#!/usr/bin/env node
// Clean-up enforcement for agent sessions: a SessionStart policy with a machine check, an end-of-turn
// (Stop) check of what THIS session created and still left, and a SessionEnd stop of the helpers THIS
// session started. Used by Claude Code and Codex hooks (SessionEnd: Claude Code only). No network.
//
// Contracts relied on (see references/enforcement.md for sources):
//   input   one JSON object on stdin: session_id, transcript_path, cwd, hook_event_name, and on Stop
//           stop_hook_active.
//   output  SessionStart: {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":...}}
//           Stop, warn:  {"systemMessage": ...}   (shown to the person; the model does not see it)
//           Stop, block: {"decision":"block","reason": ...} (the model sees the reason and continues)
//           SessionEnd: nothing (its output is not read)
// Every failure path exits 0 and prints nothing: a hook's own failure is never the session's.
// It stops processes in two cases only, both limited to helpers whose environment names THIS session:
// at SessionEnd all of them, and at Stop those whose folder is gone. MWS_HELPERS=report turns that off.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, readSync,
  renameSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  describeAgent, describeDuplicate, describeHelper, describeMemory, describeVm, memoryVerdict, readMemory, scanProcesses,
  sharedWithLiveSession, stopHelpers, stoppable,
} from './machine.mjs';

export const VERSION = '2.0.0';
const NAME = 'manage-workspace';
const LEGACY = 'manage-workspace-storage';
const HOME = () => process.env.HOME || homedir();
const ROOTS = () => [
  '/tmp', '/private/tmp', '/var/tmp', '/private/var/tmp', '/var/folders', '/private/var/folders',
  ['', 'Users', 'Shared'].join('/'), path.join(HOME(), 'Library/Caches'), path.join(HOME(), '.cache'),
];
const IGNORED = [/^\/(private\/)?tmp\/claude-/, /^\/(private\/)?var\/folders\/[^/]+\/[^/]+\/T\/claude-/];
const MAX_LISTED = 12;
const BUDGET_MS = 1200;

export const stateDir = () => process.env.MWS_STATE_DIR
  || path.join(process.env.XDG_STATE_HOME || path.join(HOME(), '.local/state'), NAME);
const configRoot = () => process.env.XDG_CONFIG_HOME || path.join(HOME(), '.config');
const configDir = () => process.env.MWS_CONFIG_DIR || path.join(configRoot(), NAME);
export const modeFile = () => path.join(configDir(), 'mode');

function setting(name, env, allowed, fallback) {
  let value = (process.env[env] || '').trim().toLowerCase();
  const files = [path.join(configDir(), name)];
  if (!process.env.MWS_CONFIG_DIR) files.push(path.join(configRoot(), LEGACY, name)); // before setup moved it
  for (const f of files) { if (value) break; try { value = readFileSync(f, 'utf8').trim().toLowerCase(); } catch { value = ''; } }
  return allowed.includes(value) ? value : fallback;
}
export const readMode = () => setting('mode', 'MWS_CLEANUP_MODE', ['off', 'warn', 'block'], 'warn');
// stop: the hooks stop this session's own helpers (all at SessionEnd, deleted-folder ones at Stop); report: list only
export const readHelpers = () => setting('helpers', 'MWS_HELPERS', ['stop', 'report'], 'stop');

// ---- command parsing -------------------------------------------------------------------------

export function tokenize(text) {
  const segments = []; let tokens = []; let cur = ''; let has = false; let quote = '';
  const push = () => { if (has) tokens.push(cur); cur = ''; has = false; };
  const cut = () => { push(); if (tokens.length) segments.push(tokens); tokens = []; };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = '';
      else if (c === '\\' && quote === '"' && i + 1 < text.length) { i += 1; cur += text[i]; } else cur += c;
    } else if (c === "'" || c === '"') { quote = c; has = true; }
    else if (c === '\\' && i + 1 < text.length) { i += 1; cur += text[i]; has = true; }
    else if (c === '\n' || c === ';' || c === '|' || c === '&' || c === '(' || c === ')') { cut(); }
    else if (c === '>') { push(); tokens.push('>'); if (text[i + 1] === '>') i += 1; }
    else if (c === ' ' || c === '\t' || c === '\r') push();
    else { cur += c; has = true; }
  }
  cut();
  return segments;
}

