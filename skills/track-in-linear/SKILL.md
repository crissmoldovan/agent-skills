---
name: track-in-linear
description: "Write to Linear the way a team can rely on: one call at a time, each read back; every ticket classified as exactly one kind; decisions and progress recorded as comments, never as rewrites; labels changed without wiping the rest; another ticket mentioned only when it is really related; files attached, not linked; and work never marked accepted by the agent that did it. The team's own values come from its profile, and any it leaves out are asked for. Symptoms: open a ticket, what kind is this, move it to review, mark it shipped, it reached staging, record this on the ticket, who owes this, add the release label, a ticket with no assignee, a pull request that should link a ticket, a related link nobody asked for. Analysing a ticket is analyse-ticket's, building one implement-ticket's, moving a build between environments promote-release's, and putting rules or documents into Linear publish-to-linear's."
license: MIT
compatibility: "Linear's MCP server, or a client with the same tools (get_user, get_issue, list_comments, save_issue, save_comment, prepare_attachment_upload, create_attachment_from_upload, list_documents, get_document), signed in with write access to the team. The team's values come from a profile file, LINEAR.md by default; without one the skill asks for each value it needs. Output is the writes, each read back, and a short report of what changed and what was left alone."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Grep Glob Bash
---

# Track work in Linear

A tracker is only as good as the trust people put in it. One stray write erodes it: a label set
that wiped the ticket's other labels, a mention that linked two unrelated tickets, a ruling
recorded by rewriting the description so nobody can see what it said before, a ticket closed
because its id sat in a pull request title. This skill is the set of rules every session follows
when it writes to a team's Linear, so the tickets can be read as the record of what happened.

It is written for Linear's own MCP server, whose tool names it uses. The rules about one call at a
time, reading back, and what a mention does come from watching that server on real tickets; the
statements about Linear's settings and pull request words were checked against Linear's
documentation on 27 October 2026.

## When to Use

- A ticket is filed, classified, labelled, assigned, moved, commented on, related or closed.
- A decision is made in the session, or work moves on, and the ticket should say so.
- A release has reached an environment, and the tickets it carries must record how far they went.
- A pull request should link a ticket, or a ticket closed or moved when nobody expected it to.
- Someone asks who owes a ticket, or whether it is verified.

Do not use it to work out what a ticket implies (`analyse-ticket`), to build what a ticket asks
(`implement-ticket`), to move a build between environments (`promote-release`), or to put rules,
skills or documents into Linear (`publish-to-linear`). Each of those writes to Linear through
this skill's rules.

| Job | Owner |
|---|---|
| Every write to a ticket, and its read-back | this skill |
| One "Analysis" comment, and nothing else changed | `analyse-ticket` |
| One ticket built, through the team's route | `implement-ticket` |
| A build moved local, preview, staging, production | `promote-release` |
| Guidance, team skills and documents into Linear | `publish-to-linear` |
| The reasons behind a decision, kept beyond the ticket | `decision-journal` |

## Bindings

