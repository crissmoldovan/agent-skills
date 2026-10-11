import assert from 'node:assert/strict';
import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';

import { availableAt, covered, evaluate, foldDetection, pickDue } from '../skills/resume-after-limit/scripts/decide.mjs';
import { inboxLines, postToInbox, readPeerToken, resumeEnv, resumeInBackground } from '../skills/resume-after-limit/scripts/deliver.mjs';
import { accountFile, classifyEntry, currentAccount, findLimited, lastMainEntry, liveSessions, sessionProgress } from '../skills/resume-after-limit/scripts/detect.mjs';
import { LABEL, MARKER, cronLine, editCrontab, install, launchdPlist, systemdUnits } from '../skills/resume-after-limit/scripts/install-scheduler.mjs';
import { keychainService, probeUsage, windowOpen } from '../skills/resume-after-limit/scripts/quota.mjs';
import { main, renderStatus, statusData, tick } from '../skills/resume-after-limit/scripts/resume.mjs';
import { acquireLock, defaultConfig, loadConfig, loadRecords, paths, saveConfig, saveRecord } from '../skills/resume-after-limit/scripts/state.mjs';
import { tempDir } from './helpers/temp-dir.mjs';

/**
 * The fixtures are synthetic, built here in code. The limit entry copies the shape OBSERVED on
 * Claude Code 2.1.281 to 2.1.295 (skills/resume-after-limit/references/evidence.md) with every id,
 * path and time invented.
 */
const SID = '11111111-2222-4333-8444-555555555555';
const SID2 = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const SID3 = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;
const T0 = Date.parse('2026-10-10T10:00:00.000Z');

function limitEntry({ at = T0, resetsAt = T0 + 4 * HOUR, type = 'five_hour', uuid = 'limit-1', sidechain = false } = {}) {
  return {
    parentUuid: 'p', isSidechain: sidechain, type: 'assistant', uuid, timestamp: new Date(at).toISOString(),
    message: { model: '<synthetic>', role: 'assistant', stop_reason: 'stop_sequence', content: [{ type: 'text', text: "You've hit your session limit · resets 2pm (UTC)" }] },
    apiErrorParams: { rate_limit_info: { status: 'rejected', resetsAt: resetsAt / 1000, rateLimitType: type } },
    quotaLimits: { status: 'rejected', resetsAt: resetsAt / 1000, unifiedRateLimitFallbackAvailable: false, rateLimitType: type, overageStatus: 'rejected', overageDisabledReason: 'org_level_disabled', isUsingOverage: false },
    error: 'rate_limit', isApiErrorMessage: true, apiErrorStatus: 429, entrypoint: 'claude-vscode', cwd: '/srv/example/repo', sessionId: SID, version: '2.1.294',
  };
}

function userEntry(text, at, extra = {}) {
  return { type: 'user', uuid: `u-${at}`, timestamp: new Date(at).toISOString(), isSidechain: false, message: { role: 'user', content: text }, ...extra };
}

const jsonl = (...entries) => `${entries.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n')}\n`;

async function configDirWith(transcripts) {
  const dir = await tempDir('ral-config-');
  const project = path.join(dir, 'projects', '-srv-example-repo');
  await mkdir(path.join(project, SID, 'subagents'), { recursive: true });
  for (const [sessionId, text, mtime] of transcripts) {
    const file = path.join(project, `${sessionId}.jsonl`);
    await writeFile(file, text);
    if (mtime) await utimes(file, mtime / 1000, mtime / 1000);
  }
  return dir;
}

// ---------------------------------------------------------------------------------------------
// Detection

test('a rejected quotaLimits entry is a limit; a server throttle with the same error is not', () => {
  assert.deepEqual(classifyEntry(limitEntry()), { kind: 'limit', resetsAt: T0 + 4 * HOUR, rateLimitType: 'five_hour' });
  const throttle = { type: 'assistant', isApiErrorMessage: true, error: 'rate_limit', apiErrorStatus: 429, message: { content: [{ type: 'text', text: 'API Error: Server is temporarily limiting requests (not your usage limit)' }] } };
  assert.deepEqual(classifyEntry(throttle), { kind: 'none' });
  const allowed = limitEntry();
  allowed.quotaLimits.status = 'allowed';
  delete allowed.apiErrorParams;
  assert.notEqual(classifyEntry(allowed).kind, 'limit');
});

test('the older epoch format is a limit, and limit wording without a reset time is unparsed', () => {
  const old = { type: 'assistant', isApiErrorMessage: true, message: { content: [{ type: 'text', text: 'Claude AI usage limit reached|1753484400' }] } };
  assert.deepEqual(classifyEntry(old), { kind: 'limit', resetsAt: 1753484400000, rateLimitType: 'unknown' });
  const words = { type: 'assistant', isApiErrorMessage: true, message: { content: [{ type: 'text', text: "You've hit your limit · resets 3pm (UTC)" }] } };
  assert.deepEqual(classifyEntry(words), { kind: 'unparsed' });
  assert.equal(classifyEntry({ ...limitEntry(), isApiErrorMessage: false }).kind, 'none');
});

