import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  GATE_ENV_FLAG,
  GATE_MODES,
  MARKER_MAX_AGE_MS,
  NO_EVIDENCE_SENTENCE,
  buildBlockReason,
  decideStop,
  findReportFailures,
  hasFreshnessToken,
  hasSectionLabel,
  hasStateToken,
  markerFile,
  resolveMode,
  runningBlock,
} from '../adapters/claude-code/report-progress-gate.mjs';

import {
  DESCRIBE_PREFIX,
  HOOK_MARKER,
  buildHookEntries,
  installHooks,
  removeHooks,
  resolveSettingsPath,
} from '../adapters/claude-code/install-report-progress-gate.mjs';

const gate = fileURLToPath(new URL('../adapters/claude-code/report-progress-gate.mjs', import.meta.url));
const installer = fileURLToPath(new URL('../adapters/claude-code/install-report-progress-gate.mjs', import.meta.url));

// The report the skill itself publishes as the one that works. Every shape assertion below
// is made against this, so a gate that rejects the skill's own worked example fails here.
const GOOD_REPORT = `Phase 3 of 5 complete (receipt-path fix landed; Windows half unproven).

Done — verified here: 4 commits on feat/receipt-path (b1c2d3e..9f0a1b2); \`npm test\` run in
this checkout at 9f0a1b2 — 812 passing, 0 failing.
Done — claimed, not verified: the child agent reports the Windows path fixed.
Running: 1 child, child-7f2, state running, activity "rewriting the fixture loader", last
observed 40s ago (lifecycle projection).
Next: re-run the installer end-to-end on a clean checkout — blocked until child-7f2 reaches
a terminal state.
Consequence: every correctly-installed Yarn 1 repository was being reported broken.`;

// The same moment reported badly, also from the skill. Four failures, no sections.
const BAD_REPORT = `Great progress! I have been working through the migration and things are moving along
nicely. The tests are all passing and the background agent should be wrapping up the
Windows fixes shortly. I will keep going and ping you if anything comes up.`;

function runGate(payload, { env = {}, raw } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [gate], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, [GATE_ENV_FLAG]: 'block', ...env },
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(raw !== undefined ? raw : JSON.stringify(payload));
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

async function scratch(name) {
  return mkdtemp(path.join(tmpdir(), `${name}-`));
}

const stopPayload = (message, extra = {}) => ({
  hook_event_name: 'Stop',
  session_id: 'sess-abc123',
  stop_hook_active: false,
  last_assistant_message: message,
  ...extra,
});

const agentDispatch = (extra = {}) => ({
  hook_event_name: 'PostToolUse',
  session_id: 'sess-abc123',
  tool_name: 'Agent',
  tool_input: { description: 'Reply with done', subagent_type: 'general-purpose', run_in_background: false },
  ...extra,
});

const build = (mode) => buildHookEntries({
  mode,
  gatePath: path.join(path.sep, 'pack', 'adapters', 'claude-code', HOOK_MARKER),
  nodePath: path.join(path.sep, 'bin', 'node'),
});

const parsedBlock = (stdout) => JSON.parse(stdout.trim());

// ---------------------------------------------------------------------------
// The check itself: shape in, failures out.
// ---------------------------------------------------------------------------

test('the report the skill publishes as correct passes the gate unchanged', () => {
  assert.deepEqual(findReportFailures(GOOD_REPORT), []);
});

test('the report the skill publishes as bad fails on all three sections', () => {
  assert.deepEqual(
    findReportFailures(BAD_REPORT).map((failure) => failure.code),
    ['missing-done', 'missing-running', 'missing-next'],
  );
});

test('a blank or absent final message produces no failures at all', () => {
  // Not leniency: `last_assistant_message` missing is a fact about the payload, and a gate
  // that blocks on what it could not read is a gate that fires at random.
  for (const message of ['', '   \n  ', undefined, null, 42, {}]) {
    assert.deepEqual(findReportFailures(message), [], `blocked on ${JSON.stringify(message)}`);
  }
});

test('the lifecycle no-evidence sentence stands in for the whole running section', () => {
  const report = `Done: 2 commits (abc1234, def5678).\n\n${NO_EVIDENCE_SENTENCE}\n\nNext: land the branch once the gate is green.`;
  assert.deepEqual(findReportFailures(report), []);
});

