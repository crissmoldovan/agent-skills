---
name: publish-to-linear
description: "Put a team's rules and reference into Linear so the people and agents working there can find them, written once in the repository and published one way: agent guidance for the workspace or a team, a team skill for Linear's agent, a document on a team, project or initiative, and the one page a team keeps in Linear itself, its Standing rules. Each place gets the form its reader needs and the rule's own words in full, the copy says where to edit it, every publish has the person's go and is read back, and a new standing rule is added in place the day it is given. Symptoms: add this to Linear's guidance, make a Linear skill for filing bugs, put the handbook in Linear, teach Linear's agent our rules, update the how-we-work document, save this as a standing rule, add it to the team's resources, the guidance in Linear differs from the repository. Writing to tickets is track-in-linear's; the record of why a rule was made is decision-journal's."
license: MIT
compatibility: "Linear's MCP server, or a client with the same tools (list_documents, get_document, save_document, list_agent_skills, get_agent_skill), signed in with write access to the team's documents, and the repository the rules are written in. Guidance and team skills have no MCP write tool: the skill prepares the exact text and a person adds it in Linear's settings (paths checked against Linear's documentation on 27 October 2026). Output is the published copies, read back, and a record of each publish."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Write Edit Grep Glob Bash
---

# Publish to Linear

A team's rules usually live in a repository: reviewed, versioned, and invisible to the people
and agents who work in Linear all day. Copy them in by hand and there are soon two versions, the
one in Linear quietly edited and the one in the repository quietly ahead. This skill keeps one
source and one direction: the rule is written in the repository, published into the place in
Linear where its reader will meet it, and the copy says where to edit it.

The one exception is a team's **Standing rules** page. Rules that hold for all of a team's work
are given in conversation ("from now on…") and must be findable the same day, so that page lives
in Linear and is edited in place.

## When to Use

- "Add this to Linear's guidance", "teach Linear's agent our rules".
- "Make a Linear skill for filing bugs", or any repeatable task Linear's agent should run.
- "Put the handbook in Linear", "update the how-we-work document", "add it to the team's
  resources".
- "Save this as a standing rule", or a rule given with "from now on", "always" or "never".
- The guidance or a document in Linear no longer matches the repository.

Do not use it to write to tickets (`track-in-linear`) or to record why a rule was made
(`decision-journal`, which keeps the reasoning; this skill publishes the rule).

| Job | Owner |
|---|---|
| Guidance, team skills, documents and the Standing rules page | this skill |
| Ticket writes, including the comment on the ticket that prompted a rule | `track-in-linear` |
| The reasons behind a rule, kept beyond Linear | `decision-journal` |

## Bindings

