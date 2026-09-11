---
name: work-in-external-repo
description: "Work in a repository that is not the current working directory: establish the target by name, prove the checkout by its origin remote before writing, refresh the base ref, build in a dedicated worktree instead of a shared checkout, and name the repository, branch, worktree and commits in the result. Use when a change, a branch or a pull request is requested against another repository."
license: MIT
compatibility: "Any machine with git and a shell the agent can run commands in; nothing to install. Locating a checkout needs read access to the roots repositories live under. Refreshing the base ref needs the network: where the fetch fails the skill reports the ahead/behind as unknown rather than branching blind. A GitHub CLI is optional and used only where a pull request is asked for. Output is the change plus the repository, branch, worktree path and commits it landed in."
metadata: "group=workflow; lifecycle=delivery; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Write Edit Grep Glob Bash
---

# Work in an external repository

The work is wanted somewhere else — another repository, on this machine or not yet on it — and
every way that goes wrong is quiet. The agent edits a checkout whose directory has the right
name and belongs to a fork. It works directly in a checkout another session is holding. It
branches off a base ref last fetched in a different month. It clones to a path it invented,
producing a second copy nobody will find. And at the end it reports two commits and a green
test run without ever naming a repository, so the reader — looking at their own terminal —
concludes the work landed here.

None of these announce themselves. Every command succeeds, the diff looks right, and the
damage surfaces in somebody else's session or in a pull request that conflicts from its first
line.

This skill owns the route to the target and the tree the work happens in: establishing which
repository is meant, proving the checkout is that repository, getting a current base, working
somewhere nobody else is standing, and saying afterwards where the work went. It does **not**
own the change — `land-complex-change` contains that. It does not own the description of the
diff (`describe-changes`), the review loop (`request-blocks-review`), or the shape of a status
report (`report-progress`); it hands that report one line it must carry, which is where the
work landed.

### What this skill does not own

| The job | Whose it is | What this skill does with it |
|---|---|---|
| Containing the change once you are in the right tree | `land-complex-change` | Hands over a clean worktree at a known base; declares no touch-set of its own. |
| Saying what the landed diff did | `describe-changes` | Calls it after the commits exist, in the worktree it created. |
| The review loop over the pull request | `request-blocks-review` | Hands over the repository, branch and head sha; runs no review of its own. |
| The shape of progress reports | `report-progress` | Supplies the destination line every report of external work owes. |
| What the child agents are doing | `agent-lifecycle` | Consumes it; two agents in one repository is exactly when it is needed. |

Install the companions with `npx skills add crissmoldovan/agent-skills`.

## When to Use

- The request names **another repository** — by owner and name, by URL, or by a shorthand only
  the user can resolve — and the change belongs there rather than here.
- A branch, a commit or a pull request is wanted in a repository that is not this working
  directory.
- The target may not be on this machine at all, and a clone is on the table.
- The target **is** on this machine as a checkout a person or another session may be using.
- Two agents are working in one repository at the same time, whatever the task.
- A previous session left a worktree behind and this session continues that work.

Do not use it for work in the current repository: everything here is overhead you have already
paid. Do not use it for read-only inspection of another repository — locating a checkout,
reading its files, running `git log` in it — that changes nothing and needs no worktree; only
the write turns this on. Do not use it as a plan for the change itself; the moment the tree is
right, `land-complex-change` takes over and this skill is finished until the result is written.

## Prerequisites

1. **The target as a remote, not as a directory.** `owner/name`, or a clone URL.
   **Complete when:** the target is written down in a form that would identify the same
   repository on a machine with no local checkouts at all.
2. **The base ref the work branches from.** `main` is a guess, not a default; some repositories
   release from another branch.
   **Complete when:** the base ref is named, or the user has confirmed the repository's default.
3. **Somewhere worktrees may be created.** A parent directory that exists and is not inside the
   shared checkout.
   **Complete when:** the parent path is known and the user approved it if it is new.
4. **Whether the work may be pushed.** Push access, a fork, or an agreement that this ends at a
   local branch.
   **Complete when:** the end state of the branch is agreed before the first commit, not
   discovered at the push.
5. **Knowledge of who else is in there.** Another agent, another session, a person with a dirty
   tree.
   **Complete when:** `git -C <repo> worktree list` and `git -C <repo> status` have been read,
   and a dirty shared tree is treated as occupied.

## Procedure

1. **Establish the target repository by name, before anything else.** Never assume the current
   repository is the target — the working directory is where the conversation happens, not
   where the work belongs. Resolve the request to `owner/name` or a URL. If it arrives as "the
   skills repo" or "the API one", ask which remote that is; do not resolve a nickname against
   the filesystem and take the first hit.
   **Complete when:** the target is stated as a remote, and nothing has yet been read from a
   directory chosen because its name looked right.

