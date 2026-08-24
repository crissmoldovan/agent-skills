import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROLES = Object.freeze(['driver', 'builder', 'sweeper']);
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const HARNESS = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const SECRET = /(?:^|[_-])(sk|api[_-]?key|token|secret|password)(?:[_-]|$)|-----BEGIN|\bAKIA[0-9A-Z]{16}\b/i;
const DEGRADED = new Set(['fold-builder', 'inline-driver']);
function fail(message) { throw new Error(message); }
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exact(value, keys, label) { if (!plain(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) fail(`${label} has unknown or missing fields`); }
function assertSafeText(value, label) { if (typeof value !== 'string' || !value || value.length > 512 || /[\u0000-\u001f]/.test(value) || SECRET.test(value)) fail(`${label} must be a non-secret safe string`); }
function assertName(name, label = 'profile name') { if (typeof name !== 'string' || !NAME.test(name) || name.includes('..')) fail(`${label} is invalid`); }
function scopeFrom(value) { if (!plain(value) || !['kind', 'id', 'home'].includes(...Object.keys(value))) fail('scope must be an object'); if (!Object.keys(value).every((key) => ['kind', 'id', 'home'].includes(key)) || !('kind' in value) || !('id' in value)) fail('scope must contain kind and id only (plus diagnostic home)'); assertSafeText(value.kind, 'scope kind'); assertSafeText(value.id, 'scope id'); if ('home' in value) assertSafeText(value.home, 'scope home'); return Object.fromEntries(Object.entries(value)); }
function binding(value, role) {
  if (role === 'sweeper' && plain(value) && Object.keys(value).length === 1 && 'mode' in value) {
    if (!DEGRADED.has(value.mode)) fail('sweeper mode must be fold-builder or inline-driver'); return { mode: value.mode };
  }
  if (role === 'sweeper') fail('sweeper must be an explicit mode, not a model binding');
  exact(value, ['provider', 'model', ...(Object.hasOwn(value ?? {}, 'effort') ? ['effort'] : [])], `${role} binding`);
  assertSafeText(value.provider, `${role} provider`); assertSafeText(value.model, `${role} model`);
  if ('effort' in value) assertSafeText(value.effort, `${role} effort`);
  return { ...value };
}
function rolesFrom(value) { exact(value, ROLES, 'profile roles'); return Object.fromEntries(ROLES.map((role) => [role, binding(value[role], role)])); }
function profileFrom(value) { exact(value, ['roles'], 'profile'); return { roles: rolesFrom(value.roles) }; }
function liveFrom(value) { exact(value, ['ownedKeys', 'prior', 'next'], 'live values'); if (!Array.isArray(value.ownedKeys) || !value.ownedKeys.length) fail('owned harness keys are required'); for (const key of value.ownedKeys) assertSafeText(key, 'owned harness key'); for (const map of [value.prior, value.next]) { if (!plain(map)) fail('live values must be objects'); if (Object.keys(map).sort().join(',') !== [...value.ownedKeys].sort().join(',')) fail('live values must cover exactly owned harness keys'); for (const item of Object.values(map)) if (item !== null) assertSafeText(item, 'live value'); } return { ownedKeys: [...value.ownedKeys], prior: { ...value.prior }, next: { ...value.next } }; }
function fingerprint(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16); }
function nowStamp() { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, ''); }
const LOCK_WAIT_MS = 15_000;
const LOCK_POLL_MS = 10;
const STALE_LOCK_MS = 60_000;
function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
async function ownerIsDead(lockPath) {
  try {
    const owner = JSON.parse(await readFile(path.join(lockPath, 'owner.json'), 'utf8'));
    if (!Number.isInteger(owner.pid) || owner.pid <= 0 || Date.now() - owner.createdAt < STALE_LOCK_MS) return false;
    try { process.kill(owner.pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; }
  } catch { return false; }
}

export function deriveScopeKey(harness, scope) { assertName(harness, 'harness'); const scoped = scopeFrom(scope); const base = path.posix.basename(scoped.id.replaceAll('\\', '/')).replace(/[^a-zA-Z0-9_-]/g, '-') || 'scope'; const digest = createHash('sha256').update(`${harness}\0${JSON.stringify(scoped)}`).digest('hex').slice(0, 16); return `${harness}--${scoped.kind}-${base}-${digest}`; }
export function validateStore(value) { exact(value, ['version', 'harness', 'scope', 'active', 'profiles'], 'store'); if (value.version !== 2) fail('store version must be 2'); assertName(value.harness, 'harness'); const scope = scopeFrom(value.scope); if (value.active !== null) assertName(value.active, 'active profile'); if (!plain(value.profiles)) fail('profiles must be an object'); const profiles = Object.fromEntries(Object.entries(value.profiles).map(([name, profile]) => { assertName(name); return [name, profileFrom(profile)]; })); if (value.active !== null && !profiles[value.active]) fail('active profile does not exist'); return { version: 2, harness: value.harness, scope, active: value.active, profiles }; }

export class ProfileStore {
  constructor({ root, harness, scope }) { assertSafeText(root, 'root'); assertName(harness, 'harness'); this.root = path.resolve(root); this.harness = harness; this.scope = scopeFrom(scope); this.scopeKey = deriveScopeKey(harness, this.scope); this.directory = path.join(this.root, 'model-routing', this.scopeKey); this.path = path.join(this.directory, 'profile-v2.json'); this.pending = Promise.resolve(); }
  async show() { return { path: this.path, scopeKey: this.scopeKey, store: await this.#read() }; }
  async restoration() {
    const receipt = await this.#latestReceipt();
    if (!receipt) fail('no receipt-owned values to restore');
    return Object.freeze({
      sequence: receipt.sequence,
      receiptId: receipt.id,
      prior: { ...receipt.prior },
      ownedKeys: [...receipt.ownedKeys],
    });
  }
  async setup({ name, roles, live, confirm }) { return this.#upsert('setup', name, roles, live, confirm, true); }
  async save({ name, roles, live, confirm }) { return this.#upsert('save', name, roles, live, confirm, false); }
  async #upsert(operation, name, roles, live, confirm, active) { this.#confirm(confirm); assertName(name); const profile = profileFrom({ roles }); return this.#mutate(async () => { const store = (await this.#read()) ?? this.#empty(); store.profiles[name] = profile; if (active) store.active = name; return this.#commit(operation, store, name, live); }); }
  async switch({ name, live, confirm }) { this.#confirm(confirm); assertName(name); return this.#mutate(async () => { const store = this.#require(await this.#read()); if (!store.profiles[name]) fail(`profile ${name} does not exist`); store.active = name; return this.#commit('switch', store, name, live); }); }
  async change({ role, binding: roleBinding, live, confirm }) { this.#confirm(confirm); if (!ROLES.includes(role)) fail('role must be driver, builder, or sweeper'); return this.#mutate(async () => { const store = this.#require(await this.#read()); if (store.active === null) fail('no active profile to change'); store.profiles[store.active].roles[role] = binding(roleBinding, role); return this.#commit('change', store, store.active, live); }); }
  async clear({ live, confirm }) { this.#confirm(confirm); return this.#mutate(async () => { const store = this.#require(await this.#read()); store.active = null; return this.#commit('clear', store, null, live); }); }
  async delete({ name, live, confirm }) { this.#confirm(confirm); assertName(name); return this.#mutate(async () => { const store = this.#require(await this.#read()); if (!store.profiles[name]) fail(`profile ${name} does not exist`); delete store.profiles[name]; if (store.active === name) store.active = null; return this.#commit('delete', store, name, live); }); }
  async reset({ live, confirm }) { this.#confirm(confirm); return this.#mutate(async () => { const store = this.#require(await this.#read()); const last = await this.#latestReceipt(); if (!last) fail('no receipt-owned values to restore'); store.active = null; const result = await this.#commit('reset', store, null, live); return { ...result, restore: last.prior }; }); }
  async useOnce({ roles, live }) { const profile = profileFrom({ roles }); const checked = liveFrom(live); return Object.freeze({ operation: 'use-once', changed: false, profile, harness: this.harness, scope: this.scope, ownedKeys: checked.ownedKeys, prior: checked.prior, next: checked.next, fingerprint: fingerprint({ profile, live: checked }) }); }
  async migrate({ legacyPath, scope, live, confirm }) { this.#confirm(confirm); if (!scope) fail('migration requires explicit scope'); const selected = scopeFrom(scope); if (JSON.stringify(selected) !== JSON.stringify(this.scope)) fail('migration scope does not match store scope'); assertSafeText(legacyPath, 'legacy path'); const contents = await readFile(path.resolve(legacyPath), 'utf8'); const raw = this.#legacy(contents); const profiles = {}; for (const [name, candidate] of Object.entries(raw.profiles ?? {})) { assertName(name); profiles[name] = { roles: this.#legacyRoles(candidate.roles ?? candidate.models) }; } const store = validateStore({ version: 2, harness: this.harness, scope: this.scope, active: raw.active ?? null, profiles }); const backupPath = `${path.resolve(legacyPath)}.v1-backup-${nowStamp()}`; await copyFile(path.resolve(legacyPath), backupPath); const result = await this.#mutate(() => this.#commit('migrate', store, store.active, live)); return { ...result, backupPath }; }
  #legacyRoles(legacy) { if (!plain(legacy)) fail('legacy v1 profile is invalid'); const result = {}; for (const role of ROLES) { const value = legacy[role]; if (role === 'sweeper' && typeof value === 'string' && DEGRADED.has(value)) result[role] = { mode: value }; else if (typeof value === 'string' && value.includes('/')) { const [provider, ...rest] = value.split('/'); result[role] = role === 'sweeper' ? fail('legacy sweeper must be a degraded mode') : { provider, model: rest.join('/') }; } else result[role] = value; } return rolesFrom(result); }
  #legacy(text) { try { return JSON.parse(text); } catch { const result = { profiles: {} }; let current = null; let inRoles = false; for (const line of text.split(/\r?\n/)) { if (!line.trim() || line.trimStart().startsWith('#')) continue; let match; if ((match = /^active:\s*(\S+)\s*$/.exec(line))) result.active = match[1]; else if ((match = /^\s{2}([\w-]+):\s*$/.exec(line))) { current = match[1]; result.profiles[current] = { roles: {} }; inRoles = false; } else if (/^\s{4}(roles|models):\s*$/.test(line)) inRoles = true; else if (inRoles && (match = /^\s{6}(driver|builder|sweeper):\s*(\S+)\s*$/.exec(line))) result.profiles[current].roles[match[1]] = match[2]; } if (!plain(result.profiles) || !Object.keys(result.profiles).length) fail('legacy v1 YAML is invalid'); return result; } }
  #empty() { return { version: 2, harness: this.harness, scope: this.scope, active: null, profiles: {} }; }
  #confirm(value) { if (value !== true) fail('operation requires explicit confirm: true'); }
  #require(store) { if (store === null) fail('no profile store exists for this exact harness and scope'); return store; }
  async #read() { try { const store = validateStore(JSON.parse(await readFile(this.path, 'utf8'))); if (store.harness !== this.harness) fail('store harness mismatch'); if (JSON.stringify(store.scope) !== JSON.stringify(this.scope)) fail('store scope mismatch'); return store; } catch (error) { if (error?.code === 'ENOENT') return null; throw error; } }
  async #latestReceipt() { try { const names = (await readdir(this.directory)).filter((name) => name.startsWith('receipt-') && name.endsWith('.json')); const receipts = await Promise.all(names.map(async (name) => JSON.parse(await readFile(path.join(this.directory, name), 'utf8')))); const applicable = receipts.filter((receipt) => receipt.operation !== 'clear' && receipt.operation !== 'reset' && Number.isSafeInteger(receipt.sequence)); if (!applicable.length) return null; return applicable.sort((left, right) => right.sequence - left.sequence)[0]; } catch (error) { if (error?.code === 'ENOENT') return null; throw error; } }
  async #mutate(operation) { const prior = this.pending; let release; this.pending = new Promise((resolve) => { release = resolve; }); await prior; try { return await this.#withLock(operation); } finally { release(); } }
  async #withLock(operation) { await mkdir(this.directory, { recursive: true, mode: 0o700 }); const lockPath = path.join(this.directory, '.profile-v2.lock'); const deadline = Date.now() + LOCK_WAIT_MS; const token = randomUUID(); while (true) { try { await mkdir(lockPath, { mode: 0o700 }); await writeFile(path.join(lockPath, 'owner.json'), `${JSON.stringify({ token, pid: process.pid, createdAt: Date.now() })}\n`, { mode: 0o600 }); break; } catch (error) { if (error?.code !== 'EEXIST') throw error; if (await ownerIsDead(lockPath)) { await rm(lockPath, { recursive: true, force: true }); continue; } if (Date.now() >= deadline) fail('timed out waiting for profile store lock'); await delay(LOCK_POLL_MS); } } try { return await operation(); } finally { try { const owner = JSON.parse(await readFile(path.join(lockPath, 'owner.json'), 'utf8')); if (owner.token === token) await rm(lockPath, { recursive: true, force: true }); } catch { /* lock cleanup is best effort */ } } }
  async #commit(operation, store, name, live) { const validated = validateStore(store); const checked = liveFrom(live); const timestamp = new Date().toISOString(); const priorReceipt = await this.#latestReceipt(); const sequence = (priorReceipt?.sequence ?? 0) + 1; const id = `${process.pid}-${process.hrtime.bigint()}-${randomUUID()}`; const receipt = { version: 1, operation, harness: this.harness, scope: this.scope, ownedKeys: checked.ownedKeys, prior: checked.prior, next: checked.next, fingerprint: fingerprint({ operation, harness: this.harness, scope: this.scope, live: checked }), timestamp, id, sequence }; const temporary = path.join(this.directory, `.profile-v2-${process.pid}-${process.hrtime.bigint()}-${randomUUID()}.tmp`); await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 }); await rename(temporary, this.path); const receiptPath = path.join(this.directory, `receipt-${String(sequence).padStart(20, '0')}-${id}.json`); await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 }); return Object.freeze({ operation, changed: true, path: this.path, receiptPath, scopeKey: this.scopeKey, active: validated.active, name, profile: name && validated.profiles[name] ? validated.profiles[name] : null, timestamp, id, sequence, fingerprint: receipt.fingerprint }); }
}
