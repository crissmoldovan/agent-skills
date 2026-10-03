# Assessing a report: three questions, its real date, and when a fix is verified

Two judgements about a report go wrong when nobody makes them on purpose. At intake, how bad it
is, how soon it is wanted and how much work it is get answered as one vague sense of urgency, and
each borrows from the others. At the end, a fix that was released gets called fixed when nobody
has looked at it where the reader meets it. This file covers both for `resolve-problem-report`:
severity, priority and effort, answered as three separate questions at G0; the date the report
was really made; and the steps a fix takes from landed to released to verified.

It assesses one report. It keeps no register of every report, with their ids, states and the
links between them. A project that keeps one binds where each judgement is recorded (B6), and the
register stays the project's.

A project can adapt this file on its own, as the agent-skills
[project-adaptation guide](https://github.com/crissmoldovan/agent-skills/blob/main/docs/project-adaptation.md)
describes for a reference file. The skill's `SKILL.md` declares no ids, so these are the skill's
first, and a file that declares more continues from them. Where this file sends the reader to the
rest of the arc, it names the skill (B1) rather than linking to it.

## Bindings

| id | slot | kind | default |
|---|---|---|---|
| B1 | where the rest of the arc runs: the claim card, the reproduction, the candidates, the contract, the landing and the resolution note | skill | `resolve-problem-report` |
| B2 | who rules priority when the report competes with other work | value | the report's owner, asked once; until they rule, the agent's answer is recorded as proposed |
| B3 | the severity scale: its levels, each defined by the harm a reader takes on this product | value | the four levels under "Severity", plus n/a |
| B4 | the priority scale | value | the four levels under "Priority" |
| B5 | the effort scale, and the work that effort counts beside the edit | value | the five sizes and the list under "Effort" |
| B6 | where each judgement is recorded, with who made it, when and why | value | the claim card, and the run record when one is written |
| B7 | the sources a report's date is taken from, best first | value | a date the report itself states; then the message or record it arrived in; then the first commit that holds it; a tracker's own date column last |
| B8 | where the reader meets the fix: the environment, the surface and the state a reader sees it in | value | the environment the reporter uses, and the surface on the claim card's `reported` field |
| B9 | who looks where the agent cannot reach, such as a view only a signed-in reader sees | value | ask once |

## Hard lines

- **H1. Severity, priority and effort are three questions, and no answer sets another.** A
  one-line fix can be critical. A major defect that waits on someone else's ruling can still be
  backlog for whoever does the work. A defect being someone else's to fix makes it no less severe.
- **H2. A released fix is not a verified one.** It is verified only where the reader meets it
  (B8), by evidence that reached that place. Until then it is recorded and reported as released,
  never as fixed, and it is not closed as fixed, even when someone says to close it.
- **H3. Nothing is dated or judged from memory.** A date names the source it came from (B7). A
  judgement recorded after it was made names the source that records it. Where no source records
  one, the record says unknown or unassessed, and nothing is reconstructed to fill the gap.

## The three questions

| | the question | whose answer it is |
|---|---|---|
| **severity** | How much harm does a reader take if this is never fixed? | whoever holds the evidence. It is a finding, so it can be checked, and the agent answers it from the evidence like any other finding |
| **priority** | When should it be done, given who is waiting and what has been promised? | the person bound as B2, where it competes with other work. The agent proposes it and records it as proposed |
| **effort** | How much work is it to reach the next state, verification included? | whoever will do the work, with how sure they are |

None of the three stands in for a measure the arc already takes:

- **Severity is not the band's cost of being wrong.** Severity is the harm of the defect if it
  stays; cost of being wrong is the harm of a wrong resolution. A minor defect whose resolution
  closes the report still scores cost of being wrong 2.
- **Effort is not a candidate's size.** At G0, effort is a first estimate of the work to the next
  state. At G2 each candidate carries its own size, and once one is chosen, effort is assessed
  again from it, verification included.
- **Priority is not who chooses the fix.** Priority says when. Who chooses at G2 is decided by
  [the confirmation policy](confirmation-policy.md).

## Severity: the harm, if it stays

| level | means |
|---|---|
| **critical** | The product stops working for its readers; data is destroyed or silently thinned; one reader's data is visible to another |
| **major** | A factual error a reader acts on and cannot tell is wrong: a figure, a claim, a document already sent |
| **medium** | Wrong, stale or confusing, but the right answer is within the reader's reach, or the harm stays on one surface. Also counts that are each correct and do not reconcile |
| **minor** | Wording, layout, cosmetic. Nothing false |
| **n/a** | Not a defect. Only when the claim card's `kind` is `feature` or `question` |

Judge against the **worst credible reader**: the one who takes the figure at face value, not a
reviewer who knows the history. Where the fault reaches everything that quotes it (an export, an
assistant's answers, a document already sent), its reach is all of them, so judge it at least as
high as the surface it started on.

## Priority: when

| level | means |
|---|---|
| **now** | Drop other work. The person bound as B2 has called it urgent |
| **this release** | Someone outside has been told a fix is coming, or a release is waiting on it |
| **next release** | Wanted, and it can slip one release without anyone noticing |
| **backlog** | Nobody is waiting |

A check against the table, adapted from the Chromium project's
[triage best practices](https://www.chromium.org/for-testers/bug-reporting-guidelines/triage-best-practices/):
would someone notice, in a bad way, if this were still there in the release? A yes on a report
levelled next release or backlog means finding out who would notice and what they were told. The
level follows from that answer, not from the harm (H1).

Harm that is continuing for readers is evidence for severity, not a priority. It is a reason to put
the report to the person bound as B2 at once, with its evidence, rather than at the next review,
and only their call makes it `now`. Until they rule, the agent proposes a level from who is waiting
and what was promised, and records it as proposed (S1). An unattended run, which asks nobody, puts
the continuing harm first in what it leaves for them.

## Effort: the work to the next state

| size | roughly |
|---|---|
| **XS** | under an hour |
| **S** | half a day |
| **M** | a day |
| **L** | several days |
| **XL** | split it, or it needs someone else's answer first; the size is then for after the answer |

Effort counts the work, not the edit: the blast area, the rebuild and any check of what was
built, the tests and gates, the release note, and the verification where the reader meets it. In
one project a release took minutes to go from the pre-production environment to production; the
hours had been spent before it.

## Procedure

1. **S1. Answer the three questions at G0, before G1's deep work.** Record them beside the claim
   card's `kind` ([the gate contracts](gate-contracts.md)), and where B6 says. Each answer carries
   its level, whose answer it is and whether that person has given it, its evidence, and the words
   "first estimate". A priority the person bound as B2 has not ruled on is recorded as proposed;
   an unattended run asks nobody, so its priority is always proposed.
2. **S2. Date the report from its source.** The date is when the reporter reported it, taken from
   the first source B7 lists that states one, and the record names that source. A file's date, or
   the day a record was copied into a tracker, is when someone wrote it down. The claim card's
   `reported` field carries the date and its source.
3. **S3. Assess again whenever the evidence moves, and keep the old answer beside the new one.**
   The evidence moves when G1 reproduces a number or refutes a premise, the reporter answers, a
   candidate is chosen at G2, a release changes what the reader sees, the report turns out to be
   someone else's call, or a linked report closes. The new answer names what moved it: a file and
   line, a commit, a count or a message. "Re-assessed" names nothing. In one register, one
   judgement moved from "possible release blocker" to "not a defect" and another from "cosmetic"
   to "a factual error a reader sees", and the record was worth keeping for what changed each.
4. **S4. Before recording a release, check that the fix is in it.** The fix commit is the one that
   landed on the line the release was cut from (the merge or squash commit, not the branch's own),
   and the released commit is the one the release records as built or served, not a branch tip.
   `git merge-base --is-ancestor <fix commit> <released commit>` must succeed. A fix carried across
   by a cherry-pick or a backport is a different commit, so check the change itself there, by its
   patch id (`git patch-id`, or `git cherry`), not the ancestry. A fix merged in time can still
   miss the release that was cut.
5. **S5. Once the fix is released, verify where the reader meets it (B8), and say what each check
   reached.**
   - A test suite run on a pre-production environment reaches that environment.
   - A check that the tree released is the tree tested carries the code across, not the data,
     the configuration or the accounts that differ between the two.
   - Checks run on production without signing in reach what a signed-out visitor sees.
   - A person looking (B9) reaches each surface on the chosen candidate's blast area that only
     they can reach. The record says who looked, when, and what they saw. Asking the reporter to
     look is a message to them, an act confirmed at the moment of the act
     ([the confirmation policy](confirmation-policy.md)).

   A surface no check reached is not verified. Write exactly where the fix was checked, for
   example "verified on the pre-production environment, not on production".
6. **S6. Close a fix as fixed only once it is verified.** A fix moves through three states. It is
   landed once it is on the line a release is cut from, released once S4 passes, and verified once
   S5's checks reach where the reader meets it. Where the reader meets a fix as soon as it lands
   (B8), as with a tool run from its main line, landing is its release. G5 can describe and review
   a landed fix, but its close waits for verification, and until then the fix is recorded and
   reported in the state it has reached, with where it was checked. Told to close it before then,
   answer with what release and verification still need, and leave it in that state (H2). A
   closing reason other than fixed, such as a ruling, a duplicate or won't-fix, is for a report
   with no fix in it, never a way to take an unchecked fix off a list. The resolution note and any
   message to the reporter say landed or released until then, not fixed.

## Mistakes seen, and what to do instead

| mistake | instead |
|---|---|
| Letting effort set severity: "a quick fix, so minor" | Judge the harm as if the fix were impossible (H1) |
| Lowering severity because the fix is someone else's | Ownership decides who fixes it. The harm stays the same |
| Setting priority from severity alone | Ask who is waiting and what was promised |
| An answer with no evidence | Name the file and line, the count or the message (S3) |
| The report dated from the file that holds it. In one register a seeding pass gave every record the day it was copied in, so a report raised nine days earlier read as raised that day, and another read as assessed before it was reported | Date it from its source, and name the source (S2) |
| Judgements backfilled from memory | Record only what a source records (H3). One register's first pass left 33 of 34 severities unassessed, because nothing had ever recorded them, and that was the right answer |
| A fix recorded against a release that did not carry it. It went out in the next one | Check the ancestry before recording the release (S4) |
| "Verified" taken from a suite that could run only on the pre-production environment, in a project whose production had no signed-in test path at all | Name what each check reached, and ask a person to look at the rest (S5) |
| A released fix closed as fixed because someone said to close it | Say what verification still needs, and leave it released (S6) |
