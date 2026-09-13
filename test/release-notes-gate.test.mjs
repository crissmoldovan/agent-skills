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
    // An UNARMED gate exits without ever draining stdin, so this write can lose its
    // reader mid-flight and raise EPIPE — a race that reddened roughly one full-suite
    // run in six while the gate itself was behaving exactly as specified. Losing the
    // reader is the correct behaviour here, not a failure, so it is not reported as
    // one. Nothing is masked by this: every armed case below asserts on the DECISION,
    // so a payload that genuinely failed to arrive shows up as an allow where a deny
    // is expected.
    child.stdin.on('error', () => {});
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

/** every regex metacharacter escaped — a version is a literal here, never a pattern */
const literal = (s) => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

/** A refusal names the version and points at a file the reader can open. */
function assertRefused(result, version) {
  const output = decision(result);
  assert.ok(output, `expected a refusal, got nothing on stdout (stderr: ${result.stderr})`);
  assert.equal(output.hookEventName, 'PreToolUse');
  assert.equal(output.permissionDecision, 'deny');
  assert.match(output.permissionDecisionReason, new RegExp(literal(version)));
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

  // The refuse half, and this test proves nothing without it: a gate that had never heard
  // of `docs/releases/` would read this layout as "no note source at all", which ALLOWS —
  // so the allow half above passes just as well against a gate that cannot see the
  // directory. Only a refusal shows the directory was actually read.
  const stale = await project({ notes: null });
  await mkdir(path.join(stale, 'docs', 'releases'), { recursive: true });
  await writeFile(path.join(stale, 'docs', 'releases', '2026-01-01-wave.md'), '# Wave\n\n## 1.3.0\n\nwhy\n');
  assertRefused(await runGate(bashCall('npm publish', stale), {}), '1.4.0');
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
  // `1-4-0` and `1x4y0` are here because nothing else in this suite could tell an escaped
  // dot from an unescaped one: every other near miss is rejected by the token boundary
  // whether or not the `.` is a wildcard. Dropping the `.` from the escape set is a mutation
  // the rest of these rows pass.
  for (const other of ['1.4.00', '1.4.0-rc.1', '11.4.0', '1.4.01', '1-4-0', '1x4y0']) {
    const dir = await project({ notes: null });
    await writeFile(path.join(dir, 'CHANGELOG.md'), `# Changelog\n\n## ${other}\n\nwhy\n`);
    assertRefused(await runGate(bashCall('npm publish', dir), {}), '1.4.0');
  }
});

// ---------------------------------------------------------------------------
// The version is looked for as TEXT, not as a pattern
//
// `notes_status` built its search pattern by escaping the dots in the version and nothing
// else, so every other regex metacharacter a legal version can carry stayed live. Semver's
// build metadata is spelled with `+` — `1.0.0+build.7` — and in an ERE a `+` is a
// quantifier, so the pattern asked for `1.0.` followed by one-or-more `0` and then `build`.
// A note written verbatim did not match it, and the refusal said the file "never mentions
// 1.0.0+build.7" while the file literally does. That is the false denial the header says
// costs most, and it accuses the reader of not having written a note they are looking at.
//
// Both directions, on the same shape: escaping the metacharacter must not also blind the
// check to a version that is genuinely unnoted.
// ---------------------------------------------------------------------------

for (const version of ['1.0.0+build.7', '1.0.0+21AF26D3']) {
  test(`a version carrying a regex metacharacter (${version}) is matched as text`, async () => {
    assertAllowed(await runGate(bashCall('npm publish', await project({ version, noted: [version] })), {}));
    assertRefused(await runGate(bashCall('npm publish', await project({ version, noted: ['2.0.0'] })), {}), version);
  });
}

