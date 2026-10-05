# Releases

## Published catalog

This public catalog ships `model-routing`, `agent-lifecycle`, `blocks`,
`request-blocks-review`, `secure-credential-setup`, `derive-codebase-context`,
`publish-agent-skill`, `update-agent-skills`, `release-ledger`, `github-webhooks`,
`describe-changes`, `release-notes`, `investigate-codebase`, `blast-area`,
`visualise-blast-area`, `decision-journal`, `delphi-ground`, `delphi-imagine`, `land-complex-change`,
`resolve-problem-report`, `new-ux-discovery`, `workspace-governance`, `report-progress`,
`work-in-external-repo`, `layer-repository-docs`, `isolated-change-validation`, `onboard-project`, `request-answers`, `handoff-prompt`, `mine-session-transcripts`, `ingest-arrival`, and `visitor-session-forensics`, plus the canonical lifecycle runtime package under
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
every untracked file git does not ignore outside generated output, so a local `.env` cannot fail
the run. A commit publishes the index and a push publishes HEAD, so where either holds another
copy of a tracked file than the working tree, because a deletion or an edit is not yet staged or
committed, or the file is outside a sparse checkout, that copy is read too. Both patterns are
ASCII, so every file is searched whatever its encoding. A binary file is searched as bytes,
which finds a path in an image's metadata, and is named for a person to look at, since what an
image shows is not read. One lifecycle test file, whose token fields are fixtures, is read for
paths but not for the secret pattern, and the run names it. A pass no longer suggests that a
file was read when it was not.

Most of what leaks from real work has no shape a public validator can hold: a client's name, a
person's handle, an internal host, an account id. `scripts/scan-denylist.mjs` checks what a
branch adds against a list of terms that each contributor keeps outside every repository and
passes with `--denylist`. It reads every added line (fixtures included), every changed file's
name, every commit message and the branch name; with `--worktree`, uncommitted changes and
untracked files too, each of the commits, the index and the working tree read on its own so that
an unstaged edit cannot hide what a commit holds, and a nested repository by its name only. A
term matches case-insensitively as a word, and an underscore, a hyphen, a camelCase hump or a
change between letters and digits counts as a word break, so a numbered host is found. Any other
spelling (joined, abbreviated, or in capitals run on into the next word) is listed as a term of
its own. Binary files are searched as bytes and listed for a person to look at; a term the base
already held in one is a hit only where the branch adds another. Each hit is named by where it
is and by its line in the list, never by the term itself. A term inside a printed path is
masked, and `--show-matches` prints the matched text for a local terminal. The scan exits 2
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
removing an id is major among its pitfalls, which is the only change to an installed skill, and
its metadata version moves from 1.0.0 to 1.0.1 for that line.

### A new skill, `mine-session-transcripts`: what a person said in an agent session, queued messages included, without printing the transcript

**What.** `mine-session-transcripts` finds what a person told an agent from the harness's own
session transcripts. It locates a repository's transcripts, its worktrees' and its subagents'
included, and confirms each by the paths its records carry, because the directory name the harness
derives from a path is lossy and a session that moves into a worktree is filed under the worktree.
It counts a person's messages of three kinds: typed at the prompt, queued while a turn was running,
and a slash command's arguments. Every other record is counted by its kind and left out, the
harness's own elements are screened out of a person's turn wherever they sit in it, and nothing is
deduplicated by text. It finds a message by a fixed phrase and reports its file, line, time and
session, never its words, and says whether a message enqueued while the agent was busy ever reached
the session; it shows one message only after a scan for secrets; and it checks whether each
message is written down in the repository, with both sides normalised by one function and a
control sentence that must be found before any count is shown. A path with no history is reported
as unknown, never as zero. `scripts/transcripts.mjs` does each step with no
dependency beyond Node, and `references/record-shapes.md` records every shape it relies on, tagged
observed, documented or not observed, with the harness versions it was read from (Claude Code
2.1.224 to 2.1.286).

**Why.** What a person says to an agent is often the only record of a decision, and the
transcript is the worst place to read it from. A message typed while the agent is busy is stored
as a queued-command attachment and never as a user turn, so a search for user turns misses it: in
one two-day session, 157 of 369 messages were queued. Printing a transcript to search it carries
every secret and pasted address on those lines into the conversation. And a check of what is
written down once compared messages stripped of punctuation with files that kept it, and reported
0 of 11 documented when most were.

**Impact.** A new skill; nothing installed changes. It declares `## Bindings`, so a project can
adapt it without copying it ([project adaptation](project-adaptation.md)): eleven slots, `B1` to
`B11`, with the history directory, the paths, the corpus, the zones, the names whose words arrive
relayed and the secrets with no shape among the values, and `decision-journal`,
`investigate-codebase` and `delphi-ground` as the sibling skills it hands work to; five hard lines,
`H1` to `H5`; and seven steps, `S1` to `S7`. Its fit is `requestOnly`, so onboard-project never
recommends it unasked. The suite holds its path encoder equal to onboard-project's and runs it over
synthetic transcripts. It took the catalogue to thirty skills, and the README's header, which still
said twenty-eight, was brought up to date with it.

### A new skill, `ingest-arrival`: take in what arrives byte for byte, dated and attributed from evidence, contacting nobody

