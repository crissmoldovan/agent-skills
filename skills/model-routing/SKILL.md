---
name: model-routing
description: "Use when configuring exact models for delegated work."
license: MIT
compatibility: "Agent Skills-compatible harnesses; inventory, profiles, and child dispatch are harness-specific."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=cueplusplus"
allowed-tools: Read Write Grep Glob Bash Agent Workflow
---

# Dependency-aware model routing

Assign explicit model identifiers to roles rather than treating provider defaults or tier names as choices. The strongest user-selected exact model drives important reasoning; parallel builders own implementation and substantive work; the cheapest exact sweeper is reserved for zero-judgment work.

Fable/Opus/Haiku and Sol/Terra/Luna are illustrative names, not defaults or tiers. Never infer a model from one of those examples, a provider, a nickname, or a harness default.

## When to Use

- A user asks to set up, inspect, change, switch, clear, reset, delete, or use a routing profile.
- A task needs delegated research, implementation, review, or mechanical processing.
- A harness has multiple selectable models and the user wants predictable cost and responsibility.

Don't use this to choose a model on the user's behalf when no exact selection or approved profile exists. Do not use a sweeper for work that requires interpretation, quality judgment, or taste.

## Roles

| Role | Assignment rule | Owns |
|---|---|---|
| **DRIVER** | The strongest exact model the user selected. | Important reasoning, scope, plans, orchestration, synthesis, acceptance decisions, and user communication. |
| **BUILDER** | Exact user-selected model(s); use parallel builders when work is independent. | Implementation, substantive research, tests, debugging, and implementation-level review. |
| **SWEEPER** | Cheapest exact user-selected model. | Deterministic, zero-judgment actions such as exact renames, formatting, extraction, and log filtering. |

A task moves upward when it requires a decision: sweeper → builder → driver. A driver should not silently become the implementation worker merely because a builder is unavailable; disclose the degradation and ask whether to proceed.

## Prerequisites

1. Read [profile controls](references/profile-controls.md) and the reference for the active harness. **Complete when:** the profile command, persistence location, and supported role bindings are known for that harness.
2. Inventory models the harness can address now. Record each identifier literally. **Complete when:** every proposed binding names an identifier that the harness reports, not a guessed vendor label.
3. Before child delegation, check for and load the `agent-lifecycle` skill. If it is unavailable, offer to install it and wait for user approval before installation. Do not substitute a todo list for lifecycle evidence. **Complete when:** lifecycle authority and its visible surface are known, or the user has declined installation and the resulting visibility limitation is explicit.

## Procedure

1. **Resolve intent.** Interpret `setup`, `show`, `change`, `switch`, `clear intent`, `reset`, `delete`, and `use once` through [profile controls](references/profile-controls.md). **Complete when:** the requested scope and write/delete effect have been stated before mutation.
2. **Select exact identifiers.** For a new profile or one-off run, ask the user to select an exact DRIVER and BUILDER; request a SWEEPER only if the harness can address it and zero-judgment work is expected. Confirm the complete role table. **Complete when:** no role is represented by a tier nickname or an illustrative model.
3. **Validate and save/apply only as requested.** Validate every selected identifier against the live inventory. A scoped saved profile auto-loads in later sessions in that scope and is validated again before use. **Complete when:** the response distinguishes saved, active, inherited, invalid, and one-off bindings.
4. **Dispatch by dependency.** Give independent builder tasks disjoint ownership and run them in parallel. Keep decisions and shared-file coordination with the DRIVER. Give SWEEPER only exact, mechanically verifiable operations. **Complete when:** no child has unbounded scope or overlapping write ownership.
5. **Expose lifecycle truth.** Prefer the harness's native child-agent UI. Only when native UI is unavailable, apply the exact fallback contract: if a lifecycle source exists, render one aggregate active display-only todo plus individual DISPLAY ONLY child rows showing ID, state, activity/tool, and freshness; the lifecycle projection is authoritative and row edits are ignored. If no lifecycle source exists, render no child rows and state exactly `Background work visibility unavailable; state unknown.` Rebuild the fallback from the reconciled projection on reconnect and preserve terminal states literally. **Complete when:** state is derived from lifecycle evidence, not from task completion guesses.
6. **Verify before reporting ready.** Re-read active bindings, validate identifiers, and distinguish selected/configured/dispatched/observed models. **Complete when:** a user can see what will run, what did run, and any degradation.

## Harness References

| Harness | Reference |
|---|---|
| Hermes Agent | [references/harness-hermes.md](references/harness-hermes.md) |
| Generic Agent Skills harness | [references/harness-generic.md](references/harness-generic.md) |
| User command semantics and profile scripts | [references/profile-controls.md](references/profile-controls.md) |

## Pitfalls

- A configured harness default is not a user-selected routing profile.
- A saved profile is not valid forever: model inventory can change, so validate at auto-load and before dispatch.
- “Cheapest” applies only after the user has selected an exact sweeper model; it never authorizes an agent to pick an unapproved model.
- Parallelism does not permit concurrent edits to shared files, manifests, or acceptance criteria.
- A native task display is not lifecycle authority; a todo fallback is weaker still.
- Never claim separate role models when the harness can run only one child model.

## Verification

- [ ] Every bound role has a literal exact identifier from the live inventory.
- [ ] The DRIVER is the strongest model explicitly selected by the user for important reasoning.
- [ ] Builder work is substantive and independent work is parallel only when ownership is disjoint.
- [ ] Sweeper work is mechanically specified and contains zero judgment.
- [ ] The active scoped profile auto-load behavior and revalidation outcome are shown.
- [ ] `agent-lifecycle` was loaded before child delegation, or its absence and approved installation decision are recorded.
- [ ] Native lifecycle UI is used when present; otherwise the todo fallback is labelled non-authoritative.
- [ ] Any harness limitation is reported as a degradation, not presented as a successful binding.
