<h1 align="center">Agent skills pack</h1>

<p align="center">
  Seventeen public, portable Agent Skills for agent operations, reviews, releases,
  codebase context, secure setup, change delivery, and evidence-backed
  investigation of what a change would touch.
</p>

A public package by **Criss Moldovan**. Every skill is independently discoverable
under `skills/<name>/SKILL.md`, installable through Agent Skills-compatible
harnesses, and tested as part of one release catalogue.

## What is in the pack

| Skill | Description | Details |
|---|---|---|
| `model-routing` | Route work efficiently without lowering output quality. | [Skill](skills/model-routing/SKILL.md) · [Guide](docs/model-routing/index.md) |
| `agent-lifecycle` | Integrate live visibility for child-agent lifecycles. | [Skill](skills/agent-lifecycle/SKILL.md) · [Guide](docs/lifecycle/index.md) |
| `blocks` | Interact with Blocks sessions, status, and bounded waits. | [Skill](skills/blocks/SKILL.md) · [Guide](docs/blocks.md) |
| `request-blocks-review` | Run Blocks review/fix/re-review until a GitHub PR is clean. | [Skill](skills/request-blocks-review/SKILL.md) |
| `secure-credential-setup` | Place and verify secrets without exposing their values. | [Skill](skills/secure-credential-setup/SKILL.md) · [Terminal patterns](skills/secure-credential-setup/references/terminal-entry-patterns.md) |
| `derive-codebase-context` | Derive agent context, enforced boundaries, and an operational atlas from the repo itself. Use when agents keep losing the shape of a large codebase. | [Skill](skills/derive-codebase-context/SKILL.md) · [Runbook](skills/derive-codebase-context/references/onboarding.md) |
| `publish-agent-skill` | Publish an Agent Skill through a verified release. | [Skill](skills/publish-agent-skill/SKILL.md) |
| `update-agent-skills` | Update Agent Skills across every requested local plane. | [Skill](skills/update-agent-skills/SKILL.md) |
| `release-ledger` | Onboard a since-you-have-been-gone release ledger into any product: capture merged work, analyse and categorise it, and show each user what changed since they last looked. | [Skill](skills/release-ledger/SKILL.md) · [System model](skills/release-ledger/references/system-model.md) |
| `github-webhooks` | Adopt and manage GitHub webhook handling in an app: endpoint setup, signature verification, event routing, and a working reference for every event type you route. | [Skill](skills/github-webhooks/SKILL.md) · [Event types](skills/github-webhooks/references/event-types.md) |
| `describe-changes` | Document what a change actually did: analyse a commit, PR, or merge, classify it, and write short, medium, and detailed descriptions anchored to the diff. | [Skill](skills/describe-changes/SKILL.md) · [Output contract](skills/describe-changes/references/output-contract.md) |
| `investigate-codebase` | Answer a question about a codebase with evidence that can prove it — score complexity before spending, fan out searches with controls, reconcile contradictions, and say what was not searched. Use when a code question needs a defensible answer, not a guess. | [Skill](skills/investigate-codebase/SKILL.md) · [Complexity rubric](skills/investigate-codebase/references/complexity-rubric.md) |
| `blast-area` | Map what a set of changes would affect before making it: callers, data contracts, jobs, UI, tests, build toolchains, deploy ordering, and second-order readers — with searched negatives and a list of what the map cannot see. Use when you need to know what a change would break. | [Skill](skills/blast-area/SKILL.md) · [Surface checklist](skills/blast-area/references/surface-checklist.md) |
| `visualise-blast-area` | Render a change's blast map as diagrams — mermaid first, optionally one self-contained interactive HTML — with changed-vs-affected styling and blind spots stated on the diagram itself. Use when a blast-area map needs to be seen, shared, or dug into. | [Skill](skills/visualise-blast-area/SKILL.md) · [Mermaid contract](skills/visualise-blast-area/references/mermaid-contract.md) |
| `land-complex-change` | Land a complex change with reduced side effects and regressions: declare a touch-set budget from its blast map, arm a regression gate per affected surface, and stop when work strays outside the budget. Use when a change is too risky to build without contained side effects. | [Skill](skills/land-complex-change/SKILL.md) · [Side-effect budget](skills/land-complex-change/references/side-effect-budget.md) |
| `resolve-problem-report` | Resolve a problem report end to end: reproduce the claim, dig to root cause or implications, offer candidate fixes with trade-offs, spec the chosen one, and land it through gated review. Use when a bug or feature report needs investigating and resolving rather than a quick patch. | [Skill](skills/resolve-problem-report/SKILL.md) · [Gate contracts](skills/resolve-problem-report/references/gate-contracts.md) |
| `new-ux-discovery` | Discover UX improvements a codebase can already support — across UI, API, CLI, MCP and notifications — and gate every candidate through a not-already-implemented sweep and a no-confusion check before proposing it. Use when you want evidence-backed UX opportunities, riding a change or from pure analysis. | [Skill](skills/new-ux-discovery/SKILL.md) · [Candidate gates](skills/new-ux-discovery/references/gates.md) |

