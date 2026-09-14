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
 *
 * OWNERSHIP IS READ FROM THE COMMAND. Claude Code drops `describe` from every hook entry whenever
 * it writes a settings file, and keeps `command`, `matcher` and `timeout` byte for byte
 * (adapters/HOOK-OUTPUT-NOTES.md, third and fourth addenda of 2026-09-14). Until now this installer
 * recognised its hook by `describe`, so on a rewritten file `--remove` printed "No release-notes gate
 * was installed … Nothing changed." and exited 0 with the hook still running, and an install refused.
 * A hook is now this installer's when its command carries the fingerprint `./hook-ownership.mjs`
 * defines: `AGENT_SKILLS_RELEASE_NOTES_GATE=` among its leading assignments, and an argument whose
 * basename is exactly `release-notes-gate.sh`. Every command this installer has written has that
 * shape. A `describe` written by anything else is a statement of ownership, and that hook is never
 * taken, with or without a flag.
 *
 * `--adopt` is for what is left: a hook that runs the gate WITHOUT the assignment leading its command,
 * which is a hand-wiring. It is refused on install and named on removal; with `--adopt` it is removed
 * or replaced. `--remove` never reports the gate gone while any hook still runs it, and exits 1 when
 * one does.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  classifyHook,
  eventKeys,
  findUnownedHooks,
  hookLabel,
  isReadableGroup,
  leadingAssignments,
  plainObject,
  readableGroups,
} from './hook-ownership.mjs';

/** The gate file. A hook is this installer's when an argument of its command has exactly this basename… */
export const HOOK_MARKER = 'release-notes-gate.sh';
/** …and the gate's own assignment leads that command. This prefix still starts every `describe`
 *  written, and a describe that does not start with it vetoes ownership. */
export const DESCRIBE_PREFIX = 'agent-skills release-notes gate';
/** The arming flag the gate reads. `off`, unset or anything else is off. */
export const GATE_ENV_FLAG = 'AGENT_SKILLS_RELEASE_NOTES_GATE';
/** The two armed modes this installer can write. `off` is not a mode; it is the default. */
export const MODES = Object.freeze(['observe', 'block']);

/** The one event the gate needs, and the tool it is scoped to. */
export const HOOK_EVENT = 'PreToolUse';
export const BASH_MATCHER = 'Bash';

/**
 * The session waits on this before every Bash call, so the ceiling is small. The gate makes no
 * network call: it reads a command string, a package.json, a release-note file, and in the
 * commit branch a staged diff. A hook that has not finished in this budget is a wedged hook,
 * and killing it is right — Claude Code treats a killed hook as no decision, which is the
 * fail-open answer this gate wants anyway.
 */
export const TIMEOUT_SECONDS = 10;

/** What `./hook-ownership.mjs` needs to tell this installer's hook from anybody else's. */
const IDENTITY = Object.freeze({ envFlag: GATE_ENV_FLAG, gateFile: HOOK_MARKER, describePrefix: DESCRIBE_PREFIX });

export { hookLabel };

const USAGE = `Usage: install-release-notes-gate.mjs [--mode observe|block] [--adopt] [--settings <path>]
       install-release-notes-gate.mjs --remove [--adopt] [--settings <path>]

observe  report to stderr what the gate would have refused; never stops a release. (default)
block    refuse a publish, release-create, release tag or version-bump commit when the
         version being released is not mentioned in the project's release notes.
         --mode is not carried over: a re-run that changes the mode of the gate already in
         the settings file says so.

--adopt  treat a hook that runs the gate WITHOUT the AGENT_SKILLS_RELEASE_NOTES_GATE=
         assignment leading its command — a hand-wiring — as this installer's own: --remove
         removes it, and an install replaces it. Not needed for this installer's own hook:
         every command it writes starts with that assignment, and that is how it recognises
         it, including after Claude Code has dropped its describe. A hook whose describe
         something else wrote is never adopted. Without --adopt, --remove names every
         hand-wiring it left and exits 1, and an install refuses and names them.

The gate checks that the version is PRESENT in a file that records releases. It cannot
check whether what is written there says why the release happened or what it breaks.`;

