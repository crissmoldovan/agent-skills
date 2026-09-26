# Workspaces 0.2.0 — through A17

This private, unpublished candidate preserves the accepted M2/A03 isolated setup,
guarded v1-plus-sidecar import, stores, catalog readback, and configured `doctor`.
A04 added read-only observation of explicitly selected configured GitHub sources and
trusted local roots, plus one honest overview shared by `discover`, selected `list`,
`report`, and `audit`. The preserved v1 catalog/policy/discovery/report engine remains
available as a clearly labelled legacy read-only surface. A05 adds revision-checked,
explicitly approved catalog drafts plus group, membership, and classification convenience
commands over the same single-catalog CAS plan route. A06 adds deterministic
repository lookup, explicit primary selection, and guarded registry-only adoption
of existing standalone or linked-worktree checkouts. A07 adds typed catalog policies,
instructions, knowledge/skill references, inert workflow definitions/overrides, deterministic
inheritance, complete provenance, and read-only external-copy drift reporting. A08 loads
bounded relevant context and trusted selected references without executing them. M4/A09 adds
read-only `open`, typed inert Hermes/terminal host actions with exact native Project plus
effective tool cwd acknowledgement, and approved non-Git coordination workspaces.

M5/A11 adds exact approved ordinary checkout creation and interrupted-operation inspection/
reconciliation. M5/A12 adds registered Git worktree listing plus exact approved create/remove
plans. It creates only a new branch from an explicit verified commit at an absent safe path,
and removes only the exact known clean inactive owned worktree after proving no unpushed commit;
the branch remains. It never uses force removal or global prune.

M6/A13 executes bounded inherited workflows through typed context/workspace checks, agent and
external handoffs, approved argv commands, and independent output readback. It does not move
checkouts or mutate a primary branch/index. A shell `cd` is never reported as activation.

M6/A14 persists real command failures with bounded output, revalidates changed output fingerprints
before safe retry, and issues a fresh approval-bound attempt. Completed effects are never replayed.
The public `workflow interrupt` seam records an approved in-flight effect as ambiguous; bound
inspection evidence may resolve it as completed, not completed, or still unknown. Definition,
policy/trust, workspace identity, and executable drift make status stale and invalidate old approval.

M6/A15 runs an exact persisted two-repository coordination binding. Every agent, command,
verification, and output is bound to one named repository/workspace/path and receives shared
project context plus only that repository's local context. A typed `rules.distribute` step emits
one digest-bound, repository-local review proposal per carrying copy and explicit `not-carrying`
rows, but never rewrites, merges, applies, or sends a remote proposal.

M7/A16 adds an exact approved same-filesystem rename for one clean inactive standalone
registered primary checkout that owns no linked-worktree registrations. It preserves stable
repository/workspace identity, rechecks every bound input before mutation, and reads back source
absence, destination Git identity, and the updated binding. Unsupported dirty, busy, colliding,
nested, linked, submodule, symlinked, identity-mismatched, stale, or cross-filesystem cases refuse
without a copy fallback. A main checkout with any linked, locked, stale/prunable, malformed,
symlinked, or unreadable worktree registration also refuses; the CLI never prunes or repairs those
records. Public operation show/reconcile can repair only an unambiguous
rename-success/binding-save-failure.

M3/A17 exposes coherent async catalog and local-state store contracts and routes public
catalog and workspace/local-state export, validation, preview, apply, CAS, and exact-readback
operations through trusted named adapters. File, memory, and an independently implemented async
adapter have semantic parity in conformance tests. The packaged CLI includes `test-async-file`
only as a labelled local test adapter for installed-route testing; it is not a production remote
or authenticated backend. Read-only, stale, partial, offline, and unknown authority cannot
preview or apply a mutation, and a losing CAS preserves the winner without a file fallback.

