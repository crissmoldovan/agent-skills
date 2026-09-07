# Agent Decision Journal — design

- **Date:** 2026-09-07 (revised after persona review)
- **Status:** Draft, awaiting review
- **Package (proposed):** `packages/agent-journal`
- **Skill (proposed):** `skills/decision-journal`
- **Review input:** [persona review findings](../notes/2026-09-07-journal-persona-review-findings.md)

## 1. Problem

Coding agents produce a complete record of *actions* and no record of *decisions*.

Every major harness now exposes lifecycle hooks that will faithfully log several
hundred tool calls per session. None of them capture "I chose X over Y because Z",
because a decision appears in no tool call. Within the hour the reasoning is
compacted away; six months later the question that actually matters — why is this
built this way, and what did we already rule out — is unanswerable.

The gap is not observability. It is that the *why* has to be written by a model, and
nothing currently asks it to, at a moment when it still knows.

### 1.1 Why existing tooling does not close it

| Prior art | What it does | Why it is not this |
| --- | --- | --- |
| `disler/claude-code-hooks-multi-agent-observability` | Hooks → SQLite → live dashboard | Claude-only, tool-level, a monitor rather than a durable record |
| `claude-code-transcripts`, `claude-devtools` | Transcript → HTML | Post-hoc, prose, not queryable structure |
| ADR tooling and ADR skills | Decisions with rationale | Manual, one-shot, authored rather than captured |
| Langfuse / Braintrust / Phoenix | LLM call tracing | Traces model calls, not engineering decisions |
| OTel GenAI semantic conventions | Agent span vocabulary | Development stability; models execution, not rationale |
| `agent-lifecycle` (this repo) | Child-agent lifecycle projection | Lifecycle state of children, explicitly not work progress |

## 2. Design position

**Two planes, and the second is only trustworthy because of the first.**

- **Plane A — deterministic capture.** Hook-written observations. Evidence the agent
  does not author.
- **Plane B — authored entries.** The *why*, written by the agent, where **every
  entry cites Plane A evidence**.

Unanchored, Plane B is a flattering narrative. The anchoring rule is the core of the
design, and it is the same discipline `describe-changes` applies to diffs: every
claim points at something checkable.

### 2.1 What anchoring does NOT prove

**Anchoring is one-directional, and the design must say so in its own voice.**

An anchor establishes that a decision was taken, when, and what it touched. It
establishes **nothing** about whether the premise the decision rested on was true.

The canonical failure: a session runs against a wrong interpreter on `PATH`. Tests
fail for environmental reasons. An agent investigates them as a real regression and
writes an entry that is *perfectly* formed — real `tool_use` anchors, a real failing
suite, populated `rejected[]`, honest `model_knowledge`, high confidence. Every rule
above is satisfied and the conclusion is worthless.

This is worse than keeping no record, for three reasons:

1. **It is citable.** A structured, evidence-linked wrong answer costs more to
   dislodge than no answer at all.
2. **It launders.** §7.4 feeds workspace entries to later sessions, so one session's
   confident error becomes cited precedent for five others.
3. **It reads as verified.** For a reader who cannot check the code, anchored Plane B
   is a flattering narrative *with citations*.

Three mechanisms answer this, and none is optional:

- **`environment` is an anchor class** (§4.3), so the premise itself is capturable.
- **§10.1 re-checks premises**, distinct from checking whether sources rotted.
- **`invalidates` exists alongside `supersedes`** (§5.8), so an entry can be marked
  *wrong* rather than merely *replaced*, and its descendants suppressed.

### 2.2 Non-goals

- Not a task board, Kanban, or todo format. **Todo and work-item state must not
  create, advance or complete journal entries.** A path claim (§7.6) is an
  observation about a resource, not work state, and is permitted — the earlier
  blanket phrasing forbade the substrate §7.4 needs.
- Not a replacement for `agent-lifecycle`. Child-agent lifecycle stays there.
- Not an LLM-call tracer. Token counts and latencies are out of scope.
- **Not a compliance product.** It produces evidence; it makes no certification
  claim. §13 governs disclosure precisely *because* the record is discoverable
  whether or not it is certified.

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
author          agent | human — see 4.5
provenance      hook | cli | http | mcp | transcript — see 4.6
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

`agent-lifecycle`'s `LifecycleKind` is a closed seven-value union, and that closure
is exactly what makes it hard to extend. Repeating the mistake would cap the design
at the use cases we thought of today.