test('the last main-chain entry skips subagents, other record types and broken lines', () => {
  const text = jsonl(userEntry('go', T0 - HOUR), limitEntry(), { type: 'system', subtype: 'x' }, userEntry('sub', T0 + MIN, { isSidechain: true }), '{not json');
  assert.equal(lastMainEntry(text).uuid, 'limit-1');
});

test('findLimited finds a stopped session, and not one that moved on, a subagent, or an old one', async () => {
  const dir = await configDirWith([
    [SID, jsonl(userEntry('work', T0 - HOUR), limitEntry())],
    [SID2, jsonl(limitEntry({ uuid: 'other' }), userEntry('continue', T0 + 5 * HOUR))],
    [SID3, jsonl(limitEntry({ uuid: 'old' })), T0 - 48 * HOUR],
  ]);
  await writeFile(path.join(dir, 'projects', '-srv-example-repo', SID, 'subagents', 'agent-a1.jsonl'), jsonl(limitEntry({ sidechain: true })));
  const found = await findLimited(dir, T0 - 24 * HOUR);
  assert.deepEqual(found.map((f) => f.sessionId), [SID]);
  assert.equal(found[0].resetsAt, T0 + 4 * HOUR);
  assert.equal(found[0].hitAt, T0);
  assert.equal(found[0].cwd, '/srv/example/repo');
});

test('sessionProgress tells a quiet session, an active one and a new limit apart', async () => {
  const dir = await configDirWith([[SID, jsonl(limitEntry())]]);
  const file = path.join(dir, 'projects', '-srv-example-repo', `${SID}.jsonl`);
  assert.equal((await sessionProgress(file, T0, 'limit-1')).state, 'quiet');
  await writeFile(file, jsonl(limitEntry(), userEntry('continue', T0 + 5 * HOUR)));
  assert.equal((await sessionProgress(file, T0 + 4 * HOUR, 'limit-1')).state, 'active');
  await writeFile(file, jsonl(limitEntry(), limitEntry({ uuid: 'limit-2', at: T0 + 5 * HOUR })));
  assert.equal((await sessionProgress(file, T0 + 4 * HOUR, 'limit-1')).state, 'limit');
  assert.equal((await sessionProgress(path.join(dir, 'gone.jsonl'), T0, null)).state, 'missing');
});

test('the account is read from the config directory, and the default directory keeps it beside itself', async () => {
  const home = await tempDir('ral-home-');
  await mkdir(path.join(home, '.claude'), { recursive: true });
  assert.equal(accountFile(path.join(home, '.claude'), home), path.join(home, '.claude.json'));
  assert.equal(accountFile(path.join(home, 'work-claude'), home), path.join(home, 'work-claude', '.claude.json'));
  await writeFile(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: 'acct-a' } }));
  assert.equal(await currentAccount(path.join(home, '.claude'), home), 'acct-a');
  assert.equal(await currentAccount(path.join(home, 'nowhere'), home), null);
});

test('live sessions skip a dead pid and a reused one, and carry the socket and key paths', async () => {
  const dir = await tempDir('ral-sessions-');
  await mkdir(path.join(dir, 'sessions'));
  const key = `${'a'.repeat(64)}`;
  await writeFile(path.join(dir, 'sessions', '101.json'), JSON.stringify({ pid: 101, sessionId: SID, status: 'idle', messagingSocketPath: '/tmp/x.sock', procStart: '500' }));
  await writeFile(path.join(dir, 'sessions', `101.${key}.key`), '{}');
  await writeFile(path.join(dir, 'sessions', '102.json'), JSON.stringify({ pid: 102, sessionId: SID2, procStart: '500' }));
  await writeFile(path.join(dir, 'sessions', '103.json'), JSON.stringify({ pid: 103, sessionId: SID3, procStart: '500' }));
  const live = await liveSessions(dir, { alive: (pid) => pid !== 102, procStartOf: async (pid) => (pid === 103 ? '999' : '500') });
  assert.deepEqual(live.map((s) => s.sessionId), [SID]);
  assert.equal(live[0].socketPath, '/tmp/x.sock');
  assert.equal(live[0].keyPath, path.join(dir, 'sessions', `101.${key}.key`));
});

// ---------------------------------------------------------------------------------------------
// Decisions

