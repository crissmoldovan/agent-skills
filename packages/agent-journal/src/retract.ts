import type { JournalEvent } from './envelope.ts';

export type Outcome = 'unknown' | 'held' | 'reverted' | 'invalidated';

export interface Projection {
  readonly live: JournalEvent[];
  readonly superseded: ReadonlySet<string>;
  readonly invalidated: ReadonlySet<string>;
  readonly outcomes: ReadonlyMap<string, Outcome>;
}

function stringField(event: JournalEvent, field: string): string | undefined {
  const v = event.data[field];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Ids this entry rests on, via `influences` of type `journal`. */
function journalInfluences(event: JournalEvent): string[] {
  const raw = event.data.influences;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const rec = item as Record<string, unknown>;
      if (rec.type === 'journal' && typeof rec.ref === 'string') out.push(rec.ref);
    }
  }
  return out;
}

export function project(events: readonly JournalEvent[]): Projection {
  const superseded = new Set<string>();
  const invalidated = new Set<string>();
  const outcomes = new Map<string, Outcome>();

  for (const e of events) outcomes.set(e.id, 'unknown');

  // Collect the edges FIRST, then assign outcomes by precedence. Assigning
  // inside this loop makes the result depend on array order: an entry that is
  // both invalidated and superseded would display whichever edge happened to be
  // processed last, so the same events in a different order give a different
  // answer — the defect class Task 5 shipped.
  for (const e of events) {
    const sup = stringField(e, 'supersedes');
    if (sup) superseded.add(sup);
    const inv = stringField(e, 'invalidates');
    if (inv) invalidated.add(inv);
  }

  // Precedence, weakest to strongest. Invalidation is the strongest claim there
  // is — "this was never sound" — and must never be displaced by a supersession
  // that merely says "something newer replaced it". Displaying `reverted` for an
  // invalidated entry tells a reader the original reasoning still stood, which is
  // exactly the conflation this task exists to prevent.
  for (const e of events) {
    const declared = e.data.outcome;
    if (declared === 'held' || declared === 'reverted') outcomes.set(e.id, declared);
  }
  for (const id of superseded) outcomes.set(id, 'reverted');
  for (const id of invalidated) outcomes.set(id, 'invalidated');

  // Invalidation propagates: anything resting on an invalidated entry is suppressed.
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of events) {
      if (invalidated.has(e.id)) continue;
      if (journalInfluences(e).some((ref) => invalidated.has(ref))) {
        invalidated.add(e.id);
        outcomes.set(e.id, 'invalidated');
        changed = true;
      }
    }
  }

  const live = events.filter((e) => !superseded.has(e.id) && !invalidated.has(e.id));
  return { live, superseded, invalidated, outcomes };
}
