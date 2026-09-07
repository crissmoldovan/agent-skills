---
name: decision-journal
description: "Record why a decision was made, anchored to evidence a reader can check, so months later the question 'why is this like this, and what did we already rule out' has an answer. Use when work is worth being able to reconstruct."
license: MIT
compatibility: "Any harness that can run a shell command, plus the agent-journal CLI. Hooks capture actions automatically where the harness exposes them — Claude Code, Codex, Cursor and Gemini all do; Cowork and ChatGPT Work do not, and there the agent records entries itself and the journal says so. Without a filesystem the journal degrades to structured blocks in the transcript, harvested later. Git raises what a claim can point at but is not required: a journal in a design or ops context anchors to tool calls and messages instead, and renders those claims in a weaker voice rather than pretending they are commits."
metadata: "group=workflow; lifecycle=delivery; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Write Grep Glob Bash
---

# Keep a decision journal

Every agent harness now records what happened. None of them record why.

A session leaves behind hundreds of tool calls — every file read, every command run,
every edit applied. Not one of them contains the sentence that matters: *we chose
Postgres over SQLite because reconnect had to converge, and we ruled out the queue
because it needed a broker we do not run.* That sentence lives in the model's context
for about an hour, and then compaction destroys it.

Six months later somebody asks why the code is shaped this way. The commit history
answers *what*. The journal is where *why* survives — and, more valuably, where the
alternatives you already rejected survive, so nobody spends a week rediscovering that
they do not work.

## Quickstart

Record one decision. This is the whole loop:

```bash
agent-journal record \
  --workspace my-project \
  --kind decision \
  --question "how do sessions find their journal?" \
  --chosen "hash the git common directory" \
  --rationale "a worktree and its main checkout must share one journal, or collision warnings never fire"
```

Later, someone finds that reasoning rested on a false premise. Retract it — **no session
required**, which is the point; root causes are usually found in a bare shell:

```bash
agent-journal invalidate <entry-id> \
  --workspace my-project \
  --reason "the interpreter on PATH was wrong; the failures were never real"
```

Ask what the record does *not* cover, which is the question most audit trails cannot
answer:

```bash
agent-journal coverage --workspace my-project
```

That prints sessions observed, sessions that recorded nothing, refused writes, sequence
gaps — and `null`, not `[]`, for anything it never assessed. An empty array would claim
a clean bill of health it never established.

## When to Use

- A choice was made that a reasonable person could have made differently.
- You rejected an option for a reason that is not obvious from the code.
- Something surprised you, and the surprise changes what you would do next time.
- A decision rests on something you did not verify — say so; that is the most valuable
  entry in the journal, not the most embarrassing.
- Work is about to be compacted, and the reasoning is still in context.

Do not use it as a task log. Progress belongs in your tracker; this is not a Kanban
column. Do not narrate what a diff already shows — a decision entry that restates the
change adds noise and dilutes the entries that carry judgement. And do not record a
decision you have not actually made yet: this skill documents choices, it does not
help you make them.

## Prerequisites

1. **The CLI is installed and on PATH.** `agent-journal --help` should print usage.
   **Complete when:** the command runs. Without it, fall back to the transcript form in
   [references/degraded-modes.md](references/degraded-modes.md) and say you did.
2. **A workspace id.** Everything is scoped to one. Pass `--workspace` explicitly; the
   library can derive one from the git common directory, but the CLI does not guess.
   **Complete when:** you have a stable string that will be the same next session.
3. **Knowing what the journal can prove here.** In a code repository a claim can point
   at a commit. In a design or ops context it cannot, and the entry must say so instead
   of implying otherwise. See [references/anchors.md](references/anchors.md).
   **Complete when:** you can name which anchor classes are available.

## Procedure

### 1. Notice that a decision happened

This is the hard part, and it is where the skill earns its keep. The decisions worth
recording rarely announce themselves. In practice they hide in three shapes:

- **A choice that did not feel like one.** You reached for a method because its name
  read like a read. You set a flag because the ticket said to. Nobody deliberated, so
  nobody wrote it down — and that is precisely the entry someone will want.
- **A rejection.** You considered something and moved on. The moving-on is the record.
- **An assumption.** You proceeded as though something were true without checking.

**Complete when:** you can state the decision as a question someone else could have
answered differently.

### 2. Write the entry

```bash
agent-journal record --workspace <id> --kind decision \
  --question "<what was being decided>" \
  --chosen "<what you picked>" \
  --rationale "<why>"
```

A good entry answers three things and resists the fourth:

| Field | What it holds | The failure mode |
| --- | --- | --- |
| `question` | What was actually being decided | Restating the change instead of the choice |
| `chosen` | What you picked | Describing the implementation, not the decision |
| `rationale` | Why, in terms that would persuade a stranger | Post-hoc justification of a foregone conclusion |
| `rejected` | What you did not pick, and why not | **Omitting it.** This is the field nothing else captures |

**Complete when:** the entry would let a stranger reconstruct your reasoning without
reading the diff.

### 3. Anchor the claim

An entry that cites nothing is a story. Anchors are the difference between *this
decision was taken* and *somebody says it was*.

