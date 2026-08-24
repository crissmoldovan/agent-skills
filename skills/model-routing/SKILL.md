---
name: model-routing
description: "Route work efficiently without lowering output quality."
license: MIT
compatibility: "Agent Skills-compatible harnesses; inventory, profiles, and child dispatch are harness-specific."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=cueplusplus"
allowed-tools: Read Write Grep Glob Bash Agent Workflow
---

# Token-efficient, quality-preserving model routing

Complete work with the fewest model tokens and least DRIVER-context growth that
still meets the acceptance criteria. Route each task to the least expensive
configured model that can own it completely, and escalate only when evidence
shows that route cannot meet quality. Profiles and exact identifiers preserve
approved bindings; they are mechanisms, not the product goal.

Fable/Opus/Haiku and Sol/Terra/Luna are illustrative names, not defaults or tiers. Never infer a model from one of those examples, a provider, a nickname, or a harness default.

## When to Use

- Work can be decomposed so expensive-model reasoning is reserved for judgment,
  synthesis, and acceptance.
- Delegated research, implementation, review, or mechanical processing would
  otherwise inflate DRIVER context or use a stronger model than necessary.
- A user asks to set up, inspect, change, switch, clear, reset, delete, or use a
  routing profile.

Don't delegate a task whose context-packaging and reconciliation overhead exceeds
the likely savings. Do not optimize token count by weakening acceptance or
verification. Do not use a sweeper for interpretation, quality judgment, or
taste.

Read [the routing policy](references/routing-policy.md) before planning a routed
run. Its local-tool-first, decomposition, context-bound, escalation, retry, and
verification rules are normative.

## Roles

| Role | Assignment rule | Owns |
|---|---|---|
| **DRIVER** | Strongest approved model; use only where marginal reasoning quality matters. | Ambiguity, scope, trade-offs, architecture, orchestration, synthesis, acceptance, and user communication. |
| **BUILDER** | Least-cost approved model that can meet bounded substantive acceptance criteria. | Implementation, research, tests, debugging, and implementation-level review. |
| **SWEEPER** | Least-cost approved model for mechanically verifiable language work. | Only bounded zero-judgment transforms when deterministic local tools are insufficient. |

Prefer deterministic local tools before any model for exact transformations,
formatting, extraction, filtering, counting, and validation. A task moves upward
only when evidence shows the lower route cannot meet acceptance: local tool →
SWEEPER → BUILDER → DRIVER.

## Prerequisites

1. Read [profile controls](references/profile-controls.md) and the reference for the active harness. **Complete when:** the profile command, persistence location, and supported role bindings are known for that harness.
2. Inventory models the harness can address now. Record each identifier literally. **Complete when:** every proposed binding names an identifier that the harness reports, not a guessed vendor label.
3. Before child delegation, check for and load the `agent-lifecycle` skill. If it is unavailable, offer to install it and wait for user approval before installation. Do not substitute a todo list for lifecycle evidence. **Complete when:** lifecycle authority and its visible surface are known, or the user has declined installation and the resulting visibility limitation is explicit.

## Procedure

1. **Set the acceptance standard.** State the required output, decisive checks, and
   judgment/blast radius. **Complete when:** cost cannot be reduced by silently
   reducing required quality.
2. **Choose the lowest viable route.** Use deterministic tools first; otherwise
   classify SWEEPER, BUILDER, or DRIVER by judgment required. **Complete when:**
   each task has one owner and a reason the cheaper route is insufficient.
3. **Resolve bindings only as needed.** Reuse and validate a matching scoped
   profile. Enter profile setup/control mode only when requested or when a needed
   binding is absent/invalid. **Complete when:** no setup ceremony is repeated
   for an already valid profile.
4. **Package minimum context.** Give children source paths, immutable decisions,
   ownership, acceptance checks, stop conditions, and a bounded result contract;
   never paste whole conversations/logs/plans. **Complete when:** the child can
   work from source without receiving unrelated context.
5. **Decompose only when savings exceed overhead.** Prefer one coherent owner.
   Parallelize only independent, disjoint work with non-overlapping questions.
   **Complete when:** no fan-out duplicates source reading, output, or ownership.
