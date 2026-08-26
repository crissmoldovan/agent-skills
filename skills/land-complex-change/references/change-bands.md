# Change bands and act gates

## The rubric is not restated here

Scoring belongs to `investigate-codebase`: five signals, each scored against an observable
that was actually run, summed into **light / normal / deep**, with the two overrides and the
boundary round-up defined there. Run that rubric. Do not restate it, do not paraphrase its
anchors, and above all do not invent a second scoring scheme for changes — two rubrics in one
family produce two different bands for the same work, and the person reading the announcement
cannot tell which one was used.

What follows is only the delta a **change** adds to it.

## The delta: an irreversible act sets the floor

**For a change, cost-of-being-wrong is 2 whenever the plan contains an irreversible act.** Not
"could conceivably lead to" — contains. Applying a migration, writing to production data,
deleting something not restorable from history, sending an outbound message to a person, a
deploy with no rollback.

Two consequences follow mechanically, and they are different from each other:

1. **The floor rises to at least normal.** A blast map becomes required, the budget must be
   derived from it rather than declared, and the gate ladder must cover every affected surface.
2. **The act gates arm.** Consent is required at each irreversible act, at the moment of the
   act. This is the part people substitute for the first one; they are not interchangeable. A
   consented act inside an unmapped change is a decision made with a confident-sounding summary
   instead of evidence.

The floor rule never produces a question at scoring time. Nothing irreversible is imminent
when the band is chosen, and a person asked to approve at that moment has no context to approve
with. The question belongs at the act, where the four facts are concrete.

## What each band buys for a change

| Band | Map | Budget | Ladder | Landing | Review |
|---|---|---|---|---|---|
| light | optional; if skipped, the touch-set is recorded as **declared, not derived** | one page, one surface | one gate on the single affected surface | one step, one revert | ordinary |
| normal | required | derived from the map, per surface | one gate per affected surface | steps ordered by the map, each separately revertible | budget + ladder handed to review |
| deep | required, plus its blindspots read first | derived, plus an adversarial pre-mortem against the budget | as normal, plus a rehearsed revert where the shape allows | staged, with a checkpoint between halves | as normal, plus the residual list as its own section |

The **adversarial pre-mortem** at the deep band is one pass with a single instruction: *assume
this change caused an incident; name the surface it came through.* It is scored against the
budget, not against the code, and its output is either a new surface for the map or an
explicit "the budget covers the paths I can name". It is a cheap use of an adversary and it is
not a code review — the review loop over the pull request belongs to `request-blocks-review`
and `blocks`, and it judges a diff that already exists.

## Escalation and de-escalation, mid-run

Re-score when any of these happens; announce the new band and what caused it.

**Escalate when:**

- The map returns a surface the plan did not anticipate, or more than one.
- A budget breach occurs — the map's method missed something, so the map's clean results are
  now weaker evidence than they were.
- An irreversible act appears in the plan that was not there at scoring time. This is the most
  common escalation and the easiest to miss, because it usually arrives as a convenience: "we
  may as well apply it while we are here".
- A gate that was assumed to exist turns out to be at rung 4, moving a surface from guarded to
  unguarded.

**De-escalate when** — and this is legitimate, and under-used — the map comes back genuinely
small: one surface, everything else searched with fired controls, no irreversible act. Say so
and drop the apparatus. Needless escalation is a failure mode in its own right; it is the cost
that makes people stop using the skill, and then nothing is contained at all.

## The act gate

At the moment before an irreversible act, state four things and stop:

```text
ABOUT TO:      apply the pending migration to the production database
IT TOUCHES:    one table, one column, roughly N rows
CANNOT UNDO:   the column's data. A revert restores the schema shape, not the values.
IF I DO NOT:   the code half stays behind a flag; nothing else in the change is blocked.
```

Then wait for a consent that names *this* act. A general "go ahead" given at the start of the
run was granted before anyone knew what the act would be, and it is not consent to this one.

**Unattended runs take no irreversible act at all.** They stop, leave the work staged, and
report precisely what remains: the act, its four facts, and how to take it. A scheduled job
that applied a migration because applying it was the natural next step has made a decision
nobody was present to make, and the fact that it was the right decision is luck rather than
process. If you cannot confirm a human will see and answer a question in **this** run, it is
unattended.

## After the act: the record is part of the act

An irreversible act is not finished when the effect lands. The record that tracks it — the
applied-migration history, the deployment log, the ticket, whatever the repository uses to
know what state production is in — is updated in the same change, not later.

In one measured repository the file's *location* was the applied-history record: a migration
that had run in production while its file sat in a review-staging folder left the main branch
disagreeing with the database, and the next deploy from a clean checkout failed. It happened
twice inside a single day. The suggested remedy from the tooling — recording the applied
migration as reverted — would have made the history lie about production, which is worse than
the failure it was offered to fix.

## Degradations

State the degradation in the same breath as the band, exactly as the rubric's own skill does:

- **No subagents.** The bands run as sequential passes. Same apparatus, more wall-clock; say
  how much. Nothing about the budget or the ladder changes.
- **No model choice.** The band controls depth only. Roles stay named; nothing is routed.
- **No blast map available** (no mapping skill, or a repository it cannot resolve). The
  touch-set is **declared, not derived**, and every surface's confidence drops accordingly.
  Say it on the budget, in the deliverable, next to the ALLOWED list — not in a footnote.
- **No runnable checks** (checks exist only in CI, or the environment cannot run them). Every
  surface drops to rung 3 or rung 4 and the ladder says so. Do not silently promote "CI will
  catch it" to a gate: an unobserved check is exactly the guard class this ladder exists to
  distrust.
