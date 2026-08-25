# Riding a change

The second mode. Same gates, same output contract — only the seed set differs. Instead of
sweeping the whole surface inventory, the seed is **a blast map**: `blast-area`'s envelope,
with its surfaces, nodes, edges and blindspots.

The question this mode answers is narrow and useful: *the change is happening anyway — what
did it just make possible, and what did it just make wrong?*

## The input

Take the envelope whole, including its `blindspots`. A blindspot in the map is a class the
change may have affected in a way nobody can see; it becomes a **NOT SWEPT** line in this
report, carried across rather than quietly dropped.

Do not re-derive the map. If there is no map, ask for one or run `blast-area` first. A
riding-a-change run seeded by a guess at what the change touches is a pure-analysis run
wearing the wrong header.

## The five questions, per affected surface

For each surface the map marks as affected — not just the ones marked changed:

1. **Newly possible.** The change added a value, a relation, a state, or a capability that
   some surface could now use and does not. This is the class of finding this mode exists for.
2. **Newly exposed.** Something is now reachable by a persona who could not reach it before —
   through a widened access rule, a new route, a new field on an existing response. Newly
   exposed is not automatically good; it is automatically worth naming.
3. **Newly asymmetric.** The change updated one of a pair and not the other: one registry and
   not its sibling, the read path and not the write path, one of two screens that mirror each
   other. Run signal class 5's set difference against the pair.
4. **Newly wrong.** Copy, help text, an error message, a reason code, a documented default — a
   statement that was true before the change and is now false. This is the highest-yield of the
   five and the least often checked, because nothing fails when help text goes stale.
5. **Newly orphaned or duplicated.** The change removed the last link to a surface, or created
   a second path to something that already had one. Run signal classes 2 and 3 against the
   nodes the map touched.

Each answer goes through both gates exactly as in pure-analysis mode. A newly-possible finding
is still routinely already implemented somewhere else.

## Scope pricing is mechanical

The temptation in this mode is to let a good adjacent idea ride along inside the change,
because the files are open and the context is loaded. That is how a bounded change becomes an
unbounded one, so the test is mechanical rather than judgemental.

### INSIDE-SCOPE — all five must hold

1. Only files **the change already touches**.
2. **No new surface** — no new route, screen, tool, job, channel or command.
3. **No new user-visible name** — no new term in copy, no new identifier a persona will see.
4. **No migration** — no schema change, no data backfill, no format change to persisted data.
5. **No new spend path** — nothing that adds a call to a metered or billed dependency.

Fail any one and it is a **SCOPE-CHANGE**. There is no middle.

### SCOPE-CHANGE — the three-part price, or it is not offered

Every scope-change carries all three parts. A scope-change with a missing part is **not
offered at all** — it does not appear as a row with a caveat.

| Part | What it states |
|---|---|
| **Effort class** | S, M or L, on the same scale as the ranked rows |
| **Added review surface** | what a reviewer now has to read that they otherwise would not — the files, the surfaces, the second gate that has to be re-run |
| **Runtime cost** | if it is spend-bearing: what it adds per invocation and per period, or the word `none` if it is not spend-bearing at all |

The runtime cost part is not optional decoration. A discovery finding that adds a per-row model
call to a batch path is a different proposal at ten rows than at ten million, and the row is
where that gets said.

## Offered, never taken

State this sentence **verbatim** in the output header of every riding-a-change run:

```text
Scope proposals in this report are offered, never taken: nothing here has been
implemented, and the run that produced it will not implement it.
```

The reason it is verbatim rather than paraphrased: an agent that has just found a good,
cheap, obviously-correct improvement while already holding the relevant files open is exactly
the agent that will implement it — and an implementation that arrives inside a discovery
report is an unreviewed change wearing a research paper's clothes. The header sentence is the
prohibition stated where the person reading the report can hold the run to it.

If the user asks for one of the rows to be built, that is a new instruction and a different
skill: `land-complex-change` for the landing, or `resolve-problem-report` when it needs
digging into first. The discovery run does not roll into a build because the build looks
small.

## What this mode does not do

- It does not re-map the change. The map is input.
- It does not judge whether the change should have been made.
- It does not widen the change's own scope by implication. A newly-asymmetric finding is a
  finding; deciding to fix it inside the same branch is the author's call, priced.
