import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRetention, type RetentionOptions } from '../src/retention.ts';
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
/** Inside a 30-day window from NOW, where OLD is far outside it. */
const RECENT = '2026-09-01T00:00:00.000Z';
const THIRTY_DAYS = 30 * 86400000;
// OLD is ~249 days before NOW. LONG_TTL comfortably outlives that gap, so
// fixtures that use it for entryTtlMs are asserting something about
// observations or invalidation, not about entry expiry — an entry given
// LONG_TTL is not the thing under test in that case.
const LONG_TTL = 400 * 86400000;

test('an old observation nothing cites is expired', () => {
  const r = applyRetention([make('o1', 'tool_call', OLD)],
    { now: NOW, observationTtlMs: THIRTY_DAYS, entryTtlMs: THIRTY_DAYS });
  assert.deepEqual(r.expired, ['o1']);
  assert.equal(r.keep.length, 0);
});

test('an old observation cited by a live entry is PINNED, not expired', () => {
  const r = applyRetention([
    make('o1', 'tool_call', OLD),
    make('d1', 'decision', OLD, { anchors: [{ type: 'tool_use', ref: 'o1' }] }),
  ], { now: NOW, observationTtlMs: THIRTY_DAYS, entryTtlMs: LONG_TTL });
  assert.deepEqual(r.pinned, ['o1']);
  assert.deepEqual(r.expired, []);
});

test('entries are never expired by the observation window', () => {
  // observationTtlMs is deliberately tiny: if it were ever (mis)applied to
  // entries too, this old entry would be the first casualty.
  const r = applyRetention([make('d1', 'decision', OLD)],
    { now: NOW, observationTtlMs: 0, entryTtlMs: LONG_TTL });
  assert.deepEqual(r.expired, []);
});

test('an observation cited only by an INVALIDATED entry loses its pin', () => {
  const r = applyRetention([
    make('o1', 'tool_call', OLD),
    make('d1', 'decision', OLD, { anchors: [{ type: 'tool_use', ref: 'o1' }] }),
    make('d2', 'decision', NOW, { invalidates: 'd1' }),
  ], { now: NOW, observationTtlMs: THIRTY_DAYS, entryTtlMs: LONG_TTL });
  assert.deepEqual(r.expired, ['o1']);
});

test('an unparseable now throws instead of expiring everything', () => {
  const fresh = [make('o1', 'tool_call', NOW)];
  assert.throws(() => applyRetention(fresh, { now: 'not-a-date', observationTtlMs: THIRTY_DAYS, entryTtlMs: THIRTY_DAYS }),
    /parseable timestamp/);
});

test('a TOMBSTONED entry does not pin the observation it cited', () => {
  const r = applyRetention([
    make('o1', 'tool_call', OLD),
    make('d1', 'decision', OLD, { anchors: [{ type: 'tool_use', ref: 'o1' }] }),
    make('t1', 'tombstone', NOW, { target: 'd1', reason: 'contained a live credential' }),
  ], { now: NOW, observationTtlMs: THIRTY_DAYS, entryTtlMs: LONG_TTL });
  assert.deepEqual(r.pinned, [], 'a citer that was deleted must not protect anything');
  assert.deepEqual(r.expired, ['o1']);
  assert.deepEqual(r.tombstoned, ['d1']);
});

test('a SUPERSEDED but not invalidated entry still pins', () => {
  // Supersession says something newer replaced this, not that it was wrong, so
  // its evidence is still worth keeping. Computing pinning from project().live
  // instead of the invalidated set would break this and pass every other test.
  const r = applyRetention([
    make('o1', 'tool_call', OLD),
    make('d1', 'decision', OLD, { anchors: [{ type: 'tool_use', ref: 'o1' }] }),
    make('d2', 'decision', NOW, { supersedes: 'd1' }),
  ], { now: NOW, observationTtlMs: THIRTY_DAYS, entryTtlMs: LONG_TTL });
  assert.deepEqual(r.pinned, ['o1']);
  assert.deepEqual(r.expired, []);
});