The 0.3 development candidate contains a bounded MCP stdio server using the pinned official
TypeScript SDK. `workspacectl-mcp --config ABSOLUTE_FILE` is read-only by default and serves
doctor, catalog/group/repository/coverage listing, where, context/explain, read-only open,
workflow list/show/status, and operation show/worktree listing. Immutable startup flag
`--allow-plans` additionally advertises one strict finite planning union. Plans are stored as
private `0600` files under the selected plans directory and returned through opaque identities;
callers cannot select plan paths. `--allow-apply` implies plans and additionally advertises exact
plan apply plus workflow run/submit/approve/resume/interrupt transitions. Effect operations are
serialized per server/config and remain counted until their handler settles even if the protocol
request is cancelled. Workflow approval is only a domain transition, not proof of human identity
or MCP-host authorization. Effect mode is therefore for trusted, approval-mediating clients.
No tool accepts arbitrary argv, config, environment, executable, shell text, or capability change.
All modes emit protocol messages only on stdout and return bounded structured content plus textual
JSON. Generated client configuration must omit both effect flags by default.

## Requirements

- Linux or macOS
- Node.js 24 or newer
- trusted Git on `PATH`
- npm associated with the selected Node runtime

Selected GitHub observation needs trusted `gh` credentials already authorized for
the explicit configured owner. The installer never installs prerequisites or changes
credentials, provider configuration, Hermes settings, Workspaces configuration, or
the separately installed skill.

## Optional agent skill lifecycle

`workspacectl setup` is the explicit CLI-first entry point. Interactive terminals offer
install, exact manual instructions, or skip; EOF, cancellation, a declined final preview,
bare help, and ordinary commands never install. The skill is optional: CLI readiness,
configuration status, skill projections, and MCP registration are reported separately.

Automation is preview-only unless every effect input is explicit:

```sh
workspacectl setup --json
workspacectl setup --source crissmoldovan/agent-skills \
  --ref workspace-governance-v0.3.0 --agent hermes-agent --agent claude-code \
  --scope project --json
workspacectl setup --install-skill --source crissmoldovan/agent-skills \
  --ref workspace-governance-v0.3.0 --agent hermes-agent --agent claude-code \
  --scope project --yes --json
workspacectl setup --remove-skill --source crissmoldovan/agent-skills \
  --ref workspace-governance-v0.3.0 --agent hermes-agent \
  --scope project --yes --json
```

Project scope is the command's current directory; there is no invented `--project` flag.
Global scope remains inside the selected synthetic/user `HOME`, including `HERMES_HOME` and
`CLAUDE_CONFIG_DIR`. The implementation pins `skills@1.7.0`, accepts only the real
`hermes-agent` and `claude-code` IDs in this release slice, resolves remote refs before an
effect, and verifies installed content/version after the third-party command. A local candidate
may use an exact 40-character Git commit whose skill bytes match, or
`local-sha256:<content-digest>` for an immutable unpublished fixture. Mutable refs refuse.

Managed ownership is a private receipt under the selected scope's `.agents/skill-receipts`.
Removal requires that receipt plus matching source/ref/content and exact projection readback;
byte-identical unmanaged directories, modified files, unexpected symlinks, and symlinked path
components refuse. Partial third-party failures report changed and unchanged projections plus
exact per-agent scoped recovery commands; they are never described as rolled back. Skill
removal does not remove the runtime, Workspaces configuration/data, repositories, or unrelated
skills.

## Verify, assemble, and install

Run focused verification from this directory in the reviewed source checkout. Runtime
assembly requires Node.js >=24, its npm, and POSIX `tar`:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check:types
npm run build
npm run assemble:runtime -- --output "$ABSENT_DIRECTORY_OUTSIDE_THE_REPOSITORY"
```

The assembler refuses relative paths, repository-contained paths, and any output path
that already exists. It rebuilds the package, creates one npm archive containing the
complete production dependency closure, and writes `runtime-manifest.json`, its detached
SHA-256 file, and the package lock beside it. The strict manifest identifies package
`0.2.0`, both bins, every archived regular file by SHA-256, all production package
versions/integrities, the archive hash, and compatible skill ref
`workspace-governance-v0.3.0`. It deliberately contains no final source-commit hash; the
package remains the unpublished 0.2.0 development identity until the later release
transition.

A consumer can install the archive without a registry or populated cache:

```sh
npm install --prefix "$DISPOSABLE_CONSUMER" \
  --offline --ignore-scripts --no-audit --no-fund \
  --cache "$EMPTY_CACHE" --registry http://127.0.0.1:9/unreachable \
  "$ABSENT_DIRECTORY_OUTSIDE_THE_REPOSITORY/crissmoldovan-workspace-governance-0.2.0.tgz"
