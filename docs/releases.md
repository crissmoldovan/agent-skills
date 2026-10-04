# Releases

## Published catalog

This public catalog ships `model-routing`, `agent-lifecycle`, `blocks`,
`request-blocks-review`, `secure-credential-setup`, `derive-codebase-context`,
`publish-agent-skill`, `update-agent-skills`, `release-ledger`, `github-webhooks`,
`describe-changes`, `release-notes`, `investigate-codebase`, `blast-area`,
`visualise-blast-area`, `decision-journal`, `delphi-ground`, `delphi-imagine`, `land-complex-change`,
`resolve-problem-report`, `new-ux-discovery`, `workspace-governance`, `report-progress`,
`work-in-external-repo`, `layer-repository-docs`, `isolated-change-validation`, `onboard-project`, `request-answers`, and `handoff-prompt`, plus the canonical lifecycle runtime package under
`packages/agent-lifecycle`, the journal runtime package under `packages/agent-journal`,
and the separately installable workspace-governance CLI package under
`packages/workspace-governance`.

`request-answers` owns the ask that unblocks work on another person's or agent's
judgement — the answer sheet they reply to, chosen at brief, normal or deep depth, and the
ledger of what came back; `decision-journal` records why a decision was made once it has been.

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

`isolated-change-validation` sits one step before the delivery family. It owns the sandbox a
change is proven in while it is still outside the repository: the physically separate lane, the
hash manifest that stands in for revision identity where the lane has no git, the gate ladder
the parent runs itself rather than believing a builder's report, the independent review axes,
and the bundle an unattended run is handed over in. The moment the change is landing in the
repository it is `land-complex-change`'s; the map it is budgeted from is `blast-area`'s; and the
verdict it produces authorizes nothing beyond itself.

`update-agent-skills` moves installed copies wherever they live, and owns the adapted copy a
project makes of a pack skill: it composes the copy from a pinned release and the project's
overlay, checks it offline, and lists adapted pins beside the installed ones, while
`skills update` never moves one ([project adaptation](project-adaptation.md)).

`onboard-project` decides which of these skills a repository should use, and puts them in front of
every session in it. Each skill declares its own fit in `references/fit.json`, which
`verify-skills` now requires; the scan evaluates those declarations against the repository's files
and, for onboard and refresh only, against this machine's session history for it; and one yes
writes a profile beside the Skills CLI's lock file plus a generated
`.claude/rules/skill-routing.md`, the file every session already loads. It installs nothing itself
— `update-agent-skills` owns that, and the user runs it — writes no context file
(`derive-codebase-context`) and no documentation (`layer-repository-docs`), and its session-start
check is off until the user arms it.

## Unreleased

Prose for the next catalogue release. Nothing below is published until the version is
bumped, the branch is merged, and a tag carries these notes.

### `verify-skills` reads every file the repository would publish, and contributors get a private-denylist scan

`scripts/verify-skills.mjs` looked for likely secrets and home-directory paths only in files
with one of ten extensions, and not at all in `packages/agent-lifecycle`. A `.toml` fixture, a
`.sh` helper, a `.jsonl` capture or an extensionless config was never read, and this
repository's own `Cargo.toml` fixture was one of them. It now reads every file the repository
would publish, whatever its name: in a git checkout, every tracked file, wherever it sits, and
every untracked file git does not ignore outside generated output, so a local `.env` cannot
fail the run. Both patterns are ASCII, so every file is searched whatever its encoding. A
binary file is searched as bytes, which finds a path in an image's metadata, and is named for a
person to look at, since what an image shows is not read. One lifecycle test file, whose token
fields are fixtures, is read for paths but not for the secret pattern, and the run names it. A
pass no longer suggests that a file was read when it was not.

Most of what leaks from real work has no shape a public validator can hold: a client's name, a
person's handle, an internal host, an account id. `scripts/scan-denylist.mjs` checks what a
branch adds against a list of terms that each contributor keeps outside every repository and
passes with `--denylist`. It reads every added line (fixtures included), every changed file's
name, every commit message and the branch name; with `--worktree`, uncommitted changes and
untracked files too, and a nested repository by its name only. A term matches
case-insensitively as a word, and an underscore, a hyphen, a camelCase hump or a change between
letters and digits counts as a word break, so a numbered host is found. Any other spelling
(joined, abbreviated, or in capitals run on into the next word) is listed as a term of its own.
Binary files are searched as bytes and listed for a person to look at. Each hit is named by
where it is and by its line in the list, never by the term itself. A term inside a printed path
is masked, and `--show-matches` prints the matched text for a local terminal. The scan exits 2
instead of passing when the list is missing, empty, or inside the repository or any of its
worktrees. CONTRIBUTING asks for it before every push.