`context` is **per event**, never per workspace.

**Registering a context obliges §4.3 to serve it.** Admitting `design` while the
capability table has no design column is a label with nothing behind it.

### 4.3 `capabilities` — which anchors this context can produce

Reuses the `known | unknown` pattern from `agent-lifecycle`, applied to evidence.

| Anchor class | Coding | Research | Ops | Design | Bare conversation |
| --- | --- | --- | --- | --- | --- |
| `commit` | yes | no | no | no | no |
| `file` (path + content hash) | yes | sometimes | sometimes | no | no |
| **`environment`** (see below) | yes | sometimes | yes | no | no |
| `visual` (design file + version + node, or screenshot hash) | no | no | no | yes | no |
| `runtime` (config, flag, deployed env var) | yes | no | yes | sometimes | no |
| `tool_use` | yes | yes | yes | yes | yes |
| `message` | yes | yes | yes | yes | yes |
| `url` / `external` | yes | yes | yes | yes | sometimes |

The bottom rows are universal. A journal without version control still works; it
proves something weaker — *the agent read X, then chose Y* — and **renderers must say
so out loud** rather than presenting weaker claims in the same voice as strong ones.

Rule: preserve `unknown` rather than inferring optimistic defaults.

**`environment` is the anchor class §2.1 requires.** It records the resolved
toolchain behind an observation — interpreter path and version as actually resolved,
relevant env flags, package manager, platform. Hooks capture it at session start and
whenever it changes. Without it the most common cause of a well-formed wrong entry is
structurally uncapturable.

**`runtime`** covers the other case §11 misses: a deployed config or flag change that
has no commit and no file, and is exactly what a support question is about.

Environment and runtime values are machine-identifying (usernames in paths, hostnames)
and are subject to §12 redaction before write.

### 4.4 Two families

**Observations** — hook-written, cheap, high volume:
`session_start`, `session_end`, `turn_end`, `tool_call`, `tool_result`,
`tool_failure`, `permission`, `subagent_start`, `subagent_stop`, `compact`,
`heartbeat`, `environment`, `path_claim` (§7.6), `void` (§10.3).

**Entries** — authored, sparse, expensive:
`decision`, `finding`, `assumption`, `blocker`, `progress`, `constraint` (§5.7).

`anchors[]`, `influences[]`, `outcome` and retraction (§5.8) apply to **every** entry
kind, not only `decision`.

### 4.5 `author` — agent or human

§2's two-plane claim assumes entries are agent-written. Some are not: a human finds a
root cause in a bare shell with no session running, or a designer decides in a canvas
no tool observed.

A human-authored entry is permitted and **carries no Plane A anchor by construction**.
That genuinely weakens it, so the field exists to say so rather than to hide it.
Renderers distinguish the two.

### 4.6 `provenance` — which transport produced this

In §9.2 tier 4 the agent authors *both* planes, so §2's separation does not hold
there. An event must therefore name the transport that produced it, and renderers
must degrade accordingly. One enum; the cheapest correctness fix in this document.

## 5. Entries

### 5.0 The decision schema

```
question        what was being decided
chosen          what was picked
rejected[]      alternatives considered, each with why-not
rationale       why
anchors[]       VERIFIABLE evidence that this decision happened — see 5.1
influences[]    ASSERTED provenance: what shaped it — see 5.2
reversibility   trivial | moderate | hard | one-way
blastRadius     who or what is affected at the moment it takes effect — see below
outcome         unknown | held | reverted | invalidated — see 5.8
supersedes?     id of an earlier decision this replaces
invalidates?    id of an entry whose premise was false — see 5.8
disclosure      private | team | published — see 13.3
confidence?     stated, not inferred
```

`rejected[]` justifies the project. Every existing tool records what happened; none
records what was considered and discarded. That is the field people actually want
later, and the first thing destroyed by compaction.

**`blastRadius` is distinct from `reversibility`**, and conflating them was a real
error. Flipping an enforcement flag is `reversibility: trivial` — unset and redeploy
— while its blast radius is every returning user. Rollback cost and user cost are
unrelated, and the trivial score is precisely the wrong signal.

### 5.1 Anchors prove occurrence; influences explain

Two different axes; they **must not be merged.**

