---
name: land-complex-change
description: "Land a complex change with reduced side effects and regressions: declare a touch-set budget from its blast map, arm a regression gate per affected surface, and stop when work strays outside the budget. Use when a change is too risky to build without contained side effects."
license: MIT
compatibility: "Any repository the agent can change, with git and a way to run the project's own checks. A blast map from the companion mapping skill is the preferred input; without one the budget is declared rather than derived and the skill says so. Guards are whatever the repository already has — tests, typecheck, lint, CI jobs, a written manual step — and the skill arms and runs them, it does not install a framework. Subagents and model choice are optional; without them the bands control depth only. Output is the change itself plus its budget, its gate ladder and its residual risks."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Write Edit Grep Glob Bash
---

# Land a complex change

A complex change rarely fails at the part that was planned. It fails at the edges: the file
that got tidied because it was already open, the guard that has been green since the day it
was written and could never have failed, the migration that got applied because applying it
was the obvious next step, the second consumer nobody mapped. The diff is reviewable and the
review still misses these, because a reviewer sees what changed — not what was *allowed* to
change, and not which of the green checks were ever capable of turning red.

Two costs, named apart because different mechanics prevent them. A **side effect** is work
the change did that nobody declared. A **regression** is behaviour that used to hold, does
not any more, and had nothing watching it. This skill contains the first with a budget and
catches the second with a gate per affected surface — and when the work turns out to be
bigger than the map said, it **stops** rather than absorbing the difference quietly.

It changes the repository. Everything it changes was declared first.

## What contains a change

Three artifacts, produced in this order. None of them is a status report; each one is a
thing the run can be checked against afterwards.

- **The side-effect budget.** The declared touch-set — every path, symbol, schema object and
  config key this change is permitted to alter, derived from the blast map rather than from
  memory — plus the classes of act that are out of bounds regardless of what the map says,
  plus the rule for what happens when reality exceeds the declaration. A budget written after
  the work is a description of the diff, which is a different document with the same shape.
- **The regression gate ladder.** For every surface the map marks affected, the guard that
  would catch a regression there — **watched failing before the change and passing after**.
  A guard that was green on both sides proves that it ran, not that it works. Surfaces with
  no guard at any rung are recorded as unguarded, in the deliverable, where a reviewer reads.
- **The change band and its act gates.** How much apparatus this change is worth, scored
  before anything is spent, with one rule that overrides the score: anything irreversible in
  the plan raises the floor and arms consent **at the act**, not at the plan.

The mechanics behind them are ordinary and the discipline is the hard part. In one measured
repository, four separate CI guards were added unarmed — each passed from the day it landed,
each was reported as coverage, and none of them was ever capable of failing. Nothing in that
repository was broken by a bad guard. Things were broken by the absence a green guard was
standing in front of.

### What this skill does not own

| The job | Whose it is | What this skill does with it |
|---|---|---|
| Which model runs which role | `model-routing` | Names **roles** and bands only. **This skill chooses no models, and it does not override `model-routing`'s Procedure step 2.** |
| Dispatching children and seeing what they did | `agent-lifecycle` | Consumes it; keeps no child bookkeeping of its own. |
| Durable, regenerable, CI-gated repo artifacts | `derive-codebase-context` | Reads what already exists; builds nothing durable. |
| Answering one question about the code | `investigate-codebase` | Delegates every search, and **inherits its complexity rubric rather than restating it**. |
| What a set of changes would affect | `blast-area` | Consumes its map as the budget's source, and re-enters it when the budget is breached. |
| Drawing that map | `visualise-blast-area` | Optional. Renders the same envelope; changes nothing in it. |
| Describing what the change did | `describe-changes` | Hands it the landed diff at the end. |
| The review loop over the pull request | `request-blocks-review` and `blocks` | Hands over the budget, the ladder and the residuals; runs no review loop of its own. |
| Intake, reproduction and candidate offers for a **report** | `resolve-problem-report` | Receives a spec from it; never performs its own intake. |

Install the companions with `npx skills add crissmoldovan/agent-skills`.

## When to Use

- A change crosses more than one surface — code and schema, code and jobs, code and config —
  and no single reviewer, and no single compiler, sees the whole path.
