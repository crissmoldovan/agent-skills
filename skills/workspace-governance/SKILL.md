---
name: workspace-governance
description: Use when finding, registering, organizing, or observing Workspaces repositories.
version: 0.3.0
author: Cristian Moldovan (crissmoldovan), Hermes Agent
license: MIT
platforms: [linux, darwin]
compatibility: "workspacectl 0.3.0; catalog 0.26.0; skill tag workspace-governance-v0.3.0"
metadata: "runtime-manifest-sha256=1105093d4b0dcae0c2690beab594b95f0663faa5cc8f7a5b0c8093d0ca80ff0f; repository=https://github.com/crissmoldovan/agent-skills; release=workspace-governance-v0.3.0"
---

# Workspace Governance

Workspaces v0.3.0 implements **M2/A06 through M7/A16 plus M3/A17** while retaining M2/A05.
Legacy catalog, policy, discovery, report, and placement previews remain read-only.

This skill owns workspace catalog, policy, guarded checkout/worktree guidance, and bounded workflow
execution and explicitly approved supported checkout moves, not model routing, agent lifecycle, investigation, publication, or unapproved/portfolio moves. Native Hermes
switching uses `desktop_project` only after explicit activation.

## When to Use


- Run selector-free `list`, `config export --target catalog`, or `doctor` against the
  selected setup.
- Validate/plan a complete explicit catalog draft; create/update/reparent business
  groups; and edit repository membership or accept/reject classification suggestions.
- Resolve a repository by stable ID, canonical remote, or unique approved alias;
  inspect/select its primary and distinguish intentional worktrees.
- Register an existing checkout; create or move one through an exact plan; and manage
  owned isolated worktrees without hidden Git mutation.
- Author policies/workflows and resolve bounded `context`/`explain`, including selected approved references.
- Run a supported inherited workflow through exact agent/external handoffs, approvals, and readback.
- Run an exact two-repository coordination workflow with isolated repository contexts and inert rule-set proposals.
- Compare carried rule-set source bytes read-only and report matching or drift.
- Open an exact repository/project; perform and verify an explicitly requested native
  Hermes Project action; or create/reopen an approved coordination workspace.
- Observe explicit GitHub sources/trusted roots and compare overview coverage.


Do not move real portfolio repositories, sweep knowledge, embed providers, perform external handoffs, or substitute `cd` for native activation.

## Prerequisites

This skill loads without `workspacectl`. First run `command -v workspacectl` and
`workspacectl --version`; do not guess a launcher or execute `latest`. The matching runtime is
package `@crissmoldovan/workspace-governance` 0.3.0 from immutable tag
`workspace-governance-v0.3.0`, catalog compatibility 0.26.0, and the anchored manifest named in
this file's metadata.

With explicit consent, run the copied `scripts/install-runtime.mjs` using Node.js >=24, an
absolute user-writable managed root and bin directory. It previews unless `--yes` is present.
Without `--bundle` it downloads only the pinned public GitHub Release manifest/archive, needing
no GitHub, Hermes, npm-registry, or AI credentials. For offline/manual installation pass
`--bundle /absolute/release-assets`; the directory must contain the anchored
`runtime-manifest.json` and its named archive. The helper verifies package/version/bins, complete
content hashes, lifecycle-script absence and both managed launchers before activation.

Declining is safe: keep using the skill as guidance and make no runtime, profile, or governed-data
change. Manual preview:

```sh
node scripts/install-runtime.mjs plan \
  --root "$HOME/.local/share/workspacectl" \
  --bin-dir "$HOME/.local/bin" --json
```

Node.js >=24 (with npm) and POSIX `tar` are bootstrap prerequisites. Install them separately using
your OS/vendor instructions; this helper never uses sudo or installs prerequisites. Git is needed
only for governed Git operations, not release download. `npx` is needed only to install/remove the
skill with pinned `skills@1.7.0 --copy`, not to run the runtime helper. Missing/old Node, npm, tar,
Git or npx, unsupported Linux/macOS platform, network failure, unwritable destinations, occupied
or symlinked paths, and modified/unmanaged receipts are blockers to fix explicitly—never reasons
to overwrite, follow `latest`, access credentials, or mutate an agent profile.