```

`test/runtime-artifact.test.ts` exercises that exact disposable route, then removes the
assembled source artifact before running version/help and a real official MCP client
initialize/list/`workspace_doctor` call against synthetic configuration. This proves a
same-host empty-cache install with an unreachable registry; it is not a network-namespace
or second-host result. Assembly consumes the trusted package manager's own freshly generated
archive. It is not the future untrusted bootstrap: that installer must reject archive
symlinks and hardlinks before extraction rather than relying on this assembler's post-extract
inventory. This is only the first M3 executable artifact slice: it is not a permanent
installer, lifecycle manager, publication, or accepted M3 release.

The retained local installer remains available for its existing development route:

```sh
./scripts/install-local.sh \
  --archive "$ABSENT_DIRECTORY_OUTSIDE_THE_REPOSITORY/crissmoldovan-workspace-governance-0.2.0.tgz" \
  --prefix "$ISOLATED_ROOT/versions/0.2.0" \
  --launcher "$ISOLATED_ROOT/bin/workspacectl"
"$ISOLATED_ROOT/bin/workspacectl" --help
```

Use explicit absolute paths. The prefix must end in `0.2.0` and be absent. The retained
installer verifies package name/version/CLI, installs with lifecycle scripts disabled,
records the exact Node runtime, and creates a stable managed launcher. Paths with spaces
are supported. An unrelated file, directory, or symlink at the launcher path is refused.

The assembled archive contains the locked runtime closure, including `yaml@2.9.1`, the
official MCP server SDK `2.1.0`, and Zod `4.2.1`. It does not install the skill. Install
the reviewed `skills/workspace-governance` directory separately through the target host's
normal mechanism. Candidate verification can pass its exact `SKILL.md` path to doctor
without changing an active profile.

`doctor` defaults to **CLI + agent skill integration** readiness. An explicit
`--skill FILE` may select the reviewed matching skill for any supported agent
integration, including Codex; without it, the existing environment and Hermes-path
fallback remain unchanged. Use `doctor --standalone` only for explicit CLI-only
readiness. Standalone mode does not select or read a skill, ignores
`WORKSPACECTL_SKILL`, reports `selected.skill:null` and a skipped/not-required skill
check, and cannot be combined with `--skill`. Runtime, Git, installation receipt,
configuration, trusted-root, selected-store, catalog, and local-state checks still run.

## Initialize an isolated v2 setup

Create the parent/config/data/state/plans/trusted-root directories first. The config,
catalog, local-state and plan files below must be absent; all paths are absolute.

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

The command creates only a private, exclusive `workspacectl-plan/1` file and returns
`applied:false`. **Nothing was applied.** Review the exact paths, absent revisions,
actions, expected outputs, digest, and required approval, then apply the exact ID:

```sh
workspacectl apply \
  --config "$CONFIG" \
  --plan "$PLANS/init.json" \
  --approve PLAN_ID_FROM_PREVIEW \
  --json
workspacectl doctor --config "$CONFIG" --skill "$SKILL" --json
```

Apply re-derives the plan from current inputs, checks all target locks before the
first write, performs per-document CAS, and reads back config, empty catalog, and
empty local state. Init inventories nothing and creates no checkout or host binding.
A valid selected A03 setup can produce `ready:true` from doctor.

Config precedence is `--config`, `WORKSPACECTL_CONFIG`,
`$XDG_CONFIG_HOME/workspacectl/config.yaml`, then
`$HOME/.config/workspacectl/config.yaml`. Integrated skill precedence remains
`--skill`, `WORKSPACECTL_SKILL`, then
`$HOME/.hermes/skills/workspace-governance/SKILL.md`. Doctor searches no unrelated
directories. Standalone mode performs no skill lookup.

## Import the retained v1 inventory

The destination must be the still-empty catalog created above. Both sources are
separate regular JSON files and remain read-only:

- manifest API: `workspace-governance/v1`
- sidecar API: `workspace-governance/unclassified-repositories-v1`

```sh
workspacectl import-v1 \
  --config "$CONFIG" \
  --manifest "$V1_MANIFEST" \
  --unclassified "$V1_UNCLASSIFIED" \
  --plan "$PLANS/import.json" \
  --json
