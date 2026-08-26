# Comparison mode

**Included, off by default, precondition-gated.** Most renders answer "what does this change
reach". Comparison answers a narrower and rarer question — "what changed about what it reaches"
— and it costs two valid envelopes to ask.

## Preconditions

All of them, or comparison does not run:

1. **Two envelopes of the same change shape.** Before and after the same proposed change, or
   the map at two revisions of the same work. Two envelopes of two different changes have a
   delta, and it means nothing.
2. **The same `resolver` in both.** One map built with a compiler-resolved index and one built
   name-based will differ mostly in resolution, not in the code. The delta would be a report on
   the tooling wearing the costume of a report on the repository.
3. **The same twelve surface ids.** They are fixed, so this holds unless one envelope is
   malformed — check anyway, because a missing surface reads as "everything here was removed".
4. **Both revisions recorded**, base and head, with dirty state. A delta against uncommitted
   work describes a tree nobody else has.
5. **It was asked for.** Do not turn it on because two envelopes happen to be available.

If a precondition fails, say which one and render the single map instead. A comparison drawn on
a broken precondition is worse than no comparison, because it produces specific, wrong numbers.

## The delta is a classification, not a second graph

Two graphs side by side get compared by eye, and by eye is exactly where a rewired edge hides —
same two boxes, same arrow, different meaning. So the output is a table, per surface, in the
fixed surface order:

- **Added** — nodes and edges present in the second envelope and not the first.
- **Removed** — present in the first and not the second.
- **Rewired** — the same endpoints in both, with a different `kind`, a different `confidence`,
  or different `evidence`. This is the class that only a classification catches.

Plus two rows that are about the map rather than the code, and are kept separate so they cannot
be mistaken for findings:

- **Coverage moved** — a surface whose `confidence` changed, in either direction. A surface
  going from `not checked` to `measured` is not a change in the codebase; it is a change in what
  was looked at, and conflating the two invents findings that do not exist.
- **Blind spots opened or closed** — entries added to or removed from `blindspots`. A closed
  blind spot means somebody ran the probe. An opened one means the second pass found a limit the
  first pass had not noticed.

Shape:

| Surface | Added | Removed | Rewired | Coverage moved | Blind spots |
|---|---|---|---|---|---|
| callers | 0 | 3 | 1 | — | — |
| data-contracts | 1 | 0 | 0 | `inferred` → `measured` | −1 closed |
| … all twelve, including the empty rows … | | | | | |

Every non-zero cell expands to the specific node or edge ids underneath the table. A count with
no list is a number nobody can check.

## Where it earns its keep

### A refactor claiming "no behaviour change"

The claim is testable against the map. Render the blast area before and after and compare: if
the refactor genuinely changed no behaviour, the delta over `callers`, `data-contracts`,
`jobs`, `ui` and `second-order` is empty, and the only movement is in `config-and-toolchains`
or `tests-and-guards`.

**A non-empty delta is the finding.** Not a rendering artefact, not noise to be explained away —
a claim of "no behaviour change" met by a removed reader on the `second-order` surface is the
whole reason the comparison was run. Report it as the headline, before the table.

### A removal or a deprecation

Here the question is precisely what stopped being reachable, and the **Removed** column is the
deliverable. Two things need saying alongside it:

- **Removed is not the same as gone.** An edge that disappeared from the map may have gone out
  of scope of the search rather than out of the codebase. Check the coverage column before
  reading a removal as a deletion.
- **A blind spot that opened during a removal** deserves its own line. Removals are where
  data-resident references and external consumers bite, and those are the two surfaces most
  likely to gain a blind spot on the second pass.

## What comparison mode is not

- Not a diff of two repositories. Both envelopes describe the same repository.
- Not a diff of two agent runs. If the two envelopes differ because two different processes
  produced them, the delta is a report on the processes.
- Not a substitute for the single map. It ships **with** the current render, never instead of
  it: a delta with no map to read it against is a list of ids.
