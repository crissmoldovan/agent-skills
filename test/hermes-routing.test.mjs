import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { HermesRoutingAdapter } from '../skills/model-routing/scripts/hermes-routing.mjs';

const roles = Object.freeze({
  driver: { provider: 'routera', model: 'openai/gpt-driver' },
  builder: { provider: 'routera', model: 'openai/gpt-builder' },
  sweeper: { mode: 'fold-builder' },
});

const inventoryCache = Object.freeze({
  routera: { fp: 'non-secret-fingerprint', at: 1, models: ['custom/routera-only'] },
  openrouter: { fp: 'non-secret-fingerprint', at: 1, models: ['openai/gpt-builder', 'openai/gpt-driver'] },
  credentials: { api_key: 'test-key', token: 'test-token', models: ['must-not-appear'] },
});

function fakeHermes({ failSet = null } = {}) {
  let failedKey = failSet;
  const config = new Map([
    ['model.provider', 'old-provider'], ['model.default', 'old-driver'],
    ['delegation.provider', 'old-delegation-provider'], ['delegation.model', 'old-builder'],
    ['base_url', 'https://private.invalid'], ['api_key', 'top-secret'],
  ]);
  const calls = [];
  const run = async (args, options = {}) => {
    calls.push({ args: [...args], options });
    if (args[0] === 'config' && args[1] === 'get') return { code: 0, stdout: `${config.get(args[2]) ?? ''}\n`, stderr: '' };
    if (args[0] === 'config' && args[1] === 'set') {
      if (args[2] === failedKey) { failedKey = null; return { code: 1, stdout: '', stderr: 'set failed' }; }
      config.set(args[2], args[3]); return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 1, stdout: '', stderr: `unexpected ${args.join(' ')}` };
  };
  return { config, calls, run, failNext(key) { failedKey = key; } };
}
async function fixture(options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'hermes-routing-'));
  const home = path.join(root, 'hermes', 'profiles', 'work');
  const fake = fakeHermes(options);
  let inventoryLoads = 0;
  const inventoryLoader = async () => { inventoryLoads += 1; return inventoryCache; };
  return {
    root, home, fake, inventoryLoads: () => inventoryLoads,
    adapter: new HermesRoutingAdapter({ root, home, run: fake.run, inventoryLoader }),
  };
}

test('discover reads injected cache inventory, preserves configured providers, and never reads secrets', async () => {
  const { adapter, fake, home, inventoryLoads } = await fixture();
  const discovered = await adapter.discover();
  assert.deepEqual(discovered.scope, { kind: 'hermes-home', id: 'work', home });
  assert.deepEqual(discovered.inventory, {
    openrouter: ['openai/gpt-builder', 'openai/gpt-driver'],
    routera: ['custom/routera-only'],
  });
  assert.equal(inventoryLoads(), 1);
  assert.equal(discovered.roles.driver.status, 'UNBOUND');
  assert.deepEqual(discovered.roles.driver.configured, { provider: 'old-provider', model: 'old-driver' });
  assert.deepEqual(discovered.roles.builder.configured, { provider: 'old-delegation-provider', model: 'old-builder' });
  assert.equal(discovered.roles.sweeper.status, 'NOT_ADDRESSABLE');
  assert.equal(fake.calls.some(({ args }) => /api_key|base_url|models list/i.test(args.join(' '))), false);
});

test('preview validates an exact model across cached catalogs while preserving its configured provider', async () => {
  const { adapter, fake } = await fixture();
  fake.config.set('model.provider', 'routera'); fake.config.set('model.default', 'openai/gpt-driver');
  fake.config.set('delegation.provider', 'routera'); fake.config.set('delegation.model', 'old-builder');
  const preview = await adapter.preview({ roles });
  assert.equal(preview.roles.driver.status, 'MATCH');
  assert.equal(preview.roles.driver.selected, 'openai/gpt-driver');
  assert.deepEqual(preview.roles.driver.configured, { provider: 'routera', model: 'openai/gpt-driver' });
  assert.equal(preview.roles.builder.status, 'MISMATCH');
  assert.deepEqual(preview.roles.builder.configured, { provider: 'routera', model: 'old-builder' });
  assert.equal(preview.roles.sweeper.status, 'NOT_ADDRESSABLE');
  const unavailable = await adapter.preview({ roles: { ...roles, builder: { provider: 'routera', model: 'gone' } } });
  assert.equal(unavailable.roles.builder.status, 'UNAVAILABLE');
  assert.equal(fake.calls.some(({ args }) => args[0] === 'config' && args[1] === 'set'), false);
});

test('apply writes main and delegated provider/model bindings, reads back, then persists receipt', async () => {
  const { adapter, fake } = await fixture();
  const result = await adapter.setup({ name: 'coding', roles, confirm: true });
  assert.equal(result.applied, true);
  assert.equal(fake.config.get('model.provider'), 'routera');
  assert.equal(fake.config.get('model.default'), 'openai/gpt-driver');
  assert.equal(fake.config.get('delegation.provider'), 'routera');
  assert.equal(fake.config.get('delegation.model'), 'openai/gpt-builder');
  const shown = await adapter.show();
  assert.equal(shown.store.store.active, 'coding');
  assert.equal(shown.live.roles.driver.status, 'MATCH');
  assert.equal(shown.live.roles.builder.status, 'MATCH');
  const receipt = JSON.parse(await readFile(result.receiptPath, 'utf8'));
  assert.deepEqual(receipt.prior, {
    'model.provider': 'old-provider', 'model.default': 'old-driver',
    'delegation.provider': 'old-delegation-provider', 'delegation.model': 'old-builder',
  });
});

