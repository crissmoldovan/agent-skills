import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JournalEvent } from '../src/envelope.ts';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TEST_DIR, '..', '..', '..');
const HOOK = join(REPO_ROOT, 'adapters', 'claude-code', 'journal-hook.sh');
const BIN_TS = join(TEST_DIR, '..', 'src', 'bin.ts');

// The real agent-journal CLI, run straight from TypeScript source. This
// package's own "verify" script runs `test` BEFORE `build`
// (package.json: "check:types && test && build"), so `pnpm test` alone does
// not guarantee dist/bin.js exists or is current -- these tests must not
// depend on it. `--experimental-strip-types` is the same mechanism this
// package's own test files already run under.
const REAL_CMD = `${process.execPath} --experimental-strip-types ${BIN_TS}`;

async function root(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'journal-hook-'));
}

// Mirrors readAllEvents in cli.test.ts, including the mergeEvents call --
// see that file's comment on why: a raw per-segment read sees `readdir`
// order, not the order a real consumer sees.
async function readAllEvents(rootDir: string, workspace: string): Promise<JournalEvent[]> {
  const { parseSegment, mergeEvents } = await import('../src/read.ts');
  const base = join(rootDir, 'workspaces', workspace, 'segments');
  const batches: JournalEvent[][] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.endsWith('.jsonl')) batches.push(parseSegment(await readFile(full, 'utf8')).events);
    }
  }
  await walk(base);
  return mergeEvents(batches);
}

// spawnSync, not execFile: execFile has no `input` option, and passing one
// there is silently accepted and ignored -- the child gets nothing on
// stdin, and every case that maps stdin to "nothing happened" would look
// like it passed. spawnSync's `input` genuinely writes to the child's
// stdin. Do not trust that claim either without evidence -- see "the test
// harness actually delivers the payload" below, which proves it rather
// than assuming it.
function runHook(input: string, env: Record<string, string>) {
  return spawnSync('sh', [HOOK], {
    input,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 10_000,
  });
}

function sessionStartPayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    session_id: 'sid-start',
    transcript_path: '/tmp/t.jsonl',
    cwd: '/private/var/probe',
    scratchpad_dir: '/tmp/scratch',
    hook_event_name: 'SessionStart',
    source: 'startup',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Proof the test harness itself works. This must run and pass BEFORE any
// test below is trusted, for the same reason the dispatch called out: a
// broken pipe between spawnSync and the script would make every "handled
// this payload" assertion look green while the script never saw the
// payload at all.
// ---------------------------------------------------------------------------

test('the test harness actually delivers the payload to the script', async () => {
  const dir = await root();
  const stubLog = join(dir, 'stub.log');
  const stubPath = join(dir, 'stub.mjs');
  await writeFile(
    stubPath,
    "import { appendFileSync } from 'node:fs';\n"
      + "appendFileSync(process.env.STUB_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');\n",
  );

  const payload = JSON.stringify({
    session_id: 'sid-1',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'echo hi' },
    tool_use_id: 'toolu_1',
  });
  const r = runHook(payload, {
    AGENT_JOURNAL_WORKSPACE: 'ws',
    AGENT_JOURNAL_ROOT: dir,
    AGENT_JOURNAL_CMD: `${process.execPath} ${stubPath}`,
    STUB_LOG: stubLog,
  });
  assert.equal(r.status, 0, r.stderr);

  const logged = await readFile(stubLog, 'utf8').catch(() => '');
  assert.ok(logged.trim().length > 0, 'the stub was never invoked -- the payload did not reach journal-hook.mjs');
  const args = JSON.parse(logged.trim().split('\n')[0]!) as string[];
  // `--flag=value` throughout, never `--flag value`: a value beginning with
  // `--` (a markdown horizontal rule opening an assistant message is the
  // everyday case) parses as the next flag name in the space-separated form,
  // and agent-journal then exits 2 having written nothing. This script ignores
  // that exit code by design, so the observation would vanish leaving no
  // `void` behind. Asserted here as argv shape because that is the only place
  // the choice is observable.
  assert.deepEqual(
    args.slice(0, 3),
    ['observe', '--workspace=ws', '--kind=tool_call'],
    `unexpected argv shape reached the observe command: ${JSON.stringify(args)}`,
  );
  assert.ok(args.includes('--tool=Bash'), JSON.stringify(args));
  assert.ok(args.includes('--callId=toolu_1'), JSON.stringify(args));
  assert.ok(
    args.every((a) => a.startsWith('--') === false || a.includes('=')),
    `every flag must carry its value inline: ${JSON.stringify(args)}`,
  );
});

// ---------------------------------------------------------------------------
// Rule 1: it never fails the tool call it observes.
// ---------------------------------------------------------------------------

test('the hook exits 0 on every malformed input', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD };
  for (const payload of ['', 'not json', '{}', '{"hook_event_name":"Unknown"}', '[]']) {
    const r = runHook(payload, env);
    assert.equal(r.status, 0, `exited ${r.status} on ${JSON.stringify(payload)}: ${r.stderr}`);
  }
  // None of these should have produced anything to observe.
  assert.deepEqual(await readAllEvents(dir, 'ws'), []);
});

