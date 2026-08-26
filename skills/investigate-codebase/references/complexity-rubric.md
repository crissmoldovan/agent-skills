# The complexity rubric

Spend is decided before the first search, from observables, and the decision is said out
loud. That ordering is the whole point: a run that decides depth after it has already
fanned out has not chosen anything, it has rationalised what it did.

Five signals, each scored 0, 1, or 2 against an **observable** — something you ran, read,
or counted, not an impression. Write the observable down next to the score. A score with
no observable behind it is a guess wearing a number, and it is the first thing to
challenge when a run comes out mis-banded.

## The five signals

### 1. Scope — how much surface the question touches

| Score | Anchor |
|---|---|
| 0 | One file, or one symbol at one definition site. A first probe returns a handful of hits in one or two files. |
| 1 | One package or one surface. Tens of hits, all inside a boundary you can name. |
| 2 | Crosses surfaces, languages, or repositories — or the count is unknown until you search, which is itself a 2. |

Observables:

```sh
git grep -n "<term>" -- <paths> | wc -l      # hits
git grep -c "<term>" -- <paths> | wc -l      # files containing it
git ls-files -- <surface> | wc -l            # size of the surface named in the ask
```

Score from the count, not from the noun. "Just one function" is a claim about scope, and
`git grep` either supports it or does not.

**Score the artifact the question names, not the term repo-wide.** If the ask is "why does
`shouldSkipRow` in `import/filter.ts` drop this record", the scope signal is the reach of
**that function at that definition site** — its callers, its call sites, what it returns to —
and not the hit count for the word "skip" across the tree. Repo-wide hits for a term that
happens to appear in the question measure the repository, not the question, and scoring them
is how a one-file question buys a fan-out. Where the question names no artifact, the repo-wide
count is the right observable and a 2 for "unknown until you search" is honest.

### 2. Contradiction risk — does the ask assert a checkable attribution?

| Score | Anchor |
|---|---|
| 0 | Pure lookup. Nothing is asserted that could be false. |
| 1 | An attribution is asserted and rests on a single source — a ticket, a comment, one person's recollection. |
| 2 | Two sources already disagree, or the asserted attribution is the thing that decides the answer. |

Attributions look like: "X is caused by Y", "the runtime reads Z", "this was already
fixed", "nothing else calls it". Each is checkable, and each is wrong often enough that
scoring it 0 is how a fluent, false answer gets produced cheaply.

### 3. Repo size and toolchain count

| Score | Anchor |
|---|---|
| 0 | One package, one language, one build. |
| 1 | A handful of packages, or two toolchains. |
| 2 | A monorepo with many packages, more than two toolchains, generated code in-tree, or several deploy targets. |

Observables:

```sh
git ls-files | wc -l
git ls-files '*package.json' 'pyproject.toml' 'go.mod' 'Cargo.toml' '*.gemspec' | wc -l
```

**Where the question names its artifact, this signal contributes at most 1.** Size is scored
because it changes what an *unresolved* search means; a question that already resolves to one
file or one definition site has spent that risk before the first command runs. A monorepo does
not make "why does this function return early" a big question, and scoring it 2 because
`git ls-files` returned a large number is the most common way a light question is escalated.

Size matters because it changes what a search means. In a monorepo of roughly 2,500
TypeScript files and 592k lines, one measured pass found 184 exported names defined in
more than one file, with the repo's own conventions the worst offenders — one HTTP verb
handler name appearing 271 times. A bare-name search there answers a different question
than the one asked.

### 4. Ambiguity — are there two plausible referents?

| Score | Anchor |
|---|---|
| 0 | Every noun in the question resolves to exactly one thing you can point at. |
| 1 | A noun has one obvious referent and one unlikely one. |
| 2 | Two referents are both plausible and would send the work in different directions. |

A 2 here is also a must-ask trigger. Scoring it and then not asking is the failure this
signal exists to catch.

### 5. Cost of being wrong

| Score | Anchor |
|---|---|
| 0 | The answer informs a conversation. |
| 1 | The answer informs a change that review would catch. |
| 2 | The answer authorises a migration, a deletion, a production write, an outbound message, or closing a ticket. |

A 2 is about **reach**, not confidence. An answer that authorises something irreversible is
a 2 even when it feels obvious — especially then.

## Banding

Sum the five scores, maximum 10.

| Total | Band |
|---|---|
| 0–2 | light |
| 3–7 | normal |
| 8+ | deep |

These thresholds are tunable. They are provisional numbers calibrated against a scored
scenario suite, and the suite penalises needless escalation as hard as it penalises an
under-resourced answer — so moving them is a measurement, not a preference.

## The two overrides and the one start rule

