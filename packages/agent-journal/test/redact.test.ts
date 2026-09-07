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
