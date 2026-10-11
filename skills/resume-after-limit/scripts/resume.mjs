#!/usr/bin/env node
/**
 * resume-after-limit: a Claude Code session stopped by a usage limit continues when its quota
 * returns, unless it has been dormant too long.
 *
 *   resume.mjs status [--json]           what is on, what is waiting, what happened lately
 *   resume.mjs on [all|selected]         turn it on, for every session or only watched ones
 *   resume.mjs off                       turn it off (scheduled ticks exit at once)
 *   resume.mjs watch [session-id]        watch a session (default: this one)
 *   resume.mjs unwatch [session-id]      stop watching it; in `all` mode, exclude it
 *   resume.mjs interval <minutes>m       5 to 60, in steps of 5
 *   resume.mjs dormancy <hours>h         1 to 24
 *   resume.mjs observe on|off            observe only (log, never resume), or act
 *   resume.mjs probe on|off              the optional usage-endpoint probe
 *   resume.mjs tick [--force] [--print]  one check; what the scheduler runs
 *
 * A tick spends no model tokens. It reads transcript tails, session files and the account, and
 * acts only on what the rules in decide.mjs allow. The scheduler that runs it is installed by the
 * user with install-scheduler.mjs, never by this script.
 */
import path from 'node:path';
import process from 'node:process';

import { accountKey, covered, evaluate, foldDetection, isFinal, pickDue, stamp } from './decide.mjs';
import { notify, postToInbox, inboxLines, readPeerToken, resumeInBackground } from './deliver.mjs';
import { currentAccount, findLimited, liveSessions, sessionProgress } from './detect.mjs';
import { probeUsage, windowOpen } from './quota.mjs';
import {
  FINAL_RETENTION_MS, MODES, SESSION_ID, acquireLock, isEntrypoint, deleteRecord, loadConfig, loadRecords, loadSessions,
  logEvent, paths, readEvents, readJson, saveConfig, saveRecord, saveSessions, writeJson,
} from './state.mjs';

export const VERSION = '1.0.0';
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
/** How long a tick may spend resuming sessions before it leaves the rest for the next tick. */
export const ACT_BUDGET_MS = 4 * MINUTE;

const USAGE = `Usage: resume.mjs status [--json] | on [all|selected] | off | watch [id] | unwatch [id]
       | interval <N>m | dormancy <N>h | observe on|off | probe on|off | tick [--force] [--print]`;

const realDeps = {
  now: () => Date.now(),
  findLimited,
  sessionProgress,
  currentAccount,
  liveSessions,
  probeUsage: (configDir) => probeUsage(configDir, { version: VERSION }),
  postToInbox,
  readPeerToken,
  resumeInBackground,
  notify,
};

function short(id) {
  return String(id).slice(0, 8);
}

