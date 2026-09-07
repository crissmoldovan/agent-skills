# Entry kinds

Six kinds. Choosing the wrong one is not fatal, but each carries different fields and is
read differently, so the choice affects what a later reader can ask.

All six share the same envelope, the same anchors and influences, the same retraction
edges, and the same disclosure control.

> **What the CLI exposes today.** The field tables below describe the **schema** — the
> shape each kind takes in the journal. The `record` command currently accepts the
> `decision` fields only: `--question`, `--chosen`, `--rationale`, `--rejected`,
> `--reversibility`, `--blastRadius`, `--confidence`, plus `--supersedes` and
> `--invalidates`. Passing a field from another kind is refused with `unknown flag`
> rather than silently dropped.
>
> So record other kinds with `--kind finding` (or `assumption`, and so on) and put their
> content in `--question` and `--rationale` until the remaining fields are wired. Hook
> adapters, which write the envelope directly rather than through the CLI, are not
> limited this way.

## `decision`

A choice between options that a reasonable person could have made differently.

| Field | Holds |
| --- | --- |
| `question` | What was being decided |
| `chosen` | What was picked |
| `rejected[]` | Alternatives and why not — **the field nothing else captures** |
| `rationale` | Why |
| `reversibility` | `trivial` / `moderate` / `hard` / `one-way` |
| `blastRadius` | Who or what is affected when it takes effect |

**`reversibility` and `blastRadius` are not the same thing**, and conflating them is a
real error. Flipping an enforcement flag is `trivial` to reverse — unset it and redeploy
— while its blast radius is every user currently signed in. The rollback cost and the
user cost are unrelated, and the trivial score is precisely the wrong signal.

## `finding`

Something you learned that was not obvious, and that changes what someone should do.

| Field | Holds |
| --- | --- |
| `claim` | What you found |
| `evidence[]` | What supports it |
| `premise[]` | **What must be true for this to hold** |
| `scope` | This machine / this workspace / general |

`premise` is what makes a premise re-check possible later. `scope` prevents the most
common failure with findings: a fact true of one laptop's `PATH` propagating as a fact
about the project. If you are not certain a finding generalises, scope it narrowly — a
finding wrongly marked general is worse than one wrongly marked local.

## `assumption`

Something you proceeded as though were true, without checking.

| Field | Holds |
| --- | --- |
| `assumed` | What you took to be true |
| `ifWrong` | What breaks if it is not |
| `checked` | `yes` / `no` |

These are the entries people are least inclined to write and that pay off most. Every
incident worth the name has one of these at its root, unrecorded. When context is about
to be compacted, sweeping for assumptions is the highest-value thing you can do with the
remaining tokens.

## `blocker`

Work that cannot proceed, and what would unblock it.

| Field | Holds |
| --- | --- |
| `blocked` | What cannot proceed |
| `on` | What it waits for |
| `owner` | Who can clear it |
| `clearedBy` | What actually cleared it, once it is |

## `progress`

A checkpoint. Use sparingly — if you have a tracker, this duplicates it, and a journal
full of progress notes buries the entries that carry judgement. Bind it to an existing
ticket id rather than restating status.

## `constraint`

A standing obligation that later work must respect. The only forward-looking kind.

| Field | Holds |
| --- | --- |
| `statement` | The obligation |
| `origin` | Who imposed it |
| `scope` | Where it applies |
| `expiry` | When it lapses, if it does |
| `enforcement` | `advisory` or `blocking` |

Everything else in the journal points backwards: this decision replaced that one, this
finding rests on that evidence. A constraint points forward — *never a third-party sink
for this client's telemetry*, *this control is fixed-height by decision, not oversight*,
*do not edit that checkout*.

Constraints are **checked at projection, never at write time**. A new decision whose
subject matches a live constraint is surfaced for a human. Nothing blocks and nothing
auto-resolves — the point is that the obligation becomes visible at the moment it is
relevant, not that a machine adjudicates it.

## Outcome and retraction

Every kind carries an outcome: `unknown`, `held`, `reverted`, `invalidated`.

**`unknown` is displayed, never hidden.** An entry nobody revisited stays `unknown`, and
that is itself the signal — "nobody checked whether this held" is information a reader
needs. Silently rendering it as fine would be the single most misleading thing the
journal could do.

Two retraction edges, and the difference carries real weight:

| | `supersedes` | `invalidates` |
| --- | --- | --- |
| Means | A later decision replaced this | This entry's premise was false |
| The original was | Reasonable at the time | Never sound |
| Effect on descendants | None | **Suppressed, transitively** |
| In a digest | Shown as history | Shown as retracted |

Invalidation propagates. If B rested on A and A is invalidated, B goes too — and
anything resting on B. That is the whole reason the two edges are separate: superseding
a decision does not cast doubt on the work built atop it, and invalidating one does.

Neither edge deletes. Both are appended events that change how the record projects.
