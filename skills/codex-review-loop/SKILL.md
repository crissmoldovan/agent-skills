---
name: codex-review-loop
description: "Run an independent AI code review on a pull request in rounds until a round returns only lowest-severity findings: start the reviewer in the background writing to a file, read only the reviewer's final message, check every finding against the code before acting, fix everything above the lowest severity with a check you watched fail by breaking the fix on purpose, measure each finding's effect on any published result, write a review record per round, split the pull request when rounds keep finding new kinds of bug, and merge only a head whose required checks ran on that exact commit. Symptoms: run codex review, get a second opinion on this PR, review until clean, the reviewer flagged a P1, is this ready to merge, codex review --base origin/main. The Blocks-hosted review loop is request-blocks-review's; containing a risky change is land-complex-change's."
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
fits. Its `exec` form, `codex exec review --base origin/main -o <file>`, also writes the final
review to a file of its own, which is how the examples read it.

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
2. **A reviewer that reviews a diff against a base and grades severity, and its declared scale.**
   Take the scale from the reviewer itself — its documentation or its own output — never from
   memory, and derive the threshold from it: every grade above the lowest is fixed, and a round
   with only the lowest grade stops the loop. The Codex CLI grades P0 to P3, so with it P0, P1 and
   P2 are fixed and a round with only P3 findings stops the loop. A finding graded outside the
   declared scale stops the round until the scale is established again.
   **Complete when:** the reviewer command, its declared scale and its lowest grade are named,
   with where the scale was read.
3. **The checks a fix must pass.** The tests, and the reproduce script if the pull request
   publishes numbers.
   **Complete when:** each is named with the command that runs it, and each has run once here.
4. **A place for review records and a place for raw logs.** Records go on the pull request, as a
   comment or a section of its description, or in files committed after the fixes they describe.
   Raw logs live outside the repository, because a reviewer reading the repository can find old
   logs and quote them into the new one.
   **Complete when:** both locations are named.
5. **The merge rules.** Who merges, the required checks, and the merge method.
   **Complete when:** the required checks are listed from the repository, not from memory.

## Procedure

1. **Pin the head under review, and review exactly its bytes.** Record the sha for the round, after
   the push, and the base sha the reviewer will diff against — the merge rests on both. A reviewer
   reads the working tree it runs in, so the tree must be that commit and nothing else: every round
   runs in a fresh worktree checked out at the recorded sha (`git worktree add --detach <path> <sha>`),
   never in the checkout. `git status --porcelain` does not list ignored files, and the reviewer
   reads them — generated configuration, build output — as if they were the commit. An uncommitted
   edit, an untracked or ignored file or an unpushed commit in the reviewed tree is reviewed and
   never merged — or merged and never reviewed. The worktree goes when the round ends, however it ends.
   **Complete when:** the round's record names the head and base shas, the remote branch points at
   the head, the reviewer ran in a fresh worktree whose `git status --porcelain --ignored` was empty
   at that sha, and the worktree and its directory are gone.

2. **Start the reviewer in the background, writing to a file.** A review can take many minutes, and
   output read live from a terminal arrives interleaved and half-finished. For example:
   `codex exec review --base origin/main -o "$REVIEW_LOGS/round-<n>.final.txt" > "$REVIEW_LOGS/round-<n>.log" 2>&1 &`,
   with the log directory outside the repository and the final-review file removed before the
   round starts, so a file from an earlier round can never stand in for this one. The log
   directory is an absolute path, checked to lie outside the reviewed tree: the reviewer runs
   inside that tree, so a relative path would land the final review in the very tree under review. Wait for the process to exit before reading anything, and keep its exit
   status: a reviewer that exited non-zero did not finish a review.
   **Complete when:** the reviewer exited zero, and its full output is in the round's log file — or
   the round is recorded as failed and run again.

