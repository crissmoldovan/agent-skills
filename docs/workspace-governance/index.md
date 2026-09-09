# Workspace Governance

v0.1 is an **unpublished, read-only release candidate**, not a checkout reconciler
or workflow executor. Use the [portable skill](../../skills/workspace-governance/SKILL.md)
for agent procedure and the [library/CLI guide](../../packages/workspace-governance/README.md)
for exact installation, signatures, flags and limitations.

## Architecture

- `packages/workspace-governance/src/core.ts`: bounded strict JSON, schema/graph
  validation, canonical identities, coherent snapshot validation, visibility,
  policy/constraint/workflow resolution. No filesystem or subprocess imports.
- `stores.ts`: file and memory read-only adapters; injected `SnapshotStore` port
  permits trusted host adapters without dynamic code loading or fallback.
- `discovery.ts`: explicit-root local Git observation and independent fixed-host
  paginated GitHub observation. No remote calls in plan/audit/verify-plan.
- `planner.ts`: pure deterministic preview and whole-plan comparison over supplied
  snapshots/inventory; Node path/hash operations only, no filesystem or subprocesses.
- `cli.ts`: file-store composition, strict command/flag parsing, JSON and exit codes.
- `skills/workspace-governance`: independently copyable procedure with its own
  references. Installing it does not install the CLI. No host-specific agent state.

Read [the consolidated normative S1–S9 specification](specification.md). It carries
only generic requirements and synthetic examples. A root describes one coherent
authority; no automatically discovered user settings or embedded organization
roster. Library `$defaults`/`$invocation` are reserved synthetic provenance labels,
not real catalog node IDs. Bound checks count the outermost JSON value at depth0;
ancestry permits at most32 nodes. Generic JSON traversal permits200,000 visited
values; manifest records additionally total at most20,000. Schemas document
structural constraints; runtime handles graph, uniqueness, byte/depth bounds and
resolution semantics. JSON Schema cannot detect duplicate keys after decoding.

## Acceptance and verification

From the repository root, run `npm run verify` on Node24+. It explicitly prepares
and verifies both independent runtime packages; the repository does not use npm
workspaces. New package tests run offline with synthetic fixtures and real
throwaway local Git repositories. No live personal or organization inventory is
part of the public fixtures.

| Acceptance | Executable evidence surface |
|---|---|
| A1 strict identity, hierarchy and schema | `test/core.test.ts`, `test/schema.test.ts`, `test/adversarial.test.ts` |
| A2 merge algebra, constraints, provenance | `test/resolution.test.ts`, `test/adversarial.test.ts` |
| A3 chosen workflow overlay and steps | `test/workflow.test.ts`, CLI/consumer workflow probes |
| A4 intersecting visibility and safe denial | `test/workflow.test.ts`, `test/planner.test.ts`, `test/cli.test.ts` |
| A5 coherent defensive stores | `test/stores.test.ts` |
| A6 contained read-only Git discovery | `test/discovery.test.ts`, `test/boundaries.test.ts`, `test/connector-limits.test.ts` (real Git, worktrees, index, sentinel, fixed argv/env, metadata and core.worktree escapes) |
| A7 bounded fixed-host pagination | `test/github.test.ts`, `test/connector-limits.test.ts` (offline runner, continuation/error/repetition/100-page bound) |
| A8 deterministic scoped previews/CLI | `test/planner.test.ts`, `test/cli.test.ts` |
| A9 isolated tarball CLI/library/types | `scripts/verify-package.mjs`, run by package verify |
| A10 portable skill/root integration | root `test/workspace-governance-skill.test.mjs`, catalog tests and skill validator |

Paths in the first nine rows are relative to `packages/workspace-governance`.
Runtime test output, independent attack corpus results and complete verify logs
are task-local artifacts, not committed inventories. Test counts should be read
from current execution, not copied from a stale release note. Live GitHub smoke is
optional and requires an explicitly approved public owner; it is not a CI gate.
A11 independent code review belongs to the integrating maintainer before commit;
this implementation's own tests are not an independent review.

## Release and deferred scope

Root package version is unchanged. The independent package starts at0.1.0 with
`private:true`; no publish/install lifecycle scripts, no global install, commit,
push or publication is implied by verification. Local tarball consumers prove
JavaScript, declarations, bin, schema, example, README and license ship together.

File/memory authorization is advisory; trusted-host enforced full snapshots are
subject-bound, not a client authentication mechanism. Scoped remote stores are
unsupported. Preview hashes are observation-level freshness, not signatures,
content-level change detection, upstream Git freshness or OS isolation.

Future work: authenticated apply/CAS/fencing/idempotency/recovery journals, guarded
checkout/adopt/move, real workspace bindings, allowlisted executable workflow
steps and gates, remote scoped storage/auth/cache/revocation, dependency revision
vectors, typed cross-project ACL references, YAML, platform adapters and Windows
subprocess/path tests. No pretend command or executor stub ships for these.
