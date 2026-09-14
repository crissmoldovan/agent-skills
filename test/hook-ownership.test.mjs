import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import * as ownership from '../adapters/claude-code/hook-ownership.mjs';
import * as progressInstaller from '../adapters/claude-code/install-report-progress-gate.mjs';
import * as releaseInstaller from '../adapters/claude-code/install-release-notes-gate.mjs';

const { classifyHook, leadingAssignments, shellCommands } = ownership;

// ---------------------------------------------------------------------------
// Which hooks an installer may call its own, read from the command.
//
// Claude Code rewrites a settings file on ordinary actions — adding a marketplace, granting a
// permission, a /config toggle — and every rewrite observed kept each hook's `command`, `matcher`
// and `timeout` byte for byte while dropping its `describe` (adapters/HOOK-OUTPUT-NOTES.md, third and
// fourth addenda of 2026-09-14). So `describe` cannot be how an installer recognises what it wrote,
// and the command is the one field left to recognise it by.
//
// Because the command is kept byte for byte, the rule can be exact. A command in an installer's EXACT
// SHAPE — its own assignments, one interpreter word, the single-quoted gate, nothing else — is never
// unclear: it is the installer's own when the interpreter is one that installer writes, nobody's when
// the "interpreter" only reads files, and adoptable otherwise. Any other command is sorted by whether it
// RUNS the gate — `adoptable` — or only names it — nobody's — or cannot be told — `unclear`, which no flag
// takes. The installer's own describe, where the harness has not dropped it, makes a hook that runs the
// gate its own, as 0.19.0's did.
// ---------------------------------------------------------------------------

/** What each installer hands the rule in production; the first test pins what is in it. */
const PROGRESS = progressInstaller.HOOK_IDENTITY;
const RELEASE = releaseInstaller.HOOK_IDENTITY;

