/**
 * Putting the continue prompt in front of a session, by the one channel that fits its state:
 *
 *   live and idle  -> its inbox socket. Documented for scripts posting into a session; the line
 *                     format is OBSERVED (references/evidence.md). The receiving session applies
 *                     its own inbound rules: one that prompts for permissions takes the message,
 *                     one that bypasses them holds it, and a held message in the VS Code extension
 *                     is dropped after `dialogExpiry`.
 *   not live       -> `claude --bg --resume <id> "<prompt>"` in the session's own directory, under
 *                     its own config directory, with no permission flag of any kind.
 *
 * A live session that is busy is never posted to: something already resumed it.
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { homedir } from 'node:os';

export const SOCKET_TIMEOUT_MS = 5000;
export const RESUME_TIMEOUT_MS = 60_000;

/** The two lines posted to an inbox: an auth line when a token is known, then the user message. */
export function inboxLines(prompt, token) {
  const lines = [];
  if (token) lines.push(JSON.stringify({ type: 'auth', token }));
  lines.push(JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } }));
  return `${lines.join('\n')}\n`;
}

/** The peer token a session publishes beside its session file, or null. */
export async function readPeerToken(keyPath) {
  if (!keyPath) return null;
  try {
    const token = JSON.parse(await readFile(keyPath, 'utf8'))?.peerToken;
    return typeof token === 'string' && /^[0-9a-f]{32}$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

/** Post the prompt to a socket. Resolves `{ ok, reason }`; never throws. */
export function postToInbox(socketPath, payload, { connect = net.createConnection, timeoutMs = SOCKET_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const socket = connect(socketPath, () => socket.end(payload));
    const timer = setTimeout(() => {
      socket.destroy();
      finish({ ok: false, reason: 'timeout' });
    }, timeoutMs);
    socket.on('error', (error) => finish({ ok: false, reason: error.code ?? 'error' }));
    socket.on('close', (hadError) => finish(hadError ? { ok: false, reason: 'closed-with-error' } : { ok: true }));
  });
}

/** The environment a resumed session runs under: ours, with its config directory when it had one. */
export function resumeEnv(configDir, env = process.env, home = homedir()) {
  const next = { ...env };
  if (path.resolve(configDir) === path.join(home, '.claude')) delete next.CLAUDE_CONFIG_DIR;
  else next.CLAUDE_CONFIG_DIR = configDir;
  return next;
}

/** `claude --bg --resume <id> <prompt>`. Resolves `{ ok, reason, output }`; never throws. */
export function resumeInBackground({ claudePath, sessionId, prompt, cwd, configDir }, { run = execFile } = {}) {
  return new Promise((resolve) => {
    run(claudePath, ['--bg', '--resume', sessionId, prompt], { cwd, env: resumeEnv(configDir), timeout: RESUME_TIMEOUT_MS }, (error, stdout = '', stderr = '') => {
      const output = `${stdout}${stderr}`.slice(0, 500);
      if (error) return resolve({ ok: false, reason: error.killed ? 'timeout' : `exit-${error.code ?? 'error'}`, output });
      // `--bg --resume` starts a copy when the session is already running, and says so.
      if (/\bcopy\b/i.test(output)) return resolve({ ok: false, reason: 'started-a-copy', output });
      resolve({ ok: true, output });
    });
  });
}

/** A desktop notification where the platform has one. Best effort; never throws. */
export function notify(title, message, { platform = process.platform, run = execFile } = {}) {
  return new Promise((resolve) => {
    const done = () => resolve();
    if (platform === 'darwin') {
      const script = `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`;
      run('osascript', ['-e', script], { timeout: 5000 }, done);
    } else if (platform === 'linux') {
      run('notify-send', [title, message], { timeout: 5000 }, done);
    } else {
      done();
    }
  });
}