| | `anchors[]` | `influences[]` |
| --- | --- | --- |
| Answers | did this happen? | how was it reached? |
| Produced by | the system | the agent, asserting |
| Verifiable | yes, that it occurred | sometimes, sometimes never |
| Rots | see below | yes — URLs die, docs move |
| Points at | the record of the decision | the inputs to it |

Collapsing them would let an entry claim anchored status while resting only on a
half-remembered URL.

**Two corrections to the earlier claim that anchors do not rot.** An anchor id is
immutable; what it points at is not.

1. The **observation** a `tool_use` anchor names can be aged out by retention. §6.3
   pins it instead.
2. An anchor proves occurrence, never soundness (§2.1).

An entry may have influences and no anchors (a bare conversation, or a human author),
or anchors and no influences (§5.4). Neither is an error.

### 5.2 Influence taxonomy

`{type, ref, role, excerpt?, retrieved_at?, integrity?}`

| type | example | verifiable |
| --- | --- | --- |
| `url` | article, docs page, benchmark | reachability + content hash if fetched |
| `document` | PDF, Google Doc, file outside this repo | sometimes |
| `journal` | another entry — **internal cross-reference** | fully |
| `ticket` | Linear issue, GitHub issue or PR | via API |
| `conversation` | something said, this session or another | by message id |
| `tool_result` | output of a search, fetch or query in-session | by `tool_use_id` |
| `codebase` | file or symbol in another repository | partially |
| `person` | a human said so | no — assertion only |
| `model_knowledge` | the model's own priors, no source consulted | **no, by definition** |

`role`: `decisive` | `supporting` | `considered` | **`contradicted`**.

`contradicted` — "I read this and chose against it" — pairs with `rejected[]` and is
otherwise unrecoverable.

`excerpt` is optional, bounded and redacted, so reasoning survives the source's death.

**`person` is PII and is governed by §13, not by preference.** The earlier "prefer a
role or handle" is not pseudonymisation: in a team of three, "the PM" is a direct
identifier.

### 5.3 Influences are selected, not recalled

Plane A already captures every `WebFetch`, `WebSearch`, `Read` and MCP call, so the
**candidate set** for a decision is derivable — the observations since the previous
entry. The agent selects and ranks from that window rather than retyping URLs.

An influence chosen this way carries a `tool_use` anchor for free, which is how an
asserted influence becomes a verifiable one.

**Stated limit.** This works only where Plane A saw the inputs. For design and for
conversation-driven work the window is often empty — a client call, a recording,
frames never exported — and the field reverts to the memory exercise this section
claims to avoid. §4.5 (human authorship) and §9.2 tier 4 are the partial answers;
neither is complete, and the spec should not pretend otherwise.

### 5.4 `model_knowledge` is the important one

An entry whose only influence is `model_knowledge` declares that the decision rested
on the model's priors and **no source was consulted**. It must be an explicit value
rather than an absent field, so "consulted nothing" stays distinguishable from
"recorded nothing".

**Two honest caveats, both raised repeatedly in review.**

*It is a confession field.* Timestamped, attributed, durable. Reviewers noted the
rational response is to attach a skimmed document as `role: supporting` instead —
which reads clean and means nothing. The field's value therefore depends entirely on
§13.3 giving candid entries somewhere safe to live. **Without disclosure control this
field does not survive contact with a review process.**

*It is not universally a defect.* In design and other taste-led work, deciding
without a citable source is the job, not a failure. Renderers must not present
`model_knowledge` as a finding in contexts whose §4.3 row makes it the norm.

### 5.5 The journal is a graph

`type: journal` influences reference other entries by id. With `supersedes` and
`invalidates`, the log becomes a decision graph: this rested on that, which replaced
an earlier one, which was invalidated by a premise that never held.

### 5.6 The other entry kinds

Previously only `decision` had a schema, which left the kinds closest to daily work
unspecified.

All share the envelope, `anchors[]`, `influences[]`, `outcome`, `disclosure`, and the
retraction fields.

- **`finding`** — `claim`, `evidence[]`, `premise[]` (what must be true for this to
  hold), `scope` (this machine / this workspace / general). `premise` is what makes
  §10.1's premise re-check possible; `scope` prevents a machine-local fact
  propagating as a universal one.
- **`assumption`** — `assumed`, `ifWrong`, `checked: yes | no`. The kind §11.2's
  compaction sweep populates.
- **`blocker`** — `blocked`, `on`, `owner`, `clearedBy?`.
- **`progress`** — `did`, `next?`, `externalRef?`. Bind to an existing tracker where
  one exists rather than duplicating it.
