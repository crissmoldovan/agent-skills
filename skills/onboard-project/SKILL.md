---
name: onboard-project
description: "Choose and wire a repository's skills from evidence instead of hoping a description matches: scan the repository and its own session history against every skill's declared fit, show one change list where each row carries the evidence that justified it and the undo that takes it back, and on one yes write a profile plus a generated .claude/rules/skill-routing.md that every session in this repository loads. A quiet session-start check then says one line when a listed skill is not installed, the repository's evidence moves, or the routing file drifts. Symptoms: which skills should this project use, set this repo up for agents, the right skill never loads when I need it, we installed it and nobody uses it, onboard this project, check the prerequisites for this repo, re-check now that we have a database. It writes its own rules file and never edits CLAUDE.md, AGENTS.md or a generated context file, and it installs nothing itself: it prints the commands and you run them."
license: MIT
compatibility: "Any repository on a machine with Node 22+ and the Skills CLI available through npx. Git is optional: without it, files stay local. Reads the pack's own fit declarations, the repository's files, and — for onboard and refresh only — this machine's session history for this repository. Writes at most two files plus a git exclude line, and only on an explicit yes. The session-start hook is off until you arm it, and arming it affects every project on this machine."
metadata: "group=workflow; lifecycle=setup; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Write Edit Grep Glob Bash
---

# Onboard a project's skills

A skill loads when its description happens to match the task at hand, or when somebody types its
name. That is the whole mechanism. There is no supported way to force-load a skill, and no field
in a skill's frontmatter that makes one skill require another.

It works until the install base grows. On the machine this was built for, 201 skills were
installed; the one a project actually depends on surfaced by luck. And enforcement does not fix
it: a gate that demanded a progress report was satisfied, in real sessions, by an agent writing
the three headings from memory — the skill was never loaded, so everything it exists to carry was
absent. The gate got its shape. The reader got nothing.

The fix is not a bigger gate. It is a file every session already reads. This skill decides which
skills a repository should use, from evidence in the repository and in how it is worked on, and
writes that decision into `.claude/rules/skill-routing.md` — a rules file with no `paths`
frontmatter, which loads at the start of every session at the same priority as the project
CLAUDE.md. Nothing is forced; the right skills are simply in front of the agent before it has to
go looking.

**One yes, and everything is shown first.** The change list names every skill, every file and
every hook, each with the evidence behind it and the undo that takes it back. Nothing is written
before that yes, and nothing that is written is hard to remove.

### What this skill does not own

| The job | Whose it is | What this skill does with it |
|---|---|---|
| Installing and updating skills across scopes and agents | `update-agent-skills` | Prints the install commands and never runs one. **The user runs that skill; no skill may install it on their behalf.** |
| The context files agents load — CLAUDE.md, AGENTS.md and their generated kin | `derive-codebase-context` | Touches none of them. Its routing lives in a separate generated rules file, so a regeneration somebody else owns cannot clobber it. |
| The documentation people read | `layer-repository-docs` | Writes none. The routing file is for agents and says so in its own header. |
| Declared-catalog placement and inherited policy | `workspace-governance` | Reads the repository where it stands; decides nothing about where repositories belong. |
| Which model runs which work | `model-routing` | Recommends the skill; makes no routing decision. |
| The shape of a progress report, and the note for a release | `report-progress`, `release-notes` | Recommends them, and lists their gates as hooks you may arm. Those installers stay theirs. |
| Authoring or releasing a skill | `publish-agent-skill` | Never authors one. A skill it cannot find is a skill it reports as missing. |

## When to Use

Three entry points, and the run **announces which one it picked before it reads anything**:

- **onboard** — this repository has no profile. Scan, recommend, show the change list, apply on one
  yes. Symptoms: *which skills should this project use*, *set this repo up for agents*, *onboard
  this project*, *check the prerequisites here*.
- **refresh** — it has one. Scan again and show only what changed. Symptoms: *we added a database,
  re-check*, *this repo has moved on*, *the routing file looks stale*.
