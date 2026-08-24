import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'verify-skills-'));
  await cp(path.join(repository, 'scripts'), path.join(root, 'scripts'), { recursive: true });
  await mkdir(path.join(root, 'skills', 'valid-skill'), { recursive: true });
  await writeFile(path.join(root, 'skills', 'valid-skill', 'SKILL.md'), '---\nname: valid-skill\ndescription: Valid fixture\n---\n');
  return root;
}

function verify(root) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/verify-skills.mjs'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('verifier ignores generated and temporary directories', async () => {
  const root = await fixture();
  for (const directory of ['.cache', '.next', '.tmp', '.turbo', '.vite', '.wrangler', 'build', 'coverage', 'dist', 'out', 'tmp']) {
    await mkdir(path.join(root, directory), { recursive: true });
    const assignment = ['to', 'ken'].join('');
    const generatedToken = ['generated', 'token', 'value', '1234567890'].join('-');
    await writeFile(path.join(root, directory, 'generated.txt'), `${assignment} = "${generatedToken}"\n`);
  }

  const result = await verify(root);

  assert.equal(result.status, 0, result.stderr);
});

test('verifier rejects public machine-specific absolute paths', async () => {
  const root = await fixture();
  const personalPath = ['', 'Users', 'alice', 'private', 'catalog'].join('/');
  await writeFile(path.join(root, 'README.md'), `Install from ${personalPath}.\n`);

  const result = await verify(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /README\.md: contains a machine-specific absolute path/);
});

test('verifier accepts neutral credential fixtures', async () => {
  const root = await fixture();
  const assignment = ['to', 'ken'].join('');
  const neutralToken = ['not', 'a', 'real', 'secret'].join('-');
  await writeFile(path.join(root, 'README.md'), `Set ${assignment} = "${neutralToken}" in your local environment.\n`);

  const result = await verify(root);

  assert.equal(result.status, 0, result.stderr);
});

test('verifier rejects realistic quoted credentials', async () => {
  const root = await fixture();
  const assignment = ['to', 'ken'].join('');
  const realisticToken = ['prod', 'token', 'value', '1234567890'].join('-');
  await writeFile(path.join(root, 'README.md'), `${assignment} = "${realisticToken}"\n`);

  const result = await verify(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /README\.md: contains a likely secret/);
});
