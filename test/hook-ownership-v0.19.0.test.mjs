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
// because Claude Code drops `describe` whenever it rewrites a settings file. A held release measured the
// cost of getting that wrong: an installer run under a Node binary with one name refused, even under
// `--adopt`, the hooks written under another name, where 0.19.0 took them.
//
// So every row below runs 0.19.0's REAL installers and this branch's on byte-identical temp files:
//   - who wrote the file: 0.19.0's installer or this branch's, under a Node binary called `wrote`, or a
//     hand-written file (the live shape; a hook that only mentions the gate file);
//   - describe present, or stripped the way a settings rewrite strips it;
//   - which installer re-runs it, under a Node binary called `reran`;
//   - the four re-runs: a bare install, `--adopt`, `--remove`, `--remove --adopt`.
// The branch must never refuse, or leave the installer's own hooks, where 0.19.0 succeeded, and never take
// a hook 0.19.0 left alone. The one intended exception: a hook that only MENTIONS the gate file is never
// taken, where 0.19.0's `--adopt` (and its describe) took it.
//
// 0.19.0 comes from git (`git show <commit>:<file>` for the four files its installers load, into a temp
// directory: nothing is added to the repository's worktree list and nothing is left to clean up). A shallow
// clone does not have that commit, so what 0.19.0 does is also kept as a table recorded from real runs,
// fixtures/hook-ownership-v0.19.0.json. The first test re-derives the table from 0.19.0 wherever the commit
// is present and fails if the two disagree; the second holds the branch to it everywhere.
// Re-record: AGENT_SKILLS_RECORD_V019_TABLE=1 node --test test/hook-ownership-v0.19.0.test.mjs
//
// Every binary is the running Node under another name (a hard link, so `process.execPath` carries that
// name), every run has HOME and --settings in a temp directory, and every gate the branch leaves installed
// is run from its written command through /bin/sh with the ambient gate variables cleared.
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
    full: 1,
    fresh: 1,
  }),
});

const BRANCH_ADAPTER = path.join(REPO, 'adapters', 'claude-code');
const branchGate = (kind) => path.join(BRANCH_ADAPTER, KINDS[kind].gate);

/** Installed by a binary called `wrote`, re-run by one called `reran`. `recognised`: whether the
 *  progress installer takes the hooks with no describe and no flag (the release installer writes `bash`). */
const INPUTS = Object.freeze([
  { id: 'node -> node', wrote: 'node', reran: 'node', recognised: true },
  { id: 'node-20 -> node-22', wrote: 'node-20', reran: 'node-22', recognised: true },
  { id: 'bun -> node', wrote: 'bun', reran: 'node', recognised: true },
  { id: 'node -> bun', wrote: 'node', reran: 'bun', recognised: true },
  { id: 'nodejs -> node', wrote: 'nodejs', reran: 'node', recognised: true },
  // A name outside the Node-runtime pattern: in the installer's exact shape, so adoptable and never unclear;
  // with the installer's own describe, its own.
  { id: 'node-lts -> node', wrote: 'node-lts', reran: 'node', recognised: false },
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
const BINARIES = await nodeBinaries([...new Set(INPUTS.flatMap((input) => [input.wrote, input.reran]))]);

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

/** The user's live shape: both gates in block mode, the progress gate at coverage 2, no describe, beside other hooks. */
function liveShape() {
  const progress = `AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 '${BINARIES.node}' '${branchGate('progress')}'`;
  const release = `AGENT_SKILLS_RELEASE_NOTES_GATE=block bash '${branchGate('release')}'`;
  return {
    model: 'opus',
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: UNRELATED }, { type: 'command', command: release, timeout: 10 }] }],
      Stop: [{ hooks: [{ type: 'command', command: UNRELATED }] }, { matcher: '*', hooks: [{ type: 'command', command: progress, timeout: 10 }] }],
      SubagentStart: [{ matcher: '*', hooks: [{ type: 'command', command: progress, timeout: 5 }] }],
    },
  };
}

