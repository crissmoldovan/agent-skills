#!/usr/bin/env node
/**
 * Install, or remove, the scheduler that runs `resume.mjs tick` every five minutes.
 *
 * A user runs this. Nothing runs it for them, and no skill or agent may run it on their behalf:
 * the tick it schedules can speak into the user's sessions, so arming it is the user's decision
 * (CONTRIBUTING, "Adapters and hooks": off until a human arms it, removed by the same installer).
 *
 *   macOS  a launchd agent, ~/Library/LaunchAgents/<LABEL>.plist, StartInterval 300. launchd runs
 *          an interval missed while the Mac slept once it wakes.
 *   Linux  a systemd user timer when `systemctl --user` answers, else one crontab line that
 *          carries MARKER, so removal finds exactly that line and nothing else.
 *
 * It records the absolute paths of `node`, `claude` and `resume.mjs` in the state directory's
 * config, because a scheduler runs with almost no PATH. It never changes the mode: the watcher
 * stays off until the user turns it on, and starts in observe mode.
 *
 * Limits, said here and wherever it is introduced: a tick only reads files and posts a prompt
 * the rules allow. It cannot answer a permission prompt, it cannot reach a session that bypasses
 * permissions (that session holds the message), and it does nothing while the machine sleeps.
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { defaultConfigDir, isEntrypoint, loadConfig, paths, saveConfig } from './state.mjs';

const execFileAsync = promisify(execFile);

export const LABEL = 'dev.agent-skills.resume-after-limit';
export const MARKER = '# agent-skills resume-after-limit';
export const INTERVAL_SECONDS = 300;

const USAGE = `Usage: install-scheduler.mjs --install [--claude <path>] [--dry-run]
       install-scheduler.mjs --remove [--dry-run]

Installs a launchd agent (macOS) or a systemd user timer / crontab line (Linux) that runs
resume.mjs tick every five minutes. It does not turn the watcher on; ask for that afterwards.`;

function xmlEscape(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The PATH a scheduled tick runs with: the directories of node and claude, then the system's. */
export function schedulePath({ node, claude }) {
  return [...new Set([path.dirname(node), claude ? path.dirname(claude) : null, '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].filter(Boolean))].join(':');
}

export function launchdPlist({ node, script, claude, stateHome, logFile }) {
  const args = [node, script, 'tick'].map((arg) => `    <string>${xmlEscape(arg)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>StartInterval</key>
  <integer>${INTERVAL_SECONDS}</integer>
  <key>RunAtLoad</key>
  <false/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xmlEscape(schedulePath({ node, claude }))}</string>
    <key>RESUME_AFTER_LIMIT_HOME</key>
    <string>${xmlEscape(stateHome)}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${xmlEscape(logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(logFile)}</string>
</dict>
</plist>
`;
}

function shellQuote(text) {
  return `'${String(text).replace(/'/g, `'\\''`)}'`;
}

/**
 * One word of a systemd unit line, double-quoted: backslashes and quotes escaped, and `%` doubled
 * so a path is never read as a specifier. A space inside the quotes stays inside the word.
 */
export function systemdQuote(text) {
  return `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`;
}

export function systemdUnits({ node, script, claude, stateHome }) {
  const service = `[Unit]
Description=resume-after-limit tick (agent-skills)

[Service]
Type=oneshot
Environment=${systemdQuote(`PATH=${schedulePath({ node, claude })}`)}
Environment=${systemdQuote(`RESUME_AFTER_LIMIT_HOME=${stateHome}`)}
ExecStart=${[node, script, 'tick'].map(systemdQuote).join(' ')}
`;
  const timer = `[Unit]
Description=resume-after-limit every ${INTERVAL_SECONDS / 60} minutes (agent-skills)

[Timer]
OnBootSec=${INTERVAL_SECONDS}
OnUnitActiveSec=${INTERVAL_SECONDS}
Persistent=true

[Install]
WantedBy=timers.target
`;
  return { service, timer };
}

export function cronLine({ node, script, claude, stateHome, logFile }) {
  return `*/${INTERVAL_SECONDS / 60} * * * * PATH=${shellQuote(schedulePath({ node, claude }))} RESUME_AFTER_LIMIT_HOME=${shellQuote(stateHome)} ${shellQuote(node)} ${shellQuote(script)} tick >> ${shellQuote(logFile)} 2>&1 ${MARKER}`;
}

/** The crontab with our line removed (and, when given, added back once at the end). */
export function editCrontab(current, line) {
  const kept = current.split('\n').filter((existing) => existing.trim() && !existing.includes(MARKER));
  if (line) kept.push(line);
  return kept.length ? `${kept.join('\n')}\n` : '';
}

async function which(command, run) {
  try {
    const { stdout } = await run('/bin/sh', ['-c', `command -v ${command}`]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function systemdAvailable(run) {
  try {
    await run('systemctl', ['--user', 'show-environment'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Plan and (unless dryRun) apply. Returns the lines to print. Every external effect goes through
 * `run` and the fs functions passed in, so tests drive it without touching a real scheduler.
 */
export async function install({ remove = false, dryRun = false, claude, platform = process.platform, home = homedir(), run = execFileAsync, fs = { mkdir, readFile, rm, writeFile }, p = paths(), node = process.execPath, script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'resume.mjs') } = {}) {
  const out = [];
  const stateHome = p.home;
  const logFile = path.join(stateHome, 'scheduler.log');
  const claudePath = claude ?? (await which('claude', run));
  const spec = { node, script, claude: claudePath, stateHome, logFile };
  const config = await loadConfig(p);
  let kind;

  if (platform === 'darwin') {
    kind = 'launchd';
    const plistPath = path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
    const domain = `gui/${userInfo().uid}`;
    if (remove) {
      out.push(`remove ${plistPath}`);
      if (!dryRun) {
        await run('launchctl', ['bootout', `${domain}/${LABEL}`]).catch(() => {});
        await fs.rm(plistPath, { force: true });
      }
    } else {
      out.push(`write ${plistPath}`, `launchctl bootstrap ${domain} ${plistPath}`);
      if (!dryRun) {
        await fs.mkdir(path.dirname(plistPath), { recursive: true });
        await fs.mkdir(stateHome, { recursive: true, mode: 0o700 });
        await fs.writeFile(plistPath, launchdPlist(spec));
        await run('launchctl', ['bootout', `${domain}/${LABEL}`]).catch(() => {});
        await run('launchctl', ['bootstrap', domain, plistPath]);
      }
    }
  } else if (platform === 'linux') {
    // Removal takes out BOTH Linux variants, whatever answers now: probing `systemctl --user`
    // at removal time would fall through to cron whenever the user bus is unreachable from the
    // shell running it, report success, and leave an enabled timer behind.
    const dir = path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'systemd', 'user');
    const service = path.join(dir, `${LABEL}.service`);
    const timer = path.join(dir, `${LABEL}.timer`);
    if (remove) {
      kind = 'systemd and cron';
      out.push(`systemctl --user disable --now ${LABEL}.timer`, `remove ${service}`, `remove ${timer}`);
      if (!dryRun) {
        await run('systemctl', ['--user', 'disable', '--now', `${LABEL}.timer`]).catch(() => {});
        await fs.rm(service, { force: true });
        await fs.rm(timer, { force: true });
        await run('systemctl', ['--user', 'daemon-reload']).catch(() => {});
      }
    } else if (await systemdAvailable(run)) {
      kind = 'systemd';
      const units = systemdUnits(spec);
      out.push(`write ${service}`, `write ${timer}`, `systemctl --user enable --now ${LABEL}.timer`);
      if (!dryRun) {
        await fs.mkdir(dir, { recursive: true });
        await fs.mkdir(stateHome, { recursive: true, mode: 0o700 });
        await fs.writeFile(service, units.service);
        await fs.writeFile(timer, units.timer);
        await run('systemctl', ['--user', 'daemon-reload']);
        await run('systemctl', ['--user', 'enable', '--now', `${LABEL}.timer`]);
      }
    } else {
      kind = 'cron';
    }
  } else {
    return { code: 1, out: [`Not supported on ${platform}: only macOS (launchd) and Linux (systemd or cron).`] };
  }

  if (platform === 'linux' && (remove || kind === 'cron')) {
    let current = null;
    try {
      current = (await run('crontab', ['-l'])).stdout;
    } catch {
      current = null; // no crontab yet, or no cron at all
    }
    if (remove) {
      // Only a crontab that carries our line is rewritten; one without it is left untouched.
      if (current !== null && current.includes(MARKER)) {
        out.push('remove the crontab line marked resume-after-limit');
        if (!dryRun) await writeCrontab(editCrontab(current, null));
      }
    } else {
      out.push(`crontab line: ${cronLine(spec)}`);
      if (!dryRun) await writeCrontab(editCrontab(current ?? '', cronLine(spec)));
    }
  }

  async function writeCrontab(text) {
    await fs.mkdir(stateHome, { recursive: true, mode: 0o700 });
    const temp = path.join(stateHome, 'crontab.tmp');
    await fs.writeFile(temp, text);
    await run('crontab', [temp]);
    await fs.rm(temp, { force: true });
  }

  if (!dryRun) {
    const paths_ = { ...config.paths };
    if (remove) delete paths_.scheduler;
    else Object.assign(paths_, { scheduler: kind, node, script, claude: claudePath });
    // Every install, a reinstall included, leaves the watcher off and in observe mode: arming it
    // to act is a separate, later ask, never something an upgrade carries over.
    await saveConfig({ ...config, mode: 'off', observe: remove ? config.observe : true, configDirs: config.configDirs.length ? config.configDirs : [defaultConfigDir()], paths: paths_ }, p);
  }

  if (remove) {
    out.push('', 'Removed. The watcher is off; its state directory is kept:', `  ${stateHome}`);
  } else {
    out.push(
      '',
      `Installed (${kind}): a tick every ${INTERVAL_SECONDS / 60} minutes. The watcher is OFF and in observe mode (it logs, it resumes nothing) until you ask for more.`,
      claudePath ? `claude: ${claudePath}` : 'claude was not found on PATH; pass --claude <path>, or exited sessions cannot be resumed.',
      '',
      'Limits: a tick reads transcripts and posts a prompt the rules allow. It cannot answer a',
      'permission prompt, a session that bypasses permissions holds its message, and nothing runs',
      'while this machine sleeps. Remove it with: install-scheduler.mjs --remove',
    );
  }
  return { code: 0, out };
}

if (isEntrypoint(import.meta.url)) {
  const args = process.argv.slice(2);
  const claudeIndex = args.indexOf('--claude');
  const claude = claudeIndex >= 0 ? args[claudeIndex + 1] : undefined;
  if ((!args.includes('--install') && !args.includes('--remove')) || (claudeIndex >= 0 && !claude)) {
    process.stdout.write(`${USAGE}\n`);
    process.exitCode = 2;
  } else {
    install({ remove: args.includes('--remove'), dryRun: args.includes('--dry-run'), claude }).then(
      ({ code, out }) => {
        process.stdout.write(`${out.join('\n')}\n`);
        process.exitCode = code;
      },
      (error) => {
        process.stderr.write(`install-scheduler: ${error?.message ?? error}\n`);
        process.exitCode = 1;
      },
    );
  }
}
