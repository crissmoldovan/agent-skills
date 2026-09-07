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

  for (const e of events) {
    const sup = stringField(e, 'supersedes');
    if (sup) {
      superseded.add(sup);
      outcomes.set(sup, 'reverted');
    }
    const inv = stringField(e, 'invalidates');
    if (inv) {
      invalidated.add(inv);
      outcomes.set(inv, 'invalidated');
    }
    const declared = e.data.outcome;
    if (declared === 'held' || declared === 'reverted') outcomes.set(e.id, declared);
  }

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