test('escaping the version does not let a near miss satisfy it', async () => {
  // The escape must be a LITERAL match, not merely a quieter pattern: `1.0.0+build.7` is
  // not satisfied by a changelog that records `1.0.00+build.7`, and an unescaped `+` would
  // have said it was.
  const dir = await project({ version: '1.0.0+build.7', notes: null });
  await writeFile(path.join(dir, 'CHANGELOG.md'), '# Changelog\n\n## 1.0.00+build.7\n\nwhy\n');
  assertRefused(await runGate(bashCall('npm publish', dir), {}), '1.0.0+build.7');
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

// ---------------------------------------------------------------------------
// Verb position — where in the command the release verb actually sits
//
// The normalisation collapsed newlines to spaces, so a two-line tool call
//     npm run build
//     npm publish
// arrived as `npm run build npm publish` and put the verb in the middle of a line.
// Every detector anchors to start-of-command or a shell separator, so none matched:
// `npm run build && npm publish` was refused while the same thing written over two
// lines was waved through, and a multi-line Bash call is the commonest shape a
// release takes. The trailing boundary had the mirror-image hole — `npm publish;`,
// `npm publish&` and `(npm publish)` all failed to match a boundary of whitespace
// or end-of-line — which would have swallowed EVERY line once newlines became `;`.
//
// Each shape is asserted BOTH ways on purpose. The refuse half is what fails against
// a gate that cannot see the verb; the allow half is what fails against a gate that
// has started refusing indiscriminately.
// ---------------------------------------------------------------------------

for (const [label, command] of [
  ['a second line', 'npm run build\nnpm publish'],
  ['an indented line', '  cd .\n  npm publish'],
  ['a trailing semicolon', 'npm publish; echo done'],
  ['a backgrounding ampersand', 'npm publish&'],
  ['a subshell', '(npm publish)'],
  ['a line continuation', 'npm publish \\\n  --access public'],
  ['a second line, tag form', 'echo cutting\ngit tag v1.4.0'],
]) {
  test(`a release verb in ${label} is gated`, async () => {
    assertRefused(await runGate(bashCall(command, await repository({ noted: ['1.3.0'] })), {}), '1.4.0');
    assertAllowed(await runGate(bashCall(command, await repository({ noted: ['1.4.0'] })), {}));
  });
}

test('a version-bump commit is gated wherever the verb sits in the command', async () => {
  for (const command of ['git commit -m rel; echo done', 'git add -A\ngit commit -m rel', '(git commit -m rel)']) {
    const unnoted = await repository({ version: '1.0.0', notes: 'CHANGELOG.md', noted: ['1.0.0'] });
    await writeFile(path.join(unnoted, 'package.json'), `${JSON.stringify({ name: '@acme/cli', version: '1.1.0' }, null, 2)}\n`);
    git(unnoted, 'add', 'package.json');
    assertRefused(await runGate(bashCall(command, unnoted), {}), '1.1.0');

    // ...and the same shape with the note staged beside the bump is still the right answer.
    const noted = await repository({ version: '1.0.0', notes: 'CHANGELOG.md', noted: ['1.0.0'] });
    await writeFile(path.join(noted, 'package.json'), `${JSON.stringify({ name: '@acme/cli', version: '1.1.0' }, null, 2)}\n`);
    await writeFile(path.join(noted, 'CHANGELOG.md'), '# Releases\n\n## 1.1.0\n\nwhat / why / impact\n\n## 1.0.0\n\nwhy\n');
    git(noted, 'add', 'package.json', 'CHANGELOG.md');
    assertAllowed(await runGate(bashCall(command, noted), {}));
  }
});

// ---------------------------------------------------------------------------
// Naming a release command is not running one
//
// `changeset publish` was matched with a bare, unanchored `changeset +publish`, so a
// SENTENCE containing those two words — `echo 'to ship, run changeset publish'` — was
// refused. That is the one outcome this gate says it cannot afford: a false denial teaches
// people to work around the guard, and a worked-around guard enforces nothing.
//
// The obvious repair is the other half of this pair, and it is why both halves are asserted
// here: anchoring the verb to the start of a command alone makes `npx changeset publish` and
// `pnpm changeset publish` — the forms people actually type, since `changeset` is a binary
// rather than a package manager — silently inert. Trading a false denial for a silent
// fail-open is how a gate ends up protecting nothing at all.
// ---------------------------------------------------------------------------

test('a sentence that merely NAMES the changeset publish command is not a release', async () => {
  const dir = await repository({ noted: ['1.3.0'] });
  for (const command of [
    "echo 'to ship, run changeset publish'",
    'echo "next step: changeset publish"',
    "printf '%s\\n' 'then changeset publish'",
  ]) {
    assertAllowed(await runGate(bashCall(command, dir), {}));
  }
});

test('a changeset release behind a runner prefix is still gated', async () => {
  const commands = [
    'changeset publish',
    'npx changeset publish',
    'pnpm changeset publish',
    'pnpm exec changeset publish',
    'yarn dlx changeset publish',
    'bunx changeset publish',
    'pnpm -w changeset publish --tag next',
    'npm run build && npx changeset publish',
  ];
  const unnoted = await repository({ noted: ['1.3.0'] });
  for (const command of commands) {
    assertRefused(await runGate(bashCall(command, unnoted), {}), '1.4.0');
  }
  // ...and the allow half, without which the refusals above pass just as well against a
  // gate that has simply started refusing everything.
  const noted = await repository({ noted: ['1.4.0'] });
  for (const command of commands) {
    assertAllowed(await runGate(bashCall(command, noted), {}));
  }
});

// ---------------------------------------------------------------------------
// `--repo` is compared against the origin of the repository being released
//
// The comparison read `remote.origin.url` from the HOOK's own cwd rather than the
// directory the command runs in, so a release cut after a `cd` was measured against an
// unrelated checkout's origin, read as foreign, and was allowed. It only ever
// under-blocks — a coverage gap rather than a hazard — but a silent one.
// ---------------------------------------------------------------------------

test('a --repo flag is judged against the origin of the repository the command runs in', async () => {
  const target = await repository({ noted: ['1.3.0'] });
  git(target, 'remote', 'add', 'origin', 'https://github.com/acme/cli.git');
  const elsewhere = await scratch('release-notes-elsewhere');

  // `--repo acme/cli` names the repository this command `cd`s into. The hook is not standing
  // in it, which is exactly the case that used to read as foreign.
  assertRefused(
    await runGate(bashCall(`cd ${target} && gh release create v1.4.0 --repo acme/cli`, elsewhere), {}),
    '1.4.0',
  );

  // A genuinely foreign repository still fails open: there is no local note file to check.
  assertAllowed(await runGate(bashCall(`cd ${target} && gh release create v1.4.0 --repo someone/else`, elsewhere), {}));

  // ...and the same local release with its note written is allowed.
  const noted = await repository({ noted: ['1.4.0'] });
  git(noted, 'remote', 'add', 'origin', 'https://github.com/acme/cli.git');
  assertAllowed(await runGate(bashCall(`cd ${noted} && gh release create v1.4.0 --repo acme/cli`, elsewhere), {}));
});

// ---------------------------------------------------------------------------
// A bump is a bump whatever the package.json is formatted like
//
// The bump detector matched `^+ "version":` against the staged DIFF TEXT, which only ever
// fires on a pretty-printed package.json. A repository that keeps its manifest on one line
// bumped its version with no note and was allowed, silently.
//
// Loosening that pattern to "a `+` line mentioning version" would have been a false-denial
// machine on the very layout it was meant to fix — every edit to a one-line manifest
// rewrites the whole line, version included. The second test here is that trap.
// ---------------------------------------------------------------------------

async function compactRepository(version, noted) {
  const dir = await repository({ version: '0.0.0', noted });
  await writeFile(path.join(dir, 'package.json'), `${JSON.stringify({ name: '@acme/cli', version, private: false })}\n`);
  git(dir, 'add', 'package.json');
  git(dir, 'commit', '-qm', 'compact manifest');
  return dir;
}

test('a version bump in a one-line package.json is still a bump', async () => {
  const dir = await compactRepository('1.0.0', ['1.0.0']);
  await writeFile(path.join(dir, 'package.json'), `${JSON.stringify({ name: '@acme/cli', version: '2.0.0', private: false })}\n`);
  git(dir, 'add', 'package.json');
  assertRefused(await runGate(bashCall('git commit -m "chore(release): 2.0.0"', dir), {}), '2.0.0');

  // ...and the note staged beside it is still the right answer, in this layout too.
  const noted = await compactRepository('1.0.0', ['1.0.0']);
  await writeFile(path.join(noted, 'package.json'), `${JSON.stringify({ name: '@acme/cli', version: '2.0.0', private: false })}\n`);
  await writeFile(path.join(noted, 'CHANGELOG.md'), '# Releases\n\n## 2.0.0\n\nwhat / why / impact\n\n## 1.0.0\n\nwhy\n');
  git(noted, 'add', 'package.json', 'CHANGELOG.md');
  assertAllowed(await runGate(bashCall('git commit -m "chore(release): 2.0.0"', noted), {}));
});

test('an edit to a one-line package.json that does not touch the version is left alone', async () => {
  // The whole line is rewritten by any edit at all, so "the staged diff mentions a version"
  // is not the question this needs answered — "did the version CHANGE" is.
  const dir = await compactRepository('2.0.0', ['1.0.0']);
  await writeFile(path.join(dir, 'package.json'), `${JSON.stringify({ name: '@acme/cli', version: '2.0.0', private: true })}\n`);
  git(dir, 'add', 'package.json');
  assertAllowed(await runGate(bashCall('git commit -m "chore: make it private"', dir), {}));
});

// ---------------------------------------------------------------------------
// A flag belongs to the invocation that carries it
//
// The publish branch read `--filter` / `-C` / `--prefix` from the WHOLE command line with
// `head -1`, so a BUILD step's package was handed to the publish that followed it:
// `pnpm --filter @acme/a build && pnpm publish` read @acme/a's version, checked @acme/a's
// changelog, and REFUSED a root release whose note was in fact written. A false denial, on
// the commonest monorepo release line there is.
//
// This is the same pairing bug branches 2 and 3 already fix for themselves, and that
// `repo_dir_for`'s own comment warns about — "callers pass a FRAGMENT holding a single
// invocation, not the whole line". Branch 1 was the one that never got the fix.
//
// Both halves are asserted, because the cheap repair — dropping the flag lookup altogether —
// passes the allow half and goes silently inert for every `pnpm --filter <pkg> publish`
// there is, which is the invisible fail-open this file trades nothing for.
// ---------------------------------------------------------------------------

/** A workspace whose ROOT release is noted and whose member's note stops one version short. */
async function workspace({ memberNoted = ['0.0.0'] } = {}) {
  const dir = await repository({ name: 'mono', version: '9.9.9', noted: ['9.9.9'] });
  const member = path.join(dir, 'packages', 'a');
  await mkdir(member, { recursive: true });
  await writeFile(path.join(member, 'package.json'), `${JSON.stringify({ name: '@acme/a', version: '0.0.1' }, null, 2)}\n`);
  const body = memberNoted.map((v) => `## ${v}\n\nwhat / why / impact\n`).join('\n');
  await writeFile(path.join(member, 'CHANGELOG.md'), `# Releases\n\n${body}`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'workspace member');
  return dir;
}

const PUBLISH_OWNS_THE_FLAG = [
  'pnpm --filter @acme/a publish',
  'pnpm publish --filter @acme/a',
  'pnpm -C packages/a publish',
  'npm --prefix packages/a publish',
  'cd packages/a && npm publish',
];

test("a build step's --filter is not the publishing invocation's package", async () => {
  // The ROOT release is noted (9.9.9); the member's changelog deliberately stops at 0.0.0, so
  // any of these that reaches the member refuses a release whose note is written.
  const dir = await workspace();
  for (const command of [
    'pnpm --filter @acme/a build && pnpm publish',
    'pnpm -C packages/a build && pnpm publish',
    'npm --prefix packages/a run build && npm publish',
    'pnpm run --filter @acme/a lint; pnpm publish',
  ]) {
    assertAllowed(await runGate(bashCall(command, dir), {}));
  }
});

test('a --filter that really does belong to the publish is still honoured', async () => {
  const unnoted = await workspace();
  for (const command of PUBLISH_OWNS_THE_FLAG) {
    assertRefused(await runGate(bashCall(command, unnoted), {}), '0.0.1');
  }
  const noted = await workspace({ memberNoted: ['0.0.1', '0.0.0'] });
  for (const command of PUBLISH_OWNS_THE_FLAG) {
    assertAllowed(await runGate(bashCall(command, noted), {}));
  }
});

test('a refusal names the tag, not the separator that followed it', async () => {
  // The normalisation ends every line with `;`, and branch 3 already trims it off a tag name.
  // The `gh release create` branch did not, so a bare release printed `Creating release v1.4.0;`.
  const dir = await repository({ noted: ['1.3.0'] });
  const result = await runGate(bashCall('gh release create v1.4.0', dir), {});
  assertRefused(result, '1.4.0');
  assert.doesNotMatch(decision(result).permissionDecisionReason, /v1\.4\.0[;&|)]/);
});

// ---------------------------------------------------------------------------
// A quoted string is data, not shell structure
//
// `START`/`END` matched CHARACTERS rather than shell structure, so any `;`, `|`, `&` or `(`
// sitting in front of a release verb put that verb at what the gate read as a command
// position — even when every one of those characters was inside a quoted string:
//
//     git commit -m "fixes the crash; npm publish now works"   -> REFUSED
//     git commit -m "see README (npm publish)"                 -> REFUSED
//
// A commit message that mentions a publish step is completely ordinary, so this fired on
// real work, and a false denial is the one outcome this gate's header says it cannot
// afford. `echo "build; npm publish"` escaped only because the CLOSING quote happens not
// to be in END's character class — which is the proof that the old behaviour was
// incidental rather than designed.
//
// Both halves are asserted for every shape. The refuse half is what fails against a gate
// that has simply stopped looking inside quotes at ALL — which would be the cheap repair,
// and which would take `npm "publish"` (a real release, quoted) with it.
// ---------------------------------------------------------------------------

// Each shape is asserted BOTH ways, on ONE fixture, and the pair is the point: the two
// commands differ only in whether the separator is inside the quotes. An ALLOW-only test here
// says nothing — it passes against a gate that has stopped reading commands at all, and the
// last row is the proof of that: `echo "build; npm publish"` was allowed by the 0.16.0 gate
// too, for the incidental reason the header records (the closing quote is not in END's class).
// Its allow half is a regression guard; only the pair is evidence.
for (const [label, quoted, bare] of [
  ['a semicolon',
    'git commit -m "fixes the crash; npm publish now works"',
    'git commit -m fixes; npm publish'],
  ['parentheses',
    'git commit -m "see README (npm publish)"',
    'git commit -m see; (npm publish)'],
  ['a pipe',
    'git commit -m "chore: docs | npm publish step"',
    'git commit -m docs | npm publish'],
  ['a newline',
    'git commit -m "fixes the crash\nnpm publish now works"',
    'git commit -m fixes\nnpm publish'],
  ['an issue comment body',
    'gh issue comment -b "workaround: (pnpm publish)"',
    'gh issue comment -b workaround && (pnpm publish)'],
  ['an echoed sentence',
    'echo "build; npm publish"',
    'echo build; npm publish'],
]) {
  test(`a release verb quoted behind ${label} is not a release, and unquoted it is`, async () => {
    // Nothing is staged here, so the `git commit` branch has no bump to find either: any
    // refusal can only have come from reading the quoted text as a command.
    const dir = await repository({ noted: ['1.3.0'] });
    assertAllowed(await runGate(bashCall(quoted, dir), {}));
    assertRefused(await runGate(bashCall(bare, dir), {}), '1.4.0');
  });
}

test('a quoted span is still one span across the seam between the pass\'s internal pieces', async () => {
  // The pass walks the command in fixed 4KB pieces, so the two pieces of machine state — the
  // open quote and a pending backslash — have to cross the seam. NOTHING else in this suite
  // is long enough to have a seam at all: every other command here is a few dozen bytes, so
  // a version of the pass that reset its state at every piece boundary passes all of them.
  // The consequence is a false denial on a long commit message, which is not an exotic shape.
  const dir = await repository({ noted: ['1.3.0'] });
  const lead = 'git commit -m "';           // 15 bytes, so the seam at 4096 lands at lead + 4081

  for (const pad of [4000, 4079, 4080, 4081, 4082, 8177]) {
    const filler = 'a'.repeat(pad);
    // The `;` is inside a span opened before the seam: text, not structure.
    assertAllowed(await runGate(bashCall(`${lead}${filler}; npm publish now works"`, dir), {}));
    // ...and the same length with the separator genuinely outside the quotes is a release.
    assertRefused(await runGate(bashCall(`git commit -m ${filler}; npm publish`, dir), {}), '1.4.0');
  }

  // A pending backslash has to cross the seam too: an escaped quote straddling it must not
  // close the span, or everything after it reads as a command again.
  for (const pad of [4078, 4079, 4080, 4081]) {
    const filler = 'a'.repeat(pad);
    assertAllowed(await runGate(bashCall(`${lead}${filler}\\" still inside; npm publish now works"`, dir), {}));
  }
});

test('a release verb that is merely QUOTED is still the release it is', async () => {
  // The cheap repair — blank every quoted span before matching — passes every case above
  // and goes silently inert here: bash runs `npm "publish"` identically to the unquoted
  // form, and a quoted tag is the ordinary way to write one. Quoting removes a character's
  // power to act as shell STRUCTURE; it does not turn a command into a comment.
  const unnoted = await repository({ noted: ['1.3.0'] });
  for (const command of ['npm "publish"', "npm 'publish'", 'git tag "v1.4.0"']) {
    assertRefused(await runGate(bashCall(command, unnoted), {}), '1.4.0');
  }
  const noted = await repository({ noted: ['1.4.0'] });
  for (const command of ['npm "publish"', "npm 'publish'", 'git tag "v1.4.0"']) {
    assertAllowed(await runGate(bashCall(command, noted), {}));
  }
});

// ---------------------------------------------------------------------------
// The run directory is the one in effect WHEN THE VERB RUNS
//
// `run_dir_for` took the last top-level `cd` on the line whatever its position, which
// contradicts its own comment. Two consequences, both downstream of the same root cause as
// the quoting bug — reading shell text as characters rather than as structure:
//
//   (a) `npm publish && cd <other-repo>` was judged against <other-repo>, so a release whose
//       note IS written was refused, naming a repository that has nothing to do with it.
//   (b) A `cd` named inside a quoted string hijacked the run directory, and an unresolvable
//       one switched the gate off entirely: `git commit -m "wip; cd /nonexistent"` allowed a
//       version bump with no note at all. Fail-open, so the safe direction — but a sentence
//       in a commit message could disarm the bump check.
// ---------------------------------------------------------------------------

test('a cd that runs AFTER the release verb is not the directory the verb runs in', async () => {
  const noted = await repository({ noted: ['1.4.0'] });
  const other = await repository({ noted: ['0.1.0'], name: '@acme/other' });
  assertAllowed(await runGate(bashCall(`npm publish && cd ${other}`, noted), {}));
  assertAllowed(await runGate(bashCall(`git tag v1.4.0 && cd ${other}`, noted), {}));

  // ...and the allow half is not the whole story: a `cd` BEFORE the verb still decides,
  // which is the behaviour this branch exists to provide.
  const unnoted = await repository({ noted: ['1.3.0'], name: '@acme/other' });
  assertRefused(await runGate(bashCall(`cd ${unnoted} && npm publish`, noted), {}), '1.4.0');

  // "Where does the verb sit" is asked with the branch's own ANCHORED pattern, so prose that
  // merely names the verb cannot move the boundary. Unanchored, the scan stops at the words
  // inside the `echo` — which are AFTER the `cd` — and the release is judged against a
  // repository the command only passed through.
  assertAllowed(await runGate(
    bashCall(`gh release create v1.4.0 && cd ${other} && echo "gh release create v1.4.0"`, noted),
    {},
  ));
});

test('a cd inside a quoted string neither hijacks the run directory nor disarms the gate', async () => {
  // (b), the fail-open half: an unresolvable `cd` is unknown ground and allows, so a `cd`
  // read out of a commit message turned the bump check off for that commit.
  const bump = await repository({ version: '1.0.0', noted: ['1.0.0'] });
  await writeFile(path.join(bump, 'package.json'), `${JSON.stringify({ name: '@acme/cli', version: '1.1.0' }, null, 2)}\n`);
  git(bump, 'add', 'package.json');
  assertRefused(await runGate(bashCall('git commit -m "wip; cd /nonexistent"', bump), {}), '1.1.0');

  // (b), the false-denial half: a resolvable `cd` named in quoted text judged the release
  // by the wrong repository's notes.
  const noted = await repository({ noted: ['1.4.0'] });
  const unnoted = await repository({ noted: ['1.3.0'], name: '@acme/other' });
  assertAllowed(await runGate(bashCall(`echo "see ${unnoted}; cd ${unnoted}" && npm publish`, noted), {}));
});

// ---------------------------------------------------------------------------
// A byte offset is not a character offset
//
// `run_dir_for` cuts the line at the verb so that a `cd` running AFTER the release is not
// read as the release's directory. The cut took its offset from `grep -Eob`, which counts
// BYTES, and applied it with `${seg:0:$off}`, which bash counts in CHARACTERS whenever
// LC_CTYPE is multibyte. Once enough non-ASCII sat in front of the verb the cut landed
// PAST it, the trailing `cd` came back into view, and the fix silently reverted to the
// false denial — or, as here, to a fail-open — for everyone whose shell is UTF-8, which is
// most shells. A locale-conditional defect is the worst kind to leave: it works for
// whoever tests it.
//
// Asserted in BOTH locales, with an ASCII control that isolates multibyte input as the
// cause rather than the shape of the command.
// ---------------------------------------------------------------------------

const MULTIBYTE = '（'.repeat(40);

for (const locale of ['C', 'en_US.UTF-8']) {
  test(`a cd after the verb stays after the verb under LC_ALL=${locale}`, async () => {
    const env = { LC_ALL: locale, LANG: locale };

    // The verb is preceded by 40 multibyte characters (80 bytes), and followed by a `cd`
    // into a directory with no package.json — so reading that `cd` as the run directory
    // turns the refusal into an allow.
    const unnoted = await repository({ noted: ['1.3.0'] });
    assertRefused(await runGate(bashCall(`echo "${MULTIBYTE}" && npm publish && cd /`, unnoted), { env }), '1.4.0');

    // The control: the same shape in ASCII must behave identically. When these two differ,
    // the cause is the unit the offset is measured in and nothing else.
    assertRefused(await runGate(bashCall(`echo "${'x'.repeat(40)}" && npm publish && cd /`, unnoted), { env }), '1.4.0');

    // ...and the allow half on the same shape, so this pair still fails against a gate that
    // has started refusing everything.
    const noted = await repository({ noted: ['1.4.0'] });
    assertAllowed(await runGate(bashCall(`echo "${MULTIBYTE}" && npm publish && cd /`, noted), { env }));
  });
}

// ---------------------------------------------------------------------------
// Branch 2 anchors like every other branch
//
// `(gh|glab) +release +create` was matched with no START/END around it while branches 1, 3
// and 4 all anchored — the same omission that made `changeset publish` refuse a sentence
// three rounds earlier. It fails in BOTH directions at once:
//
//   (a) false denial: `echo "then run gh release create v9.9.9 to ship"` — prose naming a
//       release — was refused, naming a version nobody is releasing.
//   (b) fail-OPEN: branch 2 matched a commit message, found a version its notes DO mention,
//       and `exit 0`d before the version-bump check ever ran. A staged, unnoted bump whose
//       commit message happens to contain those four words was ALLOWED, while the
//       byte-identical commit without them was correctly refused.
// ---------------------------------------------------------------------------

test('prose that merely NAMES a release-create command is not a release', async () => {
  const dir = await repository({ version: '1.0.0', noted: ['1.0.0'] });
  for (const command of [
    'echo "then run gh release create v9.9.9 to ship"',
    "echo 'next: glab release create v9.9.9'",
    'git commit -m "docs: explain gh release create v9.9.9"',
  ]) {
    assertAllowed(await runGate(bashCall(command, dir), {}));
  }
  // ...and the release itself, on the same fixture, is still refused. Without this half the
  // test above passes against a gate that has stopped looking at branch 2 altogether.
  assertRefused(await runGate(bashCall('gh release create v9.9.9', dir), {}), '9.9.9');
});

test('a commit message naming a release does not switch the bump check off', async () => {
  // The pair that matters: the only difference between these two commands is four words
  // inside a commit message, and the commit that says what it is doing must not be the one
  // that escapes the check.
  const spoken = await repository({ version: '1.0.0', noted: ['1.0.0'] });
  await writeFile(path.join(spoken, 'package.json'), `${JSON.stringify({ name: '@acme/cli', version: '1.1.0' }, null, 2)}\n`);
  git(spoken, 'add', 'package.json');
  assertRefused(await runGate(bashCall('git commit -m "chore: bump; then gh release create v1.0.0"', spoken), {}), '1.1.0');

  const silent = await repository({ version: '1.0.0', noted: ['1.0.0'] });
  await writeFile(path.join(silent, 'package.json'), `${JSON.stringify({ name: '@acme/cli', version: '1.1.0' }, null, 2)}\n`);
  git(silent, 'add', 'package.json');
  assertRefused(await runGate(bashCall('git commit -m "chore: bump"', silent), {}), '1.1.0');
});

// ---------------------------------------------------------------------------
// Every detector over $norm is anchored — asserted over the gate's own source
//
// The detectors learned that quoted text is data. What they kept forgetting is the anchor:
// `changeset publish` shipped unanchored and refused a sentence (round 1), and
// `(gh|glab) release create` shipped unanchored and refused a sentence again (round 6),
// three rounds apart. The fix for one did not protect the other, because nothing said the
// rule out loud in a place that turns red.
//
// This does. It reads the gate's source and asserts the property no branch may forget,
// which is the one thing a tokenizer would have bought structurally and the only reason
// this file does not have one.
// ---------------------------------------------------------------------------

/** every `printf '%s' "$norm" | grep -Eq <pattern>` in a shell source, with its pattern */
function normDetectors(source) {
  const found = [];
  const re = /printf\s+'%s'\s+"\$norm"\s*\|\s*grep\s+-Eq\s+(?:"([^"]*)"|'([^']*)')/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    found.push({ pattern: m[1] ?? m[2], quoted: m[1] === undefined ? "'" : '"' });
  }
  return found;
}

