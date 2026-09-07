import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { capabilitiesWithAnchors, normalizeCapabilities, normalizeEvent, type JournalEvent } from './envelope.ts';
import {
  parseAnchor, parseInfluence, fieldsFor, normalizeEntryData, KIND_FIELDS,
  type Anchor, type Influence,
} from './entry.ts';
import { SegmentJournal } from './journal.ts';
import { parseSegment, mergeEvents } from './read.ts';
import { coverage, voidEvent } from './coverage.ts';

export interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const USAGE = [
  'usage:',
  '  agent-journal record --kind <kind> --workspace <id> [--question q] [--chosen c]',
  '                       [--rationale r] [--rejected r] [--blastRadius b] [--confidence c]',
  '                       [--reversibility trivial|moderate|hard|one-way]',
  '                       [--supersedes id] [--invalidates id]',
  '                       [--anchor <class>:<ref>]… [--influence <type>:<role>[:<ref>]]…',
  '                       [--id id] [--author agent|human] [--context c]',
  '  agent-journal invalidate <entry-id> --reason <why> --workspace <id>',
  '  agent-journal coverage --workspace <id>',
  '  agent-journal help',
  '',
].join('\n');

interface ParsedFlags {
  readonly opts: Map<string, string>;
  /** Every value seen for a flag, in order. Repeatable flags read this. */
  readonly all: Map<string, string[]>;
  /** Flags given no value. Every flag this CLI accepts takes one. */
  readonly valueless: readonly string[];
}

function flags(argv: readonly string[]): ParsedFlags {
  const opts = new Map<string, string>();
  const all = new Map<string, string[]>();
  const valueless: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith('--')) continue;
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      opts.set(name, next);
      all.set(name, [...(all.get(name) ?? []), next]);
      i += 1;
    } else {
      // Storing 'true' here was silent data invention. `--workspace $WS` with an
      // unset variable expands to a bare flag, and the entry was written to a
      // workspace literally named `true` with exit 0 — the failure looked exactly
      // like success. No flag here is a boolean, so a missing value is an error.
      valueless.push(name);
    }
  }
  return { opts, all, valueless };
}

/**
 * Fields every kind shares, regardless of which kind `--kind` names.
 * `supersedes`/`invalidates` are retraction edges, not kind fields — they are
 * set on `data` after `normalizeEntryData` runs, not through it.
 */
const RECORD_GLOBAL = ['workspace', 'kind', 'id', 'author', 'context',
  'supersedes', 'invalidates', 'anchor', 'influence'] as const;

/**
 * What each subcommand accepts. One shared list was wrong in both directions:
 * `reason` belongs to `invalidate`, but listing it globally let `record` take it
 * and throw it away at exit 0 — and `--reason` is the likeliest mistyping of
 * `--rationale`. The reverse held too: `invalidate` accepted `--kind`,
 * `--question`, `--id` and `--context` and silently ignored all four.
 *
 * `record`'s allowed set is the union of every kind's fields, since which
 * fields actually apply depends on `--kind` and that is not known yet at this
 * generic gate. This gate only catches genuine typos (`--rejcted`); a field
 * that belongs to some OTHER kind than the one given passes here and is
 * caught precisely, once `kind` is read, by the per-kind check below.
 */
const ALLOWED_FLAGS: Readonly<Record<string, readonly string[]>> = {
  record: [...RECORD_GLOBAL, ...Object.values(KIND_FIELDS).flat()],
  invalidate: ['workspace', 'reason'],
  coverage: ['workspace'],
};

function unknownFlags(command: string, opts: Map<string, string>): string[] {
  const allowed = ALLOWED_FLAGS[command];
  if (!allowed) return [];
  const known = new Set<string>(allowed);
  return [...opts.keys()].filter((k) => !known.has(k)).sort();
}

function nowStamp(): string {
  // Real milliseconds, not truncated. Truncating made every event in a given
  // second tie, and ties fall back to a lexical source comparison — under which
  // `cli/host/-/-` (invalidate) sorts BEFORE `cli/host/s1/primary` (record), so
  // a retraction could be ordered ahead of the finding it retracts.
  return new Date().toISOString();
}

function journalFor(root: string, workspace: string, session: string, agent: string): SegmentJournal {
  return new SegmentJournal({ root, workspace, machine: hostname(), session, agent, epoch: 'e1' });
}

