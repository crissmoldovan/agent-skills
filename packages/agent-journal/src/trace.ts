import type { JournalEvent } from './envelope.ts';

export type TraceIndex = ReadonlyMap<string, readonly string[]>;

export interface TraceStep {
  readonly id: string;
  /** Which edge led here from the previous step; `null` for a matched root. */
  readonly via: 'influences' | 'supersedes' | 'invalidates' | null;
}

/**
 * Which of the four key sources produced this match. Distinct from
 * `TraceStep.via` — that names a traversal *edge*; this names a lookup
 * *source*. Four sources share one flat key space, so a key can match for
 * reasons a reader would weigh differently: an entry whose `subject` IS
 * `src/queue.ts` is about that file, while one that merely cites it in an
 * anchor is evidence involving it. Returning bare ids would make those
 * indistinguishable, and the whole value of this lookup is that its answer
 * needs no adjudication.
 */
export interface TraceMatch {
  readonly id: string;
  readonly via: 'subject' | 'anchor' | 'influence' | 'id';
}

export interface TraceResult {
  readonly matched: TraceMatch[];
  readonly chain: TraceStep[];
}

function refs(e: JournalEvent, field: 'anchors' | 'influences'): string[] {
  const raw = e.data[field];
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const ref = (item as Record<string, unknown>).ref;
      if (typeof ref === 'string' && ref.trim()) out.push(ref.trim());
    }
  }
  return out;
}

function journalRefs(e: JournalEvent): string[] {
  const raw = e.data.influences;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const rec = item as Record<string, unknown>;
      if (rec.type === 'journal' && typeof rec.ref === 'string' && rec.ref.trim()) {
        out.push(rec.ref.trim());
      }
    }
  }
  return out;
}

function edge(e: JournalEvent, field: 'supersedes' | 'invalidates'): string | undefined {
  const v = e.data[field];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * Spec 10.2. Four key sources, all equal: `subject`, every anchor ref (which is
 * how a `runtime` flag becomes a starting point), every influence ref (a ticket,
 * a URL), and the id.
 *
 * Keys are exact and lower-cased. A fuzzy index would return entries a reader
 * then has to disprove, and the value of this lookup is that its answer needs no
 * adjudication.
 */
export function indexEntries(events: readonly JournalEvent[]): TraceIndex {
  const ix = new Map<string, string[]>();
  const add = (key: string, id: string) => {
    const k = key.trim().toLowerCase();
    if (!k) return;
    const seen = ix.get(k);
    if (seen) { if (!seen.includes(id)) seen.push(id); }
    else ix.set(k, [id]);
  };
  for (const e of events) {
    if (e.kind === 'void') continue;
    add(e.id, e.id);
    if (e.subject) add(e.subject, e.id);
    for (const r of refs(e, 'anchors')) add(r, e.id);
    for (const r of refs(e, 'influences')) add(r, e.id);
  }
  return ix;
}

/**
 * Which source, for THIS entry, produced a match against the already
 * lower-cased `key`. Order of the checks IS the precedence: an entry whose id
 * IS the key is the entry a reader asked for; that it also happens to cite the
 * key elsewhere is secondary. `id` beats `subject` beats `anchor` beats
 * `influence`.
 */
function matchSource(e: JournalEvent, key: string): TraceMatch['via'] | null {
  if (e.id.trim().toLowerCase() === key) return 'id';
  if (e.subject && e.subject.trim().toLowerCase() === key) return 'subject';
  if (refs(e, 'anchors').some((r) => r.toLowerCase() === key)) return 'anchor';
  if (refs(e, 'influences').some((r) => r.toLowerCase() === key)) return 'influence';
  return null;
}

export function traceFrom(events: readonly JournalEvent[], key: string): TraceResult {
  const ix = indexEntries(events);
  const byId = new Map(events.map((e) => [e.id, e]));
  const k = key.trim().toLowerCase();

  const matched: TraceMatch[] = [];
  for (const id of ix.get(k) ?? []) {
    const e = byId.get(id);
    if (!e) continue;
    const via = matchSource(e, k);
    if (via) matched.push({ id, via });
  }

  const chain: TraceStep[] = [];
  const seen = new Set<string>();
  // Breadth-first from every match, recording the edge that led to each step.
  // Ids are caller-supplied, so a cycle is reachable in an append-only log.
  // Traversal starts from every matched id regardless of `via` — which source
  // matched changes nothing about what gets walked.
  const queue: TraceStep[] = matched.map((m) => ({ id: m.id, via: null }));
  while (queue.length > 0) {
    const step = queue.shift()!;
    if (seen.has(step.id)) continue;
    const e = byId.get(step.id);
    if (!e) continue;              // a dangling edge is skipped, never fatal
    seen.add(step.id);
    chain.push(step);
    for (const ref of journalRefs(e)) queue.push({ id: ref, via: 'influences' });
    const sup = edge(e, 'supersedes');
    if (sup) queue.push({ id: sup, via: 'supersedes' });
    const inv = edge(e, 'invalidates');
    if (inv) queue.push({ id: inv, via: 'invalidates' });
  }
  return { matched, chain };
}
