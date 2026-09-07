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

test('a host container id is used when there is no git, no file, and no cwd', () => {
  // This passed a real directory as `cwd` and asserted `host` won anyway, which
  // locked in a cascade that contradicted spec 6.1 and collapsed every project
  // in a container onto one journal. Host is rung 4: it applies where there is
  // no directory to distinguish projects by — Cowork, a hosted chat surface.
  const id = resolveWorkspace('', { gitCommonDir: null, hostContainer: 'cowork-space-7' });
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

// Every assertion in this file checked `method` and `detail`, or checked that two
// spellings of ONE workspace agree. Nothing asserted that two DIFFERENT
// workspaces disagree — so the suite stayed green with resolveWorkspace hashing
// a constant, collapsing every project on the machine onto one journal. That is
// the function's entire purpose.
test('different workspaces get different ids, at every rung', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'journal-distinct-'));
  const ids = new Map<string, string>();
  const seen = (label: string, id: string) => {
    for (const [other, prev] of ids) {
      assert.notEqual(id, prev, `${label} and ${other} collapsed onto one id (${id})`);
    }
    ids.set(label, id);
  };

  seen('git-a', resolveWorkspace(dir, { gitCommonDir: join(dir, 'a/.git') }).id);
  seen('git-b', resolveWorkspace(dir, { gitCommonDir: join(dir, 'b/.git') }).id);
  seen('cwd-a', resolveWorkspace(join(dir, 'project-a')).id);
  seen('cwd-b', resolveWorkspace(join(dir, 'project-b')).id);
  seen('host-a', resolveWorkspace('', { hostContainer: 'container-a' }).id);
  seen('host-b', resolveWorkspace('', { hostContainer: 'container-b' }).id);
});

// Spec §6.1 orders the cascade explicit → git → cwd → host → declared. The
// implementation ran host and declared BEFORE cwd, so two checkouts open in one
// Claude Project shared a single journal — the exact collapse rung 3 exists to
// prevent. The ResolutionMethod type already listed the spec order.
test('cwd outranks host and declared, per spec 6.1', () => {
  const a = resolveWorkspace('/work/project-a', { hostContainer: 'claude-project-7' });
  const b = resolveWorkspace('/work/project-b', { hostContainer: 'claude-project-7' });
  assert.equal(a.method, 'cwd', `expected cwd to win over host, got ${a.method}`);
  assert.notEqual(a.id, b.id, 'two projects in one container collapsed onto one journal');

  const d = resolveWorkspace('/work/project-c', { declared: 'declared-id' });
  assert.equal(d.method, 'cwd', `expected cwd to win over declared, got ${d.method}`);

  // With no cwd, the lower rungs still apply in spec order.
  assert.equal(resolveWorkspace('', { hostContainer: 'c1' }).method, 'host');
  assert.equal(resolveWorkspace('', { declared: 'x' }).method, 'declared');
});
