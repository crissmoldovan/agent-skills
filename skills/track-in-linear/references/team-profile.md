# The team profile

One file per team holds every value the Linear workflow skills need and Linear cannot tell them:
who gets unowned tickets, which status means "ready for review", who verifies, who says go for
production. The skills read it before their first write and never borrow a value from another
team. A value the profile leaves out is asked of the person the session works for; it is never
guessed.

Keep it at the root of the repository the team's work happens in, as `LINEAR.md`, unless the
skill's binding B1 names another place. Copy the template below and fill it in. Every section is
optional except **Team**; a skill that needs a section the profile does not have says so and asks.

The values here are for agents and people alike. Write them as plain facts, not instructions to
an agent: the skills already carry the rules.

## Template

````markdown
# How <team name> works in Linear

## Team

- Workspace: <workspace name>
- Team: <team name>, key `<KEY>`, id `<team uuid>` (from `get_team`)
- Lead: <name>, who rules on the team's open questions and is told what an agent finds
- Default assignee: <name>, who gets every ticket an agent creates or writes to unassigned
- Standing rules page: the team document titled "Standing rules" (or: none yet)

## Statuses

Map each role the skills use to this team's own status name. Leave a role out if the team does
not use it.

| Role | Status | Who moves a ticket there |
|---|---|---|
| intake | Triage | anyone filing |
| planned | Todo | a person, after sorting |
| investigating | — | |
| in progress | In Progress | the work's first pull request, or by hand with a comment |
| in review | In Review | the pull request, with the evidence attached, or by hand |
| shipped | Done | the release that carries the work |
| accepted | — | a person other than the one who did the work |
| blocked | — | anyone, with the reason and what it waits on |
| canceled | Canceled | a person, with the reason |
| duplicate | Duplicate | a person, with the original linked |

## Labels

- Kind group: `Kind` — kinds in the order they are tried: Question, Bug, Feature request,
  Change request, Task (add the team's own, e.g. Data request, Access request, Notice)
- Bug label: `Bug` (say whether it sits inside the Kind group or outside it)
- Origin group: `Origin` — Client, Internal (or: none)
- Source group: `Source` — Email, Chat, Call, Direct in Linear (or: none)
- Severity group: (or: none)
- Waiting-on label: (or: none)
- Stage group: `Reached` — Preview, Staging, Production, single choice (or: none)
- Version labels: yes, one per release, named as shipped (or: no; or: Linear Releases)

## Titles

- Numbering: none (or: titles lead with the team's record number, e.g. `REC-012 · …`, taken from <where>)

## Where other asks go

| Ask | Goes to |
|---|---|
| access, invites, accounts | <team or project> |
| another project's work | that project's team |

## Pull requests

- Closing words: `Fixes <id>`; contributing words: `Part of <id>`
- A merge closes the ticket: yes / no (the team's workflow automation decides; say which)
- Ticket ids in pull request titles: only on the pull request that completes the ticket

## Verification

- By: <names>, never the person who did the work
- How: <what they check, and where>

## Releases

Used by `promote-release`. The commands live in the repository's `RELEASING.md`.

- Environments, in order: local, preview, staging, production
- Branch per step: preview `<branch>`, staging `<branch>`, production `<branch>`
- Address per step: preview `<url>`, staging `<url>`, production `<url>`
- Version names: `X.Y.Z-preview.N`, `X.Y.Z-staging.N`, `X.Y.Z`
- Go per step: preview <who>, staging <who>, production <who>
- Production waits for: <each confirmation, by whom>
- A request to skip a step counts only from: <who> (or: nobody; the full route always)

## Who hears what

| When | Who | Note |
|---|---|---|
| a release reaches preview | <names> | |
| a release reaches production | <names> | |
| a ticket someone reported changes status | the reporter | |
````

## Reading it

- **A value left out is a question,** asked once of the person the session works for, and the
  answer is offered back as an edit to the profile. Never fill it from another team's profile or
  from this template's example values.
- **The Standing rules page in Linear is newer than the profile.** Where the two disagree, stop
  and ask; do not pick one.
- **Names, not handles.** A person is named as the team knows them; Linear's `get_user` resolves
  the account when a write needs one.
- **No secrets.** The profile is committed. It names who holds a credential, never the credential.