2. **Locate before creating.** Search the roots repositories live under —
   `find <search-root> -maxdepth 3 -type d -name .git` — and read
   `git -C <candidate> worktree list`, which shows checkouts of that repository you would
   otherwise clone a second time. Then prove the candidate:
   `git -C <candidate> remote get-url origin` must equal the target. **A directory with the
   right name is not proof**: forks, vendored copies and abandoned clones all carry the name of
   the thing they were copied from. If **zero** candidates survive, go to step 3. If **several**
   do, ask the user which one, listing each candidate's origin URL and current branch — picking
   the newest or the shortest path is a guess wearing a decision's clothes.
   **Complete when:** the chosen path's `origin` matches the named target, confirmed before any
   write rather than after the first edit; or the user has chosen from candidates you listed.

3. **If it is not on this machine, confirm the destination before cloning.** Never invent a
   parent directory, and never clone into the current repository's tree. Propose a path, get it
   confirmed, then `git clone <url> <path>`. Clone fully: a `--depth` clone makes the ahead/
   behind count in the next step meaningless and can refuse a `worktree add` from an old ref.
   **Complete when:** the clone exists at a path the user named or approved, and its `origin` is
   the target's URL.

4. **Refresh the base ref and report ahead/behind.** `git -C <repo> fetch origin`, then
   `git -C <repo> rev-list --left-right --count origin/<base>...HEAD` — the left number is how
   far **behind** the local ref is, the right is how far **ahead**. Say both out loud. A stale
   base is the default state of a checkout nobody has touched, not an exception, and a checkout
   hundreds of commits behind looks exactly like a current one from the inside. If the fetch
   fails, say the ahead/behind is unknown; do not branch blind and call it current.
   **Complete when:** the fetch ran in this session and both counts are stated, or the failure is
   reported in place of them.

5. **Create a dedicated worktree on a new branch, never in the shared checkout.** The form is
   `git worktree add -b <branch> <path> <base>`, run as
   `git -C <repo> worktree add -b feat/<slug> <parent>/<repo>-wt-<slug> origin/<base>`. The third
   argument is the base ref and it is not optional: omit it and git silently branches from
   whatever HEAD the shared checkout is sitting on, which may be another session's half-finished
   branch. Work in that new path only. Another session may be using the shared checkout, and its
   branch, its index and its uncommitted files are not yours to move.
   **Complete when:** the worktree exists outside the shared checkout, `git -C <worktree> status`
   is clean, and the branch points at the ref fetched in step 4.

6. **Keep off the shared tree: the forbidden operations.** In any tree another session or person
   may be using — including the checkout you located in step 2 — never run `git stash`,
   `git reset`, or `git checkout --`, and never rebase or amend a commit you did not create.
   Each is silent by design: it prints almost nothing, it exits zero, and what it destroys is
   somebody else's uncommitted work, which has no reflog to recover it from. Stage by explicit
   path — `git -C <worktree> add <path>` — never a whole-tree stage, so a file you did not write
   cannot ride along in your commit.
   **Complete when:** every git command run outside your own worktree was read-only, and every
   commit staged only paths you named.

7. **Name the destination in every result.** Repository, branch, worktree path, commits by sha
   and count. A result that does not name the repository invites the reader to assume the
   current one — they are looking at their own terminal, and nothing in your answer contradicts
   them. This line is owed in intermediate reports too, not only at the end.
   **Complete when:** the answer states repository, branch, worktree path and commits, and a
   reader who never saw a command of yours can tell which repository changed.

8. **Clean up, or hand over in writing.** Either remove the tree —
   `git -C <repo> worktree remove <path>` then `git -C <repo> worktree prune` — or say in the
   result that it remains, where it is, and on which branch. A forgotten worktree blocks the
   branch from being deleted (`git branch -d` refuses while a worktree holds it), leaves an
   administrative entry in the parent repository, and hands the next session a second tree whose
   purpose nobody remembers.
   **Complete when:** the worktree is gone from `git -C <repo> worktree list`, or the result
   names the path that survives and why it was kept.

## Usage Examples

```text
The change goes in <owner>/<repo>, not in this working directory. Find the checkout if it is on
this machine, and confirm it is the right one by its origin remote before you write anything.
If you find none, or more than one, tell me what you found and let me pick — do not choose.
```

```text
Before you branch: fetch the base and tell me how far behind that checkout is. If it is more
than a handful of commits, I want to hear the number before you build anything on it.
```

```text
Another agent is working in that repository right now. Do your work in a worktree of your own
off origin/main, and do not run stash, reset or checkout -- anywhere in the shared checkout.
Stage only the paths you actually wrote.
```

```text
When you are done, tell me which repository and branch the commits are on, the worktree path,
and whether you removed it. "Done, 2 commits" tells me nothing about where they are.
```

### The sequence, end to end

