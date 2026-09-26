# Install and invoke

## Install or remove this optional skill from the CLI

Run `workspacectl setup` in a real terminal for the install/instructions/skip flow. Project
scope uses the current directory. In automation, diagnose with `workspacectl setup --json`;
an effect additionally requires `--install-skill` or `--remove-skill`, exact `--source` and
immutable `--ref`, one or more real `--agent hermes-agent|claude-code` selections, explicit
`--scope project|global`, and `--yes`. The CLI invokes pinned `skills@1.7.0`, verifies exact
bytes/version/provenance, and refuses unmanaged, modified, or symlink-conflicted targets.
Removing the skill preserves the runtime, catalogs, policies, plans, repositories, and unrelated
skills. Follow reported per-agent recovery commands after a partial third-party result; no
automatic rollback is claimed.

Workspaces v0.3.0 through M7/A16 is an unpublished candidate. Install the portable skill
and CLI separately. A03 setup/import and A04 read-only overviews stay intact; A05
adds revision-checked catalog editing. Do not substitute a registry package, install globally,
or modify an active agent profile while reviewing a candidate. A06 adds deterministic
checkout lookup, explicit primary selection, and registry-only adoption. A07 adds typed
inherited policies/references and inert workflow overrides with provenance.

## Execute inherited workflows

Use `workflow list/show` for the resolved executable view, then `workflow run` with every
required `--input KEY=VALUE`. Preserve the pending tuple exactly. Complete agent work outside
the runner, then call `workflow submit` with the exact run/step/attempt/digest and one or more
absolute regular evidence files. Call `workflow resume`; only independent declared file readback
completes the step. Commands and external handoffs pause for `workflow approve` against the exact
pending digest. External actions are not executed by the package.

```sh
workspacectl workflow list --repo "$REPO" --workspace "$WORKSPACE" --config "$CONFIG" --json
workspacectl workflow show --repo "$REPO" --workspace "$WORKSPACE" --workflow "$FLOW" --config "$CONFIG" --json
workspacectl workflow run --repo "$REPO" --workspace "$WORKSPACE" --workflow "$FLOW" --input task="$TASK" --config "$CONFIG" --json
workspacectl workflow show --coordination "$COORDINATION" --workflow "$FLOW" --config "$CONFIG" --json
workspacectl workflow run --coordination "$COORDINATION" --workflow "$FLOW" --input task="$TASK" --config "$CONFIG" --json
workspacectl workflow submit --run "$RUN" --step "$STEP" --attempt "$ATTEMPT" --digest "$DIGEST" --outcome completed --evidence "$EVIDENCE" --config "$CONFIG" --json
workspacectl workflow approve --run "$RUN" --step "$STEP" --attempt "$ATTEMPT" --digest "$DIGEST" --config "$CONFIG" --json
workspacectl workflow interrupt --run "$RUN" --step "$STEP" --attempt "$ATTEMPT" --digest "$DIGEST" --config "$CONFIG" --json
workspacectl workflow resume --run "$RUN" --config "$CONFIG" --json
workspacectl workflow status --run "$RUN" --config "$CONFIG" --json
```

Waiting and submitted claims are not completion. Any changed selected registry revision,
resolved definition, workspace binding, executable, or absolute argv file makes the saved run
stale. A real failed safe-retry command gets a fresh attempt and approval only after reusable
checks are revalidated. For an approved effect interrupted in flight, use `workflow interrupt`,
then bound `workflow submit --outcome completed|not-completed|unknown` with inspected evidence;
unknown remains blocked and not-completed creates a fresh approval-bound attempt. See
`packages/workspace-governance/docs/m6-a13-contract.md`, `m6-a14-contract.md`, and
`m6-a15-contract.md` in the reviewed source. Coordination runs require exact persisted members,
repository-local contexts/cwds, independently verified outputs, and inert per-carrier rule proposals.

## Build and install the CLI

From the reviewed `packages/workspace-governance` source directory, use Node.js 24+
and trusted Git:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run verify
mkdir -p "$ARTIFACT_DIR"
npm pack --ignore-scripts --pack-destination "$ARTIFACT_DIR"
./scripts/install-local.sh \
  --archive "$ARTIFACT_DIR/ACTUAL_TARBALL_NAME.tgz" \
  --prefix "$ISOLATED_ROOT/versions/0.3.0" \
  --launcher "$ISOLATED_ROOT/bin/workspacectl"
