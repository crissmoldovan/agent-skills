import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
  assert.equal(machine.memoryVerdict({ ...healthy, ramMiB: 4000, freePct: 44.99 }, { needMiB: 1000 }).ok, false, '999.6 MiB above the floor is not 1000');
  assert.equal(machine.memoryVerdict({ ...healthy, ramMiB: 4003, swapUsedMiB: 1000.9 }).ok, false, 'over a quarter of 4003 MiB, unrounded');
  const unread = machine.memoryVerdict(null);
  assert.equal(unread.ok, false, 'a reading that could not be taken is not a pass');
  assert.equal(unread.unknown, true);
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
  const scan = machine.scanProcesses({ ps, envs: env, sessions, exists: (p) => p !== '/work/lane-gone' });

  assert.deepEqual(scan.helpers.map((h) => [h.pid, h.session, h.folderGone, h.sessionLive]), [[100, 'ended', true, false], [110, 'live', false, true], [120, 'live', false, true]]);
  assert.deepEqual(scan.helpers[0].tree, [100, 101, 102], 'a helper carries its whole tree');
  assert.equal(scan.helpers[0].rssKiB, 390000);
  assert.deepEqual(scan.agents.map((a) => [a.pid, a.session]), [[200, 'twice']], 'only a parentless agent CLI, and not the browser bridge');
  assert.deepEqual(scan.duplicates.map((d) => [d.session, d.pids]), [['twice', [200, 201]]]);
  assert.equal(scan.vms.length, 1);
  assert.deepEqual(machine.stoppable(scan).map((h) => h.pid), [100], 'only a helper whose session ended or whose folder is gone');
  assert.deepEqual(machine.stoppable(scan, { session: 'live' }).map((h) => h.pid), [], 'a live session\'s helper in an existing folder stays');

  const unknown = machine.scanProcesses({ ps, envs: env, sessions: null, exists: () => true });
  assert.equal(unknown.helpers[0].sessionLive, null, 'without the session registry, liveness is unknown');
  assert.deepEqual(machine.stoppable(unknown).map((h) => h.pid), [], 'and unknown never counts as ended');

  // a Claude Code process missing from the session files (another config folder, a headless run) makes absence unknown
  const partial = machine.scanProcesses({ ps: `${ps}\n${psLine(500, 77, '01:00', 1000, '/usr/local/bin/claude -p hello')}`, envs: env, sessions, exists: () => true });
  assert.equal(partial.helpers[0].sessionLive, null);
  assert.deepEqual(machine.stoppable(partial).map((h) => h.pid), []);
});

test('a helper is matched by its exact command shape, with spaces in paths, and never through a wrapper', () => {
  const ps = [
    psLine(1, 0, '1-00:00:00', 1, 'launchd'),
    psLine(10, 1, '1:00', 1, '/opt/tool chain/node/v24/bin/node /srv/plugin cache/codex/scripts/app-server-broker.mjs serve --endpoint unix:/t/x.sock --cwd /work/Project One --pid-file /t/x.pid'),
    psLine(11, 1, '1:00', 1, '/bin/sh -c node /p/app-server-broker.mjs serve --endpoint unix:/t/y.sock --cwd /work/y --pid-file /t/y.pid; other-worker'),
    psLine(12, 1, '1:00', 1, 'grep app-server-broker.mjs serve --endpoint'),
  ].join('\n');
  const scan = machine.scanProcesses({ ps, envs: { 10: { CODEX_COMPANION_SESSION_ID: 's' }, 11: { CODEX_COMPANION_SESSION_ID: 's' } }, sessions: [], exists: (p) => p === '/work/Project One' });
  assert.deepEqual(scan.helpers.map((h) => [h.pid, h.folder, h.folderGone]), [[10, '/work/Project One', false]], 'the whole folder, so an existing one is not taken for deleted');
  assert.equal(machine.folderState(path.join(fileURLToPath(new URL('.', import.meta.url)), 'no-such-folder')), 'gone');
});

