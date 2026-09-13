import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BASH_MATCHER,
  DESCRIBE_PREFIX,
  GATE_ENV_FLAG,
  HOOK_EVENT,
  HOOK_MARKER,
  MODES,
  buildHookEntry,
  installHook,
  removeHook,
  resolveSettingsPath,
} from '../adapters/claude-code/install-release-notes-gate.mjs';

const gate = fileURLToPath(new URL('../adapters/claude-code/release-notes-gate.sh', import.meta.url));
const installer = fileURLToPath(new URL('../adapters/claude-code/install-release-notes-gate.mjs', import.meta.url));

// ---------------------------------------------------------------------------
// Driving the gate the way Claude Code does: a PreToolUse payload on stdin, a
// permission decision on stdout. Nothing here asserts on an exit code — every
// path of this hook exits 0, which is the contract, so the DECISION is the only
// signal there is and a test that read the status would pass on a dead gate.
// ---------------------------------------------------------------------------

function runGate(payload, { mode = 'block', env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn('bash', [gate], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, [GATE_ENV_FLAG]: mode, ...env },
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
}

function runInstaller(argv) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [installer, ...argv], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

const bashCall = (command, cwd) => ({
  hook_event_name: 'PreToolUse',
  session_id: 'sess-abc123',
  tool_name: 'Bash',
  cwd,
  tool_input: { command },
});

function decision(result) {
  if (result.stdout.trim() === '') return null;
  return JSON.parse(result.stdout).hookSpecificOutput;
}

/** A refusal names the version and points at a file the reader can open. */
function assertRefused(result, version) {
  const output = decision(result);
  assert.ok(output, `expected a refusal, got nothing on stdout (stderr: ${result.stderr})`);
  assert.equal(output.hookEventName, 'PreToolUse');
  assert.equal(output.permissionDecision, 'deny');
  assert.match(output.permissionDecisionReason, new RegExp(version.replaceAll('.', '\\.')));
  assert.match(output.permissionDecisionReason, /release-notes skill/);
}

function assertAllowed(result) {
  assert.equal(result.stdout.trim(), '', `expected no decision, got: ${result.stdout}`);
}

async function scratch(name) {
  return mkdtemp(path.join(tmpdir(), `${name}-`));
}

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });

/**
 * A project fixture. `notes` names the file the release note lives in, which is the whole
 * point of these tests: this pack records releases in BOTH `CHANGELOG.md` and
 * `docs/releases.md`, and the gate was written against a repository that only had the first.
 */
async function project({ version = '1.4.0', notes = 'CHANGELOG.md', noted = [], name = '@acme/cli' } = {}) {
  const dir = await scratch('release-notes-gate');
  await writeFile(path.join(dir, 'package.json'), `${JSON.stringify({ name, version }, null, 2)}\n`);
  if (notes) {
    await mkdir(path.join(dir, path.dirname(notes)), { recursive: true });
    const body = noted.map((v) => `## ${v}\n\nwhat / why / impact\n`).join('\n');
    await writeFile(path.join(dir, notes), `# Releases\n\n${body}`);
  }
  return dir;
}