test('downgraded reflects a naturally EXPIRED referent, not only a tombstoned one', () => {
  // A property worth stating, because it constrains what this test can even be:
  // the ONLY entry that can cite an expired observation is one that is itself
  // invalidated. Any live entry citing an observation pins it, so the
  // observation cannot age out. An earlier version of this test added a second,
  // live entry citing o1 and was therefore unsatisfiable — that entry pinned o1
  // and nothing expired at all.
  //
  // So: d1 cites o1 and is invalidated, stopping its pin. o1 ages out. d1 is
  // still in `keep` (entries are never aged) and must be told its anchor is
  // gone. Building `gone` from tombstoned ids alone would miss this entirely
  // and pass every other test in this file.
  const r = applyRetention([
    make('o1', 'tool_call', OLD),
    make('d1', 'decision', OLD, { anchors: [{ type: 'tool_use', ref: 'o1' }] }),
    make('inv', 'decision', NOW, { invalidates: 'd1' }),
  ], { now: NOW, observationTtlMs: THIRTY_DAYS, entryTtlMs: LONG_TTL });
  assert.deepEqual(r.expired, ['o1']);
  assert.deepEqual(r.downgraded, ['d1']);
});

test('an unrecognised kind is kept and reported, never silently aged out', () => {
  const r = applyRetention([make('x1', 'decisoin', OLD)],
    { now: NOW, observationTtlMs: THIRTY_DAYS, entryTtlMs: THIRTY_DAYS });
  assert.deepEqual(r.expired, []);
  assert.deepEqual(r.unclassified, ['x1']);
  assert.equal(r.keep.length, 1);
});

test('a tombstoned target is removed and its citing anchors are downgraded', () => {
  const r = applyRetention([
    make('o1', 'tool_call', NOW),
    make('d1', 'decision', NOW, { anchors: [{ type: 'tool_use', ref: 'o1' }] }),
    make('t1', 'tombstone', NOW, { target: 'o1', reason: 'contained a live credential' }),
  ], { now: NOW, observationTtlMs: THIRTY_DAYS, entryTtlMs: THIRTY_DAYS });
  assert.equal(r.keep.some((e) => e.id === 'o1'), false);
  assert.deepEqual(r.downgraded, ['d1']);
  assert.deepEqual(r.tombstoned, ['o1']);
});

// Every fixture in this file used an observation old enough to expire, so the
// "recent observation survives" branch was never taken and the suite stayed
// green under a cutoff of POSITIVE_INFINITY — i.e. a pass that deletes the whole
// journal regardless of age. Retention deletes; the test that says what it must
// NOT delete is the one that matters.
test('an observation younger than the TTL survives, whatever else is expiring', () => {
  const now = '2026-09-07T12:00:00.000Z';
  const events = [
    make('fresh', 'tool_call', '2026-09-07T11:59:00.000Z'),   // one minute old
    make('stale', 'tool_call', '2026-09-01T00:00:00.000Z'),   // six days old
  ];
  const r = applyRetention(events, { now, observationTtlMs: 24 * 60 * 60 * 1000, entryTtlMs: THIRTY_DAYS });
  const kept = r.keep.map((e) => e.id);
  assert.ok(kept.includes('fresh'), `a one-minute-old observation was deleted: kept ${kept.join(',')}`);
  assert.deepEqual(r.expired, ['stale']);
});

test('the TTL is actually applied, not ignored', () => {
  const now = '2026-09-07T12:00:00.000Z';
  const events = [make('o1', 'tool_call', '2026-09-07T06:00:00.000Z')]; // six hours old
  // Under a one-hour TTL it goes; under a one-day TTL it stays. A cutoff that
  // ignores observationTtlMs cannot produce both answers.
  const shortTtl = applyRetention(events, { now, observationTtlMs: 60 * 60 * 1000, entryTtlMs: THIRTY_DAYS });
  const longTtl = applyRetention(events, { now, observationTtlMs: 24 * 60 * 60 * 1000, entryTtlMs: THIRTY_DAYS });
  assert.deepEqual(shortTtl.expired, ['o1'], 'a 1h TTL should expire a 6h-old observation');
  assert.deepEqual(longTtl.expired, [], 'a 24h TTL should keep a 6h-old observation');
});

test('a non-finite or negative observationTtlMs is refused, not applied', () => {
  const now = '2026-09-07T12:00:00.000Z';
  const events = [make('o1', 'tool_call', '2026-09-07T11:59:00.000Z')];
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    assert.throws(
      () => applyRetention(events, { now, observationTtlMs: bad, entryTtlMs: THIRTY_DAYS }),
      TypeError,
      `observationTtlMs ${bad} was accepted`,
    );
  }
});

