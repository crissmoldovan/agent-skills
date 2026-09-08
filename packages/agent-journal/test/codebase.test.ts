import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveCodebaseRefs } from '../src/codebase.ts';

async function repo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'journal-repo-'));
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'src', 'here.ts'), 'export function present() {}\n');
  return dir;
}

test('an existing file resolves true, a missing one false', async () => {
  const dir = await repo();
  const m = await resolveCodebaseRefs(['src/here.ts', 'src/gone.ts'], dir);
  assert.equal(m.get('src/here.ts'), true);
  assert.equal(m.get('src/gone.ts'), false);
});

test('a symbol present in the file resolves true', async () => {
  const dir = await repo();
  const m = await resolveCodebaseRefs(['src/here.ts:present'], dir);
  assert.equal(m.get('src/here.ts:present'), true);
});

test('a symbol absent from an existing file resolves false', async () => {
  const dir = await repo();
  const m = await resolveCodebaseRefs(['src/here.ts:vanished'], dir);
  assert.equal(m.get('src/here.ts:vanished'), false);
});

test('a symbol in a missing file resolves false, not an error', async () => {
  const dir = await repo();
  const m = await resolveCodebaseRefs(['src/gone.ts:whatever'], dir);
  assert.equal(m.get('src/gone.ts:whatever'), false);
});

// A ref escaping the repo is a refusal, NOT `false` -- `false` reads as "the
// file is gone", which would be a false statement about a file that exists.
test('a ref escaping the repo root is refused, not reported missing', async () => {
  const dir = await repo();
  const m = await resolveCodebaseRefs(['../../../etc/hosts', '/etc/hosts'], dir);
  assert.equal(m.has('../../../etc/hosts'), false, 'an escaping ref must not be answered');
  assert.equal(m.has('/etc/hosts'), false);
});

test('a symlink pointing out of the repo is refused too', async () => {
  const dir = await repo();
  await symlink('/etc', join(dir, 'escape'));
  const m = await resolveCodebaseRefs(['escape/hosts'], dir);
  assert.equal(m.has('escape/hosts'), false, 'containment was checked before resolution');
});

test('a directory is not a file', async () => {
  const dir = await repo();
  const m = await resolveCodebaseRefs(['src'], dir);
  assert.equal(m.get('src'), false);
});

// The intermediate-component symlink above ('escape' is a directory) is
// resolved by realpath() on the PARENT chain. The containment check has a
// second, independently mutable half: a symlink sitting at the ref's own
// FINAL component (a file, not a directory, in the symlink's position) is
// resolved by canonicalize()'s own readlink()/isSymbolicLink() branch. Each
// half must be able to fail alone.
test('a symlinked file whose target escapes the repo is refused too', async () => {
  const dir = await repo();
  await symlink('/etc/hosts', join(dir, 'src', 'link.ts'));
  const m = await resolveCodebaseRefs(['src/link.ts'], dir);
  assert.equal(m.has('src/link.ts'), false, 'the final path component itself is a symlink out');
});

// The containment check is `candidateReal === repoRootReal ||
// candidateReal.startsWith(repoRootReal + sep)`. Every other test above
// resolves to a STRICT subpath of the repo root, which only ever exercises
// the `startsWith` half. A ref that resolves to the repo root ITSELF
// exercises the `===` half on its own -- `startsWith` is false there (a
// string is never a prefix-with-separator of itself) -- so dropping the
// equality half would silently start refusing this ref (turning `false`
// into an omission) without breaking any subpath test.
test('a ref resolving to the repo root itself is not a file, not refused', async () => {
  const dir = await repo();
  const m = await resolveCodebaseRefs(['.'], dir);
  assert.equal(m.has('.'), true, 'the repo root is inside the repo root');
  assert.equal(m.get('.'), false, 'a directory is still not a file');
});