The pack contains distinct procedures, not one monolithic workflow. Compose only
what the task needs. `model-routing` and `agent-lifecycle` cover economical,
observable delegation; `request-blocks-review` uses `blocks`; `release-ledger`
can compose with `github-webhooks` for capture and `describe-changes` for entries;
a target-specific private publisher/updater may fully override the generic public
workflow.

The six change-and-evidence skills compose the way the release trio does — by name,
at the point of use, with no coordinator between them. `investigate-codebase`
answers a question about a codebase; `blast-area` uses that searching to map what a
proposed change would touch; `visualise-blast-area` draws the resulting map;
`land-complex-change` builds against it inside a declared touch-set budget with a
regression gate per affected surface; `resolve-problem-report` runs the whole arc
from a report and hands its build half to `land-complex-change`; and
`new-ux-discovery` reads a blast map to find what a change newly makes possible.
Each is usable alone, and each names the sibling that owns the adjacent job instead
of restating it.

## Install — for humans

Install the complete pack for the current project:

```bash
npx skills add crissmoldovan/agent-skills --skill '*'
```

Install the complete pack globally for every agent supported by the installed
Skills CLI:

```bash
npx skills add crissmoldovan/agent-skills --skill '*' --global --agent '*' --yes
```

Install selected skills:

```bash
# Observable routed delegation
npx skills add crissmoldovan/agent-skills --skill model-routing agent-lifecycle

# Blocks interaction plus the completed-PR review loop
npx skills add crissmoldovan/agent-skills --skill blocks request-blocks-review

# Secure credential placement
npx skills add crissmoldovan/agent-skills --skill secure-credential-setup

# Repository context and boundaries
npx skills add crissmoldovan/agent-skills --skill derive-codebase-context

# Verified publication and all-plane updates
npx skills add crissmoldovan/agent-skills --skill publish-agent-skill update-agent-skills

# Release-ledger capture and change descriptions
npx skills add crissmoldovan/agent-skills --skill release-ledger github-webhooks describe-changes

# Evidence-backed code answers and change mapping
npx skills add crissmoldovan/agent-skills --skill investigate-codebase blast-area visualise-blast-area

# Contained change delivery and end-to-end report resolution
npx skills add crissmoldovan/agent-skills --skill land-complex-change resolve-problem-report

# UX opportunities a codebase can already support
npx skills add crissmoldovan/agent-skills --skill new-ux-discovery
```

`--agent '*'` means every agent the installed CLI supports, not every agent that
exists. The CLI reports unsupported clients separately. Preserve the existing
copy/symlink form unless conversion is explicitly requested.

## Install — for agents and LLMs

```text
Install or update the seventeen public skills from crissmoldovan/agent-skills.
Inventory project and global scopes in JSON first. Preserve source provenance,
managed/unmanaged ownership, copy/symlink form, and private namespaced plugin
skills. Install the requested scope for every supported agent, report unsupported
clients separately, then verify each installed path and source. Do not treat one
successful agent or scope as proof that all local libraries are current.
```

Preview destructive replacement when a stale directory has no managed
provenance. Never remove a private namespaced skill merely because a public
standalone skill has the same bare name.

## Update the pack

Inventory before updating:

```bash
npx skills list --json
npx skills list --global --json
```

Update CLI-managed skills at an explicit scope:

```bash
npx skills update --project --yes
npx skills update --global --yes
npx skills update model-routing agent-lifecycle --global --yes
```

For missing global projections across all supported agents:

```bash
npx skills add crissmoldovan/agent-skills --skill '*' --global --agent '*' --yes
```

### All-plane update contract

