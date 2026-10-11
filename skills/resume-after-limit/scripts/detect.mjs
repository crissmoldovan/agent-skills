/**
 * Finding sessions a usage limit stopped, from what Claude Code writes to disk. Reads only: the
 * transcripts under `<configDir>/projects/`, the live-session files under `<configDir>/sessions/`,
 * and the account recorded in the config directory's `.claude.json`. Nothing here spends a token.
 *
 * The limit entry this reads is OBSERVED (references/evidence.md): an assistant entry with
 * `isApiErrorMessage: true` and a `quotaLimits` object whose `status` is "rejected". `error:
 * "rate_limit"` alone is not enough, because a temporary server throttle carries it too.
 */
import { open, readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { SESSION_ID } from './state.mjs';

/** How much of a transcript's end is read first, and the most ever read. */
export const TAIL_BYTES = 64 * 1024;
export const TAIL_MAX_BYTES = 1024 * 1024;

const OLD_FORMAT = /^Claude AI usage limit reached\|(\d{9,11})$/;
const TEXT_ONLY = /\b(?:hit your (?:session |weekly |Opus |Sonnet )?limit|usage limit reached)\b/i;

/** Read up to `bytes` from the end of a file, dropping a first line that the cut left partial. */
export async function readTail(file, bytes) {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const text = buffer.toString('utf8');
    return { text: start === 0 ? text : text.slice(text.indexOf('\n') + 1), complete: start === 0 };
  } finally {
    await handle.close();
  }
}

function textOf(entry) {
  const content = entry?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('');
  return '';
}

/** The last main-chain `user` or `assistant` entry in the text, or null. Sidechains are subagents. */
export function lastMainEntry(text) {
  const lines = text.split('\n');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.isSidechain === true) continue;
    if (entry?.type === 'user' || entry?.type === 'assistant') return entry;
  }
  return null;
}

/**
 * What one entry says about a usage limit:
 *   - `{ kind: 'limit', resetsAt, rateLimitType }` for an entry carrying rejected `quotaLimits`, or
 *     the older `Claude AI usage limit reached|<epoch>` text;
 *   - `{ kind: 'unparsed' }` for limit wording with no reset time a machine can trust;
 *   - `{ kind: 'none' }` for anything else.
 * `resetsAt` is epoch milliseconds.
 */
export function classifyEntry(entry) {
  if (!entry || entry.type !== 'assistant' || entry.isApiErrorMessage !== true) return { kind: 'none' };
  const quota = entry.quotaLimits ?? entry.apiErrorParams?.rate_limit_info;
  if (quota && quota.status === 'rejected' && Number.isFinite(quota.resetsAt)) {
    return { kind: 'limit', resetsAt: quota.resetsAt * 1000, rateLimitType: typeof quota.rateLimitType === 'string' ? quota.rateLimitType : 'unknown' };
  }
  const text = textOf(entry).trim();
  const old = OLD_FORMAT.exec(text);
  if (old) return { kind: 'limit', resetsAt: Number(old[1]) * 1000, rateLimitType: 'unknown' };
  if (TEXT_ONLY.test(text)) return { kind: 'unparsed' };
  return { kind: 'none' };
}

/** Read a transcript's end and say where the session stands. Grows the read until an entry is found. */
export async function inspectTranscript(file) {
  let bytes = TAIL_BYTES;
  for (;;) {
    const { text, complete } = await readTail(file, bytes);
    const entry = lastMainEntry(text);
    if (entry || complete || bytes >= TAIL_MAX_BYTES) {
      if (!entry) return { entry: null, verdict: { kind: 'none' } };
      return { entry, verdict: classifyEntry(entry) };
    }
    bytes = Math.min(bytes * 4, TAIL_MAX_BYTES);
  }
}

/**
 * Main transcripts (`projects/<project>/<session>.jsonl`, never `subagents/`) modified since
 * `sinceMs`. Only `stat` is called on each; nothing is read.
 */
