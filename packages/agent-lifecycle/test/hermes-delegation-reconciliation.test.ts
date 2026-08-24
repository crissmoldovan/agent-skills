import { deepEqual, equal, throws } from 'node:assert/strict';
import { test } from 'node:test';

import {
  normalizeHermesDelegationEvent,
  reconcileHermesDelegationStatus,
  createHermesDelegationReconciler,
} from '../src/hermes-delegation-reconciliation.ts';

test('normalizes documented native spawn_requested payload aliases into a created lifecycle input', () => {
  const input = normalizeHermesDelegationEvent({
    type: 'subagent.spawn_requested',
    subagent_id: ' child-a ',
    parent_id: ' parent-session ',
    child_session_id: ' child-session ',
    goal: ' Run the test suite ',
    model: ' hermes-4 ',
    observed_at: '2026-08-24T09:00:00.000Z',
  });

  deepEqual(input, {
    kind: 'created',
    childId: 'child-a',
    sessionId: 'child-session',
    parentId: 'parent-session',
    state: 'created',
    observedAt: '2026-08-24T09:00:00.000Z',
    activity: 'Run the test suite',
    model: 'hermes-4',
  });
});

test('normalizes a native complete event with an exact terminal status and completion details', () => {
  const input = normalizeHermesDelegationEvent({
    type: 'subagent.complete', child_id: 'child-a', session_id: 'session-a', status: 'failed',
    summary: 'test failure', duration: '1200', tokens: '300', files: 'src/a.ts', output_tail: 'Error: boom',
    observed_at: '2026-08-24T09:01:00.000Z',
  });

  deepEqual(input, {
    kind: 'state_changed', childId: 'child-a', sessionId: 'session-a', state: 'failed', status: 'failed',
    summary: 'test failure', duration: '1200', tokens: '300', files: 'src/a.ts', outputTail: 'Error: boom',
    observedAt: '2026-08-24T09:01:00.000Z',
  });
});

test('normalizes all native active lifecycle event kinds and active complete status', () => {
  for (const type of ['subagent.start', 'subagent.thinking', 'subagent.tool', 'subagent.progress']) {
    const input = normalizeHermesDelegationEvent({
      type, child_id: 'child-a', session_id: 'session-a', observed_at: '2026-08-24T09:01:00.000Z',
    });
    equal(input.state, 'running');
  }
  equal(normalizeHermesDelegationEvent({
    type: 'subagent.complete', child_id: 'child-a', session_id: 'session-a', status: 'running', observed_at: '2026-08-24T09:01:00.000Z',
  }).state, 'running');
});

test('normalizes a live Hermes subagent tool event into lifecycle activity', () => {
  const input = normalizeHermesDelegationEvent({
    type: 'subagent.tool.started',
    child_id: ' child-a ',
    session_id: ' session-a ',
    tool_name: ' terminal ',
    activity: ' npm test ',
    observed_at: '2026-08-24T09:00:00.000Z',
  });

  deepEqual(input, {
    kind: 'activity',
    childId: 'child-a',
    sessionId: 'session-a',
    state: 'running',
    observedAt: '2026-08-24T09:00:00.000Z',
    currentTool: 'terminal',
    activity: 'npm test',
  });
});

test('does not mark a local running delegation complete or lost when an incomplete snapshot omits it', () => {
  const result = reconcileHermesDelegationStatus({
    observedAt: '2026-08-24T09:05:00.000Z', delegations: [], complete: false,
  }, [{
    childId: 'child-a', sessionId: 'session-a', state: 'running', observedAt: '2026-08-24T09:00:00.000Z',
  }]);

  deepEqual(result, { inputs: [], intents: [] });
});

test('emits a stale unknown intent only after complete snapshot coverage and grace', () => {
  const local = [{ childId: 'child-a', sessionId: 'session-a', state: 'running' as const, observedAt: '2026-08-24T09:00:00.000Z' }];
  const first = reconcileHermesDelegationStatus({
    observedAt: '2026-08-24T09:05:00.000Z', delegations: [], complete: true,
  }, local, { missingGraceSnapshots: 2 });
  const second = reconcileHermesDelegationStatus({
    observedAt: '2026-08-24T09:06:00.000Z', delegations: [], complete: true,
  }, local, { missingGraceSnapshots: 2, consecutiveCompleteMisses: { 'child-a\u0000session-a': 1 } });

  deepEqual(first, { inputs: [], intents: [] });
  deepEqual(second.intents, [{
    kind: 'mark_stale_unknown', childId: 'child-a', sessionId: 'session-a', from: 'running', reason: 'complete_snapshot_missing',
  }]);
});

