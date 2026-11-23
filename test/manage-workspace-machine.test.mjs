import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers/temp-dir.mjs';

const dir = fileURLToPath(new URL('../skills/manage-workspace/scripts/', import.meta.url));
const leftovers = path.join(dir, 'leftovers.mjs');
const machine = await import(path.join(dir, 'machine.mjs'));

const GiB = 1024;
const healthy = { platform: 'darwin', ramMiB: 36 * GiB, freePct: 55, swapUsedMiB: 900, swapTotalMiB: 2048 };
// The reading taken on the night this was written: the free percentage looked fine while swap was full.
const swapFull = { platform: 'darwin', ramMiB: 36 * GiB, freePct: 42, swapUsedMiB: 19300, swapTotalMiB: 20480 };

test('the swap and meminfo readers parse what macOS and Linux print', () => {
  assert.deepEqual(machine.parseSwapUsage('total = 20480.00M  used = 19135.38M  free = 1344.62M  (encrypted)'), { totalMiB: 20480, usedMiB: 19135.38 });
  assert.deepEqual(machine.parseSwapUsage('total = 0.00M  used = 0.00M  free = 0.00M'), { totalMiB: 0, usedMiB: 0 });
  const linux = machine.parseMeminfo('MemTotal:       16384000 kB\nMemFree:  100 kB\nMemAvailable:    4096000 kB\nSwapTotal:       2048000 kB\nSwapFree:        1024000 kB\n');
  assert.equal(Math.round(linux.ramMiB), 16000);
  assert.equal(Math.round(linux.freePct), 25);
  assert.equal(Math.round(linux.swapUsedMiB), 1000);
  assert.equal(machine.parseEtime('03-04:40:58'), 3 * 86400 + 4 * 3600 + 40 * 60 + 58);
  assert.equal(machine.parseEtime('14:38'), 14 * 60 + 38);
});

test('the memory verdict refuses on swap even when the free percentage looks fine', () => {
  const night = machine.memoryVerdict(swapFull);
  assert.equal(night.ok, false);
  assert.match(night.reasons.join(' '), /swap/);
  assert.match(night.reasons.join(' '), /quarter of RAM|of RAM/);
  assert.equal(machine.memoryVerdict(healthy).ok, true);
  const low = machine.memoryVerdict({ ...healthy, freePct: 12 });
  assert.equal(low.ok, false);
  assert.match(low.reasons.join(' '), /12% of memory is free/);
  assert.equal(machine.memoryVerdict({ ...healthy, freePct: 40 }, { needMiB: 6144 }).ok, true, 'a 6 GiB VM fits above the floor with 40% of 36 GiB free');
  assert.equal(machine.memoryVerdict({ ...healthy, freePct: 30 }, { needMiB: 6144 }).ok, false, 'with 30% free it would leave the machine under the floor');
  const tight = machine.memoryVerdict({ ...healthy, freePct: 21 }, { needMiB: 9000 });
  assert.equal(tight.ok, false, '9000 MiB does not fit in 21% of 36 GiB');
  assert.match(tight.reasons.join(' '), /needs 9000 MiB/);
  assert.equal(machine.memoryVerdict(swapFull, { maxSwapMiB: 30000 }).ok, true, 'the swap limit is the caller\'s to set');
});

const psLine = (pid, ppid, etime, rss, args) => `${pid} ${ppid} ${etime} ${rss} ${args}`;

