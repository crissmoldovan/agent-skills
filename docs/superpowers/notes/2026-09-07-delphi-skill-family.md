# `delphi` — persona review skill family

- **Date:** 2026-09-07. **Revised the same day** after a 12-agent review *of this note*.
- **Status:** Note only. Not scheduled. **Scope reduced from four skills to two** by that review.
- **Pack name:** `delphi`. The Delphi method is independent expert panels with
  controlled feedback and convergence analysis — literally this. Its documented
  weakness is that **facilitator framing drives convergence**, which is exactly the
  flaw the self-review found below. The name is chosen to keep that visible.

## Provenance and correction

This note originally documented a 24-agent review of a design spec, and claimed that
run validated the method. A subsequent 12-agent review **of this note** falsified part
of that claim. Corrections are marked **[CORRECTED]** and the original wording is
stated, not quietly replaced.

## Part 0 — Why `delphi`

Recorded in the shape the journal spec requires of a decision: what was chosen, what
was rejected, and why. The alternative to writing this down is that in six months the
name looks arbitrary and someone renames it.

**Question.** What namespace prefix should the pack carry, given every skill is invoked
as `<pack>:<skill>` and the prefix is typed on every invocation?

**Chosen: `delphi`.**

The Delphi method is an established forecasting and review technique: a panel of
experts respond independently, their responses are collected and fed back under
controlled conditions, and convergence across rounds is analysed. That is a precise
description of what this family does — independent agents, a controlled shared
briefing, convergence read as signal.

Three reasons it won over names that merely evoke a meeting:

1. **It names real prior art rather than a metaphor.** Anyone who knows the method
   knows roughly what the pack does before reading a line.
2. **Its documented weakness is our documented weakness.** The standard critique of
   Delphi is that the facilitator's framing drives the convergence it then reports as
   agreement. That is exactly the flaw Part 5 records: the converged frame came from
   the briefing, not the artifact. Choosing a name whose known failure mode matches our
   own keeps the limitation visible instead of letting the pack's name flatter it.
3. **It leaves room for what the method still needs.** Delphi is properly iterative —
   multiple rounds with controlled feedback. The accidental second round here (Part 4)
   showed why feedback has to be controlled rather than dumped in. A future
   deliberate round has a name already.

**Rejected, with why-not.**

| Candidate | Why not |
| --- | --- |
| `council` | Strongest of the first set and the runner-up. A council is convened, holds differing views and advises rather than decides — apt. Rejected because it describes the *seating arrangement*, not the method, and it flatters: a council implies deliberation actually occurred between members, when these agents are deliberately blind to each other |
| `parallax` | The most precise metaphor available — depth recovered from separated viewpoints, with the shift itself as the measurement. Rejected because it asserts the perspectives are instrumentation that yields real depth, which is the claim Part 9 says is still unfalsified. The name would be making a promise the evidence has not earned |
| `quorum` | Fits the fan-out, but implies voting — and counting votes is the precise misreading of convergence that Part 5 had to withdraw. A name that encodes the error is a bad name |
| `vantage` | Plain, short, claims nothing it cannot support. Rejected only for being weaker than `delphi` on recognition; it would have been the safe choice if no established technique matched |
| `prism`, `panel`, `roundtable` | `prism` points at optics rather than people; `panel` collides with a UI meaning in a pack that also ships design skills; `roundtable` is the most costly to type on every invocation and implies equals arguing, which blind agents are not doing |

**Influences.** The Delphi method itself (`model_knowledge` — no source was consulted
at the time of choosing, and the correspondence to its literature is asserted from
priors rather than checked against a citation). The pack's existing prefixes — `cue:`,
`superpowers:`, `codex:`, `feature-dev:` — establish that a capability name is
acceptable and an org name is not required.

**Reversibility: moderate.** A prefix is cheap to change before publication and
expensive after, since it appears in every user's install and every invocation.
Decided before any skill was written, which is when it is cheap.

---

## Part 1 — The problem

Persona agents hallucinate by default. Asked to "imagine how you'd use this", a model
emits the median answer about that job title: enthusiastic, generic, untethered.

Four mechanisms: no grounding; no cost to being wrong; the helpfulness pull; invented
context.

## Part 2 — Six devices, and what they actually constrain

| Device | How it works |
| --- | --- |
| **Verified-facts briefing** | One file of confirmed facts about the real environment. **The only component with demonstrated value.** |
| **Grounding labels** | `observed` / `inferred` / `constructed` per scenario |
| **Mandatory anti-scenario** | Every persona names a case where the thing is useless or harmful |
| **Falsifiable specificity** | A scenario must name an artifact and a failure |
| **Traced, costed asks** | Every request traces to a scenario and states its cost |
| **Banned register** | No enthusiasm vocabulary, statistics, or fictional company names |