1. **Cost-of-being-wrong = 2 forces at least normal.** No matter what the total says. A
   one-line question whose answer authorises a deletion does not get a light-band answer.
   This override never produces a question at mode time; it raises the band and arms the
   consent gates at the irreversible action itself.
2. **Re-score after pass 1, in either direction.** The first pass changes its own inputs — a
   scope you guessed at is now counted, an ambiguity has resolved or hardened, a contradiction
   has surfaced that nobody asserted. Re-score, and if the band moves, announce again. A run
   that discovers a contradiction and keeps its light band is choosing its budget over its
   answer — and a run whose pass 1 resolved the ambiguity, found the artifact and closed the
   scope keeps a deep band for exactly the same bad reason. **A downward re-score is as
   legitimate as an upward one.** The band is a decision about the evidence in hand, not a
   commitment made at minute one, and "we already announced deep" is not evidence.
3. **A named artifact asked *why* or *how* starts light.** When the question names one file or
   one function and asks why or how it behaves, the run **starts at the light band**: the
   boundary round-up below does not fire on it before pass 1, and it escalates only on evidence
   pass 1 actually produced — a contradiction that surfaced, a scope that turned out to cross
   surfaces, a referent that split in two. In exchange, the re-score after pass 1 is
   **mandatory** rather than merely allowed: a light start is a cheap first look, not a cap.
   Only rule 1 outranks it; a question whose answer authorises something irreversible still
   starts at normal.

## Boundary round-up

The thresholds are 3 (normal) and 8 (deep). **A total exactly one point below a threshold
rounds up one band, and the announcement says so.** So a 2 becomes normal and a 7 becomes
deep. Nothing rounds down.

```text
boundary: scored 2, rounding up to normal
```

The rule is deterministic and biased towards safety, and it is applied without asking. A
human in the loop at this point buys nothing: the information needed to decide is the five
observables, and they are already written down.

**One suspension, stated so it can be checked:** the round-up does not fire before pass 1 on a
question that names one file or one function and asks why or how (rule 3 above). Such a run
starts light and re-scores after pass 1, where the round-up applies normally to the new total.
Nothing else suspends it.

## Calibration examples

The five signals are scored from **the question's shape** — the artifact it names, the
attribution it asserts, the referents it leaves open, what its answer authorises. Not from the
size of the repository, and not from how much apparatus the run would enjoy using. The suite
these thresholds are tuned against penalises needless escalation exactly as hard as an
under-resourced answer, because the cost lands on the same person either way: **over-escalation
is a scored failure, not diligence.**

Three scorings, each pinning a reading that observed runs got wrong in the same direction.

### (a) A small change with one attribution to check

> "Change this function — it has exactly two call sites; the ticket says the retry wrapper is
> the cause."

| signal | observable | score |
|---|---|---|
| scope | the definition site's call sites → 2, in 2 files | 1 |
| contradiction | one authoritative-looking attribution, single source | 1 |
| size | monorepo, capped: the ask names its artifact | ≤1 |
| ambiguity | the function resolves; a second reading of "the wrapper" is unlikely | 0–1 |
| cost | informs a change review would catch | 1 |

Total 4–5 → **normal, and never deep.** Two call sites is a bounded scope, and one attribution
is one check — `git log -S` on the fragment, the wrapper opened, the branch read. The deep band
buys an adversarial pair to attack an answer; there is no answer here large enough to attack.

### (b) A finite, enumerable list in a very large repository

> "Work through these 14 flagged rows: for each, is it still failing, and is the fix merged?"

| signal | observable | score |
|---|---|---|
| scope | 14 items, enumerable up front, each the same two-question check | 1 |
| contradiction | nothing attributed | 0 |
| size | 2,500 files and 4 toolchains — capped: each item names its artifact | 1 |
| ambiguity | every row carries its own identifier | 0 |
| cost | informs a triage decision review would catch | 1 |

Total 3 → **normal, in a repository of any size.** This is the scoring the size signal distorts
most often: scored 2 on the repository instead of on the question, the total is 4 — still
normal. **Size cannot carry a finite, enumerable list into the deep band.** What makes such a
list expensive is the number of items, and the band buys depth per question, not throughput; a
deep band here multiplies the adversarial machinery by 14 and answers nothing it did not.

### (c) Why a named detector missed a named case

> "Why did `shouldSkipRow` not flag this record?"

| signal | observable | score |
|---|---|---|
| scope | one detector at one definition site | 0 |
| contradiction | nothing attributed — the miss is observed, not explained | 0 |
| size | capped: the ask names its artifact | 1 |
| ambiguity | both the detector and the record resolve | 0 |
| cost | informs a fix review would catch | 1 |