test('every detector that reads the normalised command anchors it to a command position', async () => {
  const source = await readFile(gate, 'utf8');
  const detectors = normDetectors(source);

  // A parser that finds nothing would pass this test vacuously, so the count is asserted
  // too: four branches, and branch 1 matches its two publish dialects separately.
  assert.equal(detectors.length, 5, `expected 5 $norm detectors, found ${detectors.length}`);
  for (const { pattern } of detectors) {
    assert.ok(
      pattern.startsWith('${START}') || pattern.startsWith('$START'),
      `a detector over $norm does not begin with START, so naming its verb in prose is a release: ${pattern}`,
    );
  }

  // ...and the matcher itself is checked against the shape that has actually shipped twice:
  // an unanchored, SINGLE-quoted pattern. A double-quote-only matcher reads this file as
  // clean while the defect is live, which is exactly how round 6 reached a release.
  const single = normDetectors(`if printf '%s' "$norm" | grep -Eq '(gh|glab) +release +create'; then`);
  assert.equal(single.length, 1);
  assert.equal(single[0].quoted, "'");
  assert.equal(single[0].pattern.startsWith('${START}'), false);

  // Nothing that reads something OTHER than $norm is in scope: `$tag` is already a single
  // extracted token and has no command position to anchor to.
  assert.equal(normDetectors(`printf '%s' "$tag" | grep -Eq '@[0-9]|^v?[0-9]'`).length, 0);
});

