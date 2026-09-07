import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OBSERVATION_KINDS, fieldsForObservation, normalizeObservationData } from '../src/observe.ts';

test('the kinds are exactly spec 4.4\'s fourteen', () => {
  assert.deepEqual([...OBSERVATION_KINDS], [
    'session_start', 'session_end', 'turn_end', 'tool_call', 'tool_result', 'tool_failure',
    'permission', 'subagent_start', 'subagent_stop', 'compact', 'heartbeat', 'environment',
    'path_claim', 'void',
  ]);
});

test('each kind carries its own fields and no other kind\'s', () => {
  assert.deepEqual([...fieldsForObservation('tool_call')], ['tool', 'input', 'callId']);
  assert.deepEqual([...fieldsForObservation('tool_failure')], ['tool', 'callId', 'error']);
  assert.deepEqual([...fieldsForObservation('heartbeat')], []);
  assert.ok(!fieldsForObservation('tool_result').includes('input'),
    'tool_result must not accept tool_call\'s input');
});

test('an unrecognised kind carries no fields rather than guessing', () => {
  assert.deepEqual([...fieldsForObservation('not_a_kind')], []);
});

// Same rule as entries: a field nobody set must not appear as '' — that claims
// assessed-and-empty where nothing was assessed.
test('a blank or unsupplied field is absent, not empty', () => {
  const data = normalizeObservationData('tool_call', new Map([
    ['tool', ['Bash']], ['input', ['   ']],
  ]));
  assert.equal(data.tool, 'Bash');
  assert.ok(!('input' in data), `input was stored as ${JSON.stringify(data.input)}`);
  assert.ok(!('callId' in data));
});
