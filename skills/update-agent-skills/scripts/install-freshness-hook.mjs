#!/usr/bin/env node
/**
 * Install, or remove, a Claude Code `SessionStart` hook that reports whether an
 * installed skill pack has drifted from its published source.
 *
 * A user runs this. Nothing runs it for them, and no skill may run it on their
 * behalf: choosing to be told about updates is the user's decision, and choosing
 * to have updates applied is a much larger one.
 *
 * Two modes, and the distance between them is the whole point:
 *
 *   notify  The hook runs the read-only checker and prints what it found. It
 *           cannot mutate anything, because the checker cannot mutate anything.
 *
 *   auto    The hook runs the checker and, when it reports drift, applies the
 *           exact named, global-scoped, non-interactive update it printed.
 *           Installing this mode IS the user's standing consent to that, for
 *           that source and that scope, until they remove it with `--remove`.
 *
 * The hook is asynchronous so it never delays the start of a session, and it
 * rewakes the model on exit code 2 so the notice reaches the conversation
 * instead of scrolling past in a terminal.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { DEFAULT_SOURCE, SOURCE_PATTERN } from './check-pack-freshness.mjs';

/** Every hook this script writes carries the checker's filename in its command. */
export const HOOK_MARKER = 'check-pack-freshness.mjs';
/** …and this prefix in its `describe`, which is how we know a hook is ours. */
export const DESCRIBE_PREFIX = 'agent-skills pack freshness';
export const MODES = Object.freeze(['notify', 'auto']);

/** One short fetch plus overhead. The session is not waiting on this anyway. */
export const NOTIFY_TIMEOUT_SECONDS = 20;
/**
 * Long enough that an update is never killed halfway through rewriting a skill
 * tree. It costs nothing to allow: the hook is asynchronous.
 */
export const AUTO_TIMEOUT_SECONDS = 300;

const USAGE = `Usage: install-freshness-hook.mjs --mode notify|auto [--source <owner>/<repo>] [--settings <path>]
       install-freshness-hook.mjs --remove [--settings <path>]

notify  report drift only; never mutates anything.
auto    apply the named, global-scoped update when drift is found. Installing
        auto mode is your standing consent for that source and that scope.`;

/**
 * The auto-mode hook body. Written to take its paths as positional arguments so
 * that no path is ever interpolated into the script text, and read in the order
 * it runs:
 *
 *   1. run the checker, which prints the notice and exits 2 on drift;
 *   2. anything other than drift ends here;
 *   3. ask the checker for the stale names alone — served from the cache the
 *      call above just wrote, so this costs no second request. The checker only
 *      ever prints names matching a plain slug pattern, which is what makes the
 *      unquoted expansion below safe;
 *   4. apply the update: named skills bound what is rewritten, `--global` pins
 *      the scope instead of letting it be inferred from whatever directory the
 *      hook inherited, and `--yes` keeps an upstream deletion a printed warning
 *      rather than a removal;
 *   5. exit 2 either way, so a failed auto-update is reported rather than
 *      swallowed. A check whose good path is silent must never let a failure
 *      look like good news.
 */
const AUTO_SCRIPT = [
  '"$0" "$1" --source "$2" --consented',
  'status=$?',
  '[ "$status" -eq 2 ] || exit "$status"',
  'names=$("$0" "$1" --source "$2" --print-stale-names)',
  '[ -n "$names" ] || exit 0',
  'if npx --yes skills update $names --global --yes',
  'then printf "Applied at global scope for %s: %s\\n" "$2" "$names"',
  'else printf "AUTO_UPDATE_FAILED for %s: %s — run: npx skills update %s --global --yes\\n" "$2" "$names" "$names"',
  'fi',
  'exit 2',
].join('; ');

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

export function resolveCheckerPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), HOOK_MARKER);
}

export function buildHookEntry({ mode, source, checkerPath, nodePath = process.execPath }) {
  if (!MODES.includes(mode)) throw new Error(`mode must be one of: ${MODES.join(', ')}`);
  if (!SOURCE_PATTERN.test(source)) throw new Error('source must be <owner>/<repo>');

  const command = mode === 'auto'
    ? `sh -c ${shellQuote(AUTO_SCRIPT)} ${shellQuote(nodePath)} ${shellQuote(checkerPath)} ${shellQuote(source)}`
    : `${shellQuote(nodePath)} ${shellQuote(checkerPath)} --source ${shellQuote(source)}`;

  return {
    type: 'command',
    command,
    timeout: mode === 'auto' ? AUTO_TIMEOUT_SECONDS : NOTIFY_TIMEOUT_SECONDS,
    async: true,
    asyncRewake: true,
    statusMessage: mode === 'auto' ? 'Checking and updating the skills pack…' : 'Checking whether the skills pack moved…',
    rewakeSummary: mode === 'auto'
      ? 'The skills pack drifted and the standing auto-update ran.'
      : 'A newer version of the skills pack is available.',
    rewakeMessage: mode === 'auto'
      ? 'The installed skills pack drifted from its published source and was updated at global scope under the standing consent recorded when this hook was installed. Report what changed. The Skills CLI has no agent selector, so a successful update is not proof that every agent projection changed — verify the projections before calling every plane current.'
      : 'The installed skills pack has drifted from its published source. Report this to the user together with the exact update command. Being told about an update is not permission to apply one: do not update anything without the user explicitly naming the scope.',
    describe: mode === 'auto'
      ? `${DESCRIBE_PREFIX} (auto) for ${source}: standing consent to update this source at global scope, granted by installing this hook and revocable with --remove.`
      : `${DESCRIBE_PREFIX} (notify) for ${source}: read-only drift report, grants no consent to mutate anything.`,
  };
}