"$ISOLATED_ROOT/bin/workspacectl" --help
```

Use the exact tarball name printed by `npm pack` and explicit absolute paths. The
version prefix must end in `0.3.0` and be absent. The installer accepts an absent
launcher or replaces only a regular launcher carrying its managed marker. It
refuses symlinks, directories, and unrelated occupied files. It binds the exact
Node runtime used for installation and requires Git/npm, but installs neither.
Lifecycle scripts stay disabled.

The archive includes the exact `yaml@2.9.1` runtime dependency; it does not include
the skill. Install the reviewed `skills/workspace-governance` directory through the
host's normal skill mechanism as a separate explicit action. For candidate checks,
pass its source or isolated installed `SKILL.md` to doctor; do not change the default
profile.

Default doctor is a **standalone CLI** check and does not select or read a skill.
Use `--integration --skill FILE` to check the matching reviewed skill for Codex or
another supported agent; it is not Hermes-only.

## Create a new isolated setup

Create the parent/config/data/state/plans/trusted-root directories yourself. The
config, catalog, local-state, and plan files named below must not exist. All paths
are absolute; every plan file must be directly inside `--plans-dir`.

```sh
workspacectl init \
  --config "$CONFIG" \
  --catalog "$CATALOG" \
  --state "$STATE" \
  --plans-dir "$PLANS" \
  --trusted-root "$TRUSTED_ROOT" \
  --plan "$PLANS/init.json" \
  --json
```

The preview creates only the exclusive 0600 plan file. It prints `applied:false`,
selected config, and a `workspacectl-plan/1` plan. **Nothing was applied.** Review
all paths, absent input revisions, actions, expected outputs, semantic digest, and
`approvalsRequired`, then supply its exact ID:

```sh
workspacectl apply \
  --config "$CONFIG" \
  --plan "$PLANS/init.json" \
  --approve PLAN_ID_FROM_PREVIEW \
  --json
workspacectl doctor --integration --config "$CONFIG" --skill "$SKILL" --json
```

Apply checks the exact approval, re-derives the plan against current paths and
absence, checks all sibling locks before writing, performs per-document CAS, and
reads back config/catalog/local state. Init does not scan a home directory, import
repositories, bind checkouts, or activate a host.

## Import v1 plus the unclassified sidecar

The initialized destination catalog must still be empty. Inputs must be separate
regular JSON files and are read-only:

- classified manifest: `apiVersion: workspace-governance/v1`
- sidecar: `apiVersion: workspace-governance/unclassified-repositories-v1`

```sh
workspacectl import-v1 \
  --config "$CONFIG" \
  --manifest "$V1_MANIFEST" \
  --unclassified "$V1_UNCLASSIFIED" \
  --plan "$PLANS/import.json" \
  --json
```

The preview saves only a new 0600 plan. Review source SHA-256 digests, current
config/catalog/local-state revisions, complete counts and IDs, and the single
catalog CAS action. Legacy approval/activation fields are migration provenance and
never satisfy the new approval.

The importer maps legacy domains to organization groups, removes namespace nodes
from business ancestry, reconnects descendants to the nearest retained group, and
preserves original records/metadata as provenance. Classified repository IDs stay
stable. Sidecar IDs are deterministic canonical-identity hashes. Source IDs remain
null because a namespace does not prove GitHub owner type. Every sidecar row remains
a first-class unclassified repository with its reason/evidence.

It refuses malformed literal remotes, duplicate/conflicting canonical identities,
workspace nodes, non-default visibility/access semantics, and any nonempty legacy
policy/workflow collection. Unsupported meaning is reported; it is not silently
dropped.

```sh
workspacectl apply \
  --config "$CONFIG" \
  --plan "$PLANS/import.json" \
  --approve PLAN_ID_FROM_PREVIEW \
  --json