/**
 * every `printf '%s' "$norm" | <cmd> <flags> <pattern>` in a shell source — detectors AND
 * extractors, since the rule is about reading $norm at all, not about `grep -Eq`.
 */
function normReaders(source) {
  const found = [];
  const re = /printf\s+'%s'\s+"\$norm"\s*(?:\\\s*)?\|\s*([a-z]+)\s+(-[A-Za-z]+)\s+(?:"([^"]*)"|'([^']*)')/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    found.push({ cmd: m[1], flags: m[2], pattern: m[3] ?? m[4], quoted: m[3] === undefined ? "'" : '"' });
  }
  return found;
}

test('every read of the normalised command goes through an anchored pattern, extractors included', async () => {
  const source = await readFile(gate, 'utf8');
  const readers = normReaders(source);

  // The detector rule was written for `grep -Eq` and the EXTRACTORS went on doing what the
  // detectors had been fixed for: branch 4 read the `-C` that picks which repository is
  // judged with `sed -nE "s/.*(git<opts>) +commit.*/\1/p"`, a greedy whole-line read that a
  // commit MESSAGE could satisfy. A rule scoped to `grep -Eq` reads that file as clean.
  //
  // So the rule is about $norm, not about one command: whatever reads the normalised command
  // reads it through a pattern that starts at a command position. Anything that needs the
  // inside of one invocation cuts the fragment out first and reads THAT.
  assert.equal(readers.length, 9, `expected 9 $norm readers, found ${readers.length}`);
  for (const { cmd, flags, pattern } of readers) {
    assert.match(cmd, /^grep$/, `only grep reads $norm; a ${cmd} over the whole line cannot be anchored to a command position: ${pattern}`);
    assert.match(flags, /^-E[qo]$/, `a $norm read uses -Eq or -Eo, not ${flags}: ${pattern}`);
    assert.ok(
      pattern.startsWith('${START}') || pattern.startsWith('$START'),
      `a read of $norm does not begin with START, so its verb can be satisfied by prose: ${pattern}`,
    );
  }

  // The matcher is checked against BOTH shapes that have actually shipped: the unanchored,
  // single-quoted detector of round 6, and the greedy `sed` of round 8. A matcher that saw
  // only double-quoted `grep -Eq` reads a file carrying either of them as clean.
  const single = normReaders(`if printf '%s' "$norm" | grep -Eq '(gh|glab) +release +create'; then`);
  assert.equal(single.length, 1);
  assert.equal(single[0].quoted, "'");
  assert.equal(single[0].pattern.startsWith('${START}'), false);

  const greedy = normReaders(`cdir="$(repo_dir_for "$(printf '%s' "$norm" | sed -nE "s/.*(git\${GIT_OPTS}) +commit.*/\\1/p")")"`);
  assert.equal(greedy.length, 1);
  assert.equal(greedy[0].cmd, 'sed');
  assert.equal(greedy[0].pattern.startsWith('${START}'), false);

  // ...and a continued line is still one read, which is how branch 1's extractor is written.
  assert.equal(normReaders(`x="$(printf '%s' "$norm" \\\n        | grep -Eo "\${START}foo" \\\n        | tail -1)"`).length, 1);
});

