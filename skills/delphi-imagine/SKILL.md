---
name: delphi-imagine
description: "Review an artefact from a named perspective without inventing the world it lives in: grounded scenarios, a mandatory case where the thing is useless, and every request traced to a moment and costed. Use when you want a critique that can be checked rather than one that reads well."
license: MIT
compatibility: "Any artefact the agent can read, plus a verified-facts briefing from delphi-ground. Without one the skill runs in constructed mode and labels every scenario as such — honest, but much less useful. Fan-out across several perspectives needs a harness that dispatches subagents and withholds context; without one it runs as sequential passes and says so. Output is a fixed contract — moments, needs, an anti-scenario, costed gaps — so several runs collate without reshaping. Nothing is committed."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Write Grep Glob Bash
---

# Review from a perspective, without inventing the world

Ask an agent how a designer would feel about your spec and it will tell you — fluently,
at length, about a designer who does not exist, at a company that does not exist, with
problems nobody has. The output is confident, well-organised, and worth nothing.

The failure is not the persona. It is that nothing constrains the persona to reality, and
nothing costs it anything to be wrong.

This skill supplies both constraints. A perspective is an instrument for noticing what a
direct read misses — not a voice to perform.

Composition: **`delphi-ground`** produces the verified-facts briefing this skill consumes,
and its *insufficient* verdict is what triggers the refusal rule below.

## Quickstart

With a briefing in hand:

```text
Use delphi-imagine on docs/specs/retention.md as a compliance reviewer, grounded in
the briefing at .work/briefing.md. I want to know where this fails an audit.
```

You get back a fixed shape:

```markdown
## Moments
Three concrete situations, each naming an artefact and a failure.
Each labelled: observed | inferred | constructed

## What it would need
Per moment: what would have to be true, and whether the artefact provides it.
Cite the section, or say plainly that it does not.

## Anti-scenario
REQUIRED. One case where this is useless or harmful to me. Not a caveat.

## Gaps
Each traced to a moment above, each with its cost.
```

The **anti-scenario is the load-bearing part.** It is what stops a review being a list of
things the author wanted to hear.

## When to Use

- An artefact is about to be built, published, or relied on, and you want to know where
  it fails for someone other than its author.
- You have a design that looks right to you and want a reader who does not share your
  assumptions.
- You want several perspectives collated, and need their output to be comparable rather
  than four essays in four shapes.
- You suspect a review you already have was agreeable rather than useful.

Do not use it to validate a decision already made — it will oblige, and that is the
failure mode. Do not use it in place of asking an actual user; a simulated compliance
reviewer is a way to find obvious problems early, not a substitute for the real one. And
do not use it on an artefact with no verifiable context behind it: see the refusal rule
below.

## Prerequisites

1. **A named artefact.** One spec, one change, one proposal.
   **Complete when:** you can point at it.
2. **A briefing** from `delphi-ground`, or an explicit decision to run without one.
   **Complete when:** you have the briefing, or you have accepted that every scenario
   will be labelled `constructed` and worth correspondingly less.
3. **A perspective that could disagree with the others.** The test is not "is this a real
   job title" but "would this reader notice something the last one would not".
   **Complete when:** you can say what this perspective is positioned to see.

**Refusal rule.** If the briefing comes back *insufficient*, stop. A review with a fixed
evidence contract and nothing to ground it produces disciplined fiction — labels,
citations, a plausible anti-scenario — at full cost, and the discipline is what makes it
persuasive. Say the grounding is absent and recommend a direct read instead.

## Procedure

### 1. Take the perspective, and its stakes

A perspective is more than a title. What makes it produce different output is what it is
*positioned to notice* and what it *stands to lose*.

A compliance reviewer notices retention and deletion because they will be asked to attest
to them. A support engineer notices what a customer will quote at them. Someone who was
recently burned by a missing record notices the absence of one everywhere.

**Complete when:** you can state what this reader is exposed to, not just what they do.

### 2. Find three moments, and ground each

A moment names **a specific artefact and a specific failure**. "Improving team velocity"
is not a moment. "The Tuesday migration rollback, where nobody could say which config had
been reviewed" is.

Label each one honestly:

| Label | Means |
| --- | --- |
| `observed` | Grounded in the briefing or in the artefact |
| `inferred` | A reasonable extension of something in them |
| `constructed` | You made it up — say so plainly |

`constructed` is a legitimate label, not an admission of failure. What is not legitimate
is dressing a constructed moment as observed, which is the single most common way these
reviews go wrong.

