import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { readdir, readFile, mkdir, writeFile, realpath, lstat, readlink } from 'node:fs/promises';
import { join, dirname, resolve, basename, sep, isAbsolute, relative } from 'node:path';
import { capabilitiesWithAnchors, normalizeCapabilities, normalizeEvent, type JournalEvent } from './envelope.ts';
import {
  parseAnchor, parseInfluence, fieldsFor, normalizeEntryData, KIND_FIELDS, ENUM_FIELDS, LIST_FIELDS,
  type Anchor, type Influence,
} from './entry.ts';
import {
  OBSERVATION_KINDS, OBSERVATION_FIELDS, fieldsForObservation, normalizeObservationData,
} from './observe.ts';
import { captureEnvironment } from './environment.ts';
import { DISCLOSURE_CLASSES, type Disclosure } from './disclosure.ts';
import { SegmentJournal } from './journal.ts';
import { parseSegment, mergeEvents } from './read.ts';
import { coverage, voidEvent } from './coverage.ts';
import { project } from './retract.ts';
import { liveConstraints, constraintsBearingOn } from './constraints.ts';
import { liveClaims } from './claims.ts';
import { renderDigest } from './digest.ts';
import { traceFrom } from './trace.ts';

export interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * One line per kind naming its own fields, generated from KIND_FIELDS /
 * ENUM_FIELDS / LIST_FIELDS so this cannot drift the way the old fixed,
 * decision-shaped USAGE block did — `agent-journal help` gave a user no way
 * to discover --claim, --assumed, --blocked, --did or --statement even after
 * those fields existed. A line per kind stays readable; one flattened block
 * of all thirty-odd flags would not.
 */
function kindUsageLine(kind: string): string {
  const flags = fieldsFor(kind).map((field) => {
    const allowed = ENUM_FIELDS[kind]?.[field];
    const flag = LIST_FIELDS.has(field) ? `[--${field}]…` : `--${field}`;
    return allowed ? `${flag} ${allowed.join('|')}` : flag;
  });
  return `    ${kind}: ${flags.join(' ')}`;
}