- **`constraint`** — see §5.7.

### 5.7 Standing constraints — the forward-looking kind

`supersedes` and §10.2's traversal both run backwards. A standing obligation has no
home in a purely retrospective model, yet it is common and consequential: *"never a
third-party sink for this client's telemetry"*, *"this control is fixed-height by
decision, not oversight"*, *"do not edit that checkout"*.

A `constraint` entry carries `statement`, `origin` (who imposed it), `scope`,
`expiry?`, and `enforcement: advisory | blocking`.

Constraints are **checked at projection, never at write time** — the same precedent
as §7.5. A new decision whose subject matches a live constraint is surfaced for a
human. Nothing blocks, nothing auto-resolves.

### 5.8 Outcome and retraction

Every mechanism in the earlier draft added; none subtracted. §10.1 reported rot, §7.5
reported contradictions, `supersedes` appended. Nothing could mark an entry *wrong*.

Two distinct edges, and the distinction matters:

| | `supersedes` | `invalidates` |
| --- | --- | --- |
| Means | a later decision replaces this one | this entry's premise was false |
| The original was | reasonable at the time | never sound |
| Effect on descendants | none | suppressed from `journal context` |
| In the digest | shown as history | shown as retracted |

`outcome` (`unknown | held | reverted | invalidated`) is set on the entry itself and
defaults to `unknown`. An entry nobody revisits stays `unknown` — and **`unknown` is
displayed, not hidden**, because "nobody checked whether this held" is itself the
signal a reader needs.

**Retraction must be possible from outside a session.** The Node-26 root cause was
found in a bare shell with no agent running. `journal invalidate <id> --reason` is a
human verb, `author: human`, and requires no session. Without it, correction depends
on an agent happening to revisit — which is exactly what does not happen to abandoned
misdiagnoses.

Invalidation never deletes. It is an appended event that changes projection. Deletion
is §13.2 and is a different mechanism for a different reason.

## 6. Storage

### 6.1 Workspace identity — declared, never silently inferred

Cascade, with the winning method **recorded in `meta.json` and surfaced at read time**
so a collision warning can be trusted:

1. explicit `.agent-journal/id`
2. git **common** directory of the repository (see below)
3. cwd path hash
4. host container id (ChatGPT Project, Claude Project, Cowork space)
5. agent asks once, records the answer
6. ephemeral session-only

**Worktree resolution, previously unstated and load-bearing.** A worktree and its main
checkout share a `.git` common directory but differ by cwd. Rung 2 therefore resolves
them to **one workspace** — which is required for §7.4 to fire at all. Rung 1
overrides rung 2, so an uncommitted `.agent-journal/id` in one worktree silently
splits them; the file is therefore expected at the repository root and read via the
common directory.

Rungs 1–3 assume a filesystem; hosted environments use rungs 4–5.

### 6.2 Layout

```
~/.agents/journal/workspaces/<workspace-id>/
  meta.json                                        identity, resolution method, contexts seen
  segments/<machine>/<session>/<agent>.<epoch>.<n>.jsonl
  index/journal.sqlite                             DERIVED, rebuildable, never authoritative
  snapshots/<snapshot-id>.json                     periodic projections
  tombstones/<id>.jsonl                            see 13.2
```

**One segment per writer process**, keyed `(machine, session, agent, epoch)`. Nothing
contends, nothing locks; concurrent sessions become the same problem as multiple
machines. Locking is needed only in the degraded raw-append fallback.

**The SQLite index is derived and disposable.** Index corruption is a non-event, and
sync only ever has to move JSONL.

### 6.3 Retention — anchored observations are pinned

Observations outweigh entries by roughly 100×: a busy coding session is 500–2000 tool
calls (~150–600KB redacted) against 5–20 entries (~15KB).

Base rule: observations age out on a configured window.

**Exception, and it is not optional.** An observation cited by an `anchors[]` entry
that has not been invalidated is **pinned** and exempt from aging. The earlier rule —
keep decisions indefinitely, age out observations — deleted the proof and retained
the assertion, leaving every anchor a dangling pointer that still rendered as
anchored.

Where an anchor's referent is genuinely gone (external deletion, a purge under §13.2),
the anchor is **downgraded to `unknown`** using the §4.3 vocabulary and rendered as
such. It is never silently presented as intact.