Anchors are **selected, not recalled** — the journal already recorded every file you
read and every command you ran, so the candidate set is the work you just did. You are
choosing from it, not remembering it.

**Anchoring proves the decision happened. It does not prove the decision was right.**
That distinction is the single most important thing in this skill, and it is covered in
[references/anchors.md](references/anchors.md). A perfectly anchored entry resting on a
false premise is worse than no entry, because it is citable.

**Complete when:** every factual claim in the entry points at something checkable, or is
explicitly marked as resting on nothing.

### 4. Say when you consulted nothing

If a decision rested on your own priors and no source, record that. The journal has a
first-class way to say it, and it is deliberately not the absence of a field — "I
consulted nothing" and "I forgot to record my sources" must not look identical.

This feels like an admission. It is the most useful signal in the entire record: it
tells a later reader which decisions were reasoned from evidence and which were reasoned
from vibes, and no other tool surfaces that at all.

**Complete when:** an entry with no sources says so explicitly.

### 5. Retract what turns out to be wrong

Two different things can happen to a decision, and conflating them loses information:

- **Superseded** — something newer replaced it. The original was reasonable at the time,
  and everything built on it still stands.
- **Invalidated** — the premise was false. It was never sound, and **everything resting
  on it is suppressed too**, transitively.

```bash
agent-journal invalidate <id> --workspace <ws> --reason "<what was actually true>"
```

This works with no session, deliberately. The canonical case is a root cause found in a
shell hours after the agent that wrote the entry has gone.

**Complete when:** a wrong entry is marked wrong, and anything that rested on it is too.

### 6. Read the coverage before you trust the record

```bash
agent-journal coverage --workspace <id>
```

Silence in a journal is ambiguous — nothing decided, or nothing recorded? The coverage
report is what makes the difference legible: sessions that produced no entries, refused
writes, gaps in a source's sequence, and an explicit `null` for anything never assessed.

**Complete when:** you can state what the journal does not cover, not just what it does.

## Verification

Before treating a journal as a record you can rely on:

- **Every entry cites something, or admits it does not.** `agent-journal coverage`
  reports entries whose anchors have gone; an entry that never had any is a story.
- **The coverage report distinguishes `null` from `[]`.** If a field reads as an empty
  array when nothing assessed it, the report is claiming a clean bill of health it never
  earned. That is a bug, not a clean journal.
- **A refused write left a trace.** Redaction refuses rather than risk writing a secret,
  and the refusal is recorded as a void. If refusals vanish silently, the gap they leave
  is invisible and the coverage report is lying by omission.
- **Retractions took effect.** An invalidated entry and everything resting on it are
  suppressed from what a later session reads.

## Usage Examples

**Recording a rejection, which is the entry nothing else captures:**

```bash
agent-journal record --workspace api --kind decision \
  --question "how do we bound the retry queue?" \
  --chosen "in-process ring buffer, 256 entries" \
  --rationale "backpressure is observable and the failure mode is dropping oldest, which we can measure" \
  --rejected "redis list — needs a broker we do not run in this environment; kafka — three days of setup for one queue"
```

**Recording an assumption you did not verify:**

```bash
agent-journal record --workspace api --kind assumption \
  --question "is the upstream call idempotent?" \
  --chosen "assumed yes, retried on timeout" \
  --rationale "the method name reads like a read; nothing was checked"
```

That entry is what turns a future incident from *nobody knows why* into *here is exactly
what we assumed and never confirmed*.

**A human retracting an agent's finding, from a bare shell:**

```bash
agent-journal invalidate 7f3a --workspace api \
  --reason "the 107 test failures were a wrong interpreter on PATH; the regression never existed"
```

## Pitfalls

- **Recording what the diff already says.** "Changed the timeout to 30s" is not a
  decision; "chose 30s because the p99 upstream is 22s and we would rather fail than
  queue" is.
- **Treating an anchor as proof of correctness.** It proves the decision happened. A
  well-anchored entry built on a false premise is the most dangerous artefact this
  system can produce, because it reads as verified.
- **Writing entries only when things go well.** A journal of successes is a marketing
  document. The rejections and the assumptions are what make it worth keeping.
- **Letting the entry be a performance.** If entries are read in review, the temptation
  is to attach a source you skimmed rather than admit you consulted nothing. That
  converts the most valuable field in the record into decoration.
- **Reading `[]` as "none found".** Where the journal never assessed something it says
  `null`. An empty array means assessed and empty. Conflating them turns "we did not
  look" into "we looked and it was clean".
- **Assuming order implies causality.** Entries from different sources are ordered for
  display, not for meaning. If one thing caused another, the edge between them says so —
  the sequence in a list does not.

## Deeper reading

- [references/anchors.md](references/anchors.md) — what a claim can point at, what each
  anchor class actually proves, and why anchoring is one-directional.
- [references/entry-kinds.md](references/entry-kinds.md) — decision, finding,
  assumption, blocker, progress, constraint: which to use and how they differ.
- [references/degraded-modes.md](references/degraded-modes.md) — running without the
  CLI, without a filesystem, or without hooks, and how to say so honestly.
