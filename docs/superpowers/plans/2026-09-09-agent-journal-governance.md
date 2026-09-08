# Agent Journal — Tombstones and Entry Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it possible to remove something from a grow-only journal — a leaked secret, a named person — and give entries a retention window, so "kept indefinitely" stops being a volume decision masquerading as a policy.

**Architecture:** A tombstone is an appended event like any other; nothing is edited. A reader derives suppression from the journal itself rather than being handed a list. Entry retention reuses the machinery observations already have, with a different default and one extra protection.

**Tech Stack:** TypeScript with `--experimental-strip-types`, Node >= 24, `node:test`, no runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-07-agent-decision-journal-design.md` §13.2, with §6.3 for pinning and downgrade and §4.3 for the `unknown` vocabulary.

**Backlog entry this closes:** items 1 and 2 of `docs/superpowers/agent-journal-remaining-work.md`.

## Why these two together

They are one argument. §13.2 says erasure has no mechanism in a grow-only set, that a tombstone is the price paid for it, and — in the same breath — that entry retention is therefore symmetric with observations. Splitting them would ship the deletion mechanism without the policy that makes it routine, or the policy without the mechanism.

The retention consequence is **already built and tested**: `applyRetention` suppresses tombstoned ids and downgrades anchors citing purged content to `unknown`. What is missing is everything that would let a real journal use it. `options.tombstoned` is a list nothing produces, so today the only caller who can tombstone anything is one who already knows the ids.

## Global Constraints

- **A tombstone is an appended event. Nothing is ever edited or removed in place.** The suppression is a projection-time effect, exactly like invalidation. A tombstone that rewrote a segment would break §7.1's "writes need no coordination" and §8's union semantics simultaneously.
- **Purging bytes is a separate, explicit act from recording the intent.** §13.2 wants both, and conflating them means a reader who has seen the tombstone but not compacted has silently different content from one who has. Record the intent; purge under an explicit command.
- **Tombstoning is not retraction.** `invalidate` says a premise was false and the entry is wrong; a tombstone says the *content must not exist* and takes no position on whether the reasoning was sound. Do not reuse `invalidates`, do not let one imply the other, and do not let a tombstoned entry render as merely invalidated.
- **§13.2 forfeits convergence knowingly.** A replica that never sees the tombstone keeps the bytes. Do not attempt to fix that; do document it.
- **Node >= 24.** `pnpm test` from `packages/agent-journal`; never bare `node --test`, never Node 22. Note `timeout(1)` is not installed on this machine.
- No new runtime dependencies. `null` is not `[]`; absent is not `''`; absent is not `false`.
- **Every new test mutation-checked.** Break the code, confirm the named test goes RED, restore. If a mutation stays GREEN, report it and investigate — never retarget. Ten mutually-masking guards have been found on this project, and several plan-authored mutation rows have turned out to be wrong; treat the tables below as claims under test.
- **For every compound guard, confirm each half fails alone.**
- Gates: `pnpm verify` in the package, `node scripts/verify-skills.mjs` (20 skills), `pnpm verify` at the root.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/tombstone.ts` (new) | The tombstone kind, and deriving suppressed ids from an event list. Pure. |
| `src/retention.ts` (modify) | Entry TTL alongside the observation TTL; take tombstones from the journal. |
| `src/cli.ts` (modify) | `tombstone` and `compact` subcommands. |
| `src/index.ts` (modify) | Exports. |
| `test/tombstone.test.ts` (new), `test/retention.test.ts`, `test/cli.test.ts` (modify) | |
| `skills/decision-journal/references/retention-and-deletion.md` (new) | What a tombstone costs, and why entries expire. |

---

## Task 1: The tombstone event and its projection

**Files:**
- Create: `packages/agent-journal/src/tombstone.ts`
- Test: `packages/agent-journal/test/tombstone.test.ts`

**Interfaces:**
- Consumes: `JournalEvent`.
- Produces:
  - `TOMBSTONE_KIND = 'tombstone'`
  - `interface Tombstone { readonly id: string; readonly target: string; readonly reason: string; readonly time: string; readonly purged: boolean }`
  - `tombstonesIn(events: readonly JournalEvent[]): Tombstone[]`
  - `suppressedIds(events: readonly JournalEvent[]): ReadonlySet<string>`

