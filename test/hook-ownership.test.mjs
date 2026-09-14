import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyHook, leadingAssignments, shellCommands } from '../adapters/claude-code/hook-ownership.mjs';
import * as progressInstaller from '../adapters/claude-code/install-report-progress-gate.mjs';
import * as releaseInstaller from '../adapters/claude-code/install-release-notes-gate.mjs';

// ---------------------------------------------------------------------------
// Which hooks an installer may call its own, read from the command.
//
// Claude Code rewrites a settings file on ordinary actions — adding a marketplace, granting a
// permission, a /config toggle — and every rewrite observed kept each hook's `command`, `matcher`
// and `timeout` byte for byte while dropping its `describe` (adapters/HOOK-OUTPUT-NOTES.md, third and
// fourth addenda of 2026-09-14). So `describe` cannot be how an installer recognises what it wrote,
// and the command is the one field left to recognise it by.
//
// Because the command is kept byte for byte, the rule can be exact: a hook is an installer's own only
// when its whole command is a shape a released version of that installer wrote. Everything else is
// sorted by whether it RUNS the gate — `adoptable` — or only names it — nobody's — or cannot be told —
// `unclear`, which no flag takes.
// ---------------------------------------------------------------------------

const PROGRESS = Object.freeze({
  envFlag: 'AGENT_SKILLS_PROGRESS_GATE',
  gateFile: 'report-progress-gate.mjs',
  describePrefix: 'agent-skills report-progress gate',
  variables: Object.freeze([
    'AGENT_SKILLS_PROGRESS_GATE',
    'AGENT_SKILLS_PROGRESS_GATE_COVERAGE',
    'AGENT_SKILLS_PROGRESS_GATE_TURN_HOOK',
    'AGENT_SKILLS_PROGRESS_GATE_SKILLS',
  ]),
  interpreter: Object.freeze({ quotedPathTo: 'node' }),
});
const RELEASE = Object.freeze({
  envFlag: 'AGENT_SKILLS_RELEASE_NOTES_GATE',
  gateFile: 'release-notes-gate.sh',
  describePrefix: 'agent-skills release-notes gate',
  variables: Object.freeze(['AGENT_SKILLS_RELEASE_NOTES_GATE']),
  interpreter: Object.freeze({ word: 'bash' }),
});

