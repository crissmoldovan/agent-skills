---
name: resolve-problem-report
description: "Resolve a problem report end to end: reproduce the claim, dig to root cause or implications, offer candidate fixes with trade-offs, spec the chosen one, and land it through gated review. Use when a bug or feature report needs investigating and resolving rather than a quick patch."
license: MIT
compatibility: "Any repository the agent can read and change, with git, plus the report itself in whatever form it arrived — ticket, issue, chat message, mail, a sentence from a colleague. Reproduction needs whatever the claim is about: a runnable checkout for a code claim, a queryable datastore or logs for a claim about production, and where that reach is missing the skill says so instead of substituting a lower evidence class. Companion skills do the searching, the mapping, the landing, the description and the review; without them the gates still hold but each says what degraded. Subagents and model choice are optional. Output is the resolution and its artifacts — claim, reproduction, candidates, contract, gates — or a documented refutation with no change at all."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Write Edit Grep Glob Bash
---

# Resolve a problem report

A report is not a bug and it is not a specification. It is somebody's account of a thing that
surprised them, written in their words, usually with a cause already attached and often with
numbers in it. Resolve the account and you have fixed whatever the reporter guessed. Resolving
the *report* means finding out which parts of it are true first — and being willing to come
back with "two of these three hold, and the third names a thing that does not exist."

The expensive failures here are quiet ones. The described symptom gets patched while the cause
stays. The cause is asserted from a code reading when the claim was about production. The
reporter's numbers travel into the resolution note unchecked. Three candidates are offered and
all three propose doing something, because "this was fixed three weeks ago" is not a satisfying
thing to say out loud. And the close rests on a green suite that never covered the surface.

Six gates. Each ends in a named artifact, and each one refuses to open until that artifact
exists — not until it looks convincing. The gates run in order, the middle ones delegate to
companions that own the work, and the pipeline can correctly terminate at any of them: a
**question** is an outcome, and so is a **refutation with no action**.

## Six gates, six artifacts

| Gate | Artifact | Does not open until |
|---|---|---|
| **G0 intake** | the **claim card** | the report is restated as one claim that could be false, with what would falsify it written next to it |
| **G1 analyse** | the **finding at its class**, plus the **reproduction table** | the cause (or, for a feature, the implication) is stated at the evidence class the claim requires, every number in the report has been measured, and every inherited claim is dated to a revision |
| **G2 offer** | the **candidate table** | 2–4 candidates carry a blast area, what each does **not** fix, reversibility and size — and the do-nothing line is a real row, not a courtesy |
| **G3 spec** | the **build contract** | every requirement names its files, its proving test and the **mutation** that must kill that test, and the requirements' file sets are disjoint |
| **G4 implement** | the **landed change with its budget and gate ladder** | `land-complex-change` returns them; this skill declares no budget and arms no gates of its own |
| **G5 verify + describe** | the **resolution note**, plus **one filed report per disagreement** | each requirement is checked at its own evidence class, the reporter's original numbers are re-measured, and anything that disagrees is filed rather than chased |

A gate that cannot open is information: the artifact underneath it is missing, and that is a
far better thing to say at G1 than to discover at G5, with a change landed and somebody waiting
for a mail.

### What this skill does not own

| The job | Whose it is | What this skill does with it |
|---|---|---|
| Answering a question about the code with checkable evidence | `investigate-codebase` | Delegates G1 entirely, and **inherits its complexity rubric, control rule and contradiction table rather than restating them**. |
| What a set of changes would affect | `blast-area` | Calls it **once per candidate** at G2, and again whenever a budget is breached. |
| Drawing that map | `visualise-blast-area` | Optional — when candidates have to be compared by someone who will not read a table. |
| Landing a change inside a declared budget with a gate per surface | `land-complex-change` | Hands it the contract and the paths at G4. Runs no budget, no ladder, no act gates of its own. |
| Which model runs which role | `model-routing` | Names **roles** and bands only; chooses no models and does not override its routing. |
| Dispatching children and seeing what they did | `agent-lifecycle` | Consumes it; keeps no child bookkeeping. |
| Durable, regenerable, CI-gated repo artifacts | `derive-codebase-context` | Reads what already exists; builds nothing durable. |
| Describing what the change did | `describe-changes` | Hands it the landed diff at G5; the resolution note is built from its registers. |
| The review loop over the pull request | `request-blocks-review` and `blocks` | Hands over the contract, the budget, the ladder and the residuals; runs no review loop. |
| Finding improvements nobody has reported yet | `new-ux-discovery` | Receives chosen candidates from it; performs no sweep of its own. |

