import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const runnerSource = fileURLToPath(new URL('../packages/workspace-governance/scripts/test.mjs', import.meta.url));
const runnerModuleSource = fileURLToPath(new URL('../packages/workspace-governance/scripts/test-runner.mjs', import.meta.url));

async function makeFixture(source, testFileName = 'probe.test.ts') {
  const base = await mkdtemp(join(tmpdir(), 'workspace-governance-runner-'));
  const home = join(base, 'private home');
  const packageRoot = join(base, 'package with space % # é');
  const runner = join(packageRoot, 'scripts', 'test.mjs');
  const testFile = join(packageRoot, 'test', testFileName);
  await mkdir(home, { mode: 0o700 });
  await mkdir(dirname(runner), { recursive: true, mode: 0o700 });
  await mkdir(dirname(testFile), { recursive: true, mode: 0o700 });
  await cp(runnerSource, runner);
  await cp(runnerModuleSource, join(dirname(runner), 'test-runner.mjs'));
  await writeFile(testFile, source, { mode: 0o600 });
  return { base, home, runner };
}

function fixtureEnv(home, extra = {}) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, ...extra };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

async function assertRootRemoved(home) {
  assert.deepEqual(await readdir(home), []);
}

async function processIsGone(pid) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === 'ESRCH') return true;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

test('test runner handles checkout paths that require URL decoding', async () => {
  const fixture = await makeFixture(`
    import assert from 'node:assert/strict';
    import test from 'node:test';
    test('fixture passes', () => assert.equal(1, 1));
  `);
  try {
    const result = spawnSync(process.execPath, [fixture.runner], {
      env: fixtureEnv(fixture.home),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.signal, null);
    await assertRootRemoved(fixture.home);
  } finally {
    await rm(fixture.base, { recursive: true, force: true });
  }
});

test('test runner handles test filenames containing URL metacharacters', async () => {
  const fixture = await makeFixture(`
    import assert from 'node:assert/strict';
    import test from 'node:test';
    test('fixture passes', () => assert.equal(2 + 2, 4));
  `, 'literal % # ?.test.ts');
  try {
    const result = spawnSync(process.execPath, [fixture.runner], {
      env: fixtureEnv(fixture.home),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.signal, null);
    await assertRootRemoved(fixture.home);
  } finally {
    await rm(fixture.base, { recursive: true, force: true });
  }
});

test('test runner preserves direct child signal termination after cleanup', async () => {
  const fixture = await makeFixture(`
    import test from 'node:test';
    test('signals the direct harness', async () => {
      process.kill(process.ppid, 'SIGKILL');
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  `);
  try {
    const result = spawnSync(process.execPath, [fixture.runner], {
      env: fixtureEnv(fixture.home),
      encoding: 'utf8',
    });
    assert.equal(result.status, null, JSON.stringify({ status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr }));
    assert.equal(result.signal, 'SIGKILL');
    await assertRootRemoved(fixture.home);
  } finally {
    await rm(fixture.base, { recursive: true, force: true });
  }
});

test('test runner preserves a child failure as nonzero after cleanup', async () => {
  const fixture = await makeFixture(`
    import assert from 'node:assert/strict';
    import test from 'node:test';
    test('fixture fails', () => assert.fail('expected fixture failure'));
  `);
  try {
    const result = spawnSync(process.execPath, [fixture.runner], {
      env: fixtureEnv(fixture.home),
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, JSON.stringify({ status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr }));
    assert.equal(result.signal, null);
    await assertRootRemoved(fixture.home);
  } finally {
    await rm(fixture.base, { recursive: true, force: true });
  }
});

test('parent cancellation forwards to the test process group and removes the private root', async () => {
  const fixture = await makeFixture(`
    import { spawn } from 'node:child_process';
    import test from 'node:test';
    test('waits for cancellation', async () => {
      const resistant = spawn(process.execPath, ['-e', \`
        const { writeFileSync } = require('node:fs');
        process.on('SIGTERM', () => {});
        writeFileSync(process.env.FIXTURE_PID_PATH, String(process.pid), { mode: 0o600 });
        setInterval(() => {}, 1000);
      \`], { env: process.env, stdio: 'ignore' });
      resistant.unref();
      await new Promise(() => {});
    });
  `);
  const pidPath = join(fixture.base, 'worker.pid');
  let workerPid;
  try {
    const runner = spawn(process.execPath, [fixture.runner], {
      env: fixtureEnv(fixture.home, { FIXTURE_PID_PATH: pidPath }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        workerPid = Number(await readFile(pidPath, 'utf8'));
        break;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(Number.isSafeInteger(workerPid) && workerPid > 1, 'fixture worker did not start');
    runner.kill('SIGTERM');
    const outcome = await new Promise((resolve) => runner.once('close', (status, signal) => resolve({ status, signal })));
    assert.deepEqual(outcome, { status: null, signal: 'SIGTERM' });
    assert.equal(await processIsGone(workerPid), true, `worker ${workerPid} survived cancellation`);
    await assertRootRemoved(fixture.home);
  } finally {
    if (workerPid && !(await processIsGone(workerPid))) process.kill(workerPid, 'SIGKILL');
    await rm(fixture.base, { recursive: true, force: true });
  }
});