// entryTtlMs gets the same guard as observationTtlMs, checked independently —
// a bad entryTtlMs must not slip through just because observationTtlMs is fine.
test('a non-finite or negative entryTtlMs is refused, not applied', () => {
  const now = '2026-09-07T12:00:00.000Z';
  const events = [make('d1', 'decision', '2026-09-07T11:59:00.000Z')];
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    assert.throws(
      () => applyRetention(events, { now, observationTtlMs: THIRTY_DAYS, entryTtlMs: bad }),
      TypeError,
      `entryTtlMs ${bad} was accepted`,
    );
  }
});

// Removing the isEntry fast path made every decision and finding fall through to
// the observation branch and be reported `unclassified`, with all ten tests
// still green — nothing asserted what the three buckets must contain.
test('entries, known observations and unknown kinds land in the right buckets', () => {
  const now = '2026-09-07T12:00:00.000Z';
  const old = '2026-09-01T00:00:00.000Z';
  const events = [
    make('d1', 'decision', old),
    make('f1', 'finding', old),
    make('o1', 'tool_call', old),
    make('v1', 'void', old),
    make('u1', 'not_a_real_kind', old),
  ];
  const r = applyRetention(events, { now, observationTtlMs: 60 * 60 * 1000, entryTtlMs: THIRTY_DAYS });
  const kept = r.keep.map((e) => e.id).sort();

  assert.deepEqual(r.unclassified, ['u1'],
    `only an unknown kind is unclassified, got ${JSON.stringify(r.unclassified)}`);
  assert.deepEqual(r.expired.sort(), ['o1', 'v1'],
    'both known observation kinds should expire, and only those');
  assert.deepEqual(kept, ['d1', 'f1', 'u1'],
    'entries and unknown kinds are kept; aged observations are not');
});

// --- Task 2: entry retention, and tombstones read from the journal ---

test('entries age out on their own window, separately from observations', () => {
  // An old entry expires under a short entryTtlMs; a fresh entry does not; an
  // equally old OBSERVATION survives a generous observationTtlMs. If entryTtlMs
  // were read from observationTtlMs (or vice versa), either the old entry would
  // survive alongside the observation, or the observation would expire with it —
  // this fixture makes both of those wrong answers visible at once.
  const r = applyRetention([
    make('old-entry', 'decision', OLD),
    make('fresh-entry', 'decision', NOW),
    make('old-obs', 'tool_call', OLD),
  ], { now: NOW, observationTtlMs: LONG_TTL, entryTtlMs: THIRTY_DAYS });
  assert.deepEqual(r.expired, ['old-entry']);
  const kept = r.keep.map((e) => e.id).sort();
  assert.deepEqual(kept, ['fresh-entry', 'old-obs']);
});

test('a tombstoned id is reported, never silently dropped', () => {
  const r = applyRetention([
    make('o1', 'tool_call', NOW),
    make('t1', 'tombstone', NOW, { target: 'o1', reason: 'contained a live credential' }),
  ], { now: NOW, observationTtlMs: THIRTY_DAYS, entryTtlMs: THIRTY_DAYS });
  assert.deepEqual(r.tombstoned, ['o1']);
  assert.equal(r.keep.some((e) => e.id === 'o1'), false, 'a tombstoned id must not appear in keep');
});

// 6.3 pins evidence so it outlives its window. 13.2 destroys content on
// purpose. When they meet, the tombstone wins — otherwise citing a leaked
// credential in an anchor would make it permanent, which is precisely the
// outcome 13.2 exists to prevent.
test('a tombstone beats a pin', () => {
  const r = applyRetention([
    make('o1', 'tool_call', NOW),
    make('d1', 'decision', NOW, { anchors: [{ type: 'tool_use', ref: 'o1' }] }),
    make('t1', 'tombstone', NOW, { target: 'o1', reason: 'contained a live credential' }),
  ], { now: NOW, observationTtlMs: THIRTY_DAYS, entryTtlMs: THIRTY_DAYS });
  assert.equal(r.keep.some((e) => e.id === 'o1'), false,
    'a tombstoned observation must not survive even though a live entry cites it');
  assert.deepEqual(r.tombstoned, ['o1']);
  assert.deepEqual(r.pinned, [], 'a tombstoned id must never also be reported as pinned');
  assert.deepEqual(r.downgraded, ['d1']);
});

