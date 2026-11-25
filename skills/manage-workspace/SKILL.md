---
name: manage-workspace
description: "Clean up after every task and keep the machine usable: note what you create outside the repository, keep the evidence, then remove worktrees, containers, VMs, disk images, caches, copies and signed-in configurations once their work is done. Check a context budget, volume headroom and memory headroom that counts swap, give each run a project-owned scratch directory, and end by listing what was left and removed. It finds the processes agents leave running: agent CLIs whose editor died, a session served by two processes, plugin helpers whose session ended or whose folder is gone. Optional hooks for Claude Code and Codex add a session-start policy and machine check, an end-of-turn leftover check, and, in Claude Code, an end-of-session stop of the session's own helpers; an agent asked to install or update it does the whole setup. Use when .context keeps growing, a shared disk or memory fills, the machine swaps or freezes under agent sessions, or clean-up should be enforced. Formerly manage-workspace-storage."
license: MIT
compatibility: "The workflow works wherever the agent can inspect local files, disk usage and processes. The bundled scripts and hooks require Node.js 22 or newer on macOS or Linux. Git is needed only for Git worktrees; Docker and Tart are queried only when a session used them. The process check reads ps and, for helpers, the environment of the current user's processes. Only status makes a network request, by launching Codex to ask for hook trust."
metadata:
  group: workflow
  lifecycle: release
  version: "2.0.2"
  author: crissmoldovan
allowed-tools: Read Grep Glob Bash
---

# Manage workspace

An interrupted run needs a checkpoint. A finished run needs evidence. Neither needs a second
checkout, a running container, a helper process or a signed-in configuration sitting around for
the rest of the project. Keep a compact record in context, give large, disposable outputs a
location and an end of life before creating them, check that the machine has room before heavy
work, and leave it as you found it.

Formerly `manage-workspace-storage`; the name changed when the skill took on processes and memory.
[Migrating from manage-workspace-storage](#migrating-from-manage-workspace-storage) says what to run.

## When to Use

- A build, browser suite, native test, or packaging run creates large temporary files, worktrees,
  containers, virtual machines or disk images.
- A project keeps cloning worktrees, reinstalling dependencies, or retaining build output.
- A user asks what filled the disk or the memory, what can be recovered, or which project owns it.
- The machine swaps, stalls or logs out while several agent sessions run, or a helper process or
  an agent CLI keeps running after its session or its editor window is gone.
- A user wants clean-up to be a standing rule rather than something remembered each time.

`derive-codebase-context` owns the documentation agents load. `isolated-change-validation` owns
the proof required to accept a change. `work-in-external-repo` owns selecting another checkout.
Use this skill for the storage, memory and processes those workflows consume and leave behind.

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

3. **Check memory and what is still running before heavy work.** Before a test suite, a build or a
   virtual machine start, run the memory check with what the job needs
   (`leftovers.mjs memory --need-mib <MiB>`). It counts swap, which the free percentage macOS
   reports does not, and refuses when the job would leave the machine under its floor. If it
   refuses, list what agents left running (`leftovers.mjs processes`) and stop what you started and
   no longer need; stop another session's process only on the user's word. The rules and the limits
   are in [the process and memory guide](references/processes.md).
   **Complete when:** the check passes for the job's size, or the user has decided what to stop or
   to wait.

4. **Note each item as you create it.** For anything outside the repository, or a large
   git-ignored output inside it, record the path or name, its size, what it is for, and when it
   can go. That covers worktrees, containers, images and volumes, virtual machines, disk or
   restore images, cache folders, downloads, copies in temporary and shared folders, screenshots,
   logs, backups, background processes you start, and signed-in configurations. Where the
   enforcement hooks are installed, record it with the `note` command in
   [the enforcement guide](references/enforcement.md).
   **Complete when:** every item the run created is on the list with an end of life.

5. **Retain what you need to resume or verify.** Check the original operation and its dependent
   processes through terminal status. Keep exact source identity, a concise result or failure,
   and only the logs, outputs, and rollback material required by policy or evidence. Put what is
   worth keeping in the project's durable record first (its issue, release notes or evidence
   folder; for a large binary, its checksum and where it lived). Read back the retained bytes or
   confirm the exact revision in the authoritative remote. Keep unpublished changes, unique
   originals, and active runs until their disposition is established. A time limit expiring does
   not establish that a run ended.
   **Complete when:** the verified evidence and any live or unresolved paths are recorded outside
   the disposable run.

