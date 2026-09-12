import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function terminateWindowsTree(pid, { spawnSyncFn = spawnSync } = {}) {
  const result = spawnSyncFn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
    timeout: 5_000,
    killSignal: 'SIGKILL',
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`taskkill terminated with signal ${result.signal}`);
  if (result.status !== 0) throw new Error(`taskkill exited with status ${result.status}`);
}

export async function runTestSuite({
  processObject = process,
  packageUrl = new URL('../', import.meta.url),
  homeDirectory = homedir(),
  readdirFn = readdir,
  mkdtempFn = mkdtemp,
  rmFn = rm,
  spawnFn = spawn,
  sleepFn = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  windowsCloseDeadlineMs = 1_000,
  windowsTreeKillFn = terminateWindowsTree,
} = {}) {
  let root;
  let child;
  let processGroupId;
  let requestedSignal;
  let escalationTimer;
  let windowsCloseTimer;
  let windowsTreeTerminationRequested = false;
  let windowsTreeTerminationError;
  let rootIsSafeToRemove = false;
  let rejectWindowsCloseDeadline;
  const windowsCloseDeadline = new Promise((_, reject) => {
    rejectWindowsCloseDeadline = reject;
  });

  function posixGroupExists() {
    if (!processGroupId || processObject.platform === 'win32') return false;
    try {
      processObject.kill(-processGroupId, 0);
      return true;
    } catch (error) {
      if (error?.code === 'ESRCH') return false;
      if (error?.code === 'EPERM') return true;
      throw error;
    }
  }

  function signalManagedTree(signal) {
    if (!child?.pid) return;
    try {
      if (processObject.platform === 'win32') {
        if (windowsTreeTerminationRequested) return;
        windowsTreeTerminationRequested = true;
        windowsTreeKillFn(child.pid);
      }
      else processObject.kill(-processGroupId, signal);
    } catch (error) {
      if (processObject.platform === 'win32') {
        windowsTreeTerminationError = error;
        try {
          child.kill('SIGKILL');
        } catch (killError) {
          rejectWindowsCloseDeadline(new Error(
            `${error.message}; direct SIGKILL failed: ${killError.message}`,
            { cause: error },
          ));
          return;
        }
        windowsCloseTimer = setTimeoutFn(() => {
          child.unref?.();
          rejectWindowsCloseDeadline(new Error(
            `${error.message}; direct child close deadline exceeded`,
            { cause: error },
          ));
        }, windowsCloseDeadlineMs);
        windowsCloseTimer.unref?.();
      } else if (error?.code !== 'ESRCH') throw error;
    }
  }

  function forwardSignal(signal) {
    if (requestedSignal) return;
    requestedSignal = signal;
    if (!child) return;
    signalManagedTree(signal);
    escalationTimer = setTimeoutFn(() => signalManagedTree('SIGKILL'), 5_000);
    escalationTimer.unref?.();
  }

  async function quiesceManagedTree(outcome) {
    if (!child?.pid) return true;
    if (processObject.platform === 'win32') {
      if (windowsTreeTerminationError) throw windowsTreeTerminationError;
      if (!requestedSignal) return false;
      if (!windowsTreeTerminationRequested) signalManagedTree('SIGKILL');
      if (windowsTreeTerminationError) throw windowsTreeTerminationError;
      return true;
    }
    if (!posixGroupExists()) return true;
    if (!requestedSignal && !outcome.signal) signalManagedTree('SIGTERM');
    const gracefulDeadline = Date.now() + 5_000;
    while (posixGroupExists() && Date.now() < gracefulDeadline) await sleepFn(20);
    if (posixGroupExists()) signalManagedTree('SIGKILL');
    const killDeadline = Date.now() + 5_000;
    while (posixGroupExists() && Date.now() < killDeadline) await sleepFn(20);
    if (posixGroupExists()) throw new Error(`test process group ${processGroupId} did not quiesce`);
    return true;
  }

  const signalHandlers = new Map(
    ['SIGINT', 'SIGTERM'].map((signal) => [signal, () => forwardSignal(signal)]),
  );
  for (const [signal, handler] of signalHandlers) processObject.on(signal, handler);

  try {
    const testDirectory = fileURLToPath(new URL('test/', packageUrl));
    const tests = (await readdirFn(testDirectory))
      .filter((name) => name.endsWith('.test.ts'))
      .sort()
      .map((name) => join(testDirectory, name));
    if (requestedSignal) return { status: null, signal: requestedSignal };

    root = await mkdtempFn(join(homeDirectory, '.workspace-governance-test-'));
    rootIsSafeToRemove = true;
    if (requestedSignal) return { status: null, signal: requestedSignal };

    child = spawnFn(process.execPath, ['--test', '--test-concurrency=1', ...tests], {
      detached: processObject.platform !== 'win32',
      env: { ...process.env, WG_NATIVE_TEST_ROOT: root },
      stdio: 'inherit',
    });
    processGroupId = child.pid;
    if (processGroupId) rootIsSafeToRemove = false;
    if (requestedSignal) {
      signalManagedTree(requestedSignal);
      escalationTimer = setTimeoutFn(() => signalManagedTree('SIGKILL'), 5_000);
      escalationTimer.unref?.();
    }
    const outcome = await Promise.race([
      new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (status, signal) => resolve({ status, signal }));
      }),
      windowsCloseDeadline,
    ]);
    rootIsSafeToRemove = await quiesceManagedTree(outcome);
    return { status: outcome.status, signal: requestedSignal ?? outcome.signal };
  } finally {
    if (escalationTimer) clearTimeoutFn(escalationTimer);
    if (windowsCloseTimer) clearTimeoutFn(windowsCloseTimer);
    for (const [signal, handler] of signalHandlers) processObject.removeListener(signal, handler);
    if (root && rootIsSafeToRemove) await rmFn(root, { recursive: true, force: true });
  }
}
