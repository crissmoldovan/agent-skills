import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, copyFile, link, mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Which hooks the two gate installers take, driven end to end: the real installers, on settings files
// in a temp directory, with HOME pointed at that directory too.
//
// The rule these pin (adapters/claude-code/hook-ownership.mjs):
//   - a hook is an installer's own, with no flag, when its WHOLE command is the installer's exact shape
//     with an interpreter that installer writes, or when it runs the gate under that installer's describe;
//   - the exact shape is never unclear: with any other interpreter `--adopt` takes it;
//   - `--adopt` takes a hook in any other shape only when that hook RUNS the gate;
//   - a hook that only names the gate file — as an argument to echo, cat, rm — is not the gate at all,
//     and nothing touches it, whatever describe it wears;
//   - a hook where the installer cannot tell whether the gate runs is named, and never taken, with or
//     without a flag;
//   - a wrapper the reader pins (`timeout`, `nice`, `nohup`, `env`, `command`, `exec`, `caffeinate`, `sudo`) runs
//     the command after it, so a gate wrapped in one runs; a wrapper form it does not pin is unclear.
// test/hook-ownership-v0.19.0.test.mjs holds all of it against 0.19.0's own installers, row by row.
//
// The regression behind them: the first command-based ownership check took any hook that began with
// the gate's own assignment and NAMED the gate file anywhere in that command. A bare `--remove` deleted
// `AGENT_SKILLS_PROGRESS_GATE=block echo /pack/report-progress-gate.mjs` and a bare install replaced
// it, where 0.19.0 left both alone. Taking a hook that is not yours is the one thing an installer must
// never do.
// ---------------------------------------------------------------------------

const adapter = (file) => fileURLToPath(new URL(`../adapters/claude-code/${file}`, import.meta.url));

const PROGRESS_GATE = adapter('report-progress-gate.mjs');
const RELEASE_GATE = adapter('release-notes-gate.sh');

const INSTALLERS = Object.freeze({
  progress: Object.freeze({
    script: adapter('install-report-progress-gate.mjs'),
    event: 'Stop',
    matcher: '*',
    label: 'Stop (matcher *)',
    nothingInstalled: /No report-progress gate was installed/,
  }),
  release: Object.freeze({
    script: adapter('install-release-notes-gate.mjs'),
    event: 'PreToolUse',
    matcher: 'Bash',
    label: 'PreToolUse (matcher Bash)',
    nothingInstalled: /No release-notes gate was installed/,
  }),
});

/** Every variable either gate reads. Cleared from every child, so only a command's own assignments count. */
const GATE_VARIABLES = Object.freeze([
  'AGENT_SKILLS_PROGRESS_GATE',
  'AGENT_SKILLS_PROGRESS_GATE_COVERAGE',
  'AGENT_SKILLS_PROGRESS_GATE_SKILLS',
  'AGENT_SKILLS_PROGRESS_GATE_TURN_HOOK',
  'AGENT_SKILLS_PROGRESS_GATE_DIR',
  'AGENT_SKILLS_RELEASE_NOTES_GATE',
]);

function childEnv(extra) {
  const env = { ...process.env };
  for (const name of GATE_VARIABLES) delete env[name];
  return { ...env, ...extra };
}

