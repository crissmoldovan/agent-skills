import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, copyFile, link, mkdir, mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

import { classifyHook } from '../adapters/claude-code/hook-ownership.mjs';
import { HOOK_IDENTITY as PROGRESS_IDENTITY } from '../adapters/claude-code/install-report-progress-gate.mjs';
import { HOOK_IDENTITY as RELEASE_IDENTITY } from '../adapters/claude-code/install-release-notes-gate.mjs';

// ---------------------------------------------------------------------------
// The release bar, row by row, against 0.19.0's real installers.
//
// 0.19.0 recognised a gate installer's hooks by `describe`. This branch reads the command, because Claude Code drops
// `describe` whenever it rewrites a settings file. A reader of shell text that never guesses will always refuse some
// hand-wrapped hook, so `--adopt` is the explicit override for a hook it cannot fully read: it takes one when the command's
// leading assignments set the gate's own variable and one of its words is the gate path, and says it did. Every row below is
// held to the four points of the release bar:
//   1. a run with no flag never takes a hook the reader cannot fully read, with or without the installer's own describe;
//   2. anything 0.19.0 did, the branch still does, with the same flags or at worst with --adopt added: on every row where
//      0.19.0 took or removed the gate's hooks and exited 0, the branch takes or removes them on that row, or on the same
//      row with --adopt;
//   3. a hook the reader can read and knows does not run the gate — a mention (the gate path as an argument of echo, cat,
//      grep, rm, cp, ls, shellcheck and the like) or a write target (`timeout 5 >'<gate>' node x`, which empties the gate)
//      — is never taken, with any flag, and never fires;
//   4. the release-notes installer's --remove exits 1 while it leaves a hook that runs the gate, or may, where 0.19.0
//      printed "No release-notes gate was installed".
// Every row lands in exactly one count: the same as 0.19.0; better; (2) taken only once --adopt is added; (3) never taken;
// (4) exits 1 over a hook both versions leave. A row that breaks a point, or where 0.19.0 did better outside those counts,
// fails, and every such row is listed before the test fails.
//
// 0.19.0'S RELEASE-NOTES INSTALLER HAS NO --adopt: it exits 1 with "unknown argument: --adopt". Held to that, every branch
// result on those rows would count as better. So those rows are compared with 0.19.0's nearest equivalent run instead — its
// bare install for `--adopt install`, its bare `--remove` for `--remove --adopt` — and the first test checks that 0.19.0
// refuses the argument on every one of them.
//
// WHETHER A HOOK RUNS THE GATE IS FIRED, NOT WRITTEN DOWN. Each distinct start command is run through /bin/sh, with the
// ambient gate variables cleared, against a stand-in gate: a file with the gate's basename and the real gate's permission
// bits, in a temp directory, that writes a marker only when it is handed the hook's payload on stdin — run the way a hook
// runs the gate. What fired is recorded. sudo is never run here: its forms carry a label from runs documented in this
// branch's reviews (as root with a user x under Debian 12's dash, sudo 1.9.13p3), or say that none was documented. A form
// that needs a program this machine lacks is not fired, and says which. The reader's reading of each start hook is stated
// here and checked against the reader: a hook it reads as running the gate must fire, unless its row says why it cannot,
// and a hook it reads as not running the gate must not.
//
// Rows:
//   - who wrote the file: 0.19.0's installer or this branch's, under a Node binary called `wrote`; by hand (HAND_WRITTEN),
//     including every form from the held release reviews; or a file holding one hook that does not run the gate (NOT_RUN);
//   - describe present, or stripped the way a settings rewrite strips it;
//   - which installer re-runs it, under a Node binary called `reran`;
//   - the four re-runs: a bare install, `--adopt`, `--remove`, `--remove --adopt`.
//
// 0.19.0 comes from git (`git show <commit>:<file>` for the four files its installers load, into a temp directory: nothing
// is added to the repository's worktree list and nothing is left to clean up). A shallow clone does not have that commit,
// so what 0.19.0 does is also kept as a table recorded from real runs, fixtures/hook-ownership-v0.19.0.json. The first test
// re-derives the table from 0.19.0 wherever the commit is present and fails if the two disagree; the second holds the
// branch to it everywhere.
// Re-record: AGENT_SKILLS_RECORD_V019_TABLE=1 node --test test/hook-ownership-v0.19.0.test.mjs
//
// Every binary is the running Node under another name (a hard link, so `process.execPath` carries that name), and every
// installer run has HOME and --settings in a temp directory. Every gate the branch writes is run from its written command
// against the real gate, and must fire.
// ---------------------------------------------------------------------------

const REPO = fileURLToPath(new URL('..', import.meta.url));
const V019 = Object.freeze({ tag: 'v0.19.0', commit: '8a40f2a4e7a59ca1f0a49cf052f856d6f37b0353' });
const TABLE_URL = new URL('./fixtures/hook-ownership-v0.19.0.json', import.meta.url);
const RECORDING = process.env.AGENT_SKILLS_RECORD_V019_TABLE === '1';
const LIMIT = Math.max(2, Math.min(6, Math.floor(availableParallelism() / 2)));
/** A fired start command still running after this long is killed, and fails the test. */
const FIRE_TIMEOUT_MS = 30_000;

const KINDS = Object.freeze({
  progress: Object.freeze({
    installer: 'install-report-progress-gate.mjs',
    gate: 'report-progress-gate.mjs',
    flag: 'AGENT_SKILLS_PROGRESS_GATE',
    describePrefix: 'agent-skills report-progress gate',
    event: 'Stop',
    matcher: '*',
    label: 'Stop (matcher *)',
    // Coverage 2: Stop, UserPromptSubmit, SessionStart and SubagentStart.
    full: 4,
    // A new install: coverage 1 — Stop, UserPromptSubmit, PostToolUse Agent — in observe.
    fresh: 3,
  }),
  release: Object.freeze({
    installer: 'install-release-notes-gate.mjs',
    gate: 'release-notes-gate.sh',
    flag: 'AGENT_SKILLS_RELEASE_NOTES_GATE',
    describePrefix: 'agent-skills release-notes gate',
    event: 'PreToolUse',
    matcher: 'Bash',
    label: 'PreToolUse (matcher Bash)',
    full: 1,
    fresh: 1,
  }),
});
const OTHER = Object.freeze({ progress: 'release', release: 'progress' });

const BRANCH_ADAPTER = path.join(REPO, 'adapters', 'claude-code');
const branchGate = (kind) => path.join(BRANCH_ADAPTER, KINDS[kind].gate);
/** Where a NOT_RUN hook names the gate. No installer runs a hook; the firing check puts a stand-in in its place. */
const packGate = (kind) => `/pack/adapters/claude-code/${KINDS[kind].gate}`;

