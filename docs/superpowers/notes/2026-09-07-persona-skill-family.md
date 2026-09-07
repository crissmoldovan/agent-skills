# Persona skill family — design note

- **Date:** 2026-09-07
- **Status:** Note only. Not scheduled, not scoped, no spec. Captured while the
  evidence was fresh.
- **Origin:** a 24-agent persona review of the
  [agent decision journal spec](../specs/2026-09-07-agent-decision-journal-design.md).
  Results: [findings](2026-09-07-journal-persona-review-findings.md).

A family of composable skills: **`impersonate`** supplies a perspective; **`imagine`**,
**`debate`** and **`feedback`** are things done from one. This note records the method
that was actually exercised and what it produced, so the design starts from evidence.

The run is the only empirical input so far. Everything marked **untested** below is
reasoning, not result.

---

## Part 1 — The problem the family must solve

Persona agents hallucinate by default. Asked to "imagine how you'd use this", a model
emits the median answer about that job title: enthusiastic, generic, untethered. It
reads as insight and contains none.

Four mechanisms produce it:

1. **No grounding** — nothing anchors the persona to a real environment.
2. **No cost to being wrong** — nothing checks the output.
3. **The helpfulness pull** — enthusiasm is rewarded, doubt is not.
4. **Invented context** — company size, team shape, workflow, all fabricated to suit
   whatever conclusion is being reached.

## Part 2 — Six devices that counter it

All six ran in this exercise. **All six held**: across 24 agents, no fictional company
appeared, no invented statistic appeared, grounding labels were used honestly
including `constructed` on weak scenarios, and every agent produced a real
anti-scenario rather than a caveat.

| Device | Counters | How it works |
| --- | --- | --- |
| **Verified-facts briefing** | 1, 4 | One shared file of confirmed facts about the real environment, written by the orchestrator. Personas cite from it instead of inventing. This proved the highest-value device — agents grounded in *real incidents* produced the specific, checkable findings; the shared briefing is also what made independent convergence meaningful |
| **Grounding labels** | 2, 4 | Every scenario tagged `observed` / `inferred` / `constructed`. Borrowed from the journal spec's own `model_knowledge` discipline and turned on the exercise |
| **Mandatory anti-scenario** | 3 | Every persona must name a case where the thing is useless or harmful to them. Required, not optional. **The single strongest device** — it produced the review's most important finding |
| **Falsifiable specificity** | 2, 4 | A scenario must name an artifact and a failure. "The Tuesday migration rollback" passes; "improving team velocity" is rejected |
| **Traced, costed asks** | 2, 3 | Every request traces to a scenario above and states its cost. No free-floating wishlists |
| **Banned register** | 3 | No enthusiasm vocabulary, no invented statistics, no fictional company names |

### The device that mattered most

The mandatory anti-scenario. Twelve of twenty-four agents produced the *same* one, and
it invalidated the reviewed spec's central claim. Without it every one of those agents
would have written a feature wishlist and the flaw would have shipped.

**Design implication:** an anti-scenario requirement is not a nicety of `feedback`. It
belongs in `impersonate` itself, because it is what converts a persona from a
generator of agreeable text into an instrument.

## Part 3 — Modifier dials

Proposed vocabulary for `impersonate`. The governing rule:

> **Modifiers govern where an agent looks, never what it treats as true.**

Divergence is the dial that would otherwise license fiction. Aiming it at the *search
space* rather than the *evidence rules* is what makes the set safe.

| Dial | Range | Changes |
| --- | --- | --- |
| **Divergence** | 1 conventional → 5 out-of-the-box | how far from the obvious case they hunt |
| **Rigour** | 1 practitioner → 5 academic | lived friction vs. principle and taxonomy |
| **Charity** | 1 adversarial → 5 generous | whether premises are granted or attacked |
| **Horizon** | immediate / seasonal / multi-year | today's friction vs. the long-lived artifact |
| **Disposition** | burned / neutral / invested | *what feels salient* — the "mood" dial, mechanism not decoration |

The six devices are **fixed**; no dial may relax them. Without that, `Divergence 5`
degenerates into "make things up".

The fixed output contract also prevents caricature. A `Divergence 5 / Charity 1`
persona could become a cartoon contrarian, but it still owes three specific moments
with cited sections, and that structure disciplines the voice.

### Result from the control

Persona 1 held setting constant across three agents and varied only dials.

- **All three produced the same anti-scenario.**
- **Their feature asks differed materially.** The high-divergence / adversarial /
  multi-year / burned agent reached furthest — out-of-session human retraction,
  non-repo scopes, per-destination candour. The high-rigour agent named general
  classes. The charitable agent stayed conventional.

> **Dials shift what gets proposed. Persona and grounding determine what gets
> attacked.**