test('the process scan finds helpers, parentless agents and sessions served twice, and nothing else', () => {
  const ps = [
    psLine(1, 0, '06-00:00:00', 10, '/sbin/launchd'),
    psLine(100, 1, '03-00:00:00', 20000, 'node /plugins/codex/scripts/app-server-broker.mjs serve --endpoint unix:/t/a.sock --cwd /work/lane-gone --pid-file /t/a.pid'),
    psLine(101, 100, '03-00:00:00', 300000, '/bin/codex app-server'),
    psLine(102, 101, '03-00:00:00', 70000, 'node /npx/trigger mcp'),
    psLine(110, 1, '02-00:00:00', 20000, 'node /plugins/codex/scripts/app-server-broker.mjs serve --endpoint unix:/t/b.sock --cwd /work/main --pid-file /t/b.pid'),
    psLine(120, 1, '01-00:00:00', 20000, 'node /plugins/codex/scripts/app-server-broker.mjs serve --endpoint unix:/t/c.sock --cwd /work/main --pid-file /t/c.pid'),
    psLine(200, 1, '10:00', 400000, '/ext/native-binary/claude --output-format stream-json --verbose'),
    psLine(201, 300, '05:00', 300000, '/ext/native-binary/claude --output-format stream-json --verbose'),
    psLine(202, 900, '20:00', 300000, '/ext/native-binary/claude --output-format stream-json --verbose'),
    psLine(203, 1, '1-00:00:00', 1000, '/usr/local/bin/claude --chrome-native-host'),
    psLine(300, 1, '20:00', 200000, '/Applications/Editor.app/Contents/MacOS/Editor'),
    psLine(900, 300, '20:00', 90000, 'Editor Helper (Plugin)'),
    psLine(400, 1, '15:00', 6000000, '/System/Library/Frameworks/Virtualization.framework/Versions/A/XPCServices/com.apple.Virtualization.VirtualMachine.xpc/Contents/MacOS/com.apple.Virtualization.VirtualMachine'),
  ].join('\n');
  const env = { 100: { CODEX_COMPANION_SESSION_ID: 'ended' }, 110: { CODEX_COMPANION_SESSION_ID: 'live' }, 120: { CODEX_COMPANION_SESSION_ID: 'live' } };
  const sessions = [
    { pid: 200, sessionId: 'twice', name: 'lane work', cwd: '/work/main' },
    { pid: 201, sessionId: 'twice', name: 'lane work', cwd: '/work/main' },
    { pid: 202, sessionId: 'live', name: 'main', cwd: '/work/main' },
  ];
  const scan = machine.scanProcesses({ ps, envOf: (pid) => env[pid] ?? {}, sessions, exists: (p) => p !== '/work/lane-gone' });

  assert.deepEqual(scan.helpers.map((h) => [h.pid, h.session, h.folderGone, h.sessionLive]), [[100, 'ended', true, false], [110, 'live', false, true], [120, 'live', false, true]]);
  assert.deepEqual(scan.helpers[0].tree, [100, 101, 102], 'a helper carries its whole tree');
  assert.equal(scan.helpers[0].rssKiB, 390000);
  assert.deepEqual(scan.agents.map((a) => [a.pid, a.session]), [[200, 'twice']], 'only a parentless agent CLI, and not the browser bridge');
  assert.deepEqual(scan.duplicates.map((d) => [d.session, d.pids]), [['twice', [200, 201]]]);
  assert.equal(scan.vms.length, 1);
  assert.deepEqual(machine.stoppable(scan).map((h) => h.pid), [100], 'only a helper whose session ended or whose folder is gone');
  assert.deepEqual(machine.stoppable(scan, { session: 'live' }).map((h) => h.pid), [], 'a live session\'s helper in an existing folder stays');

  const unknown = machine.scanProcesses({ ps, envOf: (pid) => env[pid] ?? {}, sessions: null, exists: () => true });
  assert.equal(unknown.helpers[0].sessionLive, null, 'without the session registry, liveness is unknown');
  assert.deepEqual(machine.stoppable(unknown).map((h) => h.pid), [], 'and unknown never counts as ended');
});

// ---- real processes: a decoy broker, scoped by a session id nobody else uses ---------------------

