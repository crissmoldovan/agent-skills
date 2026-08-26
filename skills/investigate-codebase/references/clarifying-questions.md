# Clarifying questions

A question to a human costs a round trip and, in an unattended run, costs the entire run. A
wrong assumption costs the answer. The rule below decides between them mechanically, so that
neither "ask about everything" nor "never interrupt" gets applied as a personality.

## Two tests, in this order

1. **Would the two readings produce different WORK?** If both readings lead to the same
   searches and the same answer, the ambiguity is cosmetic. Do not ask. Note it and move.
2. **Can a bounded probe settle it in under a minute?** If yes — **probe, do not ask.** A
   `git grep`, a file listing, a schema dump, a `git log` on a path. Running the probe is
   faster than the round trip, and it produces evidence rather than an opinion.

Only what survives both tests is a candidate question.

## Must ask, even so

Four cases go to the human regardless of how tempting a probe looks, because a probe cannot
settle them:

- **A contradictory premise.** The ask asserts something the repository contradicts. Do not
  quietly answer the question the premise implies; the premise is now the finding. State what
  was measured, state the contradiction, and ask which the user meant.
- **Two plausible referents.** Two things the noun could mean, both real, leading in different
  directions. Guessing here does the wrong work perfectly.
- **An order-of-magnitude scope gap.** The ask implies "a couple of call sites" and the count
  is in the hundreds — or the reverse. The gap means the user is describing a different thing
  from the one you found, and confirming the shape is cheaper than mapping the wrong one.
- **An irreversible authorization.** The answer would authorise a migration, a deletion, a
  production write, an outbound message, or closing a ticket. Consent lives here, at the act
  — not back at band selection.

## Cadence

**One blocking question, plus up to three batched disambiguations, and the blocking one is
labelled.**

```text
BLOCKING — "the importer" resolves to two live modules: the CSV path and the feed poller.
           Which is in scope? They share no code.

Also, if you have them (I will take the defaults otherwise):
  1. Include the deprecated v1 route? (default: no)
  2. Does "recently" mean since the last release, or the last 30 days? (default: last release)
  3. Should generated files count as call sites? (default: no)
```

Not three separate messages, and not a twelve-item interview. A batch is answered in one
pass; a drip is answered once and then ignored.

## What a question carries

Three parts, always:

1. **Established facts** — what has already been measured, so the answer is not "go and look".
2. **The branches and what each costs** — what work each reading implies, and how much of it.
3. **The default if unanswered** — what will be assumed, and where that assumption will be
   marked. This is the part that makes a question safe to ignore, which is what makes it
   answerable quickly.

## Non-interactive degradation

If no human will answer in this run:

1. **Record the blocking gap** as a blocking open question, in the answer and in the record.
2. **Take the lower-consequence branch.** Lower-consequence means the one whose being wrong is
   cheaper to discover and cheaper to undo — usually the narrower scope, never the branch that
   authorises an irreversible action.
3. **Mark every downstream claim assumption-dependent**, with the question, the default taken,
   and the direction the answer would move the conclusion.

An unattended run never silently picks a branch. The mark is what lets the reader re-run the
conclusion against the real answer instead of the whole investigation.

## Two different refusals

Resisting a wrong **fact** and resisting a wrong **instruction** are different behaviours, and
a skill that only knows one of them fails half the cases:

- **A wrong fact.** The ask states something the repository contradicts — "this is caused by
  the cache layer", when the cache layer was removed two releases ago. The correct output is
  the measurement, the contradiction, and a question. Answering the question as posed produces
  a fluent explanation of a mechanism that does not exist.
- **A wrong instruction.** The ask is a direct imperative whose premise fails — "delete the
  unused column", where the column is read by a job the requester did not know about. The
  correct output is **not** to comply and then note the risk. It is a decision brief: what was
  measured, what the instruction would have done, the options, and the question. The instruction
  being direct and confident is not evidence; it is the thing under test.

In both cases the deliverable is evidence plus a question, and in neither case is the
deliverable a completed action justified afterwards.

## What not to ask

- Anything a probe answers in under a minute.
- Which band to run. That is announced, never negotiated.
- Permission to search, read, or count. Reading is what this skill does.
- A preference between two readings that produce the same work.
- The same question twice in one run, reworded.