function resolvePath(token, cwd) {
  if (!token || token.startsWith('-')) return null;
  let t = token;
  if (t === '~') t = HOME();
  else if (t.startsWith('~/')) t = path.join(HOME(), t.slice(2));
  else if (t.startsWith('$HOME/') || t.startsWith('${HOME}/')) t = path.join(HOME(), t.replace(/^\$\{?HOME\}?\//, ''));
  if (t.includes('$') || t.includes('`') || t.includes('*') || t.includes('{')) return null;
  if (!path.isAbsolute(t)) { if (!cwd) return null; t = path.resolve(cwd, t); }
  return path.normalize(t).replace(/\/+$/, '') || '/';
}

const underRoot = (p) => ROOTS().some((r) => p !== r && (p === r || p.startsWith(`${r}/`)));
const ignored = (p) => IGNORED.some((re) => re.test(p));

// Returns candidates: {kind, key, label}. kind: path | worktree | container | compose | vm | image
export function extract(text, cwd0) {
  const out = []; let cwd = cwd0;
  const add = (kind, key, label, extra = {}) => { if (key) out.push({ kind, key, label: label || key, ...extra }); };
  for (const seg of tokenize(text)) {
    let toks = seg.slice();
    while (toks.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[0])) {
      const [name, ...rest] = toks.shift().split('=');
      const v = resolvePath(rest.join('='), cwd);
      if (v && /(CACHE|cache)/.test(name) && underRoot(v)) add('path', v, `${name} cache folder`);
    }
    while (['sudo', 'command', 'time', 'env', 'nohup'].includes(toks[0])) toks.shift();
    if (!toks.length) continue;
    const cmd = path.basename(toks[0]); let args = toks.slice(1);
    for (let g = args.indexOf('>'); g !== -1; g = args.indexOf('>')) {
      if (args[g + 1]) { const p = resolvePath(args[g + 1], cwd); if (p && underRoot(p)) add('path', p, 'file written by redirect'); }
      args = [...args.slice(0, g), ...args.slice(g + 2)];
    }
    const pos = args.filter((a) => !a.startsWith('-'));
    for (let i = 0; i < args.length; i += 1) {
      if (/^--(cache|cache-dir|cache-folder)(=|$)/.test(args[i])) {
        const v = resolvePath(args[i].includes('=') ? args[i].split('=').slice(1).join('=') : args[i + 1], cwd);
        if (v && underRoot(v)) add('path', v, 'cache folder');
      }
    }
    if (cmd === 'cd') { const p = resolvePath(pos[0], cwd); if (p) cwd = p; continue; }
    if (cmd === 'git') {
      let base = cwd; let i = 0;
      while (i < args.length && args[i].startsWith('-')) { if (args[i] === '-C') { base = resolvePath(args[i + 1], cwd) || base; i += 2; } else i += 1; }
      if (args[i] === 'worktree' && args[i + 1] === 'add') {
        const rest = args.slice(i + 2); const keep = [];
        for (let k = 0; k < rest.length; k += 1) { if (['-b', '-B', '--orphan'].includes(rest[k])) k += 1; else if (!rest[k].startsWith('-')) keep.push(rest[k]); }
        add('worktree', resolvePath(keep[0], base), 'git worktree');
      } else if (args[i] === 'clone') {
        const rest = args.slice(i + 1).filter((a) => !a.startsWith('-'));
        const dest = rest.length >= 2 ? resolvePath(rest[rest.length - 1], base) : null;
        if (dest && underRoot(dest)) add('path', dest, 'git clone');
      }
    } else if (cmd === 'docker' || cmd === 'podman') {
      const sub = pos[0] === 'container' ? pos[1] : pos[0];
      if (sub === 'run' || sub === 'create') {
        const n = args.findIndex((a) => a === '--name' || a.startsWith('--name='));
        const name = n === -1 ? '' : (args[n].includes('=') ? args[n].split('=')[1] : args[n + 1]);
        if (name && !(args.includes('--rm') && !args.includes('-d') && !args.includes('--detach'))) add('container', name, 'container');
      } else if (sub === 'compose' || (cmd === 'docker' && pos[0] === 'compose')) {
        const up = args.includes('up');
        if (up) {
          const pi = args.findIndex((a) => a === '-p' || a === '--project-name');
          const project = (pi !== -1 ? args[pi + 1] : path.basename(cwd || '')).toLowerCase();
          if (project) add('compose', project, 'compose project');
        }
      }
    } else if (cmd === 'tart') {
      const sub = pos[0];
      if (sub === 'clone' && pos[2]) add('vm', pos[2], 'tart VM', { created: true });
      else if (sub === 'create' && pos[1]) add('vm', pos[1], 'tart VM', { created: true });
      else if (sub === 'run' && pos[1]) add('vm', pos[1], 'tart VM', { created: false });
    } else if (cmd === 'hdiutil') {
      const sub = pos[0];
      if (sub === 'create') {
        const o = args.indexOf('-o'); let f = o !== -1 ? args[o + 1] : pos[pos.length - 1];
        if (f && !/\.(dmg|sparseimage|sparsebundle|iso|cdr)$/.test(f) && !f.includes('.')) f += '.dmg';
        add('path', resolvePath(f, cwd), 'disk image');
      }
    } else if (['mkdir', 'touch', 'tee', 'screencapture', 'unzip', 'tar', 'curl', 'wget'].includes(cmd)) {
      const cands = [];
      for (let i = 0; i < args.length; i += 1) {
        const a = args[i];
        if (['-o', '--output', '-O', '-d', '-C', '-P', '--directory-prefix'].includes(a)) cands.push(args[i + 1]);
        else if (!a.startsWith('-') && ['mkdir', 'touch', 'tee', 'screencapture'].includes(cmd)) cands.push(a);
      }
      for (const c of cands) { const p = resolvePath(c, cwd); if (p && underRoot(p)) add('path', p, cmd === 'screencapture' ? 'screenshot' : 'created folder or file'); }
    } else if (['cp', 'mv', 'ditto', 'rsync', 'ln'].includes(cmd)) {
      const dest = resolvePath(pos[pos.length - 1], cwd);
      if (pos.length >= 2 && dest && underRoot(dest)) add('path', dest, `${cmd} destination`);
    }
  }
  return { found: out, cwd };
}

// ---- transcript reading ----------------------------------------------------------------------

function* strings(value) {
  if (typeof value === 'string') yield value;
  else if (Array.isArray(value)) for (const v of value) yield* strings(v);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) yield* strings(v);
}

