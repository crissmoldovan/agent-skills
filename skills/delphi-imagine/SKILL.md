---
name: delphi-imagine
description: "Critique a plan, spec, design or document from one or more named perspectives — a compliance reviewer, an SRE, a first-time user — after first building the verified-facts briefing the critique stands on, and refusing to review at all when too little can be checked. Phase one anchors every fact to a reference and rates what it supports; phase two returns three concrete moments each labelled observed, inferred or constructed, a mandatory case where the thing is useless, and every gap traced to a moment and costed. Symptoms: review this as a security person, what would a CTO say, poke holes in this plan, get me a second opinion, red-team this design, fan this out across several reviewers, the last review was agreeable rather than useful."
license: MIT
compatibility: "Any artefact the agent can read, plus whatever makes a claim checkable — the repository, its history, a tracker, logs. Briefing strength tracks what the environment exposes: rich in an established codebase, thin on a greenfield proposal, and thin is a supported outcome, stated rather than padded. Fan-out across perspectives needs a harness that dispatches subagents and withholds context; without one it runs as sequential passes and says so. Output is a fixed contract that collates."
metadata: "group=workflow; lifecycle=release; version=2.0.0; author=crissmoldovan"
allowed-tools: Read Write Grep Glob Bash
---

# Review from a perspective, without inventing the world

Ask an agent how a designer would feel about your spec and it will tell you — fluently,
at length, about a designer who does not exist, at a company that does not exist, with
problems nobody has. The output is confident, well-organised, and worth nothing.

The failure is not the persona. It is that nothing constrains the persona to reality, and
nothing costs it anything to be wrong.

This skill supplies both constraints, in two phases that are one job. **Phase one builds a
briefing of facts somebody checked**, so the reasoning has something to be wrong about, and
**refuses to certify one when too little can be verified**. **Phase two takes the
perspective** and returns a fixed evidence contract. A perspective is an instrument for
noticing what a direct read misses — not a voice to perform.

Phase one is not optional preparation you may skip when you are in a hurry. A review with a
fixed evidence contract and nothing under it produces disciplined fiction — labels,
citations, a plausible anti-scenario — at full cost, and the discipline is exactly what
makes it persuasive.

## Quickstart

```text
Use delphi-imagine on docs/specs/retention.md as a compliance reviewer. Ground it
first — I want it arguing with this system rather than inventing a company — and I
want to know where this fails an audit.
```

Phase one returns a briefing whose every fact carries a reference, split into two parts
that must not be mixed:

```markdown
## Environment facts          ← shareable with every reviewer
- The retry queue is in-process and bounded at 256   `src/queue.ts:14`
- Node 22 is the floor; CI pins it                   `.github/workflows/ci.yml:31`
- Two prior incidents involved the same code path    `docs/incidents/2026-06.md`

## Findings so far            ← WITHHELD from independent reviewers
- The last review concluded the bound is too low
```

and a coverage line that is the whole point:

```text
Coverage: 14 facts, 14 with references. 3 claims dropped as unverifiable.
Briefing strength: adequate.
```

Phase two returns a fixed shape:

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
- You suspect a review you already have was agreeable rather than useful — or you want to
  know whether the inputs behind someone else's confident findings were real.
- You are about to fan out several agents over one artefact and want them arguing with the
  same checked facts rather than producing twelve variations of the same invention, which
  reads like corroboration and is not.

Do not use it to validate a decision already made — it will oblige, and that is the failure
mode. Do not use it in place of asking an actual user; a simulated compliance reviewer is a
way to find obvious problems early, not a substitute for the real one. Do not use phase one
to gather requirements — it records what is true, not what is wanted — nor to summarise the
artefact: the briefing is context *around* the thing, not a précis *of* it. And do not use
any of it to make a weak case look strong: the refusal below is the point.

## Prerequisites

1. **A named artefact.** One spec, one change, one proposal, one incident. "Our
   architecture" is not one.
   **Complete when:** you can name it as a path, a URL, or an identifier.
