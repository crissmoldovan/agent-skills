# Policy and safety contract

Declare one authority with a user or organization root. User may parent
organization; organization/area may parent area/project; project parents repository;
repository parents an unbound workspace. No session node or multiple parents.
Stable IDs are separate from mutable path slugs and canonical GitHub remotes.
A logical organization may span hosting owners. Inventory does not invent ancestry.

Settings are flat dotted keys; prefix overlaps fail. Defaults precede ancestry,
explicit invocation follows it. At each scope, the selected workflow contributes
before ordinary policy. CLI defaults/invocation editing is not exposed.

| Merge | Rule |
|---|---|
| replace | Any bounded JSON, including null |
| deep-merge | Objects recurse; same-type leaves replace, arrays replace; type conflicts fail |
| append | Arrays concatenate |
| set-union | Canonical JSON equality, first appearance retained |
| keyed-merge | Arrays of unique-id objects; matching IDs deep-merge, new IDs append |
| remove | Existing whole field removed; no value property |

Inherited constraints never disappear: equals, forbidden-values, required-members
evaluate final settings including invocation. Missing equals/required-members fail;
missing forbidden-values passes. Contradictory constraints fail rather than picking
a winner. Source identity is node plus workflow-or-policy plus constraint ID.
Field-operation provenance includes removals; it is not per-leaf tracing.

Workflow step IDs are stable. A present step fully replaces at the inherited
position, a new step appends, `{id,remove:true}` removes an existing step. A removed
step readded later appends. Duplicate IDs within a layer and missing tombstones
fail. Only an explicitly selected workflow contributes. Actions are inert text;
all resolved definitions and placement plans are executable:false.

Audience is the intersection of ancestry restrictions; omitted rules inherit and
public descendants cannot widen parents. Root visibility is explicit. Local file
and memory snapshots are advisory and principal selection is not authentication.
Trusted hosts may supply a complete enforced authority bound to an authenticated
subject, but must never deliver that authority to an untrusted client. v0.1 rejects
partial/stale/scoped snapshots. No automatic plugin loading or failure fallback.
Catalog omits opaque metadata. Readable policy/workflow author text is shared,
not sanitized for arbitrary hidden strings. Global revisions may reveal changes.

Scanning requires a real explicit root, no symlink ancestors, and contained real
Git metadata before subprocesses. Fixed Git argv suppress hooks/fsmonitor/optional
locks/global config; inherited GIT_* is removed and GIT_WORK_TREE is bound to the
inspected checkout. Before status, reject effective clean/process filter keys,
including conditional includes and enabled worktree config, with a generic
incomplete scan error; status can otherwise execute those commands. `unsafePaths`
includes all non-directory obstructions, not only symlinks, so regular-file
ancestors block targets while ordinary directories remain usable.
Preserve metadata path spaces: stripping more than the file
terminator could validate a different path than Git reads. Never traverse symlinks. Linked
worktrees are supported only when checkout and metadata share the root. Traversal
skips .git, node_modules, dist, coverage, .cache, .next and .turbo. Bound depth and
entry/output/time limits fail completeness instead of proving absence.

Plans match exact canonical remotes, include only readable selected repository
facts, and refuse scopes with hidden descendants. Unsafe/occupied wrong targets and
dirty sources block. Duplicate clones remain duplicate with a dirty flag. Paths
are root plus ancestry slugs excluding user/workspace. A fresh whole-preview
comparison detects observed changes, not every content edit. This is neither an
OS sandbox against concurrent changes nor approval authenticity.

Future mutation needs authenticated authorization, current snapshot CAS, fresh
filesystem preconditions, explicit approval, leases/fencing, idempotency and a
recovery journal. Future execution needs allowlisted argv-based actions, capability
checks, gates and verification. No v0.1 apply, clone, move, automatic stashing,
rollback, push, skill installation, YAML, remote scoped/cache store, multi-store
vectors, workspace binding, or platform-specific agent adapter is implemented.
