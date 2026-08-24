# Generic Agent Skills harness adapter

Use this reference when the harness is Agent Skills-compatible but has no dedicated adapter here. It defines minimum safe behavior; do not invent flags, config locations, or model inventories.

## Discovery

1. Use the harness's documented model-listing mechanism to obtain addressable exact identifiers.
2. Use documented configuration/session APIs to determine whether profiles can be persisted and scoped.
3. Determine whether child delegation supports a per-child exact model argument and whether the child model can be observed after launch.
4. Check and load `agent-lifecycle` before starting children. If absent, offer installation with user approval; do not install it unprompted.

If discovery is unsupported, report that capability as unavailable rather than guessing.

## Dispatch mapping

- Bind the DRIVER to the user-selected exact model for reasoning and coordination.
- Start independent BUILDER children in parallel only with disjoint file/task ownership.
- Start a SWEEPER only for a deterministic, mechanically reviewable request.
- Carry exact model identifiers in prompts and result reports, while treating harness observation as stronger evidence than self-report.

Use native child-agent UI whenever it is available. Only if it is unavailable may the host render the fallback: when a lifecycle source exists, show one aggregate active display-only todo and individual DISPLAY ONLY child rows with ID, state, activity/tool, and freshness; the lifecycle projection is authoritative and row edits are ignored. When no lifecycle source exists, show no child rows and state exactly `Background work visibility unavailable; state unknown.` On reconnect, reconcile and rebuild these rows from the projection; retain terminal mappings literally (`completed`, `failed`, `cancelled`, `lost`).

## Persistent profiles

If profiles can persist, implement [profile controls](profile-controls.md): scope, auto-load, live revalidation, explicit confirmation for writes/deletes, and no silent remapping. If they cannot persist, support `use once` and report that setup/switching cannot survive the session.

## Degradation language

Use explicit statements such as “The harness cannot select a separate sweeper model; no SWEEPER is bound,” “This child launch accepts no model argument; selected BUILDER is not dispatched,” or “The harness exposes no post-launch model evidence; model use is unobserved.” Do not call these cases configured, dispatched, or observed merely because a profile contains a requested value.
