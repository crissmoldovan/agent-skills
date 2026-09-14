#!/usr/bin/env node
/**
 * ARM THE SESSION-START CHECK, or take it away again.
 *
 * The check has one mode, because it cannot cost anyone a turn: it reads, it never blocks, and it
 * prints one line only when a required skill is missing, the repository's evidence has moved, or
 * the generated rules file no longer matches its profile. So there is no observe/block choice
 * here — arming it means writing the hook, and `--remove` takes it back.
 *
 * IT AFFECTS EVERY PROJECT ON THIS MACHINE. The hook lives in the user's own settings file, so
 * onboarding one repository must never install it silently: the skill shows it as its own row,
 * marked, and the user runs this script themselves.
 *
 * RECOGNISED BY COMMAND, NOT BY DESCRIBE. Claude Code drops the `describe` key from every hook
 * entry whenever it rewrites settings.json, and an installer that recognises its own work by that
 * key stops recognising it — which is how orphaned hooks accumulate. The command survives byte for
 * byte, so that is what this reads.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOOK_MARKER = 'onboard.mjs';
export const DESCRIBE_PREFIX = 'agent-skills onboard-project check';
export const TIMEOUT_SECONDS = 5;
/** New processes only. A compact or a clear is the same process with the same answer. */
export const MATCHERS = Object.freeze(['startup', 'resume']);
/** The runtimes this installer will recognise running its own script. */
const NODEISH = /^(?:node|nodejs|bun)(?:[0-9.]*)?(?:\.exe)?$/i;

const USAGE = `Usage: install-check-hook.mjs [--settings <path>]
       install-check-hook.mjs --remove [--settings <path>]

Writes a SessionStart hook (matchers: ${MATCHERS.join(', ')}) that runs onboard-project's check.
It prints nothing at all unless something is missing or has changed, never blocks, and fails open.

This hook lives in your user settings, so it applies to EVERY project on this machine, not only
the one you were onboarding. Remove it with --remove.`;

export function shellQuote(value) {
  return `'${String(value).split("'").join(`'\\''`)}'`;
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function resolveHome(env = process.env) {
  return env.HOME || env.USERPROFILE || homedir();
}

export function resolveSettingsPath(env = process.env) {
  return path.join(resolveHome(env), '.claude', 'settings.json');
}

export function resolveCheckerPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), HOOK_MARKER);
}

export function buildHookEntry({ checkerPath = resolveCheckerPath(), nodePath = process.execPath } = {}) {
  return {
    type: 'command',
    command: `${shellQuote(nodePath)} ${shellQuote(checkerPath)} check --hook`,
    timeout: TIMEOUT_SECONDS,
    describe: `${DESCRIBE_PREFIX}: at the start of a new session, says one line if a skill this project lists is not installed, if the repository's evidence has moved, or if the generated routing file no longer matches its profile — and says nothing otherwise. It never blocks, reads no session history, and is removed by running install-check-hook.mjs --remove.`,
  };
}

/** The tokens of a command, with one level of single quotes taken off. */
function tokens(command) {
  const found = String(command).match(/'(?:[^']|'\\'')*'|\S+/g) ?? [];
  return found.map((token) => (token.startsWith("'") && token.endsWith("'")
    ? token.slice(1, -1).split(`'\\''`).join("'")
    : token));
}

/**
 * True when this command is one this installer writes: a Node-compatible runtime, this checker,
 * and exactly `check --hook`. Nothing else — a hook that merely mentions the path is not ours to
 * remove, and deleting somebody else's hook is the one mistake here with no undo.
 */
export function runsOurCheck(command, { checkerPath = resolveCheckerPath() } = {}) {
  const parts = tokens(command);
  if (parts.length !== 4) return false;
  const [runtime, script, first, second] = parts;
  if (!NODEISH.test(path.basename(runtime))) return false;
  if (path.resolve(script) !== path.resolve(checkerPath)) return false;
  return first === 'check' && second === '--hook';
}

/** A hook that names this checker in a shape this installer does not write. */
export function mentionsOurCheck(command, { checkerPath = resolveCheckerPath() } = {}) {
  return String(command).includes(path.basename(path.dirname(checkerPath)) + path.sep + HOOK_MARKER)
    || String(command).includes(checkerPath);
}

function sessionStartGroups(settings) {
  if (!Object.hasOwn(settings, 'hooks')) return [];
  if (!plainObject(settings.hooks)) throw new Error('refusing to write: the settings "hooks" key is not an object');
  if (!Object.hasOwn(settings.hooks, 'SessionStart')) return [];
  if (!Array.isArray(settings.hooks.SessionStart)) throw new Error('refusing to write: "hooks.SessionStart" is not an array');
  for (const group of settings.hooks.SessionStart) {
    if (!plainObject(group) || !Array.isArray(group.hooks)) throw new Error('refusing to write: a SessionStart entry has an unexpected shape');
  }
  return settings.hooks.SessionStart;
}

