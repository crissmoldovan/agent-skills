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

test('a session with observations and no entries is reported', () => {
  const report = coverage([make('o1', 'tool_call', 's1'), make('d1', 'decision', 's2')]);
  assert.deepEqual(report.sessionsWithNoEntries, ['s1']);
  assert.equal(report.sessions, 2);
});

test('void events are counted', () => {
  const v = voidEvent({
    id: 'v1', source: 'h/m/s1/a', sourceEpoch: 'e1', time: '2026-09-07T10:00:00.000Z',
    workspace: 'ws', session: 's1', agent: 'a', harness: 'claude-code',
    reason: 'hook failed', detail: 'exit 1',
  });
  assert.equal(v.kind, 'void');
  assert.equal(coverage([v]).voids, 1);
});

test('a gap in a source sequence is detected', () => {
  const report = coverage([
    make('a', 'tool_call', 's1', { sequence: 1 }),
    make('b', 'tool_call', 's1', { sequence: 4 }),
  ]);
  assert.equal(report.sequenceGaps.length, 1);
});
