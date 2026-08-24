# Adapter Contract (v0.2.0)

This is the runtime boundary for live child-agent visibility. Keep runtime SDK
objects, process handles, and UI-framework types outside this contract. It
matches the schema-v1 primitives implemented by this repository; it does not
create a native child in a host product.

## Required Types

Use equivalent names in the host language only if the semantics remain intact.

```text
ChildState =
  created | starting | running | waiting |
  completed | failed | cancelled | lost

Capability = known | unknown

Lineage {
  rootChildId: string
  attempt: non-negative integer
  external: boolean
  parentChildId?: string
  adoptedAt?: RFC3339 UTC timestamp
}

LifecycleEvent {
  schemaVersion: 1
  eventId: string
  source: string
  sourceEpoch: string
  childId: string
  lineage: Lineage
  kind: created | state_changed | activity | heartbeat |
        terminal | reconciliation | diagnostic
  state?: ChildState
  observedAt: RFC3339 UTC timestamp
  sequence?: non-negative integer
  activity?: string
  details?: JSON object
  capabilities: {
    history: Capability
    heartbeat: Capability
    snapshot: Capability
    cancel: Capability
    terminalCause: Capability
  }
}

AuthoritativeSnapshot {
  source: string
  sourceEpoch: string
  snapshotId: string
  observedAt: RFC3339 UTC timestamp
  complete: true
  coverage: all | child-id list
  children: [{ childId, state, sequence?, details? }]
}
```

`created`, `state_changed`, and `terminal` require a state. `created` is always
state `created`; `terminal` is one of `completed`, `failed`, `cancelled`, or
`lost`. `activity` and `heartbeat` do not carry state. `details` is additive;
it must not be the sole source of identity, ordering, state, or liveness.

## Adapter Interface

```text
interface ChildLifecycleAdapter {
  subscribe(onEvent: (event: LifecycleEvent) => void): Unsubscribe
  getSnapshot(reason: session_open | reconnect | periodic): AuthoritativeSnapshot
  cancel?(childId: string, reason?: string): CancelResult
}
```

- `subscribe` may use callbacks, streams, polling differences, or JSONL.
- `getSnapshot` is authoritative only if it declares complete coverage. An
  incomplete source view must be represented separately and cannot prove an
  omitted child absent.
- `cancel` is optional. Never synthesize it for an externally adopted child
  without documented, verified authority.
- The adapter must make its own health and source limitations observable.

## Projection Rules

1. Allocate one `childId` per lifecycle; retries use a new child ID and share
   `rootChildId` with an incremented attempt.
2. Deduplicate a sequenced event by `(source, sourceEpoch, childId, sequence)`.
   Without sequence, deduplicate only byte-equivalent `eventId` records.
3. Track high sequence per source epoch. A forward gap is provisional; an old
   sequence is out-of-order. A new source epoch permits a restarted counter.
4. Terminal states are immutable. A complete authoritative snapshot may correct
   a non-terminal projection and must emit an auditable correction; it cannot
   revive a terminal outcome.
5. Use activity for work context and heartbeat for liveness. A missed heartbeat
   marks stale only after the configured deadline.
6. Mark `lost` only after that stale child’s reconciliation attempt fails.
7. On reconnect, obtain a snapshot before trusting resumed incrementals where a
   gap cannot be ruled out.
8. Process snapshot omission only when complete coverage is proven. Use a
   consecutive-complete-miss grace policy before emitting stale/unknown intent.

## JSONL Fallback and Journal

One complete UTF-8 line is one event object. Producers flush complete lines and
do not mix ordinary logs into the lifecycle stream.

```json
{"schemaVersion":1,"eventId":"evt-7","source":"worker-cli","sourceEpoch":"start-2","childId":"child-42","lineage":{"rootChildId":"child-42","attempt":0,"external":false},"kind":"state_changed","state":"running","observedAt":"2026-08-24T09:15:30.000Z","sequence":7}
```

Consumers must incrementally buffer partial lines, cap line size, validate
before projection, and retain only bounded redacted diagnostics for malformed
input. EOF is not `completed`; reconcile or observe a runtime exit.

For an append-only journal, the reference implementation uses an atomic
per-path lock directory around replay, sequence reservation, and append.
Concurrent calls in one process serialize, and cooperating Node processes
exclude one another. Lock acquisition has a bounded timeout; stale reclamation
requires both the configured age and a recorded PID that is demonstrably dead,
and cleanup verifies the owner token. The journal becomes append-blocked if
replay detects malformed, oversized, truncated, or non-monotonic content.
This is cooperative advisory exclusion: programs that ignore the lock protocol
and filesystems without atomic directory operations remain unsupported.

## Hermes Adapter Foundation

The Hermes foundation maps delegation events and status snapshots into a
host-owned integration. It requests snapshots at session open, reconnect, and
periodically; overlapping requests coalesce. Complete Hermes snapshots may
correct records by child ID. An omitted locally-running child generates a
stale-unknown intent only after the configured consecutive complete-snapshot
grace (default two); incomplete snapshots never generate that intent.

This is not Hermes Desktop core integration. A host must supply source identity,
lineage, capabilities, event persistence, audit rendering, and any approved UI
integration.

## External Adoption Limits

| Observable | What may be stated |
| --- | --- |
| PID/process presence only | Process was observed; history, agent state, intent, and cancellation are unknown. |
| Process exit code | A process ended with that code; task success is not implied. |
| Runtime status endpoint | Exposed current state can be projected; missed history remains unknown. |
| Event stream plus complete snapshot | Visibility begins at adoption; pre-adoption history remains unknown unless supplied. |
| Verified control API | Cancellation may be offered within the documented authority scope. |

Always retain `external: true`, adoption time, source identity, and verified
capabilities. Never turn observation into a claim that the orchestrator created,
owns, or can safely terminate the child.
