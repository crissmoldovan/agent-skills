# Output contract

Four sections, fixed. The shape is not decoration: several perspectives collate only if
they produce the same structure, and a review that reshapes it cannot be compared with
the others.

```markdown
## Moments

**1. <what happened>.** `observed`
Names a specific artefact and a specific failure or friction.

**2. ...** `inferred`
**3. ...** `constructed`

## What it would need

Per moment: what would have to be true, and whether the artefact provides it.
Cite the section, or state plainly that it does not.

## Anti-scenario

REQUIRED. One case where this is useless, or actively harmful, to me.
Not a caveat — a real case.

## Gaps

Each traced to a moment above, each stating its cost
(tokens / complexity / privacy / adoption / maintenance).
```

## Moments

A moment needs three things:

1. **A named artefact** — a file, a ticket, a command, a conversation, an incident.
2. **A specific failure or friction** — what went wrong, or what was hard.
3. **A grounding label.**

| Label | Means | Test |
| --- | --- | --- |
| `observed` | Grounded in the briefing or the artefact | Could you point at the line? |
| `inferred` | A reasonable extension of something in them | Can you name what you extended? |
| `constructed` | You made it up | Say so plainly |

**Rejected as moments:** "improving team velocity", "better developer experience",
"reducing friction". These name no artefact and no failure, so nothing about them can be
checked or acted on.

**Accepted:** "the Tuesday migration rollback, where nobody could say which config had
been reviewed" — an event, an artefact, a specific gap.

`constructed` is legitimate. Labelling a constructed moment as `observed` is not, and it
is the failure that makes an entire review uncheckable: once one label is decorative, a
reader cannot trust any of them.

## What it would need

The point is to make the finding **checkable**. Two forms:

- **Provided** — cite the section. `§5.2 covers this via the role field.`
- **Not provided** — say so plainly. `Nothing in the spec addresses this.`

A third form is acceptable and useful: **cannot verify from here** — a requirement that
lives in code the review did not see, or spans documents. Say what a reader should check
rather than broadening the search.

Vagueness here is where a review stops being useful. "It should handle this better" gives
nobody anything to do.

## Anti-scenario

The single highest-yield element, and the most likely to be skipped or faked.

**A caveat is not an anti-scenario.** "It might be slow at scale" hedges a positive
review. An anti-scenario names a situation where you would not use the thing, or would
regret having used it.

Good ones tend to have one of these shapes:

- **The artefact works and that is the problem.** "The record is exactly what it promises,
  and under a formal review it is a machine-readable admission we shipped on priors."
- **It is right and useless.** "By the time I could consult it I have already answered the
  customer."
- **It creates an obligation.** "Adopting this means claiming a control I cannot evidence."
- **It is worse than nothing.** "A well-formed wrong answer costs more to dislodge than no
  answer."

**The confabulation floor.** Because it is mandatory, an agent with nothing genuine to say
will write a fluent, specific, unfalsifiable one — and nothing in the contract can
distinguish that from a real one. This is the strongest argument for grounding: a
briefing gives the anti-scenario something to be about.

## Gaps

Each gap:

- **Traces to a moment above.** Untraceable gaps are wishlist items — the review has
  drifted into designing rather than reviewing.
- **States a cost.** Tokens, complexity, privacy, adoption, maintenance. A gap with no
  cost is a preference in a finding's clothes, and it is the reviewer asking someone else
  to pay for their taste.

## Register

Fixed regardless of how adversarial the perspective is:

- No enthusiasm vocabulary — no "game-changer", "seamless", "powerful".
- No invented statistics or percentages.
- No fictional company names. Say "my team", "the client".
- No melodrama. State the objection plainly.

The contract is what keeps a sharply-dialled perspective from becoming a caricature. A
maximally adversarial reader still owes three grounded moments with cited sections, and
that requirement holds the voice in place.

## Length

Around 600 words. The cap is load-bearing: it forces selection, and selection is where
judgement shows. An unbounded review lists everything and prioritises nothing.
