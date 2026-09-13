---
name: release-notes
description: "Write the note for one version and put it everywhere the project records releases — what shipped, why it shipped, and what it means for a reader deciding whether to adopt it. Symptoms: ship/cut a release, publish to npm, bump the version, changeset, release notes, CHANGELOG entry, tag a version, patch/minor/major release, create a GitHub/GitLab Release. It writes and places the note and makes the semver call; for describing a change that already landed use describe-changes, and for a what's-new feature inside a product use release-ledger."
license: MIT
compatibility: "Any project that records releases somewhere a reader can find them — a changelog file, a changeset directory, a releases document, a forge Release page. Discovering the version and the destinations needs read access to the repository, and publishing needs the destination's existing credential. An optional Claude Code PreToolUse gate, installed by the user and nobody else, refuses a release whose version no release-note file mentions. Output is the note, in every destination the project uses."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Write Edit Grep Glob Bash
---

# Release notes

A release note is not a git message. A git message records *what a commit changed*. A release
note tells a *future reader deciding whether to adopt this version* three things: **what**
shipped, **why** it shipped (the rationale a commit omits), and **what it means for them** (a
code-change / impact analysis). Every release carries one, in every place the project records
releases.

**Core principle:** if the note would be identical to your commit subject line, it fails. The
value is the *why* and the *impact* — the parts git history does not carry.

### The mechanical half, which is not this file

A separate, optional gate refuses the release command itself when the version being released
is not mentioned in any file that records releases. It is a Claude Code `PreToolUse` hook
carried in this pack's adapter directory (`adapters/claude-code/release-notes-gate.sh`), with
its own installer beside it. It is off until a user installs it, and gone when they run that
installer with `--remove`. Everything above and below is unchanged by it: this file executes
nothing, and nothing in this skill may install the gate or arm it on a user's behalf. If you
want it, say so to the user and let them run it.

**What it does.** It reads Bash commands and acts on four shapes: `npm|pnpm|yarn publish` and
`changeset publish`, `gh|glab release create <tag>`, a release-looking `git tag`, and a `git
commit` that stages a `package.json` version bump. For each it works out which package and
which version, then looks for that version in the project's release-note files. In `block`
mode a version nothing mentions gets a permission denial; in `observe` mode the gate says on
stderr what it would have refused and the release proceeds.

**What it can check.** That the version string is present in a file whose job is recording
releases — `CHANGELOG.md` and its usual spellings, `docs/releases.md`, files under
`docs/releases/`, or a pending `.changeset/` entry. It is string matching against the command
and files on disk, which is the only reason it counts as enforcement rather than more
instructions: no model sits in its path, so there is nothing there to talk round.

**What it cannot check.** Anything this skill is actually about. A heading with a git-message
body under it satisfies the gate completely. It also cannot see a release it does not
recognise as one, and it deliberately allows everything it cannot resolve confidently —
including a project that keeps no release-note file at all, where an armed gate correctly
never fires. It is a floor. The contract below is the grade.

## The contract: every release note has three parts, in this order

1. **What** — the surface that changed, named precisely: package(s) + version(s), the API /
   behavior / flag. One or two sentences. This is the part a commit message already gives you;
   keep it short.
2. **Why** — the rationale a commit omits: the problem it solves, the decision behind it, who
   asked or who it is for. If you cannot state a why beyond "the code changed," question
   whether this is a release at all. **This is the part baseline notes skip; it is mandatory.**
3. **Impact** — a code-change / impact analysis (run the checklist below). What a consumer
   must know or do.

## When to Use

The trigger is the release action, not whether there is anything impressive to say:

- **About to publish a package** — `npm`/`pnpm`/`yarn publish`, `changeset publish`, or any
  registry push.
- **About to bump a version** in a `package.json`, a `Cargo.toml`, a `tauri.conf.json`, or
  wherever this project keeps it.
- **About to cut a tag or create a GitHub/GitLab Release.**
- **About to deploy an app** whose users can tell the difference afterwards.
- **Writing a CHANGELOG entry, a changeset, or a release document** — including the one you
  are tempted to generate from `git log`.
- **When the gate refuses a release.** It is telling you to come back here and write parts 2
  and 3, not to find a way around it.

Do not use it to describe a change that already landed — one commit, one PR, one tag range:
`describe-changes` reads the diff and anchors every claim to a hunk, and its output is the
*what* you hand to this skill. Do not use it to build a what's-new feature inside a product;
that is `release-ledger`, which is a system you install rather than a note you write. And do
not use it for an internal branch merge nobody outside the repository can observe.

## Prerequisites

1. **The version being released, read rather than assumed.** From the manifest, the tag, or
   the changeset — not from memory, and not from the last release plus one.
2. **The change itself, in enough detail to state an impact.** A diff, a PR, or a
   `describe-changes` output. A note written from a branch name is a guess.
3. **The destinations this project uses**, discovered rather than assumed — see below.
4. **The previous note for this project**, so the new one matches its shape and does not
   contradict it.

## Impact analysis: run it, do not guess

Answer each before writing the Impact part. State "none" explicitly for the load-bearing ones
(a silent "no breaking changes" you never checked is the one that bites).

- **Breaking or additive?** New required arg, removed / renamed export, changed return shape,
  stricter default = **breaking → major + a migration note**. New optional arg, new export,
  opt-in flag = **additive → minor**. Docs / internal only = **patch**. Match the version bump
  to this answer: a "small" additive API is still a **minor**, not a patch.
- **Migration** — if anything breaks, the exact steps a consumer takes. If nothing breaks, say
  "no migration, existing call sites are unchanged."
