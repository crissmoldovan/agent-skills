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
  // `telemetry` IS a literal substring of `nontelemetry` — this is the fixture
  // that actually distinguishes whole-word matching from plain substring search;
  // `telemetrics` does not (it derives from `telemetric` + `s`, not `telemetry`
  // + a suffix, so the two never share a 9-character-or-longer common prefix).
  const embedded = ev('d4', 'decision', { question: 'nontelemetry subsystem', chosen: 'x' });

  assert.deepEqual(constraintsBearingOn(hit, live).map((c) => c.id), ['c1']);
  assert.deepEqual(constraintsBearingOn(miss, live), []);
  assert.deepEqual(constraintsBearingOn(near, live), []);
  assert.deepEqual(constraintsBearingOn(embedded, live), []);
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

test('a bare YYYY-MM-DD expiry stays inclusive of its own day', () => {
  const c = ev('c1', 'constraint', { statement: 's', scope: 'x', enforcement: 'advisory',
    expiry: '2026-12-31' });
  const live = liveConstraints([c], '2026-09-08T00:00:00.000Z');
  assert.equal(live.length, 1, 'live well before the bare-date expiry');
  assert.equal(live[0]!.malformedExpiry, undefined, 'a parseable expiry is never marked malformed');
});

test('a full ISO-8601 timestamp expiry is used as-is, never dropped for being non-bare', () => {
  const c = ev('c1', 'constraint', { statement: 's', scope: 'x', enforcement: 'advisory',
    expiry: '2026-12-31T00:00:00.000Z' });
  const live = liveConstraints([c], '2026-09-08T00:00:00.000Z');
  assert.equal(live.length, 1,
    'a full timestamp expiry four months out must not vanish as if it had already lapsed');
  assert.equal(live[0]!.malformedExpiry, undefined);
});

test('an unparseable expiry stays live and is marked malformedExpiry, never dropped', () => {
  const c = ev('c1', 'constraint', { statement: 's', scope: 'x', enforcement: 'advisory',
    expiry: 'not-a-date' });
  const live = liveConstraints([c], '2026-09-08T00:00:00.000Z');
  assert.equal(live.length, 1, 'dropping is the unsafe direction; an unreadable expiry stays live');
  assert.equal(live[0]!.malformedExpiry, true);
});

test('absent, empty, whitespace-only, and a Date-parseable partial expiry all stay live', () => {
  const now = '2026-09-08T00:00:00.000Z';
  const noExpiry = ev('c1', 'constraint', { statement: 's', scope: 'x', enforcement: 'advisory' });
  const empty = ev('c2', 'constraint', { statement: 's', scope: 'x', enforcement: 'advisory', expiry: '' });
  const blank = ev('c3', 'constraint', { statement: 's', scope: 'x', enforcement: 'advisory', expiry: '   ' });
  const partial = ev('c4', 'constraint', { statement: 's', scope: 'x', enforcement: 'advisory', expiry: '2026-12' });

  assert.equal(liveConstraints([noExpiry], now).length, 1, 'no expiry at all');
  assert.equal(liveConstraints([empty], now).length, 1, 'empty string expiry');
  assert.equal(liveConstraints([blank], now).length, 1, 'whitespace-only expiry');
  assert.equal(liveConstraints([partial], now).length, 1, 'a Date-parseable partial date, well before it');
});

test('a well-formed expiry is never marked malformedExpiry: false — the key is simply absent', () => {
  const c = ev('c1', 'constraint', { statement: 's', scope: 'x', enforcement: 'advisory',
    expiry: '2026-12-31' });
  const live = liveConstraints([c], '2026-09-08T00:00:00.000Z');
  assert.ok(!('malformedExpiry' in live[0]!), 'malformedExpiry must be omitted, not false, when expiry is fine');
});

test('scope matching is case-insensitive on both sides', () => {
  const live = liveConstraints([
    ev('c1', 'constraint', { statement: 's', scope: 'Telemetry', enforcement: 'blocking' }),
  ], '2026-09-08T00:00:00.000Z');
  const entry = ev('d1', 'decision', { question: 'where does TELEMETRY pipeline data land?', chosen: 'x' });
  assert.deepEqual(constraintsBearingOn(entry, live).map((c) => c.id), ['c1'],
    'mixed-case scope must still bear on mixed-case entry text');
});

test('a scope containing a regex metacharacter does not throw, and still matches whole-word', () => {
  const live = liveConstraints([
    ev('c1', 'constraint', { statement: 'stray paren pasted from prose', scope: '(',
      enforcement: 'advisory' }),
  ], '2026-09-08T00:00:00.000Z');
  const hit = ev('d1', 'decision', { question: 'unbalanced ( in the pasted text', chosen: 'x' });
  const miss = ev('d2', 'decision', { question: 'nothing unusual here', chosen: 'x' });
  assert.doesNotThrow(() => constraintsBearingOn(hit, live));
  assert.deepEqual(constraintsBearingOn(hit, live).map((c) => c.id), ['c1']);
  assert.deepEqual(constraintsBearingOn(miss, live), []);
});

test('a scope word appearing only inside an array-valued field still bears on the entry', () => {
  const live = liveConstraints([
    ev('c1', 'constraint', { statement: 'no unmanaged brokers', scope: 'redis', enforcement: 'blocking' }),
  ], '2026-09-08T00:00:00.000Z');
  const entry = ev('d1', 'decision', {
    question: 'which cache do we use?', chosen: 'memcached',
    rejected: ['redis — needs a broker we do not run', 'sqlite — not distributed'],
  });
  assert.deepEqual(constraintsBearingOn(entry, live).map((c) => c.id), ['c1'],
    'the scope word is only inside the rejected list, not the top-level strings');
});

test('an unparseable now throws instead of silently treating every constraint as expired', () => {
  const events = [
    ev('c1', 'constraint', { statement: 's', scope: 'x', enforcement: 'advisory' }),
  ];
  assert.throws(() => liveConstraints(events, 'not-a-timestamp'), /parseable timestamp/);
});

test('a present but non-string expiry is marked malformedExpiry, unlike an absent one', () => {
  const now = '2026-09-08T00:00:00.000Z';
  const numeric = ev('c1', 'constraint', { statement: 's', scope: 'x', enforcement: 'advisory', expiry: 20260930 });
  const boolean = ev('c2', 'constraint', { statement: 's', scope: 'x', enforcement: 'advisory', expiry: true });
  const array = ev('c3', 'constraint', { statement: 's', scope: 'x', enforcement: 'advisory', expiry: ['2026-09-30'] });
  const absent = ev('c4', 'constraint', { statement: 's', scope: 'x', enforcement: 'advisory' });

  for (const [label, e] of [['numeric', numeric], ['boolean', boolean], ['array', array]] as const) {
    const live = liveConstraints([e], now);
    assert.equal(live.length, 1, `${label}: still live`);
    assert.equal(live[0]!.malformedExpiry, true, `${label}: marked malformed`);
    assert.equal(live[0]!.expiry, undefined, `${label}: no string expiry to show`);
  }

  const liveAbsent = liveConstraints([absent], now);
  assert.equal(liveAbsent.length, 1);
  assert.ok(!('malformedExpiry' in liveAbsent[0]!), 'a missing expiry key is still unmarked');
});
