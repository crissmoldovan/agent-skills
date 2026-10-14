# Merge preconditions

The review was of one commit. The merge must be of that commit, into the branch it was meant for,
with every required check having run on it. Each condition below has failed in practice while every
dashboard looked green.

## 1. The pull request's head is the reviewed head

```bash
gh pr view <pr> --json headRefOid --jq .headRefOid
```

It must equal the head the last round reviewed. A fix pushed after the last round — however small —
is unreviewed code, and either gets its own round or does not merge.

## 2. The base is the branch it should land in

```bash
gh pr view <pr> --json baseRefName,baseRefOid
```

A stacked pull request targets another feature branch. When that branch merges and is deleted, the
stacked pull request can still be merged, and GitHub reports it merged — into a branch that no
longer goes anywhere. Retarget it to the real base first (`gh pr edit <pr> --base <base>`), let its
checks run on the new merge, and review the new diff, which may now conflict or contain commits it
did not before. Verify that it landed by content — the merged files on the base match the reviewed
ones — and not by a count of commits.

## 3. It is mergeable

```bash
gh pr view <pr> --json mergeable,mergeStateStatus
```

A pull-request workflow runs against a test merge of the head into the base. When the pull request
conflicts with its base, that merge cannot be built, and **no pull-request run is dispatched at
all** — no queued run, no failure, nothing. It looks exactly like a slow or broken queue. When a
pull request gets no runs while others do, read `mergeable` before anything else; `CONFLICTING`
is the answer more often than an outage is.

## 4. Every required check ran and passed on that exact commit

The required checks pass this gate only as a zero exit, a non-empty list, and every check passed.
How the GitHub CLI reports them, measured rather than assumed:

| Call | What it does when… |
|---|---|
| `gh pr checks <pr>` (no `--json`) | a check failed: exits 1; checks pending: exits 8 |
| `gh pr checks <pr> --json name,bucket` | a check failed: **exits 0**, with `"bucket": "fail"` in the list |
| `gh pr checks <pr> --required …` | the repository declares no required checks: exits 1, "no required checks reported" |

So the exit code alone cannot gate the JSON form, and an empty list is not a pass. Read the buckets:

```bash
gh pr checks <pr> --required --json bucket --jq 'length > 0 and all(.[]; .bucket == "pass")'
```

It must exit zero and print `true`. A repository that declares no required checks fails this test,
and that is correct: nobody has said which checks matter, so nothing has shown them passing. Name
the checks that must pass, and test each of them by name instead:

```bash
gh pr checks <pr> --json name,bucket --jq '[.[] | select(.name == "<check>")] | length == 1 and all(.[]; .bucket == "pass")'
```

To be sure the answer is about the reviewed commit and not an older head, ask about the sha itself:

```bash
gh api "repos/<owner>/<repo>/commits/<sha>/check-runs" \
  --jq '.check_runs[] | [.name, .status, .conclusion] | @tsv'
```

A required check that is missing has not passed; it has not run. A check that ran on an earlier
head says nothing about this one.

## 5. Merge only through the gate, with the head pinned

Every predicate above is a test whose failure refuses the merge. Commands that print the state and
are followed by a merge are not a gate — they merge whatever they printed.

```bash
merge_if_ready() {  # merge_if_ready <pr> <reviewed-sha> <base>
  local state ok
  state=$(gh pr view "$1" --json headRefOid,baseRefName,mergeable \
    --jq '[.headRefOid, .baseRefName, .mergeable] | join(" ")') || return 1
  [ "$state" = "$2 $3 MERGEABLE" ] || { echo "REFUSE: head, base or mergeability differs: $state"; return 1; }
  ok=$(gh pr checks "$1" --required --json bucket --jq 'length > 0 and all(.[]; .bucket == "pass")') \
    || { echo "REFUSE: no required checks reported, or gh failed"; return 1; }
  [ "$ok" = true ] || { echo "REFUSE: a required check has not passed"; return 1; }
  gh pr merge "$1" --squash --match-head-commit "$2"
}
```

`--match-head-commit` makes the merge fail if the head moved after the checks: a push from another
session, a bot's commit, an accidental force-push. Without it, the merge takes whatever the head is
at that moment. Use the repository's merge method; the gate and the pin are what matter.

## After the merge

Fetch the base and confirm that what landed is what was reviewed. For a squash merge, the files the
pull request changed should be identical on the base and at the reviewed head:

```bash
git fetch origin
git diff --stat <reviewed-sha> origin/<base> -- <the paths the pull request changed>
```

An empty diff is the answer. A non-empty one means the base moved those files too, or the merge did
not carry what was reviewed, and either deserves a look before anyone is told it shipped.
