# Workspace Governance

Workspace Governance 0.3.0 gives terminal and local stdio MCP clients the same repository identity, context, planning and guarded workflow engine. The independently installed skill provides agent procedure and consent-based onboarding; neither CLI-only nor MCP-only operation requires the skill.

Start with the [portable skill](../../skills/workspace-governance/SKILL.md), [runtime installation and CLI guide](../../packages/workspace-governance/README.md), or the skill's [command reference](../../skills/workspace-governance/references/commands.md). Runtime and skill are version 0.3.0; their containing catalog release is 0.26.0. The runtime's distribution channel is the versioned GitHub Release, not npm registry publication. Check the actual release and immutable manifest anchor before installing.

## What it does

- Resolves repository identities and local bindings without requiring that existing checkouts move. Read-only discovery observes explicitly selected roots and fixed GitHub sources; incomplete coverage stays explicit.
- Resolves bounded context, rules, workflow definitions and provenance through the shared in-process engine.
- Produces inert, revision-bound plans for supported catalog and repository operations. Explicit apply verifies the exact approval and current state before performing effects. Workflow execution retains exact target, attempt, evidence and recovery contracts.
- Exposes typed local stdio MCP tools with read-only defaults. The MCP adapter accepts no arbitrary command, argv, environment or caller-selected configuration. Each instance uses one fixed configuration and capability set.
- Exports logical catalogs as digest-checked portable data. Machine-specific paths, state and authority do not travel; unresolved executable/reference dependencies must be rebound and trusted locally. Import is a reviewed plan, not an automatic merge.
- Bridges skill-first and CLI-first installation with explicit consent, pinned versions and verified installed bytes. Runtime and skill updates/removal remain separate, preserving governed data and unrelated components.

## Safety boundaries

A server capability, an exact domain approval and a human's permission are different things. `--allow-plans` enables inert plans; `--allow-apply` exposes effects whose operation bindings are still checked. The MCP host owns human permission prompts. An auto-allowing host deliberately grants the model effect authority. Registration guidance does not edit profiles or prove a connection.

The tool operates on the machine hosting the process. SSH uses existing user-controlled authentication and remote paths; it does not make the server operate on the client's local disk. No HTTP MCP listener, shared multi-tenant service, automatic disk synchronization or carried cross-machine execution authority is provided.

Runtime installation requires Node.js 24+, npm and POSIX tar; governed Git operations require Git. Linux and macOS are supported; WSL follows Linux requirements. Native Windows is outside the POSIX filesystem safety contract. Containers and SSH have the prerequisites and trusted paths of their own execution environment.

## Implementation and verification

The runtime lives under `packages/workspace-governance`. Its CLI and local MCP adapter share in-process operations rather than shelling out to a caller-authored command. The skill under `skills/workspace-governance` carries its own guidance and standalone installer; it never relies on an unpublished sibling checkout.

From the repository root, run `npm run verify` with Node 24+. The repository prepares and verifies its independent runtime packages without npm workspaces. Tests use synthetic repositories and isolated homes. The clean Linux/macOS consumer jobs receive a self-contained bundle and standalone helper rather than importing runtime code from a checkout. A candidate-bundle CI consumer is distinct from a post-release public-download check and from a personal-machine trial.

The [S1–S9 specification](specification.md) is retained as the historical v0.1 read-only contract; it is not the complete 0.3 feature or release specification. The current runtime guide, carried skill references, package contracts and executable tests document the subsequent guarded operations, portability and lifecycle surfaces. Private inventories and qualification logs are not public product artifacts.

## Installation and retention

Installing with `npx skills` installs the skill only. Its helper can install the pinned runtime after consent, or provide manual instructions. Starting with `workspacectl setup` offers the matching skill without requiring it. Ordinary read operations do not fetch installers.

Managed runtime installation records owned paths and bytes, refuses modified/unmanaged conflicts, and verifies a new version before switching an owned launcher. Retain the prior version for explicit rollback. Removal requires a preview and consent, revalidates ownership, and preserves configuration, catalogs, policies, plans, repositories and local state by default. Disconnect MCP clients before removing their runtime. No profile cleanup or component cascade is performed silently.
