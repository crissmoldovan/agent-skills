# Releases

## Published catalog

This public catalog ships `model-routing`, `agent-lifecycle`, `blocks`,
`request-blocks-review`, `secure-credential-setup`, `derive-codebase-context`,
`publish-agent-skill`, `update-agent-skills`, `release-ledger`, `github-webhooks`,
`describe-changes`, `investigate-codebase`, `blast-area`, `visualise-blast-area`,
`decision-journal`, `delphi-ground`, `delphi-imagine`, `land-complex-change`,
`resolve-problem-report`, `new-ux-discovery`, `workspace-governance`, `report-progress`,
and `work-in-external-repo`, plus the canonical lifecycle runtime package under
`packages/agent-lifecycle`, the journal runtime package under `packages/agent-journal`,
and the separately installable workspace-governance CLI package under
`packages/workspace-governance`.

Routing and lifecycle compose as documented in [the composition guide](composition.md).
`blocks` is independent review tooling. `release-ledger`, `github-webhooks`, and
`describe-changes` compose as release orchestration, capture, and entry authoring,
while each remains usable alone. `investigate-codebase`, `blast-area`,
`visualise-blast-area`, `land-complex-change`, `resolve-problem-report`, and
`new-ux-discovery` compose the same way over evidence, change mapping and contained
delivery, each naming the sibling that owns the adjacent job and each usable alone.

`decision-journal` records why a decision was made, anchored to evidence a reader can
check, and stands alone. It carries its own CLI as `scripts/agent-journal.mjs`, bundled
from `packages/agent-journal` by `npm --prefix packages/agent-journal run bundle:skill`
and checked against that source by `npm run verify`; `scripts/install-cli.mjs` puts it
on PATH. `delphi-ground` builds a verified-facts briefing, and
`delphi-imagine` reviews an artefact against it from named perspectives.

`report-progress` and `work-in-external-repo` are workflow skills that sit beside the
delivery family rather than inside it. `report-progress` owns the shape of what the reader
is told during long work and reads `agent-lifecycle` for its "what is running" section;
`work-in-external-repo` owns the route to a target repository and the tree the work happens
in, and hands over to `land-complex-change` once that tree is right. Both are usable alone.

## Unreleased

Prose for the next catalogue release. Nothing below is published until the version is
bumped, the branch is merged, and a tag carries these notes.

### Two new skills: reporting progress, and working in a repository that is not this one

**What changed.** The pack gains two workflow skills and now ships twenty-three.

`report-progress` fixes the shape of a progress report and the line between what the
reporter verified and what somebody else claimed. Long work tends to fail its reader in one
of two ways: silence, so nobody can tell whether anything is still happening, or fluent
narration that passes a child agent's "all tests pass" along as though the reporter had
watched it run. The skill answers both with three required sections — what is done, what is
running, what is next, each carrying a count or a named artefact — a rule that every number
sits beside the command that produced it or is attributed and marked unverified, a
requirement to name the user-facing consequence rather than the code change, corrections
stated in one plain sentence at the point they matter, and a ban on describing a result that
has not happened yet. It ends in a checklist a reviewer can run over a report that is
already written. It is explicit about its own limit: a skill is instructions and cannot
intercept a message, so what it removes is the ambiguity about what was owed, not the
possibility of a bad report.

`work-in-external-repo` covers work requested against a repository that is not the current
working directory, where every failure is quiet. Two of them are on record from the session
that motivated the skill: a located checkout that was 228 commits behind its origin and
looked entirely normal from the inside, and two agents sharing one worktree where a
`git stash` silently reverted the other agent's uncommitted files for about a minute. The
procedure establishes the target as a remote before any directory is chosen, proves a
candidate checkout by its `origin` URL rather than its name, confirms a destination before
cloning, fetches and states both ahead and behind counts, works in a dedicated worktree cut
from the fetched ref, forbids `git stash`, `git reset`, `git checkout --`, rebase and amend
anywhere another session may be standing, and requires every result to name the repository,
branch, worktree path and commits — because "done, 2 commits" reads as *here* to a reader
looking at their own terminal.

**Who should care.** Anyone who runs multi-phase or background work and has been asked
"where are we" mid-run; anyone whose agents dispatch children they cannot observe; and
anyone who asks an agent to change a repository other than the one it is sitting in,
especially where a checkout is shared with a colleague or a second session.

