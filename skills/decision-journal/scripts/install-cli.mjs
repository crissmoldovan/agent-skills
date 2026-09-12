#!/usr/bin/env node
/**
 * Put the agent-journal CLI on PATH, from the copy this skill carries.
 *
 * The skill ships the program as scripts/agent-journal.mjs, and an agent working
 * from the skill can run that file directly. Two other things run the CLI and never
 * load the skill: the harness hooks, which call `agent-journal` on every tool call,
 * and a person in a shell — retracting a wrong entry hours later, rendering a
 * digest, deleting a leaked secret. Both need the command at one stable path, and a
 * skill lands in a different directory per agent and per scope. This writes that path.
 *
 * A user runs this. Nothing runs it for them, and no skill may run it on their
 * behalf: it writes a file into a directory on their PATH.
 *
 * What it writes is a small POSIX wrapper — not a copy, so updating the skill
 * updates the command with it; and not a symlink, so it does not depend on the
 * executable bit surviving however the skill was installed. The wrapper carries a
 * marker, and nothing this script did not write is ever overwritten or removed —
 * the same rule the pack's freshness-hook installer keeps.
 */
import { realpathSync } from 'node:fs';
import { access, chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * True when this file is the program being run, false when it was imported.
 *
 * Its own copy, not an import: the only file beside it in this skill is the generated
 * CLI bundle, and an installer that stops working when the bundle is regenerated is a
 * worse trade than four lines repeated. The pack's other copies are in
 * `skills/update-agent-skills/scripts/check-pack-freshness.mjs` and
 * `adapters/claude-code/report-progress-gate.mjs`; `test/entrypoint-guard.test.mjs`
 * sweeps every one of them, because this decision has already drifted once.
 *
 * Observed on 2026-09-12: reached through the symlink the Skills CLI installs
 * (`~/.claude/skills/<name>` -> `~/.agents/skills/<name>`), `process.argv[1]` is the
 * path as typed while `import.meta.url` is the file Node resolved it to. Comparing
 * them as written was false, `main()` never ran, and the script exited 0 having
 * written no command and printed nothing — leaving the user to discover at their next
 * `agent-journal` that nothing was installed.
 *
 * BOTH sides are resolved: under `--preserve-symlinks-main` it is `import.meta.url`
 * that keeps the symlink. `realpathSync.native` also returns the on-disk case, which a
 * case-insensitive volume otherwise makes compare unequal. It can throw, and a guard
 * that throws at load turns an import into a crash, so it falls back to the unresolved
 * comparison rather than to silence.
 */
function isEntrypoint(moduleUrl) {
  const invoked = process.argv[1];
  if (!invoked) return false;
  const modulePath = fileURLToPath(moduleUrl);
  try {
    return realpathSync.native(invoked) === realpathSync.native(modulePath);
  } catch {
    return path.resolve(invoked) === modulePath;
  }
}

export const COMMAND = 'agent-journal';
/** In every wrapper this script writes; how it knows a file is its own. */
export const MARKER = '# installed-by: decision-journal install-cli.mjs';
/** The CLI's own floor, from packages/agent-journal's engines; the bundle is built for it. */
export const MIN_NODE_MAJOR = 24;

const USAGE = `Usage: install-cli.mjs [--bin-dir <dir>]
       install-cli.mjs --remove [--bin-dir <dir>]

Writes an \`agent-journal\` command into <dir> (default ~/.local/bin) that runs the
CLI this skill carries. --remove deletes it, and only ever a file this script wrote.`;

export function resolveHome(env = process.env) {
  return env.HOME || homedir();
}

export function resolveBinDir(env = process.env) {
  return path.join(resolveHome(env), '.local', 'bin');
}

export function resolveBundlePath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'agent-journal.mjs');
}