const baseConfig = () => ({ ...defaultConfig(), mode: 'all' });
const detected = (extra = {}) => ({ sessionId: SID, configDir: '/c', transcriptPath: '/c/t.jsonl', kind: 'limit', resetsAt: T0 + 4 * HOUR, rateLimitType: 'five_hour', hitAt: T0, limitUuid: 'limit-1', cwd: '/srv/example/repo', ...extra });

test('a first limit parks; the same entry again changes nothing; a new one after delivery bounces', () => {
  const first = foldDetection(undefined, detected(), { now: T0, account: 'a', maxAttempts: 2 });
  assert.equal(first.record.state, 'parked');
  assert.equal(first.record.account, 'a');
  assert.equal(foldDetection(first.record, detected(), { now: T0 + MIN, account: 'a', maxAttempts: 2 }).changed, false);
  const delivered = { ...first.record, state: 'delivered', attempts: 1 };
  const bounce = foldDetection(delivered, detected({ limitUuid: 'limit-2', resetsAt: T0 + 9 * HOUR }), { now: T0 + 5 * HOUR, account: 'a', maxAttempts: 2 });
  assert.equal(bounce.bounced, true);
  assert.equal(bounce.record.state, 'parked');
  assert.equal(bounce.record.attempts, 1);
  const last = foldDetection({ ...delivered, attempts: 2 }, detected({ limitUuid: 'limit-3' }), { now: T0, account: 'a', maxAttempts: 2 });
  assert.equal(last.record.state, 'failed');
  assert.equal(foldDetection(undefined, detected({ kind: 'unparsed', resetsAt: null }), { now: T0, account: 'a', maxAttempts: 2 }).record.state, 'unparsed');
});

function parked(extra = {}) {
  return { ...foldDetection(undefined, detected(), { now: T0, account: 'a', maxAttempts: 2 }).record, ...extra };
}
const ctx = (extra = {}) => ({ now: T0, config: baseConfig(), isCovered: true, accountNow: 'a', probe: null, hold: null, ...extra });

test('a record waits for its reset plus a margin, then is due while the tick is on time', () => {
  assert.equal(evaluate(parked(), ctx({ now: T0 + 4 * HOUR })).state, 'parked');
  const due = evaluate(parked(), ctx({ now: T0 + 4 * HOUR + 5 * MIN }));
  assert.equal(due.state, 'due');
  assert.equal(due.availableAt, T0 + 4 * HOUR);
});

test('a tick that runs too late after the reset expires the record instead of resuming stale work', () => {
  const late = evaluate(parked(), ctx({ now: T0 + 4 * HOUR + 45 * MIN }));
  assert.equal(late.state, 'expired');
  assert.equal(late.reason, 'checked-too-late');
});

test('a weekly reset days away is outside the window and expires without resuming', () => {
  const weekly = parked({ resetsAt: T0 + 3 * 24 * HOUR, rateLimitType: 'seven_day' });
  assert.equal(evaluate(weekly, ctx({ now: T0 + HOUR })).state, 'parked');
  assert.equal(evaluate(weekly, ctx({ now: T0 + 6 * HOUR })).reason, 'dormant');
});

test('the default five-hour window admits every session-limit reset', () => {
  const edge = parked({ resetsAt: T0 + 5 * HOUR });
  assert.equal(evaluate(edge, ctx({ now: T0 + 5 * HOUR + 3 * MIN })).state, 'due');
  const config = { ...baseConfig(), maxDormancyHours: 4 };
  assert.equal(evaluate(edge, ctx({ now: T0 + 5 * HOUR + 3 * MIN, config })).state, 'expired');
  assert.equal(evaluate(edge, ctx({ now: T0 + 5 * HOUR + 3 * MIN, config: { ...config, lateGraceMinutes: 90 } })).reason, 'reset-beyond-window');
});

test('an account switch is the signal when probing is off, and needs an open window when it is on', () => {
  const weekly = parked({ resetsAt: T0 + 3 * 24 * HOUR, rateLimitType: 'seven_day' });
  const switched = evaluate(weekly, ctx({ now: T0 + HOUR, accountNow: 'b' }));
  assert.equal(switched.state, 'due');
  assert.equal(switched.accountChangeSeenAt, T0 + HOUR);
  const probing = { ...baseConfig(), probe: { enabled: true, everyMinutes: 60 } };
  assert.equal(evaluate(weekly, ctx({ now: T0 + HOUR, accountNow: 'b', config: probing, probe: { open: false, at: T0 + HOUR } })).state, 'parked');
  assert.equal(evaluate(weekly, ctx({ now: T0 + HOUR, accountNow: 'b', config: probing, probe: { open: true, at: T0 + HOUR } })).state, 'due');
});

test('an early reset seen by a probe makes a record due before its recorded reset', () => {
  const probing = { ...baseConfig(), probe: { enabled: true, everyMinutes: 60 } };
  assert.equal(evaluate(parked(), ctx({ now: T0 + 2 * HOUR, config: probing, probe: { open: true, at: T0 + 2 * HOUR } })).state, 'due');
});