3. **Read only the final review.** A reviewer's log holds drafts, tool output and earlier messages
   before its final review, and it can quote old review files it found in the repository, so the
   review has to be taken from a boundary nothing in the log can fake. The Codex CLI's exec form
   writes the final message, and only that, to the file `-o` names: read that file. A reviewer
   that only prints a log needs its final block cut out by a marker line, which is a fallback with a
   known flaw — a quoted line that equals the marker restarts the cut and silently drops the
   findings before it — so count the markers and compare the cut with the log by eye
   ([the review record](references/review-record.md) has both). A final review that is missing or
   empty is a **failed round**, not a clean one: nothing reads exactly like "no findings". Nor is a
   review that grades no finding clean on its face: a clean Codex review is plain prose, with no
   grade and no fixed wording, so a person reads it and records it clean, or the round failed.
   **Complete when:** the reviewer exited zero, its final review is non-empty, the round's findings
   come from it alone, and the record says how it was taken — the `-o` file, or a marker cut with
   its marker count — or the round is recorded as failed and run again.

4. **Check every finding against the code or the data before acting on it.** A reviewer's claim
   about the codebase can be wrong: a line that does not do what it says, a caller that does not
   exist, a case already handled two functions away. Read the cited code, then reproduce the
   problem with an input that shows it. A claim that does not hold is rejected with the evidence.
   It is not fixed to make the reviewer happy.
   **Complete when:** every finding is marked verified, with the reproducing input, or rejected,
   with the evidence that refutes it.

5. **Fix every verified finding above the lowest severity.** At the lowest severity, fix the cheap
   ones and record the rest with a reason — in a round the next round will review. In the round
   that stops the loop, step 12 decides instead. A severity is a judgement, not a measurement: the
   same defect can be graded differently on two heads, so judge a lowest-severity finding on its
   content before deferring it.
   Nothing above the lowest severity is deferred. An owner who disputes a grade re-scores the
   finding explicitly, with the reason in the record — and until the finding is fixed or re-scored
   that way, and a round's final review no longer grades it above the lowest, it blocks the stop
   rule and the merge.
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
   **Complete when:** both have run on the last fix commit, and their results are in the record.

10. **Write the round's review record.** The head reviewed, the reviewer command, and for each
    finding its severity and title as the reviewer gave them, whether it was verified, its
    disposition, its armed evidence, its effect, and the commit that fixed it. A correction to an
    earlier round's record is written as a correction in this one. The earlier record is never
    edited to look as though it had always been right. Put the record where it does not move the
    head under review: on the pull request, as a comment or a section of its description. A
    repository that keeps records as files commits each one after the fixes it describes, never
    with them — a file cannot name the commit that adds it — so the next round reviews it along
    with them. The last round's record always goes on the pull request: a commit after the last
    review is a head nobody reviewed.
    **Complete when:** every finding in the last block appears in the record, and the record is on
    the pull request or in a commit after the fixes it names.

11. **Push, and review the new head.** The fixes are new code and get their own round.
    **Complete when:** the next round is pinned to the pushed head, or the stop rule below applies.

12. **Stop when a round returns only lowest-severity findings, and leave a reviewed head to merge.**
    That round reviewed its head and nothing after it, so any commit made now is unreviewed. Take
    one of two exits:
    - **Defer and merge.** Record every finding as deferred, with where it is tracked, and merge the
      head that round reviewed. The merge step reads those records: one line per finding in the
      round's dispositions file, and it refuses while any finding has none.
    - **Fix, then confirm once.** Fix the findings worth fixing, armed as in step 6, push, and run
      one confirmation round on the new head. If it returns nothing above the lowest severity, that
      head is the one that merges, and anything it reports at the lowest severity is deferred, not
      fixed — a fix would need another round, and the loop would not end. If it returns anything
      above the lowest severity, the loop resumes at step 4 on that head.

    **Complete when:** the head that will merge is the head of a round that returned only
    lowest-severity findings — the stop round's, or its one confirmation round's — with no commit
    after it, and every finding from that round is recorded as deferred with its tracking, or
    rejected with its evidence.

