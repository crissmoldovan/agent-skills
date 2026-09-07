import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverage, voidEvent } from '../src/coverage.ts';
import { normalizeEvent } from '../src/envelope.ts';

function make(id: string, kind: string, session: string, extra: Record<string, unknown> = {}) {
  return normalizeEvent({
    schemaVersion: 1, id, source: `h/m/${session}/a`, sourceEpoch: 'e1',
    time: '2026-09-07T10:00:00.000Z', workspace: 'ws', session, agent: 'a',
    author: 'agent', provenance: 'hook', harness: 'claude-code', context: 'coding',
    kind, data: {}, ...extra,
  });
}

// Fixtures below are deliberately asymmetric. Earlier versions used one event
// per assertion, which made `sessions` indistinguishable from `events.length`
// and `voids` indistinguishable from "count everything" — five separate wrong
// implementations passed the whole file.

test('a session with observations and no entries is reported', () => {
  const report = coverage([
    make('o1', 'tool_call', 's1'),
    make('o2', 'tool_result', 's1'),
    make('o3', 'tool_call', 's2'),
    make('d1', 'decision', 's2'),
    make('d2', 'finding', 's3'),
  ]);
  // Five events across three sessions: counting events instead of distinct
  // sessions gives 5, not 3.
  assert.equal(report.sessions, 3);
  // s1 has observations only; s2 has both; s3 has an entry only.
  assert.deepEqual(report.sessionsWithNoEntries, ['s1']);
});

test('void events are counted, and nothing else is', () => {
  const v = (id: string, session: string) => voidEvent({
    id, source: `h/m/${session}/a`, sourceEpoch: 'e1', time: '2026-09-07T10:00:00.000Z',
    workspace: 'ws', session, agent: 'a', harness: 'claude-code',
    reason: 'hook failed', detail: 'exit 1',
  });
  const report = coverage([
    make('o1', 'tool_call', 's1'),
    v('v1', 's1'),
    make('d1', 'decision', 's1'),
    v('v2', 's2'),
    make('o2', 'heartbeat', 's2'),
  ]);
  // Five events, two of them voids: counting every event gives 5.
  assert.equal(report.voids, 2);
  assert.equal(v('probe', 's1').kind, 'void');
});

test('a sequence gap is detected, and adjacent sequences are not a gap', () => {
  const report = coverage([
    // Deliberately out of order, so dropping the sort changes the answer.
    make('c', 'tool_call', 's1', { sequence: 7 }),
    make('a', 'tool_call', 's1', { sequence: 1 }),
    make('b', 'tool_call', 's1', { sequence: 2 }),
  ]);
  // 1→2 is adjacent and must NOT count; 2→7 must. A `>= 1` boundary would
  // report both, and an unsorted scan would see 7→1 and 1→2.
  assert.equal(report.sequenceGaps.length, 1);
  assert.match(report.sequenceGaps[0]!, /2 to 7/);
});

test('sourceEpoch participates in the key, not just source', () => {
  // Same source, DIFFERENT epochs — a writer restart resets its sequence
  // counter. Dropping sourceEpoch from the key merges them into [1, 9] and
  // reports a phantom gap. The collision test below varies `source` too, so it
  // cannot catch this on its own.
  const report = coverage([
    make('a', 'tool_call', 's1', { source: 'S', sourceEpoch: 'E1', sequence: 1 }),
    make('b', 'tool_call', 's1', { source: 'S', sourceEpoch: 'E2', sequence: 9 }),
  ]);
  assert.deepEqual(report.sequenceGaps, []);
});

test('sessionsWithNoEntries is sorted, not insertion-ordered', () => {
  // Three entry-less sessions supplied out of alphabetical order. A fixture
  // yielding one element cannot see a missing sort.
  const report = coverage([
    make('o1', 'tool_call', 'z1'),
    make('o2', 'tool_call', 'a1'),
    make('o3', 'tool_call', 'm1'),
    make('d1', 'decision', 'b1'),
  ]);
  assert.deepEqual(report.sessionsWithNoEntries, ['a1', 'm1', 'z1']);
});

test('a session that emitted nothing at all can be named', () => {
  const report = coverage([make('o1', 'tool_call', 's1')], { knownSessions: ['s1', 'ghost'] });
  assert.deepEqual(report.sessionsWithNoEvents, ['ghost']);
});