workspacectl list --config "$CONFIG" --json
workspacectl config export --target catalog --config "$CONFIG"
```

Apply re-reads and hashes both sources, re-derives the semantic plan, checks current
revisions and the destination lock, writes only the catalog by CAS, and reads back
all selected documents. `list` includes every registered repository and reports
`workspaceState:"unknown"`; A03 creates no workspace binding. Text-mode `config
export` emits the editable `workspacectl-edit/1` catalog draft on stdout without
changing the active catalog. With `--json`, it is wrapped in the normal command
result.

## Edit groups and repository classification

Save the complete export to a separate absolute regular file outside the active
documents. The approved positional spelling is:

```sh
workspacectl config validate FILE --config FILE --json
workspacectl config plan FILE --config FILE --plan FILE --json
workspacectl apply --config FILE --plan FILE --approve PLAN_ID --json
```

Validation writes nothing. Planning saves only an inert `catalog-edit` plan. Apply
re-reads the draft, re-derives the plan, checks exact selected-config/draft/catalog
revisions and the catalog lock, performs one catalog CAS, and returns exact readback.

Convenience commands use that same planner/apply route:

```sh
workspacectl group create --kind organization --id ORG --name NAME --slug SLUG --config "$CONFIG" --plan "$PLAN" --json
workspacectl group update --id PROJECT --name NAME --slug SLUG --config "$CONFIG" --plan "$PLAN" --json
workspacectl group reparent --id PROJECT --parent AREA --config "$CONFIG" --plan "$PLAN" --json
workspacectl group show --id PROJECT --config "$CONFIG" --json
workspacectl repo membership --id REPO --project PROJECT --action add --config "$CONFIG" --plan "$PLAN" --json
workspacectl repo classify --id REPO --decision accept --group PROJECT --config "$CONFIG" --plan "$PLAN" --json
workspacectl repo classify --id REPO --decision reject --config "$CONFIG" --plan "$PLAN" --json
workspacectl repo show --id REPO --config "$CONFIG" --json
```

Business groups do not derive from GitHub owners. Organization roots, area/project
parents, cycles, and duplicate sibling slugs are validated before a plan is saved.
Rejected suggestions remain repository rows with `primaryGroupId:null` and
`classification:"unclassified"`; explicit additional project memberships remain.
No catalog edit reads, adopts, moves, or writes a checkout.

## Find and register an existing checkout

```sh
workspacectl where REPOSITORY --config "$CONFIG" --json
workspacectl adopt --repo ID --path PATH --config "$CONFIG" \
  --plan "$PLANS/adopt.json" --json
workspacectl apply --config "$CONFIG" --plan "$PLANS/adopt.json" \
  --approve PLAN_ID --json
workspacectl workspace select-primary --repo ID --workspace WORKSPACE_ID \
  --config "$CONFIG" --plan "$PLANS/primary.json" --json
```

Lookup never chooses an ambiguous alias or duplicate primary. Adoption accepts a
dirty verified checkout and classifies a linked Git worktree separately. Preview
writes only the plan. Apply repeats observation and revision checks, CAS-writes only
local state, and reads it back. It never changes branch, HEAD, index, Git config,
tracked/untracked files, or worktree metadata. Remote mismatch, unsafe/symlink path,
absent repository, stale state, or wrong approval refuses without registry mutation.

## Create, inspect, and reconcile an ordinary checkout

```sh
workspacectl checkout --repo ID --path "$ABSENT_DEST" [--ref branch:NAME|tag:NAME|commit:SHA] \
  --config "$CONFIG" --plan "$PLANS/checkout.json" --json
workspacectl apply --config "$CONFIG" --plan "$PLANS/checkout.json" --approve PLAN_ID --json
workspacectl operation show OPERATION_ID --config "$CONFIG" --json
workspacectl operation reconcile OPERATION_ID --config "$CONFIG" \
  --plan "$PLANS/reconcile.json" --json
```

Preview binds the exact canonical remote, resolved commit, attachment, absent destination,
sibling staging path, registry revisions, and operation ID without cloning. Apply uses ordinary
Git authentication, disables hooks, avoids submodule recursion, verifies origin/ref/files and
LFS materialization, publishes only to an absent destination, then registers and reads back the
binding. It serializes no credentials. Interrupted staging is retained. Show is read-only;
reconcile refuses ambiguity and emits only a separately approved binding-repair plan for an
already verified exact destination. See `docs/m5-a11-contract.md`.

## Move one supported registered checkout

```sh
workspacectl move WORKSPACE_ID --to "$ABSENT_DEST" --confirm-inactive \
  --config "$CONFIG" --plan "$PLANS/move.json" --json