async function repository(options) {
  const dir = await project(options);
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

// ---------------------------------------------------------------------------
// Off unless armed
// ---------------------------------------------------------------------------

test('an unarmed gate decides nothing, whatever the release looks like', async () => {
  const dir = await project({ noted: ['1.0.0'] });
  for (const mode of ['', 'off', '0', 'true', 'BLOCKED']) {
    const result = await runGate(bashCall('npm publish', dir), { mode });
    assertAllowed(result);
    assert.equal(result.stderr.trim(), '', `mode ${mode} spoke when it should have been silent`);
  }
});

test('observe mode reports what it would have refused and refuses nothing', async () => {
  const dir = await project({ noted: ['1.0.0'] });
  const result = await runGate(bashCall('npm publish', dir), { mode: 'observe' });
  assertAllowed(result);
  assert.match(result.stderr, /would have refused/);
  assert.match(result.stderr, /1\.4\.0/);
});

// ---------------------------------------------------------------------------
// The two outcomes that matter, on every gated verb
// ---------------------------------------------------------------------------

test('a version WITH a note is allowed on every gated verb', async () => {
  const dir = await repository({ noted: ['1.4.0', '1.3.0'] });
  for (const command of [
    'npm publish',
    'pnpm publish --access public',
    'yarn publish',
    'changeset publish',
    'gh release create v1.4.0 --notes-file notes.md',
    'glab release create v1.4.0',
    'git tag v1.4.0',
    'git tag -a v1.4.0 -m release',
  ]) {
    assertAllowed(await runGate(bashCall(command, dir), {}));
  }
});

test('a version with NO note is refused on every gated verb', async () => {
  const dir = await repository({ noted: ['1.3.0'] });
  for (const command of [
    'npm publish',
    'pnpm publish --access public',
    'yarn publish',
    'changeset publish',
    'gh release create v1.4.0 --notes-file notes.md',
    'glab release create v1.4.0',
    'git tag v1.4.0',
    'git tag -a v1.4.0 -m release',
  ]) {
    assertRefused(await runGate(bashCall(command, dir), {}), '1.4.0');
  }
});

test('a command that is not a release is left alone', async () => {
  const dir = await repository({ noted: ['1.3.0'] });
  for (const command of [
    'npm install',
    'npm run publish:docs',
    'git tag',
    'git tag --list',
    'git tag stable',                       // not a version-shaped tag
    'gh pr create --fill',
    'echo npm publish',                     // no leading verb position
  ]) {
    assertAllowed(await runGate(bashCall(command, dir), {}));
  }
});

// ---------------------------------------------------------------------------
// `git -C <dir> tag` — the form that regressed
//
// `git -C <dir> tag v1.2.3` contains no `git tag` substring. The detector missed it
// entirely, the branch never ran, and a tag cut against another checkout went
// COMPLETELY ungated — which is how a release got tagged with no note at all. Both
// halves are asserted: that it is now detected, and that it is judged against the
// NAMED repository rather than the session's own.
// ---------------------------------------------------------------------------

test('git -C <dir> tag is gated, and judged against the named repository', async () => {
  const unnoted = await repository({ noted: ['1.3.0'] });
  const noted = await repository({ noted: ['1.4.0'] });
  const elsewhere = await scratch('release-notes-elsewhere');

  const refused = await runGate(bashCall(`git -C ${unnoted} tag v1.4.0`, elsewhere), {});
  assertRefused(refused, '1.4.0');
  assert.match(decision(refused).permissionDecisionReason, new RegExp(unnoted.replaceAll('.', '\\.')));

  assertAllowed(await runGate(bashCall(`git -C ${noted} tag v1.4.0`, elsewhere), {}));
});

test('a session cwd with no note cannot refuse a tag cut in another checkout that has one', async () => {
  // The false positive this branch exists to remove: the session's own repository has no
  // 1.4.0 note and never will, because 1.4.0 belongs to the other one.
  const session = await repository({ noted: ['0.1.0'] });
  const target = await repository({ noted: ['1.4.0'] });
  assertAllowed(await runGate(bashCall(`git -C ${target} tag v1.4.0`, session), {}));
});

test('cd <dir> && git tag is judged against the directory the command runs in', async () => {
  const unnoted = await repository({ noted: ['1.3.0'] });
  const elsewhere = await scratch('release-notes-elsewhere');
  assertRefused(await runGate(bashCall(`cd ${unnoted} && git tag v1.4.0`, elsewhere), {}), '1.4.0');
});

// ---------------------------------------------------------------------------
// Note sources other than CHANGELOG.md
//
// The gate was written for one repository. This pack is not that repository: it records
// releases in `docs/releases.md` as well. A gate that only knows `CHANGELOG.md` reports
// "no changelog here" in every other layout and allows every release, while reporting
// itself installed and working.
// ---------------------------------------------------------------------------

for (const notes of ['CHANGELOG.md', 'CHANGES.md', 'HISTORY.md', 'NEWS.md', 'docs/releases.md', 'docs/CHANGELOG.md']) {
  test(`a release note in ${notes} is found`, async () => {
    assertAllowed(await runGate(bashCall('npm publish', await project({ notes, noted: ['1.4.0'] })), {}));
    assertRefused(await runGate(bashCall('npm publish', await project({ notes, noted: ['1.3.0'] })), {}), '1.4.0');
  });
}

test('a per-release file under docs/releases/ is found', async () => {
  const dir = await project({ notes: null });
  await mkdir(path.join(dir, 'docs', 'releases'), { recursive: true });
  await writeFile(path.join(dir, 'docs', 'releases', '2026-01-01-wave.md'), '# Wave\n\n## 1.4.0\n\nwhy\n');
  assertAllowed(await runGate(bashCall('npm publish', dir), {}));
});

test('a pending changeset counts as the note, and an empty .changeset does not', async () => {
  // A pending changeset carries a bump type and no version at all — the version does not
  // exist until `changeset version` runs — so its presence is the only checkable thing.
  const staged = await project({ notes: null });
  await mkdir(path.join(staged, '.changeset'), { recursive: true });
  await writeFile(path.join(staged, '.changeset', 'README.md'), 'changesets live here\n');
  await writeFile(path.join(staged, '.changeset', 'brave-pandas-smile.md'), '---\n"@acme/cli": minor\n---\n\nwhy\n');
  assertAllowed(await runGate(bashCall('changeset publish', staged), {}));

  const empty = await project({ notes: null });
  await mkdir(path.join(empty, '.changeset'), { recursive: true });
  await writeFile(path.join(empty, '.changeset', 'README.md'), 'changesets live here\n');
  assertRefused(await runGate(bashCall('changeset publish', empty), {}), '1.4.0');
});

test('every heading dialect a changelog generator emits is accepted', async () => {
  for (const heading of [
    '## 1.4.0',
    '## v1.4.0',
    '## [1.4.0] - 2026-01-01',
    '## [v1.4.0]',
    '## @acme/cli@1.4.0',
    '### Release 1.4.0 (2026-01-01)',
    '1.4.0\n=====',
  ]) {
    const dir = await project({ notes: null });
    await writeFile(path.join(dir, 'CHANGELOG.md'), `# Changelog\n\n${heading}\n\nwhy\n`);
    assertAllowed(await runGate(bashCall('npm publish', dir), {}));
  }
});

test('a neighbouring version does not satisfy the version being released', async () => {
  for (const other of ['1.4.00', '1.4.0-rc.1', '11.4.0', '1.4.01']) {
    const dir = await project({ notes: null });
    await writeFile(path.join(dir, 'CHANGELOG.md'), `# Changelog\n\n## ${other}\n\nwhy\n`);
    assertRefused(await runGate(bashCall('npm publish', dir), {}), '1.4.0');
  }
});

// ---------------------------------------------------------------------------
// Fail-open: the direction a guard like this must fail in
// ---------------------------------------------------------------------------

test('a project with no release-note file at all is allowed, silently', async () => {
  // Not a violation: a different convention. The consequence — an armed gate that never
  // fires here — is stated in the installer's own output and in the adapter README.
  const dir = await project({ notes: null });
  const result = await runGate(bashCall('npm publish', dir), {});
  assertAllowed(result);
  assert.equal(result.stderr.trim(), '');
});

test('an unresolvable cd target, an unreadable package.json, and a foreign --repo all allow', async () => {
  const dir = await repository({ noted: ['1.3.0'] });
  assertAllowed(await runGate(bashCall(`cd ${path.join(dir, 'no-such-dir')} && npm publish`, dir), {}));

  const broken = await scratch('release-notes-broken');
  await writeFile(path.join(broken, 'package.json'), 'not json at all');
  await writeFile(path.join(broken, 'CHANGELOG.md'), '# Changelog\n');
  assertAllowed(await runGate(bashCall('npm publish', broken), {}));

  assertAllowed(await runGate(bashCall('gh release create v1.4.0 --repo someone/else', dir), {}));
});

test('a payload with no command, or no payload at all, decides nothing', async () => {
  assertAllowed(await runGate({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'x' } }, {}));
  assertAllowed(await runGate({}, {}));
});