Both axes earn their place and they are not interchangeable. A run that varies only
dials will find the same problem repeatedly; a run that varies only personas will
propose a narrower set of fixes.

### Dial/persona coherence

Some combinations are invalid and the skill should refuse rather than obey. A
compliance auditor at Charity 5 or a marketer at Charity 1 produces noise. **Untested**
— it was designed around, not measured.

## Part 4 — Assignment discipline

Applies to any fan-out.

- **Do not cross-product.** Personas × settings × dials explodes. Assign one
  `(setting, dial-profile)` pair per agent and spread them Latin-square style.
- **Do not confound.** If every sceptic gets low charity, persona and dial are
  indistinguishable in the results.
- **Exclude incoherent combinations** (above).
- **Build in a control.** Hold one variable constant for one persona. Cost: zero.
  It is the only way to learn whether the dials do anything.
- **Duplicates are not free samples.** Three identical agents give three draws from one
  distribution.
- **Keep agents blind to each other.** Independence is what makes convergence
  evidence. Twelve agreeing agents that had seen each other's output would have meant
  nothing.
- **Stage the first batch.** Run one setting-column first and check grounding quality
  before committing the rest. Cost: one round trip.

## Part 5 — Reading a fan-out

Not by counting votes. Signal lives in *who* agrees.

| Pattern | Reading |
| --- | --- |
| Agreement across **opposed interests** (auditor + sceptic + founder) | Strongest available evidence. This is what surfaced the premise flaw |
| Request from a **single persona** | Usually a rendering or presentation issue, not a design one |
| **Anti-scenarios clustering** | Where the design is actually weak |
| A persona reporting **"this adds nothing for me"** | A scope signal, and a sign the devices are working. Both marketing personas did this, confirming a prediction made before the run |
| A finding **only** the out-of-the-box agent reached | Check it directly before acting. Two such findings here verified as real |

**Verify before relaying.** Several agents made checkable structural claims — a
contradiction between two sections, a grep that returns zero, a redactor that inspects
key names. Every one was checked against the source before it entered the findings.
Two were sharper than the agent stated; none was wrong. A persona run produces
*leads*, and the orchestrator owes verification.

## Part 6 — The skills

### `impersonate` — the substrate

Supplies a perspective the other three operate from. Owns: persona definition, the
five dials, the six fixed devices, the verified-facts briefing, assignment discipline,
and the output contract.

Not a roleplay skill. The persona is an instrument for finding things a direct review
misses; the voice is a side effect.

Open: whether the briefing is part of `impersonate` or a separate primitive. It is the
most transferable piece — grounding is useful to any fan-out, persona or not — and may
deserve to stand alone as something like `ground`.

### `imagine` — what this run actually was

Given an artifact and a persona, produce grounded scenarios and traced feature gaps.
Output contract: moments → what's needed → **anti-scenario** → costed gaps.

Validated once, on a design spec. **Untested** on code, a product, or a process.

### `debate` — untested

Two shapes, and the choice is unresolved:

1. **Second pass** — personas see each other's output and respond. Loses the
   independence that made convergence meaningful here.
2. **Confrontation of positions** — the orchestrator extracts conflicting claims from
   an independent round and puts *those* to fresh personas.

Shape 2 preserves independence and is the better default. This run produced a natural
test case: the sceptic wants tombstones and short entry retention; the auditor wants
long retention and sealed segments. Both are right, and neither addressed the other.

### `feedback` — untested

Distinct from `imagine`: `imagine` asks *when would this matter*, `feedback` asks *is
this any good*. Likely a thinner skill, since it duplicates ordinary review unless the
persona is doing real work. The honest question is whether it earns a slot at all, or
whether it is `imagine` with a different output contract.

### Composition

`impersonate` sets the perspective; exactly one of the others sets the task. They do
not stack. A run is `impersonate(persona, dials) → imagine|debate|feedback(artifact)`.

## Part 7 — Costs

- **24 agents ≈ 1.4M subagent tokens** for one 550-line spec. Not a routine review;
  it is a gate for something expensive to get wrong.
- **Orchestrator cost is the real constraint.** 24 reports of ~600 words each is a
  large synthesis, and verification is on top.
- **A smaller run trades convergence, not quality.** The strongest finding needed
  independent repetition across opposed interests to be trustworthy. Six agents would
  have surfaced it once and it would have read as one agent's opinion.

## Part 8 — Open questions

1. Where does the briefing live — inside `impersonate`, or a standalone `ground`?
2. Which `debate` shape (Part 6), and does it re-ground or inherit?
3. Does `feedback` earn a slot distinct from `imagine`?
4. Do the dials hold on non-spec artifacts — code, a product, a process?
5. Is dial/persona coherence enforceable, or only advisory?
6. Can the anti-scenario requirement be generalised beyond persona work? It was the
   highest-yield device here, and nothing about it is persona-specific.
