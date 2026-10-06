# Contributing

Thanks for helping build a safe, portable public catalog.

## Before adding a skill

This public catalog ships `model-routing`, `agent-lifecycle`, `blocks`,
`request-blocks-review`, `secure-credential-setup`, `derive-codebase-context`,
`publish-agent-skill`, `update-agent-skills`, `release-ledger`, `github-webhooks`,
`describe-changes`, `release-notes`, `investigate-codebase`, `blast-area`,
`visualise-blast-area`, `land-complex-change`, `resolve-problem-report`,
`new-ux-discovery`, `decision-journal`, `delphi-ground`, `delphi-imagine`,
`workspace-governance`, `report-progress`, `work-in-external-repo`,
`layer-repository-docs`, `isolated-change-validation`, `onboard-project`,
`request-answers`, `handoff-prompt`, and `mine-session-transcripts` — thirty in all. Routing
owns exact model selection and scoped intent; lifecycle owns evidence-backed child
visibility; Blocks owns GitHub-hosted review interaction and bounded status waits;
`derive-codebase-context` owns generated repository context and its CI gates;
`update-agent-skills` owns moving installed copies wherever they live, and composing,
checking and listing the adapted copy a project makes of a pack skill;
`investigate-codebase` owns evidence-backed answers about a codebase; `blast-area`
owns what a proposed change would affect and `visualise-blast-area` owns drawing it;
`land-complex-change` owns the declared touch-set budget and the regression gate
ladder; `resolve-problem-report` owns the arc from a report to a resolution;
`new-ux-discovery` owns gated UX opportunity discovery; `request-answers` owns the ask
that unblocks work on another person's judgement — the answer sheet they reply to and the
ledger of what came back — while `decision-journal` owns the
record of why a decision was made; `delphi-ground` owns the verified-facts briefing
and `delphi-imagine` the perspective review built on one; `workspace-governance`
owns declared-catalog placement and inherited policy; `release-notes` owns the note for one version — the semver call, the three-part
note, and its placement in every destination a project records releases in;
`report-progress` owns the
shape of what a reader is told while long work runs; and `work-in-external-repo`
owns which repository a change belongs in and the tree it happens in; and
`layer-repository-docs` owns the documentation people read — the layers a repository's
documents take, the loss audit over anything it replaces, and the newcomer test that
decides whether a rewrite is fit to hand over; a request enters it through `audit`,
`draft` or `update`, and the run announces which before it reads anything; and
`isolated-change-validation` owns the sandbox a change is proven in before it may land —
the physically separate lane, the hash-pinned source identity, the gates the parent runs
itself rather than believing a builder's report, and the handoff bundle the run is
transferred in; and `onboard-project` owns which skills a repository uses and how they are put in
front of every session in it — the declared `fit.json` each skill carries, the profile beside the
Skills CLI's lock file, and the generated `.claude/rules/skill-routing.md`, which names a
project's adapted copy of a skill rather than the skill it adapts — while installing nothing
itself; and `mine-session-transcripts` owns finding what a person said to an agent in
the harness's own session transcripts — the messages typed and the ones queued while a turn ran,
each located by line, time and session without the transcript being printed, and whether each is
written down — while `decision-journal` records a decision once it is found and
`investigate-codebase` answers what the code does about it; and `secure-credential-setup` owns
getting a credential into a secret store without its value entering the transcript;
`publish-agent-skill` owns releasing a skill through a verified release, and
`request-blocks-review` the review loop that runs until a pull request is clean; `release-ledger`
owns the what's-new system inside a product, `github-webhooks` an app's GitHub webhook endpoint,
its signature check and its event routing, and `describe-changes` the anchored description of a
change that already landed; and `handoff-prompt` owns the one self-contained block that hands work
to another session, agent or person. A new skill must state which of these it does not duplicate.

Read [the public-content policy](docs/public-content-policy.md) and [architecture](docs/architecture.md). Never copy internal playbooks, credentials, customer data, or machine-specific instructions into this public repository.

## Skill contract

A skill lives at exactly:

```text
skills/<name>/SKILL.md
```

Do not create a root `SKILL.md`. The directory name and frontmatter `name` must match and use lowercase letters, digits, and single hyphens.

Start each skill with YAML frontmatter:

```yaml
---
name: example-skill
description: Use when the agent needs to perform a specific, reusable workflow.
---
```

Keep local links relative to the skill directory. Do not link to files outside that directory. Do not include absolute local paths, tokens, private endpoints, or secrets.

### What every skill carries

A reader who knows one skill in this catalogue should know where to look in the next, so a new skill
has the parts the others have. Those marked † are checked by `scripts/verify-skills.mjs` or the
catalog and site tests; the rest is the shape the catalogue's skills already share.

