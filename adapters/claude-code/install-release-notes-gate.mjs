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
 * A re-run with no `--mode` keeps the mode of the gate already in the file — `off` too, when a user
 * disarmed it by hand — and says so; only `--mode` changes it, and only a new install with no `--mode`
 * gets `observe`. Re-running this installer is how a user picks up a fix, and it must not be the thing
 * that changes what the gate enforces.
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
 * A hook is now this installer's, with no flag, when its WHOLE command is exactly the shape every
 * released version wrote (`HOOK_IDENTITY` below, checked by `./hook-ownership.mjs`):
 * `AGENT_SKILLS_RELEASE_NOTES_GATE=<value>` and no other assignment, then the bare word `bash`, then
 * the gate path, single-quoted, whose basename is exactly `release-notes-gate.sh`, and nothing after
 * it. The harness keeps the command byte for byte, so that shape survives every rewrite. Where the
 * harness has not dropped it, this installer's own `describe` on a hook that runs the gate, in any
 * shape, makes that hook this installer's too, as it did through 0.19.0. A `describe` written by
 * anything else is a statement of ownership, and that hook is never taken, with or without a flag.
 *
 * `--adopt` is for a hook with no describe that RUNS the gate in any other shape: a hand-wiring, or the
 * shape above run by another shell (`/bin/bash`, `sh`, `zsh`). It is refused on install and named on removal;
 * with `--adopt` it is removed or replaced. `--remove` never reports the gate gone while a hook this installer reads
 * as running it, or possibly running it, is left, and exits 1 when one is; and while any hook still names the gate file
 * it never says no gate was installed: it names each hook it left, with its reason and kind. NEVER TAKEN, with any flag
 * and whatever describe it wears, for four reasons and no other (`neverTakenReason` in `./hook-ownership.mjs`), each
 * applied as the reader judges the command, which can misjudge complex, hand-written shell and read a hook that runs
 * the gate as a mention (KNOWN MISREADS there; such a hook has to be removed by hand): a MENTION, every place the
 * gate file is named reaching only a program that does not run it (echo, cat, wc, shellcheck, rm, unlink, xxd and the
 * like), in that shape or any other — as its argument, on its stdin via a pipe, a here-string, a here-document or a `<`
 * redirection, or in a shell comment (`true # release-notes-gate.sh`), with nothing that program prints flowing on, and
 * nowhere else in the command, so `wc -l < '<gate>'` and `cat <<< '<gate>'` are mentions and `bash < '<gate>'` is not; a
 * WRITE TARGET, a redirection that writes to the gate file, in `sh -c`, `eval`, a here-document or a substitution too; a
 * DIFFERENT FILE, where every path with the gate file's name in it ends in another name (`release-notes-gate.sh.orig`,
 * `/x/release-notes-gate.sh/run.sh`); and a describe somebody else wrote. A reason holds only when the command holds no
 * expansion this installer does not resolve (the CERTAINTY rule, checked over the whole command) — a parameter expansion
 * with an operator (`${G%.bak}`), indirection, brace expansion or arithmetic, or a substitution feeding an executing
 * program — may turn a lookalike into the gate (`G=<gate>.bak; bash "${G%.bak}"` runs it), so such a hook is unclear, not
 * a reason. A hook where this installer cannot tell whether the gate
 * runs — the shape above run by a program it does not know, `bash5` or `/usr/bin/env` among them — is named, and a
 * run without `--adopt` never takes it, describe or not: over-reporting a hook is recoverable, and deleting one
 * that is not the gate is not. `--adopt` is the explicit override for such a hook: 0.19.0 matched the gate file's
 * name anywhere in a command, so it takes over every one that does not write to the gate file, whatever leads the
 * command and wherever the gate path sits, and so is a hook under this installer's own describe whose command never
 * names the gate file. It prints each hook it took that way, by event and matcher, on a line of its own (THE
 * OVERRIDE in `./hook-ownership.mjs`).
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  SHELL_SCRIPT_RUNNER,
  eventKeys,
  findHooksNamingGate,
  findUnownedHooks,
  hookLabel,
  isReadableGroup,
  leadingAssignments,
  leftAloneReport,
  plainObject,
  readableGroups,
  takenAs,
  tookOverLine,
  unownedReason,
} from './hook-ownership.mjs';