Install the companions with `npx skills add crissmoldovan/agent-skills`.

## When to Use

- A bug report arrived with a cause already attached, and the cause is doing load-bearing work.
- A report quotes numbers — counts, durations, percentages — and the resolution will be judged
  against them.
- A feature request needs its implications worked out before anyone agrees to it.
- Two reports may be the same report, or the same report may be two.
- The obvious patch would fix the symptom described and leave the mechanism in place.
- A report has been open long enough that "is this still true?" is a real question, or closing
  it means writing to a person who will believe the message.
- The last attempt at this one turned into a scope argument, because nobody wrote down what the
  chosen fix was **not** going to do.

Do not use it to answer a question about how the code works — that is `investigate-codebase`,
which this skill calls at G1 rather than improvising its own searching. Do not use it to map
what a change would hit; `blast-area` owns that, and this skill calls it per candidate. Do not
use it to build a change that has already been decided and has no report behind it — a roadmap
item, a dependency bump, a deprecation with a date — that is `land-complex-change`, which this
skill delegates to at G4 and which is **not a superset of this one, in either direction**. A
report can correctly end with no change at all; a change frequently starts with no report, and
manufacturing one to get a pipeline produces intake artifacts that are fiction. Do not use it to
describe a change that already landed — `describe-changes` reads the diff. Do not use it to run
the review loop over a pull request: `request-blocks-review` and `blocks` own that. Do not use it
to go looking for improvements nobody has filed; `new-ux-discovery` sweeps for those and hands
the chosen ones here. And do not use it as ticket hygiene — a pipeline that always produces a
change will produce one for the report whose correct answer was a question.

## Prerequisites

1. **The report in its original words, with its numbers intact.** Not a summary. The reporter's
   phrasing carries which surface they were on and what they expected, and paraphrase silently
   repairs the false premise you most needed to see.
   **Complete when:** the text, its date, the reporter's role and every number in it are in
   hand — or their absence is recorded.
2. **A readable checkout at a named revision.** The sha, and whether the tree is dirty. A cause
   measured against uncommitted work describes a state nobody else has.
   **Complete when:** revision and dirty state are recorded.
3. **The reach needed to reproduce, declared before reproducing.** A claim about production
   needs production observation; a computed value needs the computation run; behaviour on a
   surface needs that surface reachable. Some of it will not be reachable from here.
   **Complete when:** each claim is marked reproducible here, reproducible only with access you
   do not have, or not reproducible at all — with the reason.
4. **The reporter reachable, or explicitly not.** Reports stall for one sentence from the
   person who filed them.
   **Complete when:** the channel is known, or the run is marked unreachable and every falsifier
   can be checked without them.
5. **The repository's own checks located and runnable here.** Test command, typecheck, lint,
   build, and any manual step that constitutes a check.
   **Complete when:** each is named with the command that runs it, and at least one has been run
   in this checkout to prove the apparatus works.
6. **Every irreversible act this resolution could reach, enumerated.** Applying a migration,
   writing to production data, deleting anything not restorable, **closing the report** and
   **any outbound message to the reporter** — the last two get forgotten because they are cheap
   to perform and impossible to retract.
   **Complete when:** the list exists — or is empty and says so.
7. **Attendance declared, conservatively.** If you cannot confirm a human will see and answer a
   question in this run it is unattended, which changes the act policy and the run record.
   **Complete when:** the run is marked attended or unattended before G0.

