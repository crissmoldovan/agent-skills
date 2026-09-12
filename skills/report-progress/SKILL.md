---
name: report-progress
description: "Report progress on long or multi-phase work in a fixed shape — what is done, what is running, what is next — keeping verified numbers separate from claimed ones, naming the user-facing consequence, and stating corrections out loud. Use when work spans phases, background agents, or more than one turn."
license: MIT
compatibility: "Any agent that writes prose to a user; nothing to install, plus an optional user-installed Claude Code Stop-hook gate. A count is verified only where the agent can run the command that produces it — elsewhere it is labelled as someone else's claim. The running section is sourced from agent-lifecycle evidence where that exists, and carries the lifecycle skill's no-evidence sentence where it does not. Output is the report itself plus the checklist run over it before sending."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Grep Glob Bash
---

# Report progress

Long work fails the reader in one of two ways, and both of them read as normal. The first is
silence: forty minutes pass, something is happening, and the user cannot tell what, where, or
whether it is still happening at all. The second is worse because it looks like the opposite —
fluent narration that relays a child agent's self-report as established fact, so "all tests
pass" arrives in the user's lap having never been run by anyone who could see the result.

Both leave the same hole: the reader cannot answer *what is done, what is running, and what do
I now know that I did not before?* This skill fills that hole with a fixed shape, a line
between verified and claimed, and a checklist that can be run over a report that has already
been written.

It owns the report. It does **not** own the work, the child agents, or the truth about their
state — it consumes that from `agent-lifecycle`. It is not a summary of a diff; that is
`describe-changes`. And it is not a substitute for lifecycle telemetry: a well-written report
about children you cannot observe is a well-written guess.

## What "forced" means here

A skill is instructions. It cannot make a model do anything: nothing in this file executes,
intercepts a turn, or holds back a message that skipped the report. A skill that implies
otherwise is making exactly the unbacked claim this one exists to stop.

What a contract *can* do is remove the ambiguity that a vague report hides behind. This skill
fixes the shape, names each omission as a specific failure with a consequence, and ends in a
checklist that a reviewer — or the author, one minute later — can run against the text. So
"forced" here means: **there is no ambiguity about what was owed, and no way to claim
compliance without producing the evidence.** A missing section is visibly missing. An
unlabelled number is visibly unlabelled. That is the whole mechanism, and it is enough,
because the failure mode it addresses is not inability — it is a report that was never
checked against anything.

### The mechanical half, which is not this file

A separate, optional gate can hold a turn open when a report is owed and missing. It is a
Claude Code `Stop` hook carried in this pack's adapter directory
(`adapters/claude-code/report-progress-gate.mjs`), with its own installer beside it. It is
off until a user installs it, and gone when they run that installer with `--remove`. The
paragraphs above are unchanged by it: this file still executes nothing, and nothing in this
skill can install the gate or arm it on a user's behalf.

**What it does.** On a turn that dispatched a subagent through the `Agent` tool — and only
such a turn — it reads that turn's final message and returns `{"decision":"block"}` when the
shape is absent, which holds the turn for one more round so the report can be written. It has
an `observe` mode that reports what it would have blocked and never holds anything. In either
mode it acts at most once per turn and then stands down, because Claude Code ends a turn after
8 consecutive blocks and that budget is shared with every other `Stop` hook on the machine.

**What it can check.** That a "what is done", a "what is running" and a "what is next" section
label are present; that a running row carries a literal state and a freshness token, or that
the exact no-evidence sentence below stands in its place; and that an empty section says so.
It is string matching, and that is the only reason it is enforcement rather than more
instructions — no model sits in its path, so there is nothing there to talk round.

**What it cannot check.** Whether any number in the report is real. It cannot tell whether
`npm test` was ever run, whether `child-7f2` exists, or whether "40s ago" was an observation
rather than a guess. A message that satisfies the gate can still be a fabrication, and the
five rules and the checklist at the end of this file are what catch that. The gate replaces
neither, and a passing turn is not a verified report.

### The five rules

