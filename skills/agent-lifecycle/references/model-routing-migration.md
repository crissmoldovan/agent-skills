# Relationship and Migration Note: Model Routing

`agent-lifecycle` complements `model-routing`; it does not select models,
change routing-profile ownership, or replace phase-boundary verification.
`model-routing` decides **which child to dispatch** and with which exact model.
`agent-lifecycle` defines **how that dispatched child is observed and reconciled**.

## Load Order

For delegated work that needs live child visibility:

1. Load `model-routing` to select exact role bindings and establish dispatch
   ownership.
2. Load `agent-lifecycle` before launch to establish `childId`, source/source
   epoch, lineage, capability truth, and event/snapshot transport.
3. Dispatch only when the host can publish lifecycle evidence or explicitly
   report the unavailable capabilities.

For routing-only work that does not create observable child processes, this
skill is not required.

## Contract Boundary

| Concern | `model-routing` owns | `agent-lifecycle` owns |
| --- | --- | --- |
| Exact model choice | Role bindings and user-approved model IDs | No model selection |
| Delegation scope | Prompt structure and task ownership | Child identity, lineage, and runtime projection |
| Child status | Structured final-result expectations | Events, activity, heartbeat, snapshots, and stale/lost handling |
| Task metadata | Plan/task context | Never lifecycle-state authority |
| External process | Dispatch limitations | Adoption labels and capability limits |

A child’s final result is evidence for an outcome but not a substitute for a
terminal lifecycle event, process-exit observation, or authoritative snapshot.
Conversely, heartbeat evidence does not establish result quality or completion.

## v0.2.0 Integration Contract

The implemented lifecycle core expects schema-v1 identity and lineage:

```text
schemaVersion: 1
eventId: unique event identity
source: adapter/source name
sourceEpoch: producer sequence-space identity
childId: one lifecycle identity
lineage: root child, attempt, external/adoption truth
capabilities: known | unknown per observable
```

For a source with ordering, sequence identity is
`(source, sourceEpoch, childId, sequence)`. A routing retry should use a new
`childId`, share the original `rootChildId`, and increment `attempt`. Do not
reuse a terminal child ID for a retry.

A visibility-enabled dispatch contract should state:

- the owning adapter/source and its source-epoch policy;
- parent/root/attempt lineage;
- available activity, heartbeat, snapshot, cancel, history, and terminal-cause
  capabilities;
- event endpoint or JSONL stream, sequence behavior, and redaction boundary;
- authoritative snapshot source, reconnect behavior, and complete-omission
  grace; and
- the evidence required before a stale child may become `lost`.

## Hermes-Specific Boundary

The v0.2.0 Hermes module is an adapter foundation. It normalizes documented
Hermes delegation events and requests status snapshots on session open,
reconnect, and periodic intervals. A host consumes its reconciliation inputs and
intents, including a stale-unknown intent only after consecutive complete
snapshot omissions.

It does **not** make a child appear in Hermes Desktop’s native UI, modify
Hermes’s core lifecycle ownership, or claim that a general foreign-process
adoption path is shipped.

## Future Cross-Skill Work

Do not change other skills automatically from this package. A host integration
is complete only when it:

1. carries lifecycle identity and capability truth in its child launch contract;
2. renders normalized lifecycle state separately from todos and percentages;
3. audits authoritative corrections and preserves terminal immutability;
4. tests gaps, reconnect convergence, stale-then-lost, malformed JSONL, and
   adoption with intentionally unknown capabilities; and
5. states whether it is an adapter foundation, experimental integration, or a
   supported host feature.

Existing model-routing behavior must continue to work when live child
visibility is not requested.

Before rollout, verify the full new-session matrix for both an exact Opus model
and an exact GPT model: explicit `-m` selection and implicit harness default,
each with a matching routing profile and with no profile. In the no-profile
cases, the model is runtime state only and delegation must pause for exact role
selection. Also verify removal of active intent and a named profile leaves the
harness model bindings and `agent-lifecycle` installation untouched.
