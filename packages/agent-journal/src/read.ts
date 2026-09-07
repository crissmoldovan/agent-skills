import { normalizeEvent, type JournalEvent } from './envelope.ts';

export interface ParseDiagnostic {
  readonly line: number;
  readonly message: string;
}

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
      bad.push({ line: i + 1, message: (error as Error).message });
    }
  }
  return { events, bad };
}

function sourceKey(e: JournalEvent): string {
  return `${e.source} ${e.sourceEpoch}`;
}

/**
 * Set union with dedup by id — a grow-only set, so merge is order-independent.
 * `sequence` is authoritative WITHIN a source; wall clock only orders across
 * sources and never implies causality (spec 8.4).
 */
export function mergeEvents(batches: readonly (readonly JournalEvent[])[]): JournalEvent[] {
  const byId = new Map<string, JournalEvent>();
  for (const batch of batches) {
    for (const e of batch) if (!byId.has(e.id)) byId.set(e.id, e);
  }

  return [...byId.values()].sort((a, b) => {
    if (sourceKey(a) === sourceKey(b) && a.sequence !== undefined && b.sequence !== undefined) {
      return a.sequence - b.sequence;
    }
    const byTime = Date.parse(a.time) - Date.parse(b.time);
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  });
}