6. **Retire the run with a named scope.** Preview the owned scratch run, confirm it is closed and
   its evidence is safe, and apply cleanup within the authorized paths. Remove each worktree you
   created once its branch is merged or dropped: `git worktree remove`, then `git worktree
   prune`, so the registration goes with the files. Stop containers, virtual machines and
   background processes when their step ends, and remove the ones you created. A signed-in
   configuration is a credential: sign out and delete it when its task is done. A legacy directory
   needs its own inventory, ownership and recovery checks. Never delete or stop what another session
   or project owns, or anything unpublished, still running, or needed by a later step; leave shared
   caches, other projects, and ambiguous files in place and ask.
   **Complete when:** the removed paths, processes and any Git registrations are absent, retained
   evidence still reads back, and volume free space is measured again.

7. **End the task with the account.** Say what you left behind and why, and what you removed.
   Where the project keeps a register of temporary items, report to it.
   **Complete when:** the closing message lists both, or says that nothing was left.

See [the guard and cleanup commands](references/commands.md) to wire the helpers into a run.
The storage helper can remove the scratch directory it creates. Existing workspaces require the
scoped review above.

## Make it a standing rule

A rule an agent only reads gets forgotten in a long session. `scripts/setup-enforcement.mjs`
installs hooks for Claude Code and for Codex, whichever are present:

- a **session-start** hook that puts the policy above in front of every new session, with a
  machine check: helpers of ended sessions or deleted folders, agent CLIs with no parent, a session
  served by two processes, and low memory, each named so the agent tells the user;
- an **end-of-turn** hook that checks what this session created and still left, and asks this
  session's own helpers whose folder is gone to shut down;
- in Claude Code, an **end-of-session** hook that asks every helper this session started to shut
  down, in any folder, except one in a workspace another live session works in. Codex gets the other two until its
  `SessionEnd` has been observed.

It reads the session's own transcript and notes, so another session's or project's items are never
flagged as this session's. It sends no signal: it asks only helpers whose environment names this
session to shut themselves down, and leaves a busy one running. It
shows a preview unless given `--yes`, merges without touching existing hooks, backs each file up,
and has an uninstall. A person runs it; an agent installs it only when the user asks. Modes, the
blocking switch, the helper switch, the limits and the contracts it relies on are in
[the enforcement guide](references/enforcement.md).

```bash
node scripts/setup-enforcement.mjs            # preview
node scripts/setup-enforcement.mjs --yes      # apply
```

## Install or update (agents)

When a person asks you to "install manage-workspace" or "update manage-workspace" (or still says
"manage-workspace-storage"), do the whole setup yourself, in this order. Their request is the consent
for steps 1 to 4; step 5 has its own rule. Run no test suites, make no network calls beyond the Skills
CLI and the Codex launch `status` makes to read hook trust, and change no other file yourself. If the skill is not installed yet, the README's bootstrap prompt does
the same from scratch.

1. **Install or update the skill for every agent present.** Check `node --version` (22 or newer),
   `codex --version` and `codex features list` (hooks must be on), and whether Claude Code is
   installed. For each agent found, run the Skills CLI at user level, with the form already installed
   (`--copy` if the existing install is a copy):

   ```bash
   npx skills add crissmoldovan/agent-skills --skill manage-workspace --global --agent claude-code --yes
   npx skills add crissmoldovan/agent-skills --skill manage-workspace --global --agent codex --yes
   ```

   Read the installed `SKILL.md` back and confirm `version` is the one you meant to install.
2. **Retire the old name.** If `manage-workspace-storage` is installed (`npx skills list --global`),
   remove it once the new skill reads back: `npx skills remove manage-workspace-storage --global --yes`.
   Its hooks keep working until step 3 rewrites them.
3. **Run the setup script from the installed skill folder.** Preview first with
   `node scripts/setup-enforcement.mjs`, read what it would change, then
   `node scripts/setup-enforcement.mjs --yes`. It rewrites the old-name hook entries in place, moves
   the old state and mode, and refreshes the old script path so running sessions keep working. After
   an update, run it again: it refreshes the script copy, and rewrites a hook entry only if its
   command changed.
4. **Read back.** Both hook files (`settings.json` in `~/.claude`, `hooks.json` in `~/.codex`): the
   manage-workspace entries are there (three in Claude Code, two in Codex), no entry still names
   `manage-workspace-storage`, and every other hook is still there, in the same order.
   `node scripts/setup-enforcement.mjs status` lists them, and a second `--yes` run says
   "already up to date". Pipe a `session-start` payload to the installed script
   (`echo '{"session_id":"t"}' | node "$XDG_DATA_HOME/manage-workspace/leftovers.mjs" session-start`,
   with `~/.local/share` when unset) and see the policy printed.
