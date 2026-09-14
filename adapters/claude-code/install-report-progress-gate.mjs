#!/usr/bin/env node
/**
 * Install, or remove, the pair of Claude Code hooks that make a progress report
 * non-skippable on turns that dispatched a subagent.
 *
 * A user runs this. Nothing runs it for them, and no skill may run it on their
 * behalf: a hook that can end a turn is the user's decision to arm, and a gate
 * installed by an agent on its own initiative is a gate nobody consented to.
 *
 * Two hooks, because the gate needs both halves and neither is useful alone —
 * three when the user names skills to treat as external agents:
 *
 *   SubagentStart, matcher `*`    arms a per-session marker when a subagent is
 *                                 started, of any kind, foreground or
 *                                 backgrounded. This replaced `PostToolUse`
 *                                 matcher `Agent`, which saw only one of those.
 *   Stop, matcher `*`             reads the marker AND the harness's own list of
 *                                 background work, which arrives in this very
 *                                 payload. Refuses the turn's final message if it
 *                                 carries no report. Nothing armed, no gate —
 *                                 which is the difference between a guard people
 *                                 keep and one they rip out after it blocks "yes,
 *                                 that file is in src/".
 *   PostToolUse, matcher `Skill`  written ONLY when `--skills` named something.
 *                                 Arms on an exact skill name, never on command
 *                                 text. With no list this hook does not exist, so
 *                                 the default install gains no invocation here.
 *
 * That is the set at coverage 2. At coverage 1 the arming half is `PostToolUse` matcher
 * `Agent` in place of `SubagentStart`, and there is no `Skill` hook — see THE COVERAGE LEVEL.
 *
 * There is no third hook for background work, and that is not an omission: the
 * `Stop` payload already carries `background_tasks[]`, so a workflow launched in
 * a turn is in that turn's own register and a finished task has left it by the
 * next one. The gate arms on the CHANGE, never on the presence — a dev server
 * left running does not make every turn owe a report.
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
 * turn precisely so it can never be the hook that walks a session into that. It is
 * also why this is ONE gate rather than two: a second blocking `Stop` hook does not
 * get its own budget, it competes for this one, and two gates disagreeing about the
 * same turn can spend two blocks on one missing report.
 *
 * THE COVERAGE LEVEL, and why this script writes it into the command AND keeps it. The
 * two delegation hooks above cannot appear in a user's settings without them running
 * this script, so they cannot widen a gate on their own. The background-work half is
 * different: it rides on the `Stop` hook that is already installed, so updating the pack
 * alone would widen an armed gate silently — which breaks the rule that a hook able to
 * end a turn is off until a human arms it. So the command carries
 * `AGENT_SKILLS_PROGRESS_GATE_COVERAGE=<level>`, and a gate running under a settings entry
 * that lacks it behaves exactly as v0.16.1 did.
 *
 * That was half of it. This script used to write `2` on every run, so re-running it to
 * pick up a new version WAS the widening, and nothing it printed said so. The level is now
 * chosen with `--coverage 1|2`. With no flag, a re-run keeps the level of the gate already
 * in the settings file — read back out of its command by the gate's own `resolveCoverage`,
 * so a command naming no level, as v0.16.1 wrote it, is `1` — and a new install gets `1`.
 * Updating and changing enforcement are separate actions, and the output names which
 * one happened.
 *
 * WHY A NEW INSTALL GETS 1. Coverage 2 has a shape coverage 1 is structurally incapable of:
 * standing down deletes the marker that records a spent block, so a register that changes
 * again can arm a later `Stop` of the same turn afresh, and only the harness's
 * `stop_hook_active` stands between that and a second block out of the eight every `Stop`
 * hook on the machine shares. That is a cost a user should choose, not inherit.
 *
 * THE HOOK SET FOLLOWS THE LEVEL, or keeping a level would be a lie. Coverage 1 arms on one
 * signal, `PostToolUse` with `tool_name` `Agent`, and ignores `SubagentStart`. Measured:
 * coverage 1 written under the coverage-2 pair wrote no marker and never blocked — a gate
 * reporting itself installed while being off, which trades a silent widening for a silent
 * disarming. So coverage 1 writes `Stop` + `PostToolUse` matcher `Agent`, which is
 * v0.16.1's pair, and coverage 2 writes `Stop` + `SubagentStart`, plus `PostToolUse`
 * matcher `Skill` for a configured list. A skill list at coverage 1 is refused rather than
 * written: the gate at that level never reads one.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  COVERAGE_ENV_FLAG,
  GATE_ENV_FLAG,
  GATE_MODES,
  SKILLS_ENV_FLAG,
  isEntrypoint,
  resolveCoverage,
  resolveMode,
} from './report-progress-gate.mjs';

/** Every hook this script writes carries the gate's filename in its command. */
export const HOOK_MARKER = 'report-progress-gate.mjs';
/** …and this prefix in its `describe`, which is how we know a hook is ours. */
export const DESCRIBE_PREFIX = 'agent-skills report-progress gate';
export const MODES = GATE_MODES;

