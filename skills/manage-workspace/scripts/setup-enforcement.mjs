#!/usr/bin/env node
// Installs, previews or removes the clean-up enforcement for Claude Code and Codex: a SessionStart
// hook (policy and machine check), a Stop hook (what this session created and still left) and, for
// Claude Code, a SessionEnd hook (stops the helpers this session started). Preview by default; --yes
// applies. Idempotent. Never touches a hook it did not write. No network, except that `status` asks
// Codex for its hooks' trust by starting its app-server, which refreshes its model list as any Codex
// launch does (`status --no-codex` does not). Migrates an install made under
// the skill's old name, manage-workspace-storage: its entries are rewritten in place, its state and mode
// move, and its script path is refreshed so sessions started before the rename keep working.
//
// Order of work, so a failure part-way never leaves a hook pointing at nothing: every agent's file is
// read and validated first, and nothing is written if one is invalid; then the scripts are copied; then
// state and settings move; then the hook files are written, each with a backup.
//
//   node setup-enforcement.mjs [install] [--agent claude|codex|all] [--yes]
//   node setup-enforcement.mjs uninstall [--agent ...] [--purge] [--yes]
//   node setup-enforcement.mjs mode warn|block|off [--yes]
//   node setup-enforcement.mjs helpers stop|report [--yes]
//   node setup-enforcement.mjs status [--no-codex]
import { spawn } from 'node:child_process';
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = () => process.env.HOME || homedir();
const NAME = 'manage-workspace';
const LEGACY = 'manage-workspace-storage';
// machine.mjs first: leftovers.mjs imports it, so a copy interrupted between the two never leaves a
// leftovers.mjs whose dependency is missing.
const SCRIPTS = ['machine.mjs', 'leftovers.mjs'];
const dataRoot = () => process.env.XDG_DATA_HOME || path.join(HOME(), '.local/share');
const stateRoot = () => process.env.XDG_STATE_HOME || path.join(HOME(), '.local/state');
const configRoot = () => process.env.XDG_CONFIG_HOME || path.join(HOME(), '.config');
const dataDir = () => path.join(dataRoot(), NAME);
const legacyDataDir = () => path.join(dataRoot(), LEGACY);
const stateDir = () => process.env.MWS_STATE_DIR || path.join(stateRoot(), NAME);
const configDir = () => process.env.MWS_CONFIG_DIR || path.join(configRoot(), NAME);
const installed = () => path.join(dataDir(), 'leftovers.mjs');
const dq = (s) => `"${String(s).replace(/(["\\$`])/g, '\\$1')}"`;
const undq = (s) => s.replace(/\\(["\\$`])/g, '$1');

const AGENTS = {
  claude: { label: 'Claude Code', dir: () => process.env.CLAUDE_CONFIG_DIR || path.join(HOME(), '.claude'), file: 'settings.json' },
  codex: { label: 'Codex', dir: () => process.env.CODEX_HOME || path.join(HOME(), '.codex'), file: 'hooks.json' },
};
const agentFile = (a) => path.join(AGENTS[a].dir(), AGENTS[a].file);

function command(event) {
  const node = process.execPath;
  // The node that ran this setup, or the first node on PATH if it has moved since.
  return `if [ -x ${dq(node)} ]; then exec ${dq(node)} ${dq(installed())} ${event}; else exec node ${dq(installed())} ${event}; fi`;
}
// SessionEnd is observed in Claude Code; Codex 0.171.0 carries its input schema but it has not been
// observed firing there, so Codex gets the other two until it is.
// Stop and SessionEnd may stop helpers, which on a loaded machine takes several seconds: 30 s each.
// fork is Codex's source for a forked session; Claude Code never sends it, and the matcher is a pattern.
const MATCHER = 'startup|resume|clear|compact|fork';
const KNOWN_MATCHERS = [MATCHER, 'startup|resume|clear|compact'];
// A group is ours only with the matcher setup writes: SessionStart's, and none for the other events.
const ourGroup = (event, g) => (event === 'SessionStart' ? KNOWN_MATCHERS.includes(g?.matcher) : !g?.matcher);
const wanted = (agent) => ({
  SessionStart: { matcher: MATCHER, hooks: [{ type: 'command', command: command('session-start'), timeout: 10 }] },
  Stop: { hooks: [{ type: 'command', command: command('stop'), timeout: 30 }] },
  ...(agent === 'claude' ? { SessionEnd: { hooks: [{ type: 'command', command: command('session-end'), timeout: 30 }] } } : {}),
});

// An entry is ours only in the exact shape command() writes, under the new or the old name. A hook a
// person wrote that merely runs the script, or does more besides, is never claimed.
const Q = '"((?:[^"\\\\]|\\\\.)*)"';
const OURS = new RegExp(`^if \\[ -x ${Q} \\]; then exec ${Q} ${Q} (session-start|stop|session-end); else exec node ${Q} \\4; fi$`);
const EVENT_ARG = { SessionStart: 'session-start', Stop: 'stop', SessionEnd: 'session-end' };
export function oursScript(h, event) {
  // exactly the fields setup writes, timeout included; a hook with async, args or anything else is a person's
  if (typeof h?.command !== 'string' || h.type !== 'command' || typeof h.timeout !== 'number' || Object.keys(h).some((k) => !['type', 'command', 'timeout'].includes(k))) return null;
  const m = OURS.exec(h.command); if (!m || m[1] !== m[2]) return null;
  if (event !== undefined && m[4] !== EVENT_ARG[event]) return null;
  const script = undq(m[3]);
  if (undq(m[5]) !== script || !new RegExp(`/(${NAME}|${LEGACY})/leftovers\\.mjs$`).test(script)) return null;
  return script;
}
const ours = (h, event) => oursScript(h, event) !== null;
// Setup writes only these events; the same command copied into another event is a person's hook.
const OUR_EVENTS = ['SessionStart', 'Stop', 'SessionEnd'];
// Any hook, ours or a person's, that may run one of this skill's script copies: one that names the
// skill's data folder and the script anywhere in it (command, args, a cd then a relative path).
const usesScripts = (json) => Object.values(json.hooks ?? {}).flatMap((l) => (Array.isArray(l) ? l : [])).flatMap((g) => g.hooks ?? [])
  .some((h) => { const t = JSON.stringify(h ?? {}); return new RegExp(`/(${NAME}|${LEGACY})(?![\\w-])`).test(t) && /(leftovers|machine)\.mjs/.test(t); });

function readJson(file) {
  if (!existsSync(file)) return { json: {}, text: null };
  const text = readFileSync(file, 'utf8');
  let json; try { json = JSON.parse(text); } catch (e) { throw new Error(`${file} is not valid JSON; nothing changed (${e.message})`); }
  const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!plain(json)) throw new Error(`${file} is not a JSON object; nothing changed`);
  if (json.hooks !== undefined && !plain(json.hooks)) throw new Error(`${file}: "hooks" is not an object; nothing changed`);
  return { json, text };
}

// Returns {next, changes[]} without writing.
function planInstall(json, agent, notes = []) {
  const next = structuredClone(json); const changes = [];
  next.hooks ??= {};
  for (const [event, group] of Object.entries(wanted(agent))) {
    const list = (next.hooks[event] ??= []);
    let done = false;
    for (const g of list) {
      if (!Array.isArray(g.hooks) || !ourGroup(event, g)) continue;
      g.hooks = g.hooks.filter((h) => {
        if (!ours(h, event)) return true;
        if (done) { changes.push(`remove duplicate ${event} entry`); return false; }
        done = true;
        if (h.command !== group.hooks[0].command || h.timeout !== group.hooks[0].timeout) { h.command = group.hooks[0].command; h.timeout = group.hooks[0].timeout; changes.push(`update ${event} entry`); }
        if (group.matcher && g.matcher !== group.matcher) {
          if (g.hooks.length === 1) { g.matcher = group.matcher; changes.push(`update ${event} matcher`); }
          else notes.push(`${event}: the group holding this entry also holds another hook, so its matcher (${g.matcher}) is left as it is; add |fork to it for Codex forks`);
        }
        return true;
      });
    }
    next.hooks[event] = list.filter((g) => !(Array.isArray(g.hooks) && g.hooks.length === 0));
    if (!done) { next.hooks[event].push(group); changes.push(`add ${event} entry${group.matcher ? ` (matcher ${group.matcher})` : ''}`); }
  }
  return { next, changes };
}
function planRemove(json) {
  const next = structuredClone(json); const changes = [];
  for (const [event, list] of Object.entries(next.hooks ?? {})) {
    if (!Array.isArray(list) || !OUR_EVENTS.includes(event)) continue;
    for (const g of list) {
      if (!ourGroup(event, g)) continue;
      const before = g.hooks?.length ?? 0;
      if (g.hooks) g.hooks = g.hooks.filter((h) => !ours(h, event));
      if (before !== (g.hooks?.length ?? 0)) changes.push(`remove ${event} entry`);
    }
    next.hooks[event] = list.filter((g) => !(Array.isArray(g.hooks) && g.hooks.length === 0));
    if (next.hooks[event].length === 0 && changes.some((c) => c === `remove ${event} entry`)) delete next.hooks[event];
  }
  return { next, changes };
}
const scriptsIn = (json) => Object.entries(json.hooks ?? {}).filter(([e]) => OUR_EVENTS.includes(e))
  .flatMap(([e, l]) => (Array.isArray(l) ? l : []).filter((g) => ourGroup(e, g)).flatMap((g) => (g.hooks ?? []).map((h) => oursScript(h, e)))).filter(Boolean);

// Codex keeps trust in config.toml as [hooks.state."<hooks.json>:<event>:<group>:<hook>"] with a
// trusted_hash once a person has reviewed the hook in /hooks, and runs a hook only while that hash
// equals one it computes from a normalised form of the hook: an internal method, not imitated here.
// Codex's app-server lists every hook with its own verdict (`hooks/list`, which /hooks reads), so status
// asks it. Only when Codex cannot be asked does it read the stored hashes, whose presence cannot tell a
// hash for the current command from one for an older command.
function codexHookKeys(hooksFile, json) {
  const found = [];
  for (const [event, list] of Object.entries(json.hooks ?? {})) {
    if (!Array.isArray(list)) continue;
    list.forEach((g, gi) => (Array.isArray(g?.hooks) ? g.hooks : []).forEach((h, hi) => {
      if (h && typeof h === 'object' && ours(h, event) && ourGroup(event, g)) found.push({ event, key: `${hooksFile}:${event.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()}:${gi}:${hi}` });
    }));
  }
  return found;
}
function storedTrust(hooksFile, hooks) {
  let toml; try { toml = readFileSync(path.join(path.dirname(hooksFile), 'config.toml'), 'utf8'); } catch { toml = ''; }
  return hooks.map(({ event, key }) => {
    const header = `[hooks.state."${key}"]`;
    const at = toml.indexOf(header);
    const body = at < 0 ? '' : toml.slice(at + header.length).split(/^\[/m)[0];
    return `${event} ${/^\s*trusted_hash\s*=\s*"sha256:[0-9a-f]+"/m.test(body) ? 'trusted' : 'not trusted'}`;
  });
}
const codexAnswerMs = () => {
  const asked = Number(process.env.MWS_CODEX_ANSWER_MS);
  return asked > 0 ? Math.min(asked, 60000) : 10000;
};
// One exchange with `codex app-server` over stdio: initialize, initialized, hooks/list. Plugins are
// disabled for it, which skips the plugin refresh Codex otherwise starts; the hooks in hooks.json are
// listed all the same. Its model-list refresh, which every Codex launch makes, cannot be turned off.
// It runs in a process group of its own, killed whole when it has answered, exited, or not answered in
// time (10 s), or when this process is interrupted, so a wrapper's children go with it. The result is
// the hooks Codex listed with the warnings it gave, or why it could not be asked, including an error it
// reports while listing.
function codexHookList(cwd) {
  const bin = process.env.MWS_CODEX_BIN || 'codex';
  const limit = codexAnswerMs();
  return new Promise((resolve) => {
    let child; let buf = ''; let done = false;
    const killGroup = () => {
      if (!child?.pid) return;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
    };
    const onSignal = (signal) => { killGroup(); process.exit(signal === 'SIGINT' ? 130 : 143); };
    const finish = (result) => {
      if (done) return; done = true; clearTimeout(timer);
      process.off('exit', killGroup); process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
      killGroup();
      child?.stdout?.destroy(); child?.stdin?.destroy(); child?.unref();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ error: `it did not answer within ${limit / 1000} s` }), limit);
    try {
      child = spawn(bin, ['app-server', '--disable', 'plugins'], { stdio: ['pipe', 'pipe', 'ignore'], detached: true });
    } catch (e) { finish({ error: e.message }); return; }
    process.once('exit', killGroup); process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
    const send = (message) => { try { child.stdin.write(`${JSON.stringify(message)}\n`); } catch { /* reported by close */ } };
    child.on('error', (e) => finish({ error: e.code === 'ENOENT' ? `${bin} is not installed` : e.message }));
    child.on('close', () => finish({ error: 'it exited before listing its hooks' }));
    child.stdin.on('error', () => { /* reported by close */ });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      buf += d; let i;
      while (!done && (i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (!m || typeof m !== 'object') continue;
        if (m.id === 1) {
          if (m.error) { finish({ error: `initialize failed: ${m.error.message ?? JSON.stringify(m.error)}` }); return; }
          send({ method: 'initialized' });
          send({ id: 2, method: 'hooks/list', params: { cwds: [cwd] } });
        } else if (m.id === 2) {
          const data = m.result?.data;
          if (m.error) { finish({ error: `hooks/list failed: ${m.error.message ?? JSON.stringify(m.error)}` }); return; }
          if (!Array.isArray(data)) { finish({ error: 'hooks/list returned no list' }); return; }
          const errors = data.flatMap((entry) => (Array.isArray(entry?.errors) ? entry.errors : []));
          if (errors.length) { finish({ error: `it reported ${errors.map((e) => (typeof e === 'string' ? e : e?.message ?? JSON.stringify(e))).join('; ')}` }); return; }
          const warnings = data.flatMap((entry) => (Array.isArray(entry?.warnings) ? entry.warnings : []))
            .map((w) => (typeof w === 'string' ? w : w?.message ?? JSON.stringify(w)));
          finish({ hooks: data.flatMap((entry) => (Array.isArray(entry?.hooks) ? entry.hooks : [])), warnings });
        }
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: NAME, version: '0' } } });
  });
}
// A hook's key as Codex writes it, with its hooks.json path resolved, so a symlinked CODEX_HOME matches.
function sameKey(key) {
  const parts = key.split(':');
  if (parts.length < 4) return key;
  const file = parts.slice(0, -3).join(':');
  let real; try { real = realpathSync.native(file); } catch { real = file; }
  return [real, ...parts.slice(-3)].join(':');
}
const TRUST_WORDS = {
  trusted: 'trusted',
  modified: 'changed since it was trusted, so Codex does not run it: trust it again in /hooks',
  untrusted: 'not trusted',
  managed: 'managed by an administrator',
};
// Codex's verdict is for one folder: a project's own .codex/config.toml can turn hooks off, so status
// asks about the folder it runs in and names it.
async function codexTrust(hooksFile, json, { askCodex = true, cwd = process.cwd() } = {}) {
  const hooks = codexHookKeys(hooksFile, json);
  const listed = askCodex ? await codexHookList(cwd) : { error: 'not asked: --no-codex' };
  if (listed.hooks) {
    const verdict = new Map(listed.hooks.filter((h) => h && typeof h.key === 'string').map((h) => [sameKey(h.key), h]));
    const words = hooks.map(({ event, key }) => {
      const h = verdict.get(sameKey(key));
      if (!h) return `${event} not listed by Codex`;
      const word = TRUST_WORDS[h.trustStatus] ?? String(h.trustStatus);
      return `${event} ${word}${h.enabled === false ? ', but turned off in Codex (enabled = false), so Codex does not run it' : ''}`;
    });
    const warned = listed.warnings?.length ? `; Codex warned: ${listed.warnings.join('; ')}` : '';
    return `${words.join('; ')} (as Codex reports it for ${cwd}${warned})`;
  }
  return `${storedTrust(hooksFile, hooks).join('; ')} (a stored hash only, which cannot tell the current command from an older one: Codex could not be asked (${listed.error}). /hooks in Codex is the authority)`;
}

