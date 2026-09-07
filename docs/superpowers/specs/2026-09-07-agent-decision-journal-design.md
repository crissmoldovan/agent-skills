# Agent Decision Journal — design

- **Date:** 2026-09-07
- **Status:** Draft, awaiting review
- **Package (proposed):** `packages/agent-journal`
- **Skill (proposed):** `skills/decision-journal`

## 1. Problem

Coding agents produce a complete record of *actions* and no record of *decisions*.

Every major harness now exposes lifecycle hooks that will faithfully log several
hundred tool calls per session. None of them capture "I chose X over Y because Z",
because a decision appears in no tool call. Within the hour the reasoning is
compacted away; six months later the question that actually matters — why is this
built this way, and what did we already rule out — is unanswerable.

The gap is not observability. It is that the *why* has to be written by a model,
and nothing currently asks it to, at a moment when it still knows.

### 1.1 Why existing tooling does not close it

| Prior art | What it does | Why it is not this |
| --- | --- | --- |
| `disler/claude-code-hooks-multi-agent-observability` | Hooks → SQLite → live dashboard | Claude-only, tool-level, a monitor rather than a durable record |
| `claude-code-transcripts`, `claude-devtools` | Transcript → HTML | Post-hoc, prose, not queryable structure |
| ADR tooling and ADR skills | Decisions with rationale | Manual, one-shot, authored rather than captured |
| Langfuse / Braintrust / Phoenix | LLM call tracing | Traces model calls, not engineering decisions |
| OTel GenAI semantic conventions | Agent span vocabulary | Development stability; models execution, not rationale |
| `agent-lifecycle` (this repo) | Child-agent lifecycle projection | Lifecycle state of children, explicitly not work progress |

Nothing existing is continuous, cross-harness, decision-level and evidence-anchored
at the same time. That combination is the slot this fills.

## 2. Design position

**Two planes, and the second is only trustworthy because of the first.**

- **Plane A — deterministic capture.** Hook-written observations. Ground truth the
  agent does not control and cannot skip or embellish.
- **Plane B — authored entries.** The *why*, written by the agent, where **every
  entry cites Plane A evidence**.

Unanchored, Plane B is a flattering narrative. The anchoring rule is the whole
design, and it is the same discipline `describe-changes` already applies to diffs:
every claim points at something checkable.

### 2.1 Non-goals

- Not a task board, Kanban, or todo format. Work state must never drive journal state.
- Not a replacement for `agent-lifecycle`. Child-agent lifecycle stays there.
- Not an LLM-call tracer. Token counts and latencies are out of scope.
- Not a compliance product. It produces evidence; it makes no certification claim.

## 3. Architecture

| Layer | Contents | Novel work |
| --- | --- | --- |
| **1. Capture** | Hook adapters → sink → append-only journal | Mostly assembly |
| **2. Judgement** | The `decision-journal` skill: what counts, when to write, anchoring rules | **Yes — this is the product** |
| **3. Projection** | Renderers: digest, context-reload, query, watch | Low |

Layer 2 is prose, not code. Layers 1 and 3 exist to make Layer 2 trustworthy.

## 4. The envelope

CloudEvents-shaped, borrowed rather than invented. Two event families share one
envelope so both planes are provably the same shape.

### 4.1 Common fields

```
schemaVersion   1
id              unique event id
source          producer: harness + machine + session + agent
sourceEpoch     new value whenever a producer restarts its sequence space
sequence?       per-source monotonic; authoritative for intra-source order
time            RFC3339 UTC — DISPLAY ONLY across sources (see 8.4)
workspace       workspace id (see 6.1)
session         session id
agent           agent id within the session
harness         claude-code | codex | cursor | gemini | cowork | chatgpt | other
context         OPEN STRING — see 4.2
capabilities    declared anchor classes — see 4.3
kind            event kind within its family
subject?        what the event is about
data            payload, redacted
```

### 4.2 `context` — open, not enumerated

An open string with a registry of well-known values: `coding`, `research`, `ops`,
`writing`, `design`, `support`. Unknown values **pass through rather than error**.

This is deliberate. `agent-lifecycle`'s `LifecycleKind` is a closed seven-value
union, and that closure is exactly what makes it hard to extend for this purpose.
Repeating the mistake would cap the design at the use cases we thought of today.

`context` is **per event**, never per workspace. One workspace can carry a research
session and a coding session at once, and a single session can shift context
mid-flight.