Entry retention is set in §13.2, not here. Volume is not the only reason to expire
something.

### 6.4 The committed digest

A rendered artifact under `docs/decisions/`, for reviewers. Never the source of truth.

Its contents are **governed by `disclosure` (§13.3), not by curation judgement.** The
earlier "candid out-of-repo, curated in-repo" split named no curator, no filter and no
rule — which is the shape of selective disclosure rather than a policy.

Digest ordering is by `blastRadius` and `outcome`, not by time: irreversible and
invalidated first, `model_knowledge`-only flagged, `rejected[]` shown. Every digest
carries the §10.3 coverage statement.

## 7. Multi-session semantics

### 7.1 Writes need no coordination

Each writer owns its own segment. Concurrent sessions never contend.

### 7.2 The session tree

Claude Code's `SessionStart` matcher reports how a session began —
`startup | resume | clear | compact | fork`. Recording that plus `parentSession`
reconstructs which sessions continue one thread, which branch, which are fresh.

### 7.3 Liveness

- **active** — recent appends *and* fresh heartbeat
- **stale** — freshness deadline passed, no terminal event
- **ended** — `session_end` recorded

The **stale-before-lost** rule from `agent-lifecycle`: one missed heartbeat never
means dead. Note the consequence for §7.6 — a wedged writer and an idle-but-live
session are deliberately indistinguishable, so a path claim carries a TTL rather than
relying on liveness alone.

### 7.4 What a new session sees

`journal context` scopes to the workspace and returns entries from **all** sessions —
superseded and invalidated ones excluded, ranked within a token budget by recency,
relevance, `blastRadius`, and **evidence strength**.

Entries are flagged by their author's liveness state, and by `outcome`. *"Session X
decided this 3 minutes ago and is still running"* differs materially from *"someone
decided this last month and nobody has checked whether it held."*

**Two ranking corrections from review.**

*Machine scope.* An entry whose anchors all come from another machine is downranked
and flagged. A fact about one laptop's `PATH` is not a fact about the workspace.

*File-relevance bias.* Ranking primarily by "relevance to files in play" systematically
demotes work that touches no files — design exploration, research, ops — so the
system does not merely miss that work, it **re-weights the record against it**.
Relevance is therefore computed over `subject` and `context` as well as paths, and a
context whose §4.3 row has no `file` anchor is never ranked by file relevance.

### 7.5 Contradictory decisions

Two sessions may concurrently decide opposite things. Detecting that at write time
would need a global lock and semantic understanding.

**Record faithfully, detect at projection.** A structural check — same `subject`,
overlapping windows, different sessions — surfaces the pair for a human. No auto-
resolution.

### 7.6 Path claims

§7.4's collision-avoidance needs to answer *"is another session in this checkout right
now"* **before** any entry exists. Decisions ranked by file relevance cannot do that:
at session start no files are in play, and "I own this worktree" is a claim on a
resource, not a decision.

A `path_claim` observation is hook-written at session start, recording checkout path,
worktree, branch, and a TTL. It is an observation about a resource, permitted by
§2.2's revised wording.

It is **advisory**. Enforcing it would require write-time coordination and would
forfeit §7.1. A starting session reads live claims and surfaces them; it does not
block.

## 8. Sync

### 8.1 There is no merge algorithm

Events are immutable facts with unique ids. Merging is set union with dedup by id — a
grow-only set, a CRDT by construction.

**Two stated limits.** Grow-only is *append-permissive*, not tamper-evident: nothing
authenticates a writer, so on a shared folder anyone can author history for a session
that never ran. And union-with-dedup detects duplicates, never **omissions** — a
deleted segment is indistinguishable from one that was never written. §10.3 and §17
address these; neither is solved in v1, and the spec should not imply otherwise.

### 8.2 Tiers, each additive

| Tier | Mechanism | Good for |
| --- | --- | --- |
| 0 | Local only | Default |
| 1 | Directory on Syncthing / Dropbox / iCloud | Solo, multi-machine, zero infra |
| 2 | Private git repo of segments | Small team; free history and auth |
| 3 | R2 for segments + Durable Object for live fan-out | Hosted sink and realtime |

### 8.3 Making naive file-sync work

**Aggressive segment rotation**: finished segments are immutable, so only one small
active file per writer is mutable. A "conflicted copy" is just another segment, and
dedup-by-id absorbs it.