// ---------------------------------------------------------------------------
// An extractor reads the invocation that matched, not the whole line
//
// The detectors learned that quoted text is data; the extractors did not. Both the tag and
// the release-create extractors stripped with a greedy, unanchored `sed -E "s/.*<verb>//"`,
// so they read the LAST version-looking token on the line wherever it came from — including
// out of a quoted message. Both error directions again, on one line of code:
//
//   (a) false denial: `git tag v1.4.0 -m "supersedes the old git tag v9.9.9 line"` refused,
//       naming v9.9.9 — a version nobody is releasing and no note can ever satisfy.
//   (b) fail-OPEN: `git tag v9.9.9 -m "replaces git tag v1.0.0"` read v1.0.0, found its
//       note, and cut an unnoted release. That is the direction nobody notices.
// ---------------------------------------------------------------------------

test('a tag is read from the invocation being run, not from a message that mentions one', async () => {
  const noted = await repository({ noted: ['1.4.0'] });
  assertAllowed(await runGate(bashCall('git tag v1.4.0 -m "supersedes the old git tag v9.9.9 line"', noted), {}));

  // The fail-open half, on a fixture that notes 1.0.0 and nothing else: the tag actually
  // being cut is 9.9.9, whatever the message says afterwards.
  const dir = await repository({ version: '1.0.0', noted: ['1.0.0'] });
  assertRefused(await runGate(bashCall('git tag v9.9.9 -m "replaces git tag v1.0.0"', dir), {}), '9.9.9');

  // ...and the rule the greedy strip got right and must keep: of two real invocations, the
  // LAST one is the release being cut.
  assertRefused(await runGate(bashCall('git tag v1.0.0 && git tag v9.9.9', dir), {}), '9.9.9');

  // The `-C` that decides WHICH repository is judged is read from the same invocation, by the
  // same rule. Read with a leading `.*` it walked to the last `git … tag` on the line, so a
  // message could nominate a checkout whose notes happen to mention the version — and here
  // that turns the refusal into an allow.
  const alibi = await repository({ version: '9.9.9', noted: ['9.9.9'], name: '@acme/alibi' });
  assertRefused(await runGate(bashCall(`git tag v9.9.9 -m "see git -C ${alibi} tag v1.0.0"`, dir), {}), '9.9.9');
  // ...and a `-C` that really does belong to the tag is still honoured.
  assertAllowed(await runGate(bashCall(`git -C ${alibi} tag v9.9.9`, dir), {}));
});

