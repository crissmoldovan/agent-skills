import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyHook, leadingAssignments, shellCommands } from '../adapters/claude-code/hook-ownership.mjs';

// ---------------------------------------------------------------------------
// Which hooks an installer may call its own, read from the command.
//
// Claude Code rewrites a settings file on ordinary actions — adding a marketplace, granting a
// permission, a /config toggle — and every rewrite observed kept each hook's `command`, `matcher`
// and `timeout` byte for byte while dropping its `describe` (adapters/HOOK-OUTPUT-NOTES.md, third and
// fourth addenda of 2026-09-14). So `describe` cannot be how an installer recognises what it wrote,
// and the command is the one field left to recognise it by.
// ---------------------------------------------------------------------------

const PROGRESS = Object.freeze({
  envFlag: 'AGENT_SKILLS_PROGRESS_GATE',
  gateFile: 'report-progress-gate.mjs',
  describePrefix: 'agent-skills report-progress gate',
});
const RELEASE = Object.freeze({
  envFlag: 'AGENT_SKILLS_RELEASE_NOTES_GATE',
  gateFile: 'release-notes-gate.sh',
  describePrefix: 'agent-skills release-notes gate',
});

const hook = (command, extra = {}) => ({ type: 'command', command, ...extra });

/** The two commands the installers write, in the exact shape the harness was observed to keep. */
const PROGRESS_COMMAND = "AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 '/usr/local/bin/node' '/pack/adapters/claude-code/report-progress-gate.mjs'";
const RELEASE_COMMAND = "AGENT_SKILLS_RELEASE_NOTES_GATE=block bash '/pack/adapters/claude-code/release-notes-gate.sh'";

test('the command each installer writes is its own, with or without the describe the harness drops', () => {
  assert.equal(classifyHook(hook(PROGRESS_COMMAND), PROGRESS), 'ours');
  assert.equal(classifyHook(hook(PROGRESS_COMMAND, { timeout: 10 }), PROGRESS), 'ours');
  assert.equal(classifyHook(hook(PROGRESS_COMMAND, { describe: `${PROGRESS.describePrefix} (block): …` }), PROGRESS), 'ours');
  assert.equal(classifyHook(hook(RELEASE_COMMAND), RELEASE), 'ours');
  assert.equal(classifyHook(hook(RELEASE_COMMAND, { timeout: 10 }), RELEASE), 'ours');

  // Each fingerprint belongs to one installer: neither takes the other's gate.
  assert.equal(classifyHook(hook(RELEASE_COMMAND), PROGRESS), null);
  assert.equal(classifyHook(hook(PROGRESS_COMMAND), RELEASE), null);
});

test('the fingerprint survives what a user legitimately does to the command', () => {
  for (const command of [
    // Disarmed without uninstalling, which the installers' own output tells a user to do.
    "AGENT_SKILLS_PROGRESS_GATE=off AGENT_SKILLS_PROGRESS_GATE_COVERAGE=1 '/bin/node' '/pack/report-progress-gate.mjs'",
    // Paths with spaces, quoted as the installer quotes them.
    "AGENT_SKILLS_PROGRESS_GATE=block '/opt/my node/bin/node' '/home/me/my pack/adapters/claude-code/report-progress-gate.mjs'",
    // Double quotes, and a level set from an expansion — the level is read elsewhere; the owner is not in doubt.
    'AGENT_SKILLS_PROGRESS_GATE="block" node "/pack/report-progress-gate.mjs"',
    "AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=${LEVEL:-2} node '/pack/report-progress-gate.mjs'",
    // A v0.16.1 command, which named no level.
    "AGENT_SKILLS_PROGRESS_GATE=block '/bin/node' '/pack/adapters/claude-code/report-progress-gate.mjs'",
  ]) {
    assert.equal(classifyHook(hook(command), PROGRESS), 'ours', command);
  }
  assert.equal(classifyHook(hook("AGENT_SKILLS_RELEASE_NOTES_GATE=off bash '/my pack/release-notes-gate.sh'"), RELEASE), 'ours');
});

test('the basename must be exactly the gate file: a command that merely contains its name does not run it', () => {
  // The substring check this replaces took every one of these, and `--adopt` would have removed them.
  for (const command of [
    "AGENT_SKILLS_PROGRESS_GATE=block node '/pack/adapters/claude-code/install-report-progress-gate.mjs' --remove",
    "AGENT_SKILLS_PROGRESS_GATE=block node '/pack/report-progress-gate.mjs.bak'",
    "AGENT_SKILLS_PROGRESS_GATE=block node '/pack/my-report-progress-gate.mjs'",
    "AGENT_SKILLS_PROGRESS_GATE=block node '/pack/report-progress-gate.mjs/other.mjs'",
    'echo report-progress-gate.mjs-is-not-installed',
    // A comment runs nothing.
    'true # node /pack/report-progress-gate.mjs',
  ]) {
    assert.equal(classifyHook(hook(command), PROGRESS), null, command);
  }
  for (const command of [
    "AGENT_SKILLS_RELEASE_NOTES_GATE=block bash '/pack/release-notes-gate.sh.orig'",
    "AGENT_SKILLS_RELEASE_NOTES_GATE=block bash '/pack/my-release-notes-gate.sh'",
    "AGENT_SKILLS_RELEASE_NOTES_GATE=block node '/pack/install-release-notes-gate.mjs'",
  ]) {
    assert.equal(classifyHook(hook(command), RELEASE), null, command);
  }
});

