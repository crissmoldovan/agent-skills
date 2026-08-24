# Hermes delegation reconciliation foundation (v0.2.0)

`src/hermes-delegation-reconciliation.ts` is an adapter foundation for translating Hermes delegation observations into a host-owned lifecycle integration. It is **not** a shipped Hermes Desktop core integration and does not modify Hermes’s native UI, registry, or session protocol.

## Native event normalization

`normalizeHermesDelegationEvent` maps documented delegation payload aliases into `HermesLifecycleInput`:

| Hermes event | Lifecycle input kind | State |
|---|---|---|
| `subagent.spawn_requested` | `created` | `created` |
| `subagent.start` | `state_changed` | `running` |
| `subagent.thinking`, `subagent.tool`, `subagent.tool.started`, `subagent.progress` | `activity` | `running` |
| `subagent.complete` | `state_changed` | normalized terminal or current status |

The normalizer accepts `child_id` or `subagent_id`, and `session_id` or `child_session_id`. It passes safe display context such as tool, activity/goal, parent ID, model, completion summary, duration, tokens, files, and output tail. Unknown events or statuses are rejected instead of guessed.

Status mapping is:

```text
pending -> created
starting -> starting
active | running -> running
waiting -> waiting
completed | failed | cancelled -> same value
```

## Snapshot reconciliation

`reconcileHermesDelegationStatus(snapshot, current, options)` compares status records by `childId` and returns:

- `inputs`: snapshot-derived lifecycle inputs where a projected record is new or materially differs.
- `correct_projection` intents for an authoritative status change, tagged `authoritative_snapshot`.
- `mark_stale_unknown` intents only for a locally non-terminal child omitted from sufficient **complete** snapshots.

An incomplete status snapshot can update entries that it contains but must not cause an omitted child to be completed, lost, or stale. For complete snapshots, omission uses `missingGraceSnapshots` (default `2`): the adapter emits a stale-unknown intent only after that many consecutive complete misses. A host decides how to render or route that uncertainty; it must not silently synthesize completion.

## Reconciliation scheduling

`createHermesDelegationReconciler` wraps a host `fetchStatus` function. It fetches snapshots:

1. when a session opens (`sessionOpened()`),
2. after reconnect (`reconnected()`), and
3. at a host-selected elapsed interval (`reconcileIfDue()`).

Overlapping requests are coalesced into one in-flight fetch. The reconciler retains complete-snapshot omission counts across runs and calls `onReconciled` with inputs and intents. `intervalMs` must be a positive finite value.

## Host integration boundary

A host using this foundation should:

1. Translate `HermesLifecycleInput` into schema-v1 events with its own `eventId`, `source`, `sourceEpoch`, lineage, and capabilities.
2. Feed those events to `LifecycleProjector` and persist them through a journal when durable replay is required.
3. Treat `correct_projection` as an audited authoritative correction.
4. Treat `mark_stale_unknown` as a request to surface uncertainty and/or perform further source-specific reconciliation, not as a terminal outcome.
5. Keep native Hermes UI ownership separate unless a reviewed Hermes integration explicitly provides that path.

The foundation does not infer unavailable features such as historical event coverage, heartbeat reliability, cancellation authority, or terminal cause. Expose them as `unknown` unless the host verifies them.

For the generic schema and journal behavior, see the [Lifecycle API](lifecycle-api.md).
