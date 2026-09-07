import { normalizeEvent, type JournalEvent } from './envelope.ts';

export interface ParseDiagnostic {
  readonly line: number;
  readonly message: string;
}

/** Matches the sibling package's bound. A segment truncated repeatedly by a lossy
 *  sync tool can otherwise produce one diagnostic per line with no ceiling. */
const MAX_DIAGNOSTICS = 32;

/** Parses JSONL, retaining every valid record around any malformed one. */
export function parseSegment(text: string): { events: JournalEvent[]; bad: ParseDiagnostic[] } {
  const events: JournalEvent[] = [];
  const bad: ParseDiagnostic[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]!.trim();
    if (!raw) continue;
    try {
      events.push(normalizeEvent(JSON.parse(raw)));
    } catch (error) {
      if (bad.length < MAX_DIAGNOSTICS) {
        bad.push({ line: i + 1, message: (error as Error).message });
      }
    }
  }
  return { events, bad };
}

/**
 * Injective join. A bare space is NOT collision-free: source "foo" with epoch
 * "bar baz" and source "foo bar" with epoch "baz" both yield "foo bar baz",
 * which would make two distinct sources share one sequence space. Both fields
 * are unconstrained text. The sibling package uses NUL for the same reason.
 */
function sourceKey(e: JournalEvent): string {
  return `${e.source}\0${e.sourceEpoch}`;
}

/**
 * Set union with dedup by id, then a deterministic total order.
 *
 * ORDERING CONTRACT — read this before changing the comparator.
 *
 * A single comparator cannot both interleave sources by wall clock AND honour
 * per-source `sequence`: the two bases disagree, and applying them per-PAIR is
 * intransitive. With A(seq 1, t=3), B(seq 2, t=1) and C(no seq, t=2) in one
 * source, A<B by sequence, B<C by time and C<A by time — a cycle, and
 * `Array.prototype.sort` then yields different output for different input
 * orders. That falsifies the order-independence this function exists to give.
 *
 * The spec resolves it (8.4): `sequence` is authoritative WITHIN a source, and
 * causality is NEVER inferred from timestamps. So the output is grouped by
 * source rather than interleaved by clock. Each source's own events are
 * correctly ordered; groups are ordered by their earliest observed time, then
 * by key. Both bases are applied to DISJOINT partitions, so the order is total
 * and the result is identical for any input permutation.
 *
 * A consumer wanting a clock-interleaved view sorts a projection itself and
 * owns that view's limits. Replay needs within-source correctness, not a
 * global timeline.
 *
 * Dedup is first-writer-wins. The design assumes one id means one immutable
 * event; if a replica ever violates that, the surviving copy depends on batch
 * order. Recorded rather than defended against.
 */
export function mergeEvents(batches: readonly (readonly JournalEvent[])[]): JournalEvent[] {
  const byId = new Map<string, JournalEvent>();
  for (const batch of batches) {
    for (const e of batch) if (!byId.has(e.id)) byId.set(e.id, e);
  }

  const groups = new Map<string, JournalEvent[]>();
  for (const e of byId.values()) {
    const key = sourceKey(e);
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }

  for (const list of groups.values()) {
    list.sort((a, b) => {
      // Sequenced events form one partition and unsequenced another; a
      // comparison never mixes the two bases, which is what makes it transitive.
      const aUnsequenced = a.sequence === undefined ? 1 : 0;
      const bUnsequenced = b.sequence === undefined ? 1 : 0;
      if (aUnsequenced !== bUnsequenced) return aUnsequenced - bUnsequenced;
      if (aUnsequenced === 0) return a.sequence! - b.sequence!;
      const byTime = Date.parse(a.time) - Date.parse(b.time);
      return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
    });
  }

  const earliest = (list: readonly JournalEvent[]): number =>
    list.reduce((min, e) => Math.min(min, Date.parse(e.time)), Number.POSITIVE_INFINITY);

  return [...groups.entries()]
    .sort(([kx, gx], [ky, gy]) => {
      const byTime = earliest(gx) - earliest(gy);
      return byTime !== 0 ? byTime : kx.localeCompare(ky);
    })
    .flatMap(([, list]) => list);
}