// ---------------------------------------------------------------------------
// Version-bump commits, including the same-commit escape hatch
// ---------------------------------------------------------------------------

test('a commit that bumps the version with no note anywhere is refused', async () => {
  const dir = await repository({ version: '1.0.0', noted: ['1.0.0'] });
  await writeFile(path.join(dir, 'package.json'), `${JSON.stringify({ name: '@acme/cli', version: '1.1.0' }, null, 2)}\n`);
  git(dir, 'add', 'package.json');
  assertRefused(await runGate(bashCall('git commit -m "chore(release): 1.1.0"', dir), {}), '1.1.0');
});

test('a note staged in the SAME commit is the right answer, in whichever file it lives', async () => {
  for (const notes of ['CHANGELOG.md', 'docs/releases.md']) {
    const dir = await repository({ version: '1.0.0', notes, noted: ['1.0.0'] });
    await writeFile(path.join(dir, 'package.json'), `${JSON.stringify({ name: '@acme/cli', version: '1.1.0' }, null, 2)}\n`);
    await writeFile(path.join(dir, notes), '# Releases\n\n## 1.1.0\n\nwhat / why / impact\n\n## 1.0.0\n\nwhy\n');
    git(dir, 'add', 'package.json', notes);
    assertAllowed(await runGate(bashCall('git commit -m "chore(release): 1.1.0"', dir), {}));
  }
});