### 4.3 `capabilities` — which anchors this context can actually produce

Reuses the `known | unknown` pattern already in `agent-lifecycle`, applied to
evidence rather than control:

| Anchor class | Coding | Research | Ops / console | Bare conversation |
| --- | --- | --- | --- | --- |
| `commit` | yes | no | no | no |
| `file` (path + content hash) | yes | sometimes | sometimes | no |
| `tool_use` | yes | yes | yes | yes |
| `message` | yes | yes | yes | yes |
| `url` / `external` | yes | yes | yes | sometimes |

The bottom rows are universal. A journal without version control therefore still
works; it proves something weaker — *the agent read X, then chose Y* rather than
*the code changed this way* — and **renderers must say so out loud** rather than
presenting weaker claims in the same voice as strong ones.

Rule: preserve `unknown` rather than inferring optimistic defaults.

### 4.4 Two families

**Observations** — hook-written, cheap, high volume:
`session_start`, `session_end`, `turn_end`, `tool_call`, `tool_result`,
`tool_failure`, `permission`, `subagent_start`, `subagent_stop`, `compact`,
`heartbeat`.

**Entries** — agent-written, sparse, expensive:
`decision`, `finding`, `assumption`, `blocker`, `progress`.

`anchors[]` and `influences[]` (§5.1, §5.2) are available on **every** entry kind,
not only `decision`. What contributed to a `finding` or a `progress` note is as worth
recording as what contributed to a choice.

## 5. The decision entry

The one schema worth arguing about.

```
question        what was being decided
chosen          what was picked
rejected[]      alternatives considered, each with why-not
rationale       why
anchors[]       VERIFIABLE evidence that this decision happened - see 5.1
influences[]    ASSERTED provenance: what shaped it - see 5.2
reversibility   trivial | moderate | hard | one-way
supersedes?     id of an earlier decision this replaces
confidence?     stated, not inferred
```

`rejected[]` justifies the project. Every existing tool records what happened; none
records what was considered and discarded. That is the field people actually want
later, and it is the first thing destroyed by compaction.

### 5.1 Anchors prove; influences explain

These are two different axes and **must not be merged into one field.**

| | `anchors[]` | `influences[]` |
| --- | --- | --- |
| Answers | did this happen? | how was it reached? |
| Produced by | the system | the agent, asserting |
| Verifiable | yes, by construction | sometimes, sometimes never |
| Rots | no - commits and tool ids are immutable | yes - URLs die, docs move |
| Points at | the record of the decision | the inputs to it |

Collapsing them would let an entry claim anchored status while resting only on a
half-remembered URL. That silently destroys the property the entire design exists to
provide. Renderers must display them distinctly for the same reason.

An entry may have influences and no anchors (a decision made in a bare conversation),
or anchors and no influences (see 5.4). Neither is an error.

### 5.2 Influence taxonomy

`{type, ref, role, excerpt?, retrieved_at?, integrity?}`

| type | example | verifiable |
| --- | --- | --- |
| `url` | article, docs page, benchmark | reachability + content hash if fetched |
| `document` | PDF, Google Doc, file outside this repo | sometimes |
| `journal` | another entry in this journal - **internal cross-reference** | fully |
| `ticket` | Linear issue, GitHub issue or PR | via API |
| `conversation` | something the user said, this session or another | by message id |
| `tool_result` | output of a search, fetch or query in-session | by `tool_use_id` |
| `codebase` | file or symbol in another repository | partially |
| `person` | a human said so | no - assertion only |
| `model_knowledge` | the model's own priors, no source consulted | **no, by definition** |

`role` records how the influence acted, which matters as much as its identity:

`decisive` | `supporting` | `considered` | **`contradicted`**

`contradicted` - "I read this and chose against it" - pairs directly with
`rejected[]` and is otherwise unrecoverable.

`excerpt` is optional, bounded and redacted: it preserves the reasoning even after
the source dies. `person` references are PII and governed by the redaction policy in
12; prefer a role or handle over a name.

### 5.3 Influences are selected, not recalled

This is what makes the field cheap and reliable rather than a memory exercise.

Plane A already captures every `WebFetch`, `WebSearch`, `Read` and MCP call. So the
**candidate set** of influences for a decision is derivable - it is the observations
between the previous entry and this one. The agent's job is to select and rank from
that window, not to retype URLs from memory.

