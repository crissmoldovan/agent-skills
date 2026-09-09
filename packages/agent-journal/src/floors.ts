import type { JournalEvent } from './envelope.ts';
import { consequencesIn, type Consequence, type ConsequenceRule } from './consequence.ts';
import { liveConstraints, constraintsMatching } from './constraints.ts';

/**
 * Spec §11: two hard floors, self-triggered authoring's floor beneath the
 * floor. Both functions here render a PROMPT — text that asks the agent to
 * write something, in its own words, from what it actually did — never a
 * pre-written entry and never a `record` invocation with fields already
 * filled in. §5.3's whole claim is that an influence is *selected from what
 * the tooling saw*, not recalled from memory; a floor that hands over a
 * draft skips that selection step entirely and manufactures exactly the
 * perfunctory, unconsidered entry §11.3 warns a per-turn checkpoint would
 * produce. If a reviewer of this file ever finds a full sentence here that
 * reads like something that belongs in `--rationale` or `--chosen`, that is
 * a bug in this file, not a feature of it.
 *
 * Both renderers return `null` — never `''` — when there is nothing worth
 * saying. `null` and `''` are not interchangeable: `null` means "silence,
 * print nothing," and a floor that speaks on every call is the kind of
 * noise that gets an adapter uninstalled, which stops capturing everything,
 * not just the noisy part. See `cli.ts`'s `floor` command for how the two
 * are kept distinguishable all the way to stdout.
 */

/**
 * `since`, read the same way `consequencesIn` reads it: strictly AFTER the
 * given point, so replaying the same cutoff twice never re-flags the
 * boundary event. Shared here rather than duplicated because both floors'
 * "is there anything to say" question starts from the same filter.
 */
function sinceFilter(events: readonly JournalEvent[], since: string | undefined): readonly JournalEvent[] {
  if (since === undefined) return events;
  const sinceMs = Date.parse(since);
  if (Number.isNaN(sinceMs)) {
    throw new TypeError(`since must be a parseable timestamp, got ${JSON.stringify(since)}`);
  }
  return events.filter((e) => Date.parse(e.time) > sinceMs);
}

export interface CompactionFloorOptions {
  readonly since?: string;
}

/**
 * §11.2, verbatim: "`PreCompact` forces a flush before context is destroyed:
 * pending entries, plus an **assumption sweep** — what was taken on trust
 * (idempotency, ordering, environment) written as `assumption` entries with
 * `checked: no`."
 *
 * That is two distinct asks, and the second is the one a reader forgets,
 * because "flush what you haven't written yet" reads as the whole job. The
 * sweep is not a subset of the flush — it is a separate act of asking "what
 * did I never actually check?", and it is the half that survives
 * compaction as a durable record of what was never verified. This function
 * asks for both, explicitly, every time it has anything to say at all.
 *
 * `null` when `events` (narrowed by `since`, if given) is empty: a
 * workspace with no activity at all has nothing pending and nothing to
 * sweep, and forcing the prompt anyway would be exactly the every-call
 * noise this design otherwise avoids. `PreCompact` fires regardless of
 * activity — the emptiness check here is what keeps THIS floor's own
 * output honest about that, not a claim that compaction itself is skipped.
 */
export function renderCompactionFloor(
  events: readonly JournalEvent[],
  options: CompactionFloorOptions = {},
): string | null {
  const relevant = sinceFilter(events, options.since);
  if (relevant.length === 0) return null;

  return [
    'Context is about to be compacted. Whatever is not written down before that happens does not',
    'survive it.',
    '',
    'Flush: is there a decision, a finding, a blocker, or a piece of progress from this session',
    'that you have not recorded yet? If so, write it now — in your own words, from what actually',
    'happened, not a summary of this message.',
    '',
    'Assumption sweep: separately from the above, what did you take on trust this session without',
    'ever checking it — about idempotency, about ordering, about the environment? Name each one',
    'you can think of and write it as an `assumption` entry with `checked: no`. This is not a',
    'confession of a mistake; it is a record of what stayed unverified, for whoever reads this',
    'journal next.',
  ].join('\n');
}