- **Blast radius** — who is affected: downstream packages in this repo, external consumers, a
  specific adopter. Name them.
- **Dependency / distribution effects** — peer-dep range changes, a new required peer, npm
  dist-tag correctness (does this go to `latest`? must a `legacy` or other tag stay
  untouched?), lockfile impact.
- **Runtime behavior** — does existing consumer code behave differently at runtime with no
  change on their side (a changed default, a new throw, a perf shift)? Call it out.

## Where the note lands: every destination the project uses

A release note is not done until it is in every place the project records releases. Discover
them; do not assume one. `ls CHANGELOG.md docs/releases.md`, `ls .changeset/ docs/releases/`,
`gh release list` — and read the project's own release checklist if it has one.

- **Per-version changelog** — the `CHANGELOG.md` entry, the `docs/releases.md` entry, or a
  `.changeset/*.md` that generates one. Monorepo: the changed package's own changelog, **one
  per bumped package**.
- **The published release** — the GitHub / GitLab Release for the tag; its body mirrors the
  changelog entry. A tag or publish without a Release is an incomplete release.
- **Narrative wave notes** — for a multi-package or headline wave, a document that tells the
  story once, beyond the mechanical per-package entries.
- **Downstream surfacing** — if the release changes a public doc or site claim, the note names
  that follow-up; it is part of the impact.

Never auto-generate the changelog from `git log` and call it done. The generator gives you
part 1 (the *what*) and drops parts 2 and 3. Take its line, then add the *why* and the
*impact*.

## Procedure

1. **Read the version and the change.** Manifest version, and the diff or the
   `describe-changes` output. Complete when you can name the package, the version, and the
   surface that moved.
2. **Run the impact analysis above, in writing.** Complete when every bullet has an answer,
   including the explicit "none"s.
3. **Settle the semver bump against that answer, not against the plan.** If they disagree,
   change the bump or change the release. Complete when the version in the manifest matches
   the impact you just wrote down.
4. **Discover every destination.** Complete when you have a list, and each item is a path or a
   URL rather than a category.
5. **Write the note once**, in the three parts, and adapt it per destination without letting
   the versions drift apart. Complete when the changelog entry and the Release body say the
   same thing.
6. **Score it with the sell-test.** Complete when it scores 3 or better, or you have rewritten
   it.
7. **Place it, then release.** The note goes in *before* the publish, the tag and the Release.
   Complete when every destination on the list from step 4 has it.

## Sell-test: score before you ship

One point each, 0-4. Below 3, rewrite.

| Check | Passes when |
|---|---|
| **What?** | names the real surface, not "updated X" |
| **Why?** | states the motivation, not the diff |
| **Impact?** | answers "what breaks / what do I do" from the checklist |
| **Adopt?** | a reader can decide whether to take this version |

If it reads like a commit message, it scored 1. Rewrite.

## Usage Examples

### A note that works

```markdown
## 2.1.0

**What.** `@acme/client` 2.1.0 adds an optional `signal` argument to `fetchAll()` and exports
`AbortError`.

**Why.** Long list pages could not be cancelled, so navigating away left the request running
and the response landed on an unmounted view — the second-most-reported issue this quarter,
and the one workaround (a wrapper promise) leaked the underlying request anyway.

**Impact.** Additive, minor. No migration: `fetchAll()` without a signal behaves exactly as
before, and no existing call site changes. Affects every consumer of `@acme/client`;
`@acme/admin-ui` is the one in this repo that should adopt it. Goes to `latest`; the `legacy`
tag stays on 1.x. No peer-dependency change. One runtime difference to know about: a request
aborted through the new signal now rejects with `AbortError` instead of hanging.
```

### The same release, reported badly

```markdown
## 2.1.0

- Add signal support to fetchAll
- Update tests
```

Four failures. It is the commit subject reworded (scores 1 on the sell-test). It states no
*why*, so a reader cannot tell whether this fixes something they are hitting. It states no
*impact*, so "is this safe to take" is unanswerable — and the unstated `AbortError` rejection
is a real runtime change. And it would pass the gate, because `## 2.1.0` is there: exactly the
case the gate is a floor for rather than a grade.

## Pitfalls

- **"It's just a patch / one line / a docs fix."** The smallest release still needs a why and
  an impact line. "Additive, no migration, existing call sites unchanged" is a fine one-liner.
  Say it; do not omit it.
- **"The commit message already explains it."** The commit is the *what*. A note that equals
  the commit is a failing note.
- **"I'll write proper notes later."** Later is after it is published and someone is already
  reading the thin one. npm and the forge Release cache it; you are now editing a note people
  have read.
- **"The changelog is auto-generated from the diff."** That is the *what* only. Add the *why*
  and the *impact*.
- **"I flagged the semver mismatch, then shipped it as a patch anyway."** Either bump to match
  the impact analysis, or the note is dishonest.
- **"The gate let it through."** The gate checks that the version is mentioned, not that
  anything under it is a why or an impact. A heading with a git-message body passes the gate
  and fails this skill.
- **One entry for a change that bumped three packages.** Each bumped package needs its own.
- **Claiming "no breaking changes" without running the checklist.** A changed default or a new
  throw is a runtime break even behind an additive signature.
- **A tag or a publish with no Release.** An orphaned tag is not a release.

## Verification

Before the publish, the tag or the Release — not after:

1. The note has all three parts, in order, and the *why* is not a restatement of the *what*.
2. Every impact bullet was answered, with explicit "none"s where that is the answer.
3. The version bump matches the impact analysis.
4. Every destination discovered in step 4 has the note, and they agree with each other.
5. The sell-test scores 3 or better.
6. For a monorepo: one entry per bumped package, each naming its own version.