/** How both installers quote a word into a command. */
const q = (value) => `'${String(value).split("'").join(`'\\''`)}'`;

async function scratch(name) {
  return mkdtemp(path.join(tmpdir(), `${name}-`));
}

function spawnCollect(file, args, { env, stdin }) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'], env });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.stdin.on('error', () => {});
    child.stdin.end(stdin ?? '');
  });
}

function runInstaller(kind, args, home) {
  return spawnCollect(process.execPath, [INSTALLERS[kind].script, ...args], { env: childEnv({ HOME: home }) });
}

/** A settings file holding one hook, under the event and matcher that installer writes. */
async function settingsWith(kind, command) {
  const home = await scratch(`ownership-${kind}`);
  const file = path.join(home, 'settings.json');
  const hook = { type: 'command', command };
  const text = JSON.stringify({ hooks: { [INSTALLERS[kind].event]: [{ matcher: INSTALLERS[kind].matcher, hooks: [hook] }] } }, null, 2);
  await writeFile(file, text);
  return { home, file, text, hook };
}

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

// ---------------------------------------------------------------------------
// A mention: the gate file is an argument of a command that reads, lists, copies or deletes it.
// ---------------------------------------------------------------------------

const MENTIONS = Object.freeze({
  progress: [
    'AGENT_SKILLS_PROGRESS_GATE=block echo /pack/report-progress-gate.mjs',
    'AGENT_SKILLS_PROGRESS_GATE=block cat /pack/adapters/claude-code/report-progress-gate.mjs',
    'AGENT_SKILLS_PROGRESS_GATE=off rm -f /tmp/report-progress-gate.mjs',
    'AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 grep -c decision /pack/report-progress-gate.mjs',
    'AGENT_SKILLS_PROGRESS_GATE=block cp /pack/report-progress-gate.mjs /tmp/copy.mjs',
    'AGENT_SKILLS_PROGRESS_GATE=block ls -l /pack/report-progress-gate.mjs',
    "echo '/pack/report-progress-gate.mjs'",
    // A redirection target is written to, not run.
    'AGENT_SKILLS_PROGRESS_GATE=block echo armed &> /pack/report-progress-gate.mjs',
    // The installer's exact shape, with a program that only prints in the interpreter's place.
    "AGENT_SKILLS_PROGRESS_GATE=block '/bin/echo' '/pack/report-progress-gate.mjs'",
  ],
  release: [
    'AGENT_SKILLS_RELEASE_NOTES_GATE=block echo /pack/release-notes-gate.sh',
    'AGENT_SKILLS_RELEASE_NOTES_GATE=block shellcheck /pack/adapters/claude-code/release-notes-gate.sh',
    'AGENT_SKILLS_RELEASE_NOTES_GATE=block cat /pack/release-notes-gate.sh',
    'AGENT_SKILLS_RELEASE_NOTES_GATE=off rm -f /tmp/release-notes-gate.sh',
    'echo /pack/release-notes-gate.sh',
    'AGENT_SKILLS_RELEASE_NOTES_GATE=block echo armed >| /pack/release-notes-gate.sh',
    "AGENT_SKILLS_RELEASE_NOTES_GATE=block shellcheck '/pack/release-notes-gate.sh'",
  ],
});

test('a hook that only names the gate file is left alone by --remove and by an install, with or without --adopt', async () => {
  for (const [kind, commands] of Object.entries(MENTIONS)) {
    const { event, matcher, nothingInstalled } = INSTALLERS[kind];
    for (const command of commands) {
      for (const flags of [[], ['--adopt']]) {
        const { home, file, text } = await settingsWith(kind, command);
        const removed = await runInstaller(kind, ['--remove', ...flags, '--settings', file], home);
        const run = `${kind} --remove ${flags.join(' ')} over ${JSON.stringify(command)}`;
        assert.equal(removed.status, 0, `${run}: ${removed.stderr}`);
        assert.match(removed.stdout, nothingInstalled, `${run}: read a mention as a gate`);
        assert.equal(await readFile(file, 'utf8'), text, `${run}: took a hook that never runs the gate`);
      }
      for (const flags of [[], ['--adopt']]) {
        const { home, file, hook } = await settingsWith(kind, command);
        const installed = await runInstaller(kind, ['--mode', 'block', ...flags, '--settings', file], home);
        const run = `${kind} install ${flags.join(' ')} over ${JSON.stringify(command)}`;
        assert.equal(installed.status, 0, `${run}: ${installed.stderr}`);
        const group = (await readJson(file)).hooks[event].find((candidate) => candidate.matcher === matcher);
        assert.deepEqual(group.hooks[0], hook, `${run}: replaced or moved a hook that never runs the gate`);
        assert.equal(group.hooks.length, 2, `${run}: expected the hook beside the gate just written`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Unclear: the gate file is there, and whether the gate runs cannot be told from the command.
// ---------------------------------------------------------------------------

const UNCLEAR = Object.freeze({
  progress: [
    'AGENT_SKILLS_PROGRESS_GATE=block /usr/local/bin/hook-wrapper --gate=/pack/report-progress-gate.mjs',
    'timeout --no-such-option 5 node /pack/report-progress-gate.mjs',
    'node --check /pack/report-progress-gate.mjs',
    'cat /pack/report-progress-gate.mjs | node --input-type=module',
    'node $(echo /pack/report-progress-gate.mjs)',
    'GATE=/pack/report-progress-gate.mjs; node "$GATE"',
  ],
  release: [
    'AGENT_SKILLS_RELEASE_NOTES_GATE=block /usr/local/bin/hook-wrapper /pack/release-notes-gate.sh',
    'sudo -i bash /pack/release-notes-gate.sh',
    'bash -n /pack/release-notes-gate.sh',
    "bash <<'EOF'\nbash /pack/release-notes-gate.sh\nEOF",
    'gate() { bash /pack/release-notes-gate.sh; }',
  ],
});

test('a hook where the installer cannot tell whether the gate runs is named and kept, and --adopt never takes it', async () => {
  for (const [kind, commands] of Object.entries(UNCLEAR)) {
    const { label, nothingInstalled } = INSTALLERS[kind];
    for (const command of commands) {
      for (const flags of [[], ['--adopt']]) {
        const { home, file, text } = await settingsWith(kind, command);
        const removed = await runInstaller(kind, ['--remove', ...flags, '--settings', file], home);
        const output = `${removed.stdout}${removed.stderr}`;
        const run = `${kind} --remove ${flags.join(' ')} over ${JSON.stringify(command)}`;
        assert.equal(removed.status, 1, `${run}: a --remove that may have left the gate wired exited ${removed.status}`);
        assert.equal(await readFile(file, 'utf8'), text, `${run}: took a hook it could not tell runs the gate`);
        assert.ok(output.includes(label), `${run}: did not name the hook`);
        assert.match(output, /cannot tell whether/, `${run}: did not say why the hook was kept`);
        assert.doesNotMatch(output, nothingInstalled);
        assert.doesNotMatch(output, /again with --remove --adopt/, `${run}: advised a flag that would not remove it`);
      }
      for (const flags of [[], ['--adopt']]) {
        const { home, file, text } = await settingsWith(kind, command);
        const installed = await runInstaller(kind, ['--mode', 'block', ...flags, '--settings', file], home);
        const run = `${kind} install ${flags.join(' ')} over ${JSON.stringify(command)}`;
        assert.equal(installed.status, 1, `${run}: installed beside a hook that may already run the gate`);
        assert.equal(await readFile(file, 'utf8'), text, `${run}: changed the file`);
        assert.ok(installed.stderr.includes(label), `${run}: did not name the hook`);
        assert.match(installed.stderr, /cannot tell whether/);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// A hand-wiring: it runs the gate, and it is not exactly a shape an installer wrote.
// ---------------------------------------------------------------------------

const NODE = '/opt/node/bin/node';
const PACKED_PROGRESS = '/pack/adapters/claude-code/report-progress-gate.mjs';
const PACKED_RELEASE = '/pack/adapters/claude-code/release-notes-gate.sh';
const OWN_PROGRESS = `AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 ${q(NODE)} ${q(PACKED_PROGRESS)}`;
const OWN_RELEASE = `AGENT_SKILLS_RELEASE_NOTES_GATE=block bash ${q(PACKED_RELEASE)}`;

const HAND_WIRINGS = Object.freeze({
  progress: [
    `${OWN_PROGRESS} && rm -rf /tmp/x`,
    `${OWN_PROGRESS} --verbose`,
    `${OWN_PROGRESS} > /dev/null`,
    `NODE_OPTIONS=--no-warnings ${OWN_PROGRESS}`,
    `AGENT_SKILLS_PROGRESS_GATE="block" ${q(NODE)} ${q(PACKED_PROGRESS)}`,
    `AGENT_SKILLS_PROGRESS_GATE=block node ${q(PACKED_PROGRESS)}`,
    `AGENT_SKILLS_PROGRESS_GATE=block ${q(NODE)} ${PACKED_PROGRESS}`,
    // The exact shape with an interpreter no Node-compatible runtime is called, which this reader does not
    // know as one either: adoptable, never unclear, because the installer's own shape is never unclear.
    `AGENT_SKILLS_PROGRESS_GATE=block ${q('/usr/local/bin/node-lts')} ${q(PACKED_PROGRESS)}`,
    `AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 ${q('/usr/local/bin/hook-wrapper')} ${q(PACKED_PROGRESS)}`,
    // Wrapped in commands the reader knows run the command after them.
    `AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 timeout 5 ${q(NODE)} ${q(PACKED_PROGRESS)}`,
    `AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 sudo -u x timeout 5 ${q(NODE)} ${q(PACKED_PROGRESS)}`,
  ],
  release: [
    `${OWN_RELEASE} && rm -rf /tmp/x`,
    `${OWN_RELEASE} 2>/dev/null`,
    `AGENT_SKILLS_RELEASE_NOTES_GATE=block ${q('/bin/bash')} ${q(PACKED_RELEASE)}`,
    `AGENT_SKILLS_RELEASE_NOTES_GATE=block sh ${q(PACKED_RELEASE)}`,
    `AGENT_SKILLS_RELEASE_NOTES_GATE=block AGENT_SKILLS_PROGRESS_GATE=off bash ${q(PACKED_RELEASE)}`,
    `AGENT_SKILLS_RELEASE_NOTES_GATE=block bash5 ${q(PACKED_RELEASE)}`,
    `AGENT_SKILLS_RELEASE_NOTES_GATE=block ${q('/opt/homebrew/bin/bash5')} ${q(PACKED_RELEASE)}`,
    `AGENT_SKILLS_RELEASE_NOTES_GATE=block timeout 5 bash ${q(PACKED_RELEASE)}`,
    `AGENT_SKILLS_RELEASE_NOTES_GATE=block nice -n 10 bash ${q(PACKED_RELEASE)}`,
  ],
});

test('a hook that runs the gate in any shape an installer never wrote is not its own: named, refused, and taken only with --adopt', async () => {
  for (const [kind, commands] of Object.entries(HAND_WIRINGS)) {
    const { label } = INSTALLERS[kind];
    for (const command of commands) {
      const run = `${kind} over ${JSON.stringify(command)}`;
      const { home, file, text } = await settingsWith(kind, command);

      const removed = await runInstaller(kind, ['--remove', '--settings', file], home);
      const output = `${removed.stdout}${removed.stderr}`;
      assert.equal(removed.status, 1, `${run}: a bare --remove took it or called the gate gone`);
      assert.equal(await readFile(file, 'utf8'), text, `${run}: a bare --remove took a hook that is not exactly its own`);
      assert.ok(output.includes(label), `${run}: did not name the hook`);
      assert.match(output, /again with --remove --adopt/);

      const installed = await runInstaller(kind, ['--mode', 'block', '--settings', file], home);
      assert.equal(installed.status, 1, `${run}: a bare install replaced it`);
      assert.equal(await readFile(file, 'utf8'), text);
      assert.match(installed.stderr, /again with --adopt/);

      const adopted = await runInstaller(kind, ['--remove', '--adopt', '--settings', file], home);
      assert.equal(adopted.status, 0, `${run}: ${adopted.stderr}`);
      assert.match(adopted.stdout, /Adopted 1 of them/);
      assert.deepEqual(await readJson(file), {}, `${run}: --remove --adopt left the hand-wiring`);
    }
  }
});

// ---------------------------------------------------------------------------
// Every shape a released version wrote. Derived from `git log -p` on both installers across every tag:
//   report-progress, v0.13.0–v0.16.1  AGENT_SKILLS_PROGRESS_GATE=<mode> '<node>' '<gate>'
//                    v0.17.0–v0.18.0  … AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 [… _SKILLS='<list>'] '<node>' '<gate>'
//                    v0.19.0          … _COVERAGE=<1|2> [… _SKILLS='<list>'] '<node>' '<gate>'
//                    this version     … _COVERAGE=<1|2> AGENT_SKILLS_PROGRESS_GATE_TURN_HOOK=UserPromptSubmit [… _SKILLS='<list>'] '<node>' '<gate>'
//   release-notes,   v0.16.0–this     AGENT_SKILLS_RELEASE_NOTES_GATE=<mode> bash '<gate>'
// `<node>` is process.execPath, single-quoted; `<mode>` is block or observe, or off after a user disarms.
// ---------------------------------------------------------------------------

function progressShapes(node, gate) {
  const turn = 'AGENT_SKILLS_PROGRESS_GATE_TURN_HOOK=UserPromptSubmit';
  const skills = `AGENT_SKILLS_PROGRESS_GATE_SKILLS=${q('codex,gpt-researcher')}`;
  const program = `${q(node)} ${q(gate)}`;
  return [
    ...['block', 'observe', 'off'].map((mode) => `AGENT_SKILLS_PROGRESS_GATE=${mode} ${program}`),
    `AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 ${program}`,
    `AGENT_SKILLS_PROGRESS_GATE=observe AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 ${skills} ${program}`,
    `AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=1 ${program}`,
    `AGENT_SKILLS_PROGRESS_GATE=off AGENT_SKILLS_PROGRESS_GATE_COVERAGE=1 ${turn} ${program}`,
    `AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 ${turn} ${program}`,
    `AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 ${turn} ${skills} ${program}`,
  ];
}

const releaseShapes = (gate) => ['block', 'observe', 'off'].map((mode) => `AGENT_SKILLS_RELEASE_NOTES_GATE=${mode} bash ${q(gate)}`);

test('every command a released version of either installer wrote is recognised with no flag, describe or not', async () => {
  const cases = [
    ...progressShapes(NODE, PACKED_PROGRESS).map((command) => ['progress', command]),
    ...progressShapes("/opt/my node's/bin/node", "/srv/it's a pack/report-progress-gate.mjs").map((command) => ['progress', command]),
    // process.execPath under the names a Node-compatible runtime goes by: Debian and Ubuntu's nodejs package,
    // Windows, a versioned binary, and bun.
    ...progressShapes('/usr/bin/nodejs', PACKED_PROGRESS).map((command) => ['progress', command]),
    ...progressShapes('C:\\Program Files\\nodejs\\node.exe', PACKED_PROGRESS).map((command) => ['progress', command]),
    ...progressShapes('/usr/local/bin/node-20', PACKED_PROGRESS).map((command) => ['progress', command]),
    ...progressShapes('/opt/bun/bin/bun', PACKED_PROGRESS).map((command) => ['progress', command]),
    ...releaseShapes(PACKED_RELEASE).map((command) => ['release', command]),
    ...releaseShapes("/srv/it's a pack/release-notes-gate.sh").map((command) => ['release', command]),
  ];
  for (const [kind, command] of cases) {
    const run = `${kind} --remove over ${JSON.stringify(command)}`;
    const { home, file } = await settingsWith(kind, command);
    const removed = await runInstaller(kind, ['--remove', '--settings', file], home);
    assert.equal(removed.status, 0, `${run}: ${removed.stderr}`);
    assert.match(removed.stdout, /Removed 1 (report-progress|release-notes) gate hook from/);
    assert.doesNotMatch(`${removed.stdout}${removed.stderr}`, /--adopt|not gone|refusing/, `${run}: its own shape needed a flag`);
    assert.deepEqual(await readJson(file), {}, `${run}: its own hook survived --remove`);
  }
});

// ---------------------------------------------------------------------------
// The live shape: both gates in block mode, report-progress at coverage 2, every describe stripped by a
// settings rewrite, beside hooks nobody here wrote. A re-run of each installer just works, and what it
// writes still fires when the harness runs it.
// ---------------------------------------------------------------------------

const BAD_REPORT = 'Great progress! Things are moving along nicely and the background agent should be wrapping up shortly.';
const UNRELATED = Object.freeze({ type: 'command', command: 'someone-elses-hook' });

/** Run a written hook command the way the harness does: through /bin/sh, payload on stdin, no ambient gate variables. */
const runWritten = (command, payload, extra = {}) => spawnCollect('/bin/sh', ['-c', command], { env: childEnv(extra), stdin: JSON.stringify(payload) });

const commandsOf = (settings, event, matcher) => (settings.hooks?.[event] ?? [])
  .filter((group) => group.matcher === matcher)
  .flatMap((group) => group.hooks)
  .map((hook) => hook.command)
  .filter((command) => command !== UNRELATED.command);

function stripDescribes(settings) {
  for (const groups of Object.values(settings.hooks ?? {})) {
    for (const group of groups) for (const hook of group.hooks) delete hook.describe;
  }
  return settings;
}

async function progressFires(settings, markers) {
  const [arm] = commandsOf(settings, 'SubagentStart', '*');
  const [stop] = commandsOf(settings, 'Stop', '*');
  assert.ok(arm && stop, 'the progress gate has no SubagentStart or Stop hook');
  const env = { AGENT_SKILLS_PROGRESS_GATE_DIR: markers };
  await runWritten(arm, { hook_event_name: 'SubagentStart', session_id: 'sess-live', agent_id: 'a1', agent_type: 'general-purpose' }, env);
  const stopped = await runWritten(stop, { hook_event_name: 'Stop', session_id: 'sess-live', stop_hook_active: false, last_assistant_message: BAD_REPORT }, env);
  return stopped.stdout.trim() !== '' && JSON.parse(stopped.stdout).decision === 'block';
}

async function releaseFires(settings, project) {
  const [command] = commandsOf(settings, 'PreToolUse', 'Bash');
  assert.ok(command, 'the release-notes gate has no PreToolUse hook');
  const result = await runWritten(command, { hook_event_name: 'PreToolUse', session_id: 'sess-live', tool_name: 'Bash', cwd: project, tool_input: { command: 'npm publish' } });
  return result.stdout.trim() !== '' && JSON.parse(result.stdout).hookSpecificOutput?.permissionDecision === 'deny';
}

test('the live shape of both gates, describe stripped, is recognised by a re-run of each installer, and what they write still fires', async () => {
  const home = await scratch('ownership-live');
  const file = path.join(home, 'settings.json');
  // The node binary as a user's installer resolved it: a path whose basename is `node`.
  await mkdir(path.join(home, 'bin'));
  const node = path.join(home, 'bin', 'node');
  await symlink(process.execPath, node);
  const progress = `AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 ${q(node)} ${q(PROGRESS_GATE)}`;
  const release = `AGENT_SKILLS_RELEASE_NOTES_GATE=block bash ${q(RELEASE_GATE)}`;
  const live = {
    model: 'opus',
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [structuredClone(UNRELATED), { type: 'command', command: release, timeout: 10 }] }],
      Stop: [{ hooks: [structuredClone(UNRELATED)] }, { matcher: '*', hooks: [{ type: 'command', command: progress, timeout: 10 }] }],
      SubagentStart: [{ matcher: '*', hooks: [{ type: 'command', command: progress, timeout: 5 }] }],
    },
  };
  await writeFile(file, JSON.stringify(live, null, 2));

  const project = path.join(home, 'project');
  await mkdir(project);
  await writeFile(path.join(project, 'package.json'), `${JSON.stringify({ name: '@acme/cli', version: '1.4.0' }, null, 2)}\n`);
  await writeFile(path.join(project, 'CHANGELOG.md'), '# Releases\n\n## 1.3.0\n\nwhat / why / impact\n');

  // The fixture is live: both gates fire from the commands as the user has them.
  assert.equal(await progressFires(live, path.join(home, 'markers-before')), true, 'the fixture\'s progress gate never blocks');
  assert.equal(await releaseFires(live, project), true, 'the fixture\'s release-notes gate never refuses');

  const quiet = /refusing|--adopt|Adopted|not written by this installer|cannot tell whether|Mode observe/;
  const progressRun = await runInstaller('progress', ['--mode', 'block', '--settings', file], home);
  assert.equal(progressRun.status, 0, progressRun.stderr);
  assert.match(progressRun.stdout, /Kept coverage 2 \(already installed in this file\)/);
  assert.doesNotMatch(`${progressRun.stdout}${progressRun.stderr}`, quiet);
  let settings = await readJson(file);
  assert.deepEqual(commandsOf(settings, 'PreToolUse', 'Bash'), [release], 'the progress installer touched the release-notes gate');

  const releaseRun = await runInstaller('release', ['--mode', 'block', '--settings', file], home);
  assert.equal(releaseRun.status, 0, releaseRun.stderr);
  assert.doesNotMatch(`${releaseRun.stdout}${releaseRun.stderr}`, quiet);
  const afterRelease = await readJson(file);
  assert.deepEqual(commandsOf(afterRelease, 'Stop', '*'), commandsOf(settings, 'Stop', '*'), 'the release-notes installer touched the progress gate');
  assert.equal(commandsOf(afterRelease, 'PreToolUse', 'Bash').length, 1, 'the release-notes gate was stacked');
  settings = afterRelease;
  assert.equal(settings.model, 'opus');
  assert.deepEqual(settings.hooks.Stop[0], { hooks: [UNRELATED] });
  assert.deepEqual(settings.hooks.PreToolUse[0].hooks[0], UNRELATED);

  // The harness rewrites the file; the gates it now holds still fire, and each installer still knows its own.
  stripDescribes(settings);
  await writeFile(file, JSON.stringify(settings, null, 2));
  assert.equal(await progressFires(settings, path.join(home, 'markers-after')), true, 'the re-installed progress gate never blocks');
  assert.equal(await releaseFires(settings, project), true, 'the re-installed release-notes gate never refuses');

  // With no flags at all — "just re-run the installer" — both keep block mode, and the gates still fire.
  const bare = await runInstaller('progress', ['--settings', file], home);
  assert.equal(bare.status, 0, bare.stderr);
  assert.match(bare.stdout, /Kept coverage 2 \(already installed in this file\)/);
  assert.match(bare.stdout, /^Kept mode block \(already installed in this file\)\./m);
  const bareRelease = await runInstaller('release', ['--settings', file], home);
  assert.equal(bareRelease.status, 0, bareRelease.stderr);
  assert.match(bareRelease.stdout, /^Kept mode block \(already installed in this file\)\./m);
  assert.doesNotMatch(`${bare.stdout}${bareRelease.stdout}`, quiet);
  const rerun = await readJson(file);
  assert.equal(await progressFires(rerun, path.join(home, 'markers-bare')), true, 'a re-run with no flags left a progress gate that never blocks');
  assert.equal(await releaseFires(rerun, project), true, 'a re-run with no flags left a release-notes gate that never refuses');

  for (const kind of ['progress', 'release']) {
    const removed = await runInstaller(kind, ['--remove', '--settings', file], home);
    assert.equal(removed.status, 0, removed.stderr);
    assert.doesNotMatch(`${removed.stdout}${removed.stderr}`, /--adopt|not gone/);
  }
  assert.deepEqual(await readJson(file), { model: 'opus', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [UNRELATED] }], Stop: [{ hooks: [UNRELATED] }] } });
});

// ---------------------------------------------------------------------------
// The node binary an installer writes is process.execPath, and not every machine calls it `node`: Debian and Ubuntu's
// own package installs `nodejs`, and a versioned binary carries its version. Run under such a binary, the exact-shape
// rule once refused the hooks the installer had just written, describe and all, and `--remove` exited 1 over them,
// where 0.19.0 took them by their describe.
// ---------------------------------------------------------------------------

/** The running node binary under another name: a hard link where the file system allows one, a copy where not. */
async function nodeCalled(home, name) {
  const binary = path.join(home, 'bin', name);
  await mkdir(path.dirname(binary), { recursive: true });
  try {
    await link(process.execPath, binary);
  } catch {
    await copyFile(process.execPath, binary);
    await chmod(binary, 0o755);
  }
  return binary;
}

test('an installer run under a node binary with another name recognises the hooks it wrote, describe or not', async () => {
  for (const strip of [false, true]) {
    const home = await scratch('ownership-renamed-node');
    const node = await nodeCalled(home, 'node-22-renamed');
    const file = path.join(home, 'settings.json');
    const run = (args) => spawnCollect(node, [INSTALLERS.progress.script, ...args, '--settings', file], { env: childEnv({ HOME: home }) });
    const stripFile = async () => {
      if (strip) await writeFile(file, JSON.stringify(stripDescribes(await readJson(file)), null, 2));
    };

    const installed = await run(['--mode', 'block', '--coverage', '2']);
    assert.equal(installed.status, 0, installed.stderr);
    const [stop] = commandsOf(await readJson(file), 'Stop', '*');
    // process.execPath is the resolved path: /var/folders is /private/var/folders on macOS.
    assert.ok(stop.includes(` ${q(await realpath(node))} `), `strip=${strip}: the command does not run the binary the installer ran under: ${stop}`);
    await stripFile();

    const rerun = await run(['--mode', 'block']);
    assert.equal(rerun.status, 0, `strip=${strip}: a re-run refused the hooks it wrote: ${rerun.stderr}`);
    assert.match(rerun.stdout, /Kept coverage 2 \(already installed in this file\)/);
    assert.doesNotMatch(`${rerun.stdout}${rerun.stderr}`, /refusing|--adopt|Adopted|cannot tell whether/);
    assert.equal(commandsOf(await readJson(file), 'Stop', '*').length, 1, `strip=${strip}: the re-run stacked a second gate`);
    await stripFile();

    const removed = await run(['--remove']);
    assert.equal(removed.status, 0, `strip=${strip}: --remove left the hooks it wrote: ${removed.stderr}`);
    assert.doesNotMatch(`${removed.stdout}${removed.stderr}`, /--adopt|not gone/);
    assert.deepEqual(await readJson(file), {}, `strip=${strip}: --remove left the hooks it wrote`);
  }
});

// ---------------------------------------------------------------------------
// Where the harness has not dropped it, the installer's own describe on a hook that runs the gate says the installer
// wrote it, whatever the command became. 0.19.0 took such a hook with no flag, by that describe alone. It also took a
// hook that only mentions the gate file under that describe, and that is the one thing this does not do again.
// ---------------------------------------------------------------------------

const OWN_DESCRIBES = Object.freeze({
  progress: 'agent-skills report-progress gate (block): written before a hand edit.',
  release: 'agent-skills release-notes gate (block): written before a hand edit.',
});

test('a hook under the installer\'s own describe that runs the gate is its own with no flag; one that only mentions the gate file is left alone', async () => {
  const runs = {
    progress: `AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 node ${q(PACKED_PROGRESS)}`,
    release: `${OWN_RELEASE} 2>/dev/null`,
  };
  const mentions = {
    progress: `AGENT_SKILLS_PROGRESS_GATE=block ${q('/bin/echo')} ${q(PACKED_PROGRESS)}`,
    release: `AGENT_SKILLS_RELEASE_NOTES_GATE=block shellcheck ${q(PACKED_RELEASE)}`,
  };
  for (const kind of ['progress', 'release']) {
    const { event, matcher, nothingInstalled } = INSTALLERS[kind];
    const described = (command) => ({ type: 'command', command, describe: OWN_DESCRIBES[kind] });

    const removeHome = await scratch(`ownership-described-${kind}`);
    const removeFile = path.join(removeHome, 'settings.json');
    await writeFile(removeFile, JSON.stringify({ hooks: { [event]: [{ matcher, hooks: [described(runs[kind])] }] } }, null, 2));
    const removed = await runInstaller(kind, ['--remove', '--settings', removeFile], removeHome);
    assert.equal(removed.status, 0, `${kind}: ${removed.stderr}`);
    assert.doesNotMatch(`${removed.stdout}${removed.stderr}`, /--adopt|not gone|Adopted/);
    assert.deepEqual(await readJson(removeFile), {}, `${kind}: --remove left a hook under its own describe that runs the gate`);

    const installHome = await scratch(`ownership-described-install-${kind}`);
    const installFile = path.join(installHome, 'settings.json');
    await writeFile(installFile, JSON.stringify({ hooks: { [event]: [{ matcher, hooks: [described(runs[kind])] }] } }, null, 2));
    const installed = await runInstaller(kind, ['--settings', installFile], installHome);
    assert.equal(installed.status, 0, `${kind}: ${installed.stderr}`);
    assert.match(installed.stdout, /^Kept mode block \(already installed in this file\)\./m);
    assert.doesNotMatch(`${installed.stdout}${installed.stderr}`, /refusing|--adopt|Adopted/);
    const written = (await readJson(installFile)).hooks[event].flatMap((group) => group.hooks);
    assert.ok(written.every((entry) => entry.command !== runs[kind]), `${kind}: an install left the hook it replaces`);

    for (const flags of [[], ['--adopt']]) {
      const { home, file, text } = await settingsWith(kind, mentions[kind]);
      const mention = JSON.parse(text);
      mention.hooks[event][0].hooks[0].describe = OWN_DESCRIBES[kind];
      await writeFile(file, JSON.stringify(mention, null, 2));
      const before = await readFile(file, 'utf8');
      const result = await runInstaller(kind, ['--remove', ...flags, '--settings', file], home);
      assert.equal(result.status, 0, `${kind} ${flags.join(' ')}: ${result.stderr}`);
      assert.match(result.stdout, nothingInstalled, `${kind} ${flags.join(' ')}: read a mention under its own describe as the gate`);
      assert.equal(await readFile(file, 'utf8'), before, `${kind} ${flags.join(' ')}: took a hook that only mentions the gate file`);
    }
  }
});

// ---------------------------------------------------------------------------
// The held regression: a hook that wraps the gate in another command. 0.19.0 took it by its describe with no flag, and
// under --adopt without one. The reader read `timeout` as a program it did not know, so the hook was unclear and no flag
// took it. It now strips a wrapper by that wrapper's pinned grammar, and what is left runs the gate.
// ---------------------------------------------------------------------------

const WRAPPED = Object.freeze({
  progress: (wrapper) => `AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 ${wrapper} ${q(NODE)} ${q(PACKED_PROGRESS)}`,
  release: (wrapper) => `AGENT_SKILLS_RELEASE_NOTES_GATE=block ${wrapper} bash ${q(PACKED_RELEASE)}`,
});

test('a gate wrapped in timeout, nice, env or sudo runs: under its own describe no flag is needed, and without one --adopt takes it', async () => {
  const quiet = /refusing|cannot tell whether|not gone/;
  for (const wrapper of ['timeout 5', 'nice -n 10', 'env FOO=1', 'sudo -u x timeout 5']) {
    for (const kind of ['progress', 'release']) {
      const { event, matcher } = INSTALLERS[kind];
      const command = WRAPPED[kind](wrapper);
      const settingsFor = async (described) => {
        const made = await settingsWith(kind, command);
        if (described) {
          const settings = JSON.parse(made.text);
          settings.hooks[event][0].hooks[0].describe = OWN_DESCRIBES[kind];
          await writeFile(made.file, JSON.stringify(settings, null, 2));
        }
        return made;
      };

      for (const [flags, described] of [[[], true], [['--adopt'], false]]) {
        const run = `${kind} install ${flags.join(' ')} over ${JSON.stringify(command)}${described ? ' under its own describe' : ''}`;
        const { home, file } = await settingsFor(described);
        const installed = await runInstaller(kind, [...flags, '--settings', file], home);
        assert.equal(installed.status, 0, `${run}: ${installed.stderr}`);
        assert.doesNotMatch(`${installed.stdout}${installed.stderr}`, quiet, run);
        assert.match(installed.stdout, described ? /^Kept mode block \(already installed in this file\)\./m : /^Kept mode block \(read from the adopted hook\)\./m, run);
        const commands = (await readJson(file)).hooks[event].filter((group) => group.matcher === matcher).flatMap((group) => group.hooks).map((entry) => entry.command);
        assert.equal(commands.length, 1, `${run}: expected exactly the gate this installer writes, found ${commands.length}`);
        assert.ok(!commands.includes(command), `${run}: the wrapped hook was left where the new gate went`);
      }
      for (const [flags, described] of [[['--remove'], true], [['--remove', '--adopt'], false]]) {
        const run = `${kind} ${flags.join(' ')} over ${JSON.stringify(command)}${described ? ' under its own describe' : ''}`;
        const { home, file } = await settingsFor(described);
        const removed = await runInstaller(kind, [...flags, '--settings', file], home);
        assert.equal(removed.status, 0, `${run}: ${removed.stderr}`);
        assert.doesNotMatch(`${removed.stdout}${removed.stderr}`, quiet, run);
        assert.deepEqual(await readJson(file), {}, `${run}: left the wrapped gate`);
      }
    }
  }
});
