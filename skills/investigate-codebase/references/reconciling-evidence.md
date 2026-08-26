# Reconciling evidence

Reconciliation is not summarising what the children said. It is deciding which of two
incompatible statements is true, on evidence, and recording what the losing evidence could
and could not have proved.

## Re-read, never merge summaries

**The reconciler opens the files the children cited.** It does not build the answer out of
their prose. A child's summary of 41 hits is a claim about 41 hits; the hits themselves are
the evidence, and the difference is where substring false positives get laundered into
confirmed findings — a match inside a comment, a test fixture, a similarly-named symbol in
an unrelated package. In one measured scenario the entire wrong answer came from a
substring match that survived two summaries intact and was never re-opened.

Re-read every hit that a load-bearing claim rests on. For a large hit set, re-read the ones
the claim actually needs and record how many were re-read against how many were reported.

## The contradiction table

Every disagreement gets a row. These columns, in this order, with these names:

```text
claim | source A | source B | evidence A | evidence B | what each evidence CAN prove | verdict | residual
```

Verdicts come from a closed set:

| Verdict | Means |
|---|---|
| `confirmed` | The claim holds on evidence of a class that can carry it. |
| `refuted` | The claim is false on evidence of a class that can carry it. |
| `unresolved (needs X)` | Settleable, but not with what is in hand. Name X. |
| `inconclusive` | The evidence gathered cannot decide it, and naming a missing X would be a guess. |

The column that does the work is **"what each evidence CAN prove"**. A design document
proves intent. A log line proves behaviour. A test proves behaviour under the test's own
setup. A comment proves what somebody believed when they wrote it. Fill that column before
the verdict column, because a table that skips it settles disputes by tone — the more
confident-sounding child wins, which is not a property of evidence.

Worked:

| claim | source A | source B | evidence A | evidence B | what each evidence CAN prove | verdict | residual |
|---|---|---|---|---|---|---|---|
| the generated registry is authoritative | its own header | boot output | a doc asserting intent | 41 jobs booted against 46 listed | doc proves intent; output proves behaviour | refuted | the 5 extra rows are unexplained |
| nothing outside the worker reads the flag | searcher, by-surface | derivers child | `git grep` over `services/` → 0, control fired | one cache key computed from it | absence over one surface; a derivation the first search's pattern could not match | refuted | other surfaces not searched |

`residual` is not decoration. It is what remains true and unexplained after the verdict, and
it is what the next reader needs in order to reopen the question honestly.

### Run the CAN-prove column over your own negatives

The column exists to stop the louder child winning, but its cheapest use is on the evidence
**nobody is arguing about** — the run's own searched negatives. A zero-hit search with a fired
control proves that the search worked and that the pattern is absent from the paths searched.
It does not prove that the thing is unreachable, unused, or never loaded: those are claims
about a graph, and a direct-reference search walks no edges at all.

| the negative | what it CAN prove | what it does NOT prove |
|---|---|---|
| `git grep -n "modules/report"` → 0, control fired | no tracked file names that path literally | that nothing loads it — a barrel re-export, a registry keyed by string, or a glob import each reach it without naming it |
| `git grep -n "status" -- app/` → 0, control fired | no file under `app/` mentions the field | that no screen renders it — the screen may read a mapped DTO field with another name |

So write the negative at the reach it has: **"no reference to depth N"**, with N and the hops
that were walked. A claim about reachability is admissible only from a walk to closure over a
named boundary, or from a resolver that answers reachability directly; anything shallower stays
the depth-bounded statement, which is the one that is true.

## Evidence classes

Class breaks ties. **Reach decides admissibility.**

1. **Production observation** — a log, a trace, a metric, a query against the live system.
2. **Deterministic local measurement** — a command that was run and its output: a search
   count, a build failure, a test result, a schema dump.
3. **Code reading** — what the source says at a cited line, including generated artifacts.
4. **Docs, comments, PR titles, tickets** — statements of intent by people.
5. **Recollection** — anybody's memory, including the agent's own priors.

