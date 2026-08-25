---
name: investigate-codebase
description: "Answer a question about a codebase with evidence that can prove it — score complexity before spending, fan out searches with controls, reconcile contradictions, and say what was not searched. Use when a code question needs a defensible answer, not a guess."
license: MIT
compatibility: "Any repository the agent can read, with git and a text search tool. Parallel children need a harness that can dispatch subagents and withhold context from them; without that, the bands run as sequential passes and the skill says so. Model choice is optional — the band then controls depth only. No index, no daemon, no network. Output is a written answer plus its coverage; nothing is committed unless the run record is asked for."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Write Grep Glob Bash
---

# Investigate a codebase

Ask an agent a question about a codebase and you get an answer in the same confident
register whether it read four files or none. The prose does not carry the difference, so
the reader cannot tell a measured claim from a plausible one, and the failure only surfaces
later — in the migration that dropped a column something still read, in the deletion that
broke boot, in the "nobody calls this" that was a search with a typo in it.

This skill produces an answer whose evidence can be checked. It scores how much the question
is worth before spending anything, splits the search so that the parts can genuinely
disagree, refuses to call a zero-hit search "absent" without a control that fired, settles
contradictions in a table instead of by tone, and closes with what it did not look at.

It reads. It writes nothing to the repository unless a run record is explicitly asked for.

## What separates an answer from a guess

Five mechanics, each of which exists because its absence produced a wrong answer somebody
acted on:

- **A control on every negative.** No hits means either "absent" or "the search never
  worked", and only a control tells you which.
- **An evidence class on every claim.** A comment proves what someone believed; a log proves
  what happened. Both read as facts in prose.
- **Coverage stated with the answer.** What was searched, and what was not — the second half
  is the half that gets dropped.
- **Independence recorded.** Two children reading the same file are one reading, counted
  twice. Agreement between them is not corroboration.
- **A date on every inherited claim.** "Was it true?" and "is it still true?" are different
  questions, and tickets only answer the first.

Composition: `derive-codebase-context` builds the durable, regenerable, CI-gated artifacts —
registries, atlases, boundary rules; this skill **reads** to answer one question now and
builds nothing. Where those artifacts exist, read them and open the file they cite instead
of re-deriving by grep. Routing identifiers, profiles, context packaging and escalation
belong to `model-routing`; child visibility and lifecycle evidence to `agent-lifecycle`.
Install the companions with `npx skills add crissmoldovan/agent-skills`.

## When to Use

- A question about the code needs an answer someone will act on, and being wrong is not free.
- The premise looks shaky: a ticket, a comment, or a colleague asserts a cause, and the
  answer depends on whether that attribution holds.
- A search came back empty and the conclusion "nothing does this" is about to be load-bearing.
- Two sources disagree — a registry against a runtime, a doc against the code, two people.
- An inherited claim needs a current-state check before it is built on.
- An answer needs to survive review by someone who will ask "how do you know?".

Do not use it to **build** repository context artifacts — that is `derive-codebase-context`,
and this skill's boundary is exactly the inverse of it. Do not use it to map what a proposed
set of changes would hit; `blast-area` owns that, and calls this skill for the searching. Do
not use it to run a problem report end to end through a fix — that is `resolve-problem-report`.
Do not use it to describe a change that already happened; `describe-changes` reads the diff.
Do not use its deep-mode adversaries as a code review: they attack an answer, not a diff, and
the review loop over a real pull request belongs to `request-blocks-review` and `blocks`.

## Prerequisites

1. **A question that can be answered wrong.** One sentence, with the nouns resolved to things
   you can point at, and the consequence of a wrong answer stated.
   **Complete when:** you can say what a wrong answer would cause someone to do.
2. **A readable checkout at a named revision.** The sha, and whether the tree is dirty. A
   finding measured against uncommitted work describes a state nobody else has.
   **Complete when:** the revision and dirty state are recorded.
3. **The repository's existing derived artifacts located.** Generated registries, an atlas, a
   language server, an import-boundary config — or their confirmed absence.
   **Complete when:** each is in hand or recorded as absent.