- A refactor claims "no behaviour change" and something has to hold it to that claim.
- A migration is part of the work, and the plan contains an act that cannot be taken back.
- A deletion is part of the work, and the evidence that it is safe has to outlive the session
  that gathered it.
- The last attempt at this change grew: the branch touched files nobody asked for, and review
  turned into an argument about scope instead of about correctness.
- The work runs unattended, or across several sessions, and "what were we allowed to touch?"
  has to survive the gap.
- A spec has arrived from a report pipeline and now has to be built without disturbing the
  rest of the system.

Do not use it to work out **what** a change would hit — `blast-area` owns that, and this skill
consumes its map rather than deriving a second one. Do not use it to answer a question about
how the code works; that is `investigate-codebase`, which both skills call for their searching.
Do not use it to take a **report** from intake through reproduction and root cause to candidate
fixes — `resolve-problem-report` owns that pipeline and delegates its spec-implement-verify half
here by name. **Neither trigger is a superset of the other.** A report can correctly end with no
change at all: a refutation, a question, a "this was fixed three weeks ago". A change frequently
starts with no report behind it — a roadmap item, a dependency bump, a deprecation with a date on
it. If you hold a report and no chosen fix, start there and arrive here; if you hold a chosen
change and no report, start here and do not manufacture one. Do not use it to describe what
landed — `describe-changes` reads the diff — or to run the review loop over the pull request,
which is `request-blocks-review` and `blocks`. And do not use it as a project-management wrapper
around a body of work with no definable touch-set: the budget *is* the skill, and a budget over
an undefined change is a formality that will be quietly widened by lunchtime.

## Prerequisites

1. **The change stated as changes, with a shape.** Every element names a thing — file, symbol,
   schema object, endpoint, config key — and an operation: add, rename, drop, retype, move,
   delete. And the change carries a shape: **feature**, **refactor**, **migration**, or a
   stated mix, because the shape decides what the gates have to prove. Per-shape entries are in
   [change shapes](references/change-shapes.md).
   **Complete when:** every element has a thing and an operation, and the shape is written down.
2. **A blast map at a named base revision.** Surfaces, break times, deploy ordering, and the
   map's own "what this map cannot see". The budget is derived from this; a touch-set assembled
   from memory is a wish.
   **Complete when:** the map's envelope is in hand — or the run is at the light band and the
   absence of a map is recorded as a declared, not derived, touch-set.
3. **The repository's own checks located and runnable here.** Test command, typecheck, lint,
   build, CI configuration, and any manual runbook step that constitutes a check.
   **Complete when:** each is named with the command that runs it, and at least one has been run
   in this checkout to prove the apparatus works.
4. **A revision you can return to.** A recorded base sha, a clean or explicitly-recorded dirty
   tree, and a branch that is not the one that deploys.
   **Complete when:** base sha, dirty state and the revert path are written down.
5. **Every irreversible act in the plan enumerated, before the first edit.** Applying a
   migration, writing to production data, deleting anything not restorable from history,
   sending an outbound message to a person, a deploy with no rollback.
   **Complete when:** the list exists — or is empty and says so.
6. **Attendance declared, conservatively.** If you cannot confirm a human will see and answer a
   question in this run, it is unattended. Unattended changes both the act policy — an
   irreversible act **stops the run** rather than proceeding with a note — and whether a run
   record is written.
   **Complete when:** the run is marked attended or unattended before the first gate.

## Procedure

1. **Name the shape, and the claim the shape makes.** A **feature** claims new behaviour: its
   gates are new checks that must fail before the code exists. A **refactor** claims *no*
   behaviour change: its gates are existing checks that must pass unmodified, and any test that
   had to be edited to keep it green is a behaviour change wearing a refactor's clothes — say so
   rather than editing it. A **migration** claims a data or schema transition: it has two halves,
   an ordering between them, an irreversible act, and a window in which one half is new and the
   other is old. Mixed changes take the strictest gate of each shape they contain, and are better
   split. The per-shape budget and ladder deltas are in
   [change shapes](references/change-shapes.md).