test('a hold from a sibling bounce postpones availability; an uncovered record stays parked', () => {
  assert.equal(availableAt(parked(), { now: T0 + 4 * HOUR + 5 * MIN, hold: T0 + 9 * HOUR }), null);
  assert.equal(evaluate(parked(), ctx({ now: T0 + 4 * HOUR + 5 * MIN, isCovered: false })).state, 'parked');
});

test('coverage follows the mode, the watch list and the exclusions', () => {
  const sessions = { watched: [SID], excluded: [SID2] };
  assert.equal(covered(SID, 'selected', sessions), true);
  assert.equal(covered(SID3, 'selected', sessions), false);
  assert.equal(covered(SID3, 'all', sessions), true);
  assert.equal(covered(SID2, 'all', sessions), false);
  assert.equal(covered(SID, 'off', sessions), false);
});

test('due records go oldest first, a limited number per account per tick', () => {
  const records = [
    { sessionId: '1', state: 'due', hitAt: 3, account: 'a' },
    { sessionId: '2', state: 'due', hitAt: 1, account: 'a' },
    { sessionId: '3', state: 'due', hitAt: 2, account: 'a' },
    { sessionId: '4', state: 'due', hitAt: 4, account: 'b' },
    { sessionId: '5', state: 'parked', hitAt: 0, account: 'b' },
  ];
  assert.deepEqual(pickDue(records, 2).map((r) => r.sessionId), ['2', '3', '4']);
});

// ---------------------------------------------------------------------------------------------
// The tick, end to end, with the outside world replaced

async function harness({ config = {}, live = [], account = 'a', transcripts } = {}) {
  const home = await tempDir('ral-state-');
  const p = paths(home);
  const configDir = await configDirWith(transcripts ?? [[SID, jsonl(userEntry('work', T0 - HOUR), limitEntry())]]);
  await saveConfig({ ...defaultConfig(), mode: 'all', observe: false, staggerSeconds: 0, configDirs: [configDir], paths: { scheduler: 'launchd', claude: '/usr/local/bin/claude' }, ...config }, p);
  const calls = { inbox: [], background: [], notify: [] };
  let clock = T0 + 4 * HOUR + 5 * MIN;
  const deps = {
    now: () => clock,
    findLimited,
    sessionProgress,
    currentAccount: async () => account,
    liveSessions: async () => live,
    probeUsage: async () => ({ ok: false, reason: 'off' }),
    postToInbox: async (socket, payload) => { calls.inbox.push({ socket, payload }); return { ok: true }; },
    readPeerToken: async () => 'f'.repeat(32),
    resumeInBackground: async (args) => { calls.background.push(args); return { ok: true }; },
    notify: async (title, message) => { calls.notify.push(message); },
  };
  return { p, deps, calls, configDir, setNow: (ms) => { clock = ms; }, file: path.join(configDir, 'projects', '-srv-example-repo', `${SID}.jsonl`) };
}

test('observe mode logs what it would do and resumes nothing', async () => {
  const h = await harness({ config: { observe: true } });
  const summary = await tick({ p: h.p, deps: h.deps });
  assert.equal(summary.observed, 1);
  assert.equal(h.calls.background.length + h.calls.inbox.length, 0);
  const [record] = await loadRecords(h.p);
  assert.equal(record.state, 'observed');
  assert.equal(record.reason, 'would-resume-via-background');
  assert.match(await readFile(h.p.events, 'utf8'), /"event":"would-resume"/);
});

test('an exited session is resumed in the background, in its own directory, with no permission flag', async () => {
  const h = await harness();
  const summary = await tick({ p: h.p, deps: h.deps });
  assert.equal(summary.delivered, 1);
  assert.deepEqual(h.calls.background, [{ claudePath: '/usr/local/bin/claude', sessionId: SID, prompt: defaultConfig().prompt, cwd: '/srv/example/repo', configDir: h.configDir }]);
  const [record] = await loadRecords(h.p);
  assert.equal(record.state, 'delivered');
  assert.equal(record.attempts, 1);
  // The next tick sees the session working and calls it confirmed.
  await writeFile(h.file, jsonl(limitEntry(), userEntry(defaultConfig().prompt, T0 + 4 * HOUR + 6 * MIN)));
  h.setNow(T0 + 4 * HOUR + 16 * MIN);
  assert.equal((await tick({ p: h.p, deps: h.deps })).confirmed, 1);
});

