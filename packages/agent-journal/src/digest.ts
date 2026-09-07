import type { JournalEvent } from './envelope.ts';
import type { CoverageReport } from './coverage.ts';
import { readableAt, type Disclosure } from './disclosure.ts';
import { project, type Outcome } from './retract.ts';

export interface DigestOptions {
  /** Who the digest is for. Defaults to `published` — the committed artifact. */
  readonly level?: Disclosure;
  readonly coverage: CoverageReport;
  readonly now: string;
}

const REVERSIBILITY_RANK: Readonly<Record<string, number>> = {
  'one-way': 0, hard: 1, moderate: 2, trivial: 3,
};

function str(e: JournalEvent, field: string): string | undefined {
  const v = e.data[field];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function list(e: JournalEvent, field: string): string[] {
  const v = e.data[field];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** True only when EVERY influence is model_knowledge — 5.4's signal, not a mere mention. */
function restsOnPriorsAlone(e: JournalEvent): boolean {
  const raw = e.data.influences;
  if (!Array.isArray(raw) || raw.length === 0) return false;
  return raw.every((i) => i !== null && typeof i === 'object'
    && (i as Record<string, unknown>).type === 'model_knowledge');
}

/**
 * Order by consequence, never by time (spec 6.4). A reader scanning a digest
 * needs the retracted and the irreversible first; when something happened is a
 * question the log already answers. The id tiebreak makes the order total, so
 * two renders of one journal are byte-identical and a committed digest does not
 * churn in review.
 */
function rank(e: JournalEvent, outcome: Outcome): [number, number, number, string] {
  return [
    outcome === 'invalidated' ? 0 : 1,
    REVERSIBILITY_RANK[str(e, 'reversibility') ?? ''] ?? 4,
    str(e, 'blastRadius') ? 0 : 1,
    e.id,
  ];
}

export function renderDigest(
  events: readonly JournalEvent[],
  options: DigestOptions,
): string {
  const level = options.level ?? 'published';
  const { outcomes } = project(events);

  const entries = events
    .filter((e) => e.kind !== 'void' && readableAt(e, level))
    .map((e) => ({ e, outcome: outcomes.get(e.id) ?? 'unknown' as Outcome }))
    .sort((x, y) => {
      const a = rank(x.e, x.outcome), b = rank(y.e, y.outcome);
      for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return (a[i] as number) - (b[i] as number);
      return (a[3] as string).localeCompare(b[3] as string);
    });

  const out: string[] = [
    `# Decision digest`, '',
    `As of ${options.now}. Rendered at disclosure level \`${level}\`.`,
    'This is a rendered artifact, never the source of truth.', '',
  ];

  if (entries.length === 0) {
    out.push('_No entries at this disclosure level._', '');
  }

  for (const { e, outcome } of entries) {
    const title = str(e, 'question') ?? str(e, 'statement') ?? str(e, 'claim') ?? e.id;
    out.push(`## ${title}`, '');
    out.push(`- **id** \`${e.id}\` · **kind** ${e.kind} · **outcome** ${outcome}`);
    const chosen = str(e, 'chosen');
    if (chosen) out.push(`- **chosen** ${chosen}`);
    const rev = str(e, 'reversibility');
    if (rev) out.push(`- **reversibility** ${rev}`);
    const blast = str(e, 'blastRadius');
    if (blast) out.push(`- **blast radius** ${blast}`);
    const rationale = str(e, 'rationale');
    if (rationale) out.push(`- **why** ${rationale}`);

    const rejected = list(e, 'rejected');
    if (rejected.length > 0) {
      out.push('', '**Rejected:**');
      for (const r of rejected) out.push(`- ${r}`);
    }

    if (restsOnPriorsAlone(e)) {
      out.push('', '> **No source consulted** — this rested on `model_knowledge` alone.');
    }
    out.push('');
  }

  const c = options.coverage;
  out.push(
    '---', '',
    '## Coverage', '',
    `- sessions observed: ${c.sessions}`,
    `- sessions that recorded nothing: ${c.sessionsWithNoEntries.length}`,
    `- sessions with no events at all: ${c.sessionsWithNoEvents === null ? 'not assessed' : c.sessionsWithNoEvents.length}`,
    `- refused writes (voids): ${c.voids}`,
    `- sequence gaps: ${c.sequenceGaps.length}`,
    `- downgraded anchors: ${c.downgradedAnchors === null ? 'not assessed' : c.downgradedAnchors.length}`,
    '',
    '`not assessed` is not `none` — it means nothing computed the figure.',
    '',
  );
  return out.join('\n');
}