/** The events the gate needs, with the matcher each is scoped by. */
export const STOP_MATCHER = '*';
export const SUBAGENT_MATCHER = '*';
export const SKILL_MATCHER = 'Skill';
/** `PostToolUse` matcher `Agent`: v0.16.1's arming half, and coverage 1's — the one signal
 *  that level reads. Coverage 2 writes `SubagentStart` in its place. */
export const AGENT_MATCHER = 'Agent';

/** The levels `--coverage` accepts. Written into the command so an installed settings entry
 *  cannot be widened by updating the pack alone, and read back out of it so re-running this
 *  script to update keeps the level already chosen. */
export const COVERAGE_LEVELS = Object.freeze([1, 2]);
/** What a NEW install gets when `--coverage` is not given. The header says why it is the
 *  narrower one. An existing install keeps its own level instead. */
export const DEFAULT_COVERAGE_LEVEL = 1;

/** A skill name is a slug. Anything else is refused rather than quoted into a command line:
 *  this script builds a shell command, and the one thing it will not do is build one out of
 *  text it did not check. */
export const SKILL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

/**
 * The session waits on both of these, so both ceilings are small. The gate makes no
 * network call and spawns no process: it reads one small file and matches strings, so a
 * hook that has not finished in these budgets is a wedged hook, and killing it is right.
 */
export const STOP_TIMEOUT_SECONDS = 10;
export const POST_TOOL_TIMEOUT_SECONDS = 5;

