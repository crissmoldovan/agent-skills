---
name: decision-journal
description: "Record why a decision was made, anchored to evidence a reader can check, so months later the question 'why is this like this, and what did we already rule out' has an answer. Use when work is worth being able to reconstruct."
license: MIT
compatibility: "Any harness that can run a shell command, plus Node.js 24 or newer to run the agent-journal CLI this skill carries. Hooks capture actions automatically where the harness exposes them — Claude Code, Codex, Cursor and Gemini do; Cowork and ChatGPT Work do not, and there the agent records entries itself and the journal says so. Without a filesystem it degrades to structured blocks in the transcript. Git raises what a claim can point at but is not required: a design or ops journal anchors to tool calls, in a weaker voice."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
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

The CLI ships in this skill: `node scripts/agent-journal.mjs` works wherever
`agent-journal` appears below. To put it on PATH for hooks and a bare shell, a person
runs `node scripts/install-cli.mjs` once; an agent asks them to. Record one decision:

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

It also names what it could not read. A corrupt or unreadable journal exits non-zero and
lists the `unreadable` paths and `malformed` lines, because an all-zero report from a
destroyed record and one from a quiet week must not look the same.

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

1. **The CLI runs.** `agent-journal help`, or `node scripts/agent-journal.mjs help`, exits 0.
   **Complete when:** one does. If neither can, use [references/degraded-modes.md](references/degraded-modes.md) and say so.
2. **A workspace id.** Everything is scoped to one. Pass `--workspace` explicitly; the
   library can derive one from the git common directory, but the CLI does not guess.
   **Complete when:** you have a stable string that will be the same next session.
3. **Knowing what the journal can prove here.** In a code repository a claim can point
   at a commit. In a design or ops context it cannot, and the entry must say so instead
   of implying otherwise. See [references/anchors.md](references/anchors.md).
   **Complete when:** you can name which anchor classes are available.
4. **Knowing whether anything is watching automatically.** On a harness with hooks
   wired, tool calls and session boundaries are observed independently of what you
   write — a second witness to check your own account against, not a replacement for
   it. Cite one with `--anchor tool_use:<observation-id>`; find the id with
   `trace <tool-name>` and then `show`. The adapters are **not installed with this
   skill** — they live in the repository, at
   <https://github.com/crissmoldovan/agent-skills/tree/main/adapters>. Hooks do not
   cover everything: no heartbeat, no confirmed permission events, and unattributed
   tool calls from inside a subagent. See
   [references/adapters.md](references/adapters.md) for the whole loop and before
   assuming a class of claim is covered that isn't. **Complete when:** you know whether
   this session's harness has an adapter wired, and — if it does — `agent-journal show`
   shows observation kinds with `provenance: "hook"`. Use `show`, not `coverage`:
   `coverage` counts sessions, so a hooked session and a hookless one both report
   `sessions: 1` and it cannot tell you a hook fired.

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

```bash
agent-journal record --workspace <id> --kind decision \
  --question "<what was being decided>" --chosen "<what you picked>" \
  --anchor file:src/queue.ts:14 \
  --anchor commit:9f2c1ab
```

`--anchor <class>:<ref>` is repeatable and splits on the **first** colon, so a ref keeps
its own — `file:src/queue.ts:14` records the path and line, not a truncation of it. The
classes are `commit`, `file`, `environment`, `visual`, `runtime`, `tool_use`, `message`,
`url` and `external`; [references/anchors.md](references/anchors.md) says what each one
proves and, more usefully, what it does not.

**Citing an anchor marks its class available.** The entry's capability table records
`file: known` once a file anchor is on it, and leaves every other class `unknown`. That
is not optimism — the anchor *is* the evidence that the class is reachable here. What the
rule forbids is the reverse: assuming a class is available because it usually is.

**Complete when:** every factual claim in the entry points at something checkable, or is
explicitly marked as resting on nothing.

### 4. Say when you consulted nothing

If a decision rested on your own priors and no source, record that. The schema has a
first-class way to say it — an influence of type `model_knowledge` — and it is
deliberately not the absence of a field, because "I consulted nothing" and "I forgot to
record my sources" must not look identical.

