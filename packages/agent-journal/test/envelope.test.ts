import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvent } from '../src/envelope.ts';

const base = {
  schemaVersion: 1,
  id: 'e1',
  source: 'claude-code/machine-a/sess-1/agent-0',
  sourceEpoch: 'epoch-1',
  time: '2026-09-07T10:00:00.000Z',
  workspace: 'ws-1',
  session: 'sess-1',
  agent: 'agent-0',
  author: 'agent',
  provenance: 'cli',
  harness: 'claude-code',
  context: 'coding',
  kind: 'decision',
  data: {},
};

test('accepts a minimal valid event', () => {
  const e = normalizeEvent(base);
  assert.equal(e.id, 'e1');
  assert.equal(e.context, 'coding');
});

test('omitted capabilities default to unknown, never to known', () => {
  const e = normalizeEvent(base);
  assert.equal(e.capabilities.commit, 'unknown');
  assert.equal(e.capabilities.tool_use, 'unknown');
});

test('an unregistered context passes through rather than erroring', () => {
  const e = normalizeEvent({ ...base, context: 'gardening' });
  assert.equal(e.context, 'gardening');
});

test('rejects a non-RFC3339 time', () => {
  assert.throws(() => normalizeEvent({ ...base, time: '2026-09-07 10:00:00' }), /RFC3339/);
});

test('rejects an unknown author', () => {
  assert.throws(() => normalizeEvent({ ...base, author: 'robot' }), /author/);
});

test('rejects a negative sequence', () => {
  assert.throws(() => normalizeEvent({ ...base, sequence: -1 }), /sequence/);
});
