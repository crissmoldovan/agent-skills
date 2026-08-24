---
name: agent-lifecycle
description: "Integrate live visibility for child-agent lifecycles."
version: 0.2.0
author: Criss, Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [agents, observability, lifecycle, orchestration]
    related_skills: []
---

# Agent Lifecycle Visibility

Use the v0.2.0 lifecycle contract to make delegated agents visibly and honestly
observable. The package implements schema-v1 validation, projection, JSONL
fallback safety, and a Hermes reconciliation adapter foundation. It does not
ship Hermes Desktop core integration, a task board, or native adoption of an
arbitrary foreign process.

## When to Use

- Adding live child-agent visibility to an orchestrator, desktop application,
  CLI, or web UI.
- Normalizing multiple child runtimes behind one lifecycle interface.
- Repairing missed events after reconnect, silence, or a host restart.
- Supporting a runtime that can emit JSON Lines but cannot provide callbacks.
- Integrating Hermes delegation observations through a host-owned adapter.

Don't use for task planning, Kanban/todo synchronization, or a one-time
post-run summary. Those concerns must not substitute for lifecycle telemetry.

## Prerequisites

- Allocate a stable `childId` for the child lifetime, a stable `source`, and a
  new `sourceEpoch` whenever a producer restarts its sequence space.
- Generate unique `eventId` values. Supply a non-negative per-child `sequence`
  only when the source can guarantee it within `(source, sourceEpoch, childId)`.
- Define lineage: `rootChildId`, attempt number, and whether the child is
  externally adopted. Preserve unknown capabilities rather than inferring them.
- Choose one lifecycle owner and one authoritative snapshot source.
- Load [the adapter contract](references/adapter-contract.md) before writing a
  runtime adapter. For routed children, also read the
  [model-routing relationship note](references/model-routing-migration.md).

## Lifecycle Model

Use exactly these states:

```text
created -> starting -> running <-> waiting -> completed | failed | cancelled | lost
```

The actual legal edges are `created -> starting|cancelled|failed|lost`,
`starting -> running|waiting|cancelled|failed|lost`, and from `running` or
`waiting` to their documented successors. `completed`, `failed`, `cancelled`,
and `lost` are terminal and immutable. `activity` and `heartbeat` refresh
information only; they never transition state.

Every schema-v1 event includes `schemaVersion: 1`, `eventId`, `source`,
`sourceEpoch`, `childId`, `lineage`, `kind`, and RFC3339 UTC `observedAt`.
Capabilities are explicit `known | unknown` values for history, heartbeat,
snapshot, cancel, and terminal cause. Set `external: true` and `adoptedAt` for
adoption; do not claim pre-adoption history or control authority.

## Procedure

1. **Normalize schema-v1 events.** Require canonical identity, lineage, kind,
   timestamp, and state rules before projection. Redact secrets in `details`.
   **Complete when:** invalid kinds/states/timestamps are rejected and omitted
   capabilities become `unknown` rather than optimistic defaults.

2. **Project ordered observations.** Deduplicate sequenced events by
   `(source, sourceEpoch, childId, sequence)` and non-sequenced events only by
   exact `eventId` content. Treat forward sequence gaps as provisional and old
   sequence values as out of order. **Complete when:** replay gives the same
   projection as live delivery while conflicts remain diagnosable.

3. **Publish activity and heartbeats separately.** Put current-work text in an
   `activity` event and liveness evidence in `heartbeat`; neither may invent a
   transition. **Complete when:** quiet but alive work remains distinguishable
   from a stopped child.

4. **Use stale before lost.** After the configured freshness deadline, mark a
   non-terminal child stale and request reconciliation. Mark it `lost` only if
   that corresponding reconciliation fails; terminal loss happens once.
   **Complete when:** one missed heartbeat never directly produces `lost`.

5. **Reconcile authoritative complete snapshots.** Require `complete: true`,
   `sourceEpoch`, `snapshotId`, coverage, and observed time. Correct only a
   non-terminal projection and retain an `authoritative_snapshot` audit entry;
   never revive a terminal record. **Complete when:** reconnect convergence is
   visible and each correction is inspectable.

