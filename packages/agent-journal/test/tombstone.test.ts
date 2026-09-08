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
