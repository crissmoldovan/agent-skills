# Portable child-lifecycle contract

**Status:** implemented schema-v1 contract in this repository; not an adopted external standard.

**Package status:** v0.2.0 private implementation foundation.

This contract is the minimum data needed to make a delegated child agent visible and recoverable across a parent session, terminal, desktop view, or external control plane. It does not define planning, assignment, billing, or vendor UI behavior.

## Canonical model

### States

```text
created | starting | running | waiting | completed | failed | cancelled | lost
```

`completed`, `failed`, `cancelled`, and `lost` are terminal and immutable. `waiting` means the child is alive but blocked on an explicit dependency; it is not generic idleness. The implementation validates the legal graph documented in the [Lifecycle API](../api/lifecycle-api.md#canonical-states-and-transitions).

### Events

A schema-v1 `LifecycleEvent` has a mandatory `schemaVersion: 1`, `eventId`, `source`, `sourceEpoch`, `childId`, lineage, kind, and UTC observation time. State transitions use `created`, `state_changed`, or `terminal`; material work and liveness use `activity` and `heartbeat`. `reconciliation` and `diagnostic` are reserved vocabulary for integration evidence.

`eventId` handles non-sequenced event identity. When a source can sequence a stream, the identity scope is `(source, sourceEpoch, childId, sequence)`. A restarted source must use a new `sourceEpoch`; otherwise an old and new counter can be confused.

### Lineage and capabilities

Every event carries:

```text
lineage = {
  rootChildId,
  attempt,
  external,
  parentChildId?,
  adoptedAt?
}
```

Lineage represents retries and adoption without rewriting a child’s identity. `external: true` requires an honest capability statement. Capabilities are `known | unknown` for history, heartbeat, snapshot, cancellation, and terminal cause. Unknown means unavailable or unverified, not false.

## Reliability requirements

A conforming integration combines:

1. **Live events** for responsive state and activity updates.
2. **Heartbeats** for liveness when meaningful activity is quiet.
3. **Authoritative complete snapshots** for reconnect and dropped-event correction.
4. **Append-only JSONL journals** for fallback transport, replay, and diagnosis.
5. **Immutable terminal states** so late messages and snapshots cannot rewrite outcomes.

Silence is never proof of completion. The implementation marks a non-terminal child stale first; it only becomes `lost` after the associated reconciliation fails.

## Snapshot authority and omission

A generic `AuthoritativeSnapshot` must be explicitly `complete: true`, carry `sourceEpoch` and `snapshotId`, and identify its coverage. It may correct a non-terminal projected state, producing an audit entry with reason `authoritative_snapshot`. It cannot revive or overwrite a terminal result.

Do not infer an outcome because a child is absent from an incomplete snapshot. A source-specific adapter may use omission only when it can prove complete coverage and should apply a grace policy before surfacing stale/unknown state.

## JSONL fallback

JSONL is a transport fallback, not a second lifecycle model. One complete UTF-8 line is one schema-v1 event. Consumers must parse incrementally, retain valid lines around malformed data, bound line and diagnostic size, redact sensitive content, and treat an incomplete final line as truncation rather than an event. Journal appends use an atomic per-path lock directory so cooperating Node processes serialize replay, sequence reservation, and append. The lock times out behind a live owner and reclaims only an old lock whose recorded PID is demonstrably dead. Programs that ignore the protocol remain unsupported.

## Adapter boundary

The contract provides observability and reconciliation; it does not cause a host product to render external work as a native child. Adapters must state what they directly observe, what durable evidence supports, and what remains unknown.

See [Live subagent visibility research](live-subagent-visibility.md), the [Lifecycle API](../api/lifecycle-api.md), and the [adapter contract](../../skills/agent-lifecycle/references/adapter-contract.md).
