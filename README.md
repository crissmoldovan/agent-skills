<h1 align="center">Agent skills pack</h1>

<p align="center">
  Twenty-five public, portable Agent Skills for agent operations, reviews, releases
  and the notes that carry them, codebase context, secure setup, change delivery,
  repository governance, progress reporting, work in other repositories, and
  evidence-backed investigation of what a change would touch.
</p>

A public package by **Criss Moldovan**. Every skill is independently discoverable
under `skills/<name>/SKILL.md`, installable through Agent Skills-compatible
harnesses, and tested as part of one release catalogue.

## What is in the pack

| Skill | Description | Details |
|---|---|---|
| `model-routing` | Decide which model owns which task and when to escalate: give the cheap tier the legwork, keep planning and final review with the expensive one, and protect the driver's context. Symptoms: do this cheaply, which model should do this, delegate the legwork, we're burning tokens, this is too big for one context, set up / switch / inspect / clear a routing profile. | [Skill](skills/model-routing/SKILL.md) · [Guide](docs/model-routing/index.md) |
| `agent-lifecycle` | Add live child-agent visibility to something you are building — an orchestrator, CLI, desktop app or web UI: one event schema over several child runtimes, plus recovery of events missed across a disconnect or restart. Symptoms: show what my subagents are doing, stream agent status into the UI, normalise different child runtimes behind one interface, my agent events stop after a reconnect. This builds the feature; it is not a dispatch or routing policy. | [Skill](skills/agent-lifecycle/SKILL.md) · [Guide](docs/lifecycle/index.md) |
| `blocks` | Low-level primitives for talking to Blocks: resolve a workspace, open or read a session, collect GitHub review evidence, classify status, and wait with a visible bound. Symptoms: ask Blocks, start a Blocks session, what is Blocks doing, await the Blocks response. This is the plumbing other skills call — for the review-until-clean loop on a pull request use request-blocks-review. | [Skill](skills/blocks/SKILL.md) · [Guide](docs/blocks.md) |
| `request-blocks-review` | Run Blocks review/fix/re-review until a GitHub PR is clean. | [Skill](skills/request-blocks-review/SKILL.md) |
| `secure-credential-setup` | Get an API key, token or password into a secret store without the value ever appearing in the transcript: one credential at a time, one exact copy-pasteable terminal command for the user to run, then verification that it authenticates without printing it. Symptoms: where do I put this key, set up my API token, add it to .env / the keychain / the secret manager, here's my key (don't paste it back), the tool says unauthorized and no credential is configured. | [Skill](skills/secure-credential-setup/SKILL.md) · [Terminal patterns](skills/secure-credential-setup/references/terminal-entry-patterns.md) |
| `derive-codebase-context` | Write agent context for a repository from the repo itself: a CLAUDE.md / AGENTS.md that matches reality, the boundaries agents must not cross, and a map of where things live. Symptoms: write or fix our CLAUDE.md, the agent guidance is stale, the context files have multiplied (CLAUDE.md + AGENTS.md + Cursor rules), agents keep rediscovering the same layout, someone proposes a code knowledge graph / vector index / semantic search over the codebase. | [Skill](skills/derive-codebase-context/SKILL.md) · [Runbook](skills/derive-codebase-context/references/onboarding.md) |
| `publish-agent-skill` | Publish an Agent Skill through a verified release. | [Skill](skills/publish-agent-skill/SKILL.md) |
| `update-agent-skills` | Update installed Agent Skills wherever they live — project, global, plugin and manual copies — after correcting the changelog, README and release notes that describe them. Symptoms: update my skills, sync this skill everywhere, bring my agents to the latest version, is my skill pack stale, reinstall the pack. It moves installed copies; it does not publish a new release — that is publish-agent-skill. | [Skill](skills/update-agent-skills/SKILL.md) · [Freshness check](skills/update-agent-skills/scripts/check-pack-freshness.mjs) · [Session hook installer](skills/update-agent-skills/scripts/install-freshness-hook.mjs) |
| `release-ledger` | Build a what's-new feature into a product: capture merged work, categorise it nightly, and show each signed-in user only what shipped since they last looked, plus a digest and hand-written announcements. Symptoms: what's-new popup, in-app changelog for users, since-you-were-away digest, tell logged-in users what changed, product updates feed. This writes tables, jobs and UI into an app; it does not write the notes for one version — that is release-notes. | [Skill](skills/release-ledger/SKILL.md) · [System model](skills/release-ledger/references/system-model.md) |
| `github-webhooks` | Adopt and manage GitHub webhook handling in an app: endpoint setup, signature verification, event routing, and a working reference for every event type you route. | [Skill](skills/github-webhooks/SKILL.md) · [Event types](skills/github-webhooks/references/event-types.md) |
| `describe-changes` | Describe a change that already landed — one commit, PR, merge or tag range — classified, and written short, medium and long with every claim anchored to a hunk. Symptoms: what did this PR actually do, describe this commit, what changed between these two tags, write the changelog entry / ledger row / ticket resolution for merged work. It does not cut a release: no version bump, no semver call, no destinations — for that use release-notes and hand it this as the 'what'. | [Skill](skills/describe-changes/SKILL.md) · [Output contract](skills/describe-changes/references/output-contract.md) |
| `release-notes` | Write the note for one version and put it everywhere the project records releases — what shipped, why it shipped, and what it means for a reader deciding whether to adopt it. Symptoms: ship/cut a release, publish to npm, bump the version, changeset, release notes, CHANGELOG entry, tag a version, patch/minor/major release, create a GitHub/GitLab Release. It writes and places the note and makes the semver call; for describing a change that already landed use describe-changes, and for a what's-new feature inside a product use release-ledger. | [Skill](skills/release-notes/SKILL.md) · [PreToolUse gate](adapters/claude-code/release-notes-gate.sh) · [Gate installer](adapters/claude-code/install-release-notes-gate.mjs) |
| `investigate-codebase` | Answer a question about a codebase with evidence a reader can re-run: path and line, command output, and searched negatives reported as searched rather than as absence. Symptoms: how does X actually work, does anything still call this, is this dead code, where does this value come from, two sources disagree (a doc against the code, a registry against the runtime), I need to be sure before I delete it. For a failing test or a live bug use systematic debugging; this answers questions rather than repairing behaviour. | [Skill](skills/investigate-codebase/SKILL.md) · [Complexity rubric](skills/investigate-codebase/references/complexity-rubric.md) |
| `blast-area` | Map what a set of changes would affect before making it: callers, data contracts, jobs, UI, tests, build toolchains, deploy ordering, and second-order readers — with searched negatives and a list of what the map cannot see. Use when you need to know what a change would break. | [Skill](skills/blast-area/SKILL.md) · [Surface checklist](skills/blast-area/references/surface-checklist.md) |
| `visualise-blast-area` | Render a change's blast map as diagrams — mermaid first, optionally one self-contained interactive HTML — with changed-vs-affected styling and blind spots stated on the diagram itself. Use when a blast-area map needs to be seen, shared, or dug into. | [Skill](skills/visualise-blast-area/SKILL.md) · [Mermaid contract](skills/visualise-blast-area/references/mermaid-contract.md) |
| `decision-journal` | Record a decision and the alternatives it rejected, anchored to evidence, so the reasoning survives the session — append-only, retractable, with show/trace/digest to read it back. Symptoms: we considered X and rejected it, why is this like this, what did we already rule out, I'm assuming Y without checking, that turned out to be wrong, write this down before you compact. Records the choice, not the diff — for what a change did, use describe-changes. | [Skill](skills/decision-journal/SKILL.md) · [Anchors](skills/decision-journal/references/anchors.md) · [CLI installer](skills/decision-journal/scripts/install-cli.mjs) |
| `delphi-ground` | Build a verified-facts briefing before asking anyone — human or agent — to reason about an artefact, and refuse to certify one when too little can be checked. Use when a review, a fan-out or a persona exercise would otherwise run on invention. | [Skill](skills/delphi-ground/SKILL.md) · [Briefing format](skills/delphi-ground/references/briefing-format.md) |
| `delphi-imagine` | Critique a plan, spec, design or document from one or more named perspectives — a compliance reviewer, an SRE, a first-time user — grounded in checkable facts instead of an invented company: three concrete moments each labelled observed, inferred or constructed, a mandatory case where the thing is useless, and every gap traced to a moment and costed. Symptoms: review this as a security person, what would a CTO say, poke holes in this plan, get me a second opinion, red-team this design, the last review was agreeable rather than useful. Ground it with delphi-ground first; a critique that reads well but cannot be checked is the failure mode this exists to avoid. | [Skill](skills/delphi-imagine/SKILL.md) · [Output contract](skills/delphi-imagine/references/output-contract.md) |
| `land-complex-change` | Land a change whose side effects are the risk rather than the code: derive a touch-set budget from its blast map, arm one regression gate per affected surface and watch each fail first, land in steps that revert one at a time, and stop rather than absorb anything that appears outside the budget. Symptoms: this refactor touches code every user depends on, this migration cannot be taken back, prove the deletion is safe before I merge it, the last attempt grew until review was an argument about scope, land it in stages, this runs unattended overnight. For a routine merge-and-deploy use a ship or land-and-deploy skill; this is for the change you are nervous about. | [Skill](skills/land-complex-change/SKILL.md) · [Side-effect budget](skills/land-complex-change/references/side-effect-budget.md) |
| `resolve-problem-report` | Take a reported problem end to end: reproduce the claim, find the root cause, offer candidate fixes with trade-offs, spec the chosen one, and land it through review. Symptoms: a user reported X, this is broken in production, a flaky test is hiding something real, someone filed a bug or feature request, this keeps coming back. Use it when the report deserves more than a quick patch; for a one-line fix, just fix it. | [Skill](skills/resolve-problem-report/SKILL.md) · [Gate contracts](skills/resolve-problem-report/references/gate-contracts.md) |
| `new-ux-discovery` | Find UX improvements a codebase can already support, evidence-backed and ranked — across the CLI, the API, MCP tools, notifications and error text as much as the UI. Symptoms: what should we improve next, where does this feel rough, what's low-hanging UX we could ship this week, turn this diff into a follow-up list, roadmap candidates from the code we already have. Not a visual design pass — for look and feel use a design skill. | [Skill](skills/new-ux-discovery/SKILL.md) · [Candidate gates](skills/new-ux-discovery/references/gates.md) |
| `workspace-governance` | Audit repository placement and explain inherited policy. | [Skill](skills/workspace-governance/SKILL.md) · [Guide](docs/workspace-governance/index.md) |
| `layer-repository-docs` | Make a repository's documentation legible when an organisation has more repos than anyone can track, through three entry points — audit read-only, draft the layers, update what a change overtook: classify every document by kind, list the rot where one fact is stated twice and the two disagree, draft only the layers the tier needs from the repo's own source rather than its README, audit every replaced file for rules silently dropped, and put a newcomer through a clean clone before claiming any of it works. Symptoms: nobody can tell what this repo is for, write a manual for this repo, check whether the docs are still true, update the docs after the code moved, our READMEs all say something different, too many repos to keep track of, the docs disagree with the code, where is this rule supposed to live. It writes the documentation people read; it does not write the context files agents load — that is derive-codebase-context. | [Skill](skills/layer-repository-docs/SKILL.md) · [Entry points](skills/layer-repository-docs/references/entry-points.md) · [Layer contents](skills/layer-repository-docs/references/layer-contents.md) · [Loss audit](skills/layer-repository-docs/references/loss-audit.md) · [Newcomer test](skills/layer-repository-docs/references/newcomer-test.md) |
| `report-progress` | Report progress on long or multi-phase work in a fixed shape — what is done, what is running, what is next — keeping verified numbers separate from claimed ones, naming the user-facing consequence, and stating corrections out loud. Use when work spans phases, background agents, or more than one turn. | [Skill](skills/report-progress/SKILL.md) · [Stop-hook gate](adapters/claude-code/report-progress-gate.mjs) · [Gate installer](adapters/claude-code/install-report-progress-gate.mjs) |
| `work-in-external-repo` | Work in a repository that is not the current working directory: establish the target by name, prove the checkout by its origin remote before writing, refresh the base ref, build in a dedicated worktree instead of a shared checkout, and name the repository, branch, worktree and commits in the result. Use when a change, a branch or a pull request is requested against another repository. | [Skill](skills/work-in-external-repo/SKILL.md) |