13. **Split the pull request when rounds keep finding new kinds of bug.** Rephrasings of one defect
    converge. A run of rounds that each find a class of defect no earlier round found — the same
    subsystem failing in a new way each time — does not converge, and the next round will find
    another. After about three such rounds, stop iterating: propose a split that moves the
    subsystem that keeps failing into its own pull request, and let the owner decide.
    **Complete when:** the split is proposed with the classes found so far, or the rounds are
    converging and the record shows it.

14. **Merge only the head that was reviewed and checked.** Before merging, confirm that the pull
    request's head is the head the last round reviewed — under step 12, the stop round's head or its
    confirmation round's, with no commit after it; that every finding of that round has its
    disposition recorded, or a reader recorded its review clean; that it targets the branch it
    should, not a base that has already merged and gone; that the base branch is still at the sha
    the round diffed against — a base that moved is a merge nobody reviewed, so review again; that
    it is mergeable; and that every required check completed and passed on that exact commit. No
    checks is not a pass: a pull request that conflicts with its base gets no pull-request runs at
    all, silently. Then merge with the head pinned, so that a push in between makes the merge fail
    instead of merging unreviewed code ([merge preconditions](references/merge-preconditions.md)).
    Run these as a **gate**, not a report: each predicate is tested, and the merge command runs only
    if every one holds. Printing the state and merging anyway is not a gate. Required checks must
    come back as a zero exit, a non-empty list and every one passed. A repository that declares no
    required checks does not pass this gate: name the checks that must pass and test each by name.
    **Complete when:** the merge ran with `--match-head-commit` set to the reviewed head, in a step
    of its own after the round's findings were recorded, and after the gate's predicates all held —
    or the gate refused, and the record says which predicate failed.

## Usage Examples

