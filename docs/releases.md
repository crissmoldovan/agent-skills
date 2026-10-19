# Releases

## Published catalog

This public catalog ships `model-routing`, `agent-lifecycle`, `blocks`,
`request-blocks-review`, `secure-credential-setup`, `derive-codebase-context`,
`publish-agent-skill`, `update-agent-skills`, `release-ledger`, `github-webhooks`,
`describe-changes`, `release-notes`, `investigate-codebase`, `blast-area`,
`visualise-blast-area`, `decision-journal`, `delphi-ground`, `delphi-imagine`, `land-complex-change`,
`resolve-problem-report`, `new-ux-discovery`, `workspace-governance`, `report-progress`,
`work-in-external-repo`, `layer-repository-docs`, `isolated-change-validation`, `onboard-project`, `request-answers`, `handoff-prompt`, `mine-session-transcripts`, `resume-after-limit`, `coding-teacher`, `rotate-shared-secret`, `codex-review-loop`, and `preregistered-model-study`, plus the canonical lifecycle runtime package under
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
`.claude/rules/skill-routing.md`, the file every session already loads. A skill the repository
holds an adapted copy of counts as present, and the routing names the copy. It installs nothing
itself — `update-agent-skills` owns that, and composes the adapted copies too, and the user runs it —
writes no context file (`derive-codebase-context`) and no documentation (`layer-repository-docs`),
and its session-start check is off until the user arms it.

`mine-session-transcripts` finds what a person said to an agent in the harness's own session
transcripts, queued messages included, and says where each message is without printing the
transcript. It does not act on what it finds: a decision goes to `decision-journal`, a question
about what the code does to `investigate-codebase`, and messages that feed a briefing of verified
facts to `delphi-ground`. It declares `## Bindings`, so a project can adapt it
([project adaptation](project-adaptation.md)).

`secure-credential-setup` puts an API key, token or password into a secret store without its value
entering the transcript, one credential at a time. `publish-agent-skill` releases a skill through a
verified release, and `request-blocks-review` runs the review loop over `blocks`' primitives until
its pull request is clean. `handoff-prompt` writes work that is going to another session, agent or
person as one self-contained block; it does not do the work, and an answer wanted back is
`request-answers`'.

`resume-after-limit` continues a Claude Code session that a subscription usage limit stopped, once
the quota returns, and leaves alone a session dormant longer than its window. A tick that a
scheduler runs, armed by the user's own run of its installer, reads the limit and its reset time
from the session's transcript and spends no tokens; it resumes a live session through its inbox
socket and an exited one with `claude --bg --resume`. It does not report progress
(`report-progress`) or supervise child agents (`agent-lifecycle`).

`coding-teacher` teaches how a project's technologies and architecture work to someone from another
field, in plain language: it asks for or infers the learner's background, draws each comparison from
their own work and says where it stops, grounds every claim about the project in files it read, and
goes one level deeper on request. On request it builds an illustrated lesson page from its carried
template. It explains and changes nothing; an evidence-backed answer a developer will act on is
`investigate-codebase`'s, and the documentation a repository keeps is `layer-repository-docs`'. It
declares `## Bindings`, so a project can adapt it to its own learners and library
([project adaptation](project-adaptation.md)).

`rotate-shared-secret` rotates a key that services share without downtime: a receiver that accepts the
current or a non-empty next key, a next key generated into a private file and never printed, senders
moved to a secret store and verified delivering, a fixed-window reconciliation of the receiver's
handled requests against the senders' own delivery records before the old key is retired — one to
one by delivery id where there is one, and otherwise recorded as aggregate evidence — a check that
the live domain serves the new build, and probes with the new key, the old key, a wrong key and no
key, the old-key probe mandatory wherever it can be done safely and the retirement recorded as
UNVERIFIED where it cannot. Placing a single credential stays `secure-credential-setup`'s.

`codex-review-loop` runs an independent reviewer over a pull request in rounds. Each round reviews a
fresh worktree at the pushed sha, never the checkout, under a round number never used before, and
counts only on a zero exit and a non-empty final review, taken from the file the reviewer writes
rather than cut from its log; it reads only that review, checks each finding against the code before
acting, fixes everything above the lowest grade of the reviewer's declared scale with a check watched
failing under a deliberate break and restored from a byte copy, measures each finding's effect on
published results, and keeps a review record per round where it cannot move the head. It stops when
only lowest-grade findings remain — deferring them, or fixing them and running one confirmation
round — and splits the pull request when rounds keep finding new kinds of bug. The merge is a
person's act, after a checklist: the head is the one the final round reviewed and no earlier round
left unfixed, every finding has a complete disposition, the base has not moved since the review, and
the required checks passed; then `gh pr merge --match-head-commit` pins the reviewed head. The
examples use the Codex CLI; the loop is reviewer-agnostic. The Blocks-hosted loop stays
`request-blocks-review`'s.

`preregistered-model-study` runs a model or prompt comparison whose verdict can be trusted. It commits a
plan, a hash freeze of every input and of every executable, configuration and runtime that can change
a request, a spend or a verdict, and a dry run that proves request parity with production offline,
all pushed before the study's first paid call; runs output parity as the first paid stage, under its own pre-registered
cap; puts every later change in a dated addendum pushed before the calls it governs, or records
one found after them as a dated correction; and enforces the spend in code with a single-threaded
guard — one research account, one paying process holding an operating-system lock, calls one at a
time — that refuses production's account or any other paid credential, reserves every billable unit of each call at a
ceiling price against the study and stage caps, reads the balance before every admission and latches
the floor, settles each call before the next and latches on a settlement above its reservation, and
on restart re-derives every total and invariant from its ledger. Concurrency is out of scope, and the cap is hard only under the
single-process rule. It estimates the control's disagreement with itself as an A/A distribution rather
than one draw; judges with three vendors who see where each piece of evidence came from; reports
quality, harm and cost beside the bars; and ships a reproduce script and a checksum manifest that
rebuild every number offline. Which model runs everyday work stays `model-routing`'s.