## Procedure

1. **Score the band before spending anything, and announce it on one code path.** The rubric
   belongs to `investigate-codebase` — five signals scored 0–2 against observables you actually
   ran, summed into light / normal / deep, boundary totals rounding up. Run *that* rubric; do
   not restate it and do not invent a second one. Two things are this skill's own: **a report
   whose resolution ends in closing the report or mailing the reporter scores
   cost-of-being-wrong 2**, which forces at least the normal band and arms the act gates in
   step 6; and the rubric is **re-scored after G1**, because reproduction routinely changes the
   scope signal by an order of magnitude. Announce band, each signal's score with its
   observable, any override, and the caps it buys — before the first child is dispatched,
   whether or not anyone is watching. Never ask which mode to run.

2. **G0 — restate the report as a claim that could be false, and write its falsifier.** One
   sentence, nouns resolved to things you can point at, next to one sentence saying what
   observation would prove it wrong. "Exports are broken" is not a claim; "the export endpoint
   returns rows for one account and none for another, for the same query" is, and its falsifier
   is a run of both. Classify the report as **bug**, **feature**, or **question** — they need
   different evidence at G1 — and record the **premises separately from the claim**, because a
   report usually asserts a cause as well as a symptom and those two are falsified by different
   observations. Partial refutation is normal and is not an accusation: accept the premises that
   hold, reject the one that does not, and reject it with a number. The card's fields and the
   worked restatements are in [the gate contracts](references/gate-contracts.md).

   **Cannot proceed until:** the claim is falsifiable, the falsifier is checkable with the reach
   declared in prerequisite 3, and the report's asserted cause is written as a premise rather
   than absorbed into the claim.

3. **G1 — analyse, at the class the claim requires, and reproduce every number.** Delegate the
   searching to `investigate-codebase`: it owns the decomposition axes, the child result
   contract, the control rule (a zero-hit search is "absent" only when a control fired) and the
   contradiction table. This gate adds two requirements of its own.

   **The evidence class is set by the claim, not by what is convenient.** The ranking —
   production observation > deterministic local measurement > code reading > docs, comments and
   PR titles > recollection — decides ties, and **reach decides admissibility**: a production
   observation from a surface the report was not about proves nothing about the report. A claim
   that something *happens* is not settled by a code reading that says it *should*. Where the
   required class is out of reach, say so and mark every downstream claim as resting on a lower
   class; do not quietly promote a code reading into an observation.

   **Reproduce the numbers — all of them, one row each.**

   ```text
   number as reported | what it measured | measured here | delta | verdict
   ```

   Verdicts from a closed set: `reproduced`, `diverged`, `not reproducible (needs X)`,
   `inconclusive`. **A partial reproduction is a finding, not a failure.** In one measured case
   six of nine reported figures reproduced exactly and three did not — and the three were the
   answer, because they shared a property the six did not and that property was the mechanism.
   An agent that reports "could not reproduce" over that table has thrown the result away. And
   date everything inherited: a report is an account of a past state, so every claim carried
   from it answers "was it true?" only. Resolve each at the current revision and record it as
   *true at `<sha>`, not true at HEAD* where it has stopped holding — frequently the entire
   resolution. Class rules, the table worked through, and unreproducible claims are in
   [reproducing the claim](references/reproducing-the-claim.md).

   **Cannot proceed until:** the cause (bug) or the implications (feature) are stated at the
   required class with `path:line` at a sha behind them; every reported number has a verdict;
   every load-bearing negative names a control that fired; and every inherited claim is dated.

