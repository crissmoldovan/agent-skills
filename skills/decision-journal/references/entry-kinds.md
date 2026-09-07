# Entry kinds

Six kinds. Choosing the wrong one is not fatal, but each carries different fields and is
read differently, so the choice affects what a later reader can ask.

All six share the same envelope, the same anchors and influences, the same retraction
edges, and the same disclosure class. Every kind takes
`--disclosure private|team|published` on `record` (and `invalidate` takes it too) — the
write default is `team`, and an unrecognised value is refused rather than silently
contained. See [references/digest-and-disclosure.md](digest-and-disclosure.md) for what
the class controls, and the asymmetry between what a write defaults to and what a parse
defaults to.

Separate from disclosure, and with no flag of its own because no kind opts out of it:
every write also passes through automatic secret redaction. A recognised credential
appearing in free text is masked in place before the entry is stored; a payload the
redactor cannot scan at all — oversized, or too deeply nested — is refused outright.
That runs identically whichever disclosure class the entry is headed for; a `private`
entry gets no less scrutiny than a `published` one.

Every kind takes its own fields through `record`, and only its own — passing a field
that belongs to another kind is refused with a message naming what this kind does take,
rather than being silently dropped. `--rejected`, `--evidence` and `--premise` are
repeatable and store arrays.

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

```bash
agent-journal record --workspace api --kind decision --id d1 \
  --question "how do we bound the retry queue?" \
  --chosen "in-process ring buffer, 256 entries" \
  --rejected "redis list — needs a broker we do not run" \
  --rejected "kafka — three days of setup for one queue"
```

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

```bash
agent-journal record --workspace api --kind finding --id f2 \
  --claim "the 256 bound is never reached in practice" \
  --evidence "two weeks of queue-depth samples" \
  --premise "traffic stays within its current envelope" \
  --scope workspace
```

`scope` here is one of `machine`, `workspace` or `general` — a `constraint`'s `scope` is
free text, because it names a subject rather than a reach.

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

```bash
agent-journal record --workspace api --kind assumption --id a1 \
  --assumed "the upstream call is idempotent" \
  --ifWrong "retries double-charge" --checked no
```

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

```bash
agent-journal record --workspace api --kind constraint --id c1 \
  --statement "never a third-party sink for this telemetry" \
  --origin "client contract" --scope telemetry --enforcement blocking
```

Everything else in the journal points backwards: this decision replaced that one, this
finding rests on that evidence. A constraint points forward — *never a third-party sink
for this client's telemetry*, *this control is fixed-height by decision, not oversight*,
*do not edit that checkout*.

Constraints are **checked at projection, never at write time**. A new decision whose
subject matches a live constraint is surfaced for a human. Nothing blocks and nothing
auto-resolves — the point is that the obligation becomes visible at the moment it is
relevant, not that a machine adjudicates it.

## Outcome and retraction

Every kind carries an outcome: `unknown`, `held`, `reverted`, `invalidated`. This is a
schema field the CLI does not yet write directly — no kind takes an `--outcome` flag, so
`reverted` and `invalidated` are reached only through `--supersedes`/`--invalidates`, and
`held` is not reachable through `record` at all.

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

Invalidation propagates through `influences` links of type `journal`, walked at the
projection layer. If B records that it rests on A and A is invalidated, B goes too — and
anything resting on B. That is the whole reason the two edges are separate: superseding
a decision does not cast doubt on the work built atop it, and invalidating one does.

Record the edge with `--influence journal:<role>:<id>`. `agent-journal show` reports the
result: an entry that declared a dependence on an invalidated one reads
`outcome: invalidated, live: false` without being named in the retraction.

Neither edge deletes. Both are appended events that change how the record projects.
