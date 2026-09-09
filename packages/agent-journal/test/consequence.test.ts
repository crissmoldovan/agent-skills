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

// A preview flag turns a mutating verb into a no-op, so matching it is a pure
// false positive. This was inconsistent before: the same "the preview is a
// same-verb flag" reasoning was used to EXCLUDE `wrangler deploy` and
// `kubectl apply`, while `kubectl set env` was included and fired on its own
// dry run. The rule now applies to every pattern rather than to the ones
// somebody remembered.
test('a preview flag is not a mutation, whichever pattern would have matched', () => {
  const previews = [
    'kubectl set env deployment/api FEATURE_X=on --dry-run=client',
    'kubectl set env deployment/api FEATURE_X=on --dry-run=server',
    'kubectl delete secret my-secret --dry-run=client',
    'aws ssm put-parameter --name /prod/flag --value on --dry-run',
  ];
  for (const input of previews) {
    assert.deepEqual(consequencesIn([bash('o1', input)]).filter((c) => c.rule === 'mutation'), [],
      `a dry run was reported as a mutation: ${input}`);
  }
});

// The matcher sees one flat string, so without stripping quoted spans it cannot
// tell the command from its arguments. Every one of these fired before: the
// actual commands are grep, git, echo and cat.
test('a mutation quoted inside another command is not a mutation', () => {
  const quoted = [
    'grep -rn "gh variable set" .',
    "grep -r 'kubectl set env' docs/",
    'git commit -m "wrangler secret put reminder"',
    'echo "wrangler secret put X" >> notes.md',
    'git log --grep "secret put"',
    "cat <<'EOF' > notes.md\nwrangler secret put API_KEY\nEOF",
  ];
  for (const input of quoted) {
    assert.deepEqual(consequencesIn([bash('o1', input)]).filter((c) => c.rule === 'mutation'), [],
      `quoted text was read as a command: ${JSON.stringify(input)}`);
  }
});

// ...and the stripping must not eat the real cases, which is the failure mode
// the fix above could plausibly introduce.
test('a real mutation with a quoted argument still matches', () => {
  const real = [
    'wrangler secret put "API_KEY"',
    "gh variable set ENFORCE_AUTH --body 'true'",
    'aws ssm put-parameter --name "/prod/flag" --value "on"',
    // The pattern AFTER a quoted span, which is the only shape that can catch
    // stripping that runs on past the closing quote. In every case above the
    // pattern precedes the quote, so a greedy strip leaves them matching and
    // they cannot detect it.
    'cd "/my project" && wrangler secret put API_KEY',
    "cd '/my project' && gh variable set ENFORCE_AUTH --body true",
  ];
  for (const input of real) {
    assert.equal(consequencesIn([bash('o1', input)]).filter((c) => c.rule === 'mutation').length, 1,
      `a real mutation was lost to quote-stripping: ${input}`);
  }
});

// The first fix for false positives tested both guards against the WHOLE raw
// input, which was worse than the bug it fixed: a preview flag or a quoted word
// anywhere on the line suppressed everything, hiding mutations that really ran.
// Both guards are now per-command, and quoting removes the quote characters
// rather than their contents.
test('a preview later in the line does not hide a mutation earlier in it', () => {
  const chained = [
    'gh secret set TOKEN --body x; terraform plan --dry-run',
    'terraform plan --dry-run && wrangler secret put API_KEY',
    'wrangler secret put X # see --dry-run notes',
  ];
  for (const input of chained) {
    assert.equal(consequencesIn([bash('o1', input)]).filter((c) => c.rule === 'mutation').length, 1,
      `a real mutation was suppressed by an unrelated preview: ${input}`);
  }
});

// bash runs `wrangler secret "put" X` identically to the unquoted form, so
// stripping quoted spans made a live mutation invisible.
test('quoting a word of the command itself does not hide the mutation', () => {
  for (const input of ['wrangler secret "put" API_KEY', "gh 'secret' set TOKEN"]) {
    assert.equal(consequencesIn([bash('o1', input)]).filter((c) => c.rule === 'mutation').length, 1,
      `a quoted command token hid a real mutation: ${input}`);
  }
});

test('an unquoted comment is not a command', () => {
  assert.deepEqual(
    consequencesIn([bash('o1', 'ls # reminder: wrangler secret put X later')])
      .filter((c) => c.rule === 'mutation'),
    [], 'a comment was read as a command');
});

// The head decides whether the rest is data, so these must survive env-var
// prefixes and sudo, which change the first word without changing the command.
test('an env prefix or sudo does not hide the command', () => {
  for (const input of ['FOO=bar wrangler secret put API_KEY', 'sudo kubectl set env deploy/a A=1']) {
    assert.equal(consequencesIn([bash('o1', input)]).filter((c) => c.rule === 'mutation').length, 1,
      `the head was misread: ${input}`);
  }
});