1. **Verified and claimed are different words.** Every number in a report is one of two
   things: a result the reporter produced by running a command it can name, or a claim
   somebody else made. Never let the two share a sentence. A child agent's "all tests pass" is
   evidence that it said so; re-run at the boundary, or label it unverified and move on.
2. **Report state, not activity.** Three sections, always: what is done, what is running, what
   is next — each carrying a count or a concrete artefact. "Working on it" describes the
   reporter's experience, not the system's state, and a reader cannot act on it.
3. **Name the user-facing consequence, not the code change.** "Every correctly-installed Yarn 1
   repository was reported broken" tells the reader how much to care. "Fixed the receipt path"
   does not, and the reader has no way to recover the difference.
4. **Corrections are first-class and plain.** When something already reported turns out to be
   wrong, say so in one sentence, at the point it matters, and continue. Repairing it silently
   spends the trust every other line in the report depends on.
5. **Nothing-to-report is a valid report; invention never is.** "No commits landed yet; the
   build is still running" is complete and useful. Predicting a pending result, or describing
   what a still-running agent "should have" produced by now, is the failure this rule exists
   to stop.

### Where "what is running" comes from

`agent-lifecycle` owns the authoritative state of a child agent — identity, literal state,
activity, freshness, terminal cause. Where that evidence exists, every row in the running
section is sourced from it and from nothing else. Where it does not exist, guessing is banned,
and `agent-lifecycle` specifies the exact sentence to print instead of a running section:

```text
Background work visibility unavailable; state unknown.
```

Use it verbatim. A plausible-looking row about a child you cannot observe is the invention
rule 5 forbids, wearing a status block's formatting — and it is more convincing than plain
silence, which is what makes it worse.

### What this skill does not own

| The job | Whose it is | What this skill does with it |
|---|---|---|
| Child-agent state, freshness, stale-versus-lost | `agent-lifecycle` | Consumes its projection as the sole source of "what is running"; keeps no child bookkeeping of its own. |
| What a landed diff actually did | `describe-changes` | Hands it the diff when a change needs describing; quotes its output rather than paraphrasing the work. |
| Deciding what to do next | the caller's own plan | Reports the next act; does not choose it or re-plan the work. |
| Whether the work is any good | `request-blocks-review` and the repository's gates | Reports gate outcomes as results with their commands; passes no judgement of its own. |

Install the companions with `npx skills add crissmoldovan/agent-skills`.

## When to Use

A report is owed at these points, and the point is the trigger — not whether there is anything
impressive to say:

- **At every phase or milestone boundary**, including one that ended badly or produced nothing.
- **Before ending a turn in which background work was started**, or in which a background
  result arrived. The user is about to stop reading; this is the last moment they can learn
  that four agents are still running.
- **Whenever the user asks any form of "status"** — "where are we", "how's it going", "what's
  left", "did that finish".
- **Immediately on discovering that something already reported was wrong.** Not at the next
  boundary. The reader may already be acting on it.
- **At a handover** — to another session, another agent, or a human — where the receiver has
  none of the context and everything they get, they get from this text.

Do not use it for a single-step answer, a conversational exchange, or work with no phases: a
three-section status block over "yes, that file is in `src/` " is ceremony, not clarity, and it
trains the reader to skim the ones that matter. Do not use it as a substitute for lifecycle
telemetry — a post-run summary is not visibility, and `agent-lifecycle` says so first. Do not
use it to describe a landed change in detail; `describe-changes` reads the diff and anchors
every claim in it.

## Prerequisites

1. **A phase list, or the admission that there is not one.** The denominator in "3 of 5" has
   to come from somewhere the reader can trust.
   **Complete when:** the phases are written down with their order, or the report is prepared
   to say "no fixed phase list" rather than inventing a denominator.
2. **The command behind every number you intend to give.** Test counts, commit counts, file
   counts, durations.
   **Complete when:** each number owed is paired with the command that produces it here, or is
   marked in advance as a claim to be attributed.
3. **A lifecycle evidence source, located or declared absent.** Check before you write, not
   while writing.
   **Complete when:** the projection is readable in this run, or the run is marked as having
   no lifecycle evidence and the exact no-evidence sentence is the one that will be used.