/** The gate file: the exact basename of the path every command this installer writes runs. */
export const HOOK_MARKER = 'release-notes-gate.sh';
/** Still starts every `describe` written; a describe that does not start with it vetoes ownership. */
export const DESCRIBE_PREFIX = 'agent-skills release-notes gate';
/** The arming flag the gate reads. `off`, unset or anything else is off. */
export const GATE_ENV_FLAG = 'AGENT_SKILLS_RELEASE_NOTES_GATE';
/** The two armed modes `--mode` takes. `off` is not one; it is what the gate is unless armed. */
export const MODES = Object.freeze(['observe', 'block']);
/** Every mode a hook this installer writes can carry: `off` too, which only a re-run keeping a gate that was
 *  disarmed by hand writes, because a re-run keeps the mode it finds. */
export const WRITABLE_MODES = Object.freeze([...MODES, 'off']);
/** What a new install gets when `--mode` is not given: the mode that cannot cost anyone a release. */
export const DEFAULT_MODE = 'observe';

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

/**
 * What `./hook-ownership.mjs` needs to tell this installer's hook from anybody else's, including the
 * exact shape of the one command every released version wrote, from `git log -p` on this file across
 * the tags:
 *   v0.16.0–this version  AGENT_SKILLS_RELEASE_NOTES_GATE=<mode> bash '<gate>'
 * `bash` is `buildHookEntry`'s default `shellPath`, written bare, and no release passed another, so the
 * name does not change from one machine to the next and the interpreter this installer owns is that one
 * bare word. Another shell in that place — `/bin/bash`, `sh`, `zsh`, as `SHELL_SCRIPT_RUNNER` names them —
 * runs the gate: adoptable, and under this installer's own describe its own. A program that only reads or
 * deletes files there (`cat`, `unlink`, `xxd`) runs nothing of it; any other program (`bash5`, `/usr/bin/env`)
 * is one the reader does not know runs it, so no run without `--adopt` takes that hook. `<gate>` is this
 * file's sibling through `shellQuote`.
 */
export const HOOK_IDENTITY = Object.freeze({
  envFlag: GATE_ENV_FLAG,
  gateFile: HOOK_MARKER,
  describePrefix: DESCRIBE_PREFIX,
  variables: Object.freeze([GATE_ENV_FLAG]),
  interpreter: Object.freeze({ quoted: false, names: Object.freeze(['bash']), runs: SHELL_SCRIPT_RUNNER }),
});
const IDENTITY = HOOK_IDENTITY;
/** How an unowned hook's line describes the shape it is not. */
const OWN_SHAPE = `the ${GATE_ENV_FLAG}= assignment, bash, and the gate path, single-quoted`;

export { hookLabel };