export interface ConsequenceFloorOptions {
  readonly since?: string;
  /**
   * What the just-observed call is about — the same kind of value
   * `agent-journal observe --subject` already carries per event (a tool
   * name, a resource) — checked against every live constraint's `scope`.
   * Absent: no constraint check runs, matching `consequencesIn`'s own
   * `constraint-match` rule staying unpopulated with nothing to check
   * against. Blank-after-trim is treated as absent, the rule every other
   * `--subject` in this package follows.
   */
  readonly subject?: string;
  /**
   * Required, not defaulted to `new Date()` inside this module: `constraints.ts`'s
   * `liveConstraints` needs a clock to decide what is currently live, and
   * this module stays pure and synchronously testable by never reading one
   * itself — the same discipline `decay.ts`'s `ComputeDecayOptions` documents.
   * The CLI supplies its own `nowStamp()`; a test supplies whatever moment it
   * needs to hold `now` fixed.
   */
  readonly now: string;
}

/** Which anchor class each rule's observation should be cited under.
 *
 * `mutation` is why this mapping exists rather than a single class for
 * everything. §4.3 defines `runtime` as covering exactly this case — "a
 * deployed config or flag change that has no commit and no file, and is
 * exactly what a support question is about" — and telling an agent to cite a
 * secret rotation as `tool_use` loses that distinction at the only moment
 * anybody is thinking about it. §11.3 lists these mutations as `runtime`
 * anchors in so many words.
 *
 * The others genuinely are tool calls: what is being cited is that the call
 * happened, which is what `tool_use` means. */
const ANCHOR_FOR: Readonly<Record<ConsequenceRule, string>> = {
  mutation: 'runtime',
  permission: 'tool_use',
  'unfamiliar-api': 'tool_use',
  'constraint-match': 'tool_use',
};

/**
 * §11.3: a short, fixed list of Plane A observations prompts an entry
 * regardless of judgement, because "nobody chose to make a mutating call
 * look like a read" is exactly the gap self-triggered authoring (§11.1)
 * leaves open. `consequencesIn` (consequence.ts) already recognises three of
 * the four triggers — permission, mutation, unfamiliar-api — each carrying
 * the `observationId` of the Plane A event that tripped it. The fourth,
 * `constraint-match`, needs a subject only a caller holds (constraints.ts's
 * pre-flight finding: `constraintsBearingOn` takes a `JournalEvent`, not a
 * string), so it is wired HERE, not in consequence.ts, using
 * `constraintsMatching` against whatever `--subject` names.
 *
 * Every observation-derived line names its `observationId` deliberately: an
 * influence selected this way (§5.3) carries a `tool_use` anchor for free,
 * which is how an asserted influence becomes a verifiable one, and the
 * agent has no way to cite it without being told what it is.
 *
 * `null` — never `''` — when nothing fired: no consequence-bearing
 * observation since `since`, and no live constraint's scope matches
 * `subject`. Most tool calls are not consequence-bearing; this is meant to
 * be the common case, not the exception.
 */
export function renderConsequenceFloor(
  events: readonly JournalEvent[],
  options: ConsequenceFloorOptions,
): string | null {
  const consequences: Consequence[] = consequencesIn(
    events, options.since === undefined ? {} : { since: options.since },
  );

  const subject = options.subject?.trim();
  const matchedConstraints = subject
    ? constraintsMatching([subject], liveConstraints(events, options.now))
    : [];

  if (consequences.length === 0 && matchedConstraints.length === 0) return null;

  const lines: string[] = [
    'Plane A saw something here that nobody necessarily decided on purpose. That does not mean it',
    "needs an entry — most tool calls do not — but it's worth a moment's thought before moving on:",
    '',
  ];

  for (const c of consequences) {
    lines.push(`- ${c.rule}: ${c.detail} (observation ${c.observationId} — cite it as \`--anchor ${ANCHOR_FOR[c.rule]}:${c.observationId}\`)`);
  }
  for (const c of matchedConstraints) {
    lines.push(
      `- constraint-match: constraint ${c.id} (${c.enforcement}) says "${c.statement}"`
        + ` — its scope "${c.scope}" matches what you named ("${subject}")`,
    );
  }

  lines.push(
    '',
    'If this genuinely has a consequence, write down what happened, why, and what you assumed was',
    'true when you did it. If on reflection it does not, that is a legitimate answer too — just',
    "make sure it was a real judgement, not a pass.",
  );

  return lines.join('\n');
}