| Plane | Update rule | Required proof |
|---|---|---|
| Project-scoped Skills CLI | `npx skills update … --project --yes` from the exact project | project inventory, provenance, consuming path/precedence |
| Global Skills CLI | `npx skills update … --global --yes` | global inventory and every requested supported-agent projection |
| Copied vs symlinked | Preserve the current form unless conversion is requested | installed path/form and published-byte comparison where possible |
| Unmanaged/provenance-less | Ask before replacing only that identity | old path accounted for; new source and bytes verified |
| Native plugin/package | Use its marketplace or registry updater | exact native version, namespace, install path, and bytes |
| Manual upload/raw file | Replace through the owning UI/channel | artifact verified; otherwise `manual action required` |
| Remote machine/container | Treat as another explicitly named target | independent readback on that target |
| Unsupported client or unreachable target | Invent no destination | literal `unsupported` or `deferred` outcome |

Restart or reload agents whose loaders cache installed files. A current session
may continue using old instructions until reopened.

## Use the skills

```text
Use model-routing and agent-lifecycle for this task. Keep acceptance quality fixed,
route bounded implementation economically, and make every child visibly reconciled.
```

```text
Use request-blocks-review on this finished PR. Keep the wait visible, fix accepted
findings, rerun verification, and request current-head re-review until clean.
```

```text
Use secure-credential-setup. Ask for one credential at the exact gate and verify
authentication without printing any part of the value.
```

```text
Use derive-codebase-context. Reuse what exists, derive only missing context,
boundaries, and atlas layers, and mutation-test every new enforcement gate.
```

```text
Use publish-agent-skill for the current repository. Require catalogue README,
human release notes, update guidance, discovery, and provenance. Synchronize real
local libraries only if I explicitly name the target.
```

```text
Use update-agent-skills. Make changelog, catalogue README, release notes, and agent
update guidance agree; then update only the planes I explicitly named.
```

```text
Use release-ledger to onboard a since-you-were-away system into this app.
Investigate the stack first, decide the capture path with me, use github-webhooks
when automatic GitHub capture is selected, and use describe-changes to write each
entry from its diff in short, medium, and detailed registers.
```

```text
Use investigate-codebase for this question. Score it before spending anything, announce
the band and what it buys, run searches with controls so an empty result means something,
and tell me plainly what was not searched.
```

```text
Use blast-area for this proposed change, then visualise-blast-area on the result. I want
the surfaces it hits, when each break would surface, the deploy ordering with its reason,
and the blind spots drawn on the diagram rather than written underneath it.
```

```text
Use land-complex-change to build this. Derive the touch-set budget from the blast map
first, arm one regression gate per affected surface and watch each fail before the change,
and stop the work rather than absorb anything discovered outside the budget.
```

```text
Use resolve-problem-report on this report. Reproduce the reporter's numbers before
agreeing with them, offer candidates with what each one does not fix, and come back with a
question or a refutation if that is the honest answer.
```

```text
Use new-ux-discovery on this repository. Enumerate the surfaces first, gate every candidate
through the not-already-implemented sweep and the no-confusion check, and show me the
dropped candidates with the reason each was dropped.
```

## Composition and references

- [`docs/composition.md`](docs/composition.md) — routing and lifecycle ownership.
- [`docs/blocks.md`](docs/blocks.md) — Blocks REST/GitHub separation.
- [`skills/release-ledger/references/system-model.md`](skills/release-ledger/references/system-model.md) — release-ledger system model.
- [`skills/github-webhooks/references/event-types.md`](skills/github-webhooks/references/event-types.md) — webhook event reference.
- [`skills/describe-changes/references/output-contract.md`](skills/describe-changes/references/output-contract.md) — change-description contract.
- [`skills/blast-area/references/output-contract.md`](skills/blast-area/references/output-contract.md) — blast-map output envelope.
- [`skills/investigate-codebase/references/documenting-the-run.md`](skills/investigate-codebase/references/documenting-the-run.md) — the run-record convention, carried byte-identically by each of the six.
- [`docs/architecture.md`](docs/architecture.md) — catalogue architecture.
- [`docs/releases.md`](docs/releases.md) — release process and versioning.
- [`docs/public-content-policy.md`](docs/public-content-policy.md) — public/private boundary.

The [`routed-delegation` Hermes bundle](hermes-bundles/routed-delegation.yaml) is
a load-time helper for routing plus lifecycle. It does not install skills.

## Verify this repository

```bash
npm run verify
```

The command runs catalogue tests, skill validation, the lifecycle runtime suite,
TypeScript build, and package-consumer verification.

## License

[MIT](LICENSE)

---

<p align="center">
  <sub>Made by Criss Moldovan</sub>
</p>
