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
