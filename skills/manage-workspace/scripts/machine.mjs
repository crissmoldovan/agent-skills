// Machine checks for agent sessions: processes agents leave running, and memory headroom that counts
// swap. Read-only except stopHelpers(), which signals only the helper trees it is given, after checking
// each process still has the command line it was found with. No network. Node.js 22 or newer.
//
// What it can see, stated plainly (references/processes.md has the detail):
//   - "resident" sizes are RSS: pages that are compressed or swapped out are not counted, so a
//     helper's real share of memory can be larger than shown;
//   - a helper's session comes from its environment, read with one `ps -E` call on macOS and from
//     /proc on Linux, only for processes of the current user;
//   - whether a Claude Code session is still running comes from Claude Code's own session files,
//     which are not a documented interface; liveness is "unknown", never "ended", unless every
//     running Claude Code process is accounted for in those files.
import { spawnSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { homedir, totalmem } from 'node:os';
import path from 'node:path';

const HOME = () => process.env.HOME || homedir();

// A path made of segments, each of which may contain spaces: /seg/seg with spaces/name
const PATH_TO = (name) => `(?:\\/(?:[^/\\n]+\\/)*)?${name}`;

// Helpers a plugin starts detached, keyed to a folder, and stops only from its own session-end hook.
// `parse` takes a whole command line and returns { folder } only for the exact shape the plugin starts:
// a node binary running the broker script with `serve --endpoint … --cwd … --pid-file …`.
export const HELPERS = [{
  id: 'codex-companion-broker',
  label: 'Codex companion broker',
  sessionEnv: 'CODEX_COMPANION_SESSION_ID',
  parse(args) {
    const m = new RegExp(`^${PATH_TO('node')}\\s+(${PATH_TO('app-server-broker\\.mjs')})\\s+serve\\s+--endpoint\\s+(.+?)\\s+--cwd\\s+(.+)\\s+--pid-file\\s+(.+)$`).exec(args);
    return m ? { folder: m[3] } : null;
  },
}];

const AGENT_CLIS = ['claude', 'codex'];
const VM_PROCESS = /(com\.apple\.Virtualization\.VirtualMachine|qemu-system-[a-z0-9_]+|\bvfkit\b|\bkrunkit\b)(\s|$)/;

let fixtureCache;
function fixture() {
  if (fixtureCache !== undefined) return fixtureCache;
  const file = process.env.MWS_MACHINE_FIXTURE;
  try { fixtureCache = file ? JSON.parse(readFileSync(file, 'utf8')) : null; } catch { fixtureCache = null; }
  return fixtureCache;
}
// Any fixture that speaks for processes (their table, environments or sessions) could make a real pid
// look like something it is not: nothing is ever signalled then. A memory-only fixture is safe.
export const usingFixture = () => { const f = fixture(); return Boolean(f && ('ps' in f || 'env' in f || 'sessions' in f)); };

function run(cmd, args, ms = 800) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: ms, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  return r.status === 0 && !r.error ? r.stdout : null;
}

// ---- memory ------------------------------------------------------------------------------------

export function parseSwapUsage(text) {
  const num = (k) => { const m = new RegExp(`${k} = ([0-9.]+)([KMGT])`).exec(text || ''); if (!m) return null; return Number(m[1]) * { K: 1 / 1024, M: 1, G: 1024, T: 1024 * 1024 }[m[2]]; };
  const totalMiB = num('total'); const usedMiB = num('used');
  return totalMiB == null || usedMiB == null ? null : { totalMiB, usedMiB };
}

export function parseMeminfo(text) {
  const kib = (k) => { const m = new RegExp(`^${k}:\\s+(\\d+) kB`, 'm').exec(text || ''); return m ? Number(m[1]) : null; };
  const total = kib('MemTotal'); const avail = kib('MemAvailable');
  if (!total || avail == null) return null;
  const swapTotal = kib('SwapTotal') ?? 0; const swapFree = kib('SwapFree') ?? 0;
  return { platform: 'linux', ramMiB: total / 1024, freePct: (avail / total) * 100, swapUsedMiB: (swapTotal - swapFree) / 1024, swapTotalMiB: swapTotal / 1024 };
}

