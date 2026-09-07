import type { JournalEvent } from './envelope.ts';

export type TraceIndex = ReadonlyMap<string, readonly string[]>;

export interface TraceStep {
  readonly id: string;
  /** Which edge led here from the previous step; `null` for a matched root. */
  readonly via: 'influences' | 'supersedes' | 'invalidates' | null;
}

export interface TraceResult {
  readonly matched: string[];
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

export function traceFrom(events: readonly JournalEvent[], key: string): TraceResult {
  const ix = indexEntries(events);
  const byId = new Map(events.map((e) => [e.id, e]));
  const matched = [...(ix.get(key.trim().toLowerCase()) ?? [])];

  const chain: TraceStep[] = [];
  const seen = new Set<string>();
  // Breadth-first from every match, recording the edge that led to each step.
  // Ids are caller-supplied, so a cycle is reachable in an append-only log.
  const queue: TraceStep[] = matched.map((id) => ({ id, via: null }));
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
