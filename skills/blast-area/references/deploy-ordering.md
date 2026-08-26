# Deploy ordering

Deploy ordering is a first-class output of the map, and it is a **conditional** one. Both
orderings below are correct in the same repository; which one applies depends on the direction
the change runs. Emitting one unconditionally is right about half the time, which is worse than
useless because it is right often enough to be trusted.

## The one question

**Which half breaks the other when it runs alone?**

Every ordering decision reduces to that. The change has (at least) two halves that land at
different moments — commonly a schema half and a code half, but equally a producer and a
consumer, a library and its dependant, a config key and the reader of it. Between the two lands
there is a **window** in which one half is new and the other is old. The ordering you want is the
one whose window is survivable.

## Schema-first

**When:** the new code reads or writes something the schema does not have yet.

**Why:** the code half cannot run at all without the schema half, so it must not be first. The
old code keeps working across the new schema **provided the schema change is additive** — a new
nullable column, a new table, a new optional field, a widened enum. During the window, old
instances ignore the addition.

**Precondition, not a hope:** additive. A `NOT NULL` column without a default, a narrowed type,
a renamed column and a dropped default are all schema changes that break the running old code,
and they belong in the third case below, not here.

**Window contents:** old code against new schema. Verify that nothing does `SELECT *` into a
strict deserialiser, and that no old code path writes a row that would now violate a new
constraint.

## Code-first

**When:** the schema half would break readers that are live right now — a drop, a rename, a type
narrowing, a removed default, a tightened constraint that current code still selects or relies on.

**Why:** applying the schema half first fails **inside the window**, not at deploy time, which is
exactly why it reads as safe until it is not. The deploy goes green; the errors arrive from
whatever runs next.

**Sequence:** deploy the code that stops reading the thing → **let the old instances drain** →
then contract the schema.

**The drain question is part of the output.** Name what still runs after the new code is
deployed: in-flight HTTP requests, workers mid-job, queued messages already dequeued by an old
consumer, cached clients holding an old schema, a serverless platform keeping warm instances of
the previous version, replicas mid-rollout. "Deploy the code first" without a drain answer is an
ordering with a hole in it.

## Neither: expand, migrate, contract

**When:** each half breaks the other. A rename is the canonical case — the old code needs the old
name, the new code needs the new one, and there is no instant at which one column satisfies both.

**Why it is not an ordering problem:** no permutation of two deploys works, so the honest output
is that the change is three steps, not two, and the map should say so rather than picking the
less-bad permutation.

1. **Expand** — add the new thing alongside the old. Both exist. Nothing is removed.
2. **Migrate** — write both (dual-write) and backfill; switch readers to the new thing; let every
   consumer, including the slow ones, cross over.
3. **Contract** — remove the old thing, once no reader remains and you can show it.

Each step is separately deployable and separately revertible, which is the whole point. A feature
flag can substitute for step 2's switch where the readers are all in your control; it cannot
substitute for the backfill.

## What goes on the map

For the `deploy-ordering` surface, emit:

- **The direction**, as an ordered list of the halves.
- **The reason**, in one sentence naming which half breaks the other when it runs alone.
- **The window contents** — what is running in the interval, and the drain answer where the
  ordering is code-first.
- **The steps, where it is three rather than two**, each with its own revertibility.
- **A confidence** from the fixed vocabulary. `measured` when you can name what runs in the
  window because you checked; `inferred` when you reasoned from the platform's defaults. Say
  which.

Edges of kind `deploys-before` carry the same evidence requirement as every other edge: the
constraint that forces the order, cited.

## Two traps

- **Assuming an additive schema change is free.** It is free for readers. A new constraint, a
  trigger, an index build that locks, or a default that rewrites the table are all additive on
  paper and disruptive in the window. Check the mechanism, not the DDL verb.
- **Assuming the two halves are yours to sequence.** Where one half is another team's deploy,
  another repository's release, or a client application people update at their own pace, the
  window is not minutes — it is however long the slowest consumer takes. That is an
  expand-migrate-contract situation regardless of how simple the change looks locally.