export function readMemory() {
  const f = fixture();
  if (f && 'memory' in f) return f.memory === 'unreadable' ? null : f.memory;
  if (process.platform === 'darwin') {
    const out = run('sysctl', ['-n', 'hw.memsize', 'kern.memorystatus_level', 'vm.swapusage'], 600);
    if (!out) return null;
    const [mem, level, swap] = out.split('\n');
    const s = parseSwapUsage(swap);
    const freePct = Number(level);
    if (!s || !Number.isFinite(freePct) || !Number(mem)) return null;
    return { platform: 'darwin', ramMiB: Number(mem) / 2 ** 20, freePct, swapUsedMiB: s.usedMiB, swapTotalMiB: s.totalMiB };
  }
  if (process.platform === 'linux') { try { return parseMeminfo(readFileSync('/proc/meminfo', 'utf8')); } catch { return null; } }
  return null;
}

// Free percentage alone is not enough: on macOS kern.memorystatus_level stays near 40 while swap fills,
// so a gate on it passes on a machine about to stall. Swap is counted against physical memory, not
// against the swap total, because macOS grows swap on demand and its total says nothing.
// A reading that could not be taken is not a pass: ok is false and unknown is true.
export function memoryVerdict(reading, { minFreePct = 20, maxSwapMiB, needMiB = 0 } = {}) {
  if (!reading) return { ok: false, unknown: true, reasons: ['memory could not be read, so nothing could be checked'], reading: null };
  const ram = reading.ramMiB || totalmem() / 2 ** 20;
  const swapLimit = maxSwapMiB ?? ram / 4;
  const available = (reading.freePct / 100) * ram;
  const aboveFloor = available - (minFreePct / 100) * ram;
  const reasons = [];
  if (reading.freePct < minFreePct) reasons.push(`only ${Math.round(reading.freePct)}% of memory is free (the floor is ${minFreePct}%)`);
  if (reading.swapUsedMiB > swapLimit) reasons.push(`${gib(reading.swapUsedMiB)} of swap is in use, over the limit of ${gib(swapLimit)}${maxSwapMiB == null ? ' (a quarter of RAM)' : ''}; the free percentage does not count swap`);
  if (needMiB && needMiB > aboveFloor) reasons.push(`the job needs ${needMiB} MiB and about ${Math.max(0, Math.floor(aboveFloor))} MiB is free above the floor`);
  return { ok: reasons.length === 0, reasons, reading: { ...reading, ramMiB: Math.round(ram), availableMiB: Math.floor(available) }, limits: { minFreePct, maxSwapMiB: Math.floor(swapLimit), needMiB } };
}

export const gib = (mib) => `${(mib / 1024).toFixed(1)} GiB`;
export const describeMemory = (v) => (v.reading
  ? `${Math.round(v.reading.freePct)}% of memory free, ${gib(v.reading.swapUsedMiB)} of swap in use, ${gib(v.reading.ramMiB)} RAM`
  : 'memory could not be read');

// ---- processes ---------------------------------------------------------------------------------

export function parseEtime(s) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(String(s).trim());
  if (!m) return 0;
  return (Number(m[1] || 0) * 86400) + (Number(m[2] || 0) * 3600) + (Number(m[3]) * 60) + Number(m[4]);
}

export function parsePs(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m) out.push({ pid: Number(m[1]), ppid: Number(m[2]), ageS: parseEtime(m[3]), rssKiB: Number(m[4]), args: m[5].trim() });
  }
  return out;
}

export function readPs() {
  const f = fixture(); if (typeof f?.ps === 'string') return f.ps;
  return run('ps', ['-A', '-ww', '-o', 'pid=,ppid=,etime=,rss=,args='], 1500) || '';
}

