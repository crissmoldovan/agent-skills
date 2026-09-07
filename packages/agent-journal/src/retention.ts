import type { JournalEvent } from './envelope.ts';
import { project } from './retract.ts';
import { OBSERVATION_KINDS } from './observe.ts';

const ENTRY_KINDS = new Set(['decision', 'finding', 'assumption', 'blocker', 'progress', 'constraint']);

/** Spec 4.4's observation kinds, from observe.ts — the single source of truth
 *  for the fourteen names, since `observe` is the command that writes them.
 *  Anything in NEITHER set is unclassified: it is kept and reported rather
 *  than silently aged out, because a typo'd or future entry kind must not be
 *  destroyed by a binary classifier guessing. */
const OBSERVATION_KIND_SET = new Set<string>(OBSERVATION_KINDS);

export interface RetentionOptions {
  readonly now: string;
  /** No default. Spec open question 2 leaves the window undecided; the caller supplies it. */
  readonly observationTtlMs: number;
  /** Ids suppressed by a tombstone event (spec 13.2). */
  readonly tombstoned?: readonly string[];
}

export interface RetentionResult {
  readonly keep: JournalEvent[];
  readonly expired: string[];
  readonly pinned: string[];
  /**
   * Entries whose anchors point at content THIS CALL removed, and which must
   * render as `unknown`. Scope is deliberate and limited: an anchor referencing
   * an id absent from `events` is indistinguishable here from one in a segment
   * that simply was not loaded, so it is NOT reported. Whole-journal anchor
   * validation is the rot check's job, not retention's.
   */
  readonly downgraded: string[];
  /** Kinds in neither the entry nor observation set. Kept, never aged, surfaced. */
  readonly unclassified: string[];
}

function anchorRefs(event: JournalEvent): string[] {
  const raw = event.data.anchors;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const ref = (item as Record<string, unknown>).ref;
      if (typeof ref === 'string') out.push(ref);
    }
  }
  return out;
}

export function isEntry(event: JournalEvent): boolean {
  return ENTRY_KINDS.has(event.kind);
}

export function applyRetention(
  events: readonly JournalEvent[],
  options: RetentionOptions,
): RetentionResult {
  const tombstoned = new Set(options.tombstoned ?? []);

  // Validate `now` before it can delete anything. Unlike `e.time`, which
  // normalizeEvent guarantees is parseable, `now` is caller-supplied and
  // unchecked. An unparseable value yields NaN, every `>= cutoff` comparison is
  // then false, and EVERY unpinned observation expires — mass silent data loss
  // from one bad string. Retention deletes; it fails loudly or not at all.
  const nowMs = Date.parse(options.now);
  if (Number.isNaN(nowMs)) {
    throw new TypeError(`options.now must be a parseable timestamp, got ${JSON.stringify(options.now)}`);
  }
  if (!Number.isFinite(options.observationTtlMs) || options.observationTtlMs < 0) {
    throw new TypeError('options.observationTtlMs must be a non-negative finite number');
  }
  const cutoff = nowMs - options.observationTtlMs;

  const { invalidated } = project(events);

  // Only a live, non-tombstoned entry pins. An invalidated entry's citations
  // stop protecting anything, and a tombstoned one is not in the projection at
  // all — leaving it able to pin would protect an observation with nothing alive
  // left to justify it.
  const pinnedIds = new Set<string>();
  for (const e of events) {
    if (!isEntry(e) || invalidated.has(e.id) || tombstoned.has(e.id)) continue;
    for (const ref of anchorRefs(e)) pinnedIds.add(ref);
  }

  const expired: string[] = [];
  const pinned: string[] = [];
  const unclassified: string[] = [];
  const keep: JournalEvent[] = [];

  for (const e of events) {
    if (tombstoned.has(e.id)) continue;
    if (isEntry(e)) { keep.push(e); continue; }
    if (!OBSERVATION_KIND_SET.has(e.kind)) {
      // Neither an entry nor a known observation. Keep it and say so.
      unclassified.push(e.id);
      keep.push(e);
      continue;
    }
    if (Date.parse(e.time) >= cutoff) { keep.push(e); continue; }
    if (pinnedIds.has(e.id)) { pinned.push(e.id); keep.push(e); continue; }
    expired.push(e.id);
  }

  const gone = new Set<string>([...expired, ...tombstoned]);
  const downgraded = keep
    .filter((e) => isEntry(e) && anchorRefs(e).some((ref) => gone.has(ref)))
    .map((e) => e.id);

  return { keep, expired, pinned, downgraded, unclassified };
}