interface ReadResult {
  readonly events: JournalEvent[];
  /** Paths that exist but could not be read. Never silently empty. */
  readonly unreadable: string[];
  /** `path:line` for each line that did not parse. */
  readonly malformed: string[];
}

/**
 * Reading swallowed every error and discarded every parse diagnostic, so a
 * destroyed journal and a journal that never existed produced the same all-zero
 * report at exit 0 — from the one command whose stated purpose is making silence
 * legible. An unreadable FILE meanwhile escaped as a raw stack, so the two
 * adjacent failures behaved in opposite wrong ways.
 *
 * ENOENT is the only benign case: a workspace nobody has written to yet. Every
 * other error is recorded and surfaced.
 */
async function readAll(root: string, workspace: string): Promise<ReadResult> {
  const base = join(root, 'workspaces', workspace, 'segments');
  const batches: JournalEvent[][] = [];
  const unreadable: string[] = [];
  const malformed: string[] = [];

  const benign = (error: unknown): boolean =>
    (error as NodeJS.ErrnoException).code === 'ENOENT';

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (!benign(error)) unreadable.push(`${dir} (${(error as NodeJS.ErrnoException).code})`);
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { await walk(full); continue; }
      if (!e.name.endsWith('.jsonl')) continue;
      let text;
      try {
        text = await readFile(full, 'utf8');
      } catch (error) {
        unreadable.push(`${full} (${(error as NodeJS.ErrnoException).code})`);
        continue;
      }
      const { events, bad } = parseSegment(text);
      for (const d of bad) malformed.push(`${full}:${d.line} ${d.message}`);
      batches.push(events);
    }
  }

  await walk(base);
  return { events: mergeEvents(batches), unreadable, malformed };
}

export async function runCli(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): Promise<CliResult> {
  // Redaction refusal was handled; I/O failure was not, so a full disk or a
  // read-only root escaped as an unhandled rejection and killed the process with
  // a raw stack. A caller cannot branch on a stack trace.
  try {
    return await dispatch(argv, env);
  } catch (error) {
    const e = error as NodeJS.ErrnoException;
    const detail = e.code ? `${e.code}: ${e.message}` : String(e.message ?? error);
    return { code: 1, stdout: '', stderr: `could not complete: ${detail}\n` };
  }
}

