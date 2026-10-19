---
name: codex-review-loop
description: "Run an independent AI code review on a pull request in rounds until a round returns only lowest-severity findings: start the reviewer in the background writing to a file, read only the reviewer's final message, check every finding against the code before acting, fix everything above the lowest severity with a check you watched fail by breaking the fix on purpose, measure each finding's effect on any published result, write a review record per round, split the pull request when rounds keep finding new kinds of bug, and merge only a head whose required checks ran on that exact commit. Symptoms: run codex review, get a second opinion on this PR, review until clean, the reviewer flagged a P1, is this ready to merge, codex review --base origin/main. The Blocks-hosted review loop is request-blocks-review's; containing a risky change is land-complex-change's."
license: MIT
compatibility: "A git repository with a pull request, or a branch and its base, and a reviewer CLI that reviews a diff against a base and grades findings by severity. The examples use the Codex CLI; any reviewer with those two properties fits. Merge checks use the GitHub CLI. Output is the fixed branch, one review record per round, and either a merge pinned to the reviewed head or the stated reason it is not ready."
metadata: "group=workflow; lifecycle=release; version=1.0.1; author=crissmoldovan"
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
fits. Its `exec` form, `codex exec review --base <base sha> -o <file>`, also writes the final
review to a file of its own; the examples read it there, and pass the base as the sha recorded.

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
   never merged — or merged and never reviewed. Check the tree again when the reviewer exits: one
   that wrote there or moved `HEAD` reviewed something else. The worktree goes when the round ends.
   **Complete when:** the round's record names the head and base shas, the remote branch points at
   the head, the reviewer ran in a fresh worktree whose `HEAD` was that sha and whose
   `git status --porcelain --ignored` was empty before the review and after it, and the worktree
   and its directory are gone.

2. **Start the reviewer in the background, writing to a file.** A review can take many minutes, and
   output read live from a terminal arrives interleaved and half-finished. For example:
   `codex exec review -c project_doc_max_bytes=0 --base "$base" -o "$REVIEW_LOGS/round-<n>.final.txt" > "$REVIEW_LOGS/round-<n>.log" 2>&1 &`,
   with the final-review file removed first and each round number reserved once, atomically, so
   nothing from an earlier or a concurrent round stands in for this one. `$base` is the sha step 1
   recorded, never a name the reviewer would resolve for itself, later. The `-c` flag stops Codex
   reading instructions from the tree; a tree holding `.codex/` or `.agents/`, which no flag stops, is
   refused ([why](references/merge-preconditions.md)). The log directory is an absolute path outside
   the reviewed tree and every worktree of the checkout: a relative one lands the final review in the
   tree under review, and a log in a worktree gets committed and quoted by a later round. Wait for
   the process to exit before reading anything, and keep its exit status: a reviewer that exited
   non-zero did not finish a review.
   **Complete when:** the reviewer exited zero, and its full output is in the round's log file — or
   the round is recorded as failed and run again as a new round.

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
      head that round reviewed. The records go in the round's dispositions file, one complete line
      per finding, which the merge checklist reads.
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

14. **Merge only the head that was reviewed and checked, by hand, after a checklist.** Merging is a
    person's act, and this skill ships no merge script: three rounds running found a new way for a
    scripted gate to merge what nobody reviewed. Check each line, and stop at the first that fails
    ([merge preconditions](references/merge-preconditions.md) says why each one is there):
    1. The pull request's head is the sha the final round reviewed (`round-<n>.head`) — under
       step 12, the stop round's or its one confirmation round's — with no commit after it.
    2. No earlier round that did not end the loop reviewed that same head, unless every finding it
       graded above the lowest was rejected with evidence. A defect a round found is fixed in a new
       head, never reviewed away by running the review again until a run comes back clean.
    3. Every finding of the final round has a complete disposition in `round-<n>.dispositions`; a
       review that graded none was recorded `clean:` by the person who read it, or the round failed.
    4. The base branch's live tip (`git ls-remote origin refs/heads/<base>`) is the base the round
       recorded (`round-<n>.base`). If it moved, review again; `baseRefOid` does not see it move.
    5. It targets the branch it should, not a base that merged and is gone, and it is mergeable.
    6. Every required check completed and passed on that exact commit: a zero exit, a non-empty
       list, every one passed. No checks is not a pass, and a conflicting pull request gets none.
    7. The pull request did not configure its own review: the round ran the reviewer with the tree's
       instructions off, or a person read every change the diff makes to instruction files, symbolic
       links and reviewer configuration, and recorded that in the round's record.

    Then merge with the head pinned, so that a push in between fails the merge instead of merging
    unreviewed code: `gh pr merge <n> --merge --match-head-commit <reviewed sha>`.
    **Complete when:** every line held and the merge ran with `--match-head-commit` set to the
    reviewed head — or a line failed, and the record says which.

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
# no review of a tree that was never fetched, no round counted after a failed review.
set -euo pipefail

