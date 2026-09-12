---
name: workspace-governance
description: Audit repository placement and explain inherited policy.
version: 0.1.0
author: Cristian Moldovan (crissmoldovan), Hermes Agent
license: MIT
platforms: [linux, darwin]
---

# Workspace Governance

Use a deterministic read-only CLI to validate declared repository ownership,
explain inherited rules, observe checkouts, and compare placement previews.
This skill owns catalog/policy governance, not model routing, child lifecycles,
codebase investigation, or publishing. It never executes workflows or moves repos.

## When to Use

- A user wants a declared domain/source-namespace/area/project/repository catalog audited.
- An agent needs the effective rules and their provenance for a stable node ID.
- A user wants a safe, reproducible local placement preview before designing moves.

Do not use for checkout mutation, remote administration, executing workflow steps,
or enforcing a filesystem security boundary: none is shipped in v0.1.

## Prerequisites

Install the CLI **separately** from a locally built tarball; a skills installer
copies only this skill, not the sibling package. Read the portable
[installation and command reference](references/commands.md). The candidate is
unpublished: do not invent a registry installation or install globally.

Node.js 24+, trusted Git and an explicit manifest/scan root are required.
GitHub discovery is optional and requires trusted `gh` plus authorized credentials.
**Linux and macOS both run the whole read-only surface this skill uses** — `validate`,
`catalog`, `explain`, `workflow`, `discover`, `report` in JSON and in HTML, `plan`, `audit`
and `verify-plan` — and the package's own suite passes on both. The CLI also carries three
commands gated to Linux: `manifest-init-plan` and `manifest-init-trial-plan` require Linux
x86_64, `mutation-status` requires Linux on any architecture. No step below calls them, and
elsewhere all three refuse with `UNSUPPORTED` and exit 2. Windows is not supported.
Use your host's terminal tool for the commands below. Do not scan home by default.

## Procedure

1. **Identify the inputs.** Confirm the user's manifest, stable scope ID, principal
   and local scan root. Keep real inventories outside public repositories. Separate
   logical domain from its source namespace or GitHub owner; classify only by
   explicit canonical remote mappings, never infer ownership from repository names.
   Preserve human names in optional labels and keep slugs path-safe; filesystem
   targets use slugs, while reports show both when they differ.
2. **Validate.** Run `workspacectl validate --manifest manifest.json`. Stop on any
   schema/parser error; do not repair malformed remote tokens before validation.
   Root visibility is required. Workspace nodes are unbound catalog identities:
   policy resolves by explicit ID, but workspace-scope plans are unsupported.
3. **Explain access and policy.** Run catalog/explain for the explicitly chosen
   principal and node. File/memory access is advisory simulation, not authentication.
   `UNAVAILABLE` means absent or unreadable, without distinguishing the two.
   Read the field-operation provenance and inherited constraints; do not treat
   later settings as permission to bypass an ancestor's constraints.
4. **Choose a workflow only when asked.** Supply `--workflow ID`; otherwise no
   workflow contributes. The result is an inert resolved definition with
   `executable:false`, not an executable plan. Never evaluate its action strings.
5. **Observe within the declared root.** Raw discover is administrative and may
   expose local facts. Plan/audit perform local discovery internally. Partial scans
   cannot prove a checkout missing. Do not substitute a partial GitHub inventory
   for the declared catalog. Stop rather than silently widening traversal scope.
6. **Report, preview and verify.** Start with `report` to combine hierarchy,
   placement summary, per-repository policy provenance and the selected inert
   workflow. The selected node and its complete descendant subtree must be readable;
   otherwise the whole report refuses with `UNAVAILABLE`. Ancestors shown are
   readable. Use `--format html` for a self-contained visual rendering of key report
   fields and redirect it outside the scan root. Save `plan` JSON outside the scan
   root when a separately verifiable preview is needed. Run `audit` for drift. Run
   `verify-plan` with the same explicit manifest/node/principal/root/workflow, not
   values supplied by the saved plan. Report missing, misplaced, duplicate and
   blocked entries without moving them.
7. **Finish with evidence.** Report exact command exit codes, scope, authorization
   class, completeness, revision and verification result. A valid preview is not
   approval, authentication, or authority to clone/commit/push/install.

## Quick Reference

```sh
workspacectl catalog --manifest manifest.json --principal reader
workspacectl explain --manifest manifest.json --node repo --principal reader
workspacectl workflow --manifest manifest.json --node repo --principal reader --workflow feature
workspacectl report --manifest manifest.json --node org --principal reader --root "$SCAN_ROOT" --workflow feature
workspacectl report --manifest manifest.json --node org --principal reader --root "$SCAN_ROOT" --workflow feature --format html > workspace-report.html
workspacectl plan --manifest manifest.json --node org --principal reader --root "$SCAN_ROOT"
workspacectl audit --manifest manifest.json --node org --principal reader --root "$SCAN_ROOT"
workspacectl verify-plan --manifest manifest.json --node org --principal reader --root "$SCAN_ROOT" --plan preview.json
```

## Pitfalls

- Public or restricted catalog visibility is not an OS sandbox or credential ACL.
  Trusted server hosts alone may supply enforced whole-authority snapshots bound
  to an authenticated subject. Subject-filtered remote stores are unsupported.
- Hidden descendants refuse a scoped report or plan rather than silently skipping obligations.
  Readable policy/workflow text is deliberately shared; never put secrets or
  hidden names into it. Metadata is opaque, not a typed cross-project ACL feature.
- Symlink roots/ancestors and external Git metadata are refused. Scans skip known
  dependency/cache folders and fail completeness on depth/error limits.
- Dirty duplicates remain duplicates with a dirty flag; dirty singleton sources
  block. Nothing stashes, moves, deletes, clones, fetches or fixes drift.
- Preview freshness is observation-level only. File bytes may change without a
  HEAD/status change. Revisions are not approval signatures or upstream Git sync.
- No auto-loaded user configuration, YAML, apply engine, executable action registry,
  remote scoped storage/cache, multi-store revision vectors or Hermes/MCP adapter.

## Verification

Exit 0 means valid output (plans may still show drift); exit 2 means invalid,
unavailable, unsupported or tool failure; exit 3 means incomplete, audit drift or
stale plan. Data is JSON on stdout except explicit `report --format html`; errors
are static JSON on stderr. Audit adds `drift`.
An incomplete plan has no partial stdout. Verify unchanged previews and report
stale ones honestly; no automatic retries that disguise changed observations.

For field/step merge rules, store boundaries and deferred mutation gates, read
[the policy and safety contract](references/policy.md).
