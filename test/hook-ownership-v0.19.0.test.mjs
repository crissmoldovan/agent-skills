import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmod, copyFile, link, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Never worse than 0.19.0, row by row.
//
// 0.19.0 recognised a gate installer's hooks by `describe`. This branch recognises them by their command,
// because Claude Code drops `describe` whenever it rewrites a settings file. Two held releases measured the
// cost of reading a command wrong: an installer run under a Node binary with one name refused, even under
// `--adopt`, the hooks written under another name; and a hook that wrapped the gate in `timeout 5` read as
// unclear, which no flag takes, where 0.19.0 took it by its describe, or under `--adopt` without one.
//
// So every row below runs 0.19.0's REAL installers and this branch's on byte-identical temp files:
//   - who wrote the file: 0.19.0's installer or this branch's, under a Node binary called `wrote`; or a
//     hand-written file (HAND_WRITTEN): the live shape; the gate wrapped in `timeout 5`, `nice -n 10`,
//     `env FOO=1`, a nested `sudo -u x timeout 5`, or a wrapper option the reader does not pin; the release gate
//     run by `'/bin/bash'`, `sh` or a renamed shell; the gate run by `'/usr/bin/env'`; the exact shape followed
//     by `&& echo done` or `; true`, or under another tool's describe; or a hook that only mentions the gate file;
//   - describe present, or stripped the way a settings rewrite strips it;
//   - which installer re-runs it, under a Node binary called `reran`;
//   - the four re-runs: a bare install, `--adopt`, `--remove`, `--remove --adopt`.
// The branch must never do worse than 0.19.0: never refuse, or leave a gate, where 0.19.0 succeeded, and never
// take a hook 0.19.0 left alone. Three kinds of row are declared exceptions, each asserted as its own kind and
// counted:
//   (a) a hook that only MENTIONS the gate file is never taken, where 0.19.0's `--adopt`, and its describe,
//       took it;
//   (b) the release-notes installer's `--remove` exits 1, not 0, when it leaves a hook that runs the gate, or
//       may: both versions leave the same hooks, and 0.19.0 printed "No release-notes gate was installed" over
//       that hook;
//   (c) a wrapper form the reader does not pin is refused, named as a hook it cannot tell runs the gate, and
//       left byte for byte, where 0.19.0 took it. The form used, `timeout --no-such-option 5`, is one every
//       `timeout` measured rejects without running anything, and this test runs it to show that — but the reader
//       does not know it, which is the point: it never guesses past a wrapper.
// Any other row where 0.19.0 did better fails.
//
// 0.19.0 comes from git (`git show <commit>:<file>` for the four files its installers load, into a temp
// directory: nothing is added to the repository's worktree list and nothing is left to clean up). A shallow
// clone does not have that commit, so what 0.19.0 does is also kept as a table recorded from real runs,
// fixtures/hook-ownership-v0.19.0.json. The first test re-derives the table from 0.19.0 wherever the commit
// is present and fails if the two disagree; the second holds the branch to it everywhere.
// Re-record: AGENT_SKILLS_RECORD_V019_TABLE=1 node --test test/hook-ownership-v0.19.0.test.mjs
//
// Every binary is the running Node under another name (a hard link, so `process.execPath` carries that
// name), and every run has HOME and --settings in a temp directory. Every gate the branch leaves installed,
// and every gate in a file a row starts from that can be run here, is run from its written command through
// /bin/sh with the ambient gate variables cleared: a gate that looks installed and never fires fails, and so
// does the unpinned wrapper firing.
// ---------------------------------------------------------------------------

const REPO = fileURLToPath(new URL('..', import.meta.url));
const V019 = Object.freeze({ tag: 'v0.19.0', commit: '8a40f2a4e7a59ca1f0a49cf052f856d6f37b0353' });
const TABLE_URL = new URL('./fixtures/hook-ownership-v0.19.0.json', import.meta.url);
const RECORDING = process.env.AGENT_SKILLS_RECORD_V019_TABLE === '1';
const LIMIT = Math.max(2, Math.min(6, Math.floor(availableParallelism() / 2)));

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