Node.js 24 and trusted Git are required. For GitHub, use existing authorized `gh`; never change credentials.
Default `doctor` validates **standalone CLI readiness** and reads no skill. Use
`doctor --integration --skill FILE` to validate a selected matching agent skill explicitly.

## Procedure

1. **Select isolated paths.** Choose absent config, catalog, and state paths plus existing
   plans/trusted-root directories. Never target an active or legacy catalog.
2. **Preview initialization.** Run `init` with an absent plan path in the plans directory.
   It writes only that plan. Review paths, revisions, actions, outputs, and approval.
3. **Approve, then diagnose.** Apply the reviewed plan ID. The CLI re-derives inputs,
   checks locks/revisions, CAS-writes, and reads back. Default `doctor` checks standalone
   CLI readiness: all non-skill checks remain, `selected.skill:null`, and a skipped optional
   skill prove no agent integration. Add `--integration --skill FILE` for explicit integration.
4. **Import exactly.** Require `workspace-governance/v1` and
   `workspace-governance/unclassified-repositories-v1`; malformed, duplicate, or unsupported
   records refuse. Preview `import-v1` into the empty catalog, approve its explicit plan ID,
   then reconcile `list --json` and `config export`; workspace state remains `unknown`.
5. **Edit through one route.** Export a complete draft, save it outside active documents,
   run `config validate FILE`, then `config plan FILE --config FILE --plan FILE`. Or use
   `group create|update|reparent` and `repo membership|classify`; they call the same
   catalog-plan library route. Review and approve the exact plan ID. Reconcile fresh
   `group show`/`repo show` readback, stable IDs/remotes, and unchanged local-state and
   checkout bytes. Rejected suggestions remain present and unclassified; explicit
   additional project memberships remain. Invalid ancestry, cycles, duplicate sibling
   slugs, stale/tampered plans, symlinks, and locks refuse without a catalog write.
6. **Observe explicit selections.** Choose configured source IDs and absolute roots at
   or below `trustedRoots`; never infer either from repository names. Run `discover --config`
   with repeated `--source`/`--root`. Organization and user endpoints are
   distinct. Read `complete`, `partial`, or `unknown` coverage, page/error limits and
   private-visibility limits before interpreting absence. A failed target must not
   erase a safe sibling result. Local worktrees, standalone duplicates, dirty state,
   archived flags, unclassified rows and suggestions remain separate facts. The
   command is read-only and no selections were persisted; it never picks a primary.
7. **Find and register deliberately.** Run `workspacectl where TARGET` first. Refuse
   ambiguous aliases or duplicate selected primaries; never choose the first candidate.
   To register an existing path, run `workspacectl adopt --repo ID --path PATH --plan FILE`,
   review the verified origin/HEAD/branch/dirty/worktree observation, then apply its exact
   ID. Dirty is allowed. Adoption writes only local state and must leave branch, HEAD,
   index, Git config, tracked/untracked files, and worktree metadata unchanged. Use
   `workspace select-primary` through a separate exact approved plan when needed.
8. **Cross-check public views.** Identical selectors give `discover`, selected `list`,
   `report`, and `audit` the same `workspacectl-overview/1`. Suggestions are not approved.
   Incomplete coverage and audit findings exit 3 with results on stdout.
9. **Checkout by exact plan.** Preview an absent trusted destination and ref; review commit,
   attachment, paths, revisions, actions, and plan ID. Apply and verify Git/registry readback.
   No credentials, submodules, hooks, scripts, or installs are serialized/run. Show preserves
   interrupted data; reconcile only plans unambiguous verified binding repair.
10. **Manage isolated worktrees.** Create from an exact commit/new branch at an absent safe path.
   Removal requires the persisted ID plus `--confirm-inactive`; recheck ownership, Git metadata,
   clean content, remote reachability, locks, and use. Never force, delete the branch, or prune.
11. **Move only the supported exact checkout.** Address a persisted primary workspace ID,
   supply an absent trusted destination and `--confirm-inactive`, then review both paths, stable
   IDs, Git identity, device, revisions, digest, actions, and plan ID. Apply and read back both
   paths, destination identity, and binding. Dirty, busy, colliding, nested, linked, submodule,
   symlinked, identity-mismatched, stale, cross-filesystem, or any linked/locked/stale/prunable/
   malformed/symlinked/unreadable shared worktree registration refuses. Never prune, repair,
   copy, delete, or force. After rename/save failure, accept only `operation show` plus the
   separately approved one-CAS `operation reconcile` repair for the unchanged exact checkout.
