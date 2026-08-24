# Model routing

`model-routing` minimizes model-token use and DRIVER-context growth while
preserving the acceptance standard. It routes each task to the least expensive
configured model that can own it completely, uses deterministic local tools
before models, and escalates only on evidence.

Exact, live model bindings and scoped profiles constrain that optimization; they
are not its purpose. A role is not a model family or a tier nickname.

- **DRIVER** owns planning, orchestration, phase-boundary verification, and user communication.
- **BUILDER** owns delegated implementation, research fan-outs, and implementation review.
- **SWEEPER** is only mechanical, zero-judgment work. If a harness cannot address it separately, record a mode rather than inventing a model binding.

Read the normative [token/quality routing policy](../../skills/model-routing/references/routing-policy.md)
for delegation thresholds, context bounds, parallelism, escalation, retries, and
verification economy.

## Before dispatch

Read the [Hermes harness guide](../harnesses/hermes.md) for Hermes. Then inspect the live model inventory, live driver/child bindings, and scoped v2 profile. If no active profile exists, ask for exact identifiers for DRIVER and BUILDER and an explicit SWEEPER mode before dispatching.

A configured default is runtime state, not an active routing profile. Never infer model selection from historical examples, a provider family, or a role name.

## Model examples—not defaults

The following are examples of the required specificity; they are not recommendations, availability claims, or defaults:

| Role | Example exact value | Notes |
| --- | --- | --- |
| DRIVER | `openai/gpt-5.6-sol` | Use only if it appears in the live inventory. |
| BUILDER | `openai/gpt-5.6-terra` | On Hermes, one child binding serves all delegated builders. |
| SWEEPER | `fold-builder` | A mode, not a fake model, when no separate child binding exists. |

Always preserve the identifier the user selected verbatim in prompts, profiles, UI labels, and reports.

## Hermes limitation

Hermes has a session-driver binding and one delegated-child binding. `delegate_task` has no per-call model override, so BUILDER and delegated SWEEPER share one exact child model. Keep trivial sweeps with the driver when that avoids spending builder-tier capacity.

## Profile storage

See [scoped v2 profiles](profiles.md) for storage, scope, and safe operations. Profiles express user intent; they do not silently overwrite host configuration.
