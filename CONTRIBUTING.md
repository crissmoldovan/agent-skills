# Contributing

Thanks for helping build a safe, portable public catalog.

## Before adding a skill

This public catalog ships `model-routing`, `agent-lifecycle`, `blocks`,
`request-blocks-review`, `secure-credential-setup`, `derive-codebase-context`,
`publish-agent-skill`, `update-agent-skills`, `release-ledger`, `github-webhooks`,
`describe-changes`, `investigate-codebase`, `blast-area`, `visualise-blast-area`,
`land-complex-change`, `resolve-problem-report`, and `new-ux-discovery`. Routing
owns exact model selection and scoped intent; lifecycle owns evidence-backed child
visibility; Blocks owns GitHub-hosted review interaction and bounded status waits;
`derive-codebase-context` owns generated repository context and its CI gates;
`investigate-codebase` owns evidence-backed answers about a codebase; `blast-area`
owns what a proposed change would affect and `visualise-blast-area` owns drawing it;
`land-complex-change` owns the declared touch-set budget and the regression gate
ladder; `resolve-problem-report` owns the arc from a report to a resolution; and
`new-ux-discovery` owns gated UX opportunity discovery. A new skill must state which
of these it does not duplicate.

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
