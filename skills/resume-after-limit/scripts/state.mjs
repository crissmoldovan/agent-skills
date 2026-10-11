/**
 * Where resume-after-limit keeps what it knows, and how it changes it safely.
 *
 * Everything lives in one machine-wide directory outside every repository:
 * `~/.claude/resume-after-limit/` unless RESUME_AFTER_LIMIT_HOME says otherwise. Every write is
 * a write to a temporary file followed by a rename, so a tick killed halfway leaves the previous
 * file intact, never half of a new one.
 */
import { realpathSync } from 'node:fs';
import { appendFile, mkdir, open, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const MODES = Object.freeze(['off', 'all', 'selected']);

/** Records in one of these states are finished; they are kept a week for `status`, then deleted. */
export const FINAL_STATES = Object.freeze(['confirmed', 'failed', 'expired', 'superseded', 'observed', 'unparsed']);
export const FINAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** The events log is capped; one rotation is kept beside it. */
export const EVENTS_CAP_BYTES = 1024 * 1024;
/**
 * A lock whose pid is gone is a tick that died. One whose pid is alive is taken over only past
 * this age, far beyond a tick's bounded act phase, in case the pid was reused.
 */
export const LOCK_STALE_MS = 60 * 60 * 1000;

export const DEFAULT_PROMPT = 'Your usage limit has reset. Continue the task you were working on when the limit stopped you. If it is already finished, say so in one line and stop.';

export function defaultConfig() {
  return {
    version: 1,
    mode: 'off',
    intervalMinutes: 10,
    maxDormancyHours: 5,
    lateGraceMinutes: 30,
    observe: true,
    probe: { enabled: false, everyMinutes: 60 },
    batchPerAccount: 3,
    staggerSeconds: 20,
    maxAttempts: 2,
    notify: true,
    configDirs: [],
    prompt: DEFAULT_PROMPT,
    paths: {},
  };
}

export function stateHome(env = process.env) {
  return env.RESUME_AFTER_LIMIT_HOME || path.join(homedir(), '.claude', 'resume-after-limit');
}

/** The config directory Claude Code itself uses when CLAUDE_CONFIG_DIR is not set. */
export function defaultConfigDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || path.join(homedir(), '.claude');
}

export function paths(home = stateHome()) {
  return {
    home,
    config: path.join(home, 'config.json'),
    sessions: path.join(home, 'sessions.json'),
    accounts: path.join(home, 'accounts.json'),
    tick: path.join(home, 'tick.json'),
    events: path.join(home, 'events.jsonl'),
    lock: path.join(home, 'lock'),
    parked: path.join(home, 'parked'),
  };
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return fallback;
    throw error;
  }
}

export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, file);
}

/** The stored config over the defaults, so a config written by an older version gains new keys. */
export async function loadConfig(p = paths()) {
  const stored = await readJson(p.config, {});
  const base = defaultConfig();
  const config = { ...base, ...stored, probe: { ...base.probe, ...(stored.probe ?? {}) }, paths: { ...(stored.paths ?? {}) } };
  if (!MODES.includes(config.mode)) config.mode = 'off';
  if (!Array.isArray(config.configDirs) || config.configDirs.length === 0) config.configDirs = [defaultConfigDir()];
  return config;
}

export async function saveConfig(config, p = paths()) {
  await writeJson(p.config, config);
}

export async function loadSessions(p = paths()) {
  const stored = await readJson(p.sessions, {});
  return { watched: [...new Set(stored.watched ?? [])], excluded: [...new Set(stored.excluded ?? [])] };
}

export async function saveSessions(sessions, p = paths()) {
  await writeJson(p.sessions, sessions);
}

/** A session id is a UUID in every observed version; anything else is refused as a file name. */
export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadRecords(p = paths()) {
  let names;
  try {
    names = await readdir(p.parked);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const records = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.json')) continue;
    const record = await readJson(path.join(p.parked, name), null);
    if (record && SESSION_ID.test(record.sessionId ?? '')) records.push(record);
  }
  return records;
}

export async function saveRecord(record, p = paths()) {
  if (!SESSION_ID.test(record.sessionId ?? '')) throw new Error(`refusing to store a record for session id ${JSON.stringify(record.sessionId)}`);
  await writeJson(path.join(p.parked, `${record.sessionId}.json`), record);
}

export async function deleteRecord(sessionId, p = paths()) {
  if (!SESSION_ID.test(sessionId)) return;
  await rm(path.join(p.parked, `${sessionId}.json`), { force: true });
}

/** One JSON line per decision. Rotated once at the cap, so the log never grows without bound. */
export async function logEvent(event, p = paths(), now = Date.now()) {
  await mkdir(p.home, { recursive: true, mode: 0o700 });
  try {
    const { size } = await stat(p.events);
    if (size > EVENTS_CAP_BYTES) await rename(p.events, `${p.events}.1`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await appendFile(p.events, `${JSON.stringify({ at: new Date(now).toISOString(), ...event })}\n`, { mode: 0o600 });
}

export async function readEvents(p = paths(), limit = 20) {
  try {
    const lines = (await readFile(p.events, 'utf8')).trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { unreadable: true };
      }
    });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/**
 * Take the tick lock, or return null when another live tick holds it. The lock is a file created
 * exclusively; a lock whose pid is gone, or which is older than LOCK_STALE_MS, is taken over.
 */
export async function acquireLock(p = paths(), now = Date.now()) {
  await mkdir(p.home, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(p.lock, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: now }));
      await handle.close();
      return { release: () => unlink(p.lock).catch(() => {}) };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const held = await readJson(p.lock, null);
      const stale = !held || !Number.isInteger(held.pid) || !pidAlive(held.pid) || now - (held.at ?? 0) > LOCK_STALE_MS;
      if (!stale) return null;
      await unlink(p.lock).catch(() => {});
    }
  }
  return null;
}

/**
 * Whether this module was run rather than imported. Both sides are resolved to real paths: the
 * Skills CLI installs a skill through a symlink, and a comparison of the path as typed would
 * make a run through it a silent no-op (test/entrypoint-guard.test.mjs).
 */
export function isEntrypoint(moduleUrl) {
  const invoked = process.argv[1];
  if (!invoked) return false;
  const modulePath = fileURLToPath(moduleUrl);
  try {
    return realpathSync.native(invoked) === realpathSync.native(modulePath);
  } catch {
    return path.resolve(invoked) === modulePath;
  }
}