test('a commit that stages no package.json bump is left alone', async () => {
  const dir = await repository({ version: '1.0.0', noted: ['1.0.0'] });
  await writeFile(path.join(dir, 'src.txt'), 'change\n');
  git(dir, 'add', 'src.txt');
  assertAllowed(await runGate(bashCall('git commit -m "fix: something"', dir), {}));
});

test('git -C <dir> commit reads the index of the repository it will write, not the session\'s', async () => {
  // An unnoted bump staged in the SESSION's repository must not refuse an unrelated commit
  // that lands somewhere else.
  const session = await repository({ version: '1.0.0', noted: ['1.0.0'] });
  await writeFile(path.join(session, 'package.json'), `${JSON.stringify({ name: '@acme/cli', version: '9.9.9' }, null, 2)}\n`);
  git(session, 'add', 'package.json');

  const other = await repository({ version: '2.0.0', noted: ['2.0.0'] });
  await writeFile(path.join(other, 'src.txt'), 'unrelated\n');
  git(other, 'add', 'src.txt');

  assertAllowed(await runGate(bashCall(`git -C ${other} commit -m "fix: unrelated"`, session), {}));
  assertRefused(await runGate(bashCall(`git -C ${session} commit -m "chore: bump"`, other), {}), '9.9.9');
});

// ---------------------------------------------------------------------------
// The installer. A user runs it; nothing runs it for them.
// ---------------------------------------------------------------------------

test('the hook entry carries the mode in its own command, and says what it cannot check', () => {
  for (const mode of MODES) {
    const entry = buildHookEntry({ mode, gatePath: `/somewhere/${HOOK_MARKER}` });
    assert.equal(entry.type, 'command');
    assert.ok(entry.command.startsWith(`${GATE_ENV_FLAG}=${mode} `), entry.command);
    assert.match(entry.command, new RegExp(HOOK_MARKER.replaceAll('.', '\\.')));
    assert.ok(entry.describe.startsWith(DESCRIBE_PREFIX));
    assert.match(entry.describe, /cannot check what it says/);
    assert.match(entry.describe, /allows anything it cannot resolve/);
    assert.match(entry.describe, /--remove/);
    assert.equal(typeof entry.timeout, 'number');
  }
  assert.throws(() => buildHookEntry({ mode: 'on', gatePath: '/x' }), /mode must be one of/);
});

test('installing writes one PreToolUse Bash hook and leaves the rest of the file alone', () => {
  const settings = { model: 'opus', hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'theirs' }] }] } };
  const entry = buildHookEntry({ mode: 'block', gatePath: `/somewhere/${HOOK_MARKER}` });
  const updated = installHook(settings, { entry });

  assert.equal(updated.model, 'opus');
  assert.equal(updated.hooks.Stop[0].hooks[0].command, 'theirs');
  const groups = updated.hooks[HOOK_EVENT];
  assert.equal(groups.length, 1);
  assert.equal(groups[0].matcher, BASH_MATCHER);
  assert.equal(groups[0].hooks.length, 1);
});

test('re-installing replaces our hook rather than stacking a second one', () => {
  let settings = {};
  settings = installHook(settings, { entry: buildHookEntry({ mode: 'observe', gatePath: `/a/${HOOK_MARKER}` }) });
  settings = installHook(settings, { entry: buildHookEntry({ mode: 'block', gatePath: `/a/${HOOK_MARKER}` }) });
  const hooks = settings.hooks[HOOK_EVENT][0].hooks;
  assert.equal(hooks.length, 1);
  assert.match(hooks[0].command, new RegExp(`${GATE_ENV_FLAG}=block`));
});