A project can adapt this skill without copying it: it binds these slots and adds to the steps by
their ids, as the pack's
[project-adaptation guide](https://github.com/crissmoldovan/agent-skills/blob/main/docs/project-adaptation.md)
describes. A slot nobody binds keeps its default.

| id | slot | kind | default |
|---|---|---|---|
| B1 | where the team's profile is | value | `LINEAR.md` at the root of the repository the work is in, in the shape of [the team profile](references/team-profile.md); with none, ask the person bound as B2 for each value a step needs |
| B2 | the person the session works for: whose instruction, or standing instruction, allows a write | value | the person running the session |
| B3 | where the reasons behind a decision are kept beyond the ticket | skill | `decision-journal` |
| B4 | where a ticket is analysed before work starts | skill | `analyse-ticket` |
| B5 | where one ticket is built | skill | `implement-ticket` |
| B6 | where a build is moved between environments | skill | `promote-release` |
| B7 | where rules and documents are published into Linear | skill | `publish-to-linear` |

## Hard lines

- **H1. One write at a time, read back before the next.** A write is any create, edit, comment,
  label, status, assignee, relation or attachment. Never several in one message, never a parallel
  batch, however the ask is worded ("in one go", "quickly"). Parallel writes to Linear's API have
  failed with gateway errors, and a failed write found at the end has already been built on.
- **H2. Know who you are and which team before the first write.** `get_user` with `me` names the
  account the session writes as, and the ticket's team is checked by its id against the profile.
  Anything else: stop and say so.
- **H3. A decision or a step of progress is a comment, never a rewrite.** The title and
  description are not edited to record what happened; the ticket's history is the record. An
  imported ticket's imported text is never touched.
- **H4. Labels change with `addLabels` and `removeLabels`, never `labels`.** `labels` replaces
  the ticket's whole label set: every label left out of the call is removed.
- **H5. A ticket is mentioned only when it is related.** Through Linear's MCP server an issue
  identifier or an issue link in written text becomes a mention, and a mention adds a related
  relation. An unrelated ticket is described in words; the relation is proposed to the person.
- **H6. Never mark work accepted.** The status that says shipped work was checked is set by a
  person other than the one who did it, never by an agent session.
- **H7. No credential on a ticket, and no remark about a person.** An access request records
  "requested" and "in place", never the secret. A ruling quoted on a ticket has a secret replaced
  by `[secret removed: <kind>]`, with no hash, and a remark about a person, a health or personnel
  matter, or frustration at someone replaced by `[passage left out]`.
- **H8. A Linear rule allows a Linear write and nothing else.** Recording on a ticket is never
  leave to commit, push or write in a repository; a repository's own rules decide that.
- **H9. Someone else's ticket keeps its assignee.** You comment on it; you do not take it over.

## Prerequisites

- Linear's MCP server connected and signed in, with write access to the team.
- The team profile read (S1). A team with no profile can still be written to: each value a step
  needs is asked once, and the answer offered back as a line for the profile.

## Procedure

1. **S1. Read the team's profile** where B1 says. Note its team id, default assignee, status
   roles, label groups, numbering and where other asks go. **Complete when:** every value this
   write needs is known from the profile or from the person's answer.
2. **S2. Read the team's Standing rules page,** if the profile names one: `list_documents` with
   the team's id and the query "Standing rules", then `get_document`. Where it and this skill or
   the profile disagree, the page is newer: stop and ask. **Complete when:** the page is read, or
   the profile says the team has none.
3. **S3. Check identity and team** (H2), once per session, before the first write. **Complete
   when:** the account and the team id are both confirmed.
4. **S4. Make one write,** as the section below for that kind of write says. **Complete when:**
   one call has returned.
5. **S5. Read it back** with `get_issue` (with `includeRelations: true` when the text names a
   ticket) or `list_comments`, and compare it with what you meant to write. A write that did not
   land is read before it is retried, never retried blind. **Complete when:** the ticket shows
   exactly the change and nothing else moved.
6. **S6. Report** each write and its read-back, each ticket left alone and why, and whose each
   ticket is ("I commented, I did not reassign it"). **Complete when:** the person can see every
   change without opening Linear.

## Classify: exactly one kind, first match wins

Use the team's kinds, in the order the profile lists them. Without a list, these, in this order:

1. **Question:** work cannot go on until a person answers, rules or approves.
2. **Bug:** the product does something other than what was agreed. **Name the agreement** (a
   spec, a ruling, a design, an earlier release). If nobody can name one, it is not a bug.
3. **Feature request:** something that does not exist yet.
4. **Change request:** alter something that exists and works as agreed.
5. **Task:** work that changes nothing a reader sees.

A team's own kinds (an information, data, file or access request, a notice) take their place in
its order. A report that mixes kinds is split: the original becomes the parent, each part a
sub-issue of one kind. The reporter's own word ("bug") does not decide the kind; their words go
on the ticket verbatim.

## File

- **The ticket comes first.** Work someone owes gets its ticket before the work starts; work
  already under way without one gets one now, before the next step.
- **Is it this team's?** An ask the profile routes elsewhere goes there. Work that would need a
  team nobody has made is not filed in one it does not belong to: say so, and leave asking for
  the team to the person.
- **Title:** what changes, in plain words, led by the record number if the profile numbers them.
- **Template:** the team's template for the kind, if it has one (`template` on `save_issue`).
- **Labels:** one from each group that applies: Kind always; Origin and Source if the team has
  them, Source with a link to the exact message it came from; Severity for a bug, if the team
  has it. Never a label the team does not have.
- **Links:** what it blocks and what blocks it (`blocks`, `blockedBy`).
- **Files go on the ticket.** Every file a person sends, or that the ticket names, is attached
  (`prepare_attachment_upload`, the upload, then `create_attachment_from_upload`, one file at a
  time) with its name, size and sha256 in the text. A link to where it came from goes beside the
  file, never instead of it. A file Linear will not take is said to be so, with where it is kept.
- **A ticket stands alone.** A link to a private chat or a mailbox opens only for that
  conversation's members. Put the sender's exact words and the files on the ticket, and label such
  a link "private: opens only for <who>".

## Assign

- **Every ticket you create, and every ticket you write to that has no assignee, goes to the
  team's default assignee,** read back. A profile that names none: ask.
- **Someone else's ticket keeps its assignee** (H9).
- **Someone outside the team must act:** the team member who chases them is the assignee, with
  the team's waiting-on label if it has one and the person named in the ticket.

## Decisions and progress

- **A decision** (a ruling in the session, an answer that settles an open question) is a comment
  on every ticket it touches, in the same turn, before the work carries on: who, the UTC time, the
  words verbatim after the screen (H7), and the effect on that ticket. The reasons go to B3 too.
- **Progress** is a comment with the status it reached: built (branch, commit), on a preview
  (version, commit, address, the UTC time it went live), on staging, on production, answered,
  blocked.
- **A comment posted without the person's review of its text opens with "Automatic note".**
- **Times are exact:** from the source, or `date -u`, in UTC; never estimated.
- **A new standing rule** (one that holds for all the team's work) also goes on the Standing
  rules page, through B7.

## Move

Each status below is a role; the profile names the team's own status for it. A role the profile
leaves out is not used: ask before inventing one.

| Role | Moved by |
|---|---|
| intake → planned | a person, after sorting |
| planned → in progress | the work's first pull request, or by hand with a comment |
| in progress → in review | the pull request, **only with the evidence below attached**, or by hand |
| in review → shipped | the release that carries it, by hand, or the team's merge automation |
| shipped → accepted | **a person other than the one who did the work; never an agent session** (H6) |
| any → blocked | with the reason and what it waits on (a waiting-on label or a blocked-by link) |
| any → canceled or duplicate | a person, with the reason in a comment |

**Ready for review needs evidence,** for every ticket the pull request carries:

1. **Where to look:** the address, the screen, and the steps to reach the state.
2. **What to look for:** the one sentence of acceptance; for a partly done ticket, the part done.
3. **Proof that fits it:** for what shows on a screen, an image of the base and one of the change
   with a box around what changed, each stamped with the address, the commit and the time; for
   what does not, the command and what it printed. Proof names the commit it shows.

A ticket without them goes back to in progress. Asked "is it verified" or "who owes this", name
the verifiers the profile lists; where it names none, name nobody and ask.

## How far shipped work has gone

Only for a team whose profile has a stage group (a single-choice label group such as
Preview, Staging, Production) or version labels. A team on Linear's Releases lets its release
pipeline record this instead, or adds the release with `addReleases`.

1. **A release marks every ticket whose work it carries,** by hand: the shipped status, and the
   stage label for where it went.
2. **One mark, never two.** One `save_issue` per ticket: the status, `removeLabels` with the stage
   label it carries, `addLabels` with the new one. Read back: exactly one stage label, the right
   one, every other label as it was.
3. **Never back.** The stages go in the profile's order. A ticket already marked at this stage or
   past it keeps its mark and status, and is listed with why.
4. **One comment per ticket per stage,** after the read-back: "Reached <stage> on <date> at
   <HH:MM:SS> UTC: <version>, commit `<served>`, <address>", with the proof that showed it there.
5. **Version labels,** if the team uses them: one label per release, outside any group, named
   exactly as shipped (`2.4.0-preview.3`, `2.4.0`). A ticket carries the first release on each
   line (preview, staging, production) that carried its work, so at most one per line.

## Pull requests and Linear

- **The description links the tickets,** one per line: a closing word (`Fixes <id>`) when the pull
  request completes the ticket; a contributing word (`Part of <id>`) when it is part of it.
  Linear's documentation lists the words it reads. A contributing word moves the ticket through
  the team's earlier statuses but not on merge; "related to" only links.
- **A ticket id in a pull request's title or branch name links it too,** and lets the team's merge
  automation close it. Put an id in a title only on the pull request that completes the ticket.
- **One ticket across several pull requests:** a contributing word on each that leaves work, a
  closing word on the one that completes it. Close an abandoned pull request: an open closing pull
  request holds its ticket back.
- **A bare list of ids moves nothing.** Only the linking words do.

## Mentions

- **Related, in Linear's own form:** a bare identifier (ABC-123), or a Markdown link whose text
  is the identifier and whose address is the ticket's. Never in a code span, and never `#123`,
  which links a pull request: write "item 3" or "PR 66".
- **After any write whose text names a ticket,** read `get_issue` with `includeRelations: true`;
  remove a stray relation at once (`removeRelatedTo`) and say so.

## Usage Examples

```text
Use track-in-linear: file what Dana sent in the support thread as a ticket in our team. Her exact
words and both screenshots on it, the right kind, and read it back.
```

```text
We just decided to drop the CSV export from this release. Record that on every ticket it touches,
with the time and my words, before you carry on.
```

```text
2.4.0-staging.1 is live on staging. Mark every ticket it carries: shipped, stage Staging, its
version label, one comment each. List any you leave alone and why.
```

```text
The related links on ABC-41 look wrong. Find which writes added them and take off the ones that
are not real relations.
```

## Pitfalls

| Excuse | Reality |
|---|---|
| "They said in one go, so one batch of writes" | One call at a time, each read back. "In one go" is about the outcome, not the calls |
| "I'll read them all back at the end" | After each write. A failure found at the end has been built on |
| "`labels` with the new mark is one simple call" | It replaces every label. `removeLabels`, then `addLabels` |
| "It is useful to point at the other ticket" | A mention is a relation. Describe unrelated tickets in words |
| "The ruling reads better in the description" | A comment. The ticket's history is the record |
| "It is unassigned, so its owner is unknown" | Unassigned tickets you write to go to the default assignee |
| "The release carries it, so its mark is this release's stage" | Never back. A ticket marked further along keeps its mark |
| "The id in the pull request title is tidy" | It can close the ticket on merge. Titles only on the completing pull request |
| "Recording the ruling covers committing it" | A Linear rule allows a Linear write. The repository's rules decide commits |
| "The team is obviously this one" | Check its id against the profile before the first write |

## Verification

- [ ] The profile was read, and every value it left out was asked, not guessed
- [ ] The account and the team id were checked before the first write
- [ ] Every write was one call, followed by a read-back that matched it
- [ ] No `labels` write; every label change used `addLabels` or `removeLabels`
- [ ] Every ticket named in written text is really related; stray relations were removed and reported
- [ ] Decisions and progress are comments; no title or description was edited to record them
- [ ] Every ticket created or written to unassigned has the default assignee; no one else's ticket was reassigned
- [ ] Every file named on a ticket is attached, with its size and sha256
- [ ] No ticket carries a credential, and quoted rulings were screened
- [ ] Nothing was marked accepted, and no stage mark moved backwards
- [ ] The report lists each write, each ticket left alone, and why