test('the hook does nothing when the workspace is unconfigured', async () => {
  const dir = await root();
  const r = runHook(sessionStartPayload(), {
    AGENT_JOURNAL_ROOT: dir,
    AGENT_JOURNAL_CMD: REAL_CMD,
    AGENT_JOURNAL_WORKSPACE: '', // explicit override beats anything inherited
  });
  assert.equal(r.status, 0, r.stderr);
  const found = await readdir(dir).catch(() => []);
  assert.deepEqual(found, [], 'nothing should have been created under AGENT_JOURNAL_ROOT');
});

// A property test, not a guard test, and worth being precise about which.
//
// A whitespace-only workspace is refused three times over. The .sh does NOT
// catch it (`[ -z " " ]` is false, so it falls through); the .mjs trims;
// cli.ts's `!workspace` check refuses; and underneath both, envelope.ts's
// `text()` throws `workspace is required` for any blank field, so no event
// carrying one can be CONSTRUCTED at all. Verified by mutation: removing the
// .mjs trim leaves this green, and removing the CLI check too STILL leaves it
// green -- the envelope refuses regardless, which is the guarantee that
// actually holds the line.
//
// So this does not isolate any single guard, and no single-guard mutation
// turns it red. What it does prove is the end-to-end property: a blank
// workspace materialises no journal directory, and the adapter does not route
// around the envelope to create one.
test('a whitespace-only workspace is unconfigured too, not a workspace named " "', async () => {
  const dir = await root();
  const r = runHook(sessionStartPayload(), {
    AGENT_JOURNAL_ROOT: dir,
    AGENT_JOURNAL_CMD: REAL_CMD,
    AGENT_JOURNAL_WORKSPACE: '   ',
  });
  assert.equal(r.status, 0, r.stderr);
  const found = await readdir(dir).catch(() => []);
  assert.deepEqual(found, [], 'a blank workspace name created a journal');
});

test('a broken exit-0 rule surfaces here first: verified live, not assumed', async () => {
  // Documents, with a passing assertion, the bug found while building this
  // adapter: the brief\u2019s own sketch used
  // `: "${AGENT_JOURNAL_WORKSPACE:?}" 2>/dev/null || exit 0`. Measured
  // directly: on an unset variable, `${:?}` ends the whole non-interactive
  // shell right there, with ITS OWN nonzero code, before `||` ever runs (1
  // under macOS `/bin/sh`, 2 under dash). journal-hook.sh uses
  // `[ -z "${VAR:-}" ]` instead, which does not have this failure mode.
  const dir = await root();
  const r = runHook(sessionStartPayload(), { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD });
  assert.equal(r.status, 0);
});