4. **The earlier reports in this run, re-read.** Corrections are impossible if you cannot
   remember what you claimed.
   **Complete when:** you can name every number and every outcome you have already asserted to
   this reader.
5. **The reader's position.** Someone who has watched every message needs different framing
   from someone arriving cold at a handover.
   **Complete when:** the audience is chosen, and the report is written for that one.

## Procedure

1. **Name the boundary you are reporting at.** "Phase 3 of 5 complete", "background result
   arrived", "handing over". A report with no stated position in the work reads as a mood.
   **Complete when:** the first line says where in the work this report sits.

2. **Collect "done" from artefacts, never from memory.** A commit sha, a merged PR number, a
   file that exists, a command that exited zero in this checkout. Run the commands now; a
   result from twenty minutes and three edits ago is a claim about the past.
   **Complete when:** every done item names an artefact or a command with its result, and no
   done item rests on recollection.

3. **Source "what is running" from lifecycle evidence.** Child ID, literal state, current
   activity, freshness. If there is no evidence source, print the exact no-evidence sentence
   in place of the section and stop — do not soften it, do not supplement it with an estimate.
   **Complete when:** every running row traces to a lifecycle observation, or the exact
   sentence stands alone in place of the section.

4. **Split verified from claimed, visibly, in the text.** Two labelled groups beat one hedged
   sentence. "Verified here: `npm test` at 9f0a1b2, 812 passing." versus "Claimed by the child
   agent, not verified here: the Windows path is fixed."
   **Complete when:** every number in the report is either adjacent to the command that
   produced it, or attributed to whoever claimed it and marked unverified.

5. **Translate each done item into its user-facing consequence.** What could the user not do,
   or was wrongly told, that is now different? One clause is usually enough.
   **Complete when:** at least one line in the report states a consequence for a person rather
   than a change to a file.

6. **State "what is next" as an act with its precondition.** "Re-run the installer on a clean
   checkout; blocked until `child-7f2` reaches a terminal state." Not "continue with the
   migration", which is a topic, not a next step.
   **Complete when:** each next item names an act and what it waits on, if anything.

7. **Issue every correction you owe, in this report, in one sentence each.** Including
   corrections to a number you gave five minutes ago and corrections to something a child
   agent told you that you passed along.
   **Complete when:** no statement made earlier in this run and now known to be wrong stands
   uncorrected, and no corrected claim is quietly restated in its fixed form as though it had
   always read that way.

8. **Say when a section is empty.** "Nothing running" and "no commits yet" are results. An
   omitted section reads as an oversight and invites the reader to assume the good case.
   **Complete when:** all three sections are present, each either populated or explicitly empty.

9. **Run the Verification checklist over the text before sending it.** This is the step the
   whole contract rests on, because it is the only one that inspects the artefact rather than
   producing it.
   **Complete when:** every box is ticked, or the report has been edited until they are.

## Usage Examples

```text
Give me a status report on the migration. Fixed shape: what is done, what is running, what
is next, each with a count or an artefact. Keep numbers you verified by running something
separate from numbers a subagent claimed, and name the command for each verified one. If you
cannot see the background agents' state, say that rather than guessing it.
```

```text
Before you end this turn: you started three background agents. Report which of them are
still running, from lifecycle evidence, with freshness — or state plainly that you have no
visibility into them. Do not tell me what they are probably doing.
```

```text
The commit count you gave me earlier looks wrong. Correct it in one sentence, say what the
right number is and how you got it, and carry on — no apology paragraph, and do not restate
the old number as if it had been right.
```

### A report that works

