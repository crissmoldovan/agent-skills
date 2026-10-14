---
name: codex-review-loop
description: "Run an independent AI code review on a pull request in rounds until a round returns only lowest-severity findings: start the reviewer in the background writing to a file, read only the last review block, check every finding against the code before acting, fix everything above the lowest severity with a check you watched fail by breaking the fix on purpose, measure each finding's effect on any published result, write a review record per round, split the pull request when rounds keep finding new kinds of bug, and merge only a head whose required checks ran on that exact commit. Symptoms: run codex review, get a second opinion on this PR, review until clean, the reviewer flagged a P1, is this ready to merge, codex review --base origin/main. The Blocks-hosted review loop is request-blocks-review's; containing a risky change is land-complex-change's."
license: MIT
compatibility: "A git repository with a pull request, or a branch and its base, and a reviewer CLI that reviews a diff against a base and grades findings by severity. The examples use the Codex CLI; any reviewer with those two properties fits. Merge checks use the GitHub CLI. Output is the fixed branch, one review record per round, and either a merge pinned to the reviewed head or the stated reason it is not ready."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Write Edit Grep Glob Bash
---

# Run an independent review loop

A second reviewer earns its place by reading what the author cannot: not the diff they meant to
write, but the system the diff lands in. The loop around it is where that value leaks away. The log
holds several blocks and the wrong one gets read. A finding gets fixed because it sounded right,
and it was not. A fix gets a test that was never seen failing. The test's mutation gets undone with
a command that also undid the fix. "No effect on the results" gets written without anything being
measured. Rounds go on for ever because every one finds something new. And the head that finally
merges is one nobody reviewed, because a last small fix went in after the final round.

This skill is the loop: what a round consists of, what each finding is owed, when the loop stops,
when it should stop and split instead, and what has to be true of the exact commit that merges. It
is reviewer-agnostic. The examples use the Codex CLI, `codex review --base origin/main`, because
that is a common reviewer that takes a base and grades its findings; any reviewer that does both
fits.

### What this skill does not own

| The job | Whose it is | What this skill does with it |
|---|---|---|
| The review loop with Blocks as the reviewer | `request-blocks-review` | Runs beside it when both are wanted; the two catch different things. |
| Blocks sessions and status waits | `blocks` | Uses none of it. |
| Containing a change whose side effects are the risk | `land-complex-change` | Reviews the change once it is contained; owns no budget. |
| Checking a claim about how the code works | `investigate-codebase` | Calls it when a finding's claim is not settled by reading one place. |
| Describing what the pull request does | `describe-changes` | Hands it the final diff. |
| Telling the reader where the rounds stand | `report-progress` | Supplies the round number, the findings by severity and the head. |
| Recording why a finding was rejected or deferred | `decision-journal` | Hands over the disposition and its evidence when it is contested. |

Install the companions with `npx skills add crissmoldovan/agent-skills`.

## When to Use

- A pull request is functionally done and needs an independent review before it merges.
- A second reviewer is wanted beside a hosted one. One tends to read the diff and the other the
  system, and they report different defects.
- The pull request changes numbers somebody has already read — a study, a report, a metric — so a
  finding can move a published result.
- An earlier round found something, the fix is in, and the new head has to be reviewed.

Do not use it before a diff exists: a review of an intention reviews nothing. Do not use it for the
Blocks-hosted loop — `request-blocks-review` owns that and its waits. Do not count the author
agent's own reading of its diff as this review: the point is a reviewer that did not write the
code. And do not use it to decide scope: when the rounds say the pull request is too big, this
skill says so and proposes a split, and the person who owns the work decides.

## Prerequisites

1. **A pushed branch with a known base.** The base is the branch the pull request merges into,
   fetched in this session.
   **Complete when:** `git fetch origin` ran, and the head sha under review is written down.
2. **A reviewer that reviews a diff against a base and grades severity.** Its scale is known, and
   so is its lowest grade — on a P0 to P2 scale, P2.
   **Complete when:** the reviewer command and its lowest severity are named.
3. **The checks a fix must pass.** The tests, and the reproduce script if the pull request
   publishes numbers.
   **Complete when:** each is named with the command that runs it, and each has run once here.