test('coalesces overlapping reconciliation requests into the first request reason', async () => {
  let resolveFetch!: (snapshot: { observedAt: string; delegations: []; complete: true }) => void;
  const reasons: string[] = [];
  const reconciler = createHermesDelegationReconciler({
    clock: () => 10,
    intervalMs: 1,
    fetchStatus: (reason) => new Promise((resolve) => { reasons.push(reason); resolveFetch = resolve; }),
  });
  const first = reconciler.sessionOpened();
  const second = reconciler.reconnected();
  deepEqual(reasons, ['session_open']);
  resolveFetch({ observedAt: '2026-08-24T09:05:00.000Z', delegations: [], complete: true });
  await Promise.all([first, second]);

  deepEqual(reasons, ['session_open']);
  throws(() => createHermesDelegationReconciler({
    clock: () => 0, intervalMs: 0, fetchStatus: async () => ({ observedAt: '2026-08-24T09:05:00.000Z', delegations: [], complete: true }),
  }), /intervalMs/);
});

test('tracks complete-snapshot misses across reconciler runs before emitting stale unknown', async () => {
  const delivered: unknown[] = [];
  const reconciler = createHermesDelegationReconciler({
    clock: () => 0, intervalMs: 1,
    current: () => [{ childId: 'child-a', sessionId: 'session-a', state: 'running', observedAt: '2026-08-24T09:00:00.000Z' }],
    onReconciled: (result) => { delivered.push(result); },
    fetchStatus: async () => ({ observedAt: '2026-08-24T09:05:00.000Z', delegations: [], complete: true }),
  });

  await reconciler.sessionOpened();
  await reconciler.reconnected();

  deepEqual(delivered, [
    { inputs: [], intents: [] },
    { inputs: [], intents: [{ kind: 'mark_stale_unknown', childId: 'child-a', sessionId: 'session-a', from: 'running', reason: 'complete_snapshot_missing' }] },
  ]);
});

test('does not correct a terminal status from an incomplete snapshot', () => {
  const result = reconcileHermesDelegationStatus({
    observedAt: '2026-08-24T09:05:00.000Z',
    complete: false,
    delegations: [{ child_id: 'child-a', session_id: 'session-a', status: 'completed' }],
  }, [{
    childId: 'child-a', sessionId: 'session-a', state: 'running', observedAt: '2026-08-24T09:00:00.000Z',
  }]);

  deepEqual(result, { inputs: [], intents: [] });
});

test('adds current activity from an incomplete snapshot only when the session and nonterminal state match', () => {
  const result = reconcileHermesDelegationStatus({
    observedAt: '2026-08-24T09:05:00.000Z',
    complete: false,
    delegations: [{ child_id: 'child-a', session_id: 'session-a', status: 'running', activity: 'still testing' }],
  }, [{
    childId: 'child-a', sessionId: 'session-a', state: 'running', observedAt: '2026-08-24T09:00:00.000Z', activity: 'starting tests',
  }]);

  deepEqual(result, {
    inputs: [{
      kind: 'snapshot_reconciled', childId: 'child-a', sessionId: 'session-a', state: 'running', observedAt: '2026-08-24T09:05:00.000Z', activity: 'still testing',
    }],
    intents: [],
  });
});

test('does not treat a same-child cross-session record as a correction or presence for omission grace', () => {
  const result = reconcileHermesDelegationStatus({
    observedAt: '2026-08-24T09:05:00.000Z',
    complete: true,
    delegations: [{ child_id: 'child-a', session_id: 'other-session', status: 'completed' }],
  }, [{
    childId: 'child-a', sessionId: 'session-a', state: 'running', observedAt: '2026-08-24T09:00:00.000Z',
  }], { missingGraceSnapshots: 1 });

  deepEqual(result, {
    inputs: [{
      kind: 'snapshot_reconciled', childId: 'child-a', sessionId: 'other-session', state: 'completed', observedAt: '2026-08-24T09:05:00.000Z',
    }],
    intents: [{ kind: 'mark_stale_unknown', childId: 'child-a', sessionId: 'session-a', from: 'running', reason: 'complete_snapshot_missing' }],
  });
});

test('does not advance omission grace for an incomplete reconciler snapshot', async () => {
  const delivered: unknown[] = [];
  const snapshots = [
    { observedAt: '2026-08-24T09:05:00.000Z', delegations: [], complete: false },
    { observedAt: '2026-08-24T09:06:00.000Z', delegations: [], complete: true },
    { observedAt: '2026-08-24T09:07:00.000Z', delegations: [], complete: true },
  ];
  const reconciler = createHermesDelegationReconciler({
    clock: () => 0, intervalMs: 1,
    current: () => [{ childId: 'child-a', sessionId: 'session-a', state: 'running', observedAt: '2026-08-24T09:00:00.000Z' }],
    onReconciled: (result) => { delivered.push(result); },
    fetchStatus: async () => snapshots.shift()!,
  });

  await reconciler.sessionOpened();
  await reconciler.reconnected();
  await reconciler.reconnected();

  deepEqual(delivered, [
    { inputs: [], intents: [] },
    { inputs: [], intents: [] },
    { inputs: [], intents: [{ kind: 'mark_stale_unknown', childId: 'child-a', sessionId: 'session-a', from: 'running', reason: 'complete_snapshot_missing' }] },
  ]);
});

