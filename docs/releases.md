# Releases

## Published catalog

This public catalog ships `model-routing`, `agent-lifecycle`, `blocks`,
`request-blocks-review`, `secure-credential-setup`, `derive-codebase-context`,
`publish-agent-skill`, `update-agent-skills`, `release-ledger`, `github-webhooks`,
`describe-changes`, `release-notes`, `investigate-codebase`, `blast-area`,
`visualise-blast-area`, `decision-journal`, `delphi-ground`, `delphi-imagine`, `land-complex-change`,
`resolve-problem-report`, `new-ux-discovery`, `workspace-governance`, `report-progress`,
`work-in-external-repo`, and `layer-repository-docs`, plus the canonical lifecycle runtime package under
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

`layer-repository-docs` writes the documentation people read — a quick start in every
repository, a manual once one outgrows its README, and one organisation-wide handbook the
others link to rather than copy — and owns the loss audit and newcomer test that decide
whether a rewrite is fit to hand over. The context files agents load remain
`derive-codebase-context`'s; it delegates evidence to `investigate-codebase` and makes no
placement decision (`workspace-governance`).

## Unreleased

Prose for the next catalogue release. Nothing below is published until the version is
bumped, the branch is merged, and a tag carries these notes.

### `layer-repository-docs` (entry points, an announcement, and one report contract)

**What.** The skill shipped in 0.17.0 as one seven-step procedure with no way in: a word after its
name — `check`, `need`, `update`, `ensure` — bound to nothing. It now has three entry points, and a
run announces the one it chose in a single line before it reads anything, rather than asking.
`audit` (also `check`, `need`, `review`, no word at all, or any word not listed) writes nothing in
the repository. `draft` (also `ensure`, `write`, `layer`) writes only the files it named first, plus
pointer-only edits and one-line status corrections where the drafts would otherwise contradict a
document they route readers to. `update` takes the diff from the previous baseline to `HEAD`, writes
overtaken passages, and keeps working documents in a separate patch under their own edit rules. Each
one's scope, permitted writes, steps and output are in the new `references/entry-points.md`, the
seventh carried reference.

All three end in one report contract — a verdict line with counts, the ranked findings, the owner's
decisions, then what was run against what was inferred — capped at about eighty lines, with longer
tables in linked files, everything inline where no file can be written, and every total counted from
rows that were saved. A total whose rows exist nowhere is a failed run rather than a short one.

Nine smaller changes come from the same evidence: the repository's standing directions are read
before the rot pass, so a subject its owner has closed is held back rather than raised again;
findings say whether the repository already tracks them; loss-audit rows are saved before any total
is quoted, and an `update` gets a sixth verdict, `corrected`; a documents-only repository gets a real
newcomer task; any edit made in the overreach pass sends the newcomer test back to a clean state; the
newcomer's clone has its remote removed by name; the description check is no longer trapped inside
the drafting step; and "the draft" is defined for a run that drafts nothing.

**Why.** Six sessions were given the skill and one message each — five a bare word, one a prose
request with no command word — in throwaway clones of four repositories, and a second session graded
every run against the repository's source. The method held: nothing was committed or pushed, nothing
leaked, and nearly every finding re-checked was true. The entry is what failed. Two runs given the
identical word produced reports that could not be compared. Reports reached 333 lines with no fixed
shape, and one never reached its owner at all while the run reported it delivered. An `update`
re-verified everything over a documentation-only diff. One run quoted loss-audit totals its own
working file contradicted. The prose run failed too, which is why the report contract matters as much
as the vocabulary.

The same scenarios re-run against this change, independently graded: announcements before the first
read in all three, reports of 76, 81 and 83 lines in the contract's order, writes inside each entry
point's boundary, and the `update` narrowed from a full re-verification to thirteen claims with the
newcomer test recorded as "not run: no task path changed". Two misses remain, both recorded publicly.

**What it does not change.** No frontmatter field was added: `argument-hint` and the other
argument-declaring fields are Claude Code's rather than the open Agent Skills specification's, whose
reference validator is documented as rejecting unknown fields — documented, not run here. `$ARGUMENTS`
is a body token rather than a field, and what an agent that does not substitute it would show a reader
is untested. The selection is prose, so a harness with no slash commands matches the same words in a
sentence. Nothing is removed: a plain-English request reaches the same procedure it did in 0.17.0.

**New public page.** [`docs/layer-repository-docs/evaluation.md`](layer-repository-docs/evaluation.md)
records how the skill is exercised against real repositories, what the trial found, which checks run
on every change today against which are only planned, and what is still unmeasured — including that
the trial runs were not isolated, so their safety result is not attributable to the skill alone, and
that the no-word default has never been run.


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