### 8.4 Clock skew

Per-source `sequence` is authoritative for order **within** a source; wall clock is
**display only** across sources; **causality is never inferred from timestamps**.

## 9. Environments and transports

### 9.1 What each environment exposes

| Environment | Filesystem | Hooks | MCP |
| --- | --- | --- | --- |
| Claude Code, Codex, Cursor, Gemini (local) | yes | yes | yes |
| Claude Code cloud / web | ephemeral | repo + org settings only | yes |
| Claude Managed Agents | persistent | no | yes |
| Claude Cowork | **no** — Filesystem connector unavailable in Cowork | no | yes |
| ChatGPT Work / agent mode | ephemeral terminal only | no | yes |

**The universal denominator is MCP — not the filesystem, and not hooks.**

### 9.2 Sink interface, three transports

The CLI is a *transport*, not the architecture.

| Sink | Used where |
| --- | --- |
| **File** (CLI) | Local dev. Full fidelity, offline, cheapest. |
| **HTTP** | Anywhere networked. Claude Code hooks support `type: "http"` natively. |
| **MCP** | Hosted, no-FS. The only option in Cowork and ChatGPT Work. |

**Fallback ladder** — each rung sets `provenance` (§4.6):

1. FS + CLI — full fidelity
2. FS, no CLI — raw JSONL append, flagged `unvalidated`, repaired by a normalise pass
3. No FS — MCP or HTTP sink
4. Nothing — the agent emits entries as marked structured blocks **into its own
   transcript**, harvested later

Tier 4 is where §2's two-plane separation does not hold: the agent authors both
planes. `provenance: transcript` exists so renderers can say so.

### 9.3 Scope consequence

Cowork and ChatGPT coverage make a hosted sink non-deferrable — a minimal
authenticated endpoint writing segments to R2. Note §13.1: a hosted sink means the
candid plane lives on a server the author may not control, which is a governance
question before it is an infrastructure one.

## 10. Consumption

| Command | Consumer | Shape |
| --- | --- | --- |
| `journal render --since <ref>` | Human | Markdown digest, ordered by blast radius and outcome |
| `journal context --budget N` | A later agent | Ranked structured block (§7.4) |
| `journal query '<expr>'` | Ad hoc | Over the derived index |
| `journal invalidate <id>` | Human, out of session | §5.8 |
| `journal watch` | Dashboard | Tail active segments → projection |

### 10.1 Two distinct decay checks

**Rot** — did a source move or die?

| type | rot check |
| --- | --- |
| `url` | unreachable, or content hash differs from `retrieved_at` |
| `ticket` | closed, rejected, or reopened |
| `journal` | referenced entry superseded or invalidated |
| `codebase` | file or symbol gone |
| `visual` | design file version advanced — see below |
| `person`, `model_knowledge` | not checkable — reported as such, never as passing |

**Premise** — was the reasoning ever sound? Distinct from rot, and the check §2.1
requires. Where a `finding` declares `premise[]` (§5.6) and an `environment` anchor
exists, a re-check asks whether the premise still reproduces. A decision whose premise
no longer holds is surfaced for human `invalidate` — never auto-invalidated.

Both are reported, never auto-resolved. A decision does not become wrong because a
source moved.

**Living sources are exempt from hash-based rot.** A design file changes on every
save; flagging it daily trains people to ignore rot flags entirely. `visual` anchors
compare version ids at decision-relevant granularity, and a source may be marked
`living` to suppress content-hash rot while keeping existence checks.

### 10.2 Answering "why is it like this"

Given an artifact, find the entries anchored to it, then walk `influences`,
`supersedes` and `invalidates` backwards.

**Traversal must start from more than a file.** Support and operations questions begin
at a symptom, a customer-visible string, a ticket, or a deployed flag — not a path.
Entries are therefore indexed by `subject`, by `runtime` anchors, and by external ref,
so `ticket → entries` and `symptom → entries` work as well as `file → entries`.

### 10.3 Coverage — silence must be legible

§11 makes recording a matter of judgement and §12 exits 0 on hook errors, so a silent
gap is indistinguishable from a stretch where nothing was decided. Uncontrolled, this
converts *"we kept no record"* into *"you kept one, and it is missing here."*

Two mechanisms:

- **`void` observations** record refused writes, dropped sinks, hook failures and
  detected sequence gaps as first-class events. Silence becomes auditable.