/** How both installers quote a word into a command. */
const q = (value) => `'${String(value).split("'").join(`'\\''`)}'`;
const both = (value) => Object.freeze({ progress: value, release: value });
const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hooksWord = (count) => `${count} hook${count === 1 ? '' : 's'}`;

/** Installed by a binary called `wrote`, re-run by one called `reran`. `recognised`: whether the
 *  progress installer takes the hooks with no describe and no flag (the release installer writes `bash`). */
const INPUTS = Object.freeze([
  { id: 'node -> node', wrote: 'node', reran: 'node', recognised: true },
  { id: 'node-20 -> node-22', wrote: 'node-20', reran: 'node-22', recognised: true },
  { id: 'node22 -> node', wrote: 'node22', reran: 'node', recognised: true },
  { id: 'bun -> node', wrote: 'bun', reran: 'node', recognised: true },
  { id: 'node -> bun', wrote: 'node', reran: 'bun', recognised: true },
  { id: 'nodejs -> node', wrote: 'nodejs', reran: 'node', recognised: true },
  // A name outside the Node-runtime pattern: in the installer's exact shape, so adoptable and never unclear;
  // with the installer's own describe, its own.
  { id: 'node-lts -> node', wrote: 'node-lts', reran: 'node', recognised: false },
]);

const P = 'AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2';
const R = 'AGENT_SKILLS_RELEASE_NOTES_GATE=block';
const exactShape = Object.freeze({
  progress: (node, gate) => `${P} ${q(node)} ${q(gate)}`,
  release: (gate) => `${R} bash ${q(gate)}`,
});
const wrappedIn = (wrapper) => ({
  progress: (node, gate) => `${P} ${wrapper} ${q(node)} ${q(gate)}`,
  release: (gate) => `${R} ${wrapper} bash ${q(gate)}`,
});
const releaseRunBy = (interpreter) => ({ progress: exactShape.progress, release: (gate) => `${R} ${interpreter} ${q(gate)}` });
const followedBy = (tail) => ({
  progress: (node, gate) => `${exactShape.progress(node, gate)}${tail}`,
  release: (gate) => `${exactShape.release(gate)}${tail}`,
});

/** Labels for forms this test never fires, from runs documented in this branch's reviews. */
const SUDO_RAN = Object.freeze({ fires: true, why: "sudo is never run here; as root with a user x under Debian 12's dash, sudo 1.9.13p3, this form ran the command (a run documented in this branch's review)" });
const SUDO_RAN_NOTHING = Object.freeze({ fires: false, why: "sudo is never run here; as root with a user x under Debian 12's dash, sudo 1.9.13p3, this form ran nothing (a run documented in this branch's review)" });
const SUDO_UNDOCUMENTED = Object.freeze({ fires: null, why: 'sudo is never run here, and no run of this form is documented' });

/** Why a hook the reader reads as running the gate does not fire. */
const NOT_EXECUTABLE = 'the progress gate is not executable in a checkout (git mode 100644), so running the file as a program runs nothing';
const HERE_STRING = "a here-string takes the place of the hook's payload on stdin, so the gate never reads the payload (and dash refuses a here-string)";

/**
 * Hand-written files: both gates at block and coverage 2, beside hooks nobody here wrote, each command built from the `node`
 * binary and this branch's gate paths.
 *   reader      for each gate, what its command is to the branch's reader: `own`, the installer's exact shape with the
 *               interpreter it writes; `hand-wiring`, a command that runs the gate in any other shape; `unclear`, a command
 *               where the reader cannot tell whether the gate runs. Checked against the reader on every row.
 *   describe    what "describe present" puts on the gate hooks, when it is not the installer's own.
 *   needs       for each gate, a program the firing check needs on PATH; where it is missing that command is not fired.
 *   documented  for each gate, the label of a form never fired here (sudo), and where it comes from.
 *   silent      for each gate, why a command the reader reads as running the gate does not fire.
 */
const HAND_WRITTEN = Object.freeze([
  { id: 'live shape', ...exactShape, reader: both('own') },
  { id: 'timeout 5', ...wrappedIn('timeout 5'), reader: both('hand-wiring'), needs: both('timeout') },
  { id: 'nice -n 10', ...wrappedIn('nice -n 10'), reader: both('hand-wiring'), needs: both('nice') },
  { id: 'env FOO=1', ...wrappedIn('env FOO=1'), reader: both('hand-wiring') },
  { id: 'sudo -u x timeout 5', ...wrappedIn('sudo -u x timeout 5'), reader: both('hand-wiring'), documented: both(SUDO_RAN) },
  { id: "release gate run by '/bin/bash'", ...releaseRunBy(q('/bin/bash')), reader: { progress: 'own', release: 'hand-wiring' } },
  { id: 'release gate run by sh', ...releaseRunBy('sh'), reader: { progress: 'own', release: 'hand-wiring' } },
  { id: 'release gate run by bash5', ...releaseRunBy('bash5'), reader: { progress: 'own', release: 'hand-wiring' }, needs: { release: 'bash5' } },
  {
    id: "'/usr/bin/env' '<gate>'",
    progress: (node, gate) => `${P} ${q('/usr/bin/env')} ${q(gate)}`,
    release: (gate) => `${R} ${q('/usr/bin/env')} ${q(gate)}`,
    reader: both('hand-wiring'),
    silent: { progress: NOT_EXECUTABLE },
  },
  { id: '<shape> && echo done', ...followedBy(' && echo done'), reader: both('hand-wiring') },
  { id: '<shape>; true', ...followedBy('; true'), reader: both('hand-wiring') },
  { id: "the exact shape under another tool's describe", ...exactShape, reader: both('own'), describe: 'another-tool: checks every tool call against its own policy.' },

  // The forms from the held release reviews. First, wrapper forms the reader does not recognise, which run the gate or not.
  { id: 'nice -10', ...wrappedIn('nice -10'), reader: both('unclear'), needs: both('nice') },
  { id: 'stdbuf -oL', ...wrappedIn('stdbuf -oL'), reader: both('unclear'), needs: both('stdbuf') },
  { id: 'timeout -p 5', ...wrappedIn('timeout -p 5'), reader: both('unclear'), needs: both('timeout') },
  { id: 'time', ...wrappedIn('time'), reader: both('unclear') },
  { id: 'sudo -i', ...wrappedIn('sudo -i'), reader: both('unclear'), documented: both(SUDO_RAN) },
  { id: 'timeout --no-such-option 5', ...wrappedIn('timeout --no-such-option 5'), reader: both('unclear'), needs: both('timeout') },
  { id: 'sudo -u x timeout --no-such-option 5', ...wrappedIn('sudo -u x timeout --no-such-option 5'), reader: both('unclear'), documented: both(SUDO_UNDOCUMENTED) },
  { id: 'timeout 5x', ...wrappedIn('timeout 5x'), reader: both('unclear'), needs: both('timeout') },
  { id: 'timeout 5>/dev/null', ...wrappedIn('timeout 5>/dev/null'), reader: both('unclear'), needs: both('timeout') },
  { id: 'nice -n 2147483648', ...wrappedIn('nice -n 2147483648'), reader: both('unclear'), needs: both('nice') },
  { id: 'env -C /tmp', ...wrappedIn('env -C /tmp'), reader: both('unclear') },
  { id: 'caffeinate -z', ...wrappedIn('caffeinate -z'), reader: both('unclear'), needs: both('caffeinate') },
  { id: 'exec -a name', ...wrappedIn('exec -a name'), reader: both('unclear') },
  { id: 'command -v', ...wrappedIn('command -v'), reader: both('unclear') },
  { id: 'command -V', ...wrappedIn('command -V'), reader: both('unclear') },
  { id: 'sudo -e', ...wrappedIn('sudo -e'), reader: both('unclear'), documented: both(SUDO_RAN_NOTHING) },
  { id: 'sudo -n -u $U', ...wrappedIn('sudo -n -u $U'), reader: both('unclear'), documented: both(SUDO_RAN_NOTHING) },
  { id: 'sudo -p $P', ...wrappedIn('sudo -p $P'), reader: both('unclear'), documented: both(SUDO_RAN_NOTHING) },
  { id: 'sudo -u x*', ...wrappedIn('sudo -u x*'), reader: both('unclear'), documented: both(SUDO_RAN_NOTHING) },
  { id: 'sudo -g {a,b}', ...wrappedIn('sudo -g {a,b}'), reader: both('unclear'), documented: both(SUDO_RAN_NOTHING) },
  { id: 'sudo --user=$U', ...wrappedIn('sudo --user=$U'), reader: both('unclear'), documented: both(SUDO_RAN_NOTHING) },
  // The gate path as an option's value.
  {
    id: "timeout -s '<gate>' 5",
    progress: (node, gate) => `${P} timeout -s ${q(gate)} 5 ${q(node)} -e 0`,
    release: (gate) => `${R} timeout -s ${q(gate)} 5 bash -c true`,
    reader: both('unclear'),
    needs: both('timeout'),
  },
  {
    id: "time -o '<gate>'",
    progress: (node, gate) => `${P} time -o ${q(gate)} ${q(node)} -e 0`,
    release: (gate) => `${R} time -o ${q(gate)} bash -c true`,
    reader: both('unclear'),
  },
  // The gate as what an interpreter reads on stdin: a file, or a here-string.
  {
    id: "stdin: <interpreter> <'<gate>'",
    progress: (node, gate) => `${P} ${q(node)} <${q(gate)}`,
    release: (gate) => `${R} bash <${q(gate)}`,
    reader: both('unclear'),
  },
  {
    id: "timeout 5 <interpreter> <<< '<gate>'",
    progress: (node, gate) => `${P} timeout 5 ${q(node)} <<< ${q(gate)}`,
    release: (gate) => `${R} timeout 5 bash <<< ${q(gate)}`,
    reader: both('unclear'),
    needs: both('timeout'),
  },
  // Read as running the gate, and never handed the payload, or never run as a program.
  {
    id: "<interpreter> '<gate>' <<< '{}'",
    progress: (node, gate) => `${P} ${q(node)} ${q(gate)} <<< '{}'`,
    release: (gate) => `${R} bash ${q(gate)} <<< '{}'`,
    reader: both('hand-wiring'),
    silent: both(HERE_STRING),
  },
  {
    id: "env '<gate>'",
    progress: (node, gate) => `${P} env ${q(gate)}`,
    release: (gate) => `${R} env ${q(gate)}`,
    reader: both('hand-wiring'),
    silent: { progress: NOT_EXECUTABLE },
  },
]);

/**
 * Hooks that do not run the gate, each in a file of its own under the event its installer writes. A MENTION names the gate
 * as an argument of a program that prints, reads, lists, copies or deletes files; a WRITE TARGET names it as the file a
 * redirection writes to, which empties it. The reader reads both, and knows neither runs the gate.
 */
const NOT_RUN = Object.freeze([
  ...[
    `AGENT_SKILLS_PROGRESS_GATE=block echo ${q(packGate('progress'))}`,
    `AGENT_SKILLS_PROGRESS_GATE=block cat ${q(packGate('progress'))}`,
    `AGENT_SKILLS_PROGRESS_GATE=block grep -c decision ${q(packGate('progress'))}`,
    `AGENT_SKILLS_PROGRESS_GATE=block rm -f ${q(packGate('progress'))}`,
    `AGENT_SKILLS_PROGRESS_GATE=block cp ${q(packGate('progress'))} copy.mjs`,
    `AGENT_SKILLS_PROGRESS_GATE=block ls -l ${q(packGate('progress'))}`,
    `AGENT_SKILLS_PROGRESS_GATE=block ${q('/bin/echo')} ${q(packGate('progress'))}`,
  ].map((command) => ({ kind: 'progress', category: 'mention', command })),
  { kind: 'progress', category: 'mention', command: `AGENT_SKILLS_PROGRESS_GATE=block timeout 5 echo ${q(packGate('progress'))}`, needs: 'timeout' },
  { kind: 'progress', category: 'write target', command: `AGENT_SKILLS_PROGRESS_GATE=block timeout 5 >${q(packGate('progress'))} node -e 0`, needs: 'timeout' },
  { kind: 'progress', category: 'write target', command: `AGENT_SKILLS_PROGRESS_GATE=block node >${q(packGate('progress'))}` },
  { kind: 'progress', category: 'write target', command: `AGENT_SKILLS_PROGRESS_GATE=block env >${q(packGate('progress'))} node -e 0` },
  { kind: 'progress', category: 'write target', command: `AGENT_SKILLS_PROGRESS_GATE=block >${q(packGate('progress'))} node -e 0` },
  { kind: 'release', category: 'mention', command: `AGENT_SKILLS_RELEASE_NOTES_GATE=block shellcheck ${q(packGate('release'))}`, needs: 'shellcheck' },
  { kind: 'release', category: 'mention', command: `AGENT_SKILLS_RELEASE_NOTES_GATE=block cat ${q(packGate('release'))}` },
  { kind: 'release', category: 'mention', command: `AGENT_SKILLS_RELEASE_NOTES_GATE=block ${q('/usr/bin/shellcheck')} ${q(packGate('release'))}`, needs: '/usr/bin/shellcheck' },
  { kind: 'release', category: 'mention', command: `AGENT_SKILLS_RELEASE_NOTES_GATE=block timeout 5 echo ${q(packGate('release'))}`, needs: 'timeout' },
  { kind: 'release', category: 'write target', command: `AGENT_SKILLS_RELEASE_NOTES_GATE=block timeout 5 >${q(packGate('release'))} bash -c true`, needs: 'timeout' },
  { kind: 'release', category: 'write target', command: `AGENT_SKILLS_RELEASE_NOTES_GATE=block bash >${q(packGate('release'))}` },
  { kind: 'release', category: 'write target', command: `AGENT_SKILLS_RELEASE_NOTES_GATE=block env >${q(packGate('release'))} bash -c true` },
  { kind: 'release', category: 'write target', command: `AGENT_SKILLS_RELEASE_NOTES_GATE=block >${q(packGate('release'))} bash -c true` },
]);

const RUNS = Object.freeze({
  'bare install': [],
  '--adopt install': ['--adopt'],
  '--remove': ['--remove'],
  '--remove --adopt': ['--remove', '--adopt'],
});
const DESCRIBES = Object.freeze(['present', 'stripped']);
const isRemove = (run) => RUNS[run].includes('--remove');
const isAdopt = (run) => RUNS[run].includes('--adopt');
/** The same run with --adopt added: where point 2 lets the branch take what 0.19.0 took with no flag. */
const WITH_ADOPT = Object.freeze({ 'bare install': '--adopt install', '--remove': '--remove --adopt' });
/** 0.19.0's release-notes installer has no --adopt: the run each such row is compared with. */
const WITHOUT_ADOPT = Object.freeze({ '--adopt install': 'bare install', '--remove --adopt': '--remove' });

/** Every row the matrix declares, so a harness that builds or runs fewer cannot pass. */
const EXPECTED_ROWS = (INPUTS.length * 2 + HAND_WRITTEN.length) * DESCRIBES.length * Object.keys(KINDS).length * Object.keys(RUNS).length
  + NOT_RUN.length * DESCRIBES.length * Object.keys(RUNS).length;

const UNRELATED = 'someone-elses-hook';
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

function spawnCollect(file, args, { env, stdin, cwd, timeout }) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'], env, cwd });
    let stdout = ''; let stderr = ''; let timedOut = false;
    const timer = timeout ? setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout) : null;
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => {
      if (timer) clearTimeout(timer);
      resolve({ status, stdout, stderr, timedOut });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(stdin ?? '');
  });
}

async function inPool(items, work) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(LIMIT, items.length) }, worker));
  return results;
}

const scratch = async (name) => realpath(await mkdtemp(path.join(tmpdir(), `${name}-`)));

const allHooks = (settings) => Object.entries(settings.hooks ?? {})
  .flatMap(([event, groups]) => (Array.isArray(groups) ? groups : [])
    .flatMap((group) => (Array.isArray(group?.hooks) ? group.hooks : []).map((hook) => ({ event, matcher: group.matcher, hook }))));

function stripDescribes(settings) {
  for (const { hook } of allHooks(settings)) delete hook.describe;
  return settings;
}

/** A hook named the way an installer names it. */
function labelOf({ event, matcher }) {
  if (typeof matcher !== 'string') return `${event} (no matcher)`;
  return matcher === '' ? `${event} (matcher "")` : `${event} (matcher ${matcher})`;
}

// ---------------------------------------------------------------------------
// 0.19.0 and the binaries.
// ---------------------------------------------------------------------------

function git(...args) {
  try {
    return execFileSync('git', ['-C', REPO, ...args], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

/** 0.19.0's adapter directory in a temp directory, or null where this clone does not have its commit. */
async function checkoutV019() {
  const tagged = git('rev-parse', '--verify', '--quiet', `${V019.tag}^{commit}`);
  if (tagged === null) return null;
  assert.equal(tagged.toString().trim(), V019.commit, `${V019.tag} is not the commit this table was recorded from`);
  const adapter = path.join(await scratch('agent-skills-v0.19.0'), 'adapters', 'claude-code');
  await mkdir(adapter, { recursive: true });
  // Everything 0.19.0's two installers import: each other's gates, and nothing else.
  for (const kind of Object.values(KINDS)) {
    for (const file of [kind.installer, kind.gate]) {
      const content = git('show', `${V019.commit}:adapters/claude-code/${file}`);
      assert.ok(content, `could not read ${file} at ${V019.commit}`);
      await writeFile(path.join(adapter, file), content);
    }
  }
  return adapter;
}

/** The running Node under each name: hard links, from one copy when the temp directory is on another file system. */
async function nodeBinaries(names) {
  const dir = await scratch('ownership-v019-bin');
  let source = process.execPath;
  const binaries = {};
  for (const name of names) {
    const target = path.join(dir, name);
    try {
      await link(source, target);
    } catch (error) {
      assert.equal(source, process.execPath, `could not link a second name to the copied binary: ${error.message}`);
      source = path.join(dir, '.node-copy');
      await copyFile(process.execPath, source);
      await chmod(source, 0o755);
      await link(source, target);
    }
    binaries[name] = target;
  }
  return binaries;
}

const V019_ADAPTER = await checkoutV019();
const BINARIES = await nodeBinaries([...new Set(['node', ...INPUTS.flatMap((input) => [input.wrote, input.reran])])]);

async function loadTable() {
  try {
    return JSON.parse(await readFile(TABLE_URL, 'utf8'));
  } catch {
    return null;
  }
}
let table = await loadTable();

// ---------------------------------------------------------------------------
// Rows.
// ---------------------------------------------------------------------------

const baseSettings = () => ({
  model: 'opus',
  hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: UNRELATED }] }],
    Stop: [{ hooks: [{ type: 'command', command: UNRELATED }] }],
  },
});

function runInstaller(adapter, kind, binary, args, file, home) {
  return spawnCollect(binary, [path.join(adapter, KINDS[kind].installer), ...args, '--settings', file], { env: childEnv({ HOME: home }) });
}

/** A file both gates were installed into, in block mode and the progress gate at coverage 2, by that version under that binary. */
async function installBoth(adapter, binary) {
  const home = await scratch('ownership-v019-writer');
  const file = path.join(home, 'settings.json');
  await writeFile(file, JSON.stringify(baseSettings(), null, 2));
  for (const [kind, args] of [['progress', ['--mode', 'block', '--coverage', '2']], ['release', ['--mode', 'block']]]) {
    const result = await runInstaller(adapter, kind, binary, args, file, home);
    assert.equal(result.status, 0, `${adapter} ${kind} install under ${binary}: ${result.stderr}`);
  }
  return JSON.parse(await readFile(file, 'utf8'));
}

/** What 0.19.0 wrote, with its binary and gate paths as placeholders: the same template under every binary name. */
function toTemplate(settings, binary, adapter) {
  let text = JSON.stringify(settings);
  text = text.split(binary).join('{{NODE}}');
  for (const [kind, { gate }] of Object.entries(KINDS)) text = text.split(path.join(adapter, gate)).join(`{{${kind.toUpperCase()}_GATE}}`);
  return JSON.parse(text);
}

/** The template filled in: that binary, and this branch's gates, so both versions' re-runs read one file. */
function fromTemplate(template, binary) {
  let text = JSON.stringify(template);
  text = text.split('{{NODE}}').join(binary);
  for (const kind of Object.keys(KINDS)) text = text.split(`{{${kind.toUpperCase()}_GATE}}`).join(branchGate(kind));
  return JSON.parse(text);
}

const branchWrites = new Map();
function writtenByBranch(wrote) {
  if (!branchWrites.has(wrote)) branchWrites.set(wrote, installBoth(BRANCH_ADAPTER, BINARIES[wrote]));
  return branchWrites.get(wrote);
}

/** A hand-written file: both gates, in block mode and the progress gate at coverage 2, beside other hooks, the way the live
 *  file has them — each gate hook carrying a describe when `describe` is present. */
function handWritten(input, describe) {
  const progress = input.progress(BINARIES.node, branchGate('progress'));
  const release = input.release(branchGate('release'));
  const described = (kind) => (describe === 'present'
    ? { describe: input.describe ?? `${KINDS[kind].describePrefix} (block): recorded before a settings rewrite.` }
    : {});
  return {
    model: 'opus',
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: UNRELATED }, { type: 'command', command: release, timeout: 10, ...described('release') }] }],
      Stop: [{ hooks: [{ type: 'command', command: UNRELATED }] }, { matcher: '*', hooks: [{ type: 'command', command: progress, timeout: 10, ...described('progress') }] }],
      SubagentStart: [{ matcher: '*', hooks: [{ type: 'command', command: progress, timeout: 5, ...described('progress') }] }],
    },
  };
}

function gateHooks(settings, kind) {
  return allHooks(settings).filter(({ hook }) => typeof hook.command === 'string' && hook.command.includes(`/${KINDS[kind].gate}'`));
}