```text
Run codex review on this PR against origin/main in the background, writing to a file. Read only the
final review. Fix every P0, P1 and P2 with a check you have watched fail, write the round's
review record, and go again until a round comes back with only P3s.
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
# Fail fast: a command that fails stops the recipe, so nothing after it runs on a false premise —
# no review of a tree that was never fetched, no merge after a failed or non-terminal round.
set -euo pipefail

# Required up front. STEP=review runs one round and stops; STEP=merge runs the gate once every finding
# of that round has a disposition. REVIEW_LOGS is absolute and outside every tree under review.
: "${STEP:?set STEP to review, or to merge once every finding of the round has a disposition}"
: "${PR:?set PR to the pull request number}"
: "${ROUND:?set ROUND to the number of this round}"
: "${REVIEW_LOGS:?set REVIEW_LOGS to an absolute directory outside the repository}"
case "$REVIEW_LOGS" in /*) ;; *) echo "REFUSE: REVIEW_LOGS must be an absolute path"; exit 1;; esac
mkdir -p "$REVIEW_LOGS"

# A round counts only if the reviewer exited zero AND wrote a non-empty final review, which the exec
# form writes, and only that, to the file -o names: no log marker can cut it. A failed round leaves none.
review_round() {  # review_round <n> <tree>
  local tree_abs logs_abs log final
  case "$REVIEW_LOGS" in /*) ;; *) echo "ROUND $1 REFUSED: REVIEW_LOGS must be an absolute path"; return 1;; esac
  tree_abs=$(cd "$2" && pwd -P) && mkdir -p "$REVIEW_LOGS" && logs_abs=$(cd "$REVIEW_LOGS" && pwd -P) || return 1
  case "$logs_abs/" in "$tree_abs"/*) echo "ROUND $1 REFUSED: REVIEW_LOGS is inside the reviewed tree"; return 1;; esac
  log="$logs_abs/round-$1.log"; final="$logs_abs/round-$1.final.txt"
  rm -f "$final" "$logs_abs/round-$1.dispositions"  # nothing from an earlier run stands in for this one
  (cd "$2" && codex exec review --base origin/main -o "$final") > "$log" 2>&1 &
  wait $! || { rm -f "$final"; echo "ROUND $1 FAILED: the reviewer exited non-zero; not a clean round"; return 1; }
  grep -q '[^[:space:]]' "$final" 2>/dev/null \
    || { rm -f "$final"; echo "ROUND $1 FAILED: no final review was written; not a clean round"; return 1; }
}

# A round is terminal only if every grade in its final review is the lowest of the declared scale —
# for the Codex CLI, P3. A grade above it, or one outside the scale (a P4, a P9), is not terminal:
# fix and run the next round, or stop and establish the scale again. Never merge.
terminal_round() {  # terminal_round <n>
  local final="$REVIEW_LOGS/round-$1.final.txt" other
  [ -s "$final" ] || { echo "NOT TERMINAL: round $1 has no final review"; return 1; }
  other=$(grep -Eo '\[P[0-9]+\]' "$final" | sort -u | grep -vx '\[P3\]' || true)
  [ -z "$other" ] || { echo "NOT TERMINAL: round $1 grades findings other than the lowest, P3:" $other; return 1; }
}

# Nothing merges on findings nobody read. round-<n>.dispositions holds a line per graded finding: the
# finding as the reviewer wrote it, " => deferred: <reason>, tracked in <where>" or " => rejected:
# <evidence>". A review grading nothing failed, unless a reader wrote "clean: <its verdict>" there.
recorded_round() {  # recorded_round <n>
  local final="$REVIEW_LOGS/round-$1.final.txt" dispositions="$REVIEW_LOGS/round-$1.dispositions" finding
  [ -s "$dispositions" ] || { echo "NOT RECORDED: round $1 has no dispositions file"; return 1; }
  if ! grep -Eq '^(- )?\[P[0-9]+\] ' "$final"; then
    grep -q '^clean: [^[:space:]]' "$dispositions" && return 0
    echo "ROUND $1 FAILED: its final review grades no finding, and no reader recorded it clean"; return 1
  fi
  grep -E '^(- )?\[P[0-9]+\] ' "$final" | sed 's/^- //' | while IFS= read -r finding; do
    grep -Fq -e "$finding => deferred: " -e "$finding => rejected: " "$dispositions" \
      || { echo "NOT RECORDED: round $1 has no disposition for: $finding"; return 1; }
  done
}

# The merge is a gate: every fact the review rested on is tested again, and gh pr merge runs only if
# all hold. The base is read live: baseRefOid stays put while the branch moves (merge preconditions).
merge_if_ready() {  # merge_if_ready <pr> <reviewed-head> <base-branch> <reviewed-base-sha>
  local state tip ok
  state=$(gh pr view "$1" --json headRefOid,baseRefName,mergeable \
    --jq '[.headRefOid, .baseRefName, .mergeable] | join(" ")') || return 1
  [ "$state" = "$2 $3 MERGEABLE" ] || { echo "REFUSE: head, base or mergeability differs: $state"; return 1; }
  tip=$(git ls-remote origin "refs/heads/$3" | cut -f1) || return 1
  [ -n "$4" ] && [ "$tip" = "$4" ] \
    || { echo "REFUSE: $3 is at ${tip:-nothing}, not $4, the base the review diffed against: review again"; return 1; }
  ok=$(gh pr checks "$1" --required --json bucket --jq 'length > 0 and all(.[]; .bucket == "pass")') \
    || { echo "REFUSE: no required checks reported, or gh failed"; return 1; }
  [ "$ok" = true ] || { echo "REFUSE: a required check has not passed"; return 1; }
  gh pr merge "$1" --squash --match-head-commit "$2"
}

case "$STEP" in
  review)
    # Pin the head and the base, and review exactly those bytes: always a fresh detached worktree at
    # the pushed sha, never the checkout, whose ignored files `git status --porcelain` does not list
    # and the reviewer reads. Made only here, it goes with its directory however the script exits.
    git fetch origin
    sha=$(git rev-parse '@{upstream}'); base=$(git rev-parse origin/main)
    echo "$sha" > "$REVIEW_LOGS/round-$ROUND.head"; echo "$base" > "$REVIEW_LOGS/round-$ROUND.base"
    scratch=$(mktemp -d "${TMPDIR:-/tmp}/review-tree.XXXXXX"); tree="$scratch/tree"
    trap 'git worktree remove --force "$tree" 2>/dev/null || rm -rf "$tree"; rm -rf "$scratch"; git worktree prune' EXIT
    git worktree add --detach "$tree" "$sha"
    [ -z "$(git -C "$tree" status --porcelain --ignored)" ] || { echo "REFUSE: the review tree is not exactly $sha"; exit 1; }
    review_round "$ROUND" "$tree"    # a failed round stops here
    terminal_round "$ROUND"          # so does a round with P0-P2 findings left
    echo "Round $ROUND is terminal: record a disposition for each finding in $REVIEW_LOGS/round-$ROUND.dispositions, then run STEP=merge" ;;
  merge)
    terminal_round "$ROUND"          # the round the merge rests on is terminal,
    recorded_round "$ROUND"          # every finding in it has a disposition, or a reader recorded it clean,
    head=$(cat "$REVIEW_LOGS/round-$ROUND.head"); base=$(cat "$REVIEW_LOGS/round-$ROUND.base")
    merge_if_ready "$PR" "$head" main "$base" ;;   # and only then the gate, then the merge
  *) echo "REFUSE: STEP must be review or merge"; exit 1 ;;
esac
```