This feels like an admission. It is the most useful signal in the entire record: it
tells a later reader which decisions were reasoned from evidence and which were reasoned
from vibes, and no other tool surfaces that at all.

```bash
agent-journal record --workspace <id> --kind decision \
  --question "..." --chosen "..." \
  --influence model_knowledge:decisive
```

`model_knowledge` is the one influence type that needs no reference, because there is
nothing to point at — that is the claim. Every other type takes
`--influence <type>:<role>[:<ref>]`, splitting on the first two colons so a URL keeps
its own: `--influence url:contradicted:https://example.com/bench?a=1:2`. The roles are
`decisive`, `supporting`, `considered` and **`contradicted`** — the last meaning *I read
this and chose against it*, which pairs with `--rejected` and is otherwise unrecoverable.

**Complete when:** an entry with no sources says so explicitly, as a value rather than an
absence.

### 5. Retract what turns out to be wrong

Two different things can happen to a decision, and conflating them loses information:

- **Superseded** — something newer replaced it. The original was reasonable at the time,
  and everything built on it still stands.
- **Invalidated** — the premise was false. It was never sound, and **everything resting
  on it is suppressed too**, transitively.

`invalidate` covers the second case. The first has no separate command — pass
`--supersedes <id>` on the record that replaces it:

```bash
agent-journal record --workspace api --kind decision --id d-old \
  --question "how do we bound the retry queue?" --chosen "fixed 256-entry buffer"
agent-journal record --workspace api --kind decision --id d-new \
  --question "how do we bound the retry queue?" \
  --chosen "backpressure signal, no fixed bound" --supersedes d-old
agent-journal show --workspace api --id d-old
```

`d-old` now reads `outcome: reverted, live: false` in that output; `d-new` is
unaffected — unlike invalidation, supersession never propagates to what was built on
the entry it replaces. `--id` on `show` narrows to one entry instead of the whole
workspace, which is the faster check once you know which id you are asking about.

```bash
agent-journal invalidate <id> --workspace <ws> --reason "<what was actually true>"
```

This works with no session, deliberately. The canonical case is a root cause found in a
shell hours after the agent that wrote the entry has gone.

**Suppression follows the links you recorded.** An entry declares what it rests on with
`--influence journal:<role>:<id>`, and the projection layer walks those to a fixed point.
So invalidating an entry suppresses everything that cited it, and everything that cited
*those*:

```bash
agent-journal record --workspace api --kind decision --id d-bound \
  --question "how do we bound the retry queue?" \
  --chosen "in-process ring buffer, 256 entries"
agent-journal record --workspace api --kind finding --id f1 \
  --claim "the 256 bound is never reached" --influence journal:decisive:d-bound
agent-journal invalidate d-bound --workspace api --reason "the bound was measured, not assumed"
agent-journal show --workspace api
```

`f1` now reads `outcome: invalidated, live: false` alongside `d-bound`, without being
named in the retraction. An entry that rested on nothing you recorded is not reached —
the graph only knows the edges you gave it, which is the reason step 4 is worth the
keystrokes.

**Complete when:** the wrong entry is marked wrong, and anything that declared a
dependence on it went with it.

### 6. Read the coverage before you trust the record

```bash
agent-journal coverage --workspace <id>
```

Silence in a journal is ambiguous — nothing decided, or nothing recorded? The coverage
report is what makes the difference legible: sessions that produced no entries, refused
writes, gaps in a source's sequence, and an explicit `null` for anything never assessed.

**Complete when:** you can state what the journal does not cover, not just what it does.

### 7. Render a digest, and trace from a symptom

```bash
agent-journal digest --workspace api --level team
```

A digest renders the journal as one markdown document, ordered by consequence rather
than time — invalidated first — with the coverage report folded onto the end. It
defaults to `--level published`, the version meant to leave the room, and it is a
snapshot stamped with the moment it was rendered, never the source of truth. See
[references/digest-and-disclosure.md](references/digest-and-disclosure.md) for what
disclosure does and does not gate: a private entry never appears in a digest, but its
invalidation of something else always does.

```bash
agent-journal trace f1 --workspace api
```

