---
name: request-answers
description: "The way to ask when work needs something only someone else can give — a person or another agent: a question, a decision, a clarification, a sign-off, a missing fact, wording, or why they did something. Drop every question you can answer yourself, then send one brief whose answer sheet can be replied to in a single block, at brief, normal or deep depth."
license: MIT
compatibility: "Any agent that can write to a person or another agent; nothing to install. Strongest where it can also read the system under discussion — repository, data, logs, a rendered page, the other party's code — because every item quotes a measured present state. Deep depth writes a file per item; brief and normal are transcript-only but for the shot each question about a screen carries, taken with a local browser. Output is the brief, optional item files and shots, and a ledger row per question."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Write Grep Glob Bash
---

# Request answers

Work stops on someone else's input more often than on anything technical: a choice
of wording, a ruling, a number only they hold, the intent behind code they wrote.
The reply comes back slowly, or not at all, and the usual reason is the ask — a wall
of prose with the questions buried in it, an open "thoughts?", or a list of twenty
items of which four were actually theirs.

**This is how to ask whenever you need something from another person or another
agent** — one question or twenty. It covers a plain question, a decision, a
clarification of something ambiguous, a sign-off, a ruling, a fact only they hold, a
piece of copy, and "why did you do it this way". The recipient answers what is cheap
to answer: make the reply one block they can type in two minutes and you get it
today.

The unit is an **ask**: one thing you need back, with one place to put it. A
decision is an ask whose answer is a choice; a clarification is an ask whose answer
is a sentence. Everything below treats them the same way.

**What this is not.** Recording why a decision was made afterwards is
`decision-journal` (B5). Saying where multi-phase work stands is `report-progress`
(B6). Building a verified-facts briefing before anyone reasons about an artefact is
`delphi-ground` (B7). This skill owns the ask itself — of any kind — and the ledger of
what came back.

## Bindings

