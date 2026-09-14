import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  COVERAGE_ENV_FLAG,
  GATE_ENV_FLAG,
  GATE_MODES,
  MARKER_MAX_AGE_MS,
  NO_EVIDENCE_SENTENCE,
  SKILLS_ENV_FLAG,
  armsForSkill,
  armsForSubagentStart,
  buildBlockReason,
  decideStop,
  findReportFailures,
  hasFreshnessToken,
  hasSectionLabel,
  hasStateToken,
  markerFile,
  registerEdge,
  registerFile,
  resolveCoverage,
  resolveMode,
  resolveWatchedSkills,
  runningBlock,
  runningTaskIds,
} from '../adapters/claude-code/report-progress-gate.mjs';

import {
  COVERAGE_LEVELS,
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
      // The two coverage variables are cleared unless a case sets them, so an ambient value
      // in the shell running these tests cannot quietly widen what is being asserted.
      env: {
        ...process.env,
        [GATE_ENV_FLAG]: 'block',
        [COVERAGE_ENV_FLAG]: undefined,
        [SKILLS_ENV_FLAG]: undefined,
        ...env,
      },
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

const build = (mode, skills = [], coverage = 2) => buildHookEntries({
  mode,
  skills,
  coverage,
  gatePath: path.join(path.sep, 'pack', 'adapters', 'claude-code', HOOK_MARKER),
  nodePath: path.join(path.sep, 'bin', 'node'),
});

const parsedBlock = (stdout) => JSON.parse(stdout.trim());

// --- the second family: work the harness itself has in flight at a turn end -------------

/** One entry of `Stop.background_tasks[]`, in the shape observed on 2026-09-14. */
const runningTask = (id, extra = {}) => ({
  id,
  type: 'shell',
  status: 'running',
  description: 'a background shell',
  command: 'sleep 400',
  ...extra,
});

const stopWith = (message, tasks, extra = {}) => stopPayload(message, { background_tasks: tasks, ...extra });

const subagentStart = (extra = {}) => ({
  hook_event_name: 'SubagentStart',
  session_id: 'sess-abc123',
  agent_id: 'a73cac92a2fbb653e',
  agent_type: 'general-purpose',
  ...extra,
});

const skillCall = (skill, extra = {}) => ({
  hook_event_name: 'PostToolUse',
  session_id: 'sess-abc123',
  tool_name: 'Skill',
  tool_input: { skill },
  tool_response: { success: true },
  ...extra,
});

/** The widened coverage, which nothing gains without the installer writing it. */
const LEVEL2 = { [COVERAGE_ENV_FLAG]: '2' };

/** A report whose running section says, correctly or otherwise, that nothing is running. */
const EMPTY_RUNNING_REPORT = '## Done\n- 2 commits (abc1234)\n\n## Running\nNothing running.\n\n## Next\n- land it';

/** A report that stands `agent-lifecycle`'s no-evidence sentence in place of the section. */
const NO_EVIDENCE_REPORT = `Done: 2 commits (abc1234, def5678).\n\n${NO_EVIDENCE_SENTENCE}\n\nNext: land the branch once the gate is green.`;

/** The hook pair v0.16.1 wrote, as a user already has it on disk. */
const legacyHook = (timeout) => ({
  type: 'command',
  command: `${GATE_ENV_FLAG}=block '/bin/node' '/pack/adapters/claude-code/${HOOK_MARKER}'`,
  timeout,
  describe: `${DESCRIBE_PREFIX} (block): on a turn that dispatched a subagent, holds the turn for one more round.`,
});

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

test('the section vocabulary is fixed, and where it ends is recorded rather than guessed', () => {
  // Accepted, because reports are really written all of these ways. "Up next" is here after
  // it was observed blocking a report that carried all three sections and a good running row:
  // the pattern took "next up" and not the same two words in the other order.
  for (const line of ['Next: merge', 'Next steps: merge', 'Up next: merge', 'Next up — merge', 'What is next: merge']) {
    assert.equal(hasSectionLabel(line, 'next'), true, `not recognised as a next section: ${line}`);
  }
  // NOT accepted, and pinned so that widening it is a decision somebody makes on purpose.
  // This is the gate's live false-positive surface: a well-shaped report headed "Still to do"
  // is blocked once, told there is no "what is next" section, and then the gate stands down.
  for (const line of ['Still to do: merge', 'Remaining: merge', 'What is left: merge']) {
    assert.equal(hasSectionLabel(line, 'next'), false, `the vocabulary widened without a decision: ${line}`);
  }
});

test('a report whose next section is headed "Up next" passes, sections and all', () => {
  const report = 'Done: 2 commits (abc1234).\nRunning: child-7f2, state running, last observed 40s ago.\nUp next: merge after review.';
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
  // It may not claim the dispatch happened on THIS turn. All the marker records is that a
  // dispatch happened and no Stop has cleared it since, and a marker outlives its turn
  // whenever that turn ended without a Stop — see MARKER_MAX_AGE_MS. It also says "the shape
  // of one" rather than "one": absent shape is all this gate can see.
  assert.match(reason, /a subagent was dispatched through the Agent tool/);
  assert.doesNotMatch(reason, /this turn dispatched/);
  assert.match(reason, /does not carry the shape of one/);
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
  // A session id that tried to walk out of the marker directory did not. The name is
  // asserted, not scanned: an escaped marker is a file this readdir CANNOT see, so a bare
  // loop over the entries passes by iterating nothing. Observed — deleting the sanitiser in
  // `markerFile` wrote the marker to `<dir>/../../escape/attempt.json` and left every test
  // in this file green, so the loop this replaces was guarding nothing.
  assert.deepEqual(await readdir(directory), ['escapeattempt.json'], 'the session id walked out of the marker directory');
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

test('a gate that cannot record a spent block does not spend one', async () => {
  // Every Stop is a fresh process, so the marker file is this gate's only memory of having
  // blocked. Observed before this guard existed: with the directory made unwritable after
  // arming, the gate returned `decision: "block"` on three consecutive Stops — which walks
  // toward the shared 8-block cap, whose failure mode is an empty answer reported as success.
  const directory = await scratch('gate-nomemory');
  const env = { AGENT_SKILLS_PROGRESS_GATE_DIR: directory };
  await runGate(agentDispatch(), { env });

  await chmod(directory, 0o500);
  try {
    for (const attempt of [1, 2, 3]) {
      const result = await runGate(stopPayload(BAD_REPORT), { env });
      assert.equal(result.status, 0);
      assert.equal(result.stdout, '', `blocked on attempt ${attempt} without being able to record it`);
      assert.match(result.stderr, /could not record a spent block/);
    }
  } finally {
    await chmod(directory, 0o700);
  }

  // With the directory writable again the gate blocks — once — and records that it did.
  const blocked = await runGate(stopPayload(BAD_REPORT), { env });
  assert.equal(parsedBlock(blocked.stdout).decision, 'block');
  assert.equal(JSON.parse(await readFile(markerFile(env, 'sess-abc123'), 'utf8')).blocked, true);
  const second = await runGate(stopPayload(BAD_REPORT), { env });
  assert.equal(second.stdout, '', 'a recorded block must not be spent twice');
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

test('both halves are written, and the arming half is scoped to SubagentStart', () => {
  const entries = build('block');
  for (const entry of [entries.stop, entries.subagentStart]) {
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
  assert.equal(settings.hooks.SubagentStart.length, 1);
  assert.equal(settings.hooks.SubagentStart[0].matcher, '*');
  // `PostToolUse` matcher `Agent` was v0.16.1's arming half and is not written any more:
  // `SubagentStart` covers every subagent kind, and the second family needs no event of
  // its own because the harness hands the Stop payload its own register.
  assert.equal(Object.hasOwn(settings.hooks, 'PostToolUse'), false);
});

test('the describe says what it enforces and never claims to check whether it is true', () => {
  for (const mode of GATE_MODES) {
    const entries = build(mode);
    assert.match(entries.stop.describe, /shape only/);
    assert.match(entries.stop.describe, /cannot verify anything in it/);
    assert.doesNotMatch(entries.stop.describe, /\b(?:verifies|proves|guarantees)\b/i);
  }
  // "once, never twice" shipped here and was false. Live, at coverage 2, a Stop re-armed from the
  // register with no memory of the block it had spent, and only the harness's stop_hook_active kept
  // it from blocking again (adapters/HOOK-OUTPUT-NOTES.md, addendum 2026-09-14). Coverage 1 has the
  // same hole by a different door: an Agent dispatch in the continuation round rewrites the marker
  // with `blocked: false`, and with stop_hook_active absent the next Stop blocks a second time
  // (reproduced against the gate directly). So neither level may promise it, and both name what
  // actually holds the line.
  for (const coverage of COVERAGE_LEVELS) {
    const { describe } = build('block', [], coverage).stop;
    assert.doesNotMatch(describe, /never twice/, `coverage ${coverage} still promises what the gate cannot keep`);
    assert.match(describe, /once per turn/);
    assert.match(describe, /stop_hook_active/, `coverage ${coverage} did not name the backstop that actually holds it`);
  }
  assert.match(build('block', [], 2).stop.describe, /background/);
  assert.match(build('block', [], 1).stop.describe, /Agent dispatch/);
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
  const armingHooks = settings.hooks.SubagentStart.flatMap((group) => group.hooks);
  assert.equal(stopHooks.length, 1, 'two Stop gates would spend two of the eight shared blocks');
  assert.equal(armingHooks.length, 1);
  assert.ok(stopHooks[0].command.includes(`${GATE_ENV_FLAG}=block`));
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

// ---------------------------------------------------------------------------
// Removal must outlive the event list this version happens to write.
// ---------------------------------------------------------------------------

test('removal finds our hooks under any event key, not only the ones this version writes', () => {
  // The trap the coverage design puts first, and the reason it is first: `removeHooks` used
  // to iterate this module's OWN event list, so the moment that list stopped naming an
  // event, a hook already sitting in a user's settings under it became unremovable by
  // `--remove` — left behind forever, arming a marker nothing reads.
  const settings = {
    hooks: {
      AnEventThisVersionNeverWrites: [{
        matcher: '*',
        hooks: [{ type: 'command', command: `node /pack/${HOOK_MARKER}`, describe: `${DESCRIBE_PREFIX} (block): left over from a version that wrote this event.` }],
      }],
    },
  };
  const { settings: pruned, removed } = removeHooks(settings);
  assert.equal(removed, 1);
  assert.deepEqual(pruned, {}, 'a hook under an unfamiliar event key survived --remove');
});

test('the exact hook pair v0.16.1 wrote is removed in full', () => {
  // Pinned as a literal rather than built from this version's builder: the point is the
  // shape an ALREADY-INSTALLED user has on disk, which no longer matches what we write.
  const legacy = (timeout) => ({
    type: 'command',
    command: `AGENT_SKILLS_PROGRESS_GATE=block '/bin/node' '/pack/adapters/claude-code/${HOOK_MARKER}'`,
    timeout,
    describe: `${DESCRIBE_PREFIX} (block): on a turn that dispatched a subagent, holds the turn for one more round.`,
  });
  const settings = {
    model: 'claude-sonnet-4-6',
    hooks: {
      Stop: [{ matcher: '*', hooks: [legacy(10)] }],
      PostToolUse: [{ matcher: 'Agent', hooks: [legacy(5)] }],
    },
  };
  const { settings: pruned, removed } = removeHooks(settings);
  assert.equal(removed, 2);
  assert.deepEqual(pruned, { model: 'claude-sonnet-4-6' });
});

test('one malformed group does not hide our hook, or a foreign one, in the key beside it', () => {
  // Skipping the whole EVENT KEY on one bad group is the unremovable-hook bug wearing a
  // politer face: measured, our own live Stop hook survived `--remove` while the run printed
  // "Removed 1 … hook". A group whose `hooks` is not an array holds no hook entries for us to
  // find, so skipping just that group reaches everything else and loses nothing.
  const malformed = { matcher: 'written-by-something-else' };
  const settings = {
    hooks: {
      Stop: [{ matcher: '*', hooks: [legacyHook(10)] }, malformed],
      SubagentStart: [{ matcher: '*', hooks: [legacyHook(5)] }],
    },
  };
  const { settings: pruned, removed } = removeHooks(settings);
  assert.equal(removed, 2);
  assert.ok(!JSON.stringify(pruned).includes(DESCRIBE_PREFIX), 'a hook of ours survived --remove while the run reported success');
  assert.deepEqual(pruned.hooks.Stop, [malformed], 'a group this script cannot read was not put back untouched');

  // The same whole-key skip hid a FOREIGN gate from the scan that refuses to stack two of them.
  const foreign = {
    hooks: {
      SessionStart: [
        { matcher: 'written-by-something-else' },
        { matcher: '*', hooks: [{ type: 'command', command: `node /elsewhere/${HOOK_MARKER}`, describe: 'somebody else wrote this' }] },
      ],
    },
  };
  assert.throws(() => installHooks(foreign, { entries: build('block') }), /already runs this gate/);
});

test('removal leaves an event key it cannot understand exactly as it found it', () => {
  // Scanning every key means meeting keys this script knows nothing about. A malformed one
  // holds none of our hooks, so it is skipped rather than refused: `--remove` must not fail
  // because of somebody else's typo three keys away.
  const ours = { type: 'command', command: `node /pack/${HOOK_MARKER}`, describe: `${DESCRIBE_PREFIX} (observe): …` };
  const settings = { hooks: { SessionStart: 'not an array at all', Stop: [{ matcher: '*', hooks: [ours] }] } };
  const { settings: pruned, removed } = removeHooks(settings);
  assert.equal(removed, 1);
  assert.deepEqual(pruned, { hooks: { SessionStart: 'not an array at all' } });
});

// ---------------------------------------------------------------------------
// Family B: the harness's own in-flight register, read from the Stop payload.
// Each shape is asserted BOTH ways on purpose.
// ---------------------------------------------------------------------------

test('the register is read by id and status, and by nothing else', () => {
  assert.deepEqual(runningTaskIds([runningTask('b1'), runningTask('b2')]), ['b1', 'b2']);
  // `type` is never enumerated. A backgrounded Agent subagent registers as `subagent` and
  // its id IS the agent_id (OBSERVED 2026-09-14, ../adapters/NOTES.md addendum); a workflow
  // registers as `workflow`; a future build may add a fourth.
  assert.deepEqual(runningTaskIds([{ id: 'a7', type: 'subagent', status: 'running', agent_type: 'general-purpose' }]), ['a7']);
  assert.deepEqual(runningTaskIds([{ id: 'w1', type: 'workflow', status: 'running', name: 'x' }]), ['w1']);
  assert.deepEqual(runningTaskIds([{ id: 'u1', status: 'running' }]), ['u1'], 'an entry with no type at all was dropped');
  // Never arm on the absence of evidence: a status this file does not recognise is not
  // evidence that anything is running. `running` was the only value ever observed.
  for (const status of ['completed', 'failed', 'RUNNING', undefined, null, 1]) {
    assert.deepEqual(runningTaskIds([{ id: 'b1', status }]), [], `counted status ${JSON.stringify(status)}`);
  }
  for (const id of [undefined, null, 42, '', {}]) {
    assert.deepEqual(runningTaskIds([{ id, status: 'running' }]), [], `counted id ${JSON.stringify(id)}`);
  }
  assert.deepEqual(runningTaskIds([runningTask('b1'), runningTask('b1')]), ['b1'], 'a duplicate id was counted twice');
});

test('a malformed register is read as empty and throws nothing', () => {
  for (const value of [undefined, null, 'tasks', 42, {}, [null], [42], ['b1'], [[]], [{ }]]) {
    assert.deepEqual(runningTaskIds(value), [], `threw or counted on ${JSON.stringify(value)}`);
  }
});

test('the edge is the CHANGE in the register, never its level', () => {
  assert.deepEqual(registerEdge({ current: ['b1'], previous: [] }), { appeared: ['b1'], disappeared: [] });
  assert.deepEqual(registerEdge({ current: ['b1', 'b2'], previous: ['b2', 'b1'] }), { appeared: [], disappeared: [] });
  assert.deepEqual(registerEdge({ current: ['b1'], previous: ['b1', 'b2'] }), { appeared: [], disappeared: ['b2'] });
  assert.deepEqual(registerEdge({ current: ['b3'], previous: ['b1'] }), { appeared: ['b3'], disappeared: ['b1'] });
  assert.deepEqual(registerEdge({ current: [], previous: [] }), { appeared: [], disappeared: [] });
  // An absent baseline is EMPTY, not unknown. The other reading would make the first
  // appearance of any task unarmable, and that is the one that matters most.
  assert.deepEqual(registerEdge({}), { appeared: [], disappeared: [] });
  assert.deepEqual(registerEdge({ current: ['b1'] }), { appeared: ['b1'], disappeared: [] });
});

test('the coverage level is 1 for anything that is not exactly 2', () => {
  assert.equal(resolveCoverage({ [COVERAGE_ENV_FLAG]: '2' }), 2);
  assert.equal(resolveCoverage({ [COVERAGE_ENV_FLAG]: ' 2 ' }), 2);
  // A typo must never widen a gate that can end a turn — and must never disarm an installed
  // one either, so the fallback is the narrower armed level rather than `off`.
  for (const value of [undefined, '', '1', '0', '3', 'two', 'yes', '2x']) {
    assert.equal(resolveCoverage({ [COVERAGE_ENV_FLAG]: value }), 1, `widened on ${JSON.stringify(value)}`);
  }
});

// ---------------------------------------------------------------------------
// Family A: delegation, by the one event that covers every subagent kind.
// ---------------------------------------------------------------------------

test('SubagentStart arms for a real subagent, and for nothing else', () => {
  assert.equal(armsForSubagentStart({ agent_type: 'general-purpose' }), true);
  assert.equal(armsForSubagentStart({ agent_type: 'code-reviewer' }), true, 'an unfamiliar agent_type is still a subagent');
  // A workflow's children start asynchronously, at times no turn owns; the register covers
  // workflow work at a turn-anchored point already, so excluding them loses no coverage.
  assert.equal(armsForSubagentStart({ agent_type: 'workflow-subagent' }), false);
  // The compaction subagent's shape (../adapters/NOTES.md). Never arm on absence of evidence.
  for (const agentType of ['', '   ', undefined, null, 42, {}, []]) {
    assert.equal(armsForSubagentStart({ agent_type: agentType }), false, `armed on ${JSON.stringify(agentType)}`);
  }
  assert.equal(armsForSubagentStart({}), false);
  assert.equal(armsForSubagentStart(null), false);
});

test('the external-agent allowlist matches a whole skill name and never a part of one', () => {
  const allow = resolveWatchedSkills({ [SKILLS_ENV_FLAG]: ' codex , GPT-Researcher ,, ' });
  assert.deepEqual(allow, ['codex', 'gpt-researcher']);
  assert.equal(armsForSkill({ tool_input: { skill: 'codex' } }, allow), true);
  assert.equal(armsForSkill({ tool_input: { skill: 'CODEX' } }, allow), true);
  assert.equal(armsForSkill({ tool_input: { skill: ' codex ' } }, allow), true);
  // Substring matching is the defect family this design refused outright — four of the
  // sibling gate's eight defects were one regex reading argument text as structure.
  for (const skill of ['codex-helper', 'my-codex', 'code', 'codexx', '', '  ', undefined, null, 42, {}]) {
    assert.equal(armsForSkill({ tool_input: { skill } }, allow), false, `matched ${JSON.stringify(skill)}`);
  }
  assert.equal(armsForSkill({ tool_input: {} }, allow), false);
  assert.equal(armsForSkill({}, allow), false);
  assert.equal(armsForSkill(null, allow), false);
  // Default empty: a session that configured nothing arms on no skill at all.
  assert.deepEqual(resolveWatchedSkills({}), []);
  assert.deepEqual(resolveWatchedSkills({ [SKILLS_ENV_FLAG]: '  , ,' }), []);
  assert.equal(armsForSkill({ tool_input: { skill: 'codex' } }, []), false);
});

// ---------------------------------------------------------------------------
// The one new check: contradiction detection, not content verification.
// ---------------------------------------------------------------------------

test('a report may not declare the running section empty while the register lists tasks', () => {
  assert.deepEqual(findReportFailures(EMPTY_RUNNING_REPORT), [], 'an empty register keeps "Running: none" a result');
  assert.deepEqual(findReportFailures(EMPTY_RUNNING_REPORT, { runningTaskCount: 0 }), []);
  assert.deepEqual(
    findReportFailures(EMPTY_RUNNING_REPORT, { runningTaskCount: 2 }).map((failure) => failure.code),
    ['running-declared-empty-while-tasks-in-flight'],
  );
});

test('a report may not claim no lifecycle evidence while the register is handing the gate some', () => {
  assert.deepEqual(findReportFailures(NO_EVIDENCE_REPORT), []);
  const codes = findReportFailures(NO_EVIDENCE_REPORT, { runningTaskCount: 1 }).map((failure) => failure.code);
  assert.ok(codes.includes('no-evidence-claimed-while-tasks-in-flight'), `no contradiction named: ${codes.join(', ')}`);
  // …and the sentence stops standing in for the section it replaced, so the absent label is
  // named too. `agent-lifecycle`'s sentence is for a run with NO evidence source; the
  // register in this very payload is one.
  assert.ok(codes.includes('missing-running'));
});

test('an honest report about work in flight passes, which is the whole point of the check', () => {
  // It cannot refuse this, because an honest report about two running tasks says neither of
  // the two things above. The gate still cannot tell whether any row is TRUE.
  assert.deepEqual(findReportFailures(GOOD_REPORT, { runningTaskCount: 2 }), []);
  // No row-count check: a report may legitimately group, and the count in the register is
  // not a count of rows the report owes.
  const grouped = 'Done: 3 commits (abc1234).\nRunning: 2 background shells, both state running, last observed just now (harness register at turn end).\nNext: merge.';
  assert.deepEqual(findReportFailures(grouped, { runningTaskCount: 2 }), [], 'a grouped row was refused for not counting rows');
  // The freshness phrasing the reason offers has to be one the gate actually accepts.
  assert.equal(hasFreshnessToken('last observed just now (harness register at turn end)'), true);
});

test('an absence word inside a live row is not a denial, and neither is quoting the sentence', () => {
  // MEASURED FALSE POSITIVES, all five of them, before the `carriesRow` guard existed. Both
  // contradiction patterns are scanned over the WHOLE running block, so any of these refused
  // an honest report about work that really was running — which is the one thing the check is
  // documented as unable to do. A section carrying a literal state AND a freshness is a row,
  // not a denial, whatever words sit beside it.
  const honest = [
    'Done: 3 commits.\nRunning: dev server, state running, last observed just now — none of the tests have failed yet.\nNext: land it.',
    'Done: 3 commits.\nRunning:\n- dev server, state running, last observed just now. Failures: none so far.\nNext: land it.',
    'Done: 3 commits.\nRunning: indexer, state running, last observed just now (queue empty).\nNext: land it.',
    'Done: 3 commits.\nRunning: dev server, state running, last observed just now. There is no work left to dispatch.\nNext: land it.',
    `Done: 3 commits.\nRunning: dev server, state running, last observed just now.\nNext: land it.\n\nAside: with no evidence at all the skill says to write "${NO_EVIDENCE_SENTENCE}" instead.`,
  ];
  for (const message of honest) {
    assert.deepEqual(findReportFailures(message, { runningTaskCount: 2 }), [], `refused an honest report: ${message.split('\n')[1]}`);
  }
  // …and the guard did not cost the check its teeth. Each of these carries no row at all.
  const denials = [
    ['Done: 3.\nRunning: none.\nNext: land.', 'running-declared-empty-while-tasks-in-flight'],
    ['Done: 3.\nRunning: none — nothing is currently running.\nNext: land.', 'running-declared-empty-while-tasks-in-flight'],
    ['Done: 3.\nRunning: n/a\nNext: land.', 'running-declared-empty-while-tasks-in-flight'],
    ['Done: 3.\nRunning: none, though the review agent is running.\nNext: land.', 'running-declared-empty-while-tasks-in-flight'],
    [`Done: 3.\n${NO_EVIDENCE_SENTENCE}\nNext: land.`, 'no-evidence-claimed-while-tasks-in-flight'],
  ];
  for (const [message, code] of denials) {
    const codes = findReportFailures(message, { runningTaskCount: 2 }).map((failure) => failure.code);
    assert.ok(codes.includes(code), `a denial went uncaught (${codes.join(', ') || 'no failures'}): ${message.split('\n')[1]}`);
  }
  // At coverage 1 none of this exists, in either direction: v0.16.1 read no register at all.
  for (const [message] of denials) assert.deepEqual(findReportFailures(message), []);
});

// ---------------------------------------------------------------------------
// The Stop decision, with the new arming family factored in.
// ---------------------------------------------------------------------------

test('the register edge arms a turn that dispatched nothing through any tool', () => {
  const decision = decideStop({
    payload: stopWith(BAD_REPORT, [runningTask('b1')]),
    marker: null,
    coverage: 2,
    edge: { appeared: ['b1'], disappeared: [] },
  });
  assert.equal(decision.block, true);
  assert.match(decision.reason, /registered background work/);
});

test('a task that is merely still running arms nothing', () => {
  // Arming on the LEVEL would demand a report on every turn for as long as a dev server sits
  // in the background. That is the noise that gets a gate uninstalled.
  const decision = decideStop({
    payload: stopWith(BAD_REPORT, [runningTask('b1')]),
    marker: null,
    coverage: 2,
    edge: { appeared: [], disappeared: [] },
  });
  assert.equal(decision.block, false);
  assert.equal(decision.disarm, false);
});

test('a disappearance arms, and the reason refuses to call it a completion', () => {
  const decision = decideStop({
    payload: stopWith(BAD_REPORT, []),
    marker: null,
    coverage: 2,
    edge: { appeared: [], disappeared: ['b1'] },
  });
  assert.equal(decision.block, true);
  const opening = decision.reason.split('\n')[0];
  assert.match(opening, /no longer listed/);
  assert.match(opening, /cannot see a terminal state/);
  // Terminal states belong to `agent-lifecycle` and are immutable once set. Nothing in a
  // Stop hook may imply one from a single snapshot omission.
  assert.doesNotMatch(opening, /\b(?:completed|complete|finished|succeeded|failed|cancelled|canceled|done|lost)\b/i);
});

test('at coverage 1 the register is not read at all, and no new check applies', () => {
  const unarmed = decideStop({
    payload: stopWith(BAD_REPORT, [runningTask('b1')]),
    marker: null,
    coverage: 1,
    edge: { appeared: ['b1'], disappeared: ['b2'] },
  });
  assert.equal(unarmed.block, false);
  assert.equal(unarmed.disarm, false);
  const armed = decideStop({
    payload: stopWith(EMPTY_RUNNING_REPORT, [runningTask('b1')]),
    marker: { version: 2, armedAt: Date.now(), dispatches: 1, blocked: false },
    coverage: 1,
  });
  assert.equal(armed.block, false, 'a v0.16.1 install gained a check it never had');
});

test('the reason names the family that armed it, and says the same three things every time', () => {
  for (const [cause, needle] of [
    ['agent-tool', /a subagent was dispatched through the Agent tool/],
    ['subagent-start', /a subagent was started/],
    ['watched-skill', /external-agent list/],
    ['tasks-appeared', /registered background work/],
    ['tasks-disappeared', /no longer listed/],
  ]) {
    const reason = buildBlockReason(findReportFailures(BAD_REPORT), { causes: [cause] });
    assert.match(reason, needle, `cause ${cause} did not say what armed it`);
    assert.match(reason, /matches strings/, `cause ${cause} dropped the shape-check disclaimer`);
    assert.match(reason, /blocks once per turn/, `cause ${cause} dropped the one-block ceiling`);
    assert.match(reason, /--remove/, `cause ${cause} dropped how to remove it`);
    assert.doesNotMatch(reason, /\b(?:verified|confirms|proves|guarantees)\b/i);
  }
  // The default is unchanged from v0.16.1, so an old install's wording does not move.
  assert.equal(buildBlockReason(findReportFailures(BAD_REPORT)), buildBlockReason(findReportFailures(BAD_REPORT), { causes: ['agent-tool'] }));
});

test('the reason states the register count and offers a phrasing the gate itself accepts', () => {
  const reason = buildBlockReason(
    findReportFailures(EMPTY_RUNNING_REPORT, { runningTaskCount: 2 }),
    { causes: ['tasks-appeared'], runningCount: 2 },
  );
  assert.match(reason, /2 background task/);
  assert.match(reason, /last observed just now \(harness register at turn end\)/);
  // A count this gate computed is a fact. Text it copied out of the payload is somebody
  // else's prose arriving in a channel the model reads as instructions.
  assert.doesNotMatch(reason, /sleep 400/);
  assert.doesNotMatch(reason, /a background shell/);
});

// ---------------------------------------------------------------------------
// The hook wrapper, driven for real, at the widened coverage.
// ---------------------------------------------------------------------------

test('end to end: the appearance edge arms a turn, a steady register does not, a disappearance does', async () => {
  const directory = await scratch('gate-register');
  const env = { AGENT_SKILLS_PROGRESS_GATE_DIR: directory, ...LEVEL2 };

  const first = await runGate(stopWith(BAD_REPORT, [runningTask('b1'), runningTask('b2')]), { env });
  assert.equal(first.status, 0);
  assert.equal(parsedBlock(first.stdout).decision, 'block');

  // The edge arms a turn with NO marker on disk — no tool call wrote one — so the block has
  // to bring a whole marker into being, `armedAt` included. Without that the record reads as
  // stale on the next Stop, and the gate has forgotten it already spoke.
  const spent = JSON.parse(await readFile(markerFile(env, 'sess-abc123'), 'utf8'));
  assert.equal(spent.blocked, true);
  assert.ok(Number.isFinite(Number(spent.armedAt)), 'the spent block was recorded without a timestamp');
  assert.deepEqual(spent.causes, ['tasks-appeared']);

  const second = await runGate(stopWith(BAD_REPORT, [runningTask('b1'), runningTask('b2')]), { env });
  assert.equal(second.stdout, '', 'the level armed a turn where the edge had not moved');
  const third = await runGate(stopWith(BAD_REPORT, [runningTask('b1'), runningTask('b2')]), { env });
  assert.equal(third.stdout, '', 'a dev server left running made a third turn owe a report');

  const fourth = await runGate(stopWith(BAD_REPORT, [runningTask('b1')]), { env });
  assert.equal(parsedBlock(fourth.stdout).decision, 'block');
});

test('a stale marker does not cost the gate its memory of the block it just spent', async () => {
  // A stale marker is dropped for ARMING but was still spread into the record of the spent
  // block, `armedAt` and all — so the record came back stale on the next Stop, `blocked: true`
  // was discarded, and the gate blocked again. Measured at three consecutive Stops, which
  // leaves `stop_hook_active` as the only thing between this gate and the shared 8-block
  // budget. The gate is documented as not relying on that, so the timestamp is stamped fresh.
  const directory = await scratch('gate-stale-spend');
  const env = { AGENT_SKILLS_PROGRESS_GATE_DIR: directory, ...LEVEL2 };
  await writeFile(markerFile(env, 'sess-abc123'), JSON.stringify({
    version: 2,
    armedAt: Date.now() - MARKER_MAX_AGE_MS - 60_000,
    dispatches: 1,
    causes: ['agent-tool'],
    blocked: false,
  }));

  const first = await runGate(stopWith(BAD_REPORT, [runningTask('b1')]), { env });
  assert.equal(parsedBlock(first.stdout).decision, 'block');
  const spent = JSON.parse(await readFile(markerFile(env, 'sess-abc123'), 'utf8'));
  assert.equal(spent.blocked, true);
  assert.ok(
    Date.now() - Number(spent.armedAt) < MARKER_MAX_AGE_MS,
    'the spent block was recorded with a timestamp the next Stop will read as stale',
  );

  // No `stop_hook_active`: the harness's backstop is deliberately not what is being tested.
  const second = await runGate(stopWith(BAD_REPORT, [runningTask('b1'), runningTask('b2')]), { env });
  assert.equal(second.stdout, '', 'the gate spent a second block on a turn it had already spoken on');
});

test('an absent baseline is read as empty, so the first task the gate ever sees arms', async () => {
  const directory = await scratch('gate-register-first');
  const env = { AGENT_SKILLS_PROGRESS_GATE_DIR: directory, ...LEVEL2 };
  const result = await runGate(stopWith(BAD_REPORT, [runningTask('b1')]), { env });
  assert.equal(parsedBlock(result.stdout).decision, 'block');
});

test('the baseline is written only while something is running, and removed when nothing is', async () => {
  const directory = await scratch('gate-register-file');
  const env = { AGENT_SKILLS_PROGRESS_GATE_DIR: directory, ...LEVEL2 };
  const baseline = path.basename(registerFile(env, 'sess-abc123'));

  await runGate(stopWith(GOOD_REPORT, []), { env });
  assert.deepEqual(await readdir(directory), [], 'a session that backgrounds nothing created a file');

  const armed = await runGate(stopWith(GOOD_REPORT, [runningTask('b1')]), { env });
  assert.deepEqual(await readdir(directory), [baseline]);
  // A turn the register armed and the report satisfied says so where the user can read it
  // and the model cannot: stderr, which Claude Code does not deliver at exit 0.
  assert.equal(armed.stdout, '');
  assert.match(armed.stderr, /the report is there/);

  await runGate(stopWith(GOOD_REPORT, []), { env });
  assert.deepEqual(await readdir(directory), [], 'the baseline outlived the work it recorded');
});

test('coverage absent or unrecognised keeps v0.16.1 behaviour exactly, register and all', async () => {
  for (const level of [undefined, '1', '0', 'two']) {
    const directory = await scratch('gate-level1');
    const env = { AGENT_SKILLS_PROGRESS_GATE_DIR: directory, [COVERAGE_ENV_FLAG]: level };
    const result = await runGate(stopWith(BAD_REPORT, [runningTask('b1')]), { env });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '', `level ${JSON.stringify(level)} armed on the register`);
    assert.deepEqual(await readdir(directory), [], `level ${JSON.stringify(level)} wrote a baseline`);
  }
});

test('end to end: a SubagentStart arms the turn at coverage 2, and says so in the reason', async () => {
  const directory = await scratch('gate-subagent');
  const env = { AGENT_SKILLS_PROGRESS_GATE_DIR: directory, ...LEVEL2 };
  const arming = await runGate(subagentStart(), { env });
  assert.equal(arming.status, 0);
  assert.equal(arming.stdout, '', 'the arming half must never print to stdout');
  assert.equal(arming.stderr, '');

  const marker = JSON.parse(await readFile(markerFile(env, 'sess-abc123'), 'utf8'));
  assert.deepEqual(marker.causes, ['subagent-start']);
  assert.equal(marker.dispatches, 1);

  const blocked = await runGate(stopPayload(BAD_REPORT), { env });
  assert.match(parsedBlock(blocked.stdout).reason, /a subagent was started/);
});

test('a workflow child, the compaction subagent, and coverage 1 all arm nothing', async () => {
  const directory = await scratch('gate-subagent-nearmiss');
  const env = { AGENT_SKILLS_PROGRESS_GATE_DIR: directory, ...LEVEL2 };
  for (const agentType of ['workflow-subagent', '', undefined]) {
    const result = await runGate(subagentStart({ agent_type: agentType }), { env });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  }
  assert.deepEqual(await readdir(directory), [], 'an excluded agent_type armed the gate');

  // An updated pack under an old settings entry behaves exactly as it did before.
  await runGate(subagentStart(), { env: { AGENT_SKILLS_PROGRESS_GATE_DIR: directory } });
  assert.deepEqual(await readdir(directory), [], 'coverage 1 armed on SubagentStart');
});

test('end to end: only an exactly-listed skill arms, and with no list configured none does', async () => {
  const directory = await scratch('gate-skill');
  const env = { AGENT_SKILLS_PROGRESS_GATE_DIR: directory, ...LEVEL2, [SKILLS_ENV_FLAG]: 'codex' };
  for (const skill of ['codex-helper', 'code', 'gpt-researcher', '']) {
    const result = await runGate(skillCall(skill), { env });
    assert.equal(result.stdout, '');
  }
  assert.deepEqual(await readdir(directory), [], 'a near miss armed the gate');

  const armed = await runGate(skillCall('codex'), { env });
  assert.equal(armed.stdout, '', 'the arming half must never print to stdout');
  assert.deepEqual(JSON.parse(await readFile(markerFile(env, 'sess-abc123'), 'utf8')).causes, ['watched-skill']);

  const bare = await scratch('gate-skill-bare');
  await runGate(skillCall('codex'), { env: { AGENT_SKILLS_PROGRESS_GATE_DIR: bare, ...LEVEL2 } });
  assert.deepEqual(await readdir(bare), [], 'an unconfigured session armed on a Skill call');

  const level1 = await scratch('gate-skill-level1');
  await runGate(skillCall('codex'), { env: { AGENT_SKILLS_PROGRESS_GATE_DIR: level1, [SKILLS_ENV_FLAG]: 'codex' } });
  assert.deepEqual(await readdir(level1), [], 'coverage 1 armed on a Skill call');
});

test('the gate refuses a report that denies what the harness told it in the same payload', async () => {
  const directory = await scratch('gate-contradiction');
  const env = { AGENT_SKILLS_PROGRESS_GATE_DIR: directory, ...LEVEL2 };
  const blocked = await runGate(stopWith(EMPTY_RUNNING_REPORT, [runningTask('b1'), runningTask('b2')]), { env });
  const reason = parsedBlock(blocked.stdout).reason;
  assert.match(reason, /2 background task/);
  assert.match(reason, /still running/);

  // The same report, with the register empty, is an honest result and ends the turn.
  const clean = await scratch('gate-contradiction-empty');
  const passing = await runGate(stopWith(EMPTY_RUNNING_REPORT, []), { env: { AGENT_SKILLS_PROGRESS_GATE_DIR: clean, ...LEVEL2 } });
  assert.equal(passing.stdout, '');
});

test('nothing at all reaches the model on a passing turn, on every newly armed path', async () => {
  // The property this whole design is judged against, measured for each new arming signal in
  // turn rather than once at the end.
  const cases = [
    { name: 'subagent-start', arm: subagentStart(), extra: {} },
    { name: 'watched-skill', arm: skillCall('codex'), extra: { [SKILLS_ENV_FLAG]: 'codex' } },
    { name: 'agent-tool', arm: agentDispatch(), extra: {} },
  ];
  for (const { name, arm, extra } of cases) {
    const directory = await scratch(`gate-quiet-${name}`);
    const env = { AGENT_SKILLS_PROGRESS_GATE_DIR: directory, ...LEVEL2, ...extra };
    const arming = await runGate(arm, { env });
    assert.equal(arming.status, 0, `${name}: non-zero exit`);
    assert.equal(arming.stdout, '', `${name}: the arming half printed to stdout`);
    assert.equal(arming.stderr, '', `${name}: the arming half printed to stderr`);
    const passing = await runGate(stopWith(GOOD_REPORT, [runningTask('b1')]), { env });
    assert.equal(passing.status, 0, `${name}: non-zero exit on the passing turn`);
    assert.equal(passing.stdout, '', `${name}: a passing turn printed to stdout`);
  }

  const directory = await scratch('gate-quiet-register');
  const env = { AGENT_SKILLS_PROGRESS_GATE_DIR: directory, ...LEVEL2 };
  const passing = await runGate(stopWith(GOOD_REPORT, [runningTask('b1')]), { env });
  assert.equal(passing.stdout, '', 'register: a passing turn printed to stdout');
  const steady = await runGate(stopWith('Yes, that file is in src/.', [runningTask('b1')]), { env });
  assert.equal(steady.stdout, '', 'a one-line answer with a dev server running was refused');
  assert.equal(steady.stderr, '', 'a turn owing nothing wrote to stderr');
});

test('a malformed register arms nothing, throws nothing, and ends in exit 0', async () => {
  const directory = await scratch('gate-register-malformed');
  const env = { AGENT_SKILLS_PROGRESS_GATE_DIR: directory, ...LEVEL2 };
  const inputs = [
    '{"hook_event_name":"Stop","session_id":"s1","background_tasks":"nope","last_assistant_message":"hi"}',
    '{"hook_event_name":"Stop","session_id":"s1","background_tasks":[null,42,[],{"id":5,"status":"running"}],"last_assistant_message":"hi"}',
    '{"hook_event_name":"Stop","session_id":"s1","background_tasks":{"id":"b1"},"last_assistant_message":"hi"}',
    '{"hook_event_name":"SubagentStart","session_id":"s1","agent_type":[]}',
    '{"hook_event_name":"SubagentStart"}',
    '{"hook_event_name":"PostToolUse","tool_name":"Skill","session_id":"s1","tool_input":42}',
  ];
  for (const raw of inputs) {
    const result = await runGate(undefined, { env, raw });
    assert.equal(result.status, 0, `non-zero exit for ${raw.slice(0, 50)}`);
    assert.equal(result.stdout, '', `output for ${raw.slice(0, 50)}`);
  }
  assert.deepEqual(await readdir(directory), [], 'a malformed payload wrote a file');
});

test('a baseline it cannot write, and one it cannot parse, both leave the turn ungated', async () => {
  const usable = await scratch('gate-register-garbage');
  const env = { AGENT_SKILLS_PROGRESS_GATE_DIR: usable, ...LEVEL2 };
  await writeFile(registerFile(env, 'sess-abc123'), 'this is not json');
  // A corrupt baseline reads as empty, so the running task reads as new: one block, once,
  // which is the same cost as a swept temp directory and is the safe direction.
  const result = await runGate(stopWith(BAD_REPORT, [runningTask('b1')]), { env });
  assert.equal(result.status, 0);
  assert.equal(parsedBlock(result.stdout).decision, 'block');

  const root = await scratch('gate-register-readonly');
  const directory = path.join(root, 'nested');
  await chmod(root, 0o500);
  try {
    const unwritable = await runGate(stopWith(GOOD_REPORT, [runningTask('b1')]), {
      env: { AGENT_SKILLS_PROGRESS_GATE_DIR: directory, ...LEVEL2 },
    });
    assert.equal(unwritable.status, 0);
    assert.equal(unwritable.stdout, '');
  } finally {
    await chmod(root, 0o700);
  }
});

// ---------------------------------------------------------------------------
// The installer, at the widened coverage.
// ---------------------------------------------------------------------------

test('the installer declares the coverage level in the command it writes', () => {
  const entries = build('block');
  for (const entry of [entries.stop, entries.subagentStart]) {
    assert.ok(entry.command.includes(`${COVERAGE_ENV_FLAG}=2`), 'the widened coverage was not declared in the command');
    assert.ok(entry.command.startsWith(`${GATE_ENV_FLAG}=block `));
    assert.ok(entry.command.includes(HOOK_MARKER));
    assert.ok(Number.isInteger(entry.timeout) && entry.timeout > 0 && entry.timeout <= 10);
    assert.ok(entry.describe.startsWith(DESCRIBE_PREFIX));
    assert.match(entry.describe, /--remove/);
  }
  assert.equal(entries.skill, null, 'a Skill hook was built with no allowlist configured');
});

test('the arming half is SubagentStart, and PostToolUse is written only for a configured skill list', () => {
  const plain = installHooks({}, { entries: build('block') });
  assert.equal(plain.hooks.SubagentStart.length, 1);
  assert.equal(plain.hooks.SubagentStart[0].matcher, '*');
  assert.equal(plain.hooks.SubagentStart[0].hooks.length, 1);
  assert.equal(Object.hasOwn(plain.hooks, 'PostToolUse'), false, 'an unconfigured install gained a PostToolUse hook');

  const entries = build('block', ['codex', 'gpt-researcher']);
  const settings = installHooks({}, { entries });
  assert.equal(settings.hooks.PostToolUse[0].matcher, 'Skill');
  assert.ok(settings.hooks.PostToolUse[0].hooks[0].command.includes(`${SKILLS_ENV_FLAG}='codex,gpt-researcher'`));
  assert.match(entries.skill.describe, /codex/);
});

test('installing over a v0.16.1 install leaves one of each and orphans nothing', () => {
  const legacy = {
    hooks: {
      Stop: [{ matcher: '*', hooks: [legacyHook(10)] }],
      PostToolUse: [{ matcher: 'Agent', hooks: [legacyHook(5)] }],
    },
  };
  const settings = installHooks(legacy, { entries: build('block') });
  assert.equal(settings.hooks.Stop.flatMap((group) => group.hooks).length, 1, 'two Stop gates would spend two of the eight shared blocks');
  assert.equal(settings.hooks.SubagentStart.flatMap((group) => group.hooks).length, 1);
  assert.equal(Object.hasOwn(settings.hooks, 'PostToolUse'), false, 'the v0.16.1 arming hook was left behind, arming a marker nothing reads');
});

test('a foreign hook wearing the gate name is refused wherever it sits, not only where we write', () => {
  const foreign = {
    hooks: {
      SubagentStart: [{ matcher: '*', hooks: [{ type: 'command', command: `node /elsewhere/${HOOK_MARKER}` }] }],
    },
  };
  assert.throws(() => installHooks(foreign, { entries: build('block') }), /was not written by this installer/);
});

test('the installer refuses a skill name that is not a plain name', async () => {
  const directory = await scratch('gate-skill-args');
  const settingsPath = path.join(directory, 'settings.json');
  for (const value of ["co'dex", 'codex exec', 'codex$(x)', '../codex']) {
    const result = await runInstaller(['--skills', value, '--settings', settingsPath]);
    assert.equal(result.status, 1, `accepted ${JSON.stringify(value)}`);
  }
  assert.deepEqual(await readdir(directory), [], 'a refused run still wrote something');

  const ok = await runInstaller(['--mode', 'block', '--coverage', '2', '--skills', 'codex, gpt-researcher', '--settings', settingsPath]);
  assert.equal(ok.status, 0, ok.stderr);
  const written = JSON.parse(await readFile(settingsPath, 'utf8'));
  assert.equal(written.hooks.PostToolUse[0].matcher, 'Skill');
  assert.match(ok.stdout, /codex/);

  const removed = await runInstaller(['--remove', '--settings', settingsPath]);
  assert.match(removed.stdout, /Removed 3 report-progress gate hooks/);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, 'utf8')), {});
});

test('the installer output says what the widened coverage does and what it still cannot see', async () => {
  const directory = await scratch('gate-install-output');
  const settingsPath = path.join(directory, 'settings.json');
  const installed = await runInstaller(['--mode', 'block', '--coverage', '2', '--settings', settingsPath]);
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, /background/i);
  assert.match(installed.stdout, /cannot/i);
  // The honest limits, named in the output a user actually reads.
  assert.match(installed.stdout, /foreground/i);
});

// ---------------------------------------------------------------------------
// The coverage level is chosen, and updating keeps it.
//
// Before this, the installer wrote coverage 2 unconditionally, so re-running it to pick up a
// new version and widening an armed gate were the same action — and nothing said so. Every
// case below drives the REAL installer against a REAL settings file in a temp directory, and
// where it matters whether the result can fire, runs the command it wrote through a real
// shell, exactly as the harness does.
// ---------------------------------------------------------------------------

/** The command of our hook under one event and matcher, read from a written settings file. */
function ourCommand(settings, event, matcher) {
  const hooks = (settings.hooks?.[event] ?? [])
    .filter((group) => group.matcher === matcher)
    .flatMap((group) => group.hooks)
    .filter((hook) => typeof hook.describe === 'string' && hook.describe.startsWith(DESCRIBE_PREFIX));
  assert.equal(hooks.length, 1, `expected exactly one of our ${event}/${matcher} hooks, found ${hooks.length}`);
  return hooks[0].command;
}

const hasOurHook = (settings, event, matcher) => (settings.hooks?.[event] ?? [])
  .filter((group) => group.matcher === matcher)
  .some((group) => group.hooks.some((hook) => typeof hook.describe === 'string' && hook.describe.startsWith(DESCRIBE_PREFIX)));

/** Run a hook command the installer wrote, through /bin/sh, the way the harness runs it. The
 *  ambient gate variables are cleared so only the assignments IN the command count. */
function runWrittenCommand(command, payload, markerDirectory) {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        [GATE_ENV_FLAG]: undefined,
        [COVERAGE_ENV_FLAG]: undefined,
        [SKILLS_ENV_FLAG]: undefined,
        AGENT_SKILLS_PROGRESS_GATE_DIR: markerDirectory,
      },
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
}

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

/** What 0.17.0 wrote: coverage 2 in the command, `SubagentStart` as the arming half. */
const v0170Hook = (timeout) => ({
  type: 'command',
  command: `AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 '/bin/node' '/pack/adapters/claude-code/${HOOK_MARKER}'`,
  timeout,
  describe: `${DESCRIBE_PREFIX} (block): on a turn that started a subagent, holds the turn for one more round.`,
});

test('--coverage takes 1 or 2 and nothing else, and a refused level writes nothing', async () => {
  const directory = await scratch('gate-coverage-args');
  const settingsPath = path.join(directory, 'settings.json');
  for (const value of ['3', '0', 'two', '', '2.0', ' 2']) {
    const result = await runInstaller(['--coverage', value, '--settings', settingsPath]);
    assert.equal(result.status, 1, `accepted --coverage ${JSON.stringify(value)}`);
    assert.match(result.stderr, /--coverage must be 1 or 2/);
  }
  const dangling = await runInstaller(['--settings', settingsPath, '--coverage']);
  assert.equal(dangling.status, 1, 'accepted --coverage with no value');
  assert.deepEqual(await readdir(directory), [], 'a refused run still wrote something');

  for (const value of ['1', '2']) {
    const result = await runInstaller(['--coverage', value, '--settings', settingsPath]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(ourCommand(await readJson(settingsPath), 'Stop', '*').includes(`${COVERAGE_ENV_FLAG}=${value} `));
  }
});

test('a new install with no level gets the narrow one, and says so', async () => {
  const directory = await scratch('gate-coverage-default');
  const settingsPath = path.join(directory, 'settings.json');
  const installed = await runInstaller(['--mode', 'block', '--settings', settingsPath]);
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, /Set coverage 1 \(the default for a new install\)/);
  assert.match(installed.stdout, /--coverage 2/, 'the output did not say how to widen it');

  const written = await readJson(settingsPath);
  assert.ok(ourCommand(written, 'Stop', '*').includes(`${COVERAGE_ENV_FLAG}=1 `), 'the level is not legible in the command');
  // Coverage 1 arms on ONE signal, and this is the hook that delivers it.
  assert.ok(ourCommand(written, 'PostToolUse', 'Agent').includes(`${COVERAGE_ENV_FLAG}=1 `));
  assert.equal(Object.hasOwn(written.hooks, 'SubagentStart'), false, 'coverage 1 wrote a SubagentStart hook it never reads');
});

test('an existing coverage-1 install, re-run with no level, stays at 1 — and --coverage 2 moves it', async () => {
  const directory = await scratch('gate-coverage-keep-1');
  const settingsPath = path.join(directory, 'settings.json');
  assert.equal((await runInstaller(['--mode', 'block', '--coverage', '1', '--settings', settingsPath])).status, 0);

  // The update: the same command a user runs to pick up a new version, with no level named.
  const updated = await runInstaller(['--mode', 'block', '--settings', settingsPath]);
  assert.equal(updated.status, 0, updated.stderr);
  assert.match(updated.stdout, /Kept coverage 1 \(already installed/);
  assert.doesNotMatch(updated.stdout, /Set coverage/);
  let written = await readJson(settingsPath);
  assert.ok(ourCommand(written, 'Stop', '*').includes(`${COVERAGE_ENV_FLAG}=1 `), 'updating widened the gate');
  assert.ok(!ourCommand(written, 'Stop', '*').includes(`${COVERAGE_ENV_FLAG}=2`), 'updating widened the gate');
  assert.ok(hasOurHook(written, 'PostToolUse', 'Agent'), 'kept level 1 but dropped the only hook that arms it');
  assert.equal(hasOurHook(written, 'SubagentStart', '*'), false);

  // The other way: naming the level is how it changes, and the output names the change.
  const widened = await runInstaller(['--mode', 'block', '--coverage', '2', '--settings', settingsPath]);
  assert.equal(widened.status, 0, widened.stderr);
  assert.match(widened.stdout, /Set coverage 2 \(was 1\)/);
  written = await readJson(settingsPath);
  assert.ok(ourCommand(written, 'Stop', '*').includes(`${COVERAGE_ENV_FLAG}=2 `), '--coverage 2 did not move it');
  assert.ok(hasOurHook(written, 'SubagentStart', '*'));
  assert.equal(hasOurHook(written, 'PostToolUse', 'Agent'), false, 'the coverage-1 arming hook was left behind at coverage 2');

  // …and once widened, an update keeps THAT.
  const again = await runInstaller(['--mode', 'block', '--settings', settingsPath]);
  assert.match(again.stdout, /Kept coverage 2 \(already installed/);
  assert.ok(ourCommand(await readJson(settingsPath), 'Stop', '*').includes(`${COVERAGE_ENV_FLAG}=2 `));
});

test('a v0.16.1 install, which names no level, is read as coverage 1 and updated in place', async () => {
  const directory = await scratch('gate-coverage-v0161');
  const settingsPath = path.join(directory, 'settings.json');
  await writeFile(settingsPath, JSON.stringify({
    model: 'claude-sonnet-4-6',
    hooks: { Stop: [{ matcher: '*', hooks: [legacyHook(10)] }], PostToolUse: [{ matcher: 'Agent', hooks: [legacyHook(5)] }] },
  }, null, 2));

  const updated = await runInstaller(['--mode', 'block', '--settings', settingsPath]);
  assert.equal(updated.status, 0, updated.stderr);
  assert.match(updated.stdout, /Kept coverage 1 \(already installed/);
  const written = await readJson(settingsPath);
  assert.equal(written.model, 'claude-sonnet-4-6');
  assert.ok(ourCommand(written, 'Stop', '*').includes(`${COVERAGE_ENV_FLAG}=1 `));
  assert.ok(ourCommand(written, 'PostToolUse', 'Agent').includes(HOOK_MARKER));
  assert.equal(hasOurHook(written, 'SubagentStart', '*'), false, 'updating a v0.16.1 install widened it');
});

test('a 0.17.0 install at coverage 2 is kept at 2 by an update', async () => {
  const directory = await scratch('gate-coverage-v0170');
  const settingsPath = path.join(directory, 'settings.json');
  await writeFile(settingsPath, JSON.stringify({
    hooks: { Stop: [{ matcher: '*', hooks: [v0170Hook(10)] }], SubagentStart: [{ matcher: '*', hooks: [v0170Hook(5)] }] },
  }, null, 2));

  const updated = await runInstaller(['--mode', 'block', '--settings', settingsPath]);
  assert.equal(updated.status, 0, updated.stderr);
  assert.match(updated.stdout, /Kept coverage 2 \(already installed/);
  const written = await readJson(settingsPath);
  assert.ok(ourCommand(written, 'Stop', '*').includes(`${COVERAGE_ENV_FLAG}=2 `), 'updating narrowed the gate');
  assert.ok(hasOurHook(written, 'SubagentStart', '*'));
  assert.equal(hasOurHook(written, 'PostToolUse', 'Agent'), false);
});

test('the hooks written at each level are hooks that level can fire on', async () => {
  // Keeping a level while writing a hook set that level never reads would trade a silent
  // widening for a silent disarming. Measured before this was fixed: coverage 1 under the
  // Stop + SubagentStart pair wrote no marker and never blocked.
  for (const coverage of ['1', '2']) {
    const directory = await scratch(`gate-coverage-fires-${coverage}`);
    const settingsPath = path.join(directory, 'settings.json');
    const markers = path.join(directory, 'markers');
    assert.equal((await runInstaller(['--mode', 'block', '--coverage', coverage, '--settings', settingsPath])).status, 0);
    const written = await readJson(settingsPath);
    const [armingEvent, armingMatcher, armingPayload] = coverage === '1'
      ? ['PostToolUse', 'Agent', agentDispatch()]
      : ['SubagentStart', '*', subagentStart()];

    await runWrittenCommand(ourCommand(written, armingEvent, armingMatcher), armingPayload, markers);
    const stopped = await runWrittenCommand(ourCommand(written, 'Stop', '*'), stopPayload(BAD_REPORT), markers);
    assert.equal(stopped.status, 0);
    assert.equal(parsedBlock(stopped.stdout).decision, 'block', `coverage ${coverage} as installed never blocked`);
  }

  // And the converse at coverage 1: a SubagentStart through that level's own command arms
  // nothing — which is exactly why coverage 1 does not write that hook.
  const directory = await scratch('gate-coverage-1-subagentstart');
  const settingsPath = path.join(directory, 'settings.json');
  const markers = path.join(directory, 'markers');
  assert.equal((await runInstaller(['--mode', 'block', '--coverage', '1', '--settings', settingsPath])).status, 0);
  const stopCommand = ourCommand(await readJson(settingsPath), 'Stop', '*');
  await runWrittenCommand(stopCommand, subagentStart(), markers);
  const unarmed = await runWrittenCommand(stopCommand, stopPayload(BAD_REPORT), markers);
  assert.equal(unarmed.stdout, '', 'coverage 1 armed on SubagentStart');
});

test('a skill list needs coverage 2, whether the 1 was named or kept', async () => {
  const directory = await scratch('gate-coverage-skills');
  const settingsPath = path.join(directory, 'settings.json');
  const named = await runInstaller(['--coverage', '1', '--skills', 'codex', '--settings', settingsPath]);
  assert.equal(named.status, 1, 'wrote a skill hook coverage 1 never reads');
  assert.match(named.stderr, /--skills needs coverage 2/);
  assert.deepEqual(await readdir(directory), [], 'a refused run still wrote something');

  assert.equal((await runInstaller(['--mode', 'block', '--coverage', '1', '--settings', settingsPath])).status, 0);
  const before = await readFile(settingsPath, 'utf8');
  const kept = await runInstaller(['--mode', 'block', '--skills', 'codex', '--settings', settingsPath]);
  assert.equal(kept.status, 1, 'a kept coverage 1 silently ignored --skills');
  assert.match(kept.stderr, /--skills needs coverage 2/);
  assert.match(kept.stderr, /already installed/, 'the refusal did not say where the 1 came from');
  assert.equal(await readFile(settingsPath, 'utf8'), before, 'a refused run changed the settings file');

  const widened = await runInstaller(['--mode', 'block', '--coverage', '2', '--skills', 'codex', '--settings', settingsPath]);
  assert.equal(widened.status, 0, widened.stderr);
  assert.ok(hasOurHook(await readJson(settingsPath), 'PostToolUse', 'Skill'));
});

test('--remove takes no --coverage, and removes the coverage-1 pair in full', async () => {
  const directory = await scratch('gate-coverage-remove');
  const settingsPath = path.join(directory, 'settings.json');
  const refused = await runInstaller(['--remove', '--coverage', '2', '--settings', settingsPath]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /--remove takes no --coverage/);
  assert.deepEqual(await readdir(directory), [], 'a refused run still wrote something');

  await writeFile(settingsPath, JSON.stringify({
    model: 'claude-sonnet-4-6',
    hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'someone-elses-stop-hook' }] }] },
  }, null, 2));
  assert.equal((await runInstaller(['--mode', 'block', '--coverage', '1', '--settings', settingsPath])).status, 0);
  const removed = await runInstaller(['--remove', '--settings', settingsPath]);
  assert.equal(removed.status, 0, removed.stderr);
  assert.match(removed.stdout, /Removed 2 report-progress gate hooks/);
  assert.deepEqual(await readJson(settingsPath), {
    model: 'claude-sonnet-4-6',
    hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'someone-elses-stop-hook' }] }] },
  });
  assert.deepEqual((await readdir(directory)).sort(), ['settings.json'], 'a temp file was left behind');
});

