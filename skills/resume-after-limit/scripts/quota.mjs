/**
 * The optional second source: Claude's usage endpoint, asked how much of each window an account
 * has used. Off by default (`probe.enabled: false`), because nothing about it is observed by this
 * pack yet (references/evidence.md): the endpoint is undocumented, it answers 429 readily, and on
 * macOS reading the token from the Keychain may raise a prompt the first time.
 *
 * Two rules hold whenever it does run:
 *   - the token is read for the one request and never stored, logged or refreshed. An expired
 *     token, a 401 or a 429 skips the probe; the transcript's reset time still applies.
 *   - the request says who it is. It does not borrow Claude Code's User-Agent.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
export const USAGE_BETA = 'oauth-2025-04-20';
export const REQUEST_TIMEOUT_MS = 10_000;

/** The usage endpoint's field for each `rateLimitType` a transcript records. */
export const WINDOW_FIELD = Object.freeze({
  five_hour: 'five_hour',
  seven_day: 'seven_day',
  seven_day_opus: 'seven_day_opus',
  seven_day_sonnet: 'seven_day_sonnet',
});

/**
 * The Keychain service Claude Code stores credentials under. With a non-default config
 * directory it carries a suffix of the first eight hex digits of the directory's SHA-256; that
 * suffix is read from the binary and NOT OBSERVED.
 */
export function keychainService(configDir, home = homedir()) {
  if (path.resolve(configDir) === path.join(home, '.claude')) return 'Claude Code-credentials';
  return `Claude Code-credentials-${createHash('sha256').update(configDir).digest('hex').slice(0, 8)}`;
}

function parseCredentials(text) {
  const oauth = JSON.parse(text)?.claudeAiOauth;
  if (!oauth?.accessToken) return null;
  return { accessToken: oauth.accessToken, expiresAt: Number(oauth.expiresAt) || null };
}

/** The access token, or null. Never thrown, never printed. */
export async function readToken(configDir, { platform = process.platform, run = execFileAsync, home = homedir() } = {}) {
  try {
    if (platform === 'darwin') {
      const { stdout } = await run('security', ['find-generic-password', '-s', keychainService(configDir, home), '-a', userInfo().username, '-w'], { timeout: 5000 });
      return parseCredentials(stdout.trim());
    }
    return parseCredentials(await readFile(path.join(configDir, '.credentials.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * One probe. Returns `{ ok: true, windows }` where each window is `{ utilization, resetsAt }`
 * (epoch ms), or `{ ok: false, reason }`. `reason` never contains the token.
 */
export async function probeUsage(configDir, { fetchImpl = globalThis.fetch, now = Date.now(), version = '1.0.0', readTokenImpl = readToken } = {}) {
  const token = await readTokenImpl(configDir);
  if (!token) return { ok: false, reason: 'no-token' };
  if (token.expiresAt && token.expiresAt <= now) return { ok: false, reason: 'token-expired' };
  let response;
  try {
    response = await fetchImpl(USAGE_URL, {
      headers: { authorization: `Bearer ${token.accessToken}`, 'anthropic-beta': USAGE_BETA, 'user-agent': `agent-skills-resume-after-limit/${version}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, reason: error?.name === 'TimeoutError' ? 'timeout' : 'network' };
  }
  if (response.status !== 200) return { ok: false, reason: `http-${response.status}` };
  let body;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  const windows = {};
  for (const field of Object.values(WINDOW_FIELD)) {
    const window = body?.[field];
    if (!window || !Number.isFinite(window.utilization)) continue;
    windows[field] = { utilization: window.utilization, resetsAt: Date.parse(window.resets_at) || null };
  }
  return { ok: true, windows };
}

/**
 * Whether a probe says the window a record is waiting on is open again. Unknown when the probe
 * failed or does not carry that window.
 */
export function windowOpen(probe, rateLimitType) {
  if (!probe?.ok) return null;
  const window = probe.windows?.[WINDOW_FIELD[rateLimitType] ?? ''];
  if (!window) return null;
  return window.utilization < 100;
}