2. **Read access to whatever would make a claim checkable** — the repository, the history,
   the tracker, the logs.
   **Complete when:** you have it, or you have recorded which sources you cannot reach.
   Absent is a normal answer and changes the strength verdict, not the procedure.
3. **A decision about who reads the briefing.** One shared with independent reviewers must
   not contain prior findings. See step 3.
   **Complete when:** you know whether this briefing goes to one reader or several.
4. **A perspective that could disagree with the others.** The test is not "is this a real
   job title" but "would this reader notice something the last one would not".
   **Complete when:** you can say what this perspective is positioned to see.

## Procedure

### Phase one — ground it

#### 1. Collect candidate facts

Sweep the artefact and its surroundings for things that are *true*, not things that are
*relevant*. Relevance is the reviewer's job.

Prefer, in this order: incidents that actually happened, behaviour visible in code,
recorded decisions, and configuration. What people believe about the system goes in only
as a belief, attributed.

**Complete when:** you have more candidates than you expect to keep.

#### 2. Anchor every one, and drop what you cannot

Each fact carries a reference a reader could follow: `path:line`, a command and its
output, a commit, a URL, a ticket.

**A fact you cannot anchor gets dropped, not softened.** "The service is probably
rate-limited" is not a weaker fact than a cited one — it is a different kind of thing,
and mixing them is how a briefing quietly becomes fiction. If it matters and you cannot
check it, list it under what could not be verified, where a reviewer can see the shape of
the hole.

**Complete when:** every retained fact has a reference, and the dropped ones are counted.

#### 3. Split environment facts from findings

Two sections, and the split is load-bearing:

- **Environment facts** — what is true about the world. Shareable with everyone.
- **Findings so far** — what previous rounds concluded. **Withheld** from anyone whose
  independence you intend to rely on.

This is not tidiness. Hand a reviewer the previous round's conclusion and they will
converge on it, and you will read that convergence as corroboration. It is the single
easiest way to manufacture false agreement, and it is easy to do by accident while trying
to be transparent about what is already known. When this skill fans out to several
perspectives, they get the shareable half and nothing else.

**Complete when:** a reader of the shareable half cannot infer what the last round
decided.

#### 4. Date it and name what you could not reach

A briefing is true as of a moment. Stamp it, and list the sources you could not consult —
a tracker without access, a log already rotated, a person unavailable.

**Complete when:** a reader six months later can tell whether it has expired, and can see
what was never checked rather than assuming it was checked and clean.

#### 5. Rate the strength, and be willing to refuse

Count what you have and say plainly what it supports:

| Strength | Means | Do this |
| --- | --- | --- |
| **Adequate** | Enough anchored facts that a reviewer can be concretely wrong | Go to phase two |
| **Thin** | Few facts, or few that bear on the artefact | Go to phase two, carrying the word |
| **Insufficient** | Nothing checkable bears on the question | **Refuse.** Say so and stop |

**The refusal is this skill's most valuable output and the one you will be most tempted to
skip.** A greenfield proposal with no incident history and no code has nothing to brief
from, and phase two over it costs the same as a grounded run while being more persuasive
than it has earned. Say the grounding is absent and recommend a direct read instead.

**Where the strength is *thin*, carry the word through.** Say `briefing strength: thin` at
the top of the review, and expect most moments to be labelled `inferred` or `constructed`.
Thin does not stop the run; silently dropping the label does, because the reader then
weighs the output as though it were grounded.

**Complete when:** the strength is stated, and if insufficient, nothing below runs.

### Phase two — take the perspective

#### 6. Take the perspective, and its stakes

A perspective is more than a title. What makes it produce different output is what it is
*positioned to notice* and what it *stands to lose*.

A compliance reviewer notices retention and deletion because they will be asked to attest
to them. A support engineer notices what a customer will quote at them. Someone who was
recently burned by a missing record notices the absence of one everywhere.

**Complete when:** you can state what this reader is exposed to, not just what they do.

#### 7. Find three moments, and ground each

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

#### 8. Say what the artefact would need, and whether it has it