Nothing installed changes. Both scripts are contributor tooling and ship in no skill.

### A project can adapt a skill without forking it: binding slots, stable ids and the merge rules

A project that uses a skill often needs it to carry its own values, hand work to its own skills
and add the steps it has learned. Until now the only way to do that was to copy the skill and edit
the copy, which then stops receiving fixes. [`docs/project-adaptation.md`](project-adaptation.md)
is the contract for adapting a skill instead. A skill declares its **binding slots** in a
`## Bindings` table, each with a kind (`value`, or `skill` for every handoff to a sibling skill) and
a default, of which "ask once" is one. It names its **hard lines** `H1`, `H2` … and its **steps**
`S1`, `S2` …, and these ids are names rather than positions, so they never move. A project's overlay
binds slots, adds to steps by id and lists its own traps. The merge rules say what wins: a binding
replaces a default and nothing else, an addition extends a step, and a hard line is never relaxed.
The one override, `replaces:`, is explicit, says where its decision is recorded, and is refused on a
hard line. The page also says what an adapted copy carries, the pack's MIT licence among it, how a
project adapts a reference file of a skill rather than its `SKILL.md`, and how the copy pins the
skill it came from: a tag or a full commit sha, the skill folder's git tree, and the sha256 of every
file. The page is the contract that any composer follows, and the next entry is the one this
pack carries.

`scripts/verify-skills.mjs` now checks every file under `skills/` that declares `## Bindings`, a
reference file as much as `SKILL.md`. It requires well-formed ids, unique across the skill, one
letter for all of a skill's slots, a known kind and a default for every slot, and a `skill` slot
that defaults to a skill this catalogue ships. No skill declares the section yet, so nothing that
passed before fails now.

The pins rely on a tag policy that had never been written down, and this file now carries it under
[Tags](#tags): a published tag is never moved or deleted, unless it carries personal or client
data that has to be withdrawn, and per-skill tags `<skill>-vX.Y.Z` may sit beside catalogue tags. Renaming or removing a declared id is a major change for that skill. The
page classes every change to a declared id as major, minor or patch, and says which number moves:
the catalogue's, and a per-skill tag's where the skill has one, with a major change moving the
middle number while the version is below 1.0.0. `publish-agent-skill` now says that renaming or
removing an id is major among its pitfalls, which is the only change to an installed skill.

### `update-agent-skills` composes a project's adapted copy of a pack skill, checks it offline, and lists adapted pins

A project that adapts a pack skill now has the tool the contract above was written for.
`skills/update-agent-skills/scripts/adapt.mjs` builds the adapted copy from two inputs, the pack
skill at a pinned tag or full commit sha and the project's adapter folder (`adapter.json`, an
overlay of bindings, additions and traps, and any project files), and writes it as a generated
folder the project commits and never edits by hand. One invocation of that copy brings the skill's
whole text byte for byte, the project's values, its additions by step id and its traps, so nothing
depends on a second skill being found by its description or winning a precedence contest with a
personal copy of the generic one.

- **`compose`** reads the pin with git plumbing only, never a checkout, so nothing in the fetched
  tree runs. It prints what it would add, change or remove, what moved in the pin, and every
  addition to a hard line for review, and writes nothing without `--write`. It refuses a branch, an
  abbreviated sha, a tag that now names another commit, a binding or addition to an id no carried
  file declares, an unbound required slot, `replaces:` on a hard line, an addition to one or a
  sentence naming one in the words of an exception, a heading that names one outside the addition
  to it, a handoff to a skill the project also adapts that is not mapped to the adapter, a link
  that does not resolve or is written from the root, and a copy edited by hand unless told
  `--discard-hand-edits`. With `--write` it vendors itself beside the adapters. It never runs a
  composer it fetched, so it says when the pinned release ships another composer than the one
  running; the composer moves with a pin when a person runs the release's own.
- **`check`** is offline: no git and no network. It holds each copy to its lock file by file, to the
  sha256 of the skill text between its markers, to a fresh compose of its recorded inputs, and to
  the rules above, and warns when the composed `SKILL.md` passes 500 lines. A project runs it from
  its own tests, so a hand edit or an overlay changed without composing turns them red.
- **`outdated`** reads tags and says, per copy, whether a newer release leaves the skill's tree
  unchanged (moving the pin is a no-op) or changes it (with the `git diff` to read). A per-skill
  tag is compared with the latest catalogue release as well, and where a version cannot order the
  two, as there and for a sha pin, a different tree is reported as differing, never as newer. It
  raises an alarm when a pinned tag moved or was deleted, flags a vendored composer that is not the
  one the pinned release ships, and `--verify` compares every carried file with the upstream bytes,
  which is what proves a copy the offline check can only show was not changed.

