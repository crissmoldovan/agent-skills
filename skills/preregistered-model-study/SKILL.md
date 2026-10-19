---
name: preregistered-model-study
description: "Run a model or prompt comparison whose verdict can be trusted: before any paid call, commit the plan, a freeze of every input by hash, and a dry run proving each arm differs from production only where intended; put every later change in a dated addendum pushed before the calls it governs, or record it as a dated correction if found after them; cap the spend in code; prove the harness reproduces production before measuring; judge with three vendors who can see where each piece of evidence came from; and ship a reproduce script and checksum manifest that rebuild every number offline. Symptoms: compare these models, is the cheaper model good enough, bake-off, A/B this prompt, run an eval before we switch, can we trust this benchmark, the study overspent, the judge rewarded an answer that made things up. Which model runs everyday work is model-routing's; the review round on each study pull request is codex-review-loop's."
license: MIT
compatibility: "Any harness that can run scripts and commit to a repository. Every paid call goes through one research account, not production's: one key, one balance, such as a multi-vendor gateway, reporting each call's cost and the key's account; with no balance endpoint the floor is recorded as unavailable. Judging needs three vendors' models on that account. Output is a committed study directory: plan, freeze, addenda, raw responses, scores, report, a reproduce script and a checksum manifest."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Write Edit Grep Glob Bash
---

# Run a preregistered model study

A model comparison rarely fails at the arithmetic. It fails before the first call, when the
question was never written down and the bar drifts to wherever the results land. Or it fails
quietly in the middle: the harness was not sending what production sends, the "same" model was
served by a different provider, a judge rewarded an answer that invented its evidence because it
was shown the same untagged evidence the model had, or one rule definition counted "this does not
apply" as an invention and flipped the winner. Each of these produces a clean table. Nothing in
the table says which of them happened.

This skill makes the verdict checkable by someone who was not there. The mechanism is ordinary:
decide in writing before spending, freeze the inputs by hash, prove the harness is production's
twin, cap the spend in code rather than in intention, judge in a way that can see invention, and
ship the numbers with a script that rebuilds them. The discipline is the hard part. Every rule
below is here because leaving it out once produced a confident recommendation that was wrong.

It runs studies and writes them up. It does not change what production runs: a verdict is an
input to that decision, handed on, not the decision itself.

## What a verdict rests on

Five artefacts, committed in this order. The order is the point: each one is evidence only
because it existed before the thing it constrains.

- **PLAN** — the question as a decision, the arms, the metrics with their predicates, the bars
  (each with a point rule and an interval rule), the sample size and why, and the invention bar.
- **FREEZE** — a hash of every input the study consumes: items, prompts, each arm's parameters,
  policies, rubrics, model and provider pins, the price tables the guard reads; and of every
  executable and configuration that can change a request, a spend decision or a verdict, with the
  runtime's version and the dependency lock.
- **DRY RUN** — built offline, with nothing sent: the control's request beside production's for the
  same items, proving request parity, and every arm's request beside it, with every difference
  listed and each one intended.
- **ADDENDA** — every change after the first paid call, dated, with its reason: pushed before the
  calls it governs, or, when found after them, recorded as a correction and never backdated.
- **REPRODUCTION** — a `reproduce.sh` that rebuilds every number offline from committed data, and
  a checksum manifest covering every other file it reads.

The first three are committed and pushed to the study's pull request before the study's first paid
call, which is output parity's: a stage of its own, with the items, pass rule and cap the plan gave
it. The remote's push record is what makes "decided before" checkable, not the commit's own date,
which an amend or a rebase rewrites: a plan pushed only after the results arrived cannot be told
apart from a plan written to fit them, and a reader is right to assume the worse case.

### What this skill does not own

| The job | Whose it is | What this skill does with it |
|---|---|---|
| Choosing which model runs which piece of everyday work | `model-routing` | Produces evidence such a choice can cite; sets no routing. |
| The independent review round on each study pull request | `codex-review-loop` | Hands it each PR; records every round's corrections in the study. |
| Placing the research key in a secret store | `secure-credential-setup` | Names the key it needs, and the check that refuses production's. |
| Recording the decision the verdict feeds | `decision-journal` | Hands over the verdict with its bars, its caveats and its cost. |
| Changing production to follow the verdict | `land-complex-change` | Stops at the recommendation; the switch is another change. |
| Reporting progress while paid calls run | `report-progress` | Supplies the spend, the counts and the state of the lock. |
| Finding out how production builds its request | `investigate-codebase` | Asks it, then freezes the answer. |

