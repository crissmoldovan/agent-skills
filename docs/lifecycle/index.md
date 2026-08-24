# Agent lifecycle

`agent-lifecycle` makes delegated children visibly and honestly observable. It does not choose models, replace model-routing profiles, create a Hermes Desktop core feature, or turn todos into lifecycle state.

## Lifecycle truth

Use lifecycle evidence rather than task metadata:

```text
created -> starting -> running <-> waiting -> completed | failed | cancelled | lost
```

Terminal states are immutable. Activity describes current work; heartbeat establishes liveness. Neither changes state. A child retry receives a new child ID, retains the root child ID, and increments its attempt.

Every event needs schema-v1 identity: `eventId`, `source`, `sourceEpoch`, `childId`, lineage, kind, UTC observation time, and explicit known/unknown capabilities. Sequence identity, where supported, is scoped to `(source, sourceEpoch, childId, sequence)`.

## Reconciliation and display

Request authoritative complete snapshots at session open, reconnect, and a bounded periodic interval. A complete snapshot may correct a non-terminal projection and must leave an audit entry. Incomplete omission proves nothing.

When a child stops reporting, mark it stale after the freshness deadline, reconcile it, and mark it `lost` only when that reconciliation fails. Never jump from one missed heartbeat to `lost`.

Render the normalized lifecycle projection separately from work plans. Prefer native child-agent UI. Only when that UI is unavailable, use this exact fallback contract:

- **A lifecycle source exists:** render one aggregate **active, display-only** todo plus individual **DISPLAY ONLY** child rows. Each row must show child ID, literal lifecycle state, activity or active tool, and freshness. The normalized lifecycle projection remains authoritative; ignore edits to all fallback rows.
- **No lifecycle source exists:** render no child rows and state exactly: `Background work visibility unavailable; state unknown.`

Terminal mappings are literal: `completed`, `failed`, `cancelled`, and `lost` stay terminal display states. Do not map a terminal lifecycle state to a successful, cancelled, or complete todo state. On reconnect, reconcile first and rebuild the aggregate and child rows from the normalized projection; never recover state from prior todo rows.

Do not imply that a percentage, final result, PID, or task checkbox is a live child state.

## Hermes status

The shipped lifecycle material describes a **Hermes adapter foundation**: host-owned mapping of documented delegation observations and status snapshots, including complete-snapshot omission grace. The shipped model-routing Hermes adapter is separate catalog tooling, documented in [`skills/model-routing/references/harness-hermes.md`](../../skills/model-routing/references/harness-hermes.md); it is not a Hermes profile primitive. Neither adapter is Hermes Desktop core integration, a task board, or native adoption of arbitrary foreign processes.

A host that does integrate it should use host-native Hermes UI for its own display and controls. It must keep lifecycle state sourced from the normalized projection, expose unavailable capabilities honestly, and not claim that a custom surface is a shipped Hermes Desktop feature.

## JSONL fallback

For runtimes without callbacks, write one complete UTF-8 schema-v1 event object per JSONL line. Consumers must incrementally buffer partial lines, validate before projection, cap malformed diagnostics, and retain valid surrounding records. EOF is not completion; reconcile or observe a runtime exit.

For the full composition boundary, return to [two-skill composition](../composition.md).
