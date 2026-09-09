import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { readdir, readFile, mkdir, writeFile, stat, rename, rm } from 'node:fs/promises';
import { join, dirname, sep, relative } from 'node:path';
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
import { TOMBSTONE_KIND, tombstonesIn, suppressedIds, tombstonesActuallyPurged } from './tombstone.ts';
import { applyRetention } from './retention.ts';
import { liveConstraints, constraintsBearingOn } from './constraints.ts';
import { liveClaims } from './claims.ts';
import { renderDigest } from './digest.ts';
import { traceFrom } from './trace.ts';
import { canonicalize } from './paths.ts';
import { computeDecay, codebaseRefs, type CurrentEnvironment } from './decay.ts';
import { resolveCodebaseRefs } from './codebase.ts';
import { redact } from './redact.ts';

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

/**
 * The observation twin of `kindUsageLine`, and it exists because this line
 * used to print `Object.keys(OBSERVATION_FIELDS)` — the KIND names — under
 * the label "…plus the fields for `<kind>`". `agent-journal help` therefore
 * named not one observation field: `--checkout`, `--ttlSeconds`, `--tool`,
 * `--callId` and the rest were undiscoverable from the CLI's own help, one
 * line below `record` doing it correctly. `observe --kind path_claim` with no
 * fields still exits 0, and `claims` then reports nothing, which is exactly
 * the shape of failure this project keeps paying for.
 *
 * `void` is excluded: `observe` refuses it outright (the refusal path writes
 * voids, never a caller), so listing it here would advertise a command that
 * cannot work. A kind with no fields says so rather than trailing an empty
 * space.
 */
function observationUsageLine(kind: string): string {
  const flags = fieldsForObservation(kind).map((field) => `--${field}`);
  return `    ${kind}: ${flags.join(' ') || '(no fields)'}`;
}

const OBSERVABLE_KINDS = Object.keys(OBSERVATION_FIELDS).filter((k) => k !== 'void');

const USAGE = [
  'usage:',
  '  agent-journal record --kind <kind> --workspace <id> [--id id] [--author agent|human]',
  '                       [--context c] [--supersedes id] [--invalidates id]',
  '                       [--anchor <class>:<ref>]… [--influence <type>:<role>[:<ref>]]…',
  '                       [--disclosure private|team|published] [--subject s]',
  '                       ...plus the fields for <kind>:',
  ...Object.keys(KIND_FIELDS).map(kindUsageLine),
  '  agent-journal observe --kind <kind> --workspace <id> [--id id] [--context c] [--seq n]',
  '                        [--subject s]',
  '                        ...plus the fields for <kind>:',
  ...OBSERVABLE_KINDS.map(observationUsageLine),
  '    (environment self-populates from the running process; an explicit flag wins)',
  '  agent-journal invalidate <entry-id> --reason <why> --workspace <id> [--disclosure private|team|published]',
  '  agent-journal tombstone <target-id> --reason <why> --workspace <id>',
  '    (records that the target must not exist; purges nothing — see `compact`)',
  '  agent-journal compact --workspace <id> [--entry-ttl-days <n>] [--observation-ttl-days <n>] [--apply]',
  '    (the only command that destroys data; a dry run unless --apply is given;',
  '     refuses outright on a damaged journal; never removes a tombstone event itself)',
  '  agent-journal coverage --workspace <id>',
  '  agent-journal show --workspace <id> [--id <entry-id>]',
  '  agent-journal claims --workspace <id>  (advisory only — reports, never blocks)',
  '  agent-journal digest --workspace <id> [--level private|team|published] [--out <path>]',
  '  agent-journal trace <key> --workspace <id>',
  '  agent-journal decay --workspace <id> [--repo <path>]',
  '    (--repo is required before any codebase influence is resolved; omitted, those',
  '     findings are not-checkable rather than guessed at)',
  '  agent-journal help',
  '',
].join('\n');