// `ps -E -o command=` prints the arguments and then the environment in one string. Only what follows
// the arguments, exactly as the process table showed them, is read as the environment.
export function envFromPsE(line, args) {
  if (!line.startsWith(args)) return {};
  const env = {};
  for (const h of HELPERS) { const m = new RegExp(`(?:^|\\s)${h.sessionEnv}=(\\S+)`).exec(line.slice(args.length)); if (m) env[h.sessionEnv] = m[1]; }
  return env;
}

// The environment of several processes at once: one `ps` on macOS, /proc on Linux. Returns pid -> env.
export function readEnvs(procs) {
  const f = fixture();
  if (f && 'env' in f) return new Map(procs.map((p) => [p.pid, f.env[p.pid] || f.env[String(p.pid)] || {}]));
  const out = new Map();
  if (!procs.length) return out;
  if (process.platform === 'linux') {
    for (const p of procs) {
      try { out.set(p.pid, Object.fromEntries(readFileSync(`/proc/${p.pid}/environ`, 'utf8').split('\0').filter(Boolean).map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]))); } catch { out.set(p.pid, {}); }
    }
    return out;
  }
  const text = run('ps', ['-E', '-ww', '-o', 'pid=,command=', '-p', procs.map((p) => p.pid).join(',')], 1200) || '';
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s(.*)$/.exec(line); if (!m) continue;
    const p = byPid.get(Number(m[1])); if (p) out.set(p.pid, envFromPsE(m[2], p.args));
  }
  return out;
}

// Claude Code keeps one JSON file per running process in <config>/sessions/<pid>.json with its
// sessionId. Not a documented interface: null when the folder is missing or unreadable.
export function readSessions() {
  const f = fixture(); if (f && 'sessions' in f) return f.sessions;
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(HOME(), '.claude'), 'sessions');
  let names; try { names = readdirSync(dir); } catch { return null; }
  const out = [];
  for (const n of names) {
    if (!/^\d+\.json$/.test(n)) continue;
    try { const d = JSON.parse(readFileSync(path.join(dir, n), 'utf8')); if (d && Number.isInteger(d.pid) && d.sessionId) out.push({ pid: d.pid, sessionId: d.sessionId, name: d.name, cwd: d.cwd, procStart: d.procStart }); } catch { /* skip */ }
  }
  return out;
}

// present | gone | unknown. Only "does not exist" counts as gone; an unreadable path is unknown.
export function folderState(p) {
  try { return lstatSync(p).isDirectory() ? 'present' : 'gone'; } catch (e) { return e.code === 'ENOENT' || e.code === 'ENOTDIR' ? 'gone' : 'unknown'; }
}

const firstWord = (args) => path.basename(args.split(/\s+/)[0] || '');
const isClaudeCli = (p) => firstWord(p.args) === 'claude' && !/--chrome-native-host/.test(p.args);
function agentOf(p) {
  if (p.ppid !== 1) return null;
  if (/--chrome-native-host|\bmcp\b|\bapp-server\b/.test(p.args)) return null;
  const words = p.args.split(/\s+/);
  const first = path.basename(words[0] || '');
  if (AGENT_CLIS.includes(first)) return first;
  if (first === 'node' && words[1] && ['codex', 'codex.js'].includes(path.basename(words[1]))) return 'codex';
  return null;
}

