#!/usr/bin/env node
// Installs, previews or removes the clean-up enforcement for Claude Code and Codex: a SessionStart
// hook (policy and machine check), a Stop hook (what this session created and still left) and, for
// Claude Code, a SessionEnd hook (stops the helpers this session started). Preview by default; --yes
// applies. Idempotent. Never touches a hook it did not write. No network. Migrates an install made under
// the skill's old name, manage-workspace-storage: its entries are rewritten in place, its state and mode
// move, and its script path is refreshed so sessions started before the rename keep working.
//
//   node setup-enforcement.mjs [install] [--agent claude|codex|all] [--yes]
//   node setup-enforcement.mjs uninstall [--agent ...] [--purge] [--yes]
//   node setup-enforcement.mjs mode warn|block|off [--yes]
//   node setup-enforcement.mjs helpers stop|report [--yes]
//   node setup-enforcement.mjs status
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = () => process.env.HOME || homedir();
const NAME = 'manage-workspace';
const LEGACY = 'manage-workspace-storage';
const SCRIPTS = ['leftovers.mjs', 'machine.mjs'];
const dataRoot = () => process.env.XDG_DATA_HOME || path.join(HOME(), '.local/share');
const stateRoot = () => process.env.XDG_STATE_HOME || path.join(HOME(), '.local/state');
const configRoot = () => process.env.XDG_CONFIG_HOME || path.join(HOME(), '.config');
const dataDir = () => path.join(dataRoot(), NAME);
const legacyDataDir = () => path.join(dataRoot(), LEGACY);
const stateDir = () => process.env.MWS_STATE_DIR || path.join(stateRoot(), NAME);
const configDir = () => process.env.MWS_CONFIG_DIR || path.join(configRoot(), NAME);
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
// SessionEnd is observed in Claude Code; Codex 0.171.0 carries its input schema but it has not been
// observed firing there, so Codex gets the other two until it is.
const wanted = (agent) => ({
  SessionStart: { matcher: 'startup|resume|clear|compact', hooks: [{ type: 'command', command: command('session-start'), timeout: 10 }] },
  Stop: { hooks: [{ type: 'command', command: command('stop'), timeout: 10 }] },
  ...(agent === 'claude' ? { SessionEnd: { hooks: [{ type: 'command', command: command('session-end'), timeout: 10 }] } } : {}),
});
const ours = (h) => typeof h?.command === 'string' && (h.command.includes(`${NAME}/leftovers.mjs`) || h.command.includes(`${LEGACY}/leftovers.mjs`));

function readJson(file) {
  if (!existsSync(file)) return { json: {}, text: null };
  const text = readFileSync(file, 'utf8');
  try { return { json: JSON.parse(text), text }; } catch (e) { throw new Error(`${file} is not valid JSON; nothing changed (${e.message})`); }
}

