# Workspace Governance 0.1.0

## Working workspace report

The first useful path is one command that combines the declared hierarchy,
observed local checkouts, placement drift, inherited policy provenance and the
selected inert workflow:

```sh
workspacectl report --manifest example.json --node org --principal reader \
  --root "$SCAN_ROOT" --workflow feature

# Optional self-contained visual report; write it outside the scan root.
workspacectl report --manifest example.json --node org --principal reader \
  --root "$SCAN_ROOT" --workflow feature --format html > workspace-report.html
```

JSON is the default (`--format json` is equivalent). The report accepts a user,
organization, area, project or repository scope. The selected node and its complete
descendant subtree must be readable or the whole report refuses with `UNAVAILABLE`;
ancestors included in the report are readable. HTML is a self-contained visual
rendering of key report fields, not a lossless JSON serialization. Report output is
deterministic and read-only: it does not classify unknown repositories, clone or
move checkouts, enforce policy, or execute workflow action strings.

## Observational strict-trial status

```sh
workspacectl mutation-status --state-dir /private/fixture/state --operation-id init-example
```

`readMutationStatus(stateDir, operationId)` and the installed command read only
strict **initial trial** ledgers. A `workspace-governance/init-trial-setup-result-v1`
response with `state: "verified"` means a bounded consistent observation found
complete event/evidence/result linkage and matching safe current final files.
It does **not** attest that an earlier fsync succeeded, grant execution, or qualify
a deployment. Visible complete records may verify after writer death or fsync
failure. An immutable `result.json` alone is only a candidate: status remains
`interrupted`, possibly while the writer is alive. Corruption, ambiguous ownership
or final drift returns `needs-attention` with only validated prefix action facts.
Unknown operation IDs return `UNAVAILABLE`; insufficient saved intent or a snapshot
that changes across the one permitted retry returns `RECOVERY_REQUIRED` (exit 3).
Other status errors use the existing static error envelope; no paths are disclosed.
A successfully observed result uses exit 0, including interrupted/needs-attention.

No helper/controller launch, lock, fsync, registry read/reservation, current issuer,
current trial lifetime, external request, credentials, Git, or network is needed.
All authority captures are historical data, never renewed authority. Ordinary/full
and development ledgers are not promoted into trial history. Recovery is not
implemented by this command and no records, temporaries or locks are repaired.

The Linux reader holds no-follow read-only descriptors through snapshot validation,
requires safe owner-controlled ancestry/private bookkeeping and final file modes,
and checks current original final-parent identities and supported mount topology.
It rejects unsafe types/links, foreign members, contradictory publication slots,
noncanonical records, semantic proposal forgeries and incomplete chain linkage.
Bounds remain 256 events, 2 MiB per plan/record, 64 KiB context, 262144 decoded bytes
per ordinary capture (2 MiB only for the saved approved plan), 2 MiB aggregate
capture/payload records and 16 MiB operation reads. Inventory is bounded; no
truncation establishes completeness. Historical engine trees not reconstructible
from saved file resources (for example unrepresented empty directories) refuse
conservatively. These checks retain the trusted single-user/quiescent-host model,
not protection from a hostile same-UID writer or a storage durability qualification.

## Full read-only candidate-trial planning

```sh
workspacectl manifest-init-trial-plan --install-root /private/helper-install --candidate /private/candidate.json --intent /private/intent.json
```

This emits the complete `workspace-governance/init-trial-setup-plan-v1` JSON
(`executable:false`), not a relabeled preview. A separately provisioned and pinned
native controller independently reads the candidate, immutable intent, request,
real resources and environment, derives policy/actions/bookkeeping and the digest,
and repeats capture before returning. No locks, registry writes or candidate
launch occur while planning. The existing `manifest-init-plan` preview is unchanged.

The fixed operator sidecar selects the native controller; no executable override,
ambient PATH lookup, qualification fabrication or install hook is provided. See
`native/setup-helper/TRIAL-CONTROLLER.md` in source for the closed candidate/intent
encoding and operator provisioning. After reviewing and approving the exact digest,
the operator can separately issue/reserve using that controller. Reservation remains
unconditionally fail-closed with `UNSUPPORTED_LAUNCH`; this command does not enable
apply/recover, N-API startup authority, helper admission or deployment qualification.


Unpublished, private release candidate: a read-only TypeScript ESM library and
`workspacectl` CLI. No runtime dependencies. Linux with Node.js 24+ and Git is the
verified platform; macOS POSIX paths are expected but untested. Windows support
is not claimed. GitHub discovery additionally needs a trusted `gh` executable and
credentials authorized to read the explicitly chosen organization.