test('an explicitly empty running section is a result, not a failure', () => {
  const report = '## Done\n- 2 commits (abc1234)\n\n## Running\nNothing running.\n\n## Next\n- land it';
  assert.deepEqual(findReportFailures(report), []);
});

test('a running section with neither state nor freshness names both failures', () => {
  const report = 'Done: 1 commit abc1234.\nRunning: child-7f2 is working on the fixture loader.\nNext: merge it.';
  assert.deepEqual(
    findReportFailures(report).map((failure) => failure.code),
    ['running-row-without-state', 'running-row-without-freshness'],
  );
  // "working on" is an activity verb, which is exactly what the skill's rule 2 says cannot
  // stand in for a state: it survives a report in which nothing at all happened.
  assert.equal(hasStateToken('child-7f2 is working on the fixture loader'), false);
});

test('a status table is recognised as sections, because reports are written that way', () => {
  const report = [
    '| section | value |',
    '| --- | --- |',
    '| Done | 3 commits (abc1234..9f0a1b2) |',
    '| Running | child-7f2, state waiting, last observed 90s ago |',
    '| Next | merge after review |',
  ].join('\n');
  assert.deepEqual(findReportFailures(report), []);
});

test('headings and bold labels count; a sentence that merely starts with the word does not', () => {
  assert.equal(hasSectionLabel('## What is done', 'done'), true);
  assert.equal(hasSectionLabel('- **Done:** 4 commits', 'done'), true);
  assert.equal(hasSectionLabel('Done so far: 4 commits', 'done'), true);
  // Left permissive on purpose would be worse: this would let any narrative paragraph
  // that happens to open with "Done" satisfy a section it never wrote.
  assert.equal(hasSectionLabel('Done some refactoring of the loader before the tests ran', 'done'), false);
});

test('the running block ends where the next section begins', () => {
  const block = runningBlock('Done: x\nRunning: child-7f2, state running, last observed 5s ago\nstill on the loader\nNext: merge\nDone: y');
  assert.match(block, /child-7f2/);
  assert.match(block, /still on the loader/);
  assert.doesNotMatch(block, /merge/);
  // The label is stripped before the state scan: "Running:" must not satisfy the state
  // requirement with its own heading, which would make every running section pass for free.
  assert.equal(hasStateToken(runningBlock('Running: child-7f2, last observed 5s ago')), false);
});

// ---------------------------------------------------------------------------
// False positives. A guard that fires on ordinary prose gets uninstalled, and an
// uninstalled guard enforces nothing at all.
// ---------------------------------------------------------------------------

test('a version string, a port number and a PR number are not freshness', () => {
  for (const text of ['shipped v1.2.3', 'serving on port 3000', 'PR #4821 is open', 'issue 4821', 'took 4m 12s to build', '8080']) {
    assert.equal(hasFreshnessToken(text), false, `counted as freshness: ${text}`);
  }
});

test('an observation age is freshness, in the shapes a report actually uses', () => {
  for (const text of ['last observed 40s ago', 'heartbeat 12 minutes ago', 'last seen 2026-09-12T04:31', 'updated 3 min ago', 'last observed just now']) {
    assert.equal(hasFreshnessToken(text), true, `missed freshness: ${text}`);
  }
});

test('a good report carrying versions, ports and PR numbers still passes', () => {
  const report = `${GOOD_REPORT}\nAlso: v3.6.14 is live on port 8443; PR #4821 merged; 812 tests in 4m 12s.`;
  assert.deepEqual(findReportFailures(report), []);
});