# One round of review. It never merges: the merge is a person's act, after step 14's checklist.
# REVIEW_LOGS is absolute, outside the review tree and every worktree of this checkout.
: "${ROUND:?set ROUND to the number of this round}"
: "${REVIEW_LOGS:?set REVIEW_LOGS to an absolute directory outside the repository}"
case "$REVIEW_LOGS" in /*) ;; *) echo "REFUSE: REVIEW_LOGS must be an absolute path"; exit 1;; esac

# A round counts only if the reviewer exited zero AND wrote a non-empty final review, which the exec
# form writes, and only that, to the file -o names: no log marker can cut it. A failed round leaves none.
review_round() {  # review_round <n> <tree> <base sha>
  local tree_abs listed wt wt_abs logs_abs log final
  case "$REVIEW_LOGS" in /*) ;; *) echo "ROUND $1 REFUSED: REVIEW_LOGS must be an absolute path"; return 1;; esac
  # The reviewer gets the recorded sha, never a name it would resolve for itself when it starts.
  [[ "${3:-}" =~ ^[0-9a-f]{40}([0-9a-f]{24})?$ ]] || { echo "ROUND $1 REFUSED: the base must be the recorded sha, not a name"; return 1; }
  tree_abs=$(cd "$2" && pwd -P) && mkdir -p "$REVIEW_LOGS" && logs_abs=$(cd "$REVIEW_LOGS" && pwd -P) || return 1
  # The reviewed tree, then every worktree of this checkout, the checkout included. NUL-delimited (-z,
  # git 2.36+): a path may hold a newline. A list git did not finish has no END record, and refuses.
  while IFS= read -r -d '' wt; do
    case $wt in END) listed=yes; continue;; "worktree "*) wt=${wt#worktree };; *) continue;; esac
    wt_abs=$(cd "$wt" 2>/dev/null && pwd -P) || wt_abs=$wt
    case "$logs_abs/" in "$wt_abs"/*|"$wt"/*) echo "ROUND $1 REFUSED: REVIEW_LOGS is inside the reviewed tree or a worktree of this checkout: $wt"; return 1;; esac
  done < <(printf 'worktree %s\0' "$tree_abs"; git worktree list --porcelain -z && printf 'END\0')
  [ "${listed:-}" = yes ] || { echo "ROUND $1 REFUSED: git could not list this checkout's worktrees"; return 1; }
  # The reviewer takes nothing from the tree: -c turns off its instruction files; these two no flag does.
  for wt in .codex .agents; do if [ -e "$2/$wt" ] || [ -L "$2/$wt" ]; then echo "ROUND $1 REFUSED: the reviewed tree holds $wt, which configures its reviewer"; return 1; fi; done
  log="$logs_abs/round-$1.log"; final="$logs_abs/round-$1.final.txt"
  rm -f "$final" "$logs_abs/round-$1.dispositions"  # nothing from an earlier run stands in for this one
  (cd "$2" && codex exec review -c project_doc_max_bytes=0 --base "$3" -o "$final") > "$log" 2>&1 &
  wait $! || { rm -f "$final"; echo "ROUND $1 FAILED: the reviewer exited non-zero; not a clean round"; return 1; }
  grep -q '[^[:space:]]' "$final" 2>/dev/null \
    || { rm -f "$final"; echo "ROUND $1 FAILED: no final review was written; not a clean round"; return 1; }
}

# A round is terminal only if every grade in its final review is the lowest of the declared scale, for
# the Codex CLI P3. Any other grade, above it or outside the scale (a P4), is not: never merge on it.
terminal_round() {  # terminal_round <n>
  local final="$REVIEW_LOGS/round-$1.final.txt" other
  [ -s "$final" ] || { echo "NOT TERMINAL: round $1 has no final review"; return 1; }
  other=$(grep -Eo '\[P[0-9]+\]' "$final" | sort -u | grep -vx '\[P3\]' || true)
  [ -z "$other" ] || { echo "NOT TERMINAL: round $1 grades findings other than the lowest, P3:" $other; return 1; }
}

# HEAD is the sha and git lists nothing, ignored files included. A git that failed proves nothing: fail.
exact_tree() {  # exact_tree <tree> <sha>
  local head status; head=$(git -C "$1" rev-parse HEAD) && status=$(git -C "$1" status --porcelain --ignored) || return 1
  [ "$head" = "$2" ] && [ -z "$status" ]
}

# A round number is reserved atomically, by mkdir, and never reused. Review exactly the pushed bytes in a
# fresh detached worktree, never the checkout, whose ignored files `git status --porcelain` hides.
mkdir -p "$REVIEW_LOGS" && mkdir "$REVIEW_LOGS/round-$ROUND.lock" 2>/dev/null || { echo "REFUSE: round $ROUND is taken: it ran, or is running; review as a new round"; exit 1; }
git fetch origin
sha=$(git rev-parse '@{upstream}'); base=$(git rev-parse origin/main)
scratch=$(mktemp -d "${TMPDIR:-/tmp}/review-tree.XXXXXX"); tree="$scratch/tree"
trap 'git worktree remove --force "$tree" 2>/dev/null || rm -rf "$tree"; rm -rf "$scratch"; git worktree prune' EXIT
git worktree add --detach "$tree" "$sha"
exact_tree "$tree" "$sha" || { echo "REFUSE: the review tree is not exactly $sha"; exit 1; }
review_round "$ROUND" "$tree" "$base"    # a failed round stops here, before anything is pinned
# Check again: a reviewer that wrote into the tree, built there or moved HEAD reviewed something else.
exact_tree "$tree" "$sha" || { rm -f "$REVIEW_LOGS/round-$ROUND.final.txt"; echo "ROUND $ROUND FAILED: the review tree changed while it was reviewed, or git could not tell; nothing is pinned"; exit 1; }
echo "$sha" > "$REVIEW_LOGS/round-$ROUND.head"; echo "$base" > "$REVIEW_LOGS/round-$ROUND.base"
terminal_round "$ROUND"          # so does a round with P0-P2 findings left
echo "Round $ROUND is terminal. Record a complete disposition per finding in round-$ROUND.dispositions; a review"
echo "that grades none failed, unless you read it and record it clean:. Then work through step 14's checklist."
```

## What it looks like

A specimen, not a prompt.

### A round's review record

```text
Review round 3 — PR <number> — head <sha> against origin/main at <base sha> — posted on the PR
Reviewer: codex exec review -c project_doc_max_bytes=0 --base <base sha> -o <file>; final review from -o

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
  next, and the check went green with the defect still in place. Judge the content, and fix a head
  graded above the lowest; do not review it again until a run grades it lower.
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
  pushed sha, and remove it when the round ends: rounds that leave theirs pile up. A tree clean
  before the review says nothing about the tree the reviewer left: check it again after it exits.
- **A base that moved after the review.** The head pin does not cover it, and `baseRefOid` does
  not see it: on one open pull request it named a base 17 commits behind the base branch's tip,
  and the pull request read `MERGEABLE`. Compare the branch's live tip with the round's base.
- **The lowest grade taken from memory.** One reviewer's scale ends at P2 and another's at P3. A
  threshold copied from the wrong one stops the loop a grade early and leaves a whole grade of
  findings unfixed. Read the scale from the reviewer.
- **A scripted merge gate.** Three rounds running found a new way for one to merge what nobody
  reviewed: findings not yet read, a base that moved, a reused round, a head reviewed again until a
  run came back clean. Merge by hand after the checklist, pinned with `--match-head-commit`. And
  `gh pr checks --json` exits zero even when a check has failed: read the buckets.
- **Merging a head nobody reviewed.** A last "trivial" fix pushed after the final round merges
  unreviewed and unchecked unless the merge is pinned to the reviewed head. The commonest version
  is the stop round's own lowest-severity findings, fixed "because they were cheap" and merged
  without the one confirmation round that would have reviewed them.
- **A record committed with the fixes it names.** A file cannot carry the sha of the commit that
  adds it, and a record committed after the last round is itself an unreviewed head. Records go
  on the pull request, or in a commit after the fixes that the next round then reviews.
- **Editing an earlier round's record.** A record quietly corrected in place makes every other
  record untrustworthy. Corrections go forward, stated as corrections.

## Verification

- [ ] Each round names the head sha it reviewed and the base sha it diffed against, and the remote
      branch pointed at the head.
- [ ] Each round reviewed a fresh worktree at that sha whose `git status --porcelain --ignored`
      was empty — never the checkout — and the worktree and its directory were removed after. The
      tree was checked again after the reviewer exited: `HEAD` still that sha, and nothing listed.
- [ ] The reviewer ran in the background, given the recorded base sha rather than a branch name, to
      a log directory outside every worktree of the checkout, and was read only after it exited.
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
- [ ] The merge ran by hand after every line of step 14's checklist held: the reviewed head, not
      reviewed before by a round that did not end the loop; a complete disposition per finding, or
      the review recorded clean; the recorded base still the branch's tip; the intended branch,
      mergeable; a non-empty, all-passed list of required checks from a zero-exit call; and the
      reviewer run with the tree's instructions off, or every change to instruction files, symbolic
      links and reviewer configuration read by a person and recorded.
- [ ] The merge used `--match-head-commit`.

## Deeper reading

- [The review record](references/review-record.md): extracting the final block, the record's
  fields, the dispositions and the file the merge checklist reads them from, and measuring an effect.
- [Arming a fix](references/arming-a-fix.md): the byte-copy mutation, why version control is the
  wrong restore, and how to confirm a restore by content.
- [Merge preconditions](references/merge-preconditions.md): why each line of the merge checklist is
  there, the measured `gh` behaviours behind them, and the pinned merge.