- **check** — the quiet one, run by a hook at session start. Reads, says nothing unless something
  is missing or has moved. You rarely invoke it by hand.

With no word at all, a repository with no profile gets **onboard** and one with a profile gets
**refresh**.

Do not use it to install skills — that is `update-agent-skills`, and the user runs it. Do not use
it to write a project's context file. Do not use it to decide what a change should touch, or how
work should be reported; it recommends the skills that own those jobs and owns none of them.

## Prerequisites

1. **A repository to stand in.** Any directory; a git repository gets the committed option.
   **Complete when:** the repository root is known — the scripts walk up to find it.
2. **The pack checkout.** This skill's scripts read every pack skill's `references/fit.json`.
   **Complete when:** `scripts/onboard.mjs plan` runs and lists skills.
3. **Node 22 or newer,** and `npx` for the install commands the plan prints.
   **Complete when:** `node --version` is 22 or above.
4. **A placement answer, once per repository.** Committed, or kept local.
   **Complete when:** the user has answered, or `commitOwners` in the user config already answers
   for this repository's origin owner.

## Procedure

1. **Say which entry point you are running, and why.** "No profile here, so this is onboard." A
   run that starts scanning without naming its own mode leaves the reader unable to tell a first
   onboarding from a re-check.
   **Complete when:** the announcement names the entry point and the repository.

2. **Settle placement before anything is written.** Committed means `skills-profile.json` lands in
   the repository, so a teammate's checkout carries the same answer; local means it lives under
   the user's agents directory and the repository stays clean. The plan pre-selects from the
   user's `commitOwners`, and a repository with no git metadata can only be local. Ask once, and
   only when the pre-selection could be wrong.
   **Complete when:** the answer is recorded, and the user was not asked a second time.

3. **Run the plan, which writes nothing.**

   ```sh
   node <skill-folder>/scripts/onboard.mjs plan --repo <repository>
   ```

   It evaluates every pack skill's declared fit against this repository's files, and — for onboard
   and refresh only — against this machine's session history for this repository. History is read
   here and **never** at session start.
   **Complete when:** the change list exists, and no file in the repository has changed.

4. **Add the weak matches yourself, if any.** The scan is deliberately narrow: it recommends only
   what a declared fit matched. Skills installed on this machine that are *not* in the pack can
   still fit, but only a reader can say so, from their descriptions and what the scan found. Pass
   them with `--weak <names>`; they are listed as "suggested from description, not checked", and
   never marked required.
   **Complete when:** every weak suggestion names the description it came from, or there are none.

5. **Show the whole change list and ask once.** Every row carries its undo:

   ```text
   + release-notes  (strong)  package.json has a version
       install: npx skills add <source> --skill release-notes --project --yes
       undo:    npx skills remove release-notes --project
   = report-progress  (strong)  already installed (global)
   ~ write skills-profile.json — in this repository
       undo:    delete it, or git revert
   ~ write .claude/rules/skill-routing.md
       undo:    delete it, or git revert
   ! arm the session-start check — affects all projects on this machine, not only this one
       command: node <skill-folder>/scripts/install-check-hook.mjs
       undo:    node <skill-folder>/scripts/install-check-hook.mjs --remove
   ```

   A hook lives in the user's own settings, so it is always its own row and always marked. Never
   fold it into a general yes about "setting the project up".
   **Complete when:** the user has seen every row, including the hook row, and answered.

6. **Apply in order — files, installs, hooks — and stop at the first failure.**

   ```sh
   node <skill-folder>/scripts/onboard.mjs apply --repo <repository> --yes
   ```

   That writes the files and prints the install and hook commands. **Run them yourself, in order,
   and stop at the first one that fails.** The scripts run no installs: the network stays out of a
   module the session-start check also loads, and every install stays where the user can see it.
   **Complete when:** the report says what was applied and what was not, with nothing implied.