function backupAndWrite(file, json, original) {
  let backup;
  if (original !== null) {
    let b = `${file}.bak-${NAME}`;
    if (existsSync(b)) b = `${b}-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`;
    copyFileSync(file, b); try { chmodSync(b, statSync(file).mode & 0o777); } catch { /* keep default */ }
    backup = b;
  } else mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.mw-${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(json, null, 2)}\n`, original !== null ? { mode: statSync(file).mode & 0o777 } : {});
  renameSync(tmp, file);
  return backup;
}

// State and settings written under the old name move to the new one, file by file, unless a folder
// was given explicitly (MWS_STATE_DIR, MWS_CONFIG_DIR). Where a file exists on both sides, a ledger is
// joined (the old entries first, since they are older) and anything else keeps the new copy.
function migrations() {
  const out = [];
  if (!process.env.MWS_STATE_DIR) out.push({ what: 'session state', from: path.join(stateRoot(), LEGACY), to: stateDir() });
  if (!process.env.MWS_CONFIG_DIR) out.push({ what: 'settings', from: path.join(configRoot(), LEGACY), to: configDir() });
  return out.filter((m) => existsSync(m.from));
}
function walkFiles(dir, base = dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p, base)); else out.push(path.relative(base, p));
  }
  return out;
}
function mergeInto(from, to) {
  let moved = 0; let joined = 0;
  for (const rel of walkFiles(from)) {
    const src = path.join(from, rel); const dst = path.join(to, rel);
    mkdirSync(path.dirname(dst), { recursive: true });
    if (!existsSync(dst)) { renameSync(src, dst); moved += 1; continue; }
    if (rel.startsWith(`ledger${path.sep}`) && rel.endsWith('.jsonl')) {
      // joined in time order, so a later keep or done written under either name still follows its note
      const lines = [...readFileSync(src, 'utf8').split('\n'), ...readFileSync(dst, 'utf8').split('\n')].filter(Boolean)
        .map((l, i) => { let ts = ''; try { ts = JSON.parse(l).ts || ''; } catch { /* keep its place */ } return { l, i, ts }; })
        .sort((a, b) => (a.ts && b.ts && a.ts !== b.ts ? (a.ts < b.ts ? -1 : 1) : a.i - b.i));
      const tmp = `${dst}.mw-${process.pid}.tmp`; writeFileSync(tmp, `${lines.map((x) => x.l).join('\n')}\n`); renameSync(tmp, dst); joined += 1;
    }
    rmSync(src, { force: true });
  }
  const prune = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) prune(path.join(d, e.name)); try { rmdirSync(d); } catch { /* not empty */ } };
  prune(from);
  return { moved, joined };
}

// The script copy the hooks call, and every old-name script path still in use (the default one, and
// any an old hook entry names under another data folder) refreshed with the same bytes, for sessions
// that started before the rename and still run the old command or were told the old path.
function copies(legacyScripts) {
  const dirs = new Set([dataDir()]);
  if (existsSync(legacyDataDir())) dirs.add(legacyDataDir());
  for (const s of legacyScripts) if (existsSync(path.dirname(s))) dirs.add(path.dirname(s));
  const out = [];
  for (const dir of dirs) for (const f of SCRIPTS) {
    const src = path.join(HERE, f); const dst = path.join(dir, f);
    const same = existsSync(dst) && readFileSync(dst, 'utf8') === readFileSync(src, 'utf8');
    out.push({ src, dst, dir, same, legacy: dir !== dataDir() });
  }
  return out;
}

async function main(argv) {
  const args = argv.slice(); const flags = new Set(); const kv = {};
  const pos = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--agent') { kv.agent = args[++i]; } else if (args[i].startsWith('--')) flags.add(args[i]); else pos.push(args[i]);
  }
  const action = ['install', 'uninstall', 'mode', 'helpers', 'status'].includes(pos[0]) ? pos[0] : 'install';
  const apply = flags.has('--yes');
  const out = (s) => process.stdout.write(`${s}\n`);
  const which = (kv.agent && kv.agent !== 'all' ? [kv.agent] : Object.keys(AGENTS)).filter((a) => AGENTS[a]);
  if (kv.agent && kv.agent !== 'all' && !AGENTS[kv.agent]) { out(`unknown agent ${kv.agent}; use claude, codex or all`); return 2; }

  if (action === 'mode' || action === 'helpers') {
    const m = pos[1];
    const allowed = action === 'mode' ? ['warn', 'block', 'off'] : ['stop', 'report'];
    if (!allowed.includes(m)) { out(`usage: setup-enforcement.mjs ${action} ${allowed.join('|')} [--yes]`); return 2; }
    const f = path.join(configDir(), action);
    const what = action === 'mode' ? 'end-of-turn check mode' : 'helper handling (stop: the hooks stop this session\'s own helpers; report: they stop nothing)';
    out(`${apply ? 'set' : 'would set'} ${what} to ${m} (${f}); the environment variable ${action === 'mode' ? 'MWS_CLEANUP_MODE' : 'MWS_HELPERS'} overrides it for one process`);
    if (apply) { mkdirSync(configDir(), { recursive: true }); writeFileSync(f, `${m}\n`); } else out('preview only: re-run with --yes to apply');
    return 0;
  }

  if (action === 'status') {
    out(`script copy: ${existsSync(installed()) ? installed() : 'not installed'}`);
    if (existsSync(path.join(legacyDataDir(), 'leftovers.mjs'))) out(`old path kept for sessions started before the rename: ${path.join(legacyDataDir(), 'leftovers.mjs')} (uninstall removes it)`);
    for (const m of migrations()) out(`${m.what} still under the old name: ${m.from} (install moves it)`);
    for (const a of which) {
      const f = agentFile(a);
      let has = [];
      try { const { json } = readJson(f); has = Object.entries(json.hooks ?? {}).filter(([e, l]) => OUR_EVENTS.includes(e) && Array.isArray(l) && l.some((g) => ourGroup(e, g) && g.hooks?.some((h) => ours(h, e)))).map(([e]) => e); } catch (e) { has = [`unreadable: ${e.message}`]; }
      out(`${AGENTS[a].label}: ${existsSync(AGENTS[a].dir()) ? f : 'not present'}: ${has.length ? has.join(', ') : 'no clean-up hooks'}`);
      if (a === 'codex' && has.length) {
        let json; try { ({ json } = readJson(f)); } catch { /* unreadable: reported above */ }
        if (json) {
          try { out(`Codex trust: ${await codexTrust(f, json, { askCodex: !flags.has('--no-codex') })}`); } catch (e) { out(`Codex trust: could not be read (${e.message})`); }
        }
      }
    }
    return 0;
  }

  // 1. Read and plan every agent first; an invalid file stops the run before anything is written.
  const plans = []; const earlyNotes = [];
  for (const a of which) {
    const { label, dir } = AGENTS[a]; const f = agentFile(a);
    if (!existsSync(dir())) { out(`${label}: not present (${dir()} does not exist); skipped`); continue; }
    let read; try { read = readJson(f); } catch (e) { out(`${label}: ${e.message}`); out('nothing was written'); return 1; }
    const { next, changes } = action === 'uninstall' ? planRemove(read.json) : planInstall(read.json, a, earlyNotes);
    plans.push({ a, label, f, read, next, changes });
  }
  const legacyScripts = plans.flatMap((p) => scriptsIn(p.read.json)).filter((s) => s.includes(`/${LEGACY}/`));

  let any = plans.some((p) => p.changes.length); const notes = [...new Set(earlyNotes)];
  for (const p of plans) {
    if (!p.changes.length) { out(`${p.label}: ${p.f}: already ${action === 'uninstall' ? 'clean' : 'up to date'}`); continue; }
    if (p.read.text !== null && JSON.stringify(p.read.json, null, 2) + '\n' !== p.read.text) notes.push(`${p.label}: ${p.f} is not formatted as 2-space JSON; the write re-indents it (content and key order unchanged)`);
    if (!apply) out(`${p.label}: ${p.f}: would ${p.changes.join('; ')}`);
  }

  if (action === 'install') {
    // 2. Scripts first, so no hook ever points at a file that is not there yet.
    for (const c of copies(legacyScripts)) {
      const where = `${c.legacy ? 'old path, for sessions started before the rename' : 'script copy'}: ${c.dst}`;
      if (c.same) { out(`${where}: up to date`); continue; }
      any = true;
      if (!apply) { out(`${where}: would write`); continue; }
      mkdirSync(c.dir, { recursive: true }); const tmp = `${c.dst}.${process.pid}.tmp`; copyFileSync(c.src, tmp); renameSync(tmp, c.dst); out(`${where}: wrote`);
    }
    // 3. State and settings.
    for (const m of migrations()) {
      any = true;
      if (!apply) { out(`${m.what}: would move ${m.from} to ${m.to}${existsSync(m.to) ? ' (joining ledgers that exist on both sides)' : ''}`); continue; }
      const r = mergeInto(m.from, m.to); out(`${m.what}: moved ${m.from} to ${m.to} (${r.moved} files moved${r.joined ? `, ${r.joined} ledgers joined` : ''})`);
    }
  }

  // 4. The hook files.
  if (apply) {
    for (const p of plans) {
      if (!p.changes.length) continue;
      const backup = backupAndWrite(p.f, p.next, p.read.text);
      out(`${p.label}: ${p.f}: ${p.changes.join('; ')}${backup ? `; backup ${backup}` : ''}`);
      if (p.a === 'codex' && action === 'install') notes.push(`Codex: trust the hooks with /hooks in Codex (press t on each ${NAME} entry); non-managed hooks do not run until trusted. Trust is per machine, and needed again whenever a hook command changes${p.changes.some((c) => c.startsWith('update')) ? ', as it just did' : ''}.`);
    }
  }

  if (action === 'uninstall') {
    // The scripts and state are shared: they go only when no agent's file still has an entry of ours.
    // every agent file this run planned, plus the default ones (a second Claude Code or Codex profile in
    // its default folder shares this data folder); another profile elsewhere cannot be seen
    const planned = new Map(plans.map((p) => [p.f, p]));
    const files = new Map(Object.keys(AGENTS).map((a) => [agentFile(a), AGENTS[a].label]));
    files.set(path.join(HOME(), '.claude', 'settings.json'), 'Claude Code'); files.set(path.join(HOME(), '.codex', 'hooks.json'), 'Codex');
    const stillUsed = [...new Set([...files].filter(([f]) => {
      if (planned.has(f)) return usesScripts(planned.get(f).next);
      if (!existsSync(f)) return false;
      try { return usesScripts(readJson(f).json); } catch { return true; }
    }).map(([, label]) => label))];
    // the copies under this data folder, and an old-name copy under another one that a removed entry named,
    // when that folder holds nothing but this skill's scripts
    const named = plans.flatMap((p) => scriptsIn(p.read.json)).map((s) => path.dirname(s))
      .filter((d) => [NAME, LEGACY].includes(path.basename(d)) && existsSync(d));
    const dirs = [...new Set([dataDir(), legacyDataDir(), ...named])].filter(existsSync);
    if (stillUsed.length) notes.push(`${stillUsed.join(' and ')} still ${stillUsed.length === 1 ? 'has' : 'have'} clean-up hooks, so the shared scripts${flags.has('--purge') ? ', state and settings' : ''} stay; uninstall for ${stillUsed.length === 1 ? 'it' : 'them'} too to remove them`);
    else if (apply) {
      // only this skill's own files; a folder that still holds anything else is left, and said so
      for (const d of dirs) {
        for (const f of readdirSync(d)) if (SCRIPTS.includes(f) || /^(leftovers|machine)\.mjs\.\d+\.tmp$/.test(f)) rmSync(path.join(d, f), { force: true });
        try { rmdirSync(d); out(`removed ${d}`); } catch { notes.push(`${d} holds files this skill did not write, so it was left; its scripts were removed`); }
      }
      if (flags.has('--purge')) {
        // only what this skill writes there, never the folder wholesale: MWS_STATE_DIR or MWS_CONFIG_DIR may
        // name a folder that holds other things
        for (const d of [stateDir(), path.join(stateRoot(), LEGACY)]) for (const sub of ['sessions', 'ledger']) rmSync(path.join(d, sub), { recursive: true, force: true });
        for (const d of [configDir(), path.join(configRoot(), LEGACY)]) for (const f of ['mode', 'helpers']) rmSync(path.join(d, f), { force: true });
        for (const d of [stateDir(), configDir(), path.join(stateRoot(), LEGACY), path.join(configRoot(), LEGACY)]) { try { rmdirSync(d); } catch { /* holds other things, or is gone */ } }
        out('purged this skill\'s state and settings');
      }
    } else if (dirs.length || flags.has('--purge')) { any = true; out(`would remove ${dirs.join(' and ') || 'nothing more'}${flags.has('--purge') ? ', the session state and the settings' : ''}`); }
  }
  for (const n of notes) out(`note: ${n}`);
  if (!apply) out(any ? 'preview only: re-run with --yes to apply' : 'nothing to do');
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