const USAGE = `Usage: install-report-progress-gate.mjs [--mode observe|block] [--coverage 1|2] [--skills <names>] [--settings <path>]
       install-report-progress-gate.mjs --remove [--settings <path>]

observe  report to stderr what the gate would have blocked; never ends a turn. (default)
block    hold the turn for one more round when an armed turn ends without a progress
         report. At most one block per turn at coverage 1; at coverage 2 that is the
         intent, and the harness's own backstop is what holds it.

--coverage 1  arm on one thing: a subagent dispatched through the Agent tool. What a new
              install gets when no level is given.
--coverage 2  arm on a subagent of any kind starting, on a skill named in --skills, and on
              a change in the harness's own list of background work.
         With no --coverage, re-running this script keeps the level of the gate already
         in the settings file, so updating the pack never changes what the gate enforces.

--skills a comma-separated list of skill names to treat as external agents, matched by
         EXACT name (e.g. --skills codex,gpt-researcher). Coverage 2 only. Empty by
         default, and when it is empty no hook is written for it at all. There is no
         matching of command text here, for any binary, ever.

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
export function buildHookEntries({ mode, gatePath, nodePath = process.execPath, skills = [], coverage }) {
  if (!MODES.includes(mode)) throw new Error(`mode must be one of: ${MODES.join(', ')}`);
  // No default here on purpose. The installer resolves the level from the flag, then the
  // installed gate, then DEFAULT_COVERAGE_LEVEL; a second, silent default in the builder is
  // how a caller would write a level nobody chose.
  if (!COVERAGE_LEVELS.includes(coverage)) throw new Error(`coverage must be one of: ${COVERAGE_LEVELS.join(', ')}`);
  const watched = normaliseSkills(skills);
  if (coverage === 1 && watched.length > 0) {
    throw new Error('refusing to write: --skills needs coverage 2 — the gate at coverage 1 never reads a skill list');
  }

  const base = `${GATE_ENV_FLAG}=${mode} ${COVERAGE_ENV_FLAG}=${coverage}`;
  const command = `${base} ${shellQuote(nodePath)} ${shellQuote(gatePath)}`;
  // The allowlist rides only on the hook that reads it, so the Stop and SubagentStart
  // commands stay identical whether or not a list was configured.
  const skillCommand = `${base} ${SKILLS_ENV_FLAG}=${shellQuote(watched.join(','))} ${shellQuote(nodePath)} ${shellQuote(gatePath)}`;
  const removal = 'remove it by running this installer with --remove';
  const armed = coverage === 2
    ? 'a turn that started a subagent, invoked a listed external-agent skill, or in which the harness started or stopped listing a background task'
    : 'a turn that dispatched a subagent through the Agent tool';
  // What stops a second block. This string used to say "once, never twice", and that was not the
  // gate's to promise at either level: its record of a spent block does not survive a re-arm later
  // in the same turn. Live at coverage 2, a Stop re-armed from the register with the record gone
  // and only the harness's stop_hook_active held it (adapters/HOOK-OUTPUT-NOTES.md, 2026-09-14);
  // at coverage 1 an Agent dispatch in the continuation round rewrites the record as unspent.
  const rearm = coverage === 2
    ? 'a subagent starting, or the background list changing, later in the same turn can re-arm it without the record of the block it spent'
    : 'a further Agent dispatch later in the same turn re-arms it without the record of the block it spent';

  return {
    stop: {
      type: 'command',
      command,
      timeout: STOP_TIMEOUT_SECONDS,
      describe: mode === 'block'
        ? `${DESCRIBE_PREFIX} (block): on ${armed}, holds the turn for one more round when the final message has no "what is done / what is running / what is next" report. It means to do that once per turn, but ${rearm}, so it is the harness's own stop_hook_active that prevents a second block; it matches the report's shape only and cannot verify anything in it, and ${removal}.`
        : `${DESCRIBE_PREFIX} (observe): on ${armed}, writes to stderr what a blocking gate would have refused in the final message and never holds the turn; it matches the report's shape only and cannot verify anything in it, and ${removal}.`,
    },
    // Exactly one arming half per level. Writing the half a level ignores would cost a Node
    // start per event for nothing; omitting the half it reads would leave a gate that never fires.
    subagentStart: coverage !== 2 ? null : {
      type: 'command',
      command,
      timeout: POST_TOOL_TIMEOUT_SECONDS,
      describe: `${DESCRIBE_PREFIX} (${mode}, arming half): records that this turn started a subagent, which is one of the two things that let the Stop half fire at all — the other needs no hook of its own, because the harness hands the Stop payload its own list of background work, and ${removal}.`,
    },
    agentTool: coverage !== 1 ? null : {
      type: 'command',
      command,
      timeout: POST_TOOL_TIMEOUT_SECONDS,
      describe: `${DESCRIBE_PREFIX} (${mode}, arming half): records that this turn dispatched a subagent through the Agent tool, which at coverage 1 is the only thing that lets the Stop half fire at all, and ${removal}.`,
    },
    // Written ONLY when the user named skills. An empty list means no hook at all, so the
    // default install gains no invocation on the `Skill` path.
    skill: watched.length === 0 ? null : {
      type: 'command',
      command: skillCommand,
      timeout: POST_TOOL_TIMEOUT_SECONDS,
      describe: `${DESCRIBE_PREFIX} (${mode}, arming half): records that this turn invoked one of the skills you listed as an external agent (${watched.join(', ')}) — matched by exact name, never by command text, and ${removal}.`,
    },
  };
}

