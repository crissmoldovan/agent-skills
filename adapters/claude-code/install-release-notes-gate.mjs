#!/usr/bin/env node
/**
 * Install, or remove, the Claude Code hook that makes a missing release note
 * non-skippable at the moment a release is actually cut.
 *
 * A user runs this. Nothing runs it for them, and no skill may run it on their
 * behalf: a hook that can refuse a tool call is the user's decision to arm, and a
 * gate installed by an agent on its own initiative is a gate nobody consented to.
 * The `release-notes` skill says so too, and carries no command that would.
 *
 * One hook, not two: `PreToolUse` with matcher `Bash`. The gate needs nothing
 * armed ahead of it, because the release command itself is the trigger — it reads
 * the command, decides whether it is a release, and reads the project's release
 * notes from disk. Scoped to `Bash` so it is not invoked on `Read`, `Edit` or any
 * of the hundreds of other tool calls around it.
 *
 * Two modes, and the distance between them is the point:
 *
 *   observe  The gate runs, checks the same command, and writes what it WOULD
 *            have refused to stderr. The release always proceeds. This is the
 *            mode to live with for a day before arming the other one.
 *   block    The gate returns `permissionDecision: "deny"` and the release
 *            command does not run.
 *
 * What the gate can and cannot do is fixed and small: it checks that the version
 * being released is MENTIONED in a file that records releases. It cannot tell
 * whether the paragraph under that mention says why the release happened or what
 * it breaks — a heading with a git-message body satisfies it and fails the skill.
 * Nothing this script writes — command, describe, or printed output — may imply
 * otherwise.
 *
 * And it is deliberately fail-open: a project with no release-note file anywhere is
 * allowed, silently, because that is a different convention and not a violation. So
 * an armed gate that never fires is the expected outcome in such a repository, not a
 * sign that the installation failed.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** Every hook this script writes carries the gate's filename in its command. */
export const HOOK_MARKER = 'release-notes-gate.sh';
/** …and this prefix in its `describe`, which is how we know a hook is ours. */
export const DESCRIBE_PREFIX = 'agent-skills release-notes gate';
/** The arming flag the gate reads. `off`, unset or anything else is off. */
export const GATE_ENV_FLAG = 'AGENT_SKILLS_RELEASE_NOTES_GATE';
/** The two armed modes this installer can write. `off` is not a mode; it is the default. */
export const MODES = Object.freeze(['observe', 'block']);

/** The one event the gate needs, and the tool it is scoped to. */
export const HOOK_EVENT = 'PreToolUse';
export const BASH_MATCHER = 'Bash';

/**
 * The session waits on this before every Bash call, so the ceiling is small. The gate makes
 * no network call: it reads a command string, a package.json, a release-note file, and in the
 * commit branch a staged diff. A hook that has not finished in this budget is a wedged hook,
 * and killing it is right — Claude Code treats a killed hook as no decision, which is the
 * fail-open answer this gate wants anyway.
 */
export const TIMEOUT_SECONDS = 10;

const USAGE = `Usage: install-release-notes-gate.mjs [--mode observe|block] [--settings <path>]
       install-release-notes-gate.mjs --remove [--settings <path>]

observe  report to stderr what the gate would have refused; never stops a release. (default)
block    refuse a publish, release-create, release tag or version-bump commit when the
         version being released is not mentioned in the project's release notes.

The gate checks that the version is PRESENT in a file that records releases. It cannot
check whether what is written there says why the release happened or what it breaks.`;

