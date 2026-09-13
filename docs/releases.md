# Releases

## Published catalog

This public catalog ships `model-routing`, `agent-lifecycle`, `blocks`,
`request-blocks-review`, `secure-credential-setup`, `derive-codebase-context`,
`publish-agent-skill`, `update-agent-skills`, `release-ledger`, `github-webhooks`,
`describe-changes`, `release-notes`, `investigate-codebase`, `blast-area`,
`visualise-blast-area`, `decision-journal`, `delphi-ground`, `delphi-imagine`, `land-complex-change`,
`resolve-problem-report`, `new-ux-discovery`, `workspace-governance`, `report-progress`,
and `work-in-external-repo`, plus the canonical lifecycle runtime package under
`packages/agent-lifecycle`, the journal runtime package under `packages/agent-journal`,
and the separately installable workspace-governance CLI package under
`packages/workspace-governance`.

Routing and lifecycle compose as documented in [the composition guide](composition.md).
`blocks` is independent review tooling. `release-ledger`, `github-webhooks`,
`describe-changes`, and `release-notes` compose as release orchestration, capture,
entry authoring, and the note for one version, while each remains usable alone.
`release-notes` is the one that makes the semver call and places the note in every
destination the project records releases in; it carries an optional Claude Code
`PreToolUse` gate under `adapters/claude-code/` that refuses a release whose version
no release-note file mentions, and, like every hook in this pack, the user installs
it and nothing installs it for them. `investigate-codebase`, `blast-area`,
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

### `release-notes` joins the pack, with the gate that stops an unnoted release

**What changed.** The catalogue version moves to **0.16.0** — minor, by this repository's own
rule that a new skill is a minor. A twenty-fourth skill, `release-notes`, plus its mechanical half:
`adapters/claude-code/release-notes-gate.sh` and `install-release-notes-gate.mjs`. The skill
writes the note for one version — what shipped, why it shipped, and an impact analysis a
reader can act on — and places it in every destination the project records releases in. The
gate is a `PreToolUse` hook on `Bash` that refuses `npm|pnpm|yarn publish`, `changeset
publish`, `gh|glab release create`, a release-looking `git tag`, and a version-bump `git
commit` when the version being released is not mentioned in any file that records releases.

**Why.** Two skills already in this pack named `release-notes` in their own text as the owner
of the job neither of them does — `release-ledger` ("it does not write the notes for one
version — that is release-notes") and `describe-changes` ("it does not cut a release … for
that use release-notes"). Both described it as *a skill outside this pack, installed
alongside it*, which was true and is no longer: it lived in one directory on one machine and
was not in any git repository at all. Those two sentences now point inside the pack, which is
the only reason this is a catalogue change rather than a file move.

The gate exists because the skill is instructions, and instructions are skippable in exactly
the moment this one matters: the note is the last thing between here and `npm publish`, and
nobody is reading. One fault it carries a scar from — `git -C <dir> tag v1.2.3` contains no
`git tag` substring, so the detector missed it entirely and every tag cut against another
checkout went completely ungated. That is how a release got tagged with no note at all.

**Impact.** Additive, minor. Nothing is renamed, removed or merged; twenty-three skills become
twenty-four, and existing installs keep working unchanged. `release-ledger` and
`describe-changes` change only the sentence that pointed outside the pack.

**The gate is not installed by this release, and nothing will install it for you.** It ships
off. A user who wants it runs the installer themselves, from a checkout of this repository —
`node adapters/claude-code/install-release-notes-gate.mjs --mode observe` to watch it for a
day, `--mode block` to arm it, `--remove` to take it back out. No skill and no agent may run
that on a user's behalf, and the skill carries no command that would.

**Two limits to read before arming it.** It checks that the version is *present* in a
release-note file; it cannot check whether what is written there says why the release happened
or what it breaks, so a heading with a git-message body passes the gate and fails the skill.
And it is fail-open by design: a project with no release-note file at all is allowed, silently,
so **an armed gate that never fires is the expected outcome there** rather than a sign the
installation worked. Confirm it with `--mode observe` against a release you know has no note.

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
`check` is a mutating alias for `update`. Every verdict it has is printed as text
on stdout and delivered to the session on exit 0 — drift, and equally the
`unknown` it returns when it could not determine anything at all. An exit code
that means both "current" and "could not tell" can announce neither, and a check
whose healthy signal is silence must never let a failure render as silence. Its
notify mode reports and stops;
installing its auto mode is the user's standing consent to update that source at
that scope, and is withdrawn by removing the hook. Announcement remains
communication, and mutation remains something a user asks for. The update-check
design—asymmetric cache lifetimes, a fenced network call, and the split between
notifying and applying—is informed by garrytan/gstack's update-check design.

Future publication work is tracked in the [roadmap](roadmap.md); roadmap items
must not be described as shipped until implemented and verified.