Install the companions with `npx skills add crissmoldovan/agent-skills`.

## When to Use

- A cheaper, newer or different model is proposed for a task production already runs, and
  someone will act on the answer.
- A prompt, policy, schema or retrieval change has to be shown not to make things worse before
  it ships.
- Several candidates are being compared, and the comparison will be cited in a decision, a
  report or a pull request.
- An earlier comparison is disputed — "the judge liked the wrong answer", "the control looks
  off", "that was not a fair test" — and has to be rerun so that the dispute can be settled.
- Paid calls are involved, and an overspend would be a problem in itself.

Do not use it for a quick look at whether a model can do a task at all: a handful of calls in a
notebook is fine for that, as long as nobody quotes the result as a verdict. Do not use it to
choose routing for everyday work (`model-routing`), or to make the production change a verdict
recommends (`land-complex-change`). And do not use it when the task has no ground truth and no
judge could tell a good answer from a bad one. Say so instead: a preregistered study of an
unmeasurable question is ceremony around a guess.

## Prerequisites

1. **The question, written as a decision.** "Can arm B replace arm A on task T without losing
   more than X on metric M, and at what cost?" — not "which model is better".
   **Complete when:** the question names the decision it feeds and who makes it.
2. **Production's request path, readable.** The code or configuration that builds the request
   production sends today: system prompt, message layout, tool and schema definitions,
   parameters, provider routing.
   **Complete when:** you can rebuild one real production request for one real item, byte for
   byte, from that code — or you know you cannot, and finding out why is the study's first task.
3. **One research account that is not production's.** One key and one balance for every paid
   call, arms and judges alike — a multi-vendor gateway, for example — that reports each call's
   cost and names the account a key bills. Providers that need separate accounts, or cannot name
   that account, are out of scope: a billing account written in the plan binds no key to it.
   **Complete when:** the key is in a secret store, and a check refuses to run unless the account
   the provider names for the key is not production's, or while the harness holds any other paid
   credential.
4. **A study directory under version control.** Everything the study writes lands there and is
   committed, as prerequisite 7 allows: plan, freeze, addenda, raw responses, scores, report.
   **Complete when:** the directory exists on a branch, and the plan is in the study's first
   commit.
5. **Three judges from three vendors.** The plan says which judge, if any, shares a vendor with
   which arm, because every judge is also reported alone.
   **Complete when:** each judge is reachable, and each is named in the plan with its vendor.
6. **A budget, agreed in numbers.** A study cap, and a floor on the account's remaining balance —
   or, where the provider has no balance endpoint, the floor recorded as unavailable.
   **Complete when:** the cap is a number someone agreed to, and the floor is one too or is recorded
   as unavailable, both in the plan.
7. **The data classified.** Production requests, items and responses can carry customer data,
   credentials or sensitive tool output, and a committed file is readable by everyone with access
   to the repository. Wherever this skill says *committed*, it means as the class allows: in the
   clear, or in approved private or encrypted storage with its hash committed in its place. The
   study uses only data that every recipient — each candidate provider and each judge vendor — is
   approved to receive; otherwise this skill does not apply, and redaction comes before the study.
   **Complete when:** before any paid call, the plan names the data's class, that every recipient
   is approved for it, and where each artefact carrying it is kept.

## Procedure