function isOurs(hook) {
  return plainObject(hook) && typeof hook.describe === 'string' && hook.describe.startsWith(DESCRIBE_PREFIX);
}

function wearsOurName(hook) {
  return plainObject(hook) && typeof hook.command === 'string' && hook.command.includes(HOOK_MARKER);
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

/**
 * Merge our hook into a parsed settings object without disturbing anything else
 * in it. A hook that wears our name but that we did not write is somebody else's
 * decision, so it is refused rather than replaced.
 */
export function installHook(settings, { entry }) {
  if (!plainObject(settings)) throw new Error('refusing to write: settings must be a JSON object');

  const groups = sessionStartGroups(settings);
  for (const group of groups) {
    for (const hook of group.hooks) {
      if (wearsOurName(hook) && !isOurs(hook)) {
        throw new Error('refusing to write: a SessionStart hook already runs this checker but was not written by this installer. Remove it by hand first.');
      }
    }
  }

  // Drop any previous copy of ours wherever it sits, so re-running this to change
  // mode replaces the hook instead of stacking a second one beside it.
  const { settings: cleaned } = removeHook(settings);
  const hooks = plainObject(cleaned.hooks) ? cleaned.hooks : {};
  const sessionStart = Array.isArray(hooks.SessionStart) ? hooks.SessionStart : [];
  let startup = sessionStart.find((group) => group.matcher === 'startup');
  if (!startup) {
    startup = { matcher: 'startup', hooks: [] };
    sessionStart.push(startup);
  }
  startup.hooks.push(entry);
  hooks.SessionStart = sessionStart;
  cleaned.hooks = hooks;
  return cleaned;
}

/** Remove only our own hooks, and leave the file exactly as we found it otherwise. */
export function removeHook(settings) {
  if (!plainObject(settings)) throw new Error('refusing to write: settings must be a JSON object');
  const groups = sessionStartGroups(settings);
  let removed = 0;
  for (const group of groups) {
    const kept = group.hooks.filter((hook) => !isOurs(hook));
    removed += group.hooks.length - kept.length;
    group.hooks = kept;
  }
  if (removed > 0) {
    // Prune what we emptied, so removing leaves no residue behind.
    settings.hooks.SessionStart = groups.filter((group) => group.hooks.length > 0);
    if (settings.hooks.SessionStart.length === 0) delete settings.hooks.SessionStart;
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  }
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
  const options = { mode: null, source: DEFAULT_SOURCE, settingsPath: null, remove: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--mode') {
      index += 1;
      options.mode = argv[index] ?? '';
    } else if (argument === '--source') {
      index += 1;
      options.source = argv[index] ?? '';
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
  options.mode ??= 'notify';
  if (!MODES.includes(options.mode)) throw new Error(`--mode must be one of: ${MODES.join(', ')}`);
  if (!SOURCE_PATTERN.test(options.source)) throw new Error('--source must be <owner>/<repo>');
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
      const { settings: pruned, removed } = removeHook(settings);
      await writeSettings(settingsPath, pruned);
      stdout.write(removed > 0
        ? `Removed ${removed} freshness hook${removed === 1 ? '' : 's'} from ${settingsPath}.\nAny standing consent to auto-update is withdrawn.\n`
        : `No freshness hook was installed in ${settingsPath}. Nothing changed.\n`);
      return 0;
    }

    const entry = buildHookEntry({ mode: options.mode, source: options.source, checkerPath: resolveCheckerPath() });
    const updated = installHook(settings, { entry });
    await writeSettings(settingsPath, updated);

    stdout.write(`Installed the ${options.mode} freshness hook for ${options.source} into ${settingsPath}.\n`);
    if (options.mode === 'auto') {
      stdout.write([
        '',
        'Installing auto mode is your standing consent: from now on, when a session',
        `starts and ${options.source} has moved, the drifted skills are updated at`,
        'global scope on this machine without asking again. That consent covers this',
        'source and this scope only — no other pack, no project scope, and no upstream',
        'deletion, which stays a separate confirmed operation.',
        '',
        'Withdraw it at any time by running this script with --remove.',
        '',
        'The Skills CLI has no agent selector, so an applied update is not proof that',
        'every agent projection changed. Verify the projections before treating every',
        'plane as current.',
        '',
      ].join('\n'));
    } else {
      stdout.write('This hook only reports. It grants no permission to change anything.\n');
    }
    stdout.write(`\nHook written:\n${JSON.stringify(entry, null, 2)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = await main();
}
