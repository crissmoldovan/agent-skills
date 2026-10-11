/**
 * The rules, as pure functions: what a newly seen limit does to a record, whether a waiting
 * record may be resumed now, and in what order. No file, clock or network is touched here, so
 * every rule is tested on its own (test/resume-after-limit.test.mjs).
 */
import { FINAL_STATES } from './state.mjs';

/** Let Claude Code's own wait act first in a terminal session before anything here does. */
export const RESET_MARGIN_MS = 2 * 60 * 1000;

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/** Whether the mode covers a session: every session not excluded, or only the watched ones. */
export function covered(sessionId, mode, sessions) {
  if (mode === 'all') return !sessions.excluded.includes(sessionId);
  if (mode === 'selected') return sessions.watched.includes(sessionId);
  return false;
}

/** The key resumes are staggered and holds are kept under: the account, or the config directory. */
export function accountKey(record) {
  return record.account ? `account:${record.account}` : `dir:${record.configDir}`;
}

function stamp(record, state, now, reason) {
  return { ...record, state, reason: reason ?? null, updatedAt: now, history: [...(record.history ?? []), { at: now, state, ...(reason ? { reason } : {}) }].slice(-20) };
}

/**
 * Fold one detected limit into the stored record for that session.
 *   - first sighting: a new record, `parked` (or `unparsed` when there is no reset time to trust);
 *   - the same limit entry as before: unchanged;
 *   - a new limit after a delivery: `bounced` back to parked, the attempt already counted;
 *   - a new limit after anything else: a new episode, attempts from zero.
 */
export function foldDetection(existing, detected, { now, account, maxAttempts }) {
  if (existing && existing.limitUuid && existing.limitUuid === detected.limitUuid) return { record: existing, changed: false };
  const base = {
    sessionId: detected.sessionId,
    configDir: detected.configDir,
    transcriptPath: detected.transcriptPath,
    cwd: detected.cwd ?? existing?.cwd ?? null,
    entrypoint: detected.entrypoint,
    version: detected.version,
    hitAt: detected.hitAt,
    resetsAt: detected.resetsAt,
    rateLimitType: detected.rateLimitType,
    limitUuid: detected.limitUuid,
    account: account ?? null,
    accountChangeSeenAt: null,
    availableAt: null,
    deliveredAt: null,
    channel: null,
    firstSeenAt: now,
  };
  if (existing && (existing.state === 'delivered' || existing.state === 'delivering')) {
    const attempts = existing.attempts ?? 1;
    const record = { ...existing, ...base, attempts, history: existing.history };
    if (attempts >= maxAttempts) return { record: stamp(record, 'failed', now, 'bounced-out-of-attempts'), changed: true, bounced: true };
    return { record: stamp(record, 'parked', now, 'bounced'), changed: true, bounced: true };
  }
  const record = { ...base, attempts: 0, history: [] };
  return { record: stamp(record, detected.kind === 'unparsed' ? 'unparsed' : 'parked', now), changed: true };
}

/**
 * When quota is known to be available for a parked record, or null.
 *   - the recorded reset (or a later hold from a sibling's bounce) has passed, plus the margin;
 *   - a probe of the config directory's current account shows the window open;
 *   - the account changed since the hit and probing is off, so the switch itself is the signal.
 */
export function availableAt(record, { now, accountNow, probe, probeEnabled, hold }) {
  const switched = Boolean(accountNow && record.account && accountNow !== record.account);
  // A hold is the account's own later reset, learned from a sibling that bounced. Until it passes,
  // nothing (an open probe included) makes that account's quota available; only a different
  // account, which the hold says nothing about, can.
  if (!switched && hold && now < hold + RESET_MARGIN_MS) return null;
  const candidates = [];
  const reset = Math.max(record.resetsAt ?? Infinity, switched ? 0 : hold ?? 0);
  if (Number.isFinite(reset) && now >= reset + RESET_MARGIN_MS) candidates.push(reset);
  if (probe?.open === true && probe.at <= now) candidates.push(probe.at);
  if (switched && !probeEnabled && record.accountChangeSeenAt) candidates.push(record.accountChangeSeenAt);
  return candidates.length ? Math.min(...candidates) : null;
}

/**
 * Move a parked record on, or leave it. Returns the record (possibly unchanged).
 * Due means: covered, quota available, available within `maxDormancyHours` of the hit, and this
 * tick no later than `lateGraceMinutes` after it became available.
 */
export function evaluate(record, ctx) {
  const { now, config, isCovered } = ctx;
  if (record.state !== 'parked') return record;
  const dormancy = config.maxDormancyHours * HOUR;
  const grace = config.lateGraceMinutes * MINUTE;
  if ((record.attempts ?? 0) >= config.maxAttempts) return stamp(record, 'failed', now, 'out-of-attempts');
  if (now - record.hitAt > dormancy + grace) return stamp(record, 'expired', now, 'dormant');
  let next = record;
  const switched = Boolean(ctx.accountNow && record.account && ctx.accountNow !== record.account);
  if (switched && !record.accountChangeSeenAt) next = { ...next, accountChangeSeenAt: now };
  const at = availableAt(next, { ...ctx, probeEnabled: config.probe.enabled });
  if (at === null) return next;
  if (at - record.hitAt > dormancy) return stamp(next, 'expired', now, 'reset-beyond-window');
  if (now - at > grace) return stamp({ ...next, availableAt: at }, 'expired', now, 'checked-too-late');
  if (!isCovered) return next;
  return stamp({ ...next, availableAt: at }, 'due', now);
}

/**
 * Which due records to act on this tick: oldest hit first, at most `batchPerAccount` per account.
 */
export function pickDue(records, batchPerAccount) {
  const taken = new Map();
  const picked = [];
  for (const record of [...records].filter((r) => r.state === 'due').sort((a, b) => a.hitAt - b.hitAt)) {
    const key = accountKey(record);
    const count = taken.get(key) ?? 0;
    if (count >= batchPerAccount) continue;
    taken.set(key, count + 1);
    picked.push(record);
  }
  return picked;
}

export function isFinal(record) {
  return FINAL_STATES.includes(record.state);
}

export { stamp };