```

Preview writes only the new plan. It records exact source SHA-256 digests, selected
document revisions, complete repository IDs/counts, and one catalog CAS action.
Review it, then provide its exact plan ID:

```sh
workspacectl apply \
  --config "$CONFIG" \
  --plan "$PLANS/import.json" \
  --approve PLAN_ID_FROM_PREVIEW \
  --json
workspacectl list --config "$CONFIG" --json
workspacectl config export --target catalog --config "$CONFIG"
```

Apply re-reads and hashes both sources, re-derives the conversion, checks current
config/catalog/local-state revisions, CAS-writes only the catalog, and returns exact
readback. `list` includes classified and first-class unclassified repositories;
workspace state is `unknown` because A03 creates no checkout binding. Text-mode
`config export` emits a `workspacectl-edit/1` draft on stdout without changing the
active catalog. A05 validates and plans that complete draft as described below.

The importer preserves classified IDs, literal valid remotes, labels/slugs, reasons,
evidence, and source/top-level records as migration provenance. Domains become
organizations; namespaces leave business ancestry and descendants reconnect to the
nearest retained group. Namespace labels do not prove GitHub owner type, so imported
`sourceId` values remain null. Unclassified IDs are deterministic hashes of canonical
identity. Old activation or approval fields are provenance, never new consent.

Malformed literal remotes, duplicate/conflicting identities, workspace nodes,
non-default access semantics, and nonempty policies/workflows refuse rather than
being repaired or dropped. A changed plan/source/config/revision is stale; a missing
approval cannot write; a pre-existing lock returns busy and is preserved.

## Edit the catalog through one revision-checked route

`config export --target catalog` is the only command that emits a complete editable draft.
Save stdout to a separate absolute, regular, non-symlink path outside the active config,
catalog, and local-state files. Validation writes nothing; planning writes only a new plan
inside the configured plan directory:

```sh
workspacectl config export --target catalog --config "$CONFIG" > "$DRAFT"
workspacectl config validate FILE --config "$CONFIG" --json
workspacectl config plan FILE --config FILE --plan FILE --json
workspacectl apply --config "$CONFIG" --plan "$PLAN" --approve PLAN_ID --json
```

The literal `FILE` operands above are positional paths. Apply re-reads the draft, re-derives
the exact plan, checks the selected config and expected catalog revision, performs one catalog
CAS write, and reads back the persisted catalog. Changed drafts/plans/configs or stale catalog
revisions refuse. Wrong or absent approval, symlinked paths, and existing locks do not write.

Convenience commands produce the same `catalog-edit` plan and never write until that plan is
applied with its exact ID:

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

Organizations are roots; areas nest only under organizations or areas; projects parent only
to organizations or areas. Duplicate sibling slugs, missing/invalid parents, and cycles refuse.
Repository business grouping is independent of GitHub source owner. Rejecting a suggestion
retains the repository and remote identity as an unclassified row. These operations never read,
move, or write a checkout.

## Find and register existing checkouts

```sh
workspacectl where REPOSITORY --config "$CONFIG" --json
workspacectl adopt --repo ID --path PATH --config "$CONFIG" --plan "$PLANS/adopt.json" --json
workspacectl apply --config "$CONFIG" --plan "$PLANS/adopt.json" --approve PLAN_ID --json
workspacectl workspace select-primary --repo ID --workspace WORKSPACE_ID \
  --config "$CONFIG" --plan "$PLANS/primary.json" --json
