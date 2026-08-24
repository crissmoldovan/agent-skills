# Hermes Agent harness

Use this guide when the two-skill composition runs on Hermes Agent. It documents the current composition contract; it does not claim that Hermes Desktop core ships this catalog's lifecycle UI.

## Bindings and exact models

Hermes has one session-driver binding and one delegated-child binding. Read live state before applying changes:

```bash
hermes config get model
hermes config get delegation --json
hermes model
```

After user confirmation, set explicit values and read them back:

```bash
hermes config set model <exact-driver-slug>
hermes config set delegation.provider <provider>
hermes config set delegation.model <exact-builder-slug>
```

`delegate_task` does not accept a per-call model override. Therefore all delegated BUILDER work—and any delegated SWEEPER work—uses the one child binding. An empty `delegation.model` means unbound/inherits driver, not a selected builder.

Examples such as `openai/gpt-5.6-sol` and `openai/gpt-5.6-terra` are illustrative only. Inventory live identifiers and retain the user's chosen exact strings.

## Profile and dispatch flow

1. Read the scoped v2 profile for this Hermes/workspace context.
2. If it is unprofiled, ask for exact DRIVER and BUILDER identifiers plus an explicit SWEEPER mode. Do not delegate first.
3. Show the complete profile and host bindings; get confirmation before writing host configuration.
4. Apply, read back, then dispatch a self-contained task.
5. At each phase boundary, independently verify work rather than relying on a child report.

A no-write probe can test only the currently configured child binding. Testing a selected-but-unapplied model requires an explicitly approved temporary apply, probe, and exact restoration.

## Lifecycle visibility in Hermes

Before dispatching an observable child, load `agent-lifecycle`. Use the host's native delegated-child UI and status facilities when they exist, then reconcile with the adapter's authoritative snapshot contract at session open, reconnect, and periodically. Local delegation logs are recovery/debug evidence, not a lifecycle UI or todo board.

When native lifecycle evidence is unavailable, disclose the degradation. Do not present todos as child status; use the fallback in the [lifecycle guide](../lifecycle/index.md).

## Skill availability

For user-scope installation, Hermes scans `$HERMES_HOME/skills/<category>/<skill>/` (by default under `~/.hermes/skills/`). Project-scoped skills require explicit trust via `hermes skills trust <root>` before Hermes scans `.hermes/skills/` or `.agents/skills/`.

Use `hermes skills list` or `skills_list` to establish availability. A bundle can load installed skills into a workflow, but it cannot install missing dependencies. If either of this composition's skills is absent, follow the [missing-dependency behavior](../composition.md#when-a-dependency-is-missing) instead of silently substituting another skill.