## Unreleased

Prose for the next catalogue release. Nothing below is published until the version is
bumped, the branch is merged, and a tag carries these notes.

### A saved key is never moved into a directory, and a probe never goes without its timestamp

**What.** `rotate-shared-secret` corrects two commands in its example. The block that saves the old
key's copy in step 4 now refuses an `old.key` that is a directory or a link before it reads the
store: `mv` moved the copy inside such a directory and reported success, and the cleanup's `rm -f`
then left the key there, outside the scratch directory when a link pointed out of it. The probe's
body takes its timestamp from a checked assignment that must be a number, so a clock that fails
sends nothing; before, `curl` sent JSON with no timestamp in it, which the receiver refused for the
wrong reason. The reference and the pitfall about key files say the same.

**Why.** The last review round on the changes that went into 0.30.0 found both. They were recorded
as follow-ups rather than fixed before that release.

**Impact.** A rotation that follows the example can no longer leave a copy of the old key where the
cleanup does not reach it, or read the refusal of a malformed probe as a retirement that took. No
step, completion condition or checklist line changes meaning.

**Compatibility.** **Patch. No migration.** Two example commands and the sentences describing them
change, within the contract the skill already stated: a new 0600 copy or a failure, and a probe
that sends nothing when its request cannot be built. Skill metadata version 1.0.0 to 1.0.1.

**Who should update.**

- **Anyone with `rotate-shared-secret` installed:** update in each scope where it is installed, and
  re-copy the example's save block and `body()` wherever you keep a copy of them.

  ```bash
  npx skills update --project --yes   # from the project
  npx skills update --global --yes
  ```

- **Everyone else:** nothing changes.

### A review round reads every worktree path whole, newlines included

**What.** `codex-review-loop`'s `review_round` reads the checkout's worktrees with
`git worktree list --porcelain -z`, one NUL-terminated record at a time. Read line by line, a
registered worktree whose path holds a newline was compared as a truncated path, so a log directory
inside that worktree passed the check that keeps logs out of every worktree of the checkout. A list
git could not finish, wholly or after part of it, now refuses the round instead of checking fewer
worktrees.

**Why.** The last review round on the changes that went into 0.30.0 found it, and it was recorded as
a follow-up rather than fixed before that release.

**Impact.** A round whose log directory lies in any registered worktree is refused whatever that
worktree's path holds, and a round that cannot see the whole list does not run. The `-z` flag needs
git 2.36 or later; an older git fails the listing, and the round refuses rather than run unchecked.

**Compatibility.** **Patch. No migration.** One example function changes; the rule it enforces —
logs outside the reviewed tree and every worktree of the checkout — is unchanged. Skill metadata
version 1.0.0 to 1.0.1.

**Who should update.**

- **Anyone who runs `codex-review-loop`'s example recipe:** update in each scope where it is
  installed, and re-copy `review_round` wherever you keep a copy of it.

  ```bash
  npx skills update --project --yes   # from the project
  npx skills update --global --yes
  ```

- **Everyone else:** nothing changes.

### A model study's completion checks ask for what its rules require

**What.** `preregistered-model-study` corrects three completion checks that asked for less than the
rules they close. A correction found after its calls ran is complete only when every call, judge
verdict and score it invalidated was redone or excluded before any bar's verdict; before, marking it
as a correction was enough. Where an addendum changes a request, its output parity counts only once
its result is pushed before any later call, in step 7's completion and in the checklist alike; both
asked only that it ran after the addendum. And judging is complete per metric: every item for
invention and for every metric the plan did not name for the shortcut, and only the items where the
arms differ for each item-wise additive metric it named. Before, a study that registered the
shortcut for one metric could judge only the differing items for all of them, leaving invention
without its denominator. To keep the body within its line cap, two pitfalls that repeated a step,
"Unequal inputs" and "The silent repair", are removed; steps 6 and 12 still say both.

**Why.** The last review round on the changes that went into 0.30.0 found that each of the three
checks could be met while the rule it closes was broken. They were recorded as follow-ups rather
than fixed before that release.

**Impact.** A study that ticks its checklist can no longer report a verdict that rests on
invalidated outputs, run calls before its output parity is on record, or score invention on part of
its denominator. For contributors: the skill's test reads release prose from the skill's own entry
only — the staged one, or its own `###` entry in the newest changelog section that has one — holds
each release's wording against that release's entry, and checks the Published catalog paragraph on
its own.

**Compatibility.** **Patch. No migration.** Step 7's and step 8's completion conditions and the two
matching checklist lines now require what those steps' rules, and the references, already said; no
rule, template or reference changes meaning. Skill metadata version 1.0.0 to 1.0.1.

**Who should update.**

- **Anyone running a study with `preregistered-model-study`:** update in each scope where it is
  installed, and check a study in progress against the three corrected checks.

  ```bash
  npx skills update --project --yes   # from the project
  npx skills update --global --yes
  ```

- **Everyone else:** nothing changes.

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
