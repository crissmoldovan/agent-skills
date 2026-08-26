---
name: update-agent-skills
description: "Update Agent Skills across every requested local plane."
license: MIT
compatibility: "Agent Skills-compatible agents; the generic Skills CLI for managed project/global installs; native plugin/package updaters or manual artifact channels where applicable."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Write Grep Glob Bash Agent Workflow
---

# Update Agent Skills

Maintain release communication and update every explicitly requested Agent Skill
library without confusing one scope, agent, or channel for all of them. This skill
is repository/account agnostic. It does not authorize publication, a new release,
or mutation of an unmentioned machine, project, plugin, upload, or remote target.

## When to Use

- “Update my skills,” “sync this skill everywhere,” or “bring all my agents to the
  released version.”
- A released skill changed and its changelog, catalogue README, release notes, or
  update guidance must be corrected before users are encouraged to update.
- Installed project/global/native/manual copies need a provenance-aware refresh.

Do not use to publish unreleased source; use the target's publishing workflow
first. Do not mutate real local libraries unless the user explicitly requests the
scope, machine, agent/channel set, or “all supported agents on this machine.”

## Release Communication Gate

Before encouraging an update, verify the authoritative release exists. Maintain
these human and agent surfaces when they are part of the named source repository:

1. **Changelog:** newest version/date first; outcomes, compatibility or migration,
   and affected users—not a commit list.
2. **Repository/catalogue README:** exact skill description, source, install and
   update commands, scope behavior, and any native/manual alternatives.
3. **Release notes:** human-readable “what changed / who should update / how to
   update / restart or migration needed.” A tag or generated diff is not release
   notes.
4. **Agent-facing update guidance:** an executable prompt that inventories first,
   preserves provenance and namespaces, updates only requested planes, verifies
   readback, and reports partial results.

Encourage users and agents to update only after those surfaces resolve to the
published source. Communication is not authorization to update their machines.

## Inventory Every Requested Plane

Resolve the published source and literal skill identities. Then inventory both
Skills CLI scopes in machine-readable form:

```bash
npx skills list --global --json
npx skills list --json
```

Record scope, source provenance, managed/unmanaged ownership, install path,
copy/symlink form, and every consuming agent projection. Also discover:

- native plugin/package channels and their namespaces/versions;
- manual/upload/raw-file channels;
- remote machines, containers, browser-only agents, and other runtimes;
- unsupported clients reported by the owning installer.

Before writes, present a deduplicated target manifest: `machine × scope/profile ×
agent/channel × physical path × mechanism`. Several agents may consume one shared
physical store; update it once and report every covered consumer. “All supported
agents” authorizes only the discovered set shown in this manifest—not unknown
profiles, undetected clients, or guessed directories.

A native plugin identity and a standalone bare skill are separate. A shared
symlinked canonical copy and several copied agent directories are different
freshness models. Never infer that this machine represents another target.

## Update by Owning Channel

### Generic Skills CLI

For CLI-managed skills, specify scope rather than relying on the current folder:

```bash
npx skills update <skill...> --global --yes
npx skills update <skill...> --project --yes
```

`skills update` has no agent selector. It updates managed records at the selected
scope; it is not proof that every copied agent projection changed. Re-inventory
and verify each selected target path afterwards. Use an explicit `skills add`
only for missing selected projections, never as a substitute for provenance-aware
update.

For a missing global projection across all supported agents:

```bash
npx skills add <published-source> --skill <skill...> --global --agent '*' --yes
```

Run a missing project install from the exact project without `--global` and name
its intended agents. `--agent '*'` means every agent supported by the installed
CLI, not every possible agent. Preserve copy/symlink form; use `--copy` only when
selected by the user or existing install.

### Unmanaged or provenance-less copies

Do not overwrite them as managed. Show the exact path, identity, requested scope,
and authoritative replacement source. Ask before destructive replacement, remove
only that identity/scope, reinstall, and preserve unrelated or namespaced skills.
Do not delete a local skill merely because it disappeared upstream. Report it as
a removal candidate and require separate destructive confirmation.

### Native plugin/package plane

Use the native plugin marketplace or package registry refresh/update flow. Read
back exact installed version, namespace, path, and skill bytes. A generic CLI
update does not prove a native plugin updated.

### Manual/upload and remote planes

Verify the released ZIP/raw file/artifact. Perform the UI replacement only when
that target is requested and controllable; otherwise report `manual action
required`. Update each remote machine/container independently. Report an agent
the owning installer explicitly rejects as `unsupported`; report an explicitly
requested but currently unreachable target as `deferred`. Never invent a folder.

## Verify and Report

1. Re-run both JSON inventories and native version queries.
2. Confirm expected project/global precedence and every requested supported-agent
   projection.
3. Where no trustworthy version exists, compare installed bytes or a cryptographic
   hash with the published artifact.
   If the authoritative source exposes no comparable version/ref/digest, report
   freshness as `unknown` after update rather than manufacturing certainty.
4. Restart or reload affected agents whose loaders cache skills; an active session
   may continue using old instructions until reopened.
5. Report `scope × agent/channel × identity` as `updated`, `already current`,
   `manual action required`, `unsupported`, `deferred`, `failed`, or `out of scope`.
6. Include the release-note/update link and encourage affected humans and agents to
   update, but never collapse partial success into “everything is updated.”

## Keeping a Pack Current

