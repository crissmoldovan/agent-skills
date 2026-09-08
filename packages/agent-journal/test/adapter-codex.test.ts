import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JournalEvent } from '../src/envelope.ts';

// This suite tests the SAME black-box contract as
// adapter-claude-code.test.ts, against adapters/codex instead. See
// adapters/codex/README.md before trusting anything below: Codex is not
// installed on the machine that wrote either the adapter or this suite
// (adapters/NOTES.md, Step 4), so every payload here is built from Codex's
// published hooks documentation, not a captured example. The three rules
// (never fails the call it observes, never blocks, bypasses nothing) are
// verified live regardless — those do not depend on Codex's payload shapes
// being right, only on this script's own control flow, which is testable
// without Codex installed. The mapping tests below verify what this
// adapter WOULD do with a payload shaped the way the docs describe; they
// are not proof Codex actually sends that shape.

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TEST_DIR, '..', '..', '..');
const HOOK = join(REPO_ROOT, 'adapters', 'codex', 'journal-hook.sh');
const BIN_TS = join(TEST_DIR, '..', 'src', 'bin.ts');

// The real agent-journal CLI, run straight from TypeScript source. This
// package's own "verify" script runs `test` BEFORE `build`
// (package.json: "check:types && test && build"), so `pnpm test` alone does
// not guarantee dist/bin.js exists or is current -- these tests must not
// depend on it. `--experimental-strip-types` is the same mechanism this
// package's own test files already run under.
const REAL_CMD = `${process.execPath} --experimental-strip-types ${BIN_TS}`;

async function root(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'journal-hook-codex-'));
}

// Mirrors readAllEvents in cli.test.ts and adapter-claude-code.test.ts,
// including the mergeEvents call -- see cli.test.ts's comment on why: a raw
// per-segment read sees `readdir` order, not the order a real consumer
// sees.
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
    cwd: '/private/var/probe',
    hook_event_name: 'SessionStart',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Proof the test harness itself works. This must run and pass BEFORE any
// test below is trusted, for the same reason the Claude Code suite calls
// out: a broken pipe between spawnSync and the script would make every
// "handled this payload" assertion look green while the script never saw
// the payload at all.
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
    tool_name: 'apply_patch',
    tool_input: { patch: '*** Begin Patch\n*** End Patch' },
    tool_use_id: 'call_1',
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
  assert.deepEqual(
    args.slice(0, 4),
    ['observe', '--workspace', 'ws', '--kind'],
    `unexpected argv shape reached the observe command: ${JSON.stringify(args)}`,
  );
  assert.ok(args.includes('tool_call'));
  assert.ok(args.includes('--tool'));
  assert.ok(args.includes('apply_patch'));
  assert.ok(args.includes('--callId'));
  assert.ok(args.includes('call_1'));
});

// ---------------------------------------------------------------------------
// Rule 1: it never fails the call it observes.
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

// The .sh guard is `[ -z "${AGENT_JOURNAL_WORKSPACE:-}" ]`, which does NOT
// catch a whitespace-only value -- `[ -z " " ]` is false, so it falls through
// to the .mjs. Only the `.trim()` half of that script's `!workspace ||
// !workspace.trim()` stops it there, and the empty-string test above masks
// that half entirely. A workspace of " " would otherwise be written as a real
// journal directory nobody asked for. Same finding as
// adapter-claude-code.test.ts, carried over because journal-hook.sh and
// journal-hook.mjs share the identical guard structure here.
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
  // Documents, with a passing assertion, the same bug the Claude Code
  // adapter found while being built: the brief's own sketch used
  // `: "${AGENT_JOURNAL_WORKSPACE:?}" 2>/dev/null || exit 0`. Measured
  // directly: on an unset variable, `${:?}` ends the whole non-interactive
  // shell right there, with ITS OWN nonzero code, before `||` ever runs (1
  // under macOS `/bin/sh`, 2 under dash). journal-hook.sh uses
  // `[ -z "${VAR:-}" ]` instead, which does not have this failure mode --
  // verified here for the Codex script specifically, not assumed to carry
  // over just because it looks the same on the page.
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
  // A harness that opens the pipe and never writes or closes it must not
  // hang the call it is meant to observe. Node's spawnSync always closes
  // the `input` pipe after writing, so this needs a real, still-open pipe
  // -- built here with a FIFO whose writer end is held open by a background
  // process that never sends EOF. Same construction as
  // adapter-claude-code.test.ts, run against the Codex script instead.
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
    tool_name: 'shell',
    tool_input: { command: 'export AWS_SECRET_ACCESS_KEY=AKIAABCDEFGHIJKLMNOP' },
    tool_use_id: 'call_secret',
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
// Mapping: the events adapters/codex/README.md documents as wired, against
// payloads built from Codex's published docs -- NOT captured payloads. See
// the file header.
// ---------------------------------------------------------------------------

