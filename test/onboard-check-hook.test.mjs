import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers/temp-dir.mjs';

import {
  DESCRIBE_PREFIX,
  MATCHERS,
  buildHookEntry,
  installHooks,
  removeHooks,
  runsOurCheck,
} from '../skills/onboard-project/scripts/install-check-hook.mjs';

const packRoot = fileURLToPath(new URL('../', import.meta.url));
const installer = path.join(packRoot, 'skills', 'onboard-project', 'scripts', 'install-check-hook.mjs');
const checker = path.join(packRoot, 'skills', 'onboard-project', 'scripts', 'onboard.mjs');
const scratch = (name) => tempDir(`${name}-`);

function run(command, args, { home, cwd, input } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, HOME: home ?? process.env.HOME, USERPROFILE: home ?? process.env.HOME },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

const hookCommand = () => buildHookEntry({ checkerPath: checker }).command;

test('the hook entry runs the checker with check --hook, and carries a describe', () => {
  const entry = buildHookEntry({ checkerPath: checker, nodePath: '/bin/node' });
  assert.equal(entry.type, 'command');
  assert.equal(entry.command, `'/bin/node' '${checker}' check --hook`);
  assert.equal(entry.timeout, 5);
  assert.ok(entry.describe.startsWith(DESCRIBE_PREFIX));
});

test('a hook is recognised by its command, which survives Claude Code dropping describe', () => {
  const entry = buildHookEntry({ checkerPath: checker });
  assert.equal(runsOurCheck(entry.command, { checkerPath: checker }), true);
  // The same command with no describe at all is still ours.
  const settings = installHooks({}, { entry, checkerPath: checker });
  for (const group of settings.hooks.SessionStart) for (const hook of group.hooks) delete hook.describe;
  const { removed } = removeHooks(settings, { checkerPath: checker });
  assert.equal(removed, MATCHERS.length, 'a describe-less copy of our own hook was not recognised');
});

test('a hook that only mentions the checker is never taken', () => {
  assert.equal(runsOurCheck(`'node' '${checker}' check`, { checkerPath: checker }), false);
  assert.equal(runsOurCheck(`cat '${checker}'`, { checkerPath: checker }), false);
  assert.equal(runsOurCheck(`'node' '${checker}' plan --json`, { checkerPath: checker }), false);
  assert.equal(runsOurCheck(`'deno' '${checker}' check --hook`, { checkerPath: checker }), false);
});

test('installing writes both matchers, and installing again does not stack a second copy', () => {
  const once = installHooks({}, { entry: buildHookEntry({ checkerPath: checker }), checkerPath: checker });
  assert.deepEqual(once.hooks.SessionStart.map((group) => group.matcher), [...MATCHERS]);
  const twice = installHooks(once, { entry: buildHookEntry({ checkerPath: checker }), checkerPath: checker });
  const total = twice.hooks.SessionStart.reduce((count, group) => count + group.hooks.length, 0);
  assert.equal(total, MATCHERS.length, 'a second copy was stacked beside the first');
});

test('a foreign hook running this checker is refused rather than replaced', () => {
  const foreign = { hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: `sh -c "${checker} check"` }] }] } };
  assert.throws(() => installHooks(foreign, { checkerPath: checker }), /does not recognise/);
});

test('install then remove leaves the rest of the settings file exactly as it was', async () => {
  const home = await scratch('onboard-hook-settings');
  const file = path.join(home, '.claude', 'settings.json');
  await mkdir(path.dirname(file), { recursive: true });
  const original = {
    model: 'a-model',
    hooks: {
      Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'somebody-elses-gate', timeout: 10 }] }],
      SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'another-hook' }] }],
    },
  };
  await writeFile(file, `${JSON.stringify(original, null, 2)}\n`);
  const before = await readFile(file, 'utf8');

  const installed = await run(process.execPath, [installer, '--settings', file], { home });
  assert.equal(installed.status, 0, installed.stderr);
  const withHook = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(withHook.model, 'a-model');
  assert.equal(withHook.hooks.Stop[0].hooks[0].command, 'somebody-elses-gate');
  const ours = withHook.hooks.SessionStart.flatMap((group) => group.hooks).filter((hook) => runsOurCheck(hook.command, { checkerPath: checker }));
  assert.equal(ours.length, MATCHERS.length);

  const removed = await run(process.execPath, [installer, '--remove', '--settings', file], { home });
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(await readFile(file, 'utf8'), before, 'removing did not restore the file it found');
});

test('the hook command runs under /bin/sh and under dash, printing nothing in a repository with no profile', async () => {
  const home = await scratch('onboard-hook-shell');
  const repo = await scratch('onboard-hook-repo');
  // No .git and no profile: the check has nothing to say, and must say nothing.
  await writeFile(path.join(repo, 'README.md'), '# nothing to see\n');

  const command = hookCommand();
  const shells = [['/bin/sh', ['-c', command]]];
  const dash = spawnSync('sh', ['-c', 'command -v dash'], { encoding: 'utf8' }).stdout.trim();
  if (dash) shells.push([dash, ['-c', command]]);

  for (const [shell, args] of shells) {
    const result = await run(shell, args, { home, cwd: repo, input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', cwd: repo }) });
    assert.equal(result.status, 0, `${shell}: ${result.stderr}`);
    assert.equal(result.stdout, '', `${shell} printed something in a repository with nothing to report`);
  }
  assert.ok(shells.length >= 1);
});

test('the hook speaks in a repository whose profile lists a skill that is not installed', async () => {
  const home = await scratch('onboard-hook-speaks-home');
  const repo = await scratch('onboard-hook-speaks-repo');
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }));
  await writeFile(path.join(repo, 'skills-profile.json'), JSON.stringify({
    version: 1,
    placement: 'committed',
    fingerprint: 'not-the-current-one',
    skills: { 'release-notes': { match: 'strong', evidence: [], useWhen: 'cutting a release', required: true, scope: 'project' } },
    declined: {},
  }));

  const result = await run('/bin/sh', ['-c', hookCommand()], { home, cwd: repo, input: '{}' });
  assert.equal(result.status, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(envelope.hookSpecificOutput.additionalContext, /release-notes/);
  assert.equal(result.stdout.trimEnd().split('\n').length, 1, 'the hook wrote more than one line');
});

test('the check finds the repository root from a subdirectory, the way a hook meets it', async () => {
  const home = await scratch('onboard-hook-subdir-home');
  const repo = await scratch('onboard-hook-subdir-repo');
  await mkdir(path.join(repo, '.git'), { recursive: true });
  await mkdir(path.join(repo, 'packages', 'inner'), { recursive: true });
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }));
  await writeFile(path.join(repo, 'skills-profile.json'), JSON.stringify({
    version: 1,
    placement: 'committed',
    fingerprint: 'stale',
    skills: { 'release-notes': { match: 'strong', evidence: [], useWhen: 'cutting a release', required: true, scope: 'project' } },
    declined: {},
  }));

  const result = await run('/bin/sh', ['-c', hookCommand()], { home, cwd: path.join(repo, 'packages', 'inner'), input: '{}' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /release-notes/, 'the check did not find the repository root from a subdirectory');
});