The pack contains distinct procedures, not one monolithic workflow. Compose only
what the task needs. `model-routing` and `agent-lifecycle` cover economical,
observable delegation; `request-blocks-review` uses `blocks`; `release-ledger`
can compose with `github-webhooks` for capture and `describe-changes` for entries,
and `release-notes` writes and places the note for one version — the artefact
neither of those produces;
a target-specific private publisher/updater may fully override the generic public
workflow.

The six change-and-evidence skills compose the way the release trio does — by name,
at the point of use, with no coordinator between them. `investigate-codebase`
answers a question about a codebase; `blast-area` uses that searching to map what a
proposed change would touch; `visualise-blast-area` draws the resulting map;
`land-complex-change` builds against it inside a declared touch-set budget with a
regression gate per affected surface; `resolve-problem-report` runs the whole arc
from a report and hands its build half to `land-complex-change`; and
`new-ux-discovery` reads a blast map to find what a change newly makes possible.
Each is usable alone, and each names the sibling that owns the adjacent job instead
of restating it.

`report-progress` and `work-in-external-repo` stand beside that family rather than
inside it, because neither one does the work. `report-progress` fixes the shape of what
the reader is told while the others run: it sources "what is running" from
`agent-lifecycle` evidence and hands a landed diff to `describe-changes` instead of
paraphrasing either. `work-in-external-repo` settles which repository a change belongs
in and proves the checkout before anything is written, then hands a clean worktree to
`land-complex-change` and the destination line to `report-progress`.