interface ParsedFlags {
  readonly opts: Map<string, string>;
  /** Every value seen for a flag, in order. Repeatable flags read this. */
  readonly all: Map<string, string[]>;
  /** Bare `--flag` with nothing after it. A declared boolean may accept this. */
  readonly valueless: readonly string[];
  /** `--flag=` — an explicit, EMPTY value. Never a boolean's presence: this is
   *  what an unset variable in `--apply=$FLAG` collapses to. */
  readonly explicitEmpty: readonly string[];
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
  const explicitEmpty: string[] = [];
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
      // `--flag=` is NOT the same as a bare `--flag`, and collapsing them was
      // exploitable on the one destructive flag in the CLI: `--apply=` reached
      // the boolean carve-out as "present" and enabled deletion. That is the
      // `--workspace $UNSET` failure this file already guards against, wearing
      // a different shape — `--apply=$FLAG` with `$FLAG` unset expands to a
      // single token that lands here rather than in the bare-flag branch.
      // Tracked separately so a boolean can refuse it while a bare flag stands.
      if (value === '') explicitEmpty.push(name);
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
  return { opts, all, valueless, explicitEmpty };
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
 *
 * `subject` is here for a sharper reason than symmetry with `record`. Without
 * it the citing loop the observation plane exists for was unreachable:
 * `indexEntries` (trace.ts) indexes `e.subject` over EVERY non-void event, so
 * an observation with no subject is findable only by an id nothing prints —
 * `trace Bash` returned empty, and `show` rendered no `data`, so two
 * `tool_call` observations were indistinguishable. An agent could cite an
 * observation it already knew the uuid of, and had no documented way to learn
 * one. See references/adapters.md, "Citing an observation".
 */
const OBSERVATION_GLOBAL = ['workspace', 'kind', 'id', 'context', 'seq', 'subject'] as const;

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
  // `unknownFlags()` returns `[]` for any command with no entry here at all --
  // this registration is what makes flag checking exist for `decay` in the
  // first place, not merely what shapes it.
  decay: ['workspace', 'repo'],
  tombstone: ['workspace', 'reason'],
  compact: ['workspace', 'apply', 'entry-ttl-days', 'observation-ttl-days'],
};

function unknownFlags(command: string, opts: Map<string, string>): string[] {
  const allowed = ALLOWED_FLAGS[command];
  if (!allowed) return [];
  const known = new Set<string>(allowed);
  return [...opts.keys()].filter((k) => !known.has(k)).sort();
}

/**
 * Flags that are genuine booleans: presence alone is the whole value.
 * `compact --apply` is the first of these in this CLI — every other flag
 * keeps the rule above it (a missing value is an error, never a default),
 * because a boolean silently invented from an unset environment variable is
 * exactly what broke `--workspace $WS` before that rule existed. Scoped per
 * command so declaring `apply` boolean for `compact` grants no other command
 * the same latitude.
 */
const BOOLEAN_FLAGS: Readonly<Record<string, readonly string[]>> = {
  compact: ['apply'],
};

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


/**
 * Rewrite one segment with purged events removed, without destroying anything a
 * concurrently running session appends while we work.
 *
 * The naive read -> filter -> writeFile lost data, measurably: with a writer
 * appending every 100ms during a compaction of a large segment, 23 of 70
 * appended events were overwritten out of existence, exit 0, nothing warned.
 * Appends are the one thing §7.1 promises need no coordination, and the active
 * segment is exactly the file a purge must rewrite, because it holds the target.
 *
 * Three defences, in order of what they fix:
 *
 *  1. `stat` before and after building the output. A segment only ever grows,
 *     so a changed size or mtime means an append landed. Retry; after
 *     MAX_ATTEMPTS, SKIP the file and report it. A skipped file loses nothing —
 *     the purge simply has not happened yet, and the next run gets it.
 *  2. Write a temp file and `rename` it. `writeFile` truncates in place, so a
 *     crash mid-write left a truncated segment. `rename` is atomic.
 *  3. Keep every retained line's ORIGINAL bytes. Re-serialising from the parsed
 *     event silently dropped unknown top-level fields — a field this version
 *     does not know about, written by a newer or foreign replica, vanished from
 *     lines that were never targeted.
 *
 * A window remains between the final `stat` and the `rename`. It cannot be
 * closed without a lock, which §7.1 rules out; it is microseconds against the
 * seconds the old window spanned, and a skip is reported rather than silent.
 */