function clock(ms) {
  if (!ms) return '—';
  const date = new Date(ms);
  const sameDay = new Date().toDateString() === date.toDateString();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function ago(ms, now) {
  if (!ms) return 'never';
  const minutes = Math.round((now - ms) / MINUTE);
  if (minutes < 1) return 'just now';
  if (minutes < 120) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

/**
 * One check. Returns a summary; every decision is also written to events.jsonl.
 */
export async function tick({ p = paths(), deps = realDeps, force = false } = {}) {
  const now = deps.now();
  const config = await loadConfig(p);
  const last = await readJson(p.tick, {});
  if (config.mode === 'off') {
    await writeJson(p.tick, { ...last, lastSkippedAt: now, skipped: 'off' });
    return { skipped: 'off' };
  }
  if (!force && last.startedAt && now - last.startedAt < config.intervalMinutes * MINUTE - MINUTE) {
    return { skipped: 'interval' };
  }
  const lock = await acquireLock(p, now);
  if (!lock) return { skipped: 'locked' };
  const summary = { startedAt: now, detected: 0, due: 0, delivered: 0, observed: 0, confirmed: 0, failed: 0, expired: 0, superseded: 0, bounced: 0 };
  try {
    const sessions = await loadSessions(p);
    const accounts = await readJson(p.accounts, { probes: {}, holds: {} });
    accounts.probes ??= {};
    accounts.holds ??= {};
    const records = new Map((await loadRecords(p)).map((record) => [record.sessionId, record]));
    const since = now - (config.maxDormancyHours * HOUR + config.lateGraceMinutes * MINUTE + config.intervalMinutes * MINUTE);
    const accountNow = new Map();
    const limitedIds = new Set();

    for (const configDir of config.configDirs) {
      accountNow.set(configDir, await deps.currentAccount(configDir));
      for (const detected of await deps.findLimited(configDir, since)) {
        summary.detected += 1;
        limitedIds.add(detected.sessionId);
        const existing = records.get(detected.sessionId);
        const folded = foldDetection(existing, detected, { now, account: accountNow.get(configDir), maxAttempts: config.maxAttempts });
        if (!folded.changed) continue;
        records.set(detected.sessionId, folded.record);
        if (folded.bounced) {
          summary.bounced += 1;
          const key = accountKey(folded.record);
          accounts.holds[key] = Math.max(accounts.holds[key] ?? 0, folded.record.resetsAt ?? 0);
          await logEvent({ event: 'bounced', session: detected.sessionId, resetsAt: folded.record.resetsAt, state: folded.record.state }, p, now);
        } else {
          await logEvent({ event: 'limit-seen', session: detected.sessionId, type: detected.rateLimitType, resetsAt: detected.resetsAt, state: folded.record.state }, p, now);
        }
      }
    }

    // Records whose session moved on, and deliveries waiting for proof.
    for (const record of records.values()) {
      if (isFinal(record) || !['parked', 'due', 'delivering', 'delivered'].includes(record.state)) continue;
      const sent = record.state === 'delivering' || record.state === 'delivered';
      if (limitedIds.has(record.sessionId) && !sent) continue;
      const after = sent ? (record.deliveredAt ?? record.updatedAt) : record.hitAt;
      const progress = await deps.sessionProgress(record.transcriptPath, after, record.limitUuid);
      let next = record;
      if (progress.state === 'active') next = stamp(record, sent ? 'confirmed' : 'superseded', now);
      else if (progress.state === 'missing') next = stamp(record, 'failed', now, 'transcript-missing');
      else if (sent && now - after > 2 * config.intervalMinutes * MINUTE + MINUTE) {
        // A record left `delivering` is a tick that died mid-delivery; it is never delivered again.
        next = stamp(record, 'failed', now, record.state === 'delivering' ? 'interrupted-delivery' : 'no-activity-after-delivery');
      }
      if (next !== record) {
        records.set(record.sessionId, next);
        summary[next.state] = (summary[next.state] ?? 0) + 1;
        await logEvent({ event: next.state, session: record.sessionId, reason: next.reason }, p, now);
        if (next.state === 'failed' && config.notify) await deps.notify('resume-after-limit', `Could not resume session ${short(record.sessionId)} (${next.reason}).`);
      }
    }

    // Probes, only for config directories with a record waiting, at most once per period each.
    const probeFor = new Map();
    if (config.probe.enabled) {
      const waitingDirs = new Set([...records.values()].filter((r) => r.state === 'parked').map((r) => r.configDir));
      for (const configDir of waitingDirs) {
        const key = `${configDir}|${accountNow.get(configDir) ?? ''}`;
        const previous = accounts.probes[key];
        const switched = [...records.values()].some((r) => r.configDir === configDir && r.state === 'parked' && r.account && r.account !== accountNow.get(configDir));
        // A limit newer than the cached probe needs a probe of its own, as an account switch does.
        const newer = previous && [...records.values()].some((r) => r.configDir === configDir && r.state === 'parked' && r.hitAt >= previous.at);
        const minGap = switched || newer ? 5 * MINUTE : config.probe.everyMinutes * MINUTE;
        let probe = previous;
        if (!previous || now - previous.at >= minGap) {
          probe = { at: now, ...(await deps.probeUsage(configDir)) };
          accounts.probes[key] = probe;
          await logEvent({ event: 'probe', configDir, ok: probe.ok, reason: probe.reason ?? null }, p, now);
        }
        probeFor.set(configDir, probe);
      }
    }

    // Decide.
    for (const record of records.values()) {
      if (record.state !== 'parked' && record.state !== 'due') continue;
      const probe = probeFor.get(record.configDir);
      const open = probe ? windowOpen(probe, record.rateLimitType) : null;
      const next = evaluate(record, {
        now,
        config,
        isCovered: covered(record.sessionId, config.mode, sessions),
        accountNow: accountNow.get(record.configDir) ?? null,
        probe: probe ? { open, at: probe.at } : null,
        hold: accounts.holds[accountKey(record)] ?? null,
        holdNow: accountNow.get(record.configDir) ? accounts.holds[`account:${accountNow.get(record.configDir)}`] ?? null : null,
      });
      if (next !== record) {
        records.set(record.sessionId, next);
        if (next.state !== record.state) {
          if (next.state === 'due') summary.due += 1;
          if (next.state === 'expired') summary.expired += 1;
          await logEvent({ event: next.state, session: record.sessionId, reason: next.reason, availableAt: next.availableAt }, p, now);
        }
      }
    }

    // Act. The act phase is bounded so a tick never outlives its own lock; whatever is left stays
    // due and is checked again next tick.
    // Every resume runs under its config directory's current credentials. When that account
    // cannot be read, the directory itself is the conservative key.
    const runsUnder = (record) => {
      const current = accountNow.get(record.configDir);
      return current ? `account:${current}` : `dir:${record.configDir}`;
    };
    for (const record of pickDue([...records.values()], config.batchPerAccount, runsUnder)) {
      if (deps.now() - now > ACT_BUDGET_MS) break;
      if (!covered(record.sessionId, config.mode, sessions)) {
        records.set(record.sessionId, stamp(record, 'parked', now, 'no-longer-covered'));
        continue;
      }
      // Read just before acting: a session may have started or finished since the tick began.
      const session = (await deps.liveSessions(record.configDir)).find((s) => s.sessionId === record.sessionId);
      const channel = !session ? 'background' : session.status === 'idle' ? 'inbox' : session.status === 'busy' ? 'busy' : 'unknown';
      if (channel === 'unknown') continue; // neither idle nor busy, e.g. waiting on a prompt: next tick
      if (channel === 'busy') {
        records.set(record.sessionId, stamp(record, 'superseded', now, 'already-busy'));
        summary.superseded += 1;
        await logEvent({ event: 'superseded', session: record.sessionId, reason: 'already-busy' }, p, now);
        continue;
      }
      if (config.observe) {
        records.set(record.sessionId, stamp({ ...record, channel }, 'observed', now, `would-resume-via-${channel}`));
        summary.observed += 1;
        await logEvent({ event: 'would-resume', session: record.sessionId, channel, cwd: record.cwd }, p, now);
        continue;
      }
      // Saved before acting, so a crash here never delivers twice.
      const delivering = stamp({ ...record, channel, attempts: (record.attempts ?? 0) + 1 }, 'delivering', now);
      await saveRecord(delivering, p);
      let result;
      if (channel === 'inbox') {
        if (!session.socketPath) result = { ok: false, reason: 'no-inbox' };
        else result = await deps.postToInbox(session.socketPath, inboxLines(config.prompt, await deps.readPeerToken(session.keyPath)));
      } else if (!config.paths.claude) {
        result = { ok: false, reason: 'claude-path-unknown' };
      } else if (!record.cwd) {
        result = { ok: false, reason: 'cwd-unknown' };
      } else {
        result = await deps.resumeInBackground({ claudePath: config.paths.claude, sessionId: record.sessionId, prompt: config.prompt, cwd: record.cwd, configDir: record.configDir });
      }
      const next = result.ok
        ? stamp({ ...delivering, deliveredAt: now }, 'delivered', now)
        : stamp(delivering, 'failed', now, result.reason);
      records.set(record.sessionId, next);
      summary[result.ok ? 'delivered' : 'failed'] += 1;
      await logEvent({ event: result.ok ? 'resumed' : 'resume-failed', session: record.sessionId, channel, reason: result.reason ?? null, cwd: record.cwd }, p, now);
      if (config.notify) {
        const where = record.cwd ? path.basename(record.cwd) : short(record.sessionId);
        await deps.notify('resume-after-limit', result.ok ? `Resumed a session in ${where} (${channel}).` : `Could not resume a session in ${where}: ${result.reason}.`);
      }
      if (config.staggerSeconds > 0 && deps.sleep) await deps.sleep(config.staggerSeconds * 1000);
    }

    // Store, and forget finished records after a week.
    for (const record of records.values()) {
      if (isFinal(record) && now - (record.updatedAt ?? now) > FINAL_RETENTION_MS) await deleteRecord(record.sessionId, p);
      else await saveRecord(record, p);
    }
    for (const [key, until] of Object.entries(accounts.holds)) if (until < now - HOUR) delete accounts.holds[key];
    await writeJson(p.accounts, accounts);
    summary.finishedAt = deps.now();
    await writeJson(p.tick, { startedAt: now, finishedAt: summary.finishedAt, outcome: 'ok', summary });
    return summary;
  } catch (error) {
    await writeJson(p.tick, { startedAt: now, finishedAt: deps.now(), outcome: 'error', error: String(error?.message ?? error).slice(0, 300) });
    await logEvent({ event: 'tick-error', error: String(error?.message ?? error).slice(0, 300) }, p, now);
    throw error;
  } finally {
    await lock.release();
  }
}

/** Everything `status` reports, as data. */
export async function statusData({ p = paths(), env = process.env, now = Date.now() } = {}) {
  const config = await loadConfig(p);
  const sessions = await loadSessions(p);
  const records = await loadRecords(p);
  const last = await readJson(p.tick, {});
  const current = SESSION_ID.test(env.CLAUDE_CODE_SESSION_ID ?? '') ? env.CLAUDE_CODE_SESSION_ID : null;
  return {
    mode: config.mode,
    observe: config.observe,
    intervalMinutes: config.intervalMinutes,
    maxDormancyHours: config.maxDormancyHours,
    lateGraceMinutes: config.lateGraceMinutes,
    probe: config.probe,
    scheduler: config.paths.scheduler ?? null,
    configDirs: config.configDirs,
    lastTick: last,
    currentSession: current ? { id: current, covered: covered(current, config.mode, sessions), watched: sessions.watched.includes(current), excluded: sessions.excluded.includes(current) } : null,
    sessions,
    records: records.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    events: await readEvents(p, 8),
    now,
  };
}

export function renderStatus(data) {
  const lines = ['resume-after-limit'];
  const mode = data.mode === 'off' ? 'off' : `on, ${data.mode === 'all' ? 'every session' : 'watched sessions only'}`;
  lines.push(`  mode:        ${mode}${data.mode !== 'off' && data.observe ? ' — observe only: logs what it would do, resumes nothing' : ''}`);
  lines.push(`  checks:      every ${data.intervalMinutes} min · resume only within ${data.maxDormancyHours} h of the limit · at most ${data.lateGraceMinutes} min late`);
  lines.push(`  usage probe: ${data.probe.enabled ? `on, at most every ${data.probe.everyMinutes} min per account` : 'off'}`);
  lines.push(`  scheduler:   ${data.scheduler ? `installed (${data.scheduler})` : 'not installed — run install-scheduler.mjs --install yourself to arm it'}`);
  const t = data.lastTick;
  lines.push(`  last tick:   ${t.startedAt ? `${ago(t.startedAt, data.now)} (${t.outcome ?? 'running'})` : 'never'}${t.outcome === 'error' ? ` — ${t.error}` : ''}`);
  if (data.currentSession) {
    const s = data.currentSession;
    lines.push(`  this session ${short(s.id)}: ${s.covered ? 'covered' : 'not covered'}${s.excluded ? ' (excluded)' : ''}${data.mode === 'selected' && !s.watched ? ' (not watched)' : ''}`);
  }
  const open = data.records.filter((r) => !['confirmed', 'superseded', 'expired', 'observed', 'failed', 'unparsed'].includes(r.state));
  const done = data.records.filter((r) => !open.includes(r)).slice(0, 8);
  lines.push(`  waiting:     ${open.length ? '' : 'none'}`);
  for (const r of open) lines.push(`    ${short(r.sessionId)}  ${r.state.padEnd(10)} ${String(r.rateLimitType).padEnd(10)} hit ${clock(r.hitAt)} · resets ${clock(r.resetsAt)} · ${r.cwd ? path.basename(r.cwd) : '?'}`);
  if (done.length) {
    lines.push('  recent:');
    for (const r of done) lines.push(`    ${short(r.sessionId)}  ${r.state.padEnd(10)} ${r.reason ?? ''} · ${ago(r.updatedAt, data.now)} · ${r.cwd ? path.basename(r.cwd) : '?'}`);
  }
  return lines.join('\n');
}

function parseDuration(value, unit, min, max, step = 1) {
  const match = new RegExp(`^(\\d+)${unit}?$`).exec(String(value ?? '').trim());
  if (!match) return null;
  const n = Number(match[1]);
  if (n < min || n > max || n % step !== 0) return null;
  return n;
}

/** Run one command. Returns `{ code, out }`; prints nothing itself. */
export async function main(argv, { p = paths(), env = process.env, deps = realDeps } = {}) {
  const [command, ...rest] = argv;
  const config = await loadConfig(p);
  const sessions = await loadSessions(p);
  const target = rest.find((arg) => !arg.startsWith('--')) ?? env.CLAUDE_CODE_SESSION_ID;
  switch (command) {
    case 'status': {
      const data = await statusData({ p, env, now: deps.now() });
      return { code: 0, out: rest.includes('--json') ? JSON.stringify(data, null, 2) : renderStatus(data) };
    }
    case 'on': {
      const mode = rest[0] ?? 'all';
      if (!['all', 'selected'].includes(mode)) return { code: 2, out: USAGE };
      if (!config.paths.scheduler) return { code: 1, out: 'Not turned on: no scheduler is installed, so nothing would ever check. The user arms it by running, themselves:\n  node <skill>/scripts/install-scheduler.mjs --install' };
      await saveConfig({ ...config, mode }, p);
      return { code: 0, out: `On for ${mode === 'all' ? 'every session' : 'watched sessions only'}${config.observe ? ', observe only: it logs what it would do and resumes nothing until `observe off`' : ''}.` };
    }
    case 'off':
      await saveConfig({ ...config, mode: 'off' }, p);
      return { code: 0, out: 'Off. Scheduled checks exit at once; nothing is resumed.' };
    case 'watch':
    case 'unwatch': {
      if (!SESSION_ID.test(target ?? '')) return { code: 2, out: 'No session id given, and CLAUDE_CODE_SESSION_ID is not set in this shell.' };
      const next = { watched: sessions.watched.filter((id) => id !== target), excluded: sessions.excluded.filter((id) => id !== target) };
      if (command === 'watch') next.watched.push(target);
      else next.excluded.push(target);
      await saveSessions(next, p);
      const effect = command === 'watch'
        ? (config.mode === 'selected' ? 'covered' : config.mode === 'all' ? 'covered (every session already is)' : 'watched; nothing is covered while the mode is off')
        : (config.mode === 'all' ? 'excluded' : 'no longer watched');
      return { code: 0, out: `Session ${short(target)}: ${effect}.` };
    }
    case 'interval': {
      const minutes = parseDuration(rest[0], 'm', 5, 60, 5);
      if (minutes === null) return { code: 2, out: 'Interval must be 5 to 60 minutes in steps of 5, e.g. `interval 10m`.' };
      await saveConfig({ ...config, intervalMinutes: minutes }, p);
      return { code: 0, out: `Checks every ${minutes} minutes.` };
    }
    case 'dormancy': {
      const hours = parseDuration(rest[0], 'h', 1, 24);
      if (hours === null) return { code: 2, out: 'Dormancy must be 1 to 24 hours, e.g. `dormancy 5h`.' };
      await saveConfig({ ...config, maxDormancyHours: hours }, p);
      return { code: 0, out: `Resumes only sessions whose quota returned within ${hours} h of the limit.` };
    }
    case 'observe':
    case 'probe': {
      const value = rest[0];
      if (!['on', 'off'].includes(value)) return { code: 2, out: USAGE };
      const next = command === 'observe' ? { ...config, observe: value === 'on' } : { ...config, probe: { ...config.probe, enabled: value === 'on' } };
      await saveConfig(next, p);
      if (command === 'observe') return { code: 0, out: value === 'on' ? 'Observe only: it logs what it would do and resumes nothing.' : 'Acting: due sessions are resumed.' };
      return { code: 0, out: value === 'on' ? 'Usage probe on (undocumented endpoint; a 401 or 429 just skips it).' : 'Usage probe off; reset times come from transcripts only.' };
    }
    case 'tick': {
      const summary = await tick({ p, deps: { ...deps, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }, force: rest.includes('--force') });
      // The scheduler appends stdout to a log every five minutes, so a scheduled tick prints
      // nothing; tick.json and events.jsonl hold what it did. `--print` shows it by hand.
      return { code: 0, out: rest.includes('--print') ? JSON.stringify(summary) : '' };
    }
    default:
      return { code: command ? 2 : 0, out: USAGE };
  }
}

if (isEntrypoint(import.meta.url)) {
  main(process.argv.slice(2)).then(
    ({ code, out }) => {
      if (out) process.stdout.write(`${out}\n`);
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`resume-after-limit: ${error?.message ?? error}\n`);
      process.exitCode = 1;
    },
  );
}

export { MODES };
