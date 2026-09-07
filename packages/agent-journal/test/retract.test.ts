import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project } from '../src/retract.ts';
import { normalizeEvent } from '../src/envelope.ts';

function entry(id: string, data: Record<string, unknown> = {}) {
  return normalizeEvent({
    schemaVersion: 1, id, source: 'h/m/s/a', sourceEpoch: 'e1',
    time: '2026-09-07T10:00:00.000Z', workspace: 'ws', session: 's', agent: 'a',
    author: 'agent', provenance: 'cli', harness: 'claude-code', context: 'coding',
    kind: 'decision', data,
  });
}

test('a superseded entry leaves the live set but is not invalidated', () => {
  const p = project([entry('old'), entry('new', { supersedes: 'old' })]);
  assert.ok(p.superseded.has('old'));
  assert.equal(p.invalidated.has('old'), false);
  assert.deepEqual(p.live.map((e) => e.id), ['new']);
});

test('an invalidated entry is suppressed and marked', () => {
  const p = project([entry('wrong'), entry('fix', { invalidates: 'wrong' })]);
  assert.ok(p.invalidated.has('wrong'));
  assert.equal(p.outcomes.get('wrong'), 'invalidated');
});

test('invalidation suppresses entries that rest on the invalidated one', () => {
  const p = project([
    entry('root'),
    entry('child', { influences: [{ type: 'journal', ref: 'root' }] }),
    entry('retraction', { invalidates: 'root' }),
  ]);
  assert.ok(p.invalidated.has('child'), 'descendant should be suppressed');
  assert.equal(p.live.some((e) => e.id === 'child'), false);
});

test('invalidation propagates through a CHAIN, not just one level', () => {
  // A <- B <- C, with C placed BEFORE B in the array. A single pass visits C
  // while B is not yet marked, so it misses C entirely and stops one level
  // short. Only a fixed-point loop catches it. The single-level test above
  // passes against a single-pass implementation, so this one is the real guard.
  const p = project([
    entry('A'),
    entry('C', { influences: [{ type: 'journal', ref: 'B' }] }),
    entry('B', { influences: [{ type: 'journal', ref: 'A' }] }),
    entry('R', { invalidates: 'A' }),
  ]);
  assert.ok(p.invalidated.has('B'), 'direct descendant suppressed');
  assert.ok(p.invalidated.has('C'), 'transitive descendant suppressed');
  assert.equal(p.live.some((e) => e.id === 'C'), false);
});

test('an entry nobody revisited reports outcome unknown, not held', () => {
  assert.equal(project([entry('lonely')]).outcomes.get('lonely'), 'unknown');
});

test('a human retraction from outside a session is honoured', () => {
  const human = normalizeEvent({
    schemaVersion: 1, id: 'r1', source: 'cli/m/-/-', sourceEpoch: 'e2',
    time: '2026-09-07T12:00:00.000Z', workspace: 'ws', session: '-', agent: '-',
    author: 'human', provenance: 'cli', harness: 'other', context: 'coding',
    kind: 'decision', data: { invalidates: 'bad', rationale: 'premise never held' },
  });
  assert.ok(project([entry('bad'), human]).invalidated.has('bad'));
});
