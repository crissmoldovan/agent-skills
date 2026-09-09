import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consequencesIn } from '../src/consequence.ts';
import { normalizeEvent } from '../src/envelope.ts';

function obs(id: string, kind: string, data: Record<string, unknown>, time = '2026-09-09T10:00:00.000Z') {
  return normalizeEvent({
    schemaVersion: 1, id, source: 'hook/h/s/a', sourceEpoch: 'e1', time,
    workspace: 'ws', session: 's', agent: 'a', author: 'agent', provenance: 'hook',
    harness: 'test', context: 'coding', kind, data,
  });
}
const bash = (id: string, input: string, time?: string) =>
  obs(id, 'tool_call', { tool: 'Bash', input }, time);

test('a secret or config mutation is consequence-bearing', () => {
  const cases = [
    'wrangler secret put API_KEY',
    'gh variable set ENFORCE_AUTH --body true',
    'kubectl set env deployment/api FEATURE_X=on',
    'aws ssm put-parameter --name /prod/flag --value on',
  ];
  for (const input of cases) {
    const got = consequencesIn([bash('o1', input)]);
    assert.equal(got.length, 1, `not flagged: ${input}`);
    assert.equal(got[0]!.rule, 'mutation');
    assert.equal(got[0]!.observationId, 'o1');
  }
});

// The cost of a pattern-matcher is false positives, and a floor that fires on
// ordinary work is one people switch off — which captures nothing at all.
test('reading configuration is not mutating it', () => {
  const benign = [
    'wrangler secret list',
    'gh variable list',
    'kubectl get deployment/api -o yaml',
    'cat .env.example',
    'grep -r FEATURE_X src/',
    'git log --oneline -20',
  ];
  for (const input of benign) {
    assert.deepEqual(consequencesIn([bash('o1', input)]), [], `false positive: ${input}`);
  }
});

test('a permission observation is consequence-bearing whatever its decision', () => {
  for (const decision of ['granted', 'denied']) {
    const got = consequencesIn([obs('p1', 'permission', { tool: 'Bash', decision })]);
    assert.equal(got.length, 1, `not flagged: ${decision}`);
    assert.equal(got[0]!.rule, 'permission');
  }
});

// "Unfamiliar" means absent from THIS journal. That is a weaker claim than
// "new", and the detail must not imply otherwise.
test('a host seen before in this journal is not unfamiliar', () => {
  const events = [
    bash('o1', 'curl https://api.example.com/v1/flags', '2026-09-08T10:00:00.000Z'),
    bash('o2', 'curl https://api.example.com/v1/other', '2026-09-09T10:00:00.000Z'),
  ];
  const got = consequencesIn(events).filter((c) => c.rule === 'unfamiliar-api');
  assert.deepEqual(got.map((c) => c.observationId), ['o1'],
    'the second call to a known host was flagged as unfamiliar');
});

test('an observation is reported once even when several rules match', () => {
  // A mutation against an unfamiliar host is one thing that happened.
  const got = consequencesIn([bash('o1', 'curl -X POST https://new.example.com/admin/flags')]);
  assert.equal(new Set(got.map((c) => c.observationId)).size, got.length,
    `one observation produced duplicate consequences: ${JSON.stringify(got)}`);
});

// Not in the Task 1 brief verbatim. `curl -X POST` above is deliberately
// unrecognised by MUTATION_PATTERNS (see its own doc comment), so that test
// exercises dedupe only vacuously — a single rule fires either way, so
// dropping the per-observation dedupe leaves it unchanged (confirmed by
// mutation-testing this file; see the Task 1 report). This one constructs an
// input where mutation AND unfamiliar-api genuinely both match the same
// observation, so dedupe has something real to do.
test('mutation and unfamiliar-api both matching one observation still yields one consequence', () => {
  const got = consequencesIn([
    bash('o1', 'aws ssm put-parameter --name /prod/flag --value on --endpoint-url https://ssm.internal.example.com'),
  ]);
  assert.equal(got.length, 1, `expected exactly one consequence, got: ${JSON.stringify(got)}`);
  assert.equal(got[0]!.rule, 'mutation');
});

test('entries are not observations and produce nothing', () => {
  const entry = normalizeEvent({
    schemaVersion: 1, id: 'e1', source: 'cli/h/s/a', sourceEpoch: 'e1',
    time: '2026-09-09T10:00:00.000Z', workspace: 'ws', session: 's', agent: 'a',
    author: 'agent', provenance: 'cli', harness: 'test', context: 'coding',
    kind: 'decision', data: { question: 'q', chosen: 'wrangler secret put X' },
  });
  assert.deepEqual(consequencesIn([entry]), [],
    'a decision that merely mentions a mutation was treated as one');
});

test('since narrows to what happened after a point, exclusive of it', () => {
  const events = [
    bash('old', 'wrangler secret put A', '2026-09-08T10:00:00.000Z'),
    bash('new', 'wrangler secret put B', '2026-09-09T10:00:00.000Z'),
  ];
  const got = consequencesIn(events, { since: '2026-09-08T10:00:00.000Z' });
  assert.deepEqual(got.map((c) => c.observationId), ['new']);
});

// A tool_call with no input cannot be classified, and guessing would be worse
// than saying nothing.
test('an observation with nothing to match on produces nothing, not a guess', () => {
  assert.deepEqual(consequencesIn([obs('o1', 'tool_call', { tool: 'Bash' })]), []);
});