4. **The harness's capabilities declared.** Can it dispatch children? Can it withhold parent
   context from them? Is model choice available?
   **Complete when:** every "no" has its degradation named, ready to state in the answer.
5. **Attendance declared, conservatively.** If you cannot confirm a human will see and answer
   a question in this run, it is unattended — which changes both the question policy and
   whether a run record is written.
   **Complete when:** the run is marked attended or unattended before the first question.

## Procedure

1. **Score the rubric before spending anything.** Five signals, each 0–2 against an
   observable you actually ran. Sum: **0–2 light, 3–6 normal, 7+ deep.** Anchors, probe
   commands and worked scoring are in [the complexity rubric](references/complexity-rubric.md).

   | Signal | Observable probe | 0 | 1 | 2 |
   |---|---|---|---|---|
   | Scope | `git grep -n "<term>" -- <paths> \| wc -l`, files touched | one file or one definition site | one package or surface | crosses surfaces, or the count is unknown until you search |
   | Contradiction risk | does the ask assert a checkable attribution? | pure lookup | asserted, single source | two sources disagree, or the attribution decides the answer |
   | Repo size + toolchains | `git ls-files \| wc -l`; count of build manifests | one package, one build | a few packages, two toolchains | monorepo, >2 toolchains, generated code, several deploy targets |
   | Ambiguity | do two plausible referents exist? | every noun resolves | one obvious, one unlikely | two plausible, leading different ways |
   | Cost of being wrong | what does the answer authorise? | informs a conversation | informs a change review would catch | authorises a migration, deletion, production write, outbound message, or ticket close |

   Two overrides: **cost-of-being-wrong = 2 forces at least normal**, whatever the total; and
   **re-score after pass 1**, because the first pass changes its own inputs. A total exactly
   one point below a threshold **rounds up** one band and says so. The thresholds are tunable
   and are calibrated against a scored scenario suite that penalises needless escalation.

2. **Map the band to roles, never to model names.**

   | Band | Who works | Cap it buys |
   |---|---|---|
   | light | local tools and one cheap pass; **no driver is dispatched** | 1 round, no children |
   | normal | parallel children on disjoint axes, plus a mid-tier reconciler | 2–4 children, 2 rounds |
   | deep | the above, plus the adversarial pair; strongest tier judges only | 3 rounds, adversaries once each per round |

   Most questions are answered by a search and a file, and
   **a top-tier driver is not the default**: routing every one to the strongest
   model is the cost that makes people stop asking. Identifiers, profiles and
   escalation rules are `model-routing`'s; do not restate them here. Degradation, stated in
   the same breath as the band: **no subagents** — the same bands run as sequential passes,
   and the announcement states the wall-clock cost; **no model choice** — the band controls
   depth only.

3. **Announce the band. Always, on one code path.** One line, printed **before the first
   child is dispatched**, whether or not anyone is watching. Never ask which mode to run.

   ```text
   investigate-codebase · normal band — scope 2 (41 hits/18 files), contradiction 2 (two
   registries disagree), size 1 (14 packages), ambiguity 0, cost-of-being-wrong 1 = 6;
   boundary: scored 6, rounding up to deep → 4 children + reconciler, 3 rounds max
   ```

   The line carries the **band**, **each signal's score with the observable that scored it**,
   **any override applied**, and **the cap it buys** — fan-out width and round cap. At the
   deep band add a priced estimate where the harness can produce one; never invent a figure.
   A boundary round-up says so in the line ("boundary: scored 2, rounding up to normal").
   Overrides are user-initiated intents — "go deep on this", "light is fine" — which force a
   re-score and a fresh announcement; the skill never solicits one. A cost-of-being-wrong of
   2 never produces a mode-time question: it raises the floor and arms the consent gates at
   the irreversible action, where consent belongs.

4. **Read what the repo already derived, before searching for it.** Generated registries, an
   atlas, a compiler-backed index: read the entry, then **open the file it cites** at the
   current revision. A generated artifact is evidence of what its generator saw — code-reading
   class, and stale-able. A citation that no longer resolves is a finding.