/** How both installers quote a word into a command. */
const q = (value) => `'${String(value).split("'").join(`'\\''`)}'`;
const both = (value) => Object.freeze({ progress: value, release: value });

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

/**
 * Hand-written files: both gates at block and coverage 2, beside hooks nobody here wrote, each command built from the
 * `node` binary and this branch's gate paths.
 *   shape     for each gate, what its command is to the branch's reader: `own`, the installer's exact shape with the
 *             interpreter it writes; `runs`, a command that runs the gate in any other shape; `unpinned`, a wrapper form
 *             the reader does not pin.
 *   describe  what "describe present" puts on the gate hooks, when it is not the installer's own.
 *   fires     for each gate, whether the file's own hook fires when run as written — true or false — or why it is not
 *             run here. `needs` is a program the check needs on PATH; where it is missing the check is not run, and
 *             says so.
 */
const HAND_WRITTEN = Object.freeze([
  { id: 'live shape', ...exactShape, shape: both('own'), fires: both(true) },
  { id: 'timeout 5', ...wrappedIn('timeout 5'), shape: both('runs'), fires: both(true), needs: 'timeout' },
  { id: 'nice -n 10', ...wrappedIn('nice -n 10'), shape: both('runs'), fires: both(true), needs: 'nice' },
  { id: 'env FOO=1', ...wrappedIn('env FOO=1'), shape: both('runs'), fires: both(true), needs: 'env' },
  { id: 'sudo -u x timeout 5', ...wrappedIn('sudo -u x timeout 5'), shape: both('runs'), fires: both('no test runs sudo') },
  { id: 'timeout --no-such-option 5', ...wrappedIn('timeout --no-such-option 5'), shape: both('unpinned'), fires: both(false) },
  { id: "release gate run by '/bin/bash'", ...releaseRunBy(q('/bin/bash')), shape: { progress: 'own', release: 'runs' }, fires: both(true) },
  { id: 'release gate run by sh', ...releaseRunBy('sh'), shape: { progress: 'own', release: 'runs' }, fires: { progress: true, release: 'sh is dash on Debian and Ubuntu, and the gate is a bash script' } },
  { id: 'release gate run by bash5', ...releaseRunBy('bash5'), shape: { progress: 'own', release: 'runs' }, fires: { progress: true, release: 'no machine this runs on is known to have a bash5' } },
  {
    id: "'/usr/bin/env' '<gate>'",
    progress: (node, gate) => `${P} ${q('/usr/bin/env')} ${q(gate)}`,
    release: (gate) => `${R} ${q('/usr/bin/env')} ${q(gate)}`,
    shape: both('runs'),
    fires: { progress: 'the progress gate is not executable in a checkout (git mode 100644)', release: true },
  },
  { id: '<shape> && echo done', ...followedBy(' && echo done'), shape: both('runs'), fires: both(true) },
  { id: '<shape>; true', ...followedBy('; true'), shape: both('runs'), fires: both(true) },
  { id: "the exact shape under another tool's describe", ...exactShape, shape: both('own'), describe: 'another-tool: checks every tool call against its own policy.', fires: both(true) },
]);

const RUNS = Object.freeze({
  'bare install': [],
  '--adopt install': ['--adopt'],
  '--remove': ['--remove'],
  '--remove --adopt': ['--remove', '--adopt'],
});
const DESCRIBES = Object.freeze(['present', 'stripped']);

/** Hooks that only MENTION a gate file. Their paths are not the real gates': nothing here is ever run. */
const MENTIONS = Object.freeze({
  progress: Object.freeze([
    "AGENT_SKILLS_PROGRESS_GATE=block echo '/pack/adapters/claude-code/report-progress-gate.mjs'",
    "AGENT_SKILLS_PROGRESS_GATE=block cat '/pack/adapters/claude-code/report-progress-gate.mjs'",
    "AGENT_SKILLS_PROGRESS_GATE=block grep -c decision '/pack/adapters/claude-code/report-progress-gate.mjs'",
    "AGENT_SKILLS_PROGRESS_GATE=block rm -f '/pack/adapters/claude-code/report-progress-gate.mjs'",
    "AGENT_SKILLS_PROGRESS_GATE=block cp '/pack/adapters/claude-code/report-progress-gate.mjs' /tmp/copy.mjs",
    "AGENT_SKILLS_PROGRESS_GATE=block ls -l '/pack/adapters/claude-code/report-progress-gate.mjs'",
    "AGENT_SKILLS_PROGRESS_GATE=block '/bin/echo' '/pack/adapters/claude-code/report-progress-gate.mjs'",
  ]),
  release: Object.freeze([
    "AGENT_SKILLS_RELEASE_NOTES_GATE=block shellcheck '/pack/adapters/claude-code/release-notes-gate.sh'",
    "AGENT_SKILLS_RELEASE_NOTES_GATE=block cat '/pack/adapters/claude-code/release-notes-gate.sh'",
    "AGENT_SKILLS_RELEASE_NOTES_GATE=block '/usr/bin/shellcheck' '/pack/adapters/claude-code/release-notes-gate.sh'",
  ]),
});

/** Every row the matrix declares, so a harness that builds or runs fewer cannot pass. */
const EXPECTED_ROWS = (INPUTS.length * 2 + HAND_WRITTEN.length) * DESCRIBES.length * Object.keys(KINDS).length * Object.keys(RUNS).length
  + Object.values(MENTIONS).flat().length * DESCRIBES.length * Object.keys(RUNS).length;

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

/** exit, how many hooks name the gate and in which modes, and for a mention whether it is still there. */
function summarise(status, settings, kind, mention) {
  const hooks = gateHooks(settings, kind);
  const flag = new RegExp(`(?:^|\\s)${KINDS[kind].flag}=([A-Za-z0-9]+)`);
  const modes = [...new Set(hooks.map(({ hook }) => flag.exec(hook.command)?.[1] ?? 'unset'))].sort();
  let text = `exit ${status} | ${hooks.length} hook${hooks.length === 1 ? '' : 's'}${modes.length > 0 ? ` (${modes.join(', ')})` : ''}`;
  if (mention) text += ` | mention ${hooks.some(({ hook }) => isDeepStrictEqual(hook, mention)) ? 'kept' : 'taken'}`;
  return text;
}

function parseSummary(text) {
  const match = /^exit (\d+) \| (\d+) hooks?(?: \(([^)]*)\))?(?: \| mention (kept|taken))?$/.exec(text);
  assert.ok(match, `unreadable summary: ${text}`);
  return { status: Number(match[1]), count: Number(match[2]), modes: match[3] ?? '', mention: match[4] ?? null };
}

async function buildRows(template) {
  const rows = [];
  const add = (row) => rows.push({ ...row, startCount: gateHooks(JSON.parse(row.text), row.kind).length });

  for (const input of INPUTS) {
    const shaped = { ...input, shape: { progress: input.recognised ? 'own' : 'runs', release: 'own' }, fires: both(true) };
    for (const [writer, settings] of [['v0.19.0', fromTemplate(template, BINARIES[input.wrote])], ['branch', await writtenByBranch(input.wrote)]]) {
      for (const describe of DESCRIBES) {
        const start = describe === 'stripped' ? stripDescribes(structuredClone(settings)) : structuredClone(settings);
        for (const kind of Object.keys(KINDS)) {
          for (const run of Object.keys(RUNS)) {
            add({ key: `${input.id} | written by ${writer} | describe ${describe} | ${kind} | ${run}`, source: 'installer', input: shaped, kind, run, describe, mention: null, text: JSON.stringify(start, null, 2) });
          }
        }
      }
    }
  }
  for (const input of HAND_WRITTEN) {
    const shaped = { ...input, wrote: 'node', reran: 'node' };
    for (const describe of DESCRIBES) {
      const start = handWritten(input, describe);
      for (const kind of Object.keys(KINDS)) {
        for (const run of Object.keys(RUNS)) {
          add({ key: `${input.id} | written by hand | describe ${describe} | ${kind} | ${run}`, source: 'hand', input: shaped, kind, run, describe, mention: null, text: JSON.stringify(start, null, 2) });
        }
      }
    }
  }
  for (const [kind, commands] of Object.entries(MENTIONS)) {
    for (const command of commands) {
      for (const describe of DESCRIBES) {
        const mention = { type: 'command', command, ...(describe === 'present' ? { describe: `${KINDS[kind].describePrefix} (block): recorded before a settings rewrite.` } : {}) };
        const start = { model: 'opus', hooks: { [KINDS[kind].event]: [{ matcher: KINDS[kind].matcher, hooks: [{ type: 'command', command: UNRELATED }, mention] }] } };
        for (const run of Object.keys(RUNS)) {
          add({ key: `mention ${command} | describe ${describe} | ${kind} | ${run}`, source: 'mention', input: { id: 'mention', wrote: 'node', reran: 'node' }, kind, run, describe, mention, text: JSON.stringify(start, null, 2) });
        }
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
  return { result, text, settings, summary: summarise(result.status, settings, row.kind, row.mention) };
}

/** What the branch's reader makes of this row's gate hooks: ours, adoptable, unclear or foreign. Stated as the rule. */
function readingOf(row) {
  const shape = row.input.shape[row.kind];
  if (row.describe === 'present') {
    if (row.input.describe) return 'foreign';
    return shape === 'unpinned' ? 'unclear' : 'ours';
  }
  return { own: 'ours', runs: 'adoptable', unpinned: 'unclear' }[shape];
}

/** What the branch does on a row, stated as the rule rather than recorded. */
function expectedBranch(row) {
  const { kind } = row;
  const remove = RUNS[row.run].includes('--remove');
  const adopt = RUNS[row.run].includes('--adopt');
  const hooks = (count) => `${count} hook${count === 1 ? '' : 's'}`;
  if (row.mention) {
    // Never taken; an install writes a new gate beside it, in observe at coverage 1, because nothing of the gate is installed.
    return remove ? 'exit 0 | 1 hook (block) | mention kept' : `exit 0 | ${hooks(1 + KINDS[kind].fresh)} (block, observe) | mention kept`;
  }
  const reading = readingOf(row);
  if (reading === 'ours' || (reading === 'adoptable' && adopt)) return remove ? 'exit 0 | 0 hooks' : `exit 0 | ${hooks(KINDS[kind].full)} (block)`;
  return `exit 1 | ${hooks(row.startCount)} (block)`;
}

/** Which declared exception a row where 0.19.0 did better is, or null when it is none of them. */
function declaredException(row, { before, after, run, output }) {
  if (row.source === 'mention') {
    return before.mention === 'taken' && after.mention === 'kept' && after.status === 0 ? 'a' : null;
  }
  // Checked before (b): a release --remove over the unpinned wrapper exits 1 where 0.19.0 exited 0 too, and it is here
  // because the reader refused to read it, not because a hook that runs the gate is left.
  if (row.input.shape[row.kind] === 'unpinned') {
    return after.status === 1 && run.text === row.text && /cannot tell whether/.test(output) ? 'c' : null;
  }
  if (row.kind === 'release' && row.run === '--remove' && before.status === 0 && after.status === 1
    && after.count === before.count && after.count > 0 && run.text === row.text
    && output.includes(KINDS.release.label) && /the gate is not gone/.test(output)) {
    return 'b';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Running a written gate the way the harness does.
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

const onPath = new Map();
function installedHere(program) {
  if (!onPath.has(program)) {
    onPath.set(program, spawnCollect('/bin/sh', ['-c', `command -v ${program}`], { env: childEnv({}) }).then((result) => result.status === 0));
  }
  return onPath.get(program);
}

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
  t.diagnostic(`${rows.length} rows run through 0.19.0's installers${RECORDING ? ', and recorded' : ''}`);
});

