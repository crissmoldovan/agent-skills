<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/cue-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/cue-logo-light.svg">
  <img alt="CUE++" src="assets/cue-logo-light.svg" width="176">
</picture>

# Agent skills pack

A public package of agent skills published by **Criss Moldovan**. It helps agents spend
model tokens where they produce the most value while keeping delegated work
observable and evidence-backed.

**Use fewer model tokens without lowering the acceptance standard.** Route each
task to the least expensive configured model that can own it completely, keep
implementation detail out of the strongest model's context, and escalate only
when verification or ambiguity shows a stronger route is needed.

Profiles remember exact approved bindings; they are a convenience, not the
goal. `agent-lifecycle` is the visibility companion that keeps delegated work
observable.

## Skills in this package

Skills.sh and Agent Skills-compatible installers discover each
`skills/<name>/SKILL.md` independently. The frontmatter description shown below
is the same short description those catalogs display.

| Skill | Description | Details |
|---|---|---|
| `model-routing` | Route work efficiently without lowering output quality. | [Skill](skills/model-routing/SKILL.md) · [Guide](docs/model-routing/index.md) |
| `agent-lifecycle` | Integrate live visibility for child-agent lifecycles. | [Skill](skills/agent-lifecycle/SKILL.md) · [Guide](docs/lifecycle/index.md) |
| `blocks` | Interact with Blocks sessions, status, and bounded waits. | [Skill](skills/blocks/SKILL.md) · [Guide](docs/blocks.md) |
| `request-blocks-review` | Run Blocks review/fix/re-review until a GitHub PR is clean. | [Skill](skills/request-blocks-review/SKILL.md) · [Blocks primitives](skills/blocks/SKILL.md) |
| `secure-credential-setup` | Place and verify secrets without exposing their values. | [Skill](skills/secure-credential-setup/SKILL.md) · [Terminal patterns](skills/secure-credential-setup/references/terminal-entry-patterns.md) |

Model routing and lifecycle compose intentionally: routing chooses exact models
and lifecycle makes delegation observable without mistaking task progress for
child state. `blocks` is independent review tooling for GitHub pull requests.
Read the [composition guide](docs/composition.md) for the ownership boundary.

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
npx skills add crissmoldovan/agent-skills --skill model-routing

# Lifecycle visibility only
npx skills add crissmoldovan/agent-skills --skill agent-lifecycle

# Blocks reviews and direct Sessions API
npx skills add crissmoldovan/agent-skills --skill blocks

# Completed-PR review/fix/re-review workflow
npx skills add crissmoldovan/agent-skills --skill request-blocks-review

# Safe one-at-a-time credential placement
npx skills add crissmoldovan/agent-skills --skill secure-credential-setup

# Complete pack
npx skills add crissmoldovan/agent-skills --skill model-routing agent-lifecycle blocks request-blocks-review secure-credential-setup
```

The repository also includes the [`routed-delegation` Hermes bundle](hermes-bundles/routed-delegation.yaml). It is a load-time helper for the two skills; it does not install them and does not add a third skill.

## How to use the skills

Skills are instruction sets for your agent. After installing, ask naturally or
invoke the installed skill/bundle in the syntax your harness supports.
Use `model-routing` for routing/profile requests and `agent-lifecycle` for
status/integration requests; load both for observable routed delegation.

### Inspect or configure routing

```text
Show routing. Compare the active scoped profile with the live model bindings.
```

```text
Set up routing as "balanced". Keep important judgment with my strongest model,
use a cheaper builder for bounded implementation, and fold sweeps into the
builder where the harness cannot address a separate sweeper. Show every exact
binding and ask before writing configuration.
```

### Run token-efficient delegated work

```text
Use the active routing profile for this task. Set the acceptance checks first,
use deterministic local tools wherever possible, delegate only coherent work
whose context/time savings exceed overhead, and escalate only on evidence.
Keep child work visible through agent-lifecycle and verify the final result.
```

Expected behavior: exact mechanical work stays local; mechanically verifiable
language work may use SWEEPER; bounded substantive work uses BUILDER; ambiguity,
trade-offs, synthesis, and acceptance remain with DRIVER.

### Inspect lifecycle status

```text
Show the current child lifecycle status. For each child report its ID, literal
state, current activity/tool, freshness, and terminal evidence. Reconcile stale
children; do not infer completion from silence or a todo checkbox.
```

If the harness has native child UI, it is preferred. Otherwise the lifecycle
skill defines a display-only fallback whose rows never become lifecycle
authority. See [the composition guide](docs/composition.md) for the boundary.

### Request and await a Blocks review

```text
Ask Blocks to review this branch's pull request. Await up to ten minutes and
report requested, reviewing, clean, or findings without mistaking an eyes
reaction or acknowledgement for completion.
```

For direct Blocks sessions, set `BLOCKS_API_KEY` and ask:

```text
Start a Blocks session with the Claude agent to review this architecture. Wait
up to ten minutes for the final message and preserve the session/dashboard URL.
```

## What ships

The public catalog now ships five skill documents, their references, and grouped documentation. It includes the lifecycle runtime and Hermes adapter foundation, scoped routing guidance, generic Blocks interaction primitives, the separate completed-PR Blocks review loop, and safe one-at-a-time credential placement. It does **not** add Hermes Desktop core integration, a task board, arbitrary foreign-process adoption, or a default model selection.

- [Model-routing documentation](docs/model-routing/index.md)
- [Profile controls](docs/model-routing/profiles.md)
- [Agent-lifecycle documentation](docs/lifecycle/index.md)
- [Blocks documentation](docs/blocks.md)
- [Two-skill composition](docs/composition.md)
- [Architecture](docs/architecture.md)
- [Release process](docs/releases.md)
- [Future development](docs/roadmap.md)

## Verify

```bash
npm run verify
```

`verify` runs the catalog tests, skill validator, and the complete lifecycle
runtime package suite under `packages/agent-lifecycle`. The skill and its runtime
now share this repository as their canonical public source.

## License

[MIT](LICENSE)

---

<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/cue-logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/cue-logo-light.svg">
    <img alt="CUE++" src="assets/cue-logo-light.svg" width="72">
  </picture>
  <br>
  <sub>Made by Criss Moldovan</sub>
</p>