5. **Decompose on an axis where the children CAN disagree.** Five axes, detailed with briefs
   in [decomposition and the child contract](references/decomposition-and-children.md):

   - **by-surface** — directory, package, deploy target, language.
   - **by-symbol** — one **definition site** per child, **never a bare name**. In a monorepo
     of roughly 2,500 TypeScript files, one measured pass found 184 exported names defined in
     more than one file, the worst being the repo's own conventions: one handler name 271
     times, another 209, a registry key 143. A child briefed with a bare name returns the
     whole application.
   - **by-data-flow** — writers / readers / **derivers**. The third bucket is the one that
     gets dropped, and in one measured case the defect lived exactly there: writer and reader
     both correct, the value transformed in between.
   - **by-history** — commits, blame, reverts, the range where behaviour changed.
   - **by-runtime-evidence** — a child **forbidden from reading code**, given boot output,
     logs, or a schema dump. Its value is that its evidence is a different class; a child that
     quietly opens the source has produced a second code reading and a false independence
     signal.

   If every child would read the same files, the axis is wrong: that is one reading billed
   several times, and their agreement means nothing.

6. **Brief every child with the same result contract.**

   ```json
   {
     "question": "the slice this child was asked",
     "findings": [{ "claim": "…", "evidence": "path:line", "basis": "measured | inferred", "confidence": "basis x coverage, in words" }],
     "searched": [{ "query": "verbatim", "tool": "git grep", "hits": 41 }],
     "not_found": [{ "target": "…", "control": "the positive variant that was run", "control_fired": true }],
     "blockers": ["what this child could not do, and why"]
   }
   ```

   **THE CONTROL RULE: a zero-hit search is admissible as "absent" only when a control fired.
   Otherwise it is recorded "inconclusive."** A control is a deliberately positive variant of
   the same search, run the same way, that returns hits — it proves the apparatus worked. The
   canonical failure: `git grep -E '\b…'` returns nothing and never could, because POSIX ERE
   has no `\b`. Read as absence, that is proof of a typo. Others in the reference: a pathspec
   that excluded the answer, a file type git never tracked, `job_name` against `jobName`.

7. **Reconcile with a contradiction table — do not merge summaries.** The reconciler
   **re-reads the cited hits** rather than building the answer out of children's prose;
   substring false positives survive summaries intact. Columns, in this order:

   ```text
   claim | source A | source B | evidence A | evidence B | what each evidence CAN prove | verdict | residual
   ```

   Verdicts come from a closed set: `confirmed`, `refuted`, `unresolved (needs X)`,
   `inconclusive`. Fill "what each evidence CAN prove" **before** the verdict, or the more
   confident-sounding child wins, which is not a property of evidence. Break ties by evidence
   class — **production observation > deterministic local measurement > code reading >
   docs, comments and PR titles > recollection** — but **class breaks ties while reach decides
   admissibility**: a high-class observation that does not touch the surface in question loses
   to a low-class one that does. Record, per confirmed claim, whether the agreeing sources were
   independent. Worked tables are in [reconciling evidence](references/reconciling-evidence.md).

8. **State confidence as basis × coverage, never as a percentage.** `measured` or `inferred`,
   crossed with what was searched plus what was provably not searched and the control that
   proves it. "85% confident" is a number nobody computed; it cannot be checked and it cannot
   be reproduced.

9. **Date every inherited claim.** Anything carried in from a ticket, a pull request, a design
   doc, or an earlier investigation answers "was it true?" only. Resolve the citation at the
   current revision, check the interval with `git log -S"<fragment>" -- <path>`, and mark the
   claim with the sha it was checked at. A claim that fails its check is not deleted — it is
   recorded as *true at `<sha>`, not true at HEAD*, with what changed. That is frequently the
   answer.