- **A coverage statement** accompanies every render and digest: sessions observed,
  sessions with zero entries, aged-out windows, void events, and which anchors are
  downgraded.

Without these the journal cannot honestly be described as a control, and §2.2's
disclaimer does not repair a claim made by its mere existence.

## 11. Authoring model

**Self-triggered, with two hard floors.**

### 11.1 Self-trigger

The agent writes when it judges a real decision was made. The skill defines what
qualifies. This keeps signal-to-noise high and rationale rich.

### 11.2 Floor 1 — compaction

`PreCompact` forces a flush before context is destroyed: pending entries, plus an
**assumption sweep** — what was taken on trust (idempotency, ordering, environment)
written as `assumption` entries with `checked: no`.

### 11.3 Floor 2 — consequence, not judgement

**The most-repeated finding in review: the set §11.1 captures is roughly the
complement of the set that hurts you.** Nobody *chose* a mutating call — a `get`-shaped
name was read as a read. Nobody *decided* to flip an enforcement flag. Nobody
*decided* a catch-all error string. Those never present as decisions and are exactly
the ones later needed.

So a narrow set of **Plane A observations** prompts an entry regardless of judgement:

- permission grants and permission denials
- config, flag, env-var and deploy mutations (`runtime` anchors)
- first use of an unfamiliar external API in a workspace
- a `constraint` (§5.7) matching the current subject

This is deliberately not a per-turn checkpoint — the objection to those (tokens spent
on turns where nothing was decided, perfunctory entries) stands. It is a short list of
consequence-bearing observations, and the hooks already see all of them.

### 11.4 Backfill

Transcript mining remains available as a **backfill** for history predating adoption.
Reconstructive, blind to compacted content, and marked `provenance: transcript`.

## 12. Failure behaviour

Capture is always subordinate to the work.

| Failure | Behaviour |
| --- | --- |
| Any hook error | Exit 0. A broken journal never blocks a session — **and emits a `void` observation** (§10.3) so the gap is visible |
| Journal corruption | `JsonlLifecycleParser` recovers around bad lines with bounded, redacted diagnostics |
| CLI absent | Degrade per §9.2; flag `unvalidated`; repair later |
| Sink unreachable | Buffer locally where a filesystem exists; otherwise drop **and record a `void` event at the next reachable sink** |
| **Redaction failure** | **Fail closed.** Refuse to write. The only fail-closed case. |

### 12.1 Redaction must inspect values, not key names

**The existing redactor cannot deliver what this section promises.** It matches key
*names* (`secret|token|password|authorization|cookie|api[_-]?key`), across two
divergent pattern lists, and never inspects values.

The fields that carry the real risk have no matching key: `rationale` is
model-authored free text, `excerpt` is fetched third-party content, `person` is a
name, `environment` embeds usernames in paths. All pass through untouched. Worse, a
key-name matcher has **no failure state**, so the sole fail-closed rule above can
never fire — it passes silently and looks like success.

Required: value-level scanning with a **detectable failure verdict**, applied to every
sink and every transport. The cost is tokens and latency on write, and false positives.
Both are acceptable; a fail-closed rule that cannot fire is worse than no rule,
because it is believed.

## 13. Governance

Absent from the earlier draft entirely: no occurrence of access, consent, delete,
erase or revoke in the whole document. A durable, queryable, replicated record of
candid reasoning about people and choices needs this before it needs a dashboard.

### 13.1 Principals

Each workspace names who may **write**, **read**, **export**, and **delete**. Defaults
are the local user for all four, so solo use needs no configuration — but the model
must exist, because sync tiers 1–3 and the §9.3 hosted sink all move the candid plane
somewhere the author may not control.

Sync above tier 0 is **opt-in per workspace**, and the opt-in names its readers.
§7.3's liveness and §7.6's path claims are presence data about a person; they are
published at coarser granularity than the entry log, and a workspace may publish
presence without publishing rationale.

### 13.2 Deletion — tombstones, and the price

Erasure has no mechanism in a grow-only set: a leaked secret and a named person are
equally permanent, and a local delete returns on the next union.

A **tombstone** is an appended event that suppresses a target id from every projection
and instructs each replica to purge the referenced bytes on next compaction. Anchors
pointing at purged content downgrade to `unknown` (§6.3).

**This forfeits pure CRDT convergence** — a replica that never sees the tombstone
keeps the bytes. That is the honest price, and it is worth paying: an append-only
store of secrets and named people is not defensible at a multi-year horizon. Taking
the cost now is far cheaper than retrofitting it.