```text
Phase 3 of 5 complete (receipt-path fix landed; Windows half unproven).

Done — verified here: 4 commits on feat/receipt-path (b1c2d3e..9f0a1b2); `npm test` run in
this checkout at 9f0a1b2 — 812 passing, 0 failing.
Done — claimed, not verified: the child agent reports the Windows path fixed. No Windows
runner exists in this environment, so that is its word, not a result.
Running: 1 child, child-7f2, state running, activity "rewriting the fixture loader", last
observed 40s ago (lifecycle projection).
Next: re-run the installer end-to-end on a clean checkout — blocked until child-7f2 reaches
a terminal state.
Consequence: every correctly-installed Yarn 1 repository was being reported broken by the
doctor command; from 9f0a1b2 it is not. The same bug on Windows is still unproven either way.
Correction: I said 5 commits an hour ago. One of those was already on main before this
branch existed. It is 4.
```

Everything in it is checkable: counts carry denominators, each number sits next to the command
that produced it or the agent that claimed it, the running row came from lifecycle evidence
with its freshness, and the correction is one sentence with no ceremony around it.

### The same moment, reported badly

```text
Great progress! I've been working through the migration and things are moving along nicely.
The tests are all passing and the background agent should be wrapping up the Windows fixes
shortly. I'll keep going and ping you if anything comes up.
```

Four failures in four sentences, and the text reads better than the good one. "Working
through" is activity, not state (rule 2). "The tests are all passing" has no command, no
count, and came from a child agent (rule 1). "Should be wrapping up" predicts a result from an
agent whose state was never observed (rule 5). Nothing anywhere says what a user would notice
(rule 3) — and the commit miscount is repaired by never being mentioned again (rule 4).

## Pitfalls

- **Narrating the child's self-report.** The sentence arrives already fluent and the boundary
  between "an agent said this" and "this happened" disappears into it. The user then makes a
  decision on a result nobody produced.
- **The progress bar with no denominator.** "Phase 3" is unreadable without "of 5"; the reader
  cannot tell whether you are nearly done or barely started, which is the one thing they
  wanted.
- **Activity verbs standing in for state.** "Looking into", "continuing with", "working
  through" — all of them survive a report in which nothing at all happened, which is exactly
  when they get used.
- **The silent repair.** Quietly re-stating a corrected number in its fixed form, with no
  correction, is the cheapest possible short-term fix and it costs the reader the ability to
  trust any number in any later report.
- **Predicting a pending result.** "Should be done shortly" is not a state; it is a forecast
  presented in the grammar of an observation, and it is wrong roughly as often as work is hard.
- **Freshness dropped from a running row.** A child last observed 40 seconds ago and one last
  observed 40 minutes ago render identically without it, and only one of them is alive.
- **Reporting only at the end.** A single report after two hours cannot be acted on: every
  decision it would have informed has already been taken by someone waiting in the dark.
- **A status block over a one-step answer.** Ceremony where there is no state to report trains
  the reader to skim, and the skimming carries over to the report that mattered.
- **Counting effort instead of outcomes.** "17 files changed, 6 agents dispatched" measures
  what the agent spent, not what the user got; volume is not progress.
- **Re-using the previous report's numbers.** A count carried forward without re-running its
  command has silently become a claim about the past, and rule 1 now applies to your own
  earlier self.

## Verification

Run this over the text you have written, before it is sent.

- [ ] The first line states where in the work this report sits.
- [ ] All three sections are present: what is done, what is running, what is next.
- [ ] Every item carries a count or a named artefact; none is an activity verb.
- [ ] Every count that has a denominator shows it.
- [ ] Every number is adjacent to the command that produced it here, or is attributed to
      whoever claimed it and marked unverified.
- [ ] No child-agent claim is restated as a result of this run.
- [ ] "What is running" came from lifecycle evidence, or the exact no-evidence sentence stands
      alone in its place.
- [ ] Each running row carries a literal state and a freshness.
- [ ] At least one line names a user-facing consequence rather than a code change.
- [ ] Every earlier statement now known to be wrong carries a one-sentence correction here,
      and no corrected claim is silently restated.
- [ ] Nothing in the report describes a result that has not happened yet.
- [ ] An empty section says it is empty rather than being omitted or padded.
- [ ] A reader who has seen nothing else can answer: what is done, what is running, what is
      next.

The report is finished when every line in it is either an artefact, a command with its
result, or an attributed claim — and a reviewer holding only this checklist could tell which
is which without asking you.