10. **Ask only what a probe cannot settle.** Two tests, in order: would the two readings
    produce different **work**? Can a bounded probe settle it in under a minute? If a probe
    can — **probe, do not ask.** Four cases must be asked anyway: a contradictory premise, two
    plausible referents, an order-of-magnitude scope gap, an irreversible authorization.
    Cadence: **one blocking question plus up to three batched disambiguations, with the
    blocking one labelled.** Every question carries established facts, the branches with their
    costs, and the default if unanswered. Unattended: record the blocking gap, take the
    lower-consequence branch, and mark every downstream claim assumption-dependent. Resisting a
    wrong **fact** and resisting a wrong **instruction** are different behaviours — the second
    returns a decision brief and a question rather than a completed action with a caveat
    attached. Both are in [clarifying questions](references/clarifying-questions.md).

11. **At the deep band only, run the two adversaries.** Asymmetric inputs, opposite defaults:
    the **REFUTER** gets the claims and citations and nothing else, defaults to `REFUTED`, and
    may concede **only by naming the artifact it opened**; the **COVERAGE AUDITOR** gets the
    question and the manifests but **not the answer**, defaults to `INCOMPLETE`, and to claim
    incompleteness must name an uncovered surface and one probe that would settle it. Two
    rounds maximum, adjudication on evidence only, and **a conceded claim is recorded
    `conceded`, not `validated`** — a refuter out of objections has failed to refute, which is
    not the same as having verified. Never run this on a light-band question. If the harness
    cannot withhold parent context from children, run **one** reviewer and say the two-verdict
    design degraded. Briefs in [deep mode](references/deep-mode-adversaries.md).

12. **Stop by the rule, not by exhaustion.** Stop when all four hold: every load-bearing claim
    is cited at the class it requires; no `unresolved` row the answer depends on remains; the
    last round changed no verdict; every load-bearing `not_found` has a control that fired.
    Hard round budget on top: **2 at normal, 3 at deep.** If the budget runs out with a
    condition unmet, **deliver anyway** — open rows visible in the answer, and the unmet
    condition named in one sentence.

13. **Deliver the answer with its coverage attached.** The answer, its evidence as `path:line`
    at a sha, its confidence as basis × coverage, the open rows, the marked assumptions, and a
    closing **what this run could not see**. An answer without its coverage is the failure this
    skill exists to prevent, however correct it happens to be.

14. **Document the run when the branch calls for it.** The convention is below, and it is
    identical in every skill of this family that supports it.

### The run record

**Documenting the run.** Write a full record when the invocation carries `--document` (or
an unmistakable phrase such as "document the run"), at `docs/investigate-codebase/<UTC-date>-<slug>.md`
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

## Usage Examples

```text
Is the generated job registry actually read at runtime, or is the page the source of truth?
Score it before you start and tell me the band. I want the evidence, not a summary — and if
a search comes back empty, show me the control that proves the search was working.
```

```text
The ticket says this timeout is caused by the retry wrapper. Check whether that is still
true at HEAD before you go any further; the ticket is four months old. If the repo
contradicts the premise, stop and tell me, don't answer the question it implies.
```

```text
Who reads the status column? Split it into writers, readers, and anything that derives
another value from it — I have been bitten by the third one before. Say what you did not
search.
```

```text
Go deep on this: I'm about to drop the column and I need to know what breaks. Run the
adversarial pass, and document the run (--document) so I can hand the evidence to review
along with the migration.
```

```text
Quick one, light is fine: which module defines the cursor parser? One definition site, not
every file that mentions the name.
```

## Pitfalls

- **The zero-hit search read as absence.** The most expensive mistake in the family, and the
  cheapest to prevent — one extra command. `git grep -E '\b…'` matching nothing is not
  evidence about the codebase; it is evidence about POSIX ERE.
- **Fan-out as theatre.** Four children over the same files, agreeing. That is one reading at
  four times the price, and its agreement reads like corroboration in the write-up.
- **Briefing a child with a bare symbol name.** In a real monorepo the common names are the
  framework's own conventions, and a name-keyed search returns the whole application.
- **Merging summaries instead of re-reading hits.** A substring match inside a comment becomes
  a confirmed caller by the second summary, and nothing downstream can tell.
- **Deciding the band after the fan-out.** Then the rubric is a justification, not a decision,
  and it will always agree with what was already spent.