**[CORRECTED] The devices constrain form, not truth.** The original said "all six
held", which conflated a mechanically checkable claim (no fictional company names)
with an unfalsifiable one (labels used honestly, self-reported and never verified).

The consequence is Part 6's greenfield failure: with no facts to brief from, five of
six devices pass cleanly **on invention**. Output is indistinguishable from a grounded
run — labels, anti-scenarios, cited sections, disciplined register — and the structure
is what makes fabrication persuasive.

**[CORRECTED] The anti-scenario is not a persona device.** The original called it "the
single strongest device" and asked (Q6) whether it generalised. It does, and it is
already this pack's house idiom: `blast-area` states what the map could not see,
`investigate-codebase` states what it did not search, `new-ux-discovery` keeps DROPPED
entries with reasons. It belongs in the pack style guide, not in a new skill.

It also has a **confabulation floor**: being mandatory, an agent with nothing real to
say writes one anyway — fluent, specific, unfalsifiable — and a reading rule that
treats clustering as signal cannot distinguish it.

## Part 3 — Dials

> **Modifiers govern where an agent looks, never what it treats as true.**

| Dial | Range |
| --- | --- |
| Divergence | 1 conventional → 5 out-of-the-box |
| Rigour | 1 practitioner → 5 academic |
| Charity | 1 adversarial → 5 generous |
| Horizon | immediate / seasonal / multi-year |
| Disposition | burned / neutral / invested |

**[CORRECTED] The dials are unvalidated, and ship as advisory vocabulary, not as a
mechanism.** The original stated: *"dials shift what gets proposed; persona and
grounding determine what gets attacked."* That claim fails on its own evidence:

- The control **held persona constant** and varied dials. A control cannot license a
  claim about a variable it never varied — so it credits persona with nothing.
- Its furthest-reaching agent varied **four dials at once**, so no dial is attributable.
- n = 3, one persona, one artifact.
- Reported by an agent executing the instruction: *"Two of five dials had no effect on
  this output. I cannot tell you whether the other three did."*

**Dials have semantics and no operations.** Nothing says what to *do* on receipt. A
per-dial behavioural commitment is required before any of this is a mechanism —
at Divergence 2, name the obvious case and stop; at 5, produce one candidate outside
the artifact's own frame and mark it.

**Divergence fights falsifiable specificity.** The genuine edges of the search space
are the cases with no artifact to name, so high divergence steers toward material that
must be labelled `constructed` and is then discounted. The stable strategy is
mid-divergence content with divergent adjectives — which is a mechanism for dials
moving register rather than search.

## Part 4 — Assignment discipline

- Do not cross-product. Assign one `(setting, dial-profile)` pair per agent.
- Do not confound. **Note the original grid violated this** — persona and dial-profile
  were assigned together at one agent per cell.
- Exclude incoherent combinations (untested).
- Build in a control, and make sure it varies the thing you want to claim.
- Duplicates are not free samples.
- **Keep agents blind to each other — including to prior rounds.**
- Stage the first batch.

### [CORRECTED] The briefing must be split

The second run's briefing contained the first run's findings, violating the blinding
rule above and rendering any cross-run convergence uninterpretable. The orchestrator
did this while trying to be transparent about limits.

A briefing has two parts and only one may be shared:

- **Environment facts** — verified, about the world. Shareable.
- **Findings so far** — prior conclusions. **Withheld.**

Briefing facts must be anchored (`path:line`, or a verbatim query and its result), and
carry a freshness date. An unanchored briefing cannot be re-verified later, and stale
`observed` labels are indistinguishable from fresh ones.

## Part 5 — Reading a fan-out

**[CORRECTED] Convergence is not independent corroboration when agents share a
briefing.** The original read 12-of-24 agreement as "the strongest available evidence."
Verified afterwards: the spec those agents reviewed contained **zero** occurrences of
`node`, `interpreter`, `toolchain` or `premise`. The converged frame entered through
the briefing — the one input all 24 shared. Blinding removes cross-talk, not a shared
prior. **Convergence measured briefing salience.**

The finding itself was true and independently verified against source. That is the
distinction to hold: *the finding survived; the evidential weight of its convergence
did not.*

**[CORRECTED] The singleton heuristic is withdrawn.** The original read a
single-persona request as "usually a rendering or presentation issue." The same run's
sharpest secondary finding came from exactly one persona and was recorded as novel.
The heuristic would have discarded it.

What remains defensible:

| Pattern | Reading |
| --- | --- |
| A **checkable structural claim** | Verify it directly. This is where the run's value actually was |
| A persona reporting **"this adds nothing for me"** | A scope signal — and the one result shape a briefing alone cannot produce |
| **Convergence** | Weak. Check whether the converged frame was in the briefing before crediting it |
| **Singletons** | Read them. No discount |

