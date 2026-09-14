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

### `layer-repository-docs` (new skill)

**What.** A twenty-fifth skill: make a repository's documentation legible when an organisation
has more repositories than anyone can track. Three layers as roles rather than required files —
a quick start in every repository, a manual once one outgrows its README, and a single
organisation-wide handbook every other repository links to and none copies — plus the other
document kinds beside them, one home per fact, and a tier ladder so a small repository is not
made to grow structure it has not earned. Seven carried references hold the depth:
`references/entry-points.md`, `references/layer-contents.md`, `references/document-kinds.md`,
`references/one-home-per-fact.md`, `references/loss-audit.md`, `references/newcomer-test.md` and
`references/claim-check.md`.

**Why.** The shape is the easy half. The skill exists for the two passes that decide whether a
documentation rewrite is fit to hand over, and that nothing else catches: a **loss audit**, which
splits every replaced file into its facts and rules and gives each a verdict, because everything
it finds is absent from the new draft and absence does not read as an error; and a **newcomer
test**, in which a reader carrying none of the drafting context follows the documentation in a
clean clone, because a fact-check passes every sentence that is true and has no way to notice the
required field nobody wrote down.

**Boundaries.** It writes the documentation people read; the context files agents load belong to
`derive-codebase-context`. It delegates evidence to `investigate-codebase`, places no credential
(`secure-credential-setup`), makes no placement decision (`workspace-governance`), and opens no
pull request (`land-complex-change`, `request-blocks-review`).

**Entry points.** A request enters through one of three, and the run announces which in one line
before it reads anything, rather than asking: `audit` (also `check`, `need`, no word at all, or a
word it does not recognise) writes nothing in the repository; `draft` (also `ensure`) writes only
the files it named first; `update` takes the diff from the previous baseline to `HEAD`. Each states
its scope, what it may write, which of the seven steps it runs, and what it hands back, in
`references/entry-points.md`. All three end in one report contract — a verdict line, the ranked
findings, the owner's decisions, then what was run against what was inferred — capped at about
eighty lines, with longer tables in linked files, everything inline where no file can be written,
and a total whose rows exist nowhere counted as a failed run rather than a short one.

This is body text, and no frontmatter field was added. `argument-hint` and the other
argument-declaring fields are Claude Code's, not the open Agent Skills specification's, whose
reference validator is documented as rejecting unknown frontmatter fields — documented, not run
here. `$ARGUMENTS` is a body token rather than a field, and what an agent that does not substitute
it would show a reader is untested. Either way the portable form is the same, and a harness with no
slash commands matches the same words in a sentence.

**Why those three, and not a longer vocabulary.** Six sessions were given the skill — five a single bare
word, one a prose request with no command word at all — and a second session graded every run
against the repository's source. The method held:
nothing was committed or pushed, no credential value or address leaked, and nearly every finding
re-checked was true. What failed worst was the entry, and the prose run failed too, which is why
the report contract matters as much as the vocabulary. Every word bound to nothing, so each run cut the
procedure into its own subset; two runs given the identical word produced reports that could not be
compared; reports reached several hundred unranked lines; one never reached the owner while the run
reported it delivered; and one quoted loss-audit totals its own working file contradicted. The
entry points, the announcement and the report contract each name the failure they answer. The
protocol, the cases and what remains unmeasured are in
[the evaluation page](layer-repository-docs/evaluation.md).

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