2. **Score the change band before anything is spent, and let an irreversible act set the floor.**
   The rubric belongs to `investigate-codebase` — five signals, each scored 0–2 against an
   observable you actually ran, summed into light / normal / deep, with a boundary total rounding
   up one band. Run *that* rubric; do not restate it and do not invent a second one. One rule is
   this skill's own and it is not a restatement: **for a change, cost-of-being-wrong is 2 whenever
   the plan contains an irreversible act.** Not "may contain" — contains. That forces at least the
   normal band and it **arms the act gates** in step 8. Re-score after the map arrives, because
   the map changes the rubric's inputs; a two-file change that turns out to cross four surfaces was
   never a light-band change, it was a mis-scored one. Announce the band on one code path, before
   any child is dispatched, whether or not anyone is watching. What each band buys **here**:

   | Band | Apparatus | Landing |
   |---|---|---|
   | light | declared touch-set, one gate on the single affected surface | one step, one revert |
   | normal | blast map required, budget derived from it, one gate per affected surface | steps ordered by the map, each separately revertible |
   | deep | the above, plus an adversarial pre-mortem against the budget and a staged landing | staged, with a checkpoint between halves |

   Band-to-role assignment, the escalation triggers and the degradations are in
   [change bands and act gates](references/change-bands.md).

3. **Take the map. Do not rebuild it, and do not substitute recollection for it.** `blast-area`
   returns surfaces with break times, searched negatives with their controls, a deploy ordering
   with its reason, and a mandatory list of what it could not see. Read that last part first: it
   is the part that decides how much of the budget is guesswork. If the map is missing a surface
   you know exists, that is a defect in the map — send it back rather than patching the hole in
   the budget, or the budget will be the only place the surface is recorded and the reviewer will
   never see it.

4. **Declare the side-effect budget, and declare it before the first edit.** One artifact, four
   parts, written down where the reviewer will read it:

   ```text
   BUDGET  <change name>  base <sha>  band <light|normal|deep>  shape <feature|refactor|migration>

   ALLOWED          path or symbol            operation        surface (from the map)
   EXPECTED EFFECT  surface                   what changes there            break time
   OUT OF BOUNDS    the four standing classes + anything this change adds
   ON BREACH        stop → re-enter blast-area → extend | split | abandon (never widen silently)
   ```

   Everything not in ALLOWED is out of bounds by default — that is what makes it a budget rather
   than a list of intentions. Include the awkward entries explicitly: generated files, lockfiles,
   formatter sweeps, import reorders. A formatter that rewrites two hundred files it was never
   asked about is a side effect with a tidy diff. The full artifact, its field semantics and a
   worked budget are in [the side-effect budget](references/side-effect-budget.md).

5. **Set the out-of-bounds classes, and keep them out.** Four classes stand outside every
   budget by default, whatever the map says, and each is released only by a consent that names
   the specific act at the moment of the act:

   - **Applying a migration** — writing the schema change to a live database, as opposed to
     writing the migration file.
   - **Writing to production data** — including a "small" backfill, and including a run of a job
     whose effect is a write.
   - **Deleting anything not restorable from history** — data, buckets, branches, tags, secrets,
     and code whose only copy is the working tree.
   - **Sending an outbound message to a person** — mail, chat, ticket comment, notification,
     status change that pages someone.

   Add the repository's own: rewriting history, touching credentials, and **editing the gates
   themselves**, which deserves its own line because a change that alters the guard it is being
   judged by has removed the only thing that could contradict it.

6. **Arm one gate per affected surface — and watch each one fail before you change anything.**
   This is the ladder, and it is per surface, not per repository. For each surface the map marks
   affected, find the guard that would catch a regression there and place it on the highest rung
   you can actually reach:

   | Rung | Guard | Evidence it is armed |
   |---|---|---|
   | 1 | an automated check that **fails before and passes after** | the failing output, quoted, from before the change |
   | 2 | an automated check that cannot fail first (purely additive work) | a recorded baseline, plus a **mutation**: break the thing deliberately, watch the check fail, restore |
   | 3 | a written manual observation with an expected value | the procedure and the before-value, recorded |
   | 4 | **none** — recorded as an unguarded surface | what would guard it, and what that would cost |

   Rung 1 is the ordinary case for a feature and for a bug fix: write the check first, run it,
   watch it fail for the right reason — not because the file does not exist yet, not because of a
   typo in the test name. Rung 2 exists because some correct work cannot make an existing check
   fail, and a check that has never been observed failing is a claim; the mutation converts it
   into evidence and costs about a minute. Rung 4 is not a failure of the run — it is the run's
   most useful output, and it must appear in the deliverable rather than in a thought. A surface
   listed as affected with no row on the ladder is the one shape of omission this skill exists to
   make impossible. The full ladder, per-surface guard classes, and the failure modes of each rung
   are in [the regression gate ladder](references/regression-gates.md).