`trace` starts from whatever a support question actually hands you — a file, a ticket,
a runtime flag, or an entry id, indexed equally — and walks backwards through what an
entry rests on. Lookup is exact, never a substring. The walk does not stop at an
invalidated entry: `f1` rests on `d-bound`, invalidated two steps back, and the walk
reaches it anyway, because that is frequently where "why is this like this" ends.

**Complete when:** you know what a reader at a given disclosure level will and will not
see, and a symptom traces back to the decision it actually depends on, not just the
entry that happens to mention it.

### 8. Check what has decayed

Entries do not stay true because they were true once. A cited file gets deleted, a
ticket closes, an interpreter on `PATH` is not the one a decision was made under.

```bash
agent-journal decay --workspace api --repo .
```

This reports two different things, never resolves either, and exits `0` regardless of
what it finds — a `failing` finding does not invalidate anything, and a `drifted`
finding is not a verdict. `--repo` defaults to nothing on purpose: without it every
`codebase` influence reads `not-checkable` rather than this command silently scanning
whatever directory you happened to be standing in.

**Know the honest limit before you trust a `passing` codebase finding**: `path:symbol`
checks that the symbol's name still appears in the file's text — a grep, not a parse.
It catches a deleted or renamed symbol. It does not catch one that kept its name and
changed what it does. See [references/decay.md](references/decay.md) for the full
reference — every status, what `decay` does and does not look at, and why an
`environment` anchor's drift is reported as `drifted` rather than `failing`.

**Complete when:** you can name which of the five statuses a finding carries and what
each one does and does not commit to, and you know that reading the report is not the
same as acting on it.

### 9. Delete something that must not exist

A decision can be entirely sound and still contain a leaked credential or a named
person. `invalidate` is the wrong tool for that — it says the reasoning was wrong, and
this content might not be. `tombstone` takes no position on the reasoning at all; it
says the content itself must not exist.

```bash
agent-journal tombstone <id> --reason "<why this must not exist>" --workspace <id>
```

That appends an event and purges nothing. `compact` is the only command in this
package that deletes, and it is a dry run unless `--apply` is given — this is the one
command meant to run unattended, from a hook or CI, with nobody there to confirm it:

```bash
agent-journal compact --workspace <id> [--entry-ttl-days <n>] [--observation-ttl-days <n>] [--apply]
```

An omitted TTL flag means that axis never expires, not "expire everything," and
`compact` refuses outright on a journal it could not fully read rather than risk
purging on an incomplete view. Neither command reaches into a replica that has not
seen the tombstone yet — that replica keeps the bytes until it does; §13.2 states this
as the honest price of being able to erase anything at all. See
[references/retention-and-deletion.md](references/retention-and-deletion.md) for the
full mechanics, including what an anchor citing purged content renders as afterward.

**Complete when:** you can say, for content that must go, whether `invalidate` or
`tombstone` is the right tool — and, if it is `tombstone`, that you ran `compact`
without `--apply` first and read what it would do before adding the flag.

### 10. Let a floor catch what self-triggering misses

Step 1's "notice" is voluntary; §11.3's finding is that what an agent notices on its own
is roughly *the complement* of what causes incidents. Two **authoring floors** narrow
that by prompting, never writing: one on a consequence-bearing observation (a mutating
command, an unfamiliar host, a matching constraint), one before compaction.

```bash
agent-journal floor --kind consequence --workspace <id> [--since <ts>] [--subject <s>]
agent-journal floor --kind compaction --workspace <id> [--since <ts>]
```

**Opt-in per workspace** (`AGENT_JOURNAL_FLOORS=1`) — an unasked floor gets the adapter
uninstalled. See [references/authoring-floors.md](references/authoring-floors.md) for
what the classifier misses, why Floor 1 can't force a flush, and Floor 2's blind spot.

**Complete when:** you know whether floors are on here, and treat one as a question,
never an entry to accept as written.

## Usage Examples

**Recording a rejection, which is the entry nothing else captures:**

```bash
agent-journal record --workspace api --kind decision \
  --question "how do we bound the retry queue?" \
  --chosen "in-process ring buffer, 256 entries" \
  --rationale "backpressure is observable and the failure mode is dropping oldest, which we can measure" \
  --rejected "redis list — needs a broker we do not run in this environment" \
  --rejected "kafka — three days of setup for one queue"
```