test('a one-line answer to a one-line question is never even checked for shape', async () => {
  // The gate is not armed on a turn that dispatched nothing, so this is the real guard
  // against "yes, that file is in src/" being blocked: there is no marker to read.
  const directory = await scratch('gate-unarmed');
  const result = await runGate(stopPayload('Yes, that file is in src/.'), {
    env: { AGENT_SKILLS_PROGRESS_GATE_DIR: directory },
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});

// ---------------------------------------------------------------------------
// The Stop decision, every branch, with the file system factored out.
// ---------------------------------------------------------------------------

test('no marker means no gate', () => {
  const decision = decideStop({ payload: stopPayload(BAD_REPORT), marker: null });
  assert.equal(decision.block, false);
  assert.equal(decision.disarm, false);
});

test('a missing report on an armed turn blocks exactly once', () => {
  const marker = { version: 1, armedAt: Date.now(), dispatches: 1, blocked: false };
  const first = decideStop({ payload: stopPayload(BAD_REPORT), marker });
  assert.equal(first.block, true);
  assert.match(first.reason, /progress report is owed/);

  // The documented way out of an unresolvable loop, and the reason this gate can never be
  // the hook that spends the shared 8-block budget.
  const second = decideStop({ payload: stopPayload(BAD_REPORT, { stop_hook_active: true }), marker });
  assert.equal(second.block, false);
  assert.equal(second.disarm, true);

  // Belt and braces: even with stop_hook_active absent, our own marker says we are done.
  const third = decideStop({ payload: stopPayload(BAD_REPORT), marker: { ...marker, blocked: true } });
  assert.equal(third.block, false);
  assert.equal(third.disarm, true);
});

test('a report that satisfies the shape disarms the turn instead of blocking it', () => {
  const decision = decideStop({
    payload: stopPayload(GOOD_REPORT),
    marker: { version: 1, armedAt: Date.now(), dispatches: 1, blocked: false },
  });
  assert.equal(decision.block, false);
  assert.equal(decision.disarm, true);
});

test('a stale marker never gates a later turn, and neither does a clock that went backwards', () => {
  const stale = { version: 1, armedAt: Date.now() - MARKER_MAX_AGE_MS - 1000, blocked: false };
  assert.equal(decideStop({ payload: stopPayload(BAD_REPORT), marker: stale }).block, false);
  const future = { version: 1, armedAt: Date.now() + MARKER_MAX_AGE_MS + 1000, blocked: false };
  assert.equal(decideStop({ payload: stopPayload(BAD_REPORT), marker: future }).block, false);
  const nonsense = { version: 1, armedAt: 'whenever', blocked: false };
  assert.equal(decideStop({ payload: stopPayload(BAD_REPORT), marker: nonsense }).block, false);
});

test('an unreadable final message disarms rather than blocking', () => {
  const marker = { version: 1, armedAt: Date.now(), blocked: false };
  for (const payload of [stopPayload(undefined), stopPayload(''), stopPayload(42), { hook_event_name: 'Stop' }]) {
    const decision = decideStop({ payload, marker });
    assert.equal(decision.block, false, `blocked on ${JSON.stringify(payload)}`);
  }
});

// ---------------------------------------------------------------------------
// The reason string. It is the only thing the model ever sees from this gate.
// ---------------------------------------------------------------------------

test('the reason names what is missing, and says the gate cannot check truth', () => {
  const reason = buildBlockReason(findReportFailures(BAD_REPORT));
  assert.match(reason, /what is done/);
  assert.match(reason, /what is running/);
  assert.match(reason, /what is next/);
  assert.match(reason, /matches strings/);
  assert.match(reason, /cannot tell whether any number in the report is real/);
  assert.match(reason, /not evidence that anything in the report is true/);
  // It must say the block is one-shot: a model that believes it is in an unresolvable
  // loop starts negotiating with the hook instead of writing the report.
  assert.match(reason, /blocks once per turn/);
  assert.match(reason, /--remove/);
  assert.ok(reason.includes(NO_EVIDENCE_SENTENCE), 'the reason must quote the no-evidence sentence exactly');
  // No claim of verification anywhere: this gate proves nothing about the report's content.
  assert.doesNotMatch(reason, /\b(?:verified|confirms|proves|guarantees)\b/i);
});

// ---------------------------------------------------------------------------
// The hook wrapper: it may block, or it may stay silent. It may never do anything else.
// ---------------------------------------------------------------------------

test('with no arming flag the gate is inert, even on an armed session and a bad message', async () => {
  const directory = await scratch('gate-off');
  const file = markerFile({ AGENT_SKILLS_PROGRESS_GATE_DIR: directory }, 'sess-abc123');
  await runGate(agentDispatch(), { env: { AGENT_SKILLS_PROGRESS_GATE_DIR: directory } });
  assert.equal((await readdir(directory)).length, 1, 'the armed run did not write a marker');

  for (const flag of [undefined, '', '0', 'true', 'yes', 'BLOCKING']) {
    const result = await runGate(stopPayload(BAD_REPORT), {
      env: { AGENT_SKILLS_PROGRESS_GATE_DIR: directory, [GATE_ENV_FLAG]: flag },
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '', `flag ${JSON.stringify(flag)} produced output`);
    assert.equal(result.stderr, '', `flag ${JSON.stringify(flag)} produced stderr`);
  }
  // …and the marker it never read is still there, untouched.
  await readFile(file, 'utf8');
  assert.deepEqual(GATE_MODES, ['observe', 'block']);
  assert.equal(resolveMode({ [GATE_ENV_FLAG]: 'off' }), 'off');
  assert.equal(resolveMode({ [GATE_ENV_FLAG]: '1' }), 'block');
});

test('end to end: an Agent dispatch arms the turn, and a missing report is blocked once', async () => {
  const directory = await scratch('gate-live');
  const env = { AGENT_SKILLS_PROGRESS_GATE_DIR: directory };

  const arming = await runGate(agentDispatch(), { env });
  assert.equal(arming.status, 0);
  assert.equal(arming.stdout, '', 'the arming half must never print to stdout');

  const marker = JSON.parse(await readFile(markerFile(env, 'sess-abc123'), 'utf8'));
  assert.equal(marker.dispatches, 1);
  assert.equal(marker.blocked, false);

  const blocked = await runGate(stopPayload(BAD_REPORT), { env });
  assert.equal(blocked.status, 0);
  const decision = parsedBlock(blocked.stdout);
  assert.equal(decision.decision, 'block');
  assert.match(decision.reason, /progress report is owed/);
  // One channel only. additionalContext would be a second thing for the harness to
  // deliver on a budget that is already shared with every other Stop hook.
  assert.deepEqual(Object.keys(decision), ['decision', 'reason']);

  // The next Stop of the same turn carries stop_hook_active, and the gate stands down.
  const second = await runGate(stopPayload(BAD_REPORT, { stop_hook_active: true }), { env });
  assert.equal(second.status, 0);
  assert.equal(second.stdout, '');

  // The marker is gone, so the following turn starts unarmed.
  const third = await runGate(stopPayload(BAD_REPORT), { env });
  assert.equal(third.status, 0);
  assert.equal(third.stdout, '');
});

test('a good report on an armed turn ends the turn silently', async () => {
  const directory = await scratch('gate-pass');
  const env = { AGENT_SKILLS_PROGRESS_GATE_DIR: directory };
  await runGate(agentDispatch(), { env });
  const result = await runGate(stopPayload(GOOD_REPORT), { env });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal((await readdir(directory)).length, 0, 'a delivered report must disarm the marker');
});

test('observe mode reaches the same verdict and never holds the turn', async () => {
  const directory = await scratch('gate-observe');
  const env = { AGENT_SKILLS_PROGRESS_GATE_DIR: directory, [GATE_ENV_FLAG]: 'observe' };
  await runGate(agentDispatch(), { env });
  const result = await runGate(stopPayload(BAD_REPORT), { env });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '', 'observe mode must never write a decision');
  assert.match(result.stderr, /would have blocked/);
  assert.match(result.stderr, /missing-done/);
});

test('only the Agent tool arms the gate', async () => {
  const directory = await scratch('gate-scope');
  const env = { AGENT_SKILLS_PROGRESS_GATE_DIR: directory };
  for (const tool of ['Read', 'Bash', 'Grep', 'Edit', undefined]) {
    const result = await runGate(agentDispatch({ tool_name: tool }), { env });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  }
  assert.equal((await readdir(directory)).length, 0, 'an unrelated tool armed the gate');
});

test('every malformed input ends in exit 0 and silence, never a crash', async () => {
  const directory = await scratch('gate-malformed');
  const env = { AGENT_SKILLS_PROGRESS_GATE_DIR: directory };
  const inputs = [
    '',
    '   ',
    'not json at all',
    '[]',
    'null',
    '"a string"',
    '{}',
    '{"hook_event_name":"Stop"}',
    '{"hook_event_name":"Stop","session_id":{"nested":true},"last_assistant_message":[1,2,3]}',
    '{"hook_event_name":"Unknown","last_assistant_message":"hi"}',
    '{"hook_event_name":"SubagentStop","last_assistant_message":"hi"}',
    '{"hook_event_name":"PostToolUse","tool_name":"Agent","session_id":"../../escape/attempt"}',
    `{"hook_event_name":"Stop","last_assistant_message":${JSON.stringify('x'.repeat(200000))}}`,
    '{"hook_event_name":"Stop","last_assistant_message":"done"',
  ];
  for (const raw of inputs) {
    const result = await runGate(undefined, { env, raw });
    assert.equal(result.status, 0, `non-zero exit for ${raw.slice(0, 40)}`);
    assert.equal(result.stdout, '', `output for ${raw.slice(0, 40)}`);
  }
  // A session id that tried to walk out of the marker directory did not.
  for (const entry of await readdir(directory)) {
    assert.match(entry, /^[A-Za-z0-9_-]+\.json(?:\.\d+\.tmp)?$/);
  }
});

test('a marker directory it cannot write, and a marker it cannot parse, both end in silence', async () => {
  const root = await scratch('gate-readonly');
  const directory = path.join(root, 'nested');
  await chmod(root, 0o500);
  try {
    const result = await runGate(agentDispatch(), { env: { AGENT_SKILLS_PROGRESS_GATE_DIR: directory } });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  } finally {
    await chmod(root, 0o700);
  }

  const usable = await scratch('gate-garbage');
  const env = { AGENT_SKILLS_PROGRESS_GATE_DIR: usable };
  await writeFile(markerFile(env, 'sess-abc123'), 'this is not json');
  const result = await runGate(stopPayload(BAD_REPORT), { env });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '', 'a corrupt marker must not arm the gate');
});

test('importing the gate does not end the importing process', async () => {
  // This is a regression, not a hypothetical: the module originally called its own main()
  // unconditionally, which ran process.exit(0) inside the installer that imported it —
  // the installer wrote nothing at all and reported exit 0 while doing it.
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `import('${gate}').then(() => console.log('IMPORT_OK'));`], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.on('close', (status) => resolve({ status, stdout }));
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /IMPORT_OK/);
});