Per moment: what would have to be true for this to go well, and whether the artefact
provides it. **Cite the section, or state plainly that it does not.**

Vagueness here is where a review stops being checkable. "It should handle this better" is
not a finding; "§6.3 ages out the evidence while §5.1 claims the citations are permanent"
is.

**Complete when:** every need either points at a section, says there is none, or is
marked *cannot verify from here* with the check a reader should run — the third form the
[output contract](references/output-contract.md) defines, for a requirement living in
code this review did not see.

#### 9. Write the anti-scenario

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

#### 10. Trace and cost every gap

Every request traces to a moment above. A gap that traces to nothing is a wishlist item,
and wishlist items are how a review becomes a design document nobody asked for.

State the cost: tokens, complexity, privacy, adoption, maintenance. A gap without a cost
is a preference wearing a finding's clothes.

**Complete when:** each gap names its moment and its cost.

#### 11. Keep the register flat

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
escalation when this misbehaves. I want the moment where a customer quotes something
at me and I cannot answer.
```

**A fan-out that must stay independent:**

```text
Use delphi-imagine on docs/specs/retention.md and fan it out across three perspectives
that would disagree. Build the briefing once and withhold anything the last review
concluded — I want independent reads, not agreement.
```

**A perspective chosen to disagree:**

```text
Use delphi-imagine on the same spec as someone who thinks this whole approach is
surveillance infrastructure. Be genuinely hard to please, but honest — not
contrarian for its own sake. The anti-scenario is the part I care about.
```

**Expecting a refusal, and wanting it:**

```text
Use delphi-imagine on this greenfield proposal. If there is nothing verifiable to
ground it in, say so and stop — I would rather read it myself than fund a review
that invents a company.
```

**Auditing findings you already have:**

```text
Use delphi-imagine on the artefact these findings came from. Tell me which of them
cite something checkable and which are assertions, then review it as a maintainer
inheriting it.
```

## Pitfalls

- **Padding a thin briefing.** The temptation is to add plausible context so phase two has
  something to work with. That converts an honest "insufficient" into a confident
  fabrication with your name on it.
- **Sharing findings for transparency.** It feels open. It manufactures the agreement you
  will then cite as evidence.
- **Anchoring to the artefact under review.** A spec citing itself is not a fact about the
  world; it is the claim you asked the reviewer to evaluate.
- **Treating an old briefing as current.** Facts expire. A reused briefing produces a
  reviewer reasoning confidently about a system that has moved.
- **Letting beliefs in unattributed.** "The team thinks the bound is too low" is fine,
  attributed. Stated flatly it becomes a fact nobody checked.
- **Rating strength by fact count alone.** Twenty facts about the build system do not
  ground a review of the retention policy. Strength is about what bears on the question.
- **Skipping phase one because the artefact is short.** The shorter the artefact, the more
  of the review is invention, and the less anything on the page can contradict it.
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

- **Every retained fact has a reference someone else could follow.** Spot-check three at
  random; if one does not resolve, the briefing is not ready.
- **The shareable half leaks no conclusions.** Read it as though you were the reviewer:
  can you tell what the last round decided?
- **The dropped facts are counted, not silently discarded**, and the briefing is dated. A
  briefing that mentions no gaps has either had an unusually good day or has not looked.
- **The strength verdict matches the count**, and a thin verdict is stated at the top of
  the review rather than dropped on the way into phase two. Fourteen anchored facts is not
  "thin"; two is not "adequate".
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

- [references/briefing-format.md](references/briefing-format.md) — the exact shape of the
  briefing, the two-section split, and how strength is computed.
- [references/why-briefings-fail.md](references/why-briefings-fail.md) — the evidence
  behind the withholding rule, including a measured case where a shared briefing
  produced convergence that read as independent corroboration and was not.
- [references/output-contract.md](references/output-contract.md) — the exact sections,
  the labels, and what makes a moment or an anti-scenario acceptable.
- [references/choosing-perspectives.md](references/choosing-perspectives.md) — picking a
  set that disagrees, the dials, and why a fan-out that varies nothing costs the same as
  one that varies something.