test('moving between levels replaces the gate and never stacks or orphans a hook', async () => {
  const directory = await scratch('gate-coverage-switch');
  const settingsPath = path.join(directory, 'settings.json');
  for (const coverage of ['2', '1', '2', '1']) {
    assert.equal((await runInstaller(['--mode', 'block', '--coverage', coverage, '--settings', settingsPath])).status, 0);
    const written = await readJson(settingsPath);
    const ours = Object.values(written.hooks).flat().flatMap((group) => group.hooks)
      .filter((hook) => hook.describe.startsWith(DESCRIBE_PREFIX));
    assert.equal(ours.length, 2, `coverage ${coverage}: expected the Stop hook and one arming half, found ${ours.length}`);
    assert.ok(ours.every((hook) => hook.command.includes(`${COVERAGE_ENV_FLAG}=${coverage} `)), 'two levels in one settings file');
    assert.equal(hasOurHook(written, 'SubagentStart', '*'), coverage === '2');
    assert.equal(hasOurHook(written, 'PostToolUse', 'Agent'), coverage === '1');
  }
});

test('an update that changes the mode of the gate already installed says so', async () => {
  const directory = await scratch('gate-coverage-mode-notice');
  const settingsPath = path.join(directory, 'settings.json');
  assert.equal((await runInstaller(['--mode', 'block', '--settings', settingsPath])).status, 0);

  const bare = await runInstaller(['--settings', settingsPath]);
  assert.equal(bare.status, 0, bare.stderr);
  assert.match(bare.stdout, /already in this file ran in block mode/);
  assert.match(bare.stdout, /--mode block/);

  const same = await runInstaller(['--mode', 'observe', '--settings', settingsPath]);
  assert.doesNotMatch(same.stdout, /already in this file ran in/, 'a mode that did not change was reported as changed');
});

