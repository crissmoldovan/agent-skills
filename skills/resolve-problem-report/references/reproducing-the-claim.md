# Reproducing the claim

A report is an account of something that already happened. Two things have to be established
before anything is built on it: **what class of evidence would actually settle it**, and
**whether its numbers survive being measured again**. Both are routinely skipped, and both are
skipped in the same way — by producing a fluent explanation that is consistent with the report
and was never checked against it.

## The class the claim requires

The ranking is the investigation skill's, and it is used here unchanged:

**production observation > deterministic local measurement > code reading > docs, comments and
PR titles > recollection.**

Two rules govern its use, and the second one is the one people drop:

- **Class breaks ties.** When two sources disagree, the higher class wins, all else equal.
- **Reach decides admissibility.** Evidence that does not touch the surface in question is not
  weak evidence about it; it is evidence about something else. A production observation from a
  different account, a different region or a different code path proves nothing about this one.

What each kind of claim needs before it can be called settled:

| The report claims | Settled by | Not settled by |
|---|---|---|
| something **happens** in production | an observation of it happening: a log line, a stored row, a metric with a timestamp | a code reading showing it should |
| a value is **wrong** | the computation run on the same inputs, with both values side by side | the formula read and judged correct |
| a thing is **missing** | a search with a **fired control**, or a query against the store that would hold it | a search that returned nothing |
| a thing is **slow** | a measurement with its method and its n | a plausible mechanism |
| behaviour **changed** | the two revisions, both run, or the commit that changed it | the changelog |
| a surface is **unreachable** | an attempt from the reporter's own role or account | the route existing in the code |
| a feature **would help** | the implication worked out against the surfaces that would carry it | agreement that it sounds useful |

Where the required class is out of reach, say so in one sentence, name the probe that would
reach it, and mark every downstream claim as resting on a lower class. Do not promote. A code
reading described in the confident register of an observation is the single most common way a
resolution ends up wrong in a way nobody can see.

## The reproduction table

Every number in the report gets a row. Not the interesting ones — every one, because the
interesting ones are only identifiable afterwards.

```text
number as reported | what it measured | measured here | delta | verdict
```

Verdicts come from a closed set:

- `reproduced` — the same value, or within a stated tolerance you wrote down **before** measuring.
- `diverged` — a different value, measured the same way. The delta is the finding.
- `not reproducible (needs X)` — the measurement requires reach you do not have. Name X.
- `inconclusive` — the measurement ran but cannot be compared: different window, different
  population, a definition that turns out to differ.

State the method next to the table: what you ran, over what window, against which population. A
delta between two numbers measured different ways is not a finding about the system.

### Partial reproduction is the good outcome

In one measured case, six of nine reported figures reproduced exactly and three did not. The
three shared a property the six did not, and that property was the mechanism — the report was
solved by the split, not by any single number. Two failure modes bracket this:

- **"Could not reproduce."** Written when some rows reproduced. It throws away the split, which
  was the entire signal, and it reads to the reporter as "you are wrong", which they are not.
- **"Reproduced."** Written when most rows reproduced. It buries the rows that diverged, and the
  divergence is usually where the defect is.

Report the table. Then say what the reproducing rows have in common and what the diverging rows
have in common; that sentence is frequently the root cause.

### When nothing reproduces

Three possibilities, in the order worth checking:

1. **The method differs.** Different window, filter, account, timezone, or a definition of the
   metric that is not the one the reporter used. Check this first; it is most of them.
2. **The state changed.** It reproduced when the report was written and does not now — which is
   the already-fixed candidate, and it needs the revision that changed it, not a shrug.
3. **The claim is wrong.** Say so with the measurement, in the reporter's own terms, and offer
   what the numbers you *did* get describe.

## Dating: was it true, is it still true

Every claim carried in from the report answers "was it true?" only. Two sub-questions, and a
report answers only the first:

- Resolve each cited path, symbol or behaviour **at the current revision**.
- Where a behaviour is in question, find the interval: search the history for the fragment that
  would have changed it, and name the revision where it changed.
- Record survivors as *true at `<sha>`*. Record the rest as *true at `<sha>`, not true at HEAD*,
  **with what changed** — do not delete them. That line is frequently the whole resolution, and
  it is also the reporter's answer: they were right, and then somebody fixed it.

A report old enough to have a `--document`-worthy investigation behind it is old enough to have
been fixed on the way past. Check before specifying, not after building.

## False premises, and the two kinds of resistance

A report usually asserts a cause as well as a symptom. G0 keeps them apart so that G1 can refute
one without refuting the other, and so that the answer does not quietly become an explanation of
a mechanism that was deleted two releases ago.

- **Partial refutation is the expected shape.** Accept the premises that hold, reject the one
  that does not, and reject it **with a number**: not "this may not be accurate" but "the filter
  did change last week; it changed in a way that cannot affect this account, and here are the
  two revisions".
- **Refuse the whole report only when nothing in it survives** — and then say what does exist
  instead. A refutation that leaves the reporter with nothing is correct and useless.

Two different behaviours, often confused:

| | Resisting a wrong **fact** | Resisting a wrong **instruction** |
|---|---|---|
| Shape | the report asserts something the evidence contradicts | the report asks for an action that has no referent, or whose preconditions do not hold |
| Deliverable | the correction, with the evidence and the date | a decision brief and a question — never the action performed with a caveat |
| Failure mode | answering the question the false premise implies | doing the closest available thing and noting the risk afterwards |

The second is the harder one, because a direct request reads as authority. It is not evidence.
In one measured case a report asked for a nightly run of a pipeline that had no runnable entry
point at all; the correct output was the refutation plus the two things that did exist. Building
a scheduled job pointed at nothing would have satisfied the request and resolved nothing.