async function dispatch(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): Promise<CliResult> {
  const [command, ...rest] = argv;
  if (!command) return { code: 2, stdout: '', stderr: USAGE };

  // `help` is a request, not a usage error: stdout and exit 0, so
  // `agent-journal help` works as the install check the docs tell people to run.
  // Without this every probe fell through to the --workspace guard and exited 2,
  // which reads as a broken install.
  if (command === 'help' || command === '--help' || command === '-h') {
    return { code: 0, stdout: USAGE, stderr: '' };
  }

  const { opts, all, valueless } = flags(rest);
  const root = env.AGENT_JOURNAL_ROOT ?? join(env.HOME ?? '.', '.agents', 'journal');

  if (valueless.length > 0) {
    const which = valueless.map((f) => `--${f}`).join(', ');
    return {
      code: 2,
      stdout: '',
      stderr: `flag${valueless.length > 1 ? 's' : ''} given no value: ${which}\n${USAGE}`,
    };
  }

  // Refuse flags this subcommand does not take. Silently ignoring one loses
  // whatever the caller meant to record, with an exit code of 0 saying it worked.
  const unknown = unknownFlags(command, opts);
  if (unknown.length > 0) {
    return {
      code: 2,
      stdout: '',
      stderr: `unknown flag${unknown.length > 1 ? 's' : ''}: ${unknown.map((f) => `--${f}`).join(', ')}\n${USAGE}`,
    };
  }

  const workspace = opts.get('workspace');
  if (!workspace) return { code: 2, stdout: '', stderr: `--workspace is required\n${USAGE}` };

  if (command === 'record') {
    const kind = opts.get('kind');
    if (!kind) return { code: 2, stdout: '', stderr: `--kind is required\n${USAGE}` };

    // The generic gate above only catches typos: it allows every kind's fields
    // through regardless of which kind was actually given. This is the precise
    // check — a field genuinely allowed on some OTHER kind must still be
    // refused here, or a `--question` on an `assumption` would silently pass.
    const allowedForKind = new Set<string>([...RECORD_GLOBAL, ...fieldsFor(kind)]);
    const wrongKind = [...opts.keys()].filter((k) => !allowedForKind.has(k)).sort();
    if (wrongKind.length > 0) {
      return {
        code: 2,
        stdout: '',
        stderr: `${wrongKind.map((f) => `--${f}`).join(', ')} `
          + `${wrongKind.length > 1 ? 'are' : 'is'} not a field of kind '${kind}'; `
          + `it takes ${fieldsFor(kind).map((f) => `--${f}`).join(', ') || 'no fields'}\n`,
      };
    }

    const session = env.AGENT_JOURNAL_SESSION ?? 'unknown';
    const agent = env.AGENT_JOURNAL_AGENT ?? 'primary';
    const explicitId = opts.get('id');
    const id = explicitId ?? randomUUID();

    // Merge dedups by id, first writer wins, so a second entry under an id that
    // already exists lands on disk and is then invisible to every read path —
    // written, acknowledged, and unrecoverable. Only an explicit --id can
    // collide; a generated UUID cannot, and does not pay for this read.
    if (explicitId !== undefined) {
      const { events } = await readAll(root, workspace);
      if (events.some((e) => e.id === explicitId)) {
        return {
          code: 2,
          stdout: '',
          stderr: `an entry with id ${explicitId} already exists in this workspace; `
            + `ids are unique and the existing entry was not modified\n`,
        };
      }
    }

    // A human running this by hand is not an agent. Defaults to agent because
    // hooks are the common caller, but a refusal recorded against the wrong
    // author is the same misattribution voidEvent's `author` field exists to fix.
    // An unrecognised value was silently coerced to `agent` at exit 0 while
    // normalizeEvent rejects one outright — the CLI was the only layer guessing
    // at the field a retraction's credibility rests on.
    const declaredAuthor = opts.get('author');
    if (declaredAuthor !== undefined && declaredAuthor !== 'human' && declaredAuthor !== 'agent') {
      return {
        code: 2,
        stdout: '',
        stderr: `--author must be 'agent' or 'human', got ${JSON.stringify(declaredAuthor)}\n${USAGE}`,
      };
    }
    const author = declaredAuthor === 'human' ? 'human' : 'agent';

    // Structured, repeatable, and parsed before anything is written: a malformed
    // anchor must not produce a half-formed entry that exits 0.
    let anchors: Anchor[];
    let influences: Influence[];
    try {
      anchors = (all.get('anchor') ?? []).map(parseAnchor);
      influences = (all.get('influence') ?? []).map(parseInfluence);
    } catch (error) {
      return { code: 2, stdout: '', stderr: `${(error as Error).message}\n${USAGE}` };
    }

    let data: Record<string, unknown>;
    try {
      data = normalizeEntryData(kind, all);
    } catch (error) {
      return { code: 2, stdout: '', stderr: `${(error as Error).message}\n` };
    }

    // Retraction edges, not kind fields — set after normalizeEntryData so a
    // `--supersedes`/`--invalidates` id is never mistaken for one of the kind's
    // own fields (or rejected by a kind that has neither).
    for (const edge of ['supersedes', 'invalidates'] as const) {
      const v = opts.get(edge);
      if (v !== undefined) data[edge] = v;
    }

    // Absent stays absent. Writing [] would claim "assessed, none found", which
    // is the exact conflation `coverage` reports null to avoid.
    if (anchors.length > 0) data.anchors = anchors;
    if (influences.length > 0) data.influences = influences;

    const event = normalizeEvent({
      schemaVersion: 1, id, source: `cli/${hostname()}/${session}/${agent}`, sourceEpoch: 'e1',
      time: nowStamp(), workspace, session, agent, author, provenance: 'cli',
      harness: env.AGENT_JOURNAL_HARNESS ?? 'other', context: opts.get('context') ?? 'coding',
      capabilities: capabilitiesWithAnchors(normalizeCapabilities({}), anchors),
      kind, data,
    });

    const journal = journalFor(root, workspace, session, agent);
    const result = await journal.append(event);
    if (!result.written) {
      // Persist the refusal. Returning an error code alone means a refused write
      // never reaches `coverage()`'s `voids` count, so the silence this refusal
      // creates stays invisible — which is what voidEvent exists to prevent.
      const trace = await journal.append(voidEvent({
        id: randomUUID(), source: event.source, sourceEpoch: event.sourceEpoch,
        time: nowStamp(), workspace, session, agent,
        harness: env.AGENT_JOURNAL_HARNESS ?? 'other',
        reason: `redaction ${result.verdict}`, provenance: 'cli', author,
        ...(result.reason === undefined ? {} : { detail: result.reason }),
      }));
      return {
        code: 1,
        stdout: '',
        stderr: `refused: redaction ${result.verdict} — ${result.reason ?? 'no detail'}\n`
          + (trace.written ? '' : 'WARNING: the refusal itself could not be recorded\n'),
      };
    }
    return { code: 0, stdout: `recorded ${id}\n`, stderr: '' };
  }

  if (command === 'invalidate') {
    const target = rest[0];
    const reason = opts.get('reason');
    if (!target || target.startsWith('--')) {
      return { code: 2, stdout: '', stderr: `an entry id is required\n${USAGE}` };
    }
    if (!reason) return { code: 2, stdout: '', stderr: `--reason is required\n${USAGE}` };

    // No session: a human retracting from a bare shell (spec 5.8).
    const event = normalizeEvent({
      schemaVersion: 1, id: randomUUID(), source: `cli/${hostname()}/-/-`, sourceEpoch: 'e1',
      time: nowStamp(), workspace, session: '-', agent: '-', author: 'human', provenance: 'cli',
      harness: 'other', context: 'coding', kind: 'decision',
      data: { invalidates: target, rationale: reason },
    });

    const journal = journalFor(root, workspace, '-', '-');
    const result = await journal.append(event);
    if (!result.written) {
      // The SAME guarantee record makes. Returning only an error code here left
      // the refusal invisible — no disk record, and coverage()'s voids never saw
      // it — in the human-retraction path this command exists for.
      const trace = await journal.append(voidEvent({
        id: randomUUID(), source: event.source, sourceEpoch: event.sourceEpoch,
        time: nowStamp(), workspace, session: '-', agent: '-', harness: 'other',
        reason: `redaction ${result.verdict}`, provenance: 'cli', author: 'human',
        ...(result.reason === undefined ? {} : { detail: result.reason }),
      }));
      return {
        code: 1,
        stdout: '',
        stderr: `refused: redaction ${result.verdict}\n`
          + (trace.written ? '' : 'WARNING: the refusal itself could not be recorded\n'),
      };
    }
    // Append-only by design, so an unknown target is not an error — but a human
    // correcting a typo deserves to hear that nothing matched.
    const known = (await readAll(root, workspace)).events.some((e) => e.id === target);
    // Exit stays 0: a retraction may legitimately precede the entry it names,
    // arriving from another replica later. But `invalidated <id>` on stdout is
    // what a script reads as success, and nothing was suppressed — so stdout
    // says what actually happened and the claim is reserved for a real match.
    return {
      code: 0,
      stdout: known
        ? `invalidated ${target}\n`
        : `retraction recorded for ${target}; no matching entry in this workspace\n`,
      stderr: known ? '' : `WARNING: no entry with id ${target} is present in this workspace\n`,
    };
  }

  if (command === 'coverage') {
    // No retention pass has run here, so downgraded anchors are UNASSESSED.
    // Passing nothing yields `downgradedAnchors: null`, which renders as "not
    // assessed" rather than an empty array implying none were found.
    const { events, unreadable, malformed } = await readAll(root, workspace);
    const report = coverage(events);
    // Damage is reported IN the report, not only on stderr, because the report is
    // what gets pasted into a review. A journal that could not be fully read has
    // not earned exit 0: its zeroes mean "we could not look", not "nothing there".
    const damaged = unreadable.length > 0 || malformed.length > 0;
    const out = { ...report, unreadable, malformed };
    return {
      code: damaged ? 1 : 0,
      stdout: `${JSON.stringify(out, null, 2)}\n`,
      stderr: damaged
        ? `WARNING: this journal could not be fully read — ${unreadable.length} unreadable path(s), `
          + `${malformed.length} malformed line(s). The counts above are a floor, not a total.\n`
        : '',
    };
  }

  return { code: 2, stdout: '', stderr: `unknown command: ${command}\n${USAGE}` };
}
