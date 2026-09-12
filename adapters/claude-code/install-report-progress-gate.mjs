#!/usr/bin/env node
/**
 * Install, or remove, the pair of Claude Code hooks that make a progress report
 * non-skippable on turns that dispatched a subagent.
 *
 * A user runs this. Nothing runs it for them, and no skill may run it on their
 * behalf: a hook that can end a turn is the user's decision to arm, and a gate
 * installed by an agent on its own initiative is a gate nobody consented to.
 *
 * Two hooks, because the gate needs both halves and neither is useful alone:
 *
 *   PostToolUse, matcher `Agent`  arms a per-session marker when a subagent is
 *                                 dispatched. Scoped to that one tool, so the
 *                                 hook is not invoked at all on the hundreds of
 *                                 Read and Bash calls around it.
 *   Stop                          reads the marker and refuses the turn's final
 *                                 message if it carries no report. No marker, no
 *                                 gate — which is the difference between a guard
 *                                 people keep and one they rip out after it
 *                                 blocks "yes, that file is in src/".
 *
 * Two modes, and the distance between them is the point:
 *
 *   observe  The gate runs, checks the same message, and writes what it WOULD
 *            have blocked to stderr. The turn always ends. This is the mode to
 *            live with for a day before arming the other one.
 *   block    The gate returns `{"decision":"block"}` and the turn continues for
 *            one more round so the report can be written. Once per turn, ever.
 *
 * What the gate can and cannot do is fixed and small: it matches strings against
 * the turn's final message. It sees whether the three section labels are there
 * and whether a running row carries a state word and a freshness token. It
 * cannot tell whether a count is real, whether a child id exists, or whether
 * "40s ago" was ever observed. Nothing this script writes — command, describe, or
 * printed output — may imply otherwise.
 *
 * One number worth knowing before arming anything: Claude Code ends a turn after
 * 8 consecutive `Stop` blocks, and that budget is SHARED across every `Stop` hook
 * from every settings source (`adapters/HOOK-OUTPUT-NOTES.md`). When it runs out
 * the headless result is `subtype: "success"`, `is_error: false`, `result: ""` —
 * an empty answer reported as a clean run. The gate spends at most one block per
 * turn precisely so it can never be the hook that walks a session into that.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { GATE_ENV_FLAG, GATE_MODES } from './report-progress-gate.mjs';

/** Every hook this script writes carries the gate's filename in its command. */
export const HOOK_MARKER = 'report-progress-gate.mjs';
/** …and this prefix in its `describe`, which is how we know a hook is ours. */
export const DESCRIBE_PREFIX = 'agent-skills report-progress gate';
export const MODES = GATE_MODES;

/** The two events the gate needs, with the matcher each is scoped by. */
export const STOP_MATCHER = '*';
export const AGENT_MATCHER = 'Agent';

/**
 * The session waits on both of these, so both ceilings are small. The gate makes no
 * network call and spawns no process: it reads one small file and matches strings, so a
 * hook that has not finished in these budgets is a wedged hook, and killing it is right.
 */
export const STOP_TIMEOUT_SECONDS = 10;
export const POST_TOOL_TIMEOUT_SECONDS = 5;

const USAGE = `Usage: install-report-progress-gate.mjs [--mode observe|block] [--settings <path>]
       install-report-progress-gate.mjs --remove [--settings <path>]

observe  report to stderr what the gate would have blocked; never ends a turn. (default)
block    hold the turn for one more round when a turn that dispatched a subagent
         ends without a progress report. At most one block per turn.

The gate checks the SHAPE of the report — three section labels, and a state and a
freshness on a running row. It cannot check whether anything in the report is true.`;

