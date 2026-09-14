#!/usr/bin/env node
/**
 * Install, or remove, the Claude Code hooks that make a progress report
 * non-skippable on turns that dispatched a subagent.
 *
 * A user runs this. Nothing runs it for them, and no skill may run it on their
 * behalf: a hook that can end a turn is the user's decision to arm, and a gate
 * installed by an agent on its own initiative is a gate nobody consented to.
 *
 * Four hooks at coverage 2, because the gate needs both halves, a turn boundary and,
 * where it reads background work, a resume boundary. There are five when the user
 * names skills to treat as external agents:
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
 *   UserPromptSubmit, matcher `*` clears the Stop half's record of a block it spent
 *                                 in the previous turn, so each turn can block once
 *                                 and no more. Arms nothing, prints nothing.
 *   SessionStart, matcher `resume` notes that the session was resumed in a fresh CLI
 *                                 process, whose list of background work starts
 *                                 empty, so the next Stop does not read the old
 *                                 process's tasks as gone. Arms nothing, prints
 *                                 nothing.
 *   PostToolUse, matcher `Skill`  written ONLY when `--skills` named something.
 *                                 Arms on an exact skill name, never on command
 *                                 text. With no list this hook does not exist, so
 *                                 the default install gains no invocation here.
 *
 * That is the set at coverage 2. At coverage 1 the arming half is `PostToolUse` matcher
 * `Agent` in place of `SubagentStart`, and there is no `Skill` hook and no `SessionStart` hook —
 * see THE COVERAGE LEVEL. `UserPromptSubmit` is written at both.
 *
 * No hook arms on background work, and that is not an omission: the
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
 *            one more round so the report can be written — at most once per turn.
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
 * an empty answer reported as a clean run. The gate spends at most one block per turn
 * so that it is never the hook that walks a session into that: its record of a spent
 * block, which nothing inside the turn touches, and the `UserPromptSubmit` hook that
 * clears it at the next turn start, hold that line (the gate's own header, THE RECORD
 * OF A SPENT BLOCK). The commands declare that hook as
 * `AGENT_SKILLS_PROGRESS_GATE_TURN_HOOK=UserPromptSubmit`; a command without it, as
 * every installer through 0.19.0 wrote, runs the gate exactly as 0.19.0 did. It is
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
 * WHY A NEW INSTALL GETS 1. Coverage 2 holds more turns: it arms on every subagent kind, on a named
 * skill, and on a change in the harness's list of background work, which arms a turn with no tool
 * call at all. Through 0.19.0 it also had more ways to spend a second block in a turn, and neither
 * level could prevent one without the harness's `stop_hook_active`. The record of a spent block now
 * closes that at both levels, but holding more turns is still a cost a user should choose, not
 * inherit.
 *
 * THE HOOK SET FOLLOWS THE LEVEL, or keeping a level would be a lie. Coverage 1 arms on one
 * signal, `PostToolUse` with `tool_name` `Agent`, and ignores `SubagentStart`. Measured:
 * coverage 1 written under the coverage-2 pair wrote no marker and never blocked — a gate
 * reporting itself installed while being off, which trades a silent widening for a silent
 * disarming. So coverage 1 writes `Stop` + `PostToolUse` matcher `Agent`, which is
 * v0.16.1's pair. Coverage 2 writes `Stop` + `SubagentStart`, plus `SessionStart` matcher
 * `resume` because that level reads the register, and `PostToolUse` matcher `Skill` for a
 * configured list. Both write `UserPromptSubmit`. A skill list at coverage 1 is refused rather
 * than written: the gate at that level never reads one.
 *
 * OWNERSHIP IS READ FROM THE COMMAND. Claude Code drops `describe` from every hook entry whenever
 * it writes a settings file, and keeps `command`, `matcher` and `timeout` byte for byte
 * (adapters/HOOK-OUTPUT-NOTES.md, third and fourth addenda of 2026-09-14). Through 0.19.0 this
 * installer recognised its hooks by `describe`, so after the first such write a bare re-run refused
 * and `--remove` exited 1 over a gate it had written itself. A hook is now this installer's when
 * its command carries the fingerprint `./hook-ownership.mjs` defines: `AGENT_SKILLS_PROGRESS_GATE=`
 * among its leading assignments, and an argument whose basename is exactly `report-progress-gate.mjs`.
 * Every command this installer has written has that shape, because that assignment is what arms the
 * gate. A `describe` written by anything else is a statement of ownership, and that hook is never
 * taken, with or without a flag.
 *
 * ADOPTION is for what is left: a hook that runs this gate WITHOUT the assignment leading its
 * command — a hand-wiring, a `cd … &&` in front, an `env` prefix. It is refused on install and named
 * on removal, because overwriting somebody else's decision is how a settings file gets corrupted;
 * `--remove` never reports the gate gone while one still runs it, and exits 1 when one does. With
 * `--adopt` it is removed by `--remove` and replaced by an install, its level read out of its command
 * when no `--coverage` is named.
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
  RESUME_SOURCE,
  SESSION_START_EVENT,
  SKILLS_ENV_FLAG,
  TURN_HOOK_ENV_FLAG,
  TURN_HOOK_EVENT,
  isEntrypoint,
  resolveCoverage,
  resolveMode,
  resolveWatchedSkills,
} from './report-progress-gate.mjs';
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

export { hookLabel };

/** The gate file. A hook is this installer's when an argument of its command has exactly this basename… */
export const HOOK_MARKER = 'report-progress-gate.mjs';
/** …and the gate's own assignment leads that command (see `./hook-ownership.mjs`). This prefix still
 *  starts every `describe` written, and a describe that does not start with it vetoes ownership. */
