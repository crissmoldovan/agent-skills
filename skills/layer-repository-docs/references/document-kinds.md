# Document kinds, edit rules, tiers

The three layers are roles. Most of the files in a repository are none of them. This file names
the other kinds, gives each one a home and an **edit rule**, and gives the ladder that decides
which of them a repository should have at all.

The reason to classify at all: these kinds age at different rates. A spec is stable and a
working list is stale within the week. Put them in one file and the file has no edit rule, so
nobody can tell whether editing a line is a correction or a falsification — and the usual
outcome is that everybody stops editing it.

## The kinds

| Kind | Where it lives | What it is for | Edit rule |
|---|---|---|---|
| Record: spec | a numbered file under a spec directory | The contract. The manual explains it and links to its sections; where the two differ, the spec wins and the manual has a bug. | `amend` |
| Record: decisions | a decisions file beside the specs, or a decisions directory | The home of "why". | `supersede` |
| Record: research and evidence | a research directory, with evidence beneath it | Reached through citations, not read front to back. May hold personal data, and therefore stays private. | Existing files are not edited. An evidence index may gain one row per new file. |
| Runbook | beside the code it operates, or in a runbooks directory | A manual chapter for an operation, often one person's. | The **only** home of deploy-time variable names, endpoints, domains and deploy step state. |
| Skill | a skill file under a skills directory | A manual chapter written for agent sessions. | Links to the manual's reference for flags and counts. A mirrored copy says where it came from and changes only at its source. |
| Working: list | a status or backlog file | The home of dated status. | `strike through and date`. Any "last updated" line matches the newest entry in the file. |
| Working: session prompt | one file at the root, pasted into a new session, not loaded automatically | A reading order; dated state, each item with its owner and any standing direction that governs it; ground truth, each fact with its date, its home and how to re-measure it. | Rules for all work live in the agent file, not here. |
| Working: handoff | a dated file under a handoffs directory | Moves one piece of work, or one decision, to a person or a repository. | `delete when accepted` — version control keeps the history. |
| Working: proposal | under the docs directory | A document awaiting a decision. | Says that it is a proposal, who decides, and that it binds nothing. |
| Agent file | the harness context files at the root | Rules for agent sessions, kept apart from the repository rules that also bind people. | Owned by `derive-codebase-context`. This skill records it, its edit rule and its audience, and writes none of its content. |
| Source | schemas; the usage header of a script | The home of a vocabulary, or of a command's flags. | Changed with the code, in the same change. |
| Generated | a build output directory | Output. | `never`. A check fails the build when it is stale. |

## The edit-rule vocabulary

A docs map is only useful if the edit rules are a closed set. These seven cover every kind above:

- **`PR`** — changed through a pull request like any other file.
- **`never`** — not edited by hand at all; regenerate instead.
- **`strike through and date`** — the old line stays, struck through, with the date it stopped
  being true.
- **`supersede`** — a new entry replaces an older one, which remains in place and readable.
- **`amend`** — a deliberate change, recorded in the decisions record.
- **`add only`** — new files or new rows; existing content is never edited.
- **`delete when accepted`** — the file's job ends when somebody accepts it.

## The docs map

One table, in the manual's reference part, listing every document in the repository. It is the
only complete list, and it is the file that makes the next person's inventory take ten minutes
instead of a morning.

| Document | Kind | Audience | Edit rule |
|---|---|---|---|
| `README.md` | Quick start | anyone arriving | `PR` |
| `docs/MANUAL.md` | Manual | people using or changing the repository | `PR` |
| the spec files | Record: spec | people changing behaviour | `amend` |
| the decisions file | Record: decisions | anyone asking "why" | `supersede` |
| the status list | Working: list | the owner and any active session | `strike through and date` |
| the build output | Generated | nobody; machines read it | `never` |

One line under the table records the revision whose sources were last read for it — `sources re-read
at <sha>` — the one freshness stamp worth carrying, because it names something a reader can check,
and because it is where a later `update` run starts.

State the repository's tier in one line of the docs map — or, at the lowest tier, in the README,
since there is no map.

## The tier ladder

Tiers keep the standard from manufacturing work. A repository is one of three things, and the
thresholds are opinion.

| Tier | What it is | What it has |
|---|---|---|
| 0 | Nothing others run or change: a deck, a static site, a delivered report | A README, with a **Use** section if anything has to be run |
| 1 | Commands others run, or code others change | A README, plus a manual once a trigger below fires, plus agent files once theirs fires |
| 2 | Also a spec another system depends on, a deploy, or a published interface | A README as the router, a manual with its docs map, and whatever records, runbooks, working documents and agent files it actually uses |

## Triggers — what creates each document

Nothing is created because the tier table permits it. Each document appears when its trigger
fires, and not before.

- **Manual:** the README passes its cap; a second audience appears; a task needs more than three
  steps; a command takes flags or credentials.
- **Agent files:** the repository has a rule an agent would break by default, or a rule has had to
  be repeated to a session. (What goes in them is `derive-codebase-context`'s.)
- **Session prompt:** work regularly spans sessions.
- **Handoff:** a piece of work, or a decision, moves to another person or another repository.
- **Records:** the first decision somebody will ask "why?" about, or the first spec another system
  depends on.
- **Runbook:** the first operation only one person performs, with credentials.
- **Removal:** a document with no reader, or with dead content, is deleted. Version control keeps
  the history, and a deleted document is cheaper than a wrong one.

## Visibility

Three rules that cut across every kind:

- A public repository does not name or link paths inside a private one.
- A repository a client can see carries no internal link, no internal status, and no internal name
  beyond a role.
- Examples use patterns and `example.com` addresses, never a real one — including in a private
  repository, because a private repository's contents move.
