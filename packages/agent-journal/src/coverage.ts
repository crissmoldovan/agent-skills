import { normalizeEvent, type JournalEvent, type Provenance } from './envelope.ts';
import { isEntry } from './retention.ts';

export interface VoidInput {
  readonly id: string;
  readonly source: string;
  readonly sourceEpoch: string;
  readonly time: string;
  readonly workspace: string;
  readonly session: string;
  readonly agent: string;
  readonly harness: string;
  readonly reason: string;
  readonly detail?: string;
  /** Which transport went silent. A refused CLI write is not a hook failure. */
  readonly provenance?: Provenance;
  readonly context?: string;
}

/** A refused write, dropped sink or hook failure, recorded so silence is auditable. */
export function voidEvent(input: VoidInput): JournalEvent {
  return normalizeEvent({
    schemaVersion: 1,
    id: input.id,
    source: input.source,
    sourceEpoch: input.sourceEpoch,
    time: input.time,
    workspace: input.workspace,
    session: input.session,
    agent: input.agent,
    author: 'agent',
    provenance: input.provenance ?? 'hook',
    harness: input.harness,
    context: input.context ?? 'coding',
    kind: 'void',
    data: { reason: input.reason, ...(input.detail === undefined ? {} : { detail: input.detail }) },
  });
}

export interface CoverageReport {
  readonly sessions: number;
  readonly sessionsWithNoEntries: string[];
  /** Sessions the caller knows started but which emitted NOTHING — not even a
   *  void. Derivable only from outside, since a session with no events leaves
   *  no trace in `events`. This is the worst silence the report exists to make
   *  legible, and the one case it cannot find on its own. */
  readonly sessionsWithNoEvents: string[];
  readonly voids: number;
  readonly sequenceGaps: string[];
  /** `null` means NOT ASSESSED, not "none found". Retention computes downgrades;
   *  a caller that never ran it must not be able to render an empty array and
   *  imply a clean bill of health. */
  readonly downgradedAnchors: string[] | null;
}

export function coverage(
  events: readonly JournalEvent[],
  options: {
    readonly downgradedAnchors?: readonly string[];
    /** Sessions the caller knows exist, so silence from one can be named. */
    readonly knownSessions?: readonly string[];
  } = {},
): CoverageReport {
  const sessions = new Set<string>();
  const withEntries = new Set<string>();
  const bySource = new Map<string, number[]>();
  let voids = 0;

  for (const e of events) {
    sessions.add(e.session);
    if (isEntry(e)) withEntries.add(e.session);
    if (e.kind === 'void') voids += 1;
    if (e.sequence !== undefined) {
      // NUL-joined, not space-joined: both fields are unconstrained text, so
      // "foo" + "bar baz" and "foo bar" + "baz" would collide into one key and
      // report a phantom sequence gap across two unrelated sources. Same defect
      // Task 5 fixed in read.ts; caught here before it was written.
      const key = `${e.source}\0${e.sourceEpoch}`;
      const list = bySource.get(key) ?? [];
      list.push(e.sequence);
      bySource.set(key, list);
    }
  }

  const sequenceGaps: string[] = [];
  for (const [key, seqs] of bySource) {
    const sorted = [...seqs].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i]! - sorted[i - 1]! > 1) {
        sequenceGaps.push(`${key.replace('\0', '@')}: ${sorted[i - 1]} to ${sorted[i]}`);
      }
    }
  }

  return {
    sessions: sessions.size,
    sessionsWithNoEntries: [...sessions].filter((s) => !withEntries.has(s)).sort(),
    sessionsWithNoEvents: [...(options.knownSessions ?? [])].filter((s) => !sessions.has(s)).sort(),
    voids,
    sequenceGaps,
    downgradedAnchors: options.downgradedAnchors === undefined
      ? null
      : [...options.downgradedAnchors],
  };
}