4. **G2 — offer 2–4 candidates, and make the honest ones real candidates.** Call `blast-area`
   **once per candidate** — comparing fixes by what each disturbs is the entire point of the
   gate, and it is the comparison that a list of approaches cannot make. Every candidate carries
   five fields: its **blast area** (surfaces, break times, deploy ordering), **what it does not
   fix**, **reversibility** (what a revert restores and what it does not), **size**, and the
   **evidence it rests on**. Three candidate classes must be considered every time, and included
   whenever they survive contact with G1:

   - **Already fixed, or retracted.** The behaviour changed at some revision after the report
     was written, or the premise the report rested on is gone. This is a *result*, and the work
     is dating the claim, not building anything.
   - **Do nothing, deliberately.** With what the report costs if left, and what would make it
     worth revisiting. A pipeline that cannot output this will output a change for every report
     it is handed.
   - **The precedent this repository already used.** The same problem, solved elsewhere in the
     tree, possibly under another word. Search for it before inventing a fourth approach: an
     existing solution costs less to review and maintain, and its blast area is already known.

   Rank by consequence, not by elegance, and say which one you would take and why in one
   sentence. Then apply step 6: above the light band the choice is the reporter's or the owner's,
   not yours. Candidate rules, the comparison columns and a worked offer are in
   [candidate offers](references/candidate-offers.md).

   **Cannot proceed until:** at least two candidates exist with all five fields filled; the
   already-fixed and do-nothing lines have each been evaluated and are present or explicitly
   dismissed with a reason; each candidate's blast area came from the mapping skill or names the
   reason it could not; and the chosen candidate is recorded with who chose it.

5. **G3 — write the build contract, and make every requirement provable.** The spec is not
   prose about an approach; it is a contract a builder can be held to and a reviewer can check
   line by line. One template:

   ```text
   BUILD CONTRACT  <report handle>  base <sha>  band <light|normal|deep>  candidate <chosen>

   R1  <one checkable requirement, in one sentence>
       FILES     <the paths this requirement owns — disjoint from every other requirement>
       PROVES    <the test that proves it: path + test name>
       MUTATION  <the edit to the implementation that must make that test fail>
       OUT       <what this requirement explicitly does not do>

   R2  …

   MUTATIONS   Every test named above is watched failing under its own mutation before the
               implementation lands. A test that has never been observed failing is a claim.
   NOT IN SCOPE  <the candidates that lost, and what each would have fixed>
   STANDING INSTRUCTION  Report brief errors instead of implementing them. If a requirement
               contradicts the code, another requirement, or itself, stop and return the
               contradiction with its evidence. Do not implement around it, and do not pick
               the reading that is easiest to build.
   ```

   **Disjoint file sets** are what make requirements independently revertible and reviewable;
   where two genuinely need the same file, say so and sequence them. **The mutation line is the
   load-bearing one.** In one measured repository four CI guards were added that had never been
   capable of failing — each passed from the day it landed and each was reported as coverage. In
   another, a swallow-by-design path made its own test decorative: it asserted that nothing
   threw, which the code guaranteed. A mutation costs a minute and converts both into evidence.
   Template, disjointness, mutation forms and a worked contract are in
   [the build contract](references/build-contract.md).

   **Cannot proceed until:** every requirement has files, a proving test and a mutation; the
   file sets are disjoint or the overlap is declared and sequenced; the losing candidates appear
   under NOT IN SCOPE; and the standing instruction is in the text the builder actually receives.

6. **Confirm by the two-column rule — and confirm at the act, never at the plan.** The default
   is read off two columns, and either one turning it on is enough:

   | Column | What it reads | Confirmation at G2 |
   |---|---|---|
   | **Cost of being wrong** | the rubric's fifth signal scored **2** — the resolution authorises a migration, a deletion, a production write, an outbound message, or closing the report | **default ON** |
   | **Reversibility spread** | the candidates **differ** in what a revert would restore | **default ON** |
   | neither | a light-band report whose candidates are equally revertible | **default OFF**, with a one-line notice naming the candidate taken and how to undo it |

   Default-off is deliberate: a pipeline that stops to ask about every typo in help text stops
   being run unattended, and then stops being run. Above that line one confirmation at G2 — the
   candidate, not the implementation — carries the rest of the pipeline.

   Separately and always: **any irreversible act is confirmed at the moment of the act**, with
   four things stated — what is about to happen, what it touches, what it cannot undo, and what
   happens if it is not done — and then a wait. Closing the report and mailing the reporter are
   irreversible acts; they feel like paperwork and they reach a person. **An unattended run
   takes no irreversible act at all**: it stops, leaves the work staged, and reports exactly
   what remains. The full policy, the notice wording and the degradations are in
   [the confirmation policy](references/confirmation-policy.md).

