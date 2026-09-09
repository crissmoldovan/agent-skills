import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tombstonesIn, suppressedIds, TOMBSTONE_KIND, tombstonesActuallyPurged } from '../src/tombstone.ts';
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

// The two-phase guard, isolated. It only matters when a PLANNED purge does not
// happen — a segment skipped because a session kept appending to it — and that
// is a race, not something a test can stage. Inline in the CLI it was
// untestable, and reverting it to the planned set left every test green while
// `purged: true` was written for a credential still on disk.
test('only a tombstone whose target was actually removed may be marked purged', () => {
  const planned = tombstonesIn([
    stone('t-done', 'removed-target'),
    stone('t-skipped', 'survived-target'),
  ]);
  assert.equal(planned.length, 2, 'fixture did not produce two tombstones');

  const got = tombstonesActuallyPurged(planned, new Set(['removed-target']));
  assert.deepEqual(got.map((t) => t.id), ['t-done'],
    'a tombstone whose target survived was cleared to claim it was purged');
});

test('nothing removed means nothing marked purged', () => {
  const planned = tombstonesIn([stone('t1', 'a'), stone('t2', 'b')]);
  assert.deepEqual(tombstonesActuallyPurged(planned, new Set()), []);
});

// A removal is not enough on its own. Ids are unique per workspace in practice
// — `record` refuses a duplicate — but `mergeEvents` dedupes defensively
// because copies do happen: replicas, restores, a concurrent write. If one
// segment holding the target is rewritten and another is skipped, the id lands
// in `removedIds` while its bytes are still on disk, and the flag would say
// erased about a credential that is still there.
test('a target surviving in a skipped segment blocks the flip, even though a copy was removed', () => {
  const planned = tombstonesIn([stone('t1', 'two-copies')]);
  const got = tombstonesActuallyPurged(
    planned,
    new Set(['two-copies']),   // one copy really was deleted
    new Set(['two-copies']),   // another copy sat in a segment that was skipped
  );
  assert.deepEqual(got, [], 'purged was cleared while a copy of the target remained');
});

test('with nothing surviving, a removed target still flips', () => {
  const planned = tombstonesIn([stone('t1', 'gone')]);
  const got = tombstonesActuallyPurged(planned, new Set(['gone']), new Set());
  assert.deepEqual(got.map((t) => t.id), ['t1']);
});