Consequence for the CLI: recording an entry offers the window and takes a selection.
An influence chosen this way carries a `tool_use` anchor for free, which is how an
asserted influence can become a verifiable one.

### 5.4 `model_knowledge` is the important one

An entry whose only influence is `model_knowledge` is declaring that the decision
rested on the model's priors and **no source was consulted**.

That is the single most valuable audit signal in the schema. "This architectural
choice was made on training data alone" is precisely what a reviewer wants to find,
and no existing tool can surface it. It must be an explicit, first-class value rather
than the absence of a field, so that "consulted nothing" is distinguishable from
"forgot to record influences".

### 5.5 The journal becomes a graph

`type: journal` influences reference other entries by id. With `supersedes`, the
journal stops being a list and becomes a decision graph: this rested on that, which
replaced an earlier one, which was contradicted by a source since retracted.

This costs one string per edge and is the substrate for 10.1.

## 6. Storage

### 6.1 Workspace identity — declared, never silently inferred

Resolution cascade, with the method that won **recorded in `meta.json`**:

1. explicit `.agent-journal/id`
2. git remote URL hash
3. cwd path hash
4. host container id (ChatGPT Project, Claude Project, Cowork space)
5. agent asks once, records the answer
6. ephemeral session-only

Rungs 1–3 assume a filesystem. In hosted environments identity is **declared**
(rungs 4–5). Because the winning method is recorded, you can always tell later how
a workspace got its name.

### 6.2 Layout

```
~/.agents/journal/workspaces/<workspace-id>/
  meta.json                                        identity, resolution method, contexts seen
  segments/<machine>/<session>/<agent>.<epoch>.<n>.jsonl
  index/journal.sqlite                             DERIVED, rebuildable, never authoritative
  snapshots/<snapshot-id>.json                     periodic projections
```

Two load-bearing decisions:

**One segment per writer process.** Keyed `(machine, session, agent, epoch)`. Parent
session and each subagent get their own file. Nothing contends, nothing locks, and
concurrent sessions become the same problem as multiple machines — already solved.
Locking is needed only in the degraded raw-append fallback (§9.2, tier 2).

**The SQLite index is derived and disposable.** Rebuildable from segments. Index
corruption is a non-event, and sync only ever has to move JSONL.

### 6.3 Retention

Observations outweigh entries by roughly 100×: a busy coding session is 500–2000
tool calls (~150–600KB redacted) against 5–20 decisions (~15KB).

Therefore: **decisions kept indefinitely; observations aged out or compacted after a
configured window.** Cheap to state now, painful to retrofit.

### 6.4 The committed digest

A separate artifact — rendered markdown under `docs/decisions/` in-repo, for
reviewers. Never the source of truth. The out-of-repo journal stays complete and
candid; the in-repo digest is curated and public. Different audiences, different
candour.

## 7. Multi-session semantics

### 7.1 Writes need no coordination

Each writer owns its own segment. Concurrent sessions never contend. This is the
payoff of §6.2 and it means the hard problems are all on the read side.

### 7.2 The session tree

Claude Code's `SessionStart` matcher already reports how a session began —
`startup | resume | clear | compact | fork`. Recording that plus `parentSession`
reconstructs the actual tree: which sessions continue one thread, which branch,
which are fresh. Free provenance; makes "everything from this line of work"
answerable rather than approximate.

### 7.3 Liveness — sessions that never end

`SessionEnd` frequently never fires (crashes, kills). So:

- **active** — recent appends *and* fresh heartbeat
- **stale** — freshness deadline passed, no terminal event
- **ended** — `SessionEnd` actually recorded

This is the **stale-before-lost** rule already specified in `agent-lifecycle` step 4:
one missed heartbeat never means dead. Direct reuse, no new thinking.

### 7.4 What a new session sees

`journal context` scopes to the workspace and returns decisions from **all**
sessions, not only its own lineage — superseded ones excluded, ranked by recency,
relevance to files in play, and irreversibility, within a token budget.

Entries are flagged by the liveness state of their author. *"Session X decided this
3 minutes ago and is still running"* is a materially different fact from *"someone
decided this last month."*

This makes live collision-avoidance possible: a starting session can see that
another live session is already touching the same paths. That is arguably the
strongest single argument for the project, and it exists only because concurrent
sessions share a workspace log.

### 7.5 Contradictory decisions

Two sessions may concurrently decide opposite things. Detecting that at write time
would require a global lock and semantic understanding — destroying the
no-coordination property for a feature that cannot be done reliably anyway.