**Verify before relaying.** A run produces *leads*. Every structural claim from the
first run was checked against source; none was wrong and two were sharper than stated.
That verification — not the fan-out — is what made the output trustworthy.

## Part 6 — The skills

**[CORRECTED] Two skills, not four.**

### `delphi:ground` — the briefing primitive

The only component with evidence behind it, and the one the reviews repeatedly said
should stand alone. Produces a verified-facts briefing: gathers claims, anchors each to
a checkable reference, dates them, and **splits environment facts from findings**.

Useful to any fan-out, persona or not — which is the argument for extracting it.

**Must refuse.** When too few facts can be verified, `ground` reports that the briefing
is thin and declines to certify it. Without that gate the greenfield failure below is
undetectable.

### `delphi:imagine` — the review contract

Given an artifact and a perspective: moments → what's needed → anti-scenario → costed
gaps, with grounding labels.

**Requires a boundary section**, per the pack's house pattern. It is not
`new-ux-discovery`, which already names personas, gates candidates and emits costed
evidence-backed gaps for UX. It is not `investigate-codebase`, which already owns blind
children, disjoint axes and per-child result contracts — Part 4 here is a second copy
of that doctrine and must defer to it rather than restate it.

### Cut

- **`feedback`** — no agent in the self-review could construct a situation it wins that
  `imagine` does not. It also collides with `code-review`, `simplify` and the
  `superpowers` review skills already installed.
- **`debate`** — untested, and unmotivated until `imagine` is validated on a second
  artifact type.
- **`impersonate` as a separate skill** — persona selection is a paragraph in
  `imagine`, not a skill. There is no evidence it carries independent weight.

### Required for either to ship

- **A no-briefing path.** State what happens with no briefing, and what the skill
  refuses to claim. First run is the only run most installs get.
- **An n=1 contract.** One perspective, one artifact, one turn — with its cost. The
  only published figure is ~1.4M tokens, which is the documented price of entry.
- **A spend gate.** Announce the band before dispatching, as `investigate-codebase`
  already does.
- **Output carries its own limits** — what could not be checked, in the artifact the
  reader reads.
- **Body budget is 484 lines** (`scripts/verify-skills.mjs`), not ~500, with detail in
  `references/`.

## Part 7 — Costs

- 24 agents ≈ 1.4M subagent tokens; 12 agents ≈ 0.6M.
- **Orchestrator synthesis and verification is the real constraint**, and verification
  is unbounded.
- **Briefing authorship is orchestrator work and appears in no budget** — while being
  the one component with demonstrated value. The step most likely to be shortcut is
  the load-bearing one.
- **[CORRECTED]** The original claimed a smaller run "trades convergence, not quality".
  No run below 24 had been made when that was written. The 12-agent self-review
  produced sharper findings than the 24-agent run, on a smaller artifact. One data
  point each way; the claim is withdrawn rather than reversed.

## Part 8 — The greenfield failure

Raised independently by personas with opposed stakes, and the most serious limit here.

On an artifact with no incident history — a new product area, a first draft, a
first-of-its-kind integration — there are no verified facts to brief from. The briefing
is empty, and the other five devices constrain form only. The run returns disciplined,
labelled, anti-scenario'd output that is entirely constructed, at full cost, and
**reads as audit**.

This is the first run's own strongest finding turned on the method: a flattering
narrative with citations, more expensive to dislodge than no review, because it looks
verified. `delphi:ground`'s refusal is the only defence, and it must be a gate rather
than a warning.

## Part 9 — The missing arms

None of these ran. Until they do, the family is **unfalsified, not validated**.

1. **No-persona arm** — briefing, devices and contract, no job titles. Settles whether
   the personas contribute anything the briefing does not. Cheapest and most important.
2. **Seed-removal arm** — the briefing with the converged incident removed. Settles
   whether convergence was discovery or retrieval.
3. **Direct-review baseline** — one careful read of the same artifact. Gates the claim
   that this finds what a direct review misses. No cost figure for the alternative was
   ever taken.
4. **Per-dial arms** — one dial varied at a time.
5. **A second artifact type** — everything so far is design documents.
6. **Cross-model** — the pack ships to Codex and Cursor; portability is untested.

Also unreported from the first run: **what the twelve non-converging agents said.**
Only the convergence was counted.

## Part 10 — Open questions

1. Does `imagine` survive the no-persona arm, or does `ground` absorb it?
2. What is the per-dial behavioural commitment, or do the dials get cut too?
3. What is the trigger threshold — the cost-of-being-wrong above which a run is worth
   it? Without one, the method becomes a ritual.
4. Is there a stop condition when a run's findings are thin?
5. Can `ground` verify a fact automatically, or is anchoring always manual?
6. Does the reproducibility problem matter — briefings and agent reports are currently
   write-once and uncommitted, so no run can be replayed.