export const DESCRIBE_PREFIX = 'agent-skills report-progress gate';
export const MODES = GATE_MODES;

/** What `./hook-ownership.mjs` needs to tell this installer's hooks from anybody else's. */
const IDENTITY = Object.freeze({ envFlag: GATE_ENV_FLAG, gateFile: HOOK_MARKER, describePrefix: DESCRIBE_PREFIX });

/** The events the gate needs, with the matcher each is scoped by. */
export const STOP_MATCHER = '*';
export const SUBAGENT_MATCHER = '*';
export const SKILL_MATCHER = 'Skill';
/** `UserPromptSubmit` takes no matcher; `*` is what the `Stop` half, which takes none either, was
 *  observed working with. */
export const TURN_MATCHER = '*';
/** `SessionStart` matcher `resume`: observed firing on `--resume` and not on a fresh start
 *  (adapters/HOOK-OUTPUT-NOTES.md, fifth addendum of 2026-09-14). The gate checks `source` again. */
export const RESUME_MATCHER = RESUME_SOURCE;
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

const USAGE = `Usage: install-report-progress-gate.mjs [--mode observe|block] [--coverage 1|2] [--skills <names>] [--adopt] [--settings <path>]
       install-report-progress-gate.mjs --remove [--adopt] [--settings <path>]

observe  report to stderr what the gate would have blocked; never ends a turn. (default)
block    hold the turn for one more round when an armed turn ends without a progress
         report, at most once per turn at either level. A UserPromptSubmit hook, written
         beside the others, clears the record of the spent block when the next turn starts.

--coverage 1  arm on one thing: a subagent dispatched through the Agent tool. What a new
              install gets when no level is given.
--coverage 2  arm on a subagent of any kind starting, on a skill named in --skills, and on
              a change in the harness's own list of background work.
         With no --coverage, re-running this script keeps the level of the gate already
         in the settings file, so updating the pack never changes that level. --mode and
         --skills are not carried over: a re-run that changes the mode or drops a skill
         list says so.

--skills a comma-separated list of skill names to treat as external agents, matched by
         EXACT name (e.g. --skills codex,gpt-researcher). Coverage 2 only. Empty by
         default, and when it is empty no hook is written for it at all. There is no
         matching of command text here, for any binary, ever.

--adopt  treat a hook that runs this gate WITHOUT the AGENT_SKILLS_PROGRESS_GATE= assignment
         leading its command — a hand-wiring — as this installer's own: --remove removes it,
         and an install replaces it, keeping the level its command runs at when no --coverage
         is given. Not needed for this installer's own hooks: every command it writes starts
         with that assignment, and that is how it recognises them, including after Claude Code
         has dropped their describe. A hook whose describe something else wrote is never
         adopted. Without --adopt, --remove names every hand-wiring it left and exits 1, and an
         install refuses and names them.

The gate checks the SHAPE of the report — three section labels, and a state and a
freshness on a running row. It cannot check whether anything in the report is true.`;

