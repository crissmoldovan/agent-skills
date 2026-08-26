# Change shapes

Three shapes enter this skill. They share the budget, the ladder and the act gates; they differ
in **what the gates have to prove**, which is why the shape is named before the work starts
rather than inferred from the diff afterwards.

## Feature — the claim is new behaviour

The change adds something that did not exist. The claim is falsifiable in the easiest way
available: before the code, the new behaviour is absent, and a check that asserts it must fail.

- **Budget delta.** New files are ALLOWED entries like any other. The interesting rows are the
  existing files the feature has to reach through — a registry, a route table, a configuration
  key, a permission list. Those are the entries that get forgotten and then appear in the diff
  looking like scope creep.
- **Ladder delta.** Rung 1 is the ordinary case: write the check, run it, watch it fail for the
  right reason. Surfaces the feature only *touches* — the registry it registers into, the
  navigation it appears in — often cannot fail first and sit at rung 2 with a mutation.
- **The trap.** A feature that has to modify existing behaviour to fit is a feature and a
  refactor in one change. Split it or take both shapes' gates; do not let the new behaviour's
  green checks stand in for the old behaviour's.

## Refactor — the claim is *no* behaviour change

This is the shape with the sharpest gate, because the claim is unusually precise: everything
that held before still holds.

- **Budget delta.** A refactor's budget is usually wide in files and narrow in effect — the
  opposite of a feature's. State the effect boundary explicitly: which observable behaviours are
  in scope to stay identical, and which incidental ones (log lines, ordering of unordered
  output, timing) are permitted to differ.
- **Ladder delta.** The guards are the **existing** checks, run unmodified. **A test that had to
  be edited to keep it green refutes the claim** — the behaviour changed, and editing the
  assertion is how the change gets suppressed. The correct output at that moment is the
  behavioural delta, not a tidied test. Where a surface has no existing check, a refactor is
  where rung 4 shows up honestly: you are changing code that nothing watches, and that is worth
  knowing before rather than after.
- **The trap.** "No behaviour change" is usually true of the paths that are tested and untested
  of the rest. A non-empty delta is the finding; a rendering skill can show it as an
  added/removed/rewired classification against the same map.

## Migration — the claim is a data or schema transition

Two halves, an ordering, a window, and an irreversible act.

- **Budget delta.** The migration **file** is an ALLOWED entry. **Applying it is not** — that is
  a standing out-of-bounds class and it is released only at the act gate. Write both rows
  explicitly, because the distinction is exactly the one that erodes under momentum.
- **Ladder delta.** The data-contract surface needs a guard that reaches the *derived* values,
  not only the read and the write. The deploy-ordering surface is usually rung 3 — a rehearsal
  against a disposable database, or a written window analysis with the drain question answered.
  Say which; a rehearsed revert is worth more here than anywhere else, because this is the shape
  whose undo path is most often assumed.
- **The trap.** The undo path is where migrations are misdescribed. A revert restores the schema
  shape; it does not restore the values a contracting migration removed, and it does not un-write
  the rows the new code wrote during the window. State both halves.
- **The record.** The act's record — the applied-migration history, wherever the repository keeps
  it — is updated in the same change as the act. A migration applied in production whose record
  says otherwise breaks the next clean deploy, and the disagreement surfaces in somebody else's
  work.

## Mixed shapes

Real changes combine them: a feature that needs a schema column, a refactor that renames a
column on the way past. Two rules:

1. **Take the strictest gate of every shape present.** A refactor-plus-migration runs the
   existing checks unmodified *and* rehearses the revert *and* gates the apply.
2. **Prefer to split.** A mixed change has one budget, one review and one revert covering two
   claims of different kinds — so a regression in either half rolls back both. Splitting costs
   an extra branch; not splitting costs the ability to undo half of it.

## The boundary with `resolve-problem-report`, in both directions

The two skills meet at exactly one handover and are not supersets of each other.

| | `resolve-problem-report` | this skill |
|---|---|---|
| Starts with | a report: a bug, a feature request, a question, a complaint with numbers in it | a decided change |
| Owns | intake as a falsifiable claim, reproduction, root cause at the required evidence class, candidate offers with trade-offs, the spec | the budget, the ladder, the act gates, the landing |
| Can correctly end with | **no change at all** — a refutation, a question, "this was fixed three weeks ago" | a landed change, a split, or an abandonment with a finding |
| Hands over | the spec and the file paths — never the investigation transcript | the diff, the budget, the ladder and the residuals, to description and review |

**Report first, then here:** a report arrives, is reproduced, candidates are offered, one is
chosen and specced — and the spec-implement-verify half runs here, by name, with the spec and
the paths as context.

**Here without a report:** a roadmap item, a dependency bump, a deprecation with a date, a
performance change nobody filed. Do not manufacture a report to get a pipeline: the intake gate
would be answering a question nobody asked, and its artifacts would be fiction.

**The wrong direction, both ways.** Entering here with a report and no chosen fix means the
budget encloses a solution nobody validated — the containment will be excellent and the change
may be unnecessary. Entering the report pipeline with a decided change means re-deriving an
intake and a candidate set for a decision that is already made, which produces a document that
justifies rather than tests.