const USAGE = `Usage: install-release-notes-gate.mjs [--mode observe|block] [--adopt] [--settings <path>]
       install-release-notes-gate.mjs --remove [--adopt] [--settings <path>]

observe  report to stderr what the gate would have refused; never stops a release. (default
         for a new install)
block    refuse a publish, release-create, release tag or version-bump commit when the
         version being released is not mentioned in the project's release notes.
         With no --mode, re-running this script keeps the mode of the gate already in the
         settings file — off too, if you disarmed it by hand — and says so: "Kept mode block
         (already installed in this file)". Only --mode changes it.

--adopt  also take a hook that RUNS the gate in a shape this installer never writes — a
         hand-wiring, or its own shape run by another shell (/bin/bash, sh, zsh): --remove
         removes it, and an install replaces it. It also takes over every hook this installer
         cannot fully read — a wrapper form it does not recognise, the gate file in an
         option's value or read on the stdin of an interpreter or shell (bash < '<gate>',
         bash <<< '<gate>'), a hook whose gate name passes through an expansion it does not
         resolve (G=<gate>.bak; bash "\${G%.bak}"), its own shape run by a program it does not
         know (bash5, /usr/bin/env), or this installer's own describe over a command that never
         names the gate file — and prints each one: "Took over 1 hook this installer could not
         fully read: PreToolUse (matcher Bash)." Not needed for this installer's own hook: a
         hook whose whole command is exactly what it writes — the
         AGENT_SKILLS_RELEASE_NOTES_GATE= assignment, bash, and the gate path, single-quoted,
         and nothing else — is recognised with no flag, including after Claude Code has
         dropped its describe, and so is a hook that runs the gate under this installer's own
         describe. Never taken, with or without --adopt, for four reasons, each as this
         installer reads the command: a mention (the gate file reaching only a program that
         does not run it, as echo, cat, wc, unlink or shellcheck do — as its argument, on its
         stdin via a pipe, a here-string, a here-document or a < redirection, or in a shell
         comment, and nowhere else in the command, so wc -l < '<gate>' is a mention and
         bash < '<gate>' is not); a write target (a redirection writes to the gate file, in
         sh -c, eval, a here-document or a substitution too, even in a hook that also runs
         it); a different file (every path with the gate file's name in it ends in another
         name: release-notes-gate.sh.orig, /x/release-notes-gate.sh/run.sh); and a describe
         something else wrote. A reason holds only when the command holds no expansion this
         installer does not resolve (the certainty rule, over the whole command): a hook with
         a parameter-expansion operator, indirection, brace expansion or arithmetic in it, or
         whose gate name passes through a substitution feeding a program that runs it, is
         left unclear, taken only by --adopt.
         Known limitation: the reader can misjudge complex, hand-written shell and read a hook
         that runs the gate as a mention: a here-document body that runs it through $(…) or
         backticks, a group or compound command piped into a shell ({ cat '<gate>'; } | bash),
         $'…' quoting, $_ (test -f '<gate>' && bash "$_"), arithmetic inside [[, zsh process
         substitution, or a launcher or copy written to another file and run. --remove then
         leaves the hook and exits 0, and no flag takes it. If a hook wraps the gate in shell
         like this, remove it by hand; do not rely on --remove.
         Other known limits: a gate name not written out literally (a glob such as
         [r]elease-notes-gate.sh, a path read from a file, a symlink under another name) is
         not read as naming it; a group whose hooks is not an array is not read; control flow
         is read by structure; a write through a program's argument (sed -i, dd of=, curl -o)
         is not a write target, so --adopt may take it; under --adopt a hook it did not write
         and cannot fully read is taken, and named; a plain mention beside an unrelated \${…}
         is unclear; and printf -v is handled only as unclear. The full list is in
         adapters/claude-code/README.md, under "Known limits of the reading".
         Without --adopt a hook it cannot fully read is never taken, and an install refuses
         and names it. --remove names every hook it leaves that names the gate file, with the
         reason and its kind, and exits 1 while one of them reads as running the gate, or as
         possibly running it.

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
 * to `off` is how a user disarms the gate without uninstalling it. The whole command, exactly as
 * written here, is also how this installer recognises the hook as its own.
 *
 * The interpreter is named explicitly rather than relying on the script's execute bit and
 * shebang. A checkout that lost the mode bit — a zip download, a copy through a filesystem
 * that does not carry it, an archive extracted by a tool that drops it — would otherwise
 * produce a hook that fails to launch on every Bash call.
 */
export function buildHookEntry({ mode, gatePath, shellPath = 'bash' }) {
  if (!WRITABLE_MODES.includes(mode)) throw new Error(`mode must be one of: ${WRITABLE_MODES.join(', ')}`);

  const command = `${GATE_ENV_FLAG}=${mode} ${shellPath} ${shellQuote(gatePath)}`;
  const removal = 'remove it by running this installer with --remove';
  const describes = {
    block: `${DESCRIBE_PREFIX} (block): refuses a publish, release-create, release tag or version-bump commit when the version being released is not mentioned in the project's release notes; it checks that a note is present and cannot check what it says, it allows anything it cannot resolve, and ${removal}.`,
    observe: `${DESCRIBE_PREFIX} (observe): writes to stderr what a blocking gate would have refused about a release command and never stops one; it checks that a note is present and cannot check what it says, it allows anything it cannot resolve, and ${removal}.`,
    off: `${DESCRIBE_PREFIX} (off): disarmed — it refuses nothing and reports nothing until ${GATE_ENV_FLAG} in this command is block or observe, which this installer's --mode sets; ${removal}.`,
  };

  return { type: 'command', command, timeout: TIMEOUT_SECONDS, describe: describes[mode] };
}

/**
 * Every hook that runs this gate, or may, but is not this installer's: where it sits, and which kind it
 * is — `adoptable` (a hand-wiring; `--adopt` can take it), `unclear` (it names the gate file where this
 * installer cannot tell whether the gate runs; never adopted) or `foreign` (a describe something else
 * wrote; never adopted). Scanned over every event key, because a hook nobody can see is a hook nobody
 * can remove.
 */
export function findUnownedGateHooks(settings) {
  return findUnownedHooks(settings, IDENTITY);
}

