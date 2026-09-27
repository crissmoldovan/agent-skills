# Policy and safety contract

Workspaces v0.2.0 through M3/A07 includes isolated schema-v2 setup, guarded import,
catalog editing, selected discovery, checkout lookup/adoption, and read-only v2 rule resolution.
The existing v1 engine remains a separately labelled legacy surface. A07 defines workflows but
does not execute them, activate hosts, mutate checkouts, or auto-load A08 context.

## A03 document model

The selected config is YAML or JSON and names absolute file-store paths for a
catalog and machine-local state, one plans directory, and explicit trusted roots.
Selection order is explicit `--config`, environment, XDG, then the conventional home
path; no broad search occurs. Catalog and local-state documents are canonical JSON.
All active documents carry `schemaVersion: 2` and an exact `documentType`.

A catalog contains organization/area/project groups, one record per canonical
repository identity, explicitly configured sources, typed policies/workflows, and metadata. Unclassified
repositories are first-class records with `primaryGroupId:null`; absolute checkout
paths never live in the portable catalog. Machine-local workspace overlays remain in local state.

Local state is a separate document. A03 records only the selected config and empty
repository/coordination workspace, overlay, approval, plan, and run collections. Initialization
creates no checkout binding, so public list readback reports every repository's
workspace state as `unknown`.

JSON and YAML accept the same plain JSON value model. Input is bounded by bytes,
depth, aggregate values, keys, and strings. JSON duplicate keys and non-finite
numbers refuse. YAML duplicate keys, aliases/anchors/merge aliases, warnings, and
non-core/custom tags refuse; no executable value is constructed.

## Plans, approval, and current inputs

A03 write plans use `workspacectl-plan/1`. Their semantic digest covers kind, input
revisions, repository IDs, request, actions, preconditions, expected outputs, and
required approvals; the plan ID derives from that digest. A saved plan is inert data
and grants no permission. Legacy `approved` or activation fields are preserved only
inside migration provenance.

`init` requires absent selected config/catalog/local-state files plus existing real
parent/plans/trusted-root directories. Preview creates only a new private plan file
inside the selected plans directory. Apply requires the exact plan ID, re-derives
against current absence and paths, checks every target lock before the first write,
performs document CAS, and reads back every resulting document. It does not scan,
import, or activate anything.

`import-v1` requires a valid selected setup whose catalog still equals the empty A03
catalog. Preview reads but never rewrites the two source files, hashes their exact
bytes, converts them in memory, and saves only a new plan. Apply re-reads/re-hashes,
re-derives the same semantic conversion, checks current config/catalog/local-state
revisions, writes only the catalog by CAS, and reads back config/catalog/local state.
An edited plan or changed source/config/catalog/state is stale and requires a new
preview; missing approval cannot write.

## Store and lock boundary

`CatalogStore.read()` and `LocalStateStore.read()` return document, revision,
capabilities, and freshness. An absent document has revision `absent`; present
revisions are `sha256:` plus the canonical-JSON digest. Compare-and-swap validates
the complete next document and preserves the current document on revision conflict.
Memory and file stores share the same conformance behavior. Tests also register an
independently implemented async adapter through the public interface; this is not a
production remote backend claim.

File CAS exclusively creates a sibling `.lock`, rechecks the revision while holding
it, writes a same-directory private 0600 temporary, fsyncs, and atomically renames.
Every pre-existing lock—including malformed or apparently stale ownership—returns
`BUSY`; it is not deleted. Read-only operations acquire no write lock. A write
requires explicit CAS support and current freshness. Read-only capability returns
`UNSUPPORTED`; unknown capability or stale/unknown data returns `UNTRUSTED_INPUT`.
Adapter names come from a trusted in-process registry; repository-supplied module
paths are never loaded.

## Lossless bounded import

The classified input must be `workspace-governance/v1`; the sidecar must be
`workspace-governance/unclassified-repositories-v1`. Validate literal GitHub remote
or owner/repository tokens before canonicalizing. Never repair malformed values.

