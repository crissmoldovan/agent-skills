import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
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
  // Compared against the canonicalised form: mkdtemp()'s directory can itself sit
  // behind a symlink (macOS TMPDIR under /var, a symlink to /private/var), and the
  // cwd rung now canonicalises for exactly that reason.
  assert.equal(id.detail, realpathSync(dir));
});

test('a declared id is used when no filesystem rung applies', () => {
  const id = resolveWorkspace('', { gitCommonDir: null, declared: 'cowork-space-7' });
  assert.equal(id.method, 'declared');
  assert.equal(id.id, 'cowork-space-7');
});

test('an explicit id file BEATS git — the rungs must actually compete', async () => {
  const dir = await tmp();
  await mkdir(join(dir, '.agent-journal'), { recursive: true });
  await writeFile(join(dir, '.agent-journal', 'id'), 'declared-wins\n', 'utf8');
  // Both rungs are satisfiable here. Reorder the cascade and this test fails.
  const id = resolveWorkspace(dir, { gitCommonDir: '/repo/.git' });
  assert.equal(id.method, 'explicit');
  assert.equal(id.id, 'declared-wins');
});

test('a host container id is used when there is no git and no explicit file', async () => {
  const dir = await tmp();
  const id = resolveWorkspace(dir, { gitCommonDir: null, hostContainer: 'cowork-space-7' });
  assert.equal(id.method, 'host');
  assert.equal(id.detail, 'cowork-space-7');
});

test('the ephemeral rung yields a distinct id per call', () => {
  const a = resolveWorkspace('', {});
  const b = resolveWorkspace('', {});
  assert.equal(a.method, 'ephemeral');
  assert.notEqual(a.id, b.id);
});

test('an unreadable id file throws rather than becoming a different workspace', async () => {
  const dir = await tmp();
  // A directory where the id file belongs: readFileSync raises EISDIR, which is
  // neither ENOENT nor ENOTDIR, so it must propagate.
  await mkdir(join(dir, '.agent-journal', 'id'), { recursive: true });
  assert.throws(() => resolveWorkspace(dir, { gitCommonDir: '/repo/.git' }));
});

test('two symlinked spellings of one directory share a workspace id', async () => {
  const real = await tmp();
  const link = join(await tmp(), 'link');
  await symlink(real, link, 'dir');
  assert.equal(
    resolveWorkspace(link, { gitCommonDir: null }).id,
    resolveWorkspace(real, { gitCommonDir: null }).id,
  );
});
