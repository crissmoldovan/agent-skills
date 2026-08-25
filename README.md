<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/cue-logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/cue-logo-light.svg">
    <img alt="CUE++" src="assets/cue-logo-light.svg" width="176">
  </picture>
</p>

<h1 align="center">Agent skills pack</h1>

<p align="center">
  Eight public, portable Agent Skills for routing, lifecycle visibility, Blocks
  reviews, secure credentials, codebase context, and verified skill releases.
</p>

A public package by **Criss Moldovan**. Every skill is independently discoverable
under `skills/<name>/SKILL.md`, installable through Agent Skills-compatible
harnesses, and tested as part of one release catalogue.

## What is in the pack

| Skill | What it owns | Details |
|---|---|---|
| `model-routing` | Route work efficiently without lowering output quality. | [Skill](skills/model-routing/SKILL.md) · [Guide](docs/model-routing/index.md) |
| `agent-lifecycle` | Integrate live visibility for child-agent lifecycles. | [Skill](skills/agent-lifecycle/SKILL.md) · [Guide](docs/lifecycle/index.md) |
| `blocks` | Interact with Blocks sessions, status, and bounded waits. | [Skill](skills/blocks/SKILL.md) · [Guide](docs/blocks.md) |
| `request-blocks-review` | Run Blocks review/fix/re-review until a GitHub PR is clean. | [Skill](skills/request-blocks-review/SKILL.md) |
| `secure-credential-setup` | Place and verify secrets without exposing their values. | [Skill](skills/secure-credential-setup/SKILL.md) · [Terminal patterns](skills/secure-credential-setup/references/terminal-entry-patterns.md) |
| `derive-codebase-context` | Derive agent context, enforced boundaries, and an operational atlas from the repo itself. Use when agents keep losing the shape of a large codebase. | [Skill](skills/derive-codebase-context/SKILL.md) · [Runbook](skills/derive-codebase-context/references/onboarding.md) |
| `publish-agent-skill` | Publish an Agent Skill through a verified release. | [Skill](skills/publish-agent-skill/SKILL.md) |
| `update-agent-skills` | Update Agent Skills across every requested local plane. | [Skill](skills/update-agent-skills/SKILL.md) |

The pack contains distinct procedures, not one monolithic workflow. Use one skill
on its own or compose the relevant ones. For example, `model-routing` chooses work
ownership while `agent-lifecycle` exposes child truth; `request-blocks-review`
uses `blocks`; a target-specific private publishing skill may fully override the
generic `publish-agent-skill` workflow.

## Install — for humans

Install the complete pack for the current project:

```bash
npx skills add crissmoldovan/agent-skills
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

# Verified Agent Skill publication
npx skills add crissmoldovan/agent-skills --skill publish-agent-skill

# Changelog/README/release communication plus all-plane updates
npx skills add crissmoldovan/agent-skills --skill update-agent-skills
```

`--agent '*'` means every agent the installed CLI supports, not every agent that
exists. The CLI reports unsupported clients separately. Use `--copy` only when a
copied installation is intentional; otherwise preserve the existing
copy/symlink form.

## Install — for agents and LLMs

Give an agent with terminal access this prompt:

```text
Install or update the eight public skills from crissmoldovan/agent-skills.
Inventory project and global scopes in JSON first. Preserve source provenance,
managed/unmanaged ownership, copy/symlink form, and private namespaced plugin
skills. Install the requested scope for every supported agent, report unsupported
clients separately, then verify each installed path and source. Do not treat one
successful agent or scope as proof that all local libraries are current.
```

The agent should preview destructive replacement when a stale directory has no
managed provenance. It must not remove a private namespaced skill merely because
a public standalone skill has the same bare name.

## Update the pack

Inventory before updating:

```bash
# Project scope (the default scope for list)
npx skills list --json

# User/global scope
npx skills list --global --json
```

Update CLI-managed skills at an explicit scope:

```bash
# All managed project skills
npx skills update --project --yes

# All managed global skills
npx skills update --global --yes

# Named skills only
npx skills update model-routing agent-lifecycle --global --yes
```

For a missing global projection across all supported agents, install from the
canonical source rather than fabricating agent-specific directories:

```bash
npx skills add crissmoldovan/agent-skills --skill '*' --global --agent '*' --yes
```

### All-plane update contract

An honest “updated locally” claim covers each requested plane independently:

| Plane | Update rule | Required proof |
|---|---|---|
| Project-scoped Skills CLI | `npx skills update … --project --yes` from the exact project | project inventory, provenance, consuming agent path/precedence |
| Global Skills CLI | `npx skills update … --global --yes` | global inventory and every requested supported-agent projection |
| Copied vs symlinked | Preserve the current form unless the user requests conversion | installed path/form and published-byte comparison where no version exists |
| Unmanaged/provenance-less | Ask before removing only that identity and reinstalling from the canonical source | old path accounted for; new source and bytes verified |
| Native plugin/package | Use its marketplace or registry updater, not the generic CLI | exact native version, namespace, install path, and bytes |
| Manual upload/raw file | Replace the released artifact through the owning UI/channel | artifact verified; otherwise `manual action required` |
| Remote machine/container | Treat as another explicitly named target | independent readback on that target |
| Unsupported client | Do not invent a destination | literal `unsupported` or `deferred` outcome |

Restart or reload an affected agent when its skill loader caches installed files.
A current conversation may continue using the old skill until a new session.

## Use the skills

Ask naturally or invoke the name in the syntax your harness supports.

```text
Use model-routing and agent-lifecycle for this task. Keep acceptance quality
fixed, route bounded implementation economically, and make every child visibly
reconciled.
```

```text
Use request-blocks-review on this finished PR. Keep the wait visible, fix accepted
findings, rerun verification, and request current-head re-review until clean.
```

```text
Use secure-credential-setup. Ask for one credential at the exact gate, give me a
hidden terminal-entry command, and verify authentication without printing any
part of the value.
```

```text
Use derive-codebase-context. Reuse what exists, derive only missing context,
boundaries, and atlas layers, and mutation-test every new enforcement gate.
```

```text
Use publish-agent-skill for the current repository. Verify release, discovery,
and provenance. Synchronize real local libraries only if I explicitly name the
scope, agents, machines, plugin, or manual channel.
```

```text
Use update-agent-skills. Make the changelog, catalogue README, release notes, and
agent update guidance agree with the published release; then update only the
local scopes and channels I explicitly named and report every plane separately.
```

## Composition and boundaries

- [`docs/composition.md`](docs/composition.md) — routing and lifecycle ownership.
- [`docs/blocks.md`](docs/blocks.md) — Blocks REST/GitHub separation and bounded waits.
- [`docs/architecture.md`](docs/architecture.md) — catalogue/discovery architecture.
- [`docs/releases.md`](docs/releases.md) — release process and versioning.
- [`docs/public-content-policy.md`](docs/public-content-policy.md) — public/private boundary.

The [`routed-delegation` Hermes bundle](hermes-bundles/routed-delegation.yaml) is
a load-time helper for routing plus lifecycle. It does not install skills or add a
separate coordinator skill.

## Verify this repository

```bash
npm run verify
```

The command runs catalogue tests, skill validation, the complete lifecycle
runtime suite, TypeScript build, and package-consumer verification.

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
