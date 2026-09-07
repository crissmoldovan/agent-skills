# Decision journal — persona review findings

- **Date:** 2026-09-07
- **Input:** 24 agents — 8 personas × 3 settings, differentiated dials, blind to each other.
- **Method:** [persona skill family note](2026-09-07-persona-skill-family.md).
- **Target:** [agent decision journal design](../specs/2026-09-07-agent-decision-journal-design.md).
- **Status:** findings only. No spec changes applied.

Claims marked **verified** were checked against the spec text or the source by the
orchestrator, not taken from an agent's report.

## The finding that dominates

Twelve of twenty-four agents, independently and without knowledge of each other,
produced the same anti-scenario: the Node-26 session.

> An entry written then is *perfectly* formed — real `tool_result` anchors, a real
> failing suite, populated `rejected[]`, honest `model_knowledge`. Every rule in §2
> satisfied. The conclusion is wrong, because the premise was a bad interpreter on
> `PATH`.

The diagnosis converged as tightly as the scenario:

> **Anchors prove a decision occurred. They say nothing about whether its premise
> held.** §10.1 re-checks whether sources rotted; nothing re-checks whether the
> reasoning was ever valid. §4.3 has no environment anchor class, so the actual root
> cause was unanchorable.

Agreement here spans parties with opposed interests — the manager who wants the
tool, the sceptic who fears it, the auditor who would certify it, the founder who
would fund it, the marketer who would publish from it. By the reading standard set
before the run, this is the strongest evidence the exercise can produce.

Two consequences were stated better by the personas than the spec states its own
thesis:

- *"Anchored Plane B is a flattering narrative with citations."* Worse than prose for
  a reader who cannot check the code, because prose does not look verified.
- The journal is **citable**. A structured, evidence-linked wrong answer costs more
  to dislodge than no answer at all.

## Tier 1 — structural, resolve before an implementation plan

### 1. The premise problem

As above. Requires three things, none currently present: an environment/toolchain
anchor class; a premise re-check in §10.1 distinct from rot; and an `invalidated`
state distinct from `supersedes` that suppresses descendants from `journal context`.

### 2. Retention destroys anchoring — **verified contradiction**

§5.1 claims anchors do not rot, "commits and tool ids are immutable". §6.3 keeps
decisions indefinitely and ages out observations. The id is immutable; the
observation it names is deleted. After the window, every `tool_use` anchor is a
dangling pointer that still renders as anchored.

Named independently by the marketer, the founder, two auditors, and a sales engineer.
Fix: pin observations cited by a surviving entry, or downgrade the anchor to
`unknown` on expiry — §4.3 already has that vocabulary.

### 3. Nothing subtracts — **verified**

`supersedes` appears only in the §5 decision schema (grep: 3 occurrences, all §5,
§5.5, §10.2). §4.4 extends `anchors[]`/`influences[]` to every entry kind and is
silent on retraction. A wrong `finding` can never be withdrawn.

§10.1 reports rot. §7.5 reports contradictions. §5.5 appends supersession. **Every
mechanism in the spec adds; none subtracts.** There is also no path for a human
outside a session to mark an entry wrong — and the Node-26 root cause was found in a
bare shell with no agent running.

### 4. §11's trigger misses the decisions that matter

Near-universal. Every real incident in the briefing was a non-decision at the time:
nobody *chose* a mutating call — a `get`-shaped name was read as a read. Nobody
*decided* to flip an env var. Nobody *decided* the catch-all error string.

> The set §11 captures is roughly the complement of the set that hurts you.

Converged fix, narrower than forced checkpoints: trigger on **Plane A observations**
— permission grants, config/flag/deploy mutation, first use of an unfamiliar API —
which keeps §11's token objection small and its rationale intact.

### 5. No principal model — **verified**

In 544 lines: `access` 0, `consent` 0, `delete` 0, `erase` 0, `revoke` 0,
`outcome` 0, `tombstone` 0. Nothing states who may read, export, or delete.

§8's grow-only set plus §6.3's indefinite retention means no erasure path exists at
all — a leaked secret and a named person are equally permanent, and a local delete
returns on the next union. Multiple personas: tombstones are worth forfeiting CRDT
purity for, and that trade should be made now rather than retrofitted.

### 6. §12's fail-closed redaction cannot fire — **verified in source**

The redactor the spec leans on tests **key names**
(`/secret|token|password|authorization|cookie|api[_-]?key/i.test(k)`), in two
divergent pattern lists, and never inspects values.