// Returns { helpers, agents, duplicates, vms }. Pure apart from the readers passed in.
export function scanProcesses({ ps = readPs(), envs = readEnvs, sessions = readSessions(), folder = folderState, exists } = {}) {
  const procs = parsePs(ps);
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const kids = new Map();
  for (const p of procs) { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(p.pid); }
  const tree = (pid) => { const out = []; const stack = [pid]; while (stack.length) { const q = stack.pop(); out.push(q); for (const c of (kids.get(q) || []).slice().reverse()) stack.push(c); } return out; };
  const rssOf = (pids) => pids.reduce((n, q) => n + (byPid.get(q)?.rssKiB || 0), 0);
  const stateOf = exists ? (p) => (exists(p) ? 'present' : 'gone') : folder;

  // A session absent from the registry has ended only if every running Claude Code process is in it;
  // a process from another config folder or a headless run that writes no file makes absence unknown.
  const live = sessions ? new Map() : null;
  if (sessions) for (const s of sessions) if (byPid.has(s.pid)) { if (!live.has(s.sessionId)) live.set(s.sessionId, []); live.get(s.sessionId).push(s); }
  const registered = new Set((sessions || []).map((s) => s.pid));
  const complete = Boolean(sessions) && procs.filter(isClaudeCli).every((p) => registered.has(p.pid));

  const candidates = [];
  for (const p of procs) for (const h of HELPERS) { const got = h.parse(p.args); if (got) candidates.push({ p, h, got }); }
  const env = typeof envs === 'function' ? envs(candidates.map((c) => c.p)) : envs;
  const helpers = candidates.map(({ p, h, got }) => {
    const session = (env.get ? env.get(p.pid) : env[p.pid])?.[h.sessionEnv] || null;
    const t = tree(p.pid);
    const fs = got.folder ? stateOf(got.folder) : 'unknown';
    return {
      kind: 'helper', helper: h.id, label: h.label, pid: p.pid, args: p.args, session, folder: got.folder,
      folderGone: fs === 'gone' ? true : fs === 'present' ? false : null,
      sessionLive: !session || !live ? null : live.has(session) ? true : complete ? false : null,
      ageS: p.ageS, tree: t, rssKiB: rssOf(t),
    };
  });

  const agents = [];
  for (const p of procs) {
    const agent = agentOf(p); if (!agent) continue;
    const s = sessions?.find((x) => x.pid === p.pid);
    const t = tree(p.pid);
    agents.push({ kind: 'agent', agent, pid: p.pid, ageS: p.ageS, rssKiB: rssOf(t), processes: t.length, session: s?.sessionId || null, name: s?.name || null, cwd: s?.cwd || null });
  }

  const duplicates = [];
  if (live) for (const [session, list] of live) if (list.length > 1) duplicates.push({ kind: 'duplicate', session, name: list[0].name || null, pids: list.map((s) => s.pid).sort((a, b) => a - b) });

  const vms = procs.filter((p) => VM_PROCESS.test(p.args)).map((p) => ({ kind: 'vm', pid: p.pid, ageS: p.ageS, rssKiB: p.rssKiB, what: VM_PROCESS.exec(p.args)[1] }));
  return { helpers, agents, duplicates, vms, sessions: sessions && sessions.filter((s) => byPid.has(s.pid)) };
}

// A helper may be stopped when its folder is gone (it can never be reused) or its session is known
// to have ended. Unknown never counts as either. A session filter narrows to one session.
export function stoppable(scan, { session } = {}) {
  return scan.helpers.filter((h) => (session === undefined ? true : h.session === session) && (h.folderGone === true || h.sessionLive === false));
}

