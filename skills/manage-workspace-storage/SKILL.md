---
name: manage-workspace-storage
description: "Keep agent context small and retire disposable build and test files after verification. Check a context budget and volume headroom, give each run a project-owned scratch directory, preserve evidence, and reclaim disk space within a checked scope. Use when .context keeps growing, old worktrees or test artifacts fill a shared disk, or a large build needs a storage preflight and cleanup."
license: MIT
compatibility: "The workflow works wherever the agent can inspect local files and disk usage. The bundled guard and scratch helper require Node.js 22 or newer on macOS or Linux. Git is needed only to inspect or retire Git worktrees. The helper makes no network requests."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Grep Glob Bash
---

# Manage workspace storage

An interrupted run needs a checkpoint. A finished run needs evidence. Neither needs a second
checkout sitting beside its logs for the rest of the project. Keep a compact record in context
and give large, disposable outputs a location and an end of life before creating them.

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
   an allocated-size breakdown of the named directory, using a bounded top-level inventory.
   For suspected shared use, check Git worktree registrations, links and mounts, and open or
   known in-flight operations. A folder name is a lead about ownership. Files kept by another
   checkout, a container, or a running job need their owner resolved.
   **Complete when:** the baseline and largest contributors are recorded, with uncertainties
   where the evidence does not establish ownership or recoverability.

2. **Keep context small and give disposable output a home.** Use .context for decisions,
   current pointers, checksums, and short status records. Send builds, dependencies, fixtures,
   databases, worktree copies, and bulk logs to project-owned scratch or their appropriate
   managed store. Put required originals in the project's approved durable location.
   Pick the headroom from the actual build and its peak scratch usage. Invoke the guard before
   and after heavy stages on each volume they write to. Use it as a preflight command in a
   recurring workflow where it needs to stop a launch. Correct the storage plan if it refuses.
   **Complete when:** the run has its scratch path, evidence destination, and applicable storage
   budget, and the preflight passes.

3. **Retain what you need to resume or verify.** Check the original operation and its dependent
   processes through terminal status. Keep exact source identity, a concise result or failure,
   and only the logs, outputs, and rollback material required by policy or evidence. Read back the
   retained bytes or confirm the exact revision in the authoritative remote. Keep unpublished
   changes, unique originals, and active runs until their disposition is established. A time
   limit expiring does not establish that a run ended.
   **Complete when:** the verified evidence and any live or unresolved paths are recorded outside
   the disposable run.

4. **Retire the run with a named scope.** Preview the owned scratch run, confirm it is closed and
   its evidence is safe, and apply cleanup within the authorized paths. Use Git to remove linked
   worktrees so their registrations are retired with the files. A legacy directory needs its
   own inventory, ownership and recovery checks. Leave shared caches, other projects, and
   ambiguous files in place while those checks are unresolved.
   **Complete when:** the removed paths and any Git registrations are absent, retained evidence
   still reads back, and volume free space is measured again.

See [the guard and cleanup commands](references/commands.md) to wire the helper into a run.
It can remove the scratch directory it creates. Existing workspaces require the scoped review
above.

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

- A clean worktree can still contain ignored evidence or dependency links. Check both before
  removing it.
- A second copy can share blocks with the first. Directory size and newly available bytes
  measure different things.
- A path being old, ignored, or named cache says little about whether another run depends on it.
- Increasing a limit hides the symptom until the volume fills again. Find what wrote the bytes
  and change where that output goes or when it is retired.

## Verification

- [ ] Context and volume budgets were checked against the paths receiving writes.
- [ ] Required evidence is readable outside the disposable run.
- [ ] Remaining or removed paths match the agreed scope.
- [ ] The storage gain is reported as a measured difference in free bytes.