7. **Land in the map's order, in steps that revert one at a time.** The deploy ordering came with
   a reason attached; follow it, including what runs in the window between halves. Keep each step
   independently revertible — one concern per commit — because a change that can only be
   reverted whole converts a small regression into a full rollback, and everyone will
   therefore choose to patch forward under pressure instead. Stay inside ALLOWED. Fixing
   something you noticed in passing is the definitional side effect, however small and however
   correct the fix is: it lands in a follow-up with its own budget, or it lands as an explicit
   extension in step 9.

8. **Gate every irreversible act at the act, and take none of them unattended.** Consent lives
   here, not at band selection — a mode question at the start is the wrong moment, because nothing
   irreversible is imminent and the person answering has no context yet. At the moment before the
   act, state four things: what is about to happen, what it touches, what it cannot undo, and what
   happens if you do not do it. Then wait. **An unattended run does not take an irreversible act.
   It stops, leaves the change staged, and reports exactly what remains to be done** — a cron job
   that applied a migration because it seemed like the natural next step has made a decision
   nobody was present to make. And remember that the act's **record** is part of the act: in one
   measured repository, a migration applied to production while its file sat unmoved in a staging
   folder broke the next deploy from a clean checkout, twice inside one day, because the file's
   location *was* the applied-history record and it disagreed with reality.

9. **When something outside the budget appears, stop the work and re-enter at `blast-area`.**
   This is the rule the artifact exists to enforce, and it is not advisory. A new caller, a second
   registry, a consumer in another repository, a column read from a string literal, a surface the
   map said was empty and is not — the work stops there. Re-enter the mapping skill with the new
   fact, get an updated map, and then take one of exactly three dispositions, in the open:

   - **Extend** — re-declare the budget with the new entries, announce the extension and the
     re-scored band, and continue. An extension is a document change, not a shrug.
   - **Split** — land what is inside the original budget, and carry the discovery into a separate
     change with its own map and its own budget.
   - **Abandon** — the discovery invalidates the approach. Say what was found; that finding is
     usually worth more than the change was.

   What is never available is the fourth option everybody takes by default: absorbing the
   discovery into the current work because it is small, related, and right there. That is how a
   two-file change becomes an eight-file change and the review becomes an argument about scope.

10. **Close the ladder: pass-after for every gate, unguarded surfaces still visible.** Run every
    guard again and record its result next to the fail-before evidence from step 6. A gate that
    never failed before is recorded **unproven**, not passed — including one that was green all
    along because it never covered the surface. Refactor shapes have one extra rule: if a test had
    to be modified to make it pass, the claim of no behaviour change is refuted, and the honest
    output is the behavioural delta rather than an edited assertion.

11. **Check what the gates cannot see, and state the undo path.** Every guard you can run is a
    guard over the surfaces the tooling reaches. Carry the map's break times forward: the `silent`
    items are precisely the ones no green check will ever report on — a value that stops being
    written, a job that stops registering, a query built from a string, a row in a datastore
    naming something you renamed. List them as residual risks with the observation that would
    settle each. Then state the undo path in the change's own terms: what a revert restores, what
    it does not, and what data written during the window a revert cannot bring back. "Revertible"
    without that second half is how a rollback becomes an incident.

12. **Hand off the description and the review loop; do not perform them here.** `describe-changes`
    writes what the change did, anchored to the diff. `request-blocks-review` and `blocks` own the
    review loop over the pull request. Give the reviewer three things beside the diff — the
    budget, the ladder with its unguarded rows, and the residual risks — because a reviewer with
    only a diff can check whether the change is correct but cannot check whether it was contained.