test('a foreign hook wearing the gate name is still refused before any level is read or written', async () => {
  const directory = await scratch('gate-coverage-foreign');
  const settingsPath = path.join(directory, 'settings.json');
  const foreign = JSON.stringify({
    hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: `AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 node /elsewhere/${HOOK_MARKER}` }] }] },
  }, null, 2);
  await writeFile(settingsPath, foreign);
  const result = await runInstaller(['--mode', 'block', '--settings', settingsPath]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /was not written by this installer/);
  assert.equal(await readFile(settingsPath, 'utf8'), foreign);
});

// ---------------------------------------------------------------------------
// A hook that runs the gate and carries NO describe at all. Found on a real machine. v0.16.1 and
// 0.17.0 both write a describe, and Claude Code drops it from every hook whenever it writes the
// settings file (adapters/HOOK-OUTPUT-NOTES.md, third addendum of 2026-09-14), so this is the
// common shape of an installed gate, not a rare one; an older copy or a hand-wiring leaves the
// same. Against it, --remove
// printed "No report-progress gate was installed … Nothing changed." while both hooks kept
// running the gate, and install refused with "Remove it by hand first" — so the one command a
// user had for getting rid of the gate did nothing and said it had nothing to do.
// ---------------------------------------------------------------------------

/** A gate hook with no `describe` key, in the command shape the installer writes. */
const undescribedHook = (timeout, level) => ({
  type: 'command',
  command: `${GATE_ENV_FLAG}=block ${level ? `${COVERAGE_ENV_FLAG}=${level} ` : ''}'/bin/node' '/pack/adapters/claude-code/${HOOK_MARKER}'`,
  timeout,
});

