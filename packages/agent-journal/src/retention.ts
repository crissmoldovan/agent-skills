import type { JournalEvent } from './envelope.ts';
import { project } from './retract.ts';

const ENTRY_KINDS = new Set(['decision', 'finding', 'assumption', 'blocker', 'progress', 'constraint']);

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
  /** Entries whose anchors now point at purged content and must render as `unknown`. */
  readonly downgraded: string[];
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
  const cutoff = Date.parse(options.now) - options.observationTtlMs;
  const { invalidated } = project(events);

  // Only LIVE entries pin their anchors; an invalidated entry stops protecting them.
  const pinnedIds = new Set<string>();
  for (const e of events) {
    if (!isEntry(e) || invalidated.has(e.id)) continue;
    for (const ref of anchorRefs(e)) pinnedIds.add(ref);
  }

  const expired: string[] = [];
  const pinned: string[] = [];
  const keep: JournalEvent[] = [];

  for (const e of events) {
    if (tombstoned.has(e.id)) continue;
    if (isEntry(e)) { keep.push(e); continue; }
    if (Date.parse(e.time) >= cutoff) { keep.push(e); continue; }
    if (pinnedIds.has(e.id)) { pinned.push(e.id); keep.push(e); continue; }
    expired.push(e.id);
  }

  const gone = new Set<string>([...expired, ...tombstoned]);
  const downgraded = keep
    .filter((e) => isEntry(e) && anchorRefs(e).some((ref) => gone.has(ref)))
    .map((e) => e.id);

  return { keep, expired, pinned, downgraded };
}