/** Put the installer's own describe back on every gate hook, as the installer wrote it before a rewrite dropped it. */
function withOwnDescribes(settings) {
  for (const { hook } of allHooks(settings)) {
    for (const kind of Object.values(KINDS)) {
      if (hook.command.includes(`/${kind.gate}'`)) hook.describe = `${kind.describePrefix} (block): recorded before a settings rewrite.`;
    }
  }
  return settings;
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
  const starts = [];
  for (const input of INPUTS) {
    starts.push({ input, writer: 'v0.19.0', settings: fromTemplate(template, BINARIES[input.wrote]) });
    starts.push({ input, writer: 'branch', settings: structuredClone(await writtenByBranch(input.wrote)) });
  }
  starts.push({ input: { id: 'live shape', wrote: 'node', reran: 'node', recognised: true }, writer: 'by hand', settings: liveShape() });

  const rows = [];
  for (const { input, writer, settings } of starts) {
    for (const describe of DESCRIBES) {
      // A v0.19.0 or branch file carries its installers' describes; the live shape is given ones.
      const start = describe === 'stripped' ? stripDescribes(structuredClone(settings))
        : writer === 'by hand' ? withOwnDescribes(structuredClone(settings)) : structuredClone(settings);
      for (const kind of Object.keys(KINDS)) {
        for (const run of Object.keys(RUNS)) {
          rows.push({
            key: `${input.id} | written by ${writer} | describe ${describe} | ${kind} | ${run}`,
            input, kind, run, describe, mention: null,
            text: JSON.stringify(start, null, 2),
            startCount: gateHooks(start, kind).length,
          });
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
          rows.push({
            key: `mention ${command} | describe ${describe} | ${kind} | ${run}`,
            input: { id: 'mention', wrote: 'node', reran: 'node' }, kind, run, describe, mention,
            text: JSON.stringify(start, null, 2),
            startCount: 1,
          });
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

/** What the branch does on a row, stated as the rule rather than recorded. */
function expectedBranch(row) {
  const { kind } = row;
  const remove = RUNS[row.run].includes('--remove');
  const adopt = RUNS[row.run].includes('--adopt');
  if (row.mention) {
    // Never taken; an install writes a new gate beside it, in observe at coverage 1, because nothing of the gate is installed.
    return remove ? 'exit 0 | 1 hook (block) | mention kept' : `exit 0 | ${1 + KINDS[kind].fresh} hooks (block, observe) | mention kept`;
  }
  const recognised = kind === 'release' || row.input.recognised || row.describe === 'present';
  if (recognised || adopt) {
    const { full } = KINDS[kind];
    return remove ? 'exit 0 | 0 hooks' : `exit 0 | ${full} hook${full === 1 ? '' : 's'} (block)`;
  }
  return `exit 1 | ${row.startCount} hook${row.startCount === 1 ? '' : 's'} (block)`;
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

async function progressFires([arm, stop]) {
  const markers = await scratch('ownership-v019-markers');
  const env = { AGENT_SKILLS_PROGRESS_GATE_DIR: markers };
  await sh(arm, { hook_event_name: 'SubagentStart', session_id: 'sess-matrix', agent_id: 'a1', agent_type: 'general-purpose' }, env);
  const stopped = await sh(stop, { hook_event_name: 'Stop', session_id: 'sess-matrix', stop_hook_active: false, last_assistant_message: BAD_REPORT }, env);
  return stopped.stdout.trim() !== '' && JSON.parse(stopped.stdout).decision === 'block';
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
  return result.stdout.trim() !== '' && JSON.parse(result.stdout).hookSpecificOutput?.permissionDecision === 'deny';
}

const firingCommands = (settings, kind) => (kind === 'progress'
  ? [onlyCommand(settings, 'progress', 'SubagentStart', '*'), onlyCommand(settings, 'progress', 'Stop', '*')]
  : [onlyCommand(settings, 'release', 'PreToolUse', 'Bash')]);

// ---------------------------------------------------------------------------
// The tests.
// ---------------------------------------------------------------------------

test('what 0.19.0 does, row by row, is the recorded table: re-derived from its own installers', { skip: V019_ADAPTER ? false : `this clone does not have ${V019.tag} (${V019.commit}); the branch is held to the table recorded from it` }, async () => {
  const templates = [];
  for (const wrote of [...new Set(INPUTS.map((input) => input.wrote))]) {
    templates.push([wrote, toTemplate(await installBoth(V019_ADAPTER, BINARIES[wrote]), BINARIES[wrote], V019_ADAPTER)]);
  }
  for (const [wrote, template] of templates) assert.deepEqual(template, templates[0][1], `0.19.0 wrote a different shape under ${wrote}`);
  const template = templates[0][1];
  if (!RECORDING) assert.deepEqual(template, table?.writes, 'what 0.19.0 writes is not the recorded template');

  const rows = await buildRows(template);
  const runs = await inPool(rows, (row) => runRow(V019_ADAPTER, row));
  const outcomes = Object.fromEntries(rows.map((row, index) => [row.key, runs[index].summary]));
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
});

test('the branch against 0.19.0, row by row: never worse, and a mention is the one hook it keeps that 0.19.0 took', async (t) => {
  assert.ok(table, `no recorded table at ${fileURLToPath(TABLE_URL)}`);
  const rows = await buildRows(table.writes);
  assert.deepEqual(rows.map((row) => row.key).sort(), Object.keys(table.outcomes).sort(), 'the rows and the recorded table are not the same rows');
  const runs = await inPool(rows, (row) => runRow(BRANCH_ADAPTER, row));

  // Every row is checked before anything fails, so a regression reads as the full list of rows it touches.
  const problems = [];
  let better = 0;
  let exceptions = 0;
  const firing = new Map();
  for (const [index, row] of rows.entries()) {
    const run = runs[index];
    const before = parseSummary(table.outcomes[row.key]);
    const after = parseSummary(run.summary);
    const output = `${run.result.stdout}${run.result.stderr}`;
    const remove = RUNS[row.run].includes('--remove');
    const failed = (why) => problems.push(`${row.key}\n    ${why}\n    0.19.0: ${table.outcomes[row.key]}\n    branch: ${run.summary}${run.result.stderr ? `\n    stderr: ${run.result.stderr.split('\n').slice(0, 2).join(' / ')}` : ''}`);

    if (run.summary !== expectedBranch(row)) failed(`expected ${expectedBranch(row)}`);
    if (before.status === 0 && after.status !== 0) failed('0.19.0 succeeded here and the branch did not');
    const unrelated = (settings) => allHooks(settings).filter(({ hook }) => hook.command === UNRELATED).length;
    if (unrelated(run.settings) !== unrelated(JSON.parse(row.text)) || run.settings.model !== 'opus') failed('the branch took or changed a hook that is not the gate');
    if (after.status !== 0 && run.text !== row.text) failed('a run that failed changed the file');

    if (row.mention) {
      if (after.mention !== 'kept') failed('the branch took a hook that only mentions the gate');
      if (before.mention === 'taken') exceptions += 1;
      continue;
    }
    if (/cannot tell whether/.test(output)) failed("an installer's own exact shape was read as unclear");
    if (remove && before.status === 0 && before.count === 0 && after.count !== 0) failed('0.19.0 removed the gate and the branch left some of it');
    if (!remove && before.status === 0 && after.count !== KINDS[row.kind].full) failed('0.19.0 installed the gate and the branch did not install it exactly once');
    if (!remove && after.status === 0) {
      if (!/^Kept mode block \((already installed in this file|read from the adopted hook)\)\. Pass --mode observe to change it\.$/m.test(run.result.stdout)) failed('a re-run with no --mode did not say it kept block mode');
      if (after.modes === 'block') {
        const commands = firingCommands(run.settings, row.kind);
        firing.set(`${row.kind}\n${commands.join('\n')}`, { kind: row.kind, commands, context: `what the branch wrote on ${row.key}` });
      }
    }
    // The file each row starts from is live too: its gates fire before any re-run.
    const startCommands = firingCommands(JSON.parse(row.text), row.kind);
    firing.set(`${row.kind}\n${startCommands.join('\n')}`, { kind: row.kind, commands: startCommands, context: `the file ${row.key} starts from` });
    if (after.status < before.status || (after.status === 0 && before.status === 0 && (remove ? after.count < before.count : after.modes !== before.modes))) better += 1;
  }
  assert.deepEqual(problems, [], `${problems.length} of ${rows.length} rows:\n${problems.join('\n')}`);
  assert.ok(exceptions > 0, 'no row showed 0.19.0 taking a mention, so the exception was never compared');

  const checks = [...firing.values()];
  const fired = await inPool(checks, ({ kind, commands }) => (kind === 'progress' ? progressFires(commands) : releaseFires(commands)));
  const silent = checks.filter((_, index) => fired[index] !== true).map(({ kind, context }) => `the ${kind} gate looks installed and never fires: ${context}`);
  assert.deepEqual(silent, [], silent.join('\n'));
  t.diagnostic(`${rows.length} rows; the branch did better than 0.19.0 on ${better}; mentions 0.19.0 took and the branch kept: ${exceptions}; ${checks.length} distinct written gates fired`);
});
