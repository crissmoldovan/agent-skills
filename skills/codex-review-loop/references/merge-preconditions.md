# Merge preconditions

The review was of one commit. The merge must be of that commit, into the branch it was meant for,
with every finding of the round answered and every required check having run on it. Each section
below is one line of the merge checklist in step 14, and why it is there. Each has failed in
practice while every dashboard looked green.

A person runs the checklist and the merge. This skill once shipped a script that tested these lines
and then merged, and three review rounds running each found a new way for it to merge something
nobody had reviewed: findings not yet read, a base that had moved, a reused round number, a head
reviewed again until a run came back clean. The checks below are the same; what changed is that
nothing merges until a person has looked at each one.

## 1. The pull request's head is the reviewed head

```bash
gh pr view <pr> --json headRefOid --jq .headRefOid   # must equal round-<n>.head
```

It must equal the head the final round reviewed. A fix pushed after that round — however small — is
unreviewed code, and either gets its own round or does not merge.

## 2. No earlier round that did not end the loop reviewed that head

A review is a sample, not a proof: the same head can be graded P1 on one run and only P3 on the
next. A head that a round graded above the lowest grade is fixed, and the fix is a new head, which
is what the next round reviews. Running the review again on the unchanged head until a run comes
back clean merges a defect a round already found. The one exception is a round whose every finding
above the lowest grade was rejected with evidence: nothing was there to fix.

```bash
grep -lx '<reviewed sha>' "$REVIEW_LOGS"/round-*.head   # any file but the final round's is a stop
```

## 3. Every finding of the final round has a complete disposition

Each graded finding has its line in `round-<n>.dispositions` — the finding as the reviewer wrote it,
then `=> deferred: <reason>, tracked in <where>` or `=> rejected: <evidence>`, every part present —
and a review that graded nothing was recorded `clean:` by the person who read it
([the dispositions file](review-record.md#the-dispositions-file)). A finding with no line, or a
line missing its tracker or its evidence, is a finding nobody has answered.

## 4. The base has not moved since the review

The reviewer diffed the head against one commit of the base. If the base branch advances after the
review, the merge lands on code the reviewer never saw, and nothing about the head says so: it still
matches, it can still read `MERGEABLE`, and in a repository that does not require branches to be up
to date its checks stay green. So the round records the base sha it reviewed against — the tip of
`origin/main` right after its fetch — and that is compared with the branch's tip now:

```bash
git ls-remote origin refs/heads/<base> | cut -f1   # must equal the base sha the round recorded
```

Do not read it from the pull request. `baseRefOid` is the base as of the head's last push, not the
branch's tip, measured: an open pull request reported a `baseRefOid` 17 commits behind its base
branch, while it read `MERGEABLE` and GitHub's own test merge was built on the branch's real tip. A
check that compares `baseRefOid` with the recorded base passes after the base has moved.

A base that moved means review again, on a fresh round, not merge. Nothing pins the base at the
merge the way `--match-head-commit` pins the head, so the check leaves the seconds between it and
the merge open; a branch rule that requires branches to be up to date before merging closes them.

## 5. It lands on the branch it should, and it is mergeable

```bash
gh pr view <pr> --json baseRefName,mergeable,mergeStateStatus
```

A stacked pull request targets another feature branch. When that branch merges and is deleted, the
stacked pull request can still be merged, and GitHub reports it merged — into a branch that no
longer goes anywhere. Retarget it to the real base first (`gh pr edit <pr> --base <base>`), let its
checks run on the new merge, and review the new diff, which may now conflict or contain commits it
did not before. Verify that it landed by content — the merged files on the base match the reviewed
ones — and not by a count of commits.

A pull-request workflow runs against a test merge of the head into the base. When the pull request
conflicts with its base, that merge cannot be built, and **no pull-request run is dispatched at
all** — no queued run, no failure, nothing. It looks exactly like a slow or broken queue. When a
pull request gets no runs while others do, read `mergeable` before anything else; `CONFLICTING`
is the answer more often than an outage is.

## 6. Every required check ran and passed on that exact commit

The required checks pass only as a zero exit, a non-empty list, and every check passed.
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

It must exit zero and print `true`. A repository that declares no required checks fails this line,
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

## Then merge by hand, with the head pinned

```bash
gh pr merge <pr> --merge --match-head-commit <reviewed sha>
```

`--match-head-commit` makes the merge fail if the head moved after the checklist: a push from another
session, a bot's commit, an accidental force-push. Without it, the merge takes whatever the head is
at that moment. Use the repository's merge method; the checklist and the pin are what matter.

## After the merge

Fetch the base and confirm that what landed is what was reviewed: the files the
pull request changed should be identical on the base and at the reviewed head:

```bash
git fetch origin
git diff --stat <reviewed-sha> origin/<base> -- <the paths the pull request changed>
```

An empty diff is the answer. A non-empty one means the base moved those files too, or the merge did
not carry what was reviewed, and either deserves a look before anyone is told it shipped.