test('agent-journal being unavailable still exits 0 and writes nothing', async () => {
  const dir = await root();
  const r = runHook(sessionStartPayload(), {
    AGENT_JOURNAL_WORKSPACE: 'ws',
    AGENT_JOURNAL_ROOT: dir,
    AGENT_JOURNAL_CMD: '/no/such/agent-journal-binary',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(await readAllEvents(dir, 'ws'), []);
});

test('node itself being unavailable still exits 0', async () => {
  const dir = await root();
  const r = runHook(sessionStartPayload(), {
    AGENT_JOURNAL_WORKSPACE: 'ws',
    AGENT_JOURNAL_ROOT: dir,
    AGENT_JOURNAL_CMD: REAL_CMD,
    AGENT_JOURNAL_NODE: '/no/such/node',
  });
  assert.equal(r.status, 0, r.stderr);
});

test('an unwritable journal root still exits 0 and writes nothing', async () => {
  const dir = await root();
  await chmod(dir, 0o500); // readable and searchable, not writable
  try {
    const r = runHook(sessionStartPayload(), {
      AGENT_JOURNAL_WORKSPACE: 'ws',
      AGENT_JOURNAL_ROOT: dir,
      AGENT_JOURNAL_CMD: REAL_CMD,
    });
    assert.equal(r.status, 0, r.stderr);
  } finally {
    await chmod(dir, 0o700);
  }
  assert.deepEqual(await readAllEvents(dir, 'ws'), []);
});

// ---------------------------------------------------------------------------
// Rule 2: it never blocks.
// ---------------------------------------------------------------------------

test('the hook does not hang when stdin is never closed', async () => {
  // A harness that opens the pipe and never writes or closes it (the
  // pathological case, not the documented one -- every capture in
  // adapters/NOTES.md shows the harness closing stdin promptly) must not
  // hang the tool call it is meant to observe. Node's spawnSync always
  // closes the `input` pipe after writing, so this needs a real,
  // still-open pipe -- built here with a FIFO whose writer end is held
  // open by a background process that never sends EOF.
  const dir = await root();
  const fifo = join(dir, 'stdin.fifo');
  const mkfifo = spawnSync('mkfifo', [fifo]);
  if (mkfifo.status !== 0) return; // mkfifo unavailable on this platform: skip, do not fail the suite

  const { spawn } = await import('node:child_process');
  const bg = spawn('sh', ['-c', `exec 3>"${fifo}" && sleep 5`], { stdio: 'ignore', detached: true });
  bg.unref();

  const started = Date.now();
  let fd;
  const { openSync, closeSync } = await import('node:fs');
  fd = openSync(fifo, 'r');
  const r = spawnSync('sh', [HOOK], {
    stdio: [fd, 'ignore', 'ignore'],
    env: { ...process.env, AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD },
    timeout: 10_000,
  });
  closeSync(fd);
  const elapsedMs = Date.now() - started;

  assert.equal(r.status, 0, r.stderr?.toString());
  assert.ok(elapsedMs < 8_000, `took ${elapsedMs}ms -- the stdin-read timeout did not bound this`);
  try {
    process.kill(-bg.pid!, 'SIGKILL');
  } catch {
    // already gone
  }
});

// ---------------------------------------------------------------------------
// Rule 3: it bypasses nothing -- redaction still applies.
// ---------------------------------------------------------------------------

test('a secret in a tool input does not reach disk', async () => {
  const dir = await root();
  const payload = JSON.stringify({
    session_id: 'sid-secret',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'export AWS_SECRET_ACCESS_KEY=AKIAABCDEFGHIJKLMNOP' },
    tool_use_id: 'toolu_secret',
  });
  const r = runHook(payload, { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD });
  assert.equal(r.status, 0, r.stderr);

  const events = await readAllEvents(dir, 'ws');
  assert.equal(events.length, 1);
  const input = String(events[0]!.data.input);
  assert.ok(!input.includes('AKIAABCDEFGHIJKLMNOP'), 'the raw secret reached disk unredacted');
  assert.match(input, /\[REDACTED\]/);
});

// ---------------------------------------------------------------------------
// Mapping: the events adapters/NOTES.md confirms fire, mapped as designed.
// ---------------------------------------------------------------------------

test('SessionStart becomes a session_start observation', async () => {
  const dir = await root();
  const r = runHook(sessionStartPayload(), { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD });
  assert.equal(r.status, 0, r.stderr);
  const [event] = await readAllEvents(dir, 'ws');
  assert.equal(event?.kind, 'session_start');
  assert.equal(event?.session, 'sid-start');
  assert.equal(event?.data.harness, 'claude-code');
  assert.equal(event?.data.cwd, '/private/var/probe');
});

test('SessionEnd becomes a session_end observation', async () => {
  const dir = await root();
  const payload = JSON.stringify({ session_id: 'sid-end', hook_event_name: 'SessionEnd', reason: 'other' });
  const r = runHook(payload, { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD });
  assert.equal(r.status, 0, r.stderr);
  const [event] = await readAllEvents(dir, 'ws');
  assert.equal(event?.kind, 'session_end');
  assert.equal(event?.data.reason, 'other');
});

test('Stop becomes a turn_end observation carrying the last assistant message', async () => {
  const dir = await root();
  const payload = JSON.stringify({
    session_id: 'sid-stop',
    hook_event_name: 'Stop',
    stop_hook_active: false,
    last_assistant_message: 'done',
    background_tasks: [],
    session_crons: [],
  });
  const r = runHook(payload, { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD });
  assert.equal(r.status, 0, r.stderr);
  const [event] = await readAllEvents(dir, 'ws');
  assert.equal(event?.kind, 'turn_end');
  assert.equal(event?.data.turn, 'done');
});

test('a PreToolUse payload becomes a tool_call observation', async () => {
  const dir = await root();
  const payload = JSON.stringify({
    session_id: 'sid-tc',
    hook_event_name: 'PreToolUse',
    tool_name: 'Read',
    tool_input: { file_path: '/private/var/probe/sample.txt' },
    tool_use_id: 'toolu_read',
  });
  const r = runHook(payload, { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD });
  assert.equal(r.status, 0, r.stderr);
  const [event] = await readAllEvents(dir, 'ws');
  assert.equal(event?.kind, 'tool_call');
  assert.equal(event?.session, 'sid-tc');
  assert.equal(event?.data.tool, 'Read');
  assert.equal(event?.data.callId, 'toolu_read');
  assert.equal(event?.data.input, JSON.stringify({ file_path: '/private/var/probe/sample.txt' }));
});

test('a PostToolUse payload becomes a tool_result observation with a JSON summary', async () => {
  const dir = await root();
  const payload = JSON.stringify({
    session_id: 'sid-tr',
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'ls' },
    tool_response: { stdout: 'a\nb\n', stderr: '', interrupted: false },
    tool_use_id: 'toolu_bash',
    duration_ms: 12,
  });
  const r = runHook(payload, { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD });
  assert.equal(r.status, 0, r.stderr);
  const [event] = await readAllEvents(dir, 'ws');
  assert.equal(event?.kind, 'tool_result');
  assert.equal(event?.data.tool, 'Bash');
  assert.equal(event?.data.callId, 'toolu_bash');
  assert.equal(event?.data.summary, JSON.stringify({ stdout: 'a\nb\n', stderr: '', interrupted: false }));
});

test('SubagentStart becomes a subagent_start observation attributed to that agent', async () => {
  const dir = await root();
  const payload = JSON.stringify({
    session_id: 'sid-sub',
    agent_id: 'agent-123',
    agent_type: 'general-purpose',
    hook_event_name: 'SubagentStart',
  });
  const r = runHook(payload, { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD });
  assert.equal(r.status, 0, r.stderr);
  const [event] = await readAllEvents(dir, 'ws');
  assert.equal(event?.kind, 'subagent_start');
  assert.equal(event?.agent, 'agent-123');
  assert.equal(event?.data.agentId, 'agent-123');
  assert.equal(event?.data.purpose, 'general-purpose');
});