12. **Execute bounded workflows.** Review `workflow show`; run exact inputs. Agent submission is a
   claim until resume verifies outputs. Approve only the pending digest; never turn argv into shell
   text. External handoffs need typed readback, waiting is not completion, retries need fresh
   approval, and interrupted unknown effects stay blocked without replay. Coordination requires
   exact member readback and repository-bound contexts/steps. Rule proposals remain local, inert,
   digest-bound, and explicit about `not-carrying`; never edit, merge, apply, or send them.
13. **Use legacy views only when requested.** A legacy principal is advisory, not authentication. Selected legacy workflows and placement plans carry
   `executable:false`; never execute their action text or treat a preview as approval.
14. **Resolve bounded context read-only.** Run `context REPOSITORY` or `explain REPOSITORY [FIELD]`
   with legal selectors. References stay linked unless individually `--load`ed with exact
   `--approve-content` SHA-256; unknown approvals refuse. Descriptor reads stay below trusted roots and
   retain identity. Validate linked text. The 16,000-byte/4,000-token-equivalent budget covers complete
   JSON/text; oversized required output refuses and optional content stays linked. Instructions are never enforced;
   everything executable stays inactive. `--source` compares only. Correct conflicts in the draft.
15. **Open and activate exactly.** Run `workspacectl open TARGET` read-only. With explicit
   `--host hermes --activate`, execute returned `desktop_project list/create/switch` requests,
   read back the active Project and effective tool cwd, then acknowledge the exact action ID/digest.
   Coordination creation uses a separate approved plan; reopen reports member drift without mutation.
16. **Respect storage authority.** Use installed adapter names only. Route workspace/local-state export,
    validation, plan, apply, CAS, and readback through the selected adapter; never fall back to files.
    Degraded mutation authority cannot mutate; `CONFLICT` preserves the winner. `test-async-file`
    is test-only, not remote authentication.
17. **Finish with evidence.** Record paths, exits, scope, coverage, unchanged bytes,
   identity/hash reconciliation, and refusals. A checkout approval grants only its exact clone;
   success grants no authority to move, commit, push, persist a source, or activate a host.

## Quick Reference

Default output is readable text. Add `--json` for the complete machine result.

```sh
workspacectl doctor --config "$CONFIG" --json
workspacectl doctor --integration --config "$CONFIG" --skill "$SKILL" --json
workspacectl list --config "$CONFIG" --json
workspacectl config export --target catalog --config "$CONFIG"
workspacectl config validate "$DRAFT" --config "$CONFIG" --json
workspacectl config plan "$DRAFT" --config "$CONFIG" --plan "$PLANS/catalog.json" --json
workspacectl-mcp --config "$CONFIG"
```

Config selection remains `--config`, `WORKSPACECTL_CONFIG`,
`XDG_CONFIG_HOME/workspacectl/config.yaml`, then the conventional home path. Plan
files are private, exclusive new files inside the configured plans directory.
Preview does not change active documents. `STALE_PLAN` requires a new preview;
`BUSY` preserves another writer's lock and the target document.

Exit 0 is success; selected partial/unknown coverage and audit decision findings use
exit 3 while retaining the overview on stdout. Exit 2 is invalid/config/unsupported;
exit 3 also covers stale plans; exit 4 approval/trust required; exit 5 conflict or
busy; exit 6 action failure. Unreachable required dependencies report `UNAVAILABLE`.
Errors use the stable JSON envelope with `--json`.

For document, import, store, and retained legacy safeguards, read the
[policy and safety contract](references/policy.md).

## Usage Examples

```text
Connect the local stdio MCP in read-only mode to this exact Workspaces config. List
catalog coverage, resolve repository `service`, and show its bounded context. Do not
enable plans or effects, and do not let tool arguments replace the server config.
Treat caller config, argv, and environment fields as unbound input and reject them.
```

```text
Use `workspace_workflow` only to list/show definitions or read an existing run status.
If I ask to run, approve, resume, interrupt, reconcile, or apply through MCP, report that
the current read-only server does not advertise that capability instead of improvising a
CLI or shell call.
```