async function decoys(t) {
  const root = await tempDir('mw-machine-');
  const plugin = path.join(root, 'plugin', 'scripts');
  mkdirSync(plugin, { recursive: true });
  const broker = path.join(plugin, 'app-server-broker.mjs');
  writeFileSync(broker, [
    "import { spawn } from 'node:child_process';",
    "if (!process.argv.includes('--child')) spawn(process.execPath, [process.argv[1], '--child'], { stdio: 'ignore' });",
    'setInterval(() => {}, 1000);',
  ].join('\n'));
  const started = [];
  const start = (session, folder) => {
    const child = spawn(process.execPath, [broker, 'serve', '--endpoint', `unix:${path.join(root, `${randomUUID()}.sock`)}`, '--cwd', folder, '--pid-file', path.join(root, 'x.pid')], {
      env: { ...process.env, CODEX_COMPANION_SESSION_ID: session }, detached: true, stdio: 'ignore',
    });
    child.unref(); started.push(child.pid); return child.pid;
  };
  t.after(() => { for (const pid of started) { for (const c of childrenOf(pid)) try { process.kill(c, 'SIGKILL'); } catch { /* gone */ } try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } });
  const home = path.join(root, 'home');
  mkdirSync(home);
  const fixture = path.join(root, 'fixture.json');
  writeFileSync(fixture, JSON.stringify({ memory: healthy }));
  const env = { ...process.env, HOME: home, MWS_STATE_DIR: path.join(home, 'state'), MWS_CONFIG_DIR: path.join(home, 'config'), MWS_MACHINE_FIXTURE: fixture };
  delete env.MWS_CLEANUP_MODE; delete env.MWS_HELPERS; delete env.CLAUDE_CONFIG_DIR;
  const hook = (event, input, extra = {}) => spawnSync(process.execPath, [leftovers, event], { input: JSON.stringify(input), encoding: 'utf8', env: { ...env, ...extra } });
  const cli = (...args) => spawnSync(process.execPath, [leftovers, ...args], { encoding: 'utf8', env });
  return { root, start, hook, cli };
}

function childrenOf(pid) {
  const out = spawnSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' }).stdout || '';
  return out.split('\n').map((l) => l.trim().split(/\s+/).map(Number)).filter(([, p]) => p === pid).map(([c]) => c);
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(check, ms = 4000) { const end = Date.now() + ms; while (Date.now() < end) { if (check()) return true; await new Promise((r) => setTimeout(r, 50)); } return check(); }

test('session end stops every helper the ending session started, in any folder, and no one else\'s', async (t) => {
  const { root, start, hook } = await decoys(t);
  const mine = `mw-test-${randomUUID()}`; const theirs = `mw-test-${randomUUID()}`;
  const a = start(mine, path.join(root, 'lane-a')); const b = start(mine, root); const other = start(theirs, root);
  assert.ok(await until(() => childrenOf(a).length && childrenOf(b).length && childrenOf(other).length), 'decoys running');
  const kids = [...childrenOf(a), ...childrenOf(b)];

  const ended = hook('session-end', { session_id: mine, hook_event_name: 'SessionEnd', reason: 'other', cwd: root, transcript_path: null });
  assert.equal(ended.status, 0, ended.stderr);
  assert.equal(ended.stdout, '', 'session end prints nothing');
  assert.ok(await until(() => ![a, b, ...kids].some(alive)), 'both helpers and their children are gone');
  assert.ok(alive(other), 'another session\'s helper keeps running');

  assert.equal(hook('session-end', { session_id: theirs }, { MWS_HELPERS: 'report' }).status, 0);
  assert.ok(alive(other), 'report mode stops nothing');
  assert.equal(hook('session-end', { session_id: theirs }, { MWS_CLEANUP_MODE: 'off' }).status, 0);
  assert.ok(alive(other), 'off stops nothing');
});

test('the end-of-turn check stops this session\'s helpers whose folder is gone, and only those', async (t) => {
  const { root, start, hook } = await decoys(t);
  const sid = `mw-test-${randomUUID()}`;
  const lane = path.join(root, 'lane-b'); mkdirSync(lane);
  const kept = start(sid, root); const orphaned = start(sid, lane);
  assert.ok(await until(() => childrenOf(kept).length && childrenOf(orphaned).length));
  rmSync(lane, { recursive: true });
  const transcript = path.join(root, 't.jsonl'); writeFileSync(transcript, '');

  const reported = hook('stop', { session_id: sid, transcript_path: transcript, hook_event_name: 'Stop' }, { MWS_HELPERS: 'report' });
  assert.match(JSON.parse(reported.stdout).systemMessage, /Codex companion broker/);
  assert.ok(alive(orphaned), 'report mode lists it and leaves it');

  const turn = hook('stop', { session_id: sid, transcript_path: transcript, hook_event_name: 'Stop' });
  assert.equal(turn.status, 0, turn.stderr);
  assert.match(JSON.parse(turn.stdout).systemMessage, /Stopped 1 helper/);
  assert.ok(await until(() => !alive(orphaned)), 'the helper of a deleted folder is stopped');
  assert.ok(alive(kept), 'a helper whose folder still exists is left for session end');
});

test('processes lists and, on request, stops the helpers of a named session', async (t) => {
  const { root, start, cli } = await decoys(t);
  const sid = `mw-test-${randomUUID()}`;
  const gone = path.join(root, 'removed-lane'); mkdirSync(gone);
  const pid = start(sid, gone);
  assert.ok(await until(() => childrenOf(pid).length));
  rmSync(gone, { recursive: true });

  const listed = cli('processes', '--session', sid, '--json');
  assert.equal(listed.status, 0, listed.stderr);
  const report = JSON.parse(listed.stdout);
  assert.deepEqual(report.helpers.map((h) => [h.pid, h.folderGone]), [[pid, true]]);
  assert.equal(typeof report.memory.ok, 'boolean');

  const preview = cli('processes', '--session', sid, '--stop-helpers');
  assert.match(preview.stdout, /would stop/);
  assert.ok(alive(pid), 'a preview stops nothing');
  const applied = cli('processes', '--session', sid, '--stop-helpers', '--yes');
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /stopped/);
  assert.ok(await until(() => !alive(pid)));
});