test('SubagentStop becomes a subagent_stop observation with a fixed status, not a guess', async () => {
  const dir = await root();
  const payload = JSON.stringify({
    session_id: 'sid-sub',
    agent_id: 'agent-123',
    agent_type: 'general-purpose',
    hook_event_name: 'SubagentStop',
    stop_hook_active: false,
    agent_transcript_path: '/tmp/agent.jsonl',
    last_assistant_message: 'done',
    background_tasks: [],
    session_crons: [],
  });
  const r = runHook(payload, { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD });
  assert.equal(r.status, 0, r.stderr);
  const [event] = await readAllEvents(dir, 'ws');
  assert.equal(event?.kind, 'subagent_stop');
  assert.equal(event?.agent, 'agent-123');
  assert.equal(event?.data.status, 'stopped');
});

test('PostCompact becomes a compact observation carrying the trigger as its reason', async () => {
  const dir = await root();
  const payload = JSON.stringify({
    session_id: 'sid-compact',
    hook_event_name: 'PostCompact',
    trigger: 'manual',
    compact_summary: '<analysis>...</analysis>',
  });
  const r = runHook(payload, { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD });
  assert.equal(r.status, 0, r.stderr);
  const [event] = await readAllEvents(dir, 'ws');
  assert.equal(event?.kind, 'compact');
  assert.equal(event?.data.reason, 'manual');
});

// ---------------------------------------------------------------------------
// Deliberate non-mappings. Each of these is a finding from adapters/NOTES.md,
// not an oversight -- see journal-hook.mjs's `default` case and
// adapters/claude-code/README.md for the reasoning behind each.
// ---------------------------------------------------------------------------

test('UserPromptSubmit is observed but maps to none of the fourteen kinds', async () => {
  const dir = await root();
  const payload = JSON.stringify({
    session_id: 'sid-ups',
    hook_event_name: 'UserPromptSubmit',
    prompt_id: 'p1',
    permission_mode: 'default',
    prompt: 'List the files in this directory',
  });
  const r = runHook(payload, { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(await readAllEvents(dir, 'ws'), []);
});

test('PreCompact alone does not record a compact -- only PostCompact confirms it happened', async () => {
  const dir = await root();
  const payload = JSON.stringify({
    session_id: 'sid-precompact',
    hook_event_name: 'PreCompact',
    trigger: 'manual',
    custom_instructions: null,
  });
  const r = runHook(payload, { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(await readAllEvents(dir, 'ws'), []);
});

test('PermissionRequest has no confirmed harness source and is not wired', async () => {
  const dir = await root();
  const payload = JSON.stringify({ session_id: 'sid-perm', hook_event_name: 'PermissionRequest', tool_name: 'Read' });
  const r = runHook(payload, { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(await readAllEvents(dir, 'ws'), []);
});

test('PostToolUseFailure has no confirmed harness source and is not wired', async () => {
  const dir = await root();
  const payload = JSON.stringify({ session_id: 'sid-fail', hook_event_name: 'PostToolUseFailure', tool_name: 'Edit' });
  const r = runHook(payload, { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(await readAllEvents(dir, 'ws'), []);
});

test('no input maps to a heartbeat observation -- it is never wired, structurally', async () => {
  // adapters/NOTES.md: every hook fires only when the agent acts, so no
  // hook-derived signal can distinguish an idle-but-live session from a
  // dead one. There is deliberately no case in journal-hook.mjs\u2019s
  // switch for this, under any spelling.
  const dir = await root();
  const env = { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD };
  for (const name of ['heartbeat', 'Heartbeat', 'HEARTBEAT']) {
    runHook(JSON.stringify({ session_id: 'sid-hb', hook_event_name: name }), env);
  }
  const events = await readAllEvents(dir, 'ws');
  assert.ok(events.every((e) => e.kind !== 'heartbeat'));
});

// ---------------------------------------------------------------------------
// Harness text that looks like a flag. End to end, through the real script and
// the real CLI -- the argv-shape assertion above proves the FORM, this proves
// the CONSEQUENCE, which is the thing that was actually broken.
// ---------------------------------------------------------------------------

test('an assistant message opening with a horizontal rule still reaches disk', async () => {
  const dir = await root();
  // The reproducer, verbatim: `--turn ---\nSummary: ...` made `--turn` look
  // valueless, agent-journal exited 2, and this script ignored that by design
  // -- nothing written, and no `void` for `coverage` to report either.
  const message = '---\nSummary: fixed the parser.';
  const r = runHook(
    JSON.stringify({
      session_id: 'sid-rule',
      hook_event_name: 'Stop',
      last_assistant_message: message,
    }),
    { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD },
  );
  assert.equal(r.status, 0, r.stderr);
  const events = await readAllEvents(dir, 'ws');
  assert.equal(events.length, 1, 'the observation was silently lost');
  assert.equal(events[0]!.kind, 'turn_end');
  assert.equal(events[0]!.data.turn, message, 'the value must survive byte for byte');
});

test('every other harness-supplied field takes a ---leading value too', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD };
  // `reason` (SessionEnd), `trigger` -> reason (PostCompact), and a
  // string-valued `tool_input` -- every field either adapter fills from text
  // the harness chose, not text this project controls.
  runHook(JSON.stringify({
    session_id: 's', hook_event_name: 'SessionEnd', reason: '--- done',
  }), env);
  runHook(JSON.stringify({
    session_id: 's', hook_event_name: 'PostCompact', trigger: '--auto',
  }), env);
  runHook(JSON.stringify({
    session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: '--version', tool_use_id: 'toolu_9',
  }), env);

  const events = await readAllEvents(dir, 'ws');
  assert.equal(events.length, 3, `expected three observations, got ${events.length}`);
  const byKind = Object.fromEntries(events.map((e) => [e.kind, e]));
  assert.equal(byKind.session_end!.data.reason, '--- done');
  assert.equal(byKind.compact!.data.reason, '--auto');
  assert.equal(byKind.tool_call!.data.input, '--version');
});

// ---------------------------------------------------------------------------
// A subject is what makes an observation findable. Without one, an
// observation is reachable only by a uuid no command prints.
// ---------------------------------------------------------------------------

test('a tool_call and its tool_result share the tool name as their subject', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD };
  runHook(JSON.stringify({
    session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'pnpm test' }, tool_use_id: 'toolu_7',
  }), env);
  runHook(JSON.stringify({
    session_id: 's', hook_event_name: 'PostToolUse', tool_name: 'Bash',
    tool_response: { stdout: 'ok' }, tool_use_id: 'toolu_7',
  }), env);

  const events = await readAllEvents(dir, 'ws');
  assert.equal(events.length, 2);
  // The TOOL NAME, exactly -- `trace` matches a subject exactly, never as a
  // substring, so anything richer (`Bash:toolu_7`) would be findable by
  // nobody. The call id lives in data, which `show` renders.
  assert.deepEqual(events.map((e) => e.subject), ['Bash', 'Bash']);
  assert.deepEqual(events.map((e) => e.data.callId), ['toolu_7', 'toolu_7']);

  // Proof the subject is actually usable as a lookup key, not just present.
  const { traceFrom } = await import('../src/trace.ts');
  const matched = traceFrom(events, 'Bash').matched;
  assert.equal(matched.length, 2, 'trace Bash did not find the captured calls');
  assert.deepEqual([...new Set(matched.map((m) => m.via))], ['subject']);
});

test('a subagent observation is subjected to the agent id, not its type', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD };
  runHook(JSON.stringify({
    session_id: 's', hook_event_name: 'SubagentStart',
    agent_id: 'agent-42', agent_type: 'general-purpose',
  }), env);
  const [e] = await readAllEvents(dir, 'ws');
  assert.equal(e!.subject, 'agent-42', 'agent_type names a class, not an instance');
});

test('an event with nothing worth naming carries no subject at all', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD };
  // session_start/session_end/turn_end are about the session, which the
  // envelope already carries; compact is about nothing a reader searches for.
  // An invented subject on these would be a key matching every one of them.
  runHook(JSON.stringify({ session_id: 's', hook_event_name: 'Stop', last_assistant_message: 'done' }), env);
  const [e] = await readAllEvents(dir, 'ws');
  assert.ok(!('subject' in e!), 'a placeholder subject is worse than none');
});