export function linesToCandidates(lines, state) {
  for (const line of lines) {
    if (!/tool_use|function_call|custom_tool_call|local_shell_call|turn_context|session_meta/.test(line)) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const texts = [];
    if (o.type === 'assistant' && Array.isArray(o.message?.content)) {
      if (o.cwd) state.cwd = o.cwd;
      for (const c of o.message.content) {
        if (c?.type !== 'tool_use') continue;
        if (c.name === 'Bash' && typeof c.input?.command === 'string') texts.push(c.input.command);
        else if (c.name === 'Write' && typeof c.input?.file_path === 'string') {
          const p = resolvePath(c.input.file_path, state.cwd);
          if (p && underRoot(p)) addCandidate(state, { kind: 'path', key: p, label: 'file written' });
        }
      }
    } else if (o.type === 'turn_context' || o.type === 'session_meta') {
      if (typeof o.payload?.cwd === 'string') state.cwd = o.payload.cwd;
    } else if (o.type === 'response_item' && o.payload) {
      const p = o.payload;
      if (p.type === 'function_call' && typeof p.arguments === 'string') {
        try { texts.push(...strings(JSON.parse(p.arguments))); } catch { texts.push(p.arguments); }
      } else if (p.type === 'custom_tool_call' && typeof p.input === 'string') texts.push(p.input);
      else if (p.type === 'local_shell_call') texts.push(...[...strings(p.action)].join(' ').split('\n'));
    }
    for (const t of texts) {
      const r = extract(t, state.cwd);
      for (const c of r.found) addCandidate(state, c);
    }
  }
}