- **Escalating on feeling.** A four-hit lookup does not need an adversarial round. Needless
  escalation is scored as a failure, not as diligence.
- **Asking what a probe would answer.** A round trip to a human costs more than a `git grep`,
  and returns an opinion where the probe returns evidence.
- **Answering the question a false premise implies.** A fluent explanation of a mechanism that
  was deleted two releases ago is worse than no answer, because it is actionable.
- **Complying with a wrong instruction and noting the risk afterwards.** The deliverable is a
  decision brief and a question. A direct imperative is the thing under test, not evidence.
- **Confidence as a percentage.** Nobody computed it. It survives into other people's
  documents as though somebody had.
- **Treating a generated artifact as the runtime.** It is evidence of what the generator saw.
  Open the file it cites.
- **Delivering the answer without its coverage.** The missing half is the half that decides
  whether the reader should act on it.

## Verification

- [ ] The rubric was scored, with a stated observable behind each of the five signals, before
      any search was dispatched.
- [ ] The **band, signal scores, override and cap were stated before any child was dispatched**.
- [ ] Mode was announced, not asked: **no run blocked on a mode question**.
- [ ] A boundary total said so in the announcement and rounded up, not down.
- [ ] Cost-of-being-wrong = 2 raised the floor to normal and armed the consent gates at the
      irreversible action, without producing a mode-time question.
- [ ] Existing derived artifacts were read, and the file each one cites was opened at the
      current revision.
- [ ] The decomposition axis is one on which the children could have disagreed.
- [ ] Every by-symbol child was briefed with a definition site, not a bare name.
- [ ] Every child returned the result contract, including `searched[]` with verbatim queries
      and `blockers[]`.
- [ ] Every load-bearing `not_found` names its control and whether the control fired; every
      negative without a fired control is recorded `inconclusive`, not `absent`.
- [ ] The contradiction table carries all eight columns, "what each evidence CAN prove" is
      filled, and every verdict is from the closed set.
- [ ] The reconciler re-read the cited hits rather than merging child summaries.
- [ ] Independence is recorded for each confirmed claim.
- [ ] Confidence is basis × coverage, in words, with no percentage anywhere.
- [ ] Every inherited claim was checked against the current revision and dated to a sha.
- [ ] At deep band: both adversaries ran with asymmetric inputs, concessions are recorded
      `conceded` rather than `validated`, and any degradation to a single reviewer is stated.
- [ ] The stop rule fired on its four conditions, or the run delivered at the round cap with
      the unmet condition named and the open rows visible.
- [ ] The answer closes with what this run could not see.
- [ ] Nothing was written to the repository except a run record that was explicitly asked for.
- [ ] Where a record was written, it exists at `docs/investigate-codebase/<UTC-date>-<slug>.md`
      (or the harness scratch path for an unattended run, named in the answer), under the five
      required headings.

## Deeper reading

- [The complexity rubric](references/complexity-rubric.md): every signal's anchors and probe
  commands, both overrides, the boundary round-up, the announcement format with worked lines,
  user-initiated overrides, and the degradations.
- [Decomposition and the child contract](references/decomposition-and-children.md): the five
  axes with the trap each avoids, child briefs, the result contract field by field, and the
  control rule with its measured failures.
- [Reconciling evidence](references/reconciling-evidence.md): the contradiction table worked
  through, evidence classes and reach, independence, confidence, dated findings, and the stop
  rule.
- [Deep mode](references/deep-mode-adversaries.md): the refuter and coverage auditor briefs,
  adjudication, why this is not a code review, and the single-reviewer degradation.
- [Clarifying questions](references/clarifying-questions.md): the two tests, the four must-ask
  cases, cadence, question payload, non-interactive degradation, and the difference between
  resisting a wrong fact and a wrong instruction.
- [A worked investigation](references/worked-investigation.md): one deep-band run end to end,
  from the ask to the delivered answer.
- [The run-record convention](references/documenting-the-run.md): when a record is written,
  where it goes, its five headings, the prohibitions, and a worked record.