test('memory is a preflight: JSON on stdout, exit 1 when it refuses', async () => {
  const root = await tempDir('mw-memory-');
  const run = (reading, ...args) => {
    const f = path.join(root, `${randomUUID()}.json`); writeFileSync(f, JSON.stringify({ memory: reading }));
    return spawnSync(process.execPath, [leftovers, 'memory', ...args], { encoding: 'utf8', env: { ...process.env, MWS_MACHINE_FIXTURE: f } });
  };
  const refused = run(swapFull, '--need-mib', '6144');
  assert.equal(refused.status, 1);
  const out = JSON.parse(refused.stdout);
  assert.equal(out.ok, false);
  assert.match(out.reasons.join(' '), /swap/);
  assert.equal(run(healthy, '--need-mib', '6144').status, 0);
  assert.equal(run(healthy, '--need-mib', 'lots').status, 2, 'a bad number is a usage error');
});

test('session start adds a machine check when helpers of ended sessions, parentless agents or low memory are found', async () => {
  const root = await tempDir('mw-start-');
  const home = path.join(root, 'home'); mkdirSync(path.join(home, '.claude', 'sessions'), { recursive: true });
  writeFileSync(path.join(home, '.claude', 'sessions', '200.json'), JSON.stringify({ pid: 200, sessionId: 'abc', name: 'old window', cwd: '/work/x' }));
  const fixture = path.join(root, 'f.json');
  const write = (memory) => writeFileSync(fixture, JSON.stringify({
    memory,
    ps: [psLine(1, 0, '1-00:00:00', 1, 'launchd'), psLine(100, 1, '3-00:00:00', 2000000, 'node /p/app-server-broker.mjs serve --cwd /work/gone'), psLine(200, 1, '12:00', 400000, '/ext/claude --output-format stream-json')].join('\n'),
    env: { 100: { CODEX_COMPANION_SESSION_ID: 'ended' } },
  }));
  const env = { ...process.env, HOME: home, MWS_STATE_DIR: path.join(home, 'state'), MWS_CONFIG_DIR: path.join(home, 'config'), MWS_MACHINE_FIXTURE: fixture };
  delete env.CLAUDE_CONFIG_DIR; delete env.MWS_CLEANUP_MODE;
  const start = () => JSON.parse(spawnSync(process.execPath, [leftovers, 'session-start'], { input: JSON.stringify({ session_id: 'new' }), encoding: 'utf8', env }).stdout).hookSpecificOutput.additionalContext;

  write(swapFull);
  const started = Date.now();
  const context = start();
  assert.ok(Date.now() - started < 2000, 'the machine check stays well under two seconds');
  assert.match(context, /Machine check/);
  assert.match(context, /pid 100/);
  assert.match(context, /pid 200/);
  assert.match(context, /swap/);
  assert.match(context, /Tell the user/);
  assert.match(context, /never stop another live session/i);

  write(healthy);
  writeFileSync(fixture, JSON.stringify({ memory: healthy, ps: psLine(1, 0, '1-00:00:00', 1, 'launchd'), env: {} }));
  assert.doesNotMatch(start(), /Machine check/, 'nothing found, nothing added');
});