// ---------------------------------------------------------------------------
// The installer.
// ---------------------------------------------------------------------------

test('the settings file is the user Claude Code settings, resolved from home', () => {
  const home = path.join(path.sep, 'somewhere', 'home');
  assert.equal(resolveSettingsPath({ HOME: home }), path.join(home, '.claude', 'settings.json'));
});

test('both halves are written, and the arming half is scoped to the Agent tool', () => {
  const entries = build('block');
  for (const entry of [entries.stop, entries.postToolUse]) {
    assert.equal(entry.type, 'command');
    assert.ok(entry.command.includes(HOOK_MARKER));
    // The flag rides in the command, because a hook inherits whatever environment Claude
    // Code launched with — which for a desktop launch is no shell profile at all.
    assert.ok(entry.command.startsWith(`${GATE_ENV_FLAG}=block `));
    assert.ok(Number.isInteger(entry.timeout) && entry.timeout > 0 && entry.timeout <= 10);
    assert.ok(entry.describe.startsWith(DESCRIBE_PREFIX));
    assert.match(entry.describe, /--remove/);
  }
  const settings = installHooks({}, { entries });
  assert.equal(settings.hooks.Stop.length, 1);
  assert.equal(settings.hooks.Stop[0].hooks.length, 1);
  assert.equal(settings.hooks.PostToolUse.length, 1);
  assert.equal(settings.hooks.PostToolUse[0].matcher, 'Agent');
});