test('a hook that runs the gate without the assignment leading its command is a hand-wiring, never ours', () => {
  for (const command of [
    "node '/pack/report-progress-gate.mjs'",
    "env AGENT_SKILLS_PROGRESS_GATE=block node '/pack/report-progress-gate.mjs'",
    "cd / && AGENT_SKILLS_PROGRESS_GATE=block node '/pack/report-progress-gate.mjs'",
    "export AGENT_SKILLS_PROGRESS_GATE=block; node '/pack/report-progress-gate.mjs'",
    // Another of the gate's variables is not the gate's own assignment.
    "AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 node '/pack/report-progress-gate.mjs'",
    // An expansion is not a literal assignment.
    "AGENT_SKILLS_PROGRESS_GATE=$MODE node '/pack/report-progress-gate.mjs'",
    // The assignment applies to `true`, and the gate runs in the next command.
    "AGENT_SKILLS_PROGRESS_GATE=block true; node '/pack/report-progress-gate.mjs'",
    // A nested shell still runs the gate.
    "bash -c 'node /pack/report-progress-gate.mjs --verbose'",
  ]) {
    assert.equal(classifyHook(hook(command), PROGRESS), 'adoptable', command);
  }
  assert.equal(classifyHook(hook("bash '/elsewhere/release-notes-gate.sh'"), RELEASE), 'adoptable');
});

test('a describe somebody else wrote vetoes ownership; the installer\'s own describe does not grant it', () => {
  assert.equal(classifyHook(hook(PROGRESS_COMMAND, { describe: 'written by some other tool' }), PROGRESS), 'foreign');
  // A describe somebody typed, even an empty one, is not the absence of one.
  assert.equal(classifyHook(hook(PROGRESS_COMMAND, { describe: '' }), PROGRESS), 'foreign');
  assert.equal(classifyHook(hook(PROGRESS_COMMAND, { describe: 5 }), PROGRESS), 'foreign');
  assert.equal(classifyHook(hook("node '/pack/report-progress-gate.mjs'", { describe: 'theirs' }), PROGRESS), 'foreign');
  assert.equal(classifyHook(hook(RELEASE_COMMAND, { describe: 'theirs' }), RELEASE), 'foreign');
  // …and a hook that does not run the gate is nobody's business, whatever its describe says.
  assert.equal(classifyHook(hook('someone-elses-hook', { describe: 'theirs' }), PROGRESS), null);

  // The fingerprint decides for a hook wearing this installer's describe too.
  const ownDescribe = { describe: `${PROGRESS.describePrefix} (block): …` };
  assert.equal(classifyHook(hook("node '/pack/report-progress-gate.mjs'", ownDescribe), PROGRESS), 'adoptable');
  assert.equal(classifyHook(hook('echo something else entirely', ownDescribe), PROGRESS), null);
});

test('anything that is not a hook with a string command belongs to nobody, and throws nothing', () => {
  for (const value of [null, undefined, 'x', 42, [], {}, { command: 5 }, { type: 'command' }, { command: ['a'] }]) {
    assert.equal(classifyHook(value, PROGRESS), null, JSON.stringify(value));
  }
});

test('commands are split into words the way sh splits them', () => {
  assert.deepEqual(
    shellCommands('A=1 \'b c\' "d\\"e" f\\ g; h | i && j # k l\nm'),
    [['A=1', 'b c', 'd"e', 'f g'], ['h'], ['i'], ['j'], ['m']],
  );
  assert.deepEqual(shellCommands('a\\\nb'), [['ab']], 'a backslash-newline is a line continuation');
  assert.deepEqual(shellCommands("echo 'unbalanced"), [['echo', 'unbalanced']]);
  assert.deepEqual(shellCommands('a#b "#" \'#\''), [['a#b', '#', '#']], 'a # inside a word or quotes is not a comment');
  assert.deepEqual(shellCommands('node gate.mjs > /tmp/out'), [['node', 'gate.mjs', '/tmp/out']]);
  assert.deepEqual(shellCommands(''), []);
  assert.deepEqual(shellCommands('   ;; &&  '), []);
});

test('leading assignments are read only where the shell reads them literally', () => {
  assert.deepEqual(leadingAssignments(PROGRESS_COMMAND).map((entry) => entry.name), ['AGENT_SKILLS_PROGRESS_GATE', 'AGENT_SKILLS_PROGRESS_GATE_COVERAGE']);
  assert.deepEqual(leadingAssignments('A="x y" B=\'z\' C=w\\ v cmd'), [
    { name: 'A', value: 'x y' },
    { name: 'B', value: 'z' },
    { name: 'C', value: 'w v' },
  ]);
  assert.deepEqual(leadingAssignments('A=$HOME cmd'), [], 'an expansion ends the scan');
  assert.deepEqual(leadingAssignments('env A=1 cmd'), []);
  assert.deepEqual(leadingAssignments('A=1'), [{ name: 'A', value: '1' }]);
});