const hook = (command, extra = {}) => ({ type: 'command', command, ...extra });
/** How both installers quote a word into a command. */
const q = (value) => `'${String(value).split("'").join(`'\\''`)}'`;

/** The two commands the installers write, in the exact shape the harness was observed to keep. */
const PROGRESS_COMMAND = "AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 '/usr/local/bin/node' '/pack/adapters/claude-code/report-progress-gate.mjs'";
const RELEASE_COMMAND = "AGENT_SKILLS_RELEASE_NOTES_GATE=block bash '/pack/adapters/claude-code/release-notes-gate.sh'";

test('each installer hands the ownership rule its own identity, and these tests use that identity', () => {
  assert.deepEqual(progressInstaller.HOOK_IDENTITY, PROGRESS);
  assert.deepEqual(releaseInstaller.HOOK_IDENTITY, RELEASE);
});

test('the command each installer writes is its own, with or without the describe the harness drops', () => {
  assert.equal(classifyHook(hook(PROGRESS_COMMAND), PROGRESS), 'ours');
  assert.equal(classifyHook(hook(PROGRESS_COMMAND, { timeout: 10 }), PROGRESS), 'ours');
  assert.equal(classifyHook(hook(PROGRESS_COMMAND, { describe: `${PROGRESS.describePrefix} (block): …` }), PROGRESS), 'ours');
  assert.equal(classifyHook(hook(RELEASE_COMMAND), RELEASE), 'ours');
  assert.equal(classifyHook(hook(RELEASE_COMMAND, { timeout: 10 }), RELEASE), 'ours');

  // Each shape belongs to one installer: neither takes the other's gate.
  assert.equal(classifyHook(hook(RELEASE_COMMAND), PROGRESS), null);
  assert.equal(classifyHook(hook(PROGRESS_COMMAND), RELEASE), null);
});

test('every shape a released version of either installer wrote is its own, and so is what this version writes', () => {
  // From `git log -p` on both installers across every tag. `<node>` is process.execPath, single-quoted.
  const node = "/opt/my node's/bin/node";
  const gate = "/srv/it's a pack/adapters/claude-code/report-progress-gate.mjs";
  const program = `${q(node)} ${q(gate)}`;
  const turn = 'AGENT_SKILLS_PROGRESS_GATE_TURN_HOOK=UserPromptSubmit';
  const skills = `AGENT_SKILLS_PROGRESS_GATE_SKILLS=${q('codex,gpt-researcher')}`;
  for (const command of [
    // v0.13.0 through v0.16.1, and a user's disarmed copy.
    `AGENT_SKILLS_PROGRESS_GATE=block ${program}`,
    `AGENT_SKILLS_PROGRESS_GATE=observe ${program}`,
    `AGENT_SKILLS_PROGRESS_GATE=off ${program}`,
    // v0.17.0 and v0.18.0 wrote coverage 2 always; the skill hook adds the list.
    `AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 ${program}`,
    `AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 ${skills} ${program}`,
    // v0.19.0 wrote the level chosen.
    `AGENT_SKILLS_PROGRESS_GATE=observe AGENT_SKILLS_PROGRESS_GATE_COVERAGE=1 ${program}`,
    // This version declares the turn hook.
    `AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=1 ${turn} ${program}`,
    `AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 ${turn} ${skills} ${program}`,
    "AGENT_SKILLS_PROGRESS_GATE=off AGENT_SKILLS_PROGRESS_GATE_COVERAGE=1 '/bin/node' '/pack/report-progress-gate.mjs'",
  ]) {
    assert.equal(classifyHook(hook(command), PROGRESS), 'ours', command);
  }
  const entries = progressInstaller.buildHookEntries({ mode: 'block', gatePath: gate, nodePath: node, skills: ['codex'], coverage: 2 });
  for (const entry of Object.values(entries).filter(Boolean)) {
    assert.equal(classifyHook(hook(entry.command), PROGRESS), 'ours', entry.command);
  }
  for (const coverage of [1, 2]) {
    const { stop } = progressInstaller.buildHookEntries({ mode: 'observe', gatePath: gate, nodePath: node, coverage });
    assert.equal(classifyHook(hook(stop.command), PROGRESS), 'ours', stop.command);
  }

  // v0.16.0 through this version.
  for (const mode of ['block', 'observe', 'off']) {
    assert.equal(classifyHook(hook(`AGENT_SKILLS_RELEASE_NOTES_GATE=${mode} bash '/my pack/release-notes-gate.sh'`), RELEASE), 'ours', mode);
  }
  for (const mode of ['block', 'observe']) {
    const entry = releaseInstaller.buildHookEntry({ mode, gatePath: "/srv/it's a pack/release-notes-gate.sh" });
    assert.equal(classifyHook(hook(entry.command), RELEASE), 'ours', entry.command);
  }
});

test('only the exact shape is owned: anything before, around or after it makes a hook that runs the gate a hand-wiring', () => {
  for (const command of [
    // After it: a compound command, an argument, a redirection, a comment.
    `${PROGRESS_COMMAND} && rm -rf /tmp/x`,
    `${PROGRESS_COMMAND}; true`,
    `${PROGRESS_COMMAND} --verbose`,
    `${PROGRESS_COMMAND} > /dev/null`,
    `${PROGRESS_COMMAND} # disarm later`,
    // Before it: somebody else's variable, a repeated one, a wrapper.
    `NODE_OPTIONS=--no-warnings ${PROGRESS_COMMAND}`,
    `AGENT_SKILLS_PROGRESS_GATE=off ${PROGRESS_COMMAND}`,
    `env ${PROGRESS_COMMAND}`,
    // Around it: quoting no installer wrote, an expansion, an interpreter no installer wrote.
    'AGENT_SKILLS_PROGRESS_GATE="block" \'/bin/node\' \'/pack/report-progress-gate.mjs\'',
    "AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=${LEVEL:-2} '/bin/node' '/pack/report-progress-gate.mjs'",
    "AGENT_SKILLS_PROGRESS_GATE=block node '/pack/report-progress-gate.mjs'",
    "AGENT_SKILLS_PROGRESS_GATE=block '/usr/bin/nodejs' '/pack/report-progress-gate.mjs'",
    "AGENT_SKILLS_PROGRESS_GATE=block 'C:\\node\\node.exe' '/pack/report-progress-gate.mjs'",
    "AGENT_SKILLS_PROGRESS_GATE=block '/bin/node' /pack/report-progress-gate.mjs",
    // The gate's own variables without the arming one.
    "AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 '/bin/node' '/pack/report-progress-gate.mjs'",
  ]) {
    assert.equal(classifyHook(hook(command), PROGRESS), 'adoptable', command);
  }
  for (const command of [
    `${RELEASE_COMMAND} && rm -rf /tmp/x`,
    `${RELEASE_COMMAND} 2>/dev/null`,
    "AGENT_SKILLS_RELEASE_NOTES_GATE=block '/bin/bash' '/pack/release-notes-gate.sh'",
    "AGENT_SKILLS_RELEASE_NOTES_GATE=block 'bash' '/pack/release-notes-gate.sh'",
    "AGENT_SKILLS_RELEASE_NOTES_GATE=block sh '/pack/release-notes-gate.sh'",
    "AGENT_SKILLS_RELEASE_NOTES_GATE=block bash /pack/release-notes-gate.sh",
    // Another gate's variable is not this gate's.
    "AGENT_SKILLS_RELEASE_NOTES_GATE=block AGENT_SKILLS_PROGRESS_GATE=off bash '/pack/release-notes-gate.sh'",
  ]) {
    assert.equal(classifyHook(hook(command), RELEASE), 'adoptable', command);
  }
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