4. **A place for review records and a place for raw logs.** Records are committed with the work.
   Raw logs live outside the repository, because a reviewer reading the repository can find old
   logs and quote them into the new one.
   **Complete when:** both locations are named.
5. **The merge rules.** Who merges, the required checks, and the merge method.
   **Complete when:** the required checks are listed from the repository, not from memory.

## Procedure

1. **Pin the head under review.** Record `git rev-parse HEAD` for the round, after the push. Every
   finding, fix and check in the round is about that commit.
   **Complete when:** the round's record names the head sha, and the remote branch points at it.

2. **Start the reviewer in the background, writing to a file.** A review can take many minutes, and
   output read live from a terminal arrives interleaved and half-finished. For example:
   `codex review --base origin/main > "$REVIEW_LOGS/round-<n>.log" 2>&1 &`, with the log directory
   outside the repository. Wait for the process to exit before reading anything.
   **Complete when:** the reviewer has exited, and its full output is in the round's log file.

3. **Read only the last review block.** A reviewer's log holds drafts, tool output and earlier
   messages before its final review, and it can also quote old review files it found in the
   repository. Extracting from the first block instead of the last presents earlier rounds'
   findings as this round's. With the Codex CLI, every message opens with a line reading `codex`,
   and the final block is everything after the last such line
   ([the review record](references/review-record.md) has the extraction).
   **Complete when:** the round's findings come from the last block alone, and the record says how
   many earlier blocks were discarded.

4. **Check every finding against the code or the data before acting on it.** A reviewer's claim
   about the codebase can be wrong: a line that does not do what it says, a caller that does not
   exist, a case already handled two functions away. Read the cited code, then reproduce the
   problem with an input that shows it. A claim that does not hold is rejected with the evidence.
   It is not fixed to make the reviewer happy.
   **Complete when:** every finding is marked verified, with the reproducing input, or rejected,
   with the evidence that refutes it.

5. **Fix every verified finding above the lowest severity.** At the lowest severity, fix the cheap
   ones and record the rest with a reason. A severity is a judgement, not a measurement: the same
   defect can be graded differently on two heads, so judge a lowest-severity finding on its
   content before deferring it.
   **Complete when:** every verified finding above the lowest severity is fixed, and every
   lowest-severity finding is fixed or recorded as deferred with a reason.

6. **Arm every fix: watch its check fail with the fix broken.** Write a test or a self-check for
   the fix. Copy the fixed file byte for byte to a scratch path, break the fix on purpose, run the
   check and watch it fail for the right reason, then restore from the byte copy and confirm the
   restore by content before running the check again. Never restore with `git checkout --` or
   `git restore`: the fix is usually uncommitted in that same file, and the restore throws it away
   along with the mutation, silently ([arming a fix](references/arming-a-fix.md)).
   **Complete when:** every fix has a recorded failing run under a named mutation and a passing
   run after a restore checked with `cmp` or a search for the fix's own identifier.

7. **Diff shared code against the base after every fix.** A fix aimed at one path often runs
   through a function every path shares, and can quietly change what the default path does — a
   guard added for an edge case that also rewrites the ordinary case.
   **Complete when:** every shared function the round touched has been diffed against the base,
   and each change to its default behaviour is intended and tested.

8. **Measure each finding's effect on any published result.** Where the pull request publishes
   numbers, rerun them with the fix and compare them with the published ones. Write "no effect"
   only when that comparison shows no change, and name the command that showed it.
   **Complete when:** every finding has an effect line — the numbers that moved, from what to what,
   or "none", backed by a named command and its output.

9. **Run the tests and the reproduce script on the fixed tree.**
   **Complete when:** both have run on the commit that will be pushed, and their results are in
   the record.

10. **Write the round's review record.** The head reviewed, the reviewer command, and for each
    finding its severity and title as the reviewer gave them, whether it was verified, its
    disposition, its armed evidence, its effect, and the commit that fixed it. A correction to an
    earlier round's record is written as a correction in this one. The earlier record is never
    edited to look as though it had always been right.
    **Complete when:** the record is committed with the fixes, and every finding in the last block
    appears in it.

