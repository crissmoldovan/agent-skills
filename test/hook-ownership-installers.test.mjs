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
// The rule these pin (adapters/claude-code/hook-ownership.mjs), by the release bar's four points in precedence order:
//   1. a run with no flag never takes a hook the reader cannot fully read, with or without the installer's own describe;
//   2. never taken, with any flag: a hook that only MENTIONS the gate file (an argument of echo, cat, rm, unlink, xxd…), only
//      WRITES to it, names a DIFFERENT FILE whose name contains the gate file's, or carries ANOTHER tool's describe;
//   3. everything else 0.19.0 took is taken with the same flags or with --adopt: a hook is an installer's own, with no flag,
//      when its WHOLE command is the installer's exact shape with an interpreter that installer writes, or when it runs the
//      gate under that installer's describe; --adopt also takes a hook that runs the gate in any other shape, and takes over,
//      saying so, any hook the reader cannot fully read that names the gate file, or carries the installer's own describe;
//   4. --remove exits 1 while it leaves a hook that runs the gate, or may, and names every hook it leaves that names the gate
//      file, with why, rather than saying no gate was installed.
// A wrapper the reader pins (`timeout`, `nice`, `nohup`, `env`, `command`, `exec`, `caffeinate`, `sudo`) runs the command after
// it, so a gate wrapped in one runs; a wrapper form it does not pin is one it cannot fully read.
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
    describe: 'agent-skills report-progress gate (block): written before a hand edit.',
  }),
  release: Object.freeze({
    script: adapter('install-release-notes-gate.mjs'),
    event: 'PreToolUse',
    matcher: 'Bash',
    label: 'PreToolUse (matcher Bash)',
    nothingInstalled: /No release-notes gate was installed/,
    describe: 'agent-skills release-notes gate (block): written before a hand edit.',
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

/** A settings file holding one hook, under the event and matcher that installer writes, or the ones named; with a describe when given one. */
async function settingsWith(kind, command, { describe = null, event = INSTALLERS[kind].event, matcher = INSTALLERS[kind].matcher } = {}) {
  const home = await scratch(`ownership-${kind}`);
  const file = path.join(home, 'settings.json');
  const hook = { type: 'command', command, ...(describe === null ? {} : { describe }) };
  const text = JSON.stringify({ hooks: { [event]: [{ matcher, hooks: [hook] }] } }, null, 2);
  await writeFile(file, text);
  return { home, file, text, hook };
}

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

/** The line --remove prints for a hook it names: `  - <event> (matcher <m>): <why>`. */
const namedLine = (output, label, why) => output.split('\n').some((line) => line.startsWith(`  - ${label}: `) && why.test(line));
const LEFT_ALONE_WHY = Object.freeze({
  mention: /: left alone: only mentions the gate file/,
  'write target': /: left alone: only writes to the gate file/,
  'different file': /: left alone: names a different file/,
});

// ---------------------------------------------------------------------------
// Left alone, with any flag (point 2): a hook that names the gate file and that the reader reads as not running it — the gate path
// only as an argument of a program that does not run it (a mention), only as the file a redirection writes to (a write target), or
// only inside the name of a different file. No flag takes it, whatever describe it wears. --remove names each, with why, and never
// says that no gate was installed while one is in the file (point 4).
// ---------------------------------------------------------------------------

const LEFT_ALONE = Object.freeze({
  progress: [
    ['AGENT_SKILLS_PROGRESS_GATE=block echo /pack/report-progress-gate.mjs', 'mention'],
    ['AGENT_SKILLS_PROGRESS_GATE=block cat /pack/adapters/claude-code/report-progress-gate.mjs', 'mention'],
    ['AGENT_SKILLS_PROGRESS_GATE=off rm -f /tmp/report-progress-gate.mjs', 'mention'],
    ['AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 grep -c decision /pack/report-progress-gate.mjs', 'mention'],
    ['AGENT_SKILLS_PROGRESS_GATE=block cp /pack/report-progress-gate.mjs /tmp/copy.mjs', 'mention'],
    ['AGENT_SKILLS_PROGRESS_GATE=block ls -l /pack/report-progress-gate.mjs', 'mention'],
    ["echo '/pack/report-progress-gate.mjs'", 'mention'],
    // The installer's exact shape, with a program that only prints, reads or deletes files in the interpreter's place.
    ["AGENT_SKILLS_PROGRESS_GATE=block '/bin/echo' '/pack/report-progress-gate.mjs'", 'mention'],
    ["AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 unlink '/pack/report-progress-gate.mjs'", 'mention'],
    ["AGENT_SKILLS_PROGRESS_GATE=block '/bin/unlink' '/pack/report-progress-gate.mjs'", 'mention'],
    ["AGENT_SKILLS_PROGRESS_GATE=block xxd '/pack/report-progress-gate.mjs'", 'mention'],
    ["AGENT_SKILLS_PROGRESS_GATE=block du '/pack/report-progress-gate.mjs'", 'mention'],
    // A copy of the gate that then runs: the reader does not follow copies, and names the hook it left.
    ["AGENT_SKILLS_PROGRESS_GATE=block cp '/pack/report-progress-gate.mjs' ./copy.mjs && node ./copy.mjs", 'mention'],
    // A redirection target is written to, not run.
    ['AGENT_SKILLS_PROGRESS_GATE=block echo armed &> /pack/report-progress-gate.mjs', 'write target'],
    // …whatever program writes it: this runs `node -e 0` and truncates the gate.
    ["AGENT_SKILLS_PROGRESS_GATE=block timeout 5 >'/pack/report-progress-gate.mjs' node -e 0", 'write target'],
    // A different file whose name contains the gate file's, which 0.19.0's substring match took.
    ["AGENT_SKILLS_PROGRESS_GATE=block node '/pack/adapters/claude-code/install-report-progress-gate.mjs' --remove", 'different file'],
    ["node '/pack/report-progress-gate.mjs.bak'", 'different file'],
  ],
  release: [
    ['AGENT_SKILLS_RELEASE_NOTES_GATE=block echo /pack/release-notes-gate.sh', 'mention'],
    ['AGENT_SKILLS_RELEASE_NOTES_GATE=block shellcheck /pack/adapters/claude-code/release-notes-gate.sh', 'mention'],
    ['AGENT_SKILLS_RELEASE_NOTES_GATE=block cat /pack/release-notes-gate.sh', 'mention'],
    ['AGENT_SKILLS_RELEASE_NOTES_GATE=off rm -f /tmp/release-notes-gate.sh', 'mention'],
    ['echo /pack/release-notes-gate.sh', 'mention'],
    ["AGENT_SKILLS_RELEASE_NOTES_GATE=block shellcheck '/pack/release-notes-gate.sh'", 'mention'],
    ["AGENT_SKILLS_RELEASE_NOTES_GATE=block unlink '/pack/release-notes-gate.sh'", 'mention'],
    ["AGENT_SKILLS_RELEASE_NOTES_GATE=block '/bin/unlink' '/pack/release-notes-gate.sh'", 'mention'],
    ["AGENT_SKILLS_RELEASE_NOTES_GATE=block xxd '/pack/release-notes-gate.sh'", 'mention'],
    ["AGENT_SKILLS_RELEASE_NOTES_GATE=block du '/pack/release-notes-gate.sh'", 'mention'],
    ["AGENT_SKILLS_RELEASE_NOTES_GATE=block cp '/pack/release-notes-gate.sh' ./copy.sh && bash ./copy.sh", 'mention'],
    ['AGENT_SKILLS_RELEASE_NOTES_GATE=block echo armed >| /pack/release-notes-gate.sh', 'write target'],
    ["AGENT_SKILLS_RELEASE_NOTES_GATE=block bash >'/pack/release-notes-gate.sh'", 'write target'],
    ["AGENT_SKILLS_RELEASE_NOTES_GATE=block bash '/pack/release-notes-gate.sh.orig'", 'different file'],
    ["bash '/pack/my-release-notes-gate.sh'", 'different file'],
  ],
});

test('a hook that names the gate file and does not run it is left alone by --remove and by an install, with any flag or describe, and --remove names it with why', async () => {
  let runs = 0;
  for (const [kind, entries] of Object.entries(LEFT_ALONE)) {
    const { event, matcher, label, nothingInstalled, describe: own } = INSTALLERS[kind];
    for (const [command, why] of entries) {
      for (const describe of [null, own]) {
        for (const flags of [['--remove'], ['--remove', '--adopt']]) {
          const { home, file, text } = await settingsWith(kind, command, { describe });
          const removed = await runInstaller(kind, [...flags, '--settings', file], home);
          const output = `${removed.stdout}${removed.stderr}`;
          const run = `${kind} ${flags.join(' ')} over ${JSON.stringify(command)}${describe ? ' under its own describe' : ''}`;
          assert.equal(removed.status, 0, `${run}: ${removed.stderr}`);
          assert.equal(await readFile(file, 'utf8'), text, `${run}: took a hook that never runs the gate`);
          assert.doesNotMatch(output, nothingInstalled, `${run}: said no gate was installed while a hook names the gate file`);
          assert.ok(namedLine(output, label, LEFT_ALONE_WHY[why]), `${run}: did not name the hook it left alone, with why (${why})\n${output}`);
          assert.doesNotMatch(output, /Took over|not gone|cannot tell whether/, `${run}: said it took over, or could not read, a hook it read`);
          runs += 1;
        }
        for (const flags of [[], ['--adopt']]) {
          const { home, file, hook } = await settingsWith(kind, command, { describe });
          const installed = await runInstaller(kind, ['--mode', 'block', ...flags, '--settings', file], home);
          const run = `${kind} install ${flags.join(' ')} over ${JSON.stringify(command)}${describe ? ' under its own describe' : ''}`;
          assert.equal(installed.status, 0, `${run}: ${installed.stderr}`);
          assert.doesNotMatch(`${installed.stdout}${installed.stderr}`, /Took over/, `${run}: said it took over a hook it left`);
          const group = (await readJson(file)).hooks[event].find((candidate) => candidate.matcher === matcher);
          assert.deepEqual(group.hooks[0], hook, `${run}: replaced or moved a hook that never runs the gate`);
          assert.equal(group.hooks.length, 2, `${run}: expected the hook beside the gate just written`);
          runs += 1;
        }
      }
    }
  }
  assert.equal(runs, Object.values(LEFT_ALONE).flat().length * 2 * 4, 'a run over a hook left alone did not happen');
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
    // The exact shape with a Node-compatible runtime written another way than the installer writes it.
    `AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 bun ${q(PACKED_PROGRESS)}`,
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
    `AGENT_SKILLS_RELEASE_NOTES_GATE=block zsh ${q(PACKED_RELEASE)}`,
    `AGENT_SKILLS_RELEASE_NOTES_GATE=block ${q('/bin/dash')} ${q(PACKED_RELEASE)}`,
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
      // Left alone, and named as a mention: never "no gate was installed" while a hook names the gate file.
      assert.doesNotMatch(result.stdout, nothingInstalled, `${kind} ${flags.join(' ')}: said no gate was installed while a hook names the gate file`);
      assert.ok(namedLine(result.stdout, INSTALLERS[kind].label, LEFT_ALONE_WHY.mention), `${kind} ${flags.join(' ')}: did not name the mention it left alone\n${result.stdout}`);
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

// ---------------------------------------------------------------------------
// The override. A reader that never guesses always refuses some hand-wrapped hook, and 0.19.0 took such hooks — by its
// describe with no flag, or under --adopt — matching the gate file's name anywhere in the command. So --adopt takes over any hook
// the installer cannot fully read that names the gate file, as a word, inside a quoted argument or an option value, whatever
// leads it, unless it writes to the gate file; and it says so, naming each hook by event and matcher. With no flag nothing
// changes: such a hook is named and refused, its own describe or not. Each entry names the mode the adopted command runs the gate
// in, which an install keeps: `off` where it sets no mode, and none (the default, said so) where it sets one this reader cannot read.
// ---------------------------------------------------------------------------

const MODE_LINE = Object.freeze({
  block: /^Kept mode block \(read from the adopted hook\)\./m,
  off: /^Kept mode off \(read from the adopted hook\): the gate is disarmed/m,
  unreadable: /^Mode observe, the default — the mode the gate already in this file ran in could not be read from its command\./m,
});

const TAKEN_OVER = Object.freeze({
  progress: [
    // The wrapper forms the held release reviews found running the gate, or not, that the reader does not recognise.
    ...['nice -10', 'stdbuf -oL', 'timeout -p 5', 'time', 'sudo -i', 'timeout --no-such-option 5'].map((wrapper) => [WRAPPED.progress(wrapper), 'block']),
    // The gate as what the interpreter reads on stdin, and as a here-string.
    [`AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 ${q(NODE)} <${q(PACKED_PROGRESS)}`, 'block'],
    ['AGENT_SKILLS_PROGRESS_GATE=block timeout 5 node <<< /pack/report-progress-gate.mjs', 'block'],
    // A sudo value the shell may make vanish, an adjustment BSD nice refuses, a wrapper script given an option.
    ['AGENT_SKILLS_PROGRESS_GATE=block sudo -n -u $U node /pack/report-progress-gate.mjs', 'block'],
    ['AGENT_SKILLS_PROGRESS_GATE=block nice -n 2147483648 node /pack/report-progress-gate.mjs', 'block'],
    [`AGENT_SKILLS_PROGRESS_GATE=block /usr/local/bin/hook-wrapper --verbose ${q(PACKED_PROGRESS)}`, 'block'],
    // The installer's exact shape under a program this reader does not know runs a Node module.
    [`AGENT_SKILLS_PROGRESS_GATE=block ${q('/usr/local/bin/node-lts')} ${q(PACKED_PROGRESS)}`, 'block'],
    [`AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 ${q('/usr/local/bin/hook-wrapper')} ${q(PACKED_PROGRESS)}`, 'block'],
    // The held ship report's gap forms: no leading assignment of the gate's own variable, or one this reader cannot read…
    [`nice -10 node ${q(PACKED_PROGRESS)}`, 'off'],
    [`timeout --no-such-option 5 node ${q(PACKED_PROGRESS)}`, 'off'],
    [`time node ${q(PACKED_PROGRESS)}`, 'off'],
    [`timeout -p 5 node ${q(PACKED_PROGRESS)}`, 'off'],
    [`sudo -i node ${q(PACKED_PROGRESS)}`, 'off'],
    [`env AGENT_SKILLS_PROGRESS_GATE=block nice -10 node ${q(PACKED_PROGRESS)}`, 'unreadable'],
    [`cd /tmp && AGENT_SKILLS_PROGRESS_GATE=block nice -10 node ${q(PACKED_PROGRESS)}`, 'unreadable'],
    [`export AGENT_SKILLS_PROGRESS_GATE=block; nice -10 node ${q(PACKED_PROGRESS)}`, 'unreadable'],
    [`AGENT_SKILLS_PROGRESS_GATE=\${MODE:-block} nice -10 node ${q(PACKED_PROGRESS)}`, 'unreadable'],
    [`sudo -u x AGENT_SKILLS_PROGRESS_GATE=block nice -10 node ${q(PACKED_PROGRESS)}`, 'unreadable'],
    [`AGENT_SKILLS_PROGRESS_GATEX=block nice -10 node ${q(PACKED_PROGRESS)}`, 'off'],
    [`AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 nice -10 cat ${q(PACKED_PROGRESS)}`, 'off'],
    // …and the gate path only inside a word: an option's value, a substitution, a script, a variable, a function, a pipe.
    ['AGENT_SKILLS_PROGRESS_GATE=block /usr/local/bin/hook-wrapper --gate=/pack/report-progress-gate.mjs', 'block'],
    ['AGENT_SKILLS_PROGRESS_GATE=block node $(echo /pack/report-progress-gate.mjs)', 'block'],
    ["AGENT_SKILLS_PROGRESS_GATE=block sh -c 'nice -10 node /pack/report-progress-gate.mjs; true'", 'block'],
    [`GATE=${q(PACKED_PROGRESS)} AGENT_SKILLS_PROGRESS_GATE=block sh -c 'nice -10 node "$GATE"'`, 'block'],
    [`GATE=${q(PACKED_PROGRESS)}; AGENT_SKILLS_PROGRESS_GATE=block node "$GATE"`, 'unreadable'],
    [`gate() { AGENT_SKILLS_PROGRESS_GATE=block node ${q(PACKED_PROGRESS)}; }; gate`, 'unreadable'],
    ['cat /pack/report-progress-gate.mjs | node --input-type=module', 'off'],
    ['node --check /pack/report-progress-gate.mjs', 'off'],
  ],
  release: [
    ...['nice -10', 'stdbuf -oL', 'timeout -p 5', 'time', 'sudo -i', 'timeout --no-such-option 5'].map((wrapper) => [WRAPPED.release(wrapper), 'block']),
    [`AGENT_SKILLS_RELEASE_NOTES_GATE=block bash <${q(PACKED_RELEASE)}`, 'block'],
    ['AGENT_SKILLS_RELEASE_NOTES_GATE=block bash <<< /pack/release-notes-gate.sh', 'block'],
    ['AGENT_SKILLS_RELEASE_NOTES_GATE=block /usr/local/bin/hook-wrapper /pack/release-notes-gate.sh', 'block'],
    // The installer's exact shape under a program this reader does not know runs a shell script.
    [`AGENT_SKILLS_RELEASE_NOTES_GATE=block bash5 ${q(PACKED_RELEASE)}`, 'block'],
    [`AGENT_SKILLS_RELEASE_NOTES_GATE=block ${q('/opt/homebrew/bin/bash5')} ${q(PACKED_RELEASE)}`, 'block'],
    [`AGENT_SKILLS_RELEASE_NOTES_GATE=block ${q('/usr/bin/env')} ${q(PACKED_RELEASE)}`, 'block'],
    // The held ship report's gap forms.
    [`nice -10 bash ${q(PACKED_RELEASE)}`, 'off'],
    [`timeout --no-such-option 5 bash ${q(PACKED_RELEASE)}`, 'off'],
    [`time bash ${q(PACKED_RELEASE)}`, 'off'],
    [`sudo -i bash ${q(PACKED_RELEASE)}`, 'off'],
    [`env AGENT_SKILLS_RELEASE_NOTES_GATE=block nice -10 bash ${q(PACKED_RELEASE)}`, 'unreadable'],
    [`gate() { bash ${q(PACKED_RELEASE)}; }; gate`, 'off'],
    ['AGENT_SKILLS_RELEASE_NOTES_GATE=block hook-wrapper --script=/pack/release-notes-gate.sh', 'block'],
    ["bash <<'EOF'\nbash /pack/release-notes-gate.sh\nEOF", 'off'],
    ['bash -n /pack/release-notes-gate.sh', 'off'],
    // rg runs the file its --pre option names.
    [`AGENT_SKILLS_RELEASE_NOTES_GATE=block rg --pre ${q(PACKED_RELEASE)} x /etc/hosts`, 'block'],
  ],
});

test('a hook the installer cannot fully read that names the gate file: refused with no flag, describe or not; --adopt takes it over, says so, and keeps its mode', async () => {
  let runs = 0;
  for (const [kind, entries] of Object.entries(TAKEN_OVER)) {
    const { event, matcher, label, nothingInstalled } = INSTALLERS[kind];
    const tookOver = `Took over 1 hook this installer could not fully read: ${label}.`;
    for (const [command, mode] of entries) {
      for (const described of [false, true]) {
        const run = (flags) => `${kind} ${flags.join(' ') || 'bare'} over ${JSON.stringify(command)}${described ? ' under its own describe' : ''}`;
        const made = () => settingsWith(kind, command, { describe: described ? INSTALLERS[kind].describe : null });

        // No flag: named, refused, the file untouched, and --adopt offered.
        for (const flags of [['--remove'], []]) {
          const { home, file, text } = await made();
          const result = await runInstaller(kind, [...flags, '--settings', file], home);
          const output = `${result.stdout}${result.stderr}`;
          assert.equal(result.status, 1, `${run(flags)}: took a hook it cannot fully read with no flag`);
          assert.equal(await readFile(file, 'utf8'), text, `${run(flags)}: changed the file`);
          assert.ok(output.includes(label), `${run(flags)}: did not name the hook`);
          assert.match(output, /cannot tell whether/, run(flags));
          assert.match(output, flags.length > 0 ? /again with --remove --adopt/ : /again with --adopt/, `${run(flags)}: did not say --adopt takes it`);
          assert.doesNotMatch(output, /Took over/, run(flags));
          assert.doesNotMatch(output, nothingInstalled, run(flags));
          runs += 1;
        }

        // --remove --adopt: gone, and said out loud.
        {
          const flags = ['--remove', '--adopt'];
          const { home, file } = await made();
          const removed = await runInstaller(kind, [...flags, '--settings', file], home);
          assert.equal(removed.status, 0, `${run(flags)}: ${removed.stderr}`);
          assert.deepEqual(await readJson(file), {}, `${run(flags)}: left the hook`);
          assert.ok(removed.stdout.split('\n').includes(tookOver), `${run(flags)}: did not print "${tookOver}"\n${removed.stdout}`);
          assert.doesNotMatch(removed.stdout, /Adopted 1 of them/, `${run(flags)}: counted it as a hook that runs the gate`);
          runs += 1;
        }

        // --adopt install: replaced by this installer's own, keeping block, and said out loud.
        {
          const flags = ['--adopt'];
          const { home, file } = await made();
          const installed = await runInstaller(kind, [...flags, '--settings', file], home);
          assert.equal(installed.status, 0, `${run(flags)}: ${installed.stderr}`);
          assert.ok(installed.stdout.split('\n').includes(tookOver), `${run(flags)}: did not print "${tookOver}"\n${installed.stdout}`);
          assert.match(installed.stdout, MODE_LINE[mode], `${run(flags)}: did not keep the mode its command runs the gate in (${mode})\n${installed.stdout}`);
          const left = (await readJson(file)).hooks[event].filter((group) => group.matcher === matcher).flatMap((group) => group.hooks).map((entry) => entry.command);
          assert.equal(left.length, 1, `${run(flags)}: expected exactly the gate this installer writes, found ${left.length}`);
          assert.ok(!left.includes(command), `${run(flags)}: the hook was left where the new gate went`);
          runs += 1;
        }
      }
    }
  }
  const commands = Object.values(TAKEN_OVER).flat().length;
  assert.equal(runs, commands * 2 * 4, 'a run over a hook --adopt takes over did not happen');
});

// ---------------------------------------------------------------------------
// 0.19.0 took a hook under its own describe whatever the command was. Over a command that never names the gate file — a script of
// the user's that may run the gate — the installer cannot tell whether the gate runs: no run without --adopt takes it, and --adopt
// takes it over, saying so. Without that describe the same hook is nobody's business.
// ---------------------------------------------------------------------------

test('a hook under the installer\'s own describe whose command never names the gate file is refused with no flag and taken over, loudly, by --adopt', async () => {
  let runs = 0;
  for (const kind of ['progress', 'release']) {
    const { event, matcher, label, describe, nothingInstalled } = INSTALLERS[kind];
    const tookOver = `Took over 1 hook this installer could not fully read: ${label}.`;
    for (const command of ['"$HOME/bin/gate-wrapper" --strict', 'someone-elses-hook']) {
      const run = (flags) => `${kind} ${flags.join(' ') || 'bare'} over ${JSON.stringify(command)} under its own describe`;
      for (const flags of [['--remove'], []]) {
        const { home, file, text } = await settingsWith(kind, command, { describe });
        const result = await runInstaller(kind, [...flags, '--settings', file], home);
        const output = `${result.stdout}${result.stderr}`;
        assert.equal(result.status, 1, `${run(flags)}: ${output}`);
        assert.equal(await readFile(file, 'utf8'), text, `${run(flags)}: changed the file`);
        assert.ok(namedLine(output, label, /own describe, but its command never names the gate file/), `${run(flags)}: did not name the hook, with why\n${output}`);
        assert.match(output, flags.length > 0 ? /again with --remove --adopt/ : /again with --adopt/, run(flags));
        assert.doesNotMatch(output, nothingInstalled, run(flags));
        runs += 1;
      }
      {
        const { home, file } = await settingsWith(kind, command, { describe });
        const removed = await runInstaller(kind, ['--remove', '--adopt', '--settings', file], home);
        assert.equal(removed.status, 0, `${run(['--remove', '--adopt'])}: ${removed.stderr}`);
        assert.ok(removed.stdout.split('\n').includes(tookOver), `${run(['--remove', '--adopt'])}: did not print "${tookOver}"\n${removed.stdout}`);
        assert.deepEqual(await readJson(file), {});
        runs += 1;
      }
      {
        const { home, file } = await settingsWith(kind, command, { describe });
        const installed = await runInstaller(kind, ['--adopt', '--settings', file], home);
        assert.equal(installed.status, 0, `${run(['--adopt'])}: ${installed.stderr}`);
        assert.ok(installed.stdout.split('\n').includes(tookOver), `${run(['--adopt'])}: did not print "${tookOver}"\n${installed.stdout}`);
        const left = (await readJson(file)).hooks[event].filter((group) => group.matcher === matcher).flatMap((group) => group.hooks);
        assert.ok(left.every((entry) => entry.command !== command), `${run(['--adopt'])}: left the hook`);
        runs += 1;
      }
      // Without the describe, the same command is not the gate's, and nothing mentions it.
      {
        const { home, file, text } = await settingsWith(kind, command);
        const removed = await runInstaller(kind, ['--remove', '--adopt', '--settings', file], home);
        assert.equal(removed.status, 0, removed.stderr);
        assert.match(removed.stdout, nothingInstalled);
        assert.equal(await readFile(file, 'utf8'), text);
        runs += 1;
      }
    }
  }
  assert.equal(runs, 2 * 2 * 5, 'a run over a hook under the installer\'s own describe did not happen');
});

// ---------------------------------------------------------------------------
// Honest --remove (point 4). It exits 1 while a hook that runs the gate, or may, is left behind, and whenever any hook in the file
// still names the gate file it never says no gate was installed: it names each hook it left, and why.
// ---------------------------------------------------------------------------

test('--remove names every hook it leaves that names the gate file, with why, and exits 1 only while one of them runs the gate, or may', async () => {
  const cases = {
    progress: {
      own: `AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 ${q(NODE)} ${q(PACKED_PROGRESS)}`,
      left: [
        [`AGENT_SKILLS_PROGRESS_GATE=block cat ${q(PACKED_PROGRESS)}`, LEFT_ALONE_WHY.mention],
        [`cp ${q(PACKED_PROGRESS)} ./copy.mjs && node ./copy.mjs`, LEFT_ALONE_WHY.mention],
        [`timeout 5 >${q(PACKED_PROGRESS)} node -e 0`, LEFT_ALONE_WHY['write target']],
        ["node '/pack/adapters/claude-code/install-report-progress-gate.mjs' --remove", LEFT_ALONE_WHY['different file']],
      ],
      running: [
        [{ command: `timeout 5 node ${q(PACKED_PROGRESS)}`, describe: 'another-tool: checks every turn.' }, /under a describe this installer did not write/],
        [{ command: `nice -10 node ${q(PACKED_PROGRESS)} 2>${q(PACKED_PROGRESS)}` }, /also writes to the gate file/],
        [{ command: `nice -10 node ${q(PACKED_PROGRESS)}` }, /cannot tell whether the gate runs/],
      ],
    },
    release: {
      own: `AGENT_SKILLS_RELEASE_NOTES_GATE=block bash ${q(PACKED_RELEASE)}`,
      left: [
        [`cp ${q(PACKED_RELEASE)} ./copy.sh && bash ./copy.sh`, LEFT_ALONE_WHY.mention],
        [`AGENT_SKILLS_RELEASE_NOTES_GATE=block xxd ${q(PACKED_RELEASE)}`, LEFT_ALONE_WHY.mention],
        [`echo armed >${q(PACKED_RELEASE)}`, LEFT_ALONE_WHY['write target']],
        [`bash '/pack/adapters/claude-code/release-notes-gate.sh.orig'`, LEFT_ALONE_WHY['different file']],
      ],
      running: [
        [{ command: `timeout 5 bash ${q(PACKED_RELEASE)}`, describe: 'another-tool: checks every tool call.' }, /under a describe this installer did not write/],
        [{ command: `bash ${q(PACKED_RELEASE)} 2>${q(PACKED_RELEASE)}` }, /also writes to the gate file/],
        [{ command: `sudo -i bash ${q(PACKED_RELEASE)}` }, /cannot tell whether the gate runs/],
      ],
    },
  };
  let runs = 0;
  for (const [kind, { own, left, running }] of Object.entries(cases)) {
    const { event, matcher, label, nothingInstalled } = INSTALLERS[kind];
    const settingsOf = (hooks) => ({ model: 'opus', hooks: { [event]: [{ matcher, hooks: [{ type: 'command', command: 'someone-elses-hook' }, ...hooks] }] } });
    const leftHooks = left.map(([command]) => ({ type: 'command', command }));

    // Only hooks it leaves alone, with and without its own hook beside them: exit 0, each named, never "no gate was installed".
    for (const withOwn of [false, true]) {
      for (const flags of [['--remove'], ['--remove', '--adopt']]) {
        const home = await scratch(`ownership-honest-${kind}`);
        const file = path.join(home, 'settings.json');
        await writeFile(file, JSON.stringify(settingsOf([...(withOwn ? [{ type: 'command', command: own }] : []), ...leftHooks]), null, 2));
        const result = await runInstaller(kind, [...flags, '--settings', file], home);
        const output = `${result.stdout}${result.stderr}`;
        const run = `${kind} ${flags.join(' ')} over hooks it leaves alone${withOwn ? ', beside its own' : ''}`;
        assert.equal(result.status, 0, `${run}: ${output}`);
        assert.doesNotMatch(output, nothingInstalled, `${run}: said no gate was installed while hooks name the gate file`);
        assert.doesNotMatch(output, /No (turn will be held|release will be refused) again/, `${run}: said the gate is gone for good while hooks name the gate file`);
        for (const [command, why] of left) assert.ok(namedLine(output, label, why), `${run}: did not name ${JSON.stringify(command)} with why\n${output}`);
        assert.equal(output.split('\n').filter((line) => line.startsWith(`  - ${label}: left alone: `)).length, left.length, `${run}: named a different number of hooks than it left alone\n${output}`);
        assert.deepEqual((await readJson(file)).hooks[event][0].hooks, [{ type: 'command', command: 'someone-elses-hook' }, ...leftHooks], `${run}: took a hook it leaves alone`);
        if (withOwn) assert.match(result.stdout, new RegExp(`Removed 1 ${kind === 'progress' ? 'report-progress' : 'release-notes'} gate hook from`));
        runs += 1;
      }
    }

    // Each hook that runs the gate, or may, and that --remove leaves: exit 1, named with why, and the hooks left alone named too.
    for (const [hook, why] of running) {
      for (const flags of [['--remove'], ['--remove', '--adopt']]) {
        if (flags.includes('--adopt') && /cannot tell whether/.test(why.source)) continue;
        const home = await scratch(`ownership-honest-running-${kind}`);
        const file = path.join(home, 'settings.json');
        await writeFile(file, JSON.stringify(settingsOf([{ type: 'command', command: own }, { type: 'command', ...hook }, ...leftHooks]), null, 2));
        const result = await runInstaller(kind, [...flags, '--settings', file], home);
        const output = `${result.stdout}${result.stderr}`;
        const run = `${kind} ${flags.join(' ')} leaving ${JSON.stringify(hook.command)}`;
        assert.equal(result.status, 1, `${run}: a --remove that left a hook that runs the gate, or may, exited ${result.status}`);
        assert.match(output, /the gate is not gone/i, run);
        assert.doesNotMatch(output, nothingInstalled, run);
        assert.ok(namedLine(output, label, why), `${run}: did not name the hook it left, with why\n${output}`);
        for (const [command, leftWhy] of left) assert.ok(namedLine(output, label, leftWhy), `${run}: did not name ${JSON.stringify(command)} with why\n${output}`);
        runs += 1;
      }
    }
  }
  assert.equal(runs, 2 * (2 * 2 + 5), 'a --remove over hooks it leaves did not happen');

  // A file with no hook that names the gate file still says so, as before.
  for (const kind of ['progress', 'release']) {
    const { home, file } = await settingsWith(kind, 'someone-elses-hook');
    const removed = await runInstaller(kind, ['--remove', '--settings', file], home);
    assert.equal(removed.status, 0, removed.stderr);
    assert.match(removed.stdout, INSTALLERS[kind].nothingInstalled);
    assert.doesNotMatch(removed.stdout, /left alone/);
  }
});

// ---------------------------------------------------------------------------
// 0.19.0's release-notes installer looked only under PreToolUse, so a release hook under any other event was installed beside, and
// its --remove said no gate was installed. This installer reads every event: its own shape is its own there too, a hook it cannot
// fully read is refused with no flag and taken over by --adopt, and --remove names what it leaves.
// ---------------------------------------------------------------------------

test('a release-notes gate hook under another event is read by the same rule as one under PreToolUse', async () => {
  const own = `AGENT_SKILLS_RELEASE_NOTES_GATE=block bash ${q(PACKED_RELEASE)}`;
  const unclear = `sudo -i bash ${q(PACKED_RELEASE)}`;
  const file = async () => {
    const home = await scratch('ownership-release-events');
    const settings = path.join(home, 'settings.json');
    const text = JSON.stringify({ hooks: {
      PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: unclear }] }],
      Stop: [{ matcher: '*', hooks: [{ type: 'command', command: own, timeout: 10 }] }],
    } }, null, 2);
    await writeFile(settings, text);
    return { home, settings, text };
  };

  const bare = await file();
  const refused = await runInstaller('release', ['--mode', 'block', '--settings', bare.settings], bare.home);
  assert.equal(refused.status, 1, refused.stderr);
  assert.match(refused.stderr, /PostToolUse \(matcher Bash\): names this gate's file where this installer cannot tell whether the gate runs/);
  assert.equal(await readFile(bare.settings, 'utf8'), bare.text);

  const removeBare = await file();
  const removed = await runInstaller('release', ['--remove', '--settings', removeBare.settings], removeBare.home);
  assert.equal(removed.status, 1, removed.stdout);
  assert.match(removed.stdout, /Removed 1 release-notes gate hook from/);
  assert.match(removed.stderr, /PostToolUse \(matcher Bash\)/);
  assert.match(removed.stderr, /again with --remove --adopt/);

  const adopted = await file();
  const installed = await runInstaller('release', ['--mode', 'block', '--adopt', '--settings', adopted.settings], adopted.home);
  assert.equal(installed.status, 0, installed.stderr);
  assert.ok(installed.stdout.split('\n').includes('Took over 1 hook this installer could not fully read: PostToolUse (matcher Bash).'), installed.stdout);
  const written = await readJson(adopted.settings);
  assert.deepEqual(Object.keys(written.hooks), ['PreToolUse'], 'a release-notes gate hook under another event survived an --adopt install');
  assert.equal(written.hooks.PreToolUse[0].hooks.length, 1);

  const removeAdopt = await file();
  const gone = await runInstaller('release', ['--remove', '--adopt', '--settings', removeAdopt.settings], removeAdopt.home);
  assert.equal(gone.status, 0, gone.stderr);
  assert.deepEqual(await readJson(removeAdopt.settings), {});
});

// ---------------------------------------------------------------------------
// A command that writes to the gate file. Read as running the gate, `bash '<gate>' 2>'<gate>'` — which empties the gate before
// bash opens it — was taken with no flag under the installer's own describe, and by --adopt without one. It is a write target:
// no flag takes it, and because whether the gate runs cannot be told, --remove names it and exits 1 and an install refuses.
// ---------------------------------------------------------------------------

const WRITES_GATE = Object.freeze({
  progress: [
    `AGENT_SKILLS_PROGRESS_GATE=block ${q(NODE)} ${q(PACKED_PROGRESS)} >${q(PACKED_PROGRESS)}`,
    `AGENT_SKILLS_PROGRESS_GATE=block timeout 5 ${q(NODE)} ${q(PACKED_PROGRESS)} >>${q(PACKED_PROGRESS)}`,
  ],
  release: [
    `AGENT_SKILLS_RELEASE_NOTES_GATE=block bash ${q(PACKED_RELEASE)} 2>${q(PACKED_RELEASE)}`,
    `AGENT_SKILLS_RELEASE_NOTES_GATE=block bash ${q(PACKED_RELEASE)}; : >${q(PACKED_RELEASE)}`,
    `AGENT_SKILLS_RELEASE_NOTES_GATE=block nice -10 echo ${q(PACKED_RELEASE)} $(: >${q(PACKED_RELEASE)})`,
  ],
});

test('a hook that writes to the gate file is never taken, with any flag or describe: --remove names it and exits 1, and an install refuses', async () => {
  let runs = 0;
  for (const [kind, commands] of Object.entries(WRITES_GATE)) {
    const { event, label, nothingInstalled } = INSTALLERS[kind];
    for (const command of commands) {
      for (const described of [false, true]) {
        for (const flags of [['--remove'], ['--remove', '--adopt'], [], ['--adopt']]) {
          const { home, file, text } = await settingsWith(kind, command);
          let start = text;
          if (described) {
            const parsed = JSON.parse(text);
            parsed.hooks[event][0].hooks[0].describe = OWN_DESCRIBES[kind];
            start = JSON.stringify(parsed, null, 2);
            await writeFile(file, start);
          }
          const run = `${kind} ${flags.join(' ') || 'bare'} over ${JSON.stringify(command)}${described ? ' under its own describe' : ''}`;
          const result = await runInstaller(kind, [...flags, '--settings', file], home);
          const output = `${result.stdout}${result.stderr}`;
          assert.equal(result.status, 1, `${run}: took a hook that writes to the gate file\n${output}`);
          assert.equal(await readFile(file, 'utf8'), start, `${run}: changed the file`);
          assert.ok(output.includes(label), `${run}: did not name the hook`);
          assert.match(output, /cannot tell whether/, run);
          assert.match(output, /--adopt never takes a hook that writes to the gate file/, `${run}: did not say why --adopt does not take it`);
          assert.doesNotMatch(output, /Took over|Adopted [1-9]|again with --adopt|again with --remove --adopt/, `${run}: took it, or advised a flag that would not take it`);
          assert.doesNotMatch(output, nothingInstalled, run);
          runs += 1;
        }
      }
    }
  }
  assert.equal(runs, Object.values(WRITES_GATE).flat().length * 2 * 4, 'a run over a hook that writes to the gate did not happen');
});
