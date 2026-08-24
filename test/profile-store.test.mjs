import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, stat, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

import { ProfileStore, deriveScopeKey, validateStore } from '../skills/model-routing/scripts/profile-store.mjs';

const roles = Object.freeze({
  driver: { provider: 'openai', model: 'gpt-5.6-sol', effort: 'high' },
  builder: { provider: 'openai', model: 'gpt-5.6-terra' },
  sweeper: { mode: 'fold-builder' },
});
const live = Object.freeze({
  ownedKeys: ['model.driver', 'model.builder'],
  prior: { 'model.driver': 'old-driver', 'model.builder': 'old-builder' },
  next: { 'model.driver': 'gpt-5.6-sol', 'model.builder': 'gpt-5.6-terra' },
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'routing-store-'));
  return { root, harness: 'hermes', scope: { kind: 'workspace', id: '/repos/acme/widget', home: '/example/hermes-home' } };
}
function input(name = 'coding', extra = {}) { return { name, roles, live, confirm: true, ...extra }; }

async function receiptFor(store, receipt) {
  return JSON.parse(await readFile(receipt.receiptPath, 'utf8'));
}

test('scope key includes harness and opaque typed scope identity', () => {
  const first = deriveScopeKey('hermes', { kind: 'workspace', id: '/repos/a/widget' });
  assert.notEqual(first, deriveScopeKey('hermes', { kind: 'workspace', id: '/repos/b/widget' }));
  assert.notEqual(first, deriveScopeKey('codex', { kind: 'workspace', id: '/repos/a/widget' }));
  assert.match(first, /^hermes--workspace-widget-[a-f0-9]{16}$/);
  assert.throws(() => deriveScopeKey('hermes', { kind: 'workspace' }), /scope.*id/i);
});

test('setup writes typed role bindings, scoped identity, and a separate nonsecret receipt', async () => {
  const options = await fixture();
  const store = new ProfileStore(options);
  const result = await store.setup(input());
  const shown = await store.show();
  assert.deepEqual(shown.store, {
    version: 2, harness: 'hermes', scope: options.scope, active: 'coding',
    profiles: { coding: { roles } },
  });
  assert.deepEqual(await receiptFor(store, result), {
    version: 1, operation: 'setup', harness: 'hermes', scope: options.scope,
    ownedKeys: live.ownedKeys, prior: live.prior, next: live.next,
    fingerprint: result.fingerprint, timestamp: result.timestamp,
    id: result.id, sequence: result.sequence,
  });
  assert.equal((await stat(result.receiptPath)).mode & 0o777, 0o600);
});

test('rejects fake sweeper models and accepts only explicit degraded modes', async () => {
  const store = new ProfileStore(await fixture());
  await assert.rejects(() => store.setup(input('bad', { roles: { ...roles, sweeper: { provider: 'local', model: 'fold-builder' } } })), /sweeper.*mode/i);
  await assert.rejects(() => store.setup(input('bad', { roles: { ...roles, sweeper: { mode: 'pretend' } } })), /fold-builder|inline-driver/i);
  const saved = await store.setup(input('inline', { roles: { ...roles, sweeper: { mode: 'inline-driver' } } }));
  assert.equal(saved.profile.roles.sweeper.mode, 'inline-driver');
});

test('refuses scope or harness collisions rather than loading a foreign store', async () => {
  const options = await fixture();
  const owner = new ProfileStore(options);
  await owner.setup(input());
  const foreign = new ProfileStore({ ...options, harness: 'codex' });
  await mkdir(foreign.directory, { recursive: true });
  await writeFile(foreign.path, await readFile(owner.path), { mode: 0o600 });
  await assert.rejects(() => foreign.show(), /harness.*mismatch/i);
  const wrongScope = new ProfileStore({ ...options, scope: { ...options.scope, id: '/repos/acme/other' } });
  await mkdir(wrongScope.directory, { recursive: true });
  await writeFile(wrongScope.path, await readFile(owner.path), { mode: 0o600 });
  await assert.rejects(() => wrongScope.show(), /scope.*mismatch/i);
});

test('clear only clears active intent, delete is narrow, and reset restores latest receipt-owned live values', async () => {
  const store = new ProfileStore(await fixture());
  await store.setup(input());
  await store.save(input('review', { roles: { ...roles, builder: { provider: 'anthropic', model: 'claude-sonnet' } } }));
  await store.clear({ live, confirm: true });
  assert.deepEqual(Object.keys((await store.show()).store.profiles).sort(), ['coding', 'review']);
  const deleteLive = { ...live, prior: { 'model.driver': 'delete-driver', 'model.builder': 'delete-builder' } };
  await store.delete({ name: 'coding', live: deleteLive, confirm: true });
  assert.deepEqual(Object.keys((await store.show()).store.profiles), ['review']);
  const reset = await store.reset({ live, confirm: true });
  assert.deepEqual(reset.restore, deleteLive.prior);
  assert.deepEqual((await store.show()).store.profiles, { review: { roles: { ...roles, builder: { provider: 'anthropic', model: 'claude-sonnet' } } } });
  assert.equal((await store.show()).store.active, null);
});

test('each mutation creates a unique receipt with a monotonic chronology sequence', async () => {
  const store = new ProfileStore(await fixture());
  const receipts = [];
  for (let index = 0; index < 8; index += 1) receipts.push(await store.save(input(`profile-${index}`)));
  const parsed = await Promise.all(receipts.map((result) => receiptFor(store, result)));
  assert.equal(new Set(receipts.map((result) => result.receiptPath)).size, receipts.length);
  assert.equal(new Set(parsed.map((receipt) => receipt.id)).size, parsed.length);
  assert.deepEqual(parsed.map((receipt) => receipt.sequence), [...parsed.keys()].map((index) => index + 1));
  assert.equal((await readdir(store.directory)).filter((name) => name.startsWith('receipt-')).length, receipts.length);
});

