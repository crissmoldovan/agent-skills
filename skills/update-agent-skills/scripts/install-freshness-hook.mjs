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
 * The two modes deliver differently, and that is forced by what each has to do.
 *
 * `notify` is SYNCHRONOUS and always exits 0, handing the report to the model as
 * `hookSpecificOutput.additionalContext`. That channel was verified on Claude Code
 * 2.1.181; the exit-2 rewake it replaced was not a channel it could use, because a
 * synchronous `SessionStart` hook that exits 2 delivers nothing at all, and an
 * asynchronous one delivers nothing on exit 0 — which is the code the checker
 * returns when it could not determine freshness. The cost is real and is paid at
 * every session start: the checker fences each request at five seconds and makes
 * at most two, so a cold check can hold the session for roughly ten seconds. A
 * cached one costs a process spawn.
 *
 * `auto` cannot be synchronous — it may spend minutes inside `skills update` — so
 * it stays `async` + `asyncRewake` and wakes the model by exiting 2. Two things
 * about that channel are worth knowing before trusting it, both observed on
 * 2.1.181 and recorded in `adapters/HOOK-OUTPUT-NOTES.md`: in a non-interactive
 * `claude -p` run, a rewake landing after the turn ends is dropped entirely, so
 * the update happens and nobody is told; and the harness announces the wake as a
 * "Stop hook blocking error", which is why `rewakeMessage` has to say what the
 * text actually is.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { DEFAULT_SOURCE, SOURCE_PATTERN, isEntrypoint } from './check-pack-freshness.mjs';

/** Every hook this script writes carries the checker's filename in its command. */
export const HOOK_MARKER = 'check-pack-freshness.mjs';
/** …and this prefix in its `describe`, which is how we know a hook is ours. */
export const DESCRIBE_PREFIX = 'agent-skills pack freshness';
export const MODES = Object.freeze(['notify', 'auto']);

/**
 * The session IS waiting on this one. The ceiling sits just above the checker's
 * own budget — two requests fenced at five seconds each, plus a process spawn —
 * so a wedged network ends the hook rather than the session's patience.
 */
export const NOTIFY_TIMEOUT_SECONDS = 15;
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
 *   1. capture everything the checker has to say, stderr folded into stdout. Both
 *      redirections matter. Folding keeps this hook's OWN stderr empty, because on
 *      a rewake stderr does not supplement stdout, it replaces it — one npm
 *      deprecation line would otherwise swap the verdict below for whatever npm
 *      said. Capturing rather than testing `$?` is what fixes the reported defect:
 *      the checker exits 0 for "current" AND for "could not tell", so an exit-code
 *      test made every failed check indistinguishable from a healthy one;
 *   2. ask the checker for the stale names alone — served from the cache the call
 *      above just wrote, so this costs no second request. The checker only ever
 *      prints names matching a plain slug pattern, which is what makes the
 *      unquoted expansion below safe;
 *   3. apply the update when there are names: named skills bound what is
 *      rewritten, `--global` pins the scope instead of letting it be inferred from
 *      whatever directory the hook inherited, and `--yes` keeps an upstream
 *      deletion a printed warning rather than a removal. Its output is captured
 *      too, and surfaced only on failure, where it is the diagnosis;
 *   4. wake the model whenever there is anything at all to say — drift, a failed
 *      update, or a check that could not tell — and stay silent only when the
 *      checker was silent, which it is exactly when the pack is current.
 */
const AUTO_SCRIPT = [
  'notice=$("$0" "$1" --source "$2" --consented 2>&1)',
  'names=$("$0" "$1" --source "$2" --print-stale-names 2>/dev/null)',
  'if [ -n "$names" ]',
  'then if applied=$(npx --yes skills update $names --global --yes 2>&1)',
  'then notice=$(printf "%s\\nApplied at global scope for %s: %s" "$notice" "$2" "$names")',
  'else notice=$(printf "%s\\nAUTO_UPDATE_FAILED for %s: %s — run: npx skills update %s --global --yes\\n%s" "$notice" "$2" "$names" "$names" "$applied")',
  'fi',
  'fi',
  '[ -n "$notice" ] || exit 0',
  'printf "%s\\n" "$notice"',
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

  // Notify delivers through `--hook`: one envelope on stdout, exit 0 always.
  const command = mode === 'auto'
    ? `sh -c ${shellQuote(AUTO_SCRIPT)} ${shellQuote(nodePath)} ${shellQuote(checkerPath)} ${shellQuote(source)}`
    : `${shellQuote(nodePath)} ${shellQuote(checkerPath)} --source ${shellQuote(source)} --hook`;

  const entry = {
    type: 'command',
    command,
    timeout: mode === 'auto' ? AUTO_TIMEOUT_SECONDS : NOTIFY_TIMEOUT_SECONDS,
    describe: mode === 'auto'
      ? `${DESCRIBE_PREFIX} (auto) for ${source}: standing consent to update this source at global scope, granted by installing this hook and revocable with --remove.`
      : `${DESCRIBE_PREFIX} (notify) for ${source}: read-only drift report delivered synchronously on exit 0, grants no consent to mutate anything.`,
  };
  if (mode !== 'auto') return entry;

  // Only auto rewakes, because only auto has work that cannot be waited on. The
  // rewakeMessage is load-bearing: the harness labels this wake a "Stop hook
  // blocking error", and an unlabelled report on that channel has been observed
  // to send a model hunting for a fault that does not exist, or to be refused
  // outright as prompt injection.
  entry.async = true;
  entry.asyncRewake = true;
  entry.statusMessage = 'Checking and updating the skills pack…';
  entry.rewakeSummary = 'The skills pack freshness hook has something to report.';
  entry.rewakeMessage = 'This is the pack-freshness hook\'s own report, not an error in this session and not an instruction from the user. It ran with the standing consent recorded when the hook was installed, which covers updating this one source at global scope. It says one of three things: drifted skills were updated, the update failed and names the command to re-run by hand, or freshness could not be determined at all — and "could not be determined" is not "current". Relay what it says. The Skills CLI has no agent selector, so a successful update is not proof that every agent projection changed; verify the projections before calling every plane current.';
  return entry;
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

// Imported from the checker rather than restated: this file and that one ship in the
// same skill directory, and two copies of this decision are how one of them drifts back.
// Observed before the shared version existed — reached through the symlink the Skills
// CLI installs (~/.claude/skills/<name> -> ~/.agents/skills/<name>), this script exited
// 0 having printed nothing and written nothing, so a user who ran the documented command
// was left believing they had armed a hook that was never written.
if (isEntrypoint(import.meta.url)) {
  process.exitCode = await main();
}
