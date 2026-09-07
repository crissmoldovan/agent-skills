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
