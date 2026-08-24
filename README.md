# CUE++ Agent Skills

**Use fewer model tokens without lowering the acceptance standard.** Route each
task to the least expensive configured model that can own it completely, keep
implementation detail out of the strongest model's context, and escalate only
when verification or ambiguity shows a stronger route is needed.

Profiles remember exact approved bindings; they are a convenience, not the
goal. `agent-lifecycle` is the visibility companion that keeps delegated work
observable. This catalog ships exactly two skills:

1. [`model-routing`](skills/model-routing/SKILL.md) — routes work by judgment and acceptance needs to reduce token use while preserving quality responsibility.
2. [`agent-lifecycle`](skills/agent-lifecycle/SKILL.md) — records and displays lifecycle evidence for delegated children.

There is no third skill. The two compose intentionally: model routing chooses the exact models and profile; lifecycle makes delegation observable without mistaking task progress for child state. Read the [two-skill composition guide](docs/composition.md) for the ownership boundary.

## Model routing

`model-routing` prefers deterministic local tools before any model, reserves the
strongest configured model for ambiguity, decisions, synthesis, and acceptance,
uses builders for bounded substantive work, and uses a sweeper only for
mechanically verifiable language work. It avoids fan-out when dispatch/context
overhead exceeds the likely savings and requires fresh verification before
acceptance.

Exact model identifiers remain explicit and validated. The skill does not infer
a model from a provider default, nickname, or example.

For example, a profile may bind the exact identifiers `Fable`, `Opus`, and `Haiku` to DRIVER, BUILDER, and SWEEPER. `Sol`, `Terra`, and `Luna` are likewise illustrative names only. They are not defaults, model tiers, or a promise that any harness offers them.

Profiles are persistent and scoped: a saved profile auto-loads in its saved scope in later sessions, then must be validated against the current model inventory before use. The skill supports these explicit actions:

- **setup** — save a named profile and make it active;
- **show** — inspect the active, saved, inherited, or invalid bindings;
- **change** — replace one exact binding in the active profile;
- **switch** — activate a different saved profile;
- **clear** — remove the active selection while retaining saved profiles; and
- **reset** — restore the host's previous routing configuration from its recorded receipt, then clear active routing intent. It never deletes all saved profiles.

Use a one-off selection when it should not be saved. Before delegating, `model-routing` automatically depends on `agent-lifecycle`; if lifecycle support is unavailable, the resulting visibility limit must be stated rather than silently replaced with a todo list.

## Delegation visibility

When a host has a native child-agent interface, use that UI first. `agent-lifecycle` remains the authority for lifecycle state: created, running, waiting, completed, failed, cancelled, and lost are backed by lifecycle evidence and reconciliation, not task checkboxes or a final result.

If the native UI is unavailable, use the fallback only under this contract:

- **Lifecycle source available:** render exactly one aggregate **active, display-only** todo and individual **DISPLAY ONLY** child rows. Each child row shows its ID, literal lifecycle state, activity or active tool, and freshness. The normalized lifecycle projection is authoritative; edits to these fallback rows are ignored. Preserve terminal states literally: `completed`, `failed`, `cancelled`, and `lost` are terminal display states, never remapped to a successful or cancelled todo.
- **No lifecycle source:** render no child rows and state exactly: `Background work visibility unavailable; state unknown.`

On reconnect, rebuild the fallback from the normalized projection after reconciliation; do not retain or infer child state from prior todo rows. See the [lifecycle guide](docs/lifecycle/index.md) and [Hermes adapter notes](docs/harnesses/hermes.md) for the shipped boundary.

## Install

Install either skill on its own, or both for routed delegation with lifecycle visibility:

```bash
# Model routing only
npx skills add cueplusplus/agent-skills --skill model-routing

# Lifecycle visibility only
npx skills add cueplusplus/agent-skills --skill agent-lifecycle

# Both skills
npx skills add cueplusplus/agent-skills --skill model-routing
npx skills add cueplusplus/agent-skills --skill agent-lifecycle
```

The repository also includes the [`routed-delegation` Hermes bundle](hermes-bundles/routed-delegation.yaml). It is a load-time helper for the two skills; it does not install them and does not add a third skill.

## What ships

The public catalog now ships both skill documents, their references, and grouped documentation. It includes a Hermes adapter foundation for lifecycle observations and scoped routing guidance. It does **not** add Hermes Desktop core integration, a task board, arbitrary foreign-process adoption, or a default model selection.

- [Model-routing documentation](docs/model-routing/index.md)
- [Profile controls](docs/model-routing/profiles.md)
- [Agent-lifecycle documentation](docs/lifecycle/index.md)
- [Two-skill composition](docs/composition.md)
- [Architecture](docs/architecture.md)
- [Release process](docs/releases.md)
- [Future development](docs/roadmap.md)

## Verify

```bash
npm run verify
```

`verify` runs the repository's Node test suite and skill-catalog checker. To verify the vendored lifecycle mirror against its source checkout, set `AGENT_LIFECYCLE_SOURCE` to the **repository root** (the directory that contains `skills/agent-lifecycle`):

```bash
AGENT_LIFECYCLE_SOURCE=/path/to/agent-lifecycle npm run verify
```

Without that variable, catalog verification does not require a separate source checkout.

## License

[MIT](LICENSE)
