import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { ProfileStore } from './profile-store.mjs';

const OWNED_KEYS = Object.freeze(['model.provider', 'model.default', 'delegation.provider', 'delegation.model']);
const roleKeys = Object.freeze({
  driver: ['model.provider', 'model.default'],
  builder: ['delegation.provider', 'delegation.model'],
});
const safe = (value) => typeof value === 'string' && value.length <= 512 && !/(api[_-]?key|secret|token|password|base_url)/i.test(value);
const secretKey = (key) => /(api[_-]?key|secret|token|password|base_url|credential)/i.test(key);

function defaultRun(args, { env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('hermes', args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject); child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function defaultInventoryLoader(home) {
  const cachePath = path.join(home, 'provider_models_cache.json');
  try { return JSON.parse(await readFile(cachePath, 'utf8')); } catch { return {}; }
}

function parseInventory(raw) {
  const providers = raw?.providers ?? raw;
  const output = {};
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) return output;
  for (const [provider, entry] of Object.entries(providers)) {
    if (!safe(provider) || secretKey(provider)) continue;
    const models = Array.isArray(entry) ? entry : entry?.models;
    if (!Array.isArray(models)) continue;
    output[provider] = models
      .map((model) => typeof model === 'string' ? model : model?.id)
      .filter(safe)
      .sort();
  }
  return output;
}

const GATEWAY_PROVIDERS = new Set(['routera']);

function inCachedCatalog(binding, inventory) {
  const providerModels = inventory[binding.provider];
  if (!providerModels) return false;
  if (providerModels.includes(binding.model)) return true;
  return GATEWAY_PROVIDERS.has(binding.provider) && Object.values(inventory).some((models) => models.includes(binding.model));
}

function statusFor(role, binding, live, inventory) {
  if (role === 'sweeper') return { status: 'NOT_ADDRESSABLE', detail: `degraded: ${binding.mode}; Hermes has no independent sweeper control` };
  if (!inCachedCatalog(binding, inventory)) return { status: 'UNAVAILABLE', selected: binding.model, provider: binding.provider };
  const expected = Object.fromEntries(roleKeys[role].map((key) => [key, key.endsWith('.provider') ? binding.provider : binding.model]));
  const match = Object.entries(expected).every(([key, value]) => live[key] === value);
  return {
    status: match ? 'MATCH' : 'MISMATCH',
    selected: binding.model,
    provider: binding.provider,
    configured: { provider: live[roleKeys[role][0]] ?? null, model: live[roleKeys[role][1]] ?? null },
  };
}

export class HermesRoutingAdapter {
  constructor({ root = path.join(process.env.HOME ?? '', '.agents'), home = process.env.HERMES_HOME ?? path.join(process.env.HOME ?? '', '.hermes'), run = defaultRun, inventoryLoader = defaultInventoryLoader } = {}) {
    this.root = root; this.home = path.resolve(home); this.run = run; this.inventoryLoader = inventoryLoader;
    const marker = `${path.sep}profiles${path.sep}`;
    const at = this.home.lastIndexOf(marker);
    this.profileName = at >= 0 ? this.home.slice(at + marker.length).split(path.sep)[0] : 'default';
    this.scope = { kind: 'hermes-home', id: this.profileName, home: this.home };
    this.store = new ProfileStore({ root, harness: 'hermes', scope: this.scope });
  }
  async #command(args) {
    const result = await this.run(args, { env: { HERMES_HOME: this.home } });
    if (result.code !== 0) throw new Error(`hermes ${args.join(' ')} failed: ${String(result.stderr).trim() || result.code}`);
    return String(result.stdout).trim();
  }
  async #live() {
    const values = {};
    for (const key of OWNED_KEYS) values[key] = (await this.#command(['config', 'get', key])) || null;
    return values;
  }
  async #inventory() { return parseInventory(await this.inventoryLoader(this.home)); }
  async discover() {
    const [live, inventory] = await Promise.all([this.#live(), this.#inventory()]);
    const roles = {
      driver: { status: 'UNBOUND', configured: { provider: live['model.provider'], model: live['model.default'] } },
      builder: { status: 'UNBOUND', configured: { provider: live['delegation.provider'], model: live['delegation.model'] } },
      sweeper: { status: 'NOT_ADDRESSABLE', detail: 'Hermes exposes no independent sweeper control' },
    };
    return { scope: this.scope, live, inventory, roles };
  }
  async preview({ roles }) {
    const [live, inventory] = await Promise.all([this.#live(), this.#inventory()]);
    return { scope: this.scope, live, inventory, roles: Object.fromEntries(Object.entries(roles).map(([role, binding]) => [role, statusFor(role, binding, live, inventory)])), writes: this.#next(roles) };
  }
  #next(roles) {
    return {
      'model.provider': roles.driver.provider, 'model.default': roles.driver.model,
      'delegation.provider': roles.builder.provider, 'delegation.model': roles.builder.model,
    };
  }
  async #apply(roles) {
    const preview = await this.preview({ roles });
    if (Object.values(preview.roles).some(({ status }) => status === 'UNAVAILABLE')) return { applied: false, reason: 'UNAVAILABLE', preview };
    const prior = preview.live; const next = this.#next(roles); const changed = [];
    try {
      for (const key of OWNED_KEYS) if (prior[key] !== next[key]) { await this.#command(['config', 'set', key, next[key]]); changed.push(key); }
      const readback = await this.#live();
      if (OWNED_KEYS.some((key) => readback[key] !== next[key])) throw new Error('Hermes config readback mismatch');
      return { applied: true, prior, next, preview, readback, changed };
    } catch (error) {
      for (const key of changed.reverse()) { try { await this.#command(['config', 'set', key, prior[key] ?? '']); } catch {} }
      return { applied: false, reason: error.message, preview, rolledBack: changed };
    }
  }
  async setup({ name, roles, confirm }) { return this.#saveThenApply('setup', { name, roles, confirm }); }
  async switch({ name, confirm }) {
    if (confirm !== true) throw new Error('operation requires explicit confirm: true');
    const shown = await this.store.show(); const profile = shown.store?.profiles[name];
    if (!profile) throw new Error(`profile ${name} does not exist`);
    const result = await this.#apply(profile.roles);
    if (!result.applied) return result;
    try {
      const saved = await this.store.switch({ name, confirm: true, live: { ownedKeys: OWNED_KEYS, prior: result.prior, next: result.next } });
      return { ...result, ...saved };
    } catch (error) {
      const rollbackFailures = [];
      for (const key of [...result.changed].reverse()) {
        try { await this.#command(['config', 'set', key, result.prior[key] ?? '']); } catch (rollbackError) { rollbackFailures.push(`${key}: ${rollbackError.message}`); }
      }
      if (shown.store) {
        try { await writeFile(this.store.path, `${JSON.stringify(shown.store, null, 2)}\n`, { mode: 0o600 }); } catch (restoreError) { rollbackFailures.push(`profile: ${restoreError.message}`); }
      }
      if (rollbackFailures.length) error.message = `${error.message}; rollback failed: ${rollbackFailures.join('; ')}`;
      throw error;
    }
  }
  async #saveThenApply(operation, { name, roles, confirm }) {
    if (confirm !== true) throw new Error('operation requires explicit confirm: true');
    const existing = await this.store.show();
    const result = await this.#apply(roles);
    if (!result.applied) return result;
    try {
      const saved = await this.store[operation]({ name, roles, confirm: true, live: { ownedKeys: OWNED_KEYS, prior: result.prior, next: result.next } });
      return { ...result, ...saved };
    } catch (error) {
      const rollbackFailures = [];
      for (const key of [...result.changed].reverse()) {
        try { await this.#command(['config', 'set', key, result.prior[key] ?? '']); } catch (rollbackError) { rollbackFailures.push(`${key}: ${rollbackError.message}`); }
      }
      if (existing.store) {
        try { await writeFile(this.store.path, `${JSON.stringify(existing.store, null, 2)}\n`, { mode: 0o600 }); } catch (restoreError) { rollbackFailures.push(`profile: ${restoreError.message}`); }
      }
      if (rollbackFailures.length) error.message = `${error.message}; rollback failed: ${rollbackFailures.join('; ')}`;
      throw error;
    }
  }
  async clear({ confirm }) {
    if (confirm !== true) throw new Error('operation requires explicit confirm: true');
    const live = await this.#live();
    return this.store.clear({ confirm: true, live: { ownedKeys: OWNED_KEYS, prior: live, next: live } });
  }
  async reset({ confirm }) {
    if (confirm !== true) throw new Error('operation requires explicit confirm: true');
    const restoration = await this.store.restoration();
    const current = await this.#live(); const changed = [];
    try {
      for (const key of OWNED_KEYS) if (current[key] !== restoration.prior[key]) { await this.#command(['config', 'set', key, restoration.prior[key] ?? '']); changed.push(key); }
      const verify = await this.#live(); if (OWNED_KEYS.some((key) => verify[key] !== restoration.prior[key])) throw new Error('Hermes reset readback mismatch');
    } catch (error) { for (const key of changed.reverse()) { try { await this.#command(['config', 'set', key, current[key] ?? '']); } catch {} } return { applied: false, reason: error.message }; }
    const saved = await this.store.reset({ confirm: true, live: { ownedKeys: OWNED_KEYS, prior: current, next: restoration.prior } });
    return { applied: true, ...saved };
  }
  async show() { const [store, live] = await Promise.all([this.store.show(), this.previewForActive()]); return { store, live }; }
  async previewForActive() { const stored = await this.store.show(); return stored.store?.active ? this.preview({ roles: stored.store.profiles[stored.store.active].roles }) : this.discover(); }
}
