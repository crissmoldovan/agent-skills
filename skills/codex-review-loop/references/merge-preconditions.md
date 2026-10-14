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

```bash
gh pr checks <pr> --required
gh api "repos/<owner>/<repo>/commits/<sha>/check-runs" \
  --jq '.check_runs[] | [.name, .status, .conclusion] | @tsv'
```

The first lists the required checks for the pull request. The second asks about the reviewed sha by
name, so the answer cannot come from an older head. Take the list of required checks from the
repository's branch rules, not from memory. Every one must appear, completed, with a passing
conclusion. A required check that is missing has not passed; it has not run. A check that ran on an
earlier head says nothing about this one.

## 5. Merge with the head pinned

```bash
gh pr merge <pr> --squash --match-head-commit <reviewed-sha>
```

`--match-head-commit` makes the merge fail if the head moved after the checks above: a push from
another session, a bot's commit, an accidental force-push. Without it, the merge takes whatever the
head is at that moment. Use the repository's merge method; the pin is what matters.

## After the merge

Fetch the base and confirm that what landed is what was reviewed. For a squash merge, the files the
pull request changed should be identical on the base and at the reviewed head:

```bash
git fetch origin
git diff --stat <reviewed-sha> origin/<base> -- <the paths the pull request changed>
```

An empty diff is the answer. A non-empty one means the base moved those files too, or the merge did
not carry what was reviewed, and either deserves a look before anyone is told it shipped.
