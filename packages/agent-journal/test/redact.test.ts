import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../src/redact.ts';

// Fixtures are BUILT, never written as literals: scripts/verify-skills.mjs
// scans this file and fails on literal secret shapes and home paths.
const GH_TOKEN = `gh${'p'}_${'a1b2c3d4e5'.repeat(3)}`;
const HOME_NODE = ['', 'Users', 'alice', '.local', 'bin', 'node'].join('/');

test('redacts a secret in free text, not just under a suspicious key', () => {
  const r = redact({ rationale: `used ${GH_TOKEN} to fetch it` });
  assert.equal(r.verdict, 'redacted');
  assert.match(JSON.stringify(r.value), /\[REDACTED]/);
  assert.doesNotMatch(JSON.stringify(r.value), /a1b2c3d4e5/);
});

test('redacts an email address appearing in an excerpt', () => {
  const r = redact({ excerpt: 'raised by someone@example.com in review' });
  assert.equal(r.verdict, 'redacted');
  assert.doesNotMatch(JSON.stringify(r.value), /someone@example\.com/);
});

test('redacts a home directory path that leaks a username', () => {
  const r = redact({ environment: { node: HOME_NODE } });
  assert.equal(r.verdict, 'redacted');
  assert.doesNotMatch(JSON.stringify(r.value), /alice/);
});

test('leaves clean content untouched and reports clean', () => {
  const r = redact({ rationale: 'chose the projector because reconnect had to converge' });
  assert.equal(r.verdict, 'clean');
  assert.deepEqual([...r.hits], []);
});

test('reports a failure verdict when input exceeds the scan budget', () => {
  const r = redact({ blob: 'x'.repeat(200000) }, { maxBytes: 1024 });
  assert.equal(r.verdict, 'failed');
  assert.match(r.reason ?? '', /budget/);
});

test('reports a failure verdict on a value it cannot serialize', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const r = redact(cyclic);
  assert.equal(r.verdict, 'failed');
});

test('a secret inside a boxed String is redacted, not decomposed', () => {
  const r = redact({ rationale: new String(`used ${GH_TOKEN}`) });
  assert.equal(r.verdict, 'redacted');
  assert.doesNotMatch(JSON.stringify(r.value), /a1b2c3d4e5/);
});

test('a secret inside a Buffer is redacted — execSync returns Buffers by default', () => {
  const r = redact({ environment: { raw: Buffer.from(GH_TOKEN) } });
  assert.equal(r.verdict, 'redacted');
  assert.doesNotMatch(JSON.stringify(r.value), /a1b2c3d4e5/);
});

test('a Date is scanned via toJSON rather than silently becoming {}', () => {
  const r = redact({ environment: { at: new Date('2026-09-07T10:00:00.000Z') } });
  assert.equal(r.verdict, 'clean');
  assert.match(JSON.stringify(r.value), /2026-09-07T10:00:00/);
});

test('the depth guard fails closed and reports no partial hits', () => {
  let deep: Record<string, unknown> = { leaf: GH_TOKEN };
  for (let i = 0; i < 40; i += 1) deep = { nest: deep };
  const r = redact(deep, { maxDepth: 8 });
  assert.equal(r.verdict, 'failed');
  assert.equal(r.value, undefined);
  assert.deepEqual([...r.hits], []);
});

// Every pattern below was anchored with \b on both ends. A word boundary cannot
// exist between an alphanumeric and `_`, and `_` is exactly what surrounds a
// secret in the two places secrets actually appear in prose: an env var
// assignment (GITHUB_TOKEN=ghp_...) and a suffixed note (..._rotated). The
// pattern therefore could not fire, the verdict was `clean`, and the credential
// reached disk byte-for-byte. Every existing fixture delimited its token with a
// space, so nothing could catch it.
test('a secret still redacts when a word character abuts it', () => {
  // Composed from parts on purpose: a literal token here would match the
  // repository's own secret scanner (scripts/verify-skills.mjs), which is doing
  // exactly its job. The runtime values are the shapes the patterns must catch.
  const run = 'a1b2c3d4e5';
  const cases: readonly [string, string][] = [
    ['github-token', 'ghp' + '_' + run.repeat(3)],
    ['openai-key', 'sk' + '-' + run.repeat(3)],
    ['aws-access-key', 'AKIA' + 'IOSFODNN7EXAMPLE'],
    ['jwt', 'eyJ' + 'hbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU'],
    ['bearer', 'Bearer ' + run.repeat(2)],
    ['email', 'someone@example.com'],
  ];
  // The four adjacencies that occur in real prose around a credential.
  const frames: readonly ((s: string) => string)[] = [
    (s) => `X_${s}`,
    (s) => `${s}_rotated`,
    (s) => `KEY=${s}_old`,
    (s) => `9${s}`,
  ];
  for (const [name, secret] of cases) {
    for (const frame of frames) {
      const subject = frame(secret);
      const r = redact({ note: `we used ${subject} yesterday` });
      const written = JSON.stringify(r.value);
      assert.ok(
        !written.includes(secret),
        `${name} leaked through ${JSON.stringify(subject)}: verdict ${r.verdict}, wrote ${written}`,
      );
    }
  }
});

// The existing depth-guard fixture put its only secret BELOW the depth limit, so
// the throw happened before any hit was recorded and `hits.length = 0` could be
// deleted with nothing failing. This fixture records a hit at a shallow depth
// and only then exceeds the limit, which is the state the reset exists for.
test('a failed verdict reports no partial hits, even when one was already found', () => {
  const secret = 'ghp' + '_' + 'a1b2c3d4e5'.repeat(3);
  let deep: Record<string, unknown> = { bottom: true };
  for (let i = 0; i < 40; i += 1) deep = { next: deep };
  const r = redact({ shallow: `token ${secret}`, deep });

  assert.equal(r.verdict, 'failed', 'the depth guard did not fire');
  assert.deepEqual([...r.hits], [],
    `a failed verdict leaked partial hits: ${JSON.stringify(r.hits)}`);
  assert.equal(r.value, undefined);
});