const MAX_PURGE_ATTEMPTS = 3;

async function purgeOneSegment(
  full: string,
  purgeIds: ReadonlySet<string>,
  flipTombstoneIds: ReadonlySet<string>,
  forceSkip: string | undefined,
): Promise<{
  outcome: 'unchanged' | 'rewritten' | 'skipped';
  /** Ids whose bytes this call actually deleted. */
  removed: string[];
  /** Ids this file HELD and was asked to act on, but did not, because it was
   *  skipped. Reporting these is what stops `purged` running ahead of the bytes
   *  when the same id lives in two segments and only one is rewritten. */
  unapplied: string[];
}> {
  let lastSeen: string[] = [];
  for (let attempt = 0; attempt < MAX_PURGE_ATTEMPTS; attempt += 1) {
    // Test-only seam. The skip path exists for a race — a session appending
    // while compaction runs — and a race cannot be staged deterministically, so
    // without this the two-phase wiring in the `compact` branch has no test at
    // all: rewiring it back to a single pass left the whole suite green while
    // `purged: true` was written for bytes still on disk. Three separate
    // defects have come out of this call site; an env var nothing in normal
    // operation sets is a cheap price for being able to test it.
    if (forceSkip && full.includes(forceSkip)) {
      const { events: held } = parseSegment(await readFile(full, 'utf8'));
      return {
        outcome: 'skipped',
        removed: [],
        unapplied: held
          .filter((e) => purgeIds.has(e.id) || flipTombstoneIds.has(e.id))
          .map((e) => e.id),
      };
    }
    const before = await stat(full);
    const text = await readFile(full, 'utf8');

    let changed = false;
    const removed: string[] = [];
    const seen: string[] = [];
    lastSeen = seen;
    const lines: string[] = [];
    for (const raw of text.split('\n')) {
      if (!raw.trim()) continue;
      let parsed: { id?: unknown; kind?: unknown; data?: unknown };
      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch {
        // Unreadable to us is not the same as unwanted. On the one path in this
        // package that destroys data, a line we cannot parse is kept.
        lines.push(raw);
        continue;
      }
      const id = typeof parsed.id === 'string' ? parsed.id : undefined;
      if (id !== undefined && purgeIds.has(id)) { changed = true; removed.push(id); seen.push(id); continue; }
      if (id !== undefined && parsed.kind === TOMBSTONE_KIND && flipTombstoneIds.has(id)) {
        const data = (parsed.data ?? {}) as Record<string, unknown>;
        lines.push(JSON.stringify({ ...parsed, data: { ...data, purged: true } }));
        changed = true;
        seen.push(id);
        continue;
      }
      lines.push(raw); // original bytes, unknown fields and all
    }
    if (!changed) return { outcome: 'unchanged', removed: [], unapplied: [] };

    const after = await stat(full);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) continue;

    const tmp = `${full}.compact-${process.pid}-${Date.now()}.tmp`;
    // finally, not just the growth branch: a failing `rename` (an immutable
    // file, a full disk) left a full-size orphan copy beside every segment,
    // and nothing in this package ever reaps them.
    let renamed = false;
    try {
      await writeFile(tmp, lines.length > 0 ? `${lines.join('\n')}\n` : '', 'utf8');
      const finalCheck = await stat(full);
      if (finalCheck.size !== before.size || finalCheck.mtimeMs !== before.mtimeMs) continue;
      await rename(tmp, full);
      renamed = true;
    } finally {
      if (!renamed) await rm(tmp, { force: true });
    }
    return { outcome: 'rewritten', removed, unapplied: [] };
  }
  // Skipped: report what this file HELD, so a caller cannot conclude an id was
  // dealt with because some other segment happened to hold a copy of it.
  return { outcome: 'skipped', removed: [], unapplied: lastSeen };
}