// ---------------------------------------------------------------------------
// The authoring floors (Task 3). Two independent, opt-in output streams:
// Floor 2 on PostToolUse (hookSpecificOutput.additionalContext), Floor 1 on
// PreCompact (top-level reason/systemMessage, NO hookSpecificOutput -- see
// adapters/HOOK-OUTPUT-NOTES.md). "Test the OFF case first" per the brief:
// the OFF-by-default section comes before the ON section below.
// ---------------------------------------------------------------------------

const MUTATION_COMMAND = 'wrangler secret put API_KEY';

function preToolUseMutationPayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: MUTATION_COMMAND }, tool_use_id: 'toolu_mut',
    ...overrides,
  });
}

function postToolUseMutationPayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    session_id: 's', hook_event_name: 'PostToolUse', tool_name: 'Bash',
    tool_input: { command: MUTATION_COMMAND },
    tool_response: { stdout: 'ok', stderr: '', interrupted: false },
    tool_use_id: 'toolu_mut', duration_ms: 5,
    ...overrides,
  });
}

function postToolUseBenignPayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    session_id: 's', hook_event_name: 'PostToolUse', tool_name: 'Bash',
    tool_input: { command: 'git log --oneline -5' },
    tool_response: { stdout: 'ok', stderr: '', interrupted: false },
    tool_use_id: 'toolu_benign', duration_ms: 5,
    ...overrides,
  });
}

function preCompactPayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    session_id: 's', hook_event_name: 'PreCompact', trigger: 'manual', custom_instructions: null,
    ...overrides,
  });
}

