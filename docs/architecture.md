# Architecture

## Purpose

`agent-skills` is a public, standards-first monorepo for portable agent skills. It separates catalog structure and validation from the skill content shipped by the public catalog.

## Discovery contract

The only supported discovery location is:

```text
skills/<name>/SKILL.md
```

`<name>` is the skill's stable identifier. Its `SKILL.md` frontmatter must declare the same `name`. The repository must not contain a root-level `SKILL.md`; that layout can make generic skill installers stop discovery early and ignore nested skills.

## Catalog boundary

The public product started with exactly two planned skills:

- `model-routing`: token-efficient, quality-preserving work routing with exact model bindings.
- `agent-lifecycle`: automatic delegated-work visibility.

No further skill belongs in the catalog without a deliberate product decision. The catalog
now ships twenty-three skills, each admitted by such a decision and each recorded in the
repository README and in [releases](releases.md).

## Verification boundary

`scripts/verify-skills.mjs` is dependency-free and is run locally and in CI. It enforces discovery structure, minimal frontmatter, local-link containment, carried-file existence for every bare `references/`, `scripts/`, or `assets/` token, a 484-line cap on the `SKILL.md` body so detail lives in carried files, likely-secret detection, and local absolute-path detection. It intentionally does not claim to prove that content is safe; human review and the [public-content policy](public-content-policy.md) remain required.

## Adapters and hooks

`adapters/` is not part of the catalog. Nothing in it is discovered as a skill, nothing in it
is installed by `npx skills add`, and `scripts/verify-skills.mjs` does not look at it — it
validates `skills/` only. What lives there is harness-specific glue: code that runs outside
the conversation, in a hook the user wired into their own harness.

- `adapters/claude-code/journal-hook.{sh,mjs}` translates Claude Code's hook payloads into
  `agent-journal observe` calls, with two opt-in authoring floors that speak back into the
  session. Its tests live with the package it feeds
  (`packages/agent-journal/test/adapter-claude-code.test.ts`).
- `adapters/claude-code/report-progress-gate.mjs` is the mechanical half of the
  `report-progress` skill: a `PostToolUse` marker writer plus a `Stop` hook that can hold a
  turn open when a report is owed and missing, installed and removed by
  `install-report-progress-gate.mjs`. It is covered by `test/report-progress-gate.test.mjs`.
- `adapters/codex/` is built from Codex's published documentation and has never run against a
  real Codex session. It says so at the top of its own README and must keep saying so until
  someone captures a real payload.

The freshness `SessionStart` hook is the exception to the directory: it is carried inside
`skills/update-agent-skills/scripts/`, because an installed skill has to be able to offer it.

Three rules hold for anything here:

1. **Observed, not assumed.** Every claim about a payload shape, an event name or an output
   channel is anchored to a capture in [`adapters/NOTES.md`](../adapters/NOTES.md) or
   [`adapters/HOOK-OUTPUT-NOTES.md`](../adapters/HOOK-OUTPUT-NOTES.md). Those files outrank
   every README in the repository, including this one.
2. **An exit code is not a delivery channel.** The same number means different things on
   different events: a synchronous `SessionStart` hook that exits 2 discards the stdout an
   exit 0 would have delivered, and an asynchronous one delivers nothing on exit 0. A hook
   that has something to say prints the words.
3. **Off until a human arms it.** A hook that can end a turn, speak into a session or mutate
   an installation is installed by the user running its installer, never by a skill and never
   by an agent acting on a skill's instructions.

## Automation

GitHub Actions runs the same verifier using Node.js 24. Dependabot maintains GitHub Actions updates. CODEOWNERS routes changes in policy, automation, and skill content to maintainers.

## Future architecture

The planned bridge from the private skills control plane to this public
delivery repository is documented in the [roadmap](roadmap.md). The public
repository remains independently installable and contains no private team state.