workspacectl apply --config "$CONFIG" --plan "$PLANS/move.json" --approve PLAN_ID --json
workspacectl operation show OPERATION_ID --config "$CONFIG" --json
workspacectl operation reconcile OPERATION_ID --config "$CONFIG" \
  --plan "$PLANS/move-reconcile.json" --json
```

Preview/apply support only a clean inactive standalone primary with no linked-worktree
registrations, exact catalog Git identity, absent safe destination, and same-filesystem rename.
Stable repository/workspace IDs remain; only the binding path changes after
destination/source/Git readback. Dirty, busy, collision, nested, linked, submodule, symlink,
mismatched, stale, wrong-approval, and cross-filesystem cases refuse unchanged with no copy
fallback. Linked, locked, stale/prunable, malformed, symlinked, or unreadable registrations in a
main checkout's shared Git metadata also refuse, including when attached after preview. The CLI
never prunes or repairs worktree metadata. If rename succeeds but local-state save fails, public
show reports both paths and binding. Reconcile emits only a separately approved one-CAS binding
repair for the unchanged unambiguous destination; it never moves, copies, deletes, or rolls back.
See `docs/m7-a16-contract.md`.

## Manage isolated worktrees

```sh
workspacectl worktree list --repo ID --config "$CONFIG" --json
workspacectl worktree create --repo ID --base COMMIT --branch NEW_BRANCH --path "$ABSENT_PATH" \
  --config "$CONFIG" --plan "$PLANS/worktree-create.json" --json
workspacectl apply --config "$CONFIG" --plan "$PLANS/worktree-create.json" --approve PLAN_ID --json
workspacectl worktree remove --workspace WORKSPACE_ID --confirm-inactive \
  --config "$CONFIG" --plan "$PLANS/worktree-remove.json" --json
workspacectl apply --config "$CONFIG" --plan "$PLANS/worktree-remove.json" --approve PLAN_ID --json
```

List is read-only and labels exact registered paths as owned. Create binds an unambiguous
registered primary, exact present base commit, new branch, absent disjoint trusted path and
registry revisions. Apply freshly re-derives, disables hooks, verifies common Git metadata,
HEAD/branch and binding readback, and leaves primary branch/index/files unchanged.

Remove accepts only a persisted worktree ID and requires the explicit inactivity assertion.
Both preview and apply refuse dirty/incomplete, unpushed, locked/prunable, active, foreign,
identity-mismatched, stale or ambiguous targets. Apply uses no force, verifies the branch remains,
and never deletes a branch or globally prunes. See `docs/m5-a12-contract.md`.

## Observe selected sources and roots

A source must already be a validated catalog record with an explicit GitHub owner
and `ownerType` (`organization` or `user`). Use the complete A05 draft route for source edits.
Choose source IDs and absolute local roots explicitly; every root must be at or below
one of the configured `trustedRoots`. Selections apply only to this invocation.

```sh
workspacectl discover --config "$CONFIG" \
  --source SOURCE_ID --root "$ROOT" --depth 8 --max-pages 100 --json
workspacectl list --config "$CONFIG" \
  --source SOURCE_ID --root "$ROOT" --json
workspacectl report --config "$CONFIG" \
  --source SOURCE_ID --root "$ROOT"
workspacectl audit --config "$CONFIG" \
  --source SOURCE_ID --root "$ROOT" --json