/** Single-quote for POSIX sh, closing and reopening around any embedded quote. */
export function shellQuote(value) {
  return `'${String(value).split("'").join(`'\\''`)}'`;
}

export function buildWrapper({ bundlePath }) {
  return [
    '#!/bin/sh',
    MARKER,
    '# Runs the agent-journal CLI carried by the decision-journal skill. Remove with: install-cli.mjs --remove',
    `bundle=${shellQuote(bundlePath)}`,
    // A skill installed as a plugin lives in a versioned folder, and an update moves it.
    // Say so, rather than let node fail with a bare "Cannot find module".
    'if [ ! -f "$bundle" ]; then',
    '  echo "agent-journal: $bundle is gone; the decision-journal skill was updated or removed. Re-run its scripts/install-cli.mjs." >&2',
    '  exit 127',
    'fi',
    'exec node "$bundle" "$@"',
    '',
  ].join('\n');
}

export function isOurs(content) {
  return typeof content === 'string' && content.includes(MARKER);
}

/** Whether `dir` is one of PATH's entries, compared as resolved paths. */
export function onPath(dir, pathVariable = process.env.PATH ?? '') {
  const target = path.resolve(dir);
  return pathVariable.split(path.delimiter).filter(Boolean).some((entry) => path.resolve(entry) === target);
}

async function readIfPresent(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function parseArguments(argv) {
  const options = { binDir: null, remove: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--bin-dir') {
      index += 1;
      options.binDir = argv[index] ?? '';
      if (!options.binDir) throw new Error('--bin-dir needs a directory');
    } else if (argument === '--remove') options.remove = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

export async function main(argv = process.argv.slice(2), context = {}) {
  const {
    env = process.env,
    stdout = process.stdout,
    stderr = process.stderr,
    bundlePath = resolveBundlePath(),
    platform = process.platform,
    nodeVersion = process.versions.node,
  } = context;

  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    stderr.write(`${error.message}\n${USAGE}\n`);
    return 1;
  }
  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (platform === 'win32') {
    stderr.write(`This installer writes a POSIX shell wrapper and does not support Windows.\nRun the CLI directly instead: node ${bundlePath} help\n`);
    return 1;
  }

  const binDir = options.binDir || resolveBinDir(env);
  const target = path.join(binDir, COMMAND);

  try {
    const existing = await readIfPresent(target);

    if (options.remove) {
      if (existing === undefined) {
        stdout.write(`No ${COMMAND} was installed at ${target}. Nothing changed.\n`);
        return 0;
      }
      if (!isOurs(existing)) {
        stderr.write(`refusing to remove ${target}: it was not written by this installer.\n`);
        return 1;
      }
      await rm(target);
      stdout.write(`Removed ${target}.\n`);
      return 0;
    }

    if (existing !== undefined && !isOurs(existing)) {
      stderr.write(`refusing to overwrite ${target}: an ${COMMAND} is already there and this installer did not write it.\nRemove it yourself first, or pass --bin-dir to install somewhere else.\n`);
      return 1;
    }

    // The wrapper runs whichever `node` is on PATH, which is usually the one running
    // this. Refuse here rather than install a command that fails on its first use.
    // Only installing needs it: --remove works with any Node that can run this file.
    const major = Number.parseInt(nodeVersion, 10);
    if (!(major >= MIN_NODE_MAJOR)) {
      stderr.write(`refusing to install: the agent-journal CLI needs Node.js ${MIN_NODE_MAJOR} or newer, and this is ${nodeVersion}.\n`);
      return 1;
    }

    // Fail here, where the message can say why, rather than leave a command that
    // points at nothing and fails later with a bare "not found".
    try {
      await access(bundlePath);
    } catch {
      stderr.write(`refusing to install: the CLI this skill should carry is missing at ${bundlePath}.\n`);
      return 1;
    }

    await mkdir(binDir, { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, buildWrapper({ bundlePath }));
    await chmod(temporary, 0o755);
    await rename(temporary, target);

    stdout.write(`${existing === undefined ? 'Installed' : 'Updated'} ${target}\n  runs ${bundlePath}\n`);
    stdout.write('If the skill moves (a plugin update installs it to a new folder), re-run this from there.\n');
    if (!onPath(binDir, env.PATH)) {
      stdout.write([
        '',
        `${binDir} is not on your PATH, so \`${COMMAND}\` will not be found yet.`,
        'Add it to your shell profile, for example:',
        `  export PATH="${binDir}:$PATH"`,
        'This installer does not edit shell profiles for you.',
        '',
      ].join('\n'));
    }
    stdout.write(`\nCheck it with: ${COMMAND} help\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (isEntrypoint(import.meta.url)) {
  process.exitCode = await main();
}