test('on macOS the environment is read only after the arguments ps printed', () => {
  const args = 'node /p/app-server-broker.mjs serve --endpoint unix:/t/CODEX_COMPANION_SESSION_ID=fake.sock --cwd /w --pid-file /t/p';
  assert.deepEqual(machine.envFromPsE(`${args} HOME=/h CODEX_COMPANION_SESSION_ID=real PATH=/bin`, args), { CODEX_COMPANION_SESSION_ID: 'real' });
  assert.deepEqual(machine.envFromPsE('something else entirely CODEX_COMPANION_SESSION_ID=x', args), {}, 'a line that does not start with the arguments gives nothing');
});

test('a fixture that speaks for processes never lets anything be signalled', async () => {
  const root = await tempDir('mw-fixture-');
  const probe = (fixture) => {
    const f = path.join(root, `${randomUUID()}.json`); writeFileSync(f, JSON.stringify(fixture));
    return spawnSync(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(path.join(dir, 'machine.mjs'))}); console.log(m.usingFixture());`], { encoding: 'utf8', env: { ...process.env, MWS_MACHINE_FIXTURE: f } }).stdout.trim();
  };
  assert.equal(probe({ memory: healthy }), 'false', 'a memory reading alone is safe');
  for (const key of ['ps', 'env', 'sessions']) assert.equal(probe({ [key]: key === 'ps' ? '' : key === 'env' ? {} : [] }), 'true', key);
});

// ---- real processes: a decoy broker, scoped by a session id nobody else uses ---------------------

async function decoys(t) {
  const root = await tempDir('mw-machine-');
  const plugin = path.join(root, 'plugin', 'scripts');
  mkdirSync(plugin, { recursive: true });
  const broker = path.join(plugin, 'app-server-broker.mjs');
  // A decoy that speaks the plugin's protocol: busy reply on request, broker/shutdown stops its child and exits.
  writeFileSync(broker, [
    "import { spawn } from 'node:child_process'; import net from 'node:net'; import fs from 'node:fs';",
    "const a = process.argv;",
    "if (a.includes('--child')) { setInterval(() => {}, 1000); } else {",
    "  const child = spawn(process.execPath, [a[1], '--child'], { stdio: 'ignore' });",
    "  const sock = a[a.indexOf('--endpoint') + 1].slice('unix:'.length);",
    "  if (!process.env.DECOY_NO_SOCKET) {",
    "    const server = net.createServer((s) => { s.setEncoding('utf8'); let b = ''; s.on('data', (c) => { b += c; for (let i = b.indexOf('\\n'); i !== -1; i = b.indexOf('\\n')) { const m = JSON.parse(b.slice(0, i)); b = b.slice(i + 1);",
    "      if (m.method === 'broker/shutdown') { s.write(JSON.stringify({ id: m.id, result: {} }) + '\\n'); child.kill(); server.close(); try { fs.unlinkSync(sock); } catch {} setTimeout(() => process.exit(0), 20); }",
    "      else if (process.env.DECOY_NULL) s.write('null\\n');",
    "      else s.write(JSON.stringify({ id: m.id, error: process.env.DECOY_BUSY ? { code: -32001, message: 'Shared Codex broker is busy.' } : { code: -32601, message: 'Method not found' } }) + '\\n'); } }); });",
    "    server.listen(sock);",
    "  }",
    "  setInterval(() => {}, 1000);",
    "}",
  ].join('\n'));
  const started = []; let n = 0;
  const start = (session, folder, extra = {}) => {
    n += 1; const sock = path.join(root, `s${n}.sock`);
    const child = spawn(process.execPath, [broker, 'serve', '--endpoint', `unix:${sock}`, '--cwd', folder, '--pid-file', path.join(root, 'x.pid')], {
      env: { ...process.env, CODEX_COMPANION_SESSION_ID: session, ...extra }, detached: true, stdio: 'ignore',
    });
    child.unref(); started.push(child.pid); child.sock = sock; return child.pid;
  };
  t.after(() => { for (const pid of started) { for (const c of childrenOf(pid)) try { process.kill(c, 'SIGKILL'); } catch { /* gone */ } try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } });
  const home = path.join(root, 'home');
  // an empty Claude Code session folder, as on a machine running Claude Code with no other session here
  mkdirSync(path.join(home, '.claude', 'sessions'), { recursive: true });
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
  await until(() => existsSync(path.join(root, 's1.sock')) && existsSync(path.join(root, 's2.sock')));

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
  assert.ok(await until(() => childrenOf(kept).length && childrenOf(orphaned).length && existsSync(path.join(root, 's2.sock'))));
  rmSync(lane, { recursive: true });
  const transcript = path.join(root, 't.jsonl'); writeFileSync(transcript, '');

  const reported = hook('stop', { session_id: sid, transcript_path: transcript, hook_event_name: 'Stop' }, { MWS_HELPERS: 'report' });
  assert.match(JSON.parse(reported.stdout).systemMessage, /Codex companion broker/);
  assert.ok(alive(orphaned), 'report mode lists it and leaves it');

  const turn = hook('stop', { session_id: sid, transcript_path: transcript, hook_event_name: 'Stop' });
  assert.equal(turn.status, 0, turn.stderr);
  assert.match(JSON.parse(turn.stdout).systemMessage, /Asked 1 helper .* to shut down/);
  assert.ok(await until(() => !alive(orphaned)), 'the helper of a deleted folder is stopped');
  assert.ok(alive(kept), 'a helper whose folder still exists is left for session end');
});

test('processes lists and, on request, stops the helpers of a named session', async (t) => {
  const { root, start, cli } = await decoys(t);
  const sid = `mw-test-${randomUUID()}`;
  const gone = path.join(root, 'removed-lane'); mkdirSync(gone);
  const pid = start(sid, gone);
  assert.ok(await until(() => childrenOf(pid).length && existsSync(path.join(root, 's1.sock'))));
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
  assert.equal(run('unreadable').status, 1, 'an unreadable machine refuses');
  const bare = spawnSync(process.execPath, [leftovers, 'processes', '--session', '--stop-helpers', '--yes'], { encoding: 'utf8', env: { ...process.env, MWS_MACHINE_FIXTURE: path.join(root, 'none.json') } });
  assert.equal(bare.status, 2, 'a --session with no id is a usage error, never machine-wide');
});

test('session end leaves a helper whose folder another live session works in', async (t) => {
  const { root, start, hook } = await decoys(t);
  const sid = `mw-test-${randomUUID()}`;
  const shared = path.join(root, 'shared-lane'); mkdirSync(shared);
  const pid = start(sid, shared);
  assert.ok(await until(() => childrenOf(pid).length));
  const home = path.join(root, 'home');
  writeFileSync(path.join(home, '.claude', 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'other-live', cwd: shared }));
  assert.equal(hook('session-end', { session_id: sid }).status, 0);
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(alive(pid), 'another live session works in that folder, so it may be reusing the broker');
  rmSync(path.join(home, '.claude', 'sessions', `${process.pid}.json`));
  hook('session-end', { session_id: sid });
  assert.ok(await until(() => !alive(pid)), 'once no one else works there, session end stops it');
});

test('session start adds a machine check when helpers of ended sessions, parentless agents or low memory are found', async () => {
  const root = await tempDir('mw-start-');
  const home = path.join(root, 'home'); mkdirSync(path.join(home, '.claude', 'sessions'), { recursive: true });
  writeFileSync(path.join(home, '.claude', 'sessions', '200.json'), JSON.stringify({ pid: 200, sessionId: 'abc', name: 'old window', cwd: '/work/x' }));
  const fixture = path.join(root, 'f.json');
  const write = (memory) => writeFileSync(fixture, JSON.stringify({
    memory,
    ps: [psLine(1, 0, '1-00:00:00', 1, 'launchd'), psLine(100, 1, '3-00:00:00', 2000000, 'node /p/app-server-broker.mjs serve --endpoint unix:/t/a.sock --cwd /work/gone --pid-file /t/a.pid'), psLine(200, 1, '12:00', 400000, '/ext/claude --output-format stream-json')].join('\n'),
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

test('round three: a wrapper with a dash, a doubled marker, a symlinked folder and a stale session file are all read safely', async () => {
  const wrapper = psLine(20, 1, '1:00', 1, '/bin/sh -c /opt/bin/node /p/app-server-broker.mjs serve --endpoint unix:/t/z.sock --cwd /work/z --pid-file /t/z.pid');
  assert.equal(machine.scanProcesses({ ps: wrapper, envs: { 20: { CODEX_COMPANION_SESSION_ID: 's' } }, sessions: [], exists: () => true }).helpers.length, 0, 'a shell line is never a node path');

  const args = 'node /p/app-server-broker.mjs serve --endpoint unix:/t/a --cwd /w --pid-file /t/p';
  assert.deepEqual(machine.envFromPsE(`${args} LABEL=x CODEX_COMPANION_SESSION_ID=alpha CODEX_COMPANION_SESSION_ID=beta`, args), {}, 'two values: ambiguous, so unknown');
  assert.deepEqual(machine.envFromPsE(`${args} CODEX_COMPANION_SESSION_ID=beta A=1`, args), { CODEX_COMPANION_SESSION_ID: 'beta' });

  const root = await tempDir('mw-round3-');
  const real = path.join(root, 'real'); mkdirSync(real); const link = path.join(root, 'link'); symlinkSync(real, link);
  writeFileSync(path.join(root, 'file'), 'x');
  assert.equal(machine.folderState(link), 'present', 'a symlink to a folder is followed');
  assert.equal(machine.folderState(path.join(root, 'file')), 'unknown', 'a file is not a deleted folder');
  assert.equal(machine.folderState(path.join(root, 'nope')), 'gone');

  const ps = [psLine(1, 0, '1-00:00:00', 1, 'launchd'), psLine(200, 1, '10:00', 1, '/ext/claude --output-format stream-json'),
    psLine(100, 1, '1:00', 1, 'node /p/app-server-broker.mjs serve --endpoint unix:/t/a --cwd /w --pid-file /t/p')].join('\n');
  const stale = [{ pid: 200, sessionId: 'old', startedAt: Date.now() - 5 * 86400 * 1000 }];
  const scan = machine.scanProcesses({ ps, envs: { 100: { CODEX_COMPANION_SESSION_ID: 'ended' } }, sessions: stale, exists: () => true });
  assert.equal(scan.helpers[0].sessionLive, null, 'a stale session file does not make the registry complete');
  assert.equal(scan.duplicates.length, 0);
});

test('round three: an unreadable or malformed memory reading refuses, and an empty session id is a usage error', async () => {
  const root = await tempDir('mw-round3m-');
  const f = path.join(root, 'true.json'); writeFileSync(f, JSON.stringify({ memory: true }));
  assert.equal(spawnSync(process.execPath, [leftovers, 'memory'], { encoding: 'utf8', env: { ...process.env, MWS_MACHINE_FIXTURE: f } }).status, 1);
  assert.equal(spawnSync(process.execPath, [leftovers, 'processes', '--session', '', '--json'], { encoding: 'utf8', env: { ...process.env, MWS_MACHINE_FIXTURE: f } }).status, 2);
});

test('session end leaves a broker in a workspace another live session works in, even from another subfolder', async (t) => {
  const { root, start, hook } = await decoys(t);
  const repo = path.join(root, 'repo'); mkdirSync(path.join(repo, 'one'), { recursive: true }); mkdirSync(path.join(repo, 'two')); mkdirSync(path.join(repo, '.git'));
  const sid = `mw-test-${randomUUID()}`;
  const pid = start(sid, path.join(repo, 'one'));
  assert.ok(await until(() => childrenOf(pid).length));
  const home = path.join(root, 'home');
  writeFileSync(path.join(home, '.claude', 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'other-live', cwd: path.join(repo, 'two') }));
  assert.equal(hook('session-end', { session_id: sid }).status, 0);
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(alive(pid), 'same workspace root, so it may be reused');
  rmSync(path.join(home, '.claude', 'sessions'), { recursive: true });
  hook('session-end', { session_id: sid });
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(alive(pid), 'without the session files sharing cannot be ruled out, so an existing folder\'s broker stays');
});

test('no signal is sent: a busy helper and one without a socket are left running, with a kill hint', async (t) => {
  const { root, start, hook } = await decoys(t);
  const sid = `mw-test-${randomUUID()}`;
  const lane = path.join(root, 'lane-busy'); mkdirSync(lane);
  const busy = start(sid, lane, { DECOY_BUSY: '1' });
  const mute = start(sid, lane, { DECOY_NO_SOCKET: '1' });
  assert.ok(await until(() => childrenOf(busy).length && childrenOf(mute).length && existsSync(path.join(root, 's1.sock'))));
  rmSync(lane, { recursive: true });
  const transcript = path.join(root, 'b.jsonl'); writeFileSync(transcript, '');
  const out = hook('stop', { session_id: sid, transcript_path: transcript, hook_event_name: 'Stop' });
  assert.equal(out.status, 0, out.stderr);
  const message = JSON.parse(out.stdout).systemMessage;
  assert.match(message, new RegExp(`Left helper pid ${busy} running: it is busy`));
  assert.match(message, new RegExp(`Left helper pid ${mute} running: it has no socket.*kill ${mute}`));
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(alive(busy) && alive(mute), 'neither was signalled');
  assert.equal(hook('stop', { session_id: sid, transcript_path: transcript, hook_event_name: 'Stop' }).stdout, '', 'said once');
  assert.equal(hook('session-end', { session_id: sid }).status, 0);
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(alive(busy) && alive(mute), 'session end does not signal them either');
});

test('the end-of-turn check leaves a deleted subfolder\'s broker that another live session uses from the repository', async (t) => {
  const { root, start, hook } = await decoys(t);
  const repo = path.join(root, 'repo2'); const sub = path.join(repo, 'tmp-sub'); mkdirSync(sub, { recursive: true }); mkdirSync(path.join(repo, '.git'));
  const sid = `mw-test-${randomUUID()}`;
  const pid = start(sid, sub);
  assert.ok(await until(() => childrenOf(pid).length && existsSync(path.join(root, 's1.sock'))));
  rmSync(sub, { recursive: true });
  writeFileSync(path.join(root, 'home', '.claude', 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'other-live', cwd: repo }));
  const transcript = path.join(root, 'r.jsonl'); writeFileSync(transcript, '');
  assert.equal(hook('stop', { session_id: sid, transcript_path: transcript, hook_event_name: 'Stop' }).status, 0);
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(alive(pid), 'the repository is still another live session\'s workspace');
  assert.equal(hook('session-end', { session_id: sid }).status, 0);
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(alive(pid), 'and session end applies the same guard to the deleted folder');
});

test('a broker that answers with something other than a JSON object does not fail the hook', async (t) => {
  const { root, start, hook } = await decoys(t);
  const sid = `mw-test-${randomUUID()}`;
  const lane = path.join(root, 'lane-null'); mkdirSync(lane);
  const pid = start(sid, lane, { DECOY_NULL: '1' });
  assert.ok(await until(() => childrenOf(pid).length && existsSync(path.join(root, 's1.sock'))));
  rmSync(lane, { recursive: true });
  const transcript = path.join(root, 'n.jsonl'); writeFileSync(transcript, '');
  const out = hook('stop', { session_id: sid, transcript_path: transcript, hook_event_name: 'Stop' });
  assert.equal(out.status, 0, out.stderr);
  assert.match(JSON.parse(out.stdout).systemMessage, /did not answer on its socket/);
  assert.ok(alive(pid));
});