function shellQuote(value) {
  return `'${String(value).split("'").join(`'\\''`)}'`;
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
 * The hook entries, built together because installing one without the other is a
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

  // The turn hook is declared in every command, so the Stop half knows a UserPromptSubmit half was
  // written beside it — and a command from an older installer, which does not declare it, keeps the
  // behaviour it was installed with.
  const base = `${GATE_ENV_FLAG}=${mode} ${COVERAGE_ENV_FLAG}=${coverage} ${TURN_HOOK_ENV_FLAG}=${TURN_HOOK_EVENT}`;
  const command = `${base} ${shellQuote(nodePath)} ${shellQuote(gatePath)}`;
  // The allowlist rides only on the hook that reads it, so the Stop and SubagentStart
  // commands stay identical whether or not a list was configured.
  const skillCommand = `${base} ${SKILLS_ENV_FLAG}=${shellQuote(watched.join(','))} ${shellQuote(nodePath)} ${shellQuote(gatePath)}`;
  const removal = 'remove it by running this installer with --remove';
  const armed = coverage === 2
    ? 'a turn that started a subagent, invoked a listed external-agent skill, or in which the harness started or stopped listing a background task'
    : 'a turn that dispatched a subagent through the Agent tool';

  return {
    stop: {
      type: 'command',
      command,
      timeout: STOP_TIMEOUT_SECONDS,
      describe: mode === 'block'
        ? `${DESCRIBE_PREFIX} (block): on ${armed}, holds the turn for one more round when the final message has no "what is done / what is running / what is next" report, once per turn — the spent block is recorded where nothing inside the turn touches it, and the UserPromptSubmit half clears that record when the next turn starts; it matches the report's shape only and cannot verify anything in it, and ${removal}.`
        : `${DESCRIBE_PREFIX} (observe): on ${armed}, writes to stderr what a blocking gate would have refused in the final message and never holds the turn; it matches the report's shape only and cannot verify anything in it, and ${removal}.`,
    },
    // The turn boundary, at both levels: what lets the Stop half keep its record of a spent block for
    // exactly one turn.
    turnStart: {
      type: 'command',
      command,
      timeout: POST_TOOL_TIMEOUT_SECONDS,
      describe: `${DESCRIBE_PREFIX} (${mode}, turn start): clears the Stop half's record of a block it spent in the previous turn, so it can block once in this one; it arms nothing and prints nothing, and ${removal}.`,
    },
    // A resume, at coverage 2 only: the level that reads the register is the only level a resume can mislead.
    sessionStart: coverage !== 2 ? null : {
      type: 'command',
      command,
      timeout: POST_TOOL_TIMEOUT_SECONDS,
      describe: `${DESCRIBE_PREFIX} (${mode}, resume): notes that this session was resumed in a fresh process, whose list of background work starts empty, so the next Stop does not read the old process's tasks as gone; it arms nothing and prints nothing, and ${removal}.`,
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

/**
 * Every hook that runs this gate but is not this installer's: where it sits, and which kind it is —
 * `adoptable` (it runs the gate without the gate's assignment leading its command; `--adopt` can
 * take it) or `foreign` (a describe something else wrote; never adopted). Scanned over every event
 * key, as removal is, because a hook nobody can see is a hook nobody can remove.
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
 * Coverage 1 is `Stop` plus `PostToolUse` matcher `Agent`, which is v0.16.1's pair, plus
 * `UserPromptSubmit`. Coverage 2 is `Stop` plus `SubagentStart`, one event that covers every
 * subagent kind, foreground and backgrounded alike. It adds `UserPromptSubmit`, `SessionStart`
 * matcher `resume`, and `PostToolUse` matcher `Skill` only for a configured list. The second
 * family, work in flight at a turn end, needs no ARMING event of its own, because the harness
 * already hands the `Stop` payload its own register of it.
 *
 * `removeHooks` deliberately does NOT read this list. See its own comment.
 */
const HOOK_PLAN = Object.freeze([
  { event: 'Stop', matcher: STOP_MATCHER, key: 'stop' },
  { event: TURN_HOOK_EVENT, matcher: TURN_MATCHER, key: 'turnStart' },
  { event: SESSION_START_EVENT, matcher: RESUME_MATCHER, key: 'sessionStart' },
  { event: 'SubagentStart', matcher: SUBAGENT_MATCHER, key: 'subagentStart' },
  { event: 'PostToolUse', matcher: AGENT_MATCHER, key: 'agentTool' },
  { event: 'PostToolUse', matcher: SKILL_MATCHER, key: 'skill' },
]);

/**
 * Merge both hooks into a parsed settings object without disturbing anything else in it.
 * A hook that wears our name but that we did not write is somebody else's decision, so it
 * is refused rather than replaced.
 */
export function installHooks(settings, { entries, adopt = false }) {
  if (!plainObject(settings)) throw new Error('refusing to write: settings must be a JSON object');

  // Scanned over EVERY event key, not only the ones this version writes: a hook wearing the
  // gate's filename under an event we no longer touch is still somebody's decision, and
  // stacking a second gate beside it would spend two of the eight shared blocks on one
  // missing report. Every such hook is named, so the refusal is something a user can act on,
  // and `--adopt` lifts it for a hand-wiring — never for a hook under somebody else's describe.
  const blockers = findUnownedGateHooks(settings).filter((hook) => !(adopt && hook.kind === 'adoptable'));
  if (blockers.length > 0) {
    const lines = ['refusing to write: each hook below already runs this gate but was not written by this installer.', ...unownedLines(blockers)];
    if (blockers.some((hook) => hook.kind === 'adoptable')) {
      lines.push(`Run this script again with --adopt to treat each hook that runs this gate without the ${GATE_ENV_FLAG}= assignment as this installer's own and replace it.`);
    }
    throw new Error(lines.join('\n'));
  }
  // Validated only where we are about to WRITE. A shape we misread is a settings file we
  // could corrupt, and these three are the only keys this script edits.
  for (const { event, key } of HOOK_PLAN) {
    if (entries[key]) eventGroups(settings, event);
  }

  // Drop any previous copy of ours wherever it sits, so re-running this to change mode or
  // level replaces the gate instead of stacking a second one beside it, and so the arming
  // half of the level being left does not survive as an orphan beside the new one.
  const { settings: cleaned } = removeHooks(settings, { adopt });
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
 * EVENT-AGNOSTIC ON PURPOSE. It scans every key under `settings.hooks` for a hook carrying this
 * installer's fingerprint (`./hook-ownership.mjs`), rather than iterating the event list this version
 * happens to write. The version before this one did the latter, and the moment that list
 * stopped naming `PostToolUse` — which this version's default install no longer writes —
 * every already-installed user's `PostToolUse` hook became unremovable by `--remove`:
 * left in their settings forever, arming a marker nothing reads.
 *
 * With `adopt`, a hook that runs this gate without that fingerprint goes too, unless a describe
 * somebody else wrote vetoes it.
 * `removed` counts every hook taken out, adopted ones included; `unowned` is what still runs the
 * gate afterwards, so no caller can report the gate gone while a hook is still running it.
 */
export function removeHooks(settings, { adopt = false } = {}) {
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
    // Prune what we emptied, so removing leaves no residue behind — and only what we emptied.
    // A group this script could not read is somebody else's, and is put back untouched.
    settings.hooks[event] = settings.hooks[event].filter((group) => !isReadableGroup(group) || group.hooks.length > 0);
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  if (plainObject(settings.hooks) && Object.keys(settings.hooks).length === 0) delete settings.hooks;
  return { settings, removed, adopted, unowned: findUnownedGateHooks(settings) };
}


/**
 * What a command sets one of the gate's variables to, read the way the shell hands it to the gate —
 * or `legible: false` when the command sets it anywhere this reader cannot follow: after `env`,
 * `cd … &&` or `export`, from an expansion, or anywhere else the leading assignments do not account
 * for. Measured before this existed: `env …COVERAGE=2`, a `cd … &&` in front, an `export`, and a
 * double-quoted `"2"` each ran the gate at coverage 2 and were each read as 1, so adopting them
 * narrowed the gate while printing "Kept coverage 1". A level that cannot be read cannot be kept.
 */
function readAssignment(command, name) {
  const assigned = leadingAssignments(command).filter((entry) => entry.name === name);
  const mentions = String(command).match(new RegExp(`(?<![A-Za-z0-9_])${name}=`, 'g'))?.length ?? 0;
  if (mentions !== assigned.length) return { legible: false, value: undefined };
  return { legible: true, value: assigned.at(-1)?.value };
}

/**
 * The gate this installer already wrote into a settings file, read the way the running gate
 * reads its own command: the level and mode come from the assignments in front of it and are
 * resolved by the gate's own `resolveCoverage` and `resolveMode`, not a restatement of them.
 * So a command naming no level — as v0.16.1 wrote it — or an unrecognised one is coverage 1,
 * which is exactly what that gate is running at.
 *
 * Only hooks this installer wrote are read — plus, under `--adopt`, the hooks it is about to
 * adopt, so adopting with no `--coverage` keeps the level the adopted command was running at,
 * exactly as a bare re-run keeps its own. The mode is read from `Stop` by preference, because
 * that is the hook that holds a turn; any other of ours stands in when there is no `Stop`.
 *
 * THE LEVEL IS KEPT ONLY WHEN THERE IS ONE LEVEL TO KEEP. If any of those hooks sets the level
 * where `readAssignment` cannot follow it, or two of them run at different levels, `coverage` is
 * `null` and `unknown` says why: the caller then needs `--coverage`, because any level it picked
 * would be a guess printed as "Kept". Returns `null` when the file holds no gate of ours.
 */
export function readInstalledGate(settings, { adopt = false } = {}) {
  if (!plainObject(settings)) return null;
  const candidates = [];
  for (const event of eventKeys(settings)) {
    for (const group of readableGroups(settings, event) ?? []) {
      for (const hook of group.hooks) {
        const kind = classifyHook(hook, IDENTITY);
        let adopted;
        if (kind === 'ours') adopted = false;
        else if (adopt && kind === 'adoptable') adopted = true;
        else continue;
        const level = readAssignment(hook.command, COVERAGE_ENV_FLAG);
        const mode = readAssignment(hook.command, GATE_ENV_FLAG);
        const watched = readAssignment(hook.command, SKILLS_ENV_FLAG);
        candidates.push({
          event,
          matcher: group.matcher,
          adopted,
          coverage: level.legible ? resolveCoverage({ [COVERAGE_ENV_FLAG]: level.value }) : null,
          mode: mode.legible ? resolveMode({ [GATE_ENV_FLAG]: mode.value }) : null,
          // Read only to say, on a re-run that names no --skills, which list it is dropping.
          skills: watched.legible && watched.value !== undefined ? resolveWatchedSkills({ [SKILLS_ENV_FLAG]: watched.value }) : [],
        });
      }
    }
  }
  if (candidates.length === 0) return null;
  // `Stop` first; within an event, a hook this installer wrote over one it is adopting.
  const stops = candidates.filter((entry) => entry.event === 'Stop');
  const lead = stops.find((entry) => !entry.adopted) ?? stops[0]
    ?? candidates.find((entry) => !entry.adopted) ?? candidates[0];
  const unreadable = candidates.find((entry) => entry.coverage === null);
  const levels = new Set(candidates.map((entry) => entry.coverage));
  let unknown = null;
  if (unreadable) {
    unknown = `the command of its ${hookLabel(unreadable)} hook sets ${COVERAGE_ENV_FLAG} somewhere other than a plain assignment at the start of the command — after env, cd … &&, or export, or from an expansion — so this installer cannot read the level the gate really runs at`;
  } else if (levels.size > 1) {
    unknown = `its hooks run at different levels: ${candidates.map((entry) => `${hookLabel(entry)} at ${entry.coverage}`).join(', ')}`;
  }
  const skills = [...new Set(candidates.flatMap((entry) => entry.skills))];
  const events = [...new Set(candidates.map((entry) => entry.event))];
  return { coverage: unknown ? null : lead.coverage, mode: lead.mode, adopted: lead.adopted, unknown, skills, events };
}

/** One line naming where the level came from. A silent level is the defect this replaced. */
function describeLevel({ named, existing, coverage }) {
  const other = coverage === 1 ? 2 : 1;
  const change = `Pass --coverage ${other} to ${other > coverage ? 'widen' : 'narrow'} it`;
  if (named !== null) {
    if (!existing) return `Set coverage ${coverage}.`;
    if (existing.coverage === null) return `Set coverage ${coverage} (no single level could be read from the gate already in this file).`;
    return existing.coverage === coverage
      ? `Set coverage ${coverage} (unchanged).`
      : `Set coverage ${coverage} (was ${existing.coverage}).`;
  }
  if (existing) {
    const source = existing.adopted ? 'read from the adopted hook' : 'already installed in this file';
    return `Kept coverage ${coverage} (${source}). ${change}.`;
  }
  return `Set coverage ${coverage} (the default for a new install). ${change} — what that adds, and what it costs, is below.`;
}

/** Mode keeps its documented default; when that default changes an installed gate, say so. */
function describeModeChange({ modeGiven, existing, mode }) {
  if (!existing || existing.mode === mode) return null;
  if (existing.mode === null) {
    return modeGiven ? null : `Mode ${mode}, the default — the mode the gate already in this file ran in could not be read from its command. Pass --mode observe or --mode block to choose it.`;
  }
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
  const options = { mode: null, modeGiven: false, coverage: null, settingsPath: null, skills: [], skillsGiven: false, remove: false, adopt: false, help: false };
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
      options.skillsGiven = true;
      options.skills = normaliseSkills(argv[index] ?? '');
    } else if (argument === '--remove') options.remove = true;
    else if (argument === '--adopt') options.adopt = true;
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
      // Named before removal, because removal edits `settings` in place.
      const adoptable = options.adopt ? findUnownedGateHooks(settings).filter((hook) => hook.kind === 'adoptable') : [];
      const { settings: pruned, removed, adopted, unowned } = removeHooks(settings, { adopt: options.adopt });
      // Written only when something was removed: a run that removed nothing leaves the file byte
      // for byte as it found it.
      if (removed > 0) await writeSettings(settingsPath, pruned);
      const report = [];
      if (removed > 0) report.push(`Removed ${countOf(removed, 'report-progress gate hook')} from ${settingsPath}.`);
      if (options.adopt) {
        report.push(adopted > 0
          ? `Adopted ${adopted} of them: ${adopted === 1 ? 'a hook' : 'hooks'} that ran this gate without the ${GATE_ENV_FLAG}= assignment — ${adoptable.map(hookLabel).join(', ')}.`
          : `Adopted none: no hook in this file ran this gate without the ${GATE_ENV_FLAG}= assignment.`);
      }
      // THE GATE IS GONE ONLY WHEN NOTHING RUNS IT. This branch once printed "No report-progress
      // gate was installed … Nothing changed." and exited 0 while two hooks the harness had stripped
      // of describe kept running the gate. So every hook left running it is named, with what can be done about it,
      // and the run fails: what was asked for — the gate out of this file — did not happen.
      if (unowned.length === 0) {
        report.push(removed > 0
          ? 'No turn will be held again unless you install it back.'
          : `No report-progress gate was installed in ${settingsPath}. Nothing changed.`);
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

    // Named, then installed, then the default. The middle step is the point: re-running this
    // script to pick up a new version must never be the thing that changes what it enforces.
    const existing = readInstalledGate(settings, { adopt: options.adopt });
    // Checked before the fallback below, which would otherwise turn an unreadable level into the
    // default and print it as kept.
    if (options.coverage === null && existing && existing.coverage === null) {
      throw new Error(`refusing to write: there is no single coverage level to keep in ${settingsPath}: ${existing.unknown}. Name the level with --coverage 1 or --coverage 2.`);
    }
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
    // Named before installing, because installing edits `settings` in place.
    const adoptable = options.adopt ? findUnownedGateHooks(settings).filter((hook) => hook.kind === 'adoptable') : [];
    const updated = installHooks(settings, { entries, adopt: options.adopt });
    await writeSettings(settingsPath, updated);

    stdout.write(`Installed the ${options.mode} report-progress gate into ${settingsPath}.\n`);
    if (options.adopt) {
      stdout.write(adoptable.length > 0
        ? `Adopted ${countOf(adoptable.length, 'hook')} that ran this gate without the ${GATE_ENV_FLAG}= assignment, and replaced ${adoptable.length === 1 ? 'it' : 'them'}: ${adoptable.map(hookLabel).join(', ')}.\n`
        : `Adopted none: no hook in this file ran this gate without the ${GATE_ENV_FLAG}= assignment.\n`);
    }
    stdout.write(`${describeLevel({ named: options.coverage, existing, coverage })}\n`);
    const modeChange = describeModeChange({ modeGiven: options.modeGiven, existing, mode: options.mode });
    if (modeChange) stdout.write(`${modeChange}\n`);
    // Like the mode, a skill list is not carried over, so an update that drops one says so rather
    // than narrowing what arms the gate in silence.
    if (!options.skillsGiven && existing && existing.skills.length > 0) {
      const count = existing.skills.length;
      stdout.write(`Skill list not kept — the gate already in this file treated ${existing.skills.join(', ')} as external agent${count === 1 ? '' : 's'}, and this run named no --skills. Pass --skills ${existing.skills.join(',')}${coverage === 1 ? ' --coverage 2' : ''} to keep ${count === 1 ? 'it' : 'them'}.\n`);
    }
    // The hook that makes "once per turn" true is new, and an update that adds it says so.
    if (existing && !existing.events.includes(TURN_HOOK_EVENT)) {
      stdout.write(`Added a ${TURN_HOOK_EVENT} hook: the gate already in this file had none, so its record of a spent block did not outlast a re-arm later in the same turn. With it, the gate blocks at most once per turn.\n`);
    }
    if (coverage === 2 && existing && !existing.events.includes(SESSION_START_EVENT)) {
      stdout.write(`Added a ${SESSION_START_EVENT} hook (matcher ${RESUME_MATCHER}): without it, the first turn after resuming a session in a fresh process read the old process's background work as gone, and cost one block.\n`);
    }
    stdout.write((coverage === 1 ? [
      '',
      'ARMED ON ONE THING, and on nothing else:',
      '  - a subagent dispatched through the Agent tool in this turn (PostToolUse, matcher',
      '    Agent). That is v0.16.1\'s arming signal exactly.',
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
      'cost: more turns are held — a change in that list arms a turn with no tool call at',
      'all. Neither level blocks more than once in a turn.',
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
      'Every other turn ends exactly as it would with the gate absent — with two exceptions,',
      'each costing one block, once, and each worth hearing about before rather than after:',
      '  - the marker is per session and is cleared by the Stop that ends the turn, so a turn',
      '    that armed and then died without one (a crash, a kill) leaves it behind;',
      '  - a background result arriving while you ask something trivial arms that trivial turn.',
      'Resuming a session in a fresh CLI process starts the background list empty again. The',
      'SessionStart hook written beside the gate (matcher resume) notes the resume, so that',
      'first turn does not read the old process\'s work as gone.',
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
        'Block mode holds the turn for one more round, at most once per turn, and then stands',
        'down: if the next message still has no report, the turn ends anyway. That ceiling is',
        'not politeness. Claude Code ends a turn after 8 consecutive Stop blocks, the budget is',
        'shared with every other Stop hook you have installed, and when it runs out the',
        'result comes back as a success with an empty answer.',
        'What keeps it to once is a record of the spent block that nothing inside the turn',
        'touches, and the UserPromptSubmit hook written beside the gate, which clears that',
        'record when the next turn starts. UserPromptSubmit was observed firing at every turn',
        'start and never inside a continuation. A turn it does not fire for (slash-command',
        'turns are untested) cannot block while an earlier turn\'s block is still on record,',
        'rather than blocking twice. Keep the hooks together: without that one, the gate',
        'blocks once per session, not once per turn.',
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
