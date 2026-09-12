# Contributing

Thanks for helping build a safe, portable public catalog.

## Before adding a skill

This public catalog ships `model-routing`, `agent-lifecycle`, `blocks`,
`request-blocks-review`, `secure-credential-setup`, `derive-codebase-context`,
`publish-agent-skill`, `update-agent-skills`, `release-ledger`, `github-webhooks`,
`describe-changes`, `investigate-codebase`, `blast-area`,
`land-complex-change`, `resolve-problem-report`, `new-ux-discovery`,
`decision-journal`, `delphi-imagine`, `workspace-governance`,
`report-progress`, and `work-in-external-repo` — twenty-one in all. Routing
owns exact model selection and scoped intent; lifecycle owns evidence-backed child
visibility; Blocks owns GitHub-hosted review interaction and bounded status waits;
`derive-codebase-context` owns generated repository context and its CI gates;
`investigate-codebase` owns evidence-backed answers about a codebase; `blast-area`
owns what a proposed change would affect and the drawing of it;
`land-complex-change` owns the declared touch-set budget and the regression gate
ladder; `resolve-problem-report` owns the arc from a report to a resolution;
`new-ux-discovery` owns gated UX opportunity discovery; `decision-journal` owns the
record of why a decision was made; `delphi-imagine` owns the verified-facts briefing
and the perspective review built on it; `workspace-governance`
owns declared-catalog placement and inherited policy; `report-progress` owns the
shape of what a reader is told while long work runs; and `work-in-external-repo`
owns which repository a change belongs in and the tree it happens in. A new skill
must state which of these it does not duplicate.

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

## Adapters and hooks

`adapters/` holds harness-specific code that runs outside the conversation — today
the Claude Code journal hook and the `report-progress` gate. None of it is a skill:
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
`test/freshness-hook-install.test.mjs`) or from the package they feed
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
the same command. The workspace-governance runtime has no runtime dependencies.

Workspace governance owns declared catalog/policy, read-only discovery and
non-executable placement previews, not routing, lifecycle or repository mutation.
Its library, CLI and schemas live in `packages/workspace-governance`; its skill
carries only portable instructions and internal relative references. Do not put
machine inventories in the public tree. See its
[architecture and acceptance map](docs/workspace-governance/index.md). The package
is private/unpublished; packaging tests do not authorize a release, global install
or live agent update.

## Pull requests

- Keep each PR focused.
- Explain the end-user outcome and why the skill belongs in this catalog.
- Add or update documentation when changing repository policy or release behavior.
- Confirm all checked links are public and intentional.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).

For a vulnerability or accidental secret disclosure, do not open a public issue. Follow [SECURITY.md](SECURITY.md).