7. **G4 — hand the build to `land-complex-change`, with the contract and the paths and nothing
   else.** That skill owns the change-landing half and produces three artifacts this one does
   not: the **side-effect budget** (the declared touch-set derived from the blast map, the
   out-of-bounds classes, the on-breach rule), the **regression gate ladder** (per affected
   surface, the guard that catches a regression there, watched failing before and passing after,
   with unguarded surfaces recorded visibly), and the **change band with its act gates**. Its
   breach rule applies here as written: work that strays outside the budget **stops**, re-enters
   `blast-area`, and resolves to **extend, split or abandon** — never silent absorption. A
   breach that invalidates the chosen candidate returns to G2, not to the reporter as a
   surprise.

   **Context is the contract plus the file paths — never the investigation transcript.** The
   transcript carries discarded hypotheses, refuted premises and the reporter's own diagnosis,
   and a builder handed all of it will implement some of it. It belongs in the run record, where
   it is read on purpose.

   **Cannot proceed until:** the budget and the ladder come back with the diff; every affected
   surface has a ladder row with its rung; every rung-1 guard has quoted fail-before evidence;
   and every breach is recorded with its disposition.

8. **G5 — verify at the class, describe, review — and file what verification turns up.**
   Verification is not the test suite going green; it is each numbered requirement checked at
   the evidence class **its own claim** requires, plus a re-measurement of the reporter's
   original numbers against the same table from G1. A green suite over a surface nothing guarded
   is evidence about the other surfaces.

   **A verification that opens a new report is a success.** When the re-measurement turns up a
   figure that disagrees with the system's own — the classic shape is two counts of the same
   thing differing by more than a hundred rows — **file that as its own report and close this
   one on its own contract**. In one measured case the disagreement was chased instead: the
   original stayed open for weeks, the new finding was never filed under its own name, and both
   were invisible in every status view.

   Hand the landed diff to `describe-changes` for the resolution note — its short register is
   the reporter's line, its detailed register is the reviewer's — and the pull request loop to
   `request-blocks-review` and `blocks`, giving them the contract, the budget, the ladder and
   the residuals alongside the diff. Then, behind step 6's act gate, close the report and tell
   the reporter what was true in their account, what was not, what changed, what it does **not**
   fix, and what to do if it recurs.

9. **Deliver the outcome the evidence supports, including the ones with no change in them.**
   Three terminal outcomes are legitimate and each is delivered with its evidence:

   - **A resolution** — a landed change with its contract, its gates and its residuals.
   - **A question** — the report needs one answer no bounded probe can settle, and the
     deliverable is that question with its established facts, the branches with their costs, and
     the default if nobody answers. Probe what a probe can settle; ask only the rest.
   - **A refutation with no action** — the premise does not hold, the thing was fixed already,
     or the requested action has no referent. In one measured case a report asked for a nightly
     run of a pipeline that had no runnable entry point at all; the correct output was the
     refutation plus the two things that did exist, not a job pointed at nothing. **Resisting a
     wrong fact and resisting a wrong instruction are different behaviours** — the second
     returns a decision brief and a question, not a completed action with a caveat attached.

10. **Document the run when the branch calls for it.** The convention is below, and it is
    identical in every skill of this family that supports it.

### The run record

**Documenting the run.** Write a full record when the invocation carries `--document` (or
an unmistakable phrase such as "document the run"), at `docs/resolve-problem-report/<UTC-date>-<slug>.md`
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