A higher class wins a tie **only over the surface it actually touches**. A production log
from one region does not outrank a code reading about another region; it does not reach
there. Reach is checked first: an inadmissible high-class observation loses to an admissible
low-class one, every time. State the reach when a class is used to break a tie.

## Independence

Record, per confirmed claim, whether the agreeing sources were independent. Two children
that read the same file agree because it is one reading; the agreement adds nothing. Two
children on different evidence classes — a code reading and a boot observation — corroborate.
Write which of the two happened; "both children agreed" without that distinction is the most
common way a single unverified reading is presented as a consensus.

## Confidence

Never a percentage. Confidence is **basis × coverage**, stated in words.

- **Basis** — `measured` or `inferred`, from the child contract.
- **Coverage** — what was searched, plus what was provably not searched and the control that
  proves it. Coverage without controls is an assertion about absence.

So: "measured at three cited sites; two of five surfaces searched, the other three not
searched and recorded as such" is a confidence statement. "85% confident" is a decoration —
nobody computed it, and it cannot be checked or reproduced.

### Reproduce the miss before explaining it

A question of the form *why did this check not catch that?* has a mechanism as its answer, and
mechanisms are the easiest thing in this skill to invent convincingly. The basis is `measured`
only when two things were done:

1. **The exact input was located** — the record, the row, the argument, the payload the check
   actually saw, at a citation, not a reconstruction of what it probably saw.
2. **The deciding branch was traced** — the line that returned the verdict for that input,
   quoted. Not the first condition that could plausibly have matched: the one that did.

Anything short of both is `inferred`, and the sentence that states it says so. The failure this
prevents: a run explained a skipped record by a null check in the guard's first branch, named
the real cause in passing and moved on; the field was populated, and a length threshold two
branches earlier had already returned. The plausible mechanism and the actual one were both in
the same function, and only one of them ran.

Where the input cannot be obtained — it lives in a system you cannot reach, or it is gone —
say that, mark the mechanism `inferred`, and name the probe that would settle it. An honest
`inferred` costs the reader nothing; a `measured` that was never watched deciding costs them
the next hour.

## Dated findings

"Was it true?" and "is it still true?" are different questions, and a claim inherited from a
ticket, a pull request, a design doc, or a previous investigation answers only the first. In
the scenario suite this family is scored against, three of eight cases turn on exactly this
gap: the reported behaviour was real and has since been fixed, or the cited fix landed and
was reverted, or the code moved and the citation now points at something else.

Every inherited claim gets a **current-state check** before it can be load-bearing:

1. Resolve the citation at the current revision. Does the path still exist? Does the line
   still contain what was described?
2. Search history for the interval: `git log -S"<fragment>" -- <path>` and `git log --oneline
   <since>..HEAD -- <path>`. A change in that window is a finding whether or not it is the
   answer.
3. Where the claim is about behaviour rather than code, ask what observation would show it
   still happening, and say so if that observation is unavailable.
4. Mark the claim with the revision it was checked at. A claim dated to a sha is re-checkable
   later; an undated one has to be re-investigated from scratch.

A claim that fails its current-state check is not deleted — it is recorded as *was true at
`<sha>`, not true at HEAD*, with what changed. That difference is frequently the answer.

## The stop rule

Stop when **all four** conditions hold:

1. Every load-bearing claim is cited at the evidence class it requires — behaviour claims on
   observation or measurement, not on a comment.
2. No `unresolved` row remains that the answer depends on.
3. The last round changed no verdict.
4. Every load-bearing `not_found` has a control, and the control fired.

Plus a hard round budget: **2 rounds at normal, 3 at deep.** The budget is a ceiling, not a
target; condition 3 usually fires first.

When the budget runs out with a condition unmet, **deliver anyway** — with the open rows
visible in the answer and the unmet condition named in one sentence. An investigation that
runs past its budget in search of a clean finish spends real money to hide the one fact the
reader most needs: that something is still open. "Delivered at the round cap with one
unresolved row: whether the second registry is read at deploy time (needs a deploy-log
observation)" is a better answer than a confident one.