/** One line per unowned hook, saying what it is and what can be done about it. */
function unownedLines(unowned) {
  return unowned.map((hook) => `  - ${hookLabel(hook)}: ${unownedReason(hook.kind, OWN_SHAPE, { why: hook.why })}`);
}

/** What `--adopt` took a hook it could not fully read on, printed under the line naming each one (THE OVERRIDE in `./hook-ownership.mjs`). */
const OVERRIDE_BASIS = '--adopt took each because this installer could not tell whether it ran the gate: it names the gate file, or carries this installer\'s own describe, and writes nothing to the gate file.';
/** How to take such a hook over, where a run without `--adopt` left it. */
const OVERRIDE_ADVICE = 'each hook above that this installer cannot fully read and that does not write to the gate file';

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
 * The mode the gate already in this file runs in, so that a re-run with no `--mode` keeps it and a re-run that
 * changes it says so. Through 0.19.0 `--mode` defaulted to `observe` on every run, so re-running this
 * installer to update — which is what a release note tells a user to do — switched a block gate to observe.
 *
 * Read only from a hook an install is about to replace — this installer's own, and under `--adopt` a
 * hand-wiring or a hook it takes over — and only from the leading assignment the shell hands the gate, resolved as
 * `release-notes-gate.sh` resolves it, so a gate disarmed by hand reads `off`. `null` when there is no such
 * hook; `{ mode: null }` when a hook also sets the flag anywhere else, because a mode that cannot be read
 * cannot be kept or reported as changed. `adopted` says whether it came from a hook being adopted.
 */
export function readInstalledMode(settings, { adopt = false } = {}) {
  if (!plainObject(settings)) return null;
  let adopted = null;
  for (const event of eventKeys(settings)) {
    for (const group of readableGroups(settings, event) ?? []) {
      for (const hook of group.hooks) {
        const taken = takenAs(hook, IDENTITY, { adopt });
        if (taken === null) continue;
        // A hook taken over by its describe alone may have no command at all.
        const command = typeof hook.command === 'string' ? hook.command : '';
        const assigned = leadingAssignments(command).filter((entry) => entry.name === GATE_ENV_FLAG);
        const mentions = command.match(new RegExp(`(?<![A-Za-z0-9_])${GATE_ENV_FLAG}=`, 'g'))?.length ?? 0;
        const found = { mode: mentions === assigned.length ? gateModeOf(assigned.at(-1)?.value) : null, adopted: taken !== 'own' };
        if (taken === 'own') return found;
        adopted ??= found;
      }
    }
  }
  return adopted;
}

/**
 * The mode this run writes: the one `--mode` names; with none, the mode of the gate already in the file — `off`
 * included, so a gate disarmed by hand stays disarmed; with neither, `DEFAULT_MODE`. A mode that cannot be read
 * from the installed hook is not guessed at: that run gets the default and says so.
 */
export function resolveInstallMode({ named = null, existing = null } = {}) {
  return named ?? existing?.mode ?? DEFAULT_MODE;
}

