# Anchors: what a claim can point at

An anchor is a pointer from something you wrote to something a reader can check. It is
what separates a decision record from a story about a decision.

## Anchoring is one-directional

This is the most important idea in the skill, and the easiest to get wrong.

An anchor establishes that a decision **was taken**, when, and what it touched. It
establishes **nothing** about whether the premise the decision rested on was true.

The canonical failure looks like this. A session runs against the wrong interpreter on
`PATH`. Tests fail for environmental reasons. An agent investigates them as a genuine
regression and writes an entry that is *perfectly* formed — real tool-call anchors, a
real failing suite, a populated rejection list, an honest note that no source was
consulted, high stated confidence. Every rule in this document is satisfied. The
conclusion is worthless.

That entry is worse than no entry, for three reasons:

1. **It is citable.** A structured, evidence-linked wrong answer costs more to dislodge
   than no answer at all.
2. **It propagates.** Later sessions read the workspace's entries as context, so one
   session's confident error becomes cited precedent for the next five.
3. **It reads as verified.** For a reader who cannot check the code, an anchored claim
   is a flattering narrative *with citations*.

The defence is not better anchoring. It is:

- capturing the **environment** as an anchor class, so the premise itself is checkable;
- re-checking premises separately from re-checking sources;
- and marking an entry **invalidated** rather than merely superseded when its premise
  turns out to be false, so everything resting on it is suppressed too.

## Anchor classes, and what each proves

| Class | Proves | Does not prove |
| --- | --- | --- |
| `commit` | This change entered history at this point | That the change was correct |
| `file` | This path had this content | That the content was read correctly |
| `environment` | The toolchain that actually ran — resolved interpreter, versions, flags | That the toolchain was the intended one |
| `runtime` | A deployed config or flag value | That the value was reviewed |
| `tool_use` | This command ran and returned this | That its output was interpreted correctly |
| `message` | This was said, here | That it was true |
| `url` / `external` | This source existed and said this at the time | That it still does |
| `visual` | A design file at a version, a node, a screenshot | That the rendered result matched intent |

Two rows do the heavy lifting in practice. **`tool_use` and `message` are universal** —
they exist in every context, including one with no repository at all. So a journal
outside version control still works; it proves something weaker, *the agent read X and
then chose Y* rather than *the code changed this way*, and that weaker claim must be
rendered in a weaker voice rather than dressed up.

**`environment` is the one people forget.** It is also the one that would have caught
the failure above.

## Anchors versus influences

These are different axes and must not be merged.

- **Anchors** prove the entry is honest. System-produced, verifiable: this commit
  exists, this tool call is in the log. They point at *the record of the decision*.
- **Influences** explain how it was reached. Agent-asserted, often unverifiable, prone
  to rot. They point at *the inputs*.

Collapse them and an entry can claim anchored status while resting only on a
half-remembered URL — which destroys the one property the whole design provides.

An influence carries a role, and the role matters as much as the identity:

- `decisive` — this is why
- `supporting` — this agreed
- `considered` — this was read and weighed
- `contradicted` — **this was read and chosen against**

That last one pairs with the rejection list and is otherwise unrecoverable. "I read the
benchmark and decided against what it recommended" is a fact nobody can reconstruct from
the code.

## Influences are selected, not recalled

The journal already recorded every fetch, search, read and query. So the candidate set
for a decision is derivable: it is the work between the previous entry and this one.

You are **selecting and ranking from that window**, not retyping URLs from memory. An
influence chosen this way carries a tool-call anchor for free, which is how an asserted
influence becomes a verifiable one.

The limit is worth stating: this works only where the tooling saw the inputs. For design
work and conversation-driven decisions the window is often empty — a call, a recording,
frames never exported — and the field reverts to a memory exercise. Say so when it does.

## Rot, and the check that is not rot

Two decay checks, and conflating them hides the dangerous one.

**Rot** — did a source move or die? A URL 404s, a ticket closed, a referenced entry was
superseded, a symbol no longer exists. Reported, never auto-resolved: a decision does not
become wrong because a link broke.

**Premise** — was the reasoning ever sound? Distinct, and the one that matters. Where an
entry declares what must be true for it to hold, and an environment anchor exists, a
re-check can ask whether that premise still reproduces.

**Only half of that ships.** `agent-journal decay` compares the environment an entry was
anchored to against the environment now; nothing reads `premise[]` at all. A `finding`
whose premises are plainly false today, on an unchanged interpreter, reports clean. The
design intent above is the spec's; what runs is narrower, and
[references/decay.md](decay.md) says exactly where the line falls.

A source may be marked as *living* — a design file changes on every save, and flagging it
daily trains people to ignore rot flags entirely. **This is also design intent, not
shipped behaviour**: `living` suppresses content-hash rot, and no hash-based check exists
yet, so the marker would have nothing to suppress.

## What good anchoring looks like

- Every factual claim points at something, or is explicitly marked as pointing at
  nothing.
- The entry names what must be true for it to hold, so a later reader can test that
  rather than take it on trust.
- Where the context cannot produce strong anchors, the entry says which classes were
  unavailable rather than implying they were checked and clean.