```

`where` resolves an exact stable ID, canonical GitHub remote, or unique
case-insensitive approved alias. Ambiguous aliases and duplicate selected primaries
refuse with deterministic candidates. The result keeps standalone primary bindings
and intentional linked worktrees distinct. Primary selection is an explicit
`workspace-primary` plan; it is never inferred from array or discovery order.

`adopt` verifies one existing checkout inside a configured trusted root, including
origin, HEAD, branch, dirty status and worktree kind. Dirty checkouts are accepted.
Preview writes only an inert plan; approved apply re-observes the checkout,
re-derives the semantic plan, checks config/catalog/local-state revisions, performs
one local-state CAS, and reads it back. It does not clone, fetch, clean, checkout,
stage, change Git config, modify worktree metadata, or write checkout files. Remote
mismatch, unsafe/symlink paths, absent repositories, stale revisions and wrong
approval refuse without changing active registry or checkout bytes. See
`docs/m2-a06-contract.md` for the exact boundary.

## Create an ordinary checkout

```sh
workspacectl checkout --repo ID --path "$ABSENT_DEST" --ref branch:main \
  --config "$CONFIG" --plan "$PLANS/checkout.json" --json
workspacectl apply --config "$CONFIG" --plan "$PLANS/checkout.json" --approve PLAN_ID --json
workspacectl operation show OPERATION_ID --config "$CONFIG" --json
workspacectl operation reconcile OPERATION_ID --config "$CONFIG" \
  --plan "$PLANS/reconcile.json" --json
```

Omit `--ref` for the advertised default branch; explicit `branch:NAME` stays attached,
while `tag:NAME` and `commit:SHA` detach. Preview resolves and binds the exact remote
commit but does not clone. Approved apply uses existing Git HTTPS/SSH authentication,
an exclusive sibling staging directory, no submodule recursion, and no hooks/setup/install
scripts. It verifies canonical origin, HEAD, attachment, files, and materialized LFS content
before publishing to the still-free destination and CAS-registering/read-backing the binding.
Credentials are never serialized. Failed/interrupted staging data is preserved.

`operation show` re-inspects only recorded exact targets. `operation reconcile` refuses
ambiguous partial effects and creates only an inert separately approved local-state binding
repair when an existing destination already proves the complete recorded outcome. See
[the A11 contract](docs/m5-a11-contract.md).

## Move one supported checkout

```sh
workspacectl move WORKSPACE_ID --to "$ABSENT_DEST" --confirm-inactive \
  --config "$CONFIG" --plan "$PLANS/move.json" --json
workspacectl apply --config "$CONFIG" --plan "$PLANS/move.json" --approve PLAN_ID --json
workspacectl operation show OPERATION_ID --config "$CONFIG" --json
workspacectl operation reconcile OPERATION_ID --config "$CONFIG" \
  --plan "$PLANS/move-reconcile.json" --json
```

Only a clean inactive standalone registered primary with no linked-worktree registrations may
move, by same-filesystem rename to an absent symlink-free trusted path. Preview and apply bind and
recheck stable IDs, both paths, Git identity, filesystem device, revisions, digest, exact approval.
Apply preserves the workspace ID while updating only its path and independently reads back both
filesystem and registry state. There is no copy/delete/force fallback. Dirty, busy, collision,
nested, linked, submodule, symlink, wrong-identity, stale, and cross-filesystem cases refuse before
rename. Linked, locked, stale/prunable, malformed, symlinked, and unreadable registrations in the
main checkout's shared Git metadata are all unsafe; neither preview nor apply prunes or repairs them.
If rename succeeds but binding save fails, public show exposes both actual paths and binding;
reconcile can emit only a separately approved single-CAS binding repair for the unchanged exact
checkout. See [the A16 contract](docs/m7-a16-contract.md).

## Manage isolated worktrees

```sh
workspacectl worktree list --repo ID --config "$CONFIG" --json
workspacectl worktree create --repo ID --base COMMIT --branch NEW_BRANCH \
  --path "$ABSENT_PATH" --config "$CONFIG" --plan "$PLANS/worktree-create.json" --json
