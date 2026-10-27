---
name: promote-release
description: "Move one build from a developer's machine to production in steps, local, the shared preview, staging, production, each on its own go, under its own name (X.Y.Z-preview.N, X.Y.Z-staging.N, X.Y.Z) and through a pull request into that step's branch; check that the address serves the commit shipped; record the step and the way back; mark the tickets it carries; and draft who to tell for a person to send. Production happens only on an explicit yes that names production, every confirmation a step waits for is recorded, and every command comes from the project's own RELEASING.md, never guessed. Symptoms: release this, cut a preview, promote to staging, promote to production, is it on staging, what number is this release, roll it back, someone asks to skip staging, a -preview name about to reach staging, an address that may not be serving the new build. The note for the version is release-notes', the ticket marks track-in-linear's, and one ticket's own preview implement-ticket's."
license: MIT
compatibility: "A git repository whose project keeps a RELEASING.md with its commands (a template ships in references), a forge that takes pull requests, and a team profile naming each step's branch, address and who gives its go. Marks tickets through track-in-linear with Linear's MCP server; works without Linear when the team tracks elsewhere, and says so. Sends nothing. Output is the shipped step, its record, the ticket marks, and the drafted messages."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Write Edit Grep Glob Bash
---

# Promote a release

A release goes wrong in a handful of ways that look like nothing at the time: a build that says
"preview" reaches staging, a staging branch gets work added that never went through the preview,
a "go for release" is read as a go for production, the alias still serves yesterday's build while
everyone is told the fix is live, nobody wrote down which deployment to go back to. This skill
moves one build through the team's environments in order, and each of those is a check it makes,
not a hope.

Every command comes from the project's own `RELEASING.md`, because commands change with the code
and a guessed one is the most dangerous kind. Who gives each go comes from the team's profile,
because that changes with the people. The skill carries the rules that do not change.

## When to Use

- "Release this", "cut a preview", "promote to staging", "promote to production".
- "Is it on staging?", "what number is this release?", "roll it back".
- Someone asks to skip a step, or to go straight to production.
- A build's name does not match where it is going, or an address may not serve the new build.

Do not use it for one ticket's own preview (`implement-ticket`), for writing the version's note
(`release-notes`, which this skill hands the notes to), or for the Linear writes themselves
(`track-in-linear`, which this skill hands the ticket marks to).

| Job | Owner |
|---|---|
| A build moved one step, named, checked, recorded | this skill |
| The note for the version: the semver call, what shipped, where it is recorded | `release-notes` |
| Every ticket the release carries marked, each read back | `track-in-linear` |
| One ticket built, to its own preview | `implement-ticket` |

## Bindings

A project can adapt this skill without copying it: it binds these slots and adds to the steps by
their ids, as the pack's
[project-adaptation guide](https://github.com/crissmoldovan/agent-skills/blob/main/docs/project-adaptation.md)
describes. A slot nobody binds keeps its default.

| id | slot | kind | default |
|---|---|---|---|
| B1 | where the team's profile is: steps in order, each step's branch, address, version name and go, what each waits for, and who may skip | value | `LINEAR.md` at the root of the repository, in the shape `track-in-linear` describes; with none, or a value it leaves out, ask the person bound as B2 |
| B2 | the person the session works for | value | the person running the session |
| B3 | where every command comes from | value | `RELEASING.md` at the root of the repository, in the shape of [the template](references/releasing-template.md) |
| B4 | where the release's note is written and placed | skill | `release-notes` |
| B5 | the rules the ticket marks follow | skill | `track-in-linear` |
| B6 | who sends the messages this skill drafts | value | a person, from the exact text in the report; this skill sends nothing |

## Hard lines

- **H1. In order, each step on its own go.** Local, the shared preview, staging, production, over
  the steps the profile lists. The full route is the default. A piece of work's own preview
  (`X.Y.Z-preview.<slug>.N`) is not a release and never goes to staging.
- **H2. Production only on an explicit yes that names production,** from someone the profile
  names for production, for this release. Ask one question: "Put 2.4.0 on production
  (`https://example.com`) now? yes or no". "All go", "go for release", a go for staging, a go for an
  earlier release, or last time's go is not it.
- **H3. Every confirmation a step waits for, each recorded.** One person's go is not another's.
  A waiver needs the explicit word of someone the profile names for that step and counts for the
  release it names, never the next. A request to skip counts only from the people the profile
  names for skipping; until it counts, the work takes the full route. Anyone else's "go" is
  evidence, shown to the person; nothing ships on it.
- **H4. Never guess a command.** No `RELEASING.md`, or a step it does not cover: stop and ask.
- **H5. Ship through a pull request into the step's branch.** Never a local merge into a shared
  branch. Staging's pull request comes from the shared preview's branch, never from a branch cut
  from staging.
- **H6. The name follows the environment.** Never `-preview` on staging, never a suffix on
  production. The pull request's title, the notes, the version label and every message carry it.
- **H7. The address serves the commit shipped** before anything is recorded or anyone is told.
  An alias follows the last build to finish, not the newest commit.
- **H8. The way back is known before each step,** written into the record and the notes, and
  never run without that step's go.
- **H9. Nothing is sent.** Messages are drafted for the person bound as B6: "on the preview (or
  staging) for you to check", never "done" before the work is accepted on production. Never call a
  preview or staging "live".