/** exit, how many hooks name the gate and in which modes, and for a NOT_RUN hook whether it is still there. */
function summarise(status, settings, kind, notRun) {
  const hooks = gateHooks(settings, kind);
  const flag = new RegExp(`(?:^|\\s)${KINDS[kind].flag}=([A-Za-z0-9]+)`);
  const modes = [...new Set(hooks.map(({ hook }) => flag.exec(hook.command)?.[1] ?? 'unset'))].sort();
  let text = `exit ${status} | ${hooksWord(hooks.length)}${modes.length > 0 ? ` (${modes.join(', ')})` : ''}`;
  if (notRun) text += ` | hook ${hooks.some(({ hook }) => isDeepStrictEqual(hook, notRun)) ? 'kept' : 'taken'}`;
  return text;
}

function parseSummary(text) {
  const match = /^exit (\d+) \| (\d+) hooks?(?: \(([^)]*)\))?(?: \| hook (kept|taken))?$/.exec(text);
  assert.ok(match, `unreadable summary: ${text}`);
  return { status: Number(match[1]), count: Number(match[2]), modes: match[3] ?? '', hook: match[4] ?? null };
}

async function buildRows(template) {
  const rows = [];
  const add = (row) => rows.push({ ...row, key: `${row.base} | ${row.run}`, startCount: gateHooks(JSON.parse(row.text), row.kind).length });

  for (const input of INPUTS) {
    const read = { ...input, reader: { progress: input.recognised ? 'own' : 'hand-wiring', release: 'own' } };
    for (const [writer, settings] of [['v0.19.0', fromTemplate(template, BINARIES[input.wrote])], ['branch', await writtenByBranch(input.wrote)]]) {
      for (const describe of DESCRIBES) {
        const start = describe === 'stripped' ? stripDescribes(structuredClone(settings)) : structuredClone(settings);
        const text = JSON.stringify(start, null, 2);
        for (const kind of Object.keys(KINDS)) {
          for (const run of Object.keys(RUNS)) {
            add({ base: `${input.id} | written by ${writer} | describe ${describe} | ${kind}`, source: 'installer', input: read, kind, run, describe, notRun: null, gatePath: branchGate(kind), text });
          }
        }
      }
    }
  }
  for (const input of HAND_WRITTEN) {
    const read = { ...input, wrote: 'node', reran: 'node' };
    for (const describe of DESCRIBES) {
      const text = JSON.stringify(handWritten(input, describe), null, 2);
      for (const kind of Object.keys(KINDS)) {
        for (const run of Object.keys(RUNS)) {
          add({ base: `${input.id} | written by hand | describe ${describe} | ${kind}`, source: 'hand', input: read, kind, run, describe, notRun: null, gatePath: branchGate(kind), text });
        }
      }
    }
  }
  for (const entry of NOT_RUN) {
    const { kind, category, command } = entry;
    const read = { id: category, wrote: 'node', reran: 'node', needs: entry.needs ? { [kind]: entry.needs } : undefined };
    for (const describe of DESCRIBES) {
      const hook = { type: 'command', command, ...(describe === 'present' ? { describe: `${KINDS[kind].describePrefix} (block): recorded before a settings rewrite.` } : {}) };
      const text = JSON.stringify({ model: 'opus', hooks: { [KINDS[kind].event]: [{ matcher: KINDS[kind].matcher, hooks: [{ type: 'command', command: UNRELATED }, hook] }] } }, null, 2);
      for (const run of Object.keys(RUNS)) {
        add({ base: `${category} ${command} | describe ${describe} | ${kind}`, source: 'not run', input: read, kind, run, describe, notRun: hook, gatePath: packGate(kind), text });
      }
    }
  }
  return rows;
}