13. **Document the run when the branch calls for it.** The convention is below, and it is
    identical in every skill of this family that supports it.

### The run record

**Documenting the run.** Write a full record when the invocation carries `--document` (or
an unmistakable phrase such as "document the run"), at `docs/land-complex-change/<UTC-date>-<slug>.md`
in the host repository — and always when the run is unattended, in which case it goes to the
harness scratch directory, never the repository, and its path is named in the final answer;
if you cannot confirm a human will see and answer a question in THIS run, treat it as
unattended. Attended with no token: stay silent, offering once only if the run ends with an
unresolved contradiction or an open blocking question. Five headings, in order: What was
searched / Who searched it / What each found / How it reconciled / What was decided and why,
closing with what this run could not see. No secret values, machine-absolute paths, child
transcripts or raw logs; no unmarked inference or unearned benefit claims; never edit an
earlier record, and never let writing one change the answer.

Records are written per [the run-record convention](references/documenting-the-run.md).

For a change, the five headings carry the change's own material: the budget and the map it came
from under *what was decided and why*; every gate with its fail-before and pass-after evidence
under *what each found*; each budget breach, its re-entry and its disposition under *how it
reconciled*; and the unguarded surfaces and residual risks in *what this run could not see*.

## Usage Examples

```text
Here is the blast map for dropping the status column. Turn it into a touch-set budget before you
write any code, and stay inside it — if you find a reader the map missed, stop and tell me
instead of fixing it while you are in there.
```

```text
This is a pure refactor and the claim is no behaviour change. Before you start, show me which
existing test covers each surface on the map and which surfaces have nothing watching them at
all. I would rather know the ladder has holes now than find out from production.
```

```text
Build the spec on the branch. The migration file is part of the work, but do not apply it —
leave it staged, and tell me the ordering, what runs in the window between the halves, and what
a revert would not bring back.
```

```text
Run this one unattended overnight. Land what is inside the budget, stop at anything
irreversible rather than deciding for me, and document the run (--document) so I can read what
happened and what is left before I approve the rest.
```

```text
This looked like a two-file change and it is turning into eight. Stop, re-score the band, get
the map redone with what you just found, and come back with an extended budget before you write
another line.
```

```text
Before review: give me the gate ladder with the fail-before output for each guard, the surfaces
you could not guard, and the residual risks the tests cannot see. The diff I can read myself.
```

## Pitfalls

- **The budget written after the work.** It will match the diff exactly, prove nothing, and read
  as diligence. The budget's whole value is that it was falsifiable while there was still time.
- **"While I was in there."** The single most common source of side effects, and it never arrives
  as a bad idea — it arrives as a small, correct, obviously-worth-doing fix that nobody asked for
  and nobody will review as a change.
- **A guard nobody watched fail.** Green from the day it was written, reported as coverage,
  incapable of failing. Four of them in one measured repository, and each cost more than having
  no guard, because no guard invites care and a green one invites confidence.
- **A silently widened budget.** Extension is legitimate; extension without an announcement is
  the failure. The difference between them is one sentence written down.
- **Absorbing the discovery instead of re-mapping.** The new fact is evidence that the map was
  wrong, which means the *rest* of the map is now suspect too — not just the part you noticed.
- **Reverting the code and calling it reverted.** Rows written during the window survive the
  revert. Jobs that fired stay fired. Messages that went out stay sent.
- **Editing the test to make it pass.** In a refactor that is the behaviour change announcing
  itself, and editing it is how the announcement gets suppressed.
- **A green suite mistaken for coverage.** A suite that passes over an unguarded surface is not
  evidence about that surface. It is evidence about the others.
- **Applying the migration because you were already at the prompt.** The act gate exists exactly
  where the momentum is strongest, which is why it is placed at the act and not at the plan.
- **The unattended run that took the irreversible act and left a note.** A note is not consent.
  Nobody was there; that is the entire premise of the branch.
- **One commit for the whole change.** Then the only available revert is total, so under pressure
  everybody patches forward instead — which is the state the budget was meant to avoid.
- **Confusing the diff with the touch-set.** Generated output, lockfiles and formatter sweeps
  belong in the budget as declared entries, or the diff will contain hundreds of files nobody
  decided on.