Entry retention is therefore symmetric with observations: entries carry a TTL, default
long but not infinite. "Kept indefinitely" was a volume decision masquerading as a
policy.

### 13.3 Disclosure class

Every entry carries `disclosure: private | team | published`.

- **`private`** never leaves the local journal — not to sync, not to a hosted sink,
  not to a digest.
- **`team`** syncs to the workspace's named readers.
- **`published`** may appear in a committed digest.

Default is `team`, and the skill sets `private` for entries whose candour is the point
— `model_knowledge`-only rationale, `person` influences, `rejected[]` entries naming a
person's work.

This is the mechanism §5.4 depends on. Without somewhere safe for candid entries to
live, the rational response to a confession field is to stop being candid, and the
journal degrades into well-anchored entries that read as diligence and are not — the
exact failure §2 exists to prevent.

## 14. Packaging

A **sibling package**, not an extension of `agent-lifecycle`, whose `LifecycleKind` is
closed and whose skill forbids using lifecycle state for work progress.

Extract the reusable primitives — journal, parser, lock discipline — into a shared
internal module and stand both event families on it. The redactor is **not** reusable
as-is (§12.1) and is rewritten.

## 15. Testing

| Test | Why |
| --- | --- |
| **Recorded conformance fixtures per harness** | Real hook payloads → expected normalised events. Without these, adapters rot silently when a harness changes its schema and you find out during an audit |
| Replay-order independence | Shuffle the log, identical projection |
| **Value-level redaction** | Planted secrets *and* planted names, in `rationale`, `excerpt`, `person` and `environment` — the fields with no matching key. Must assert the failure verdict fires |
| **Anchor pinning** | Run retention; assert anchored observations survive and unanchored ones expire |
| **Invalidation propagation** | Invalidate an entry; assert descendants are suppressed from `context` and marked in the digest |
| **Coverage honesty** | Induce hook failures and dropped sinks; assert `void` events and an accurate coverage statement |
| Degraded-mode round trip | CLI absent → raw append → normalise → identical journal |
| Transcript-harvest round trip | Ships with tier 4, not v1 |

## 16. Scope

### In v1

- Envelope (including `author`, `provenance`, `outcome`, `disclosure`), validator,
  **new value-level redactor**
- Journal (file sink) + CLI, including `journal invalidate`
- The `decision-journal` skill
- Human digest renderer with coverage statement
- `environment` and `runtime` anchor classes; `path_claim` and `void` observations
- The `constraint` entry kind (§5.7) and its projection-time check
- The `visual` anchor class as a **schema**, populated manually or by a human-authored
  entry (§4.5). Automated design-tool capture is deferred; the class exists in v1 so a
  `design` context can declare the capability honestly rather than claiming `unknown`
- Anchor pinning; tombstones
- **Two** harness adapters: Claude Code and Codex

Two adapters deliberately: a portable abstraction cannot be validated against one
implementation.

### Deferred

- Cursor and Gemini adapters
- Hosted sink (moves in with Cowork / ChatGPT coverage — §9.3, §13.1)
- Realtime dashboard and Durable Object fan-out
- MCP wrapper
- Cross-machine sync beyond tier 1
- Signed segments and coverage attestation (§8.1, §17.5)
- Automated `visual` capture from design tools (the anchor class itself ships in v1)
- Transcript tier 4 and the backfill pass (§11.4)

## 17. Open questions

1. **Hosted sink in v1** — Cowork/ChatGPT coverage against a service to run, now also
   against §13.1's principal model.
2. **Retention windows** — observations, and separately entries (§13.2). Both need
   numbers, and the entry number now carries governance weight.
3. **Well-known `context` registry** — initial set, and the process for adding one.
   Adding a context obliges a §4.3 row.
4. **Digest cadence** — per PR, per release, or on demand. Reviewers noted an
   undecided cadence means no digest reaches anyone.
5. **Signed segments** — §8.1 is append-permissive and cannot distinguish removal from
   absence. Key custody and revocation are real costs; is tamper-evidence in scope at
   all, or is this explicitly a good-faith record?
6. **An axis above workspace** — an initiative spanning several repos has no home, and
   `journal context` is workspace-scoped.
7. **Excerpt bound** — byte cap, and whether excerpts are stored by default.