test('a gate path that is only an argument of echo, cat, grep, rm, cp, ls and the like is a mention, whatever leads the command', () => {
  // Each of these was taken by a bare --remove or install once the gate's assignment led it, where
  // 0.19.0 left it alone. None runs the gate, so none is anybody's gate hook.
  for (const command of [
    'AGENT_SKILLS_PROGRESS_GATE=block echo /pack/report-progress-gate.mjs',
    'AGENT_SKILLS_PROGRESS_GATE=block cat /pack/report-progress-gate.mjs',
    'AGENT_SKILLS_PROGRESS_GATE=off rm -f /tmp/report-progress-gate.mjs',
    'AGENT_SKILLS_PROGRESS_GATE=block grep -c decision /pack/report-progress-gate.mjs',
    'AGENT_SKILLS_PROGRESS_GATE=block cp /pack/report-progress-gate.mjs /tmp/copy.mjs',
    'AGENT_SKILLS_PROGRESS_GATE=block ls -l /pack/report-progress-gate.mjs',
    'AGENT_SKILLS_PROGRESS_GATE=block printf %s /pack/report-progress-gate.mjs',
    'echo /pack/report-progress-gate.mjs',
    'test -f /pack/report-progress-gate.mjs',
    '[ -x /pack/report-progress-gate.mjs ]',
    // A redirection target is written to or read from, never run by the command it redirects.
    'AGENT_SKILLS_PROGRESS_GATE=block echo armed &> /pack/report-progress-gate.mjs',
    'echo armed >| /pack/report-progress-gate.mjs',
    'echo armed 2>&1 > /pack/report-progress-gate.mjs',
    // A nested shell that only mentions it.
    "bash -c 'echo /pack/report-progress-gate.mjs'",
  ]) {
    assert.equal(classifyHook(hook(command), PROGRESS), null, command);
  }
  for (const command of [
    'AGENT_SKILLS_RELEASE_NOTES_GATE=block echo /pack/release-notes-gate.sh',
    'AGENT_SKILLS_RELEASE_NOTES_GATE=block shellcheck /pack/release-notes-gate.sh',
    'AGENT_SKILLS_RELEASE_NOTES_GATE=block cat /pack/release-notes-gate.sh',
  ]) {
    assert.equal(classifyHook(hook(command), RELEASE), null, command);
  }
});

