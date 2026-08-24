# Lifecycle API (v0.2.0)

This document describes the implementation exported by `src/index.ts`. It is a schema-v1 contract for a consumer that projects child lifecycle state. It is not a hosted protocol or a claim of native UI integration in any harness.

## Canonical states and transitions

`ChildState` is exactly:

```text
created | starting | running | waiting | completed | failed | cancelled | lost
```

Legal transitions are:

```text
created  -> starting | cancelled | failed | lost
starting -> running  | waiting | cancelled | failed | lost
running  -> waiting  | completed | failed | cancelled | lost
waiting  -> running  | completed | failed | cancelled | lost
```

`completed`, `failed`, `cancelled`, and `lost` are terminal and immutable. `activity` and `heartbeat` update freshness only; neither performs a state transition.

## Event schema

`normalizeLifecycleEvent(value)` accepts only schema version 1 and returns a normalized `LifecycleEvent`.

```ts
interface LifecycleEvent {
  schemaVersion: 1;
  eventId: string;
  source: string;
  sourceEpoch: string;
  childId: string;
  lineage: {
    rootChildId: string;
    attempt: number;
    external: boolean;
    parentChildId?: string;
    adoptedAt?: string; // RFC3339 UTC
  };
  kind: 'created' | 'state_changed' | 'activity' | 'heartbeat' |
    'terminal' | 'reconciliation' | 'diagnostic';
  state?: ChildState;
  observedAt: string; // RFC3339 UTC
  sequence?: number;
  activity?: string;
  details?: Record<string, unknown>;
  capabilities?: {
    history: 'known' | 'unknown';
    heartbeat: 'known' | 'unknown';
    snapshot: 'known' | 'unknown';
    cancel: 'known' | 'unknown';
    terminalCause: 'known' | 'unknown';
  };
}
```

`created`, `state_changed`, and `terminal` require `state`; other kinds forbid it. A `created` event must carry `state: 'created'`, and `terminal` must carry a terminal state. Timestamps must be RFC3339 UTC in the form accepted by the normalizer. Omitted capabilities normalize conservatively to `unknown`.

`details` is JSON data; values under keys matching secret, token, password, authorization, or cookie are redacted before projection.

### Identity, epoch, and sequence

- `eventId` distinguishes non-sequenced events. An exact duplicate is deduplicated; the same identity with different normalized content is a conflict.
- A sequenced event is identified by `(source, sourceEpoch, childId, sequence)`. `sourceEpoch` prevents a restarted source’s sequence counter from being mistaken for an old stream.
- The projector tracks the highest sequence per `(source, sourceEpoch, childId)`. Older sequenced events are reported as deduplicated/out-of-order; a forward gap is accepted provisionally and marked `gapDetected`.
- Projection records are keyed by `(source, childId)`, so an epoch transition can continue a child’s current projection while retaining epoch-scoped ordering.

### Lineage and capabilities

`lineage.rootChildId` identifies the root of a retry/delegation tree; `attempt` distinguishes attempts. Set `external: true` and `adoptedAt` when the child was adopted rather than created by the orchestrator. Capabilities state what the source can actually establish. Unknown is not false: it means the adapter cannot truthfully assert the feature.

## Projecting, freshness, and loss

`LifecycleProjector` applies normalized events and returns an `ApplyResult` with status `applied`, `provisional`, `deduplicated`, `conflict`, `stale`, or `terminal_immutable`.

A `ProgressSnapshot` retains canonical state, lineage, capabilities, sequence, latest activity, latest heartbeat, and `stale`/`gapDetected` markers. The stale timer uses the most recent heartbeat if present, otherwise the most recent observed event.

Call `markStale(now)` after the configured inactivity interval (default 120 seconds). It marks a non-terminal child stale and schedules reconciliation; it does **not** declare loss. Call `reconciliationFailed(source, childId, now)` only after the corresponding reconciliation attempt fails. That one eligible stale child becomes `lost`; a second call is terminal-immutable. Silence alone is never completion or loss.

## Authoritative snapshots and audit

`reconcile(snapshot)` accepts an `AuthoritativeSnapshot` only when it is explicitly complete and identity-qualified:

```ts
interface AuthoritativeSnapshot {
  source: string;
  sourceEpoch: string;
  snapshotId: string;
  observedAt: string;
  complete: true;
  coverage: 'all' | readonly string[];
  children: readonly {
    childId: string;
    state: ChildState;
    sequence?: number;
    details?: Record<string, unknown>;
  }[];
}
```

For children present in the snapshot, a changed non-terminal projection is corrected and returned in `audit` with `reason: 'authoritative_snapshot'`. A snapshot cannot revive or rewrite a terminal state; the reconcile result instead includes `terminal_immutable` diagnostics. The current implementation corrects entries that the snapshot includes; omission handling belongs to an adapter that can establish complete coverage.

## JSONL transport and journal

`JsonlLifecycleParser` is an incremental UTF-8 JSON Lines parser. Call `push(bytes)` repeatedly and `end()` at EOF. It preserves valid preceding records and adds bounded diagnostics for malformed, oversized, and truncated lines. Diagnostic raw text is redacted and bounded; ordinary logs must not share the lifecycle stream.

`JsonlLifecycleJournal(path)` provides an append-only fallback journal:

- Each `append` acquires an atomic per-path lock directory, replays the journal, and assigns an increasing `journalSequence` while holding that lock.
- Concurrent callers in one process serialize, and cooperating Node processes using this journal API exclude one another through the filesystem lock.
- A final truncated line is tolerated during replay; malformed or oversized non-final input is an integrity failure and blocks all later appends.
- Lock acquisition has a bounded timeout. A stale lock is reclaimed only when it exceeds the configured age and its recorded PID is demonstrably dead; token-checked cleanup prevents an old holder from deleting a replacement lock.
- This is cooperative advisory exclusion, not protection against unrelated programs that ignore the lock protocol, hostile writers, or filesystems whose directory creation/rename semantics are not atomic.

## Example: project and reconcile a child

```ts
import { LifecycleProjector } from '@crissmoldovan/agent-lifecycle';

const projector = new LifecycleProjector({ staleAfterMs: 120_000 });
const capabilities = {
  history: 'known', heartbeat: 'known', snapshot: 'known',
  cancel: 'unknown', terminalCause: 'unknown',
} as const;
const lineage = { rootChildId: 'child-42', attempt: 0, external: false };

projector.apply({
  schemaVersion: 1,
  eventId: 'evt-1',
  source: 'worker-cli',
  sourceEpoch: 'worker-start-7',
  childId: 'child-42',
  lineage,
  kind: 'created',
  state: 'created',
  observedAt: '2026-08-24T09:00:00.000Z',
  sequence: 1,
  capabilities,
});

projector.apply({
  schemaVersion: 1,
  eventId: 'evt-2',
  source: 'worker-cli',
  sourceEpoch: 'worker-start-7',
  childId: 'child-42',
  lineage,
  kind: 'state_changed',
  state: 'starting',
  observedAt: '2026-08-24T09:00:01.000Z',
  sequence: 2,
  capabilities,
});

const result = projector.reconcile({
  source: 'worker-cli',
  sourceEpoch: 'worker-start-7',
  snapshotId: 'snapshot-18',
  observedAt: '2026-08-24T09:00:10.000Z',
  complete: true,
  coverage: 'all',
  children: [{ childId: 'child-42', state: 'running', sequence: 3 }],
});

// result.audit records the starting -> running authoritative correction.
```

See also the [Hermes delegation adapter foundation](hermes-delegation-reconciliation.md) and the [adapter contract](../../skills/agent-lifecycle/references/adapter-contract.md).