11. **Push, and review the new head.** The fixes are new code and get their own round.
    **Complete when:** the next round is pinned to the pushed head, or the stop rule below applies.

12. **Stop when a round returns only lowest-severity findings.** Fix the cheap ones and record the
    rest, as in step 5. The loop is done; the pull request is reviewed at that head and no later
    one.
    **Complete when:** the last round's findings are all at the lowest severity, each fixed or
    recorded.

13. **Split the pull request when rounds keep finding new kinds of bug.** Rephrasings of one defect
    converge. A run of rounds that each find a class of defect no earlier round found — the same
    subsystem failing in a new way each time — does not converge, and the next round will find
    another. After about three such rounds, stop iterating: propose a split that moves the
    subsystem that keeps failing into its own pull request, and let the owner decide.
    **Complete when:** the split is proposed with the classes found so far, or the rounds are
    converging and the record shows it.

14. **Merge only the head that was reviewed and checked.** Before merging, confirm that the pull
    request's head is the head the last round reviewed; that it targets the branch it should,
    not a base that has already merged and gone; that it is mergeable; and that every required
    check completed and passed on that exact commit. No checks is not a pass: a pull request that
    conflicts with its base gets no pull-request runs at all, silently. Then merge with the head
    pinned, so that a push in between makes the merge fail instead of merging unreviewed code
    ([merge preconditions](references/merge-preconditions.md)).
    **Complete when:** the merge ran with `--match-head-commit` set to the reviewed head, or the
    record says which precondition is not met.

## Usage Examples

```text
Run codex review on this PR against origin/main in the background, writing to a file. Read only the
last review block. Fix every P0 and P1 with a check you have watched fail, write the round's review
record, and go again until a round comes back with only P2s.
```

```text
The reviewer says the parser drops empty rows. Before you change anything, show me that it is true:
the line it means, and an input that proves it.
```

```text
This PR changes numbers in a published report. For every finding, tell me whether fixing it moves a
published number, and by how much. Do not write "no effect" unless you measured it.
```

```text
That is the fourth round in a row that found a new kind of bug. Stop iterating, and propose how to
split this PR so that the part that keeps failing gets its own branch.
```

```bash
# One round: pin the head, review it against the base in the background, keep the raw log outside the repo.
git fetch origin
git rev-parse HEAD > "$REVIEW_LOGS/round-3.head"
codex review --base origin/main > "$REVIEW_LOGS/round-3.log" 2>&1 &
wait $!

# Keep only the final block: the Codex CLI opens every message with a line reading "codex".
awk '/^codex$/{buf=""} {buf=buf $0 "\n"} END{printf "%s", buf}' \
  "$REVIEW_LOGS/round-3.log" > "$REVIEW_LOGS/round-3.final.txt"

# Merge only the reviewed head, and only once its required checks have run on it.
gh pr view <pr> --json headRefOid,baseRefName,mergeable,mergeStateStatus
gh pr checks <pr> --required
gh pr merge <pr> --squash --match-head-commit "$(cat "$REVIEW_LOGS/round-3.head")"
```

## What it looks like

A specimen, not a prompt.

### A round's review record

```text
Review round 3 — PR <number> — head <sha> against origin/main
Reviewer: codex review --base origin/main; last block only (2 earlier blocks discarded)

[P1] The scorer counts a "does not apply" answer as an invention
  verified: yes — <file>:<line>; fixture item <id> reproduces it
  disposition: fixed in <sha>
  armed: test "not-applicable is not invention" failed with the fix broken; passed after a
         restore from a byte copy, checked with cmp
  effect: arm B invention <x>% -> <y>% (reproduce.sh, tables/bar-2.csv); bar 2 verdict unchanged

[P1] "The loader skips the header row twice"
  verified: no — the header is read once (<file>:<line>); a fixture with a header and one row
            loads one row
  disposition: rejected, evidence above

[P2] A log line misspells an arm label
  disposition: fixed (cheap) in <sha>
  effect: none — reproduce.sh output byte-identical before and after

Tests: <command> — all passing at <sha>. reproduce.sh: identical except tables/bar-2.csv, as above.
Correction to round 2: its P1 on the cache key was marked fixed in <sha>; that commit fixed the
read path only. The write path is fixed in this round, in <sha>.
Next: round 4 on <sha>.
```