const USAGE = [
  'usage:',
  '  agent-journal record --kind <kind> --workspace <id> [--id id] [--author agent|human]',
  '                       [--context c] [--supersedes id] [--invalidates id]',
  '                       [--anchor <class>:<ref>]… [--influence <type>:<role>[:<ref>]]…',
  '                       [--disclosure private|team|published] [--subject s]',
  '                       ...plus the fields for <kind>:',
  ...Object.keys(KIND_FIELDS).map(kindUsageLine),
  '  agent-journal observe --kind <kind> --workspace <id> [--id id] [--context c] [--seq n]',
  '                        ...plus the fields for <kind>: ' + Object.keys(OBSERVATION_FIELDS).join(', '),
  '  agent-journal invalidate <entry-id> --reason <why> --workspace <id> [--disclosure private|team|published]',
  '  agent-journal coverage --workspace <id>',
  '  agent-journal show --workspace <id> [--id <entry-id>]',
  '  agent-journal claims --workspace <id>  (advisory only — reports, never blocks)',
  '  agent-journal digest --workspace <id> [--level private|team|published] [--out <path>]',
  '  agent-journal trace <key> --workspace <id>',
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

/**
 * Two forms, both accepted: `--flag value` and `--flag=value`.
 *
 * The space-separated form cannot carry a value that itself begins with `--`,
 * and it never could: this parser has to treat a `--`-prefixed token as the
 * next flag name, or a genuinely valueless flag becomes indistinguishable
 * from one whose value happens to look like a flag. That was not a
 * theoretical hazard. An assistant message opening with a markdown horizontal
 * rule makes `--turn ---\nSummary: …` a valueless `--turn`, the CLI exits 2,
 * and both adapters ignore the exit code by design — so nothing is written,
 * no `void` is recorded, and `coverage` shows no gap. Silence with no trace
 * is the one failure the observation plane exists to prevent, so the
 * adapters now emit `--flag=value` exclusively, which cannot be confused
 * with anything: the name ends at the first `=` and everything after it is
 * the value, `--` prefix, embedded `=`, newlines and all.
 *
 * `--flag=` — nothing after the `=` — is an ERROR, not an empty value. It is
 * the same accident in `=` clothing: `--workspace=$WS` with `WS` unset
 * expands to exactly that, and the whole reason the valueless guard exists is
 * that `--workspace $WS` once wrote to a workspace literally named `true` at
 * exit 0. `--flag ''` (an explicitly quoted empty argument) is a different
 * act — deliberate, not an expansion accident — and still parses as a value,
 * which the field normalizers then treat as absent.
 */
function flags(argv: readonly string[]): ParsedFlags {
  const opts = new Map<string, string>();
  const all = new Map<string, string[]>();
  const valueless: string[] = [];
  const take = (name: string, value: string): void => {
    opts.set(name, value);
    all.set(name, [...(all.get(name) ?? []), value]);
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith('--')) continue;
    const body = token.slice(2);
    const eq = body.indexOf('=');
    if (eq >= 0) {
      // First `=` only. A later one belongs to the value — `--input=a=b` is
      // the flag `input` carrying `a=b`, not a malformed anything.
      const name = body.slice(0, eq);
      const value = body.slice(eq + 1);
      if (value === '') valueless.push(name);
      else take(name, value);
      continue;
    }
    const name = body;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      take(name, next);
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
  'supersedes', 'invalidates', 'anchor', 'influence', 'disclosure', 'subject'] as const;
const RECORD_GLOBAL_SET = new Set<string>(RECORD_GLOBAL);

/**
 * Fields every observation shares, regardless of `--kind`. Deliberately
 * missing `--author` — an observation is never authored by a human, which is
 * what makes it Plane A — and `--disclosure` — observations are machinery,
 * not candour, so they take the envelope default rather than a caller's
 * stated intent.
 */
const OBSERVATION_GLOBAL = ['workspace', 'kind', 'id', 'context', 'seq'] as const;

/** Kinds `record` writes. `observe` refuses any of these — that is `record`'s job. */
const ENTRY_KINDS_SET = new Set<string>(Object.keys(KIND_FIELDS));

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
  observe: [...OBSERVATION_GLOBAL, ...Object.values(OBSERVATION_FIELDS).flat()],
  invalidate: ['workspace', 'reason', 'disclosure'],
  coverage: ['workspace'],
  show: ['workspace', 'id'],
  claims: ['workspace'],
  digest: ['workspace', 'level', 'out'],
  trace: ['workspace'],
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

/**
 * Resolve the PARENT directory chain of `p` as canonically as the filesystem
 * allows: walk up to the longest existing ancestor, `realpath()` that, and
 * lexically rejoin whatever does not exist yet. Deliberately never inspects
 * the final path component itself — that needs different treatment (see
 * `canonicalize`), because a symlink AT that position must be followed to
 * where it points, not treated as "this segment doesn't exist yet".
 */
async function realParentDir(dirPath: string): Promise<string> {
  let current = resolve(dirPath);
  const tail: string[] = [];
  for (;;) {
    try {
      const real = await realpath(current);
      return tail.length === 0 ? real : join(real, ...tail);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(current);
      if (parent === current) return join(current, ...tail); // reached the fs root; nothing more to resolve
      tail.unshift(basename(current));
      current = parent;
    }
  }
}

/**
 * Resolve `p` as canonically as the filesystem allows, so a comparison against
 * it cannot be defeated by a relative path, a `..` traversal, or a symlink
 * anywhere in the chain — including the FINAL component being a symlink whose
 * target does not exist yet.
 *
 * `fs.realpath()` alone throws ENOENT the instant any segment does not exist
 * — including a dangling symlink's TARGET, which is exactly what `--out`
 * pointed through such a symlink looks like from realpath's point of view.
 * The previous version of this function treated every ENOENT the same way —
 * walk up, lexically rejoin the basename — which for a dangling final-
 * component symlink reconstructs the SYMLINK'S OWN location, never where it
 * points. `writeFile` then follows the link anyway, so a dangling symlink
 * into the segment tree canonicalized to somewhere harmless while the actual
 * write landed inside the tree it was supposed to be caught by.
 *
 * The fix resolves the parent directory chain (which legitimately may not
 * fully exist yet — `--out` to a fresh nested path always looks like that)
 * separately from the final component. For the final component, `lstat` —
 * never `realpath` — decides what it is: nonexistent (the ordinary "fresh
 * output path" case, returned as-is), an existing non-symlink (already
 * canonical, since its parent is), or a symlink, dangling or not, which is
 * followed to wherever it actually points — recursively, since the target
 * can itself be another symlink or another not-yet-existing nested path —
 * rather than back to the link's own location.
 */
async function canonicalize(p: string, depth = 0): Promise<string> {
  if (depth > 40) {
    // A real filesystem refuses a symlink chain this long with ELOOP; this
    // mirrors that instead of recursing forever around a symlink cycle.
    throw Object.assign(new Error(`too many levels of symbolic links: ${p}`), { code: 'ELOOP' });
  }
  const abs = resolve(p);
  const parentReal = await realParentDir(dirname(abs));
  const candidate = join(parentReal, basename(abs));

  let stat;
  try {
    stat = await lstat(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // Genuinely does not exist at all, at any level — nothing more to resolve.
    return candidate;
  }

  if (!stat.isSymbolicLink()) {
    // Exists, and is not itself a link: the parent is already canonical and
    // this component adds nothing symlinked on top of it.
    return candidate;
  }

  // A symlink, dangling or not — follow it to wherever it actually points,
  // then canonicalize THAT (it may not exist yet either, or may itself be
  // another symlink), rather than falling back to the link's own location.
  const target = await readlink(candidate);
  const resolvedTarget = isAbsolute(target) ? target : join(dirname(candidate), target);
  return canonicalize(resolvedTarget, depth + 1);
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
    // Node's fs errors already begin their `message` with the code
    // (`EISDIR: illegal operation on a directory, open '...'`), so
    // unconditionally prepending it here doubled it — `--out` is what made
    // this reachable by a user doing something ordinary: pointing at a
    // directory, or at a file they cannot write.
    const message = String(e.message ?? error);
    const detail = e.code && !message.startsWith(`${e.code}:`) ? `${e.code}: ${message}` : message;
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

    // Spec 5.6/5.7 name six kinds, but retention.ts (spec 4.4) deliberately
    // keeps an entry whose kind is in NEITHER of its sets unclassified rather
    // than destroying what may be a legitimate future kind. Refusing an
    // unrecognised `--kind` outright here would contradict that — it would
    // destroy the very entry retention.ts exists to keep. So an unrecognised
    // kind is written anyway, with no kind-specific fields (fieldsFor(kind)
    // is empty for it, so normalizeEntryData stores none), and warned about —
    // the same idiom `invalidate` already uses for a target with no match:
    // exit 0, the entry lands, and a WARNING says what happened.
    const kindKnown = Object.prototype.hasOwnProperty.call(KIND_FIELDS, kind);
    let kindWarning = '';
    if (kindKnown) {
      // The generic gate above only catches typos: it allows every kind's
      // fields through regardless of which kind was actually given. This is
      // the precise check — a field genuinely allowed on some OTHER kind must
      // still be refused here, or a `--question` on an `assumption` would
      // silently pass.
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
    } else {
      // The bare-unknown-kind case above is genuine forward compatibility: the
      // kind itself may be legitimate, just not known to this version yet, and
      // retention.ts already keeps it unclassified rather than destroying it.
      // But that grace covers the KIND, not the DATA. fieldsFor() of an
      // unknown kind is empty, so any content flag here — anything that is not
      // one of the always-allowed globals — would be silently thrown away
      // while the CLI still reported success at exit 0. Destroying what the
      // caller typed is not what "forward compatible" was ever meant to cover,
      // so an unknown kind arriving WITH content flags is refused outright,
      // naming exactly what it would have destroyed.
      const contentFlags = [...opts.keys()].filter((k) => !RECORD_GLOBAL_SET.has(k)).sort();
      if (contentFlags.length > 0) {
        return {
          code: 2,
          stdout: '',
          stderr: `kind ${JSON.stringify(kind)} is not one of the known kinds `
            + `(${Object.keys(KIND_FIELDS).join(', ')}); refusing to write and silently discard `
            + `${contentFlags.map((f) => `--${f}`).join(', ')}\n`,
        };
      }
      kindWarning = `WARNING: kind ${JSON.stringify(kind)} is not one of the known kinds `
        + `(${Object.keys(KIND_FIELDS).join(', ')}); no kind-specific fields will be stored\n`;
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

    // Refuse rather than contain. normalizeDisclosure maps an unrecognised value
    // to `private` because a FOREIGN record's intent is unknowable — but here the
    // caller is present, and silently downgrading their stated intent is the
    // `--author robot` coercion this CLI already removed once.
    const declaredDisclosure = opts.get('disclosure');
    if (declaredDisclosure !== undefined
        && !(DISCLOSURE_CLASSES as readonly string[]).includes(declaredDisclosure)) {
      return {
        code: 2,
        stdout: '',
        stderr: `--disclosure must be one of ${DISCLOSURE_CLASSES.join(', ')}, `
          + `got ${JSON.stringify(declaredDisclosure)}\n`,
      };
    }

    // Blank is "not supplied", the same rule every other scalar in this
    // command follows.
    const rawSubject = opts.get('subject');
    const subject = rawSubject !== undefined && rawSubject.trim() ? rawSubject.trim() : undefined;

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

    // A constraint that states no obligation cannot be one — the same class of
    // requirement `--kind` itself is for `record`. normalizeEntryData already
    // treats a blank `--statement` as not supplied (never stores `''`), so this
    // one check catches both "never passed" and "passed empty".
    if (kind === 'constraint' && !('statement' in data)) {
      return {
        code: 2,
        stdout: '',
        stderr: `--statement is required for --kind constraint; `
          + `a constraint that states no obligation cannot be one\n`,
      };
    }

    // Retraction edges, not kind fields — set after normalizeEntryData so a
    // `--supersedes`/`--invalidates` id is never mistaken for one of the kind's
    // own fields (or rejected by a kind that has neither). Blank is "not
    // supplied" here too, the same rule normalizeEntryData applies to every
    // kind field: a `--supersedes ""` must not assert a retraction that
    // `project()` — which requires non-blank after trim — would then deny.
    const edges: { field: 'supersedes' | 'invalidates'; value: string }[] = [];
    for (const field of ['supersedes', 'invalidates'] as const) {
      const raw = opts.get(field);
      const value = raw?.trim();
      if (value) {
        edges.push({ field, value });
        data[field] = value;
      }
    }

    // An entry cannot retract itself: written, acknowledged, and dead on
    // arrival — it would project `live: false` immediately, with nothing
    // pointing at the mistake.
    const selfEdge = edges.find((e) => e.value === id);
    if (selfEdge) {
      return {
        code: 2,
        stdout: '',
        stderr: `--${selfEdge.field} names this entry's own id (${JSON.stringify(id)}); `
          + `an entry cannot retract itself\n`,
      };
    }

    // Absent stays absent. Writing [] would claim "assessed, none found", which
    // is the exact conflation `coverage` reports null to avoid.
    if (anchors.length > 0) data.anchors = anchors;
    if (influences.length > 0) data.influences = influences;

    // A retraction edge, or a `journal` influence, may legitimately precede the
    // entry it names — across replicas the target can arrive later, so this is
    // never refused. But `invalidate` already warns a human when its target
    // does not match, and silently accepting the same typo here was the one
    // place this idiom broke.
    const journalRefs = influences
      .filter((inf): inf is Influence & { ref: string } => inf.type === 'journal' && !!inf.ref)
      .map((inf) => inf.ref);
    const referencedIds = [...new Set([...edges.map((e) => e.value), ...journalRefs])];
    let targetWarning = '';
    if (referencedIds.length > 0) {
      const { events: knownEvents } = await readAll(root, workspace);
      const knownIds = new Set(knownEvents.map((e) => e.id));
      targetWarning = referencedIds
        .filter((refId) => !knownIds.has(refId))
        .sort()
        .map((refId) => `WARNING: no entry with id ${refId} is present in this workspace\n`)
        .join('');
    }

    const event = normalizeEvent({
      schemaVersion: 1, id, source: `cli/${hostname()}/${session}/${agent}`, sourceEpoch: 'e1',
      time: nowStamp(), workspace, session, agent, author, provenance: 'cli',
      harness: env.AGENT_JOURNAL_HARNESS ?? 'other', context: opts.get('context') ?? 'coding',
      capabilities: capabilitiesWithAnchors(normalizeCapabilities({}), anchors),
      kind, data,
      disclosure: declaredDisclosure ?? 'team',
      ...(subject === undefined ? {} : { subject }),
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
    return { code: 0, stdout: `recorded ${id}\n`, stderr: kindWarning + targetWarning };
  }

  if (command === 'observe') {
    const kind = opts.get('kind');
    if (!kind) return { code: 2, stdout: '', stderr: `--kind is required\n${USAGE}` };

    // A void records a refused write and is produced by the failure path
    // itself. Letting a caller fabricate one would let a hook manufacture
    // evidence of its own silence, which is precisely backwards.
    if (kind === 'void') {
      return {
        code: 2, stdout: '',
        stderr: 'void observations are written by the refusal path itself, never by a caller\n',
      };
    }

    // An entry kind belongs to `record`, not here — routing it there rather
    // than writing it as a garbage observation.
    if (ENTRY_KINDS_SET.has(kind)) {
      return {
        code: 2, stdout: '',
        stderr: `${kind} is an entry kind — use \`agent-journal record\`\n`,
      };
    }

    // normalizeEvent does NOT validate `kind` — it is a free string all the
    // way to disk. Without this membership check, `observe --kind
    // constructor` (or any other unrecognised kind) writes a garbage event
    // and exits 0, and retention.ts then files it as `unclassified` forever.
    if (!(OBSERVATION_KINDS as readonly string[]).includes(kind)) {
      return {
        code: 2, stdout: '',
        stderr: `${JSON.stringify(kind)} is not an observation kind; one of `
          + `${OBSERVATION_KINDS.join(', ')}\n`,
      };
    }

    // The generic gate above only catches typos across every kind's fields.
    // This is the precise check: a field genuinely allowed on some OTHER
    // observation kind must still be refused here.
    const allowedForKind = new Set<string>([...OBSERVATION_GLOBAL, ...fieldsForObservation(kind)]);
    const wrong = [...opts.keys()].filter((k) => !allowedForKind.has(k)).sort();
    if (wrong.length > 0) {
      return {
        code: 2, stdout: '',
        stderr: `${wrong.map((f) => `--${f}`).join(', ')} `
          + `${wrong.length > 1 ? 'are' : 'is'} not a field of observation '${kind}'\n`,
      };
    }

    // `--seq` is optional: absent means the source declares no sequence,
    // which `mergeEvents` already handles. Observations are the only
    // high-volume writer here, and a gap in the sequence is how a dropped
    // hook becomes visible in `coverage`.
    let sequence: number | undefined;
    const rawSeq = opts.get('seq');
    if (rawSeq !== undefined) {
      if (!/^\d+$/.test(rawSeq)) {
        return {
          code: 2, stdout: '',
          stderr: `--seq must be a non-negative whole number, got ${JSON.stringify(rawSeq)}\n`,
        };
      }
      sequence = Number(rawSeq);
    }

    const session = env.AGENT_JOURNAL_SESSION ?? 'unknown';
    const agent = env.AGENT_JOURNAL_AGENT ?? 'primary';
    const event = normalizeEvent({
      schemaVersion: 1, id: opts.get('id') ?? randomUUID(),
      source: `hook/${hostname()}/${session}/${agent}`, sourceEpoch: 'e1',
      ...(sequence === undefined ? {} : { sequence }),
      time: nowStamp(), workspace, session, agent,
      // An observation is never authored by a human — that is what makes it
      // Plane A — and it takes the envelope's disclosure default rather than
      // a caller's stated intent: observations are machinery, not candour.
      author: 'agent', provenance: 'hook',
      harness: env.AGENT_JOURNAL_HARNESS ?? 'other',
      context: opts.get('context') ?? 'coding',
      kind,
      // `environment` self-populates from the process that is actually running
      // this CLI invocation. Explicit flags still win — spread order — so a
      // hook that knows better than the current process (a remote runner, a
      // container) can override what was captured here.
      data: kind === 'environment'
        ? { ...captureEnvironment(), ...normalizeObservationData(kind, all) }
        : normalizeObservationData(kind, all),
    });

    const journal = journalFor(root, workspace, session, agent);
    const result = await journal.append(event);
    if (!result.written) {
      // Persist the refusal, the same guarantee `record` makes — otherwise
      // this refusal never reaches coverage()'s `voids` count and the
      // silence it creates stays invisible.
      const trace = await journal.append(voidEvent({
        id: randomUUID(), source: event.source, sourceEpoch: event.sourceEpoch,
        time: nowStamp(), workspace, session, agent,
        harness: env.AGENT_JOURNAL_HARNESS ?? 'other',
        reason: `redaction ${result.verdict}`, provenance: 'hook', author: 'agent',
        ...(result.reason === undefined ? {} : { detail: result.reason }),
      }));
      return {
        code: 1, stdout: '',
        stderr: `refused: redaction ${result.verdict} — ${result.reason ?? 'no detail'}\n`
          + (trace.written ? '' : 'WARNING: the refusal itself could not be recorded\n'),
      };
    }
    return { code: 0, stdout: `observed ${event.id}\n`, stderr: '' };
  }

  if (command === 'invalidate') {
    const target = rest[0];
    const reason = opts.get('reason');
    if (!target || target.startsWith('--')) {
      return { code: 2, stdout: '', stderr: `an entry id is required\n${USAGE}` };
    }
    if (!reason) return { code: 2, stdout: '', stderr: `--reason is required\n${USAGE}` };

    // Same guard as record's: refuse an unrecognised value rather than let
    // normalizeDisclosure silently contain it. A retraction's --reason can be
    // as candid as an entry's rationale, so it needs the same escape to
    // `private` record has, validated the same way.
    const declaredDisclosure = opts.get('disclosure');
    if (declaredDisclosure !== undefined
        && !(DISCLOSURE_CLASSES as readonly string[]).includes(declaredDisclosure)) {
      return {
        code: 2,
        stdout: '',
        stderr: `--disclosure must be one of ${DISCLOSURE_CLASSES.join(', ')}, `
          + `got ${JSON.stringify(declaredDisclosure)}\n`,
      };
    }

    // No session: a human retracting from a bare shell (spec 5.8).
    const event = normalizeEvent({
      schemaVersion: 1, id: randomUUID(), source: `cli/${hostname()}/-/-`, sourceEpoch: 'e1',
      time: nowStamp(), workspace, session: '-', agent: '-', author: 'human', provenance: 'cli',
      harness: 'other', context: 'coding', kind: 'decision',
      data: { invalidates: target, rationale: reason },
      // The write-path default is `team`, per spec 13.3 — same distinction
      // record draws: an entry THIS CLI wrote is known to have meant the
      // default; only a foreign, unreadable record contains to `private`.
      disclosure: declaredDisclosure ?? 'team',
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

  if (command === 'show') {
    const { events, unreadable, malformed } = await readAll(root, workspace);
    const proj = project(events);
    const live = liveConstraints(events, nowStamp());
    const liveIds = new Set(proj.live.map((e) => e.id));
    // A constraint's own liveness needs more than "not superseded, not
    // invalidated" — it also needs a real statement and to not have expired.
    // liveConstraints() already applies all three; without this a constraint
    // whose --expiry has passed rendered `live: true` here while being absent
    // from `liveConstraints` below, two different meanings of "live" in one
    // payload.
    const liveConstraintIds = new Set(live.map((c) => c.id));
    const wanted = opts.get('id');

    // Same non-blank-after-trim predicate retract.ts's own `stringField` uses
    // to decide what counts as a retraction edge. `typeof === 'string'` alone
    // let `--supersedes ""` make `show` assert a retraction that `project()`
    // denies for being blank.
    const retractionTarget = (raw: unknown): string | undefined =>
      typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;

    const entries = events
      .filter((e) => e.kind !== 'void' && (wanted === undefined || e.id === wanted))
      .map((e) => {
        const anchors = Array.isArray(e.data.anchors) ? e.data.anchors : null;
        const influences = Array.isArray(e.data.influences) ? e.data.influences : null;

        // A retraction event (from `invalidate`, or `record --supersedes`) is a
        // real `decision`-kind entry on disk — hiding it would break the
        // append-only ethos. But surfacing it with no marker made it
        // indistinguishable from an ordinary live decision: `outcome: unknown`,
        // no anchors, counted toward "what is live" forever. `retracts` names
        // what it retracts so a reader (or the NEXT task's brief) can tell the
        // two apart. null, never [] or {}: the same rule as anchors/influences.
        //
        // An entry that carries BOTH edges names two different targets — this
        // is not retract.ts's "one target, which outcome wins" question, so a
        // single winner would hide one of two real edges. `retracts` is an
        // array for that reason, ordered invalidates-then-supersedes to match
        // retract.ts's own precedence, and is `null` — never `[]` — only when
        // the entry retracts nothing at all.
        const invalidatesTarget = retractionTarget(e.data.invalidates);
        const supersedesTarget = retractionTarget(e.data.supersedes);
        const retracts = invalidatesTarget === undefined && supersedesTarget === undefined
          ? null
          : [
              ...(invalidatesTarget === undefined ? [] : [{ type: 'invalidates' as const, target: invalidatesTarget }]),
              ...(supersedesTarget === undefined ? [] : [{ type: 'supersedes' as const, target: supersedesTarget }]),
            ];

        return {
          id: e.id, kind: e.kind, time: e.time, author: e.author,
          outcome: proj.outcomes.get(e.id) ?? 'unknown',
          live: e.kind === 'constraint' ? liveConstraintIds.has(e.id) : liveIds.has(e.id),
          // null, never []: an entry with no anchors has none recorded, which is
          // not the same claim as "assessed and found none".
          anchors, influences, retracts,
          constraintsBearingOn: constraintsBearingOn(e, live).map((c) => c.id),
        };
      });

    // Same guarantee as `coverage`: a journal that could not be fully read has
    // not earned exit 0. An all-clear built on a floor, not a total, is the
    // exact failure this command's honesty rule exists to prevent.
    const damaged = unreadable.length > 0 || malformed.length > 0;
    return {
      code: damaged ? 1 : 0,
      stdout: `${JSON.stringify({ entries, liveConstraints: live, unreadable, malformed }, null, 2)}\n`,
      stderr: damaged
        ? 'WARNING: this journal could not be fully read — the entries above are a floor, not a total.\n'
        : '',
    };
  }

  if (command === 'claims') {
    // Advisory only (spec 7.6): this reports what it can read and nothing
    // here blocks, waits, locks, or refuses on the result. `advisory: true`
    // is in the payload deliberately, so a consumer cannot mistake this for
    // a lock without having read the docs.
    const { events, unreadable, malformed } = await readAll(root, workspace);
    const claims = liveClaims(events, nowStamp());
    const damaged = unreadable.length > 0 || malformed.length > 0;
    return {
      code: damaged ? 1 : 0,
      stdout: `${JSON.stringify({ claims, advisory: true, unreadable, malformed }, null, 2)}\n`,
      stderr: damaged
        ? 'WARNING: this journal could not be fully read — the claims above are a floor.\n'
        : '',
    };
  }

  if (command === 'digest') {
    const level = opts.get('level');
    if (level !== undefined && !(DISCLOSURE_CLASSES as readonly string[]).includes(level)) {
      return {
        code: 2, stdout: '',
        stderr: `--level must be one of ${DISCLOSURE_CLASSES.join(', ')}, got ${JSON.stringify(level)}\n`,
      };
    }
    const out = opts.get('out');

    // §13.3, verbatim: "private never leaves the local journal — not to
    // sync, not to a hosted sink, not to a digest." Printing to stdout is
    // reading the local journal; writing a file is leaving it. Refused
    // before any read or render happens, before the segment-tree guard below
    // even runs.
    if (out && level === 'private') {
      return {
        code: 2, stdout: '',
        stderr: '--out is refused with --level private; private entries are not written to '
          + 'a file (spec 13.3) — omit --out and read the digest from stdout for local inspection\n',
      };
    }

    if (out) {
      // A digest written under ANY workspace's segment tree becomes journal
      // INPUT the next time THAT workspace is read: readAll() walks every
      // `*.jsonl` under a workspace's segments/, coverage/show/trace would
      // treat this command's own artifact as journal data, and a name that
      // happens to land on a `.jsonl` extension gets parsed as one — most
      // likely wedging that workspace's damaged-journal refusal permanently,
      // since the very next digest attempt reads its own prior output as
      // corruption. This is deliberately NOT scoped to the rendered
      // workspace alone: `--out` naming a DIFFERENT workspace's segment tree
      // (`--workspace ws --out <root>/workspaces/other/segments/p.jsonl`)
      // wedges that sibling just as permanently while this command still
      // exits 0 for the workspace it was actually asked about — narrowing
      // this check to only the rendered workspace's tree was itself a defect
      // in an earlier pass, on the mistaken reasoning that anything outside
      // it is "odd but harmless"; true of `<root>/digest.md`, false of a
      // sibling's segment tree. Both sides are resolved through the
      // filesystem, not compared as strings — a relative path, a `..`
      // traversal, or a symlink (dangling or not) pointing back into a
      // segment tree must not slip past what would otherwise be a naive
      // prefix check.
      const workspacesRoot = await canonicalize(join(root, 'workspaces'));
      const resolvedOut = await canonicalize(out);
      const rel = relative(workspacesRoot, resolvedOut);
      const insideWorkspaces = rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`);
      const candidateWorkspaceId = insideWorkspaces ? rel.split(sep)[0]! : undefined;
      const hitSegmentsDir = candidateWorkspaceId === undefined
        ? undefined
        : join(workspacesRoot, candidateWorkspaceId, 'segments');
      // Exact match (`--out` pointed AT the tree itself) and "strictly
      // inside" are kept as two separate conditions, never a single
      // `startsWith(hitSegmentsDir)` missing the separator — that would also
      // match a sibling that merely shares the `segments` PREFIX, e.g.
      // `<id>/segments-backup/d.md`, and falsely refuse a legitimate path.
      if (hitSegmentsDir !== undefined
          && (resolvedOut === hitSegmentsDir || resolvedOut.startsWith(hitSegmentsDir + sep))) {
        return {
          code: 2, stdout: '',
          stderr: `--out must not write inside a workspace's own segment tree `
            + `(${hitSegmentsDir}); a digest written there becomes journal input on the next read\n`,
        };
      }
    }
    const { events, unreadable, malformed } = await readAll(root, workspace);
    const damaged = unreadable.length > 0 || malformed.length > 0;
    if (damaged) {
      // Refuse rather than write a partial artifact. A digest is a rendered
      // document somebody commits and reviews; one written from a journal that
      // could not be fully read, warning or not, is the most misleading thing
      // this package can produce.
      return {
        code: 1, stdout: '',
        stderr: `refusing to render: ${unreadable.length} unreadable path(s), `
          + `${malformed.length} malformed line(s)\n`,
      };
    }
    const rendered = renderDigest(events, {
      coverage: coverage(events), now: nowStamp(),
      ...(level === undefined ? {} : { level: level as Disclosure }),
    });
    if (out) {
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, rendered, 'utf8');
      return { code: 0, stdout: `wrote ${out}\n`, stderr: '' };
    }
    return { code: 0, stdout: rendered, stderr: '' };
  }

  if (command === 'trace') {
    const key = rest[0];
    if (!key || key.startsWith('--')) {
      return { code: 2, stdout: '', stderr: `a key is required: trace <key> --workspace <id>\n` };
    }
    const { events, unreadable, malformed } = await readAll(root, workspace);
    const result = traceFrom(events, key);
    const damaged = unreadable.length > 0 || malformed.length > 0;
    return {
      code: damaged ? 1 : 0,
      stdout: `${JSON.stringify({ ...result, unreadable, malformed }, null, 2)}\n`,
      stderr: damaged
        ? 'WARNING: this journal could not be fully read — the result is a floor, not a total.\n'
        : result.matched.length === 0
          ? `no entry is indexed under ${JSON.stringify(key)} in this workspace\n`
          : '',
    };
  }

  return { code: 2, stdout: '', stderr: `unknown command: ${command}\n${USAGE}` };
}