test('where the command cannot say whether the gate runs, the hook is unclear: never its own, never adoptable', () => {
  for (const command of [
    // An argument of a program this reader does not know.
    'AGENT_SKILLS_PROGRESS_GATE=block /usr/local/bin/hook-wrapper --gate=/pack/report-progress-gate.mjs',
    'AGENT_SKILLS_PROGRESS_GATE=block hook-wrapper --gate=report-progress-gate.mjs',
    'timeout 5 node /pack/report-progress-gate.mjs',
    'xargs node < /pack/report-progress-gate.mjs.list /pack/report-progress-gate.mjs',
    'eval "node /pack/report-progress-gate.mjs"',
    // After an interpreter's options, which may or may not run it.
    'node --check /pack/report-progress-gate.mjs',
    'node -r /pack/report-progress-gate.mjs other.mjs',
    'node other.mjs /pack/report-progress-gate.mjs',
    // Out through a pipe, into a substitution, a variable, a here-document or a function body.
    'cat /pack/report-progress-gate.mjs | node --input-type=module',
    'echo /pack/report-progress-gate.mjs | xargs node',
    'node $(echo /pack/report-progress-gate.mjs)',
    'node "$(echo /pack/report-progress-gate.mjs)"',
    'node `echo /pack/report-progress-gate.mjs`',
    'GATE=/pack/report-progress-gate.mjs; node "$GATE"',
    // An array holds words, not commands — and here it holds the gate for later.
    'files=(/pack/report-progress-gate.mjs) true',
    // `exec` runs its first word as the program: one that looks like an assignment is not skipped.
    "exec AGENT_SKILLS_PROGRESS_GATE=block node '/pack/report-progress-gate.mjs'",
    "node <<'EOF'\nimport('/pack/report-progress-gate.mjs')\nEOF",
    'gate() { node /pack/report-progress-gate.mjs; }',
    'node <(cat /pack/report-progress-gate.mjs)',
  ]) {
    assert.equal(classifyHook(hook(command), PROGRESS), 'unclear', command);
  }
  for (const command of [
    'sudo bash /pack/release-notes-gate.sh',
    'bash -n /pack/release-notes-gate.sh',
    "bash <<'EOF'\nbash /pack/release-notes-gate.sh\nEOF",
    'AGENT_SKILLS_RELEASE_NOTES_GATE=block /usr/local/bin/hook-wrapper /pack/release-notes-gate.sh',
  ]) {
    assert.equal(classifyHook(hook(command), RELEASE), 'unclear', command);
  }
  // A describe somebody else wrote still says whose it is.
  assert.equal(classifyHook(hook('timeout 5 node /pack/report-progress-gate.mjs', { describe: 'theirs' }), PROGRESS), 'foreign');
});

