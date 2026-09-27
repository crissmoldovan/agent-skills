# M2/A03 setup, store, and import contract

This is the bounded first M2 slice. It implements isolated setup, persisted document stores,
lossless v1-plus-sidecar import, and catalog readback. It does **not** implement remote/local
discovery, group editing, checkout lookup/adoption, rules/context resolution, workflow execution,
or host activation.

## Documents and limits

All active documents use `schemaVersion: 2`. JSON and YAML accept the same plain JSON data model.
Configuration is YAML or JSON; catalog, local state, and saved plans are canonical JSON files.
Input is UTF-8, depth is at most 32, and a document is at most 2 MiB (configuration at most
256 KiB). Strings and object keys are at most 16,384 code points; aggregate values are bounded
at 200,000. YAML duplicate keys, aliases, merge aliases, and non-core/custom tags are rejected.
JSON duplicate keys and non-finite numbers are rejected. No executable value is constructed.

The executable schemas are in `schemas/v2/`; synthetic valid and invalid examples are in
`test/fixtures/v2/`.

### `workspacectl/config`

`{schemaVersion, documentType, catalog, localState, plans, trustedRoots}`. Catalog and local-state
selectors are `{adapter:"file", path:ABSOLUTE}`. Plans are `{directory:ABSOLUTE}`. Trusted roots
are unique absolute existing directories. Adapter names come from a trusted in-process registry;
repository-supplied module paths are never loaded.

### `workspacectl/catalog`

`{schemaVersion, documentType, groups, repositories, sources, policies, workflows, metadata}`.
Groups are organization/area/project records with stable IDs. Repositories retain one literal,
validated GitHub remote and are unique by canonical identity; unclassified rows are first-class
with `primaryGroupId:null`. A03 requires `policies` and `workflows` to remain empty because M3 owns
their final v2 semantics.

### `workspacectl/local-state`

Machine-local data is a separate document. A03 creates `selectedConfig` plus empty repository and
coordination workspace, overlay, approval, plan, and run collections. It creates no checkout
binding, so imported repositories read back with `workspaceState:"unknown"`.

### `workspacectl-plan/1`

A plan contains `{schemaVersion, format, id, kind, createdAt, inputRevisions, repositoryIds,
request, actions, preconditions, expectedOutputs, approvalsRequired, semanticDigest}`. The digest
covers kind, input revisions, repository IDs, request, actions, preconditions, expected outputs,
and required approvals. `id` is `plan-` plus the first 32 digest hex characters. Old approval or
activation fields are data provenance only and never satisfy `approvalsRequired`.

## Store and CAS boundary

`CatalogStore.read()` and `LocalStateStore.read()` return
`{document, revision, capabilities, freshness}`. An absent file is
`{document:null, revision:"absent"}`. Current document revisions are
`sha256:<canonical-json-sha256>`. Capabilities declare read support and
`compareAndSwap` as `supported`, `read-only`, or `unknown`; freshness is `current`, `stale`, or
`unknown`.

`compareAndSwap(expectedRevision, nextDocument)` validates the whole next document and returns the
new revision. Memory and file adapters use the same behavior. File CAS takes a short sibling
`.lock` with exclusive creation, validates the current revision while holding it, writes a 0600
same-directory private temporary, fsyncs, and atomically renames. Any pre-existing lock—including
unknown or apparently stale ownership—returns `BUSY` and is not removed. Revision mismatch returns
`CONFLICT` without changing the document. Read-only operations never acquire the lock. A write is
refused unless freshness is current and CAS capability is explicitly supported.

## Installed CLI slice

Preview commands persist only the explicitly named new plan file; they do not change active
catalog, config, local state, checkout state, source files, or host settings.

```text
workspacectl init [--config FILE] --catalog FILE --state FILE \
  --plans-dir DIR --trusted-root DIR --plan FILE [--json]
workspacectl import-v1 [--config FILE] --manifest FILE \
  --unclassified FILE --plan FILE [--json]
workspacectl apply [--config FILE] --plan FILE --approve PLAN_ID [--json]
workspacectl list [--config FILE] [--json]
workspacectl config export --target catalog [--config FILE] [--json]
workspacectl doctor [--config FILE] [--skill FILE] [--json]
```

Config selection remains `--config`, `WORKSPACECTL_CONFIG`, `XDG_CONFIG_HOME`, then the conventional
home path. `init` requires a genuinely absent selected config and absent destination documents.
`apply` requires the exact current plan ID, re-derives the plan from current inputs, checks all
revisions and source digests, applies CAS, and reads back the written documents. Missing approval
is `APPROVAL_REQUIRED`/exit 4; changed inputs are `STALE_PLAN`/exit 3; CAS or identity conflicts and
busy locks are exit 5.

`import-v1` accepts a validated `workspace-governance/v1` classified manifest plus
`workspace-governance/unclassified-repositories-v1`. It maps legacy domains to organizations,
removes namespaces from business ancestry, reconnects descendants to the nearest retained group,
and preserves exact legacy records and top-level metadata as migration provenance. Source IDs stay
null because namespace labels do not establish GitHub owner type. Existing classified IDs are
preserved. Sidecar IDs are deterministic hashes of canonical identities and collision-checked.
Any malformed literal remote/token, duplicate/conflicting canonical identity, unsupported nonempty
policy/workflow collection, or nonempty unmappable access semantics refuses before a plan is saved.
The import destination must be the empty catalog created by this slice; originals are read-only.

JSON successes identify the command, plan/revisions, counts, and readback. JSON errors are
`{ok:false,error:{code,message,details?}}`. Exit codes are 0 success, 2 invalid/config/unsupported,
3 incomplete/stale, 4 approval/trust required, 5 conflict/busy, and 6 action failure.