6. **Escalate on evidence.** Stop at ambiguity, failed acceptance, quality risk,
   or ownership conflict. Retry once only for a transient execution failure;
   otherwise pass the failure delta/artifacts to a stronger route. **Complete
   when:** no blind retry repeats full discovery/context.
7. **Verify economically.** Run deterministic/focused checks first and broader
   checks at risk or phase boundaries; DRIVER independently accepts the result.
   **Complete when:** accepted output has fresh evidence and concise reporting.
8. **Expose lifecycle truth.** Load `agent-lifecycle` for child delegation and
   prefer native child UI; use its display-only fallback only when needed.
   **Complete when:** visible state comes from lifecycle evidence, not task guesses.

## Usage Examples

### Show the active route

```text
Show routing. Compare the scoped profile with live bindings and report MATCH,
MISMATCH, UNBOUND, NOT_ADDRESSABLE, or UNAVAILABLE for each role. Do not write.
```

### Set up a reusable profile

```text
Set up routing as "balanced". Ask me for exact DRIVER and BUILDER models, and a
SWEEPER model or explicit degraded mode. Validate the live inventory, preview
the changes, and wait for confirmation before applying and saving them.
```

### Route a task efficiently

```text
Use the active routing profile. Define acceptance first. Use deterministic local tools
for exact work, BUILDER for bounded implementation with objective checks,
and DRIVER only for ambiguity, trade-offs, synthesis, and acceptance. Delegate
only when the savings exceed dispatch/context overhead. Keep child work visible
with agent-lifecycle and independently verify the result.
```

### Escalate without repeating discovery

```text
The current route failed verification. Do not rerun the same prompt. Pass the
failure delta, relevant artifacts, attempted checks, and remaining acceptance
criteria to the next capable route.
```

## Harness References

| Harness | Reference |
|---|---|
| Hermes Agent | [references/harness-hermes.md](references/harness-hermes.md) |
| Generic Agent Skills harness | [references/harness-generic.md](references/harness-generic.md) |
| User command semantics and profile scripts | [references/profile-controls.md](references/profile-controls.md) |
| Token/quality routing policy | [references/routing-policy.md](references/routing-policy.md) |

## Pitfalls

- A configured harness default is not a user-selected routing profile.
- A saved profile is not valid forever: model inventory can change, so validate at auto-load and before dispatch.
- “Cheapest” applies only after the user has selected an exact sweeper model; it never authorizes an agent to pick an unapproved model.
- Parallelism does not permit concurrent edits to shared files, manifests, or acceptance criteria.
- Fan-out can spend more tokens than it saves; parallelize only independent work
  whose wall-time or context benefit exceeds dispatch/reconciliation overhead.
- Never send complete conversations, repositories, plans, or raw logs to every
  child. Pass source references and bounded evidence.
- Never blindly retry the same prompt. Preserve artifacts and escalate on the
  failure delta.
- A native task display is not lifecycle authority; a todo fallback is weaker still.
- Never claim separate role models when the harness can run only one child model.

## Verification

- [ ] Every bound role has a literal exact identifier from the live inventory.
- [ ] The DRIVER is the strongest model explicitly selected by the user for important reasoning.
- [ ] Builder work is substantive and independent work is parallel only when ownership is disjoint.
- [ ] Sweeper work is mechanically specified and contains zero judgment.
- [ ] Deterministic local tools were preferred where no model judgment was needed.
- [ ] Child context/results are bounded and do not duplicate broad source material.
- [ ] Escalations follow failed evidence/ambiguity; no blind retry repeated discovery.
- [ ] Token reduction did not weaken acceptance criteria or fresh verification.
- [ ] The active scoped profile auto-load behavior and revalidation outcome are shown.
- [ ] `agent-lifecycle` was loaded before child delegation, or its absence and approved installation decision are recorded.
- [ ] Native lifecycle UI is used when present; otherwise the todo fallback is labelled non-authoritative.
- [ ] Any harness limitation is reported as a degradation, not presented as a successful binding.