function shellQuote(value) {
  return `'${String(value).split("'").join(`'\\''`)}'`;
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function resolveHome(env = process.env) {
  return env.HOME || homedir();
}

export function resolveSettingsPath(env = process.env) {
  return path.join(resolveHome(env), '.claude', 'settings.json');
}

export function resolveGatePath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), HOOK_MARKER);
}

/**
 * The two hook entries, built together because installing one without the other is a
 * broken gate: a Stop hook with nothing to arm it never fires, and a marker writer with
 * no Stop hook writes files nobody reads.
 *
 * The arming flag is written into the command itself rather than left to the ambient
 * environment. Hooks inherit whatever environment Claude Code happened to launch with —
 * a desktop launch inherits no shell profile at all — so a gate that depended on an
 * exported variable would be armed in a terminal session and silently inert in every
 * other one. Here the mode is visible in `settings.json`, on the line that runs it, and
 * editing that one word is how a user disarms the gate without uninstalling it.
 */
export function buildHookEntries({ mode, gatePath, nodePath = process.execPath }) {
  if (!MODES.includes(mode)) throw new Error(`mode must be one of: ${MODES.join(', ')}`);

  const command = `${GATE_ENV_FLAG}=${mode} ${shellQuote(nodePath)} ${shellQuote(gatePath)}`;
  const removal = 'remove it by running this installer with --remove';

  return {
    stop: {
      type: 'command',
      command,
      timeout: STOP_TIMEOUT_SECONDS,
      describe: mode === 'block'
        ? `${DESCRIBE_PREFIX} (block): on a turn that dispatched a subagent, holds the turn for one more round — once, never twice — when the final message has no "what is done / what is running / what is next" report; it matches the report's shape only and cannot verify anything in it, and ${removal}.`
        : `${DESCRIBE_PREFIX} (observe): on a turn that dispatched a subagent, writes to stderr what a blocking gate would have refused in the final message and never holds the turn; it matches the report's shape only and cannot verify anything in it, and ${removal}.`,
    },
    postToolUse: {
      type: 'command',
      command,
      timeout: POST_TOOL_TIMEOUT_SECONDS,
      describe: `${DESCRIBE_PREFIX} (${mode}, arming half): records that this turn dispatched a subagent, which is the only thing that lets the Stop half fire at all — without it the gate is silent on every turn, and ${removal}.`,
    },
  };
}

function isOurs(hook) {
  return plainObject(hook) && typeof hook.describe === 'string' && hook.describe.startsWith(DESCRIBE_PREFIX);
}

function wearsOurName(hook) {
  return plainObject(hook) && typeof hook.command === 'string' && hook.command.includes(HOOK_MARKER);
}

/** The groups for one event, validated. Anything shaped unexpectedly is refused rather
 *  than reshaped: this file is editing a settings file it does not own. */
function eventGroups(settings, event) {
  if (!Object.hasOwn(settings, 'hooks')) return [];
  if (!plainObject(settings.hooks)) throw new Error('refusing to write: the settings "hooks" key is not an object');
  if (!Object.hasOwn(settings.hooks, event)) return [];
  if (!Array.isArray(settings.hooks[event])) throw new Error(`refusing to write: "hooks.${event}" is not an array`);
  for (const group of settings.hooks[event]) {
    if (!plainObject(group) || !Array.isArray(group.hooks)) throw new Error(`refusing to write: a ${event} entry has an unexpected shape`);
  }
  return settings.hooks[event];
}

const EVENTS = Object.freeze([
  { event: 'Stop', matcher: STOP_MATCHER, key: 'stop' },
  { event: 'PostToolUse', matcher: AGENT_MATCHER, key: 'postToolUse' },
]);

/**
 * Merge both hooks into a parsed settings object without disturbing anything else in it.
 * A hook that wears our name but that we did not write is somebody else's decision, so it
 * is refused rather than replaced.
 */
export function installHooks(settings, { entries }) {
  if (!plainObject(settings)) throw new Error('refusing to write: settings must be a JSON object');

  for (const { event } of EVENTS) {
    for (const group of eventGroups(settings, event)) {
      for (const hook of group.hooks) {
        if (wearsOurName(hook) && !isOurs(hook)) {
          throw new Error(`refusing to write: a ${event} hook already runs this gate but was not written by this installer. Remove it by hand first.`);
        }
      }
    }
  }

  // Drop any previous copy of ours wherever it sits, so re-running this to change mode
  // replaces the gate instead of stacking a second one beside it — which would spend two
  // of the eight shared blocks on the same missing report.
  const { settings: cleaned } = removeHooks(settings);
  const hooks = plainObject(cleaned.hooks) ? cleaned.hooks : {};
  for (const { event, matcher, key } of EVENTS) {
    const groups = Array.isArray(hooks[event]) ? hooks[event] : [];
    let group = groups.find((candidate) => candidate.matcher === matcher);
    if (!group) {
      group = { matcher, hooks: [] };
      groups.push(group);
    }
    group.hooks.push(entries[key]);
    hooks[event] = groups;
  }
  cleaned.hooks = hooks;
  return cleaned;
}

