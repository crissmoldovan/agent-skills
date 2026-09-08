import type { JournalEvent } from './envelope.ts';
import { project } from './retract.ts';
import { INFLUENCE_TYPES, type InfluenceType } from './entry.ts';

/**
 * Four statuses that must never collapse into each other:
 *  - `passing`        — checked, and the source still holds.
 *  - `failing`        — checked, and the source no longer holds.
 *  - `not-checkable`  — nothing could ever check this (a property of the
 *                        source: a person, a model's own knowledge, a
 *                        conversation transcript this journal does not keep).
 *  - `not-implemented`— a checker could exist but this release doesn't have
 *                        one yet (a property of this release, not the source).
 * "We could not check this" and "we checked and it is fine" are exactly the
 * distinction this design exists to preserve. A `person` influence must never
 * report as `passing`.
 */
export type DecayStatus = 'passing' | 'failing' | 'not-checkable' | 'not-implemented';

export interface DecayFinding {
  readonly entryId: string;
  readonly type: InfluenceType;
  readonly ref: string | null;
  readonly status: DecayStatus;
  readonly detail: string;
}

export interface DecayReport {
  readonly findings: DecayFinding[];
  readonly checked: number;
  readonly notCheckable: number;
  readonly notImplemented: number;
}

export interface ComputeDecayOptions {
  readonly codebase?: ReadonlyMap<string, boolean>;
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

/** Belt-and-suspenders: keeps the switch above and the two documentation sets
 *  from silently drifting apart. Cheap (nine entries) and runs once, at
 *  import time, throwing loudly rather than misclassifying at runtime. */
(function checkClassificationsAgree(): void {
  const dummy: CheckContext = { allIds: new Set(), invalidated: new Set(), superseded: new Set(), codebase: undefined };
  for (const type of INFLUENCE_TYPES) {
    const { status } = classify({ type, ref: null }, dummy);
    if (NOT_CHECKABLE.has(type) && status !== 'not-checkable') {
      throw new TypeError(`decay: NOT_CHECKABLE and the switch disagree on ${type}`);
    }
    if (NOT_IMPLEMENTED.has(type) && status !== 'not-implemented') {
      throw new TypeError(`decay: NOT_IMPLEMENTED and the switch disagree on ${type}`);
    }
  }
})();

/**
 * Checks every live, directly-non-retracted entry's influences for decay.
 * Filesystem truth is injected pre-resolved via `options.codebase` so this
 * module stays pure and synchronously testable -- Task 2 builds the map,
 * Task 3 wires it in.
 */
export function computeDecay(
  events: readonly JournalEvent[],
  options: ComputeDecayOptions = {},
): DecayReport {
  const proj = project(events);
  const allIds = new Set(events.map((e) => e.id));
  const directInvalidated = directlyInvalidatedIds(events);

  const ctx: CheckContext = {
    allIds,
    invalidated: proj.invalidated,
    superseded: proj.superseded,
    codebase: options.codebase,
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
  }

  let checked = 0;
  let notCheckable = 0;
  let notImplemented = 0;
  for (const f of findings) {
    if (f.status === 'passing' || f.status === 'failing') checked++;
    else if (f.status === 'not-checkable') notCheckable++;
    else if (f.status === 'not-implemented') notImplemented++;
  }

  return { findings, checked, notCheckable, notImplemented };
}
