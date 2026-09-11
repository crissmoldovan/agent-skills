import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { runTestSuite, terminateWindowsTree } from '../packages/workspace-governance/scripts/test-runner.mjs';

test('default Windows tree termination is time-bounded', () => {
  let invocation;
  terminateWindowsTree(4321, {
    spawnSyncFn: (...args) => {
      invocation = args;
      return { status: 0, signal: null, error: null };
    },
  });

  assert.deepEqual(invocation.slice(0, 2), [
    'taskkill.exe',
    ['/PID', '4321', '/T', '/F'],
  ]);
  assert.equal(invocation[2].timeout, 5_000);
  assert.equal(invocation[2].killSignal, 'SIGKILL');
});

test('discovery cancellation is captured before any private root or child exists', async () => {
  const processObject = new EventEmitter();
  processObject.platform = 'linux';
  let resolveDiscovery;
  const discovery = new Promise((resolve) => { resolveDiscovery = resolve; });
  let rootCalls = 0;
  let spawnCalls = 0;

  const running = runTestSuite({
    processObject,
    packageUrl: new URL('file:///fixture/package/'),
    homeDirectory: '/fixture/home',
    readdirFn: async () => discovery,
    mkdtempFn: async () => {
      rootCalls += 1;
      return '/fixture/home/.workspace-governance-test-fixed';
    },
    rmFn: async () => {},
    spawnFn: () => {
      spawnCalls += 1;
      throw new Error('child must not start after discovery cancellation');
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  processObject.emit('SIGINT');
  resolveDiscovery(['probe.test.ts']);

  const outcome = await running;
  assert.deepEqual(outcome, { status: null, signal: 'SIGINT' });
  assert.equal(rootCalls, 0);
  assert.equal(spawnCalls, 0);
  assert.equal(processObject.listenerCount('SIGINT'), 0);
  assert.equal(processObject.listenerCount('SIGTERM'), 0);
});

test('setup cancellation is captured before root acquisition and prevents child launch', async () => {
  const processObject = new EventEmitter();
  processObject.platform = 'linux';
  let resolveRoot;
  const rootCreated = new Promise((resolve) => { resolveRoot = resolve; });
  let spawnCalls = 0;
  const removed = [];

  const running = runTestSuite({
    processObject,
    packageUrl: new URL('file:///fixture/package/'),
    homeDirectory: '/fixture/home',
    readdirFn: async () => ['probe.test.ts'],
    mkdtempFn: async () => rootCreated,
    rmFn: async (path) => removed.push(path),
    spawnFn: () => { spawnCalls += 1; throw new Error('child must not start after cancellation'); },
  });

  await new Promise((resolve) => setImmediate(resolve));
  processObject.emit('SIGTERM');
  processObject.emit('SIGTERM');
  resolveRoot('/fixture/home/.workspace-governance-test-fixed');

  const outcome = await running;
  assert.deepEqual(outcome, { status: null, signal: 'SIGTERM' });
  assert.equal(spawnCalls, 0);
  assert.deepEqual(removed, ['/fixture/home/.workspace-governance-test-fixed']);
  assert.equal(processObject.listenerCount('SIGINT'), 0);
  assert.equal(processObject.listenerCount('SIGTERM'), 0);
});

test('Windows cancellation uses a whole-process-tree terminator before cleanup', async () => {
  const processObject = new EventEmitter();
  processObject.platform = 'win32';
  const child = new EventEmitter();
  child.pid = 4321;
  const events = [];
  let resolveSpawned;
  const spawned = new Promise((resolve) => { resolveSpawned = resolve; });
  child.kill = (signal) => {
    events.push(`direct:${signal}`);
    setImmediate(() => child.emit('close', null, signal));
  };

  const running = runTestSuite({
    processObject,
    packageUrl: new URL('file:///fixture/package/'),
    homeDirectory: 'C:/fixture/home',
    readdirFn: async () => ['probe.test.ts'],
    mkdtempFn: async () => 'C:/fixture/home/.workspace-governance-test-fixed',
    rmFn: async () => events.push('remove-root'),
    spawnFn: () => {
      resolveSpawned();
      return child;
    },
    windowsTreeKillFn: (pid) => {
      events.push(`tree:${pid}`);
      setImmediate(() => child.emit('close', null, 'SIGKILL'));
    },
  });

  await spawned;
  processObject.emit('SIGTERM');
  const outcome = await running;

  assert.deepEqual(outcome, { status: null, signal: 'SIGTERM' });
  assert.deepEqual(events, ['tree:4321', 'remove-root']);
});

test('Windows tree-termination failure force-kills the direct child and preserves the root', async () => {
  const processObject = new EventEmitter();
  processObject.platform = 'win32';
  const child = new EventEmitter();
  child.pid = 4321;
  const events = [];
  let resolveSpawned;
  const spawned = new Promise((resolve) => { resolveSpawned = resolve; });
  child.kill = (signal) => {
    events.push(`direct:${signal}`);
    setImmediate(() => child.emit('close', null, signal));
  };

  const running = runTestSuite({
    processObject,
    packageUrl: new URL('file:///fixture/package/'),
    homeDirectory: 'C:/fixture/home',
    readdirFn: async () => ['probe.test.ts'],
    mkdtempFn: async () => 'C:/fixture/home/.workspace-governance-test-fixed',
    rmFn: async () => events.push('remove-root'),
    spawnFn: () => {
      resolveSpawned();
      return child;
    },
    windowsTreeKillFn: () => {
      events.push('tree:4321');
      throw new Error('taskkill unavailable');
    },
  });

  await spawned;
  processObject.emit('SIGTERM');

  await assert.rejects(running, /taskkill unavailable/);
  assert.deepEqual(events, ['tree:4321', 'direct:SIGKILL']);
  assert.equal(processObject.listenerCount('SIGINT'), 0);
  assert.equal(processObject.listenerCount('SIGTERM'), 0);
});

test('Windows tree-termination failure settles when direct close never arrives', async () => {
  const processObject = new EventEmitter();
  processObject.platform = 'win32';
  const child = new EventEmitter();
  child.pid = 4321;
  const events = [];
  child.kill = (signal) => events.push(`direct:${signal}`);
  child.unref = () => events.push('unref-child');
  let resolveSpawned;
  const spawned = new Promise((resolve) => { resolveSpawned = resolve; });

  const running = runTestSuite({
    packageUrl: new URL('file:///tmp/package/'),
    processObject,
    readdirFn: async () => ['probe.test.ts'],
    mkdtempFn: async () => '/tmp/private-root',
    rmFn: async () => events.push('remove-root'),
    spawnFn: () => {
      resolveSpawned();
      return child;
    },
    setTimeoutFn: (callback, milliseconds) => {
      const handle = { unref() {} };
      if (milliseconds === 1_000) setImmediate(callback);
      return handle;
    },
    clearTimeoutFn: () => {},
    windowsTreeKillFn: () => {
      events.push('tree:4321');
      throw new Error('taskkill unavailable');
    },
  });

  await spawned;
  processObject.emit('SIGTERM');
  await assert.rejects(running, /taskkill unavailable.*close deadline/i);
  assert.deepEqual(events, ['tree:4321', 'direct:SIGKILL', 'unref-child']);
  assert.equal(processObject.listenerCount('SIGINT'), 0);
  assert.equal(processObject.listenerCount('SIGTERM'), 0);
});

test('Windows clean child completion retains root without whole-tree proof', async () => {
  const processObject = new EventEmitter();
  processObject.platform = 'win32';
  const child = new EventEmitter();
  child.pid = 4321;
  const events = [];

  const outcomePromise = runTestSuite({
    packageUrl: new URL('file:///tmp/package/'),
    processObject,
    readdirFn: async () => ['probe.test.ts'],
    mkdtempFn: async () => '/tmp/private-root',
    rmFn: async () => events.push('remove-root'),
    spawnFn: () => {
      setImmediate(() => child.emit('close', 0, null));
      return child;
    },
    windowsTreeKillFn: () => events.push('tree:4321'),
  });

  assert.deepEqual(await outcomePromise, { status: 0, signal: null });
  assert.deepEqual(events, []);
});

test('POSIX quiescence-probe failure preserves the root', async () => {
  const processObject = new EventEmitter();
  processObject.platform = 'linux';
  processObject.kill = (_pid, signal) => {
    if (signal !== 0) events.push(`group:${signal}`);
  };
  const child = new EventEmitter();
  child.pid = 4321;
  const events = [];

  const running = runTestSuite({
    processObject,
    packageUrl: new URL('file:///fixture/package/'),
    homeDirectory: '/fixture/home',
    readdirFn: async () => ['probe.test.ts'],
    mkdtempFn: async () => '/fixture/home/.workspace-governance-test-fixed',
    rmFn: async () => events.push('remove-root'),
    spawnFn: () => {
      setImmediate(() => child.emit('close', 0, null));
      return child;
    },
    sleepFn: async () => {
      throw new Error('quiescence probe failed');
    },
  });

  await assert.rejects(running, /quiescence probe failed/);
  assert.deepEqual(events, ['group:SIGTERM']);
  assert.equal(processObject.listenerCount('SIGINT'), 0);
  assert.equal(processObject.listenerCount('SIGTERM'), 0);
});