test('reconciles complete authoritative delegation status records by child id and emits correction intent', () => {
  const result = reconcileHermesDelegationStatus({
    observedAt: '2026-08-24T09:05:00.000Z',
    complete: true,
    delegations: [{
      child_id: 'child-a',
      session_id: 'session-a',
      status: 'completed',
      current_tool: 'terminal',
      activity: 'tests passed',
    }],
  }, [{
    childId: 'child-a',
    sessionId: 'session-a',
    state: 'running',
    observedAt: '2026-08-24T09:00:00.000Z',
    currentTool: 'terminal',
    activity: 'npm test',
  }]);

  equal(result.inputs.length, 1);
  deepEqual(result.inputs[0], {
    kind: 'snapshot_reconciled',
    childId: 'child-a',
    sessionId: 'session-a',
    state: 'completed',
    observedAt: '2026-08-24T09:05:00.000Z',
    currentTool: 'terminal',
    activity: 'tests passed',
  });
  deepEqual(result.intents, [{
    kind: 'correct_projection',
    childId: 'child-a',
    sessionId: 'session-a',
    from: 'running',
    to: 'completed',
    reason: 'authoritative_snapshot',
  }]);
});

test('keeps simultaneous reused child ids isolated by session for snapshots, corrections, and omission grace', () => {
  const current = [
    { childId: 'child-a', sessionId: 'old-session', state: 'running' as const, observedAt: '2026-08-24T09:00:00.000Z' },
    { childId: 'child-a', sessionId: 'new-session', state: 'waiting' as const, observedAt: '2026-08-24T09:01:00.000Z' },
  ];
  const result = reconcileHermesDelegationStatus({
    observedAt: '2026-08-24T09:05:00.000Z',
    complete: true,
    delegations: [
      { child_id: 'child-a', session_id: 'old-session', status: 'completed' },
      { child_id: 'child-a', session_id: 'new-session', status: 'waiting' },
    ],
  }, current, { missingGraceSnapshots: 2 });
  const missingOldSession = reconcileHermesDelegationStatus({
    observedAt: '2026-08-24T09:06:00.000Z',
    complete: true,
    delegations: [{ child_id: 'child-a', session_id: 'new-session', status: 'waiting' }],
  }, current, {
    missingGraceSnapshots: 2,
    consecutiveCompleteMisses: { 'child-a\u0000old-session': 1 },
  });

  deepEqual(result, {
    inputs: [{
      kind: 'snapshot_reconciled', childId: 'child-a', sessionId: 'old-session', state: 'completed', observedAt: '2026-08-24T09:05:00.000Z',
    }],
    intents: [{
      kind: 'correct_projection', childId: 'child-a', sessionId: 'old-session', from: 'running', to: 'completed', reason: 'authoritative_snapshot',
    }],
  });
  deepEqual(missingOldSession.intents, [{
    kind: 'mark_stale_unknown', childId: 'child-a', sessionId: 'old-session', from: 'running', reason: 'complete_snapshot_missing',
  }]);
});

test('requests snapshots on session open, reconnect, and elapsed periodic intervals', async () => {
  let now = 0;
  const reasons: string[] = [];
  const reconciler = createHermesDelegationReconciler({
    clock: () => now,
    intervalMs: 30_000,
    fetchStatus: async (reason) => {
      reasons.push(reason);
      return { observedAt: '2026-08-24T09:05:00.000Z', delegations: [] };
    },
  });

  await reconciler.sessionOpened();
  await reconciler.reconnected();
  now = 29_999;
  equal(await reconciler.reconcileIfDue(), false);
  now = 30_000;
  equal(await reconciler.reconcileIfDue(), true);

  deepEqual(reasons, ['session_open', 'reconnect', 'periodic']);
});

test('delivers session-open reconciliation inputs and intents to an injected sink', async () => {
  let delivered: unknown;
  const reconciler = createHermesDelegationReconciler({
    clock: () => 0,
    intervalMs: 30_000,
    current: () => [{
      childId: 'child-a', sessionId: 'session-a', state: 'running', observedAt: '2026-08-24T09:00:00.000Z',
    }],
    onReconciled: (result) => { delivered = result; },
    fetchStatus: async () => ({
      observedAt: '2026-08-24T09:05:00.000Z',
      complete: true,
      delegations: [{ child_id: 'child-a', session_id: 'session-a', status: 'completed' }],
    }),
  });

  await reconciler.sessionOpened();

  deepEqual(delivered, {
    inputs: [{
      kind: 'snapshot_reconciled', childId: 'child-a', sessionId: 'session-a', state: 'completed', observedAt: '2026-08-24T09:05:00.000Z',
    }],
    intents: [{
      kind: 'correct_projection', childId: 'child-a', sessionId: 'session-a', from: 'running', to: 'completed', reason: 'authoritative_snapshot',
    }],
  });
});