// A stub AGENT_JOURNAL_CMD that stands in for the real `agent-journal`
// binary, dedicated to the `floor` subcommand only -- `observe` calls hit it
// too (journal-hook.mjs always calls both) but this stub does nothing for
// that subcommand, deliberately: these tests are about what THIS ADAPTER
// does with whatever `floor` printed, not about real journal classification
// (which the REAL_CMD-based tests below already cover end to end). Behaviour
// is switched by STUB_FLOOR_MODE: 'hang' blocks past FLOOR_TIMEOUT_MS,
// 'huge' prints 300KB, 'text' prints STUB_FLOOR_TEXT verbatim (so the OUTER
// test file can hand it arbitrary content -- quotes, newlines, backslashes,
// unicode -- without needing to double-escape any of it into a second
// script's source), anything else (including unset) prints nothing. When
// STUB_ARGV_LOG is set, every `floor` invocation's argv is appended to it as
// one JSON line, which is how the --since/--subject computation itself is
// checked below.
async function writeStubFloor(dir: string): Promise<string> {
  const stubPath = join(dir, 'stub-floor.mjs');
  await writeFile(
    stubPath,
    [
      "import { appendFileSync } from 'node:fs';",
      "import { execFileSync } from 'node:child_process';",
      'const args = process.argv.slice(2);',
      'const sub = args[0];',
      "if (sub === 'floor' && process.env.STUB_ARGV_LOG) {",
      "  appendFileSync(process.env.STUB_ARGV_LOG, JSON.stringify(args) + '\\n');",
      '}',
      "if (sub === 'floor') {",
      "  const mode = process.env.STUB_FLOOR_MODE || 'empty';",
      "  if (mode === 'hang') execFileSync('sleep', ['5']);",
      "  else if (mode === 'huge') process.stdout.write('X'.repeat(300000));",
      "  else if (mode === 'text') process.stdout.write(process.env.STUB_FLOOR_TEXT || '');",
      '}',
      'process.exit(0);',
      '',
    ].join('\n'),
  );
  return stubPath;
}

// --------------------------- OFF case, tested first ------------------------

test('floors off by default: a mutation-shaped PostToolUse prints nothing on stdout', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD };
  runHook(preToolUseMutationPayload(), env);
  const r = runHook(postToolUseMutationPayload(), env); // AGENT_JOURNAL_FLOORS unset
  assert.equal(r.status, 0, r.stderr);
  assert.equal((r.stdout ?? '').trim(), '', 'a real consequence exists but floors are off -- must stay silent');
});

test('floors stay off when AGENT_JOURNAL_FLOORS is blank', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD };
  runHook(preToolUseMutationPayload(), env);
  const r = runHook(postToolUseMutationPayload(), { ...env, AGENT_JOURNAL_FLOORS: '' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal((r.stdout ?? '').trim(), '');
});

test('floors stay off for any value other than the exact string "1"', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD };
  for (const value of ['0', 'true', 'yes', 'on', ' 1', '1 ']) {
    runHook(preToolUseMutationPayload(), env);
    const r = runHook(postToolUseMutationPayload(), { ...env, AGENT_JOURNAL_FLOORS: value });
    assert.equal(r.status, 0, r.stderr);
    assert.equal((r.stdout ?? '').trim(), '', `AGENT_JOURNAL_FLOORS=${JSON.stringify(value)} was treated as ON`);
  }
});

test('floors stay off when the workspace is unconfigured, even with AGENT_JOURNAL_FLOORS=1', async () => {
  const dir = await root();
  const r = runHook(postToolUseMutationPayload(), {
    AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD, AGENT_JOURNAL_FLOORS: '1',
    AGENT_JOURNAL_WORKSPACE: '',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal((r.stdout ?? '').trim(), '');
});

// ------------------------- ON: silence stays the common case ---------------

test('floors on, but the event is neither PostToolUse nor PreCompact: never emits', async () => {
  const dir = await root();
  const env = {
    AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD,
    AGENT_JOURNAL_FLOORS: '1',
  };
  // PreToolUse itself carries the same mutating command -- if the event-name
  // gate were dropped or widened, this is the case that would catch it.
  const r = runHook(preToolUseMutationPayload(), env);
  assert.equal(r.status, 0, r.stderr);
  assert.equal((r.stdout ?? '').trim(), '');
});

test('floors on, PostToolUse for a benign call with no matching constraint: prints nothing', async () => {
  const dir = await root();
  const env = {
    AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD,
    AGENT_JOURNAL_FLOORS: '1',
  };
  runHook(JSON.stringify({
    session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'git log --oneline -5' }, tool_use_id: 'toolu_benign',
  }), env);
  const r = runHook(postToolUseBenignPayload(), env);
  assert.equal(r.status, 0, r.stderr);
  assert.equal((r.stdout ?? '').trim(), '', 'most tool calls are not consequence-bearing -- this must stay silent');
});

test('floors on, PreCompact on a workspace with no activity: prints nothing', async () => {
  const dir = await root();
  const env = {
    AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD,
    AGENT_JOURNAL_FLOORS: '1',
  };
  const r = runHook(preCompactPayload(), env);
  assert.equal(r.status, 0, r.stderr);
  assert.equal((r.stdout ?? '').trim(), '');
});

// ----------------------- ON: the real content, end to end ------------------

test('floors on, a mutating PostToolUse: prints valid PostToolUse hookSpecificOutput naming the observation', async () => {
  const dir = await root();
  const env = {
    AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD,
    AGENT_JOURNAL_FLOORS: '1',
  };
  runHook(preToolUseMutationPayload(), env);
  const r = runHook(postToolUseMutationPayload(), env);
  assert.equal(r.status, 0, r.stderr);
  assert.notEqual((r.stdout ?? '').trim(), '');

  const parsed = JSON.parse(r.stdout!.trim());
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(parsed.hookSpecificOutput.additionalContext, /anchor/i);
  assert.match(parsed.hookSpecificOutput.additionalContext, /mutation/i);
  // Never a pre-written entry -- the same property floors.ts's own tests pin,
  // re-checked here because this is what actually leaves the adapter.
  assert.doesNotMatch(parsed.hookSpecificOutput.additionalContext, /agent-journal record/);
  // Exactly one top-level key: no stray reason/systemMessage/hookSpecificOutput sibling.
  assert.deepEqual(Object.keys(parsed).sort(), ['hookSpecificOutput']);
});

test('floors on, PreCompact with pending activity: prints reason/systemMessage, never hookSpecificOutput', async () => {
  const dir = await root();
  const env = {
    AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD,
    AGENT_JOURNAL_FLOORS: '1',
  };
  runHook(JSON.stringify({
    session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'ls' }, tool_use_id: 'toolu_1',
  }), env);
  const r = runHook(preCompactPayload(), env);
  assert.equal(r.status, 0, r.stderr);
  assert.notEqual((r.stdout ?? '').trim(), '');

  const parsed = JSON.parse(r.stdout!.trim());
  assert.match(parsed.reason, /assumption sweep/i);
  assert.match(parsed.reason, /checked: no/);
  assert.equal(parsed.systemMessage, parsed.reason, 'both generic fields must carry the same text');
  // This is the rule the whole two-mechanism design rests on: PreCompact's
  // own schema REJECTS hookSpecificOutput outright (HOOK-OUTPUT-NOTES.md).
  // If this key ever appears here, Claude Code will show a validation-error
  // banner instead of delivering the prompt.
  assert.ok(!('hookSpecificOutput' in parsed), 'PreCompact output must never carry hookSpecificOutput');
  assert.deepEqual(Object.keys(parsed).sort(), ['reason', 'systemMessage']);
});