## Install — for humans

Install the complete pack for the current project:

```bash
npx skills add crissmoldovan/agent-skills --skill '*'
```

Install the complete pack globally for every agent supported by the installed
Skills CLI:

```bash
npx skills add crissmoldovan/agent-skills --skill '*' --global --agent '*' --yes
```

Install selected skills:

```bash
# Observable routed delegation
npx skills add crissmoldovan/agent-skills --skill model-routing agent-lifecycle

# Blocks interaction plus the completed-PR review loop
npx skills add crissmoldovan/agent-skills --skill blocks request-blocks-review

# Secure credential placement
npx skills add crissmoldovan/agent-skills --skill secure-credential-setup

# Repository context and boundaries
npx skills add crissmoldovan/agent-skills --skill derive-codebase-context

# Verified publication and all-plane updates
npx skills add crissmoldovan/agent-skills --skill publish-agent-skill update-agent-skills

# Release-ledger capture, change descriptions, and the note for one version
npx skills add crissmoldovan/agent-skills --skill release-ledger github-webhooks describe-changes release-notes

# Evidence-backed code answers and change mapping
npx skills add crissmoldovan/agent-skills --skill investigate-codebase blast-area visualise-blast-area

# Contained change delivery and end-to-end report resolution
npx skills add crissmoldovan/agent-skills --skill land-complex-change resolve-problem-report

# Read-only repository governance (CLI installed separately)
npx skills add crissmoldovan/agent-skills --skill workspace-governance

# UX opportunities a codebase can already support
npx skills add crissmoldovan/agent-skills --skill new-ux-discovery

# Progress reports over long work, and changes that belong in another repository
npx skills add crissmoldovan/agent-skills --skill report-progress work-in-external-repo

# Decision records with checkable evidence. The skill carries its own CLI; put it on
# PATH once, from the folder the skill was installed to, so hooks and your shell find it
npx skills add crissmoldovan/agent-skills --skill decision-journal
node <skill-folder>/scripts/install-cli.mjs

# Grounded, evidence-first reviews of an artefact
npx skills add crissmoldovan/agent-skills --skill delphi-ground delphi-imagine
```

Document a repository in layers — a quick start, a manual, and the organisation's handbook:

```bash
npx skills add crissmoldovan/agent-skills --skill layer-repository-docs
```