## Build and install the CLI separately

From this package directory in a source checkout:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run verify
npm pack --ignore-scripts --pack-destination "$ARTIFACT_DIR"
npm install --prefix "$CONSUMER_DIR" --ignore-scripts --no-audit --no-fund "$TARBALL"
"$CONSUMER_DIR/node_modules/.bin/workspacectl" --help
```

Set the three variables to explicit, user-approved local locations. `TARBALL` is
the actual file printed by `npm pack`. Do not substitute a registry package:
this candidate is **not published**. The portable skill installer does not install
this CLI. No global install, lifecycle install scripts, or automatic configuration.

## Commands

All successful data is JSON on stdout, except help/version and
`report --format html`. Errors are static
`{"error":{"code":"INVALID","message":"Invalid input."}}`-shaped JSON on
stderr; no input excerpts or tool stderr. Unknown/duplicate flags are rejected.

```sh
workspacectl --help
workspacectl --version
workspacectl validate --manifest example.json
workspacectl catalog --manifest example.json --principal reader
workspacectl explain --manifest example.json --node repo --principal reader
workspacectl workflow --manifest example.json --node repo --principal reader --workflow feature
workspacectl discover --root "$SCAN_ROOT" --depth 8
workspacectl discover-github --owner example
workspacectl report --manifest example.json --node org --principal reader --root "$SCAN_ROOT" --workflow feature
workspacectl plan --manifest example.json --node org --principal reader --root "$SCAN_ROOT"
workspacectl audit --manifest example.json --node org --principal reader --root "$SCAN_ROOT"
workspacectl verify-plan --manifest example.json --node org --principal reader --root "$SCAN_ROOT" --plan preview.json
```

The packaged [example](examples/example.json) is synthetic. Do not issue its remote
discovery command unless you deliberately choose that public organization.
`--workflow ID` is supported by explain, workflow, report, plan, audit and verify-plan; only
workflow requires it. Plan/audit/verify-plan also accept `--depth N` (default 8,
range 0–32); report accepts the same bound. They perform fresh **local** discovery
internally, never GitHub calls.
Save a plan using explicit shell redirection outside the scan root, then verify it
with the **same explicit** scope/principal/root/workflow. The saved plan cannot
choose these resources. No `--human`, apply, execution, clone, move or override CLI.

Exit 0: success (including a valid plan with drift). Exit 2: invalid, unavailable,
unsupported or tool failure. Exit 3: incomplete discovery, audit drift or stale
preview. Audit returns the plan fields plus `drift`; incomplete plans print no
partial stdout. Administrative raw discover may return an incomplete inventory
with exit 3. Validate and raw discovery are operator-local administrative commands,
not principal-filtered views.

## Native-verified init preview (read-only milestone)

```sh
workspacectl manifest-init-plan --manifest "$MANIFEST_PATH" --request "$REQUEST_PATH" \
  --state-dir "$STATE_DIR" --executor-profile "$PREVIEW_PROFILE"
