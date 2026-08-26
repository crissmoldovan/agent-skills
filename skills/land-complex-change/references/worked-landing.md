# A worked landing

One migration-shaped change, end to end: the map, the budget, the ladder, a mid-run discovery
that stopped the work, the extension that followed, and the surface that stayed unguarded.
Names are generic; the sequence, including the discovery, is the ordinary one.

**The change:** drop the `status` column from the `jobs` table. It has been superseded by a
`state` enum written by the same code path for two releases.

## 1. Shape and band

Shape: **migration**. Two halves — the readers stop reading `status`, then the column is
dropped — an ordering between them, and one irreversible act.

The rubric is scored with `investigate-codebase`. Cost-of-being-wrong is **2** by this skill's
one rule: the plan contains applying a migration. Total lands at normal on its own; the floor
rule would have raised it there anyway. Announced before anything is dispatched:

```text
land-complex-change · normal band — migration shape; cost-of-being-wrong 2 (plan applies a
migration) forces the floor. Map required, budget derived, one gate per affected surface,
act gates armed. Attended.
```

## 2. The map, read blindspots first

The mapping skill returns nine surfaces with content and two empty. Read in the order that
matters:

- **What it could not see:** resolution is name-based; the repository has no compiler-resolved
  index. Data-resident references *were* queried — a single table of saved report definitions.
  Runtime-only edges: one job dispatches handlers by a key built at runtime.
- **Callers:** four, all in one package, `compile` break.
- **Data contracts:** two readers plus **one deriver** — a nightly rollup computing a count
  grouped by `status`. Break time `silent`: with the column gone the group collapses and the
  number simply changes.
- **Jobs:** the nightly rollup, above. `runtime` at first dispatch.
- **Docs and data-resident:** one saved report definition names the column in a stored SQL
  string. `silent`, always.
- **Deploy ordering:** code-first. The schema half would break readers that are live now, so
  the readers stop reading, old instances drain, then the column goes.
- **External consumers:** an analytics warehouse job in another repository, **not readable from
  here** — recorded as a blindspot with a probe: ask its owners for a column-level search.

## 3. The budget, before the first edit

```text
BUDGET  drop jobs.status  base 4f2ab19  band normal  shape migration
map: blast map of the same base; blindspots read

ALLOWED
  src/jobs/read-status.ts            edit   callers            switch four call sites to state
  src/reports/rollup-nightly.ts      edit   data-contracts     group by state; deriver
  src/jobs/__tests__/rollup.test.ts  edit   tests-and-guards   rung-1 guard for the deriver
  migrations/<version>_drop_status   add    data-contracts     FILE ONLY — not applied

EXPECTED EFFECT
  callers                four call sites take state              compile
  data-contracts         rollup groups by state, same totals     silent
  jobs                   nightly rollup keeps running            runtime
  docs-and-data-resident one saved report definition updated     silent
  ui                     none — searched, control fired          none
  external-consumers     UNKNOWN — warehouse job unreadable      unknown

OUT OF BOUNDS
  the four standing classes, plus:
  - the enum definition itself: widening it is a different change
  - the report-definition table beyond the single row named above

ON BREACH
  stop → re-enter the mapping skill → extend | split | abandon
```

The `migrations/...` row is the distinction the whole shape turns on: **the file is allowed,
applying it is not.**

## 4. The ladder, armed before any edit

| Surface | Guard | Rung | Fail-before |
|---|---|---|---|
| callers | typecheck | 1 | run first: four errors, one per call site — quoted |
| data-contracts (deriver) | rollup test asserting the grouped totals | 1 | edited the test to expect `state`; run: fails on the old code, correct reason |
| jobs | registration assertion + one execution test | 2 | additive; **mutation**: removed the registry key, watched the assertion fail, restored |
| tests-and-guards | the mutation above is itself the check | 2 | recorded |
| docs-and-data-resident | a query counting rows whose SQL names `status` | 1 | returns 1 before; must return 0 after |
| deploy-ordering | rehearsed on a disposable database | 3 | written procedure, before-value recorded |
| ui | — | 4 | **unguarded**: no view renders the column; a search with a fired control found nothing, and nothing would catch a future one |
| external-consumers | — | 4 | **unguarded**: the warehouse job is in another repository. Guarding it needs a column-level search by its owners — asked, answer pending |

Two rung-4 rows, both visible in the deliverable. The second is the honest one: this change
cannot see the consumer that is most likely to break, and the reviewer needs to know that
before approving, not after.

## 5. The breach

Four call sites edited, typecheck green. While editing the rollup, a `SELECT` built from a
string literal appears in a **second** report path that the map did not list — an export
routine assembling its query from a template, in a package the search's pathspec excluded.

The work stops there. Not after finishing the rollup edit: the discovery is evidence that the
map's method missed a class of thing, so every clean result from the same method is now weaker
evidence than it was.

Re-entering the mapping skill with the new fact returns what stopping bought: **three** more
string-built queries, not one. Two name the column; the third names a different column and is
irrelevant. The original pathspec had excluded an entire package.

**Disposition: extend.** The two new sites belong to this change — same surface, same break
time, no new shape. The budget is re-declared with the extra rows, the extension is announced
with the re-scored band (still normal), and the ladder gains a rung-1 guard for the export
path: a test asserting the exported header set, which fails before and passes after.

Absorbing the two edits quietly would have produced a diff with two extra files and no record
of why — and, worse, would have left the third string-built query undiscovered, because nobody
would have gone looking for a class of thing they had already fixed twice.

## 6. Landing, in the map's order

Code-first, in separately revertible steps: callers and rollup, then the export path, then the
saved report definition row, then the migration **file**. Four commits, each revertible alone.

At the act gate:

```text
ABOUT TO:      apply the pending migration to the production database
IT TOUCHES:    one table, one column
CANNOT UNDO:   the column's values. A revert restores the shape, not the data.
IF I DO NOT:   nothing else is blocked. The readers already stopped reading it.
```

Consent given, naming this act. The applied-migration record is updated in the same change —
the record is part of the act, and a repository whose history disagrees with production breaks
the next clean deploy rather than this one.

## 7. Closing

Ladder re-run: every rung-1 gate passed having failed first; both rung-2 gates passed with
their mutations recorded; the rehearsal at rung 3 matched its expected value. Nothing was
recorded `unproven`.

Residual risks, from the map's `silent` items and the two rung-4 rows:

- The warehouse job in another repository. Probe: a column-level search by its owners; asked,
  pending. **This is the most likely break in the whole change.**
- Any report definition added to the datastore between the query and the deploy. Probe: re-run
  the counting query immediately before the act — done, still 0.
- Undo: a revert restores the schema shape and the four commits. It does not restore the
  column's values, and it does not un-write rows the new code wrote in the window.

Handed to review: the diff, the budget with its one recorded extension, the ladder including
both unguarded rows, and the three residuals. The reviewer's first question was about the
warehouse job — which is the point. It was on the page.
