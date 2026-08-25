# Candidate offers

The offer gate exists because the choice between fixes is a decision about consequences, and
consequences are not visible in a description of an approach. Two candidates described in prose
are compared on how well each was written. Two candidates with a blast area each are compared on
what they disturb, which is the thing the chooser actually cares about.

## Five fields, every candidate

| Field | What it holds | Failure if omitted |
|---|---|---|
| **blast area** | the surfaces the change would touch, each with its break time (compile / runtime / silent), plus the deploy ordering and its reason | the cheap-looking candidate wins, and the cost surfaces after it is chosen |
| **what it does not fix** | the part of the report this candidate leaves standing, in the reporter's own terms | the fix ships, the report reopens, and everyone believes it regressed |
| **reversibility** | what a revert restores, what it does not, and what data written in between survives it | "revertible" is assumed, and a rollback becomes an incident |
| **size** | a rung, not an estimate: one file / one surface / several surfaces / crosses a boundary | precision nobody has is offered, and it will be quoted back |
| **evidence** | what the candidate rests on from G1 — which finding, at which class | a candidate built on the premise that was refuted at G1 |

Call the mapping skill **once per candidate**. It is more work than mapping the favourite, and it
is the only version of this gate that produces a comparison rather than a recommendation with
decoration. Where a map genuinely cannot be produced for one candidate, say so in that
candidate's row: "effects reasoned, not enumerated."

## The four candidate classes that must be considered every time

These are the ones a pipeline drops, because none of them is satisfying to say and all four are
frequently correct.

### 1. Already fixed, or retracted

The behaviour changed at a revision after the report was written, or the premise it rested on no
longer holds. Requires: the revision that changed it, what it changed, and a re-run of the
reproduction table at HEAD. The work is dating, not building.

Say it in the reporter's terms and without triumph — "this was happening; it stopped at this
revision; here is what changed" — and check whether the *symptom* stopped or only the *mechanism
they named* stopped. Those come apart more often than you would like.

### 2. Do nothing, deliberately

Not "won't fix" and not silence. A do-nothing candidate carries:

- what the report costs if left — frequency, who hits it, what they do instead;
- what would make it worth revisiting: a threshold, a date, a dependency that lands;
- what to tell the reporter, which is the part that makes this an honest outcome rather than an
  ignored ticket.

A pipeline that cannot produce this candidate will produce a change for every report it is ever
handed, including the ones whose correct answer was "this is working as designed and here is
why".

### 3. The precedent this repository already used

The same problem, solved elsewhere in the tree, possibly under another word. A four-step search,
in cost order:

1. **Name it three ways** — the reporter's words, the domain word this codebase uses, and the
   identifier form (symbol, slug, route segment, column name). Most already-solved problems are
   missed because they were searched under one of the three.
2. **Search the whole tree by name**, unscoped. The precedent is usually in a package you would
   not have thought to look in.
3. **Search the history** — a closed report, a reverted attempt, a commit message naming the
   same symptom. A reverted attempt is especially valuable: somebody already learned why the
   obvious fix does not work.
4. **Search work in flight** — open branches and open pull requests. The tree is the product
   minus everything currently being built.

Matching an existing solution costs less to review, less to maintain, and arrives with a blast
area someone has already walked. Diverging from one is a legitimate choice — say why in one
sentence, because the next reader will ask.

### 4. The sibling requirement already in the ticket

Reports and requests rarely carry one requirement. When the one that stalled is ambiguous,
expensive, or blocked on a limit, look at what sits **next to it in the same ticket**: an
adjacent requirement, usually better specified, frequently delivering most of the value the
reporter actually described, at a fraction of the cost and with nothing left to interpret.

That sibling is **a real candidate**, ranked in the same table as the others — not a consolation
prize produced after the ambiguous one fails, and not a scope reduction smuggled in as a
simplification. It carries the same five fields as everything else, including **what it does not
fix**, which is where the part of the ask it drops has to be stated plainly and in the reporter's
own terms.

Two rules keep it honest:

- **The reporter or owner chooses it, not the agent** — swapping one requirement for its
  neighbour changes what gets delivered, so it goes through the same choice as any other
  candidate, above the light band.
- **The stalled requirement stays on the table.** Offering the sibling is not a verdict that the
  first one is infeasible; where the block was a limit, that claim needs the limit decomposed at
  G1 before it can be made at all.

## The comparison table

Rank by consequence, not by elegance. One table, candidates as rows:

```text
candidate | fixes | does NOT fix | surfaces touched (break times) | reversibility | size | evidence
```

Then one sentence: which you would take and why. The recommendation is welcome; it is not the
gate. The gate is that somebody else could reach a different conclusion from the same table and
be right.

Two to four candidates. Fewer than two is not an offer. More than four is usually two real ones
and a decorative spread — and it pushes the decision back to the reader by volume.

## Recording the choice

The chosen candidate is recorded with **who chose it** and **when**: the reporter, the owning
person, or the agent under the light-band default. This single field decides what the resolution
note says at the end and whether a surprise at G4 is a conversation or an accusation. Where the
confirmation policy made the choice the agent's, record the one-line notice that was given.

## Anti-patterns

- **The strawman spread.** One real candidate flanked by two nobody would pick. It looks like a
  choice and functions as a recommendation.
- **Candidates that differ only in effort.** Small / medium / large versions of one approach.
  That is a sizing question inside one candidate, not three candidates.
- **The candidate whose blast area is "unknown".** Either map it or say it is reasoned; an empty
  cell reads as a small blast area.
- **Ranking by how clean the diff would be.** The chooser is not going to read the diff. They
  are going to live with what it disturbs.
- **Dropping "what it does not fix".** The most useful field on the table, and the first one to
  disappear under time pressure — because writing it means admitting the fix is partial, which
  is exactly what the reporter needs to know before it ships.