## What it looks like

A specimen, not a prompt.

### A round's review record

```text
Review round 3 — PR <number> — head <sha> against origin/main — posted on the pull request
Reviewer: codex exec review --base origin/main -o <file>; final review from the -o file

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
  effect: none — nothing was changed; reproduce.sh output byte-identical at this head

[P3] A log line misspells an arm label
  verified: yes — <file>:<line> prints "arm-B" where the label is "arm B"
  disposition: fixed (cheap) in <sha>
  armed: test "log lines use the arm's label" failed with the fix broken; passed after a restore
         from a byte copy, checked with cmp
  effect: none — reproduce.sh output byte-identical before and after

Tests: <command> — all passing at <sha>. reproduce.sh: identical except tables/bar-2.csv, as above.
Correction to round 2: its P1 on the cache key was marked fixed in <sha>; that commit fixed the
read path only. The write path is fixed in this round, in <sha>.
Next: round 4 on <sha>, the last fix commit, once pushed.
```

Every finding has a verified line and an effect line, and every fix an armed line: the record meets
the contract it describes. Each finding says whether it was true, what was done, how the fix was
proven to matter, and what it changed in the published numbers. The rejected finding carries its evidence. The correction to the
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
- **A marker the review itself can contain.** Cutting the final block out of a log at the last line
  reading `codex` breaks the moment the review quotes a file or a command output with such a line:
  the cut restarts there and the findings before it vanish, while the tail left over still looks
  like a review. Take the final message from a file the reviewer writes, where it has one.
- **A failed round read as a clean one.** A reviewer that crashed, was rate-limited or was logged
  out leaves a log with no final block, and an extraction over it returns nothing — which looks
  exactly like a review with no findings. A round counts only on a zero exit and a non-empty final
  block.
- **A dirty tree under review.** The reviewer reads the files in front of it. An edit made after
  the push, or a file never committed, is reviewed and then never merged, and a commit not yet
  pushed is merged without the review having seen it on the branch. A checkout that holds only
  ignored files looks clean to `git status --porcelain` and is not. Review a fresh worktree at the
  pushed sha, and remove it when the round ends: rounds that leave theirs pile up.
- **Merging before the findings are read.** A recipe that merges the moment a round is terminal
  merges lowest-grade findings nobody verified or recorded, and a garbled review with no grade in it
  passes for a clean one. Review and merge are separate steps, with the dispositions between them.
- **A base that moved after the review.** The head pin does not cover it, and `baseRefOid` does
  not see it: on one open pull request it named a base 17 commits behind the base branch's tip,
  and the pull request read `MERGEABLE`. Compare the branch's live tip with the round's base.
- **The lowest grade taken from memory.** One reviewer's scale ends at P2 and another's at P3. A
  threshold copied from the wrong one stops the loop a grade early and leaves a whole grade of
  findings unfixed. Read the scale from the reviewer.