test('PreCompact firing the floor still records no compact observation -- the two streams stay independent', async () => {
  const dir = await root();
  const env = {
    AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD,
    AGENT_JOURNAL_FLOORS: '1',
  };
  runHook(JSON.stringify({
    session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'ls' }, tool_use_id: 'toolu_1',
  }), env);
  const before = await readAllEvents(dir, 'ws');
  const r = runHook(preCompactPayload(), env);
  assert.equal(r.status, 0, r.stderr);
  assert.notEqual((r.stdout ?? '').trim(), '', 'the floor itself must still have fired');
  const after = await readAllEvents(dir, 'ws');
  assert.deepEqual(after, before, 'PreCompact must not have written any observation, floor or not');
  assert.ok(after.every((e) => e.kind !== 'compact'));
});

// --------------------------- --since / --subject shape ---------------------

test('a PostToolUse floor check passes --since bounded by duration_ms and --subject as the command text', async () => {
  const dir = await root();
  const stubPath = await writeStubFloor(dir);
  const argvLog = join(dir, 'argv.log');
  const env = {
    AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir,
    AGENT_JOURNAL_CMD: `${process.execPath} ${stubPath}`,
    AGENT_JOURNAL_FLOORS: '1', STUB_ARGV_LOG: argvLog,
  };
  const before = Date.now();
  const durationMs = 1234;
  const r = runHook(postToolUseMutationPayload({ duration_ms: durationMs }), env);
  assert.equal(r.status, 0, r.stderr);

  const logged = (await readFile(argvLog, 'utf8')).trim().split('\n');
  assert.equal(logged.length, 1, `expected exactly one floor invocation, got ${logged.length}`);
  const args = JSON.parse(logged[0]!) as string[];
  assert.equal(args[0], 'floor');
  assert.ok(args.includes('--kind=consequence'), JSON.stringify(args));
  assert.ok(args.includes('--workspace=ws'), JSON.stringify(args));

  const subjectArg = args.find((a) => a.startsWith('--subject='));
  assert.equal(subjectArg, `--subject=${JSON.stringify({ command: MUTATION_COMMAND })}`);

  const sinceArg = args.find((a) => a.startsWith('--since='));
  assert.ok(sinceArg, 'no --since flag was passed');
  const sinceMs = Date.parse(sinceArg!.slice('--since='.length));
  // Expected: T - durationMs - 10_000 (the default lookback), where T is
  // whatever `Date.now()` read inside the hook, some point between `before`
  // (captured just before the call) and `after` (just after it returns).
  // durationMs and the lookback are both constants subtracted from T either
  // way, so the same [before, after] window bounds `since` directly, with
  // no extra slack needed.
  const after = Date.now();
  assert.ok(sinceMs >= before - durationMs - 10_000, `since too early: ${sinceArg}`);
  assert.ok(sinceMs <= after - durationMs - 10_000, `since too late: ${sinceArg}`);
});

test('a PreCompact floor check passes neither --since nor --subject', async () => {
  const dir = await root();
  const stubPath = await writeStubFloor(dir);
  const argvLog = join(dir, 'argv.log');
  const env = {
    AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir,
    AGENT_JOURNAL_CMD: `${process.execPath} ${stubPath}`,
    AGENT_JOURNAL_FLOORS: '1', STUB_ARGV_LOG: argvLog,
  };
  const r = runHook(preCompactPayload(), env);
  assert.equal(r.status, 0, r.stderr);

  const logged = (await readFile(argvLog, 'utf8')).trim().split('\n');
  assert.equal(logged.length, 1);
  const args = JSON.parse(logged[0]!) as string[];
  assert.deepEqual(args, ['floor', '--kind=compaction', '--workspace=ws']);
});