async function runRow(adapter, row) {
  const home = await scratch('ownership-v019-row');
  const file = path.join(home, 'settings.json');
  await writeFile(file, row.text);
  const result = await runInstaller(adapter, row.kind, BINARIES[row.input.reran], RUNS[row.run], file, home);
  const text = await readFile(file, 'utf8');
  const settings = JSON.parse(text);
  return { result, text, settings, summary: summarise(result.status, settings, row.kind, row.notRun) };
}

/** What the branch's reader makes of this row's gate hooks: ours, adoptable, unclear, foreign, or none. Stated as the rule. */
function readingOf(row) {
  if (row.notRun) return 'none';
  if (row.describe === 'present' && row.input.describe) return 'foreign';
  const reader = row.input.reader[row.kind];
  if (reader === 'unclear') return 'unclear';
  return reader === 'own' || row.describe === 'present' ? 'ours' : 'adoptable';
}

/** What --adopt takes a hook the reader cannot fully read on, stated here rather than read from the reader: this gate's
 *  arming variable among the command's leading assignments, and the gate path, single-quoted, as a word of its own or as the
 *  file a `<` reads. */
function carriesOverrideEvidence(command, kind, gatePath) {
  const lead = new RegExp(`^(?:[A-Za-z_][A-Za-z0-9_]*=\\S*\\s+)*${KINDS[kind].flag}=\\S*\\s`);
  const word = new RegExp(`(?:^|\\s|<)${escapeRegExp(q(gatePath))}(?=\\s|$)`);
  return lead.test(command) && word.test(command);
}

