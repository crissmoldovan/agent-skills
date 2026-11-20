import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers/temp-dir.mjs';

const script = fileURLToPath(new URL('../skills/manage-workspace-storage/scripts/workspace-storage.mjs', import.meta.url));

async function fixture() {
  const root = realpathSync.native(await tempDir('workspace-storage-'));
  const project = path.join(root, 'project');
  const scratch = path.join(root, 'scratch');
  mkdirSync(project);
  mkdirSync(scratch, { mode: 0o700 });
  const call = (action, ...args) => spawnSync(
    process.execPath, [script, action, '--project', project, ...args], { encoding: 'utf8' },
  );
  const start = () => {
    const result = call('start', '--scratch-root', scratch, '--min-free-mib', '0');
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).run;
  };
  return { root, project, scratch, call, start };
}

test('guard measures the context and fails on either exceeded budget or insufficient volume space', async () => {
  const { call, project, scratch } = await fixture();
  const context = path.join(project, '.context');
  mkdirSync(context);
  writeFileSync(path.join(context, 'note.md'), 'evidence');
  const healthy = call('guard', '--volume', scratch);
  assert.equal(healthy.status, 0, healthy.stderr);
  assert.equal(JSON.parse(healthy.stdout).contextBytes, '8');
  assert.match(call('guard', '--context-max-mib', '0').stderr, /context exceeds/i);
  assert.match(call('guard', '--volume', scratch, '--min-free-mib', '9007199254740991').stderr, /available space/i);
  assert.equal(call('guard', '--unsupported', 'x').status, 1);
});

test('the guard refuses a linked context and repository storage used as scratch', async () => {
  const { call, project, scratch } = await fixture();
  symlinkSync(scratch, path.join(project, '.context'));
  assert.match(call('guard').stderr, /real directory/i);
  assert.match(call('start', '--scratch-root', project, '--min-free-mib', '0').stderr, /outside the project/i);
});

test('an unretired run blocks another start and a preview leaves all files in place', async () => {
  const { call, scratch, start } = await fixture();
  const run = start();
  writeFileSync(path.join(run, 'work', 'output'), 'generated');
  assert.match(call('start', '--scratch-root', scratch, '--min-free-mib', '0').stderr, /existing run/i);
  const preview = call('cleanup', '--run', run);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).removed, false);
  assert.equal(readFileSync(path.join(run, 'work', 'output'), 'utf8'), 'generated');
  const open = call('cleanup', '--run', run, '--apply');
  assert.notEqual(open.status, 0);
  assert.match(open.stderr, /--closed/);
});

