import type { JournalEvent } from './envelope.ts';

/**
 * A tombstone is an APPENDED event, exactly like every other kind here — it
 * never edits or removes anything in place. It records that a human decided
 * some content must not exist; the projection functions below (`tombstonesIn`,
 * `suppressedIds`) are what turn that record into a suppression effect at
 * read time, the same way `invalidate` turns an `invalidates` edge into
 * suppression via `project()` in retract.ts. §7.1's "writes need no
 * coordination" and §8's union semantics both depend on this staying purely
 * additive: two writers appending tombstones concurrently never conflict,
 * and reading a subset of segments never produces a result a full read would
 * contradict — it can only omit tombstones this reader hasn't seen yet.
 *
 * This is deliberately NOT retraction. `invalidates` says a premise was false
 * and the entry's reasoning is wrong; it takes no position on whether the
 * CONTENT should still exist. A tombstone says the content must not exist and
 * takes no position on whether the reasoning was sound. Neither implies the
 * other, and this module never reads or writes `invalidates`.
 */
export const TOMBSTONE_KIND = 'tombstone';

export interface Tombstone {
  readonly id: string;
  readonly target: string;
  readonly reason: string;
  readonly time: string;
  readonly purged: boolean;
}

/** The house rule for reading a string field, matching `stringField` in
 *  decay.ts and `text` in envelope.ts: non-blank-after-trim, or absent. */
function stringField(event: JournalEvent, field: string): string | undefined {
  const v = (event.data as Record<string, unknown>)[field];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** `purged` is truthy-string or boolean `true`; anything else — absent,
 *  `false`, `'false'`, a number, `null` — is `false`. Never absent: the brief
 *  requires the field always be present and boolean, so a caller can render
 *  it without an `?? false` of their own at every use site. */
function purgedField(event: JournalEvent): boolean {
  const v = (event.data as Record<string, unknown>).purged;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.trim().length > 0;
  return false;
}

/**
 * Every well-formed tombstone event in `events`, oldest first. Matches
 * strictly on `kind === TOMBSTONE_KIND` — `normalizeEvent` does not validate
 * `kind`, so a `decision` event whose `data` happens to carry `target` and
 * `reason` fields must never be read as a tombstone here.
 *
 * `reason` is required. An unexplained tombstone is indistinguishable from a
 * mistake, and a reader six months later cannot tell whether to trust the
 * suppression — so an event missing (or blank) `reason` is not a tombstone at
 * all, and is silently excluded rather than partially honoured.
 *
 * A tombstone naming itself as `target` is also excluded here, at the source,
 * so it can never appear as a real tombstone in this list OR contribute a
 * suppression via `suppressedIds` — self-targeting would erase the record of
 * the deletion, leaving the content gone and nothing saying why.
 */
export function tombstonesIn(events: readonly JournalEvent[]): Tombstone[] {
  const out: Tombstone[] = [];
  for (const e of events) {
    if (e.kind !== TOMBSTONE_KIND) continue;
    const reason = stringField(e, 'reason');
    if (!reason) continue;
    const target = stringField(e, 'target');
    if (!target) continue;
    if (target === e.id) continue;
    out.push({ id: e.id, target, reason, time: e.time, purged: purgedField(e) });
  }
  out.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  return out;
}

/**
 * The set of ids suppressed by any well-formed tombstone in `events`. Built
 * from `tombstonesIn` rather than re-scanning `events` a second way — the
 * same reasoning `codebaseRefs` in decay.ts gives for reusing its extractor:
 * two independently-written passes over the same shape are how one of them
 * drifts and a suppression silently stops applying.
 *
 * A tombstone naming an id absent from `events` still suppresses that id —
 * the target may live in a segment this reader has not loaded, and
 * suppression must not depend on having seen the thing being suppressed, or
 * a partial read would silently un-delete it.
 */
export function suppressedIds(events: readonly JournalEvent[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const t of tombstonesIn(events)) out.add(t.target);
  return out;
}