/** What the branch does on a row, stated as the rule rather than recorded. */
function expectedBranch(row) {
  const { kind } = row;
  const remove = isRemove(row.run);
  const adopt = isAdopt(row.run);
  const reading = readingOf(row);
  if (reading === 'none') {
    // Never taken; an install writes a new gate beside it, in observe at coverage 1, because nothing of the gate is installed.
    return remove ? 'exit 0 | 1 hook (block) | hook kept' : `exit 0 | ${hooksWord(1 + KINDS[kind].fresh)} (block, observe) | hook kept`;
  }
  const taken = reading === 'ours' || (adopt && (reading === 'adoptable' || reading === 'unclear'));
  if (taken) return remove ? 'exit 0 | 0 hooks' : `exit 0 | ${hooksWord(KINDS[kind].full)} (block)`;
  return `exit 1 | ${hooksWord(row.startCount)} (block)`;
}

/** Whether a version took or removed the gate's hooks on a row and exited 0. An install that exits 0 over a start file holding
 *  gate hooks replaced them: neither version stacks a gate beside a gate hook it will not take. */
function took(outcome, row) {
  if (outcome.status !== 0) return false;
  if (row.notRun) return outcome.hook === 'taken';
  return isRemove(row.run) ? outcome.count < row.startCount : true;
}

/** Whether the branch took or removed, on a row, what 0.19.0 took or removed there. */
function didTheSame(after, before, row) {
  if (after.status !== 0) return false;
  if (row.notRun) return after.hook === 'taken';
  return isRemove(row.run) ? after.count <= before.count : after.count === KINDS[row.kind].full;
}

// ---------------------------------------------------------------------------
// Firing a start command against a stand-in gate.
// ---------------------------------------------------------------------------

/** What the stand-in looks for on stdin: only a hook's payload carries it. */
const PAYLOAD_MARK = 'agent-skills-matrix-payload';
/** Stand-ins that write their marker only when handed the payload on stdin. Each is in its own temp directory and knows its
 *  marker's absolute path, so an emptied environment (`env -i`) or another working directory changes nothing. */
const STAND_INS = Object.freeze({
  progress: (marker) => [
    '#!/usr/bin/env node',
    "import { readFileSync, writeFileSync } from 'node:fs';",
    "let input = '';",
    "try { input = readFileSync(0, 'utf8'); } catch {}",
    `if (input.includes(${JSON.stringify(PAYLOAD_MARK)})) writeFileSync(${JSON.stringify(marker)}, 'fired');`,
    '',
  ].join('\n'),
  release: (marker) => [
    '#!/bin/sh',
    'input=$(cat)',
    `case $input in *${PAYLOAD_MARK}*) printf fired > ${q(marker)} ;; esac`,
    '',
  ].join('\n'),
});

