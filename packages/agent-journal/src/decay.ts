import type { JournalEvent } from './envelope.ts';
import { project } from './retract.ts';
import { INFLUENCE_TYPES, type InfluenceType } from './entry.ts';
import type { Environment } from './environment.ts';

/**
 * Five statuses that must never collapse into each other:
 *  - `passing`        — checked, and the source still holds.
 *  - `failing`        — checked, and the source no longer holds.
 *  - `drifted`        — checked, and it differs, but the difference is not a
 *                        verdict: an `environment` anchor whose interpreter or
 *                        version no longer matches the one running now. A
 *                        moved SOURCE is broken (`failing`); a moved
 *                        ENVIRONMENT may simply be a different machine, and
 *                        collapsing the two would train people to ignore the
 *                        flag (§10.1's own reasoning for exempting living
 *                        sources from hash rot, applied here to a machine).
 *  - `not-checkable`  — nothing could ever check this (a property of the
 *                        source: a person, a model's own knowledge, a
 *                        conversation transcript this journal does not keep).
 *  - `not-implemented`— a checker could exist but this release doesn't have
 *                        one yet (a property of this release, not the source).
 * "We could not check this" and "we checked and it is fine" are exactly the
 * distinction this design exists to preserve. A `person` influence must never
 * report as `passing`.
 */
export type DecayStatus = 'passing' | 'failing' | 'drifted' | 'not-checkable' | 'not-implemented';

export interface DecayFinding {
  readonly entryId: string;
  /** An `InfluenceType`, or the literal `'environment'` for the one anchor
   *  class this checker looks at — see `checkEnvironmentAnchor`. */
  readonly type: InfluenceType | 'environment';
  readonly ref: string | null;
  readonly status: DecayStatus;
  readonly detail: string;
}

export interface DecayReport {
  readonly findings: DecayFinding[];
  readonly checked: number;
  readonly notCheckable: number;
  readonly notImplemented: number;
  /** Separate from `checked`: a drifted finding was evaluated, but its
   *  outcome is a flag for a human, not a pass/fail verdict — see
   *  `DecayStatus`. Keeping it out of `checked` is what "coherent counts"
   *  means here; folding it in would silently redefine what `checked` means. */
  readonly drifted: number;
}

/** What `computeDecay` needs to know about "now" to check environment drift.
 *  Deliberately narrower than the full `Environment` shape `captureEnvironment`
 *  returns — `platform`, `packageManager` and `flags` are not compared, so a
 *  caller (or a test) supplying only these two fields is not a lie. A full
 *  `Environment` satisfies this structurally, so `captureEnvironment()` is
 *  passed straight through with no adapting. */
export type CurrentEnvironment = Pick<Environment, 'interpreter' | 'version'>;

export interface ComputeDecayOptions {
  readonly codebase?: ReadonlyMap<string, boolean>;
  /** The environment this run is executing under, injected rather than
   *  captured inside this module -- `captureEnvironment()` touches `process`,
   *  and this module stays pure and synchronously testable by never calling
   *  it itself. Absent (not just non-matching) is why an environment anchor
   *  reports `not-checkable` rather than guessing. */
  readonly now?: CurrentEnvironment;
}

/** Influence types for which nothing could ever check freshness. A property
 *  of the source itself, not of what this release happens to implement. */
const NOT_CHECKABLE = new Set<InfluenceType>(['person', 'model_knowledge', 'conversation']);

/** Influence types a checker could in principle exist for, but this release
 *  has deferred. A property of this release, not of the source. */
const NOT_IMPLEMENTED = new Set<InfluenceType>(['url', 'ticket', 'document']);

function stringField(event: JournalEvent, field: string): string | undefined {
  const v = (event.data as Record<string, unknown>)[field];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

interface RawInfluence {
  readonly type: InfluenceType;
  readonly ref: string | null;
}

interface RawEnvironmentAnchor {
  readonly ref: string | null;
}

/**
 * Pulls `influences` out of `event.data`. Both the array and its elements may
 * be absent or malformed -- an entry written by a foreign writer can carry
 * anything -- so every shape short of "an object with a known `type`" is
 * dropped rather than trusted. `ref` is `string | null`, never `''`: absent
 * is not the same claim as empty.
 */
function extractInfluences(event: JournalEvent): RawInfluence[] {
  const raw = (event.data as Record<string, unknown>).influences;
  if (!Array.isArray(raw)) return [];
  const out: RawInfluence[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.type !== 'string' || !(INFLUENCE_TYPES as readonly string[]).includes(rec.type)) continue;
    const ref = typeof rec.ref === 'string' && rec.ref !== '' ? rec.ref : null;
    out.push({ type: rec.type as InfluenceType, ref });
  }
  return out;
}

