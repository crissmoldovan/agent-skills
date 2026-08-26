# The confirmation policy

Two questions, kept apart because they have different answers. **Who chooses the fix** is a
question about consequence, answered once at the offer gate by reading two columns. **Whether to
take an act that cannot be undone** is a question about permission, answered at the act, every
time, regardless of what the columns said.

Confusing them produces the two failure modes this policy exists to prevent: a pipeline that
asks about everything, which nobody runs unattended twice; and a pipeline that asks about
nothing, which eventually mails a person or drops a table.

## The two-column rule, at G2

Read both columns. **Either one turning it on is enough.**

| Column | What it reads | Effect |
|---|---|---|
| **Cost of being wrong** | the complexity rubric's fifth signal scored **2**: the resolution authorises a migration, a deletion, a production write, an outbound message, or closing the report | confirmation **default ON** |
| **Reversibility spread** | the candidates **differ** in what a revert restores — one is a config flip, another rewrites stored rows | confirmation **default ON** |
| neither | a light-band report whose candidates are all equally revertible | **default OFF**, with a one-line notice |

Scoring the first column is not a judgement call for a report: **closing the report and messaging
the reporter both score it 2**, and almost every resolution ends in one of them. That is
deliberate. It means most reports get one confirmation, at the offer, which is the cheapest place
to put it — before a contract is written and before anything is built.

The second column catches the case the first misses: two candidates that are both reversible in
the ordinary sense but not equally. "Both can be reverted" is not the same as "a revert of either
leaves the same state", and the difference is exactly what somebody else should decide.

## What "confirmation at G2" means

One message, containing the comparison table, the recommendation in one sentence, and the
question: which candidate. Not a request for approval of a plan; a choice between named options
with their consequences attached. The answer is recorded in the candidate table as who chose it.

One confirmation at G2 carries the rest of the pipeline. The contract, the build and the review
do not each need their own — they are the chosen candidate being executed, and re-asking teaches
people to skim.

## Default-off, and why it is not a loophole

A pipeline that stops to ask about the wording of an error message stops being run unattended,
and then it stops being run. Default-off applies only where both columns are cold: light band,
candidates equally revertible, nothing irreversible in the plan. It is never silent — the notice
is mandatory:

```text
resolve-problem-report · light band, no confirmation gate — took C2 (widen the help text to
name both flags). Reversible by reverting one commit; nothing else was touched. Say the word
and I will take C1 instead.
```

One line, and it carries three things: what was taken, how to undo it, and that an alternative
existed. A default-off run that does not say what it did has converted a policy into a habit.

## The act gate

Separately from all of the above, and always: **every irreversible act is confirmed at the moment
of the act.** Not at the plan — at plan time nothing is imminent and the person answering has no
context; at act time they have both.

The four things to state, then wait:

```text
About to: apply the pending migration to the production database.
Touches:  the rows table — adds one nullable column; no data rewritten.
Cannot undo: the applied-history record. A revert of the code does not remove it; removing the
          column afterwards is its own change.
If not done: the build stays staged and the fix does not take effect for anyone.
```

The standing irreversible classes for a report:

- applying a migration;
- writing to production data, including a "small" backfill and including running a job whose
  effect is a write;
- deleting anything not restorable from history;
- **closing the report**;
- **any outbound message to the reporter** — mail, chat, ticket comment, a status change that
  notifies.

The last two are the ones that get forgotten. They are cheap to perform, they feel like
paperwork, and they reach a person. A wrong resolution note read by the reporter is not undone by
editing it afterwards; they have already read it and told someone.

## Unattended runs

**An unattended run takes no irreversible act at all.** It stops, leaves the work staged, and
reports exactly what remains — including which act it stopped at and the four lines it would have
stated. A cron job that closed a report because closing was the natural next step made a decision
nobody was present to make.

Attendance is **declared conservatively and never probed**: if you cannot confirm a human will see
and answer a question in this run, it is unattended. Dispatched by a parent agent counts as
unattended. Being run in a terminal somebody opened three hours ago counts as unattended.

## When a confirmation goes unanswered

- **Attended, no reply yet:** wait. Do not take the default because the wait is boring.
- **The run ends without an answer:** deliver the offer as the deliverable. The comparison table
  *is* a result, and it is the one the chooser needs.
- **Unattended, above the light band:** proceed only through candidates that contain no
  irreversible act, and stop at the first one that does — with everything up to it staged and
  reported.
- **Never:** proceed with the riskier candidate on the grounds that it is more complete.

## Degradations and anti-patterns

| Situation | What to do |
|---|---|
| no channel to the reporter | confirm with the owner; record that the reporter was not consulted |
| the harness cannot wait for input | treat as unattended: no irreversible acts, staged output |
| the chooser answers "you decide" | take the recommendation, record it as delegated, and keep the notice |
| a confirmation arrives after the run ended | do not resume silently; restate what changed since |

- **Asking at the plan.** Consent given before anything is imminent is consent to a description.
- **Bundling.** "Shall I fix it, close the report and mail them?" is three acts in one answer,
  and the yes belongs to the first.
- **Re-asking at every gate.** Teaches skimming, which is how the one question that mattered gets
  a reflexive yes.
- **Treating a light-band default as silence.** The notice is the price of the default.
- **Counting the reporter's original request as consent.** They asked for a fix; they did not
  approve a migration, a backfill, or the message you are about to send in their name.