test('the gate runs as the program of a simple command, or as the script straight after an interpreter', () => {
  for (const command of [
    '/pack/report-progress-gate.mjs',
    './report-progress-gate.mjs --verbose',
    "node '/pack/report-progress-gate.mjs'",
    "exec node '/pack/report-progress-gate.mjs'",
    "nohup node '/pack/report-progress-gate.mjs'",
    "command node '/pack/report-progress-gate.mjs'",
    "env AGENT_SKILLS_PROGRESS_GATE=block node '/pack/report-progress-gate.mjs'",
    "cd / && AGENT_SKILLS_PROGRESS_GATE=block node '/pack/report-progress-gate.mjs'",
    "export AGENT_SKILLS_PROGRESS_GATE=block; node '/pack/report-progress-gate.mjs'",
    "AGENT_SKILLS_PROGRESS_GATE=$MODE node '/pack/report-progress-gate.mjs'",
    "AGENT_SKILLS_PROGRESS_GATE=block true; node '/pack/report-progress-gate.mjs'",
    "if true; then node /pack/report-progress-gate.mjs; fi",
    "{ node /pack/report-progress-gate.mjs; }",
    '(node /pack/report-progress-gate.mjs)',
    "bun /pack/report-progress-gate.mjs",
    // Its output piped on does not make it any less run.
    'node /pack/report-progress-gate.mjs | cat',
    // Run inside a substitution or a nested shell.
    'echo "$(node /pack/report-progress-gate.mjs)"',
    "bash -c 'node /pack/report-progress-gate.mjs --verbose'",
    "sh -ec \"node '/pack/report-progress-gate.mjs'\"",
    // The assignment arms a file whose name merely CONTAINS the gate's, and the gate runs in the next
    // command without it.
    "AGENT_SKILLS_PROGRESS_GATE=block node '/pack/report-progress-gate.mjs.bak' && node '/pack/report-progress-gate.mjs'",
    "AGENT_SKILLS_PROGRESS_GATE=block node '/pack/install-report-progress-gate.mjs'; node '/pack/report-progress-gate.mjs'",
  ]) {
    assert.equal(classifyHook(hook(command), PROGRESS), 'adoptable', command);
  }
  for (const command of [
    "bash '/elsewhere/release-notes-gate.sh'",
    'zsh /pack/release-notes-gate.sh',
    '. /pack/release-notes-gate.sh',
    'source /pack/release-notes-gate.sh',
    "AGENT_SKILLS_RELEASE_NOTES_GATE=block bash '/pack/my-release-notes-gate.sh' && bash '/pack/release-notes-gate.sh'",
  ]) {
    assert.equal(classifyHook(hook(command), RELEASE), 'adoptable', command);
  }
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
  assert.equal(classifyHook(hook('echo /pack/report-progress-gate.mjs', { describe: 'theirs' }), PROGRESS), null);

  // The command decides for a hook wearing this installer's describe too.
  const ownDescribe = { describe: `${PROGRESS.describePrefix} (block): …` };
  assert.equal(classifyHook(hook("node '/pack/report-progress-gate.mjs'", ownDescribe), PROGRESS), 'adoptable');
  assert.equal(classifyHook(hook('echo something else entirely', ownDescribe), PROGRESS), null);
  assert.equal(classifyHook(hook('AGENT_SKILLS_PROGRESS_GATE=block echo /pack/report-progress-gate.mjs', ownDescribe), PROGRESS), null);
});

test('anything that is not a hook with a string command belongs to nobody, and throws nothing', () => {
  for (const value of [null, undefined, 'x', 42, [], {}, { command: 5 }, { type: 'command' }, { command: ['a'] }]) {
    assert.equal(classifyHook(value, PROGRESS), null, JSON.stringify(value));
  }
  // Nor does an identity missing the shape it would need: nothing is owned, nothing thrown.
  assert.equal(classifyHook(hook(PROGRESS_COMMAND), { envFlag: PROGRESS.envFlag, gateFile: PROGRESS.gateFile, describePrefix: PROGRESS.describePrefix }), 'adoptable');
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
  // A substitution stays inside the word it is part of, and does not end the command.
  assert.deepEqual(shellCommands('node $(echo a; b) "x$(c)" `d e` | f'), [['node', '$(echo a; b)', 'x$(c)', '`d e`'], ['f']]);
  // `&>`, `>&`, `>|` and `2>&1` redirect; they do not end a command.
  assert.deepEqual(shellCommands('a &> b; c 2>&1 >| d'), [['a', 'b'], ['c', '2', '1', 'd']]);
  // A here-document's body is data, not commands.
  assert.deepEqual(shellCommands("cat <<'EOF'\nnot a command\nEOF\nnext"), [['cat', 'EOF'], ['next']]);
  assert.deepEqual(shellCommands('cat <<-END\n\tnot a command\n\tEND\nnext <<< here'), [['cat', 'END'], ['next', 'here']]);
  // An array assignment is one word.
  assert.deepEqual(shellCommands('a=(x y) b'), [['a=(x y)', 'b']]);
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