test('setup with an existing name replaces the stored profile with requested roles', async () => {
  const { adapter } = await fixture();
  const first = { ...roles, driver: { provider: 'routera', model: 'openai/gpt-driver' }, builder: { provider: 'routera', model: 'openai/gpt-builder' } };
  const replacement = { ...roles, driver: { provider: 'routera', model: 'openai/gpt-builder' }, builder: { provider: 'routera', model: 'openai/gpt-driver' } };
  await adapter.setup({ name: 'same', roles: first, confirm: true });
  const result = await adapter.setup({ name: 'same', roles: replacement, confirm: true });
  assert.deepEqual(result.profile.roles, replacement);
  assert.deepEqual((await adapter.show()).store.store.profiles.same.roles, replacement);
});

test('setup rolls host configuration back when profile persistence fails after apply', async () => {
  const { adapter, fake } = await fixture();
  await adapter.setup({ name: 'old', roles, confirm: true });
  const prior = Object.fromEntries(['model.provider', 'model.default', 'delegation.provider', 'delegation.model'].map((key) => [key, fake.config.get(key)]));
  adapter.store.setup = async () => { throw new Error('receipt write failed'); };
  await assert.rejects(adapter.setup({ name: 'new', roles: { ...roles, driver: { provider: 'routera', model: 'openai/gpt-builder' } }, confirm: true }), /receipt write failed/);
  assert.deepEqual(Object.fromEntries(['model.provider', 'model.default', 'delegation.provider', 'delegation.model'].map((key) => [key, fake.config.get(key)])), prior);
  assert.equal((await adapter.show()).store.store.active, 'old');
});

test('preview rejects a model from another catalog when the selected provider is unknown', async () => {
  const { adapter } = await fixture();
  const preview = await adapter.preview({ roles: { ...roles, driver: { provider: 'not-configured', model: 'openai/gpt-driver' } } });
  assert.equal(preview.roles.driver.status, 'UNAVAILABLE');
});

test('preview requires an exact provider cache match for non-gateway providers', async () => {
  const { adapter } = await fixture();
  const preview = await adapter.preview({ roles: { ...roles, driver: { provider: 'openrouter', model: 'custom/routera-only' } } });
  assert.equal(preview.roles.driver.status, 'UNAVAILABLE');
});

test('switch rolls host configuration back when receipt persistence fails', async () => {
  const { adapter, fake } = await fixture();
  const replacement = { ...roles, driver: { provider: 'routera', model: 'openai/gpt-builder' } };
  await adapter.setup({ name: 'old', roles, confirm: true });
  await adapter.setup({ name: 'new', roles: replacement, confirm: true });
  await adapter.switch({ name: 'old', confirm: true });
  const prior = fake.config.get('model.default');
  adapter.store.switch = async () => { throw new Error('receipt write failed'); };
  await assert.rejects(adapter.switch({ name: 'new', confirm: true }), /receipt write failed/);
  assert.equal(fake.config.get('model.default'), prior);
  assert.equal((await adapter.show()).store.store.active, 'old');
});

test('failed apply rolls back every changed provider and model binding and preserves old active pointer', async () => {
  const { adapter, fake } = await fixture();
  await adapter.setup({ name: 'old', roles: { ...roles, builder: { provider: 'routera', model: 'openai/gpt-driver' } }, confirm: true });
  fake.config.set('delegation.provider', 'old-delegation-provider'); fake.config.set('delegation.model', 'old-builder');
  fake.failNext('delegation.model');
  const failed = await adapter.setup({ name: 'new', roles, confirm: true });
  assert.equal(failed.applied, false);
  assert.equal(fake.config.get('model.provider'), 'routera');
  assert.equal(fake.config.get('model.default'), 'openai/gpt-driver');
  assert.equal(fake.config.get('delegation.provider'), 'old-delegation-provider');
  assert.equal(fake.config.get('delegation.model'), 'old-builder');
  assert.equal((await adapter.show()).store.store.active, 'old');
});

test('clear changes intent only and reset restores every receipt-owned binding safely', async () => {
  const { adapter, fake } = await fixture();
  await adapter.setup({ name: 'coding', roles, confirm: true });
  const before = fake.calls.length;
  await adapter.clear({ confirm: true });
  assert.equal(fake.calls.slice(before).some(({ args }) => args[0] === 'config' && args[1] === 'set'), false);
  await adapter.reset({ confirm: true });
  assert.equal(fake.config.get('model.provider'), 'old-provider');
  assert.equal(fake.config.get('model.default'), 'old-driver');
  assert.equal(fake.config.get('delegation.provider'), 'old-delegation-provider');
  assert.equal(fake.config.get('delegation.model'), 'old-builder');
  assert.equal((await adapter.show()).store.store.active, null);
});
