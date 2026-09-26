import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const runnerSource = fileURLToPath(new URL('../packages/workspace-governance/scripts/test.mjs', import.meta.url));

test('test runner discovers sorted test files and executes them serially', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workspace-governance-runner-order-'));
  const packageRoot = join(root, 'package');
  const scripts = join(packageRoot, 'scripts');
  const tests = join(packageRoot, 'test');
  const trace = join(root, 'trace.txt');
  const lock = join(root, 'active.lock');
  await Promise.all([mkdir(scripts, { recursive: true }), mkdir(tests, { recursive: true })]);
  await cp(runnerSource, join(scripts, 'test.mjs'));
  const source = (label) => `
    import assert from 'node:assert/strict';
    import { appendFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
    import test from 'node:test';
    test('${label}', async () => {
      assert.equal(existsSync(${JSON.stringify(lock)}), false, 'test files overlapped');
      writeFileSync(${JSON.stringify(lock)}, '${label}');
      appendFileSync(${JSON.stringify(trace)}, '${label}');
      await new Promise(resolve => setTimeout(resolve, 40));
      rmSync(${JSON.stringify(lock)});
    });
  `;
  await writeFile(join(tests, 'b.test.ts'), source('b'));
  await writeFile(join(tests, 'a.test.ts'), source('a'));
  try {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [join(scripts, 'test.mjs')], { encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(trace, 'utf8'), 'ab');
  } finally { await rm(root, { recursive: true, force: true }); }
});