```

`--source` and `--root` may repeat. `discover` requires at least one and requires
explicit `--config`; selected `list`, `report`, and `audit` accept the same flags.
`--depth` is 0..32 and only valid with a root. `--max-pages` is 1..100 and only
valid with a source. Selector-free `list` preserves the A03 catalog readback.
Selector-free `report`/`audit` show catalog-only checkout state as unknown.

All four selected commands expose the same `workspacectl-overview/1` fields:
`selection`, registry `revisions`, `coverage`, `groups`, `repositories`, `findings`,
and `summary`. Text is the default; `--json` returns the complete model. Coverage is
`complete`, `partial`, or `unknown`. GitHub coverage is credential-visible and
repository absence is never authoritative for inaccessible private data. The user
endpoint is public-only/private-unavailable and therefore partial for all-repository
coverage. A full final allowed page, interruption, invalid/repeated page, or access
denial retains safe observations and reports bounded errors instead of an empty
success.

Local observation is independent per selected root. It does not follow symlinks or
external Git metadata and refuses executable clean/process filters before status.
An unsafe or untrusted target is explicit unknown coverage and does not erase a
separate safe root. Rows distinguish standalone duplicates from intentional
worktrees, preserve dirty/HEAD/archived/private facts, and leave `checkout.selected`
null. Source defaults are suggestions, never approved business assignments. No
config, catalog, local state, Git index, branch, checkout, credentials, or host state
is written; no selections were persisted.

Selected partial/unknown coverage emits the overview on stdout and exits 3. `audit`
also exits 3 when a decision finding (for example unclassified, suggested, duplicate,
or missing) is present. Other complete read-only overviews exit 0.

## Resolve inherited rules

Author policies and workflows by editing a complete exported `catalog` or `user` draft, or the
selected overlay from `config export --target workspace --workspace ID`; then validate, plan,
approve, and read back through the same route. Resolve without execution:

```sh
workspacectl context REPOSITORY --project PROJECT --workspace WORKSPACE \
  --workflow WORKFLOW --config "$CONFIG" --json
workspacectl explain REPOSITORY commands.test --workflow WORKFLOW \
  --config "$CONFIG" --json
workspacectl context REPOSITORY --source "$SOURCE_BYTES" --config "$CONFIG" --json
workspacectl context REPOSITORY --config "$CONFIG" --load knowledge:REFERENCE_ID \
  --approve-content knowledge:REFERENCE_ID=sha256:DIGEST --json
```

Project selection requires confirmed primary placement or explicit membership; source owner is
irrelevant. `--source` parses bounded source JSON and compares its canonical SHA-256 with both the
declared digest and canonical carried payload digest; it reports matching or drift without writing
either file. `POLICY_CONFLICT` covers required removals, mandatory
conflicts, dotted prefix/type conflicts, and invalid workflow graphs. No flag bypasses it. References
stay linked unless selected with `--load knowledge:ID` or `--load skill:ID`. Selected content resolves
from the declaring source/catalog document, must remain below a configured trusted root through a
bounded identity-checked descriptor, and requires `--approve-content` for its exact current SHA-256
revision. Unknown approvals refuse; externally sourced records require approval at every scope. All
linked text is validated, with invalid optional targets inactive and warned. The default 16,000-byte
display budget is the deterministic 4,000-token equivalent over complete JSON/text; required output
refuses instead of truncating, while optional content remains linked with a warning. Instructions report
loaded, never enforced. All workflow/configuration/reference payloads remain inert and
`executable:false`.

## Open, activate through Hermes, and coordinate

```sh
workspacectl open TARGET --config "$CONFIG" --json
workspacectl open TARGET --host terminal --activate --config "$CONFIG" --json
workspacectl open TARGET --host hermes --activate --config "$CONFIG" --json
workspacectl host acknowledge --action "$ACTION_JSON" --readback "$READBACK_JSON" --config "$CONFIG" --json
workspacectl coordination create --group PROJECT --path "$FREE_NON_GIT_DIR" \
  --plan "$PLANS/coordination.json" --config "$CONFIG" --json