test('a live idle session gets the prompt on its inbox, authenticated with its peer token', async () => {
  const h = await harness({ live: [{ sessionId: SID, status: 'idle', socketPath: '/tmp/s.sock', keyPath: '/tmp/k.key' }] });
  await tick({ p: h.p, deps: h.deps });
  assert.equal(h.calls.background.length, 0);
  assert.equal(h.calls.inbox.length, 1);
  const [auth, message] = h.calls.inbox[0].payload.trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(auth, { type: 'auth', token: 'f'.repeat(32) });
  assert.deepEqual(message, { type: 'user', message: { role: 'user', content: defaultConfig().prompt } });
});

test('a live busy session is left alone: something already resumed it', async () => {
  const h = await harness({ live: [{ sessionId: SID, status: 'busy', socketPath: '/tmp/s.sock' }] });
  const summary = await tick({ p: h.p, deps: h.deps });
  assert.equal(summary.superseded, 1);
  assert.equal(h.calls.inbox.length, 0);
});

test('a session that hits the limit again after a resume is re-parked once, then given up on', async () => {
  const h = await harness();
  await tick({ p: h.p, deps: h.deps });
  await writeFile(h.file, jsonl(limitEntry(), userEntry('continue', T0 + 4 * HOUR + 6 * MIN), limitEntry({ uuid: 'limit-2', at: T0 + 4 * HOUR + 7 * MIN, resetsAt: T0 + 4 * HOUR + 30 * MIN })));
  h.setNow(T0 + 4 * HOUR + 16 * MIN);
  const second = await tick({ p: h.p, deps: h.deps });
  assert.equal(second.bounced, 1);
  let [record] = await loadRecords(h.p);
  assert.equal(record.state, 'parked');
  h.setNow(T0 + 4 * HOUR + 35 * MIN);
  await tick({ p: h.p, deps: h.deps });
  [record] = await loadRecords(h.p);
  assert.equal(record.state, 'delivered');
  assert.equal(record.attempts, 2);
  await writeFile(h.file, jsonl(limitEntry({ uuid: 'limit-3', at: T0 + 4 * HOUR + 40 * MIN })));
  h.setNow(T0 + 4 * HOUR + 45 * MIN);
  await tick({ p: h.p, deps: h.deps });
  [record] = await loadRecords(h.p);
  assert.equal(record.state, 'failed');
  assert.equal(h.calls.background.length, 2);
});

test('a delivery a crash interrupted is never sent again', async () => {
  const h = await harness();
  await saveRecord({ ...foldDetection(undefined, { ...detected(), configDir: h.configDir, transcriptPath: h.file }, { now: T0, account: 'a', maxAttempts: 2 }).record, state: 'delivering', updatedAt: T0 + 4 * HOUR, attempts: 1 }, h.p);
  h.setNow(T0 + 4 * HOUR + 30 * MIN);
  await tick({ p: h.p, deps: h.deps });
  const [record] = await loadRecords(h.p);
  assert.equal(record.state, 'failed');
  assert.equal(record.reason, 'interrupted-delivery');
  assert.equal(h.calls.background.length, 0);
});

test('a tick does nothing when off, before its interval, or while another holds the lock', async () => {
  const off = await harness({ config: { mode: 'off' } });
  assert.deepEqual(await tick({ p: off.p, deps: off.deps }), { skipped: 'off' });
  const h = await harness({ config: { observe: true } });
  await tick({ p: h.p, deps: h.deps });
  h.setNow(T0 + 4 * HOUR + 10 * MIN);
  assert.deepEqual(await tick({ p: h.p, deps: h.deps }), { skipped: 'interval' });
  const lock = await acquireLock(h.p);
  assert.deepEqual(await tick({ p: h.p, deps: h.deps, force: true }), { skipped: 'locked' });
  await lock.release();
});

test('in selected mode an unwatched session is never resumed', async () => {
  const h = await harness({ config: { mode: 'selected' } });
  await tick({ p: h.p, deps: h.deps });
  assert.equal(h.calls.background.length, 0);
  const [record] = await loadRecords(h.p);
  assert.equal(record.state, 'parked');
});

// ---------------------------------------------------------------------------------------------
// Commands

test('on refuses while no scheduler is installed, and names the installer the user runs', async () => {
  const p = paths(await tempDir('ral-cmd-'));
  const result = await main(['on'], { p, env: {} });
  assert.equal(result.code, 1);
  assert.match(result.out, /install-scheduler\.mjs --install/);
  assert.equal((await loadConfig(p)).mode, 'off');
});