test('SessionStart becomes a session_start observation', async () => {
  const dir = await root();
  const r = runHook(sessionStartPayload(), { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD });
  assert.equal(r.status, 0, r.stderr);
  const [event] = await readAllEvents(dir, 'ws');
  assert.equal(event?.kind, 'session_start');
  assert.equal(event?.session, 'sid-start');
  assert.equal(event?.data.harness, 'codex');
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
    last_assistant_message: 'done',
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
    tool_name: 'apply_patch',
    tool_input: { patch: '*** Begin Patch\n*** End Patch' },
    tool_use_id: 'call_patch',
  });
  const r = runHook(payload, { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD });
  assert.equal(r.status, 0, r.stderr);
  const [event] = await readAllEvents(dir, 'ws');
  assert.equal(event?.kind, 'tool_call');
  assert.equal(event?.session, 'sid-tc');
  assert.equal(event?.data.tool, 'apply_patch');
  assert.equal(event?.data.callId, 'call_patch');
  assert.equal(event?.data.input, JSON.stringify({ patch: '*** Begin Patch\n*** End Patch' }));
});

test('a PostToolUse payload becomes a tool_result observation with a JSON summary', async () => {
  const dir = await root();
  const payload = JSON.stringify({
    session_id: 'sid-tr',
    hook_event_name: 'PostToolUse',
    tool_name: 'shell',
    tool_input: { command: 'ls' },
    tool_response: { stdout: 'a\nb\n', exit_code: 0 },
    tool_use_id: 'call_shell',
  });
  const r = runHook(payload, { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD });
  assert.equal(r.status, 0, r.stderr);
  const [event] = await readAllEvents(dir, 'ws');
  assert.equal(event?.kind, 'tool_result');
  assert.equal(event?.data.tool, 'shell');
  assert.equal(event?.data.callId, 'call_shell');
  assert.equal(event?.data.summary, JSON.stringify({ stdout: 'a\nb\n', exit_code: 0 }));
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
  });
  const r = runHook(payload, { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD });
  assert.equal(r.status, 0, r.stderr);
  const [event] = await readAllEvents(dir, 'ws');
  assert.equal(event?.kind, 'compact');
  assert.equal(event?.data.reason, 'manual');
});

// ---------------------------------------------------------------------------
// Deliberate non-mappings. Each is a documented-not-observed finding from
// adapters/codex/README.md, not an oversight -- see journal-hook.mjs's
// `default` case for the reasoning behind each.
// ---------------------------------------------------------------------------

test('UserPromptSubmit is documented but maps to none of the fourteen kinds', async () => {
  const dir = await root();
  const payload = JSON.stringify({
    session_id: 'sid-ups',
    hook_event_name: 'UserPromptSubmit',
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
  });
  const r = runHook(payload, { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(await readAllEvents(dir, 'ws'), []);
});

test('PermissionRequest is documented but left unwired as a safety decision, not an evidentiary gap', async () => {
  // Unlike Claude Code's PermissionRequest (never confirmed to fire at all),
  // Codex's own docs describe this event's hook output as able to allow or
  // deny the underlying request. Wiring it unverified would risk becoming
  // the thing that denies the call it was meant to only observe -- see
  // adapters/codex/README.md. This test asserts the safe outcome: nothing
  // recorded, same as every other unmapped event.
  const dir = await root();
  const payload = JSON.stringify({ session_id: 'sid-perm', hook_event_name: 'PermissionRequest', tool_name: 'shell' });
  const r = runHook(payload, { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(await readAllEvents(dir, 'ws'), []);
});

test('Interrupt is a Codex-only event with no matching kind, and is not wired', async () => {
  const dir = await root();
  const payload = JSON.stringify({ session_id: 'sid-int', hook_event_name: 'Interrupt' });
  const r = runHook(payload, { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(await readAllEvents(dir, 'ws'), []);
});

test('no input maps to a heartbeat observation -- it is never wired, structurally', async () => {
  // adapters/NOTES.md: every hook fires only when the agent acts, so no
  // hook-derived signal can distinguish an idle-but-live session from a
  // dead one. Codex's own documented event list has the same shape (every
  // event ties to an action or a phase change) -- there is deliberately no
  // case in journal-hook.mjs's switch for this, under any spelling.
  const dir = await root();
  const env = { AGENT_JOURNAL_WORKSPACE: 'ws', AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_CMD: REAL_CMD };
  for (const name of ['heartbeat', 'Heartbeat', 'HEARTBEAT']) {
    runHook(JSON.stringify({ session_id: 'sid-hb', hook_event_name: name }), env);
  }
  const events = await readAllEvents(dir, 'ws');
  assert.ok(events.every((e) => e.kind !== 'heartbeat'));
});