Therefore: **record faithfully, detect at projection.** A renderer runs a cheap
structural check — two decisions on the same `subject`, overlapping windows,
different sessions — and surfaces the pair for a human. No semantics, no
auto-resolution, no false certainty.

## 8. Sync

### 8.1 There is no merge algorithm

Events are immutable facts with unique ids. Merging two machines is set union with
dedup by id. That is a grow-only set — a CRDT by construction, not by effort.

### 8.2 Tiers, each additive

| Tier | Mechanism | Good for |
| --- | --- | --- |
| 0 | Local only | Default |
| 1 | Directory on Syncthing / Dropbox / iCloud | Solo, multi-machine, zero infra |
| 2 | Private git repo of segments | Small team; free history and auth |
| 3 | R2 for segments + Durable Object for live fan-out | Hosted sink and realtime dashboard |

### 8.3 Making naive file-sync work

File-sync tools normally mangle append-only logs. The fix is **aggressive segment
rotation**: finished segments are immutable, so only one small active file per
writer is ever mutable. A Dropbox "conflicted copy" is then just another segment,
and dedup-by-id absorbs it.

### 8.4 Clock skew is the real hazard

Machines with drifting clocks interleave wrongly. Therefore:

- per-source `sequence` is authoritative for order **within** a source
- wall clock is **display only** across sources
- **causality is never inferred from timestamps**

## 9. Environments and transports

### 9.1 What each environment actually exposes

| Environment | Filesystem | Hooks | MCP |
| --- | --- | --- | --- |
| Claude Code, Codex, Cursor, Gemini (local) | yes | yes | yes |
| Claude Code cloud / web | ephemeral | repo + org settings only | yes |
| Claude Managed Agents | persistent | no | yes |
| Claude Cowork | **no** (Filesystem connector unavailable in Cowork sessions) | no | yes |
| ChatGPT Work / agent mode | ephemeral terminal only | no | yes |

**The universal denominator is MCP — not the filesystem, and not hooks.**

### 9.2 Sink interface, three transports

The CLI is a *transport*, not the architecture. One envelope, one validator, one
redactor, behind a sink interface:

| Sink | Used where |
| --- | --- |
| **File** (CLI) | Local dev. Full fidelity, offline, cheapest. |
| **HTTP** | Anywhere networked. Claude Code hooks support `type: "http"` natively — no install. |
| **MCP** | Hosted, no-FS. The only option in Cowork and ChatGPT Work. |

**Fallback ladder:**

1. FS + CLI — full fidelity
2. FS, no CLI — raw JSONL append, entries flagged `unvalidated`, repaired by a later
   normalise pass
3. No FS — MCP or HTTP sink, identical envelope
4. Nothing at all — the agent emits entries as **marked structured blocks into its
   own transcript**, harvested later from anywhere with storage

Tier 4 is serious, not a joke. Every hosted product retains conversation history, so
the transcript *is* durable storage — merely not queryable storage. The skill
therefore degrades to "still records decisions" rather than "does nothing", even in
a bare chat with no tools.

### 9.3 Scope consequence, stated plainly

Cowork and ChatGPT coverage make a hosted sink **non-deferrable**. Not the dashboard
— just a minimal authenticated endpoint accepting events and writing segments to R2.
Tier 3's storage half moves into scope; its realtime half does not.

## 10. Consumption

| Command | Consumer | Shape |
| --- | --- | --- |
| `journal render --since <ref>` | Human, retrospective | Markdown digest, anchors as links. Feeds `describe-changes` / `release-ledger`. |
| `journal context --budget N` | A later agent | Compact structured block; ranked by recency, relevance, irreversibility. Feeds the memory system. |
| `journal query '<expr>'` | Ad hoc | Over the derived index. The "why did we do X" question. |
| `journal watch` | Dashboard | Tail active segments → projection. Layer 3. |

An MCP wrapper later exposes the middle two to any agent.

### 10.1 Derived signal: stale decisions

Because entries carry typed anchors, a renderer can detect decisions whose anchoring
file was rewritten or whose commit was reverted. *"These 4 decisions rest on code
that no longer exists"* is a genuinely useful audit signal, and it is possible only
because of the anchoring discipline.

**Influence rot is the stronger version of the same check**, because influences are
the things that actually decay. A re-check pass can establish, per influence:

