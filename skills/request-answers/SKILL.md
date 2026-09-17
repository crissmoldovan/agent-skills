---
name: request-answers
description: "The way to ask when work needs something only someone else can give — a person or another agent: a question, a decision, a clarification, a sign-off, a missing fact, wording, or why they did something. Drop every question you can answer yourself, then send one brief whose answer sheet can be replied to in a single block, at brief, normal or deep depth."
license: MIT
compatibility: "Any agent that can write to a person or another agent; nothing to install. Strongest where it can also read the system under discussion — repository, data, logs, a rendered page, the other party's code — because every item quotes a measured present state. Deep depth writes a file per item and needs a filesystem; brief and normal are transcript-only. Output is the brief, optionally per-item files, and a ledger row per question."
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
`decision-journal`. Saying where multi-phase work stands is `report-progress`.
Building a verified-facts briefing before anyone reasons about an artefact is
`delphi-ground`. This skill owns the ask itself — of any kind — and the ledger of
what came back.

## The iron rule

```
NEVER ASK WHAT YOU CAN ANSWER YOURSELF
```

Before anything is written, every candidate question goes through a hunt-down pass.
Look in the repository, the data, the exports, the logs, the running system, the
other party's own code, the public web. Most "we need to ask them" turns out to be
answerable in minutes, and every one you answer is a wait you do not pay for.

Sort each candidate into one of four:

- **answered here** — with the evidence, and it leaves the ask
- **needs their judgement** — a preference, a name, a trade-off, a sign-off
- **needs their access** — a truth only their system, scrape or inbox holds
- **needs their intent** — why they did it this way, or which of two readings is meant

Only the last three reach anyone. Keep the answered ones in the ledger: that is the
record that a question was closed rather than forgotten, and it stops the same
question being asked next week.

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

Two rules bind every depth:

- **The answer sheet must be answerable on its own** at every depth. Detail and
  files are for the reader who wants them, never a dependency.
- **Say which depth you chose and why**, in one clause, so the recipient knows
  whether more exists: *"sixteen decisions, detail under each, evidence in the
  attached files."*

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

An agent's answer is a claim until it carries evidence. Record it in the ledger the
same way, with what it pointed at.

## The brief

Four parts, in this order.

### 1. The header

Three things, in two lines. The depth line is a required slot: agents given this
skill wrote the brief correctly and silently dropped the depth, so it is a field to
fill in rather than a rule to remember.

> **16 asks · depth: normal** — detail under each, no attached files.
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

### 4. Not for you

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

## The ledger

One place, updated as answers arrive, with a row per question: what was asked, who
owns it, what came back, and what it unblocked. Three sections earn their keep:

- **open** — still waiting, with what each one blocks
- **answered** — the reply, the date, and the work it released
- **answered without asking** — the ones you closed yourself, with the evidence

The third is the one people forget and the one that saves the most time. It is also
how you stay honest: when an item moves from "asked" to "answered here", say so and
withdraw the question.

## Rules that keep it honest

- **Measure the present tense.** "The panel shows only Retailer" is a claim; open it
  and count. Quote the string, give the number, name the screen or file.
- **Never invent an option.** If only one path exists, say so and ask for a yes.
- **Recommend exactly one.** "It depends" hands the work back.
- **One question per line.** Compound questions come back half-answered.
- **Name the consequence** wherever the options differ in cost, risk, or what a
  reader loses.
- **Say what you could not check**, and why, rather than implying you did.
- **Withdraw a question you answered.** Leaving it in makes the whole list suspect.
- **Do not pad.** An item you can decide is not a decision; deciding it is the work.
- **Say what happens on silence**, per item. Never let a blocking item read as
  optional.
- **Carry the context the answer needs** — no more. A judgement needs the trade-off;
  a missing fact needs where you looked; an intent question needs the line of their
  code you are reading.

## Verification checklist

- [ ] Every item needs someone: none is answerable from the system
- [ ] The header's depth slot is filled in, and matches what the recipient needs
- [ ] The answer sheet can be answered without the detail
- [ ] Every line has one question and one place to answer
- [ ] Every item carries a measured present state, quoted where it is text
- [ ] Every item has one recommendation, or is honestly marked CHOOSE, WRITE, WHICH or EXPLAIN
- [ ] No WRITE line asks for something you could have drafted
- [ ] The header's count matches the sheet's lines
- [ ] The closing section exists — with the other owners named, or the one line saying there are none
- [ ] Silence has a stated consequence for every item
- [ ] At deep depth: every item links to a file, and the index lists them all
- [ ] The ledger holds every question, including those answered without asking
- [ ] For an agent recipient: the reply contract is one line, and evidence is asked for

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
| Leaving an answered question on the list | They trust none of it |

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
