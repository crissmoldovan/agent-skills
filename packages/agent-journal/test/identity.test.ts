import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveWorkspace } from '../src/identity.ts';

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'journal-id-'));
}

test('an explicit id file wins and is reported as explicit', async () => {
  const dir = await tmp();
  await mkdir(join(dir, '.agent-journal'), { recursive: true });
  await writeFile(join(dir, '.agent-journal', 'id'), 'my-workspace\n', 'utf8');
  const id = resolveWorkspace(dir);
  assert.equal(id.id, 'my-workspace');
  assert.equal(id.method, 'explicit');
});

test('a git checkout resolves by its common directory', async () => {
  const dir = await tmp();
  const id = resolveWorkspace(dir, { gitCommonDir: '/repo/.git' });
  assert.equal(id.method, 'git');
  assert.equal(id.detail, '/repo/.git');
});

test('a worktree resolves to the SAME id as its main checkout', () => {
  const main = resolveWorkspace('/repo', { gitCommonDir: '/repo/.git' });
  const tree = resolveWorkspace('/repo-feature', { gitCommonDir: '/repo/.git' });
  assert.equal(main.id, tree.id);
});

test('falls back to a cwd hash when there is no git', async () => {
  const dir = await tmp();
  const id = resolveWorkspace(dir, { gitCommonDir: null });
  assert.equal(id.method, 'cwd');
  assert.equal(id.detail, dir);
});

test('a declared id is used when no filesystem rung applies', () => {
  const id = resolveWorkspace('', { gitCommonDir: null, declared: 'cowork-space-7' });
  assert.equal(id.method, 'declared');
  assert.equal(id.id, 'cowork-space-7');
});