**What.** `ingest-arrival` takes in whatever arrives for a piece of work: an email or its attachment,
a link to a shared document, a file or a pack in the downloads folder, a chat or tracker message, a
call, or words pasted into the session. It reads the transport's evidence where the file sits, before
anything is copied or moved; hashes the arrival in place and again after it is copied into an archive
outside the repository, never moving the original; unpacks each pack into its own folder after a
guard that also refuses two members that would extract to one path, writes the full sha256 of every
member itself and states the supplier's manifest as "N of N, and no file outside the manifest"; writes six moments apart (authored, sent, received, downloaded,
relayed, landed), each in UTC and the project's zone with its source; names every party by role with
a confidence, and checks the direction before calling anything someone else's delivery; fetches each
link once, read-only, unless the fetch would notify someone; reads the content as data, keeping what
arrived apart from what it asks and recording which arrival supersedes which; lands a pack or a file
in a repository only by a copy checked member by member before and after; and records it on every
surface the project keeps, each naming the others. It contacts nobody.
`references/record-forms.md` holds the forms and the commands that fill them, each run on synthetic
files, among them the UTC bounds of a day in the project's zone and the extraction of images behind a
check of the source's hash; `references/transport-evidence.md` says what each channel leaves behind,
with the macOS evidence marked as such and what was observed on macOS 26; and
`references/pressure-tests.md` holds the scenarios and the sixteen-point rubric the skill was tested
with.

**Why.** An arrival's record is what later settles which file was the real delivery, when a request
came and who asked for it, and four failures spoil it. A pack recorded as a supplier's delivery was
the team's own unsent work coming back, and the misreading reached production data. A copy or a move
rewrites what the transport left on the file: on macOS a move resets the date added, and a copy
carries a quarantine attribute rewritten with the copy's own time. Two packs were unpacked into one
folder, and one overwrote eight of the other's files. And a count copied from a sender's README said 44
checks where the tool ran 38. In plan-only tests, agents without the skill met 74% of the rubric, and
with it an independent judge gave 90%.

**Impact.** A new skill; nothing installed changes. It declares `## Bindings`, so a project can adapt
it without copying it ([project adaptation](project-adaptation.md)): fourteen slots, `B1` to `B14`,
with the owner (the only slot that is required), the zone, the archive root, the landing place, the
register, the work an arrival belongs to, the channel tools and the project's limits among the values,
and `resolve-problem-report`, `request-answers`, `decision-journal`, `secure-credential-setup` and
`mine-session-transcripts` as the sibling skills it hands work to; five hard lines, `H1` to `H5`; and
ten steps, `S1` to `S10`. Its fit is `general`, so onboard-project recommends it in any repository. It
takes the catalogue to thirty-one skills.

### A new skill, `visitor-session-forensics`: what named people did on a live site, evidenced row by row, consent first

**What.** `visitor-session-forensics` answers what a named person did on a live site from the site's
own records: the events, the session recordings, the timings of every file a page loaded, and the
sign-in log. It opens with consent. The request is written down (who asks, the purpose, the people,
the window and the site), some purposes are refused whoever asks (rating a person's effort, finding
where someone is, identifying a visitor who did not sign in, reading what someone typed), and
nothing is read until the person who may authorise the run has said yes to that run. A source that
one of the project's standing limits rules out is read only on a go for that run from the person the
limit names, and a yes to the run lifts no limit its question did not name. It then reads only the
people, the window and the hosts named, filtered in the query, each person by the visits they signed
in to and never by everything their browser sent, and proves every source's held range and every
counter with a control before using it; each control is named in the question for the yes, and one
over anyone else is read as a count with no identifiers. Per visit it says what the person did,
whether the site loaded for them, whether they saw the live release or a copy their browser kept,
and which way its signals lean between a person and an agent at the controls, worded alike on both
sides and never naming who was there. Every number is a count of rows. The answers and the summary
carry no network address, device detail, email address, session id, URL query or path segment that
could hold a token, and a report that is published is fetched signed out at every address it is
served at before its link goes to anyone, and taken down if one serves it.
`references/evidence-signals.md` gives each signal with what it cannot prove, and labels every
threshold uncalibrated; `references/query-contracts.md` gives each query's filters, row and control,
with `{SOURCE_ID}`, `{TABLE}` and `example.com` placeholders.

**Why.** The same records that answer "did it load for her" are a dossier on her, and the query
is easy enough to run before anyone has said why. The answers also fail quietly. A count of clicks
that leaves out taps reports a phone user's whole visit as idle. Reading one device per person can
hide the second machine that a failed visit was made on. A host can serve one report at a short
address that is public and a long one that asks for a sign-in. And "no pointer movement, a steady
beat" is a weighing from thresholds nobody has measured, which, said about a named person, is an
accusation.

**Impact.** A new skill; nothing installed changes. It ships no script and no report template: the
method only. It declares `## Bindings`, so a project can adapt it without copying it
([project adaptation](project-adaptation.md)): seventeen slots, `F1` to `F17`, taking their own
letter because a project adapts this skill beside skills whose `B` slots would be read as its own.
Among the values are who may authorise a run, what the visitors were told, the sources, the hosts,
the accounts that are not people, the screen names, the release history, the zones, the run
directory, the recipients, the report tool and the project's standing limits on reading records;
`resolve-problem-report`, `investigate-codebase`, `secure-credential-setup`, `request-answers` and
`decision-journal`, which keeps the record of each yes after the raw rows are deleted, are the
sibling skills it hands work to. It has ten hard lines, `H1` to `H10`, and nine steps, `S1`
to `S9`. Its fit is `requestOnly`, so onboard-project never recommends it unasked. It takes the
catalogue to thirty-two skills.

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