| type | rot check |
| --- | --- |
| `url` | unreachable, or content hash differs from `retrieved_at` |
| `ticket` | closed, rejected, or reopened since |
| `journal` | the referenced entry has been superseded |
| `codebase` | the referenced file or symbol no longer exists |
| `document` | moved or unresolvable |
| `person`, `model_knowledge` | not checkable — reported as such, never as passing |

*"This decision rested on three sources; one is gone and one has changed since it was
read"* is the review prompt that justifies storing provenance at all. The bounded
`excerpt` (§5.2) is what lets a reader judge the change rather than merely be told of it.

Rot is reported, never auto-resolved. A decision does not become wrong because a
source moved.

### 10.2 Answering "why is it like this"

The graph in §5.5 makes the genuinely hard query tractable: given a file, find the
decisions anchored to it, then walk `influences` and `supersedes` backwards to the
reasoning and sources behind them. That traversal is the reason the journal is
structured rather than prose.

## 11. Authoring model

**Self-triggered, with a `PreCompact` floor.**

- The agent writes an entry when it judges a real decision was made. The skill
  defines what qualifies. This keeps signal-to-noise high and the rationale rich.
- `PreCompact` forces a flush before context is destroyed — the single
  unrecoverable moment, and the only place a hard trigger is justified.

Rejected alternatives:

- *Forced at every checkpoint* — burns tokens on turns where nothing was decided and
  produces perfunctory entries.
- *Capture now, distil later* — zero session cost and works everywhere, but
  reconstructive, and blind to anything already compacted away. Retained as a
  **backfill** mechanism, not the primary one.

## 12. Failure behaviour

Capture is always subordinate to the work.

| Failure | Behaviour |
| --- | --- |
| Any hook error | Exit 0 unconditionally. A broken journal never blocks a session. |
| Journal corruption | Existing `JsonlLifecycleParser` recovers around bad lines with bounded, redacted diagnostics. |
| CLI absent | Degrade to raw append; flag `unvalidated`; repair later. |
| Sink unreachable | Buffer locally where a filesystem exists; drop with a recorded diagnostic where it does not. |
| **Redaction failure** | **Fail closed.** Refuse to write rather than write a secret. The only fail-closed case. |

## 13. Packaging

A **sibling package**, not an extension of `agent-lifecycle`.

`LifecycleKind` is a closed union and the `agent-lifecycle` skill explicitly forbids
using lifecycle state to represent work progress. Extending it in place would break
its own contract.

Instead: extract the genuinely reusable primitives — `JsonlLifecycleJournal`,
`JsonlLifecycleParser`, the redactor, the lock discipline — into a shared internal
module, and stand both event families on it.

## 14. Testing

| Test | Why it matters |
| --- | --- |
| **Recorded conformance fixtures per harness** | Real captured hook payloads → expected normalised events. Without these, adapters silently rot when a harness changes its schema and you find out during an audit. |
| Replay-order independence | Shuffle the log, identical projection. Same shape as existing projector tests. |
| Planted-secret redaction | Every sink, every transport. |
| Degraded-mode round trip | CLI absent → raw append → normalise → journal identical to the CLI path. |
| Transcript-harvest round trip | Tier 4 blocks → parsed → same entries. Ships with tier 4, not v1. |

## 15. Scope

### In v1

- Envelope, validator, redactor
- Journal (file sink) + CLI
- The `decision-journal` skill
- Human digest renderer
- **Two** harness adapters: Claude Code and Codex

Two adapters, not one, deliberately: a portable abstraction cannot be validated
against a single implementation. Cursor and Gemini then follow a contract proven to
bend at least once.

### Deferred

- Cursor and Gemini adapters
- Hosted sink (moves in only if Cowork / ChatGPT coverage is wanted in v1 — see §9.3)
- Realtime dashboard and Durable Object fan-out
- MCP wrapper
- Cross-machine sync beyond tier 1
- Transcript tier 4 (§9.2) and the backfill / transcript-mining pass (§11)

The envelope is designed so every deferred item is additive.

## 16. Open questions

1. **Hosted sink in v1 or not.** §9.3 makes it a straight trade: Cowork/ChatGPT
   coverage against a service to run. Not yet decided.
2. **Retention window** for observations. Needs a number.
3. **Well-known `context` registry** — initial value set, and the process for adding one.
4. **Digest cadence** — per PR, per session, or on demand.
5. **Excerpt bound** for influences (§5.2) — a byte cap, and whether excerpts are
   stored by default or only on request. Trades journal size against surviving link rot.