test('inventory distinguishes owned runs, registered checkouts, and unrelated output', async () => {
  const { call, root, project, scratch } = await fixture();
  const started = call('start', '--scratch-root', scratch, '--min-free-mib', '0', '--purpose', 'Tauri test');
  assert.equal(started.status, 0, started.stderr);
  const { run } = JSON.parse(started.stdout);
  const other = path.join(root, 'other');
  const artifact = path.join(scratch, 'legacy-verification');
  const checkout = path.join(artifact, 'candidate');
  const unknown = path.join(scratch, 'unattributed');
  mkdirSync(other);
  mkdirSync(artifact);
  mkdirSync(unknown);
  const git = (...args) => {
    const result = spawnSync('git', ['-C', other, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git('init', '-q');
  git('-c', 'user.name=Storage test', '-c', 'user.email=storage@example.invalid',
    '-c', 'commit.gpgSign=false', 'commit', '--allow-empty', '-qm', 'initial');
  git('worktree', 'add', '-q', '--detach', checkout);
  const result = call('inventory', '--artifact-root', scratch, '--owner-project', other);
  assert.equal(result.status, 0, result.stderr);
  const rows = new Map(JSON.parse(result.stdout).folders.map((row) => [row.path, row]));
  assert.equal(rows.get(run).ownerEvidence[0].project, project);
  assert.equal(rows.get(run).ownerEvidence[0].purpose, 'Tauri test');
  assert.deepEqual(rows.get(artifact).ownerEvidence, [{ kind: 'git-worktree', project: other, path: checkout }]);
  assert.deepEqual(rows.get(unknown).ownerEvidence, []);
  assert.ok(existsSync(run) && existsSync(checkout) && existsSync(unknown));
});

test('cleanup preserves linked files, refuses other projects, and verifies the owned run is gone', async () => {
  const { root, project, call, start } = await fixture();
  const run = start();
  const preserved = path.join(root, 'outside');
  writeFileSync(preserved, 'retain');
  symlinkSync(preserved, path.join(run, 'work', 'linked'));
  const other = path.join(root, 'other');
  mkdirSync(other);
  const foreign = spawnSync(process.execPath, [
    script, 'cleanup', '--project', other, '--run', run, '--apply', '--closed',
  ], { encoding: 'utf8' });
  assert.match(foreign.stderr, /owner marker/i);
  assert.equal(existsSync(run), true);
  const result = call('cleanup', '--run', run, '--apply', '--closed');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).removed, true);
  assert.equal(existsSync(run), false);
  assert.equal(readFileSync(preserved, 'utf8'), 'retain');
  assert.equal(existsSync(project), true);
});

test('cleanup refuses linked run roots, copied markers, and nested Git metadata', async () => {
  const { call, scratch, start } = await fixture();
  const run = start();
  const link = path.join(scratch, 'run-link');
  symlinkSync(run, link);
  assert.match(call('cleanup', '--run', link, '--apply', '--closed').stderr, /real directory/i);
  const copied = path.join(scratch, 'run-copied');
  mkdirSync(copied, { mode: 0o700 });
  const marker = '.agent-scratch.json';
  writeFileSync(path.join(copied, marker), readFileSync(path.join(run, marker)), { mode: 0o600 });
  assert.match(call('cleanup', '--run', copied, '--apply', '--closed').stderr, /owner marker/i);
  writeFileSync(path.join(run, 'work', '.git'), 'gitdir: somewhere');
  assert.match(call('cleanup', '--run', run, '--apply', '--closed').stderr, /git metadata/i);
  assert.equal(existsSync(run), true);
});

test('start can retry after an interrupted marker write without adopting unmarked output', async () => {
  const { project, root, scratch, start } = await fixture();
  const preload = path.join(root, 'reject-marker.cjs');
  writeFileSync(preload, `
    const fs = require('node:fs');
    const write = fs.writeFileSync;
    fs.writeFileSync = (target, ...args) => {
      if (String(target).endsWith('.agent-scratch.json')) {
        write(target, 'incomplete', { mode: 0o600 });
        throw Object.assign(new Error('injected write failure'), { code: 'ENOSPC' });
      }
      return write(target, ...args);
    };
    require('node:module').syncBuiltinESMExports();
  `);
  const failed = spawnSync(process.execPath, [
    '--require', preload, script, 'start', '--project', project,
    '--scratch-root', scratch, '--min-free-mib', '0',
  ], { encoding: 'utf8' });
  assert.match(failed.stderr, /injected write failure/);
  assert.deepEqual(readdirSync(scratch), []);
  assert.equal(existsSync(start()), true);
});

test('a competing start or cleanup cannot replace a run during deletion', async () => {
  const { call, project, root, scratch, start } = await fixture();
  const run = start();
  const preload = path.join(root, 'compete.cjs');
  writeFileSync(preload, `
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const { spawnSync } = require('node:child_process');
    const original = fs.readdirSync;
    fs.readdirSync = (directory, ...args) => {
      if (directory === ` + JSON.stringify(run) + `) {
        const call = (...args) => spawnSync(process.execPath, [` + JSON.stringify(script) + `, ...args], { encoding: 'utf8' });
        const competingCleanup = call('cleanup', '--project', ` + JSON.stringify(project) + `, '--run', directory, '--apply', '--closed');
        assert.match(competingCleanup.stderr, /root is reserved/);
        const competingStart = call('start', '--project', ` + JSON.stringify(project) + `, '--scratch-root', ` + JSON.stringify(scratch) + `, '--min-free-mib', '0');
        assert.match(competingStart.stderr, /root is reserved/);
      }
      return original(directory, ...args);
    };
    require('node:module').syncBuiltinESMExports();
  `);
  const result = spawnSync(process.execPath, [
    '--require', preload, script, 'cleanup', '--project', project, '--run', run, '--apply', '--closed',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(run), false);
  const successor = start();
  assert.notEqual(successor, run);
  assert.notEqual(call('cleanup', '--run', run, '--apply', '--closed').status, 0);
  assert.equal(existsSync(successor), true);
});

test('cleanup rejects parent traversal even when it would name an owned run', async () => {
  const { call, scratch, start } = await fixture();
  const run = start();
  mkdirSync(path.join(scratch, 'other'));
  symlinkSync(path.join(scratch, 'other'), path.join(scratch, 'link'));
  const ambiguous = scratch + '/link/../' + path.basename(run);
  assert.match(call('cleanup', '--run', ambiguous, '--apply', '--closed').stderr, /without parent traversal/);
  assert.equal(existsSync(run), true);
});
