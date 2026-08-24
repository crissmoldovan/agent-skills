# Hermes new-session acceptance matrix

This matrix validates skill discovery and the boundary between `model-routing` and `agent-lifecycle` before rollout.

Exact test models (validated from the live Hermes provider cache on 2026-08-24):

- Opus: `anthropic/claude-opus-5`
- GPT: `openai/gpt-5.6-sol`

`explicit` means the new session is launched with `hermes chat -m <exact-model>`. `implicit` means no `-m` flag is supplied and Hermes resolves the profile's configured `model.default`. A routing profile is intent read from `~/.agents/model-routing-tiers.yaml`; it does not itself select the runtime model.

| ID | Runtime family | Selection | Routing profile | Expected routing result | Lifecycle expectation |
|---|---|---|---|---|---|
| O-E-P | Opus | explicit `-m anthropic/claude-opus-5` | present and matching | `MATCH`; exact model retained | `agent-lifecycle` v0.2.0 loads |
| O-I-P | Opus | implicit profile default | present and matching | `MATCH`; configured model reported | skill loads; no model inferred from role name |
| O-E-N | Opus | explicit | absent | `UNPROFILED`; ask exact role bindings before delegation | lifecycle may be inspected; no child dispatch |
| O-I-N | Opus | implicit profile default | absent | `UNPROFILED`; configured default is not consent | lifecycle may be inspected; no child dispatch |
| G-E-P | GPT | explicit `-m openai/gpt-5.6-sol` | present and matching | `MATCH`; exact model retained | `agent-lifecycle` v0.2.0 loads |
| G-I-P | GPT | implicit profile default | present and matching | `MATCH`; configured model reported | skill loads; no model inferred from role name |
| G-E-N | GPT | explicit | absent | `UNPROFILED`; ask exact role bindings before delegation | lifecycle may be inspected; no child dispatch |
| G-I-N | GPT | implicit profile default | absent | `UNPROFILED`; configured default is not consent | lifecycle may be inspected; no child dispatch |
| REMOVE | either | either | remove active intent and selected named profile | active intent absent; named file absent; harness model unchanged; next dispatch asks again | installed lifecycle skill remains available |

## New-session smoke command

```sh
hermes chat -Q -s agent-lifecycle --max-turns 2 \
  -q 'State the loaded agent-lifecycle skill version and distinguish activity from heartbeat. Use no tools.'
```

Expected: version `0.2.0`; activity describes current work, heartbeat proves liveness, and neither changes lifecycle state.

## Interactive Desktop test

1. Start a **new session** in the `agent-lifecycle` Hermes Project.
2. Ask: `Load agent-lifecycle and model-routing. Show the active routing profile and live Hermes bindings; do not mutate anything.`
3. Ask it to delegate a read-only probe only when the routing row is `MATCH`.
4. While the child runs, verify Hermes' native subagent row remains visible and opens its child watch session.
5. The package currently supplies a reconciliation adapter foundation; it does not yet patch Hermes Desktop core. Therefore a missing/stale native row is a Hermes host-integration defect, not evidence that the skill failed to load.

## Removal safety

Profile-removal tests must use temporary test profile names or exact backup/restore. Removing routing intent must never change `model.default`, `delegation.model`, provider credentials, unrelated named profiles, or the installed `agent-lifecycle` skill.