const firingKey = (kind, command) => `${kind}\n${command}`;
const firingEnv = () => childEnv({ PATH: [path.dirname(BINARIES.node), process.env.PATH].filter(Boolean).join(path.delimiter) });

const onPath = new Map();
function installedHere(program) {
  if (!onPath.has(program)) {
    onPath.set(program, spawnCollect('/bin/sh', ['-c', `command -v ${q(program)}`], { env: firingEnv() }).then((result) => result.status === 0));
  }
  return onPath.get(program);
}

const gateMode = async (kind) => (await stat(branchGate(kind))).mode & 0o777;
async function gateHashes() {
  const entries = [];
  for (const kind of Object.keys(KINDS)) entries.push([kind, createHash('sha256').update(await readFile(branchGate(kind))).digest('hex')]);
  return Object.fromEntries(entries);
}

async function fireOne(check) {
  if (/(?:^|[\s;&|(`])sudo\s/.test(check.command)) {
    assert.ok(check.documented, `refusing to run sudo to label a form with no documented run: ${check.command}`);
  }
  if (check.documented) return { state: 'documented', fires: check.documented.fires, why: check.documented.why };
  if (check.needs && !(await installedHere(check.needs))) return { state: 'not fired', fires: null, why: `${check.needs} is not installed here` };
  const dir = await scratch('ownership-v019-standin');
  const standIn = path.join(dir, KINDS[check.kind].gate);
  const marker = path.join(dir, 'fired');
  await writeFile(standIn, STAND_INS[check.kind](marker));
  await chmod(standIn, await gateMode(check.kind));
  const command = check.command.split(check.gatePath).join(standIn);
  assert.ok(command.includes(standIn) && !command.includes(branchGate(check.kind)), `the stand-in did not take the gate's place in: ${check.command}`);
  const payload = JSON.stringify({ hook_event_name: KINDS[check.kind].event, session_id: 'sess-matrix-standin', token: PAYLOAD_MARK });
  const result = await spawnCollect('/bin/sh', ['-c', command], { env: firingEnv(), stdin: payload, cwd: dir, timeout: FIRE_TIMEOUT_MS });
  if (result.timedOut) return { state: 'timed out', fires: null, why: `killed after ${FIRE_TIMEOUT_MS} ms` };
  return existsSync(marker) ? { state: 'fired', fires: true, why: null } : { state: 'silent', fires: false, why: null };
}

/** Every distinct start command, fired once, with the reading and labels its rows state. The real gates must not change. */
async function fireStartCommands(rows) {
  const checks = new Map();
  for (const row of rows) {
    for (const { hook } of gateHooks(JSON.parse(row.text), row.kind)) {
      const check = {
        key: firingKey(row.kind, hook.command),
        kind: row.kind,
        id: row.input.id,
        command: hook.command,
        gatePath: row.gatePath,
        reader: row.notRun ? 'none' : row.input.reader[row.kind],
        needs: row.input.needs?.[row.kind] ?? null,
        documented: row.input.documented?.[row.kind] ?? null,
        silent: row.input.silent?.[row.kind] ?? null,
      };
      const seen = checks.get(check.key);
      if (seen) {
        assert.deepEqual([seen.reader, seen.needs, seen.documented, seen.silent], [check.reader, check.needs, check.documented, check.silent], `two rows state different things about one start command: ${hook.command}`);
      } else {
        checks.set(check.key, check);
      }
    }
  }
  const list = [...checks.values()];
  const before = await gateHashes();
  const results = await inPool(list, fireOne);
  assert.deepEqual(await gateHashes(), before, 'firing a start command changed a real gate file');
  return new Map(list.map((check, index) => [check.key, { ...check, ...results[index] }]));
}

function firingLabel(check) {
  if (check.state === 'fired') return 'fired here';
  if (check.state === 'silent') return 'did not fire here';
  if (check.fires === true) return 'ran, by a documented run';
  if (check.fires === false) return 'ran nothing, by a documented run';
  return 'not fired';
}

// ---------------------------------------------------------------------------
// Running a written gate the way the harness does, against the real gate.
// ---------------------------------------------------------------------------

const BAD_REPORT = 'Great progress! Things are moving along nicely and the background agent should be wrapping up shortly.';
const onlyCommand = (settings, kind, event, matcher) => {
  const found = gateHooks(settings, kind).filter((entry) => entry.event === event && entry.matcher === matcher);
  assert.equal(found.length, 1, `expected one ${kind} gate hook under ${event} (matcher ${matcher}), found ${found.length}`);
  return found[0].hook.command;
};
const sh = (command, payload, extra = {}) => spawnCollect('/bin/sh', ['-c', command], { env: childEnv(extra), stdin: JSON.stringify(payload) });

/** The JSON object a hook printed, wherever it sits in its stdout — a compound command may print after it — or null. */
function printed(stdout) {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end < start) return null;
  try {
    return JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function progressFires([arm, stop]) {
  const markers = await scratch('ownership-v019-markers');
  const env = { AGENT_SKILLS_PROGRESS_GATE_DIR: markers };
  await sh(arm, { hook_event_name: 'SubagentStart', session_id: 'sess-matrix', agent_id: 'a1', agent_type: 'general-purpose' }, env);
  const stopped = await sh(stop, { hook_event_name: 'Stop', session_id: 'sess-matrix', stop_hook_active: false, last_assistant_message: BAD_REPORT }, env);
  return printed(stopped.stdout)?.decision === 'block';
}

let releaseProject = null;
async function releaseFires([command]) {
  if (releaseProject === null) {
    releaseProject = await scratch('ownership-v019-project');
    await writeFile(path.join(releaseProject, 'package.json'), `${JSON.stringify({ name: '@acme/cli', version: '1.4.0' }, null, 2)}\n`);
    await writeFile(path.join(releaseProject, 'CHANGELOG.md'), '# Releases\n\n## 1.3.0\n\nwhat / why / impact\n');
  }
  const verb = ['pub', 'lish'].join('');
  const result = await sh(command, { hook_event_name: 'PreToolUse', session_id: 'sess-matrix', tool_name: 'Bash', cwd: releaseProject, tool_input: { command: `npm ${verb}` } });
  return printed(result.stdout)?.hookSpecificOutput?.permissionDecision === 'deny';
}

const fires = ({ kind, commands }) => (kind === 'progress' ? progressFires(commands) : releaseFires(commands));

const firingCommands = (settings, kind) => (kind === 'progress'
  ? [onlyCommand(settings, 'progress', 'SubagentStart', '*'), onlyCommand(settings, 'progress', 'Stop', '*')]
  : [onlyCommand(settings, 'release', 'PreToolUse', 'Bash')]);

// ---------------------------------------------------------------------------
// The tests.
// ---------------------------------------------------------------------------

test('what 0.19.0 does, row by row, is the recorded table: re-derived from its own installers', { skip: V019_ADAPTER ? false : `this clone does not have ${V019.tag} (${V019.commit}); the branch is held to the table recorded from it` }, async (t) => {
  const templates = [];
  for (const wrote of [...new Set(INPUTS.map((input) => input.wrote))]) {
    templates.push([wrote, toTemplate(await installBoth(V019_ADAPTER, BINARIES[wrote]), BINARIES[wrote], V019_ADAPTER)]);
  }
  for (const [wrote, template] of templates.slice(1)) assert.deepEqual(template, templates[0][1], `0.19.0 wrote a different shape under ${wrote}`);
  const template = templates[0][1];
  if (!RECORDING) assert.deepEqual(template, table?.writes, 'what 0.19.0 writes is not the recorded template');

  const rows = await buildRows(template);
  assert.equal(rows.length, EXPECTED_ROWS, 'the matrix did not build every row it declares');
  const runs = await inPool(rows, (row) => runRow(V019_ADAPTER, row));
  const outcomes = Object.fromEntries(rows.map((row, index) => [row.key, runs[index].summary]));
  assert.equal(Object.keys(outcomes).length, EXPECTED_ROWS, 'two rows share a key, or a row did not run');

  // 0.19.0's release-notes installer has no --adopt. Those rows are compared with its nearest equivalent run (the header),
  // which is only honest while 0.19.0 refuses the argument on every one of them and leaves the file alone.
  const withAdopt = rows.map((row, index) => ({ row, run: runs[index] })).filter(({ row }) => row.kind === 'release' && isAdopt(row.run));
  const accepted = withAdopt.filter(({ row, run }) => !(run.result.status === 1 && /unknown argument: --adopt/.test(run.result.stderr) && run.text === row.text));
  assert.ok(withAdopt.length > 0, 'no release-notes row passes --adopt');
  assert.deepEqual(accepted.map(({ row }) => row.key), [], "0.19.0's release-notes installer did not refuse --adopt on these rows");

  if (RECORDING) {
    table = {
      about: `What ${V019.tag} (${V019.commit}) does on every row of test/hook-ownership-v0.19.0.test.mjs, recorded from its real installers. Placeholders in "writes" stand for the Node binary and each gate's path. Re-record with AGENT_SKILLS_RECORD_V019_TABLE=1.`,
      commit: V019.commit,
      writes: template,
      outcomes,
    };
    await writeFile(TABLE_URL, `${JSON.stringify(table, null, 2)}\n`);
  }
  assert.deepEqual(outcomes, table.outcomes, '0.19.0 no longer does what the recorded table says');
  t.diagnostic(`${rows.length} rows run through 0.19.0's installers${RECORDING ? ', and recorded' : ''}; its release-notes installer refused --adopt as an unknown argument, leaving the file alone, on all ${withAdopt.length} rows that pass it`);
});

test('the branch against 0.19.0, row by row, held to the release bar: every point on every row, and every row in one count', async (t) => {
  assert.ok(table, `no recorded table at ${fileURLToPath(TABLE_URL)}`);
  const rows = await buildRows(table.writes);
  assert.equal(rows.length, EXPECTED_ROWS, 'the matrix did not build every row it declares');
  assert.deepEqual(rows.map((row) => row.key).sort(), Object.keys(table.outcomes).sort(), 'the rows and the recorded table are not the same rows');
  const runs = await inPool(rows, (row) => runRow(BRANCH_ADAPTER, row));
  assert.equal(runs.filter((run) => typeof run?.summary === 'string').length, rows.length, 'a row did not run');
  const branchSummary = new Map(rows.map((row, index) => [row.key, runs[index].summary]));

  // Whether each start file's hooks run the gate: fired, not written down.
  const firing = await fireStartCommands(rows);

  // Every row is checked before anything fails, so a regression reads as the full list of rows it touches.
  const problems = [];
  const tally = { same: 0, better: 0, withAdopt: 0, neverTaken: 0, exitsOne: 0 };
  const points = { noFlagUnclear: 0, tookOver: 0, notRun: 0, releaseRemoveLeft: 0, comparedWithEquivalent: 0 };
  const leftBy = {};
  const written = new Map();
  for (const [index, row] of rows.entries()) {
    const run = runs[index];
    const start = JSON.parse(row.text);
    const startGate = gateHooks(start, row.kind);
    const reading = readingOf(row);
    const remove = isRemove(row.run);
    const adopt = isAdopt(row.run);
    // 0.19.0's release-notes installer has no --adopt, so its nearest equivalent run stands in (the header).
    const equivalent = row.kind === 'release' && adopt ? WITHOUT_ADOPT[row.run] : null;
    const beforeText = table.outcomes[equivalent ? `${row.base} | ${equivalent}` : row.key];
    const before = parseSummary(beforeText);
    const after = parseSummary(run.summary);
    const output = `${run.result.stdout}${run.result.stderr}`;
    const failed = (why) => problems.push(`${row.key}\n    ${why}\n    0.19.0${equivalent ? ` (${equivalent}, its nearest equivalent run)` : ''}: ${beforeText}\n    branch: ${run.summary}${run.result.stderr ? `\n    stderr: ${run.result.stderr.split('\n').slice(0, 2).join(' / ')}` : ''}`);
    if (equivalent) {
      points.comparedWithEquivalent += 1;
      if (parseSummary(table.outcomes[row.key]).status !== 1) failed("0.19.0's release-notes installer is recorded accepting --adopt, so its run without it is not the nearest equivalent");
    }

    // What this test states the reader makes of each start hook is what the reader makes of it.
    const identity = row.kind === 'progress'
      ? { ...PROGRESS_IDENTITY, interpreter: { ...PROGRESS_IDENTITY.interpreter, names: [row.input.reran] } }
      : RELEASE_IDENTITY;
    for (const { hook } of startGate) {
      const actual = classifyHook(hook, identity) ?? 'none';
      if (actual !== reading) failed(`the reader reads a start hook as ${actual}, and this test states ${reading}`);
      if (reading === 'unclear' && !carriesOverrideEvidence(hook.command, row.kind, row.gatePath)) {
        failed("a hook stated unclear does not set this gate's own variable and name its path, which is what --adopt takes such a hook on");
      }
    }

    if (run.summary !== expectedBranch(row)) failed(`expected ${expectedBranch(row)}`);
    const unrelated = (settings) => allHooks(settings).filter(({ hook }) => hook.command === UNRELATED).length;
    if (unrelated(run.settings) !== unrelated(start) || run.settings.model !== 'opus') failed('the branch took or changed a hook that is not the gate');
    if (!isDeepStrictEqual(gateHooks(run.settings, OTHER[row.kind]), gateHooks(start, OTHER[row.kind]))) failed(`the ${row.kind} installer changed the ${OTHER[row.kind]} gate's hooks`);
    if (after.status !== 0 && run.text !== row.text) failed('a run that failed changed the file');

    // POINT 1: a run with no flag never takes a hook the reader cannot fully read, with or without its own describe.
    if (!adopt && reading === 'unclear') {
      points.noFlagUnclear += 1;
      const left = gateHooks(run.settings, row.kind);
      const kept = startGate.filter(({ hook }) => left.some((entry) => isDeepStrictEqual(entry.hook, hook))).length;
      if (after.status !== 1 || kept !== startGate.length || run.text !== row.text) failed('POINT 1: a run with no flag took or changed a hook the reader cannot fully read');
    }
    // …and --adopt says so, naming each by event and matcher, whenever it takes one.
    const tookOverLine = `Took over ${hooksWord(startGate.length)} this installer could not fully read: ${startGate.map(labelOf).join(', ')}.`;
    if (adopt && reading === 'unclear') {
      points.tookOver += 1;
      if (!run.result.stdout.split('\n').includes(tookOverLine)) failed(`--adopt took hooks it could not fully read without printing: ${tookOverLine}`);
    } else if (/Took over/.test(output)) {
      failed('said it took over a hook it could not fully read, on a row where it took none');
    }
    // POINT 3: a hook the reader knows does not run the gate is never taken, with any flag.
    if (row.notRun) {
      points.notRun += 1;
      if (after.status !== 0 || after.hook !== 'kept') failed(`POINT 3: took, or failed over, a ${row.input.id}, which never runs the gate`);
    }
    // POINT 4: the release-notes --remove exits 1 while it leaves a hook that runs the gate, or may.
    if (row.kind === 'release' && remove && !row.notRun && after.count > 0) {
      points.releaseRemoveLeft += 1;
      const label = firingLabel(firing.get(firingKey('release', startGate[0].hook.command)));
      leftBy[label] = (leftBy[label] ?? 0) + 1;
      if (after.status !== 1 || /No release-notes gate was installed/.test(output) || !output.includes(KINDS.release.label)) {
        failed('POINT 4: the release-notes --remove left a hook that runs the gate, or may, and did not exit 1 naming it');
      }
    }

    // Every row in exactly one count. Where 0.19.0 did better, the row is (2), (3) or (4), or it fails.
    if (took(before, row) && !didTheSame(after, before, row)) {
      if (row.notRun) {
        if (after.status === 0 && after.hook === 'kept') tally.neverTaken += 1;
        else failed('0.19.0 took this hook, and the branch neither took it nor left it and succeeded');
      } else if (!adopt && didTheSame(parseSummary(branchSummary.get(`${row.base} | ${WITH_ADOPT[row.run]}`)), before, row)) {
        tally.withAdopt += 1;
      } else {
        failed(`POINT 2: 0.19.0 took or removed the gate here, and the branch does not${adopt ? '' : ', with these flags or with --adopt added'}`);
      }
    } else if (before.status === 0 && after.status !== 0) {
      if (row.kind === 'release' && remove && !row.notRun && after.status === 1 && after.count === before.count && run.text === row.text && /the gate is not gone/.test(output)) {
        tally.exitsOne += 1;
      } else {
        failed('0.19.0 exited 0 here, and the branch did not');
      }
    } else if (run.summary === beforeText) {
      tally.same += 1;
    } else {
      tally.better += 1;
    }

    if (row.notRun) continue;
    const named = reading === 'unclear' && !adopt;
    if (/cannot tell whether/.test(output) !== named) {
      failed(named ? 'a hook the reader cannot fully read was left without being named as one it cannot tell runs the gate' : 'a hook was named as one the reader cannot tell runs the gate, on a row that did not leave one');
    }
    // Only a row that did what it should: one that stacked a second gate is already a problem above, and must be listed with
    // the rest rather than stop the loop here.
    if (!remove && after.status === 0 && run.summary === expectedBranch(row)) {
      if (!/^Kept mode block \((already installed in this file|read from the adopted hook)\)\. Pass --mode observe to change it\.$/m.test(run.result.stdout)) failed('a re-run with no --mode did not say it kept block mode');
      if (after.modes === 'block') {
        const commands = firingCommands(run.settings, row.kind);
        written.set(`${row.kind}\n${commands.join('\n')}`, { kind: row.kind, commands, context: `what the branch wrote on ${row.key}` });
      }
    }
  }
  assert.deepEqual(problems, [], `${problems.length} problems over ${rows.length} rows:\n${problems.join('\n')}`);
  assert.equal(Object.values(tally).reduce((sum, count) => sum + count, 0), rows.length, 'a row was neither compared nor counted');
  for (const [name, count] of Object.entries({ ...tally, ...points })) assert.ok(count > 0, `no row was counted as ${name}, so that part of the bar was never compared`);

  // The firing, held against the reader.
  const firingProblems = [];
  const states = { fired: 0, silent: 0, documented: 0, 'not fired': 0 };
  const labelled = new Map();
  const unclearRan = new Set();
  let silentAsDeclared = 0;
  for (const check of firing.values()) {
    if (!Object.hasOwn(states, check.state)) {
      firingProblems.push(`${check.kind} start command ${check.state} (${check.why}): ${check.command}`);
      continue;
    }
    states[check.state] += 1;
    if (check.why) labelled.set(check.why, [...(labelled.get(check.why) ?? []), `${check.kind} ${check.id}`]);
    if (check.reader === 'none') {
      if (check.fires === true) firingProblems.push(`POINT 3: a hook the reader knows does not run the gate fired: ${check.command}`);
    } else if (check.reader === 'unclear') {
      if (check.fires === true) unclearRan.add(`${check.kind} ${check.id}${check.state === 'documented' ? ' (documented)' : ''}`);
    } else if (check.fires !== null) {
      if (check.silent && check.fires) firingProblems.push(`declared silent (${check.silent}), and it fired: ${check.command}`);
      if (!check.silent && !check.fires) firingProblems.push(`the reader reads this as running the gate, and it did not fire: ${check.command}`);
      if (check.silent && check.state === 'silent') silentAsDeclared += 1;
    }
  }
  assert.deepEqual(firingProblems, [], firingProblems.join('\n'));
  assert.equal(Object.values(states).reduce((sum, count) => sum + count, 0), firing.size, 'a start command was neither fired nor labelled');
  assert.ok(states.fired > 0 && states.silent > 0 && states.documented > 0, `the firing check did not exercise every outcome: ${JSON.stringify(states)}`);
  assert.ok(silentAsDeclared > 0, 'no command declared silent was fired to show it');

  const writtenChecks = [...written.values()];
  const writtenFired = await inPool(writtenChecks, fires);
  const silent = writtenChecks.filter((_, index) => writtenFired[index] !== true).map(({ kind, context }) => `the ${kind} gate looks installed and never fires: ${context}`);
  assert.deepEqual(silent, [], silent.join('\n'));
  assert.ok(writtenChecks.length > 0, 'no gate the branch wrote was fired');

  const bySource = (source) => rows.filter((row) => row.source === source).length;
  t.diagnostic(`${rows.length} rows (${bySource('installer')} from installer-written files, ${bySource('hand')} hand-written, ${bySource('not run')} over a hook that does not run the gate)`);
  t.diagnostic(`counts: the same as 0.19.0 ${tally.same}; better ${tally.better}; (2) taken only with --adopt added ${tally.withAdopt}; (3) never taken ${tally.neverTaken}; (4) release --remove exits 1 over a hook both versions leave ${tally.exitsOne}`);
  t.diagnostic(`points: (1) no-flag rows over a hook the reader cannot fully read, none taken ${points.noFlagUnclear}; --adopt rows that took such a hook and said so ${points.tookOver}; (3) rows over a mention or write target, none taken ${points.notRun}; (4) release --remove rows leaving a gate hook, all exit 1 ${points.releaseRemoveLeft} (${Object.entries(leftBy).map(([label, count]) => `${label}: ${count}`).join(', ')}); release-notes --adopt rows compared with 0.19.0's nearest equivalent run ${points.comparedWithEquivalent}`);
  t.diagnostic(`start commands: ${firing.size} (fired ${states.fired}, did not fire ${states.silent}, labelled from a documented run ${states.documented}, not fired ${states['not fired']}; ${silentAsDeclared} declared silent and shown so); the reader cannot fully read these, and they ran: ${[...unclearRan].join('; ') || 'none'}`);
  t.diagnostic(`labels not from a firing here: ${[...labelled].map(([why, which]) => `${which.join(', ')} — ${why}`).join('; ')}`);
  t.diagnostic(`${writtenChecks.length} distinct gates the branch wrote fired against the real gate`);
});
