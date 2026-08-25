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

### Native plugin/package plane

Use the native plugin marketplace or package registry refresh/update flow. Read
back exact installed version, namespace, path, and skill bytes. A generic CLI
update does not prove a native plugin updated.

### Manual/upload and remote planes

Verify the released ZIP/raw file/artifact. Perform the UI replacement only when
that target is requested and controllable; otherwise report `manual action
required`. Update each remote machine/container independently. Report an
undocumented or unsupported agent as `unsupported` or `deferred`; never invent a
folder.

## Verify and Report

1. Re-run both JSON inventories and native version queries.
2. Confirm expected project/global precedence and every requested supported-agent
   projection.
3. Where no trustworthy version exists, compare installed bytes or a cryptographic
   hash with the published artifact.
4. Restart or reload affected agents whose loaders cache skills; an active session
   may continue using old instructions until reopened.
5. Report `scope × agent/channel × identity` as `updated`, `already current`,
   `manual action required`, `unsupported`, `failed`, or `out of scope`.
6. Include the release-note/update link and encourage affected humans and agents to
   update, but never collapse partial success into “everything is updated.”

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
- **Unmanaged overwritten:** absence of provenance requires approval, not guessing.
- **Successful command called current:** verify version, namespace, bytes, or hash.
- **Changelog as commit dump:** write outcomes and update action for a human reader.
- **Announcement as consent:** encouraging adoption does not authorize mutation.

## Verification

- [ ] Published source/version/artifact exists and was read back.
- [ ] Changelog, repository/catalogue README, human release notes, and agent update
      guidance agree.
- [ ] Every mutated scope/machine/agent/channel was explicitly requested.
- [ ] Global and project inventories were captured before and after.
- [ ] Managed/unmanaged and copy/symlink ownership was preserved.
- [ ] Native, manual/upload, remote, and unsupported planes have literal outcomes.
- [ ] Installed bytes/version/namespace and runtime reload were verified.
- [ ] Users and agents receive exact update guidance without false completion.