function shellQuote(value) {
  return `'${String(value).split("'").join(`'\\''`)}'`;
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
 * to `off` is how a user disarms the gate without uninstalling it. It is also, now, how this
 * installer recognises the hook as its own.
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

/**
 * Every hook that runs this gate but is not this installer's: where it sits, and which kind it is —
 * `adoptable` (a hand-wiring; `--adopt` can take it) or `foreign` (a describe something else wrote;
 * never adopted). Scanned over every event key, because a hook nobody can see is a hook nobody can
 * remove.
 */
export function findUnownedGateHooks(settings) {
  return findUnownedHooks(settings, IDENTITY);
}

/** One line per unowned hook, saying what it is and what can be done about it. */
function unownedLines(unowned) {
  return unowned.map((hook) => (hook.kind === 'adoptable'
    ? `  - ${hookLabel(hook)}: runs this gate, but its command does not start with the ${GATE_ENV_FLAG}= assignment every command this installer writes starts with, so it is not recognised as this installer's own. A hand-wiring looks like this.`
    : `  - ${hookLabel(hook)}: runs this gate under a describe this installer did not write, so it is never adopted — remove it by hand, or with whatever wrote it.`));
}

function countOf(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** What `release-notes-gate.sh` makes of its flag: lower-cased, blanks removed, `block` or `1` blocks,
 *  `observe` observes, anything else — unset included — is off. */
function gateModeOf(value) {
  const raw = String(value ?? '').toLowerCase().replace(/\s/g, '');
  if (raw === 'block' || raw === '1') return 'block';
  if (raw === 'observe') return 'observe';
  return 'off';
}

/**
 * The mode the gate already in this file runs in, so that a re-run which changes it can say so. `--mode`
 * defaults to `observe` and is not carried over; before this installer recognised a hook the harness had
 * stripped of `describe`, a bare re-run over a block-mode gate refused, and once it did recognise one the
 * same re-run disarmed it to observe in silence.
 *
 * Read only from a hook an install is about to replace — this installer's own, and under `--adopt` a
 * hand-wiring — and only from the leading assignment the shell hands the gate. `null` when there is no
 * such hook; `{ mode: null }` when a hook also sets the flag anywhere else, because a mode that cannot be
 * read cannot be reported as changed.
 */
export function readInstalledMode(settings, { adopt = false } = {}) {
  if (!plainObject(settings)) return null;
  let adopted = null;
  for (const event of eventKeys(settings)) {
    for (const group of readableGroups(settings, event) ?? []) {
      for (const hook of group.hooks) {
        const kind = classifyHook(hook, IDENTITY);
        if (kind !== 'ours' && !(adopt && kind === 'adoptable')) continue;
        const assigned = leadingAssignments(hook.command).filter((entry) => entry.name === GATE_ENV_FLAG);
        const mentions = hook.command.match(new RegExp(`(?<![A-Za-z0-9_])${GATE_ENV_FLAG}=`, 'g'))?.length ?? 0;
        const found = { mode: mentions === assigned.length ? gateModeOf(assigned.at(-1)?.value) : null };
        if (kind === 'ours') return found;
        adopted ??= found;
      }
    }
  }
  return adopted;
}

/** One line when this run changed the mode of the gate already in the file; `null` when it did not. */
function describeModeChange({ modeGiven, existing, mode }) {
  if (!existing || existing.mode === mode) return null;
  if (existing.mode === null) {
    return modeGiven ? null : `Mode ${mode}, the default — the mode the gate already in this file ran in could not be read from its command. Pass --mode observe or --mode block to choose it.`;
  }
  if (modeGiven) return `Set mode ${mode} (was ${existing.mode}).`;
  if (existing.mode === 'off') {
    return `Mode ${mode}, the default — the gate already in this file was disarmed (off), and this run armed it again. To keep it disarmed, set ${GATE_ENV_FLAG}=off in its command again, or run this script with --remove.`;
  }
  return `Mode ${mode}, the default — the gate already in this file ran in ${existing.mode} mode. Pass --mode ${existing.mode} to keep it.`;
}

/** The groups for the one event this script WRITES into, validated. Anything shaped unexpectedly
 *  is refused rather than reshaped: this file is editing a settings file it does not own. */
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
 * A hook that runs the gate but is not this installer's is somebody else's decision, so it
 * is refused rather than replaced — scanned under every event key, and named, so the refusal
 * is something a user can act on. `--adopt` lifts it for a hand-wiring, never for a hook under
 * somebody else's describe.
 */
export function installHook(settings, { entry, adopt = false }) {
  if (!plainObject(settings)) throw new Error('refusing to write: settings must be a JSON object');

  const blockers = findUnownedGateHooks(settings).filter((hook) => !(adopt && hook.kind === 'adoptable'));
  if (blockers.length > 0) {
    const lines = ['refusing to write: each hook below already runs this gate but was not written by this installer.', ...unownedLines(blockers)];
    if (blockers.some((hook) => hook.kind === 'adoptable')) {
      lines.push(`Run this script again with --adopt to treat each hook that runs this gate without the ${GATE_ENV_FLAG}= assignment as this installer's own and replace it.`);
    }
    throw new Error(lines.join('\n'));
  }
  // Validated only where we are about to WRITE.
  eventGroups(settings, HOOK_EVENT);

  // Drop any previous copy of ours wherever it sits, so re-running this to change mode
  // replaces the gate instead of stacking a second one beside it — which would ask the same
  // question twice and print the same refusal twice.
  const { settings: cleaned } = removeHook(settings, { adopt });
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

/**
 * Remove only our own hook, and leave the file exactly as we found it otherwise.
 *
 * EVENT-AGNOSTIC, like the report-progress installer's removal: every key under `settings.hooks` is
 * scanned, so a hook of ours moved by hand, or left under a key a later version stops writing, is
 * still reachable. A group this script cannot read is somebody else's and is put back untouched.
 *
 * With `adopt`, a hand-wiring goes too. `removed` counts every hook taken out, adopted ones included;
 * `unowned` is what still runs the gate afterwards, so no caller can report the gate gone while a
 * hook is still running it.
 */
export function removeHook(settings, { adopt = false } = {}) {
  if (!plainObject(settings)) throw new Error('refusing to write: settings must be a JSON object');
  let removed = 0;
  let adopted = 0;
  for (const event of eventKeys(settings)) {
    const groups = readableGroups(settings, event);
    if (groups === null || groups.length === 0) continue;
    for (const group of groups) {
      const kept = group.hooks.filter((hook) => {
        const kind = classifyHook(hook, IDENTITY);
        if (kind === 'ours') return false;
        if (adopt && kind === 'adoptable') {
          adopted += 1;
          return false;
        }
        return true;
      });
      removed += group.hooks.length - kept.length;
      group.hooks = kept;
    }
    // Prune what we emptied, so removing leaves no residue behind.
    settings.hooks[event] = settings.hooks[event].filter((group) => !isReadableGroup(group) || group.hooks.length > 0);
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  if (plainObject(settings.hooks) && Object.keys(settings.hooks).length === 0) delete settings.hooks;
  return { settings, removed, adopted, unowned: findUnownedGateHooks(settings) };
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
  const options = { mode: null, modeGiven: false, settingsPath: null, remove: false, adopt: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--mode') {
      index += 1;
      options.mode = argv[index] ?? '';
    } else if (argument === '--settings') {
      index += 1;
      options.settingsPath = argv[index] ?? '';
    } else if (argument === '--remove') options.remove = true;
    else if (argument === '--adopt') options.adopt = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`unknown argument: ${argument}`);
  }
  if (options.help) return options;
  if (options.remove) {
    if (options.mode) throw new Error('--remove takes no --mode');
    return options;
  }
  // The default is the mode that cannot cost anyone a release.
  options.modeGiven = options.mode !== null;
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
      // Named before removal, because removal edits `settings` in place.
      const adoptable = options.adopt ? findUnownedGateHooks(settings).filter((hook) => hook.kind === 'adoptable') : [];
      const { settings: pruned, removed, adopted, unowned } = removeHook(settings, { adopt: options.adopt });
      // Written only when something was removed: a run that removed nothing leaves the file byte
      // for byte as it found it, and creates no file that did not exist.
      if (removed > 0) await writeSettings(settingsPath, pruned);
      const report = [];
      if (removed > 0) report.push(`Removed ${countOf(removed, 'release-notes gate hook')} from ${settingsPath}.`);
      if (options.adopt) {
        report.push(adopted > 0
          ? `Adopted ${adopted} of them: ${adopted === 1 ? 'a hook' : 'hooks'} that ran this gate without the ${GATE_ENV_FLAG}= assignment — ${adoptable.map(hookLabel).join(', ')}.`
          : `Adopted none: no hook in this file ran this gate without the ${GATE_ENV_FLAG}= assignment.`);
      }
      // THE GATE IS GONE ONLY WHEN NOTHING RUNS IT. This branch once printed "No release-notes gate
      // was installed … Nothing changed." and exited 0 while the harness-rewritten hook kept running.
      if (unowned.length === 0) {
        report.push(removed > 0
          ? 'No release will be refused again unless you install it back.'
          : `No release-notes gate was installed in ${settingsPath}. Nothing changed.`);
        stdout.write(`${report.join('\n')}\n`);
        return 0;
      }
      if (report.length > 0) stdout.write(`${report.join('\n')}\n`);
      const still = [
        `${removed > 0 ? 'The gate is not gone' : 'Nothing was removed, and the gate is not gone'}: ${countOf(unowned.length, 'hook')} in ${settingsPath} still ${unowned.length === 1 ? 'runs' : 'run'} it, and this installer did not write ${unowned.length === 1 ? 'it' : 'them'}.`,
        ...unownedLines(unowned),
      ];
      if (unowned.some((hook) => hook.kind === 'adoptable')) {
        still.push(`To remove each hook that runs this gate without the ${GATE_ENV_FLAG}= assignment as this installer's own, run this script again with --remove --adopt.`);
      }
      stderr.write(`${still.join('\n')}\n`);
      return 1;
    }

    const entry = buildHookEntry({ mode: options.mode, gatePath: resolveGatePath() });
    // Named before installing, because installing edits `settings` in place.
    const adoptable = options.adopt ? findUnownedGateHooks(settings).filter((hook) => hook.kind === 'adoptable') : [];
    // Read before installing, for the same reason: installing replaces the hook this reads.
    const existing = readInstalledMode(settings, { adopt: options.adopt });
    const updated = installHook(settings, { entry, adopt: options.adopt });
    await writeSettings(settingsPath, updated);

    stdout.write(`Installed the ${options.mode} release-notes gate into ${settingsPath}.\n`);
    if (options.adopt) {
      stdout.write(adoptable.length > 0
        ? `Adopted ${countOf(adoptable.length, 'hook')} that ran this gate without the ${GATE_ENV_FLAG}= assignment, and replaced ${adoptable.length === 1 ? 'it' : 'them'}: ${adoptable.map(hookLabel).join(', ')}.\n`
        : `Adopted none: no hook in this file ran this gate without the ${GATE_ENV_FLAG}= assignment.\n`);
    }
    const modeChange = describeModeChange({ modeGiven: options.modeGiven, existing, mode: options.mode });
    if (modeChange) stdout.write(`${modeChange}\n`);
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
      `${GATE_ENV_FLAG}=off in the command this wrote — keep the assignment itself, because it is`,
      'how this installer recognises the hook as its own. Remove it entirely: run this script',
      'with --remove.',
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