**Recording an assumption you did not verify:**

```bash
agent-journal record --workspace api --kind assumption \
  --assumed "the upstream call is idempotent" \
  --ifWrong "a retry double-charges the customer" \
  --checked no
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
- **Reading a `passing` `codebase` finding as "the reasoning still holds".** It means
  the symbol's name is still in the file. `decay`'s `path:symbol` check is a grep, not
  a parse — it says nothing about whether the symbol still does what the entry said it
  did. See [references/decay.md](references/decay.md).

## Verification

Before treating a journal as a record you can rely on:

- **Every entry cites something, or admits it does not.** Read the entries and check.
  `coverage` cannot answer this for you — it reports `downgradedAnchors: null`, meaning
  *not assessed*, because it runs no retention pass. An entry that cites nothing and does
  not say so is a story.
- **The coverage report distinguishes `null` from `[]`.** If a field reads as an empty
  array when nothing assessed it, the report is claiming a clean bill of health it never
  earned. That is a bug, not a clean journal.
- **A refused write left a trace.** A recognised secret is masked and the entry is
  written; a payload the redactor cannot scan at all — oversized, or too deeply nested —
  is refused outright, and that refusal is recorded as a void. If refusals vanish
  silently, the gap they leave is invisible and the coverage report is lying by omission.
- **The journal could be read at all.** `coverage` exits non-zero and lists `unreadable`
  paths and `malformed` lines when the record is damaged. Zeroes from a damaged journal
  mean "we could not look", not "nothing happened" — treat its counts as a floor.
- **Retractions took effect.** `agent-journal show --workspace <ws>` reports `outcome`
  and `live` per entry. An invalidated entry and everything that declared a dependence on
  it both read `live: false`.
- **You can tell a retraction from a decision.** `invalidate` appends its retraction as a
  `decision` record, so a workspace with two entries and one retraction shows **three**
  rows. The retraction is the one whose `retracts` field is populated; the entries it
  acted on carry `retracts: null`. A count of live decisions that forgets this is wrong by
  one per retraction, forever.
- **`null` is not `[]` in `show` either.** `anchors`, `influences` and `retracts` read
  `null` when the entry has none — not recorded, rather than assessed and empty.
- **A `decay` report is something to read, not something that gates.** It exits `0`
  whether every finding is `passing` or half of them are `failing` — treating a clean
  exit code as "nothing decayed" skips the one field, `findings`, that actually says so.

## Deeper reading

- [references/anchors.md](references/anchors.md) — what a claim can point at, what each
  anchor class actually proves, and why anchoring is one-directional.
- [references/decay.md](references/decay.md) — the five statuses `decay` can report,
  what it does and does not check, the `codebase` grep's honest limit, and why
  environment drift is reported rather than resolved.
- [references/entry-kinds.md](references/entry-kinds.md) — decision, finding,
  assumption, blocker, progress, constraint: which to use and how they differ.
- [references/digest-and-disclosure.md](references/digest-and-disclosure.md) — the
  three disclosure classes, why the write default and the parse default differ, how a
  digest orders and gates entries, and what `trace` can and cannot find.
- [references/retention-and-deletion.md](references/retention-and-deletion.md) —
  tombstones versus `invalidate`, why a tombstone forfeits pure CRDT convergence,
  `compact`'s dry-run default and its refusal on a damaged journal, entry TTL, and the
  pinning interaction between the two.
- [references/degraded-modes.md](references/degraded-modes.md) — running without the
  CLI, without a filesystem, or without hooks, and how to say so honestly.
- [references/adapters.md](references/adapters.md) — the observation plane hooks feed
  automatically: what it proves that self-reported entries can't, obtaining and
  installing the Claude Code and Codex adapters (they ship in the repository, not with
  this skill), verifying arrival with `coverage`, the capture → find → cite loop for
  anchoring an entry to an observation, what still has to be hand-anchored, and the
  honest, unequal status of each adapter.
- [references/authoring-floors.md](references/authoring-floors.md) — the two floors
  that prompt regardless of judgement: what fires each, opting in, what the classifier
  misses, and why Floor 1 doesn't force a pre-compaction flush and Floor 2 misses a
  failed tool call.