Legacy domains become organizations. Namespace nodes are omitted from business
ancestry, while descendants reconnect to the nearest retained organization/area/
project. Existing group and classified repository IDs, labels/slugs, remotes, source
records, and top-level metadata are retained as migration provenance. A namespace
label does not establish GitHub owner type, so A03 creates no active source and keeps
`sourceId:null`. Sidecar IDs are deterministic hashes of canonical identity and are
collision-checked. Reasons and evidence remain in each unclassified record.

A duplicate/conflicting canonical identity returns `CONFLICT`. Any workspace node,
non-default access/visibility meaning, nonempty policy/workflow collection, or other
unsupported nonempty semantic record returns `UNSUPPORTED` with bounded unmappable
details. Nothing nonempty is silently discarded.

## A07 rule and workflow boundary

Resolution order is base, user, organization, outer-to-inner areas, selected legal project,
repository, workspace, invocation. Workflow settings precede ordinary settings at each scope;
constraints accumulate. The retained merge algebra enforces list/type/dotted-prefix behavior.
Named records and steps merge by stable ID. Required removals, mandatory conflicts, unknown
removals, incompatible workflow I/O, missing dependencies, and cycles return `POLICY_CONFLICT`.

Carried policies retain source repository/path/revision/content digest and resolve at their
declared source scope. Repository additions remain repository overrides. Explicit source JSON is
canonicalized and compared with both the declared digest and carried payload digest; matching/drift
is reported without writing either copy. Workflow steps, commands, URLs,
references, and skills remain inert data; A07 never grants trust or executes them.

## Preserved legacy safeguards

The retained v1 principal and local file/memory snapshots are advisory, not
authentication. Audience restrictions intersect through ancestry. Policy operations
and constraints fail on type/conflict errors instead of choosing a value. Only an
explicitly selected workflow contributes, and all resolved actions remain inert
with `executable:false`.

Legacy local observation requires an explicit real root, refuses symlink ancestry
and unsafe/external Git metadata, suppresses optional Git writes/config, and refuses
executable filters. Bounded traversal failures report incomplete rather than proving
absence. Placement previews match canonical remotes, retain duplicate/dirty facts,
and compare a fresh whole observation, but are neither approval nor a security
boundary.

## A11 checkout and operation boundary

Checkout plans bind one canonical catalog identity, resolved remote commit/ref attachment,
absent trusted destination, exclusive sibling staging path, all registry revisions, operation
ID, effects, expected binding, and exact approval. Apply uses ordinary Git HTTPS/SSH
credentials without persisting them, disables hooks, does not recurse submodules, and runs no
repository scripts or installers. Branches attach; tags/commits detach. Origin, HEAD, files,
attachment and non-pointer LFS content are verified before publish and registry CAS/readback.

The compact journal records exact targets and outcome outside repositories. Interrupted or
ambiguous effects retain staging/data and become `needs-attention`; no recursive cleanup or
blind replay exists. Show re-inspects exact targets read-only. Reconcile can only preview a
separately approved binding repair for an already complete exact checkout with no partial
staging. It cannot clone, rename, delete, overwrite, change branches, or infer approval.

## A12 isolated-worktree boundary

Worktree list is read-only. Create binds one selected primary, exact base commit, new branch,
absent disjoint trusted path, registry revisions and exact approval. Apply re-derives those facts,
disables hooks, verifies common Git metadata plus HEAD/branch, CAS-registers the worktree, and
reads it back without changing primary branch/index/files.

Removal accepts only a known persisted worktree ID plus explicit inactivity confirmation. Preview
and apply recheck clean complete content, remote reachability of HEAD, common-metadata and origin
identity, locks/prunable markers, host links and observed active process cwd. Ordinary non-force
`git worktree remove` affects only that path; branch retention and binding removal are read back.
No branch deletion or `git worktree prune` exists. Dirty, unpushed, busy, foreign, stale, unsafe,
colliding or identity-mismatched targets refuse.

## Deferred scope

The current slice does not move/stash/push checkouts, execute workflows, install
skills, or synchronize a remote backend. Those require later schemas, explicit plans and
acceptance. No success authorizes a live portfolio or default-profile change.