6. **Handle omission only with proof and grace.** Do not conclude anything from
   an incomplete snapshot omitting a child. If an adapter can establish complete
   coverage, count consecutive complete misses and surface stale/unknown only
   after a documented grace threshold. **Complete when:** an intermittent or
   partial snapshot cannot silently complete or lose work.

7. **Use JSONL as a bounded fallback.** Emit one complete UTF-8 event per line;
   parse incrementally, retain valid surrounding records, and bound/redact
   malformed diagnostics. Journal appends use a cooperative atomic lock
   directory so concurrent calls and cooperating Node processes serialize;
   lock acquisition times out behind live owners and only reclaims old locks
   whose recorded PID is demonstrably dead. Programs that ignore the protocol
   remain unsupported. **Complete when:** malformed, oversized, and truncated
   lines do not mutate projection incorrectly.

8. **Integrate Hermes honestly.** Map documented Hermes delegation events and
   status snapshots through the adapter foundation. Request status at session
   open, reconnect, and a bounded periodic interval; coalesce overlapping
   fetches. **Complete when:** the host consumes its inputs/intents, applies
   complete-snapshot omission grace, and does not claim Hermes Desktop core UI
   integration is shipped.

9. **Render lifecycle truth, not proxy work state.** Drive visible state from
   the normalized projection; tasks and percent complete are auxiliary only.
   **Complete when:** removing all task-board data leaves lifecycle status
   correct.

## Quick Reference

- Event identity: `eventId`, or `(source, sourceEpoch, childId, sequence)`.
- Lineage: root/attempt/parent and adoption truth, not inferred ancestry.
- Activity: material current-work information; heartbeat: liveness only.
- Complete snapshot: authority to correct present non-terminal records.
- Audit: record every authoritative correction.
- Stale then lost: deadline first, failed reconciliation second.
- JSONL: bounded transport fallback with cooperative cross-process journal locking.
- Hermes: adapter foundation only; session-open/reconnect/periodic snapshots.

## Pitfalls

- **Todo/Kanban substitution:** task metadata can be missing or manually edited;
  it is never lifecycle authority.
- **Epoch blindness:** a producer restart can reuse a sequence number; scope
  sequence identity by `sourceEpoch`.
- **Snapshot overclaim:** incomplete coverage cannot establish absence.
- **Heartbeat as progress:** liveness does not prove useful work or success.
- **Terminal revival:** late event delivery and snapshots cannot rewrite a
  terminal outcome.
- **JSONL mixed with logs:** ordinary stdout logs make malformed diagnostics,
  not lifecycle events.
- **External-adoption overclaim:** PID presence does not provide history,
  intent, heartbeat, terminal cause, or cancellation authority.

## Verification

For Hermes routing/new-session rollout, also run the repository's
`docs/testing/hermes-new-session-matrix.md`: Opus and GPT, explicit and implicit
model selection, with and without routing profiles, plus safe routing-profile
removal. A configured or explicit runtime model without a routing profile is
still `UNPROFILED` and must not authorize delegation silently.

1. Apply a legal path through `created`, `starting`, `running`, `waiting`, and a
   terminal state; verify invalid transitions are rejected.
2. Deliver exact duplicates, identity conflicts, an out-of-order sequence, and
   a forward gap; verify their distinct results.
3. Stop heartbeats beyond the deadline; verify stale state appears before one
   failed reconciliation transitions the child to `lost`.
4. Reconcile a complete snapshot that changes a non-terminal state; verify the
   correction audit. Attempt to alter a terminal state; verify it is refused.
5. Feed valid JSONL around malformed, oversized, and truncated data; verify
   valid events remain and diagnostics are bounded/redacted.
6. For Hermes, verify snapshots run on session open, reconnect, and elapsed
   interval; verify incomplete omission does nothing and complete omission needs
   the configured grace count.

The integration is ready only when every result comes from lifecycle evidence,
not optimistic UI defaults or task-board metadata.
