import test from 'node:test';
import assert from 'node:assert/strict';
import { TerminalDecision } from '../src/setup/terminal.ts';

test('terminal decision refuses invented durability and never retries a finalized frame', () => {
  const initial = new TerminalDecision();
  assert.throws(() => initial.finishCriticalSection(true), { code: 'INVALID' });
  for (const durable of [true, false]) {
    const model = new TerminalDecision();
    model.establishQuiescence();
    assert.equal(model.enterCriticalSection(), true);
    model.finishCriticalSection(durable);
    assert.deepEqual(model.finalizeReplies(), [durable ? 'begin-result' : 'begin-error']);
    assert.equal(model.cancel(), 'terminal');
    assert.deepEqual(model.finalizeReplies(), ['cancel-ack']);
    assert.deepEqual(model.finalizeReplies(), []);
    assert.throws(() => model.finishCriticalSection(!durable), { code: 'INVALID' });
  }
});

test('disconnect queues in critical section and suppresses delivery without changing terminal win', () => {
  const initial = new TerminalDecision();
  initial.disconnect();
  initial.establishQuiescence();
  assert.equal(initial.enterCriticalSection(), false);
  assert.deepEqual(initial.finalizeReplies(), []);
  for (const durable of [true, false]) {
    const model = new TerminalDecision();
    model.establishQuiescence();
    assert.equal(model.enterCriticalSection(), true);
    model.disconnect();
    model.finishCriticalSection(durable);
    assert.deepEqual(model.finalizeReplies(), []);
    assert.equal(model.outcome, durable ? 'success' : 'failure');
  }
});

test('terminal decision serializes cancellation against durability, not result visibility', async () => {
  const modulePath = '../src/setup/terminal.ts';
  const { TerminalDecision } = await import(modulePath);
  const early = new TerminalDecision();
  assert.equal(early.cancel(), 'accepted');
  assert.equal(early.enterCriticalSection(), false);
  assert.deepEqual(early.finalizeReplies(), []);
  early.establishQuiescence();
  assert.deepEqual(early.finalizeReplies(), ['begin-error', 'cancel-ack']);
  assert.deepEqual(early.finalizeReplies(), []);
  const late = new TerminalDecision();
  late.establishQuiescence();
  assert.equal(late.enterCriticalSection(), true);
  assert.equal(late.cancel(), 'queued');
  assert.deepEqual(late.finalizeReplies(), []);
  late.finishCriticalSection(true);
  assert.deepEqual(late.finalizeReplies(), ['begin-result', 'cancel-ack']);
  assert.deepEqual(late.finalizeReplies(), []);
});