/**
 * The only place this package writes to a segment file after its initial
 * append. Everything else in `cli.ts` only ever appends (`SegmentJournal`) or
 * reads (`readAll`); this rewrites files in place, which is why `compact` is
 * gated so hard above it.
 *
 * `purgeIds` are ids to drop entirely (§13.2's purge, plus TTL expiry) —
 * dropped from every segment file that physically holds them, not just the
 * one `mergeEvents` would have credited as the "real" copy of a duplicate id,
 * because the goal is the bytes gone, wherever they are.
 *
 * `flipTombstoneIds` are the ids of tombstone EVENTS (not their targets)
 * whose `data.purged` must become `true` — computed by the caller from
 * `tombstonesIn(events)` filtered to `purgeIds.has(target)`, so this
 * function never has to re-decide which targets are being purged.
 *
 * A file with nothing to change is left untouched — no read-then-write-back
 * of identical content, and the one guarantee `compact` without `--apply`
 * needs (byte-identical segments) falls out for free, since the dry-run path
 * never calls this at all.
 */
async function purgeSegments(
  root: string,
  workspace: string,
  purgeIds: ReadonlySet<string>,
  flipTombstoneIds: ReadonlySet<string>,
  forceSkip: string | undefined,
): Promise<{ skipped: string[]; removed: Set<string>; unapplied: Set<string> }> {
  const skipped: string[] = [];
  const removed = new Set<string>();
  const unapplied = new Set<string>();
  const base = join(root, 'workspaces', workspace, 'segments');

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { await walk(full); continue; }
      if (!e.name.endsWith('.jsonl')) continue;

      const r = await purgeOneSegment(full, purgeIds, flipTombstoneIds, forceSkip);
      if (r.outcome === 'skipped') skipped.push(full);
      for (const id of r.removed) removed.add(id);
      for (const id of r.unapplied) unapplied.add(id);
    }
  }

  await walk(base);
  return { skipped, removed, unapplied };
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

  const { opts, all, valueless, explicitEmpty } = flags(rest);
  const root = env.AGENT_JOURNAL_ROOT ?? join(env.HOME ?? '.', '.agents', 'journal');

  // Every flag is an error without a value, EXCEPT a flag this command has
  // explicitly declared boolean in BOOLEAN_FLAGS — `compact --apply` today,
  // and nothing else. Filtered here, before the generic guard fires, so
  // `--apply`'s presence-is-the-value shape does not need its own copy of
  // this whole check.
  const declaredBoolean = new Set<string>(BOOLEAN_FLAGS[command] ?? []);
  // `--flag=` is refused for EVERY flag, boolean included. A declared boolean
  // exempts the bare `--flag` form only. Without this split, `--apply=` — which
  // is what `--apply=$FLAG` becomes when the variable is unset — read as the
  // flag being present and silently enabled the one destructive operation here.
  const genuinelyValueless = [
    ...valueless.filter((f) => !declaredBoolean.has(f)),
    ...explicitEmpty,
  ];
  if (genuinelyValueless.length > 0) {
    const which = genuinelyValueless.map((f) => `--${f}`).join(', ');
    return {
      code: 2,
      stdout: '',
      stderr: `flag${genuinelyValueless.length > 1 ? 's' : ''} given no value: ${which}\n${USAGE}`,
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
        // OBSERVABLE_KINDS, not OBSERVATION_KINDS: `void` is refused ten lines
        // above, so offering it here sends the caller straight back into that
        // refusal. USAGE already got this right.
        stderr: `${JSON.stringify(kind)} is not an observation kind; one of `
          + `${OBSERVABLE_KINDS.join(', ')}\n`,
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

    // Same blank-is-absent rule `record` applies to its own --subject: `''`
    // would claim a subject was assessed and found empty, which is not what
    // an unset shell variable means.
    const rawSubject = opts.get('subject');
    const subject = rawSubject !== undefined && rawSubject.trim() ? rawSubject.trim() : undefined;

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
      // What this observation is ABOUT — a tool name, an agent id — which is
      // what makes it findable by `trace` rather than only by a uuid nobody
      // has. Absent stays absent: an observation with nothing worth naming
      // carries no subject rather than a placeholder.
      ...(subject === undefined ? {} : { subject }),
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

  if (command === 'tombstone') {
    const target = rest[0];
    if (!target || target.startsWith('--')) {
      return { code: 2, stdout: '', stderr: `a target id is required\n${USAGE}` };
    }

    // Non-blank after trim, the same rule tombstonesIn() itself enforces at
    // read time. Accepting a blank reason here would record something that
    // reads back as no tombstone at all — recorded, acknowledged, and inert.
    const reason = opts.get('reason')?.trim();
    if (!reason) {
      return { code: 2, stdout: '', stderr: `--reason is required, and must be non-blank\n${USAGE}` };
    }

    // No session, author human, same as `invalidate` (spec 5.8) — §13.2 says
    // a tombstone records that A HUMAN decided the content must not exist.
    // `purged: false` is written explicitly: recording the intent and
    // destroying the bytes are two separate acts, and this event predates
    // the second one entirely — `compact` is the only thing that can ever
    // flip this to true.
    const event = normalizeEvent({
      schemaVersion: 1, id: randomUUID(), source: `cli/${hostname()}/-/-`, sourceEpoch: 'e1',
      time: nowStamp(), workspace, session: '-', agent: '-', author: 'human', provenance: 'cli',
      harness: 'other', context: 'coding', kind: TOMBSTONE_KIND,
      data: { target, reason, purged: false },
    });

    const journal = journalFor(root, workspace, '-', '-');
    const result = await journal.append(event);
    if (!result.written) {
      // The same guarantee `invalidate` makes: a refusal that vanishes at
      // exit 1 alone never reaches coverage()'s voids, and the silence a
      // refused write creates is exactly what voidEvent exists to prevent.
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

    // Append-only, same as `invalidate`: a tombstone may legitimately precede
    // the entry it names (another replica writes the target later), so an
    // unknown target is not an error — but a human correcting a typo deserves
    // to hear that nothing matched.
    const known = (await readAll(root, workspace)).events.some((e) => e.id === target);
    return {
      code: 0,
      stdout: `tombstoned ${target}\n`,
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
    // `project()` and `liveConstraints()` run over the FULL read, same as
    // retention.ts's own `project(events)` call — a retraction edge carried
    // by a since-tombstoned event still resolves. Only the RENDERED list is
    // narrowed, below.
    const proj = project(events);
    const live = liveConstraints(events, nowStamp());
    const hidden = suppressedIds(events);
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
      // A tombstoned id stops rendering here even though its bytes are still
      // on disk — `compact` is the only thing that removes them. Rendering
      // it anyway until then would make the tombstone event itself pointless.
      .filter((e) => e.kind !== 'void' && !hidden.has(e.id) && (wanted === undefined || e.id === wanted))
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
          // Which PLANE this came from, and the only field that says so. `author`
          // does not: `observe` writes `author: 'agent'` too, so a hook-captured
          // observation and an agent-authored entry are indistinguishable without
          // this. Verifying "did a hook actually fire" is exactly the question
          // adapters.md sends a reader to `show` to answer, and it could not be
          // answered from this payload.
          provenance: e.provenance,
          // What the event is about, and what it carries. Both were missing,
          // and their absence broke the citing loop the observation plane
          // exists for: id/kind/time/outcome/live renders two `tool_call`
          // observations identically, so `show` could not tell a reader WHICH
          // id to put in an `--anchor`. Only reading raw JSONL could, which
          // is not a documented command. `subject` is null — never '' — when
          // the event names none; `data` renders whatever the event actually
          // carries, which for an observation is its whole content.
          subject: e.subject ?? null,
          data: e.data,
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

    // Hoisted out of the guard block below so the WRITE can use the very path
    // the guard vetted, rather than re-deriving it from `out` afterwards.
    let resolvedOut: string | undefined;
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
      resolvedOut = await canonicalize(out);
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
    // Coverage still reports over the FULL journal — a tombstoned event was
    // still recorded, and still contributes real signal to sessions/voids/
    // sequence gaps. Only the RENDERED entries below are narrowed: a
    // tombstoned entry stops appearing in the committed document, exactly
    // like it stops appearing in `show`.
    const hidden = suppressedIds(events);
    const visible = events.filter((e) => !hidden.has(e.id));
    const rendered = renderDigest(visible, {
      coverage: coverage(events), now: nowStamp(),
      ...(level === undefined ? {} : { level: level as Disclosure }),
    });
    if (out) {
      // Write the path the guards above actually vetted, not `out`, which they
      // vetted only by proxy. Anything changing in between — a symlink swapped
      // in after canonicalize returned — would be followed by a write to `out`
      // and land outside the tree the guard just proved it was inside. Writing
      // the resolved path closes that window: the bytes go where the check
      // looked.
      if (resolvedOut === undefined) {
        // Unreachable: the guard block above runs under this same `if (out)`.
        // Refusing beats falling back to `out`, which would write a path
        // nothing vetted — the exact hole this hoist exists to close.
        return { code: 1, stdout: '', stderr: 'internal: --out was not vetted before write\n' };
      }
      await mkdir(dirname(resolvedOut), { recursive: true });
      await writeFile(resolvedOut, rendered, 'utf8');
      // ...but report `out`, the path the caller typed. `resolvedOut` may name
      // a location they never mentioned, and telling somebody you wrote
      // somewhere they did not ask for is its own small betrayal.
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
    // Same narrowing as `show`/`digest`: a tombstoned id stops being
    // findable, and stops being a step a chain can walk through — traceFrom
    // already tolerates a dangling edge gracefully, which is exactly what a
    // link pointing at a now-hidden id becomes.
    const hidden = suppressedIds(events);
    const visible = events.filter((e) => !hidden.has(e.id));
    const result = traceFrom(visible, key);
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

  if (command === 'decay') {
    // Defaults to nothing, never to `process.cwd()`: silently scanning
    // whatever directory the caller happens to be standing in is a surprise,
    // and `not-checkable` (computeDecay's behaviour with no `codebase` map
    // at all) is the honest default for a codebase influence when no repo
    // was named.
    const repo = opts.get('repo');
    const { events, unreadable, malformed } = await readAll(root, workspace);

    const codebase = repo
      ? await resolveCodebaseRefs(codebaseRefs(events), repo)
      : undefined;

    // Captured here, at the CLI boundary, and injected -- computeDecay stays
    // pure and never touches `process` itself. Every OTHER value this CLI
    // ever prints was written through `journal.append` first, which redacts
    // on write (spec 4.3: an interpreter path is machine-identifying). A
    // captured-live "now" is deliberately never persisted -- computeDecay
    // only ever compares it, so it never passes through that gate -- which
    // makes this the one spot a raw, unredacted path could reach stdout
    // straight from `process`, on the exact field 4.3 already requires
    // masked for a STORED environment observation. Redacted explicitly here
    // for that reason. A `failed` verdict (the tiny capture object exceeding
    // the scan budget, in practice never) omits `now` rather than risk
    // printing it unscrubbed -- `not-checkable` is the same honest fallback
    // `computeDecay` already uses when nothing was supplied at all.
    const redactedNow = redact(captureEnvironment());
    const report = computeDecay(events, {
      ...(codebase === undefined ? {} : { codebase }),
      ...(redactedNow.verdict === 'failed' ? {} : { now: redactedNow.value as CurrentEnvironment }),
    });

    // Same guarantee `claims`/`show` make, for the same reason: a journal
    // that could not be fully read has not earned exit 0, and its floor of
    // findings must never be mistaken for a total. This is deliberately
    // NOT how a `failing` finding is treated -- §10.1 is explicit that decay
    // is reported, never judged, so no finding's status ever changes this
    // exit code. Only damage to the JOURNAL does.
    const damaged = unreadable.length > 0 || malformed.length > 0;
    return {
      code: damaged ? 1 : 0,
      stdout: `${JSON.stringify({ ...report, unreadable, malformed }, null, 2)}\n`,
      stderr: damaged
        ? 'WARNING: this journal could not be fully read — the findings above are a floor, not a total.\n'
        : '',
    };
  }

  if (command === 'compact') {
    // `--apply` is the one boolean flag this CLI has (BOOLEAN_FLAGS above),
    // which only means the guard above stopped treating its bare presence as
    // an error. It still must not silently accept a VALUE — `--apply true`
    // or `--apply=maybe` is refused outright rather than guessed at, the same
    // "refuse rather than contain" instinct every other flag in this file
    // follows.
    if (opts.has('apply')) {
      return {
        code: 2, stdout: '',
        stderr: `--apply takes no value; pass it as a bare flag\n${USAGE}`,
      };
    }
    const apply = valueless.includes('apply');

    const parseTtlDays = (flag: string): number | undefined | { error: string } => {
      const raw = opts.get(flag);
      if (raw === undefined) return undefined;
      if (!/^\d+$/.test(raw)) {
        return { error: `--${flag} must be a non-negative whole number, got ${JSON.stringify(raw)}` };
      }
      return Number(raw);
    };
    const entryTtlDaysRaw = parseTtlDays('entry-ttl-days');
    if (entryTtlDaysRaw !== undefined && typeof entryTtlDaysRaw === 'object') {
      return { code: 2, stdout: '', stderr: `${entryTtlDaysRaw.error}\n` };
    }
    const observationTtlDaysRaw = parseTtlDays('observation-ttl-days');
    if (observationTtlDaysRaw !== undefined && typeof observationTtlDaysRaw === 'object') {
      return { code: 2, stdout: '', stderr: `${observationTtlDaysRaw.error}\n` };
    }
    const entryTtlDays = entryTtlDaysRaw as number | undefined;
    const observationTtlDays = observationTtlDaysRaw as number | undefined;

    // §17.2 leaves the window undecided, same as applyRetention's own two
    // required options — no default here would hide a decision nobody has
    // made. But compact's flags are OPTIONAL, unlike applyRetention's, so
    // "not supplied" must still mean something: NEVER expire under that axis,
    // not "expire everything". A sentinel this large as an entryCutoff sits
    // deep in negative time, so `Date.parse(e.time) < cutoff` is false for
    // every real event — while staying finite, which applyRetention requires
    // (Infinity is refused there).
    const DAY_MS = 86400000;
    const NEVER_MS = Number.MAX_SAFE_INTEGER;
    const entryTtlMs = entryTtlDays === undefined ? NEVER_MS : entryTtlDays * DAY_MS;
    const observationTtlMs = observationTtlDays === undefined ? NEVER_MS : observationTtlDays * DAY_MS;

    // Refuse on a damaged journal BEFORE doing anything else -- the most
    // important guard in this command. A segment that failed to parse might
    // hold the very tombstone protecting something, or the content a
    // tombstone names; compacting on an incomplete read could destroy
    // content whose tombstone status this read never saw. Nothing below this
    // point may run first.
    const { events, unreadable, malformed } = await readAll(root, workspace);
    const damaged = unreadable.length > 0 || malformed.length > 0;
    if (damaged) {
      return {
        code: 1, stdout: '',
        stderr: `refusing to compact: ${unreadable.length} unreadable path(s), `
          + `${malformed.length} malformed line(s) -- compacting a partial view could `
          + `destroy content whose tombstone status was never seen\n`,
      };
    }

    // `compact` is applyRetention's first real caller (Task 2 built it as a
    // pure library function with no caller in this file). Both TTLs are
    // ALWAYS passed, never a caller-supplied `tombstoned` list -- suppression
    // is derived from the journal itself, same as everywhere else this reads.
    const result = applyRetention(events, { now: nowStamp(), entryTtlMs, observationTtlMs });
    const byId = new Map(events.map((e) => [e.id, e] as const));

    // What gets purged is what applyRetention declined to keep: expired
    // entries and observations, and tombstoned targets.
    //
    // Belt and braces on the one irreversible path in this package. retention
    // now guarantees a tombstone reaches neither list — but the previous
    // version's comment here asserted that same guarantee while it was false,
    // and the gap between the claim and the code is what let a tombstone be
    // purged. A second, local check costs nothing and does not rely on another
    // module keeping a promise.
    const purgeIds = new Set<string>(
      [...result.expired, ...result.tombstoned]
        .filter((id) => byId.get(id)?.kind !== TOMBSTONE_KIND),
    );

    // Which tombstone EVENTS need `purged` flipped true: exactly the
    // well-formed tombstones (tombstonesIn, not a bare kind check) whose
    // target is about to be purged this run. A tombstone whose target was
    // already purged in an earlier run keeps its (already-true) `purged`
    // untouched here -- its target is simply absent from `events` by now, so
    // it never enters `purgeIds` again.
    const tombstonesToFlip = tombstonesIn(events).filter((t) => purgeIds.has(t.target));

    const report = {
      apply,
      entryTtlDays: entryTtlDays ?? null,
      observationTtlDays: observationTtlDays ?? null,
      expired: result.expired,
      tombstoned: result.tombstoned,
      pinned: result.pinned,
      downgraded: result.downgraded,
      unclassified: result.unclassified,
      // The ids of the TOMBSTONE EVENTS whose `purged` flag is (--apply) or
      // would be (dry run) flipped true -- not the ids of their targets.
      // Dry run: what WOULD be flipped. --apply: replaced below with what
      // actually was, since a skipped segment can leave a planned flip undone.
      tombstonesMarkedPurged: tombstonesToFlip.map((t) => t.id),
    };

    if (apply) {
      // Two phases, because `purged` is the field somebody reads to answer
      // "was the leaked credential actually erased?" — and a one-pass flip
      // wrote `purged: true` for a target that had NOT been erased.
      //
      // The flag was set per-segment from the PLANNED purge set, so when the
      // target lived in a busy segment that got skipped and its tombstone lived
      // in a quiet one, the tombstone was stamped purged while the bytes stayed
      // on disk — contradicting this package's own documented guarantee that
      // compact flips it "only once it has actually removed the bytes".
      //
      // Phase 1 removes and reports what it really removed. Phase 2 flips only
      // those. A tombstone whose target survived a skip keeps `purged: false`
      // and is flipped by the next run, which is the truthful answer.
      const forceSkip = env.AGENT_JOURNAL_FORCE_SKIP;
      const purgePass = await purgeSegments(root, workspace, purgeIds, new Set(), forceSkip);
      const skippedPaths = purgePass.skipped;
      const actuallyFlipped = tombstonesActuallyPurged(
        tombstonesToFlip, purgePass.removed, purgePass.unapplied,
      );
      // Phase two flips. What it was ASKED to flip is not what it DID: its own
      // segments can be skipped too, and reporting the request as the result
      // was the same lie one level up — the report claimed a flip that never
      // happened, while the bytes were already gone.
      let flipped = actuallyFlipped;
      if (actuallyFlipped.length > 0) {
        const flipPass = await purgeSegments(
          root, workspace, new Set(), new Set(actuallyFlipped.map((t) => t.id)), forceSkip,
        );
        // Deduped: phase two walks the same tree, so a segment skipped in
        // phase one is skipped again and was being listed twice — with stderr
        // then reporting "2 segment(s)" for one file, in a count the docs tell
        // a reader to act on.
        for (const path of flipPass.skipped) {
          if (!skippedPaths.includes(path)) skippedPaths.push(path);
        }
        if (flipPass.unapplied.size > 0) {
          flipped = actuallyFlipped.filter((t) => !flipPass.unapplied.has(t.id));
        }
      }
      const truthfulReport = { ...report, tombstonesMarkedPurged: flipped.map((t) => t.id) };
      if (skippedPaths.length > 0) {
        // Not a failure: nothing was lost, the purge simply did not happen for
        // these files because a session kept appending to them. Saying so is
        // the whole point — a silent skip on a deletion the caller asked for
        // would leave them believing content is gone when it is not.
        return {
          code: 1,
          stdout: `${JSON.stringify({ ...truthfulReport, skipped: skippedPaths }, null, 2)}\n`,
          stderr: `${skippedPaths.length} segment(s) were being written during compaction `
            + `and were left untouched; re-run when writers are idle\n`,
        };
      }
      // Nothing skipped: planned and actual coincide. Returned from the
      // truthful object anyway, so the two can never drift apart silently.
      return { code: 0, stdout: `${JSON.stringify(truthfulReport, null, 2)}\n`, stderr: '' };
    }

    return { code: 0, stdout: `${JSON.stringify(report, null, 2)}\n`, stderr: '' };
  }

  return { code: 2, stdout: '', stderr: `unknown command: ${command}\n${USAGE}` };
}
