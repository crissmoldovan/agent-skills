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
    return { record: stamp(record, detected.kind === 'unparsed' ? 'unparsed' : 'parked', now, 'bounced'), changed: true, bounced: true };
  }
  const record = { ...base, attempts: 0, history: [] };
  return { record: stamp(record, detected.kind === 'unparsed' ? 'unparsed' : 'parked', now), changed: true };
}

/**
 * When quota is known to be available for a waiting record, or null.
 *   - the recorded reset (or a later hold from a sibling's bounce) has passed, plus the margin;
 *   - a probe of the config directory's current account, taken after the hit, shows the window open;
 *   - the account changed since the hit and probing is off, so the switch itself is the signal.
 * A hold is an account's own later reset, learned from a sibling that bounced. The hold that
 * applies is the one on the account the session would run under now: the recorded account, or
 * the account switched to (`holdNow`). Until it passes nothing makes quota available, and quota
 * is never said to be back earlier than it.
 */
export function availableAt(record, { now, accountNow, probe, probeEnabled, hold, holdNow }) {
  const switched = Boolean(accountNow && record.account && accountNow !== record.account);
  const applicable = switched ? holdNow ?? null : hold ?? null;
  if (applicable && now < applicable + RESET_MARGIN_MS) return null;
  const candidates = [];
  if (!switched && Number.isFinite(record.resetsAt) && now >= record.resetsAt + RESET_MARGIN_MS) candidates.push(record.resetsAt);
  // A probe taken before this limit was hit says nothing about it.
  if (probe?.open === true && probe.at > record.hitAt && probe.at <= now) candidates.push(probe.at);
  if (switched && !probeEnabled && record.accountChangeSeenAt) candidates.push(record.accountChangeSeenAt);
  if (!candidates.length) return null;
  return applicable ? Math.max(Math.min(...candidates), applicable) : Math.min(...candidates);
}

/** The late grace in effect: never shorter than one interval plus five minutes. */
export function effectiveGraceMs(config) {
  return Math.max(config.lateGraceMinutes, config.intervalMinutes + 5) * MINUTE;
}

/**
 * Move a waiting (`parked` or `due`) record on, or leave it. Returns the record.
 * Due means: covered, quota available, available within `maxDormancyHours` of the hit, and this
 * tick no later than the late grace after it became available. A record already due is checked
 * again every tick: a hold that appeared sends it back to parked, and a gap longer than the grace
 * since the tick that last found it due (a machine that slept) expires it.
 */
export function evaluate(record, ctx) {
  const { now, config, isCovered } = ctx;
  if (record.state !== 'parked' && record.state !== 'due') return record;
  const dormancy = config.maxDormancyHours * HOUR;
  const grace = effectiveGraceMs(config);
  if ((record.attempts ?? 0) >= config.maxAttempts) return stamp(record, 'failed', now, 'out-of-attempts');
  if (now - record.hitAt > dormancy + grace) return stamp(record, 'expired', now, 'dormant');
  let next = record;
  const switched = Boolean(ctx.accountNow && record.account && ctx.accountNow !== record.account);
  if (switched && !record.accountChangeSeenAt) next = { ...next, accountChangeSeenAt: now };
  const at = availableAt(next, { ...ctx, probeEnabled: config.probe.enabled });
  if (at === null) return record.state === 'due' ? stamp(next, 'parked', now, 'held') : next;
  if (at - record.hitAt > dormancy) return stamp(next, 'expired', now, 'reset-beyond-window');
  if (record.state === 'due') {
    if (now - (record.dueCheckedAt ?? record.updatedAt ?? now) > grace) return stamp(next, 'expired', now, 'checked-too-late');
    if (!isCovered) return stamp(next, 'parked', now, 'no-longer-covered');
    return { ...next, dueCheckedAt: now };
  }
  if (now - at > grace) return stamp({ ...next, availableAt: at }, 'expired', now, 'checked-too-late');
  if (!isCovered) return next;
  return stamp({ ...next, availableAt: at, dueCheckedAt: now }, 'due', now);
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
