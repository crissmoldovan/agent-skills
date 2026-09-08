import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalize } from '../src/paths.ts';

// realpath the scratch dir: on macOS `tmpdir()` is `/var/...`, itself a symlink
// to `/private/var/...`. canonicalize resolves it (correctly), so comparing
// against the unresolved path fails for a reason that has nothing to do with
// what is under test.
async function scratch(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), 'journal-paths-')));
}

// This helper had two copies -- one guarding `digest --out`, one guarding
// decay's repo reads -- already diverging in their comments. It is the
// resolution EVERY containment guard in this package runs before comparing a
// path against a root it must stay inside, so a behavioural difference between
// copies would be a difference in what each guard lets through.
test('a final-component symlink is followed, which is the whole point', async () => {
  const dir = await scratch();
  await mkdir(join(dir, 'real'), { recursive: true });
  await writeFile(join(dir, 'real', 'f.txt'), 'x');
  await symlink(join(dir, 'real', 'f.txt'), join(dir, 'link.txt'));
  assert.equal(await canonicalize(join(dir, 'link.txt')), join(dir, 'real', 'f.txt'));
});

// A guard that resolved only intermediate segments would be defeated by a link
// sitting at exactly the final position, which is why this case exists.
test('a DANGLING final-component symlink still resolves to its target', async () => {
  const dir = await scratch();
  await symlink(join(dir, 'nowhere', 'gone.txt'), join(dir, 'dangling.txt'));
  assert.equal(await canonicalize(join(dir, 'dangling.txt')), join(dir, 'nowhere', 'gone.txt'));
});

test('a path that does not exist at all resolves to itself, not an error', async () => {
  const dir = await scratch();
  assert.equal(await canonicalize(join(dir, 'a', 'b', 'c.md')), join(dir, 'a', 'b', 'c.md'));
});

// Mirrors what a real filesystem does with ELOOP rather than recursing forever.
test('a symlink cycle raises ELOOP instead of hanging', async () => {
  const dir = await scratch();
  await symlink(join(dir, 'b'), join(dir, 'a'));
  await symlink(join(dir, 'a'), join(dir, 'b'));
  await assert.rejects(() => canonicalize(join(dir, 'a')), (e: NodeJS.ErrnoException) => e.code === 'ELOOP');
});