const hook = (command, extra = {}) => ({ type: 'command', command, ...extra });
/** How both installers quote a word into a command. */
const q = (value) => `'${String(value).split("'").join(`'\\''`)}'`;
const ownDescribe = { describe: 'agent-skills report-progress gate (block): …' };
const releaseDescribe = { describe: 'agent-skills release-notes gate (block): …' };

/** The two commands the installers write, in the exact shape the harness was observed to keep. */
const PROGRESS_COMMAND = "AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 '/usr/local/bin/node' '/pack/adapters/claude-code/report-progress-gate.mjs'";
const RELEASE_COMMAND = "AGENT_SKILLS_RELEASE_NOTES_GATE=block bash '/pack/adapters/claude-code/release-notes-gate.sh'";

test('each installer hands the ownership rule its own identity', () => {
  const { interpreter: progressInterpreter, ...progress } = PROGRESS;
  assert.deepEqual(progress, {
    envFlag: 'AGENT_SKILLS_PROGRESS_GATE',
    gateFile: 'report-progress-gate.mjs',
    describePrefix: 'agent-skills report-progress gate',
    variables: ['AGENT_SKILLS_PROGRESS_GATE', 'AGENT_SKILLS_PROGRESS_GATE_COVERAGE', 'AGENT_SKILLS_PROGRESS_GATE_TURN_HOOK', 'AGENT_SKILLS_PROGRESS_GATE_SKILLS'],
  });
  // It writes process.execPath, single-quoted: a Node-compatible runtime's name, or whatever the binary running it is called.
  assert.deepEqual(progressInterpreter, { quoted: true, pattern: ownership.NODE_RUNTIME_NAME, names: [path.basename(process.execPath)] });

  const { interpreter: releaseInterpreter, ...release } = RELEASE;
  assert.deepEqual(release, {
    envFlag: 'AGENT_SKILLS_RELEASE_NOTES_GATE',
    gateFile: 'release-notes-gate.sh',
    describePrefix: 'agent-skills release-notes gate',
    variables: ['AGENT_SKILLS_RELEASE_NOTES_GATE'],
  });
  // It writes the bare word `bash` on every machine.
  assert.deepEqual(releaseInterpreter, { quoted: false, names: ['bash'] });
});

test('a Node-compatible runtime name is one pattern: node, nodejs or bun, an optional version, an optional .exe, in any case', () => {
  const pattern = ownership.NODE_RUNTIME_NAME;
  assert.ok(pattern instanceof RegExp, 'hook-ownership.mjs exports no NODE_RUNTIME_NAME');
  for (const name of ['node', 'nodejs', 'node.exe', 'node-20', 'node22', 'node_22', 'node-22.11.0', 'node-v22', 'nodejs20', 'nodejs-22', 'node22.exe', 'bun', 'bun.exe', 'bun-1.1', 'Node.exe', 'NODEJS']) {
    assert.match(name, pattern, name);
  }
  for (const name of ['nodemon', 'node-gyp', 'nodenv', 'node.js', 'node-lts', 'node-', 'node22x', 'my-node', 'node.exe.bak', 'bunx', 'deno', 'python3', 'bash', 'report-progress-gate.mjs']) {
    assert.doesNotMatch(name, pattern, name);
  }
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
    // process.execPath under the names a Node-compatible runtime goes by: Debian and Ubuntu's nodejs package,
    // Windows, a versioned binary, and bun, whose own execPath is the bun binary.
    "AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 '/usr/bin/nodejs' '/pack/report-progress-gate.mjs'",
    "AGENT_SKILLS_PROGRESS_GATE=block 'C:\\Program Files\\nodejs\\node.exe' '/pack/report-progress-gate.mjs'",
    "AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 '/usr/bin/node-20' '/pack/report-progress-gate.mjs'",
    "AGENT_SKILLS_PROGRESS_GATE=observe '/opt/node22/bin/node22' '/pack/report-progress-gate.mjs'",
    "AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=1 '/opt/bun/bin/bun' '/pack/report-progress-gate.mjs'",
    "AGENT_SKILLS_PROGRESS_GATE=block 'C:\\bun\\bun.exe' '/pack/report-progress-gate.mjs'",
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

test('only the exact shape, with an interpreter the installer writes, is owned: anything else that runs the gate is a hand-wiring', () => {
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
    "AGENT_SKILLS_PROGRESS_GATE=block '/usr/local/bin/node-lts' '/pack/report-progress-gate.mjs'",
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

test('the interpreter an installer writes is the binary that ran it, whatever that binary is called', () => {
  // A released installer wrote process.execPath. Where that binary's name is outside the Node-runtime pattern, the command
  // it wrote is still exactly its shape, and an installer running under that same name takes it with no flag.
  const ranUnder = { ...PROGRESS, interpreter: { ...PROGRESS.interpreter, names: ['gate-runner'] } };
  const command = "AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 '/usr/bin/gate-runner' '/pack/report-progress-gate.mjs'";
  assert.equal(classifyHook(hook(command), ranUnder), 'ours');
  assert.equal(classifyHook(hook(command, ownDescribe), ranUnder), 'ours');
  assert.equal(classifyHook(hook(command, { describe: 'theirs' }), ranUnder), 'foreign');
  // Anything around the shape leaves the structural reading, where a program it does not know leaves it unable to tell.
  assert.equal(classifyHook(hook(`${command} && true`), ranUnder), 'unclear');
  // Under an installer running as anything else, that shape is adoptable — never unclear, which no flag takes. The
  // installer that wrote it under `node-20` and re-read it under `node-22` could not even adopt it (measured).
  assert.equal(classifyHook(hook(command), PROGRESS), 'adoptable');
});

test('a command in the installer\'s exact shape is never unclear: its own interpreter owns it, one that only reads files nobody, any other --adopt', () => {
  const lead = 'AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2';
  const gate = "'/pack/adapters/claude-code/report-progress-gate.mjs'";
  // A Node-compatible runtime's name, single-quoted, as the installer writes process.execPath: its own, describe or not.
  for (const node of ['/usr/bin/node-20', '/opt/node22/bin/node22', '/opt/bun/bin/bun', 'C:\\bun\\bun.exe', '/usr/bin/nodejs', '/usr/local/bin/node']) {
    assert.equal(classifyHook(hook(`${lead} ${q(node)} ${gate}`), PROGRESS), 'ours', node);
    assert.equal(classifyHook(hook(`${lead} ${q(node)} ${gate}`, ownDescribe), PROGRESS), 'ours', node);
  }
  // Any other program in the interpreter's place, quoted or bare: adoptable, since everything else is pinned and a user
  // passing --adopt has made the call; the installer's own describe makes it its own; somebody else's never.
  for (const program of [q('/usr/local/bin/node-lts'), q('/usr/bin/deno'), q('/usr/local/bin/hook-wrapper'), q('/usr/bin/python3'), 'node-lts', 'hook-wrapper', 'node']) {
    const command = `${lead} ${program} ${gate}`;
    assert.equal(classifyHook(hook(command), PROGRESS), 'adoptable', command);
    assert.equal(classifyHook(hook(command, ownDescribe), PROGRESS), 'ours', command);
    assert.equal(classifyHook(hook(command, { describe: 'theirs' }), PROGRESS), 'foreign', command);
  }
  // A program that only prints, reads, lists, copies or deletes files runs nothing of the gate, whatever describe it wears.
  for (const program of [q('/bin/echo'), q('/bin/cat'), q('/usr/bin/grep'), q('/bin/rm'), q('/bin/cp'), q('/bin/ls'), 'echo', 'shellcheck']) {
    const command = `${lead} ${program} ${gate}`;
    assert.equal(classifyHook(hook(command), PROGRESS), null, command);
    assert.equal(classifyHook(hook(command, ownDescribe), PROGRESS), null, command);
  }

  // The release-notes installer writes the bare word bash: that is its own; any other interpreter word is adoptable.
  const releaseGate = "'/pack/adapters/claude-code/release-notes-gate.sh'";
  const releaseLead = 'AGENT_SKILLS_RELEASE_NOTES_GATE=block';
  for (const program of ['bash5', q('/opt/homebrew/bin/bash5'), 'fish', q('/bin/bash'), q('bash'), 'sh']) {
    const command = `${releaseLead} ${program} ${releaseGate}`;
    assert.equal(classifyHook(hook(command), RELEASE), 'adoptable', command);
    assert.equal(classifyHook(hook(command, releaseDescribe), RELEASE), 'ours', command);
  }
  for (const program of ['shellcheck', q('/usr/bin/shellcheck'), 'cat']) {
    const command = `${releaseLead} ${program} ${releaseGate}`;
    assert.equal(classifyHook(hook(command), RELEASE), null, command);
    assert.equal(classifyHook(hook(command, releaseDescribe), RELEASE), null, command);
  }

  // Outside the shape, a program the structural reading does not know leaves it unable to tell, describe or not.
  for (const extra of [{}, ownDescribe]) {
    assert.equal(classifyHook(hook(`${lead} ${q('/usr/local/bin/node-lts')} ${gate} && true`, extra), PROGRESS), 'unclear');
    assert.equal(classifyHook(hook(`${lead} ${q('/usr/local/bin/hook-wrapper')} --gate ${gate}`, extra), PROGRESS), 'unclear');
  }
  // …but a Node-compatible name is an interpreter there too, so a versioned binary in a hand-wiring runs the gate.
  assert.equal(classifyHook(hook(`cd / && ${lead} ${q('/usr/bin/node-22')} ${gate}`), PROGRESS), 'adoptable');
  assert.equal(classifyHook(hook(`/opt/bun/bin/bun.exe ${gate} | cat`), PROGRESS), 'adoptable');
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
    'xargs node < /pack/report-progress-gate.mjs.list /pack/report-progress-gate.mjs',
    // A wrapper form no rule pins, and `time`, which under dash is a program Debian and Ubuntu do not install.
    'timeout --no-such-option 5 node /pack/report-progress-gate.mjs',
    'time node /pack/report-progress-gate.mjs',
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
    'sudo -i bash /pack/release-notes-gate.sh',
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

test('a describe somebody else wrote vetoes ownership; the installer\'s own describe grants it to a hook that runs the gate, and to nothing else', () => {
  assert.equal(classifyHook(hook(PROGRESS_COMMAND, { describe: 'written by some other tool' }), PROGRESS), 'foreign');
  // A describe somebody typed, even an empty one, is not the absence of one.
  assert.equal(classifyHook(hook(PROGRESS_COMMAND, { describe: '' }), PROGRESS), 'foreign');
  assert.equal(classifyHook(hook(PROGRESS_COMMAND, { describe: 5 }), PROGRESS), 'foreign');
  assert.equal(classifyHook(hook("node '/pack/report-progress-gate.mjs'", { describe: 'theirs' }), PROGRESS), 'foreign');
  assert.equal(classifyHook(hook(RELEASE_COMMAND, { describe: 'theirs' }), RELEASE), 'foreign');
  // The other installer's describe is somebody else's.
  assert.equal(classifyHook(hook(RELEASE_COMMAND, { describe: `${PROGRESS.describePrefix} (block): …` }), RELEASE), 'foreign');
  // …and a hook that does not run the gate is nobody's business, whatever its describe says.
  assert.equal(classifyHook(hook('someone-elses-hook', { describe: 'theirs' }), PROGRESS), null);
  assert.equal(classifyHook(hook('echo /pack/report-progress-gate.mjs', { describe: 'theirs' }), PROGRESS), null);

  // The installer's own describe, still on a hook the harness has not rewritten, is the installer's word that it wrote
  // that hook: on a hook that runs the gate in any shape, it is the installer's own, with no flag, as in 0.19.0.
  for (const command of [
    "node '/pack/report-progress-gate.mjs'",
    "cd / && AGENT_SKILLS_PROGRESS_GATE=block '/bin/node' '/pack/report-progress-gate.mjs'",
    `${PROGRESS_COMMAND} && rm -rf /tmp/x`,
    "AGENT_SKILLS_PROGRESS_GATE=block '/usr/bin/deno' '/pack/report-progress-gate.mjs'",
  ]) {
    assert.equal(classifyHook(hook(command, ownDescribe), PROGRESS), 'ours', command);
    assert.equal(classifyHook(hook(command), PROGRESS), 'adoptable', command);
  }
  assert.equal(classifyHook(hook("bash '/elsewhere/release-notes-gate.sh'", releaseDescribe), RELEASE), 'ours');
  assert.equal(classifyHook(hook(`${RELEASE_COMMAND} 2>/dev/null`, releaseDescribe), RELEASE), 'ours');

  // Never to a hook that only mentions the gate file, which 0.19.0 took by that describe, and never to one where
  // whether the gate runs cannot be told.
  assert.equal(classifyHook(hook('echo something else entirely', ownDescribe), PROGRESS), null);
  assert.equal(classifyHook(hook('AGENT_SKILLS_PROGRESS_GATE=block echo /pack/report-progress-gate.mjs', ownDescribe), PROGRESS), null);
  assert.equal(classifyHook(hook("AGENT_SKILLS_PROGRESS_GATE=block '/bin/echo' '/pack/report-progress-gate.mjs'", ownDescribe), PROGRESS), null);
  assert.equal(classifyHook(hook("AGENT_SKILLS_RELEASE_NOTES_GATE=block shellcheck '/pack/release-notes-gate.sh'", releaseDescribe), RELEASE), null);
  assert.equal(classifyHook(hook('timeout --no-such-option 5 node /pack/report-progress-gate.mjs', ownDescribe), PROGRESS), 'unclear');
  // A wrapper the reader pins is not such a place: what it runs is read, and that runs the gate.
  assert.equal(classifyHook(hook('timeout 5 node /pack/report-progress-gate.mjs', ownDescribe), PROGRESS), 'ours');
});

// ---------------------------------------------------------------------------
// Wrappers: commands whose documented form is `wrapper [options] [operands] COMMAND [args]` and which execute COMMAND.
// The reader strips each by its pinned grammar, as many times as they nest, and reads what is left by the rules above.
// Every form below was run, not read about: under macOS 14's /bin/sh and zsh, and under dash with GNU coreutils 9.1
// (Debian 12) and 9.4 (Ubuntu 24.04), plus coreutils 9.11 for timeout. sudo's grammar is pinned from its manual, 1.9.13 on
// both systems, because running it here needs a password, and every sudo form below that runs was also run as root under
// Debian 12's dash with sudo 1.9.13p3; caffeinate was run on macOS, the only system that has it.
// ---------------------------------------------------------------------------

const WRAPPED_NODE = "'/usr/local/bin/node'";
const WRAPPED_GATE = "'/pack/adapters/claude-code/report-progress-gate.mjs'";
const WRAPPED_RELEASE_GATE = "'/pack/adapters/claude-code/release-notes-gate.sh'";
const wrappedProgress = (wrapper) => `AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 ${wrapper} ${WRAPPED_NODE} ${WRAPPED_GATE}`;
const wrappedRelease = (wrapper) => `AGENT_SKILLS_RELEASE_NOTES_GATE=block ${wrapper} bash ${WRAPPED_RELEASE_GATE}`;

/** Forms that run the command after them on every system above. */
const RUNNING_WRAPPERS = Object.freeze([
  // timeout: the operand DURATION, then every option coreutils 9.1, 9.4 and 9.11 share.
  'timeout 5', 'timeout 0', 'timeout 0.5', 'timeout .5', 'timeout 5.', 'timeout 1m', 'timeout 2h', 'timeout 1d', 'timeout 10s',
  'timeout -k 1 5', 'timeout -k1 5', 'timeout --kill-after=1 5', 'timeout --kill-after 1 5',
  'timeout -s KILL 5', 'timeout -s kill 5', 'timeout -s SIGTERM 5', 'timeout -s 9 5', 'timeout --signal=HUP 5', 'timeout --signal INT 5',
  'timeout -v 5', 'timeout -vk 1 5', 'timeout --verbose 5', 'timeout --preserve-status 5', 'timeout --foreground 5', 'timeout -- 5',
  // nice: GNU's and BSD's shared -n, and `--`.
  'nice', 'nice -n 10', 'nice -n10', 'nice -n -5', 'nice -n +5', 'nice --',
  'nohup', 'nohup --',
  // env: the options GNU and BSD share, and assignments to variable names.
  'env', 'env FOO=1', 'env FOO=1 BAR=', 'env -i', 'env -', 'env -i FOO=1', 'env -u FOO', 'env -uFOO', 'env -iu FOO', 'env -v', 'env --', 'env -- FOO=1',
  // The shell's own, first in the command.
  'command', 'command -p', 'command --', 'exec',
  'caffeinate', 'caffeinate -i', 'caffeinate -dimsu', 'caffeinate -d -i', 'caffeinate -t 5', 'caffeinate -t5', 'caffeinate -w 1', 'caffeinate --',
  // sudo: the options both systems' manuals list for running a command that decide nothing else first.
  'sudo', 'sudo -u x', 'sudo -ux', 'sudo --user=x', 'sudo --user x', 'sudo -g staff', 'sudo -p prompt', 'sudo -n', 'sudo -B -H -n -P', 'sudo -nH',
  'sudo --non-interactive --set-home', 'sudo --bell --preserve-groups', 'sudo FOO=1', 'sudo -u x FOO=1', 'sudo --',
  // Nested, as deep as anyone writes them.
  'sudo -u x timeout 5', 'nice -n 10 nohup timeout -s KILL 5', 'env FOO=1 sudo -n timeout 5', 'command -p timeout 5 env -i', 'exec sudo -n nice',
]);

/** Forms the reader does not pin, so it cannot tell what runs. */
const UNPINNED_WRAPPERS = Object.freeze([
  // The wrapper itself refuses them, on every system measured, and runs nothing.
  'timeout --no-such-option 5', 'timeout 5x', 'timeout -s NOPE 5', 'timeout',
  'nice -n x', 'env -0', 'command -v', 'command -V', 'nohup --help', 'caffeinate -z', 'caffeinate -t abc', 'caffeinate -w abc', 'caffeinate --help',
  // They run the command on one system and not the other.
  'timeout -p 5', 'timeout -f 5', 'env -C /tmp', 'env -P /bin', 'nice --adjustment=3', 'exec --', 'exec -a name', 'env =x',
  // They run it by a rule this reader does not follow: an abbreviated long option, nice's obsolete -N, a -S string with
  // quoting or expansion of its own, a word env takes as an assignment that names no variable.
  'timeout --sig=KILL 5', 'nice -10', "env -S 'FOO=${HOME}'", "env -S '\"node\"'", 'env ./x=y',
  // sudo: a value given twice, which it refuses, and the forms that decide something first — a shell, a background job,
  // a helper or stdin for the password, a policy that may refuse the option, another root, directory or host, no command.
  'sudo -u a -u b', 'sudo -i', 'sudo -s', 'sudo -b', 'sudo -A', 'sudo -S', 'sudo -E', 'sudo -k', 'sudo -D /tmp', 'sudo -R /tmp',
  'sudo -T 5', 'sudo -C 5', 'sudo -h host', 'sudo -e', 'sudo -l', 'sudo -- FOO=1',
  // Programs that change how or whether the command runs, which are not wrappers here.
  'xargs', 'watch', 'parallel', 'flock /tmp/lock', 'ionice -c 3', 'chrt -o 0', 'taskset 1', 'stdbuf -oL', 'time', 'time -p', '/usr/bin/command',
  // One unpinned layer anywhere in a nest is enough; the shell's own run only first in the command.
  'sudo -u x timeout --no-such-option 5', 'timeout 5 sudo -i', 'nice -n 10 time', 'nice command', 'timeout 5 exec',
  // After a wrapper, a reserved word is only the name of a program.
  'nohup !', 'timeout 5 if',
]);

test('the held regression: a gate wrapped in timeout runs, so its own describe takes it with no flag and --adopt takes it without one', () => {
  const progress = "AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 timeout 5 '/usr/local/bin/node' '/pack/adapters/claude-code/report-progress-gate.mjs'";
  const release = "AGENT_SKILLS_RELEASE_NOTES_GATE=block timeout 5 bash '/pack/adapters/claude-code/release-notes-gate.sh'";
  assert.equal(classifyHook(hook(progress, ownDescribe), PROGRESS), 'ours');
  assert.equal(classifyHook(hook(progress), PROGRESS), 'adoptable');
  assert.equal(classifyHook(hook(release, releaseDescribe), RELEASE), 'ours');
  assert.equal(classifyHook(hook(release), RELEASE), 'adoptable');
  assert.equal(classifyHook(hook(progress, { describe: 'theirs' }), PROGRESS), 'foreign');
});

test('every wrapper form the reader pins runs the command after it, and wrappers nest', () => {
  for (const wrapper of RUNNING_WRAPPERS) {
    for (const [command, identity, describe] of [[wrappedProgress(wrapper), PROGRESS, ownDescribe], [wrappedRelease(wrapper), RELEASE, releaseDescribe]]) {
      assert.equal(classifyHook(hook(command), identity), 'adoptable', command);
      assert.equal(classifyHook(hook(command, describe), identity), 'ours', command);
      assert.equal(classifyHook(hook(command, { describe: 'theirs' }), identity), 'foreign', command);
    }
  }
  // What a wrapper runs is read by the rules for any command: a mention stays a mention, and a shell's -c script is read.
  for (const command of [
    `timeout 5 cat ${WRAPPED_GATE}`,
    `sudo -u x rm -f ${WRAPPED_GATE}`,
    `AGENT_SKILLS_PROGRESS_GATE=block nice -n 10 echo ${WRAPPED_GATE}`,
    `env FOO=1 ls -l ${WRAPPED_GATE}`,
  ]) {
    assert.equal(classifyHook(hook(command), PROGRESS), null, command);
    assert.equal(classifyHook(hook(command, ownDescribe), PROGRESS), null, command);
  }
  assert.equal(classifyHook(hook(`timeout 5 sh -c "node ${WRAPPED_GATE}"`), PROGRESS), 'adoptable');
  // env -S splits a string of plain words into arguments, and env reads them as if they had been written out.
  assert.equal(classifyHook(hook("env -S 'FOO=1 node' '/pack/report-progress-gate.mjs'"), PROGRESS), 'adoptable');
  assert.equal(classifyHook(hook("env -S 'node /pack/report-progress-gate.mjs'"), PROGRESS), 'adoptable');
  assert.equal(classifyHook(hook("env -S '-i node' /pack/report-progress-gate.mjs"), PROGRESS), 'adoptable');
});

test('a wrapper form the reader does not pin is unclear, describe or not: it never guesses past a wrapper', () => {
  for (const wrapper of UNPINNED_WRAPPERS) {
    for (const [command, identity, describe] of [[wrappedProgress(wrapper), PROGRESS, ownDescribe], [wrappedRelease(wrapper), RELEASE, releaseDescribe]]) {
      assert.equal(classifyHook(hook(command), identity), 'unclear', command);
      assert.equal(classifyHook(hook(command, describe), identity), 'unclear', command);
      assert.equal(classifyHook(hook(command, { describe: 'theirs' }), identity), 'foreign', command);
    }
  }
  // A value a wrapper option takes that names the gate file is a place the gate may run from.
  assert.equal(classifyHook(hook(`sudo -p ${WRAPPED_GATE} node /pack/other.mjs`), PROGRESS), 'unclear');
  // With nothing of the gate in it, an unpinned wrapper is nobody's business.
  assert.equal(classifyHook(hook('timeout --no-such-option 5 node /pack/other.mjs'), PROGRESS), null);
});

// Each command below names the gate file and does not run it as a hook runs it — as its own entry point, with the hook's
// payload on stdin — on every system measured: a probe gate recording how it was run, under macOS 14's /bin/sh and dash, and
// under Debian 12's dash with coreutils 9.1 and sudo 1.9.13p3, as root with a user x. `bash <gate` runs the script with the
// script itself on stdin, and a here-string is a syntax error under dash. The reader once read each as running the gate, so
// --adopt, or the installer's own describe, would have deleted it.
test('a redirection, a here-string, a wrapper value the shell may change and an adjustment nice refuses never read as running the gate', () => {
  const G = WRAPPED_GATE;
  const RG = WRAPPED_RELEASE_GATE;
  // A file a redirection writes to is written, never run: the command runs what is left, and here that is not the gate.
  for (const command of [
    `AGENT_SKILLS_PROGRESS_GATE=block timeout 5 >${G} node -e 0`,
    `env >${G} node -e 0`,
    `>${G} node -e 0`,
    `AGENT_SKILLS_PROGRESS_GATE=block node >${G}`,
    `nohup node -e 0 2>${G}`,
  ]) {
    assert.equal(classifyHook(hook(command), PROGRESS), null, command);
    assert.equal(classifyHook(hook(command, ownDescribe), PROGRESS), null, command);
  }
  assert.equal(classifyHook(hook(`AGENT_SKILLS_RELEASE_NOTES_GATE=block timeout 5 >${RG} bash -c true`, releaseDescribe), RELEASE), null);
  for (const [command, identity, describe] of [
    // What a command reads on stdin an interpreter may run, or not: `node <gate.mjs` runs it, but not as its entry point.
    [`node <${G}`, PROGRESS, ownDescribe],
    [`AGENT_SKILLS_PROGRESS_GATE=block node <<< ${G}`, PROGRESS, ownDescribe],
    [`timeout 5 node <<< ${G}`, PROGRESS, ownDescribe],
    [`AGENT_SKILLS_RELEASE_NOTES_GATE=block bash <<< ${RG}`, RELEASE, releaseDescribe],
    [`bash 0<${RG}`, RELEASE, releaseDescribe],
    // A descriptor number is part of its redirection, not the operand or value the wrapper needed.
    [`timeout 5>/dev/null node ${G}`, PROGRESS, ownDescribe],
    [`nice -n 5>/dev/null node ${G}`, PROGRESS, ownDescribe],
    // A sudo value the shell may split, glob or make vanish, after which the option takes the next word.
    [`sudo -n -u $U node ${G}`, PROGRESS, ownDescribe],
    [`sudo -p $P node ${G}`, PROGRESS, ownDescribe],
    [`sudo -u x* node ${G}`, PROGRESS, ownDescribe],
    [`sudo -g {a,b} node ${G}`, PROGRESS, ownDescribe],
    [`sudo -u '~x' node ${G}`, PROGRESS, ownDescribe],
    [`sudo --user=$U bash ${RG}`, RELEASE, releaseDescribe],
    // An adjustment outside a C int: macOS 14's nice prints "invalid nice value" and runs nothing.
    [`nice -n 2147483648 node ${G}`, PROGRESS, ownDescribe],
    [`nice -n -2147483649 bash ${RG}`, RELEASE, releaseDescribe],
    // A quoted digit is a word: this runs a program called 2.
    [`'2'>/dev/null node ${G}`, PROGRESS, ownDescribe],
  ]) {
    assert.equal(classifyHook(hook(command), identity), 'unclear', command);
    assert.equal(classifyHook(hook(command, describe), identity), 'unclear', command);
  }
  // Quotes are gone by the time the reader sees a word, so a quoted expansion is refused too. It runs; this is an over-refusal,
  // which a user can undo by hand, never a guess.
  assert.equal(classifyHook(hook(`sudo -p "$P" node ${G}`), PROGRESS), 'unclear');
  // None of that makes a hook that does run the gate unclear.
  for (const command of [
    `node ${G} 2>/dev/null`,
    `2>/dev/null node ${G}`,
    `node ${G} </dev/null`,
    `timeout 5 node ${G} >/dev/null 2>&1`,
    `nice -n 2147483647 node ${G}`,
    `nice -n -2147483648 node ${G}`,
    `sudo -p '%p: ' -u x node ${G}`,
  ]) {
    assert.equal(classifyHook(hook(command), PROGRESS), 'adoptable', command);
    assert.equal(classifyHook(hook(command, ownDescribe), PROGRESS), 'ours', command);
  }
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
  // A redirection's target is a file, not a word of the command.
  assert.deepEqual(shellCommands('node gate.mjs > /tmp/out'), [['node', 'gate.mjs']]);
  assert.deepEqual(shellCommands(''), []);
  assert.deepEqual(shellCommands('   ;; &&  '), []);
  // A substitution stays inside the word it is part of, and does not end the command.
  assert.deepEqual(shellCommands('node $(echo a; b) "x$(c)" `d e` | f'), [['node', '$(echo a; b)', 'x$(c)', '`d e`'], ['f']]);
  // `&>`, `>&`, `>|` and `2>&1` redirect; they do not end a command, and a descriptor number right against one is part of it.
  assert.deepEqual(shellCommands('a &> b; c 2>&1 >| d'), [['a'], ['c']]);
  assert.deepEqual(shellCommands("c '2'>x 3 >y <>z"), [['c', '2', '3']], 'a quoted digit, or one set apart, is a word');
  // A here-document's body is data, not commands, and neither its delimiter nor a here-string is a word.
  assert.deepEqual(shellCommands("cat <<'EOF'\nnot a command\nEOF\nnext"), [['cat'], ['next']]);
  assert.deepEqual(shellCommands('cat <<-END\n\tnot a command\n\tEND\nnext <<< here'), [['cat'], ['next']]);
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

// ---------------------------------------------------------------------------
// THE OVERRIDE. A safe reader of shell text always refuses some hand-wrapped hook, so `--adopt` is the explicit override for a
// hook this reader could not fully read: it takes one when the command's leading assignments set this gate's own arming
// variable AND one of its words is the gate path — exactly the gate file's basename, as a word of its own. With no flag
// nothing changes. A hook the reader understood as not running the gate — a mention, a write target — is never taken.
// ---------------------------------------------------------------------------

test('--adopt takes over a hook this reader could not fully read only when it sets this gate\'s own variable and names the gate path as a word of its own', () => {
  const { takenAs, findUnownedHooks } = ownership;
  assert.equal(typeof takenAs, 'function', 'hook-ownership.mjs exports no takenAs');
  const G = WRAPPED_GATE;
  const RG = WRAPPED_RELEASE_GATE;
  const N = WRAPPED_NODE;
  const P = 'AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2';
  const R = 'AGENT_SKILLS_RELEASE_NOTES_GATE=block';

  // The forms 0.19.0 took that this reader cannot read, and more: each sets the gate's own variable and names its path.
  const takenOver = [
    [`${P} nice -10 ${N} ${G}`, PROGRESS, ownDescribe],
    [`${P} stdbuf -oL ${N} ${G}`, PROGRESS, ownDescribe],
    [`${P} timeout -p 5 ${N} ${G}`, PROGRESS, ownDescribe],
    [`${P} time ${N} ${G}`, PROGRESS, ownDescribe],
    [`${P} sudo -i ${N} ${G}`, PROGRESS, ownDescribe],
    [`${P} timeout --no-such-option 5 ${N} ${G}`, PROGRESS, ownDescribe],
    // The gate as the file a command reads on stdin, or a here-string.
    [`${P} ${N} <${G}`, PROGRESS, ownDescribe],
    [`${P} timeout 5 ${N} <<< ${G}`, PROGRESS, ownDescribe],
    // The arming variable need not lead the assignments; the directory may be an expansion, or hold a blank.
    ['AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 AGENT_SKILLS_PROGRESS_GATE=block nice -10 node "$HOME/my pack/report-progress-gate.mjs"', PROGRESS, ownDescribe],
    // A wrapper script given an option first: outside the exact shape, where any interpreter word is adoptable, never unclear.
    [`AGENT_SKILLS_PROGRESS_GATE=block /usr/local/bin/hook-wrapper --verbose ${G}`, PROGRESS, ownDescribe],
    [`${R} nice -10 bash ${RG}`, RELEASE, releaseDescribe],
    [`${R} sudo -i bash ${RG}`, RELEASE, releaseDescribe],
    [`${R} bash <${RG}`, RELEASE, releaseDescribe],
    [`${R} time -o ${RG} bash -c true`, RELEASE, releaseDescribe],
  ];
  for (const [command, identity, describe] of takenOver) {
    for (const extra of [{}, describe]) {
      const entry = hook(command, extra);
      assert.equal(classifyHook(entry, identity), 'unclear', command);
      assert.equal(takenAs(entry, identity, { adopt: true }), 'override', command);
      assert.equal(takenAs(entry, identity, { adopt: false }), null, `${command}: taken with no flag`);
      assert.equal(takenAs(entry, identity), null, `${command}: taken with no options`);
    }
  }

  // Unclear, and not taken even under --adopt: the variable is missing, not the arming one, another gate's, not a literal
  // leading assignment; the path is only inside a word; or the command also writes to the gate file.
  const refused = [
    [`timeout --no-such-option 5 node ${G}`, PROGRESS],
    [`nice -10 AGENT_SKILLS_PROGRESS_GATE=block node ${G}`, PROGRESS],
    [`AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 nice -10 node ${G}`, PROGRESS],
    [`AGENT_SKILLS_RELEASE_NOTES_GATE=block nice -10 node ${G}`, PROGRESS],
    [`AGENT_SKILLS_PROGRESS_GATE=$MODE nice -10 node ${G}`, PROGRESS],
    [`sudo -i bash ${RG}`, RELEASE],
    [`AGENT_SKILLS_PROGRESS_GATE=block nice -10 bash ${RG}`, RELEASE],
    ['AGENT_SKILLS_PROGRESS_GATE=block /usr/local/bin/hook-wrapper --gate=/pack/report-progress-gate.mjs', PROGRESS],
    ['AGENT_SKILLS_PROGRESS_GATE=block GATE=/pack/report-progress-gate.mjs hook-wrapper', PROGRESS],
    ["AGENT_SKILLS_PROGRESS_GATE=block sh -c 'nice -10 node /pack/report-progress-gate.mjs; true'", PROGRESS],
    ['AGENT_SKILLS_PROGRESS_GATE=block node $(echo /pack/report-progress-gate.mjs)', PROGRESS],
    ['AGENT_SKILLS_RELEASE_NOTES_GATE=block hook-wrapper --script=/pack/release-notes-gate.sh', RELEASE],
    [`AGENT_SKILLS_PROGRESS_GATE=block nice -10 node ${G} 2>${G}`, PROGRESS],
  ];
  for (const [command, identity] of refused) {
    for (const extra of [{}, identity === RELEASE ? releaseDescribe : ownDescribe]) {
      const entry = hook(command, extra);
      assert.equal(classifyHook(entry, identity), 'unclear', command);
      assert.equal(takenAs(entry, identity, { adopt: true }), null, `${command}: --adopt took it over`);
    }
  }

  // Read, and known not to run the gate: never taken, flag or not, describe or not.
  for (const [command, identity] of [
    [`${P} timeout 5 >${G} node -e 0`, PROGRESS],
    [`${P} node >${G}`, PROGRESS],
    [`${P} cat ${G}`, PROGRESS],
    [`${P} timeout 5 echo ${G}`, PROGRESS],
    [`${R} timeout 5 >${RG} bash -c true`, RELEASE],
    [`${R} shellcheck ${RG}`, RELEASE],
  ]) {
    for (const extra of [{}, identity === RELEASE ? releaseDescribe : ownDescribe]) {
      for (const adopt of [false, true]) {
        assert.equal(takenAs(hook(command, extra), identity, { adopt }), null, `${command} adopt=${adopt}`);
      }
    }
  }

  // The rest is unchanged: its own with no flag, a hand-wiring under --adopt, somebody else's describe never.
  assert.equal(takenAs(hook(PROGRESS_COMMAND), PROGRESS), 'own');
  assert.equal(takenAs(hook(PROGRESS_COMMAND), PROGRESS, { adopt: true }), 'own');
  assert.equal(takenAs(hook(`${P} timeout 5 ${N} ${G}`), PROGRESS), null);
  assert.equal(takenAs(hook(`${P} timeout 5 ${N} ${G}`), PROGRESS, { adopt: true }), 'adopted');
  assert.equal(takenAs(hook(`${P} nice -10 ${N} ${G}`, { describe: 'theirs' }), PROGRESS, { adopt: true }), null);

  // Each unowned hook says whether --adopt can take it over.
  const settings = { hooks: { Stop: [{ matcher: '*', hooks: [hook(`${P} nice -10 ${N} ${G}`), hook(`timeout --no-such-option 5 node ${G}`), hook(`${P} timeout 5 ${N} ${G}`)] }] } };
  assert.deepEqual(findUnownedHooks(settings, PROGRESS), [
    { event: 'Stop', matcher: '*', kind: 'unclear', overridable: true },
    { event: 'Stop', matcher: '*', kind: 'unclear', overridable: false },
    { event: 'Stop', matcher: '*', kind: 'adoptable', overridable: false },
  ]);
});