**Design decisions this task locks in.**

*The kind is neither an entry nor an observation.* It is a governance event. `retention.ts` classifies anything in neither set as `unclassified` and keeps it — which is the right default but the wrong answer here, so Task 2 teaches it the third category explicitly rather than letting a tombstone ride in as unclassified forever.

*A tombstone carries a `reason`, and it is required.* §13.2's price is paid by a human deciding something must not exist. An unexplained tombstone is indistinguishable from a mistake, and a reader six months later cannot tell whether to trust the suppression.

*`purged` records whether the bytes are gone, and it is a separate later fact.* Recording the intent and destroying the content are two acts; the field says which have happened.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-journal/test/tombstone.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tombstonesIn, suppressedIds, TOMBSTONE_KIND } from '../src/tombstone.ts';
import { normalizeEvent } from '../src/envelope.ts';

function ev(id: string, kind: string, data: Record<string, unknown>, time = '2026-09-09T10:00:00.000Z') {
  return normalizeEvent({
    schemaVersion: 1, id, source: 'cli/h/s/a', sourceEpoch: 'e1', time,
    workspace: 'ws', session: 's', agent: 'a', author: 'human', provenance: 'cli',
    harness: 'test', context: 'coding', kind, data,
  });
}
const stone = (id: string, target: string, extra: Record<string, unknown> = {}) =>
  ev(id, TOMBSTONE_KIND, { target, reason: 'contained a live credential', ...extra });

test('a tombstone suppresses its target', () => {
  const s = suppressedIds([ev('e1', 'decision', { question: 'q', chosen: 'x' }), stone('t1', 'e1')]);
  assert.deepEqual([...s], ['e1']);
});

test('a tombstone naming nothing present still suppresses that id', () => {
  // The target may live in a segment this reader has not loaded. Suppression
  // must not depend on having seen the thing being suppressed, or a partial
  // read silently un-deletes it.
  assert.deepEqual([...suppressedIds([stone('t1', 'absent-elsewhere')])], ['absent-elsewhere']);
});

test('a tombstone without a target suppresses nothing, rather than everything', () => {
  assert.deepEqual([...suppressedIds([ev('t1', TOMBSTONE_KIND, { reason: 'r' })])], []);
});

// A tombstone with no reason is indistinguishable from a mistake, and a reader
// months later cannot tell whether to trust it.
test('a tombstone without a reason is not a tombstone', () => {
  const t = ev('t1', TOMBSTONE_KIND, { target: 'e1' });
  assert.deepEqual(tombstonesIn([t]), []);
  assert.deepEqual([...suppressedIds([t])], []);
});

test('a tombstone cannot suppress itself, which would erase the record of the deletion', () => {
  assert.deepEqual([...suppressedIds([stone('t1', 't1')])], []);
});

test('purged is false until something says otherwise, and is never absent', () => {
  const [t] = tombstonesIn([stone('t1', 'e1')]);
  assert.equal(t!.purged, false);
  const [p] = tombstonesIn([stone('t2', 'e2', { purged: 'true' })]);
  assert.equal(p!.purged, true);
});

test('two tombstones for one target are one suppression, not two', () => {
  const s = suppressedIds([stone('t1', 'e1'), stone('t2', 'e1')]);
  assert.deepEqual([...s], ['e1']);
  assert.equal(tombstonesIn([stone('t1', 'e1'), stone('t2', 'e1')]).length, 2,
    'both events are still real events, even though they suppress one id');
});

test('tombstones are returned in time order, oldest first', () => {
  const out = tombstonesIn([
    stone('t2', 'e2') as never, // later in the array, earlier in time below
    ev('t1', TOMBSTONE_KIND, { target: 'e1', reason: 'r' }, '2026-09-08T10:00:00.000Z'),
  ]);
  assert.deepEqual(out.map((t) => t.id), ['t1', 't2']);
});