test('the describe says what it enforces and never claims to check whether it is true', () => {
  for (const mode of GATE_MODES) {
    const entries = build(mode);
    assert.match(entries.stop.describe, /shape only/);
    assert.match(entries.stop.describe, /cannot verify anything in it/);
    assert.doesNotMatch(entries.stop.describe, /\b(?:verifies|proves|guarantees)\b/i);
  }
  assert.match(build('block').describe ?? build('block').stop.describe, /once, never twice/);
  assert.match(build('observe').stop.describe, /never holds the turn/);
});

test('an unknown mode is refused rather than guessed at', () => {
  assert.throws(() => build('enforce'), /mode must be one of/);
  assert.throws(() => build(''), /mode must be one of/);
});

test('installing twice replaces the gate instead of stacking two of them', () => {
  let settings = installHooks({}, { entries: build('observe') });
  settings = installHooks(settings, { entries: build('block') });
  const stopHooks = settings.hooks.Stop.flatMap((group) => group.hooks);
  const postHooks = settings.hooks.PostToolUse.flatMap((group) => group.hooks);
  assert.equal(stopHooks.length, 1, 'two Stop gates would spend two of the eight shared blocks');
  assert.equal(postHooks.length, 1);
  assert.ok(stopHooks[0].command.includes('=block'));
});

