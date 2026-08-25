# A worked resolution

One report, intake to close. Details are illustrative; the shape is the point — a partly
reproduced claim, a refuted premise, four candidates including the precedent and the do-nothing,
a contract with mutations, a landing that hit a breach, and a verification whose disagreement was
filed as its own report rather than chased.

## The report, as it arrived

> "Exports are broken since the filter change last week. Our team's export comes back empty. I
> ran it nine times across our accounts and got 0 rows for three of them — 612 rows for the
> others where the dashboard says 734. Can we get this fixed before month end."

Numbers in it: nine runs, three zero-row accounts, 612, 734. All four go on the card.

## G0 — the claim card

```text
claim      The export endpoint returns zero rows for some accounts under a filter that returns
           rows for others.
falsifier  A run of the same filter against an affected account returning rows.  Reachable: yes
           (staging has the same builder; production read access available for counts).
premises   P1 "since the filter change last week"    — causal, separately falsifiable
           P2 "the dashboard's 734 is the true count" — an attribution, not an observation
kind       bug
reported   <date>, by an analyst, from the export screen
numbers    9 runs · 3 zero-row accounts · 612 exported · 734 on the dashboard
consequence  A wrong answer authorises a change to a shared query builder and a message to a
           team waiting on month end.
```

Band, scored before anything is spent: scope 1, contradiction 2 (two counts disagree), size 1,
ambiguity 0, cost-of-being-wrong 2 (closes a report and mails a person) — **6, normal**,
announced with the caps it buys.

## G1 — analyse

**Reproduction table.**

```text
number | what it measured        | measured here | delta | verdict
9 runs | attempts                | 9             | —     | reproduced
3 accts| zero-row accounts       | 3             | —     | reproduced
612    | rows exported (6 accts) | 612           | 0     | reproduced
734    | dashboard total         | 734           | 0     | reproduced
```

Six of the nine runs reproduced exactly; three returned zero. **The split is the finding**: all
three zero-row accounts were created after a change to the shared query builder, and none of the
six were. That is the mechanism, and no single number would have shown it.

**Root cause, at the class the claim requires.** The claim is that something *happens*, so a code
reading is not enough on its own: the builder was read (`services/reporting/query.ts:88`, at
`4f1c9ab`) **and** the query was run against one affected account with the account scope logged.
Both agree: when a filter is supplied, the filtered branch rebuilds the query without the account
scope, and accounts whose rows carry the newer tenancy marker then match nothing.

**Premise verdicts.**

- **P1 — refuted, with a number.** The filter change landed eleven days ago; the scope regression
  came in with the tenancy marker three weeks before that. Two revisions, both named. The
  reporter noticed it after the filter change because that is when their team started filtering.
- **P2 — refuted, and it is a separate problem.** The dashboard's 734 counts rows the export
  deliberately excludes (soft-deleted). 612 and 734 are both correct, for different questions.
  Held for G5.

## G2 — offer

Four candidates, one map each.

| # | Candidate | Fixes | Does NOT fix | Surfaces (break time) | Reversibility | Size |
|---|---|---|---|---|---|---|
| C1 | patch the export handler to re-apply the scope | this export | every other reader of the shared builder | export handler (runtime) | one commit | one file |
| C2 | do nothing until the tenancy migration completes | — | anything; 3 accounts affected today, growing | — | n/a | none |
| C3 | **fix the shared builder, matching the precedent in the reporting module** | every reader | the dashboard/export count difference | query builder (runtime), 4 callers (compile), 1 saved report row (silent) | one commit; no data written | one file + tests |
| C4 | already fixed? | — | — | — | — | — |

C4 was checked and dismissed: the reproduction ran at HEAD and still fails. C3 carries the
precedent — the reporting module solved the same scope-under-filter problem two quarters ago, and
matching it means one shape to maintain and a blast area somebody has already walked.

Cost-of-being-wrong is 2, so the two-column rule puts confirmation **on**. The table went to the
owner; **C3 chosen by the owner**, recorded.

## G3 — the contract

Two requirements, disjoint files, a mutation each: R1 keeps the account scope in the filtered
branch of the builder; R2 makes an empty scoped result a 200 with an empty list rather than a
500. Both proving tests were watched failing under their own mutations before implementation —
R1's mutation drops the scope clause, R2's returns 500 on the empty branch. NOT IN SCOPE records
C1 and C2 with what each would have left standing, and the standing brief-error instruction rides
with the text the builder receives.

## G4 — the landing

Handed to the landing skill with the contract and two file paths. **Not** the investigation
transcript: it contains P1, the reporter's own diagnosis, which is refuted and would otherwise
have shown up as a defensive change to the filter code.

The budget was derived from C3's map. The gate ladder put the builder and the export handler on
rung 1 (both tests watched failing first), the four compile-time callers on rung 2 (additive; a
mutation armed the typecheck), and the saved report row on **rung 4 — unguarded**, because
nothing in the repository watches a stored query for a scope clause.

**A breach, mid-build.** A fifth caller turned up in a package the map had not walked — a nightly
job importing the builder through a re-export. The work stopped, the map was re-entered with the
new fact, and the disposition was **extend**: one entry added to the budget, band re-scored, the
extension announced. It did not invalidate C3, so it did not go back to G2.

## G5 — verify, describe, file

Each requirement verified at its own class: R1 by running the query against the affected account
again (an observation, not a reading), R2 by its test. The reproduction table re-run: all nine
runs now return rows; the three formerly-zero accounts return 41, 88 and 12.

**The 612-vs-734 disagreement was filed as its own report.** It is a different claim — two counts
of the same thing, differing by more than a hundred, because they answer different questions —
with a different falsifier and a different owner. In one measured case a disagreement of this
shape was chased instead of filed: the original report stayed open for weeks, the new finding was
never recorded under its own name, and both were invisible in every status view. Here the original
closed on its own contract and the new one entered the pipeline at G0.

**The resolution note** came from the description skill's registers — the short one for the
reporter, the detailed one for the reviewer — and the review loop received the contract, the
budget, the ladder with its one unguarded row, and the residuals. Then, behind the act gate, the
report was closed and the reporter was told:

> Your export was returning nothing for three of your accounts: the shared query dropped the
> account scope whenever a filter was applied, and only accounts created after a change three
> weeks earlier were affected — which is why it looked like it started with the filter change
> eleven days ago. Fixed in the shared query, so the other places that use it are fixed too. Your
> 612 and the dashboard's 734 are both correct: the dashboard counts soft-deleted rows and the
> export does not. That difference is now its own ticket. If an export comes back empty again,
> send us the account and the filter and we will have the query log.

**Residuals** carried into the note: the saved report row nothing guards, and the fact that the
soft-delete difference is unresolved until the new report is worked.
