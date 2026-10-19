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

A reviewer reads project instruction files from the tree it runs in, and its configuration decides
which names count. Codex, read from its source: in each directory from the project root down to
where it runs, the first that exists of `AGENTS.override.md`, `AGENTS.md` and each name in
`project_doc_fallback_filenames`. A configuration with `project_doc_fallback_filenames = ["CLAUDE.md"]`
takes instructions from `CLAUDE.md` wherever no `AGENTS.md` sits beside it. That configuration comes
in layers — the user's `config.toml`, the profile in use, a `-c` override on the command, managed
settings, and a project's own `.codex/config.toml`, which a pull request can add. A Codex session's
own record of a review opens with `AGENTS.md instructions for <the directory it ran in>` whichever
file supplied them, so it shows that instructions were loaded, not which file they came from.

The round runs in a worktree at the pull request's head, so a pull request that adds or edits any of
those files hands the reviewer instructions nobody has reviewed: one line can tell it to grade
everything P3. A round over such a diff is not independent until a person has read those changes
and recorded that in the round's record.

Build the list from the reviewer, not from this page: every name its active configuration loads,
from every layer that applies to the run — or, for a reviewer whose session record names each
instruction file it loaded, that list. The reviewer's configuration in the tree, for Codex anything
under `.codex/`, is on the list whatever it says, because it can change the list; and where a file
on the list is a symbolic link, its target is on it too. When the list cannot be established — a
layer you cannot read, an override you did not see, a reviewer that does not say — fail closed:
every instruction-like file the diff touches counts, and a person reads each one. Record which list
the round used.

```bash
# instruction_files <recorded base> <reviewed sha> [name...]: the files the pull request changed that
# can carry the reviewer's instructions. Pass every name its active configuration loads, for Codex
# AGENTS.override.md, AGENTS.md and each project_doc_fallback_filenames entry. With no name it fails
# closed, onto every instruction-like file. .codex/ and any path git had to quote are listed either way.
instruction_files() {
  local changed
  changed=$(git -c core.quotePath=false diff --name-only --no-renames "$1...$2") || { echo "CANNOT TELL: the diff could not be listed"; return 1; }
  printf '%s\n' "$changed" | NAMES="${*:3}" awk '
    { path = tolower("/" $0); file = path; sub(/.*\//, "", file)
      hit = path ~ /\/\.codex\// || substr($0, 1, 1) == "\""
      n = split(tolower(ENVIRON["NAMES"]), name, " ")
      for (i = 1; i <= n; i++) if (file == name[i]) hit = 1
      if (n == 0 && path ~ /\/(agents|claude)[^\/]*\.md$|\/\.(cursorrules|clinerules|windsurfrules)$|\/\.github\/copilot-instructions\.md$|\/\.(agents|claude|cursor|windsurf)\/|\/\.github\/instructions\//) hit = 1
      if (hit) print }'
}
instruction_files <recorded base> <reviewed sha> AGENTS.override.md AGENTS.md CLAUDE.md   # this run's names
```

Every path it prints is read by a person before the merge, and the record says so. It prints nothing
only when the diff touches none of them; `CANNOT TELL` is not that, and stops the merge like a hit.
Names are compared without regard to case, as a case-insensitive file system would find them, and
with no name given it lists the instruction files of some common agents: `AGENTS*.md`, `CLAUDE*.md`,
`.cursorrules`, `.clinerules`, `.windsurfrules`, `.github/copilot-instructions.md`, and anything
under `.agents/`, `.claude/`, `.cursor/`, `.windsurf/` or `.github/instructions/`. That list is a
floor, not a definition: any other file in the diff written for an agent to read — another tool's
instructions or configuration — is read by a person as well.

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