**Complete when:** three moments, each with an artefact, a failure, and a label.

### 3. Say what the artefact would need, and whether it has it

Per moment: what would have to be true for this to go well, and whether the artefact
provides it. **Cite the section, or state plainly that it does not.**

Vagueness here is where a review stops being checkable. "It should handle this better" is
not a finding; "§6.3 ages out the evidence while §5.1 claims the citations are permanent"
is.

**Complete when:** every need either points at a section or says there is none.

### 4. Write the anti-scenario

**Required, not optional.** One case where this artefact is useless to you, or actively
harmful.

This single requirement does more than everything else in the contract combined. It
breaks the helpfulness pull that produces agreeable reviews, and in practice it is where
the most valuable findings appear — because it forces you past "here is what I would
want" into "here is where this hurts me".

It must be a real case, not a caveat. "It might be slow at scale" is a caveat.
"Under a formal review, this record is a machine-readable admission that we shipped on
priors, and I would rather have kept nothing" is an anti-scenario.

**Complete when:** you have named a case where you would not use it, or would regret
having used it.

### 5. Trace and cost every gap

Every request traces to a moment above. A gap that traces to nothing is a wishlist item,
and wishlist items are how a review becomes a design document nobody asked for.

State the cost: tokens, complexity, privacy, adoption, maintenance. A gap without a cost
is a preference wearing a finding's clothes.

**Complete when:** each gap names its moment and its cost.

### 6. Keep the register flat

No enthusiasm vocabulary. No invented statistics or percentages. No fictional company
names — say "my team", "the client". No melodrama either: an adversarial perspective
states its objection plainly rather than performing outrage.

The fixed contract is what keeps a strongly-dialled perspective from becoming a
caricature. It still owes three grounded moments and cited sections, and that discipline
holds the voice in place.

**Complete when:** the output would read as a colleague's memo, not a character study.

## Usage Examples

**A single grounded perspective:**

```text
Use delphi-imagine on docs/specs/journal.md as a support engineer who gets the
escalation when this misbehaves. Ground it in .work/briefing.md. I want the moment
where a customer quotes something at me and I cannot answer.
```

**A perspective chosen to disagree:**

```text
Use delphi-imagine on the same spec as someone who thinks this whole approach is
surveillance infrastructure. Be genuinely hard to please, but honest — not
contrarian for its own sake. The anti-scenario is the part I care about.
```

**Checking a review you already have:**

```text
Use delphi-imagine on this artefact as a maintainer inheriting it. Then tell me
which of the findings in review.md a maintainer would actually care about, and
which are the reviewer's preferences.
```

## Pitfalls

- **Performing the persona.** Voice is a side effect. A review that is enjoyable to read
  and cites nothing has failed.
- **Skipping the anti-scenario because nothing came to mind.** If nothing comes to mind,
  you have not taken the perspective seriously — every real reader has a case where a
  tool is wrong for them.
- **A manufactured anti-scenario.** Because it is mandatory, an agent with nothing to say
  will write a fluent, unfalsifiable one. That is a floor of noise the contract cannot
  distinguish from signal, and it is the strongest argument for grounding.
- **Labelling constructed moments as observed.** Quietly fatal. It converts the labels
  from information into decoration and makes the whole output uncheckable.
- **Reading agreement between perspectives as corroboration.** If they shared a briefing,
  they shared a prior. Check whether the agreed frame appears in the briefing before
  crediting it.
- **Discounting a finding because only one perspective raised it.** Singletons are often
  the sharpest findings — the one reader positioned to see it was the only one who could.
  Read them; do not weight by count.

## Verification

- **Every moment carries a label, and the labels are honest.** Spot-check one `observed`
  moment against the briefing. If it is not there, the labels are decoration.
- **The anti-scenario is a case, not a caveat.** Ask: does it describe a situation where
  this thing is the wrong choice? If it hedges, it is not one.
- **Every gap traces to a moment and states a cost.** Untraced gaps are wishlist.
- **No fabricated specifics.** No percentages, no company names, no invented incidents
  presented as real.
- **Where several perspectives ran, they are comparable.** Same sections, same labels.
  If one reshaped the contract, its output cannot be collated with the rest.

## Deeper reading

- [references/output-contract.md](references/output-contract.md) — the exact sections,
  the labels, and what makes a moment or an anti-scenario acceptable.
- [references/choosing-perspectives.md](references/choosing-perspectives.md) — picking a
  set that disagrees, the dials, and why a fan-out that varies nothing costs the same as
  one that varies something.