Total 2 → **light start** under rule 3: a named artifact asked *why*, so the round-up is
suspended before pass 1 and the run spends its first pass where the answer is — the record the
check actually saw, and the branch that returned the verdict (the reproduce-the-miss rule).
The **re-score after pass 1 is mandatory**, and that is where this question is allowed to become
expensive: a second referent, a contradicting source, or a scope that turns out to cross
surfaces bands the new total normally. A 2 that survives pass 1 unchanged rounds up to normal —
the suspension covers the first look, not the run.

## The announcement

One line, printed **before the first child is dispatched**, on the same code path whether
or not a human is watching. It carries the spend shape, so that the next thing said about
this run cannot be a surprise.

```text
investigate-codebase · <band> band — scope <n> (<observable>), contradiction <n> (<observable>),
size <n> (<observable>), ambiguity <n> (<observable>), cost-of-being-wrong <n> (<observable>)
= <total>[; <override>][; boundary: …] → <fan-out width>, <round cap>[, <estimate>]
```

Worked:

```text
investigate-codebase · light band — scope 0 (git grep -n "parseCursor" → 4 hits in 2 files),
contradiction 0 (nothing attributed), size 1 (2 toolchains), ambiguity 0, cost-of-being-wrong 0
= 1 → no children, single pass, 1 round
```

```text
investigate-codebase · normal band — scope 2 (git grep -n "registerJob(" → 41 hits in 18
files), contradiction 2 (two registries disagree), size 1 (14 packages, capped: the ask names
its artifact), ambiguity 0, cost-of-being-wrong 1 = 6 → 3 children + reconciler, 2 rounds max
```

The same question once the deletion is on the table and "the registry" turns out to name two
artifacts — a deep band carried by contradiction and cost, not by the size of the tree:

```text
investigate-codebase · deep band — scope 2 (41 hits in 18 files), contradiction 2 (authority
and absence both asserted), size 1 (14 packages, capped: the ask names its artifact),
ambiguity 1 ("the registry" → 2 artifacts), cost-of-being-wrong 2 (authorises a deletion) = 8
→ 4 children + reconciler, adversarial pair, 3 rounds max
```

A light start on a named artifact, with the mandatory re-score flagged in the line itself:

```text
investigate-codebase · light band — scope 0 (the ask names one function; git grep -n
"shouldSkipRow" -- src → 3 hits in 1 file), contradiction 0 (nothing attributed), size 1
(monorepo, capped: the ask names its artifact), ambiguity 0, cost-of-being-wrong 0 = 1
→ no children, single pass, 1 round; named-artifact start, re-score after pass 1 is mandatory
```

And the same run again after pass 1 turned up nothing that widens it — a band that stays where
it is, said out loud, so that "light" is visibly a decision rather than an omission:

```text
investigate-codebase · light band held after pass 1 — scope 0 (the branch that decided it is
at import/filter.ts:41), contradiction 0, size 1, ambiguity 0, cost-of-being-wrong 0 = 1
→ single pass, answer delivered with its coverage
```

A downward re-score, which is the same mechanism running the other way:

```text
investigate-codebase · normal band, re-scored DOWN from deep after pass 1 — scope 2 → 1 (the
41 hits resolve to one package once the definition site is fixed), contradiction 2, size 1,
ambiguity 0, cost-of-being-wrong 1 = 5 → 3 children + reconciler, 2 rounds max
```

```text
investigate-codebase · normal band — scope 1, contradiction 1, size 1, ambiguity 0,
cost-of-being-wrong 2 (answer authorises dropping a column) = 5; override: cost-of-being-wrong=2
holds the floor at normal → 3 children + reconciler, 2 rounds max
```

At the deep band, add a priced estimate **where the harness can produce one** — a token or
currency figure it actually reports. Do not invent a price; an estimate nobody computed is
the same decoration as a confidence percentage.

The announcement is never a question. Nothing waits on it, in either direction.

## User-initiated overrides

The user may say "go deep on this" or "light is fine". Those are recognised intents: they
force a **re-score** with the requested band as the floor or ceiling, and a **fresh
announcement** stating that a user override applied and what the observables said before it.

The skill never solicits an override. It does not ask "shall I go deeper?", does not offer
a menu of bands, and does not treat a boundary score as an invitation to consult. If the
user overrides down while cost-of-being-wrong is 2, honour the ceiling for depth and keep
the act gates armed — depth is theirs to choose, an irreversible action is still consented
to separately.

## Degradation

- **No subagents.** The bands survive as sequential passes with the same axes and the same
  contracts — announce that they are sequential and state the wall-clock cost the fan-out
  would have saved. A record that omits this reads as if a fan-out happened.
- **No model choice.** The band then controls depth only: how many passes, how many rounds,
  whether the adversaries run. Role names still describe who owns what; identifiers,
  profiles, and escalation belong to `model-routing` and are not restated here.