/** Validated, trimmed, de-duplicated, lower-cased. Throws rather than quoting anything
 *  surprising into the command line it is about to write into a settings file. */
export function normaliseSkills(skills) {
  const list = Array.isArray(skills) ? skills : String(skills ?? '').split(',');
  const seen = [];
  for (const raw of list) {
    const name = String(raw).trim();
    if (name === '') continue;
    if (!SKILL_NAME_PATTERN.test(name)) {
      throw new Error(`refusing to write: ${JSON.stringify(name)} is not a plain skill name (letters, digits, and _ . : - only)`);
    }
    const lowered = name.toLowerCase();
    if (!seen.includes(lowered)) seen.push(lowered);
  }
  return seen;
}

function isOurs(hook) {
  return plainObject(hook) && typeof hook.describe === 'string' && hook.describe.startsWith(DESCRIBE_PREFIX);
}

function wearsOurName(hook) {
  return plainObject(hook) && typeof hook.command === 'string' && hook.command.includes(HOOK_MARKER);
}

/**
 * The groups under one event key that are shaped the way this script understands — GROUP BY
 * GROUP, never all-or-nothing.
 *
 * SCANNING is done over every key in `settings.hooks` rather than over this module's own event
 * list, so it meets keys written by other tools, by other versions of this one, and by hand.
 * Refusing the whole run because of somebody else's typo three keys away would make `--remove`
 * fail exactly when a user is trying to get rid of us.
 *
 * Skipping the whole KEY on one bad group is the same failure wearing a politer face, and it is
 * worse than failing loudly: with a malformed group beside it, our own `Stop` hook in the good
 * group survived `--remove` while the run printed "Removed 1 … hook" (measured). A group whose
 * `hooks` is not an array holds no hook entries for us to find, so skipping just that group
 * loses nothing and reaches everything else.
 */
function isReadableGroup(group) {
  return plainObject(group) && Array.isArray(group.hooks);
}

function readableGroups(settings, event) {
  const value = settings.hooks?.[event];
  if (!Array.isArray(value)) return null;
  return value.filter(isReadableGroup);
}

/** Every event key present in the file. A snapshot, because the callers delete keys. */
function eventKeys(settings) {
  if (!plainObject(settings) || !Object.hasOwn(settings, 'hooks')) return [];
  if (!plainObject(settings.hooks)) throw new Error('refusing to write: the settings "hooks" key is not an object');
  return Object.keys(settings.hooks);
}

/** The groups for one event this script intends to WRITE into, validated. Anything shaped
 *  unexpectedly is refused rather than reshaped: this file is editing a settings file it
 *  does not own, and writing into a shape it misread is how it would corrupt one. */
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
 * Every place this version can write, and the level decides which: `buildHookEntries` returns
 * `null` for each entry the chosen level does not read, and a null row is not written.
 * Coverage 1 is `Stop` plus `PostToolUse` matcher `Agent` — v0.16.1's pair exactly. Coverage 2
 * is `Stop` plus `SubagentStart`, one event that covers every subagent kind, foreground and
 * backgrounded alike, and `PostToolUse` matcher `Skill` only for a configured list; the second
 * family, work in flight at a turn end, needs no event of its own at all, because the harness
 * already hands the `Stop` payload its own register of it.
 *
 * `removeHooks` deliberately does NOT read this list. See its own comment.
 */
