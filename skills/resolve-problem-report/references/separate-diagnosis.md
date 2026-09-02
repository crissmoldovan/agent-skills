# Falsifying the diagnosis

The rule is in `SKILL.md` at G1: reproducing every number does not test the cause, so
each causal claim gets its own row and its own falsification. This file carries the
evidence behind that rule, the shape of the test, and what it does to G2.

## The failure it catches is the competent reporter

A careless report is caught by the numbers. A careful one supplies accurate numbers
**and** a plausible mechanism inferred from them, and the mechanism is where the
error lives. The reproduction table tests only what was observed, so such a report
passes it completely while being wrong about everything that decides the fix.

Three measured cases in one day, same reporter, every reported figure `reproduced`,
and a build against each stated cause already written and passing its own tests:

- **"The join table contains duplicate rows — delete them."** The counts were exact.
  Duplicates: **zero**. The extra rows were a legitimate one-to-many the same
  reporter had asked for in an earlier ticket; the deletion would have destroyed
  them.
- **"The original value survives in the backup column, so it is recoverable."** The
  fill rate was exact. But most of that column was a byte-identical copy of the clean
  source and corrupted at half its rate — so the proposed recovery preferred the
  *dirtier* of the two. Simulated, it repaired none of the damaged rows and rewrote
  thousands of clean ones.
- **"These records have been through human review."** Zero of them had. No reviewer
  column existed in the schema at all, so review was not merely unused but
  unrecordable — and the fix wrote "verified" into every downstream prompt, where the
  artifact it produced would launder the false provenance into something later
  readers take as fact.

Two of those three builds were destructive rather than merely useless, and all three
arrived with green tests.

## Make the test a falsification

Name what must be true in the data if the mechanism holds, then go looking for its
**absence**. "Are there duplicates?" is settled by a grouped count returning nothing
— not by rows exceeding entities, which a legitimate one-to-many produces just as
readily. Confirmation is cheap and proves little; the absence is the test.

Verdicts come from the same closed set the reproduction table uses, so a refuted
mechanism is recorded rather than argued about.

## When the two verdicts disagree

**The symptom is still real.** Record the observation as confirmed and the mechanism
as refuted, carry the corrected cause into G2, and say so plainly: a reporter who
found a real problem is owed the finding, not a rebuttal.

## What it does to G2

An unverified diagnosis makes the do-nothing row heavier, because a faithful build
against a wrong cause is frequently destructive — and it arrives with green tests, a
confident note, and nothing in its presentation to distinguish it from a correct one.

Where G1 could not falsify the mechanism, put that in the candidate table rather than
letting the report's confidence carry unexamined into the build contract.