export async function recentTranscripts(configDir, sinceMs) {
  const root = path.join(configDir, 'projects');
  let projects;
  try {
    projects = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const found = [];
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    let files;
    try {
      files = await readdir(path.join(root, project.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;
      const sessionId = file.name.slice(0, -'.jsonl'.length);
      if (!SESSION_ID.test(sessionId)) continue;
      const full = path.join(root, project.name, file.name);
      try {
        const { mtimeMs } = await stat(full);
        if (mtimeMs >= sinceMs) found.push({ sessionId, transcriptPath: full, mtimeMs });
      } catch {
        // gone between readdir and stat
      }
    }
  }
  return found;
}

/** Every session in the window whose last main-chain entry is a usage limit, or limit wording. */
export async function findLimited(configDir, sinceMs) {
  const limited = [];
  for (const transcript of await recentTranscripts(configDir, sinceMs)) {
    let inspected;
    try {
      inspected = await inspectTranscript(transcript.transcriptPath);
    } catch {
      continue;
    }
    const { entry, verdict } = inspected;
    if (verdict.kind === 'none') continue;
    limited.push({
      sessionId: transcript.sessionId,
      transcriptPath: transcript.transcriptPath,
      configDir,
      kind: verdict.kind,
      resetsAt: verdict.resetsAt ?? null,
      rateLimitType: verdict.rateLimitType ?? null,
      hitAt: Date.parse(entry.timestamp) || transcript.mtimeMs,
      limitUuid: entry.uuid ?? null,
      cwd: typeof entry.cwd === 'string' ? entry.cwd : null,
      entrypoint: typeof entry.entrypoint === 'string' ? entry.entrypoint : null,
      version: typeof entry.version === 'string' ? entry.version : null,
    });
  }
  return limited;
}

/**
 * Where the session stands after `afterMs`, read from its transcript: 'limit' when the last
 * main-chain entry is a (possibly new) limit, 'active' when anything else came after `afterMs`,
 * 'quiet' when nothing did, 'missing' when the transcript is gone.
 */
export async function sessionProgress(transcriptPath, afterMs, knownLimitUuid) {
  let inspected;
  try {
    inspected = await inspectTranscript(transcriptPath);
  } catch (error) {
    if (error.code === 'ENOENT') return { state: 'missing' };
    throw error;
  }
  const { entry, verdict } = inspected;
  if (!entry) return { state: 'quiet' };
  if (verdict.kind === 'limit' || verdict.kind === 'unparsed') {
    if (entry.uuid && entry.uuid === knownLimitUuid) return { state: 'quiet' };
    return { state: 'limit', verdict, entry };
  }
  const at = Date.parse(entry.timestamp);
  if (Number.isFinite(at) && at > afterMs) return { state: 'active', at };
  return { state: 'quiet' };
}

/** Claude Code keeps the account of its default config directory in `~/.claude.json`. */
export function accountFile(configDir, home = homedir()) {
  return path.resolve(configDir) === path.join(home, '.claude') ? path.join(home, '.claude.json') : path.join(configDir, '.claude.json');
}

/** The signed-in account's id, or null when there is none (API key, signed out, unreadable). */
export async function currentAccount(configDir, home = homedir()) {
  try {
    const data = JSON.parse(await readFile(accountFile(configDir, home), 'utf8'));
    const id = data?.oauthAccount?.accountUuid;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
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
 * The running Claude Code processes of a config directory, from `<configDir>/sessions/<pid>.json`.
 * A file whose pid is gone is a crash leftover and is skipped. On Linux the recorded `procStart`
 * is also compared with the process's own start time, so a reused pid is not mistaken for the
 * session; elsewhere the pid alone is trusted.
 */
export async function liveSessions(configDir, { alive = pidAlive, procStartOf = linuxProcStart } = {}) {
  const dir = path.join(configDir, 'sessions');
  let names;
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const sessions = [];
  for (const name of names) {
    const match = /^(\d+)\.json$/.exec(name);
    if (!match) continue;
    let data;
    try {
      data = JSON.parse(await readFile(path.join(dir, name), 'utf8'));
    } catch {
      continue;
    }
    const pid = Number(match[1]);
    if (data?.pid !== pid || !alive(pid)) continue;
    const started = await procStartOf(pid);
    if (started !== null && typeof data.procStart === 'string' && data.procStart !== started) continue;
    const keyName = names.find((other) => other.startsWith(`${pid}.`) && other.endsWith('.key') && /^\d+\.[0-9a-f]{64}\.key$/.test(other));
    sessions.push({
      pid,
      sessionId: data.sessionId,
      cwd: data.cwd ?? null,
      kind: data.kind ?? null,
      entrypoint: data.entrypoint ?? null,
      status: data.status ?? null,
      socketPath: data.messagingSocketPath ?? null,
      keyPath: keyName ? path.join(dir, keyName) : null,
    });
  }
  return sessions;
}

/** Field 22 of /proc/<pid>/stat, the process start time in clock ticks; null off Linux. */
export async function linuxProcStart(pid) {
  if (process.platform !== 'linux') return null;
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return fields[19] ?? null;
  } catch {
    return null;
  }
}