/** One line saying which mode this run wrote and where it came from, when a gate was already in the file. */
function describeMode({ named, existing, mode }) {
  if (!existing) return null;
  if (named === null) {
    if (existing.mode === null) {
      return `Mode ${mode}, the default — the mode the gate already in this file ran in could not be read from its command. Pass --mode observe or --mode block to choose it.`;
    }
    const source = existing.adopted ? 'read from the adopted hook' : 'already installed in this file';
    if (mode === 'off') return `Kept mode off (${source}): the gate is disarmed, and refuses and reports nothing. Pass --mode observe or --mode block to arm it.`;
    return `Kept mode ${mode} (${source}). Pass --mode ${mode === 'block' ? 'observe' : 'block'} to change it.`;
  }
  if (existing.mode === null || existing.mode === mode) return null;
  return `Set mode ${mode} (was ${existing.mode}).`;
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
 * is something a user can act on. `--adopt` lifts it for a hand-wiring and for a hook it cannot fully
 * read that THE OVERRIDE takes, never for a hook under somebody else's describe.
 */
export function installHook(settings, { entry, adopt = false }) {
  if (!plainObject(settings)) throw new Error('refusing to write: settings must be a JSON object');

  const blockers = findUnownedGateHooks(settings).filter((hook) => !(adopt && (hook.kind === 'adoptable' || hook.overridable)));
  if (blockers.length > 0) {
    const lines = ['refusing to write: each hook below already runs this gate, or may, and was not written by this installer.', ...unownedLines(blockers)];
    if (blockers.some((hook) => hook.kind === 'adoptable')) {
      lines.push('Run this script again with --adopt to replace each hook above that runs this gate in a shape this installer never writes with this installer\'s own.');
    }
    if (blockers.some((hook) => hook.overridable)) {
      lines.push(`Run this script again with --adopt to take over ${OVERRIDE_ADVICE} — check first that each is the gate.`);
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
 * With `adopt`, a hand-wiring goes too, and so does a hook this installer cannot fully read that THE
 * OVERRIDE takes. `removed` counts every hook taken out; `adopted` and `tookOver` count those two kinds;
 * `unowned` is what still runs the gate afterwards, or may, so no caller can report the gate gone while a
 * hook is still running it.
 */
export function removeHook(settings, { adopt = false } = {}) {
  if (!plainObject(settings)) throw new Error('refusing to write: settings must be a JSON object');
  let removed = 0;
  let adopted = 0;
  let tookOver = 0;
  for (const event of eventKeys(settings)) {
    const groups = readableGroups(settings, event);
    if (groups === null || groups.length === 0) continue;
    for (const group of groups) {
      const kept = group.hooks.filter((hook) => {
        const taken = takenAs(hook, IDENTITY, { adopt });
        if (taken === 'adopted') adopted += 1;
        if (taken === 'override') tookOver += 1;
        return taken === null;
      });
      removed += group.hooks.length - kept.length;
      group.hooks = kept;
    }
    // Prune what we emptied, so removing leaves no residue behind.
    settings.hooks[event] = settings.hooks[event].filter((group) => !isReadableGroup(group) || group.hooks.length > 0);
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  if (plainObject(settings.hooks) && Object.keys(settings.hooks).length === 0) delete settings.hooks;
  return { settings, removed, adopted, tookOver, unowned: findUnownedGateHooks(settings) };
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
  // No default here: a re-run keeps the mode of the gate already in the file, so the default — for a new
  // install only — is resolved once the file has been read (`resolveInstallMode`).
  options.modeGiven = options.mode !== null;
  if (options.modeGiven && !MODES.includes(options.mode)) throw new Error(`--mode must be one of: ${MODES.join(', ')}`);
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
      const unownedBefore = options.adopt ? findUnownedGateHooks(settings) : [];
      const adoptable = unownedBefore.filter((hook) => hook.kind === 'adoptable');
      const takenOver = unownedBefore.filter((hook) => hook.overridable);
      const { settings: pruned, removed, adopted, tookOver, unowned } = removeHook(settings, { adopt: options.adopt });
      // Every hook still naming the gate file that this installer reads as not running it: named below, so that no run calls a
      // file clean while one is in it (LEFT ALONE in `./hook-ownership.mjs`).
      const leftAlone = findHooksNamingGate(pruned, IDENTITY);
      // Written only when something was removed: a run that removed nothing leaves the file byte
      // for byte as it found it, and creates no file that did not exist.
      if (removed > 0) await writeSettings(settingsPath, pruned);
      const report = [];
      if (removed > 0) report.push(`Removed ${countOf(removed, 'release-notes gate hook')} from ${settingsPath}.`);
      if (options.adopt) {
        if (adopted > 0) report.push(`Adopted ${adopted} of them: ${adopted === 1 ? 'a hook' : 'hooks'} that ran this gate in a shape this installer never writes — ${adoptable.map(hookLabel).join(', ')}.`);
        // A hook taken although it could not be fully read is said out loud, on a line of its own.
        if (tookOver > 0) report.push(tookOverLine(takenOver), OVERRIDE_BASIS);
        if (adopted === 0 && tookOver === 0) report.push('Adopted none: no hook in this file ran this gate in a shape this installer never writes.');
      }
      // THE GATE IS GONE ONLY WHEN NOTHING RUNS IT. This branch once printed "No release-notes gate
      // was installed … Nothing changed." and exited 0 while the harness-rewritten hook kept running.
      if (unowned.length === 0) {
        if (leftAlone.length > 0) {
          report.push(...leftAloneReport(leftAlone, { removed, settingsPath }));
        } else {
          report.push(removed > 0
            ? 'No release will be refused again unless you install it back.'
            : `No release-notes gate was installed in ${settingsPath}. Nothing changed.`);
        }
        stdout.write(`${report.join('\n')}\n`);
        return 0;
      }
      if (report.length > 0) stdout.write(`${report.join('\n')}\n`);
      const still = [
        `${removed > 0 ? 'The gate is not gone' : 'Nothing was removed, and the gate is not gone'}: ${countOf(unowned.length, 'hook')} in ${settingsPath} still ${unowned.length === 1 ? 'runs' : 'run'} it, or may, and this installer did not write ${unowned.length === 1 ? 'it' : 'them'}.`,
        ...unownedLines(unowned),
      ];
      if (unowned.some((hook) => hook.kind === 'adoptable')) {
        still.push('To remove each hook above that runs this gate in a shape this installer never writes, run this script again with --remove --adopt.');
      }
      if (unowned.some((hook) => hook.overridable)) {
        still.push(`To take over ${OVERRIDE_ADVICE}, run this script again with --remove --adopt — check first that each is the gate.`);
      }
      still.push(...leftAloneReport(leftAlone));
      stderr.write(`${still.join('\n')}\n`);
      return 1;
    }

    // Read before installing, because installing replaces the hook this reads — and before the entry is built,
    // because with no --mode the mode it writes is the one this reads. Updating never changes what the gate enforces.
    const existing = readInstalledMode(settings, { adopt: options.adopt });
    const mode = resolveInstallMode({ named: options.mode, existing });
    const entry = buildHookEntry({ mode, gatePath: resolveGatePath() });
    // Named before installing, because installing edits `settings` in place.
    const unownedBefore = options.adopt ? findUnownedGateHooks(settings) : [];
    const adoptable = unownedBefore.filter((hook) => hook.kind === 'adoptable');
    const takenOver = unownedBefore.filter((hook) => hook.overridable);
    const updated = installHook(settings, { entry, adopt: options.adopt });
    await writeSettings(settingsPath, updated);

    stdout.write(mode === 'off'
      ? `Installed the release-notes gate into ${settingsPath}, disarmed (off), as the gate already there was.\n`
      : `Installed the ${mode} release-notes gate into ${settingsPath}.\n`);
    if (options.adopt) {
      if (adoptable.length > 0) {
        stdout.write(`Adopted ${countOf(adoptable.length, 'hook')} that ran this gate in a shape this installer never writes, and replaced ${adoptable.length === 1 ? 'it' : 'them'}: ${adoptable.map(hookLabel).join(', ')}.\n`);
      }
      // A hook replaced although it could not be fully read is said out loud, on a line of its own.
      if (takenOver.length > 0) stdout.write(`${tookOverLine(takenOver)}\n${OVERRIDE_BASIS}\n`);
      if (adoptable.length === 0 && takenOver.length === 0) stdout.write('Adopted none: no hook in this file ran this gate in a shape this installer never writes.\n');
    }
    const modeLine = describeMode({ named: options.mode, existing, mode });
    if (modeLine) stdout.write(`${modeLine}\n`);
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
    if (mode === 'block') {
      stdout.write([
        'Block mode returns a permission denial, so the release command does not run. That',
        'decision shape is documented by the harness and was not observed firing in this',
        "pack's own probes (adapters/HOOK-OUTPUT-NOTES.md) — read a run of observe mode from",
        'this hook before depending on block mode to stop anything.',
        '',
      ].join('\n'));
    } else if (mode === 'observe') {
      stdout.write([
        'Observe mode never stops a release. It writes what it would have refused to stderr.',
        'Whether Claude Code surfaces a PreToolUse hook\'s stderr at exit 0 is not something',
        "this pack has observed, so confirm you can see that line before trusting it as the",
        'way you will notice the gate working.',
        '',
      ].join('\n'));
    } else {
      stdout.write([
        'Off: the hook still runs before every Bash call and decides nothing, as it did before',
        'this run. Arm it with --mode observe or --mode block.',
        '',
      ].join('\n'));
    }
    stdout.write((mode === 'off' ? [
      'Remove it entirely: run this script with --remove.',
      '',
    ] : [
      `Disarm without uninstalling: change ${GATE_ENV_FLAG}=${mode} to`,
      `${GATE_ENV_FLAG}=off in the command this wrote, and change nothing else in it: this`,
      'installer recognises its hook only while the command is exactly what it writes, and a',
      're-run keeps the gate off. Remove it entirely: run this script with --remove.',
      '',
    ]).join('\n'));
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