// Returns {next, changes[]} without writing.
function planInstall(json, agent) {
  const next = structuredClone(json); const changes = [];
  next.hooks ??= {};
  for (const [event, group] of Object.entries(wanted(agent))) {
    const list = (next.hooks[event] ??= []);
    let done = false;
    for (const g of list) {
      if (!Array.isArray(g.hooks)) continue;
      g.hooks = g.hooks.filter((h) => {
        if (!ours(h)) return true;
        if (done) { changes.push(`remove duplicate ${event} entry`); return false; }
        done = true;
        if (h.command !== group.hooks[0].command || h.timeout !== group.hooks[0].timeout) { h.command = group.hooks[0].command; h.timeout = group.hooks[0].timeout; changes.push(`update ${event} entry`); }
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
    let b = `${file}.bak-${NAME}`;
    if (existsSync(b)) b = `${b}-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`;
    copyFileSync(file, b); try { chmodSync(b, statSync(file).mode & 0o777); } catch { /* keep default */ }
    var backup = b;
  } else mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.mw-${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(json, null, 2)}\n`, original !== null ? { mode: statSync(file).mode & 0o777 } : {});
  renameSync(tmp, file);
  return backup;
}

// State and mode written under the old name move to the new one, unless the new one already exists
// or a folder was given explicitly (MWS_STATE_DIR, MWS_CONFIG_DIR).
function migrations() {
  const out = [];
  if (!process.env.MWS_STATE_DIR) out.push({ what: 'session state', from: path.join(stateRoot(), LEGACY), to: stateDir() });
  if (!process.env.MWS_CONFIG_DIR) out.push({ what: 'mode setting', from: path.join(configRoot(), LEGACY), to: configDir() });
  return out.filter((m) => existsSync(m.from));
}

// The script copy the hooks call, and the old path refreshed with the same bytes for sessions that
// started before the rename and still run the old hook command or were told the old path.
function copies() {
  const targets = [dataDir()];
  if (existsSync(legacyDataDir())) targets.push(legacyDataDir());
  const out = [];
  for (const dir of targets) for (const f of SCRIPTS) {
    const src = path.join(HERE, f); const dst = path.join(dir, f);
    const same = existsSync(dst) && readFileSync(dst, 'utf8') === readFileSync(src, 'utf8');
    out.push({ src, dst, dir, same, legacy: dir === legacyDataDir() });
  }
  return out;
}

function main(argv) {
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
    const what = action === 'mode' ? 'end-of-turn check mode' : 'helper handling (stop: the hooks stop this session\'s own helpers; report: they only list them)';
    out(`${apply ? 'set' : 'would set'} ${what} to ${m} (${f}); the environment variable ${action === 'mode' ? 'MWS_CLEANUP_MODE' : 'MWS_HELPERS'} overrides it for one process`);
    if (apply) { mkdirSync(configDir(), { recursive: true }); writeFileSync(f, `${m}\n`); } else out('preview only: re-run with --yes to apply');
    return 0;
  }

  if (action === 'status') {
    out(`script copy: ${existsSync(installed()) ? installed() : 'not installed'}`);
    if (existsSync(path.join(legacyDataDir(), 'leftovers.mjs'))) out(`old path kept for sessions started before the rename: ${path.join(legacyDataDir(), 'leftovers.mjs')} (uninstall removes it)`);
    for (const m of migrations()) out(`${m.what} still under the old name: ${m.from} (install moves it)`);
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
    const { next, changes } = action === 'uninstall' ? planRemove(read.json) : planInstall(read.json, a);
    if (!changes.length) { out(`${label}: ${f}: already ${action === 'uninstall' ? 'clean' : 'up to date'}`); continue; }
    any = true;
    if (read.text !== null && JSON.stringify(read.json, null, 2) + '\n' !== read.text) notes.push(`${label}: ${f} is not formatted as 2-space JSON; the write re-indents it (content and key order unchanged)`);
    if (!apply) { out(`${label}: ${f}: would ${changes.join('; ')}`); continue; }
    const backup = backupAndWrite(f, next, read.text);
    out(`${label}: ${f}: ${changes.join('; ')}${backup ? `; backup ${backup}` : ''}`);
    if (a === 'codex' && action === 'install') notes.push(`Codex: trust the hooks with /hooks in Codex (press t on each ${NAME} entry); non-managed hooks do not run until trusted. Trust is per machine, and needed again whenever a hook command changes${changes.some((c) => c.startsWith('update')) ? ', as it just did' : ''}.`);
  }

  if (action === 'install') {
    for (const m of migrations()) {
      if (existsSync(m.to)) { notes.push(`${m.what}: both ${m.from} and ${m.to} exist; the old one is left as it is`); continue; }
      any = true;
      if (!apply) { out(`${m.what}: would move ${m.from} to ${m.to}`); continue; }
      mkdirSync(path.dirname(m.to), { recursive: true }); renameSync(m.from, m.to); out(`${m.what}: moved ${m.from} to ${m.to}`);
    }
    for (const c of copies()) {
      const where = `${c.legacy ? 'old path, for sessions started before the rename' : 'script copy'}: ${c.dst}`;
      if (c.same) { out(`${where}: up to date`); continue; }
      any = true;
      if (!apply) { out(`${where}: would write`); continue; }
      mkdirSync(c.dir, { recursive: true }); const tmp = `${c.dst}.${process.pid}.tmp`; copyFileSync(c.src, tmp); renameSync(tmp, c.dst); out(`${where}: wrote`);
    }
  } else if (apply) {
    for (const d of [dataDir(), legacyDataDir()]) if (existsSync(d)) { rmSync(d, { recursive: true, force: true }); out(`removed ${d}`); }
    if (flags.has('--purge')) {
      for (const d of [stateDir(), configDir(), path.join(stateRoot(), LEGACY), path.join(configRoot(), LEGACY)]) rmSync(d, { recursive: true, force: true });
      out('purged state and settings');
    }
  } else out(`would remove ${dataDir()}${existsSync(legacyDataDir()) ? ` and ${legacyDataDir()}` : ''}${flags.has('--purge') ? ', the session state and the settings' : ''}`);
  for (const n of notes) out(`note: ${n}`);
  if (!apply) out(any || action === 'uninstall' ? 'preview only: re-run with --yes to apply' : 'nothing to do');
  return 0;
}

process.exitCode = main(process.argv.slice(2));