test('removal leaves the rest of the file exactly as it was', () => {
  const original = {
    model: 'claude-sonnet-4-6',
    hooks: {
      Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'someone-elses-stop-hook' }] }],
      PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'someone-elses-posttooluse-hook' }] }],
    },
  };
  const installed = installHooks(structuredClone(original), { entries: build('block') });
  const { settings, removed } = removeHooks(installed);
  assert.equal(removed, 2);
  assert.deepEqual(settings, original);

  const { removed: none } = removeHooks(structuredClone(original));
  assert.equal(none, 0);
});

test('removal prunes the keys it created and leaves no residue', () => {
  const installed = installHooks({}, { entries: build('block') });
  const { settings, removed } = removeHooks(installed);
  assert.equal(removed, 2);
  assert.deepEqual(settings, {});
});

test('a hook wearing the gate name that this installer did not write is refused, not replaced', () => {
  const foreign = {
    hooks: {
      Stop: [{ matcher: '*', hooks: [{ type: 'command', command: `node /elsewhere/${HOOK_MARKER}` }] }],
    },
  };
  assert.throws(() => installHooks(foreign, { entries: build('block') }), /was not written by this installer/);
});

test('a settings file shaped in a way this script does not understand is never rewritten', () => {
  assert.throws(() => installHooks({ hooks: 'nope' }, { entries: build('block') }), /"hooks" key is not an object/);
  assert.throws(() => installHooks({ hooks: { Stop: {} } }, { entries: build('block') }), /"hooks.Stop" is not an array/);
  assert.throws(() => installHooks({ hooks: { Stop: [{ matcher: '*' }] } }, { entries: build('block') }), /unexpected shape/);
  assert.throws(() => installHooks('not settings', { entries: build('block') }), /settings must be a JSON object/);
});

test('the installer writes real settings atomically, and --remove takes them back out', async () => {
  const directory = await scratch('gate-install');
  const settingsPath = path.join(directory, 'settings.json');
  await writeFile(settingsPath, JSON.stringify({ model: 'claude-sonnet-4-6' }, null, 2));

  const installed = await runInstaller(['--mode', 'block', '--settings', settingsPath]);
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, /Installed the block report-progress gate/);
  assert.match(installed.stdout, /cannot check whether a count is real/);
  assert.match(installed.stdout, /8 consecutive Stop blocks/);

  const written = JSON.parse(await readFile(settingsPath, 'utf8'));
  assert.equal(written.model, 'claude-sonnet-4-6');
  assert.equal(written.hooks.Stop[0].hooks[0].describe.startsWith(DESCRIBE_PREFIX), true);
  assert.deepEqual((await readdir(directory)).sort(), ['settings.json'], 'a temp file was left behind');

  const removed = await runInstaller(['--remove', '--settings', settingsPath]);
  assert.equal(removed.status, 0, removed.stderr);
  assert.match(removed.stdout, /Removed 2 report-progress gate hooks/);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, 'utf8')), { model: 'claude-sonnet-4-6' });

  const again = await runInstaller(['--remove', '--settings', settingsPath]);
  assert.match(again.stdout, /Nothing changed/);
});

test('the installer refuses nonsense arguments instead of acting on a guess', async () => {
  const directory = await scratch('gate-args');
  const settingsPath = path.join(directory, 'settings.json');
  for (const argv of [['--mode', 'enforce'], ['--remove', '--mode', 'block'], ['--sudo']]) {
    const result = await runInstaller([...argv, '--settings', settingsPath]);
    assert.equal(result.status, 1, `accepted ${argv.join(' ')}`);
  }
  assert.deepEqual(await readdir(directory), [], 'a refused run still wrote something');

  await writeFile(settingsPath, '{ this is not json');
  const broken = await runInstaller(['--mode', 'block', '--settings', settingsPath]);
  assert.equal(broken.status, 1);
  assert.match(broken.stderr, /not valid JSON/);
  assert.equal(await readFile(settingsPath, 'utf8'), '{ this is not json');
});