- **Frontmatter:** `name`† (the folder's name), `description`†, `license: MIT`, `compatibility`† (at
  most 500 characters: what the skill needs and what it outputs), `metadata` as
  `"group=workflow; lifecycle=release; version=<x.y.z>; author=<handle>"`, and `allowed-tools`. The
  description is at most 1024 characters† and is what a runtime matches: what the skill does, then
  `Symptoms:` or `Use when` with the words a person would type, then which sibling skill owns the job
  next to it. `lifecycle`† is the skill's own maturity, not the stage of the work it serves, and
  every skill this catalogue publishes says `release`. The metadata `version` is the skill's own, and
  any change to the skill's files moves it† from the version last released: a patch for wording,
  documentation, metadata or the description, a minor version for new behaviour. A release that
  carries several changes to one skill moves it once, by the largest step. `agent-lifecycle` and
  `workspace-governance` keep the frontmatter of their own releases.
- **Body**, at most 484 lines†: a `#` title, then `## When to Use`, with what not to use it for;
  `## Prerequisites`, or a first step that settles them; `## Procedure`, in numbered steps, with a
  **Complete when:** on each step or each prerequisite; `## Usage Examples`†, holding only prompts
  in `text` fences and commands in `bash` fences, since a specimen of output goes under
  `## What it looks like`; `## Pitfalls`; and `## Verification`, a checklist. It says which sibling
  skills own the jobs next to it, in a table or under When to Use.
- **Carried files:** `references/fit.json`†, which `onboard-project` reads, and every other reference
  file linked from `SKILL.md` with a Markdown link, in the text or under `## Deeper reading`, not
  only named as code.
- **Outside its folder:** an entry under the README's What is in the pack, with the exact
  description†, the install command, one to three asks (a lead "Use <skill> …" ask, or one of its
  own Usage Examples or its opening, word for word), and a More line linking the skill and its main
  references; its name in the README's flat list†, in the list above with a clause on what it owns,
  and in `docs/releases.md`'s Published catalog† with a paragraph saying what it owns; a content
  test, in `test/catalog-content.test.mjs` or a test file of its own; and its release prose under
  Unreleased in `docs/releases.md`. A skill with a hook also gets a subsection under the README's
  Optional hooks.

### A skill a project can adapt