It has three entry points, and it announces the one it picked before it starts: `check` or `need`
audits and writes nothing, `draft` or `ensure` writes the layers, `update` takes only what a change
overtook. With no word at all it audits. In a harness with slash commands that is

```text
/layer-repository-docs check
```

and in one without, the same words in a sentence. How each is evaluated is in
[its evaluation protocol](docs/layer-repository-docs/evaluation.md).

`--agent '*'` means every agent the installed CLI supports, not every agent that
exists. The CLI reports unsupported clients separately. Preserve the existing
copy/symlink form unless conversion is explicitly requested.

## Install — for agents and LLMs

```text
Install or update the twenty-five public skills from crissmoldovan/agent-skills.
Inventory project and global scopes in JSON first. Preserve source provenance,
managed/unmanaged ownership, copy/symlink form, and private namespaced plugin
skills. Install the requested scope for every supported agent, report unsupported
clients separately, then verify each installed path and source. Do not treat one
successful agent or scope as proof that all local libraries are current.
decision-journal carries its own CLI: ask before running its
scripts/install-cli.mjs, which puts agent-journal on PATH; never run it unasked.
```

Preview destructive replacement when a stale directory has no managed
provenance. Never remove a private namespaced skill merely because a public
standalone skill has the same bare name.

## Update the pack

Inventory before updating:

```bash
npx skills list --json
npx skills list --global --json
```

Update CLI-managed skills at an explicit scope:

```bash
npx skills update --project --yes
npx skills update --global --yes
npx skills update model-routing agent-lifecycle --global --yes
```

For missing global projections across all supported agents:

```bash
npx skills add crissmoldovan/agent-skills --skill '*' --global --agent '*' --yes
```

### All-plane update contract

| Plane | Update rule | Required proof |
|---|---|---|
| Project-scoped Skills CLI | `npx skills update … --project --yes` from the exact project | project inventory, provenance, consuming path/precedence |
| Global Skills CLI | `npx skills update … --global --yes` | global inventory and every requested supported-agent projection |
| Copied vs symlinked | Preserve the current form unless conversion is requested | installed path/form and published-byte comparison where possible |
| Unmanaged/provenance-less | Ask before replacing only that identity | old path accounted for; new source and bytes verified |
| Native plugin/package | Use its marketplace or registry updater | exact native version, namespace, install path, and bytes |
| Manual upload/raw file | Replace through the owning UI/channel | artifact verified; otherwise `manual action required` |
| Remote machine/container | Treat as another explicitly named target | independent readback on that target |
| Unsupported client or unreachable target | Invent no destination | literal `unsupported` or `deferred` outcome |

Restart or reload agents whose loaders cache installed files. A current session
may continue using old instructions until reopened.

## Use the skills

```text
Use model-routing for this task. Keep acceptance quality fixed, send the bounded
implementation to the cheap tier, and keep planning and final review where they are.
```

```text
Use agent-lifecycle to add child visibility to this orchestrator: one event schema
over both child runtimes, a projection the UI can render, and recovery of whatever
was missed while the connection was down.
```

```text
Use decision-journal while you work. Record the choices that did not feel like
choices, cite what you actually read, and say plainly where you consulted nothing.
```

```text
Use delphi-ground on this spec, then delphi-imagine from three perspectives that
would disagree. Withhold prior findings, and stop if the briefing comes back thin.
```

```text
Use request-blocks-review on this finished PR. Keep the wait visible, fix accepted
findings, rerun verification, and request current-head re-review until clean.
```

```text
Use secure-credential-setup. Ask for one credential at the exact gate and verify
authentication without printing any part of the value.
```

```text
Use derive-codebase-context. Reuse what exists, derive only missing context,
boundaries, and atlas layers, and mutation-test every new enforcement gate.
```

```text
Use publish-agent-skill for the current repository. Require catalogue README,
human release notes, update guidance, discovery, and provenance. Synchronize real
local libraries only if I explicitly name the target.
```

```text
Use update-agent-skills. Make changelog, catalogue README, release notes, and agent
update guidance agree; then update only the planes I explicitly named.
```

```text
Use release-ledger to onboard a since-you-were-away system into this app.
Investigate the stack first, decide the capture path with me, use github-webhooks
when automatic GitHub capture is selected, and use describe-changes to write each
entry from its diff in short, medium, and detailed registers.
```

```text
Use release-notes before you publish this. Run the impact analysis rather than guessing at
it, settle the semver bump against what that analysis says instead of against the plan, and
write what / why / impact — then find every place this project records releases and put the
note in all of them before the tag goes up.
```