workspacectl apply --config "$CONFIG" --plan "$PLANS/worktree-create.json" --approve PLAN_ID --json
workspacectl worktree remove --workspace WORKSPACE_ID --confirm-inactive \
  --config "$CONFIG" --plan "$PLANS/worktree-remove.json" --json
workspacectl apply --config "$CONFIG" --plan "$PLANS/worktree-remove.json" --approve PLAN_ID --json
```

Listing is read-only and distinguishes persisted owned bindings from foreign Git worktrees.
Creation requires one unambiguous registered primary, an exact locally verified base commit,
a new valid branch, and an absent path below a trusted root but outside the primary. Apply
re-derives every bound input, disables hooks, creates the worktree, verifies Git common metadata,
HEAD/branch/path, CAS-persists the binding, and reads both back without changing primary branch,
index, or files.

Removal addresses only a persisted worktree ID and requires `--confirm-inactive`. Preview and
apply both recheck origin/common-metadata identity, exact registration, branch attachment,
clean complete tracked/untracked content, no Git lock/prunable state or observed active process,
and that HEAD is reachable from a current remote ref. Dirty, unpushed, busy, foreign, stale,
unsafe, colliding, or identity-mismatched targets refuse. Apply invokes ordinary non-force
`git worktree remove`, verifies the path/binding are gone and the branch remains, and never runs
`git worktree prune`. See [the A12 contract](docs/m5-a12-contract.md).

## Execute an inherited workflow

```sh
workspacectl workflow list --repo REPO --workspace WORKSPACE --config "$CONFIG" --json
workspacectl workflow show --repo REPO --workspace WORKSPACE --workflow FEATURE --config "$CONFIG" --json
workspacectl workflow run --repo REPO --workspace WORKSPACE --workflow FEATURE \
  --input task=DESCRIPTION --config "$CONFIG" --json
workspacectl workflow show --coordination COORDINATION --workflow FEATURE --config "$CONFIG" --json
workspacectl workflow run --coordination COORDINATION --workflow FEATURE \
  --input task=DESCRIPTION --config "$CONFIG" --json
workspacectl workflow submit --run RUN --step STEP --attempt ATTEMPT --digest DIGEST \
  --outcome completed --evidence "$EVIDENCE" --config "$CONFIG" --json
workspacectl workflow approve --run RUN --step STEP --attempt ATTEMPT --digest DIGEST \
  --config "$CONFIG" --json
