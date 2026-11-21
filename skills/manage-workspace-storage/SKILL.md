---
name: manage-workspace-storage
description: "Plan storage before large builds and retire disposable outputs at closeout. Check context and disk headroom, give each run project-owned scratch, and preserve a small evidence record. Use for Tauri or Rust builds, full browser suites, packaged verification, repeated cold rebuilds, and investigations of growing .context, worktree or artifact storage."
license: MIT
compatibility: "The workflow works wherever the agent can inspect local files and disk usage. The bundled guard and scratch helper require Node.js 22 or newer on macOS or Linux. Git is needed only to inspect or retire Git worktrees. The helper makes no network requests."
metadata: "group=workflow; lifecycle=release; version=1.3.1; author=crissmoldovan"
allowed-tools: Read Grep Glob Bash
---

# Manage workspace storage

Give each run a place for temporary output and a place for its durable result. Retire generated
output when verification closes after a pass, failure, or abandoned attempt. Keep recovery data
for interrupted work until cleanup or restoration is verified.

## When to Use

- A build, browser suite, native test, or packaging run creates large temporary files.
- A project keeps cloning worktrees, reinstalling dependencies, or retaining build output.
- A user asks what filled the disk, what can be recovered, or which project owns a directory.

`derive-codebase-context` owns the documentation agents load. `isolated-change-validation` owns
the proof required to accept a change. `work-in-external-repo` owns selecting another checkout.
Use this skill for the storage those workflows consume and leave behind.

## Prerequisites

1. **Name the project, affected volumes, and scope.** Decide which locations the run owns and
   where its required evidence will live. Read-only inspection and deletion have separate scope.
   **Complete when:** the project and paths come from the actual workspace, and the run has
   no reason to write to another project's directory.

## Procedure

1. **Measure what already exists.** Start with available bytes on the volumes the run uses and
   an allocated-size breakdown of the named directory. Use `inventory` to match a shared
   artifact directory against known project checkouts and managed run records.
   For suspected shared use, check Git worktree registrations, workspace-manager attachments,
   links and mounts, and open or known in-flight operations. Check links into the candidate
   from the known consumers, including ignored dependency directories. A folder name is a
   lead about ownership. Resolve the owner for files kept by another checkout, a container,
   or a running job. For pending runs, follow the launch entrypoint through linked helpers,
   imports and file paths built at runtime. Check the resolved inputs against the proposed
   removals. Use a read-only dependency preflight when the runner can resolve inputs without
   provisioning or starting the job.
   **Complete when:** the baseline and largest contributors are recorded, with uncertainties
   where the evidence does not establish ownership or recoverability.

2. **Keep context small and give disposable output a home.** Use .context for decisions,
   current pointers, checksums, and short status records. Send builds, dependencies, fixtures,
   databases, worktree copies, and bulk logs to project-owned scratch or their appropriate
   managed store. Put required originals in the project's approved durable location.
   Pick the headroom from the actual build and its peak scratch usage. Invoke the guard before
   and after heavy stages on each volume they write to. Use it as a preflight command in a
   recurring workflow where it needs to stop a launch. Correct the storage plan if it refuses.
   At launch, record the owning project, run purpose or ticket, disposable paths, durable
   evidence destination, and cleanup scope. Where the owner permits, include exact run-owned
   cleanup in the launch authorization. Use `start --purpose` when the build can write to
   managed scratch. For a verifier with fixed paths, pair its launch with a cleanup step and
   record the same fields in the launch receipt.
   **Complete when:** the run has its scratch path, evidence destination, and applicable storage
   budget, and the preflight passes.

3. **Retain what you need to resume or verify.** Verify terminal process status and any required
   test-fixture cleanup or restoration. Write a compact record outside scratch with the source
   identity, command, result or failure, and cleanup status. Keep extra captures, recovery
   dumps, and generated deliverables only for an open diagnostic, pending consumer, or required
   retention obligation. Record each retained path, its consumer or reason, and when to release
   it. Read back the retained bytes or confirm the exact revision in the authoritative remote.
   Keep unpublished changes and unique originals in durable storage.
   **Complete when:** the compact record reads back and each retained bulk path has a specific
   purpose and release condition.

4. **Retire the run with a named scope.** Preview the owned scratch run, confirm it is closed and
   its evidence is safe, and apply cleanup within the authorized paths. For an app-managed
   worktree, use the workspace manager's supported archive or removal action after confirming
   what it preserves. Use Git to retire a Git-only worktree. A legacy directory needs its own
   inventory, ownership and recovery checks. Leave shared caches, other projects, and ambiguous
   files in place while those checks are unresolved.
   Run cleanup in the same closeout after the last consumer has finished. Recheck any retained
   path when its release condition is reached. Before a rebuild, retire the previous
   run's disposable output and use empty scratch. Keep a separate, exact scope for any input
   still pinned by a pending run. Report cleanup as pending if ownership, closure, or required
   approval is unresolved.
   **Complete when:** authorized disposable paths and their retired registrations are gone,
   retaining only the named exceptions, and retained evidence and free space have been
   verified again.

See [the guard and cleanup commands](references/commands.md) to wire the helper into a run.
It can remove the scratch directory it creates. Existing workspaces require the scoped review
above.

For Cargo or Tauri, apply [the clean-build and retirement workflow](references/tauri-rust.md).
Retire disposable outputs after either a passing or failing run. Close and retire the previous
run before starting a clean rebuild.

## Usage Examples

```text
Use manage-workspace-storage before the browser suite. Check the target volume, keep .context small, and clean up this run's scratch after retaining its result.
```

```text
Tell me what filled this project's disk and which files are safe to remove.
```

## What it looks like

A short closeout names the closed run, its preserved source and evidence, the removed paths,
the measured before and after free bytes, and any paths that still need a decision.

## Pitfalls

- A clean worktree can still have a saved session attachment, ignored evidence, or dependency
  links. A dependency link can live in another clean worktree. Check known consumers before
  removing its target.
- A second copy can share blocks with the first. Directory size and newly available bytes
  measure different things.
- A path being old, ignored, or named cache says little about whether another run depends on it.
- Increasing a limit hides the symptom until the volume fills again. Find what wrote the bytes
  and change where that output goes or when it is retired.

## Verification

- [ ] Context and volume budgets were checked against the paths receiving writes.
- [ ] Required evidence is readable outside the disposable run.
- [ ] Remaining or removed paths match the agreed scope.
- [ ] Each retained bulk path has a named consumer or reason and a release condition.
- [ ] The storage gain is reported as a measured difference in free bytes.