Nothing in the update path announces that a pack moved, and the Skills CLI cannot
be asked. Its `check` is a bare alias for `update`: it mutates, there is no dry
run, and its exit code reports failure rather than availability—exit 0 covers
both “nothing to do” and “I just rewrote every tracked skill.” Anything that runs
the CLI to *see* whether an update exists performs one instead, non-interactively,
at a scope inferred from whatever directory it inherited.

Detection must therefore be built apart from application. This skill carries both
halves, and the seam between them is where consent lives.

### Detecting drift

`scripts/check-pack-freshness.mjs` is read-only. It reads the global lockfile,
asks the source repository for one tree, and compares the folder hash the
lockfile already records against the hash upstream now has. It starts no process,
calls no CLI, and writes nothing but its own cache.

```bash
node scripts/check-pack-freshness.mjs --source <owner>/<repo>
```

Silence means current. Drift prints the stale skill names, the latest release, and
the exact command that would apply it, then exits 2. Whatever it could not
determine—an unreadable lockfile, an unreachable source, an entry carrying no
comparable hash—is reported as `unknown` and exits 0. Unknown is a third state and
is never folded into “current”: where silence is the healthy signal, a failure
that renders as silence reads as health.

Answers are cached with two deliberately different lifetimes. A current answer
expires in an hour; a drifted one in twelve. A drifted pack is re-announced every
session because the user has not acted yet, while the request is not repeated
because the answer cannot change until they do. The verdict is recomputed from the
lockfile on every run, so an update silences the notice at once instead of at the
end of a cache window.

### Being told, and being updated

`scripts/install-freshness-hook.mjs` writes a `SessionStart` hook that runs the
checker asynchronously, so it never delays a session, and rewakes the model on
exit code 2, so the notice reaches the conversation instead of the scrollback.
The user runs this. No skill may install it on their behalf.

```bash
node scripts/install-freshness-hook.mjs --mode notify --source <owner>/<repo>
node scripts/install-freshness-hook.mjs --mode auto --source <owner>/<repo>
node scripts/install-freshness-hook.mjs --remove
```

`notify` reports and stops. It cannot mutate anything, because the checker cannot.

`auto` applies exactly the update the checker named. **Installing auto mode is the
user's standing consent, for that source and that scope only.** This is not an
exception to the rule that mutation requires an explicit request—it is the one
channel through which that request can be made ahead of time, recorded in a form
that can be read back and withdrawn with `--remove`. It authorizes nothing beyond
the source and scope named at install time: no other pack, no project scope, and
no deletion.

Never widen that command into a bare `skills update`. Named skills bound what is
rewritten, `--global` pins the scope instead of letting the working directory
choose it, and `--yes` keeps an upstream deletion a printed warning rather than a
removal. An applied update still proves nothing about the agent projections;
re-inventory and verify each one.

## Usage Examples

```text
Update this released skill for all supported agents in global scope on this
machine. Inventory JSON and provenance first, preserve plugin namespaces and
copy/symlink form, update through each owning channel, reload cached runtimes, and
report unsupported or manual planes separately.
```

```text
Prepare the update communication only. Make the changelog, repository README,
release notes, and agent-facing update guidance agree with the published release.
Do not update any local library.
```

## Pitfalls

- **Update before release:** branch bytes are not an update source.
- **One scope called all:** project and global inventories are independent.
- **One agent called all:** `--agent '*'` covers only the installed CLI's supported
  set; native/manual/remote and unsupported clients remain separate.
- **Shared path counted repeatedly:** deduplicate physical targets while still
  reporting each consuming agent.
- **Portable name, nonportable payload:** validate standard `SKILL.md`, relative
  carried files, and absence of one-agent-only interpolation before copying.
- **Upstream deletion mirrored:** deletion is a separately confirmed destructive
  operation, never an ordinary update.
- **Unmanaged overwritten:** absence of provenance requires approval, not guessing.
- **Successful command called current:** verify version, namespace, bytes, or hash.
- **Changelog as commit dump:** write outcomes and update action for a human reader.
- **Announcement as consent:** encouraging adoption does not authorize mutation.
- **A check that updates:** the CLI's `check` is an alias for `update`; asking it
  whether a pack moved moves it. Detect drift read-only, apply it deliberately.
- **Silence mistaken for health:** when “no output” means current, a check that
  crashed or could not reach the network must report `unknown`, never nothing.

## Verification

- [ ] Published source/version/artifact exists and was read back.
- [ ] Changelog, repository/catalogue README, human release notes, and agent update
      guidance agree.
- [ ] Every mutated scope/machine/agent/channel was explicitly requested.
- [ ] Global and project inventories were captured before and after.
- [ ] A deduplicated target manifest was presented before every local write.
- [ ] Managed/unmanaged and copy/symlink ownership was preserved.
- [ ] Upstream-missing skills are removal candidates requiring separate destructive
      confirmation, not ordinary update deletions.
- [ ] Without a comparable authoritative version/ref/digest, freshness is
      `unknown`, never inferred from command success or timestamps.
- [ ] Native, manual/upload, remote, and unsupported planes have literal outcomes.
- [ ] Installed bytes/version/namespace and runtime reload were verified.
- [ ] Users and agents receive exact update guidance without false completion.
- [ ] Freshness was detected without invoking a command that mutates.
- [ ] Any standing auto-update names the source and scope it covers, was installed
      by the user, and can be withdrawn.