workspacectl workflow resume --run RUN --config "$CONFIG" --json
workspacectl workflow status --run RUN --config "$CONFIG" --json
```

The runner accepts only its typed action registry. Agent and external steps return a bound
handoff; submit records a claim, while resume independently reads declared outputs. Commands
use one absolute executable plus argv, exact workspace cwd, named environment variables,
timeout and expected exit, never a shell. Commands and external effects require the exact
pending approval. Changed config/catalog/local-state, resolved workflow, workspace binding,
executable, or absolute argv files make an existing run stale. Waiting is not completion.
External publication/deployment is a host handoff only; the package performs no remote action.
See [the A13 contract](docs/m6-a13-contract.md).
For exact two-member context and rule-proposal semantics, see [the A15 contract](docs/m6-a15-contract.md).

## Selected-source discovery and shared overview

Source selection is by existing validated catalog ID, never an owner guessed from a
repository name. Root selection is by explicit absolute path at or below a configured
trusted root. `--source` and `--root` repeat; selections are transient and read-only.

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

`discover` requires explicit `--config` and at least one selector. `--depth` is 0..32
and requires a root; `--max-pages` is 1..100 and requires a source. Duplicate or
relative selections, unknown source IDs, and unused controls refuse before
observation. An absolute untrusted or unsafe root remains visible as unknown coverage
and does not block an independently selected safe target.

GitHub organizations use `/orgs/OWNER/repos` with `type=all`; users use
`/users/OWNER/repos` with `type=owner`. Pages contain at most 100 records and continue
until a short page. A full final allowed page is partial, not complete. A first-page
denial/failure is unknown; interruption or invalid/repeated data after complete pages
is partial and retains those pages. Coverage is credential-visible, raw runner text is
not returned, and absence of an inaccessible private repository is never authoritative.
The user endpoint cannot observe private repositories and is therefore partial for
all-repository coverage even after a short page.

Local Git observation stays bounded and sanitized: no symlink traversal, metadata outside
configured trusted roots, optional locks, executable clean/process filters, home-wide
fallback, or index write. A narrowly selected linked worktree may use its external
per-worktree/common Git metadata only when each exact resolved metadata path remains
inside a configured trusted root. Rows distinguish standalone duplicates from
intentional worktrees and show HEAD, dirty state and remote availability. The overview keeps archived/private,
registered/observed-only, confirmed/suggested/unclassified, approved group and
source-default suggestion fields separate; source ownership never assigns a business
group. `checkout.selected` remains null.

For identical selectors, all four commands expose identical `selection`, `revisions`,
`coverage`, `groups`, `repositories`, `findings`, and `summary` under
`workspacectl-overview/1`; only command/presentation and observation timestamps may
differ. Text is default and `--json` emits the complete machine result. Selected
partial or unknown coverage is returned on stdout with exit 3. `audit` also exits 3
for decision findings; complete `discover`/selected `list`/`report` exit 0. Selector-free
`list` preserves A03 readback, while selector-free `report`/`audit` are catalog-only
with checkout state unknown. No selection, classification, primary, or observation is
persisted; no repository lifecycle action follows.

## Resolve inherited rules and workflow overrides

Author complete policy and workflow records through `config export --target catalog`, `--target
user`, or `--target workspace --workspace ID`, followed by validate, plan, exact approval, and
readback. Settings are flat dotted keys; plain settings replace and explicit operations append,
set-union, keyed-merge, or remove. Named instructions, knowledge references, skills, and workflow
steps merge by stable ID. Required removals, mandatory conflicts, type/prefix conflicts, unknown
step removals, missing dependencies, and cycles return `POLICY_CONFLICT` before an approved draft
can write.

```sh
workspacectl context REPOSITORY --project PROJECT --workspace WORKSPACE \
  --workflow WORKFLOW --config "$CONFIG" --json
workspacectl explain REPOSITORY commands.test --workflow WORKFLOW \
  --config "$CONFIG" --json
workspacectl context REPOSITORY --config "$CONFIG" --source "$SOURCE_BYTES" --json
workspacectl context REPOSITORY --config "$CONFIG" \
  --load knowledge:ARCHITECTURE \
  --approve-content knowledge:ARCHITECTURE=sha256:DIGEST --json
```

Precedence is base, user, organization, ancestor areas outer-to-inner, selected legal project,
repository, workspace, invocation. At each scope selected-workflow settings apply before ordinary
settings. Hosting owner never selects a business project. JSON includes every setting operation,
constraint, named record, step add/replacement/removal, scope, and external provenance. `--source`
parses bounded source JSON and compares its canonical SHA-256 with both declared provenance and the
canonical carried payload; matching/drift is reported without rewriting either source or catalog.
Commands, URLs, skills, and steps remain data and are
never activated. A08 keeps references linked unless individually selected with `--load`; relative
paths resolve from the declaring source/catalog document, and only symlink-free files below configured
trusted roots may be read. Selected content requires `--approve-content` for its exact current SHA-256
revision and still remains inactive. Required and optional textual targets are validated while linked;
invalid optional targets stay inactive with warnings. Reads use bounded descriptors and reject path
drift. The deterministic default display budget is 16,000 UTF-8 bytes (the documented 4,000-token
equivalent) over the larger complete JSON/default-text rendering; required output refuses with
`INCOMPLETE` instead of being truncated, while optional content stays linked with a warning. Natural-language instructions are
`loaded`, never enforced. Cross-repository callers use `resolveProjectContexts` for one shared project
context and distinct repository contexts without local-rule mixing. The executable output schema is
`schemas/v2/resolved-context.schema.json`; see [the A08 contract](docs/m3-a08-contract.md).
Draft-07 schemas describe individual A07 records; runtime validation owns the
document-wide uniqueness, ancestry, required-removal, constraint, and graph invariants listed in
the schema comments. See [the A07 contract](docs/m3-a07-contract.md).

## Open targets and coordinate projects

```sh
workspacectl open TARGET --config "$CONFIG" --json
workspacectl open TARGET --host hermes --activate --config "$CONFIG" --json
workspacectl host acknowledge --action "$ACTION" --readback "$READBACK" --config "$CONFIG" --json
workspacectl coordination create --group PROJECT --path "$FREE_DIR" \
  --plan "$PLANS/coordination.json" --config "$CONFIG" --json