/** Somebody else's Stop hook, in a group of its own. Every run below must leave it alone. */
const UNRELATED_STOP_GROUP = Object.freeze({ hooks: [{ type: 'command', command: 'someone-elses-stop-hook' }] });

/** The fixture the bug was found with: two undescribed gate hooks, under `Stop` and `PostToolUse`
 *  matcher `Agent`, beside an unrelated `Stop` hook. */
const undescribedSettings = (level) => ({
  model: 'claude-sonnet-4-6',
  hooks: {
    Stop: [structuredClone(UNRELATED_STOP_GROUP), { matcher: '*', hooks: [undescribedHook(10, level)] }],
    PostToolUse: [{ matcher: 'Agent', hooks: [undescribedHook(5, level)] }],
  },
});

/** A hook that runs the gate under a describe some other tool wrote. */
const otherToolsHook = () => ({ type: 'command', command: `node /elsewhere/${HOOK_MARKER}`, describe: 'written by some other tool' });

/** Every hook in a settings object that runs the gate, whoever wrote it. */
const gateHooks = (settings) => Object.values(settings.hooks ?? {})
  .filter(Array.isArray)
  .flat()
  .filter((group) => group && Array.isArray(group.hooks))
  .flatMap((group) => group.hooks)
  .filter((hook) => typeof hook.command === 'string' && hook.command.includes(HOOK_MARKER));