test('a tombstone event is never itself expired, however old', () => {
  const ANCIENT = '2000-01-01T00:00:00.000Z';
  const r = applyRetention([
    make('t1', 'tombstone', ANCIENT, { target: 'nonexistent', reason: 'contained a live credential' }),
  ], { now: NOW, observationTtlMs: 1, entryTtlMs: 1 });
  assert.deepEqual(r.expired, []);
  assert.ok(r.keep.some((e) => e.id === 't1'),
    'an ancient tombstone event must survive a tiny entryTtlMs and observationTtlMs alike');
});

test('a tombstone event is not unclassified', () => {
  const r = applyRetention([
    make('t1', 'tombstone', NOW, { target: 'nonexistent', reason: 'contained a live credential' }),
  ], { now: NOW, observationTtlMs: THIRTY_DAYS, entryTtlMs: THIRTY_DAYS });
  assert.deepEqual(r.unclassified, []);
});

// 6.3's downgrade rule is about the referent being gone, not about why: an
// entry that aged out under entryTtlMs must downgrade its citers exactly like
// a tombstoned one does.
test('an expired entry downgrades anchors citing it, like a purged one', () => {
  const r = applyRetention([
    make('old-decision', 'decision', OLD),
    make('citing', 'decision', NOW, { anchors: [{ type: 'tool_use', ref: 'old-decision' }] }),
  ], { now: NOW, observationTtlMs: THIRTY_DAYS, entryTtlMs: THIRTY_DAYS });
  assert.deepEqual(r.expired, ['old-decision']);
  assert.deepEqual(r.downgraded, ['citing']);
});

test('suppression comes from the journal, not from a caller-supplied list', () => {
  // `RetentionOptions` no longer declares `tombstoned` at all. Assigning it via
  // a type assertion — rather than an inline object literal, which TypeScript's
  // excess-property check would refuse outright — proves the field is not just
  // rejected at the type level but genuinely inert at runtime: nothing reads it.
  const bogus = {
    now: NOW, observationTtlMs: THIRTY_DAYS, entryTtlMs: THIRTY_DAYS, tombstoned: ['o1'],
  } as RetentionOptions;
  const r = applyRetention([make('o1', 'tool_call', NOW)], bogus);
  assert.deepEqual(r.tombstoned, [],
    'a caller-supplied tombstoned list must be ignored — suppression comes only from tombstone EVENTS');
  assert.ok(r.keep.some((e) => e.id === 'o1'),
    'an id named only in the (removed) tombstoned option, with no tombstone event, must survive');
});

// 6.3 pins an observation cited by an entry "that has not been invalidated" —
// written when entries never expired. Now they do, and the omission mattered:
// observations outweigh entries by roughly 100x (6.3's own figure), so an
// expired entry that kept pinning its anchors would free about a hundredth of
// what expiring it implies, and those observations would outlive every decision
// that justified them. An entry nobody can read protects nothing.
test('an entry outside its own TTL stops pinning what it cited', () => {
  const r = applyRetention([
    make('o1', 'tool_call', OLD),
    make('e1', 'decision', OLD, { anchors: [{ type: 'tool_use', ref: 'o1' }] }),
  ], { now: NOW, observationTtlMs: THIRTY_DAYS, entryTtlMs: THIRTY_DAYS });

  assert.deepEqual(r.pinned, [], 'an expired entry still pinned its evidence');
  assert.deepEqual(r.expired.sort(), ['e1', 'o1'],
    'the observation outlived the only entry that justified keeping it');
  assert.deepEqual(r.keep, []);
});

// The other side of the same rule: a LIVE entry still pins an observation that
// is itself long past the observation window. That is the whole point of 6.3,
// and the fix above must not have broken it.
test('an entry inside its TTL still pins an observation past its own window', () => {
  const r = applyRetention([
    make('o1', 'tool_call', OLD),
    make('e1', 'decision', RECENT, { anchors: [{ type: 'tool_use', ref: 'o1' }] }),
  ], { now: NOW, observationTtlMs: THIRTY_DAYS, entryTtlMs: THIRTY_DAYS });

  assert.deepEqual(r.pinned, ['o1']);
  assert.deepEqual(r.expired, []);
  assert.equal(r.keep.length, 2);
});
