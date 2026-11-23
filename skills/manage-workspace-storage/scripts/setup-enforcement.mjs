#!/usr/bin/env node
// Installs, previews or removes the clean-up enforcement for Claude Code and Codex: a SessionStart
// hook (policy) and a Stop hook (what this session created and still left). Preview by default;
// --yes applies. Idempotent. Never touches a hook it did not write. No network.
//
//   node setup-enforcement.mjs [install] [--agent claude|codex|all] [--yes]
//   node setup-enforcement.mjs uninstall [--agent ...] [--purge] [--yes]
//   node setup-enforcement.mjs mode warn|block|off [--yes]
//   node setup-enforcement.mjs status
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = () => process.env.HOME || homedir();
const MARK = 'manage-workspace-storage/leftovers.mjs';
const dataDir = () => path.join(process.env.XDG_DATA_HOME || path.join(HOME(), '.local/share'), 'manage-workspace-storage');
const stateDir = () => process.env.MWS_STATE_DIR || path.join(process.env.XDG_STATE_HOME || path.join(HOME(), '.local/state'), 'manage-workspace-storage');
const configDir = () => process.env.MWS_CONFIG_DIR || path.join(process.env.XDG_CONFIG_HOME || path.join(HOME(), '.config'), 'manage-workspace-storage');
const installed = () => path.join(dataDir(), 'leftovers.mjs');
const dq = (s) => `"${String(s).replace(/(["\\$`])/g, '\\$1')}"`;

const AGENTS = {
  claude: { label: 'Claude Code', dir: () => process.env.CLAUDE_CONFIG_DIR || path.join(HOME(), '.claude'), file: 'settings.json' },
  codex: { label: 'Codex', dir: () => process.env.CODEX_HOME || path.join(HOME(), '.codex'), file: 'hooks.json' },
};

function command(event) {
  const node = process.execPath;
  // The node that ran this setup, or the first node on PATH if it has moved since.
  return `if [ -x ${dq(node)} ]; then exec ${dq(node)} ${dq(installed())} ${event}; else exec node ${dq(installed())} ${event}; fi`;
}
const wanted = () => ({
  SessionStart: { matcher: 'startup|resume|clear|compact', hooks: [{ type: 'command', command: command('session-start'), timeout: 10 }] },
  Stop: { hooks: [{ type: 'command', command: command('stop'), timeout: 10 }] },
});
const ours = (h) => typeof h?.command === 'string' && h.command.includes('manage-workspace-storage/leftovers.mjs');

function readJson(file) {
  if (!existsSync(file)) return { json: {}, text: null };
  const text = readFileSync(file, 'utf8');
  try { return { json: JSON.parse(text), text }; } catch (e) { throw new Error(`${file} is not valid JSON; nothing changed (${e.message})`); }
}

// Returns {next, changes[]} without writing.
function planInstall(json) {
  const next = structuredClone(json); const changes = [];
  next.hooks ??= {};
  for (const [event, group] of Object.entries(wanted())) {
    const list = (next.hooks[event] ??= []);
    let done = false;
    for (const g of list) for (const h of g.hooks ?? []) if (ours(h)) {
      done = true;
      if (h.command !== group.hooks[0].command || h.timeout !== group.hooks[0].timeout) { h.command = group.hooks[0].command; h.timeout = group.hooks[0].timeout; changes.push(`update ${event} entry`); }
    }
    if (!done) { list.push(group); changes.push(`add ${event} entry${group.matcher ? ` (matcher ${group.matcher})` : ''}`); }
  }
  return { next, changes };
}
function planRemove(json) {
  const next = structuredClone(json); const changes = [];
  for (const [event, list] of Object.entries(next.hooks ?? {})) {
    if (!Array.isArray(list)) continue;
    for (const g of list) {
      const before = g.hooks?.length ?? 0;
      if (g.hooks) g.hooks = g.hooks.filter((h) => !ours(h));
      if (before !== (g.hooks?.length ?? 0)) changes.push(`remove ${event} entry`);
    }
    next.hooks[event] = list.filter((g) => !(Array.isArray(g.hooks) && g.hooks.length === 0));
    if (next.hooks[event].length === 0 && changes.some((c) => c === `remove ${event} entry`)) delete next.hooks[event];
  }
  return { next, changes };
}

