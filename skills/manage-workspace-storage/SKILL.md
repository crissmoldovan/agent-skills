---
name: manage-workspace-storage
description: "Clean up after every task and keep agent context small: note what you create outside the repository, keep the evidence, then remove worktrees, containers, VMs, disk images, caches, copies and signed-in configurations once their work is done. Check a context budget and volume headroom, give each run a project-owned scratch directory, and end by listing what was left and removed. An optional setup script makes it a standing rule in Claude Code and Codex with a session-start policy and an end-of-turn leftover check. Use when .context keeps growing, old worktrees or test artifacts fill a shared disk, a large build needs a storage preflight, or clean-up should be enforced."
license: MIT
compatibility: "The workflow works wherever the agent can inspect local files and disk usage. The bundled guard, scratch helper and enforcement hooks require Node.js 22 or newer on macOS or Linux. Git is needed only to inspect or retire Git worktrees; Docker and Tart are only queried when a session used them. Nothing makes a network request."
metadata: "group=workflow; lifecycle=release; version=1.1.0; author=crissmoldovan"
allowed-tools: Read Grep Glob Bash
---

# Manage workspace storage

An interrupted run needs a checkpoint. A finished run needs evidence. Neither needs a second
checkout, a running container or a signed-in configuration sitting around for the rest of the
project. Keep a compact record in context, give large, disposable outputs a location and an end
of life before creating them, and leave the machine as you found it.

## When to Use

- A build, browser suite, native test, or packaging run creates large temporary files, worktrees,
  containers, virtual machines or disk images.
- A project keeps cloning worktrees, reinstalling dependencies, or retaining build output.
- A user asks what filled the disk, what can be recovered, or which project owns a directory.
- A user wants clean-up to be a standing rule rather than something remembered each time.

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

3. **Note each item as you create it.** For anything outside the repository, or a large
   git-ignored output inside it, record the path or name, its size, what it is for, and when it
   can go. That covers worktrees, containers, images and volumes, virtual machines, disk or
   restore images, cache folders, downloads, copies in temporary and shared folders, screenshots,
   logs, backups, and signed-in configurations. Where the enforcement hooks are installed,
   record it with the `note` command in [the enforcement guide](references/enforcement.md).
   **Complete when:** every item the run created is on the list with an end of life.

4. **Retain what you need to resume or verify.** Check the original operation and its dependent
   processes through terminal status. Keep exact source identity, a concise result or failure,
   and only the logs, outputs, and rollback material required by policy or evidence. Put what is
   worth keeping in the project's durable record first (its issue, release notes or evidence
   folder; for a large binary, its checksum and where it lived). Read back the retained bytes or
   confirm the exact revision in the authoritative remote. Keep unpublished changes, unique
   originals, and active runs until their disposition is established. A time limit expiring does
   not establish that a run ended.
   **Complete when:** the verified evidence and any live or unresolved paths are recorded outside
   the disposable run.

5. **Retire the run with a named scope.** Preview the owned scratch run, confirm it is closed and
   its evidence is safe, and apply cleanup within the authorized paths. Remove each worktree you
   created once its branch is merged or dropped: `git worktree remove`, then `git worktree
   prune`, so the registration goes with the files. Stop containers and virtual machines when
   their step ends, and remove the ones you created. A signed-in configuration is a credential:
   sign out and delete it when its task is done. A legacy directory needs its own inventory,
   ownership and recovery checks. Never delete what another session or project owns, or anything
   unpublished, still running, or needed by a later step; leave shared caches, other projects,
   and ambiguous files in place and ask.
   **Complete when:** the removed paths and any Git registrations are absent, retained evidence
   still reads back, and volume free space is measured again.

6. **End the task with the account.** Say what you left behind and why, and what you removed.
   Where the project keeps a register of temporary items, report to it.
   **Complete when:** the closing message lists both, or says that nothing was left.

See [the guard and cleanup commands](references/commands.md) to wire the helper into a run.
It can remove the scratch directory it creates. Existing workspaces require the scoped review
above.

## Make it a standing rule

A rule an agent only reads gets forgotten in a long session. `scripts/setup-enforcement.mjs`
installs two hooks for Claude Code and for Codex, whichever are present: a session-start hook
that puts the policy above in front of every new session, and an end-of-turn hook that checks
what this session created and still left. It reads the session's own transcript and notes, so
another session's or project's items are never flagged. It shows a preview unless given
`--yes`, merges without touching existing hooks, backs each file up, and has an uninstall. A
person runs it; an agent installs it only when the user asks. Modes, the blocking switch, the
limits and the contracts it relies on are in [the enforcement guide](references/enforcement.md).

```bash
node scripts/setup-enforcement.mjs            # preview
node scripts/setup-enforcement.mjs --yes      # apply
```

## Usage Examples

```text
Use manage-workspace-storage before the browser suite. Check the target volume, keep .context small, and clean up this run's scratch after retaining its result.
```

```text
Tell me what filled this project's disk and which files are safe to remove.
```

```text
Use manage-workspace-storage: end this task by listing what you left behind and what you removed, and remove the worktree and containers you created.
```

```bash
node scripts/setup-enforcement.mjs --agent codex --yes
```

## What it looks like

A short closeout names the closed run, its preserved source and evidence, the removed paths,
the measured before and after free bytes, and any paths that still need a decision. With the
hooks installed, an end-of-turn reminder looks like this:

```text
Clean-up reminder. This session created these and they still exist (2):
- worktree: /tmp/feature-wt, 212.0 MiB
- tart VM: build-vm (running)
Remove each when its work is done, or say in the final message why it stays.
```

## Pitfalls

- A clean worktree can still contain ignored evidence or dependency links. Check both before
  removing it.
- A second copy can share blocks with the first. Directory size and newly available bytes
  measure different things.
- A path being old, ignored, or named cache says little about whether another run depends on it.
- Increasing a limit hides the symptom until the volume fills again. Find what wrote the bytes
  and change where that output goes or when it is retired.
- The end-of-turn check reads commands the session ran. An item created by a script, or under a
  name a command did not spell out, is invisible to it; note those yourself.
- A reminder the model cannot see does not change what it does. In the default mode the reminder
  is shown to the person; only the blocking mode puts it in front of the agent.

## Verification

- [ ] Context and volume budgets were checked against the paths receiving writes.
- [ ] Every item created outside the repository was noted with its purpose and end of life.
- [ ] Required evidence is readable outside the disposable run, and was kept before removal.
- [ ] Remaining or removed paths match the agreed scope, and nothing another session owns was touched.
- [ ] The storage gain is reported as a measured difference in free bytes.
- [ ] The closing message lists what was left behind and what was removed.