/** Remove only our own hooks, and leave the file exactly as we found it otherwise. */
export function removeHooks(settings) {
  if (!plainObject(settings)) throw new Error('refusing to write: settings must be a JSON object');
  let removed = 0;
  for (const { event } of EVENTS) {
    const groups = eventGroups(settings, event);
    if (groups.length === 0) continue;
    for (const group of groups) {
      const kept = group.hooks.filter((hook) => !isOurs(hook));
      removed += group.hooks.length - kept.length;
      group.hooks = kept;
    }
    // Prune what we emptied, so removing leaves no residue behind.
    settings.hooks[event] = groups.filter((group) => group.hooks.length > 0);
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  if (plainObject(settings.hooks) && Object.keys(settings.hooks).length === 0) delete settings.hooks;
  return { settings, removed };
}

async function readSettings(settingsPath) {
  let raw;
  try {
    raw = await readFile(settingsPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return {};
    throw new Error(`refusing to write: settings file is unreadable (${error.message})`);
  }
  if (raw.trim() === '') return {};
  try {
    const parsed = JSON.parse(raw);
    if (!plainObject(parsed)) throw new Error('settings file is not a JSON object');
    return parsed;
  } catch (error) {
    // Never clobber a file we could not understand.
    throw new Error(`refusing to write: settings file is not valid JSON (${error.message})`);
  }
}

async function writeSettings(settingsPath, settings) {
  await mkdir(path.dirname(settingsPath), { recursive: true });
  const temporary = `${settingsPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`);
  await rename(temporary, settingsPath);
}

function parseArguments(argv) {
  const options = { mode: null, settingsPath: null, remove: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--mode') {
      index += 1;
      options.mode = argv[index] ?? '';
    } else if (argument === '--settings') {
      index += 1;
      options.settingsPath = argv[index] ?? '';
    } else if (argument === '--remove') options.remove = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`unknown argument: ${argument}`);
  }
  if (options.help) return options;
  if (options.remove) {
    if (options.mode) throw new Error('--remove takes no --mode');
    return options;
  }
  // The default is the mode that cannot cost anyone a turn.
  options.mode ??= 'observe';
  if (!MODES.includes(options.mode)) throw new Error(`--mode must be one of: ${MODES.join(', ')}`);
  return options;
}

export async function main(argv = process.argv.slice(2), context = {}) {
  const { env = process.env, stdout = process.stdout, stderr = process.stderr } = context;
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

  const settingsPath = options.settingsPath || resolveSettingsPath(env);
  try {
    const settings = await readSettings(settingsPath);
    if (options.remove) {
      const { settings: pruned, removed } = removeHooks(settings);
      await writeSettings(settingsPath, pruned);
      stdout.write(removed > 0
        ? `Removed ${removed} report-progress gate hook${removed === 1 ? '' : 's'} from ${settingsPath}.\nNo turn will be held again unless you install it back.\n`
        : `No report-progress gate was installed in ${settingsPath}. Nothing changed.\n`);
      return 0;
    }

    const entries = buildHookEntries({ mode: options.mode, gatePath: resolveGatePath() });
    const updated = installHooks(settings, { entries });
    await writeSettings(settingsPath, updated);

    stdout.write(`Installed the ${options.mode} report-progress gate into ${settingsPath}.\n`);
    stdout.write([
      '',
      'It is armed only on turns that dispatched a subagent through the Agent tool.',
      'Every other turn ends exactly as it would with the gate absent.',
      '',
      'It checks the SHAPE of the final message: that a "what is done", a "what is',
      'running" and a "what is next" section are present, and that a running row carries',
      'a literal state and a freshness. It cannot check whether a count is real, whether',
      'a child id exists, or whether an observation ever happened — a message that',
      'satisfies this gate can still be wrong, and only a reader can catch that.',
      '',
    ].join('\n'));
    if (options.mode === 'block') {
      stdout.write([
        'Block mode holds the turn for one more round, once, and then stands down: if the',
        'next message still has no report, the turn ends anyway. That ceiling is not',
        'politeness. Claude Code ends a turn after 8 consecutive Stop blocks, the budget is',
        'shared with every other Stop hook you have installed, and when it runs out the',
        'result comes back as a success with an empty answer.',
        '',
      ].join('\n'));
    } else {
      stdout.write([
        'Observe mode never holds a turn. It writes what it would have blocked to stderr,',
        'which Claude Code shows you and does not deliver to the model. Read a day of that',
        'before arming --mode block.',
        '',
      ].join('\n'));
    }
    stdout.write([
      `Disarm without uninstalling: change ${GATE_ENV_FLAG}=${options.mode} to`,
      `${GATE_ENV_FLAG}=off in the two commands this wrote. Remove it entirely: run this`,
      'script with --remove.',
      '',
    ].join('\n'));
    stdout.write(`\nHooks written:\n${JSON.stringify(entries, null, 2)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = await main();
}
