# Two-skill composition

This catalog deliberately composes **exactly two skills**:

1. [`model-routing`](model-routing/index.md) chooses the exact models and the saved routing intent for delegated work.
2. [`agent-lifecycle`](lifecycle/index.md) makes the dispatched child observable and reconciles its lifecycle evidence.

There is no third composition skill. Keep model choice, child visibility, task planning, and host UI ownership distinct rather than introducing a coordinator skill that blurs those boundaries.

## Ownership boundary

| Concern | `model-routing` | `agent-lifecycle` |
| --- | --- | --- |
| Exact driver and child-model choice | Owns | Does not choose models |
| Scoped routing profile | Owns | Reads it only as context |
| Delegation prompt and task ownership | Owns | Supplies observation requirements |
| Child identity, lineage, capabilities | Passes through | Owns |
| Events, heartbeats, snapshots, stale/lost | Does not infer | Owns |
| Todo rows, percentages, plan checkboxes | Auxiliary only | Never lifecycle authority |
| Hermes Desktop UI | Uses native host UI when available | Does not add Desktop core UI |

A final child result is outcome evidence, not a lifecycle event. A heartbeat is liveness evidence, not progress or success.

## Recommended load and dispatch order

1. Load `model-routing`; read the matching harness guide before configuring or dispatching.
2. Inspect live bindings and the active profile. If no active profile exists, ask the user for exact role identifiers; a harness default is not consent.
3. Load `agent-lifecycle` before launch when the host can expose delegated-child evidence.
4. Declare the child source, stable child ID, source epoch, lineage, and known/unknown capabilities.
5. Dispatch only after the user confirms the model profile and the host either has lifecycle evidence or clearly reports its visibility limits.
6. Keep task progress separate from lifecycle state. At phase boundaries, independently verify the resulting work.

Routing-only work that creates no observable child does not need lifecycle integration. Conversely, lifecycle integration does not authorize a model choice.

## What ships now

The catalog ships the two skills and their documentation. The lifecycle contract includes a Hermes adapter foundation; it does **not** ship Hermes Desktop core integration, a task board, or arbitrary foreign-process adoption. Host-native rendering and status controls remain the host's responsibility. The shipped Hermes routing adapter is documented in [`skills/model-routing/references/harness-hermes.md`](../skills/model-routing/references/harness-hermes.md); its `hermes-routing` scripts are adapter tooling, not a Hermes profile primitive.

## Installing and packaging

Install both skills explicitly when you want this composition. The [`routed-delegation` bundle](../hermes-bundles/routed-delegation.yaml) is a load-time helper: it loads both skills but installs neither.

For public distribution, packing with `skills.sh pack` is optional. A successful pack does not itself publish the skills or make them discoverable in a public listing. Treat an unlisted package as an intentional distribution choice and provide an explicit repository/install path to users.

## When a dependency is missing

Do not silently substitute a third skill, a todo board, or an assumed model. Explain which of the two skills is unavailable and what degrades:

- **Missing `model-routing`:** do not delegate until the user has selected exact model identifiers through a supported host flow. You may perform non-delegated work.
- **Missing `agent-lifecycle`:** dispatch only if the user accepts degraded host-native visibility. State that lifecycle projection, reconciliation, stale/lost handling, and adapter evidence are unavailable.
- **Missing both:** do not claim routed or observable delegation. Offer installation instructions or proceed without delegation.

If the host exposes only todos, show them as task metadata—not as a child state. Label the display **“Task progress (not lifecycle status)”** and show `Lifecycle: unavailable` (or `unknown`) until lifecycle evidence exists.