async function settingsFile(name, value) {
  const directory = await scratch(name);
  const settingsPath = path.join(directory, 'settings.json');
  const text = JSON.stringify(value, null, 2);
  await writeFile(settingsPath, text);
  return { directory, settingsPath, text };
}

test('removeHooks adopts only when asked, and only a hook with no describe key at all', () => {
  const emptyDescribe = { type: 'command', command: `node /elsewhere/${HOOK_MARKER}`, describe: '' };
  const make = () => ({ hooks: { Stop: [{ matcher: '*', hooks: [undescribedHook(10), otherToolsHook(), emptyDescribe] }] } });

  const plain = removeHooks(make());
  assert.equal(plain.removed, 0);
  assert.equal(plain.adopted, 0);
  assert.deepEqual(plain.unowned.map((hook) => `${hook.event}|${hook.matcher}|${hook.describe}`), ['Stop|*|absent', 'Stop|*|foreign', 'Stop|*|foreign']);

  const adopting = removeHooks(make(), { adopt: true });
  assert.equal(adopting.removed, 1);
  assert.equal(adopting.adopted, 1);
  // A describe somebody typed, even an empty one, is not the absence of one.
  assert.deepEqual(adopting.settings.hooks.Stop[0].hooks, [otherToolsHook(), emptyDescribe]);
  assert.deepEqual(adopting.unowned.map((hook) => hook.describe), ['foreign', 'foreign']);
});