/**
 * Pulls `environment`-class `anchors` out of `event.data`, the anchor twin of
 * `extractInfluences` immediately above and defensive for the same reason: a
 * foreign writer's `anchors` array can carry anything short of "an object
 * with a known `type`". Every other anchor class (`commit`, `file`, `visual`,
 * ...) is deliberately ignored here -- this release's premise check is
 * scoped to `environment`, per the task-3 brief; extending it to another
 * anchor class is a decision this function's callers have not made.
 */
function extractEnvironmentAnchors(event: JournalEvent): RawEnvironmentAnchor[] {
  const raw = (event.data as Record<string, unknown>).anchors;
  if (!Array.isArray(raw)) return [];
  const out: RawEnvironmentAnchor[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    if (rec.type !== 'environment') continue;
    const ref = typeof rec.ref === 'string' && rec.ref !== '' ? rec.ref : null;
    out.push({ ref });
  }
  return out;
}

/**
 * Ids named DIRECTLY by another entry's `invalidates` field -- a single flat
 * pass, not the transitive cascade `project()` already computes.
 *
 * This deliberately does NOT reuse `project().invalidated`: that set also
 * contains entries that only inherit invalidity by CITING an invalidated
 * entry through a `journal` influence (project's cascade -- "anything resting
 * on an invalidated entry is suppressed"). Skipping decay-checks for those
 * citing entries too would erase the exact finding this checker exists to
 * produce: the citing entry's own `journal` influence, reported `failing`,
 * is how a reader learns its reasoning now rests on something withdrawn. Only
 * an entry someone explicitly retracted (named directly) goes silent; an
 * entry that merely cites a casualty still gets its day in the report.
 */
function directlyInvalidatedIds(events: readonly JournalEvent[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const e of events) {
    const inv = stringField(e, 'invalidates');
    if (inv) out.add(inv);
  }
  return out;
}

interface CheckContext {
  readonly allIds: ReadonlySet<string>;
  readonly invalidated: ReadonlySet<string>;
  readonly superseded: ReadonlySet<string>;
  readonly codebase: ReadonlyMap<string, boolean> | undefined;
  /** Every `environment`-kind observation present in this event list, keyed
   *  by id -- what an `environment` anchor's `ref` names. */
  readonly environmentObservations: ReadonlyMap<string, JournalEvent>;
  readonly now: CurrentEnvironment | undefined;
}

function checkJournal(ref: string | null, ctx: CheckContext): { status: DecayStatus; detail: string } {
  if (ref === null) return { status: 'failing', detail: 'journal influence has no ref to check' };
  if (!ctx.allIds.has(ref)) {
    return { status: 'failing', detail: `cited entry "${ref}" is not present in this journal` };
  }
  // Invalidation outranks supersession -- same precedence project() itself
  // enforces -- so an entry that is somehow both is reported by the stronger
  // claim, not whichever set happened to be checked first.
  if (ctx.invalidated.has(ref)) {
    return { status: 'failing', detail: `cited entry "${ref}" was invalidated` };
  }
  if (ctx.superseded.has(ref)) {
    return { status: 'failing', detail: `cited entry "${ref}" was superseded` };
  }
  return { status: 'passing', detail: `cited entry "${ref}" is live` };
}

function checkToolResult(ref: string | null, ctx: CheckContext): { status: DecayStatus; detail: string } {
  if (ref === null) return { status: 'failing', detail: 'tool_result influence has no ref to check' };
  if (!ctx.allIds.has(ref)) {
    return { status: 'failing', detail: `cited observation "${ref}" is not present in this journal` };
  }
  return { status: 'passing', detail: `cited observation "${ref}" is present` };
}