- **Changing the gate you are being judged by.** Occasionally necessary, never incidental, and
  always its own change with its own review — a guard edited inside the change it guards has
  removed the only thing that could have contradicted the change.
- **Handing the reviewer a diff and nothing else.** They can check correctness from a diff. They
  cannot check containment from a diff, because containment is a claim about what is *not* there.
- **Leaving the act's record out of the plan.** An irreversible act whose record is not updated
  in the same breath leaves the repository disagreeing with production — and the disagreement
  surfaces later, in someone else's deploy.

## Verification

- [ ] The change's shape is named — feature, refactor, migration, or a stated mix — and the
      claim that shape makes is written down.
- [ ] The band was scored with `investigate-codebase`'s rubric (not a second, local one) before
      anything was spent, and announced before any child was dispatched.
- [ ] **Where the plan contains an irreversible act, cost-of-being-wrong was scored 2**, the
      floor was raised to at least normal, and the act gates were armed — or the plan contains
      none and says so.
- [ ] The band was re-scored after the map arrived, and any change of band was announced.
- [ ] The budget was declared **before the first edit**, and it lists ALLOWED entries, expected
      effects per surface, the out-of-bounds classes, and the on-breach rule.
- [ ] The touch-set was derived from the blast map — or the run is light-band and the touch-set is
      explicitly recorded as declared, not derived.
- [ ] Generated files, lockfiles and formatter output are either declared in the budget or absent
      from the diff.
- [ ] **Every surface the map marks affected has a row on the gate ladder**, with its rung.
- [ ] Every rung-1 guard has quoted fail-before evidence; every rung-2 guard has a recorded
      baseline and a mutation that was watched failing and then restored.
- [ ] **Unguarded surfaces appear in the deliverable**, each with what would guard it and what
      that would cost.
- [ ] Every gate was re-run after the change, and any guard that never failed first is recorded
      `unproven` rather than passed.
- [ ] For a refactor: no existing test was modified to keep it green, or the behavioural delta is
      reported as the finding.
- [ ] The work landed in the map's deploy order, in steps that can be reverted one at a time.
- [ ] Every breach of the budget stopped the work, re-entered `blast-area`, and resolved to
      extend, split, or abandon — recorded in the open, with none absorbed silently.
- [ ] No irreversible act was taken without consent at the act naming what it touches and what it
      cannot undo; **no irreversible act was taken in an unattended run**.
- [ ] Where an irreversible act was taken, the record that tracks it was updated in the same
      change.
- [ ] Residual risks are listed for the map's `silent` items, each with the observation that would
      settle it, and the undo path states what a revert does **not** restore.
- [ ] The description and the review loop were handed to `describe-changes` and
      `request-blocks-review`, and the reviewer received the budget, the ladder and the residuals
      alongside the diff.
- [ ] Where a record was written, it exists at `docs/land-complex-change/<UTC-date>-<slug>.md` (or
      the harness scratch path for an unattended run, named in the final answer), under the five
      required headings.

## Deeper reading

- [The side-effect budget](references/side-effect-budget.md): the artifact field by field, how the
  touch-set is derived from a blast map, the four standing out-of-bounds classes with the consent
  each requires, the breach procedure with its three dispositions, and a worked budget.
- [The regression gate ladder](references/regression-gates.md): the four rungs with their evidence
  requirements, the guard classes that fit each of the map's surfaces, arming by mutation, how
  guards go quietly dead, and how unguarded surfaces are reported.
- [Change bands and act gates](references/change-bands.md): what each band buys for a change, the
  irreversible-act floor rule, the escalation and de-escalation triggers, the act-gate script, the
  unattended stop rule, and the degradations.
- [Change shapes](references/change-shapes.md): feature, refactor and migration entries with the
  budget and ladder deltas for each, mixed shapes, and the boundary with `resolve-problem-report`
  in both directions.
- [A worked landing](references/worked-landing.md): one migration-shaped change end to end — map
  to budget to ladder, a mid-run discovery that stopped the work and re-entered the map, the
  extension that followed, and the surface that stayed unguarded.
- [The run-record convention](references/documenting-the-run.md): when a record is written, where
  it goes, its five headings, the prohibitions, and a worked record.