workspacectl apply --plan "$PLANS/coordination.json" --approve PLAN_ID --config "$CONFIG" --json
workspacectl coordination open --id COORDINATION_ID --config "$CONFIG" --json
```

Plain `open` verifies the selected checkout and loads A08 context without a host action.
Hermes activation output is inert: the portable skill must execute `desktop_project list`,
`create` only if needed, and `switch`, then obtain active Project identity/path and effective
tool cwd from a real tool. Acknowledgement binds both to the exact action ID/digest; shell
`cd`, wrong Project/path, stale action, or cwd mismatch refuses. Coordination creation is a
revision-bound approved plan into an absent trusted non-Git directory. It generates only
`WORKSPACE.md` and `members.json`, persists the binding by CAS/readback, copies no source,
and reopen reports every missing, changed, ambiguous, or foreign member without mutation.

## Preserved legacy read-only engine

```sh
workspacectl validate --manifest examples/example.json --json
workspacectl catalog --manifest examples/example.json --principal reader --json
workspacectl explain --manifest examples/example.json --node repo --principal reader --json
workspacectl workflow --manifest examples/example.json --node repo --principal reader --workflow feature --json
workspacectl discover --root "$SCAN_ROOT" --depth 8 --json
workspacectl discover-github --owner example --json
workspacectl report --manifest examples/example.json --node org --principal reader --root "$SCAN_ROOT" --workflow feature --json
workspacectl report --manifest examples/example.json --node org --principal reader --root "$SCAN_ROOT" --format html > workspace-report.html
workspacectl plan --manifest examples/example.json --node org --principal reader --root "$SCAN_ROOT" --json > legacy-preview.json
workspacectl audit --manifest examples/example.json --node org --principal reader --root "$SCAN_ROOT" --json
workspacectl verify-plan --manifest examples/example.json --node org --principal reader --root "$SCAN_ROOT" --plan legacy-preview.json --json
```

Choose an approved owner before remote discovery and save reports/previews outside
the scan root. A principal remains advisory, not authentication. Legacy workflow
actions and placement previews remain inert with `executable:false`; they are not A03
write plans or approval.

## Errors, library, and verification

JSON errors are `{ok:false,error:{code,message,details?}}`. Incomplete overview
coverage is instead a successful result on stdout with exit 3. Exits are 0 success;
2 invalid/config/unsupported; 3 incomplete/stale/audit decision; 4 approval/trust
required; 5 conflict/busy; and 6 action failure.

The package exports schema-v2 validators, safe JSON/YAML parsing, catalog/local-state
file and memory stores, the trusted named adapter registry, plan creation/apply, v1 conversion,
catalog list/export helpers, GitHub/local discovery, and the shared overview builder
and observer alongside the preserved legacy library. File stores
use private temporaries, sibling locks, atomic rename, revision CAS, and exact
readback. An independent async adapter is exercised through the public interfaces in
tests; it is not a production remote-store claim. See [the A17 storage contract](docs/m3-a17-contract.md).

```sh
npm run check:types
npm test
npm run build
npm run verify:package
```

`npm run build` removes `dist` before compiling. `verify:package` packs and installs
a fresh isolated consumer, exercises init/import/apply/catalog readback/doctor,
checks packaged A05 commands/contracts/schema, selected-source overview exports, and
the legacy/library/declaration surface, verifies
`yaml@2.9.1`, and confirms retired output is absent. The exact contracts are
[M2/A05](docs/m2-a05-contract.md), [M2/A04](docs/m2-a04-contract.md), retained
[M2/A03](docs/m2-a03-contract.md), and the
[M1 shell](docs/m1-cli-contract.md).