7. **Record a no properly.** If the user declines a skill, write nothing unless they say "don't
   ask again" — then the profile records that decision with the fingerprint of that skill's own
   evidence, so it is offered again if and only if the evidence changes.
   **Complete when:** a declined skill is either absent from the profile or recorded with its
   fingerprint.

8. **Refresh shows differences only.** New matches, skills whose evidence disappeared (offered for
   removal, never removed silently), listed skills that are not installed, and a routing file that
   no longer matches its profile — shown as a diff, never overwritten quietly.
   **Complete when:** the user sees only what changed since the last scan.

9. **Arm the check only if the user asks for it.** It is off until then. It says one line when a
   listed skill is missing, the evidence moved, or the routing file drifted, and nothing at all
   otherwise; it reads no history, never blocks, and fails open.
   **Complete when:** the hook is armed with the user's explicit yes, or it is not armed.

See [what gets written](references/what-gets-written.md) for every file, its location and its undo,
and [fit signals](references/fit-signals.md) for the grammar a skill declares its own fit in.

## Usage Examples

```text
Onboard this project. Tell me which skills this repository should use and why, show me everything
you would write and everything you would install before you write any of it, and do not arm any
hook without telling me it affects all my projects.
```

```text
We added migrations and a background worker since you last looked. Refresh the profile and show me
only what changed — do not rewrite the routing file if it has not moved.
```

```text
Check this repository quietly. If everything the profile lists is installed and the evidence has
not moved, say nothing at all.
```

```text
Keep this one local: the repository is not mine to put tooling files in. Write the routing file,
add it to the git exclude, and keep the profile under my agents directory.
```

## Pitfalls

- **Editing CLAUDE.md instead.** Roughly one repository in a large estate carries a hand-written
  routing section, and the context files in several are generated by other tools with "do not
  edit" at the top — an inserted section there survives exactly until the next regeneration. The
  routing file is separate for that reason.
- **Recommending from descriptions and calling it evidence.** A description match is a guess; it
  belongs in the weak list, labelled, never marked required.
- **A skill listed but never installed.** The profile is not an installer. A listed skill that is
  not installed does nothing at all, which is why the check's first question is whether the
  required ones are actually there.
- **Arming a hook inside a project yes.** The hook is in user settings and applies to every
  project on the machine. It gets its own row, its own mark, and its own yes.
- **Reading history at session start.** These transcripts run to tens of megabytes. A check that
  costs a second at every session start is a check that gets removed, and then nothing is watching
  at all.
- **Treating an absent history as evidence of nothing happening.** A machine that has never opened
  this repository has no history for it. That is *unknown*, not zero — and a skill must not be
  dropped because the evidence was never going to be here.
- **Overwriting a hand-edited routing file.** It is generated, and a formatter or a person can
  still have touched it. Refresh shows the diff and asks; it does not tidy.
- **Committing tooling files into a repository that is not yours.** Placement is asked once per
  repository and defaults to local for any origin owner the user has not listed.

## Verification

- [ ] The run announced its entry point before reading anything.
- [ ] Placement was settled once, and matches the repository's origin owner or the user's answer.
- [ ] Every recommended skill carries the evidence that justified it; weak ones are labelled.
- [ ] The change list showed every skill, file and hook, each with its undo, before any write.
- [ ] Nothing was written without one explicit yes.
- [ ] Installs and hooks were run in order, stopping at the first failure, with the result naming
      what was applied and what was not.
- [ ] No CLAUDE.md, AGENTS.md or generated context file was touched.
- [ ] A declined skill is either absent from the profile or recorded with its own fingerprint.
- [ ] The hook, if armed, was armed on its own explicit yes and is marked as affecting all
      projects.
- [ ] `check` says nothing in a repository where everything agrees.

The project is onboarded when a new session in that repository sees the right skills without
anybody remembering to mention them — and when the person who owns the repository can undo every
line of it from the list they said yes to.
