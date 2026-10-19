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

## 7. Nothing in the diff told the reviewer what to say

A reviewer reads instructions and configuration from the tree it runs in, and the round runs it in a
worktree at the pull request's head. A pull request that adds or edits such a file hands the reviewer
instructions nobody has reviewed: one line can tell it to grade everything P3. Filtering the diff for
the files that matter does not converge. Every filter tried here missed another way in: a configured
fallback name, a symbolic link whose target changed, a setting that names another file, a name with a
space in it. So the channel is cut instead.

**Run the reviewer so that it takes nothing from the tree.** For Codex, read from its source at
`openai/codex@fbb2f9d`:

- Its project instruction files — `AGENTS.override.md`, `AGENTS.md` and each
  `project_doc_fallback_filenames` name (`codex-rs/core/src/agents_md.rs:272-296`) — are read only
  while `project_doc_max_bytes` is above zero; at zero, none is (`agents_md.rs:68-72`, `:133-135`). A
  `-c` flag is a session layer, which outranks a project's (`codex-rs/config/src/config_layer_source.rs:46-47`),
  so nothing in the tree can raise it again. The user's own instructions, in `$CODEX_HOME`, still apply.
- A `.codex/` directory between the project root and where it runs is a configuration layer of its
  own (`codex-rs/config/src/loader/mod.rs:1705-1725`). It can set `model_instructions_file`
  (`codex-rs/config/src/config_toml.rs:275`), which is not among the keys Codex strips from a project
  layer (`loader/mod.rs:89-102`), and no flag turns the layer off.
- A `.agents/skills/` directory there is read as a root of skills
  (`codex-rs/ext/skills/src/host_roots.rs:24-25`, `:137-185`).

So the recipe runs `codex exec review -c project_doc_max_bytes=0` from the root of the tree, which is
also its project root (its `.git` is the default marker), and `review_round` refuses a tree that holds
`.codex` or `.agents` there, before the reviewer starts. A round run that way took no instructions
from the tree, and this line holds with nothing more to read. Check these facts again against the
Codex you run when its version changes.

**When the reviewer cannot be told to ignore the tree** — another reviewer, a tree the round refused,
a Codex that no longer works this way — a person reads every change the diff makes to a file any
reviewer could take as instructions or configuration, every symbolic link it adds, changes or
removes, and every configuration file the reviewer reads, and records that in the round's record. No
list of names decides what is read: every file the diff touches is listed, and the person judges each.

```bash
git diff --name-status --no-renames <recorded base>...<reviewed sha>   # every file the diff touches
git diff --raw --no-renames <recorded base>...<reviewed sha> | grep -E '^:(120000 [0-7]{6}|[0-7]{6} 120000) '   # every symbolic link
```

## The merge

When every line has held, merge with the head pinned:

```bash
gh pr merge <pr> --merge --match-head-commit <reviewed sha>
```

`--match-head-commit` makes the merge fail if the head moved after the checklist: a push from another
session, a bot's commit, an accidental force-push. Without it, the merge takes whatever the head is
at that moment. Use the repository's merge method; the checklist and the pin are what matter.

## After the merge

Confirm that what landed is what was reviewed: with `--merge`, the merge commit's second parent is
the reviewed head.

```bash
git fetch origin
merge=$(gh pr view <pr> --json mergeCommit --jq .mergeCommit.oid)
[ "$(git rev-parse "$merge^2")" = "<reviewed sha>" ] && echo "merged the reviewed head"
```

Do not compare the merged files with the reviewed head's. When the base changed one of the same
files on another line, a correct merge carries both changes and that comparison reports a
difference. A squash or rebase merge has no second parent; check those by the pull request's own
record of the commit it merged.