test('a non-tombstone event is ignored however tombstone-shaped its data', () => {
  const decoy = ev('d1', 'decision', { target: 'e1', reason: 'r', question: 'q', chosen: 'x' });
  assert.deepEqual([...suppressedIds([decoy])], []);
});
```

- [ ] **Step 2: Run to verify they fail** — `Cannot find module '../src/tombstone.ts'`.

- [ ] **Step 3: Implement.** Read `target` and `reason` with the same non-blank-after-trim rule the rest of the package uses. `purged` is truthy-string or boolean `true`; anything else is `false`.

- [ ] **Step 4: Run to verify they pass**

- [ ] **Step 5: Mutation-check**

| Mutation | Test that must go red |
| --- | --- |
| drop the `reason` requirement | a tombstone without a reason is not a tombstone |
| allow self-targeting | a tombstone cannot suppress itself |
| absent `target` → suppress all ids | a tombstone without a target suppresses nothing |
| require the target to be present in `events` | a tombstone naming nothing present |
| `purged` default `undefined` instead of `false` | purged is never absent |
| drop the time sort | tombstones are returned in time order |
| match on `data.target` rather than `kind` | a non-tombstone event is ignored |

- [ ] **Step 6: Commit**

---

## Task 2: Entry retention, and tombstones read from the journal

**Files:**
- Modify: `packages/agent-journal/src/retention.ts`
- Test: `packages/agent-journal/test/retention.test.ts`

**Interfaces:**
- `RetentionOptions` gains `entryTtlMs: number` (required, like `observationTtlMs` — §17.2 leaves the window undecided, so the caller supplies it and no default hides the decision).
- `options.tombstoned` is **removed**; suppression comes from `suppressedIds(events)`.
- `RetentionResult` gains `tombstoned: string[]` — ids suppressed by a tombstone in this journal, reported rather than silently vanished.

**Three rules that decide the shape.**

*A tombstone event is never itself expired or unclassified.* It is the record of a deletion; aging it out would un-delete the content on the next union. Teach `applyRetention` the third category.

*Pinning protects observations from the TTL. It does not protect anything from a tombstone.* §6.3's pin exists so evidence outlives its window; §13.2 exists so content can be destroyed on purpose. When they disagree, the tombstone wins — otherwise citing a leaked secret would make it permanent.

*An expired entry downgrades citing anchors exactly as a purged one does.* §6.3's downgrade rule is about the referent being gone, not about why.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-journal/test/retention.test.ts — append
test('entries age out on their own window, separately from observations', () => {
  // an old entry with a short entryTtlMs expires; a recent one does not;
  // an old OBSERVATION with a long observationTtlMs survives, proving the two
  // windows are independent rather than one value read twice
});

test('a tombstoned id is reported, never silently dropped', () => {
  // result.tombstoned names it; it is absent from keep
});

// 6.3 pins evidence so it outlives its window. 13.2 destroys content on
// purpose. When they meet, the tombstone wins — otherwise citing a leaked
// credential in an anchor would make it permanent, which is precisely the
// outcome 13.2 exists to prevent.
test('a tombstone beats a pin', () => {
  // an observation cited by a live entry's anchors AND tombstoned:
  // absent from keep, present in tombstoned, and the citing entry is downgraded
});

test('a tombstone event is never itself expired, however old', () => {
  // an ancient tombstone with a tiny entryTtlMs and observationTtlMs survives
});

test('a tombstone event is not unclassified', () => {
  assert.deepEqual(/* result */.unclassified, []);
});

test('an expired entry downgrades anchors citing it, like a purged one', () => {
  // 6.3: the rule is about the referent being gone, not about why
});

test('suppression comes from the journal, not from a caller-supplied list', () => {
  // applyRetention takes NO tombstoned option any more; passing one is either
  // a type error or ignored — assert the behaviour comes from the events
});
```

Fill these in against Task 1's exports and the existing fixtures in this file.

- [ ] **Step 2–4: Run, implement, run**

- [ ] **Step 5: Mutation-check**

| Mutation | Test that must go red |
| --- | --- |
| `entryTtlMs` read from `observationTtlMs` | entries age out on their own window |
| pin checked before tombstone | a tombstone beats a pin |
| tombstone events subject to the entry TTL | a tombstone event is never itself expired |
| tombstone kind left unclassified | a tombstone event is not unclassified |
| expired entries do not downgrade | an expired entry downgrades anchors citing it |
| `tombstoned` omitted from the result | a tombstoned id is reported |

- [ ] **Step 6: Commit**

---

## Task 3: `tombstone` and `compact` commands

**Files:**
- Modify: `packages/agent-journal/src/cli.ts`, `src/index.ts`
- Test: `packages/agent-journal/test/cli.test.ts`