```

All four paths are explicit absolute paths, without traversal or symlinks; parents
must already exist with non-group/world-writable ancestry. Input regular files
must be owned by the caller, single-link and not group/world writable. Nothing
creates the manifest, state, locks or journal. Do not repair existing permissions.
Linux x86-64 only for this command. Other legacy commands are unchanged.

Provision the separate `workspacectl-init-helper` binary explicitly. The npm
package does not bundle, build, download or auto-select it. The **planning-only**
profile has exactly this shape (replace the illustrative path and hash):

```json
{"apiVersion":"workspace-governance/init-preview-profile-v1","helper":{"path":"/approved-install/bin/workspacectl-init-helper","sha256":"<64 lowercase hexadecimal characters>"}}
```

The request is the existing `workspace-governance/init-request-v1` object with
`authorityId` and one explicit `rootNode` including visibility. A restricted root
needs declared readers, but this command does not choose or authenticate a reader.
The output is `{nativeVerified:true,plan:...}`. Its plan is deliberately tagged
`workspace-governance/init-preview-plan-v1`, `executable:false`, and
`policyStatus:"proposed-not-authority"`. The proposed init policy fingerprints the
validated manifest revision and complete empty settings/constraints/provenance;
its `allowed:true` is **not** operator approval or permission to mutate.

The installed CLI captures bounded input bytes, hashes the explicitly pinned
helper and rederives the preview in TypeScript. It invokes that helper over a
private fd3 Unix-stream socketpair using Node's child-process transport, empty
helper environment, cwd `/` and null standard IO. Native independently derives
and compares every preview field using the existing Rust authoring engine and
its own executable hash. Frames are bounded to 2 MiB, with one request followed
by write-side EOF, duplicate/extra-key defenses, ancillary-FD refusal and bounded
read/write deadlines. No helper child execution or filesystem writer is exposed.
Byte-identical existing manifests yield a null action; different occupied bytes
refuse unchanged. A preview is observational, not a resource reservation.

This is an executable **planning interface**, not the frozen qualified
`init-setup-plan-v1`, N-API authority launcher, deployment qualification or
candidate-trial authority. In particular this precursor runs native pure
verification during planning; the eventual qualified data-only planning surface
is not implemented by this transport. Full native filesystem recapture,
under-lock checks, profile/runtime/issuer validation, approval, journal,
cancellation/recovery and status integration remain required before apply.
Native preview `apply`/`recover` requests always return `UNSUPPORTED`; other
production/trial families are not admitted. No policy amendment is activated.

## Model and trust boundary

- One authority has one user or organization root with explicit visibility.
  A user may parent organizations; an organization cannot parent a user.
  Organization/area → area/project; project → repository; repository → workspace.
  No session nodes. Logical organization need not equal a hosting organization.
- Node IDs are stable; slugs and remotes are mutable declarations. `$defaults` and
  `$invocation` are reserved synthetic provenance sources. Workspace identities
  are **unbound** catalog nodes: policy resolution works, workspace-scope plans
  are unsupported. Observed Git worktrees do not create catalog identities.
- Manifest, observed inventory and local runtime bindings are separate. Only
  manifests belong in version control; never commit real inventories or secrets.
  A [JSON Schema](schemas/manifest.schema.json) describes structural validation.
  Runtime additionally enforces duplicate JSON keys, byte/depth/aggregate bounds,
  graph parent legality/cycles, uniqueness, canonical identity and merge semantics.
- File and memory snapshots are **advisory**. Local `--principal` is visibility
  simulation, not authentication. File access already gives access to all bytes.
  Effective readership intersects ancestor restrictions; descendants cannot widen it.
  Catalog emits only id/kind/slug/parentId. Metadata is opaque and not projected.
  Readable policy/workflow text is intentionally shared; authors must not embed
  hidden names/secrets. No arbitrary string redaction or hidden-change guarantee.
- Trusted hosts may inject a `SnapshotStore` with complete enforced authority
  snapshots and an authenticated bound `subject`. Only the trusted host core may
  receive those complete snapshots; do not deliver them to untrusted clients.
  Enforced snapshots reject a different requested principal. Subject-filtered
  remote projections and dependency-closure protocols are **unsupported**.
  Adapter failures never fall back. Authorization labels cannot authenticate a
  malicious manifest or untrusted adapter.

## Library

```js
import {
  FileSnapshotStore, loadSnapshot, resolvePolicy, discoverLocal,
  createPlan, verifyPlan, createReport,
} from '@crissmoldovan/workspace-governance';
const snapshot = await loadSnapshot(new FileSnapshotStore(manifestPath));
const options = { workflowId: 'feature' };
const resolution = resolvePolicy(snapshot, 'repo', 'reader', options);
const inventory = await discoverLocal(scanRoot, { depth: 8 });
const plan = createPlan(snapshot, inventory, 'org', 'reader', options);
verifyPlan(plan, snapshot, inventory, 'org', 'reader', options);
const report = createReport(snapshot, inventory, 'org', 'reader', options);
```

Public declarations ship with the package. `validateManifest(unknown)` returns a
defensive manifest; `parseJson(text)` is the bounded duplicate-safe parser.
`validateSnapshot(unknown)` validates and copies the full envelope.
`MemorySnapshotStore(manifest)` and `FileSnapshotStore(path)` implement
`SnapshotStore.readSnapshot(): Promise<unknown>`; `loadSnapshot(store)` validates
its output. Envelope keys: manifest, revision, complete:true, stale:false,
authorization:advisory|enforced, coverage:authority, subject:null|string.
Memory revisions hash canonical manifests; file revisions hash exact captured UTF-8
bytes. Revisions are opaque change signals, not authentication or upstream Git
freshness. Each file call captures the current local file, not a Git sync.

`ancestors(manifest,nodeId)`, `canRead(manifest,nodeId,principal)` and
`visibleNodes(snapshot,principal)` provide hierarchy and fixed visibility views.
`resolvePolicy(snapshot,nodeId,principal,options?)` accepts `workflowId`, `defaults`
and `invocation` (setting arrays). Defaults precede ancestry; invocation follows it.
At each scope selected workflow settings precede ordinary settings. All inherited
constraints evaluate the final values and cannot be removed or bypassed.

Settings are flat dotted fields, with no participating prefix overlap. Merge modes:
replace (any JSON), deep-merge (objects; same-type leaves, arrays replace), append,
set-union (canonical equality, first appearance), keyed-merge (array of objects,
unique stable id, recursive map merge), remove (existing whole field, no value).
Constraints: equals; forbidden-values (missing passes); required-members (final
array contains each member). Constraint identity includes scope and workflow.
Provenance retains every field-level operation, including removals and synthetic
sources; it does not invent per-leaf traces. Workflow steps replace fully by stable
id or use `{id,remove:true}` tombstones; missing removals fail. Arbitrary action
strings are inert, with `executable:false`; nothing evaluates shell or prompts.

`canonicalRemote(input)` accepts only the documented GitHub HTTPS, SCP-style SSH
and ssh:// forms; validates before normalizing to lowercase HTTPS. Manifest remotes
must already equal canonical form. `canonicalJson(value)` sorts object keys by
Unicode codepoint; `digest(value)` is its SHA256. No numeric provider-ID identity
or rename reconciliation is promised.

## Discovery and preview limitations

Local discovery requires an explicit existing real root with no symlink ancestors.
It skips `.git`, `node_modules`, `dist`, `coverage`, `.cache`, `.next`, `.turbo` from
walk coverage. It scans nested repos and internal linked worktrees, never follows
symlinks, and checks gitdir/commondir containment before invoking Git. Traversal is
bounded to 50,000 entries; all subprocess output to 2 MiB, with 30-second timeouts.
Unsafe metadata, missing origin, malformed Git state and depth exhaustion fail
completeness rather than proving absence. Inherited GIT_* variables are removed;
optional locks, fsmonitor, hooks, maintenance, excludes and global config are
suppressed for fixed read-only Git argv. After removing inherited GIT_* variables,
GIT_WORK_TREE is explicitly rebound to the inspected checkout so local core.worktree
cannot redirect status outside it. Before status, effective config names are read
with includes (including conditional includes and enabled worktree config). Any
`filter.<name>.clean` or `.process` key, even unused or empty, fails completeness
with generic `GIT_METADATA_OR_STATUS`; filters are never run or silently disabled.
`unsafePaths` records all non-directory entries, including regular files and
symlinks, so obstructed target ancestors block without blocking valid directories.
Trusted PATH is a prerequisite. This is
best-effort containment, **not an OS sandbox** against concurrent adversaries.

GitHub uses bounded fixed-host organization GET pagination (100 pages maximum).
Malformed, repeated, truncated or failed responses never return partial success.
Unmapped remotes remain unmanaged; no ownership guesses from names. Remote
inventory is an administrative adoption aid, not an authoritative plan input.

Plans and reports require the selected node and its complete descendant subtree to
be readable. An unreadable selected node or descendant refuses the whole scope
generically; ancestors shown in a report are readable. Targets are root plus
ancestry slugs (excluding user/workspace), never collapsed by repeated basename. Statuses: present,
missing-checkout, misplaced, duplicate, blocked. Dirty singleton sources, occupied
wrong targets, unsafe ancestors and case-fold collisions block; duplicates retain
the dirty flag. No remote removal is inferred. Occupied targets report no other
repository identity; status filenames never appear in plans.

`verifyPlan` rederives and compares the entire canonical preview, not just its
hash. Inventory digest is order-independent and includes root, head, status,
remote, dirty/worktree flags and occupancy. Porcelain bytes are first SHA256-hashed
inside the canonical inventory envelope to keep long status blobs distinct from
bounded manifest text fields. The digest reveals a local administrative
change signal without listing unrelated paths. **Observation-level freshness
only:** changed bytes with unchanged HEAD/status may still verify. No approval
authenticity or post-check race safety is implied; future apply must recheck all
state and authorization.

## Deferred

No mutation/executor stubs ship. Apply/CAS/fencing/idempotency/journal recovery,
checkout/adopt/move, workspace bindings, allowlisted executable actions and gates,
remote scoped storage/auth/cache/revocation, multi-store dependency vectors, typed
cross-project ACL references, YAML, Hermes/MCP adapters, and a Windows matrix are
future work. The CLI does not enforce policy on other tools or filesystem access.