test('downgradedAnchors is null when never assessed, not an empty array', () => {
  assert.equal(coverage([make('o1', 'tool_call', 's1')]).downgradedAnchors, null);
  assert.deepEqual(coverage([make('o1', 'tool_call', 's1')], { downgradedAnchors: [] }).downgradedAnchors, []);
});

test('a void records which transport went silent', () => {
  const v = voidEvent({
    id: 'v1', source: 'h/m/s1/a', sourceEpoch: 'e1', time: '2026-09-07T10:00:00.000Z',
    workspace: 'ws', session: 's1', agent: 'a', harness: 'other',
    reason: 'sink unreachable', provenance: 'cli', context: 'ops',
  });
  assert.equal(v.provenance, 'cli');
  assert.equal(v.context, 'ops');
  // Default stays 'hook'/'coding' when the caller says nothing.
  const d = voidEvent({
    id: 'v2', source: 'h/m/s1/a', sourceEpoch: 'e1', time: '2026-09-07T10:00:00.000Z',
    workspace: 'ws', session: 's1', agent: 'a', harness: 'claude-code', reason: 'hook failed',
  });
  assert.equal(d.provenance, 'hook');
});

test('source participates in the key, not just sourceEpoch', () => {
  // The MIRROR of the test above. That one varies epoch with a shared source;
  // this varies source with a shared epoch. Without both, an implementation
  // keying on either field alone passes the whole file — which is exactly what
  // happened after the first fix.
  const report = coverage([
    make('a', 'tool_call', 's1', { source: 'S1', sourceEpoch: 'E', sequence: 1 }),
    make('b', 'tool_call', 's1', { source: 'S2', sourceEpoch: 'E', sequence: 9 }),
  ]);
  assert.deepEqual(report.sequenceGaps, []);
});

test('sessionsWithNoEvents is null when never assessed, and sorted when it is', () => {
  const one = make('o1', 'tool_call', 's1');
  // Omitted knownSessions must NOT read as "none missing".
  assert.equal(coverage([one]).sessionsWithNoEvents, null);
  // Supplied, out of alphabetical order, so the sort is load-bearing.
  assert.deepEqual(
    coverage([one], { knownSessions: ['zz', 's1', 'aa', 'mm'] }).sessionsWithNoEvents,
    ['aa', 'mm', 'zz'],
  );
  // Explicitly EMPTY is not the same as omitted: "I know of no sessions, and
  // none are missing" must read as [] and not collapse into null. Its sibling
  // downgradedAnchors has this case; without it here, an implementation folding
  // empty into the undefined branch passes the whole file.
  assert.deepEqual(coverage([one], { knownSessions: [] }).sessionsWithNoEvents, []);
});

test('downgradedAnchors passes its contents through, not just its emptiness', () => {
  // An implementation returning [] whenever the option is present would swallow
  // real downgrade data and still satisfy a null-vs-empty test.
  const report = coverage([make('o1', 'tool_call', 's1')], { downgradedAnchors: ['d1', 'd2'] });
  assert.deepEqual(report.downgradedAnchors, ['d1', 'd2']);
});

test('a void defaults context as well as provenance, and can name a human', () => {
  const base = {
    source: 'h/m/s1/a', sourceEpoch: 'e1', time: '2026-09-07T10:00:00.000Z',
    workspace: 'ws', session: 's1', agent: 'a', harness: 'claude-code', reason: 'refused',
  };
  const d = voidEvent({ ...base, id: 'v1' });
  assert.equal(d.context, 'coding');
  assert.equal(d.author, 'agent');
  // A human running the CLI and hitting a refusal is not an agent failure.
  const h = voidEvent({ ...base, id: 'v2', author: 'human', provenance: 'cli' });
  assert.equal(h.author, 'human');
});

test('a space in source or epoch cannot fake a sequence gap', () => {
  // Under a bare-space join these two collide on the key "foo bar baz", their
  // sequences merge to [1, 5], and a phantom gap is reported across two
  // unrelated sources. Task 5 fixed the same collision in read.ts.
  const report = coverage([
    make('one', 'tool_call', 's1', { source: 'foo', sourceEpoch: 'bar baz', sequence: 1 }),
    make('two', 'tool_call', 's1', { source: 'foo bar', sourceEpoch: 'baz', sequence: 5 }),
  ]);
  assert.deepEqual(report.sequenceGaps, []);
});