A project can adapt a skill instead of forking it: it binds the skill's slots and adds to its
steps, and the skill's own text reaches it unchanged. A skill that allows this declares a
`## Bindings` table of slots, each with a default, makes every handoff to a sibling skill a slot
of kind `skill`, and gives its hard lines `H` ids and its steps `S` ids, as
[project adaptation](docs/project-adaptation.md) describes. `scripts/verify-skills.mjs` checks
every file that declares the section. An id is a name, not a position: renaming or removing one
is a major change for that skill ([which number moves](docs/project-adaptation.md#changing-a-skill-that-projects-adapt)),
and a published tag is never moved or deleted ([Tags](docs/releases.md#tags) names the one
exception).

## Adapters and hooks

`adapters/` holds harness-specific code that runs outside the conversation — today
the Claude Code journal hook, the `report-progress` gate, and the `release-notes`
gate. None of it is a skill:
it is not discovered, `npx skills add` does not install it, and
`scripts/verify-skills.mjs` does not validate it. It carries its own rules instead.

- **Observed, not assumed.** Every claim about a payload shape, an event name or an
  output channel must be anchored to a capture in
  [`adapters/NOTES.md`](adapters/NOTES.md) or
  [`adapters/HOOK-OUTPUT-NOTES.md`](adapters/HOOK-OUTPUT-NOTES.md). If you need a
  fact neither file holds, probe it in a throwaway project and add it there, tagged
  the way those files tag everything — OBSERVED, DOCUMENTED, NOT OBSERVED. Never
  document intended behaviour.
- **An exit code is not a delivery channel.** It means different things on different
  events, and one number often covers two states. A hook with something to say
  prints the words.
- **Off until a human arms it.** A hook that can end a turn, speak into a session or
  mutate an installation ships off, is installed by a user running its installer,
  and is removed by that same installer. No skill installs one, and no agent
  installs one on a user's behalf.
- **Never fail what you observe.** Every path exits 0, every stdin read is fenced by
  a timeout, and a hook's own failure is never the session's.
- **State the limits everywhere the hook is introduced.** A string-matching gate
  checks shape, not truth; a hook that spends a shared block budget has a ceiling.
  Code comment, reason string, installer output, README and release note all have
  to say so — a guard that is over-trusted is worse than no guard.

Hooks are tested from the root suite (`test/report-progress-gate.test.mjs`,
`test/release-notes-gate.test.mjs`, `test/hook-ownership.test.mjs`, `test/hook-ownership-installers.test.mjs`, `test/hook-ownership-v0.19.0.test.mjs`, `test/freshness-hook-install.test.mjs`, `test/onboard-check-hook.test.mjs`) or from the package they feed
(`packages/agent-journal/test/adapter-claude-code.test.ts`). `npm run verify` runs
both.

## Local verification

Use Node.js 24 or newer, then run:

```bash
npm run verify
```

The command installs locked development dependencies for the independent lifecycle
and workspace-governance packages, then runs their type checks, tests, builds and
isolated tarball consumers. It must pass before opening a pull request; CI runs
the same command. Workspace governance keeps a locked runtime dependency closure;
its local stdio MCP uses the pinned official MCP server SDK and Zod, while YAML
remains the catalog parser.

Before you push, also scan what your branch adds against your own private list of
terms that must never appear here — the clients, people, hosts, account ids and
machine details from the work a contribution came out of — kept outside every
repository, and outside every worktree of this one:
`node scripts/scan-denylist.mjs --denylist <your file> --base origin/main`. It reads
every added line, fixtures included, every file name, every commit message and the
branch name, and prints no term it matched unless you pass `--show-matches`. A term
matches as a word, numbered forms included (`name01`); list every other spelling on a
line of its own: joined, hyphenated, abbreviated, or in capitals run on into the next
word.

Workspace governance owns declared catalog/policy, read-only discovery, its local
stdio MCP adapter, and guarded repository operations, not routing or agent lifecycle.
The MCP server starts read-only and accepts one immutable configuration path; tool
callers cannot supply argv, environment, executables, or alternate configs. Its library, CLI and schemas live in `packages/workspace-governance`; its skill
carries only portable instructions and internal relative references. Do not put
machine inventories in the public tree. See its
[architecture and acceptance map](docs/workspace-governance/index.md). The package
is `private:true` and is not published to the npm registry; reviewed GitHub Release
bundles are its distribution channel. Packaging tests alone do not authorize a
release, global install or live agent update.

## The three checks on a pull request, and why each is kept

Measured 2026-09-22, so that none of them is removed later as unexplained noise.

**`verify`** — `npm run verify` on Node 24. In 30 runs it has succeeded 29 times and
failed none. It rarely catches the person who just ran verify locally, because it
tests the same configuration they did. It is kept because the release checklist in
[`docs/releases.md`](docs/releases.md) says to merge *after CI succeeds*, and without
a job that is a form of words — and because the contributor it does catch is the one
who did not run verify.

**`journal-node-floor`** — the same suite plus the committed CLI bundle on **Node 22**.
This is the only check testing something a maintainer's machine cannot. `decision-journal`
installs its CLI behind whatever `node` a user already has, down to major 22, so a
Node-24-only API reaching `packages/agent-journal/src` would pass everything else and
throw on the first machine that installed the skill. That is not hypothetical: it is how
the floor came to be 24 in the first place, unmeasured. The job's own comment in
[`verify.yml`](.github/workflows/verify.yml) carries the full reasoning.

**Blocks PR review** — **keep it.** It is deliberate, not leftover plumbing, and it earns
its place on a repository whose failure mode is prose drifting from the thing it
describes. Across pull requests #65 to #68 it posted ten observations, at least one on
each. Two, to show the class: a new test's `split()[1]` matched a fenced block anywhere
*after* the `## Usage Examples` heading rather than inside that section, and `--out`
with no argument threw a bare `TypeError` instead of printing usage. That is the point
rather than a disappointment — the severity-7 defects are what the suite is for, and the
ones below it are exactly the class [`.blocks/review.md`](.blocks/review.md) explains
this repository keeps producing.

It has failed a check exactly once, on #68, and that run is the argument for keeping it.
It found that the README's flat list ended `work-in-external-repo · handoff-prompt`
under a line reading "in the order they appear above", while the catalog placed
`handoff-prompt` first — and called it severity 7. On the next head it reported the same
defect at severity 5, so the check went green and #68 merged with the defect still in
it — an hour before this pull request was opened, which is where it was finally fixed.
Read that twice before trusting a severity number to decide anything: the grade moved,
the defect did not. That list now has a test, because a claim a document makes about
itself is checkable and should not have needed a reviewer twice. Five measured runs took
between 3m31s and 8m05s, which is the price of the copy-edit pass.

If any of these is ever dropped, say in the commit which of the three reasons above
stopped being true.

## Pull requests

- Keep each PR focused.
- Explain the end-user outcome and why the skill belongs in this catalog.
- Add or update documentation when changing repository policy or release behavior.
- Confirm all checked links are public and intentional.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).

For a vulnerability or accidental secret disclosure, do not open a public issue. Follow [SECURITY.md](SECURITY.md).
