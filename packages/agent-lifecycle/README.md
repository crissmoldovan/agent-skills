# Agent Lifecycle

Portable lifecycle projection, reconciliation, and visibility primitives for delegated agents.

> **Status: v0.2.0 implementation foundation.** The private package now ships the schema-v1 normalizer, lifecycle projector, bounded JSONL parser and single-writer journal, plus a Hermes delegation-reconciliation adapter foundation. It does **not** ship Hermes Desktop core integration, a hosted service, or a general native-child insertion API.

Coding-agent harnesses can launch child agents while terminals, desktop views, and reconnecting sessions see incomplete or stale status. Agent Lifecycle defines a small, durable contract for identity, activity, liveness, outcome, and auditable repair without claiming that an arbitrary process can be made a native child of another product.

## What this package contains

- Schema-v1 lifecycle event validation with redaction of sensitive detail fields.
- Canonical states, legal transitions, immutable terminal outcomes, and projected progress snapshots.
- Event identity, source-epoch sequence handling, lineage, and explicit capabilities.
- Activity and heartbeat freshness; stale-before-lost handling after reconciliation failure.
- Authoritative complete-snapshot correction with a reconciliation audit trail.
- Incremental JSONL parsing and a serialized, append-only single-writer journal.
- A Hermes delegation event/status adapter foundation, including session-open, reconnect, and periodic reconciliation.
- An installable `agent-lifecycle` skill and adapter-contract reference.

Start with the [schema and API guide](docs/api/lifecycle-api.md), [portable contract](docs/research/child-lifecycle-contract.md), and [Hermes adapter guidance](docs/api/hermes-delegation-reconciliation.md).

## Design position

There is no established vendor-neutral API that lets an already-running arbitrary process retrospectively appear as a native child in another harness’s stock UI. Preserve lifecycle ownership instead:

1. Create harness-native children where a supported API allows it.
2. Adapt observable native events, hooks, and status snapshots where it does not.
3. Publish observations to the portable lifecycle model.
4. Reconcile missed delivery with authoritative complete snapshots and durable journals.

This is **not** a task board, Kanban system, or generic todo-list format. Todo state must not create, advance, complete, or revive lifecycle state.

## API at a glance

The package exports these implementation primitives from `src/index.ts`:

- `normalizeLifecycleEvent(value)` validates and normalizes a schema-v1 `LifecycleEvent`.
- `LifecycleProjector` applies events, exposes projected snapshots, marks inactive children stale, reconciles authoritative snapshots, and only marks a child `lost` after stale state plus failed reconciliation.
- `JsonlLifecycleParser` incrementally recovers valid JSONL records while producing bounded, redacted diagnostics for malformed, oversized, or truncated input.
- `JsonlLifecycleJournal` appends normalized records to a single-writer journal and refuses future appends if replay discovers non-final corruption.

The Hermes adapter foundation is exported separately from `src/hermes-delegation-reconciliation.ts`; it normalizes documented delegation events and reconciles status snapshots. See the [API example](docs/api/lifecycle-api.md#example-project-and-reconcile-a-child).

## Package and skill

The package is maintained in this public monorepo at version `0.3.0`. It is not an npm publication claim.

The repository root includes `skills/agent-lifecycle/SKILL.md`. Install that
skill from `crissmoldovan/agent-skills`, then load `agent-lifecycle`. This
package directory is the canonical runtime implementation used by that skill.

## Development

Requires Node.js 24 or newer.

```sh
npm install
npm run verify
```

`npm run verify` checks package policy, Markdown hygiene, TypeScript, and the lifecycle and Hermes adapter tests.

## Contributing and security

- Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing changes.
- Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
- The project is licensed under the [MIT License](LICENSE).

## Roadmap

Implemented in v0.2.0: schema normalization, projection, JSONL transport/journal safety, snapshot reconciliation, and a Hermes adapter foundation.

Remaining work:

1. Add executable integration examples and conformance fixtures for supported adapters.
2. Integrate an adapter into a host product only with that product’s reviewed ownership and UI contracts.
3. Complete publication, release ownership, and public-listing prerequisites.

No public package release or directory listing has been submitted.