function checkCodebase(ref: string | null, ctx: CheckContext): { status: DecayStatus; detail: string } {
  if (!ctx.codebase) {
    return { status: 'not-checkable', detail: 'no codebase index was provided for this run' };
  }
  if (ref === null) return { status: 'failing', detail: 'codebase influence has no ref to check' };
  const present = ctx.codebase.get(ref);
  if (present === undefined) {
    return { status: 'not-checkable', detail: `"${ref}" was not covered by the codebase index provided` };
  }
  return present
    ? { status: 'passing', detail: `"${ref}" is present in the codebase` }
    : { status: 'failing', detail: `"${ref}" is no longer present in the codebase` };
}

/**
 * §2.1's canonical failure, closed: an entry anchored `environment:<id>`
 * carries the toolchain it was decided under. This compares that observation's
 * `interpreter` and `version` against the environment this run is executing
 * under (`ctx.now`, injected -- see `ComputeDecayOptions`).
 *
 * A difference is `drifted`, never `failing` -- §10.1's own distinction:
 * `failing` means a SOURCE is broken, and an environment simply being a
 * different machine is not that. It is reported so a human can judge whether
 * the difference matters, exactly as §10.1 requires for a premise re-check:
 * surfaced, never auto-invalidated.
 *
 * Ordered deliberately: a structurally broken anchor (`ref: null`, or a `ref`
 * naming nothing in this journal) is `failing` -- that is not a drift, it is a
 * dead citation, the same class of defect `checkJournal`/`checkToolResult`
 * report. Only once the anchor resolves to a real observation does this ask
 * whether a COMPARISON is even possible: no `now` supplied, or the observation
 * itself missing the fields being compared, is `not-checkable` -- "we could
 * not check this" must not collapse into "we checked and it matches".
 */
function checkEnvironmentAnchor(
  ref: string | null,
  ctx: CheckContext,
): { status: DecayStatus; detail: string } {
  if (ref === null) return { status: 'failing', detail: 'environment anchor has no ref to check' };
  const obs = ctx.environmentObservations.get(ref);
  if (!obs) {
    return { status: 'failing', detail: `referenced environment observation "${ref}" is not present in this journal` };
  }
  if (!ctx.now) {
    return { status: 'not-checkable', detail: 'no current environment was supplied for this run' };
  }
  const recordedInterpreter = stringField(obs, 'interpreter');
  const recordedVersion = stringField(obs, 'version');
  if (!recordedInterpreter || !recordedVersion) {
    return {
      status: 'not-checkable',
      detail: `environment observation "${ref}" has no recorded interpreter/version to compare`,
    };
  }
  if (recordedInterpreter === ctx.now.interpreter && recordedVersion === ctx.now.version) {
    return { status: 'passing', detail: `environment matches: ${recordedInterpreter}@${recordedVersion}` };
  }
  return {
    status: 'drifted',
    detail: `environment drifted: recorded ${recordedInterpreter}@${recordedVersion}, `
      + `now ${ctx.now.interpreter}@${ctx.now.version}`,
  };
}

function assertNever(x: never): never {
  throw new TypeError(`decay: unhandled influence type ${JSON.stringify(x)}`);
}

/**
 * The type dispatch is an exhaustive `switch`, not a lookup through
 * `NOT_CHECKABLE`/`NOT_IMPLEMENTED` followed by a default. Those two sets
 * document intent; they cannot make TypeScript reject a ninth or tenth
 * influence type that lands in neither. The `switch` can: every member of
 * `InfluenceType` has its own case, and the `default` branch only compiles
 * because `x` is `never` there. Add a new influence type without adding a
 * case, and that branch stops type-checking -- the failure moves to build
 * time instead of shipping a silent `passing`.
 */
function classify(inf: RawInfluence, ctx: CheckContext): { status: DecayStatus; detail: string } {
  const { type, ref } = inf;
  switch (type) {
    case 'person':
      return { status: 'not-checkable', detail: 'a person cannot be re-verified by this tool' };
    case 'model_knowledge':
      return { status: 'not-checkable', detail: "a model's own knowledge cannot be re-verified by this tool" };
    case 'conversation':
      return { status: 'not-checkable', detail: 'a conversation transcript cannot be re-verified by this tool' };
    case 'url':
      return { status: 'not-implemented', detail: 'url decay checking is not implemented in this release' };
    case 'ticket':
      return { status: 'not-implemented', detail: 'ticket decay checking is not implemented in this release' };
    case 'document':
      return { status: 'not-implemented', detail: 'document decay checking is not implemented in this release' };
    case 'journal':
      return checkJournal(ref, ctx);
    case 'tool_result':
      return checkToolResult(ref, ctx);
    case 'codebase':
      return checkCodebase(ref, ctx);
    default:
      return assertNever(type);
  }
}


