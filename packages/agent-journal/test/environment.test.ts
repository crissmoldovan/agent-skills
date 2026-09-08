import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureEnvironment } from '../src/environment.ts';

test('the interpreter is the resolved path, never the word that was typed', () => {
  const e = captureEnvironment();
  assert.ok(e.interpreter.includes('/'),
    `expected a resolved path, got ${JSON.stringify(e.interpreter)}`);
  assert.notEqual(e.interpreter, 'node');
});

test('version and platform come from the running process', () => {
  const e = captureEnvironment();
  assert.equal(e.version, process.version);
  assert.equal(e.platform, `${process.platform}/${process.arch}`);
});

// The fake's values must not collide with this machine's real ones on any of
// the fields under test — otherwise a mutation that silently falls back to
// the real `process` would still pass here for the wrong reason.
test('a fake process is read rather than the real one, so this is testable at all', () => {
  const e = captureEnvironment({
    execPath: '/opt/weird/bin/node', version: 'v22.0.0',
    platform: 'linux', arch: 'arm64', env: { npm_config_user_agent: 'pnpm/9.0.0' },
  } as unknown as NodeJS.Process);
  assert.equal(e.interpreter, '/opt/weird/bin/node');
  assert.equal(e.version, 'v22.0.0');
  assert.equal(e.platform, 'linux/arm64');
  assert.equal(e.packageManager, 'pnpm/9.0.0');
});

test('an absent package manager is omitted, not empty', () => {
  const e = captureEnvironment({
    execPath: '/x/node', version: 'v24.0.0', platform: 'darwin', arch: 'x64', env: {},
  } as unknown as NodeJS.Process);
  assert.ok(!('packageManager' in e), `packageManager was ${JSON.stringify(e.packageManager)}`);
});
