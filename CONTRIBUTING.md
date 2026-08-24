# Contributing

Thanks for helping build a safe, portable public catalog.

## Before adding a skill

This public catalog ships exactly two skills: `model-routing` and `agent-lifecycle`. They compose intentionally, but remain separate: routing owns exact model selection and scoped intent; lifecycle owns evidence-backed child visibility. Do not add a third skill without maintainer approval.

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

The command is dependency-free and must pass before opening a pull request. CI runs the same command.

## Pull requests

- Keep each PR focused.
- Explain the end-user outcome and why the skill belongs in this catalog.
- Add or update documentation when changing repository policy or release behavior.
- Confirm all checked links are public and intentional.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).

For a vulnerability or accidental secret disclosure, do not open a public issue. Follow [SECURITY.md](SECURITY.md).
