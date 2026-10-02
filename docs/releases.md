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
file. This change ships no composer; the page is the contract that any composer follows.

`scripts/verify-skills.mjs` now checks every file under `skills/` that declares `## Bindings`, a
reference file as much as `SKILL.md`. It requires well-formed ids, unique across the skill, one
letter for all of a skill's slots, a known kind and a default for every slot, and a `skill` slot
that defaults to a skill this catalogue ships. No skill declared the section before this release,
so nothing that passed before fails now.

The pins rely on a tag policy that had never been written down, and this file now carries it under
[Tags](#tags): a published tag is never moved or deleted, unless it carries personal or client
data that has to be withdrawn, and per-skill tags `<skill>-vX.Y.Z` may sit beside catalogue tags. Renaming or removing a declared id is a major change for that skill. The
page classes every change to a declared id as major, minor or patch, and says which number moves:
the catalogue's, and a per-skill tag's where the skill has one, with a major change moving the
middle number while the version is below 1.0.0. `publish-agent-skill` now says that renaming or
removing an id is major among its pitfalls, which is the only change to an installed skill.

### `report-progress` gives a percentage with its basis and an ETA as a clock time, sends updates nobody has to ask for, and can be adapted

A reader waiting on long work asks how far along it is and when it will be finished, and often
asks to be told at a set interval. `report-progress` answered neither question: its three
sections say what is done, running and next, and a reader who wanted a percentage or a time to
plan around got whatever the agent improvised. Improvised, both numbers fail in the same few
ways: a percentage with no basis, or one whose rows are in two units and cannot be added up; a
denominator that grows silently, so that work being found reads as a stall; an ETA whose headline
covers part of the work; a zone label typed from memory, wrong for half of every year; and timed
updates that stop without anyone noticing, so the reader has to ask after all.

A report can now open with an optional **head line**, under its first line and above the three
sections: the percentage, counted from a named register just before writing, in one unit, with
work blocked on a person in the denominator and never in the numerator, and the ceiling without
them; and the ETA in agent-hours, then wall-clock at the agents the running section counts, then
a clock time in each reader's zone, pasted from a command, dated when it is not today there, and
labelled as an estimate with its basis. A new reference,
[`percentage-eta-cadence.md`](../skills/report-progress/references/percentage-eta-cadence.md),
has the shape, the arithmetic, the clock commands, and what keeps updates on a cadence coming:
a tick strictly inside the harness's cap on background time, re-armed before each update is
written, a standing order written where a context compaction cannot take it, and a last update
that says the updates stop. It also says that a status question sent while a fan-out runs may
reach every agent in it. Two hard lines come with the head line: a figure nobody measured is
reported as not measured, never as 0, and that includes a percentage with no register to count;
and an ETA is labelled as an estimate with its basis, so it is never the prediction of a pending
result that rule 5 forbids. Rule 5, the checklist and the step that splits verified from claimed
now say as much, and a labelled ETA passes all three.

Nothing a report owed before is dropped. The three sections are still owed; outside a cadence, a
report nobody asked for a percentage or an ETA carries no head line; and the head line's "in
flight" is task metadata that never stands in for the running section, which still comes from
lifecycle evidence alone. So a report written to the old shape is still complete, and this is new
guidance, a minor change under [Versioning](#versioning). The description gains the new triggers:
a request for a percentage, an ETA or updates at a set interval. The `report-progress` gate is
unchanged: it reads the three section labels, and a head line is not one of them.

The skill also declares what a project adapts it by, as [project adaptation](project-adaptation.md)
describes: nine slots, B1 to B9 (the cadence, the zones a clock time is given in, the register a
percentage is counted from, the command that measures, how a timed tick is raised and the cap on
it, where the standing order is written, and the three sibling skills it hands work to,
`agent-lifecycle` for what is running, `describe-changes` for a change that already landed and
`request-blocks-review` for whether the work is any good), eight hard lines, H1 to H8 (the five
rules, that nothing in the skill installs or arms the gate, and the two above), and its eleven
steps as S1 to S11. Every slot's default is what the skill does on its own, so a project that
binds nothing gets the same procedure. Nothing needs migrating: no project could adapt the skill
before it declared these ids.

### `resolve-problem-report` answers severity, priority and effort as three questions, and does not call a released fix verified

Two judgements about a report were left to chance. At intake, `resolve-problem-report` restated
the report as a claim and classified it, but said nothing about how bad it is, how soon it is
wanted or how much work it is. Unasked, the three get answered as one sense of urgency, each
borrowing from the others: a quick fix reads as minor, and a defect that is someone else's to fix
reads as less severe. At the end, verification checked each requirement at its own evidence class
but never said where, so a fix that had been released could be called fixed before anyone had
looked at it where its reader meets it. And the report's date was whatever date came to hand,
often the day someone copied it into a tracker.

A new reference, [`assessing-a-report.md`](../skills/resolve-problem-report/references/assessing-a-report.md),
answers severity, priority and effort at G0 as three separate questions, each with its owner:
severity by whoever holds the evidence, because it is a finding; priority by the person who rules it
when the report competes with other work, the agent's answer recorded as proposed until they do; and
effort by whoever will do the work, verification included. It gives a default scale for each, says
why none of them stands in for the band's cost of being wrong, a candidate's size or who chooses the
fix, and says when to assess again, keeping the old answer beside the new one and naming what moved
it. It dates the report from its source, best first, and names the source. It follows a fix from
landed to released to verified. Before a release is recorded, it checks that the fix is in it, by
the commit that landed and the commit the release records, or by the change itself when the fix was
cherry-picked. Once the fix is released, it says what each check reached (a suite on a
pre-production environment, a check that the tree released is the tree tested, signed-out checks on
production, a person looking where the agent cannot). It closes a fix as fixed only once it is
verified where its reader meets it, even when told to close it sooner, so a fix that has landed but
is not released waits in that state rather than closing at G5. Three hard lines come with it:
severity, priority and effort are three questions and no answer sets another; a released fix is not
a verified one; and nothing is dated or judged from memory.

`SKILL.md` gains no lines, because its body was already at the 484-line cap. Step 2 points to the
reference. G5's verification names where the reader meets a released fix, its close waits for that,
and the gate table's G5 row says the same. Prerequisite 1 asks where the report's date came from,
two checklist items carry the new rules, and Deeper reading lists the file. The end of G5's closing
paragraph is rewrapped to keep its length, and two paragraphs the change does not otherwise touch,
G2's gate and step 7, are rewrapped at 100 columns, with no word changed, to make the room. The
skill keeps no register of reports: ids, states across every report and the links between them stay
out of it, as its rule against ticket hygiene says. A run that answered none of the three questions,
or closed a released fix unchecked, now fails two checklist items it passed before; nothing that
consumes the skill's output breaks, so this is substantive new guidance, a minor change under
[Versioning](#versioning).

The reference declares what a project adapts it by, as [project adaptation](project-adaptation.md)
describes for a reference file a project adapts on its own: nine slots, B1 to B9 (the rest of the
arc, which is `resolve-problem-report` itself so that an adapted copy can route it, who rules
priority, the three scales, where each judgement is recorded, the sources a date is taken from,
where the reader meets the fix, and who looks where the agent cannot), three hard lines, H1 to H3,
and six steps, S1 to S6. They are the skill's first ids, so a file that declares more continues
from them. Every slot's default is what the skill does on its own, so a project that binds nothing
gets the same procedure.

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
