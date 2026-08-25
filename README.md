<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/cue-logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/cue-logo-light.svg">
    <img alt="CUE++" src="assets/cue-logo-light.svg" width="176">
  </picture>
</p>

<h1 align="center">Agent skills pack</h1>

<p align="center">
  Eleven public, portable Agent Skills for agent operations, reviews, releases,
  codebase context, secure setup, and change delivery.
</p>

A public package by **Criss Moldovan**. Every skill is independently discoverable
under `skills/<name>/SKILL.md`, installable through Agent Skills-compatible
harnesses, and tested as part of one release catalogue.

## What is in the pack

| Skill | Description | Details |
|---|---|---|
| `model-routing` | Route work efficiently without lowering output quality. | [Skill](skills/model-routing/SKILL.md) · [Guide](docs/model-routing/index.md) |
| `agent-lifecycle` | Integrate live visibility for child-agent lifecycles. | [Skill](skills/agent-lifecycle/SKILL.md) · [Guide](docs/lifecycle/index.md) |
| `blocks` | Interact with Blocks sessions, status, and bounded waits. | [Skill](skills/blocks/SKILL.md) · [Guide](docs/blocks.md) |
| `request-blocks-review` | Run Blocks review/fix/re-review until a GitHub PR is clean. | [Skill](skills/request-blocks-review/SKILL.md) |
| `secure-credential-setup` | Place and verify secrets without exposing their values. | [Skill](skills/secure-credential-setup/SKILL.md) · [Terminal patterns](skills/secure-credential-setup/references/terminal-entry-patterns.md) |
| `derive-codebase-context` | Derive agent context, enforced boundaries, and an operational atlas from the repo itself. Use when agents keep losing the shape of a large codebase. | [Skill](skills/derive-codebase-context/SKILL.md) · [Runbook](skills/derive-codebase-context/references/onboarding.md) |
| `publish-agent-skill` | Publish an Agent Skill through a verified release. | [Skill](skills/publish-agent-skill/SKILL.md) |
| `update-agent-skills` | Update Agent Skills across every requested local plane. | [Skill](skills/update-agent-skills/SKILL.md) |
| `release-ledger` | Onboard a since-you-have-been-gone release ledger into any product: capture merged work, analyse and categorise it, and show each user what changed since they last looked. | [Skill](skills/release-ledger/SKILL.md) · [System model](skills/release-ledger/references/system-model.md) |
| `github-webhooks` | Adopt and manage GitHub webhook handling in an app: endpoint setup, signature verification, event routing, and a working reference for every event type you route. | [Skill](skills/github-webhooks/SKILL.md) · [Event types](skills/github-webhooks/references/event-types.md) |
| `describe-changes` | Document what a change actually did: analyse a commit, PR, or merge, classify it, and write short, medium, and detailed descriptions anchored to the diff. | [Skill](skills/describe-changes/SKILL.md) · [Output contract](skills/describe-changes/references/output-contract.md) |

The pack contains distinct procedures, not one monolithic workflow. Compose only
what the task needs. `model-routing` and `agent-lifecycle` cover economical,
observable delegation; `request-blocks-review` uses `blocks`; `release-ledger`
can compose with `github-webhooks` for capture and `describe-changes` for entries;
a target-specific private publisher/updater may fully override the generic public
workflow.

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

# Release-ledger capture and change descriptions
npx skills add crissmoldovan/agent-skills --skill release-ledger github-webhooks describe-changes
```

`--agent '*'` means every agent the installed CLI supports, not every agent that
exists. The CLI reports unsupported clients separately. Preserve the existing
copy/symlink form unless conversion is explicitly requested.

## Install — for agents and LLMs

```text
Install or update the eleven public skills from crissmoldovan/agent-skills.
Inventory project and global scopes in JSON first. Preserve source provenance,
managed/unmanaged ownership, copy/symlink form, and private namespaced plugin
skills. Install the requested scope for every supported agent, report unsupported
clients separately, then verify each installed path and source. Do not treat one
successful agent or scope as proof that all local libraries are current.
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
Use model-routing and agent-lifecycle for this task. Keep acceptance quality fixed,
route bounded implementation economically, and make every child visibly reconciled.
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

## Composition and references

- [`docs/composition.md`](docs/composition.md) — routing and lifecycle ownership.
- [`docs/blocks.md`](docs/blocks.md) — Blocks REST/GitHub separation.
- [`skills/release-ledger/references/system-model.md`](skills/release-ledger/references/system-model.md) — release-ledger system model.
- [`skills/github-webhooks/references/event-types.md`](skills/github-webhooks/references/event-types.md) — webhook event reference.
- [`skills/describe-changes/references/output-contract.md`](skills/describe-changes/references/output-contract.md) — change-description contract.
- [`docs/architecture.md`](docs/architecture.md) — catalogue architecture.
- [`docs/releases.md`](docs/releases.md) — release process and versioning.
- [`docs/public-content-policy.md`](docs/public-content-policy.md) — public/private boundary.

The [`routed-delegation` Hermes bundle](hermes-bundles/routed-delegation.yaml) is
a load-time helper for routing plus lifecycle. It does not install skills.

## Verify this repository

```bash
npm run verify
```

The command runs catalogue tests, skill validation, the lifecycle runtime suite,
TypeScript build, and package-consumer verification.

## License

[MIT](LICENSE)

---

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/cue-logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/cue-logo-light.svg">
    <img alt="CUE++" src="assets/cue-logo-light.svg" width="72">
  </picture>
  <br>
  <sub>Made by Criss Moldovan</sub>
</p>