`rationale` is model-authored free text. `excerpt` is fetched third-party content.
`person` is a name. None has a matching key, so all three pass through untouched —
and a key-name matcher has no failure state, so the one fail-closed rule in the spec
can never trigger.

## Tier 2 — significant

### 7. Coverage is unmeasurable

§11 makes recording a matter of model judgement; §12 exits 0 on any hook error;
§6.3 ages observations out. A silent gap is indistinguishable from a stretch where
nothing was decided.

> The journal converts "we kept no record" into "you kept one, and it is missing
> here."

Fix: void events for refused writes and dropped sinks, plus a coverage statement on
every render. Without it the journal cannot be claimed as a control.

### 8. The non-code generalisation is thinner than claimed

§4.2 registers `design` as a context; §4.3's capability table has four columns and
design is not one. The registry admits a value the anchor vocabulary cannot serve.

Sharper, and novel — from the high-stakes designer:

> §7.4 ranks by relevance to files in play and irreversibility. Three weeks of
> exploration touching no files rank nowhere, while forty anchored engineering
> entries rank first. The system does not merely miss design work — it **re-weights
> the record against it**, then hands that record to a reviewer.

Also: §5.3's "influences are selected, not recalled" depends on Plane A having
observed the candidate set. For design the window is empty — a client call, a Loom,
three hidden frames — and the field reverts to exactly the memory exercise §5.3
claims it is not.

### 9. Four of five entry kinds have no schema — **verified**

§5 specifies `decision`. `finding`, `assumption`, `blocker` and `progress` appear
once, as a list. The sales persona: *"the one entry kind that maps to my job is the
unspecified one."*

### 10. Everything points backwards

`supersedes` and §10.2's traversal both run from an artifact into the past. A
**standing constraint** — "never a third-party sink for our telemetry", "this
control is fixed-height by decision" — has no home, and no new decision is ever
checked against one. §7.5's detect-at-projection precedent applies.

### 11. Tier 4 has no provenance marker

In §9.2 tier 4 the agent authors *both* planes, so §2's "ground truth the agent does
not control" is simply false there. §4.1 has no field naming which tier produced an
event; tier 2 gets `unvalidated`, tiers 3–4 get nothing. Cheapest fix in this
document: one enum on the envelope.

### 12. Worktree resolution is unstated and load-bearing

§6.1 rung 2 (git remote hash) and rung 3 (cwd hash) resolve a worktree differently,
and the spec never says which wins. §7.4's collision-avoidance — the headline feature
— silently never fires under one reading and fires constantly under the other.

## Tier 3 — worth carrying

- **No `author` field** (verified): §4.1 has `agent`, nothing to mark a human-written
  entry. Admitting one weakens §2's two-plane claim honestly rather than papering.
- **No axis above workspace**: an initiative spanning five repos has no home, and
  §16 does not list this as open.
- **No reverse index**: §10.2 runs file → decision. Support runs symptom → decision.
- **Unauthenticated writers**: on sync tier 1, anyone with the share can author
  history for a session that never ran. Grow-only is append-permissive, not
  tamper-evident.
- **§2.1 vs §7.4**: "work state must never drive journal state" forbids the path
  claim §7.4's headline feature needs. The spec oversells relative to its own rules.

## The honest negative

Both marketing personas largely confirmed the prediction made when the persona set
was chosen: for most changelog rows `describe-changes` already anchors what changed
better than an agent's recollection would, and the journal adds nothing. It earns its
place only on the rows they currently cannot write at all — chiefly `rejected[]`, and
work that shipped outside version control.

That is a real scope signal, not a failure of the exercise.

## Method result — for the persona skill family

The control (persona 1, setting held constant, dials varied) produced:

- **All three shared the anti-scenario.** Persona plus grounding determined what got
  attacked.
- **Feature asks differed materially.** The high-divergence / adversarial / burned
  agent reached furthest — out-of-session human retraction, non-repo scopes,
  per-destination candour. The high-rigour agent named general classes. The
  charitable agent stayed conventional.

**Preliminary conclusion: dials shift what gets proposed; persona and grounding
determine what gets attacked.** Both axes earn their place, and they are not
interchangeable.

The six anti-hallucination devices held. No agent produced a fictional company, no
invented statistics appeared, grounding labels were used honestly — including
`constructed` on weak scenarios — and every agent produced a real anti-scenario
rather than a caveat.
