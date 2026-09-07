import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSegment, mergeEvents } from '../src/read.ts';
import { normalizeEvent } from '../src/envelope.ts';

function ev(id: string, extra: Record<string, unknown> = {}) {
  return normalizeEvent({
    schemaVersion: 1, id, source: 'h/m/s/a', sourceEpoch: 'e1',
    time: '2026-09-07T10:00:00.000Z', workspace: 'ws', session: 's', agent: 'a',
    author: 'agent', provenance: 'cli', harness: 'claude-code', context: 'coding',
    kind: 'decision', data: {}, ...extra,
  });
}

test('recovers valid records around a corrupt line', () => {
  const good = JSON.stringify(ev('e1'));
  const also = JSON.stringify(ev('e2'));
  const { events, bad } = parseSegment(`${good}\n{not json\n${also}\n`);
  assert.deepEqual(events.map((e) => e.id), ['e1', 'e2']);
  assert.equal(bad.length, 1);
  assert.equal(bad[0]!.line, 2);
});

test('merging two replicas dedups by id', () => {
  const merged = mergeEvents([[ev('e1'), ev('e2')], [ev('e2'), ev('e3')]]);
  assert.deepEqual(merged.map((e) => e.id), ['e1', 'e2', 'e3']);
});

test('orders by sequence within one source, not by wall clock', () => {
  const a = ev('a', { sequence: 2, time: '2026-09-07T10:00:00.000Z' });
  const b = ev('b', { sequence: 1, time: '2026-09-07T11:00:00.000Z' });
  assert.deepEqual(mergeEvents([[a, b]]).map((e) => e.id), ['b', 'a']);
});

test('merge is order-independent', () => {
  const one = mergeEvents([[ev('e1'), ev('e2')], [ev('e3')]]);
  const two = mergeEvents([[ev('e3')], [ev('e2'), ev('e1')]]);
  assert.deepEqual(one.map((e) => e.id), two.map((e) => e.id));
});

test('a source with MIXED sequence presence still sorts identically every way', () => {
  // The intransitive case: sequence says A<B, wall clock says B<C<A.
  const a = ev('A', { sequence: 1, time: '2026-09-07T03:00:00.000Z' });
  const b = ev('B', { sequence: 2, time: '2026-09-07T01:00:00.000Z' });
  const c = ev('C', { time: '2026-09-07T02:00:00.000Z' });
  const permutations = [[a, b, c], [b, c, a], [c, a, b], [a, c, b], [b, a, c], [c, b, a]];
  const results = new Set(permutations.map((p) => mergeEvents([p]).map((e) => e.id).join('')));
  assert.equal(results.size, 1, `order-dependent: got ${[...results].join(' | ')}`);
});

test('a source keeps its own sequence order regardless of clock skew', () => {
  const a = ev('A', { sequence: 1, time: '2026-09-07T03:00:00.000Z' });
  const b = ev('B', { sequence: 2, time: '2026-09-07T01:00:00.000Z' });
  assert.deepEqual(mergeEvents([[b, a]]).map((e) => e.id), ['A', 'B']);
});

test('a space in source or epoch cannot merge two distinct sequence spaces', () => {
  const one = ev('one', { source: 'foo', sourceEpoch: 'bar baz', sequence: 2 });
  const two = ev('two', { source: 'foo bar', sourceEpoch: 'baz', sequence: 1 });
  // Distinct sources: their sequence numbers are not comparable, so they must
  // land in separate groups rather than being reordered against each other.
  const merged = mergeEvents([[one, two]]);
  assert.equal(merged.length, 2);
  assert.deepEqual(mergeEvents([[two, one]]).map((e) => e.id), merged.map((e) => e.id));
});

test('parse diagnostics are bounded', () => {
  const { bad } = parseSegment(Array.from({ length: 200 }, () => '{broken').join('\n'));
  assert.equal(bad.length, 32);
});