function addCandidate(state, c) {
  const id = `${c.kind}:${c.key}`;
  if (!state.cands[id]) state.cands[id] = { ...c, seq: Object.keys(state.cands).length };
  else if (c.created) state.cands[id].created = true;
}

const sessionFile = (sid) => path.join(stateDir(), 'sessions', `${String(sid).replace(/[^A-Za-z0-9_.-]/g, '_')}.json`);
const ledgerFile = (sid) => path.join(stateDir(), 'ledger', `${String(sid).replace(/[^A-Za-z0-9_.-]/g, '_')}.jsonl`);

function loadState(sid) {
  try { return JSON.parse(readFileSync(sessionFile(sid), 'utf8')); } catch { return { offset: 0, cwd: '', cands: {}, start: 0, reported: '', blocked: '' }; }
}
function saveState(sid, state) {
  const f = sessionFile(sid); mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(state)); renameSync(tmp, f);
}

function scanTranscript(file, state) {
  if (!file || !existsSync(file)) return;
  const fd = openSync(file, 'r');
  try {
    const st = fstatSync(fd);
    if (!state.start) state.start = Math.min(st.birthtimeMs || st.mtimeMs, st.mtimeMs);
    if (st.size < state.offset) { state.offset = 0; state.cands = {}; }
    if (st.size === state.offset) return;
    const buf = Buffer.alloc(st.size - state.offset);
    let got = 0; while (got < buf.length) { const n = readSync(fd, buf, got, buf.length - got, state.offset + got); if (!n) break; got += n; }
    const text = buf.subarray(0, got).toString('utf8');
    const lastNl = text.lastIndexOf('\n');
    if (lastNl === -1) return;
    state.offset += Buffer.byteLength(text.slice(0, lastNl + 1));
    linesToCandidates(text.slice(0, lastNl).split('\n'), state);
  } finally { closeSync(fd); }
}

// ---- ledger (the session's own notes) ----------------------------------------------------------

export function readLedger(sid) {
  const items = new Map();
  let raw = ''; try { raw = readFileSync(ledgerFile(sid), 'utf8'); } catch { return items; }
  for (const line of raw.split('\n')) {
    if (!line) continue; let e; try { e = JSON.parse(line); } catch { continue; }
    const id = `${e.kind}:${e.path}`;
    if (e.op === 'note') items.set(id, { ...e, status: 'open' });
    else if (e.op === 'done') items.delete(id);
    else if (e.op === 'keep') { const cur = items.get(id) || { kind: e.kind, path: e.path }; items.set(id, { ...cur, status: 'kept', reason: e.reason }); }
  }
  return items;
}
const appendLedger = (sid, entry) => {
  const f = ledgerFile(sid); mkdirSync(path.dirname(f), { recursive: true });
  appendFileSync(f, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
};

// ---- live checks -----------------------------------------------------------------------------

function run(cmd, args, ms) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: ms, stdio: ['ignore', 'pipe', 'ignore'] });
  return r.status === 0 && !r.error ? r.stdout : null;
}
function sizeOf(p, deadline) {
  try {
    const st = lstatSync(p);
    if (!st.isDirectory()) return st.size;
    const left = deadline - Date.now(); if (left < 100) return null;
    const out = run('du', ['-sk', p], Math.min(left, 600));
    return out ? Number(out.split(/\s/)[0]) * 1024 : null;
  } catch { return null; }
}
const human = (n) => (n == null ? 'size unknown' : n >= 2 ** 30 ? `${(n / 2 ** 30).toFixed(1)} GiB` : n >= 2 ** 20 ? `${(n / 2 ** 20).toFixed(1)} MiB` : `${Math.max(1, Math.round(n / 1024))} KiB`);