test('the commands set the mode, the watch list, the interval and the window, within bounds', async () => {
  const p = paths(await tempDir('ral-cmd-'));
  await saveConfig({ ...defaultConfig(), paths: { scheduler: 'launchd' } }, p);
  const env = { CLAUDE_CODE_SESSION_ID: SID };
  assert.equal((await main(['on', 'selected'], { p, env })).code, 0);
  assert.equal((await loadConfig(p)).mode, 'selected');
  assert.match((await main(['watch'], { p, env })).out, /covered/);
  assert.equal((await main(['interval', '7m'], { p, env })).code, 2);
  assert.equal((await main(['interval', '15m'], { p, env })).code, 0);
  assert.equal((await main(['dormancy', '30h'], { p, env })).code, 2);
  assert.equal((await main(['dormancy', '3h'], { p, env })).code, 0);
  assert.equal((await main(['observe', 'off'], { p, env })).code, 0);
  const config = await loadConfig(p);
  assert.equal(config.intervalMinutes, 15);
  assert.equal(config.maxDormancyHours, 3);
  assert.equal(config.observe, false);
  const data = await statusData({ p, env, now: T0 });
  assert.equal(data.currentSession.covered, true);
  const text = renderStatus(data);
  assert.match(text, /mode: +on, watched sessions only/);
  assert.match(text, /every 15 min · resume only within 3 h/);
  assert.match(text, /this session 11111111: covered/);
  assert.equal((await main(['off'], { p, env })).code, 0);
  assert.match(renderStatus(await statusData({ p, env, now: T0 })), /mode: +off/);
  assert.equal((await main(['watch'], { p, env: {} })).code, 2);
});

// ---------------------------------------------------------------------------------------------
// Delivery and probing

test('the inbox payload is an auth line, when a token is known, then one user message line', () => {
  assert.equal(inboxLines('go on', null), '{"type":"user","message":{"role":"user","content":"go on"}}\n');
  assert.equal(inboxLines('go on', 'abc').split('\n')[0], '{"type":"auth","token":"abc"}');
});

test('a post reaches a real unix socket byte for byte, and a missing socket is a failure, not a throw', async () => {
  const dir = await tempDir('ral-sock-');
  const socketPath = path.join(dir, 's.sock');
  let received = '';
  const server = net.createServer((socket) => socket.on('data', (d) => { received += d; }));
  await new Promise((resolve) => server.listen(socketPath, resolve));
  const payload = inboxLines('hello', 'f'.repeat(32));
  assert.deepEqual(await postToInbox(socketPath, payload), { ok: true });
  await new Promise((resolve) => server.close(resolve));
  assert.equal(received, payload);
  assert.equal((await postToInbox(path.join(dir, 'none.sock'), payload)).ok, false);
});

test('a peer token is read only in its published shape', async () => {
  const dir = await tempDir('ral-key-');
  await writeFile(path.join(dir, 'good.key'), JSON.stringify({ peerToken: 'a'.repeat(32), procStart: '1' }));
  await writeFile(path.join(dir, 'bad.key'), JSON.stringify({ peerToken: 'not-hex' }));
  assert.equal(await readPeerToken(path.join(dir, 'good.key')), 'a'.repeat(32));
  assert.equal(await readPeerToken(path.join(dir, 'bad.key')), null);
  assert.equal(await readPeerToken(null), null);
});

test('a background resume passes only --bg --resume and the prompt, and a copy is a failure', async () => {
  let seen;
  const run = (file, args, options, callback) => { seen = { file, args, cwd: options.cwd }; callback(null, 'Started in background: abc\n', ''); };
  const ok = await resumeInBackground({ claudePath: '/bin/claude', sessionId: SID, prompt: 'go', cwd: '/srv/example/repo', configDir: '/c' }, { run });
  assert.deepEqual(seen, { file: '/bin/claude', args: ['--bg', '--resume', SID, 'go'], cwd: '/srv/example/repo' });
  assert.equal(ok.ok, true);
  const copy = await resumeInBackground({ claudePath: '/bin/claude', sessionId: SID, prompt: 'go', cwd: '/', configDir: '/c' }, { run: (f, a, o, cb) => cb(null, 'Session is already running; started a copy as def\n', '') });
  assert.deepEqual([copy.ok, copy.reason], [false, 'started-a-copy']);
  assert.equal(resumeEnv('/elsewhere', {}, '/srv/u').CLAUDE_CONFIG_DIR, '/elsewhere');
  assert.equal(resumeEnv('/srv/u/.claude', { CLAUDE_CONFIG_DIR: '/x' }, '/srv/u').CLAUDE_CONFIG_DIR, undefined);
});