const HOOK_PLAN = Object.freeze([
  { event: 'Stop', matcher: STOP_MATCHER, key: 'stop' },
  { event: 'SubagentStart', matcher: SUBAGENT_MATCHER, key: 'subagentStart' },
  { event: 'PostToolUse', matcher: AGENT_MATCHER, key: 'agentTool' },
  { event: 'PostToolUse', matcher: SKILL_MATCHER, key: 'skill' },
]);

/**
 * Merge both hooks into a parsed settings object without disturbing anything else in it.
 * A hook that wears our name but that we did not write is somebody else's decision, so it
 * is refused rather than replaced.
 */
export function installHooks(settings, { entries }) {
  if (!plainObject(settings)) throw new Error('refusing to write: settings must be a JSON object');

  // Scanned over EVERY event key, not only the ones this version writes: a hook wearing the
  // gate's filename under an event we no longer touch is still somebody's decision, and
  // stacking a second gate beside it would spend two of the eight shared blocks on one
  // missing report.
  for (const event of eventKeys(settings)) {
    for (const group of readableGroups(settings, event) ?? []) {
      for (const hook of group.hooks) {
        if (wearsOurName(hook) && !isOurs(hook)) {
          throw new Error(`refusing to write: a ${event} hook already runs this gate but was not written by this installer. Remove it by hand first.`);
        }
      }
    }
  }
  // Validated only where we are about to WRITE. A shape we misread is a settings file we
  // could corrupt, and these three are the only keys this script edits.
  for (const { event, key } of HOOK_PLAN) {
    if (entries[key]) eventGroups(settings, event);
  }

  // Drop any previous copy of ours wherever it sits, so re-running this to change mode or
  // level replaces the gate instead of stacking a second one beside it, and so the arming
  // half of the level being left does not survive as an orphan beside the new one.
  const { settings: cleaned } = removeHooks(settings);
  const hooks = plainObject(cleaned.hooks) ? cleaned.hooks : {};
  for (const { event, matcher, key } of HOOK_PLAN) {
    if (!entries[key]) continue;
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

/**
 * Remove only our own hooks, and leave the file exactly as we found it otherwise.
 *
 * EVENT-AGNOSTIC ON PURPOSE. It scans every key under `settings.hooks` for a `describe`
 * that starts with `DESCRIBE_PREFIX`, rather than iterating the event list this version
 * happens to write. The version before this one did the latter, and the moment that list
 * stopped naming `PostToolUse` — which this version's default install no longer writes —
 * every already-installed user's `PostToolUse` hook became unremovable by `--remove`:
 * left in their settings forever, arming a marker nothing reads.
 */
export function removeHooks(settings) {
  if (!plainObject(settings)) throw new Error('refusing to write: settings must be a JSON object');
  let removed = 0;
  for (const event of eventKeys(settings)) {
    const groups = readableGroups(settings, event);
    if (groups === null || groups.length === 0) continue;
    for (const group of groups) {
      const kept = group.hooks.filter((hook) => !isOurs(hook));
      removed += group.hooks.length - kept.length;
      group.hooks = kept;
    }
    // Prune what we emptied, so removing leaves no residue behind — and only what we emptied.
    // A group this script could not read is somebody else's, and is put back untouched.
    settings.hooks[event] = settings.hooks[event].filter((group) => !isReadableGroup(group) || group.hooks.length > 0);
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  if (plainObject(settings.hooks) && Object.keys(settings.hooks).length === 0) delete settings.hooks;
  return { settings, removed };
}

/**
 * The leading `NAME=value` assignments of a command, as the shell reads them: it stops at the
 * first word that is not one. Values this script writes are bare words or single-quoted.
 */
function leadingAssignments(command) {
  const assignments = {};
  const pattern = /^\s*([A-Za-z_][A-Za-z0-9_]*)=('(?:[^']|'\\'')*'|[^\s']*)(?=\s|$)/;
  let rest = String(command);
  for (let match = pattern.exec(rest); match; match = pattern.exec(rest)) {
    const [whole, name, raw] = match;
    assignments[name] = raw.startsWith("'") ? raw.slice(1, -1).split(`'\\''`).join("'") : raw;
    rest = rest.slice(whole.length);
  }
  return assignments;
}

/**
 * The gate this installer already wrote into a settings file, read the way the running gate
 * reads its own command: the level and mode come from the assignments in front of it and are
 * resolved by the gate's own `resolveCoverage` and `resolveMode`, not a restatement of them.
 * So a command naming no level — as v0.16.1 wrote it — or an unrecognised one is coverage 1,
 * which is exactly what that gate is running at.
 *
 * Only hooks this installer wrote are read. `Stop` is preferred, because that is the hook
 * where the level changes what a turn can cost; any other of ours stands in when there is no
 * `Stop`. Returns `null` when the file holds no gate of ours.
 */
export function readInstalledGate(settings) {
  if (!plainObject(settings)) return null;
  const ours = [];
  for (const event of eventKeys(settings)) {
    for (const group of readableGroups(settings, event) ?? []) {
      for (const hook of group.hooks) {
        if (isOurs(hook) && typeof hook.command === 'string') ours.push({ event, hook });
      }
    }
  }
  if (ours.length === 0) return null;
  const { hook } = ours.find((entry) => entry.event === 'Stop') ?? ours[0];
  const env = leadingAssignments(hook.command);
  return { coverage: resolveCoverage(env), mode: resolveMode(env) };
}

/** One line naming where the level came from. A silent level is the defect this replaced. */
function describeLevel({ named, existing, coverage }) {
  const other = coverage === 1 ? 2 : 1;
  const change = `Pass --coverage ${other} to ${other > coverage ? 'widen' : 'narrow'} it`;
  if (named !== null) {
    if (!existing) return `Set coverage ${coverage}.`;
    return existing.coverage === coverage
      ? `Set coverage ${coverage} (unchanged).`
      : `Set coverage ${coverage} (was ${existing.coverage}).`;
  }
  if (existing) return `Kept coverage ${coverage} (already installed in this file). ${change}.`;
  return `Set coverage ${coverage} (the default for a new install). ${change} — what that adds, and what it costs, is below.`;
}

/** Mode keeps its documented default; when that default changes an installed gate, say so. */
function describeModeChange({ modeGiven, existing, mode }) {
  if (!existing || existing.mode === mode) return null;
  if (modeGiven) return `Set mode ${mode} (was ${existing.mode}).`;
  if (existing.mode === 'off') {
    return `Mode ${mode}, the default — the gate already in this file was disarmed (off), and this run armed it again. To keep it disarmed, set ${GATE_ENV_FLAG}=off in its commands again, or run this script with --remove.`;
  }
  return `Mode ${mode}, the default — the gate already in this file ran in ${existing.mode} mode. Pass --mode ${existing.mode} to keep it.`;
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
  const options = { mode: null, modeGiven: false, coverage: null, settingsPath: null, skills: [], remove: false, help: false };
  let skillsGiven = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--mode') {
      index += 1;
      options.mode = argv[index] ?? '';
    } else if (argument === '--coverage') {
      index += 1;
      const value = argv[index] ?? '';
      // Compared as exact text, so `2.0`, ` 2` and `02` are refused rather than read as a
      // number: this flag decides how often a turn can be held, and a guess is not good enough.
      if (value !== '1' && value !== '2') throw new Error('--coverage must be 1 or 2');
      options.coverage = Number(value);
    } else if (argument === '--settings') {
      index += 1;
      options.settingsPath = argv[index] ?? '';
    } else if (argument === '--skills') {
      index += 1;
      skillsGiven = true;
      options.skills = normaliseSkills(argv[index] ?? '');
    } else if (argument === '--remove') options.remove = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`unknown argument: ${argument}`);
  }
  if (options.help) return options;
  if (options.remove) {
    if (options.mode) throw new Error('--remove takes no --mode');
    if (skillsGiven) throw new Error('--remove takes no --skills');
    if (options.coverage !== null) throw new Error('--remove takes no --coverage');
    return options;
  }
  // The default is the mode that cannot cost anyone a turn.
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
      const { settings: pruned, removed } = removeHooks(settings);
      await writeSettings(settingsPath, pruned);
      stdout.write(removed > 0
        ? `Removed ${removed} report-progress gate hook${removed === 1 ? '' : 's'} from ${settingsPath}.\nNo turn will be held again unless you install it back.\n`
        : `No report-progress gate was installed in ${settingsPath}. Nothing changed.\n`);
      return 0;
    }

    // Named, then installed, then the default. The middle step is the point: re-running this
    // script to pick up a new version must never be the thing that changes what it enforces.
    const existing = readInstalledGate(settings);
    const coverage = options.coverage ?? existing?.coverage ?? DEFAULT_COVERAGE_LEVEL;
    if (coverage === 1 && options.skills.length > 0) {
      const source = options.coverage !== null
        ? 'You named --coverage 1.'
        : existing
          ? `The gate already installed in ${settingsPath} runs at coverage 1, and a re-run keeps that.`
          : 'Coverage 1 is what a new install gets.';
      throw new Error(`refusing to write: --skills needs coverage 2. ${source} At coverage 1 the gate never reads a skill list, so that hook would run on every Skill call and arm nothing. Add --coverage 2 to widen it.`);
    }

    const entries = buildHookEntries({ mode: options.mode, gatePath: resolveGatePath(), skills: options.skills, coverage });
    const updated = installHooks(settings, { entries });
    await writeSettings(settingsPath, updated);

    stdout.write(`Installed the ${options.mode} report-progress gate into ${settingsPath}.\n`);
    stdout.write(`${describeLevel({ named: options.coverage, existing, coverage })}\n`);
    const modeChange = describeModeChange({ modeGiven: options.modeGiven, existing, mode: options.mode });
    if (modeChange) stdout.write(`${modeChange}\n`);
    stdout.write((coverage === 1 ? [
      '',
      'ARMED ON ONE THING, and on nothing else:',
      '  - a subagent dispatched through the Agent tool in this turn (PostToolUse, matcher',
      '    Agent). That is v0.16.1\'s gate exactly.',
      '',
      'Every other turn ends exactly as it would with the gate absent — with one exception,',
      'costing one block, once: the marker is per session and is cleared by the Stop that',
      'ends the turn, so a turn that armed and then died without one (a crash, a kill)',
      'leaves it behind.',
      '',
      'It checks the SHAPE of the final message: that a "what is done", a "what is',
      'running" and a "what is next" section are present, and that a running row carries',
      'a literal state and a freshness. It cannot check whether a count is real, whether a',
      'child id exists, or whether an observation ever happened — a message that satisfies',
      'this gate can still be wrong, and only a reader can catch that.',
      '',
      'WHAT IT CANNOT SEE AT THIS LEVEL, stated plainly because the alternative is finding out later:',
      '  - a subagent started by anything but an Agent tool call — SubagentStart is not read;',
      '  - an external agent, including one a skill runs — --skills is a coverage 2 option;',
      '  - the harness\'s own list of background work, which this level never reads: a',
      '    workflow or a background shell launched in a turn arms nothing, and a report',
      '    saying "Running: none" beside work the harness lists as running is not refused.',
      '',
      'WHAT --coverage 2 ADDS, AND WHAT IT COSTS. It arms on a subagent of any kind starting,',
      'on a skill you name, and on a change in the harness\'s list of background work. The',
      'cost: standing down deletes the gate\'s record of a spent block, so if that list',
      'changes again within one turn a later Stop can arm afresh, and only the harness\'s',
      'own stop_hook_active keeps it from blocking a second time. That backstop is the',
      'harness\'s, not this gate\'s own memory.',
      '',
    ] : [
      '',
      'ARMED ON THREE THINGS, and on nothing else:',
      '  - a subagent started in this turn (SubagentStart, any kind except a workflow\'s own',
      '    children, which the third item covers at a better moment);',
      options.skills.length > 0
        ? `  - one of the skills you listed as an external agent: ${options.skills.join(', ')};`
        : '  - a skill you have listed as an external agent — none listed, so nothing here;',
      '  - a CHANGE in the harness\'s own list of background work between this turn\'s end and',
      '    the last one — something new appeared, or something that was running is no longer',
      '    listed. A task that is merely still running arms nothing, so a dev server left in',
      '    the background does not make every turn for the rest of the session owe a report.',
      '',
      'Every other turn ends exactly as it would with the gate absent — with three exceptions,',
      'each costing one block, once, and each worth hearing about before rather than after:',
      '  - the marker is per session and is cleared by the Stop that ends the turn, so a turn',
      '    that armed and then died without one (a crash, a kill) leaves it behind;',
      '  - a background result arriving while you ask something trivial arms that trivial turn;',
      '  - resuming a session in a fresh CLI process starts the background list empty again,',
      '    so the first turn after a resume can read as a disappearance.',
      '',
      'It checks the SHAPE of the final message: that a "what is done", a "what is',
      'running" and a "what is next" section are present, and that a running row carries',
      'a literal state and a freshness. Where the harness listed work as still running, it',
      'also refuses a report that says "Running: none" or claims there is no lifecycle',
      'evidence — that is contradiction detection, not verification. It still',
      'cannot check whether a count is real, whether a child id exists, or whether an',
      'observation ever happened — a message that satisfies this gate can still be wrong,',
      'and only a reader can catch that.',
      '',
      'WHAT IT STILL CANNOT SEE, stated plainly because the alternative is finding out later:',
      '  - a foreground external agent — a bare `codex exec` in a Bash call — unless you have',
      '    listed the skill that runs it. There is no command-text matching here, deliberately:',
      '    a false positive would demand a progress report because a commit message mentioned',
      '    codex. Backgrounding such a call makes it visible, exactly, with no guessing;',
      '  - the individual children of a workflow. A workflow of twelve agents is one entry in',
      '    the harness\'s list and owes one row, not twelve;',
      '  - background work that starts and finishes inside one turn, which the list is never',
      '    sampled in time to see.',
      '',
    ]).join('\n'));
    if (options.mode === 'block') {
      stdout.write([
        'Block mode holds the turn for one more round, once, and then stands down: if the',
        'next message still has no report, the turn ends anyway. That ceiling is not',
        'politeness. Claude Code ends a turn after 8 consecutive Stop blocks, the budget is',
        'shared with every other Stop hook you have installed, and when it runs out the',
        'result comes back as a success with an empty answer.',
        ...(coverage === 2 ? [
          'At coverage 2, "once" is the intent rather than a guarantee: standing down deletes',
          'the record of the spent block, so a background list that changes again within the',
          'turn can arm a later Stop afresh, and the harness\'s stop_hook_active is what stops a',
          'second block. --coverage 1 does not have this shape.',
        ] : []),
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
      `${GATE_ENV_FLAG}=off in the commands this wrote. Remove it entirely: run this`,
      'script with --remove.',
      '',
    ].join('\n'));
    const written = Object.fromEntries(Object.entries(entries).filter(([, entry]) => entry !== null));
    stdout.write(`\nHooks written:\n${JSON.stringify(written, null, 2)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error.message}\n`);
    return 1;
  }
}

// Imported from the gate rather than restated: the two files ship side by side, and two
// copies of this decision are how one of them drifts back. Restated as a raw path
// comparison, it was false through the symlink the Skills CLI installs — this installer
// wrote no settings, printed nothing, and exited 0, which reads exactly like success.
if (isEntrypoint(import.meta.url)) {
  process.exitCode = await main();
}
