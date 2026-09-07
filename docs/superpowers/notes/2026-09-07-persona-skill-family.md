# Persona skill family — design note

- **Date:** 2026-09-07
- **Status:** Note only. Not scheduled, not scoped, no spec.
- **Origin:** captured while running a 24-agent persona review of the
  [agent decision journal spec](../specs/2026-09-07-agent-decision-journal-design.md).

A possible family of composable skills: **`impersonate`** supplying a perspective,
with **`imagine`**, **`debate`** and **`feedback`** as the things done from it. This
note records the method that was actually exercised, so the design starts from
evidence rather than from scratch.

## The problem the family has to solve

Persona agents hallucinate by default. Asked to "imagine how you'd use this", a
model emits the median answer about that job title: enthusiastic, generic and
untethered. It reads as insight and contains none.

Four mechanisms produce this:

1. No grounding — nothing anchors the persona to a real environment.
2. No cost to being wrong — nothing checks the output.
3. The helpfulness pull — enthusiasm is rewarded, doubt is not.
4. Invented context — company size, team shape, workflow, all fabricated to suit
   whatever conclusion is being reached.

## Six devices that counter it

Used together in this run. Each targets a specific mechanism above.

| Device | Counters |
| --- | --- |
| **Verified-facts briefing.** One shared file of confirmed facts about the real environment, written by the orchestrator. Personas cite from it rather than inventing. | 1, 4 |
| **Grounding labels.** Every scenario tagged `observed` / `inferred` / `constructed`. Borrowed directly from the journal spec's own `model_knowledge` discipline (§5.4) and turned on the exercise. | 2, 4 |
| **Mandatory anti-scenario.** Every persona must name a case where the thing is useless or harmful to them. Required, not optional. The single strongest device. | 3 |
| **Falsifiable specificity.** A scenario must name an artifact and a failure. "The Tuesday migration rollback" passes; "improving team velocity" is rejected. | 2, 4 |
| **Traced, costed feature asks.** Every request must trace to a scenario above and state its cost. No free-floating wishlists. | 2, 3 |
| **Banned register.** No enthusiasm vocabulary, no invented statistics, no fictional company names. | 3 |

## Modifier dials

Proposed vocabulary for `impersonate`. The governing rule:

> **Modifiers govern where an agent looks, never what it treats as true.**

Divergence is the dial that would otherwise license fiction. Aiming it at the
*search space* rather than at the *evidence rules* is what makes the set safe.

| Dial | Range | Changes |
| --- | --- | --- |
| **Divergence** | 1 conventional → 5 out-of-the-box | how far from the obvious case they hunt |
| **Rigour** | 1 practitioner → 5 academic | lived friction vs. principle and taxonomy |
| **Charity** | 1 adversarial → 5 generous | whether premises are granted or attacked |
| **Horizon** | immediate / seasonal / multi-year | today's friction vs. the long-lived artifact |
| **Disposition** | burned / neutral / invested | *what feels salient* — the "mood" dial, as mechanism not decoration |

The six devices above are **fixed** and no dial may relax them. Without that,
`Divergence 5` degenerates into "make things up".

The fixed output contract also prevents caricature. A `Divergence 5 / Charity 1`
persona could easily become a cartoon contrarian, but it still owes three specific
moments with cited sections, and that structure disciplines the voice.

## Assignment discipline

Learned while designing this run; applies to any fan-out.

- **Do not cross-product.** Personas × settings × dials explodes. Assign one
  `(setting, dial-profile)` pair per agent and spread them Latin-square style.
- **Do not confound.** If every sceptic gets low charity, persona and dial are
  indistinguishable in the results. Spread each dial level across many personas.
- **Exclude incoherent combinations.** A compliance auditor at Charity 5, or a
  marketer at Charity 1, produces noise rather than signal. Some dial/persona
  pairs are simply invalid, and the skill should say so rather than obey.
- **Build in a control.** Hold setting constant for one persona and vary only the
  dials. If those agents return near-identical output, the dials do nothing — and
  that is worth learning from one run rather than after shipping a skill.
- **Duplicates are not free samples.** Three identical agents give three draws
  from one distribution. Differentiate, or run one.

## Reading a fan-out

Not by counting votes. Signal lives in *who agrees*:

- Agreement between parties with **opposed interests** (an auditor and a sceptical
  IC) is strong evidence.
- A request from a single persona is usually a rendering or presentation issue,
  not a design issue.
- **Anti-scenarios matter most.** Where they cluster is where the design is weak.

## Open questions

1. Do the dials measurably change output, or is persona alone doing the work?
   The control in this run is the first evidence either way.
2. Where does `impersonate` end and `debate` begin — does debate re-run personas
   against each other's output, or is it a separate pass over collected results?
3. Is the verified-facts briefing part of `impersonate`, or a separate primitive?
   It is the most transferable piece and may deserve to stand alone.
4. Whether `feedback` needs its own dials or inherits the persona's.