```text
# 1. Locate, then prove it — a matching directory name is not proof of anything.
find <search-root> -maxdepth 3 -type d -name .git
git -C <candidate> remote get-url origin       # must equal the named target
git -C <candidate> worktree list               # what is already checked out, and where

# 2. Refresh the base. Left = commits you are behind; right = commits you are ahead.
git -C <candidate> fetch origin
git -C <candidate> rev-list --left-right --count origin/main...HEAD

# 3. Branch into a tree of your own, off the ref you just fetched.
git -C <candidate> worktree add -b feat/<slug> <parent>/<repo>-wt-<slug> origin/main

# 4. Work there, staging by explicit path only.
git -C <parent>/<repo>-wt-<slug> add <path>
git -C <parent>/<repo>-wt-<slug> commit -F <message-file>

# 5. Hand back: remove the tree, or say in the result that it remains.
git -C <candidate> worktree remove <parent>/<repo>-wt-<slug>
git -C <candidate> worktree prune
```

### A result that names where the work landed

```text
Repository: <owner>/<repo> — origin git@github.com:<owner>/<repo>.git. Not this working
directory; nothing here changed.
Branch: feat/<slug>, cut from origin/main at a1b2c3d, fetched in this session (0 behind).
Worktree: <parent>/<repo>-wt-<slug> — still present, deliberately, for the review pass.
Commits: 2 — 4d1f0c7, 9e8a210. Pushed to origin/feat/<slug>; no pull request opened.
```

Every line of it is checkable by someone who saw none of the session: the repository is named
as a remote rather than as a path, the base carries the sha it was cut from and the freshness
of that ref, the worktree's survival is stated rather than left to be discovered, and the
commits are countable.

## Pitfalls

- **The right name, the wrong repository.** A directory named for the project is evidence of
  nothing — forks, vendored copies and year-old clones all keep the name. The change lands in
  a copy, every test passes, and the pull request goes to a repository nobody watches.
- **A base ref nobody has fetched in weeks.** In the session that produced this skill, the
  located checkout was **228 commits behind** its origin, and looked entirely normal from the
  inside. Authoring there would have produced a change built on a file two generations old and
  a pull request that conflicts from its first line — work that reviews as careless and was
  merely stale.
- **`git stash` in a shared worktree.** Two agents were working in one tree; one ran
  `git stash` to get a clean status before committing, and the other agent's **uncommitted**
  files silently reverted underneath it for about a minute. Nothing errored, nothing warned,
  and the second agent watched its own edits disappear mid-task. There is no reflog for
  uncommitted work.
- **`worktree add` with no base ref.** It succeeds, and branches from whatever HEAD the shared
  checkout happened to be on — frequently another session's half-finished branch, which then
  arrives inside your diff as commits you did not write.
- **Cloning to an invented path.** A second copy appears somewhere the user does not look;
  later they find two checkouts, cannot tell which one holds the work, and the honest answer
  requires reading both.
- **The unnamed destination.** "Done — 2 commits, tests green" reads as *here* to anyone in
  their own terminal. The correction arrives days later, usually from a colleague asking why
  a branch exists.
- **The forgotten worktree.** `git branch -d` refuses while a worktree holds the branch, the
  parent repository keeps an administrative entry pointing at a path that may no longer exist,
  and the next session inherits a tree whose purpose nobody recorded.
- **"Just for a minute" in the shared checkout.** The minute becomes a commit on the wrong
  branch, or a dirty tree handed back to whoever was already using it.
- **A shallow clone.** `--depth` makes the ahead/behind count meaningless and can refuse a
  `worktree add` from a base older than the truncation — after the branch was promised.
- **Assuming push access.** Discovered at the push, after the commits exist, when the only
  choices left are a fork nobody agreed to or a branch that stays local and unannounced.

## Verification

- [ ] The target was stated as a remote — owner and name, or a URL — before any directory was
      chosen.
- [ ] The chosen checkout's `origin` remote was read and matches that target; its directory name
      was not the evidence.
- [ ] Where zero or several candidates were found, the user chose between what you listed.
- [ ] Any clone landed at a path the user named or approved, and was not shallow.
- [ ] `git fetch` ran in this session, and both the ahead and behind counts against the base ref
      appear in the result — or the fetch failed and the result says the counts are unknown.
- [ ] The branch was cut from the fetched remote ref, with that ref given explicitly to
      `worktree add`.
- [ ] Every edit happened in the dedicated worktree; the shared checkout's working tree is as it
      was found.
- [ ] No `git stash`, `git reset`, `git checkout --`, rebase or amend ran outside your own
      worktree.
- [ ] Every commit staged only paths named explicitly.
- [ ] The result names the repository, the branch, the worktree path and the commits by sha.
- [ ] The worktree was removed and no longer appears in `git worktree list`, or the result says
      it remains, where, and why.
- [ ] A reader holding only the final answer can say which repository changed, on which branch,
      and what is left to do there.

The work is finished when someone who never saw the session can find it: a named repository, a
named branch, a sha they can check out, and no second tree left behind that nobody can account
for.