5. **Get the Codex hooks trusted.** Codex trust is per machine and is needed again whenever a hook
   command changes, as it does when an old-name entry is rewritten (setup prints `update ... entry`).
   Default: ask the person to run `/hooks` in Codex and press `t` on the two `manage-workspace`
   entries, then run `status` by its full path from the folder where `/hooks` was opened, and check
   it reports both trusted, as Codex reports it for that folder (a line that says it fell back to
   stored hashes is not proof). Only when the person's request explicitly authorises
   self-approval, follow the guarded procedure in
   [the enforcement guide](references/enforcement.md#guarded-self-approval), and stop and hand back to
   `/hooks` the moment any step cannot be proven. Never use `--dangerously-bypass-hook-trust`, never
   edit `hooks.json` to look trusted, never trust another hook.
6. **Report** the installed versions per agent, whether the old name was removed, the files edited and
   their backups, the hook entries, whether Codex trust is done or waiting for the person, that the
   mode is `warn` and helpers `stop` unless set, and the commands for `mode block`, `helpers report`
   and `uninstall`.

**Complete when:** the installed version is the intended one for every agent present, the old name is
gone or reported, both hook files read back with every pre-existing hook in place, and the Codex trust
is either verified or reported as waiting for the person.

### Migrating from manage-workspace-storage

The skill, its hooks and its folders now use the name `manage-workspace`. Install it under the new
name, remove the old one, and run setup again, as steps 1 to 3 above. Until setup runs, the old hooks
keep working as before. After it runs, the old script path holds the new script, so a session that
started earlier and was told that path still records its notes; uninstall removes it.

## Usage Examples

```text
Install manage-workspace.
```

```text
Update manage-workspace.
```

```text
Use manage-workspace before the browser suite. Check the target volume and memory, keep .context small, and clean up this run's scratch after retaining its result.
```

```text
The Mac keeps swapping with several agent sessions open. Use manage-workspace to find what agents left running and tell me what is safe to stop.
```

```text
Tell me what filled this project's disk and which files are safe to remove.
```

```text
Use manage-workspace: end this task by listing what you left behind and what you removed, and remove the worktree and containers you created.
```

```bash
node scripts/leftovers.mjs memory --need-mib 6144
node scripts/leftovers.mjs processes
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
Stopped 1 helper this session left in deleted folders: Codex companion broker pid 4242, session 7f…, folder /tmp/lane-a (deleted), 9 processes, 420 MiB resident, 2 d old.
```

and the machine check a new session starts with:

```text
Machine check at session start (2):
- claude pid 5150 has no parent (its editor or terminal is gone), session 3c… "lane work", 380 MiB resident with 12 child processes, 9 min old
- memory is low: 19.3 GiB of swap is in use, over the limit of 9.0 GiB (a quarter of RAM); the free percentage does not count swap (42% of memory free, 19.3 GiB of swap in use, 36.0 GiB RAM)
Tell the user about these before heavy work. Never stop another live session's processes. …
```

## Pitfalls

- A clean worktree can still contain ignored evidence or dependency links. Check both before
  removing it.
- A second copy can share blocks with the first. Directory size and newly available bytes
  measure different things.
- A path being old, ignored, or named cache says little about whether another run depends on it.
- Increasing a limit hides the symptom until the volume fills again. Find what wrote the bytes
  and change where that output goes or when it is retired.
- The free percentage macOS reports (`kern.memorystatus_level`) can stay near 40 while swap is full.
  A gate on it alone lets a VM start on a machine about to stall; the memory check counts swap.
- Resident sizes are what is in RAM now. Under pressure most of a process is compressed or swapped,
  so the real share is larger than the number shown.
- An editor that dies does not end its sessions: their CLIs keep running, and working, for a while,
  and the editor may reopen the same session in a second process. Report them; do not stop them
  without the user's word.
- The end-of-turn check reads commands the session ran. An item created by a script, or under a
  name a command did not spell out, is invisible to it; note those yourself.
- A reminder the model cannot see does not change what it does. In the default mode the reminder
  is shown to the person; only the blocking mode puts it in front of the agent.

## Verification

- [ ] Context and volume budgets were checked against the paths receiving writes.
- [ ] Memory was checked for the job's size before heavy work, with swap counted.
- [ ] Every item created outside the repository was noted with its purpose and end of life.
- [ ] Required evidence is readable outside the disposable run, and was kept before removal.
- [ ] Remaining or removed paths and processes match the agreed scope, and nothing another session
      owns was touched without the user's word.
- [ ] The storage gain is reported as a measured difference in free bytes.
- [ ] The closing message lists what was left behind and what was removed.