const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// Signals each helper's tree: TERM, then KILL what is left after graceMs. The process table is read
// again first: a helper is signalled only if its pid still has the same command line and its
// environment still names the same session, and its tree is taken from that fresh table. A tree that
// holds this process or one of its ancestors is never signalled. Before KILL the table is read once
// more and only pids with an unchanged command line are signalled, so a reused pid is left alone.
export function stopHelpers(list, { graceMs = 1500 } = {}) {
  const stopped = []; const skipped = [];
  if (usingFixture()) return { stopped, skipped: list.map((h) => ({ pid: h.pid, why: 'fixture: nothing is signalled' })) };
  const now = parsePs(readPs()); const byPid = new Map(now.map((p) => [p.pid, p]));
  const kids = new Map(); for (const p of now) { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(p.pid); }
  const descendants = (pid) => { const out = []; const stack = [pid]; while (stack.length) { const q = stack.pop(); out.push(q); for (const c of kids.get(q) || []) stack.push(c); } return out; };
  const mine = new Set(); for (let q = process.pid; q > 1 && byPid.has(q); q = byPid.get(q).ppid) mine.add(q);
  const envNow = readEnvs(list.map((h) => byPid.get(h.pid)).filter(Boolean));
  const targets = [];
  for (const h of list) {
    const p = byPid.get(h.pid); const def = HELPERS.find((x) => x.id === h.helper);
    if (!p || !def || p.args !== h.args || !def.parse(p.args) || (envNow.get(h.pid)?.[def.sessionEnv] || null) !== h.session) { skipped.push({ pid: h.pid, why: 'no longer the same helper' }); continue; }
    const pids = descendants(h.pid).filter((q) => q > 1);
    if (pids.some((q) => mine.has(q))) { skipped.push({ pid: h.pid, why: 'its tree holds the process stopping it' }); continue; }
    targets.push({ h, procs: pids.map((q) => ({ pid: q, args: byPid.get(q).args })) });
  }
  for (const t of targets) for (const q of t.procs) { try { process.kill(q.pid, 'SIGTERM'); } catch { /* gone */ } }
  const all = targets.flatMap((t) => t.procs);
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && all.some((q) => isAlive(q.pid))) spawnSync('sleep', ['0.1']);
  if (all.some((q) => isAlive(q.pid))) {
    const again = new Map(parsePs(readPs()).map((p) => [p.pid, p.args]));
    for (const q of all) if (again.get(q.pid) === q.args) { try { process.kill(q.pid, 'SIGKILL'); } catch { /* gone */ } }
  }
  for (const t of targets) stopped.push(t.h.pid);
  return { stopped, skipped };
}

// Another live session works in this folder (its directory is the folder or inside it): the plugin
// reuses a broker by folder, so that session may be using it now.
export function sharedWithLiveSession(h, sessions, session) {
  if (!h.folder || !sessions) return false;
  return sessions.some((s) => s.sessionId !== session && s.cwd && (s.cwd === h.folder || s.cwd.startsWith(`${h.folder}/`)));
}

// ---- wording -----------------------------------------------------------------------------------

const human = (kib) => (kib >= 2 ** 20 ? `${(kib / 2 ** 20).toFixed(1)} GiB` : `${Math.max(1, Math.round(kib / 1024))} MiB`);
const age = (s) => (s >= 86400 ? `${Math.floor(s / 86400)} d` : s >= 3600 ? `${Math.floor(s / 3600)} h` : `${Math.max(1, Math.floor(s / 60))} min`);

export function describeHelper(h) {
  const session = h.session ? `session ${h.session}${h.sessionLive === false ? ' (not running)' : h.sessionLive ? ' (running)' : ''}` : 'no session';
  const folder = h.folder ? `folder ${h.folder}${h.folderGone ? ' (deleted)' : ''}` : 'no folder';
  return `${h.label} pid ${h.pid}, ${session}, ${folder}, ${h.tree.length} processes, ${human(h.rssKiB)} resident, ${age(h.ageS)} old`;
}
export const describeAgent = (a) => `${a.agent} pid ${a.pid} has no parent (its editor or terminal is gone)${a.session ? `, session ${a.session}${a.name ? ` "${a.name}"` : ''}` : ''}, ${human(a.rssKiB)} resident with ${a.processes - 1} child processes, ${age(a.ageS)} old`;
export const describeDuplicate = (d) => `session ${d.session}${d.name ? ` "${d.name}"` : ''} is served by ${d.pids.length} processes: pids ${d.pids.join(', ')}`;
export const describeVm = (v) => `virtual machine process ${v.what} pid ${v.pid}, ${human(v.rssKiB)} resident, ${age(v.ageS)} old`;