test('--remove never says nothing is installed while undescribed hooks run the gate, and names each one', async () => {
  const { settingsPath, text } = await settingsFile('gate-undescribed-remove', undescribedSettings());
  const result = await runInstaller(['--remove', '--settings', settingsPath]);
  const output = `${result.stdout}${result.stderr}`;
  assert.doesNotMatch(output, /No report-progress gate was installed/, 'said nothing is installed while two hooks run the gate');
  assert.doesNotMatch(output, /Nothing changed/);
  assert.doesNotMatch(output, /No turn will be held again/);
  assert.notEqual(result.status, 0, 'a --remove that left the gate wired exited as a success');
  assert.match(output, /Stop \(matcher \*\)/);
  assert.match(output, /PostToolUse \(matcher Agent\)/);
  assert.match(output, /--remove --adopt/, 'the output did not say how to remove them');
  assert.match(output, /Claude Code drops describe/, 'the output did not say where a hook with no describe usually comes from');
  assert.equal(await readFile(settingsPath, 'utf8'), text, 'a hook with no describe was removed without --adopt');
  assert.equal(gateHooks(await readJson(settingsPath)).length, 2);
});

test('--remove --adopt removes both undescribed hooks, says so, and leaves the unrelated one', async () => {
  const { directory, settingsPath } = await settingsFile('gate-undescribed-remove-adopt', undescribedSettings());
  const result = await runInstaller(['--remove', '--adopt', '--settings', settingsPath]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Removed 2 report-progress gate hooks/);
  assert.match(result.stdout, /Adopted 2 of them/);
  assert.match(result.stdout, /Stop \(matcher \*\)/);
  assert.match(result.stdout, /PostToolUse \(matcher Agent\)/);
  assert.match(result.stdout, /No turn will be held again/);
  assert.deepEqual(await readJson(settingsPath), { model: 'claude-sonnet-4-6', hooks: { Stop: [UNRELATED_STOP_GROUP] } });
  assert.deepEqual((await readdir(directory)).sort(), ['settings.json'], 'a temp file was left behind');
});