/** Drop our own hooks, leaving everything else exactly as it was found. */
export function removeHooks(settings, { checkerPath = resolveCheckerPath() } = {}) {
  if (!plainObject(settings)) throw new Error('refusing to write: settings must be a JSON object');
  const groups = sessionStartGroups(settings);
  let removed = 0;
  const left = [];
  for (const group of groups) {
    const kept = [];
    for (const hook of group.hooks) {
      if (runsOurCheck(hook?.command ?? '', { checkerPath })) {
        removed += 1;
        continue;
      }
      if (mentionsOurCheck(hook?.command ?? '', { checkerPath })) left.push(`SessionStart (matcher ${group.matcher ?? '-'})`);
      kept.push(hook);
    }
    group.hooks = kept;
  }
  if (removed > 0 || groups.length > 0) {
    const remaining = groups.filter((group) => group.hooks.length > 0);
    if (remaining.length === 0) delete settings.hooks.SessionStart;
    else settings.hooks.SessionStart = remaining;
    if (plainObject(settings.hooks) && Object.keys(settings.hooks).length === 0) delete settings.hooks;
  }
  return { settings, removed, left };
}

/** Write our hook into both matchers, replacing any copy of ours already there. */
export function installHooks(settings, { entry = buildHookEntry(), checkerPath = resolveCheckerPath() } = {}) {
  if (!plainObject(settings)) throw new Error('refusing to write: settings must be a JSON object');
  const { settings: cleaned, left } = removeHooks(settings, { checkerPath });
  if (left.length > 0) {
    throw new Error(`refusing to write: ${left.join(', ')} already runs this check in a shape this installer does not recognise. Remove it by hand first.`);
  }
  const hooks = plainObject(cleaned.hooks) ? cleaned.hooks : {};
  const sessionStart = Array.isArray(hooks.SessionStart) ? hooks.SessionStart : [];
  for (const matcher of MATCHERS) {
    let group = sessionStart.find((candidate) => candidate.matcher === matcher);
    if (!group) {
      group = { matcher, hooks: [] };
      sessionStart.push(group);
    }
    group.hooks.push({ ...entry });
  }
  hooks.SessionStart = sessionStart;
  cleaned.hooks = hooks;
  return cleaned;
}

function readSettings(file) {
  if (!existsSync(file)) return {};
  const source = readFileSync(file, 'utf8');
  if (source.trim() === '') return {};
  const parsed = JSON.parse(source);
  if (!plainObject(parsed)) throw new Error(`refusing to write: ${file} is not a JSON object`);
  return parsed;
}

function writeSettings(file, settings) {
  const temporary = `${file}.${process.pid}.tmp`;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`);
  renameSync(temporary, file);
}

export async function main(argv, { stdout = process.stdout, stderr = process.stderr, env = process.env } = {}) {
  const options = { remove: false, settings: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--remove') options.remove = true;
    else if (argument === '--settings') options.settings = argv[index += 1];
    else if (argument === '--help' || argument === '-h') {
      stdout.write(`${USAGE}\n`);
      return 0;
    } else {
      stderr.write(`unknown option: ${argument}\n${USAGE}\n`);
      return 1;
    }
  }
  const file = options.settings ? path.resolve(options.settings) : resolveSettingsPath(env);
  try {
    const settings = readSettings(file);
    if (options.remove) {
      const { settings: cleaned, removed, left } = removeHooks(settings);
      writeSettings(file, cleaned);
      stdout.write(`Removed ${removed} onboard-project check hook${removed === 1 ? '' : 's'} from ${file}.\n`);
      if (left.length > 0) {
        stderr.write(`Left in place, because this installer did not write ${left.length === 1 ? 'it' : 'them'}: ${left.join(', ')}.\n`);
        return 1;
      }
      return 0;
    }
    writeSettings(file, installHooks(settings));
    stdout.write([
      `Armed the onboard-project check in ${file}, on SessionStart (${MATCHERS.join(' and ')}).`,
      '',
      'It says ONE line, and only when one of three things is true: a skill this project lists is',
      'not installed, the repository\'s evidence has moved since the profile was written, or the',
      'generated routing file no longer matches that profile. Every other session start is silent.',
      '',
      'It reads no session history, never blocks a turn, and fails open — any error at all produces',
      'no output rather than a failed session start.',
      '',
      'THIS HOOK APPLIES TO EVERY PROJECT ON THIS MACHINE. In a repository with no profile it says',
      'once, and then never again, that onboarding exists.',
      '',
      'Remove it by running this script with --remove.',
      '',
    ].join('\n'));
    return 0;
  } catch (error) {
    stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