test('the probe says who it is, never sends Claude Code\'s name, and a 429 just skips', async () => {
  let headers;
  const fetchImpl = async (url, init) => {
    headers = init.headers;
    return { status: 200, json: async () => ({ five_hour: { utilization: 40, resets_at: '2026-10-10T15:00:00+00:00' }, seven_day: { utilization: 100, resets_at: '2026-10-15T14:00:00+00:00' }, seven_day_opus: null }) };
  };
  const token = async () => ({ accessToken: 'example-token', expiresAt: T0 + HOUR });
  const probe = await probeUsage('/c', { fetchImpl, now: T0, readTokenImpl: token });
  assert.equal(probe.ok, true);
  assert.equal(windowOpen(probe, 'five_hour'), true);
  assert.equal(windowOpen(probe, 'seven_day'), false);
  assert.equal(windowOpen(probe, 'seven_day_opus'), null);
  assert.match(headers['user-agent'], /^agent-skills-resume-after-limit\//);
  assert.doesNotMatch(headers['user-agent'], /claude-code/i);
  const limited = await probeUsage('/c', { fetchImpl: async () => ({ status: 429 }), now: T0, readTokenImpl: token });
  assert.deepEqual(limited, { ok: false, reason: 'http-429' });
  assert.doesNotMatch(JSON.stringify(limited), /example-token/);
  assert.deepEqual(await probeUsage('/c', { fetchImpl, now: T0 + 2 * HOUR, readTokenImpl: token }), { ok: false, reason: 'token-expired' });
  assert.equal(keychainService('/srv/u/.claude', '/srv/u'), 'Claude Code-credentials');
  assert.match(keychainService('/srv/u/other', '/srv/u'), /^Claude Code-credentials-[0-9a-f]{8}$/);
});

// ---------------------------------------------------------------------------------------------
// The scheduler installer

const spec = { node: '/opt/node/bin/node', script: '/srv/u/.claude/skills/resume-after-limit/scripts/resume.mjs', claude: '/srv/u/.local/bin/claude', stateHome: '/srv/u/.claude/resume-after-limit', logFile: '/srv/u/.claude/resume-after-limit/scheduler.log' };

test('the launchd agent runs the tick every five minutes, with the paths it needs and nothing at load', () => {
  const plist = launchdPlist(spec);
  assert.match(plist, new RegExp(`<string>${LABEL}</string>`));
  assert.match(plist, /<key>StartInterval<\/key>\n  <integer>300<\/integer>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\n  <false\/>/);
  assert.match(plist, /<string>\/opt\/node\/bin\/node<\/string>\n    <string>[^<]+resume\.mjs<\/string>\n    <string>tick<\/string>/);
  assert.match(plist, /<string>\/opt\/node\/bin:\/srv\/u\/\.local\/bin:/);
});

test('the crontab line is marked, added once, and removal takes only that line', () => {
  const line = cronLine(spec);
  assert.ok(line.endsWith(MARKER));
  const before = '0 * * * * echo keep\n';
  const added = editCrontab(before, line);
  assert.equal(editCrontab(added, line), added);
  assert.equal(editCrontab(added, null), before);
  assert.match(systemdUnits(spec).timer, /OnUnitActiveSec=300\nPersistent=true/);
});

test('installing records the paths, keeps the watcher off, and states its limits; removal turns it off', async () => {
  const home = await tempDir('ral-install-');
  const p = paths(path.join(home, 'state'));
  const ran = [];
  const run = async (file, args) => { ran.push([file, ...args].join(' ')); return { stdout: '/usr/local/bin/claude\n' }; };
  const result = await install({ platform: 'darwin', home, run, p, node: '/opt/node/bin/node', script: '/x/resume.mjs' });
  assert.equal(result.code, 0);
  assert.match(result.out.join('\n'), /still OFF, and in observe mode/);
  assert.match(result.out.join('\n'), /cannot answer a\npermission prompt/);
  assert.ok(ran.some((line) => line.startsWith('launchctl bootstrap gui/')));
  const plist = await readFile(path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`), 'utf8');
  assert.match(plist, /resume\.mjs/);
  let config = await loadConfig(p);
  assert.deepEqual([config.mode, config.paths.scheduler, config.paths.claude], ['off', 'launchd', '/usr/local/bin/claude']);
  await install({ remove: true, platform: 'darwin', home, run, p });
  config = await loadConfig(p);
  assert.equal(config.paths.scheduler, undefined);
  assert.equal(config.mode, 'off');
  const dry = await install({ platform: 'darwin', home, run: async () => ({ stdout: '' }), p, dryRun: true });
  assert.match(dry.out.join('\n'), /claude was not found/);
});

// ---------------------------------------------------------------------------------------------
// What the skill and the catalogue say about it

test('the skill says what it does not own, never arms itself, and carries no real machine detail', async () => {
  const root = new URL('../', import.meta.url);
  const read = (file) => readFile(new URL(file, root), 'utf8');
  const skill = await read('skills/resume-after-limit/SKILL.md');
  const evidence = await read('skills/resume-after-limit/references/evidence.md');
  const decides = await read('skills/resume-after-limit/references/how-it-decides.md');
  const fit = JSON.parse(await read('skills/resume-after-limit/references/fit.json'));
  const readme = await read('README.md');
  const contributing = await read('CONTRIBUTING.md');
  const releases = await read('docs/releases.md');

  assert.equal(fit.kind, 'requestOnly');
  for (const sibling of ['report-progress', 'agent-lifecycle', 'handoff-prompt']) assert.match(skill, new RegExp(sibling));
  // Arming the scheduler is the user's own act (CONTRIBUTING, "Adapters and hooks").
  assert.match(skill, /Do not run it for them/);
  assert.match(skill, /\*\*off and in observe mode\*\*/);
  assert.equal(defaultConfig().mode, 'off');
  assert.equal(defaultConfig().observe, true);
  assert.equal(defaultConfig().probe.enabled, false);
  assert.equal(defaultConfig().maxDormancyHours, 5);
  assert.equal(defaultConfig().intervalMinutes, 10);
  // Observed, documented or not: each tagged, with the versions named.
  assert.match(evidence, /## The limit record — OBSERVED/);
  assert.match(evidence, /\*\*Claude Code 2\.1\.281 to 2\.1\.295\*\*/);
  assert.match(evidence, /\*\*NOT OBSERVED:\*\* a post from a detached process into a session that prompts for permissions/);
  for (const reason of ['dormant', 'reset-beyond-window', 'checked-too-late', 'already-busy', 'interrupted-delivery']) assert.match(decides, new RegExp(`\`${reason}\``));
  for (const text of [skill, evidence, decides]) {
    assert.doesNotMatch(text, /~\/work\//);
    assert.doesNotMatch(text, /\b(?:Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_]+/);
    for (const address of text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []) assert.match(address, /@example\.com$/);
  }
  // Registered everywhere a skill is.
  assert.ok(readme.includes(skill.match(/^description: "(.+)"$/m)[1]), 'README carries the exact description');
  assert.match(readme, /\[How it decides\]\(skills\/resume-after-limit\/references\/how-it-decides\.md\)/);
  assert.match(readme, /One skill carries a scheduler rather than a hook/);
  assert.match(contributing, /`resume-after-limit` owns continuing a Claude Code session/);
  assert.match(releases, /`resume-after-limit` continues a Claude Code session/);
});

// Blocks caught this on #92: removal probed `systemctl --user` again, so from a shell without the
// user bus it fell through to cron, reported success, and left the timer enabled.
test('removal on Linux takes out the systemd timer even when systemd does not answer, and our cron line only', async () => {
  const home = await tempDir('ral-linux-');
  const p = paths(path.join(home, 'state'));
  const unitDir = path.join(home, '.config', 'systemd', 'user');
  await mkdir(unitDir, { recursive: true });
  await writeFile(path.join(unitDir, `${LABEL}.service`), 'x');
  await writeFile(path.join(unitDir, `${LABEL}.timer`), 'x');
  let crontab = `0 * * * * echo keep\n${cronLine(spec)}\n`;
  const ran = [];
  const run = async (file, args) => {
    ran.push([file, ...args].join(' '));
    if (file === 'systemctl') throw new Error('Failed to connect to bus');
    if (file === 'crontab' && args[0] === '-l') return { stdout: crontab };
    if (file === 'crontab') { crontab = await readFile(args[0], 'utf8'); return { stdout: '' }; }
    return { stdout: '' };
  };
  const saved = process.env.XDG_CONFIG_HOME;
  delete process.env.XDG_CONFIG_HOME;
  try {
    await saveConfig({ ...defaultConfig(), mode: 'all', paths: { scheduler: 'systemd' } }, p);
    const result = await install({ remove: true, platform: 'linux', home, run, p });
    assert.equal(result.code, 0);
    await assert.rejects(readFile(path.join(unitDir, `${LABEL}.timer`)));
    await assert.rejects(readFile(path.join(unitDir, `${LABEL}.service`)));
    assert.ok(ran.includes(`systemctl --user disable --now ${LABEL}.timer`));
    assert.equal(crontab, '0 * * * * echo keep\n');
    const config = await loadConfig(p);
    assert.deepEqual([config.mode, config.paths.scheduler], ['off', undefined]);
    // A crontab without our line is never rewritten.
    ran.length = 0;
    await install({ remove: true, platform: 'linux', home, run, p });
    assert.ok(!ran.some((line) => /^crontab \S+crontab\.tmp$/.test(line)));
    // Installing where systemd does not answer writes the cron line, once.
    await install({ platform: 'linux', home, run, p, node: '/opt/node/bin/node', script: '/x/resume.mjs', claude: '/x/claude' });
    assert.equal(crontab.split('\n').filter((line) => line.includes(MARKER)).length, 1);
    assert.equal((await loadConfig(p)).paths.scheduler, 'cron');
  } finally {
    if (saved !== undefined) process.env.XDG_CONFIG_HOME = saved;
  }
});