/**
 * Checks every live, directly-non-retracted entry's influences -- plus its
 * `environment` anchors, Task 3's addition -- for decay. Filesystem truth is
 * injected pre-resolved via `options.codebase`, and "now" is injected via
 * `options.now`, so this module stays pure and synchronously testable: Task 2
 * built the codebase map, Task 3 wires both in from the CLI.
 */
export function computeDecay(
  events: readonly JournalEvent[],
  options: ComputeDecayOptions = {},
): DecayReport {
  const proj = project(events);
  const allIds = new Set(events.map((e) => e.id));
  const directInvalidated = directlyInvalidatedIds(events);
  const environmentObservations = new Map<string, JournalEvent>();
  for (const e of events) {
    if (e.kind === 'environment') environmentObservations.set(e.id, e);
  }

  const ctx: CheckContext = {
    allIds,
    invalidated: proj.invalidated,
    superseded: proj.superseded,
    codebase: options.codebase,
    environmentObservations,
    now: options.now,
  };

  const findings: DecayFinding[] = [];
  for (const event of events) {
    // An entry that was itself explicitly retracted -- named directly by
    // someone else's `invalidates` or `supersedes` -- is not decay-checked:
    // its sources' health stopped mattering the moment it stopped counting.
    // `proj.superseded` is safe to use as-is (supersession never cascades in
    // project()); invalidation is recomputed narrowly above because
    // `proj.invalidated` also contains entries that only inherit invalidity
    // by citing a casualty, and those still need their findings reported.
    if (proj.superseded.has(event.id) || directInvalidated.has(event.id)) continue;

    for (const inf of extractInfluences(event)) {
      const { status, detail } = classify(inf, ctx);
      findings.push({ entryId: event.id, type: inf.type, ref: inf.ref, status, detail });
    }

    for (const anchor of extractEnvironmentAnchors(event)) {
      const { status, detail } = checkEnvironmentAnchor(anchor.ref, ctx);
      findings.push({ entryId: event.id, type: 'environment', ref: anchor.ref, status, detail });
    }
  }

  let checked = 0;
  let notCheckable = 0;
  let notImplemented = 0;
  let drifted = 0;
  // An exhaustive switch, the same reason `classify`'s dispatch is one and
  // not an if-chain: a sixth `DecayStatus` added without a case here stops
  // compiling instead of silently landing in none of the four counters
  // (which is exactly the bug `drifted` would have been, folded into
  // `checked` by an `else` that was never taught the new status existed).
  for (const f of findings) {
    switch (f.status) {
      case 'passing':
      case 'failing':
        checked++;
        break;
      case 'not-checkable':
        notCheckable++;
        break;
      case 'not-implemented':
        notImplemented++;
        break;
      case 'drifted':
        drifted++;
        break;
      default:
        assertNever(f.status);
    }
  }

  return { findings, checked, notCheckable, notImplemented, drifted };
}

/**
 * Every `codebase` influence ref across `events`, deduplicated -- what a
 * caller (the CLI) must resolve via `resolveCodebaseRefs` before calling
 * `computeDecay` with the result. Built by reusing `extractInfluences` rather
 * than re-parsing `data.influences` a second way in the CLI: a second parser
 * that trims, or filters, even slightly differently than this one is exactly
 * how a ref gets resolved under one string and looked up under another --
 * this project has already found one helper living in two copies, and a
 * ref-extraction pair diverging the same way would fail every codebase check
 * silently, each one reporting `not-checkable` instead of what the filesystem
 * actually says.
 */
export function codebaseRefs(events: readonly JournalEvent[]): string[] {
  const refs = new Set<string>();
  for (const event of events) {
    for (const inf of extractInfluences(event)) {
      if (inf.type === 'codebase' && inf.ref !== null) refs.add(inf.ref);
    }
  }
  return [...refs];
}