test('the branch against 0.19.0, row by row: never worse, but for three declared kinds of row, each counted', async (t) => {
  assert.ok(table, `no recorded table at ${fileURLToPath(TABLE_URL)}`);
  const rows = await buildRows(table.writes);
  assert.equal(rows.length, EXPECTED_ROWS, 'the matrix did not build every row it declares');
  assert.deepEqual(rows.map((row) => row.key).sort(), Object.keys(table.outcomes).sort(), 'the rows and the recorded table are not the same rows');
  const runs = await inPool(rows, (row) => runRow(BRANCH_ADAPTER, row));
  assert.equal(runs.filter((run) => typeof run?.summary === 'string').length, rows.length, 'a row did not run');

  // Every row is checked before anything fails, so a regression reads as the full list of rows it touches.
  const problems = [];
  const tally = { better: 0, same: 0, a: 0, b: 0, c: 0 };
  const written = new Map();
  const starts = new Map();
  for (const [index, row] of rows.entries()) {
    const run = runs[index];
    const start = JSON.parse(row.text);
    const before = parseSummary(table.outcomes[row.key]);
    const after = parseSummary(run.summary);
    const output = `${run.result.stdout}${run.result.stderr}`;
    const remove = RUNS[row.run].includes('--remove');
    const failed = (why) => problems.push(`${row.key}\n    ${why}\n    0.19.0: ${table.outcomes[row.key]}\n    branch: ${run.summary}${run.result.stderr ? `\n    stderr: ${run.result.stderr.split('\n').slice(0, 2).join(' / ')}` : ''}`);

    if (run.summary !== expectedBranch(row)) failed(`expected ${expectedBranch(row)}`);
    const unrelated = (settings) => allHooks(settings).filter(({ hook }) => hook.command === UNRELATED).length;
    if (unrelated(run.settings) !== unrelated(start) || run.settings.model !== 'opus') failed('the branch took or changed a hook that is not the gate');
    if (!isDeepStrictEqual(gateHooks(run.settings, OTHER[row.kind]), gateHooks(start, OTHER[row.kind]))) failed(`the ${row.kind} installer changed the ${OTHER[row.kind]} gate's hooks`);
    if (after.status !== 0 && run.text !== row.text) failed('a run that failed changed the file');
    if (row.mention && after.mention !== 'kept') failed('the branch took a hook that only mentions the gate');

    // Where 0.19.0 did better, the row is a declared exception or a failure.
    let worse = null;
    if (before.status === 0 && after.status !== 0) worse = '0.19.0 succeeded here and the branch did not';
    else if (row.mention && before.mention === 'taken' && after.mention === 'kept') worse = '0.19.0 took a hook that only mentions the gate, and the branch kept it';
    else if (remove && before.status === 0 && after.count > before.count) worse = '0.19.0 removed more of the gate than the branch did';
    else if (!remove && !row.mention && before.status === 0 && after.count !== KINDS[row.kind].full) worse = '0.19.0 installed the gate and the branch did not install it exactly once';
    if (worse) {
      const exception = declaredException(row, { before, after, run, output });
      if (exception) tally[exception] += 1;
      else failed(worse);
    } else if (run.summary === table.outcomes[row.key]) {
      tally.same += 1;
    } else {
      tally.better += 1;
    }

    if (row.mention) continue;
    const unclear = readingOf(row) === 'unclear';
    if (/cannot tell whether/.test(output) !== unclear) {
      failed(unclear ? 'a hook the reader cannot read was not named as one it cannot tell runs the gate' : 'a hook the reader can read was named as one it cannot tell runs the gate');
    }
    if (!remove && after.status === 0) {
      if (!/^Kept mode block \((already installed in this file|read from the adopted hook)\)\. Pass --mode observe to change it\.$/m.test(run.result.stdout)) failed('a re-run with no --mode did not say it kept block mode');
      if (after.modes === 'block') {
        const commands = firingCommands(run.settings, row.kind);
        written.set(`${row.kind}\n${commands.join('\n')}`, { kind: row.kind, commands, context: `what the branch wrote on ${row.key}` });
      }
    }
    // The file each row starts from is live too: its gates fire before any re-run, or, for the unpinned wrapper, must not.
    const commands = firingCommands(start, row.kind);
    starts.set(`${row.kind}\n${commands.join('\n')}`, { kind: row.kind, commands, expected: row.input.fires[row.kind], needs: row.input.needs, context: `the file ${row.key} starts from` });
  }
  assert.deepEqual(problems, [], `${problems.length} of ${rows.length} rows:\n${problems.join('\n')}`);
  assert.equal(tally.better + tally.same + tally.a + tally.b + tally.c, rows.length, 'a row was neither compared nor counted');
  assert.ok(tally.a > 0, 'no row showed 0.19.0 taking a mention, so exception (a) was never compared');
  assert.ok(tally.b > 0, 'no row showed 0.19.0\'s release --remove exiting 0 over a hook it left, so exception (b) was never compared');
  assert.ok(tally.c > 0, 'no row showed 0.19.0 taking the unpinned wrapper, so exception (c) was never compared');

  const writtenChecks = [...written.values()];
  const writtenFired = await inPool(writtenChecks, fires);
  const silent = writtenChecks.filter((_, index) => writtenFired[index] !== true).map(({ kind, context }) => `the ${kind} gate looks installed and never fires: ${context}`);
  assert.deepEqual(silent, [], silent.join('\n'));

  const notRun = [];
  const startChecks = [];
  for (const check of starts.values()) {
    if (typeof check.expected === 'string') notRun.push(`${check.kind}: ${check.expected}`);
    else if (check.needs && !(await installedHere(check.needs))) notRun.push(`${check.kind}: ${check.needs} is not installed here`);
    else startChecks.push(check);
  }
  const startFired = await inPool(startChecks, fires);
  const wrong = startChecks.filter((check, index) => startFired[index] !== check.expected).map((check) => (check.expected
    ? `the ${check.kind} gate never fires from ${check.context}`
    : `the ${check.kind} gate fired from ${check.context}, where this test states it cannot`));
  assert.deepEqual(wrong, [], wrong.join('\n'));
  const firedStarts = startChecks.filter((check) => check.expected === true).length;
  const silentStarts = startChecks.filter((check) => check.expected === false).length;
  assert.ok(firedStarts > 0 && silentStarts > 0, 'a start file was neither run to fire nor run to stay silent');

  const bySource = (source) => rows.filter((row) => row.source === source).length;
  t.diagnostic(`${rows.length} rows (${bySource('installer')} from installer-written files, ${bySource('hand')} hand-written, ${bySource('mention')} mentions); the branch did better than 0.19.0 on ${tally.better} and the same on ${tally.same}`);
  t.diagnostic(`declared exceptions: (a) a mention 0.19.0 took and the branch kept: ${tally.a}; (b) release --remove exits 1 over a hook both versions leave: ${tally.b}; (c) an unpinned wrapper refused where 0.19.0 took it: ${tally.c}`);
  t.diagnostic(`${writtenChecks.length} distinct gates the branch wrote fired; of the start files, ${firedStarts} fired and ${silentStarts} stayed silent as stated; ${notRun.length} not run: ${[...new Set(notRun)].join('; ')}`);
});