export function findLeftovers(sid, transcript, { persist = true } = {}) {
  const deadline = Date.now() + BUDGET_MS;
  const state = loadState(sid);
  scanTranscript(transcript, state);
  const ledger = readLedger(sid);
  const cands = Object.values(state.cands).sort((a, b) => a.seq - b.seq);
  for (const item of ledger.values()) cands.push({ kind: item.kind, key: item.path, label: item.purpose || item.kind, seq: 1e9, noted: item });
  const live = {};
  const need = (k) => cands.some((c) => c.kind === k);
  if (need('container') || need('compose')) {
    const t = run('docker', ['ps', '-a', '--format', '{{.Names}}\t{{.State}}'], 700);
    live.containers = t == null ? null : Object.fromEntries(t.split('\n').filter(Boolean).map((l) => l.split('\t')));
    if (need('compose')) { const j = run('docker', ['compose', 'ls', '--format', 'json'], 700); try { live.compose = j == null ? null : Object.fromEntries(JSON.parse(j).map((p) => [p.Name, p.Status])); } catch { live.compose = null; } }
  }
  if (need('vm')) {
    const j = run('tart', ['list', '--format', 'json'], 700);
    try { live.vms = j == null ? null : Object.fromEntries(JSON.parse(j).map((v) => [v.Name, v])); } catch { live.vms = null; }
  }
  const found = []; const seen = new Set();
  for (const c of cands) {
    const id = `${c.kind}:${c.key}`; if (seen.has(id)) continue; seen.add(id);
    const note = c.noted || ledger.get(id);
    if (note?.status === 'kept') continue;
    let line = null;
    if (c.kind === 'path' || c.kind === 'worktree') {
      if (ignored(c.key)) continue;
      let st; try { st = lstatSync(c.key); } catch { continue; }
      if (!c.noted && state.start && (st.birthtimeMs || st.mtimeMs) < state.start - 5000) continue;
      line = { what: c.kind === 'worktree' ? 'worktree' : c.label, where: c.key, size: sizeOf(c.key, deadline), id };
    } else if (c.kind === 'container') {
      const s = live.containers?.[c.key]; if (!s) continue;
      line = { what: 'container', where: c.key, extra: s, id };
    } else if (c.kind === 'compose') {
      const s = live.compose?.[c.key]; if (!s) continue;
      line = { what: 'compose project', where: c.key, extra: s, id };
    } else if (c.kind === 'vm') {
      const v = live.vms?.[c.key]; if (!v) continue;
      if (!c.created && !v.Running) continue;
      line = { what: 'tart VM', where: c.key, extra: v.Running ? 'running' : 'stopped', size: (v.Size || 0) * 2 ** 30 || null, id };
    } else if (c.noted) line = { what: c.kind, where: c.key, id };
    if (line) { if (c.noted?.purpose) line.purpose = c.noted.purpose; if (c.noted?.until) line.until = c.noted.until; found.push(line); }
  }
  // report only the outermost of nested paths
  const paths = found.filter((f) => f.where.startsWith('/')).map((f) => f.where);
  const result = found.filter((f) => !f.where.startsWith('/') || !paths.some((p) => p !== f.where && f.where.startsWith(`${p}/`)));
  if (persist) saveState(sid, state);
  return { state, items: result };
}

export function describe(items) {
  const shown = items.slice(0, MAX_LISTED);
  const lines = shown.map((i) => `- ${i.what}: ${i.where}${i.extra ? ` (${i.extra})` : ''}${i.size !== undefined ? `, ${human(i.size)}` : ''}${i.purpose ? `, for ${i.purpose}` : ''}${i.until ? `, can go ${i.until}` : ''}`);
  if (items.length > shown.length) lines.push(`- and ${items.length - shown.length} more`);
  return lines.join('\n');
}

// ---- hook entry points -----------------------------------------------------------------------