The copy's frontmatter takes `license` and `compatibility` from the skill and pre-approves no tool
unless `adapter.json` names it: it carries an `allowed-tools` line only when `allowedTools` lists
the tools, and then exactly those, never the skill's own, because a pre-approval granted by a shared
skill would apply in every project that adapts it. `compose` lists every tool a copy pre-approves
for review and says what the skill itself declares, and `check` refuses an `allowed-tools` line
that is not that list.

A reference file of a skill can be the entry instead of `SKILL.md`: its links are rewritten for the
folder root, an id only `SKILL.md` declares is refused, and a link from another carried file to the
skill's `SKILL.md`, which in that copy holds the entry's text, is named in a warning. When an
addition replaces a step, the copy's opening says the addition wins. `check-pack-freshness.mjs --repo
<project>` lists a project's adapted pins against the latest release beside the global installs,
lists a copy of another source as not compared, and exits 2 when a pin moved or differs. It never
names one in its update command, so an armed auto hook never touches one, and it is refused with
`--hook`, whose silence means current.

The pack's verifier, `scripts/verify-skills.mjs`, now resolves the links in every Markdown file a
skill carries, not only in its `SKILL.md`, read as the composer reads them, fenced code and link
definitions included. It found one file: `references/documenting-the-run.md`, which
`investigate-codebase`, `blast-area`, `visualise-blast-area`, `land-complex-change`,
`resolve-problem-report` and `new-ux-discovery` each carry byte for byte, showed the sentence a
`SKILL.md` points to it with as a fenced example, link included, and from `references/` that link
names nothing, so no copy of those six skills could be composed. The file now says to write that
sentence word for word, linking its words to the path, and gives the path as code. No `SKILL.md`
changes, and the wording keeps its meaning, so this is a patch for those six skills.

**Who should update.** Anyone adapting a pack skill to a project. The skill's description gains
the symptom "adapt a pack skill to this project", and its `compatibility` names Node.js 22 and git
for the composer. Nothing installed changes behaviour: the freshness check without `--repo`
behaves as before. The skill's metadata version moves from 1.0.0 to 1.1.0, for the composer.

## Release checklist

1. Confirm every new or changed skill is under `skills/<name>/SKILL.md`.
2. Update the repository catalogue README with the exact frontmatter description,
   install coordinates, and update guidance.
3. Run `npm run verify` with Node.js 24 or newer.
4. Review all content against the [public-content policy](public-content-policy.md).
5. Merge through a reviewed pull request after CI succeeds.
6. Tag and publish human-readable GitHub Release notes explaining outcomes,
   compatibility/migration, who should update, and exact update action. A pushed tag
   is never moved or deleted ([Tags](#tags)).
7. Read back main, release, installer discovery, and isolated installation before
   encouraging humans or agents to update.

## Versioning

The repository version records public catalog releases. Use semantic impact:
major for broken existing guidance/contracts, minor for new skills or substantive
new guidance, and patch for corrections within an already-correct contract.
The binding slots, hard lines and steps a skill declares for projects to adapt are such a
contract: renaming or removing one of their ids is a major change for that skill, because
every overlay that cites it stops composing ([project adaptation](project-adaptation.md#changing-a-skill-that-projects-adapt)
classes the other changes to an id). It moves this version, and a per-skill tag's as well where
the skill has one. While the version is below 1.0.0, a major change moves its middle number, and
the release notes call it breaking.

## Tags

A tag is what a pinned install and an adapted project skill point at, so it is a promise.

- **A published tag is never moved or deleted.** Once pushed, a tag names the same commit for
  good. A release that turns out wrong is followed by a new version, never re-tagged, and the new
  release's notes say what it corrects. The one exception is personal or client data, below.
- **Catalogue tags** are `vX.Y.Z` and name a catalogue release. **Per-skill tags**
  `<skill>-vX.Y.Z` name one skill's release, where `<skill>` is the skill's directory name, and may
  sit on the same commit as a catalogue tag. `workspace-governance-v0.1.0` and
  `workspace-governance-v0.3.0` are per-skill tags; the second sits on the same commit as `v0.26.0`,
  and the first on a commit of its own.
- **A branch is never a release identity**, because it moves.
- **An accidental disclosure in a tagged commit** is reported and handled under
  [SECURITY.md](../SECURITY.md).
  - A credential is revoked, which is the only remedy once a tag has been fetched, and the tag
    stays.
  - Personal or client data cannot be revoked, so the tag that carries it may have to be deleted
    and the data taken out of what the repository publishes, as that handling decides. A
    replacement release then follows, and its notes say which tag was withdrawn and which version
    replaces it, so a project pinned to the withdrawn tag knows to re-pin.

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