test('a release tag is read from the invocation being run, not from its own --notes', async () => {
  const dir = await repository({ version: '1.0.0', noted: ['1.0.0'] });
  assertAllowed(await runGate(bashCall('gh release create v1.0.0 --notes "supersedes gh release create v9.9.9"', dir), {}));
  assertRefused(await runGate(bashCall('gh release create v9.9.9 --notes "replaces gh release create v1.0.0"', dir), {}), '9.9.9');

  // Bounding the fragment at the next shell separator is a behaviour change from the
  // "deliberately not truncated" rule this branch inherited, so it gets its own assertion:
  // a `--repo` belonging to the release is still inside the fragment and still read, and a
  // later command's flags are not.
  const target = await repository({ noted: ['1.3.0'] });
  git(target, 'remote', 'add', 'origin', 'https://github.com/acme/cli.git');
  assertRefused(await runGate(bashCall('gh release create v1.4.0 --repo acme/cli', target), {}), '1.4.0');
  assertAllowed(await runGate(bashCall('gh release create v1.4.0 --repo someone/else', target), {}));
  assertAllowed(await runGate(bashCall('gh release create v1.4.0 --repo someone/else && echo --repo acme/cli', target), {}));
});

// ---------------------------------------------------------------------------
// ...and the commit branch reads its `-C` the same way
//
// Branch 3 learned this; branch 4 did not, and it was the last greedy whole-line read left
// in the file: `sed -nE "s/.*(git<opts>) +commit.*/\1/p"`. A leading `.*` walks to the LAST
// `git … commit` on the line, and after the quote pass the words inside a commit MESSAGE are
// still words — so an ordinary sentence decided which repository's index was read. Three
// consequences, all reproduced against the unfixed file:
//
//   (a) FALSE DENIAL, on a minimal pair. From a session rooted in a repository with an
//       unnoted staged bump, `git -C <clean> commit -m "explain how git commit hooks work"`
//       was refused — naming a package in a repository the command never touches — while the
//       byte-identical message WITHOUT those two words was allowed. The `-C` belonging to
//       the real invocation was walked past, so the judged repository fell back to the
//       session's own.
//   (b) FALSE DENIAL the other way round: in a CLEAN checkout, prose naming another repo
//       (`git commit -m "see git -C <other> commit for how"`) was judged against <other>'s
//       staged bump, which no note in the current repository can ever satisfy.
//   (c) FAIL-OPEN: prose naming a `-C` that does not exist made `resolve_dir` fail, and the
//       branch exits 0 on an unresolvable directory — so a real unnoted bump walked through.
//       That is the direction nobody notices.
// ---------------------------------------------------------------------------