Each finding says whether it was true, what was done, how the fix was proven to matter, and what it
changed in the published numbers. The rejected finding carries its evidence. The correction to the
earlier round is stated where the reader will see it.

## Pitfalls

- **Reading the whole log.** Drafts, tool output and quoted old reviews precede the final block. In
  one loop the reviewer printed review files it found in the repository, and an extraction that
  began at the first block presented three earlier rounds' findings as the current one's.
- **Fixing a claim nobody checked.** A reviewer is often right and sometimes confidently wrong
  about what the code does. An unverified "fix" for a defect that does not exist is a real change
  with no reason behind it.
- **A fix whose check never failed.** A test written after the fix and green from its first run
  proves that it runs, not that it guards anything.
- **Restoring a mutation with version control.** `git checkout --` restores the last committed
  version, which predates the uncommitted fix. The fix disappears, the suite still passes because
  its own test went with it, and nothing reports either.
- **"No effect" with no measurement.** It reads as a finding and is a guess. Published numbers are
  exactly where an unmeasured guess does the most damage.
- **A fix that changes the default path.** A shape guard added for an override path can change
  what the ordinary path does with an edge input, and no finding pointed there.
- **Rounds that do not converge.** Each finds a new class of defect, each fix adds surface, and the
  next round finds the next class. The way out is a smaller pull request, not another round.
- **Severity as a verdict.** The same defect has been graded high on one head and lower on the
  next, and the check went green with the defect still in place. Judge the content.
- **Merging a head nobody reviewed.** A last "trivial" fix pushed after the final round merges
  unreviewed and unchecked unless the merge is pinned to the reviewed head.
- **No checks taken for passing checks.** A pull request in conflict with its base gets no
  pull-request runs at all. An empty checks list looks like a quiet queue, not a failure.
- **Merging into a dead base.** A stacked pull request whose base branch already merged and was
  deleted can still report "merged" — into a branch that goes nowhere. Retarget it first.
- **Editing an earlier round's record.** A record quietly corrected in place makes every other
  record untrustworthy. Corrections go forward, stated as corrections.

## Verification

- [ ] Each round names the head sha it reviewed, and the remote branch pointed at it.
- [ ] The reviewer ran in the background to a log file outside the repository, and was read only
      after it exited.
- [ ] Each round's findings came from the last review block alone.
- [ ] Every finding was verified against the code or data, or rejected with evidence.
- [ ] Every verified finding above the lowest severity was fixed; lowest-severity findings were
      fixed if cheap and otherwise recorded with a reason.
- [ ] Every fix has a check that was watched failing with the fix broken, and passing after a
      restore from a byte copy that was checked by content.
- [ ] No `git checkout --` or `git restore` was used to undo a mutation.
- [ ] Shared code touched by a fix was diffed against the base, and default-path changes are
      intended and tested.
- [ ] Every finding has an effect line, and every "none" names the command that measured it.
- [ ] Tests and the reproduce script ran on the commit that was pushed.
- [ ] A review record exists for every round, and corrections to earlier rounds are stated in
      later records rather than edited into earlier ones.
- [ ] The loop stopped on a round with only lowest-severity findings — or a split was proposed
      after rounds kept finding new kinds of bug.
- [ ] The merged head is the reviewed head, its base is the intended branch, and every required
      check completed and passed on that exact commit.
- [ ] The merge used `--match-head-commit`.

## Deeper reading

- [The review record](references/review-record.md): extracting the final block, the record's
  fields, the dispositions, and how an effect is measured.
- [Arming a fix](references/arming-a-fix.md): the byte-copy mutation, why version control is the
  wrong restore, and how to confirm a restore by content.
- [Merge preconditions](references/merge-preconditions.md): the reviewed head, required checks on
  that commit, conflicting and stacked pull requests, and the pinned merge.