**Compatibility.** Additive. No existing skill's contract, frontmatter, or carried
reference changed, and neither runtime package was touched, so an installed pack keeps
working exactly as before if these two are never installed. The repository README's pack
count moved from twenty-one to twenty-three and its install block gained a line for the
pair.
Node.js 24 or newer is still the requirement for `npm run verify`. Neither skill carries a
script, a reference file or a runtime of its own: each is a single `SKILL.md`, and the only
tool `work-in-external-repo` asks for is the git an agent already has.

**Action required to receive it.** Nothing is delivered by publication alone. Add the pair
to an existing installation:

```bash
npx skills add crissmoldovan/agent-skills --skill report-progress work-in-external-repo
```

Or work at the scope you actually use. `npx skills update` refreshes skills that are
already installed; adding the complete pack is what brings across a skill that was not there
before:

```bash
npx skills update --project --yes
npx skills update --global --yes
npx skills add crissmoldovan/agent-skills --skill '*' --global --agent '*' --yes
```

Restart or reload any agent whose loader caches installed files; a session already open will
keep using the instructions it loaded at start.

### `npm run verify` is green on macOS again

**What changed.** Thirty-one of the seventy-two `workspace-governance` tests had been failing
on every macOS machine, and one further test asserted a Linux-only code path unconditionally.
Nothing in CI could see it: GitHub Actions runs Linux, where `/var` is a real directory.

The mechanism is a macOS detail with a sharp edge. Fixtures build scratch roots with
`mkdtemp(join(tmpdir(), …))`, which on macOS lands under `/var/folders/…`; local discovery
refuses any root with a symlink ancestor, and macOS resolves `/var` to `/private/var`. So the
very first path component of every fixture root was rejected, and every affected test failed
with the same opaque `Invalid input (INVALID)`.

The refusal is correct and is left exactly as it was: it is a published contract in four
documents, and it is the precondition that makes the containment check on a `.git` file's
`gitdir:` pointer meaningful — a lexical prefix test against a non-canonical root proves
nothing. The fixtures were wrong, not the guard, so the fixtures now resolve their scratch
root before handing it over. `packages/agent-journal` already did exactly this, with a comment
naming the same cause. No file under `src/` changed.

**Who should care.** Anyone running `npm run verify` on macOS — step 3 of the release
checklist in this document, which could not pass there. On Linux the change is the identity
function: resolving a path with no symlink ancestors returns the same string.

## Release checklist

1. Confirm every new or changed skill is under `skills/<name>/SKILL.md`.
2. Update the repository catalogue README with the exact frontmatter description,
   install coordinates, and update guidance.
3. Run `npm run verify` with Node.js 24 or newer.
4. Review all content against the [public-content policy](public-content-policy.md).
5. Merge through a reviewed pull request after CI succeeds.
6. Tag and publish human-readable GitHub Release notes explaining outcomes,
   compatibility/migration, who should update, and exact update action.
7. Read back main, release, installer discovery, and isolated installation before
   encouraging humans or agents to update.

## Versioning

The repository version records public catalog releases. Use semantic impact:
major for broken existing guidance/contracts, minor for new skills or substantive
new guidance, and patch for corrections within an already-correct contract.

## Changelog and update communication

GitHub Releases are the public changelog. A tag or generated diff is not release
notes. [`CHANGELOG.md`](../CHANGELOG.md) carries the same entry per version inside the
repository, so `git log` alone answers what shipped in which version; a Release body and
its changelog entry must agree. Notes must explain end-user behavior and exact update instructions.
Repository README and agent-facing update prompts must agree with the published
catalogue. Encouraging an update never authorizes mutation of a user's machine;
local synchronization remains an explicit target handled by `update-agent-skills`.

Release notes reach a reader only if they learn the release happened.
`update-agent-skills` carries a read-only freshness check that compares an
installed pack against the published tree and prints the stale skills, the latest
release, and the exact scoped command, plus an installer for an optional
`SessionStart` hook that runs it. The check never invokes the Skills CLI, whose
`check` is a mutating alias for `update`. Its notify mode reports and stops;
installing its auto mode is the user's standing consent to update that source at
that scope, and is withdrawn by removing the hook. Announcement remains
communication, and mutation remains something a user asks for. The update-check
design—asymmetric cache lifetimes, a fenced network call, and the split between
notifying and applying—is informed by garrytan/gstack's update-check design.

Future publication work is tracked in the [roadmap](roadmap.md); roadmap items
must not be described as shipped until implemented and verified.