function readStdin() {
  try { return JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}
const self = () => path.resolve(fileURLToPath(import.meta.url));

export function policyText(sid, mode) {
  return [
    'Standing clean-up policy for this session. It is the user\'s instruction. Agents leave things behind on this machine: worktrees, containers, VMs, disk images, cache folders, /tmp and shared-folder copies, screenshots, signed-in configurations, and processes that keep running after their session or window is gone.',
    '- When you create anything outside the repository, or a large git-ignored output inside it, note it at once: path, size, purpose, when it can go.',
    `  node "${self()}" note --session ${sid || '<session id>'} --kind path|worktree|container|vm|credential --path <path or name> --purpose "<why>" --until "<when it can go>"`,
    '- When its work is done, keep the evidence in the project\'s durable record first, then remove it. Remove worktrees you created once their branch is merged or dropped (git worktree remove, then git worktree prune). Stop containers and VMs when their step ends. A signed-in configuration is a credential: sign out and delete it when done.',
    `- Before a heavy command or a VM start, check memory; it counts swap, which the free percentage does not: node "${self()}" memory --need-mib <MiB the job needs>. If it refuses, stop what you started that is no longer needed, or wait.`,
    '- Never delete or stop what another session or project owns, or anything unpublished, running, or needed later. Ask instead.',
    '- End each task by listing what you left behind and what you removed.',
    `  An item you decide to keep: node "${self()}" keep --session ${sid || '<session id>'} --path <path or name> --reason "<why>"   (an item you removed needs no command; one you noted and removed: ... done --path <path>)`,
    `At the end of each turn a hook checks what this session created and still left (mode: ${mode}${mode === 'block' ? '; the turn cannot end until each is removed or kept with a reason' : ''}).`,
  ].join('\n');
}

// Machine-wide, read-only: what another session left is reported, never stopped, from here.
export function machineCheck({ memory = memoryVerdict(readMemory()), scan = scanProcesses() } = {}) {
  const lines = [];
  for (const h of stoppable(scan)) lines.push(describeHelper(h));
  for (const a of scan.agents) lines.push(describeAgent(a));
  for (const d of scan.duplicates) lines.push(describeDuplicate(d));
  if (!memory.ok && !memory.unknown) lines.push(`memory is low: ${memory.reasons.join('; ')} (${describeMemory(memory)})`);
  return lines;
}

function sessionStart() {
  const input = readStdin(); const mode = readMode();
  if (mode === 'off') return;
  let context = policyText(input.session_id, mode);
  try {
    const found = machineCheck();
    if (found.length) {
      context += `\n\nMachine check at session start (${found.length}):\n${found.slice(0, MAX_LISTED).map((l) => `- ${l}`).join('\n')}${found.length > MAX_LISTED ? `\n- and ${found.length - MAX_LISTED} more` : ''}\n`
        + `Tell the user about these before heavy work. Never stop another live session's processes. With the user's word, stop the helpers of ended sessions and deleted folders: node "${self()}" processes --stop-helpers --yes`;
    }
  } catch { /* the policy still goes out */ }
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } })}\n`);
}

// This session's own helpers whose folder is gone can never be reused: stop them (or list them).
function ownHelpers(sid) {
  try {
    const scan = scanProcesses();
    const mine = scan.helpers.filter((h) => h.session === sid && h.folderGone === true);
    if (!mine.length) return { lines: [], items: [] };
    if (readHelpers() === 'report') return { lines: [], items: mine.map((h) => ({ what: 'helper', where: describeHelper(h), id: `helper:${h.pid}` })) };
    const { stopped } = stopHelpers(mine);
    return { lines: stopped.length ? [`Stopped ${stopped.length} helper${stopped.length === 1 ? '' : 's'} this session left in deleted folders: ${mine.filter((h) => stopped.includes(h.pid)).map(describeHelper).join('; ')}.`] : [], items: [] };
  } catch { return { lines: [], items: [] }; }
}

// Leftovers are announced once per distinct set, and only they can block a turn. A helper this turn
// stopped is announced once, as is memory falling low; neither repeats or re-blocks the leftovers.
function stop() {
  const input = readStdin(); const mode = readMode();
  if (mode === 'off' || !input.session_id) return;
  const { state, items: found } = findLeftovers(input.session_id, input.transcript_path);
  const helpers = ownHelpers(input.session_id);
  const items = [...found, ...helpers.items];
  let memory; try { memory = memoryVerdict(readMemory()); } catch { memory = { ok: false, unknown: true }; }
  const low = !memory.ok && !memory.unknown;
  const extra = [...helpers.lines];
  if (low && !state.memoryLow) extra.push(`Memory is low: ${memory.reasons.join('; ')} (${describeMemory(memory)}). Stop VMs, containers and helpers that are no longer needed before more heavy work.`);
  const memoryChanged = Boolean(state.memoryLow) !== low; state.memoryLow = low;
  const sig = items.length ? createHash('sha256').update(items.map((i) => i.id).sort().join('\n')).digest('hex').slice(0, 16) : '';
  if (!items.length) { state.reported = ''; state.blocked = ''; }
  const body = items.length ? `This session created these and they still exist (${items.length}):\n${describe(items)}` : '';
  if (items.length && mode === 'block' && !input.stop_hook_active && state.blocked !== sig) {
    state.blocked = sig; state.reported = sig; saveState(input.session_id, state);
    const howto = `node "${self()}" keep --session ${input.session_id} --path <path or name> --reason "<why>"`;
    process.stdout.write(`${JSON.stringify({ decision: 'block', reason: `${body}\nBefore you finish: for each, keep the evidence in the project's durable record and remove it, or, if it must stay (another session owns it, it is unpublished, running, or needed later), run ${howto}. Then end with what you left behind and what you removed.${extra.length ? `\n${extra.join('\n')}` : ''}` })}\n`);
    return;
  }
  const reminder = items.length && state.reported !== sig ? `Clean-up reminder. ${body}\nRemove each when its work is done, or say in the final message why it stays.` : '';
  if (reminder) state.reported = sig;
  if (reminder || extra.length || memoryChanged || !items.length) saveState(input.session_id, state);
  const message = [reminder, ...extra].filter(Boolean).join('\n');
  if (message) process.stdout.write(`${JSON.stringify({ systemMessage: message })}\n`);
}

// At session end every helper this session started is done with, wherever its folder is, unless
// another live session works in that folder and may be reusing it.
function sessionEnd() {
  const input = readStdin();
  if (readMode() === 'off' || readHelpers() === 'report' || !input.session_id) return;
  const scan = scanProcesses();
  const mine = scan.helpers.filter((h) => h.session === input.session_id && (h.folderGone === true || !sharedWithLiveSession(h, scan.sessions, input.session_id)));
  if (mine.length) stopHelpers(mine);
}

function parseFlags(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) f[argv[i].slice(2)] = true;
    else { f[argv[i].slice(2)] = argv[i + 1]; i += 1; }
  }
  return f;
}

function ledgerCommand(op, argv) {
  const f = parseFlags(argv);
  const sid = f.session || process.env.MWS_SESSION;
  if (!sid || typeof f.path !== 'string') { process.stderr.write(`usage: leftovers.mjs ${op} --session <id> --path <path or name>${op === 'note' ? ' --kind <kind> --purpose <text> --until <text>' : op === 'keep' ? ' --reason <text>' : ''}\n`); process.exitCode = 2; return; }
  let p = f.path; if (/^[~./]/.test(p)) p = resolvePath(p, process.cwd()) || p;
  const kinds = op === 'note' ? [f.kind || 'path'] : ['path', 'worktree', 'container', 'compose', 'vm', 'credential', 'other', 'image'];
  for (const kind of kinds) appendLedger(sid, { op, kind, path: p, size: f.size, purpose: f.purpose, until: f.until, reason: f.reason });
  process.stdout.write(`${op}: ${p}\n`);
}

function list(argv) {
  const f = parseFlags(argv); const sid = f.session; if (typeof sid !== 'string') { process.stderr.write('usage: leftovers.mjs list --session <id> [--transcript <file>]\n'); process.exitCode = 2; return; }
  const { items } = findLeftovers(sid, f.transcript, { persist: false });
  process.stdout.write(items.length ? `${describe(items)}\n` : 'nothing left by this session\n');
}

const number = (v, name) => { if (v === undefined) return undefined; if (typeof v !== 'string' || !/^\d+$/.test(v)) throw new UsageError(`--${name} must be a whole number`); return Number(v); };
class UsageError extends Error {}

function memoryCommand(argv) {
  const f = parseFlags(argv);
  let limits; try { limits = { needMiB: number(f['need-mib'], 'need-mib') || 0, maxSwapMiB: number(f['max-swap-mib'], 'max-swap-mib'), minFreePct: number(f['min-free-pct'], 'min-free-pct') ?? 20 }; } catch (e) { process.stderr.write(`usage: leftovers.mjs memory [--need-mib N] [--max-swap-mib N] [--min-free-pct N]: ${e.message}\n`); process.exitCode = 2; return; }
  const v = memoryVerdict(readMemory(), limits);
  process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
  if (!v.ok) process.exitCode = 1;
}

function processesCommand(argv) {
  const f = parseFlags(argv);
  if (Object.hasOwn(f, 'session') && typeof f.session !== 'string') { process.stderr.write('usage: leftovers.mjs processes [--session <id>] [--json] [--stop-helpers [--yes]]: --session needs a session id\n'); process.exitCode = 2; return; }
  const session = typeof f.session === 'string' ? f.session : undefined;
  const scan = scanProcesses();
  const keep = (x) => !session || x.session === session;
  const report = { helpers: scan.helpers.filter(keep), agents: scan.agents.filter(keep), duplicates: scan.duplicates.filter(keep), vms: session ? [] : scan.vms, memory: memoryVerdict(readMemory()) };
  if (f['stop-helpers']) {
    const targets = stoppable(scan, { session });
    if (!targets.length) { process.stdout.write('no helper of an ended session or a deleted folder is running\n'); return; }
    if (f.yes !== true) { process.stdout.write(`would stop ${targets.length}:\n${targets.map((h) => `- ${describeHelper(h)}`).join('\n')}\npreview only: re-run with --yes to stop them\n`); return; }
    const { stopped, skipped } = stopHelpers(targets);
    process.stdout.write(`stopped ${stopped.length}${stopped.length ? `: pids ${stopped.join(', ')}` : ''}${skipped.length ? `; skipped ${skipped.map((x) => `${x.pid} (${x.why})`).join(', ')}` : ''}\n`);
    return;
  }
  if (f.json) { process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); return; }
  const lines = [
    ...report.helpers.map((h) => `- ${describeHelper(h)}`), ...report.agents.map((a) => `- ${describeAgent(a)}`),
    ...report.duplicates.map((d) => `- ${describeDuplicate(d)}`), ...report.vms.map((v) => `- ${describeVm(v)}`),
  ];
  process.stdout.write(`${lines.length ? `Processes agents left running${session ? ` for session ${session}` : ''}:\n${lines.join('\n')}` : 'no helper, parentless agent, doubled session or virtual machine process found'}\nMemory: ${describeMemory(report.memory)}${report.memory.ok || report.memory.unknown ? '' : ` - low: ${report.memory.reasons.join('; ')}`}\n`);
  if (stoppable(scan, { session }).length) process.stdout.write(`Stop the helpers of ended sessions and deleted folders: node "${self()}" processes${session ? ` --session ${session}` : ''} --stop-helpers --yes\n`);
}

const real = (p) => { try { return realpathSync.native(p); } catch { return path.resolve(p); } };
const invoked = process.argv[1] && real(process.argv[1]) === real(self());
if (invoked) {
  const [event, ...rest] = process.argv.slice(2);
  try {
    if (event === 'session-start') sessionStart();
    else if (event === 'stop') stop();
    else if (event === 'session-end') sessionEnd();
    else if (['note', 'keep', 'done'].includes(event)) ledgerCommand(event, rest);
    else if (event === 'list') list(rest);
    else if (event === 'processes') processesCommand(rest);
    else if (event === 'memory') memoryCommand(rest);
    else if (event === 'mode') process.stdout.write(`${readMode()}\n`);
    else if (event === 'helpers') process.stdout.write(`${readHelpers()}\n`);
    else if (event === 'version') process.stdout.write(`${VERSION}\n`);
    else { process.stderr.write('usage: leftovers.mjs session-start|stop|session-end|note|keep|done|list|processes|memory|mode|helpers|version\n'); process.exitCode = 2; }
  } catch { /* a hook's own failure is never the session's */ }
}