test('a hook wearing the gate\'s name that we did not write is refused, not replaced', () => {
  const settings = {
    hooks: { [HOOK_EVENT]: [{ matcher: BASH_MATCHER, hooks: [{ type: 'command', command: `bash /theirs/${HOOK_MARKER}` }] }] },
  };
  assert.throws(
    () => installHook(settings, { entry: buildHookEntry({ mode: 'block', gatePath: `/ours/${HOOK_MARKER}` }) }),
    /was not written by this installer/,
  );
});

test('removing takes ours out and leaves no residue', () => {
  const theirs = { type: 'command', command: 'unrelated' };
  let settings = { hooks: { [HOOK_EVENT]: [{ matcher: BASH_MATCHER, hooks: [theirs] }] } };
  settings = installHook(settings, { entry: buildHookEntry({ mode: 'block', gatePath: `/a/${HOOK_MARKER}` }) });
  const { settings: pruned, removed } = removeHook(settings);
  assert.equal(removed, 1);
  assert.deepEqual(pruned.hooks[HOOK_EVENT][0].hooks, [theirs]);

  const { settings: bare } = removeHook(installHook({}, { entry: buildHookEntry({ mode: 'block', gatePath: `/a/${HOOK_MARKER}` }) }));
  assert.equal(Object.hasOwn(bare, 'hooks'), false, 'removing our only hook left an empty hooks object behind');
});

test('a settings file that is not JSON is never clobbered', async () => {
  const dir = await scratch('release-notes-settings');
  const file = path.join(dir, 'settings.json');
  await writeFile(file, '{ this is not json');
  const result = await runInstaller(['--settings', file, '--mode', 'block']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /refusing to write/);
  assert.equal(await readFile(file, 'utf8'), '{ this is not json');
});

test('the installer writes, then removes, a real settings file end to end', async () => {
  const dir = await scratch('release-notes-settings');
  const file = path.join(dir, 'settings.json');

  const installed = await runInstaller(['--settings', file, '--mode', 'observe']);
  assert.equal(installed.status, 0, installed.stderr);
  // The user has to be told the thing that is easy to misread: silence is not proof.
  assert.match(installed.stdout, /never fires/);
  assert.match(installed.stdout, /cannot check whether what is written there/);
  const written = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(written.hooks[HOOK_EVENT][0].matcher, BASH_MATCHER);
  assert.match(written.hooks[HOOK_EVENT][0].hooks[0].command, new RegExp(`${GATE_ENV_FLAG}=observe`));

  const removedRun = await runInstaller(['--settings', file, '--remove']);
  assert.equal(removedRun.status, 0, removedRun.stderr);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {});
});

test('the installer defaults to the mode that cannot cost anyone a release', async () => {
  const dir = await scratch('release-notes-settings');
  const file = path.join(dir, 'settings.json');
  await runInstaller(['--settings', file]);
  const written = JSON.parse(await readFile(file, 'utf8'));
  assert.match(written.hooks[HOOK_EVENT][0].hooks[0].command, new RegExp(`${GATE_ENV_FLAG}=observe`));
});

test('the default settings path is the user\'s, and no test ever writes to it', () => {
  assert.equal(resolveSettingsPath({ HOME: '/nowhere' }), path.join('/nowhere', '.claude', 'settings.json'));
});

// ---------------------------------------------------------------------------
// The skill and the gate must keep saying the same thing about each other.
// ---------------------------------------------------------------------------

test('the skill names the gate it ships with, and disclaims installing it', async () => {
  const skill = await readFile(new URL('../skills/release-notes/SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /adapters\/claude-code\/release-notes-gate\.sh/);
  assert.match(skill, /nothing in this skill may install the gate/i);
  assert.match(skill, /It is a floor\./);
  for (const section of ['## When to Use', '## Prerequisites', '## Procedure', '## Usage Examples', '## Pitfalls', '## Verification']) {
    assert.ok(skill.includes(section), `release-notes/SKILL.md is missing ${section}`);
  }
});

test('the two skills that hand over to release-notes no longer place it outside the pack', async () => {
  for (const name of ['release-ledger', 'describe-changes']) {
    const source = await readFile(new URL(`../skills/${name}/SKILL.md`, import.meta.url), 'utf8');
    assert.match(source, /`release-notes`/, `${name} no longer names release-notes`);
    assert.doesNotMatch(
      source,
      /release-notes`[\s\S]{0,80}outside this\s*\n?pack/,
      `${name} still describes release-notes as living outside this pack`,
    );
  }
});