A project can adapt this skill without copying it: it binds these slots and adds to the steps by
their ids, as the pack's
[project-adaptation guide](https://github.com/crissmoldovan/agent-skills/blob/main/docs/project-adaptation.md)
describes. A slot nobody binds keeps its default.

| id | slot | kind | default |
|---|---|---|---|
| B1 | who the run answers to: the person who rules on what the run proposes to decide, and is told what the shooting finds | value | whoever asked for the ask |
| B2 | who sends an ask to a person: the person who sends it, or approves its exact text for sending | value | the person bound as B1; an ask to another agent the run delivers itself |
| B3 | who may be messaged at all | value | the recipients the person bound as B1 named, and nobody else |
| B4 | how a screen is rendered and shot | value | the browser automation this environment has, run as `references/pointing-at-the-screen.md` requires; with none, ask once |
| B5 | where the reasons behind a decision that comes back are recorded | skill | `decision-journal` |
| B6 | where a reader is told how long-running work stands | skill | `report-progress` |
| B7 | where a briefing of verified facts is built before anyone reasons about an artefact | skill | `delphi-ground` |

## Hard lines

- **H1. Never ask what you can answer yourself.** Every candidate goes through the hunt-down
  pass (S2) before anything is written, and one answered here leaves the ask.
- **H2. The answer sheet is answerable on its own, at every depth.** Detail, files and shots
  are for the reader who wants them, never a dependency.
- **H3. Nothing reaches a person on the run's own word.** The run prepares the ask and shows it
  in full to the person bound as B2. It goes when that person sends it, or approves that exact
  text, those recipients and those attachments for sending, and only to recipients B3 allows;
  nobody else is copied in. An ask changed after the approval is approved again.
- **H4. A shot shows exactly what its question is about, or there is no shot.** Never a
  whole-screen stand-in for a target that was not found, never an edited image, and never a
  live site or a signed-in session.
- **H5. What the run decides or finds on its own is a proposal.** A question decided here
  without a standing ruling, and anything the shooting shows that disagrees with a record, go
  to the person bound as B1 with their evidence. Neither is fixed, or written into a brief as
  settled, until that person rules.

## Procedure

1. **S1. Collect the candidates.** Every question the work waits on, each with where it came
   from. Split a point with several parts into one question per part. A question they asked
   you is not a question for them: it is yours to answer, or someone else's. When an
   instruction could mean either, ask the person bound as B1.
2. **S2. Hunt each one down and sort it**, as the iron rule below says. Every claim that takes
   a question off the list goes past an independent refuter first.
3. **S3. Pick the depth** from what the recipient needs to answer.
4. **S4. Show the screen** for every open question about something a reader sees, rendered as
   B4 says (Show the screen, below).
5. **S5. Write the brief** in its five parts, the settled rows that concern this reader among
   them.
6. **S6. Hand it over** as H3 says. With the defaults, whoever asked for the ask reads the
   brief, and sends it or approves its exact text for sending.
7. **S7. Keep the ledger** as answers arrive. A closed question keeps its number, and moves to
   the settled rows with the answer quoted.

## The iron rule

```
NEVER ASK WHAT YOU CAN ANSWER YOURSELF
```

Before anything is written, every candidate question goes through a hunt-down pass.
Look in the repository, the data, the exports, the logs, the running system, the
other party's own code, the public web. Most "we need to ask them" turns out to be
answerable in minutes, and every one you answer is a wait you do not pay for.

Sort each candidate into one of five:

- **answered here** — with the evidence, and it leaves the ask
- **decided here** — a judgement a standing ruling already settles: cite the ruling, who gave
  it and for what, and it leaves the ask. A ruling covers only what it was given for. With
  none, the decision you would take is a proposal to the person bound as B1 (H5), and the
  question leaves the ask only when they rule
- **needs their judgement** — a preference, a name, a trade-off, a sign-off
- **needs their access** — a truth only their system, scrape or inbox holds
- **needs their intent** — why they did it this way, or which of two readings is meant

Only the last three reach the recipient. Keep the answered and decided ones in the ledger:
that is the record that a question was closed rather than forgotten, and it stops the same
question being asked next week.

**Every claim that takes a question off goes past a refuter.** Give each "answered here" and
"decided here" claim, with its evidence, to an independent refuter: another agent, or a person,
who did not make it and is asked to break it. Re-check every claim yourself as well, upheld or
not, and when a refuter overturns one, re-run its evidence before believing either side. With
no refuter available, the claims go to the person bound as B1 marked unrefuted. In one run,
forty-nine open questions came to forty open, six answered and three decidable, and a refuter
caught the run's own claim that a colleague's mapping was wrong — it agreed on every row —
before the claim reached them.

From a real run: twelve questions were queued across four people. Nine were
answerable — the upstream author's own unused helper showed a removal was an
unfinished port rather than a decision; a channel column in the export answered "can
you identify these rows"; a supposedly missing row was absent from every version of
the export, so the question became a scope question; the repository ran no job at
all, so a promised date could not be met by anything except a decision to build it.
Three were genuinely theirs.

## Pick the depth

Depth decides how much context travels with each question. Choose it from what the
recipient needs to answer, never from how much you happen to know.

| Depth | Shape | Use when |
|---|---|---|
| **brief** | header + answer sheet, one line of context per item | they own the area and already hold the context; fewer than about six items; a same-day nudge |
| **normal** *(default)* | brief, plus a detail section per item: current state, options, recommendation | anything that needs a judgement they cannot make from the line alone |
| **deep** | normal, plus a file per item, an index and a ledger | more than about eight items; evidence has to be quotable; several owners; someone else implements the answers later; a pack will be sent onward or archived |

Three rules bind every depth:

- **The answer sheet must be answerable on its own** at every depth. Detail and
  files are for the reader who wants them, never a dependency.
- **Say which depth you chose and why**, in one clause, so the recipient knows
  whether more exists: *"sixteen decisions, detail under each, evidence in the
  attached files."*
- **A question about something on a screen carries its shot**, attached as a file at
  every depth, brief and normal included: the screen with the thing boxed and labelled
  (Show the screen, below).

Ratchet up, never down: if an item turns out to need proof, raise that item to deep
rather than dropping the proof.

## Asking a person, asking an agent

The shape is the same; only the reply format changes.

- **A person** answers in prose over your sheet. Keep the choices in capitals and
  leave a visible slot per line.
- **An agent** answers in whatever you make cheapest to emit. Give it the same
  sheet, state the reply contract in one line — *"reply with these keys and one of
  the listed values"* — and keep one key per line. Ask for the evidence with the
  answer: *"name the file or command that settles it."*
- **Either** gets the same iron rule: do not ask a subagent to find what you have
  already measured, and do not ask it to decide what only a human owns.
- **Who sends** an ask to a person is B2, and who may be messaged at all is B3. By
  default the run hands the brief to whoever asked for it, and they send it or approve
  its exact text for sending. Nothing is sent on the run's own word, or addressed to
  anyone they did not name (H3).

An agent's answer is a claim until it carries evidence. Record it in the ledger the
same way, with what it pointed at.

## The brief

Five parts, in this order.

### 1. The header

Three things, in two lines. The depth line is a required slot: agents given this
skill wrote the brief correctly and silently dropped the depth, so it is a field to
fill in rather than a rule to remember.

> **16 asks · depth: normal** — detail under each; the eleven about a screen carry a shot.
>
> Nothing else is waiting on you. **Nine are a yes/no**; **five need you to choose
> or write something**; **two are readings to confirm.**

### 2. The answer sheet

A fenced block, one line per question, choices spelled out in capitals, dot leaders
to a visible answer slot. Sub-answers sit indented under their parent. The recipient
copies the block, types over it, sends it back.

```
Q1  restore the filter groups, merged into one "stocked" filter ...... YES / NO
Q2  show each own-label sub-range by name ........................... YES / NO
    does the value range count as own label? ....................... YES / NO
Q5  order results by best rank, then score ......................... YES / NO  (or: score only)
Q6  score bands: cut-offs ....... 70/55/35 / 75/55/35  and names .... WRITE: ............
Q7  we read "active" as the active ingredient — correct? .. READING A / READING B
Q9  summary cards to keep visible by default ......... WRITE: ............
```

If a line cannot be understood alone, the line is wrong, not the reader.

### 3. The detail — one section per item *(normal and deep)*

Each section carries, in order:

1. **The marker** — `YES/NO`, `CHOOSE`, `WRITE`, or `APPROVE OR EDIT`
2. **What it looks like today** — quoted and measured, never described from memory
3. **Why it is being asked** — whose request, in their words where there is one
4. **The options** — numbered, with the consequence where it differs
5. **One recommendation**, in bold
6. **What happens on silence** — you proceed, or it blocks
7. **The pointer** — the per-item file, at deep depth

Keep a section to what fits on a phone screen. Longer belongs in the item file.

### 4. Already settled

The ledger's closed rows that concern this reader, headed *"nothing here needs an
answer"*: each with the number it was asked by, how it closed — their answer, someone
else's, a ruling, evidence found here, or a move to someone else — by whom and when,
and the words or the evidence quoted. It stops them being asked twice, and shows them
that what they said landed. With nothing closed yet, write the one line —
*"Already settled: nothing yet."*

### 5. Not for you

The items owned by other people, each with the person named. It stops the recipient
answering something that was never theirs, and lets them chase it in the same
conversation.

**This section is never omitted.** With nothing in it, write the one line — *"Not for
you: nothing outstanding with anyone else."* A tested agent dropped the section and
with it two items belonging to two named colleagues, which read as though nobody was
waiting on anything.

## Classify every item

| Marker | Use when | The line in the sheet |
|---|---|---|
| **YES/NO** | you have a recommendation and agreement is enough | `... YES / NO` |
| **CHOOSE** | two to four real options, none obviously right | `... OPTION A / OPTION B` |
| **WRITE** | only they hold the words, the number or the name — **never where you could draft one** | `... WRITE: ............` |
| **APPROVE OR EDIT** | you drafted the words and they own the voice | `... APPROVED / EDIT: ......` |
| **WHICH** | two readings of something ambiguous, and you need to know which | `... READING A / READING B` |
| **EXPLAIN** | only they know why, and a sentence settles it | `... WHY: ............` |

The last two are the clarification cases. Put your best reading in the line —
*"we read this as X; is that right?"* — because confirming a reading is cheaper than
writing one from scratch.

A **YES/NO** without a recommendation is a **CHOOSE** pretending. A **WRITE** you
could have drafted is laziness: draft it and downgrade it to **APPROVE OR EDIT**. In
testing, one agent asked "what should the four bands be called?" while another
proposed "Strong / Good / Fair / Weak" for the same item — the second is answerable
in a second, the first is homework.

## Deep depth: a file per item

Every file follows one contract, the brief links each item to its file, and an index
beside them carries a row per item — number, title, state, owner — with a tally of
where things stand. The contract and a template are in
[references/item-file.md](references/item-file.md); the brief's own template and a
worked example are in [references/answer-sheet.md](references/answer-sheet.md).

**The files never replace the brief.** A recipient who reads only the brief must
still be able to answer everything.

## Show the screen

A question about something a reader sees — a sentence, a tile, a row, a control —
shows it, so nobody has to work out which one is meant. Shoot only the questions
still open after S2, with the renderer B4 names:

- **Two images per target**, attached at every depth: an overview of the screen with a
  box around the thing, so the reader can find it, and a close-up with the same box and
  a label naming the question by its number.
- **A pinned build of what the reader will look at**, rendered on this machine with
  every other host blocked. Never a live site, and never a signed-in session.
- **A target that is not found fails the shot.** No image, and never a whole-screen
  stand-in: a missing image reads as no evidence, a whole screen as evidence of the
  wrong thing.
- **Open every image** before it goes: the box holds exactly what is asked, and the
  label names the right question.
- **Every variant the question applies to** is shot: each layout, category or role it
  covers.
- **A state only a signed-in reader sees** is described in words, saying why there is
  no shot.
- **With no renderer here**, and none named when asked (B4), each question says in words
  where to look, and the header says that no shots travel.
- **What the shooting shows that disagrees with a record** goes to the person bound as
  B1 as a finding, with its evidence (H5): not fixed, and not written into a question as
  settled.

The method, and what is recorded beside each image, are in
[references/pointing-at-the-screen.md](references/pointing-at-the-screen.md).

## The ledger

One place, updated as answers arrive, with a row per question: what was asked, who
owns it, what came back, and what it unblocked. Three sections earn their keep:

- **open** — still waiting, with what each one blocks
- **answered** — the reply, the date, and the work it released
- **answered without asking** — the ones you closed yourself, with the evidence, or
  the standing ruling that decided them

The third is the one people forget and the one that saves the most time. It is also
how you stay honest: when an item moves from "asked" to "answered here", say so and
withdraw the question.

**The reader gets the closed rows too.** The ledger is your record, so on its own it
stops only you asking twice. Every brief carries the closed rows that concern its
reader beside the open ones, in its fourth part. **Ids never move**: a question keeps
its number in every later brief and in the settled rows, a new one takes the next
unused number, and a closed one's number is never used again, so a reply's "Q7" means
one question for good.

## Rules that keep it honest

- **Measure the present tense.** "The panel shows only Retailer" is a claim; open it
  and count. Quote the string, give the number, name the screen or file, and show the
  screen when the question is about one.
- **Never invent an option.** If only one path exists, say so and ask for a yes.
- **Recommend exactly one.** "It depends" hands the work back.
- **One question per line.** Compound questions come back half-answered.
- **Name the consequence** wherever the options differ in cost, risk, or what a
  reader loses.
- **Say what you could not check**, and why, rather than implying you did.
- **Withdraw a question you answered.** Leaving it in makes the whole list suspect.
- **Do not pad.** An item you can decide is not a decision for them; deciding it is the
  work, under a standing ruling or as a proposal to the person bound as B1.
- **Say what happens on silence**, per item. Never let a blocking item read as
  optional.
- **Carry the context the answer needs** — no more. A judgement needs the trade-off;
  a missing fact needs where you looked; an intent question needs the line of their
  code you are reading.

## Verification checklist

- [ ] Every item needs someone: none is answerable from the system
- [ ] Every claim that took a question off went past an independent refuter, and was re-checked
- [ ] Nothing decided here without a standing ruling is in the brief as settled
- [ ] The header's depth slot is filled in, and matches what the recipient needs
- [ ] The answer sheet can be answered without the detail
- [ ] Every line has one question and one place to answer
- [ ] Every item carries a measured present state, quoted where it is text
- [ ] Every question about a screen carries its shot, or says why it has none, and every image was opened
- [ ] Every item has one recommendation, or is honestly marked CHOOSE, WRITE, WHICH or EXPLAIN
- [ ] No WRITE line asks for something you could have drafted
- [ ] The header's count matches the sheet's lines
- [ ] The settled part lists every closed row that concerns this reader, under its number
- [ ] The closing section exists — with the other owners named, or the one line saying there are none
- [ ] Silence has a stated consequence for every item
- [ ] At deep depth: every item links to a file, and the index lists them all
- [ ] The ledger holds every question, including those answered without asking
- [ ] For an agent recipient: the reply contract is one line, and evidence is asked for
- [ ] Nothing went to a person on the run's own word, nor to anyone B3 does not allow

## Common mistakes

| Mistake | What it costs |
|---|---|
| Asking everything you are unsure about | They answer the cheap ones and stall on the rest |
| An open clarification ("what did you mean?") | Put your reading in the line and ask them to confirm it |
| One brief per topic instead of per owner | Everyone waits for everyone else |
| Prose with the questions inside it | You get opinions, not answers |
| No recommendation | The decision comes back as a question |
| Compound lines ("and also…") | Half an answer, and no way to tell which half |
| Describing the current state from memory | One wrong detail and the whole brief is doubted |
| Options invented to look balanced | They pick one and you build something nobody wanted |
| Deep depth by default | The brief drowns; nothing gets read |
| Leaving the depth slot blank | They cannot tell whether more detail exists |
| Dropping "not for you" because it felt empty | Items belonging to named colleagues disappear |
| Brief depth for a judgement call | They cannot answer, so they don't |
| A brief with no ledger | The same questions again next week |
| Sending only the open questions | They are asked again what they already answered |
| Renumbering the open questions in a later brief | Their "yes to Q7" now means a different question |
| Leaving an answered question on the list | They trust none of it |
| Taking a question off on your own decision | A decision nobody took reads as settled |
| Describing a screen in words when a shot would show it | They answer about the wrong sentence or tile |
| A whole screen in place of a shot whose target was not found | It reads as evidence of the wrong thing |
| Fixing what the shooting revealed | A finding nobody ruled on becomes a change nobody asked for |

## Usage Examples

```text
I am blocked on Dana for four things. Use request-answers: drop anything you can
settle from the repo or the data first, then give me one brief with an answer sheet
she can reply to in a single block, normal depth.
```

```text
Turn this list of twelve open questions into asks. Group them by who can actually
answer, put each person's in their own brief, and say what happens on silence for
every line.
```

```text
Ask the subagent for the three facts we are missing. Same answer sheet, one key per
line, and make it name the file or command behind each answer.
```

## How this was tested

Five agents were given the same scenario: twelve complaints outstanding, eight of
them answerable from facts the agent already held, one owner who decides and two
colleagues who own a slice. Two had no skill, two had it, one had it after the fixes
below.

| | without the skill | with it |
|---|---|---|
| answerable items dropped, of eight | 2 and 5 | 6 and 6 |
| one answer sheet, answerable on a phone | neither | both |
| a recommendation on every item | 2 of 9, 3 of 5 | one of the two |
| silence given a consequence | neither — both wrote "no rush" | both |

Both unaided agents wrote numbered prose to someone about to walk into a meeting,
left several decisions as open questions, and told her nothing was urgent. One of
the two with the skill also caught an arithmetic problem neither baseline saw.

Three failures survived the first version, and each was fixed by making the thing
structural rather than adding a rule:

- **both skipped the depth**, so it became a slot in the header line
- **one dropped "not for you"** when it felt empty, taking two colleagues' items with
  it — so the section is now never omitted
- **one asked for band names it could have drafted**, so the WRITE row carries the
  prohibition where it is read

A fifth agent on the fixed skill produced the depth slot, the closing section naming
both colleagues, and drafted band names offered for approval.

The rules added after that test — the shots, the settled rows, the refuter and the
decisions held as proposals — come from a project that ran this kind of round as its
own skill over several rounds of questions to one reader. They were not part of the
five-agent test above.
