# The output contract

Three sections, always all three, in this order: **the ranked rows**, **DROPPED**, and
**NOT SWEPT**. A report missing any of the three is incomplete, and the two most often
missing are the two that carry the coverage.

## The cap

**Ten rows, maximum.** Five when model choice was unavailable — depth is what the band buys,
and a shallower run should say less rather than the same amount with less behind it.

The cap is a ceiling and never a quota. **A clean result is a valid result**: zero rows, plus a
full sweep record, is a complete and deliverable answer. It says the surfaces were walked, the
signals were run, and everything that surfaced was already built or would have created
confusion — which is genuinely useful and is exactly what a padded list destroys.

If more than ten survive both gates, rank and cut. Say how many survived and how many were
shown. Do not spread the overflow into an appendix; the cap exists so the reader reads all of
it.

## The rank key

Strict, and applied in order. Later keys break ties in earlier ones; they never override them.

```text
1. evidence strength    measured with a fired control > measured > sampled > inferred
2. affected population  a number where one is obtainable; "unknown" sorts last
3. harm shape           silent wrong answer > silent nothing > friction > cosmetic
4. effort               ascending — S, then M, then L
5. scope                inside-scope before scope-change
```

**Evidence strength first**, deliberately. A weaker finding that is certain outranks a stronger
finding that might not be real, because the reader is going to spend time on row one and the
worst outcome is spending it on something that turns out not to exist.

**Affected population wants a number.** "Most users" is not a number. Where one is obtainable —
a row count, a route's traffic, a registry's size — use it and say where it came from. Where it
is not, write `unknown`, which sorts last within its evidence tier rather than being guessed
upward.

**Harm shape** is a fixed four-value ladder. A silent wrong answer beats a silent nothing
because the user acts on it; a silent nothing beats friction because friction is at least
visible; friction beats cosmetic because somebody is losing time.

A worked tie, and a deliberately uncomfortable one. Two `measured` findings: A affects an
unknown population and its harm is a silent wrong answer; B affects a measured 12,000 accounts
and its harm is friction. They tie on key 1, so key 2 decides — and `unknown` sorts last, so
**B outranks A**, even though A's harm shape is worse. That is the key working as written: the
fix is to go and obtain A's number, not to promote it by feel. When an ordering will surprise
the reader, **state which key decided the adjacent pair**, so they can see it was applied
rather than judged.

## The row

```json
{
  "signal_class": "orphan",
  "claim": "the gap, stated as what is missing or wrong — never the fix",
  "evidence": "path:line, or the verbatim query with its tool and hit count",
  "surfaces": ["screens", "http-routes"],
  "persona": "the role affected, from the named list",
  "effort": "S | M | L",
  "changes_scope": "inside-scope | scope-change",
  "price": { "effort_class": "M", "review_surface": "…", "runtime_cost": "… | none" },
  "gate_a": { "names": ["…", "…", "…"], "classes_swept": "7 of 9",
              "whole_tree": "verbatim query → hits", "in_flight": "…",
              "access": "…", "verdict": "DOES-NOT-EXIST" },
  "gate_b": { "q1": "…", "q2": "…", "q3": "…",
              "disposition": "propose | convert | re-scope | drop" }
}
```

Field notes:

- **`claim` is the gap, not the fix.** "The export screen has no way to filter by date" is a
  claim. "Add a date filter to the export screen" is a design decision taken before anyone
  agreed the gap existed. The distinction is load-bearing: the gap is checkable, the fix is a
  preference, and stating the fix as the finding removes the reader's chance to solve it
  differently or more cheaply.
- **`evidence` is anchored or the row does not ship.** `path:line`, or a verbatim query with
  its tool and its hit count. Not a description of a search.
- **`surfaces`** uses the step-0 class ids, so rows sort by surface and the reader can see when
  five findings all land on one screen.
- **`persona`** comes from the named list in the prerequisites. "Users" is not a persona.
- **`price` is required whenever `changes_scope` is `scope-change`**, with all three parts.
  A scope-change with a missing part is not offered.
- **`gate_a` and `gate_b` travel with the row.** They are not an appendix. A row whose gate
  records live somewhere else arrives at the reader as an unverified idea.

## Enforced exclusions

These are not style preferences. A row that hits one of them is removed, not softened.

- **No redesign essays.** The claim is the gap. A paragraph proposing an information
  architecture is a different deliverable and belongs to whoever owns the design.
- **No unanchored findings.** Every claim points at a line or a query. This removes the entire
  category of plausible-sounding improvement that nobody can check.
- **No aesthetic critique.** "Dated", "cluttered", "inconsistent styling" — none of these have
  an anchor or a gate record, and this skill has no method for them.
- **No "add a link" when the target has a duplicate.** The one exclusion with an immediate
  shipping consequence: if signal class 3 shows the target is one half of a fork, the finding
  is a consolidation, and proposing the link surfaces the stale half to every persona.

## The DROPPED section

One line per dropped candidate: what it was, which gate dropped it, the verdict, and the
evidence in brackets. See [the two gates](gates.md) for the format and an example.

This section is the most reusable artefact the run produces. It is also the first thing cut
for length, which is backwards — **cut a ranked row before cutting a dropped reason**, because
the ranked row will be rediscovered and the dropped reason will not.

## The NOT SWEPT section

Two lists and a sentence:

1. **Surface classes not enumerated**, from the nine, each with its skip reason.
2. **Signal classes not run**, from the nine, each with its reason — usually "sequential sweep,
   not reached in yield order".
3. **The degradation rung**, named: which capability was missing and what it cost. Where forge
   access was unavailable, the named confidence caveat is repeated here as well as on each gate
   record.

Then the closing sentence of what this run could not see. A reader who does not find this
section will assume the sweep was complete, and will be wrong in a direction that costs them.

## Handing it on

Hand over all three sections together. A consumer given only the ranked rows reads the
absences as checked — the same failure `blast-area` calls the blank cell that was never
searched. A chosen row goes to `resolve-problem-report` to be dug into and specced, or to
`land-complex-change` when it is already understood well enough to budget.