test('reset restores the latest receipt that is not a clear or reset operation', async () => {
  const store = new ProfileStore(await fixture());
  const original = { ...live, prior: { 'model.driver': 'original-driver', 'model.builder': 'original-builder' } };
  const cleared = { ...live, prior: { 'model.driver': 'clear-driver', 'model.builder': 'clear-builder' } };
  await store.setup(input('coding', { live: original }));
  await store.clear({ live: cleared, confirm: true });
  const result = await store.reset({ live, confirm: true });
  assert.deepEqual(result.restore, original.prior);
});

test('migration only accepts v1 JSON or YAML candidates with explicit matching scope and leaves timestamped backup', async () => {
  const options = await fixture();
  const legacy = path.join(options.root, 'legacy-v1.yaml');
  await writeFile(legacy, `scope:\n  kind: workspace\n  id: /repos/acme/widget\nactive: old\nprofiles:\n  old:\n    roles:\n      driver: openai/gpt-5.6-sol\n      builder: openai/gpt-5.6-terra\n      sweeper: fold-builder\n`);
  const store = new ProfileStore(options);
  await assert.rejects(() => store.migrate({ legacyPath: legacy, confirm: true, live }), /explicit.*scope/i);
  const result = await store.migrate({ legacyPath: legacy, scope: options.scope, confirm: true, live });
  assert.equal(result.operation, 'migrate');
  assert.match(result.backupPath, /legacy-v1\.yaml\.v1-backup-\d{8}T\d{6}Z$/);
  assert.deepEqual((await store.show()).store.profiles.old.roles.sweeper, { mode: 'fold-builder' });
  assert.equal((await readFile(result.backupPath, 'utf8')).includes('profiles:'), true);
});

test('use-once validates an ephemeral profile but writes neither store nor receipt', async () => {
  const store = new ProfileStore(await fixture());
  const result = await store.useOnce({ roles, live });
  assert.equal(result.operation, 'use-once');
  assert.equal(result.changed, false);
  assert.equal((await store.show()).store, null);
  await assert.rejects(() => readdir(store.directory), /ENOENT/);
});

function runCli(args, inputText = '') {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['skills/model-routing/scripts/profile-store-cli.mjs', ...args], { cwd: path.resolve(import.meta.dirname, '..'), stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr })); child.stdin.end(inputText);
  });
}
test('CLI exposes every contract command and gates each mutation with --confirm', async () => {
  const { root, harness, scope } = await fixture();
  const args = ['--root', root, '--harness', harness, '--scope-kind', scope.kind, '--scope', scope.id];
  const help = await runCli(['--help']);
  for (const command of ['setup', 'show', 'save', 'change', 'switch', 'clear', 'delete', 'reset', 'migrate', 'use-once']) assert.match(help.stdout, new RegExp(`\\b${command}\\b`));
  const denied = await runCli(['setup', ...args], JSON.stringify(input()));
  assert.equal(denied.status, 2); assert.match(denied.stderr, /--confirm/i);
  const oneOff = await runCli(['use-once', ...args], JSON.stringify({ roles, live }));
  assert.equal(oneOff.status, 0); assert.equal(JSON.parse(oneOff.stdout).changed, false);
});

test('24 cooperating CLI processes save without losing profiles or receipts', async () => {
  const { root, harness, scope } = await fixture();
  const args = ['--root', root, '--harness', harness, '--scope-kind', scope.kind, '--scope', scope.id, '--scope-home', scope.home];
  const jobs = Array.from({ length: 24 }, (_, index) => runCli(['save', ...args, '--confirm'], JSON.stringify(input(`concurrent-${index}`))));
  const outcomes = await Promise.all(jobs);
  assert.deepEqual(outcomes.map(({ status }) => status), Array(24).fill(0));
  const store = new ProfileStore({ root, harness, scope });
  const shown = await store.show();
  assert.equal(Object.keys(shown.store.profiles).length, 24);
  assert.equal((await readdir(store.directory)).filter((name) => name.startsWith('receipt-')).length, 24);
});

test('reclaims only a stale lock whose recorded owner PID is dead', async () => {
  const options = await fixture();
  const store = new ProfileStore(options);
  await mkdir(path.join(store.directory, '.profile-v2.lock'), { recursive: true });
  await writeFile(path.join(store.directory, '.profile-v2.lock', 'owner.json'), JSON.stringify({ token: 'orphan', pid: 999999999, createdAt: Date.now() - 61_000 }));
  await store.save(input('recovered'));
  assert.ok((await store.show()).store.profiles.recovered);
});

test('schema rejects loose strings, unknown fields, and inconsistent constructor identity', async () => {
  assert.throws(() => validateStore({ version: 2, harness: 'hermes', scope: { kind: 'workspace', id: 'x' }, active: null, profiles: { x: { roles: { ...roles, driver: 'openai/x' } } } }), /driver.*(object|fields)/i);
  const options = await fixture(); const store = new ProfileStore(options); await store.setup(input());
  const raw = JSON.parse(await readFile(store.path, 'utf8')); raw.scope.id = 'tampered'; await writeFile(store.path, JSON.stringify(raw));
  await assert.rejects(() => store.show(), /scope.*mismatch/i);
});