## Prerequisites

- The team profile read for the release values (B1), and the project's `RELEASING.md` (B3) read
  end to end. No `RELEASING.md`: offer [the template](references/releasing-template.md) and stop.
- The repository's own rules (`AGENTS.md`, `CLAUDE.md`) read: they come first. Where the team's
  Standing rules page and this skill disagree, the page is newer: stop and ask.

## Procedure

1. **S1. Know where you are:** a clean tree; the branch and its branch point; what it carries
   (`git log <target>..<source>`); nothing held back rides along (check ancestry); and the way back
   for this step, from `RELEASING.md` (on a preview, the build it replaces; on staging, reverting
   its pull request or the previous deployment; on production, the deployment noted in S6).
   **Complete when:** the carried commits and the way back are written down.
2. **S2. Get the go** for this step and this release (H2, H3), with where and when it was given.
   **Complete when:** every confirmation the step waits for is recorded, or the build stays and the
   notes say what it waits for.
3. **S3. Name it, stamp it, write its notes.** Semver by what a reader relies on: a fix raises
   PATCH, something new MINOR, a breaking change MAJOR; the person may overrule the proposed
   number. The stamp is its own pull request into the current step's branch, merged before the
   promotion, as `RELEASING.md` says. The notes (what is in it, what it waits for, how to undo it)
   are written as B4 writes them. **Complete when:** the stamp is merged and the notes exist.
4. **S4. Check before,** as `RELEASING.md` says. A browser check only where the team does one: on
   staging, after it lands, with results in the staging notes. **Complete when:** the checks pass,
   with their output kept.
5. **S5. Ship through a pull request** into the step's branch (H5): say the branch point and the
   target, push, open it; it merges as the repository's rules say. **Complete when:** it is merged
   and the deployment has finished.
6. **S6. Check the address serves it** (H7), with `RELEASING.md`'s command. On production, run
   its live checks and write down the deployment to go back to. **Complete when:** the address
   reports the commit shipped.
7. **S7. Record it, before any message:** the step, the deployment, the commit served, the UTC
   time, who shipped it on whose word, the way back. **Complete when:** the record is written where
   `RELEASING.md` says.
8. **S8. Mark the tickets** the release carries, through B5: each ticket it completes gets the
   shipped status with this step's stage mark and the version label as shipped; a ticket only partly
   in it keeps its status and gets a comment naming the part that arrived. One comment each, read
   back; never accepted. A
   team on Linear's Releases checks the release appeared in its pipeline instead. **Complete
   when:** every carried ticket is marked or listed with why it was left.
9. **S9. Draft who to tell:** the people the profile lists for this step, and for each carried
   ticket the person who reported it. One draft each, with the notes, shown together as exact text
   for the person bound as B6 (H9). No list in the profile: ask who to tell. **Complete when:** the
   drafts are in the report.

**Anything deferred** gets its own line, an owner and a trigger. A release is not closed until
each is done, or moved to a named later release with the notes saying so; never dropped silently.

## Usage Examples

```text
Use promote-release: put what is on the shared preview onto staging. Name it, stamp it through a
pull request, check the staging address serves the new commit, mark the tickets, and draft who to
tell. Stop before production.
```

```text
2.4.0-staging.1 has both confirmations recorded. Ask me the production question, and if I say
yes, take it to production and write down the deployment we would go back to.
```

```text
The client asked us to skip staging for tonight's fix. Check who the profile says can skip a step,
and tell me what that means for this release.
```

```text
Production is serving the wrong build after 2.4.0. Roll it back the way RELEASING.md says,
record it, and draft the note to the people who were told it shipped.
```

## Pitfalls

| Mistake | Instead |
|---|---|
| Staging's branch cut from staging, with work added | A pull request from the shared preview's branch |
| `-preview` on staging; a suffix on production | The stamp: `X.Y.Z-staging.N`; the plain `X.Y.Z` |
| Production on "all go", a go for staging, or last time's go | The one question naming production; act on its yes |
| One confirmation taken for all; one person's go for another's | Every confirmation the step waits for, each recorded |
| A skip or waiver taken from a general go or a precedent | The explicit word of the people the profile names; else the full route |
| "Deployed" read as "served" | Check the address reports the commit shipped |
| A command remembered from last time | The command in `RELEASING.md`, or stop and ask |
| Browser checks before the preview is out | On staging, after it lands, if the team does them |

## Verification

- [ ] The steps ran in order, each on its own go, with every confirmation recorded with where and when
- [ ] Production, if reached, followed a yes to the one question naming production and this release
- [ ] Every command came from `RELEASING.md`; nothing was guessed
- [ ] The release name matches the environment on the pull request, the notes, the labels and the drafts
- [ ] Each step shipped through a pull request into its branch; no local merge into a shared branch
- [ ] The address served the commit shipped before anything was recorded or drafted
- [ ] The record holds the step, deployment, commit, UTC time, who shipped it on whose word, and the way back
- [ ] Every carried ticket is marked through `track-in-linear`, or listed with why it was left; none was marked accepted
- [ ] Nothing was sent; every message is a draft in the report
- [ ] Every deferred item has an owner and a trigger