- **A merge recipe that prints instead of gating.** Commands that show the head, the checks and
  the mergeability, followed by a merge, merge whatever they showed. And `gh pr checks --json`
  exits zero even when a check has failed, so only the buckets themselves can gate.
- **Merging a head nobody reviewed.** A last "trivial" fix pushed after the final round merges
  unreviewed and unchecked unless the merge is pinned to the reviewed head. The commonest version
  is the stop round's own lowest-severity findings, fixed "because they were cheap" and merged
  without the one confirmation round that would have reviewed them.
- **A record committed with the fixes it names.** A file cannot carry the sha of the commit that
  adds it, and a record committed after the last round is itself an unreviewed head. Records go
  on the pull request, or in a commit after the fixes that the next round then reviews.
- **No checks taken for passing checks.** A pull request in conflict with its base gets no
  pull-request runs at all. An empty checks list looks like a quiet queue, not a failure.
- **Merging into a dead base.** A stacked pull request whose base branch already merged and was
  deleted can still report "merged" — into a branch that goes nowhere. Retarget it first.
- **Editing an earlier round's record.** A record quietly corrected in place makes every other
  record untrustworthy. Corrections go forward, stated as corrections.

## Verification

- [ ] Each round names the head sha it reviewed and the base sha it diffed against, and the remote
      branch pointed at the head.
- [ ] Each round reviewed a fresh worktree at that sha whose `git status --porcelain --ignored`
      was empty — never the checkout — and the worktree and its directory were removed after.
- [ ] The reviewer ran in the background to a log file outside the repository, and was read only
      after it exited.
- [ ] Each round counted only on a zero exit and a non-empty final review; any other round was
      recorded as failed and run again.
- [ ] Each round's findings came from the reviewer's final message alone — the file its `-o`
      option wrote, or, for a reviewer with only a log, a marker cut checked against the log.
- [ ] The threshold came from the reviewer's declared scale — for the Codex CLI, P0 to P3: P0 to
      P2 fixed, a P3-only round stops the loop.
- [ ] Every finding was verified against the code or data, or rejected with evidence.
- [ ] Every verified finding above the lowest severity was fixed; lowest-severity findings were
      fixed if cheap and otherwise recorded with a reason.
- [ ] Every fix has a check that was watched failing with the fix broken, and passing after a
      restore from a byte copy that was checked by content.
- [ ] No `git checkout --` or `git restore` was used to undo a mutation.
- [ ] Shared code touched by a fix was diffed against the base, and default-path changes are
      intended and tested.
- [ ] Every finding has an effect line, and every "none" names the command that measured it.
- [ ] Tests and the reproduce script ran on the last fix commit of each round.
- [ ] A review record exists for every round, and corrections to earlier rounds are stated in
      later records rather than edited into earlier ones.
- [ ] The loop stopped on a round with only lowest-severity findings — or a split was proposed
      after rounds kept finding new kinds of bug.
- [ ] At the stop, its findings were either all deferred and the reviewed head merged, or fixed
      and then reviewed by exactly one confirmation round, whose own lowest-severity findings were
      deferred.
- [ ] The merged head is the head of the stop round or of its one confirmation round, with no
      commit after it; its base is the intended branch; and every required check completed and
      passed on that exact commit.
- [ ] Every record is on the pull request, or in a commit after the fixes it names — none names
      its own commit, and none follows the last review.
- [ ] The merge was gated, in a step of its own: every finding of the merged round had a recorded
      disposition, or a reader recorded its review clean; head, base branch and mergeability
      matched; the base branch's live tip was the base the round diffed against; the required
      checks were a non-empty all-passed list from a zero-exit call; and only then did it merge.
- [ ] The merge used `--match-head-commit`.

## Deeper reading

- [The review record](references/review-record.md): extracting the final block, the record's
  fields, the dispositions and the file the merge step reads them from, and measuring an effect.
- [Arming a fix](references/arming-a-fix.md): the byte-copy mutation, why version control is the
  wrong restore, and how to confirm a restore by content.
- [Merge preconditions](references/merge-preconditions.md): the reviewed head and base, required
  checks on that commit, conflicting and stacked pull requests, and the pinned merge.