function shellQuote(value) {
  return `'${String(value).split("'").join(`'\\''`)}'`;
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Resolve BOTH sides to real paths before comparing. `process.argv[1]` keeps the symlink as
 * typed while `import.meta.url` is what Node resolved it to, and the Skills CLI installs a
 * pack as a symlink — so an as-typed comparison is false through exactly the path a user
 * runs, and the script exits 0 having printed nothing and written nothing.
 */
export function isEntrypoint(moduleUrl) {
  const invoked = process.argv[1];
  if (!invoked) return false;
  const modulePath = fileURLToPath(moduleUrl);
  try {
    return realpathSync.native(invoked) === realpathSync.native(modulePath);
  } catch {
    return path.resolve(invoked) === modulePath;
  }
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
 * The hook entry.
 *
 * The arming flag is written into the command itself rather than left to the ambient
 * environment. Hooks inherit whatever environment Claude Code happened to launch with — a
 * desktop launch inherits no shell profile at all — so a gate that depended on an exported
 * variable would be armed in a terminal session and silently inert in every other one. Here
 * the mode is visible in `settings.json`, on the line that runs it, and editing that one word
 * to `off` is how a user disarms the gate without uninstalling it.
 *
 * The interpreter is named explicitly rather than relying on the script's execute bit and
 * shebang. A checkout that lost the mode bit — a zip download, a copy through a filesystem
 * that does not carry it, an archive extracted by a tool that drops it — would otherwise
 * produce a hook that fails to launch on every Bash call.
 */
export function buildHookEntry({ mode, gatePath, shellPath = 'bash' }) {
  if (!MODES.includes(mode)) throw new Error(`mode must be one of: ${MODES.join(', ')}`);

  const command = `${GATE_ENV_FLAG}=${mode} ${shellPath} ${shellQuote(gatePath)}`;
  const removal = 'remove it by running this installer with --remove';

  return {
    type: 'command',
    command,
    timeout: TIMEOUT_SECONDS,
    describe: mode === 'block'
      ? `${DESCRIBE_PREFIX} (block): refuses a publish, release-create, release tag or version-bump commit when the version being released is not mentioned in the project's release notes; it checks that a note is present and cannot check what it says, it allows anything it cannot resolve, and ${removal}.`
      : `${DESCRIBE_PREFIX} (observe): writes to stderr what a blocking gate would have refused about a release command and never stops one; it checks that a note is present and cannot check what it says, it allows anything it cannot resolve, and ${removal}.`,
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

/**
 * Merge the hook into a parsed settings object without disturbing anything else in it.
 * A hook that wears our name but that we did not write is somebody else's decision, so it
 * is refused rather than replaced.
 */
export function installHook(settings, { entry }) {
  if (!plainObject(settings)) throw new Error('refusing to write: settings must be a JSON object');

  for (const group of eventGroups(settings, HOOK_EVENT)) {
    for (const hook of group.hooks) {
      if (wearsOurName(hook) && !isOurs(hook)) {
        throw new Error(`refusing to write: a ${HOOK_EVENT} hook already runs this gate but was not written by this installer. Remove it by hand first.`);
      }
    }
  }

  // Drop any previous copy of ours wherever it sits, so re-running this to change mode
  // replaces the gate instead of stacking a second one beside it — which would ask the same
  // question twice and print the same refusal twice.
  const { settings: cleaned } = removeHook(settings);
  const hooks = plainObject(cleaned.hooks) ? cleaned.hooks : {};
  const groups = Array.isArray(hooks[HOOK_EVENT]) ? hooks[HOOK_EVENT] : [];
  let group = groups.find((candidate) => candidate.matcher === BASH_MATCHER);
  if (!group) {
    group = { matcher: BASH_MATCHER, hooks: [] };
    groups.push(group);
  }
  group.hooks.push(entry);
  hooks[HOOK_EVENT] = groups;
  cleaned.hooks = hooks;
  return cleaned;
}

/** Remove only our own hook, and leave the file exactly as we found it otherwise. */
export function removeHook(settings) {
  if (!plainObject(settings)) throw new Error('refusing to write: settings must be a JSON object');
  let removed = 0;
  const groups = eventGroups(settings, HOOK_EVENT);
  if (groups.length > 0) {
    for (const group of groups) {
      const kept = group.hooks.filter((hook) => !isOurs(hook));
      removed += group.hooks.length - kept.length;
      group.hooks = kept;
    }
    // Prune what we emptied, so removing leaves no residue behind.
    settings.hooks[HOOK_EVENT] = groups.filter((group) => group.hooks.length > 0);
    if (settings.hooks[HOOK_EVENT].length === 0) delete settings.hooks[HOOK_EVENT];
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
  // The default is the mode that cannot cost anyone a release.
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
      const { settings: pruned, removed } = removeHook(settings);
      await writeSettings(settingsPath, pruned);
      stdout.write(removed > 0
        ? `Removed ${removed} release-notes gate hook${removed === 1 ? '' : 's'} from ${settingsPath}.\nNo release will be refused again unless you install it back.\n`
        : `No release-notes gate was installed in ${settingsPath}. Nothing changed.\n`);
      return 0;
    }

    const entry = buildHookEntry({ mode: options.mode, gatePath: resolveGatePath() });
    const updated = installHook(settings, { entry });
    await writeSettings(settingsPath, updated);

    stdout.write(`Installed the ${options.mode} release-notes gate into ${settingsPath}.\n`);
    stdout.write([
      '',
      'It looks at Bash commands only, and only at four shapes: npm/pnpm/yarn publish and',
      'changeset publish, gh/glab release create, a release-looking git tag, and a commit that',
      'stages a package.json version bump. Every other command is untouched.',
      '',
      'It checks that the version being released is MENTIONED in a file that records releases',
      '(CHANGELOG.md and its usual spellings, docs/releases.md, docs/releases/, a pending',
      '.changeset/ entry). It cannot check whether what is written there says why the release',
      'happened or what it breaks — a heading with a git-message body satisfies this gate and',
      'fails the skill. It is a floor, not a grade.',
      '',
      'It allows anything it cannot resolve confidently, including a project with no',
      'release-note file at all. In such a repository an armed gate never fires, and that is',
      'the design rather than a failed installation.',
      '',
    ].join('\n'));
    if (options.mode === 'block') {
      stdout.write([
        'Block mode returns a permission denial, so the release command does not run. That',
        'decision shape is documented by the harness and was not observed firing in this',
        "pack's own probes (adapters/HOOK-OUTPUT-NOTES.md) — read a run of observe mode from",
        'this hook before depending on block mode to stop anything.',
        '',
      ].join('\n'));
    } else {
      stdout.write([
        'Observe mode never stops a release. It writes what it would have refused to stderr.',
        'Whether Claude Code surfaces a PreToolUse hook\'s stderr at exit 0 is not something',
        "this pack has observed, so confirm you can see that line before trusting it as the",
        'way you will notice the gate working.',
        '',
      ].join('\n'));
    }
    stdout.write([
      `Disarm without uninstalling: change ${GATE_ENV_FLAG}=${options.mode} to`,
      `${GATE_ENV_FLAG}=off in the command this wrote. Remove it entirely: run this`,
      'script with --remove.',
      '',
    ].join('\n'));
    stdout.write(`\nHook written:\n${JSON.stringify(entry, null, 2)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (isEntrypoint(import.meta.url)) {
  process.exitCode = await main();
}
