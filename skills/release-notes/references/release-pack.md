# A release sent to people as a document pack

Some releases are sent as well as published. A build goes to the people who approve it, a version
to the customers who asked for it, a report to the readers who act on it: a note and the documents
beside it, carried by one message. `release-notes` (B9) still makes the semver call and writes the
note. This file covers what sending adds: the pack is pinned at both ends, every sentence in it is
sourced and checked before anyone reads it, what is sent is byte for byte what is kept, and the
message is prepared for a person to send.

A project can adapt this file on its own, as the agent-skills
[project-adaptation guide](https://github.com/crissmoldovan/agent-skills/blob/main/docs/project-adaptation.md)
describes for a reference file. Its ids continue the numbering of the skill's `SKILL.md`, and it
cites none of that file's ids, so it reads the same with or without it.

## Bindings

| id | slot | kind | default |
|---|---|---|---|
| B9 | where the version number and the note itself are made | skill | `release-notes` |
| B10 | who the pack goes to | value | ask once |
| B11 | who sends the message: the person whose word sends it, or approves it for sending | value | the person who asked for the release |
| B12 | the companion documents a pack carries beside the note | value | a list of what is still open and whose it is, whenever anything is |
| B13 | the renderer: the command that turns the drafts into the files sent, and the formats it writes | value | none: each document is sent in the format it was drafted in, its source notes stripped and a search finding none left |
| B14 | the archive: where the drafts, the checks, the files rendered and the copies as sent are kept | value | ask once |
| B15 | the zone times are written in, beside UTC | value | UTC only |
| B16 | where a question for the owner of an open decision goes | skill | `request-answers` |

## Hard lines

- **H5. Every sentence is sourced, and checked against its source before anyone reads it.** A
  claim with no source is sourced or cut. A difference with no reason on record goes to its owner
  as a question (B16), and is never written up as approved.
- **H6. The agent never sends the message on its own word.** It prepares the message and shows it
  in full to the person bound as B11. The message goes when that person sends it, or approves that
  exact text, those recipients and those attachments for sending. A message changed after the
  approval is approved again.
- **H7. What is sent is what is kept, byte for byte.** Every file attached is one rendered for the
  release, every rendered file, a binary one such as a PDF as much as a text file, is identical
  to its copy last committed, and every copy as sent is compared with the file rendered before
  the send is recorded.
- **H8. Nobody is asked to decide what is someone else's.** Every open decision names who approves
  it, from the records. The recipients are asked only about what is theirs, and are told that their
  approval does not replace the owner's.
- **H9. The pack is sent whole.** Never one document now and the rest "to follow". If the renderer
  cannot run, dry-run the drafts, hold the message, and ask the person bound as B11 for what the
  render needs.

## What a pack is

**One note, plus companions, plus the message that carries them.**

- **The note** is the release note, in the three parts `release-notes` requires: what, why and
  impact. A notes document may be longer, with a header of facts and sections of detail. It then
  opens with the three parts, in plain words, as its summary, and the other sections follow as
  their detail.
- **The companions** (B12) hold what the note points to rather than repeats: a comparison of every
  difference, view by view, each with its reason; a list of what is still open and whose it is.
  Each one agrees with the note.
- **The message** is one more destination. It is short: the few changes a reader would notice
  first, one paragraph on what is open and who decides it, and one ask. Everything else is in the
  attachments.

Every document carries the same header: its title, the release, who composed it and when (the date
and time in UTC, and in the zone bound as B15), who it is for, and, on a release, every system a
reader could wonder about, the unchanged ones included. Every document the pack points a reader to
is in it, attached by name, never a path in a repository the reader cannot open. A superseded draft
is never attached; the pack names what replaced it.

## Procedure

1. **S8. Pin both ends.** The baseline is the build the readers were last sent: the last pack sent
   to them, or, if they were sent none, what the environment they use serves. The build is the
   commit that will be served. In the note's header, name the baseline by deployment and commit,
   and the build by that commit; its deployment joins it when S14 records the release. Write
   "sent", not "seen", unless the readers said they looked. The previous note is not the baseline:
   a build can be sent without a note, and a note can describe a build nobody was sent.
2. **S9. Gather the differences, then their reasons.** List the commits from the baseline to the
   build, with what each merge brought. Where readers see screens, capture both builds the same way,
   every route a reader takes to a view included, and set the captures side by side. The difference
   between the builds is the list of changes. The records give each one its reason: the issues, the
   decisions, and every reply to the last pack since it went, which is a source too. A loss the
   merge caused is a difference like any other, and putting it back needs its owner's word for that
   item alone.
3. **S10. Draft with a source on every claim.** Write the note first (B9), then the companions, and
   the list of what is open last, from the other documents. Then draft the message to the
   recipients bound as B10, from the note and that list, as "What a pack is" describes, so that
   S11 checks it and S12 shows it with the documents. Every sentence carries a source note
   that the render strips: `<!-- src: path:line | commit | capture -->`. Follow "Writing it", below.
4. **S11. Check with three independent checkers,** each given the drafts and the evidence, and none
   another's findings:
   - **evidence**: every passage against its source, every attribution and name included;
   - **consistency**: the message, the note and every companion carry the same open items, figures,
     approvers and names;
   - **as a recipient**: what a reader would misread, miss, or be unable to act on.

   Re-check every finding yourself before applying it, and record each one you reject, with why.
   Repeat until a pass finds nothing wrong.
5. **S12. Show it all to the person bound as B11,** the message and every document in full, and
   wait for their word. A change goes back through S10 and S11.
6. **S13. Number and stamp the release through B9, then dry-run the render** (B13): the source notes
   stripped, none left, and no scratch or machine path in any file. The dry run writes every file
   the render will, in every format B13 names, binary ones included; one it cannot write yet, as
   when the renderer cannot run (H9), is dry-run once it can, before S16. Commit the files the dry
   run wrote, and keep the drafts with their source notes in the archive (B14). Whenever a document
   changes after this (in the sweep of S14, for a late arrival in S15, or for a fix in S20),
   dry-run it again and commit what it writes: S16 compares against the files last committed. A
   changed document does not stamp the release again; only a changed number does (S15). A time or
   an id the render writes into a file, printed or not, such as when the pack was composed or a
   PDF's creation date, is fixed, never "now" or new on each run: otherwise the dry run and the
   render differ, and the comparison in S16 fails. A renderer that cannot fix them cannot pass
   S16, so the message is held and the person bound as B11 is asked, as H9 says.
7. **S14. Ship it, and record the release before any message.** The record says where it went, the
   deployment, the commit served, the time in UTC and in the zone bound as B15, **who pushed it and
   on whose word**, and how to roll it back. Take the push from its record, such as the reflog of
   the local remote-tracking branch, the deploy log or the forge's record of pushes, never from
   memory. **The commit served is not always the stamp.** Where a merge carries the release to an
   environment, the merge is served: check that the stamp is its ancestor
   (`git merge-base --is-ancestor <stamp> <served>`) and record both. Put the deployment and the
   commit served in every header that names the build. Then sweep the message and every document
   for what the push answered ("not yet", "not pushed", "nobody has checked"), so the message never
   contradicts its attachments, and commit the documents that changed as S13 says.
8. **S15. Take in late arrivals before the render.** Since the drafts began, has anyone ruled on the
   number, the route or the scope, or replied to the last pack? Each one goes in first: a ruling on
   the number through B9, a ruling on the route into the baseline and the environments named, a
   reply into the open list and whatever it changes in the note and the message. A ruling that
   changes the number or the route of what S14 shipped goes back to S13: stamp, ship and record
   again. If someone is still editing a draft, the render waits for them. Then run S11 again, all
   three checkers, over everything changed since its last pass, the sweep of S14 included, and
   commit it as S13 says.
9. **S16. Render and archive** (B13, B14): the drafts with their source notes, the checks with their
   logs, and the files rendered. Search the rendered files for tokens and machine paths first.
   Compare every rendered file, binary ones included, byte for byte (by hash or with `cmp`; a text
   diff passes over a binary file) with its copy last committed, as S13 says (H7).
10. **S17. Prepare the message** to the recipients bound as B10: the text drafted in S10, checked in
    S11 and shown in S12, its source notes stripped and none left, with the files rendered in S16
    attached from the archive, not from a scratch directory. A message is never first written here:
    one with no draft goes back to S10. If the message or a document changed after the person bound
    as B11 read it, show them the difference first. Show them the prepared message verbatim,
    attachments included, and say that nothing has been sent. It goes only as H6 says. Afterwards,
    read the sent folder or the channel before reporting it sent, or still a draft.
11. **S18. Record what was sent.** Copy the attachments as sent into the archive, and compare each
    copy byte for byte with the file rendered (H7). Write down when it went, in UTC and in the
    zone bound as B15, and by whom ("sent by the person bound as B11", or "sent by the agent on
    their approval of the exact message"), the message's ids, the recipients, the subject, each
    attachment with the committed file and commit it copies, and the deployment it describes. Add
    the message to the release record in the next commit. When something a sent pack said proves
    wrong, the correction rides in the next release's message, which names what it corrects.

## S19. A release that carries an earlier one

A release that was sent but never reached an environment can travel inside a later one instead of
going on its own.

- The later note says so in its baseline, and where it lists what is not yet released: the earlier
  release does not go on its own.
- For the recipients, the baseline is still what they were last sent: the earlier release. For each
  environment, it is what that environment serves. Every document says both releases arrive
  together.
- The earlier release's commits after its stamp travel in the later one, listed among its fixes and
  its commits.
- The earlier release keeps its own note. When the later one reaches an environment, every release
  it carries, directly or inside another, gets the same time in its release record, with "inside
  release <later>", so a reader of either note can tell.

## S20. Fixes merged after the stamp

A check after the stamp can find problems, and their fixes can merge before the release moves on.

- **If whoever rules the number under `release-notes` keeps it,** do not stamp again. Where their
  words name the version without ruling on the bump, the record says that keeping the number is a
  reading of their words, and they are shown it, as in S12.
- The note gains a "Fixed after the stamp" section: each fix, its commit, what it fixes, and which
  check found it. The commit list is updated, and so is a bump judge's reading, if one runs.
- The commit served is now the one carrying the fixes. S14's check and record use it, with the
  stamp as its ancestor.
- Run S11 again over the changed documents, commit them as S13 says, then run S15 and S16 again.
- **If nobody has ruled,** ask once: in this version, or in the next patch.

## Writing it

- **Say whose numbering you use**, once, when the items a reader knows by number are numbered
  differently in the two builds, and mark every exception. When one item moves, the list renumbers.
- **Count from the build, not from a pattern.** A count made by a search misses what the search did
  not expect. Read every item the count leaves out.
- **Attribute exactly.** Say who raised what, in their own words. Unsure of a name, such as one
  taken down from speech, use the role instead.
- **Every open decision names who approves it**, from the records (H8). When no record does, write
  "no record names who decides". Say whose it would be only when a record names who owns that
  area, and cite it. Give a recommendation only when one is on record, and cite that record.
- **Work that has not merged** goes in as "work in progress, not merged", with its branch and head.
- **Write "not yet", never "never",** and say where the work goes next.
- **A note about a pre-production environment says so at its top.** It is not the production
  release note.
- **Write for the recipients.** Engineering detail goes under a heading that says it is for
  engineers. A section on how the release was checked opens with one plain line.

## Pitfalls

| what went wrong | so |
|---|---|
| The note said the build still showed the old version | Stamp before the checks on the live build, and before anything is sent |
| A check "passed" on the baseline, where in fact it was skipped | Report a skipped check as not run, with the reason |
| A count made by a pattern missed a quarter of the items | Count from the build ("Writing it") |
| "That view is unchanged", but one route to it still showed the old version | Capture every route to a view (S9) |
| The open list offered a recommendation nobody had recorded | Cite the record's own lean, or give none |
| Three documents counted the open items three ways | Draft the open list last, from the other documents, and let the consistency checker compare them all |
| The message asked the recipients to approve another person's items | Say whose each item is, and that their approval does not replace the owner's (H8) |
| One document went in one format, with the rest "to follow" | The pack is sent whole, or it waits (H9) |
| The note as sent said "not released yet" beside a message saying it was live | The release record, then the sweep, before any message (S14) |
| A ruling on the number waited behind a running job, and the pack was rendered without it | The render waits for the ruling (S15) |
| A reply to the last pack lay unread, and the new draft contradicted it | Replies are sources (S9, S15) |
| The attachments were refused because they sat in a temporary directory | Attach from the archive (S17) |
| A tool's second opinion on the level changed between two runs | Report both: a judge is advice (`release-notes`) |

## Verification

Before the message goes:

1. Both ends are pinned, by deployment and commit, in the note's header, and the baseline is what
   the readers were last sent.
2. Every claim in the drafts carries a source note, and neither a file rendered nor the message as
   prepared carries one (H5).
3. The three checkers' last pass came after the last change to the message or a document, and
   found nothing, and every finding rejected has its reason.
4. The open list agrees with the note, every companion and the message: the same items, approvers
   and figures.
5. The release record, who pushed it and on whose word included, was committed before the message,
   and neither the message nor any document contradicts it.
6. Every ruling and reply that arrived while the pack was drafted is in the render.
7. Every rendered file, binary ones included, is byte-identical to its copy last committed (H7).
8. Every open decision names who approves it, and the recipients are asked only about what is
   theirs (H8).
9. Every document of the pack is rendered and attached, and none is "to follow" (H9).

After it goes: the message went only as H6 says, the sent folder was read before it was reported
sent, and every copy as sent is byte-identical to the file rendered.