1. **Write the PLAN, and commit it before any paid call.** It holds the question and the decision
   it feeds; the arms, each by model, provider, prompt and parameters, with the control named;
   every metric with its predicate — what counts in the numerator, what in the denominator, what
   is excluded and why; and the bars. A bar has a **point rule** ("B's error rate no more than 2
   points above A's") and an **interval rule** ("the upper bound of the 95% interval of the
   difference below 4 points"), because a point estimate inside the bar with an interval
   straddling it is not a pass. **Invention** — answering where the truth cannot be determined
   from the evidence — is a bar of its own, counted and capped like any other harm. The sample
   size comes with its reason: the smallest difference worth detecting, and the interval width
   that size will give. Output parity (step 5) is registered here as a stage of its own, with its
   items, its pass rule and its own cap inside the study's. Templates are in
   [study files](references/study-files.md).
   **Complete when:** the plan is pushed to the study's pull request, and no paid call by this
   study's harness predates the push (production's stored outputs do, by design).

2. **Build the budget guard in code, and arm it before it guards anything.** An intention does not
   stop a retry loop at two in the morning. The guard is single-threaded by design, and its parts
   are detailed with a sketch in [the budget guard](references/budget-guard.md):
   - **One paying process, one call at a time.** The process holds an exclusive lock the kernel
     releases when it exits or dies — `flock` or its equivalent — for the whole run, and admits,
     sends and settles calls strictly one at a time. The cap is hard only under this rule.
     Concurrency is out of scope: parallel calls, a second process, locks on shared storage and
     lock takeover each void it.
   - **One research key for every paid call**, refused at start-up unless the account the provider
     names for it is not production's — never by unequal keys alone, nor by the plan's say-so — or
     while the harness holds any other paid credential.
   - **A hard study cap**, enforced by reserving before each call an upper bound on what it can be
     billed: every billable unit — tokens, per-request fees, images, audio, hosted search and tool
     invocations — at its maximum quantity and a ceiling price (the largest of the list price, a
     stated margin over it, and the provider's maximum), for every attempt it may make; the client
     library's own retries are off, or the guard refuses to start. A unit with no cap in the
     request, or missing from the price table, makes the call unadmittable. A call is admitted
     only while `spent + reserved + worst <= cap`, and while its stage — output parity, the main
     run, judging — stays within its own pre-registered cap too. A cap checked after the call is a
     report, not a cap.
   - **A balance floor, read before every admission, that latches.** A call is admitted only if
     the account's balance just read — never a key's own limit — less everything the study has
     settled, which no balance is assumed to show yet, and every reservation still standing, stays
     at or above the floor after the call's worst case. A read below that, or a read that fails,
     latches the run and writes a STOP flag with the reason; a later, healthier read does not lift
     it. With no balance endpoint, the plan says the floor is unavailable and the caps govern alone.
   - **Settle each call before the next.** The cost is the larger of the list-price and the
     provider-reported cost for every attempt, retries and failures included, summed. A settled
     cost above its reservation latches, writes STOP and closes the ledger: continuing takes an
     addendum and a new ledger. The reservation row is on disk before the call is sent, and the
     settled rows before the next admission.
   - **Restart by re-deriving every invariant from the ledger.** A new process restores the study's
     and every stage's totals from the settled rows, counts any reservation without a settlement at
     its worst case, checks every settled call against its reservation again — a run can die between
     a settlement and the latch it earned — and every total against its cap, latching on a breach,
     and refuses while a STOP flag or a recorded latch stands.

   Then arm it. Set the cap below one call's worst case and watch it refuse. Stub the balance below
   the floor and watch it latch and write STOP. Settle a call above its reservation and watch it
   latch. Kill the run between a reservation and its settlement, restart, and watch the reservation
   counted at its worst case. Write a settlement above its reservation with no latch, restart, and
   watch it latch. Start a second paying process and watch it refuse the lock.
   **Complete when:** each part has been watched refusing, every stub is restored before the
   freeze, and the evidence is in the study's audit log.

3. **FREEZE every input by hash.** Items, with their selection rule and seed; prompts; each arm's
   request parameters; policies; rubrics; judge prompts; model identifiers with their provider
   pins; every price table the budget guard reads; and every executable and configuration that can
   change a request, a spend decision or a verdict — harness, the guard armed in step 2, judge
   runner, scorer, `reproduce.sh` — with the runtime's version and the dependency lock. Before
   freezing, read every metric's definition against a handful of real items, the awkward ones
   included. A definition that counts "this field does not apply" as an invented answer will flip
   a verdict, and only a real example shows that it does.
   **Complete when:** every input the run will read, and every file of code and configuration it
   runs, has a hash in the committed freeze, and each metric definition was checked against items
   named in the plan.

4. **Prove request parity and dry-run every arm, offline, and commit it before any paid call.**
   Build — without sending — the request production sends and the request each arm would send,
   for the same real items ([parity and controls](references/parity-and-controls.md)). The
   control's request must equal production's: the same system prompt, message layout, tool and
   schema definitions, parameters and provider pin. Each other arm's request may differ from it
   only where the plan intends — the model, the prompt under test — and nothing else: not a
   reordered message, a dropped schema field, a changed temperature. Pin the serving provider in
   every arm's request: different providers of the "same" model can answer differently, and a
   router may pick the provider by the request's layout, so a layout change can silently change who
   serves the call. Where production's own request leaves its provider to a router or a fallback,
   the control cannot equal it and be pinned: such a study is out of scope.
   **Complete when:** the request-parity diff and every arm's diff are committed, every line of
   difference is intended, and this study's harness has made no paid call.

5. **Prove output parity as the first paid stage, under its own pre-registered cap.** Run the
   control arm alone on the items the plan named for this stage, and compare its answers with what
   production stored for them, against the pass rule the plan gave. Check the provider that served
   every call against the pin. The stage spends only within its own cap, inside the study's, and
   the guard enforces that cap at every admission. A control that fails its pass rule stops the
   study here, with an addendum, because everything measured against it would compare two systems
   neither of which is production's.
   **Complete when:** the stage ran under its own cap, its plan committed before its first call;
   every call was served by the pinned provider; and the result against its pass rule is committed
   — or the study stopped with an addendum saying why.

6. **Run, with the controls that make a difference readable.**
   - **An A/A distribution, not a single draw.** Run the baseline arm several times over the same
     items, or resample paired item-level differences between baseline runs, and estimate how far
     the control differs from itself — a distribution with its interval, not one number. A
     difference between arms inside that distribution is not a finding. A single A/A comparison is
     a diagnostic, able to show that the harness is unstable, but never a floor and never a veto.
   - **A layout-only control** whenever a content change can also change the prompt's layout or
     its caching: an arm that carries the layout change without the content change, so the two
     effects can be told apart.
   - **Arms interleaved per item.** Every arm answers item 1, then every arm answers item 2.
     Running arm A on Monday and arm B on Tuesday measures Tuesday.
   - **The same inputs for every arm.** An arm that lacked an input for some items lost those
     items for a reason the study is not about.

   **Complete when:** every baseline repeat, every arm and every control have run over the frozen
   items, interleaved; the A/A distribution is estimated with its interval and its method; and
   every response is stored raw with its cost.

7. **Put every change after the first paid call in a dated ADDENDUM, pushed before the calls it
   governs.** A scorer bug fixed, an item dropped because its source vanished, an arm added, a bar
   clarified: each gets the date, what changed, why, which calls and numbers it affects, and the
   commit it was written on. It is pushed to the study's pull request before the first call it
   governs — the plan's anchor, not a local commit. A file cannot name the commit that adds it, so
   the audit records the addendum's commit, its push and the first call it governs. An addendum that
   changes a frozen file re-runs every gate that read the old bytes, before that call, and pushes the
   results with it. A change discovered after its calls ran is recorded as a correction to those
   calls. It is never backdated, and what it invalidates counts toward no verdict until redone.
   **Complete when:** every change since the first paid call has an addendum; each one made before
   its calls was pushed before the first call it governs, with every gate on a file it changed
   re-run, and each found after them is marked as a correction to them, never backdated.

8. **Judge with three vendors, and let the judges see provenance**
   ([judging and metrics](references/judging-and-metrics.md)).
   - Three judges from three vendors, all on the one account; the verdict is the 2-of-3 majority.
   - **Tag the evidence with where it came from.** Every field shown to a judge says whether the
     source holds it or a model wrote or guessed it, and each judge gets a second, source-only
     reading as well. A judge shown the same untagged evidence as the model cannot tell an
     invented fact from a sourced one; it grades the invention as correct, fluently.
   - **Report each judge alone** beside the majority, so a verdict that rests on one judge's taste,
     or on a judge favouring its own vendor, is visible.
   - **One panel verdict per normalised (item, answer)**, reused by every arm that gave that answer.
   - **Judge only where the arms differ**, if cost forces it, and only on item-wise additive
     metrics — never invention, whose denominator the judges decide; before relying on it, prove on
     a fixture that the shortcut gives exactly the verdicts that judging everything gives.

   **Complete when:** every item — or, under a shortcut the plan registered, every item where the
   arms differ — has three raw judge verdicts, the majority and each judge alone are reported, and
   any shortcut has a passing exactness test.

9. **Score against the bars as registered, and report more than the bars.**
   - Invention is reported against its own bar: not folded into accuracy, not left to a footnote.
   - Denominators match across arms: the same items, or a stated reason why not, with the count
     on each side.
   - Every percentage carries its predicate beside it: "4.1% of the items whose source determines
     the answer (n = 612)", never a bare "4.1%".
   - **Passing the bar is not being better.** A non-inferiority bar answers "is it safe to switch?"
     Beside it, report the observed quality, the harm and the cost per item and at the expected
     volume, so that a reader can see which arm is better and not only which one passed.

   **Complete when:** every bar has a pass or a fail with its point and its interval, and quality,
   harm and cost per arm stand beside the bars, each percentage with its predicate.

10. **Make every number rebuildable offline.** `reproduce.sh` rebuilds every table and figure from
    committed data, with no network and no key. A checksum manifest lists every file it consumes,
    including files read from other studies, but itself, which its pushed commit anchors; the script
    checks every frozen file and the runtime against the freeze itself, then the manifest, before it
    computes anything. No module in the study may share a name with a standard-library module or
    with another study's module, or the reproduction runs different code depending on where it was
    started.
    **Complete when:** a clean checkout runs `reproduce.sh` offline to byte-identical outputs, and
    the manifest covers every other file the run opened.

11. **Arm every gate by mutation, and watch each one fail.** Tamper with one row of raw data;
    remove one manifest line; mutate one scorer rule. Run the reproduction after each and watch it
    refuse. Restore from a byte copy taken before the mutation, never from version control, which
    discards any uncommitted work in the same file along with the mutation.
    **Complete when:** each gate has a recorded failing run under a named mutation, and a passing
    run after a restore that was checked by content.

12. **Review every study pull request independently, and record corrections in the open.** Each PR
    gets an independent review round (`codex-review-loop`). A finding that changes a published
    number becomes a correction — what was wrong, what changed, which numbers moved and by how
    much — in an addendum or in the round's review record. It is never repaired silently in place.
    **Complete when:** every PR has its review record, and every number that changed after it was
    published carries its correction.

13. **Write the report for the decision, and say what the study cannot tell.** The verdict per bar;
    quality, harm and cost per arm; each judge alone; the A/A distribution; every correction; and what
    the study did not cover — item types it did not sample, providers it did not pin, volume it
    did not price.
    **Complete when:** the report answers the plan's question in the plan's terms, and a reader can
    trace every number in it to `reproduce.sh`.

## Usage Examples

```text
Before we switch the ticket classifier to the cheaper model, run a preregistered study. Commit the
plan, the freeze and a dry run before you spend anything, and cap the spend in code. I want to know
whether it passes the bars and, separately, whether it is actually better, and what it costs at our
volume.
```

```text
The last comparison's judge preferred the answer that made things up. Rerun the judging with three
vendors, tag which fields the model wrote or guessed, give each judge a source-only reading too, and
report every judge on its own as well as the majority.
```

```text
Prove the harness sends what production sends before we measure anything. Show me one real item's
request from production and from the control arm, diffed, with the serving provider pinned on both.
```

```text
We changed the scorer after the first batch of calls. Write the addendum — what changed, why, which
calls it governs, which published numbers move — and push it before the next batch runs.
```

```bash
# Rebuild every number offline; the script checks the manifest before computing anything.
./reproduce.sh

# Arm the manifest gate: drop one line, watch the run refuse, restore from a byte copy.
cp MANIFEST.sha256 MANIFEST.sha256.bak
tail -n +2 MANIFEST.sha256.bak > MANIFEST.sha256
./reproduce.sh; echo "exit $? (expected non-zero)"
cp MANIFEST.sha256.bak MANIFEST.sha256 && cmp MANIFEST.sha256 MANIFEST.sha256.bak && ./reproduce.sh
```

## What it looks like

Specimens, not prompts.

### A result a reader can check

```text
Bar 2 — invention: an answer given where the source cannot determine it
  predicate: items whose source leaves the field undeterminable; same items in both arms
             (n = <n> per arm)
  arm A <a>%   arm B <b>%   difference B-A <d> points, 95% interval [<lo>, <hi>]
  bar (from PLAN, commit <sha>): B-A <= 1.0 point and upper bound <= 2.0
  result: FAIL — the upper bound is above 2.0
  each judge alone: J1 FAIL, J2 FAIL, J3 pass; majority FAIL
  A/A distribution (<k> baseline runs, paired resampling): 95% of A-vs-A differences within +/- <f> points
  rebuilt by: reproduce.sh -> tables/bar-2.csv
```

Every number has its predicate, its interval and its source; the bar is quoted from a commit that
predates the calls; the judges are visible one by one; and the A/A distribution says how much of
the difference the control produces against itself.

### The same result, reported badly

```text
Model B hallucinates slightly less than A (3.9% vs 4.1%) and costs 60% less, so it's the winner.
```

No predicate: nobody can tell what the 3.9% is a share of. No interval or A/A distribution: the gap
could be the control disagreeing with itself. "Winner" answers a bar that only asked whether B was
safe to switch to. No judge is visible, so it may rest on one judge's taste; no number is rebuilt.

## Pitfalls

- **The bar that moved.** A threshold chosen after the results are in always fits them. Only a
  committed plan with an earlier timestamp separates a bar from a description of the outcome.
- **A rule definition nobody read against an example.** Counting a "no" on a field that does not
  apply the same as an invented "yes" flipped one study's winner. The definition read sensibly;
  a single real item showed what it did.
- **A passed gate written up as the winner.** Non-inferiority says "no worse than the control by
  more than X". It says nothing about which arm is better, and a report that calls the passing arm
  "better" has answered a question the study never asked.
- **A judge that cannot see invention.** Given the same untagged evidence as the model, a judge
  reads a guessed field as a sourced one and marks the answer correct. Provenance tags and a
  source-only reading are what let it notice.
- **A harness that was not production.** A reordered message, a missing schema field or a default
  parameter makes the control a different system. Everything measured after that compares two
  systems that are not the one being decided about.
- **The "same" model from a different provider.** Providers serving one model name can answer
  differently, and a router that picks by request layout can move an arm to another provider
  when only its layout changed.
- **A broken control.** A fresh control run with a fault in it makes every other arm look better.
  Compare the control with production's stored outputs before trusting it as the baseline.
- **Unequal inputs.** One arm missing an input for some items loses those items for a reason the
  study is not about, and the loss is reported as the model's.
- **A reservation that is not a bound.** A cap checked after the call reports money already spent;
  a reservation at list price, or counting tokens only, is exceeded by the first call billed above
  list or that also searched the web, and the cap with it. Reserve every billable unit at a ceiling
  price, first.
- **Parity paid for before it was planned.** Running the control "just to check parity" is a paid
  call nothing constrained, and both its spend and its result arrive before the plan could. Request
  parity costs nothing and belongs in the dry run; output parity is a paid stage with its own cap.
- **More than one call in flight.** Two paying processes, or parallel calls in one, each reserve
  against a total the others have not added to yet, and together spend past the cap. This guard's
  cap is hard only for one process, one call at a time.
- **One A/A pair taken as the noise floor.** Two runs are one draw of how far the control differs
  from itself. Treated as a hard floor, it vetoes real differences on a lucky draw and passes
  noise on an unlucky one.
- **A reproduction that read more than its manifest.** A file read from another study changed
  underneath, unlisted; a module named like a standard-library one, or another study's, ran
  different code depending on the directory the reproduction was started from.
- **The silent repair.** A number corrected in place with no record spends the trust every other
  number depends on.

## Verification

- [ ] The question is written as a decision, naming who makes it.
- [ ] PLAN, FREEZE and DRY RUN were each pushed to the study's pull request before its first paid
      call, and the remote's push record shows it.
- [ ] Every bar has a point rule and an interval rule, and invention has a bar of its own.
- [ ] Every metric definition was read against named real items before it was frozen.
- [ ] The data was classified before any paid call, every recipient is approved for it, and every
      artefact carrying it is kept where its class allows.
- [ ] The freeze hashes every executable and configuration that can change a request, a spend
      decision or a verdict, with the runtime's version and the dependency lock.
- [ ] Every paid call went through the one research account, not production's, and the checks that
      refuse production's account, by the account the provider names for each key, and any other
      paid credential ran.
- [ ] One paying process held an operating-system lock for the run, and calls were admitted, sent
      and settled strictly one at a time.
- [ ] Before each call the guard reserved an upper bound on its bill — every billable unit at its
      bound and a ceiling price, for every attempt, the client library's own retries off — and
      checked the study cap and the call's stage cap; a unit with no cap or no price was refused.
- [ ] Where a balance endpoint exists, the account's balance was read before every admission,
      less everything the study settled, and a call that would cross the floor, a balance below it,
      or a failed read latched the run and wrote STOP; where none exists, the plan records the floor
      as unavailable.
- [ ] Each call was settled, at the larger of list and reported cost per attempt, before the next
      admission; a settlement above its reservation latched the guard.
- [ ] A restart restored the study's and every stage's totals from the ledger, with unsettled
      reservations at their worst case, and rechecked every settled call against its reservation
      and every total against its cap before admitting anything. Each part was watched refusing.
- [ ] Request parity was proven offline, in the dry run, before the study's first paid call: the
      control's request equals production's, with the provider pinned in every arm's request and in
      production's own; every dry-run difference from production's request is intended.
- [ ] Output parity ran as the first paid stage, under a cap and pass rule committed before its
      first call, and every call was served by the pinned provider.
- [ ] The A/A distribution was estimated from repeated baseline runs or paired resampling, with
      its interval; no single A/A pair was used as a floor or a veto; a layout-only control ran
      where layout or caching could change; arms were interleaved per item; every arm had the same
      inputs.
- [ ] Every change after the first paid call has a dated addendum: one made before its calls was
      pushed before them, with every gate on a file it changed re-run; one found after them is
      marked as a correction, never backdated.
- [ ] Three judges from three vendors scored every item — or, under a shortcut the plan
      registered, every item where the arms differ, with absolute rates reported as not measured;
      the majority and each judge alone are reported; judges saw provenance tags and a source-only
      reading. A shortcut covers only item-wise additive metrics, never invention, and has a passing
      exactness test on a fixture.
- [ ] Denominators match across arms, and every percentage carries its predicate.
- [ ] The report gives quality, harm and cost beside the bars, and does not call a passing arm
      better on the strength of the bar alone.
- [ ] `reproduce.sh` rebuilds every number offline, byte-identically, from a clean checkout, under
      the frozen runtime and dependency lock.
- [ ] The manifest covers every other consumed input, files from other studies included.
- [ ] Each gate was armed by a named mutation, watched failing, and restored from a byte copy.
- [ ] No study module shadows a standard-library module or another study's module.
- [ ] Every study PR has a review record, and every number that changed after publication carries
      its correction.

## Deeper reading

- [Study files](references/study-files.md): the directory layout, the PLAN, FREEZE and ADDENDUM
  templates, the shape of `reproduce.sh` and the manifest, and what the report and the audit carry.
- [The budget guard](references/budget-guard.md): its single-process scope, the parts, a sketch of
  the admission path, the restart, and how to arm each part.
- [Parity and controls](references/parity-and-controls.md): request and output parity, pinning
  providers, the A/A distribution, the layout-only control, and interleaving.
- [Judging and metrics](references/judging-and-metrics.md): the panel, provenance, each judge alone,
  the shortcut and its exactness test, invention, denominators and predicates.
