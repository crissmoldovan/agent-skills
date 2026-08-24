# Hermes Agent adapter

Hermes Agent configuration and UI evolve independently of this skill. Consult current Hermes Agent documentation and the `hermes-agent` skill before using Hermes-specific commands or claiming a configuration capability.

## Required pre-delegation check

Before delegating child work, locate and load `agent-lifecycle`. It remains responsible for stable child identity, activity, heartbeats, snapshots/reconciliation, and lifecycle truth. If missing, offer installation and wait for user approval; do not replace it with todos, a task board, or a post-run summary.

Prefer Hermes's native lifecycle/child-agent UI. Only if it is unavailable may a fallback be rendered. If a lifecycle source exists, render one aggregate **active, display-only** todo and individual **DISPLAY ONLY** child rows with child ID, literal state, activity or active tool, and freshness; the normalized lifecycle projection is authoritative and edits to those rows are ignored. If no lifecycle source exists, render no child rows and state exactly `Background work visibility unavailable; state unknown.` On reconnect, obtain reconciliation and rebuild the fallback from the projection. Preserve `completed`, `failed`, `cancelled`, and `lost` as literal terminal mappings; never map them to todo completion or cancellation.

## Model-routing capability and degradation

Hermes has two relevant live bindings:

- **DRIVER** uses the session's main model: `model.provider` and `model.default`.
- **BUILDER** uses Hermes's one delegated-child binding: `delegation.provider` and `delegation.model`. Every delegated child uses this same binding; Hermes does not expose separate child bindings per child or per role.
- **SWEEPER** has no independently addressable Hermes binding. Fold it into BUILDER (`fold-builder`) or do its work inline with DRIVER (`inline-driver`). Report that role as degraded, including the chosen mode.

Do not state that one child binding prevents distinct DRIVER and BUILDER selection: they are distinct session and delegation controls. Do not claim separately dispatchable child models beyond the single BUILDER binding.

For display, keep provider and model as separate fields. In particular, do **not** concatenate them into a synthetic `provider/model` identifier: gateway providers such as `routera` can select an exact ID such as `openai/gpt-5.6-terra`, where `routera/openai/gpt-5.6-terra` is false.

## Shipped Hermes routing adapter

This catalog ships a Hermes-specific adapter layer, not a Hermes profile primitive. When Hermes's native routing UI is not the applicable control surface, use the repository's [`hermes-routing.mjs`](../scripts/hermes-routing.mjs) adapter script. It is catalog adapter tooling that reads and applies the catalog's scoped routing intent through documented Hermes configuration; it does not add a native Hermes profile type or claim a Desktop-core feature.

Use the script only after checking its documented interface and actual output. The adapter reads `$HERMES_HOME/provider_models_cache.json` safely; it never calls the nonexistent `hermes models list --json` command and never reads credentials. It validates the exact selected model ID across all cached provider catalogs, while preserving the configured provider in its own binding field. This supports gateway providers whose model ID is listed under another cached catalog.

Before applying host bindings, capture all four host values (`model.provider`, `model.default`, `delegation.provider`, and `delegation.model`) in a receipt. Apply and read back every value; if any write or readback fails, roll back every changed key. A reset restores that receipt and clears active routing intent; it never deletes all saved profiles. Live inventory validation and host binding remain Hermes-adapter responsibilities.

At session start, auto-load the most-specific matching saved profile, validate exact identifiers against Hermes's cached live inventory, and surface invalid or unsupported bindings before child dispatch. Never silently fall back to the session default.

## Reporting

For each role, label the outcome selected, configured, dispatched, observed, invalid, or degraded as defined in [profile controls](profile-controls.md). A selected profile value is not proof Hermes sent that model to a child; read live child metadata or lifecycle evidence before claiming observed use.