`release-notes` also has a mechanical half, and it is not that prompt: an optional Claude
Code `PreToolUse` hook that refuses a release whose version no release-note file mentions.
It is off until a human installs it, and no agent may install it on your behalf — see
[Optional hooks](#optional-hooks-adapters).

```text
Use investigate-codebase for this question. Score it before spending anything, announce
the band and what it buys, run searches with controls so an empty result means something,
and tell me plainly what was not searched.
```

```text
Use blast-area for this proposed change, then visualise-blast-area on the result. I want
the surfaces it hits, when each break would surface, the deploy ordering with its reason,
and the blind spots drawn on the diagram rather than written underneath it.
```

```text
Use land-complex-change to build this. Derive the touch-set budget from the blast map
first, arm one regression gate per affected surface and watch each fail before the change,
and stop the work rather than absorb anything discovered outside the budget.
```

```text
Use resolve-problem-report on this report. Reproduce the reporter's numbers before
agreeing with them, offer candidates with what each one does not fix, and come back with a
question or a refutation if that is the honest answer.
```

```text
Use new-ux-discovery on this repository. Enumerate the surfaces first, gate every candidate
through the not-already-implemented sweep and the no-confusion check, and show me the
dropped candidates with the reason each was dropped.
```

```text
Use report-progress at each phase boundary and before you end a turn with background work
running. What is done, what is running, what is next — each with a count or an artefact.
Keep numbers you verified by running something apart from numbers a subagent claimed, and
say you cannot see the children rather than guessing what they are doing.
```

`report-progress` also has a mechanical half, and it is not that prompt: an optional Claude
Code `Stop` hook that holds a turn open when a report is owed and missing. It is off until a
human installs it, and no agent may install it on your behalf — see
[Optional hooks](#optional-hooks-adapters).

```text
Use work-in-external-repo: this change belongs in another repository, not in this working
directory. Prove the checkout by its origin remote before writing anything, fetch the base
and tell me how far behind it is, work in a worktree of your own, and name the repository,
branch, worktree path and commits in the result.
```

```text
Use workspace-governance to validate this declared catalog, explain inherited
policy and produce one workspace report covering hierarchy, checkout placement and
the selected inert workflow. Treat previews as read-only and local principal
selection as advisory, never approval to move repositories.
```

The workspace-governance CLI is installed separately from a built local tarball;
see [build/install guidance](packages/workspace-governance/README.md). Installing
the skill does not install the CLI; the v0.1 candidate is unpublished.

## Optional hooks (adapters)

Three skills have a **mechanical half**: a hook that runs outside the conversation, where no
model sits in the enforcement path. Each is off until a human installs it, each is
removed by the same installer that wrote it, and no skill and no agent may install any of
them on a user's behalf. They live in [`adapters/`](adapters/), beside the payload captures they
were built against — [`adapters/NOTES.md`](adapters/NOTES.md) for the shapes Claude Code
sends, [`adapters/HOOK-OUTPUT-NOTES.md`](adapters/HOOK-OUTPUT-NOTES.md) for what a hook can
print back and have the harness act on. Where a document and those notes disagree, the notes
win: they are the observed record.

### The `report-progress` gate — Claude Code `Stop`

On a turn that delegated work the reader cannot see, or that changed what is running in the
background, it reads the turn's final message. In `block` mode it holds the turn open for one
more round when that message carries no progress report; in `observe` mode — the default, and
the one to live with first — it writes what it would have refused to stderr and never holds
anything. A turn that delegated nothing and changed nothing ends exactly as it would with the
hook absent.

How wide it arms is a level you choose with `--coverage 1|2`, written into the hook command as
`AGENT_SKILLS_PROGRESS_GATE_COVERAGE`. `1` — also what a command naming no level means — is the
narrow original: one signal, `PostToolUse` with `tool_name` `Agent`. At `2` it arms on a **subagent of any kind** starting
(`SubagentStart`), on a skill you named as an external agent (`--skills`, exact name, empty by
default), and on a **change** in the harness's own register of background work between this
turn's end and the last one — something appeared, or something that was running is no longer
listed. A task that is merely still running arms nothing, so a dev server left in the
background does not make every turn owe a report. It does no matching of command text
anywhere.

**Updating keeps the level and the mode you have.** Re-running the installer with no `--coverage`
keeps the level of the gate already installed, and prints `Kept coverage N (already installed in
this file)`; with no `--mode` it keeps that gate's mode — `off` too, if you disarmed it by hand —
and prints `Kept mode block (already installed in this file)`. Only `--coverage` and `--mode`
change them, and the output names the change: `Set mode observe (was block)`. A new install with no
`--coverage` gets `1`: coverage 2 holds more turns, since a change in the background register arms
a turn with no tool call at all. A new install with no `--mode` gets `observe`. A gate that can end a
turn is the user's to widen, not a default to inherit.

The gate ships with **this repository**, not with the installed skill: `npx skills add`
copies `skills/report-progress/SKILL.md` and nothing else, so arming the gate means running
the installer from a checkout of this repo.

```bash
# say what it would have refused, on stderr; never holds a turn. This is the default.
node adapters/claude-code/install-report-progress-gate.mjs --mode observe

# hold the turn instead
node adapters/claude-code/install-report-progress-gate.mjs --mode block

# arm on subagents of any kind, named skills and background work too
node adapters/claude-code/install-report-progress-gate.mjs --mode block --coverage 2

# take it back out; nothing is left behind
node adapters/claude-code/install-report-progress-gate.mjs --remove

# a hand-wired hook, running the gate in a shape this installer never writes:
# --remove names it and exits 1, and an install refuses; --adopt takes it as this installer's own
node adapters/claude-code/install-report-progress-gate.mjs --remove --adopt
```

**The installer recognises its hooks by their command.** Claude Code drops `describe` from every
hook entry whenever it writes a settings file, and adding a plugin marketplace is enough to cause
that; the same writes keep each hook's command byte for byte
([`adapters/HOOK-OUTPUT-NOTES.md`](adapters/HOOK-OUTPUT-NOTES.md), 2026-09-14). So updating or
removing a gate the harness has rewritten needs no flag. The installer's exact shape is
assignments to the gate's own `AGENT_SKILLS_PROGRESS_GATE…` variables (the arming one among them,
none twice), then one interpreter, then the gate single-quoted with a basename of exactly
`report-progress-gate.mjs`, and nothing after. A command in that shape is read by its interpreter
alone. It is the installer's own when the interpreter is a single-quoted path whose name is a
Node-compatible runtime — `node`, `nodejs` or `bun`, with an optional version (`node-20`, `node22`)
and an optional `.exe` — or the name of the node binary running the installer. The installer writes
the path of whatever binary runs it, so that name changes from one machine, and one upgrade, to the
next. With any other program in that place the same shape is named, and `--adopt` takes it; with one
that only prints, reads or deletes files, such as `'/bin/echo'` or `unlink`, it is nobody's. Where
the harness has not dropped it, the
installer's own `describe` on a hook that runs the gate, in any shape, makes that hook its own too,
as it did through 0.19.0. `--adopt` takes any other hook that runs the gate: the gate file as the
program, or straight after an interpreter such as `node` or `bash`. That holds past the wrappers
the installer reads in front of a command — `timeout`, `nice`, `nohup`, `env`, `command`, `exec`,
`caffeinate` and `sudo`, nested or not (`sudo -u x timeout 5 node …`) — each only in the forms its
manual gives on both macOS and Linux; the table is in
[`adapters/claude-code/README.md`](adapters/claude-code/README.md).

**A plain re-run never takes a hook the installer cannot fully read**, with or without its
`describe`: `--remove` names it and exits 1, and an install refuses. That covers a wrapper option or
form it does not recognise (`nice -10`, `timeout -p 5`, `sudo -i`), which it never guesses past; the
file as an argument of `xargs`, `time` or a wrapper script, or as an option's value; the file after
`node --check`; the gate read on the stdin of an interpreter or shell (`node <<< '<gate>'`,
`bash < '<gate>'`); a pipe into one, or a variable; its own shape run by a program it does not know;
and its own `describe` over a command that never names the gate file.
**`--adopt` takes such a hook over**, whatever leads the command and wherever the gate path sits, as
0.19.0 did, unless the hook also writes to the gate file; and it says when it did, naming each hook:
`Took over 1 hook this installer could not fully read: Stop (matcher *).`
The installer could not tell whether such a hook runs the gate, so check it before you pass
`--adopt`.

**It never takes a hook, with any flag and whatever its `describe` says, for four reasons, and keeps
a hook from `--adopt` for no other.** The reasons are applied as the installer's reader judges the
command, and it can misjudge complex, hand-written shell (the known limitation below):

- **a mention** — every place the reader finds the gate file named reaches only a program that does not run it
  (`echo`, `cat`, `grep`, `wc`, `rm`, `unlink`): as its argument, on its stdin (a pipe, a here-string,
  a here-document or a `<` redirection), or in a shell comment, with nothing that program prints
  flowing on into anything else, and nowhere else in the command. `wc -l < '<gate>'` and
  `cat <<< '<gate>'` are mentions; `node <<< '<gate>'` is not (an interpreter runs its stdin), and
  `node '<gate>' # note` still runs the gate;
- **a write target** — a redirection writes to the gate file, inside `sh -c`, `eval`, a here-document
  or a substitution too;
- **a different file** — every path with the gate file's name in it ends in another name: a lookalike
  (`install-report-progress-gate.mjs`) or the gate file's name only as a directory
  (`/x/report-progress-gate.mjs/index.mjs`);
- **another tool's `describe`**.

A reason is returned only when the command holds no expansion the installer does not resolve
(**the certainty rule**, checked over the whole command): a parameter expansion with an operator
(`${G%.bak}`, `${G:=…}`), indirection, brace expansion or arithmetic, or a command substitution whose
output feeds an executing program, may turn a lookalike into the gate (`G=<gate>.bak; node
"${G%.bak}"` runs the gate) or the gate into another file, so such a hook is left unclear, which
`--adopt` takes and `--remove` exits 1 over, never a mention or a different file.

`--remove` names every hook it leaves that names the gate file, with the reason and its kind
(`left alone: only mentions the gate file (comment)`, `left alone: names a different file (directory)`),
and never says no gate was installed while one is there.

**Known limitation: some hand-written hooks that run the gate are read as mentions.** The reader
reads shell text without running it, and it can read a complex hook that wraps the gate in shell as
only mentioning the gate file although the shell runs the gate. The families observed:

- a here-document whose body runs the gate through `$(…)` or backticks (`cat <<EOF`, then
  `$(node '<gate>')`, then `EOF`);
- the output of a group or compound command piped into a shell or interpreter:
  `{ cat '<gate>'; } | bash`, `(cat '<gate>') | bash`, `if …; then cat '<gate>'; fi | bash`, or a loop;
- ANSI-C quoting, `$'…'`, hiding a later command;
- `$_` carrying a mentioned argument into the next command: `test -f '<gate>' && node "$_"`;
- arithmetic that bash evaluates inside `[[`;
- zsh process substitution: `cat '<gate>' > >(bash)`, `exec > >(bash)`;
- a launcher or a copy written to another file and run: `cp '<gate>' x && node x`, or through `tee`.

For such a hook `--remove` exits 0, says no hook in the file runs the gate as the installer reads it,
and lists the hook as left alone; no flag, `--adopt` included, takes it over. **If a hook wraps the
gate in shell like this, remove it by hand; do not rely on `--remove`.**

Other known limits of the reading: a gate whose name is not written out literally (a
`[r]eport-progress-gate.mjs` glob, a path read from a file, a symlink under another name) is not read
as naming it; a group whose `hooks` is not an array is not read; control flow is read by structure
(`false && node '<gate>'` reads as running it); a write through a program's argument (`sed -i`,
`dd of=`, `curl -o`) is not a write target, so `--adopt` may take it; under `--adopt` a hook the
installer did not write and cannot fully read is taken, and named, as 0.19.0 took it; the certainty
rule covers the whole command, so a plain mention beside an unrelated `${…}` is treated as unclear;
and `printf -v` captures are handled only as unclear. The full list is in
[the adapter README](adapters/claude-code/README.md#known-limits-of-the-reading). The release-notes
gate's installer below recognises its hook the same way, with the same limits.

Six limits, stated here because a guard that is misread is worse than no guard:

- **It checks the shape of a report, never whether anything in it is true.** It sees three
  section labels, and a literal state and a freshness token on a running row. It cannot tell
  whether `npm test` was ever run, whether `child-7f2` exists, or whether "40s ago" was an
  observation. A message that satisfies it can still be a fabrication; the skill's own
  checklist, run by a reader, is what catches that.
- **It enforces an opportunity, not compliance.** A block buys the model one more round and
  nothing else. Live, when the user's own prompt contradicted the gate — reply with one line,
  write no report — the model weighed the gate's feedback against that instruction, re-sent the
  one-liner unchanged, and the turn ended. Where nothing contradicted it, the same model wrote the
  report and the report passed.
- **It blocks at most once per turn, and that depends on a hook the installer writes beside it.**
  Claude Code ends a turn after 8 consecutive `Stop` blocks, that budget is shared with every
  other `Stop` hook on the machine, and when it runs out the result comes back as a success with
  an empty answer. The gate records each block it spends in a file that nothing inside the turn
  touches, so arming again later in the same turn does not erase it. Arming again means another
  `Agent` dispatch, a subagent starting, or the background register changing again. At both
  levels the installer writes a `UserPromptSubmit` hook that clears that record when the next turn
  starts. It prints nothing. That event was observed firing at the start of every turn, including
  the turn a background completion starts, and never inside a `Stop`-forced continuation
  ([`adapters/HOOK-OUTPUT-NOTES.md`](adapters/HOOK-OUTPUT-NOTES.md), fourth addendum of
  2026-09-14). A turn it does not fire for cannot block while an earlier turn's block is still on
  record, because nothing else clears it; after a turn that did not block, it still can. Turns started by a slash command
  were not tested. A gate installed by 0.19.0 or earlier has no such hook, and it behaves exactly
  as it did until the installer is re-run. Under that older gate, only the harness's own
  `stop_hook_active` stops a second block after a re-arm.
- **Its marker is keyed by session,** and the `Stop` that ends a turn is what clears it. A
  turn that armed and then died without a `Stop` — a crash, a kill — leaves the marker behind,
  so the next turn in that session pays one block for a dispatch it did not make. One block,
  then cleared.
- **At coverage 2, resuming a session does not cost a block, provided the gate's `SessionStart`
  hook is installed.** The baseline is kept under the session id, which `--resume` keeps. The
  harness's background list belongs to the CLI process, which a resume replaces. The `Stop`
  payload and the hook's environment carry no process identity. The hook's parent pid is the CLI
  only where the shell execs the command, so nothing can be keyed on it. Instead, the installer
  writes a `SessionStart` hook on matcher `resume`. It fires for `--resume` and `--continue` before
  the resumed process's first `Stop`, and leaves a note. That `Stop` drops the disappearances when
  none of the old tasks is still listed, which a new process cannot do. On `--fork-session` the
  event carries the parent's session id, so the note can reach the parent's next `Stop` instead.
  There a disappearance is kept while any of the parent's tasks is still listed. It is missed only
  when all of them went away in that same turn. A gate installed without the hook still pays one
  block after a resume
  ([`adapters/HOOK-OUTPUT-NOTES.md`](adapters/HOOK-OUTPUT-NOTES.md), fourth and fifth addenda of
  2026-09-14).
- **It keeps small per-session files in the temp directory, beside the marker.** Coverage 2
  keeps `<session>.register.json`, the baseline the next turn's edge is compared against, which
  has to survive the `Stop` that deletes the marker. It is removed only when a later `Stop` finds
  the register empty. A session that ends with something still running leaves one behind until
  the operating system sweeps its temp directory. At both levels, a spent block leaves
  `<session>.spent.json` until the next turn starts. At coverage 2, a resume leaves
  `<session>.resumed.json` until that session's next `Stop`.

### The `release-notes` gate — Claude Code `PreToolUse`

It reads Bash commands and acts on four shapes: `npm|pnpm|yarn publish` and `changeset
publish`, `gh|glab release create <tag>`, a release-looking `git tag`, and a `git commit`
that stages a `package.json` version bump. For each it resolves the package and the version
being released, then looks for that version in the project's release-note files. In `block`
mode a version nothing mentions gets a permission denial; in `observe` mode — the default,
and the one to live with first — it writes what it would have refused to stderr and stops
nothing.

Like the gate above it ships with **this repository** rather than with the installed skill,
so arming it means running the installer from a checkout of this repo.

```bash
# say what it would have refused, on stderr; never stops a release. This is the default.
node adapters/claude-code/install-release-notes-gate.mjs --mode observe

# refuse the release instead
node adapters/claude-code/install-release-notes-gate.mjs --mode block

# take it back out; nothing is left behind
node adapters/claude-code/install-release-notes-gate.mjs --remove
```

Like the progress gate's, this installer recognises its hook by the command it wrote, so a settings
file Claude Code has rewritten needs no flag: a hook is its own when the whole command is exactly
`AGENT_SKILLS_RELEASE_NOTES_GATE=<mode> bash '<path>/release-notes-gate.sh'`, with nothing after it,
or when it runs the gate under this installer's own `describe`. `--adopt` takes a hook that runs the
gate in any other shape, including that one with another shell in place of `bash` (`/bin/bash`,
`sh`). A plain re-run never takes a hook it cannot fully read. `--adopt` takes it over, whatever leads
the command and wherever the gate path sits, unless it writes to the gate file, and prints each hook
it took that way. It never takes a hook for the same four reasons as the progress gate's installer,
applied as its reader judges the command, and for no other: a mention (`echo`, `cat`, `unlink`,
`shellcheck`, or a comment such as `true # release-notes-gate.sh`), a write target, a different file
(`release-notes-gate.sh.orig`, or the name only as a directory, `/x/release-notes-gate.sh/run.sh`), or
another tool's `describe`. The known limits are the same too, including the hand-written shell it can
read as a mention (`{ cat '<gate>'; } | bash`, a here-document body that runs `$(bash '<gate>')`):
remove such a hook by hand.
`--remove` exits 1 while a hook it reads as running the gate, or possibly running it, is left, and
names every hook it leaves that names the gate file, with why. Re-running it with no `--mode` keeps the mode already installed, `off`
included, and says so.

Three limits, stated here because a guard that is misread is worse than no guard:

- **It checks that a note is present, never what it says.** It looks for the version string
  in a file whose job is recording releases — `CHANGELOG.md` and its usual spellings,
  `docs/releases.md`, files under `docs/releases/`, a pending `.changeset/` entry. A heading
  with a git-message body under it satisfies the gate completely and fails the skill.
- **It allows everything it cannot resolve confidently,** including a project that keeps no
  release-note file at all. In such a repository an armed gate never fires, and that is the
  design rather than a failed installation — so do not read silence as proof it is working.
  Confirm with a run in `observe` mode against a release you know has no note.
- **Its decision channel is documented rather than observed.** The `permissionDecision`
  shape block mode returns is in the harness schema captured in
  [`adapters/HOOK-OUTPUT-NOTES.md`](adapters/HOOK-OUTPUT-NOTES.md), whose probe deliberately
  did not exercise the decision channel; nor has this pack observed whether a `PreToolUse`
  hook's stderr reaches you at exit 0. Both are marked NOT OBSERVED there, and this gate
  does not upgrade them by being installed.

### The `update-agent-skills` freshness hook — Claude Code `SessionStart`

This one is carried by the skill itself, so an installed copy has it:

```bash
node <skill-folder>/scripts/install-freshness-hook.mjs --mode notify --source <owner>/<repo>
node <skill-folder>/scripts/install-freshness-hook.mjs --remove
```

`notify` reads and reports; it cannot mutate anything, because the checker cannot. Its hook
is synchronous and always exits 0, handing the report to the model as
`hookSpecificOutput.additionalContext` — so the session waits for it: roughly ten seconds on
a cold check, a process spawn on a cached one. Drift and **`unknown`** travel that same
channel: an unreadable lockfile, an unreachable source or a crashed check says so out loud
rather than rendering as the silence that means "current".

`auto` applies exactly the update the checker named, at global scope, for that one source.
Installing it is the user's standing consent, and `--remove` is how it is withdrawn.

## Composition and references

- [`docs/composition.md`](docs/composition.md) — routing and lifecycle ownership, where progress reports draw their evidence, and where external-repository work sits.
- [`docs/blocks.md`](docs/blocks.md) — Blocks REST/GitHub separation.
- [`skills/release-ledger/references/system-model.md`](skills/release-ledger/references/system-model.md) — release-ledger system model.
- [`skills/github-webhooks/references/event-types.md`](skills/github-webhooks/references/event-types.md) — webhook event reference.
- [`skills/describe-changes/references/output-contract.md`](skills/describe-changes/references/output-contract.md) — change-description contract.
- [`skills/blast-area/references/output-contract.md`](skills/blast-area/references/output-contract.md) — blast-map output envelope.
- [`skills/investigate-codebase/references/documenting-the-run.md`](skills/investigate-codebase/references/documenting-the-run.md) — the run-record convention, carried byte-identically by each of the six.
- [`docs/architecture.md`](docs/architecture.md) — catalogue architecture.
- [`docs/releases.md`](docs/releases.md) — release process and versioning.
- [`docs/public-content-policy.md`](docs/public-content-policy.md) — public/private boundary.
- [`adapters/claude-code/release-notes-gate.sh`](adapters/claude-code/release-notes-gate.sh) — the release-note presence gate, and the note sources it recognises.
- [`adapters/`](adapters/) — the optional hooks above, and the observed hook-payload and hook-output records they were built against.

The [`routed-delegation` Hermes bundle](hermes-bundles/routed-delegation.yaml) is
a load-time helper for routing plus lifecycle. It does not install skills.

## Verify this repository

```bash
npm run verify
```

The command runs catalogue and digest tests, skill validation, the lifecycle and
journal runtime suites, the workspace-governance suite, TypeScript builds, and
isolated package-consumer verification.

## License

[MIT](LICENSE)

---

<p align="center">
  <sub>Made by Criss Moldovan</sub>
</p>
