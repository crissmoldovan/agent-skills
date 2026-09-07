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

test('an unparseable now throws instead of expiring everything', () => {
  const fresh = [make('o1', 'tool_call', NOW)];
  assert.throws(() => applyRetention(fresh, { now: 'not-a-date', observationTtlMs: THIRTY_DAYS }),
    /parseable timestamp/);
});

test('a TOMBSTONED entry does not pin the observation it cited', () => {
  const r = applyRetention([
    make('o1', 'tool_call', OLD),
    make('d1', 'decision', OLD, { anchors: [{ type: 'tool_use', ref: 'o1' }] }),
  ], { now: NOW, observationTtlMs: THIRTY_DAYS, tombstoned: ['d1'] });
  assert.deepEqual(r.pinned, [], 'a citer that was deleted must not protect anything');
  assert.deepEqual(r.expired, ['o1']);
});

test('a SUPERSEDED but not invalidated entry still pins', () => {
  // Supersession says something newer replaced this, not that it was wrong, so
  // its evidence is still worth keeping. Computing pinning from project().live
  // instead of the invalidated set would break this and pass every other test.
  const r = applyRetention([
    make('o1', 'tool_call', OLD),
    make('d1', 'decision', OLD, { anchors: [{ type: 'tool_use', ref: 'o1' }] }),
    make('d2', 'decision', NOW, { supersedes: 'd1' }),
  ], { now: NOW, observationTtlMs: THIRTY_DAYS });
  assert.deepEqual(r.pinned, ['o1']);
  assert.deepEqual(r.expired, []);
});

test('downgraded reflects a naturally EXPIRED referent, not only a tombstoned one', () => {
  // d1 is invalidated, so it stops pinning o1 and o1 ages out. d2 still cites
  // o1 and must be told its anchor is gone. Building `gone` from tombstoned ids
  // alone would miss this and pass every other test in this file.
  const r = applyRetention([
    make('o1', 'tool_call', OLD),
    make('d1', 'decision', OLD, { anchors: [{ type: 'tool_use', ref: 'o1' }] }),
    make('inv', 'decision', NOW, { invalidates: 'd1' }),
    make('d2', 'decision', NOW, { anchors: [{ type: 'tool_use', ref: 'o1' }] }),
  ], { now: NOW, observationTtlMs: THIRTY_DAYS });
  assert.deepEqual(r.expired, ['o1']);
  assert.ok(r.downgraded.includes('d2'), 'an entry citing an expired observation must be downgraded');
});

test('an unrecognised kind is kept and reported, never silently aged out', () => {
  const r = applyRetention([make('x1', 'decisoin', OLD)], { now: NOW, observationTtlMs: THIRTY_DAYS });
  assert.deepEqual(r.expired, []);
  assert.deepEqual(r.unclassified, ['x1']);
  assert.equal(r.keep.length, 1);
});

test('a tombstoned target is removed and its citing anchors are downgraded', () => {
  const r = applyRetention([
    make('o1', 'tool_call', NOW),
    make('d1', 'decision', NOW, { anchors: [{ type: 'tool_use', ref: 'o1' }] }),
  ], { now: NOW, observationTtlMs: THIRTY_DAYS, tombstoned: ['o1'] });
  assert.equal(r.keep.some((e) => e.id === 'o1'), false);
  assert.deepEqual(r.downgraded, ['d1']);
});