// Codex keeps trust in config.toml as [hooks.state."<hooks.json>:<event>:<group>:<hook>"] with a
// trusted_hash once a person has reviewed the hook in /hooks. Presence of a hash is all this can
// read: it cannot tell a hash for the current command from one for an older command.
function codexTrust(hooksFile, json) {
  let toml; try { toml = readFileSync(path.join(path.dirname(hooksFile), 'config.toml'), 'utf8'); } catch { toml = ''; }
  const found = [];
  for (const [event, list] of Object.entries(json.hooks ?? {})) {
    if (!Array.isArray(list)) continue;
    list.forEach((g, gi) => (g.hooks ?? []).forEach((h, hi) => {
      if (!ours(h)) return;
      const header = `[hooks.state."${hooksFile}:${event.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()}:${gi}:${hi}"]`;
      const at = toml.indexOf(header);
      const body = at < 0 ? '' : toml.slice(at + header.length).split(/^\[/m)[0];
      found.push(`${event} ${/^\s*trusted_hash\s*=\s*"sha256:[0-9a-f]+"/m.test(body) ? 'trusted' : 'not trusted'}`);
    }));
  }
  return found;
}

function backupAndWrite(file, json, original) {
  if (original !== null) {
    let b = `${file}.bak-manage-workspace-storage`;
    if (existsSync(b)) b = `${b}-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`;
    copyFileSync(file, b); try { chmodSync(b, statSync(file).mode & 0o777); } catch { /* keep default */ }
    var backup = b;
  } else mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.mws-${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(json, null, 2)}\n`, original !== null ? { mode: statSync(file).mode & 0o777 } : {});
  renameSync(tmp, file);
  return backup;
}

function main(argv) {
  const args = argv.slice(); const flags = new Set(); const kv = {};
  const pos = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--agent') { kv.agent = args[++i]; } else if (args[i].startsWith('--')) flags.add(args[i]); else pos.push(args[i]);
  }
  const action = ['install', 'uninstall', 'mode', 'status'].includes(pos[0]) ? pos[0] : 'install';
  const apply = flags.has('--yes');
  const out = (s) => process.stdout.write(`${s}\n`);
  const which = (kv.agent && kv.agent !== 'all' ? [kv.agent] : Object.keys(AGENTS)).filter((a) => AGENTS[a]);
  if (kv.agent && kv.agent !== 'all' && !AGENTS[kv.agent]) { out(`unknown agent ${kv.agent}; use claude, codex or all`); return 2; }

  if (action === 'mode') {
    const m = pos[1];
    if (!['warn', 'block', 'off'].includes(m)) { out('usage: setup-enforcement.mjs mode warn|block|off [--yes]'); return 2; }
    const f = path.join(configDir(), 'mode');
    out(`${apply ? 'set' : 'would set'} end-of-turn check mode to ${m} (${f}); the environment variable MWS_CLEANUP_MODE overrides it for one process`);
    if (apply) { mkdirSync(configDir(), { recursive: true }); writeFileSync(f, `${m}\n`); } else out('preview only: re-run with --yes to apply');
    return 0;
  }

  if (action === 'status') {
    out(`script copy: ${existsSync(installed()) ? installed() : 'not installed'}`);
    for (const a of which) {
      const f = path.join(AGENTS[a].dir(), AGENTS[a].file);
      let has = [];
      try { const { json } = readJson(f); has = Object.entries(json.hooks ?? {}).filter(([, l]) => Array.isArray(l) && l.some((g) => g.hooks?.some(ours))).map(([e]) => e); } catch (e) { has = [`unreadable: ${e.message}`]; }
      out(`${AGENTS[a].label}: ${existsSync(AGENTS[a].dir()) ? f : 'not present'}: ${has.length ? has.join(', ') : 'no clean-up hooks'}`);
      if (a === 'codex' && has.length) {
        try { out(`Codex trust: ${codexTrust(f, readJson(f).json).join('; ')} (a stored hash only; /hooks in Codex is the authority, and a changed command needs trusting again)`); } catch { /* unreadable: reported above */ }
      }
    }
    return 0;
  }

  let any = false; const notes = [];
  for (const a of which) {
    const { label, file, dir } = AGENTS[a]; const f = path.join(dir(), file);
    if (!existsSync(dir())) { out(`${label}: not present (${dir()} does not exist); skipped`); continue; }
    let read; try { read = readJson(f); } catch (e) { out(`${label}: ${e.message}`); return 1; }
    const { next, changes } = action === 'uninstall' ? planRemove(read.json) : planInstall(read.json);
    if (!changes.length) { out(`${label}: ${f}: already ${action === 'uninstall' ? 'clean' : 'up to date'}`); continue; }
    any = true;
    if (read.text !== null && JSON.stringify(read.json, null, 2) + '\n' !== read.text) notes.push(`${label}: ${f} is not formatted as 2-space JSON; the write re-indents it (content and key order unchanged)`);
    if (!apply) { out(`${label}: ${f}: would ${changes.join('; ')}`); continue; }
    const backup = backupAndWrite(f, next, read.text);
    out(`${label}: ${f}: ${changes.join('; ')}${backup ? `; backup ${backup}` : ''}`);
    if (a === 'codex' && action === 'install') notes.push('Codex: trust the new hooks with /hooks in Codex (press t on each manage-workspace-storage entry); non-managed hooks do not run until trusted. Trust is per machine, and needed again whenever a hook command changes.');
  }

  if (action === 'install') {
    const src = path.join(HERE, 'leftovers.mjs'); const dst = installed();
    const same = existsSync(dst) && readFileSync(dst, 'utf8') === readFileSync(src, 'utf8');
    if (same) out(`script copy: ${dst}: up to date`);
    else if (!apply) out(`script copy: would write ${dst}`);
    else { mkdirSync(dataDir(), { recursive: true }); const tmp = `${dst}.${process.pid}.tmp`; copyFileSync(src, tmp); renameSync(tmp, dst); out(`script copy: wrote ${dst}`); }
    if (!same) any = true;
  } else if (apply) {
    rmSync(dataDir(), { recursive: true, force: true }); out(`removed ${dataDir()}`);
    if (flags.has('--purge')) { rmSync(stateDir(), { recursive: true, force: true }); rmSync(configDir(), { recursive: true, force: true }); out('purged state and mode setting'); }
  } else out(`would remove ${dataDir()}${flags.has('--purge') ? ', the session state and the mode setting' : ''}`);
  for (const n of notes) out(`note: ${n}`);
  if (!apply) out(any || action === 'uninstall' ? 'preview only: re-run with --yes to apply' : 'nothing to do');
  return 0;
}

process.exitCode = main(process.argv.slice(2));