**Interfaces:**
- `agent-journal tombstone <target-id> --reason <why> --workspace <id>`
- `agent-journal compact --workspace <id> [--entry-ttl-days <n>] [--observation-ttl-days <n>] [--apply]`

**`compact` is a dry run unless `--apply` is given.** This is the only command in the package that destroys data. Every other one appends or reads. A destructive default would be wrong even with a confirmation prompt, because this runs in hooks and CI where nothing is there to confirm.

**`tombstone` writes an event and purges nothing.** Purging happens in `compact`, which rewrites segments with tombstoned payloads removed and flips `purged`. Recording the intent must not depend on being able to complete the destruction.

**Register both in `ALLOWED_FLAGS`** — `unknownFlags()` returns `[]` for an unregistered command, so without an entry no flag is checked at all. Add a test that a typo'd flag is rejected on each, or that registration can be deleted silently.

- [ ] **Step 1: Write the failing tests**

Cover at minimum: `tombstone` requires a reason and exits 2 without one; it writes an appended event and leaves the target's bytes on disk; `show` and `digest` stop rendering a tombstoned entry; `compact` without `--apply` reports what it *would* remove and changes nothing on disk (assert byte-identical segments); `compact --apply` removes the payload and flips `purged`; `compact --apply` never removes a tombstone event itself; a damaged journal makes `compact` refuse rather than purge a partial view — **that last one is the most important test in the task**, because compacting on an incomplete read destroys content whose tombstone status was never seen.

- [ ] **Step 2–4: Run, implement, run**

- [ ] **Step 5: Mutation-check**, including: `--apply` defaulted to true; `compact` proceeding on a damaged journal; `compact` purging tombstone events; `tombstone` accepting a blank reason.

- [ ] **Step 6: Verify through the built binary** — tombstone an entry, confirm `show`/`digest`/`trace` all stop rendering it, confirm the bytes are still on disk, then `compact --apply` and confirm they are gone and `coverage` still reads.

- [ ] **Step 7: Commit**

---

## Task 4: Documentation

**Files:**
- Create: `skills/decision-journal/references/retention-and-deletion.md`
- Modify: `skills/decision-journal/SKILL.md`, `docs/superpowers/agent-journal-remaining-work.md`

Cover: what a tombstone is and what it costs (§13.2's forfeited convergence, stated plainly — a replica that never sees it keeps the bytes); that tombstoning is not retraction and when to reach for each; that `compact` is the only destructive command and is a dry run by default; why entries expire at all; and how an anchor citing purged content reads as `unknown` rather than intact.

Then **strike items 1 and 2 from `agent-journal-remaining-work.md`**, leaving the rest. A backlog that only grows is one nobody trusts.

- [ ] **Step 1: Write the reference**
- [ ] **Step 2: Add a SKILL.md step** — capability and its limits, no marketing
- [ ] **Step 3: Run every documented command block verbatim, in document order, against one scratch workspace.** Watch for `--id` collisions. This has caught a broken example in three of the last four plans.
- [ ] **Step 4: Update the backlog file**
- [ ] **Step 5: Gates and commit**

---

## Self-Review

**1. Spec coverage.** §13.2's tombstone-as-appended-event → Task 1. Its purge-on-compaction and forfeited convergence → Task 3 and Task 4. Its entry TTL → Task 2. §6.3's pin-versus-purge interaction → Task 2's "a tombstone beats a pin". §4.3's `unknown` downgrade → already built, extended to expired entries in Task 2.

**2. Placeholders.** Task 1 carries complete test code. Tasks 2 and 3 describe their tests rather than spelling them out, because both depend on Task 1's final `Tombstone` shape and on existing fixtures in files an implementer will have open — a stated dependency, not an omission.

**3. Type consistency.** `suppressedIds` returns `ReadonlySet<string>`; `RetentionResult.tombstoned` is `string[]` to match its siblings (`expired`, `pinned`, `downgraded`). `entryTtlMs` mirrors `observationTtlMs` in name, type and required-ness.

**4. The risk worth naming.** `compact --apply` is the first operation in this package that destroys data, and its correctness depends on a complete read. The damaged-journal refusal is what stands between a partial segment load and permanent loss of content whose tombstone was never seen. If one test in this plan is worth writing twice, it is that one.