test('--remove takes out its own hooks and still names the undescribed one it left behind', async () => {
  const value = undescribedSettings();
  delete value.hooks.PostToolUse;
  value.hooks.SubagentStart = [{ matcher: '*', hooks: [v0170Hook(5)] }];
  const { settingsPath } = await settingsFile('gate-undescribed-remove-mixed', value);

  const result = await runInstaller(['--remove', '--settings', settingsPath]);
  const output = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0, 'a --remove that left a gate hook running exited as a success');
  assert.match(result.stdout, /Removed 1 report-progress gate hook from/);
  assert.match(output, /Stop \(matcher \*\)/);
  assert.doesNotMatch(output, /No turn will be held again/, 'promised the gate is gone while a hook still runs it');
  const written = await readJson(settingsPath);
  assert.equal(Object.hasOwn(written.hooks, 'SubagentStart'), false);
  assert.equal(gateHooks(written).length, 1);
});

test('install without --adopt refuses, names every undescribed hook, and names --adopt as the way forward', async () => {
  const { settingsPath, text } = await settingsFile('gate-undescribed-install', undescribedSettings());
  const result = await runInstaller(['--mode', 'block', '--coverage', '2', '--settings', settingsPath]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /was not written by this installer/);
  assert.match(result.stderr, /Stop \(matcher \*\)/);
  assert.match(result.stderr, /PostToolUse \(matcher Agent\)/);
  assert.match(result.stderr, /again with --adopt/);
  assert.doesNotMatch(result.stderr, /by hand first/, 'the refusal still sends the user to hand-edit the file');
  assert.equal(await readFile(settingsPath, 'utf8'), text);
});

test('install --adopt replaces both undescribed hooks with this installer\'s own, and says how many', async () => {
  const { settingsPath } = await settingsFile('gate-undescribed-install-adopt', undescribedSettings());
  const result = await runInstaller(['--mode', 'block', '--coverage', '2', '--adopt', '--settings', settingsPath]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Adopted 2 hooks/);
  assert.match(result.stdout, /Set coverage 2 \(was 1\)/);

  const written = await readJson(settingsPath);
  assert.equal(written.model, 'claude-sonnet-4-6');
  const running = gateHooks(written);
  assert.equal(running.length, 2, `expected the Stop hook and one arming half, found ${running.length}`);
  assert.ok(running.every((hook) => typeof hook.describe === 'string' && hook.describe.startsWith(DESCRIBE_PREFIX)), 'an undescribed hook survived adoption');
  assert.ok(ourCommand(written, 'Stop', '*').includes(`${COVERAGE_ENV_FLAG}=2 `));
  assert.ok(hasOurHook(written, 'SubagentStart', '*'));
  assert.equal(Object.hasOwn(written.hooks, 'PostToolUse'), false, 'the adopted PostToolUse hook was left behind');
  assert.deepEqual(written.hooks.Stop.filter((group) => !Object.hasOwn(group, 'matcher')), [UNRELATED_STOP_GROUP], 'the unrelated Stop hook did not survive');
});

test('adopting with no --coverage keeps the level the adopted command runs at', async () => {
  for (const [level, expected] of [[undefined, 1], ['2', 2]]) {
    const { settingsPath } = await settingsFile(`gate-undescribed-level-${expected}`, undescribedSettings(level));
    const result = await runInstaller(['--mode', 'block', '--adopt', '--settings', settingsPath]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`Kept coverage ${expected} \\(read from the adopted hook`));
    const written = await readJson(settingsPath);
    assert.ok(ourCommand(written, 'Stop', '*').includes(`${COVERAGE_ENV_FLAG}=${expected} `), `adopting moved the level off ${expected}`);
    assert.equal(hasOurHook(written, 'SubagentStart', '*'), expected === 2);
    assert.equal(hasOurHook(written, 'PostToolUse', 'Agent'), expected === 1);
  }
});