For a report, the five headings carry the report's own material: the claim card and the
reproduction table under *what each found*; the refuted premises and the contradiction table
under *how it reconciled*; the candidate table, the choice and who made it under *what was
decided and why*; the unreproducible claims, the unguarded surfaces and anything filed as a new
report in *what this run could not see*. Quote the reporter only as far as the claim needs.

## Usage Examples

```text
Here is the report exactly as it came in. Before you touch anything, turn it into one sentence
that could be false and tell me what observation would falsify it — and keep the cause they
suggested separate from what they actually observed.
```

```text
They say the nightly total double-counts and they quote nine figures. Reproduce all nine before
you go near the code. If some come out right and some do not, the ones that do not are what I
want to hear about first, not an average.
```

```text
Give me three options with what each one does not fix and what a revert of each would leave
behind. Include doing nothing, and check whether we already solved this somewhere else in the
tree before you invent a fourth approach.
```

```text
This ticket is four months old. Check whether it is still true at HEAD before you spec anything
— if it was fixed on the way past, I want the revision that fixed it and a note to the
reporter, not a change.
```

```text
Spec the option I picked: file sets that do not overlap, a test per requirement, and the
mutation that has to kill each test. If any requirement contradicts the code, come back and
tell me instead of building your best guess at what I meant.
```

```text
Land it, but do not close the report and do not mail them — leave both for me, and tell me
which surfaces ended up with nothing watching them.
```

```text
Run this one unattended overnight and document the run (--document). Stop at anything you
cannot take back. If verification finds a number that disagrees with the report's, file that as
its own report rather than holding this one open.
```

## Pitfalls

- **Resolving the reporter's diagnosis instead of their report.** The cause they attached is a
  premise, and the part most likely to be wrong: they saw a symptom and reasoned backwards.
- **Answering at the wrong evidence class.** A code reading that says the value *should* be
  written does not settle a report saying it *is not there*. Class breaks ties; reach decides
  whether the evidence was about this at all.
- **The numbers nobody re-ran.** They travel into the resolution note unchecked, and the note is
  believed because it has figures in it.
- **Treating a partial reproduction as a failure to reproduce.** Six of nine reproducing is the
  most informative result available: the three that did not are a filter on the mechanism.
- **A stale claim built on.** The report describes a past state; anything inherited from it
  answers "was it true?" and needs a current-state check before it becomes a requirement.
- **All candidates propose doing something.** If "already fixed" and "do nothing" are never
  offered they were never considered, and the pipeline has an outcome it cannot reach. The
  fourth invented approach usually already exists in the tree under a different word, which is
  why searching for the precedent is a named step and not a hope.
- **Candidates compared by description.** Without a blast area each, the comparison is between
  two summaries and the more confident one wins.
- **A contract whose file sets overlap.** No requirement can then be reverted alone, review
  cannot attribute a defect, and the first regression rolls back all of them.
- **A test that could never have failed.** Green from the day it was written, reported as
  coverage. The mutation is a minute; skipping it is how a suite becomes decorative.
- **Handing the builder the investigation transcript.** It contains the refuted premises and the
  discarded approaches, and some of them will end up in the diff.
- **Confirmation asked at the plan and not at the act.** At plan time nothing irreversible is
  imminent and the person answering has no context. At act time they have both.
- **Forgetting that closing the report and mailing the reporter are irreversible.** Cheap to
  perform, they reach a person, and no revert takes them back.
- **Chasing the disagreement verification found.** File it. Holding this report open to chase it
  hides two problems in one row that reads as in-progress.
- **Closing on a green suite.** A suite that passes over an unguarded surface is evidence about
  the surfaces it covers, not about the one the report was filed against — and a pipeline that
  always outputs a change will find something to change in the report whose answer was a
  question.

## Verification

- [ ] The band was scored with `investigate-codebase`'s rubric (not a second, local one) and
      announced before any child was dispatched, with signal scores and the caps it buys.
- [ ] Cost-of-being-wrong was scored **2** where the resolution closes the report or messages
      the reporter, and the band floor and act gates followed from it.