A project can adapt this skill without copying it: it binds these slots and adds to the steps by
their ids, as the pack's
[project-adaptation guide](https://github.com/crissmoldovan/agent-skills/blob/main/docs/project-adaptation.md)
describes. A slot nobody binds keeps its default.

| id | slot | kind | default |
|---|---|---|---|
| B1 | where the team's profile is | value | `LINEAR.md` at the root of the repository, in the shape `track-in-linear` describes; with none, ask the person bound as B2 |
| B2 | the person whose go a publish needs | value | the person running the session |
| B3 | where each thing is written in the repository | value | `linear/guidance.md` (workspace or team), `linear/skills/<name>.md` (team skills), and documents where the repository already keeps them; a folder that does not exist yet is created in the same pull request |
| B4 | where each publish is recorded | value | the repository's `CHANGELOG.md` |
| B5 | the rules every Linear write follows | skill | `track-in-linear` |
| B6 | where the reasons behind a rule are kept | skill | `decision-journal` |

## Hard lines

- **H1. Written in the repository, published one way.** Guidance, team skills and reference
  documents are written in the repository, reviewed by pull request, then published. Never edited
  in Linear: the next publish overwrites the edit, and until then there are two versions. The
  Standing rules page is the one exception.
- **H2. A publish is a write.** It needs the go of the person bound as B2, for that publish. One
  call at a time, read back, and what you found is said.
- **H3. One text, carried in full.** Linear's agent cannot open a private repository, so guidance
  or a team skill carries the rule's own words, taken from its canonical text: never a pointer to
  a section, and never the rule in other words. When the canonical text changes, what was
  published from it is published again.
- **H4. One Standing rules page per team, edited in place.** Never a second page. A rule that
  replaces another says which, and the old one is struck through, not deleted.
- **H5. Nothing goes into Linear that everyone who can see the team should not read.** No
  credential, and no remark about a person.

## Where each thing goes

| Place | Level | Who reads it | What belongs there |
|---|---|---|---|
| **Agent guidance** | workspace, or a team (the team's wins where both exist) | Linear's agent and agents installed into Linear, automatically, when they work on the team's tickets | Short rules an agent must follow: what it may and may not set, what a ticket needs before review, how pull requests name tickets |
| **Team skills** | a team | People, as a slash command in Linear's agent; the agent also uses one by itself when the conversation matches | One repeatable task, start to finish: file a ticket, review a ticket, list what is blocked and on whom |
| **Documents** | a team, project, initiative, issue or cycle (Linear has none at workspace level) | Anyone who can see that team or project; agents can find them, and guidance that mentions a document lets the agent read it | A team's how-we-work page and its Standing rules; a project's plan and decisions; an initiative's goal |
| Status descriptions, templates | a team | People, in Linear's own screens | One line per status; one template per kind |

As Linear's documentation stood on 27 October 2026: workspace guidance is under Settings → Agents
→ Additional guidance, and a team's under that team's settings → Agents → Additional guidance;
team skills are under the team's settings → AI & Agents → Agent skills, and who may manage them is
a team permission. How an agent applies guidance depends on that agent's integration. Coding
agents working outside Linear do not receive this guidance: they read team skills and documents
through the MCP server (`list_agent_skills`, `get_agent_skill`, `list_documents`, `get_document`),
and take their rules from the skills installed in their own harness.

## Writing for each reader

- **Guidance:** rules only, in the imperative, one line each, each in its canonical text's words,
  followed by where it comes from, for whoever edits it later. No background; a document carries
  that.
- **A team skill:** a title that names the task ("File a ticket"), then the steps, then what the
  result must look like. One task per skill.
- **A document:** the file as it is, headed with one line: "Published from `<repository>`,
  `<path>` at `<commit>`. Edit it there, not here."

## Prerequisites

- Linear's MCP server connected, with write access to the team's documents.
- The repository the rules are written in, and the team profile (B1) for the team's id and its
  Standing rules page.

## Procedure

1. **S1. Pick the place** from the table above, for the reader who needs the rule. **Complete
   when:** the place and its level are named.
2. **S2. Write it in the repository** where B3 says, in the form its reader needs, carrying the
   canonical words (H3), through a pull request. **Complete when:** the pull request is merged.
3. **S3. Get the go** for this publish (H2). **Complete when:** the person's words are quoted with
   their time.
4. **S4. Publish.** A document: `save_document` with the team's or the project's id (one parent),
   or with the existing document's id to update it. Guidance or a team skill: no MCP tool writes
   them, so hand the person the exact text and where it goes in Linear's settings; a team skill
   can also be created by asking Linear's agent to save it as a team skill. **Complete when:** the
   document call returned, or the person says the text is in.
5. **S5. Read it back:** `get_document`; for a team skill, `list_agent_skills` and
   `get_agent_skill`, compared with the file. **Complete when:** the copy in Linear matches the
   merged file, word for word, or the difference is reported.
6. **S6. Record the publish** where B4 says: what, where in Linear, from which commit, and who
   said go. **Complete when:** the record is committed with the person's leave, as the
   repository's rules require.

## Adding a standing rule

When the person who leads the team gives a rule that holds for all its work ("from now on…",
"always", "never", "for future reference"):

1. **S7. Read the page:** `list_documents` with the team's id and the query "Standing rules";
   then `get_document`. **Complete when:** the page and its last rule number are known, or it is
   known there is none.
2. **S8. Add the rule in place,** with the person's go: `save_document` with the page's id, under
   the heading it belongs to, numbered after the last rule, with the date and the words as said
   (H4). **Complete when:** the call returned.
3. **S9. Read the page back,** and say what you added. **Complete when:** the rule is on the page
   once, numbered and dated.
4. **S10. Note it where it came from:** a comment on the ticket that prompted it, through B5, and
   the reasons through B6. **Complete when:** both are written, or there was no ticket.
5. **S11. Change the setup too** when the rule changes a label, a status or a pull request rule:
   through the team's own setup, by pull request. **Complete when:** the change is proposed, or
   the rule needs none.

A team with no page yet: propose one to the person. The first page is made with their go, as a
team document titled "Standing rules".

## Usage Examples

```text
Use publish-to-linear: our rule for pull request words is in docs/working-rules.md. Put it into
the team's agent guidance in its own words, and tell me exactly what to paste and where.
```

```text
Make a team skill for Linear's agent that files a bug the way our team does. Write it in the
repository first, then give me the text to add.
```

```text
From now on, nothing goes to production on a Friday. Save that as a standing rule for the team.
```

```text
The how-we-work document in Linear has drifted from the repository. Show me the differences, then
publish the repository's version over it once I say go.
```

## Pitfalls

| Excuse | Reality |
|---|---|
| "It is quicker to fix the wording in Linear" | The next publish overwrites it. Fix it in the repository |
| "The guidance can point at the section in the repository" | Linear's agent cannot open a private repository. Carry the words |
| "I will paraphrase the rule to fit one line" | The rule's own words, from its canonical text |
| "There is no page, so I will start one" | Propose it; it is made with the person's go |
| "A fresh page is tidier than editing the old one" | One page per team, edited in place |
| "The MCP server can write the guidance" | It cannot. Hand the person the exact text and where it goes |
| "The person said publish last week" | A go covers the publish it was given for |

## Verification

- [ ] The rule was written in the repository and merged before it was published
- [ ] Guidance and team skills carry the rule's own words, not a pointer or a paraphrase
- [ ] Each copy names where to edit it, except the Standing rules page
- [ ] Every publish had the person's go, quoted with its time
- [ ] Every published copy was read back and matched the merged file, or the difference was reported
- [ ] A standing rule was added in place, numbered and dated, on the team's one page
- [ ] The ticket that prompted a rule has its comment, and the setup change is proposed where needed
- [ ] Every publish is recorded with what, where, from which commit, and who said go
- [ ] Nothing published carries a credential or a remark about a person