workspacectl apply --plan "$PLANS/coordination.json" --approve PLAN_ID --config "$CONFIG" --json
workspacectl coordination open --id COORDINATION_ID --config "$CONFIG" --json
```

Without `--activate`, `open` is read-only even when `--host` is present. Repository open uses
only the one persisted selected primary; missing or ambiguous selection refuses. Group open
returns the explicit member map and an existing coordination binding when present; it never
creates one. Terminal activation is a launch target, not a claim that another process changed
cwd. Codex live switching remains unsupported in A09.

For Hermes, save the returned exact action JSON outside repositories. The portable skill calls
`desktop_project list`; if the action requests creation, call `desktop_project create` with the
exact name/path; then call `desktop_project switch`. Record one ordered result for every request,
including the Project identity returned by create and the final switched Project ID/name/path, and
run a real tool in that Project to obtain its effective cwd. Write only those observed values to
the readback JSON. `host acknowledge` loads the current config/catalog/local-state revisions,
consumes the persisted pending action once by CAS, verifies the exact ordered native result chain,
requires create and final switch to name the same Project, persists that verified Project ID on the
repository or coordination binding for later list+switch, and verifies the effective tool cwd.
Do not substitute shell `cd`, process cwd, Hermes
internal database/config writes, or an assertion without readback.

Coordination planning requires an absent path below a trusted root and outside every repository.
Apply re-derives members, paths and remote identities, checks revisions and approval, creates only
the declared `WORKSPACE.md` and `members.json`, CAS-writes the binding, and reads back both sides.
Existing destinations, symlink ancestors, stale members, collisions and wrong approval refuse.
Reopen revalidates every persisted member and reports drift without writing. No unregister route
is exposed; never recursively delete a coordination directory.

## Diagnose and selection

```sh
workspacectl doctor
workspacectl doctor --config "$CONFIG" --json
workspacectl doctor --integration --config "$CONFIG" --skill "$SKILL" --json
```

Config selection is `--config`, `WORKSPACECTL_CONFIG`,
`$XDG_CONFIG_HOME/workspacectl/config.yaml`, then
`$HOME/.config/workspacectl/config.yaml`. Default standalone scope ignores
`WORKSPACECTL_SKILL`, performs no skill lookup, returns `selected.skill:null`, and
reports the skill check skipped/not required. Explicit integration requires
`--integration --skill FILE`; no unrelated directories are searched. Doctor is read-only in either scope and checks Node, Git, versioned
installation, config schema, trusted roots, selected stores, and current readable
catalog/local state. Integrated scope also requires matching skill frontmatter. A
missing setup is not ready; a valid selected setup can be standalone-ready without
claiming agent integration readiness.

## Preserved legacy read-only commands

```sh
workspacectl validate --manifest manifest.json --json
workspacectl catalog --manifest manifest.json --principal reader --json
workspacectl explain --manifest manifest.json --node repo --principal reader --json
workspacectl workflow --manifest manifest.json --node repo --principal reader --workflow feature --json
workspacectl discover --root "$SCAN_ROOT" --depth 8 --json
workspacectl discover-github --owner example --json
workspacectl report --manifest manifest.json --node org --principal reader --root "$SCAN_ROOT" --workflow feature --json
workspacectl report --manifest manifest.json --node org --principal reader --root "$SCAN_ROOT" --format html > workspace-report.html
workspacectl plan --manifest manifest.json --node org --principal reader --root "$SCAN_ROOT" --json > legacy-preview.json
workspacectl audit --manifest manifest.json --node org --principal reader --root "$SCAN_ROOT" --json
workspacectl verify-plan --manifest manifest.json --node org --principal reader --root "$SCAN_ROOT" --plan legacy-preview.json --json
```

Choose an approved owner before remote discovery. Save output outside the scan
root. A legacy principal is advisory, workflows/actions are inert, and a placement
preview is not an A03 write plan or approval.

## Refusals and exits

Plan/source/config changes after preview return `STALE_PLAN` and require a new
preview. Missing or wrong approval returns `APPROVAL_REQUIRED`. A stale expected
revision returns `CONFLICT`; every pre-existing lock returns `BUSY` and is preserved.
Malformed/unsupported input returns `INVALID_CONFIG` or `UNSUPPORTED`. Read-only,
unknown, or stale store capability cannot authorize a write.

Exit 0 success; exit 2 invalid/config/unsupported; exit 3 selected incomplete
coverage, audit decision findings, or stale state; exit 4 approval/trust required;
exit 5 conflict/busy; exit 6 action failure. With `--json`, errors use
`{ "ok": false, "error": { "code", "message", "details"? } }`; incomplete overview
results are successes on stdout with exit 3, not error envelopes.