- [ ] **G0:** the claim is one falsifiable sentence with its falsifier written down, the report
      is classified bug / feature / question, and the reporter's asserted cause is recorded as a
      **premise**, separately.
- [ ] **G1:** the cause or implication is stated at the evidence class the claim requires, with
      `path:line` at a sha — or the required class is named as out of reach and the downstream
      claims are marked as resting on a lower one.
- [ ] **G1:** every number in the report has a row and a verdict from the closed set, and a
      partial reproduction is reported as a finding rather than as a failure.
- [ ] **G1:** every inherited claim is dated to a revision, anything that stopped holding is
      recorded as true at one sha and not at HEAD, and every load-bearing negative names a
      control that fired.
- [ ] **G2:** 2–4 candidates carry blast area, what-it-does-not-fix, reversibility, size and
      evidence — each blast area from the mapping skill, or with the reason it could not be.
- [ ] **G2:** already-fixed and do-nothing were each evaluated, and the repository was searched
      for a precedent before a new approach was proposed.
- [ ] The choice is recorded with **who made it**, and the two-column rule decided whether it
      needed confirming.
- [ ] **G3:** every requirement names its files, its proving test and the mutation that must
      kill that test; the file sets are disjoint or the overlap is declared and sequenced.
- [ ] **G3:** the losing candidates appear under NOT IN SCOPE, the standing instruction to
      **report brief errors instead of implementing them** is in the text the builder received,
      and every proving test was watched failing under its own mutation before landing.
- [ ] **G4:** the build was handed to `land-complex-change` with the contract and the paths and
      **not** the investigation transcript, and it returned a budget and a gate ladder.
- [ ] Every budget breach stopped the work, re-entered `blast-area`, and resolved to extend,
      split or abandon — with any breach that invalidated the chosen candidate returning to G2.
- [ ] **G5:** each requirement was verified at its own evidence class, and the reporter's
      original numbers were re-measured against the G1 table.
- [ ] **Every disagreement verification turned up was filed as its own report**, and this one
      was closed on its own contract rather than held open to chase it.
- [ ] The resolution note came from `describe-changes` and the review loop from
      `request-blocks-review`, which received the contract, the budget, the ladder and the
      residuals alongside the diff.
- [ ] No irreversible act — migration apply, production write, deletion, report close, outbound
      message — was taken without consent at the act; **none was taken in an unattended run**.
- [ ] Where the outcome was a **question** or a **refutation with no action**, it was delivered
      with its evidence and its branches, and no change was manufactured to fill the gap.
- [ ] Where a record was written, it exists at
      `docs/resolve-problem-report/<UTC-date>-<slug>.md` (or the harness scratch path for an
      unattended run, named in the final answer), under the five required headings.

## Deeper reading

- [The gate contracts](references/gate-contracts.md): all six gates with their artifact fields,
  the cannot-proceed-until conditions as checks, what a blocked gate produces instead, re-entry
  from a later gate, and the degradations when a companion is absent.
- [Reproducing the claim](references/reproducing-the-claim.md): the class each kind of claim
  requires, reach versus class, the reproduction table worked, partial and unreproducible
  claims, dating, and false premises.
- [Candidate offers](references/candidate-offers.md): the five fields per candidate, the three
  mandatory classes with the precedent search, the comparison table, sizing, and the choice.
- [The build contract](references/build-contract.md): the template field by field, disjoint file
  sets, mutation forms per requirement kind, the brief-error instruction, and a worked contract.
- [The confirmation policy](references/confirmation-policy.md): the two-column rule worked, the
  act-gate script, the light-band notice, the unattended stop rule, and unanswered confirmations.
- [A worked resolution](references/worked-resolution.md): one report from intake to close — a
  partly-reproduced claim, a refuted premise, four candidates including the precedent, the
  contract, the landing, and the disagreement filed as its own report.
- [The run-record convention](references/documenting-the-run.md): when a record is written,
  where it goes, its five headings, the prohibitions, and a worked record.
