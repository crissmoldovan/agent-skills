import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const runnerSource = fileURLToPath(new URL('../packages/workspace-governance/scripts/test.mjs', import.meta.url));

async function makeFixture(source, testFileName = 'probe.test.ts') {
  const base = await mkdtemp(join(tmpdir(), 'workspace-governance-runner-'));
  const packageRoot = join(base, 'package with space % # é');
  const runner = join(packageRoot, 'scripts', 'test.mjs');
  const testFile = join(packageRoot, 'test', testFileName);
  await mkdir(dirname(runner), { recursive: true, mode: 0o700 });
  await mkdir(dirname(testFile), { recursive: true, mode: 0o700 });
  await cp(runnerSource, runner);
  await writeFile(testFile, source, { mode: 0o600 });
  return { base, packageRoot, runner };
}

function run(fixture) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [fixture.runner], { encoding: 'utf8', env });
}

test('test runner decodes checkout URL paths and uses package cwd', async () => {
  const fixture = await makeFixture('');
  try {
    const source = `
      import assert from 'node:assert/strict';
      import test from 'node:test';
      test('package cwd', () => assert.equal(process.cwd(), ${JSON.stringify(fixture.packageRoot)}));
    `;
    await writeFile(join(fixture.packageRoot, 'test', 'probe.test.ts'), source);
    const result = run(fixture);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.signal, null);
  } finally { await rm(fixture.base, { recursive: true, force: true }); }
});

test('test runner handles test filenames containing URL metacharacters', async () => {
  const fixture = await makeFixture(`
    import assert from 'node:assert/strict';
    import test from 'node:test';
    test('fixture passes', () => assert.equal(2 + 2, 4));
  `, 'literal % # ?.test.ts');
  try {
    const result = run(fixture);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.signal, null);
  } finally { await rm(fixture.base, { recursive: true, force: true }); }
});

test('test runner preserves direct harness signal termination', async () => {
  const fixture = await makeFixture(`
    import test from 'node:test';
    test('signals direct harness', async () => {
      process.kill(process.ppid, 'SIGKILL');
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  `);
  try {
    const result = run(fixture);
    assert.equal(result.status, null, JSON.stringify(result));
    assert.equal(result.signal, 'SIGKILL');
  } finally { await rm(fixture.base, { recursive: true, force: true }); }
});

test('test runner preserves test failure as nonzero', async () => {
  const fixture = await makeFixture(`
    import assert from 'node:assert/strict';
    import test from 'node:test';
    test('fixture fails', () => assert.fail('expected fixture failure'));
  `);
  try {
    const result = run(fixture);
    assert.notEqual(result.status, 0, JSON.stringify(result));
    assert.equal(result.signal, null);
  } finally { await rm(fixture.base, { recursive: true, force: true }); }
});