/** a repository whose staged package.json bumps to 9.9.9, with no note for it */
async function stagedBump(options) {
  const dir = await repository({ version: '1.0.0', noted: ['1.0.0'], ...options });
  const name = options?.name ?? '@acme/cli';
  await writeFile(path.join(dir, 'package.json'), `${JSON.stringify({ name, version: '9.9.9' }, null, 2)}\n`);
  git(dir, 'add', 'package.json');
  return dir;
}

test('a commit is judged against the repository its own invocation names, not one its message mentions', async () => {
  const dirty = await stagedBump({ name: '@acme/dirty' });
  const clean = await repository({ version: '1.0.0', noted: ['1.0.0'], name: '@acme/clean' });

  // The fixture really is dirty, so every allow below is a statement about the reading and
  // not about a gate that has gone quiet.
  assertRefused(await runGate(bashCall('git commit -m ordinary', dirty), {}), '9.9.9');

  // (a) the minimal pair: the same commit, in the same session, differing only in four
  // words of prose. Both land in <clean>, which has nothing staged.
  assertAllowed(await runGate(bashCall(`git -C ${clean} commit -m "explain how git commit hooks work"`, dirty), {}));
  assertAllowed(await runGate(bashCall(`git -C ${clean} commit -m "explain how hooks work"`, dirty), {}));

  // (b) prose nominating another checkout from a clean one
  assertAllowed(await runGate(bashCall(`git commit -m "see git -C ${dirty} commit for how"`, clean), {}));

  // (c) the fail-open: an unresolvable `-C` in prose must not disarm the bump check
  assertRefused(await runGate(bashCall('git commit -m "see git -C /nonexistent-a9f3c1 commit"', dirty), {}), '9.9.9');

  // ...and a `-C` that really does belong to the commit is still honoured, in both
  // directions: it is the whole reason this read exists.
  assertRefused(await runGate(bashCall(`git -C ${dirty} commit -m "chore: bump"`, clean), {}), '9.9.9');
  assertAllowed(await runGate(bashCall(`git -C ${clean} commit -m "chore: docs"`, dirty), {}));

  // ...and of two real invocations the LAST one is the commit being made, which is the rule
  // the greedy strip got right and this must preserve.
  assertRefused(await runGate(bashCall(`git -C ${clean} commit -m a && git -C ${dirty} commit -m b`, clean), {}), '9.9.9');
  assertAllowed(await runGate(bashCall(`git -C ${dirty} commit -m a && git -C ${clean} commit -m b`, dirty), {}));
});