test('a hook running the gate under somebody else\'s describe is never adopted, with or without --adopt', async () => {
  const value = { hooks: { Stop: [{ matcher: '*', hooks: [otherToolsHook()] }], PostToolUse: [{ matcher: 'Agent', hooks: [undescribedHook(5)] }] } };

  for (const flags of [[], ['--adopt']]) {
    const { settingsPath, text } = await settingsFile('gate-described-install', value);
    const refused = await runInstaller(['--mode', 'block', ...flags, '--settings', settingsPath]);
    assert.equal(refused.status, 1, `installed over another tool's gate hook with ${flags.join(' ') || 'no flag'}`);
    assert.match(refused.stderr, /Stop \(matcher \*\)/);
    assert.match(refused.stderr, /never adopted/);
    assert.equal(await readFile(settingsPath, 'utf8'), text, 'a refused install changed the file');
  }

  const { settingsPath } = await settingsFile('gate-described-remove', value);
  const removed = await runInstaller(['--remove', '--adopt', '--settings', settingsPath]);
  const output = `${removed.stdout}${removed.stderr}`;
  assert.notEqual(removed.status, 0, 'a --remove that left a gate hook running exited as a success');
  assert.match(removed.stdout, /Removed 1 report-progress gate hook from/);
  assert.match(removed.stdout, /Adopted 1 of them/);
  assert.match(output, /Stop \(matcher \*\)/);
  assert.match(output, /never adopted/);
  assert.doesNotMatch(output, /No turn will be held again|Nothing changed|No report-progress gate was installed/);
  assert.deepEqual(await readJson(settingsPath), { hooks: { Stop: [{ matcher: '*', hooks: [otherToolsHook()] }] } }, 'another tool\'s gate hook was touched');

  // Alone, it gets no advice to run --adopt: that flag would not remove it.
  const { settingsPath: alone, text } = await settingsFile('gate-described-alone', { hooks: { Stop: [{ matcher: '*', hooks: [otherToolsHook()] }] } });
  const aloneResult = await runInstaller(['--remove', '--settings', alone]);
  const aloneOutput = `${aloneResult.stdout}${aloneResult.stderr}`;
  assert.notEqual(aloneResult.status, 0);
  assert.match(aloneOutput, /Stop \(matcher \*\)/);
  assert.doesNotMatch(aloneOutput, /Nothing changed|No report-progress gate was installed/);
  assert.doesNotMatch(aloneOutput, /--remove --adopt|again with --adopt/);
  assert.equal(await readFile(alone, 'utf8'), text);
});

// ---------------------------------------------------------------------------
// Keeping a level means reading the level the gate REALLY runs at, which is whatever the shell
// hands it. Each hand-wired shape below ran the gate at coverage 2 when executed, and each was read
// as 1 by the installer, so `--adopt` narrowed the gate and printed "Kept coverage 1".
// ---------------------------------------------------------------------------

const hookAt = (command, timeout) => ({ type: 'command', command, timeout });
const slug = (text) => text.replace(/\W+/g, '-');

test('adopting refuses to keep a level it cannot read the way the shell does, and names why', async () => {
  const program = `'${process.execPath}' '${gate}'`;
  const level2 = `${GATE_ENV_FLAG}=block ${COVERAGE_ENV_FLAG}=2`;
  const shapes = {
    'after env': `env ${level2} ${program}`,
    'after cd &&': `cd / && ${level2} ${program}`,
    'exported first': `export ${level2}; ${program}`,
    'from an expansion': `${GATE_ENV_FLAG}=block ${COVERAGE_ENV_FLAG}=\${GATE_LEVEL:-2} ${program}`,
  };
  for (const [shape, command] of Object.entries(shapes)) {
    // What the hook really does, run the way the harness runs it: SubagentStart arms only at level 2.
    const markers = path.join(await scratch(`gate-unreadable-run-${slug(shape)}`), 'markers');
    await runWrittenCommand(command, subagentStart(), markers);
    const ran = await runWrittenCommand(command, stopPayload(BAD_REPORT), markers);
    assert.equal(parsedBlock(ran.stdout).decision, 'block', `${shape}: the fixture does not run the gate at coverage 2`);

    const { settingsPath, text } = await settingsFile(`gate-unreadable-${slug(shape)}`, {
      hooks: { Stop: [{ matcher: '*', hooks: [hookAt(command, 10)] }], SubagentStart: [{ matcher: '*', hooks: [hookAt(command, 5)] }] },
    });
    const refused = await runInstaller(['--mode', 'block', '--adopt', '--settings', settingsPath]);
    assert.equal(refused.status, 1, `${shape}: kept a level it could not read`);
    assert.doesNotMatch(refused.stdout, /Kept coverage/);
    assert.match(refused.stderr, /no single coverage level to keep/);
    assert.match(refused.stderr, /SubagentStart \(matcher \*\)|Stop \(matcher \*\)/);
    assert.match(refused.stderr, /--coverage 1 or --coverage 2/);
    assert.equal(await readFile(settingsPath, 'utf8'), text, `${shape}: a refused run changed the file`);

    const named = await runInstaller(['--mode', 'block', '--coverage', '2', '--adopt', '--settings', settingsPath]);
    assert.equal(named.status, 0, named.stderr);
    assert.match(named.stdout, /Set coverage 2 \(no single level could be read/);
    assert.ok(ourCommand(await readJson(settingsPath), 'Stop', '*').includes(`${COVERAGE_ENV_FLAG}=2 `));
    assert.ok(hasOurHook(await readJson(settingsPath), 'SubagentStart', '*'));
  }
});

test('adopting reads a double-quoted level and mode as the shell does, and refuses hooks that disagree', async () => {
  const quoted = `${GATE_ENV_FLAG}="block" ${COVERAGE_ENV_FLAG}="2" '${process.execPath}' '${gate}'`;
  const markers = path.join(await scratch('gate-quoted-run'), 'markers');
  await runWrittenCommand(quoted, subagentStart(), markers);
  assert.equal(parsedBlock((await runWrittenCommand(quoted, stopPayload(BAD_REPORT), markers)).stdout).decision, 'block');

  const { settingsPath } = await settingsFile('gate-quoted-level', {
    hooks: { Stop: [{ matcher: '*', hooks: [hookAt(quoted, 10)] }], SubagentStart: [{ matcher: '*', hooks: [hookAt(quoted, 5)] }] },
  });
  const kept = await runInstaller(['--adopt', '--settings', settingsPath]);
  assert.equal(kept.status, 0, kept.stderr);
  assert.match(kept.stdout, /Kept coverage 2 \(read from the adopted hook\)/);
  assert.doesNotMatch(kept.stdout, /disarmed \(off\)/, 'a double-quoted "block" was read as off');
  assert.match(kept.stdout, /ran in block mode/);
  assert.ok(ourCommand(await readJson(settingsPath), 'Stop', '*').includes(`${COVERAGE_ENV_FLAG}=2 `));

  const { settingsPath: mixed, text } = await settingsFile('gate-disagreeing-levels', {
    hooks: { Stop: [{ matcher: '*', hooks: [undescribedHook(10)] }], SubagentStart: [{ matcher: '*', hooks: [undescribedHook(5, '2')] }] },
  });
  const refused = await runInstaller(['--mode', 'block', '--adopt', '--settings', mixed]);
  assert.equal(refused.status, 1, 'kept one of two disagreeing levels');
  assert.match(refused.stderr, /different levels: Stop \(matcher \*\) at 1, SubagentStart \(matcher \*\) at 2/);
  assert.equal(await readFile(mixed, 'utf8'), text);
});

test('neither level can promise one block per turn: re-arming after a block blocks again unless stop_hook_active holds it', async () => {
  // Shipped as "coverage 1 does not have this shape" and "v0.16.1 was structurally incapable of
  // this". Measured here against the gate itself: an Agent dispatch re-arms coverage 1 exactly as a
  // subagent starting re-arms coverage 2, and the gate's own record of the spent block does not
  // survive either. If the gate is ever changed to keep that record, this test is where the docs
  // that describe the hole get caught out.
  const blocks = (stdout) => stdout.trim() !== '' && JSON.parse(stdout).decision === 'block';
  for (const [coverage, arming] of [['1', agentDispatch()], ['2', subagentStart()]]) {
    const command = `${GATE_ENV_FLAG}=block ${COVERAGE_ENV_FLAG}=${coverage} '${process.execPath}' '${gate}'`;
    for (const active of [false, true]) {
      const markers = path.join(await scratch(`gate-rearm-c${coverage}-${active}`), 'markers');
      await runWrittenCommand(command, arming, markers);
      const first = await runWrittenCommand(command, stopPayload(BAD_REPORT), markers);
      assert.equal(blocks(first.stdout), true, `coverage ${coverage}: the first Stop did not block`);
      await runWrittenCommand(command, arming, markers);
      const second = await runWrittenCommand(command, stopPayload(BAD_REPORT, { stop_hook_active: active }), markers);
      assert.equal(blocks(second.stdout), !active, `coverage ${coverage}, stop_hook_active ${active}: second Stop`);
    }
  }

  const help = await runInstaller(['--help']);
  assert.doesNotMatch(help.stdout, /At most one block per turn at coverage 1/);
  assert.match(help.stdout, /stop_hook_active/);
  for (const coverage of ['1', '2']) {
    const directory = await scratch(`gate-rearm-output-${coverage}`);
    const installed = await runInstaller(['--mode', 'block', '--coverage', coverage, '--settings', path.join(directory, 'settings.json')]);
    assert.equal(installed.status, 0, installed.stderr);
    assert.doesNotMatch(installed.stdout, /does not have this shape|structurally incapable/);
    assert.match(installed.stdout, /"Once" is the intent rather than a guarantee/);
    assert.match(installed.stdout, /stop_hook_active is what stops/);
  }
});

test('an update that drops a skill list says so, and one that repeats the list says nothing', async () => {
  // The usage text promised that updating "never changes what the gate enforces", while a bare
  // re-run over a coverage-2 install with --skills removed the Skill hook and printed nothing
  // about it (v0.18.0 did the same, silently).
  const directory = await scratch('gate-skills-notice');
  const settingsPath = path.join(directory, 'settings.json');
  assert.equal((await runInstaller(['--mode', 'block', '--coverage', '2', '--skills', 'codex,gpt-researcher', '--settings', settingsPath])).status, 0);

  const repeated = await runInstaller(['--mode', 'block', '--skills', 'codex,gpt-researcher', '--settings', settingsPath]);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.doesNotMatch(repeated.stdout, /Skill list not kept/);
  assert.ok(hasOurHook(await readJson(settingsPath), 'PostToolUse', 'Skill'));

  const bare = await runInstaller(['--mode', 'block', '--settings', settingsPath]);
  assert.equal(bare.status, 0, bare.stderr);
  assert.match(bare.stdout, /Skill list not kept/);
  assert.match(bare.stdout, /Pass --skills codex,gpt-researcher to keep them/);
  assert.equal(hasOurHook(await readJson(settingsPath), 'PostToolUse', 'Skill'), false);

  const again = await runInstaller(['--mode', 'block', '--settings', settingsPath]);
  assert.equal(again.status, 0, again.stderr);
  assert.doesNotMatch(again.stdout, /Skill list not kept/, 'a list that was already gone was reported as dropped');
});
