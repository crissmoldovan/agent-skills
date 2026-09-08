import type { JournalEvent } from './envelope.ts';
import type { CoverageReport } from './coverage.ts';
import { readableAt, type Disclosure } from './disclosure.ts';
import { project, type Outcome } from './retract.ts';
import { isEntry } from './retention.ts';

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
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];
}

/**
 * Every field this touches renders into a single-line bullet BY
 * CONSTRUCTION — the title becomes a markdown heading (`## ${title}`), and
 * `chosen`/`reversibility`/`blastRadius`/`rationale`/each `rejected[]` item
 * becomes one `- **label** value` (or bare `- value`) line. Collapse any
 * embedded whitespace — including a newline — to a single space, then strip
 * a leading run of markdown block characters (`#`, `>`, `-`, `*`, backtick)
 * so a value typed carelessly, or adversarially, cannot inject its own
 * heading, blockquote, list marker, or escape into the document as a raw
 * line of its own. This is narrow line-normalisation, not a general
 * markdown escaper: nothing past the leading run is touched, so inline
 * emphasis, links, and the rest of ordinary markdown inside a value pass
 * through untouched.
 *
 * Originally scoped to the title alone, on the reasoning that body fields
 * were a broader design question this package had not settled. That was
 * wrong: `--rationale $'fine\n## Coverage\n\n- sessions observed: 9999'`
 * renders a forged second `## Coverage` block, with a fabricated count,
 * above the real one — in the artifact meant to be committed and reviewed.
 * §10.3's coverage statement is this design's honesty control; an ordinary
 * content field must not be able to forge it.
 */
function sanitizeLine(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().replace(/^[#>*`-]+\s*/, '');
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

  // `isEntry`, not `kind !== 'void'`. A digest is a rendering of AUTHORED
  // entries — the six kinds in retention.ts's own entry set. Filtering only
  // voids let every hook-captured observation through, so a session with the
  // adapters wired rendered one anonymous `## <uuid>` section per tool call:
  // no question, no statement, no claim to title it, `outcome: unknown`, and
  // nothing an entry-shaped `rank()` can order. The observation plane is read
  // through `show`, `trace` and `coverage`, never here.
  //
  // Note what does NOT change: `project(events)` above still runs over ALL
  // events, so a retraction edge from anywhere in the journal still resolves.
  // Only the display list narrows.
  const entries = events
    .filter((e) => isEntry(e) && readableAt(e, level))
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
    // A retraction entry — from `invalidate`, or `record --supersedes` —
    // carries none of question/statement/claim; it never had one. Without
    // this fallback its title fell through to its own raw id, and the row
    // that exists to say "this retracted that" named neither, anonymously.
    // `show` was already fixed for exactly this with its `retracts` field;
    // the digest is the committed, higher-stakes surface and was not.
    const invalidatesTarget = str(e, 'invalidates');
    const supersedesTarget = str(e, 'supersedes');
    const retractionTitle = invalidatesTarget
      ? `Retraction of ${invalidatesTarget}`
      : supersedesTarget
        ? `Supersession of ${supersedesTarget}`
        : undefined;
    const title = sanitizeLine(str(e, 'question') ?? str(e, 'statement') ?? str(e, 'claim')
      ?? retractionTitle ?? e.id);
    out.push(`## ${title}`, '');
    out.push(`- **id** \`${e.id}\` · **kind** ${e.kind} · **outcome** ${outcome}`);
    // Name the target explicitly — not just a readable title above, but the
    // edge itself — so a reader does not have to infer it from the title's
    // prose.
    if (invalidatesTarget) out.push(`- **invalidates** \`${invalidatesTarget}\``);
    if (supersedesTarget) out.push(`- **supersedes** \`${supersedesTarget}\``);
    const chosen = str(e, 'chosen');
    if (chosen) out.push(`- **chosen** ${sanitizeLine(chosen)}`);
    const rev = str(e, 'reversibility');
    if (rev) out.push(`- **reversibility** ${sanitizeLine(rev)}`);
    const blast = str(e, 'blastRadius');
    if (blast) out.push(`- **blast radius** ${sanitizeLine(blast)}`);
    const rationale = str(e, 'rationale');
    if (rationale) out.push(`- **why** ${sanitizeLine(rationale)}`);

    const rejected = list(e, 'rejected');
    if (rejected.length > 0) {
      out.push('', '**Rejected:**');
      for (const r of rejected) out.push(`- ${sanitizeLine(r)}`);
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