// ---------------------------------------------------------------------------
// The quote pass costs what the pass it replaced cost
//
// The first version walked the command one character at a time rebuilding `out = out c`,
// which under one-true-awk is quadratic: 128KB took 1025ms against the shipped gate's 58ms,
// on a hook that runs before EVERY Bash tool call.
//
// The assertion is on SCALING, not on a millisecond budget. A fixed wall-clock threshold in
// a test is a hand-maintained description of something that moves — it goes red on a loaded
// machine and green on a fast one, and tells you nothing either way. A sixteen-fold input
// that costs a small multiple is linear; the defect this guards cost thirty-two times.
//
// The multiple is PER SHAPE, and that is not a fudge. Linear means a sixteenfold input costs
// at most sixteen times; the small multiples the first three rows assert come from the gate
// paying its fixed cost — spawning, jq, the greps — once at each end, which dominates when
// the shape is cheap per byte. On an expensive shape the fixed cost is a smaller share and
// the honest linear ceiling is nearer sixteen than six. Asserting six everywhere would
// therefore not be stricter; it would be a bound the fixed version cannot meet, which is how
// a scaling test ends up being deleted rather than believed. Each row carries the multiple
// its own shape can hold, with the measured numbers beside it.
// ---------------------------------------------------------------------------

test('the quote pass scales with the size of the command, not with its square', async () => {
  const dir = await repository({ noted: ['1.3.0'] });
  const median = async (command) => {
    const runs = [];
    for (let i = 0; i < 3; i += 1) {
      const started = performance.now();
      await runGate(bashCall(command, dir), {});
      runs.push(performance.now() - started);
    }
    return runs.sort((a, b) => a - b)[1];
  };

  // MANY QUOTED SPANS is the shape that drives this pass, and the one this test left out
  // while the pass was quadratic: inert text, metacharacters and many lines are all cheap
  // per byte and all three stayed linear throughout. A quote mark is a state change, and the
  // per-mark work is where the cost was — which is why `curl -d "{…}"` and
  // `psql -c "INSERT …"`, ordinary commands both, were the shapes that got dear, while one
  // huge quoted blob never did. It is the only row that needs sizes this large: below about
  // 32KB the gate's fixed cost hides the difference, and the quadratic build passes.
  const span = `echo "ab;cd" 'ef|gh' `;
  const spans = (kb) => span.repeat(Math.ceil((kb * 1024) / span.length));
  for (const [label, small, large, bound] of [
    ['inert text', `echo ${'a'.repeat(8 * 1024)}`, `echo ${'a'.repeat(128 * 1024)}`, 6],
    // Metacharacter-dense input is the case a run-based pass could regress on its own,
    // since it is the number of state changes that drives the loop.
    ['metacharacters', `echo ${'ab;c|d&e(f)'.repeat(744)}`, `echo ${'ab;c|d&e(f)'.repeat(11904)}`, 6],
    ['many lines', Array.from({ length: 125 }, () => `echo ${'a'.repeat(60)}`).join('\n'),
      Array.from({ length: 2000 }, () => `echo ${'a'.repeat(60)}`).join('\n'), 6],
    // 32KB -> 512KB, measured over five trials on the machine that wrote this: 8.1-9.1 with
    // the linear pass, 24.0-31.6 with the quadratic one. 14 sits between those with room on
    // both sides, and is still comfortably under the sixteen that a sixteenfold input costs
    // when the pass is perfectly linear and the fixed cost has stopped mattering.
    ['quoted spans', spans(32), spans(512), 14],
  ]) {
    const small_ms = await median(small);
    const large_ms = await median(large);
    assert.ok(
      large_ms < small_ms * bound,
      `${label}: the larger command cost ${large_ms.toFixed(0)}ms against ${small_ms.toFixed(0)}ms for a sixteenth of the input, ${(large_ms / small_ms).toFixed(1)}x against a bound of ${bound}x — that is not linear`,
    );
  }
});

// ---------------------------------------------------------------------------
// The under-blocks, asserted rather than only described
//
// Reading quoted text as data gives up every release that reaches the shell as a STRING.
// The adapter README named one shape of that (`sh -c "npm publish"`); there are four, and
// two of them arrive through `$( )` and backticks, where bash really does re-enter command
// context and really does run the publish. An unbalanced quote is the fourth, and it is a
// regression this branch introduced: everything after an odd apostrophe reads as quoted, so
// a heredoc body containing one disarms every detector for the rest of the command.
//
// Each is paired with the release the same fixture DOES refuse, so this is a statement
// about these shapes rather than about a gate that stopped working.
// ---------------------------------------------------------------------------

test('a release handed to the shell as a string is under-blocked, and it is written down', async () => {
  const dir = await repository({ noted: ['1.3.0'] });
  assertRefused(await runGate(bashCall('npm publish', dir), {}), '1.4.0');

  for (const command of [
    'echo "$(npm publish)"',
    'OUT="$(npm publish --tag next)"',
    'echo `npm publish`',
    'sh -c "build; npm publish"',
    "cat <<EOF > notes.txt\nit's shipping\nEOF\nnpm publish",
  ]) {
    assertAllowed(await runGate(bashCall(command, dir), {}));
  }

  const readme = await readFile(new URL('../adapters/claude-code/README.md', import.meta.url), 'utf8');
  for (const shape of ['$(', 'backtick', 'unbalanced', 'heredoc']) {
    assert.ok(readme.includes(shape), `the adapter README does not name the ${shape} under-block`);
  }
});
