import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveConstraints, constraintsBearingOn } from '../src/constraints.ts';
import { normalizeEvent } from '../src/envelope.ts';

function ev(id: string, kind: string, data: Record<string, unknown>, time = '2026-09-07T10:00:00.000Z') {
  return normalizeEvent({
    schemaVersion: 1, id, source: 'cli/h/s/a', sourceEpoch: 'e1', time,
    workspace: 'ws', session: 's', agent: 'a', author: 'agent', provenance: 'cli',
    harness: 'test', context: 'coding', kind, data,
  });
}

test('a constraint with no expiry is live', () => {
  const live = liveConstraints([
    ev('c1', 'constraint', { statement: 'never a third-party sink for this telemetry',
      origin: 'client contract', scope: 'telemetry', enforcement: 'blocking' }),
  ], '2027-01-01T00:00:00.000Z');
  assert.equal(live.length, 1);
  assert.equal(live[0]!.enforcement, 'blocking');
});

test('an expired constraint is not live, and expiry is inclusive of its day', () => {
  const c = ev('c1', 'constraint', { statement: 's', scope: 'x', enforcement: 'advisory',
    expiry: '2026-09-30' });
  assert.equal(liveConstraints([c], '2026-09-30T23:59:59.000Z').length, 1, 'live on its expiry day');
  assert.equal(liveConstraints([c], '2026-10-01T00:00:01.000Z').length, 0, 'not live after it');
});

test('an invalidated constraint stops constraining', () => {
  const events = [
    ev('c1', 'constraint', { statement: 's', scope: 'telemetry', enforcement: 'blocking' }),
    ev('r1', 'decision', { invalidates: 'c1', rationale: 'the contract changed' }),
  ];
  assert.deepEqual(liveConstraints(events, '2026-09-08T00:00:00.000Z'), []);
});

test('a superseded constraint stops constraining too', () => {
  const events = [
    ev('c1', 'constraint', { statement: 's', scope: 'telemetry', enforcement: 'blocking' }),
    ev('c2', 'constraint', { statement: 's2', scope: 'telemetry', enforcement: 'advisory',
      supersedes: 'c1' }),
  ];
  const live = liveConstraints(events, '2026-09-08T00:00:00.000Z');
  assert.deepEqual(live.map((c) => c.id), ['c2']);
});

test('matching is by keyword on scope, and says nothing about meaning', () => {
  const live = liveConstraints([
    ev('c1', 'constraint', { statement: 'no third-party sink', scope: 'telemetry',
      enforcement: 'blocking' }),
  ], '2026-09-08T00:00:00.000Z');

  const hit = ev('d1', 'decision', { question: 'where does telemetry go?', chosen: 'a vendor' });
  const miss = ev('d2', 'decision', { question: 'what colour is the button?', chosen: 'blue' });
  // Whole-word, case-insensitive: `telemetrics` is a different word.
  const near = ev('d3', 'decision', { question: 'telemetrics dashboard', chosen: 'x' });

  assert.deepEqual(constraintsBearingOn(hit, live).map((c) => c.id), ['c1']);
  assert.deepEqual(constraintsBearingOn(miss, live), []);
  assert.deepEqual(constraintsBearingOn(near, live), []);
});

test('a constraint never matches itself or another constraint', () => {
  const live = liveConstraints([
    ev('c1', 'constraint', { statement: 'telemetry stays in-house', scope: 'telemetry',
      enforcement: 'advisory' }),
  ], '2026-09-08T00:00:00.000Z');
  const other = ev('c2', 'constraint', { statement: 'telemetry retention is 30 days',
    scope: 'telemetry', enforcement: 'advisory' });
  assert.deepEqual(constraintsBearingOn(other, live), [],
    'constraints surface against decisions, not against each other');
});
