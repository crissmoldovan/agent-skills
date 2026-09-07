import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRetention } from '../src/retention.ts';
import { normalizeEvent } from '../src/envelope.ts';

function make(id: string, kind: string, time: string, data: Record<string, unknown> = {}) {
  return normalizeEvent({
    schemaVersion: 1, id, source: 'h/m/s/a', sourceEpoch: 'e1', time,
    workspace: 'ws', session: 's', agent: 'a', author: 'agent', provenance: 'hook',
    harness: 'claude-code', context: 'coding', kind, data,
  });
}

const OLD = '2026-01-01T00:00:00.000Z';
const NOW = '2026-09-07T00:00:00.000Z';
const THIRTY_DAYS = 30 * 86400000;

test('an old observation nothing cites is expired', () => {
  const r = applyRetention([make('o1', 'tool_call', OLD)], { now: NOW, observationTtlMs: THIRTY_DAYS });
  assert.deepEqual(r.expired, ['o1']);
  assert.equal(r.keep.length, 0);
});

test('an old observation cited by a live entry is PINNED, not expired', () => {
  const r = applyRetention([
    make('o1', 'tool_call', OLD),
    make('d1', 'decision', OLD, { anchors: [{ type: 'tool_use', ref: 'o1' }] }),
  ], { now: NOW, observationTtlMs: THIRTY_DAYS });
  assert.deepEqual(r.pinned, ['o1']);
  assert.deepEqual(r.expired, []);
});

test('entries are never expired by the observation window', () => {
  const r = applyRetention([make('d1', 'decision', OLD)], { now: NOW, observationTtlMs: THIRTY_DAYS });
  assert.deepEqual(r.expired, []);
});

test('an observation cited only by an INVALIDATED entry loses its pin', () => {
  const r = applyRetention([
    make('o1', 'tool_call', OLD),
    make('d1', 'decision', OLD, { anchors: [{ type: 'tool_use', ref: 'o1' }] }),
    make('d2', 'decision', NOW, { invalidates: 'd1' }),
  ], { now: NOW, observationTtlMs: THIRTY_DAYS });
  assert.deepEqual(r.expired, ['o1']);
});

test('a tombstoned target is removed and its citing anchors are downgraded', () => {
  const r = applyRetention([
    make('o1', 'tool_call', NOW),
    make('d1', 'decision', NOW, { anchors: [{ type: 'tool_use', ref: 'o1' }] }),
  ], { now: NOW, observationTtlMs: THIRTY_DAYS, tombstoned: ['o1'] });
  assert.equal(r.keep.some((e) => e.id === 'o1'), false);
  assert.deepEqual(r.downgraded, ['d1']);
});
