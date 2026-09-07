import type { JournalEvent } from './envelope.ts';

export interface PathClaim {
  readonly id: string;
  readonly session: string;
  readonly checkout: string;
  readonly worktree?: string;
  readonly branch?: string;
  readonly claimedAt: string;
  readonly expiresAt?: string;
  /** Set only when `ttlSeconds` was present and unreadable. Never `false`. */
  readonly malformedTtl?: true;
}

const DEFAULT_TTL_SECONDS = 3600;

function text(e: JournalEvent, field: string): string | undefined {
  const v = e.data[field];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * Spec 7.6. Advisory only: this reports, and nothing anywhere blocks, waits or
 * refuses on the result. Enforcing would need write-time coordination and would
 * forfeit 7.1's "writes need no coordination".
 *
 * A claim answers "is another session in this checkout right now" — a question
 * that exists BEFORE any entry does. At session start no files are in play, so
 * this cannot be ranked by file relevance the way `constraintsBearingOn` ranks
 * constraints; it is keyed on `checkout` alone.
 *
 * `expiresAt` is derived here, from `ttlSeconds` recorded on the observation,
 * rather than stamped at write time — so a reader can re-evaluate it against
 * its own clock instead of trusting the writer's.
 *
 * An unreadable `ttlSeconds` keeps the claim LIVE and marks it, the same
 * failure direction `liveConstraints`' `malformedExpiry` takes: a claim whose
 * lifetime cannot be read might still be held, and dropping it silently is the
 * unsafe direction. `ttlSeconds` absent entirely (not just blank) falls back
 * to a default TTL rather than counting as malformed — the field is present
 * on `OBSERVATION_FIELDS.path_claim` but nothing requires a caller supply it.
 */
export function liveClaims(events: readonly JournalEvent[], now: string): PathClaim[] {
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) {
    throw new TypeError(`now must be a parseable timestamp, got ${JSON.stringify(now)}`);
  }

  const ended = new Set<string>();
  for (const e of events) if (e.kind === 'session_end') ended.add(e.session);

  // Last claim per session wins; a session re-claiming replaces its own
  // earlier one. Keyed by SESSION, not checkout — two different sessions
  // claiming the same checkout must both survive into `latest`, which is
  // exactly the case this feature exists for.
  const latest = new Map<string, JournalEvent>();
  for (const e of events) {
    if (e.kind !== 'path_claim' || ended.has(e.session)) continue;
    const prev = latest.get(e.session);
    if (!prev || Date.parse(e.time) >= Date.parse(prev.time)) latest.set(e.session, e);
  }

  const out: PathClaim[] = [];
  for (const e of latest.values()) {
    const checkout = text(e, 'checkout');
    if (!checkout) continue; // claims nothing

    const rawTtl = e.data.ttlSeconds;
    const ttlPresent = rawTtl !== undefined;
    const ttlText = text(e, 'ttlSeconds');
    let ttl: number | null;
    if (!ttlPresent || ttlText === undefined) {
      // Absent, or present-but-blank: no TTL stated, so the default applies.
      // Never marked malformed — only a key that is present and unusable is.
      ttl = DEFAULT_TTL_SECONDS;
    } else if (typeof rawTtl === 'string' && /^\d+$/.test(ttlText)) {
      ttl = Number(ttlText);
    } else {
      ttl = null; // present and unreadable
    }

    const worktree = text(e, 'worktree');
    const branch = text(e, 'branch');

    if (ttl === null) {
      out.push({
        id: e.id, session: e.session, checkout, claimedAt: e.time, malformedTtl: true,
        ...(worktree === undefined ? {} : { worktree }),
        ...(branch === undefined ? {} : { branch }),
      });
      continue;
    }

    const expiresMs = Date.parse(e.time) + ttl * 1000;
    if (nowMs > expiresMs) continue; // boundary is inclusive of its final second

    out.push({
      id: e.id, session: e.session, checkout, claimedAt: e.time,
      expiresAt: new Date(expiresMs).toISOString(),
      ...(worktree === undefined ? {} : { worktree }),
      ...(branch === undefined ? {} : { branch }),
    });
  }
  return out;
}
