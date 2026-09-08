import type { JournalEvent } from './envelope.ts';
import { project } from './retract.ts';
import { OBSERVATION_KINDS } from './observe.ts';
import { TOMBSTONE_KIND, suppressedIds } from './tombstone.ts';

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
  /**
   * No default here either — §13.2 says entry retention is symmetric with
   * observations ("default long but not infinite"), but §17.2 leaves the
   * actual window an open question. Hiding that behind a fallback would make
   * a policy decision nobody has made yet; the caller must supply it, exactly
   * like `observationTtlMs`.
   */
  readonly entryTtlMs: number;
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
  /**
   * Kinds in neither the entry nor observation set. Kept, never aged,
   * surfaced. A tombstone (spec 13.2) does NOT land here even though it is
   * itself in neither set — it is a governance event with its own explicit
   * category (see the `kind === TOMBSTONE_KIND` branch below), because
   * folding it into "unclassified" would still keep it, but ageing it as a
   * generic unknown kind forever is not the same guarantee as "a tombstone
   * event is never itself expired" — the next maintainer who tightens
   * `unclassified` handling must not accidentally start expiring tombstones.
   */
  readonly unclassified: string[];
  /**
   * Ids suppressed by a tombstone event found IN `events` (spec 13.2), via
   * `suppressedIds`. Reported rather than silently vanished, and — unlike
   * `expired` — not necessarily kinds this function aged out itself: a live,
   * recently-written entry can be tombstoned too.
   */
  readonly tombstoned: string[];
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
  // Suppression comes from the journal itself, never from a caller-supplied
  // list — the whole point of Task 1's tombstone module. A caller who wants
  // to suppress something must WRITE a tombstone event, not hand it here.
  const tombstoned = suppressedIds(events);

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
  if (!Number.isFinite(options.entryTtlMs) || options.entryTtlMs < 0) {
    throw new TypeError('options.entryTtlMs must be a non-negative finite number');
  }
  // Two independent windows. Reading entryTtlMs for one and (accidentally)
  // observationTtlMs for both would pass every pre-existing test in this file
  // — none of them varied the two TTLs independently — which is exactly what
  // "entries age out on their own window, separately from observations" exists
  // to catch.
  const observationCutoff = nowMs - options.observationTtlMs;
  const entryCutoff = nowMs - options.entryTtlMs;

  const { invalidated } = project(events);

  // Only an entry that SURVIVES this pass pins. Three ways to stop surviving,
  // and all three revoke the pin for the same reason: 6.3's pin exists so
  // evidence outlives its window for a decision somebody might still read, and
  // none of these can be read any more.
  //
  // The third — the citing entry falling outside its own TTL — was not in 6.3,
  // which was written when entries never expired. Now they do, and leaving it
  // out made entry retention nearly pointless: observations outweigh entries by
  // roughly 100x (6.3's own figure), so an expired entry that still pinned its
  // anchors would free about a hundredth of what expiring it implies, and the
  // pinned observations would outlive every decision that justified them.
  const pinnedIds = new Set<string>();
  for (const e of events) {
    if (!isEntry(e) || invalidated.has(e.id) || tombstoned.has(e.id)) continue;
    if (Date.parse(e.time) < entryCutoff) continue;
    for (const ref of anchorRefs(e)) pinnedIds.add(ref);
  }

  const expired: string[] = [];
  const pinned: string[] = [];
  const unclassified: string[] = [];
  const tombstonedOut: string[] = [];
  const keep: JournalEvent[] = [];

  for (const e of events) {
    // Tombstone suppression is checked FIRST, before anything else — including
    // the pin check below. §6.3's pin protects an observation from its TTL;
    // §13.2's tombstone destroys content on purpose. If the pin check ran
    // first, a pinned-and-tombstoned observation would survive, which would
    // make citing a leaked credential in an anchor a way to make it permanent
    // — exactly what §13.2 exists to prevent. This branch applies to ANY kind
    // (entry, observation, or a tombstone naming another tombstone), not only
    // observations, because suppression is not scoped to one bucket.
    if (tombstoned.has(e.id)) { tombstonedOut.push(e.id); continue; }
    // A tombstone event is the record of a deletion, not the deletion's
    // target. It is never itself expired or unclassified — ageing it out
    // would un-delete its target on the next union that doesn't re-derive
    // suppression from a still-live tombstone. This check must run before the
    // entry-TTL and unclassified branches below, or an old tombstone (entry
    // kind check does not match 'tombstone') would fall through to
    // "unclassified" and eventually be aged as a generic unknown kind.
    if (e.kind === TOMBSTONE_KIND) { keep.push(e); continue; }
    if (isEntry(e)) {
      if (Date.parse(e.time) >= entryCutoff) { keep.push(e); continue; }
      expired.push(e.id);
      continue;
    }
    if (!OBSERVATION_KIND_SET.has(e.kind)) {
      // Neither an entry, a tombstone, nor a known observation. Keep it and say so.
      unclassified.push(e.id);
      keep.push(e);
      continue;
    }
    if (Date.parse(e.time) >= observationCutoff) { keep.push(e); continue; }
    if (pinnedIds.has(e.id)) { pinned.push(e.id); keep.push(e); continue; }
    expired.push(e.id);
  }

  // An expired entry downgrades anchors citing it exactly as a tombstoned one
  // does — §6.3's downgrade rule is about the referent being gone, not about
  // why. `expired` now includes entries as well as observations, so this
  // needs no special casing beyond what already existed.
  const gone = new Set<string>([...expired, ...tombstoned]);
  const downgraded = keep
    .filter((e) => isEntry(e) && anchorRefs(e).some((ref) => gone.has(ref)))
    .map((e) => e.id);

  return { keep, expired, pinned, downgraded, unclassified, tombstoned: tombstonedOut };
}