// ------------------------------- dedup heuristic ----------------------------

test('an old mutation falls outside a short lookback window and does not resurface on a later, unrelated call', async () => {
  const dir = await root();
  const seedEnv = { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD };
  // Seed the old mutation with floors off -- only its own timing matters here.
  const seeded = runHook(preToolUseMutationPayload({ tool_use_id: 'toolu_old' }), seedEnv);
  assert.equal(seeded.status, 0, seeded.stderr);

  await new Promise((resolve) => { setTimeout(resolve, 300); });

  const checkEnv = {
    ...seedEnv, AGENT_JOURNAL_FLOORS: '1', AGENT_JOURNAL_FLOOR_LOOKBACK_MS: '50',
  };
  runHook(JSON.stringify({
    session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'ls' }, tool_use_id: 'toolu_new',
  }), checkEnv);
  const r = runHook(JSON.stringify({
    session_id: 's', hook_event_name: 'PostToolUse', tool_name: 'Bash',
    tool_input: { command: 'ls' },
    tool_response: { stdout: 'ok' }, tool_use_id: 'toolu_new', duration_ms: 1,
  }), checkEnv);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    (r.stdout ?? '').trim(), '',
    'the mutation from 300ms ago should have fallen outside a 50ms(+1ms) lookback window',
  );
});

// --------------------------- Rule 1, extended to the new stream ------------

test('a floor check that hangs still exits 0, bounded by FLOOR_TIMEOUT_MS, not by the stdin timeout', async () => {
  const dir = await root();
  const stubPath = await writeStubFloor(dir);
  const env = {
    AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir,
    AGENT_JOURNAL_CMD: `${process.execPath} ${stubPath}`,
    AGENT_JOURNAL_FLOORS: '1', STUB_FLOOR_MODE: 'hang',
  };
  const started = Date.now();
  const r = runHook(preCompactPayload(), env);
  const elapsedMs = Date.now() - started;
  assert.equal(r.status, 0, r.stderr);
  assert.equal((r.stdout ?? '').trim(), '', 'a hung floor check must not deliver partial or garbage output');
  assert.ok(elapsedMs < 9_000, `took ${elapsedMs}ms -- FLOOR_TIMEOUT_MS did not bound this`);
});

test('agent-journal being unavailable for the floor call still exits 0 and prints nothing', async () => {
  const dir = await root();
  const r = runHook(postToolUseMutationPayload(), {
    AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_FLOORS: '1',
    AGENT_JOURNAL_CMD: '/no/such/agent-journal-binary',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal((r.stdout ?? '').trim(), '');
});

test('a 300KB floor render is truncated by this adapter, not handed to the harness whole', async () => {
  const dir = await root();
  const stubPath = await writeStubFloor(dir);
  const env = {
    AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir,
    AGENT_JOURNAL_CMD: `${process.execPath} ${stubPath}`,
    AGENT_JOURNAL_FLOORS: '1', STUB_FLOOR_MODE: 'huge',
  };
  const r = runHook(postToolUseMutationPayload(), env);
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout!.trim());
  const text = parsed.hookSpecificOutput.additionalContext as string;
  assert.ok(text.length < 10_000, `expected this adapter to truncate; got ${text.length} chars`);
  assert.match(text, /truncated/);
});

test('floor output containing quotes, backslashes, newlines and unicode still round-trips as valid JSON', async () => {
  const dir = await root();
  const stubPath = await writeStubFloor(dir);
  const tricky = 'line one\nline "two" has quotes\\and a backslash\ncafé — em dash too';
  const env = {
    AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir,
    AGENT_JOURNAL_CMD: `${process.execPath} ${stubPath}`,
    AGENT_JOURNAL_FLOORS: '1', STUB_FLOOR_MODE: 'text', STUB_FLOOR_TEXT: tricky,
  };
  const r = runHook(postToolUseMutationPayload(), env);
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout!.trim()); // throws if this adapter emitted invalid JSON
  assert.equal(parsed.hookSpecificOutput.additionalContext, tricky);
});

test('a malformed (non-JSON) floor render is never forwarded -- the adapter only ever emits its own JSON', async () => {
  // journal-hook.mjs never passes the raw `floor` stdout through verbatim --
  // it always re-wraps it via JSON.stringify. This pins that even stdout
  // that LOOKS like broken JSON on its own (an unterminated brace) still
  // comes out the other side as ONE well-formed JSON object, because it was
  // never treated as JSON to begin with, only as a plain string value.
  const dir = await root();
  const stubPath = await writeStubFloor(dir);
  const env = {
    AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir,
    AGENT_JOURNAL_CMD: `${process.execPath} ${stubPath}`,
    AGENT_JOURNAL_FLOORS: '1', STUB_FLOOR_MODE: 'text', STUB_FLOOR_TEXT: '{"broken": [1, 2,',
  };
  const r = runHook(postToolUseMutationPayload(), env);
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout!.trim());
  assert.equal(parsed.hookSpecificOutput.additionalContext, '{"broken": [1, 2,');
});
