#!/usr/bin/env node
/**
 * The mechanical half of the `report-progress` skill: a Claude Code `Stop` hook
 * that refuses a turn's final message when that turn dispatched a subagent and
 * the message carries no progress report.
 *
 * A skill is instructions, and instructions are skippable — silently, with no
 * trace, on exactly the turns where the user has stopped reading and four
 * children are still running. This file is the part that is not instructions.
 * It is string matching in a hook, and that is the only reason it counts as
 * enforcement: no model sits in the enforcement path, so nothing here can be
 * talked out of firing.
 *
 * OFF UNLESS ARMED. Like the authoring floors in `journal-hook.mjs`, this file
 * writes nothing anywhere until `AGENT_SKILLS_PROGRESS_GATE=1` is in its
 * environment. An unarmed copy — wired by hand, copied out of a blog post,
 * inherited from someone else's settings — reads stdin and exits 0.
 * `install-report-progress-gate.mjs` is what arms it, by putting that
 * assignment in the command it writes; that is the user's act, and `--remove`
 * is how they take it back.
 *
 * WHAT ARMS IT, dispatched on `hook_event_name`. There are two families, and the
 * line between them is not what kind of thing was dispatched — it is what the
 * user cannot see: work that happened inside something whose transcript they
 * will not read, and work still in flight when they stop reading. Everything
 * below the `Agent` tool is coverage level 2; see `COVERAGE_ENV_FLAG`.
 *
 *   FAMILY A — OPAQUE DELEGATION. Each of these writes a per-session marker
 *   file and prints nothing at all.
 *
 *     SubagentStart — a subagent was started, foreground or backgrounded, of any
 *       kind. One event where the alternative was two, it carries `agent_id`, and
 *       it does not care whether the child was backgrounded. `agent_type`
 *       `workflow-subagent` and `""` are excluded; `armsForSubagentStart` says why.
 *     PostToolUse, `tool_name` "Skill" — the user listed this skill as an
 *       external agent. Exact name match, default empty list, and when the list
 *       is empty the installer writes no such hook at all. There is no matching
 *       of Bash command text here, for any binary; see `SKILLS_ENV_FLAG`.
 *     PostToolUse, `tool_name` "Agent" — v0.16.1's only signal, still honoured at
 *       every level so a settings entry written by that version keeps working.
 *       The tool is named `Agent`, not `Task`, on this harness (../NOTES.md:251,
 *       confirmed in the PreToolUse/PostToolUse pair that brackets a subagent's
 *       own SubagentStart/SubagentStop).
 *
 *   FAMILY B — WORK IN FLIGHT AT A TURN END, and it needs NO EVENT OF ITS OWN.
 *   `Stop` already carries `background_tasks[]`: the harness's own register of
 *   background shells, workflows and backgrounded subagents, delivered in the
 *   payload this gate is already reading. The gate compares the ids running now
 *   against the ids running at this session's previous `Stop` and arms on the
 *   EDGE — something appeared, or something that was running is no longer listed
 *   — never on the LEVEL. Arming on the level would demand a report on every turn
 *   for as long as a dev server sits in the background.
 *
 *   That is also the whole of the Workflow answer. A workflow launched in turn T
 *   is in T's own `Stop` register, so this file never reads `PostToolUse` for the
 *   `Workflow` tool at all — whose response arrives at duration_ms 3–5, the
 *   launch rather than the work, while the dispatching turn's `Stop` fires with
 *   the workflow still running.
 *
 *   Stop — reads the marker and computes that edge. Neither armed, no gate: a
 *     turn that delegated nothing and changed nothing ends exactly as it would
 *     with this file absent. That silence is the whole design. A gate that fires
 *     on "yes, that file is in src/" gets uninstalled within a day, and an
 *     uninstalled gate enforces nothing at all.
 *     The marker is keyed by SESSION, not by turn, and the `Stop` that ends a turn
 *     is what clears it — so a turn that dispatched a subagent and then died
 *     without a `Stop` leaves one behind, and the next turn in that session pays
 *     one block for a dispatch it did not make (MARKER_MAX_AGE_MS bounds how long
 *     that can happen). One block, then cleared; it is a cost, not a loop.
 *
 * WHAT IT STILL CANNOT SEE, kept here rather than in a release note because the
 * person most likely to overestimate this gate is the one reading its source:
 *   - a foreground external agent — a bare `codex exec` in a Bash call — unless
 *     the user listed the skill that runs it. Deliberate; `SKILLS_ENV_FLAG` says why.
 *   - the individual children of a workflow. The harness registers ONE entry for
 *     a workflow of twelve agents, the parent cannot observe those twelve
 *     children's state, and twelve invented rows would be exactly the fabrication
 *     the skill exists to stop, manufactured by the gate meant to prevent it.
 *   - background work that starts and finishes inside one turn. The register is
 *     sampled at `Stop`, so it is never sampled in time to see it.
 *   - which process a `Stop` came from. `background_tasks[]` belongs to the CLI
 *     process, not to the session id (OBSERVED, ../NOTES.md addendum 2026-09-14),
 *     and nothing in the payload names the process. A resume is covered by the
 *     `SessionStart` half, under A RESUME below. A gate installed without that half
 *     still reads the first `Stop` after a resume as a burst of disappearances, and
 *     pays one block. Two processes holding one session id at once share one
 *     baseline; that was not tested.
 *
 * IT CHECKS SHAPE, NOT TRUTH, and every string it prints says so. It can see
 * that three section labels are present and that a running row carries a state
 * word and a freshness token. It cannot see whether "812 passing" was ever run,
 * whether `child-7f2` exists, or whether "40s ago" is a real observation. A
 * message that satisfies this gate can still be a fabrication; the skill's own
 * checklist, run by a reader, is what catches that, and nothing here replaces it.
 *
 * ONE EXCEPTION, and it is CONTRADICTION DETECTION rather than verification.
 * When the register in this very payload lists n tasks as running, the report may
 * not assert the absence of what the harness just stated — not "Running: none",
 * and not `agent-lifecycle`'s no-evidence sentence, which is for a run with no
 * evidence source at all. The gate still cannot tell whether any row is TRUE; it
 * can now tell when one denies something it is holding in its hand. That catches a
 * real lie by string matching and cannot refuse an honest report, because an
 * honest report about n running tasks says neither of those two things. There is
 * no row-count check and no id matching: a report may legitimately group, and
 * forcing it to echo harness ids would buy a number nobody could verify. A DENIAL IS
 * A SECTION WITH NO ROW IN IT — both patterns are scanned over the whole running block,
 * so without that guard "state running, last observed just now — none of the tests
 * failed" read as "Running: none" and refused an honest report (measured, five shapes);
 * see `findReportFailures`.
 *
 * ONE BLOCK PER TURN, and the reason says only what holds it. Claude Code ends a turn
 * after 8 consecutive blocks, that budget is SHARED with every other `Stop`
 * hook from every settings source, and the observed failure when it runs out is
 * not "the gate gives up": the headless result comes back `subtype: "success"`,
 * `is_error: false`, `result: ""` — an empty answer reported as a clean run
 * (../HOOK-OUTPUT-NOTES.md, "the cap is 8 continuations per turn, shared").
 * Spending one block and standing down is what keeps this gate out of that
 * failure, and `stop_hook_active` is honoured rather than counted on.
 *
 * THE RECORD OF A SPENT BLOCK, and where a turn starts. A block is written to its
 * own per-session file (`spentFile`) before it is emitted, and a gate that cannot
 * write it declines to block. Nothing inside a turn touches that file: arming
 * rewrites the marker and standing down deletes it, and neither reaches the
 * record. The marker alone could not do that, which is why through 0.19.0 a re-arm
 * later in the turn — another `Agent` dispatch, another subagent, a register that
 * changed again — left only `stop_hook_active` between this gate and a second
 * block. The record is cleared by this file's `UserPromptSubmit` half, which the
 * installer writes at both levels and declares in every command as
 * `AGENT_SKILLS_PROGRESS_GATE_TURN_HOOK=UserPromptSubmit`. That event fires at the
 * start of every turn, a background completion's `<task-notification>` turn
 * included, and never inside a `Stop`-forced continuation; text arriving during a
 * foreground tool call is folded into the current turn without it, which keeps a
 * spent block spent (OBSERVED, ../HOOK-OUTPUT-NOTES.md, fourth addendum of
 * 2026-09-14). Where it does not fire for a turn — a slash-command turn was NOT
 * TESTED — that turn cannot block while an earlier turn's block is still on record,
 * because nothing else clears it; a turn after one that did not block still can. The
 * failure is a missed block, never a second one.
 *
 * WITHOUT THE DECLARATION the record is neither written nor read, and the gate
 * decides exactly as 0.19.0 did. A command an older installer wrote names no turn
 * hook, and its settings file has no `UserPromptSubmit` half to clear a record, so
 * reading one there would stop the gate blocking after its first block in the
 * session. Under those hooks a re-arm that meets a `Stop` without
 * `stop_hook_active` can still spend a second block, and the reason it prints says
 * only what is true there.
 *
 * `SubagentStop` is deliberately NOT wired, and widening this gate to cover every
 * subagent kind did not change that. It has no 8-block backstop at all
 * (DOCUMENTED, same file), so a bug here would hang a child agent indefinitely
 * rather than costing one continuation — and it is the event internal compaction
 * summarisation fires, with `agent_type: ""` and no matching `SubagentStart`
 * (OBSERVED, ../NOTES.md), so a gate armed there would demand a progress report
 * on the turn after a `/compact`. `SubagentStart` is the paired event that has
 * neither problem, which is precisely why it is the one this file reads.
 *
 * `UserPromptSubmit` is wired for ONE thing — clearing the record above — and never
 * arms anything. It is the channel for every real user prompt, so a bug there would
 * leak text into every turn of the session: the branch reads nothing but the
 * session id and writes nothing to stdout, and a hook that prints nothing adds
 * nothing to the model's request (OBSERVED, same addendum). A background completion
 * also arrives on it, and the gate still does not arm there: every completion it
 * could catch is already visible to the `Stop` hook as a disappearance from the
 * register, one turn later at the latest, at no additional cost.
 *
 * A RESUME. `SessionStart` is wired at coverage 2 for one thing, and it arms nothing and
 * prints nothing. The installer writes it on matcher `resume`, and this file acts only on
 * `source: "resume"`: `compact` fires inside the running process with its register
 * intact, and `startup` and `clear` begin a session id that has no baseline to misread.
 * The event fires with `source: "resume"` for `--resume` and `--continue`, before the
 * resumed process's first `Stop` (OBSERVED, ../HOOK-OUTPUT-NOTES.md, fourth and fifth
 * addenda of 2026-09-14). So it leaves a note (`resumeFile`), and that session's next
 * `Stop` drops the disappearances. It drops them only when none of the baseline's tasks
 * is still listed, which a new process, whose register starts empty, cannot do. On
 * `--fork-session` the event carries the PARENT's session id (OBSERVED, fourth addendum),
 * so the note can reach the parent's next `Stop` instead of the fork's. The fork has no
 * baseline to misread. The parent keeps every disappearance while any of its tasks is
 * still listed, and can miss one only when all of them went away in that same turn. That
 * is a missed block, never an extra one.
 *
 * The four rules in `journal-hook.mjs` hold here too, and this file states them
 * again because it is the one that can end a turn:
 *   1. It never fails what it observes. Every path exits 0, whatever happened.
 *   2. It never blocks on I/O. The stdin read is fenced; the only files it
 *      touches are small per-session files in a temp directory; it makes no
 *      network call and spawns no process.
 *   3. It never authors. The reason is assembled from fixed sentences and the
 *      names of the checks that failed — never from the user's text, the
 *      agent's text, or a subagent's prose.
 *   4. It never speaks when it has nothing to enforce. Not armed, not owed,
 *      already spent, or passing: stdout stays empty.
 */
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * True when this file is the program being run, false when it was imported.
 *
 * Observed on 2026-09-12: reached through a symlink — which is how the Skills CLI
 * installs a pack, `~/.claude/skills/<name>` pointing at `~/.agents/skills/<name>` —
 * `process.argv[1]` is the path as typed while `import.meta.url` is the file Node
 * resolved it to, so comparing the two as written was false, the file's `main()`
 * never ran, and it exited 0 having done nothing. For a Stop hook that means a gate
 * the user installed, sees in their settings, and which enforces nothing.
 *
 * BOTH sides are resolved, not just `argv[1]`: under `--preserve-symlinks-main` it is
 * `import.meta.url` that keeps the symlink, and resolving one side only fails the same
 * silent way in the other direction. `realpathSync.native` also returns the on-disk
 * case, which a case-insensitive volume otherwise makes compare unequal.
 *
 * Resolving can throw — a deleted entry, an unreadable parent — and a guard that throws
 * at load turns an import into a crash, so it falls back to comparing them unresolved.
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

/**
 * Arming flag, and the mode selector: `block` (or `1`) blocks, `observe` reports to
 * stderr what it would have blocked and lets the turn end. Anything else — unset, blank,
 * `0`, `true` — is off, which is what an unarmed copy of this file always is.
 */
export const GATE_ENV_FLAG = 'AGENT_SKILLS_PROGRESS_GATE';
/** The two armed modes the installer can write. `off` is not a mode; it is the default. */
export const GATE_MODES = Object.freeze(['observe', 'block']);
/** Overrides where marker files live. Exists so a test never writes to the real temp path. */
export const GATE_DIR_ENV = 'AGENT_SKILLS_PROGRESS_GATE_DIR';

/**
 * HOW WIDE THIS GATE ARMS, and the reason it is a separate flag from the mode.
 *
 * `2` adds everything described in the header above the `Agent`-tool dispatch: `SubagentStart`,
 * the watched-skill list, and the in-flight register. Absent, `1`, or anything unrecognised is
 * v0.16.1's behaviour EXACTLY — one signal, `PostToolUse` with `tool_name` `Agent`.
 *
 * It exists because the register half needs no new settings entry. `SubagentStart` and the
 * `Skill` hook cannot appear in a user's settings without them re-running the installer, but
 * the register rides on the `Stop` hook that is already there — so without this flag, updating
 * the pack would silently widen a gate the user armed under different terms. The adapter rule
 * is that a hook which can end a turn is off until a human arms it, and "arms it" has to mean
 * the shape they actually agreed to.
 *
 * An unrecognised value falls back to `1` rather than to `off`: a typo must never widen a gate
 * that can end a turn, and must never silently disable one the user installed either.
 */
export const COVERAGE_ENV_FLAG = 'AGENT_SKILLS_PROGRESS_GATE_COVERAGE';

/**
 * The externalised-agent allowlist: exact skill names, comma-separated, default EMPTY.
 *
 * This is the whole of the `/codex` answer, and it is deliberately small. The Bash path that
 * actually runs an external agent carries no distinguishing tool name — `tool_name` is `Bash`
 * and the only signal is `tool_input.command` TEXT — and matching command text is the defect
 * family the sibling release gate produced eight times over five rounds, where a false
 * positive merely denied a command. Here a false positive would demand a progress report
 * because the agent mentioned `codex` in a commit message. So: no command-text matching, not
 * for any binary, not behind a flag. A `Skill` call is structured (`tool_input.skill`), and an
 * exact `===` against a list the user typed is the only external-agent signal this file reads.
 */
export const SKILLS_ENV_FLAG = 'AGENT_SKILLS_PROGRESS_GATE_SKILLS';

/**
 * Declares that this gate's `UserPromptSubmit` half is installed beside it, and so that the record of
 * a spent block will be cleared when each turn starts. Exactly `UserPromptSubmit` declares it. Anything
 * else — absent included, which is every command an installer through 0.19.0 wrote — leaves the record
 * unwritten and unread. See the header's THE RECORD OF A SPENT BLOCK and WITHOUT THE DECLARATION.
 */
export const TURN_HOOK_ENV_FLAG = 'AGENT_SKILLS_PROGRESS_GATE_TURN_HOOK';
/** The event that marks a turn start, and the one value of `TURN_HOOK_ENV_FLAG` that declares it. */
export const TURN_HOOK_EVENT = 'UserPromptSubmit';

/** The event that marks a session resumed in a fresh CLI process, and the one `source` it acts on. */
export const SESSION_START_EVENT = 'SessionStart';
export const RESUME_SOURCE = 'resume';

/** A workflow's own children. Excluded from `SubagentStart` arming — see `armsForSubagentStart`. */
export const WORKFLOW_SUBAGENT_TYPE = 'workflow-subagent';

/** What armed a turn. One sentence each, and the reason is assembled from these alone. */
export const CAUSES = Object.freeze([
  'agent-tool',
  'subagent-start',
  'watched-skill',
  'tasks-appeared',
  'tasks-disappeared',
]);

/**
 * The sentence `agent-lifecycle` publishes for a run with no lifecycle evidence,
 * and which `report-progress` carries verbatim. Present anywhere in the message it
 * satisfies the running requirement outright: the skill puts it IN PLACE OF the
 * section, so demanding a state and a freshness beside it would block the one
 * message the skill tells an honest agent to send.
 */
export const NO_EVIDENCE_SENTENCE = 'Background work visibility unavailable; state unknown.';

/**
 * How long a marker stays armed. A session that crashed between dispatch and Stop must not
 * gate a turn hours later, in which the user asked something else entirely.
 *
 * THE LIMIT THIS LEAVES, stated because the reason string is written to respect it: a marker
 * is cleared by the next `Stop`, so its scope is one turn ONLY for turns that reach a `Stop`
 * at all. A turn that dispatches a subagent and then dies — a crash, a kill, and possibly an
 * interrupt, which `../HOOK-OUTPUT-NOTES.md` does not record either way — leaves the marker
 * behind, and the next turn in that session, within this window, is gated on a dispatch it
 * did not make. It costs one block and then clears, so the ceiling holds; what it must not do
 * is let the gate tell the model "this turn dispatched a subagent", which the marker cannot
 * support. `buildBlockReason` says "a subagent was dispatched" for exactly this reason.
 */
export const MARKER_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** The marker shape this version writes. Nothing reads it; it is here for a future reader
 *  staring at a file on disk that a different version left behind. */
const MARKER_VERSION = 2;

/** Ceiling on how many register ids are carried between turns. A backstop, not a size any
 *  real session approaches: the register is a list of background tasks, not of tool calls. */
const MAX_REGISTER_IDS = 200;

/** Ceiling on the configured skill allowlist, for the same reason. */
const MAX_WATCHED_SKILLS = 32;

/** Bounded, per rule 2: a harness that never closes stdin must not hold the turn. */
const STDIN_TIMEOUT_MS = 1500;

/** Hard ceiling on the reason. It is built from fixed sentences, so this is a backstop,
 *  not a size any real reason approaches. */
const MAX_REASON_CHARS = 4000;

/** Only the first 200 lines of a message are scanned. A 4000-line paste cannot turn a
 *  gate meant to cost microseconds into something a user notices. */
const MAX_LINES_SCANNED = 200;

const SECTION_IDS = Object.freeze(['done', 'running', 'next']);

/**
 * What a section label looks like at the head of a line. These match the shapes the
 * skill's own worked example uses ("Done — verified here:", "Running:", "Next:") plus
 * the headings and bold labels a report is just as likely to be written with.
 */
const LABEL_PATTERNS = Object.freeze({
  done: /^(?:what(?:'s|s| is| has been| was)?\s+)?(?:been\s+)?(?:done|completed|complete|landed|shipped|finished)\b/i,
  running: /^(?:what(?:'s|s| is)?\s+)?(?:running|in[ -]flight|in progress|ongoing|still running|background(?: work| agents?)?|children|child agents?)\b/i,
  next: /^(?:(?:what(?:'s|s| is)?|up)\s+)?next(?:\s+(?:up|steps?|actions?))?\b/i,
});

/** Human names for the three sections, used only in the reason. */
const SECTION_NAMES = Object.freeze({ done: 'what is done', running: 'what is running', next: 'what is next' });

/** The lifecycle states `agent-lifecycle` defines, plus the two derived ones a report
 *  is allowed to show. A row that names none of them has no state on it. */
const STATE_PATTERN = /\b(?:created|starting|running|waiting|queued|blocked|completed|complete|failed|cancelled|canceled|lost|stale|terminated|succeeded|errored)\b/i;

/** An explicitly-empty running section. "Nothing running" is a result the skill calls
 *  valid, and blocking it would punish the honest report for being short. */
const EMPTY_SECTION_PATTERN = /\b(?:none|nothing|no (?:child|children|background|subagents?|agents?|work|runs?)\b|empty|n\/a)\b/i;

/** A duration with a unit. The unit is what keeps a version string, a port number and a
 *  PR number out: `v1.2.3`, `port 3000` and `#4821` carry digits and no unit at all. */
const DURATION = String.raw`\d+(?:\.\d+)?\s*(?:ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?)\b`;

/** The words that make a duration an OBSERVATION AGE rather than a measurement. Without
 *  one of these, "ran in 4m 12s" would read as freshness, and a report could satisfy the
 *  gate while never saying when anything was last seen. */
const OBSERVED = String.raw`last\s+(?:observed|seen|updated?|heard|checked|polled)|observed|updated|refreshed|heartbeat|as of`;

const FRESHNESS_PATTERN = new RegExp(
  [
    String.raw`(?:${DURATION}\s*(?:ago|old)\b)`,
    String.raw`(?:\b(?:${OBSERVED})\b[^\n]{0,40}?${DURATION})`,
    String.raw`(?:\b(?:${OBSERVED})\b[^\n]{0,30}?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2})`,
    String.raw`(?:\b(?:${OBSERVED})\b[^\n]{0,20}?\bjust now\b)`,
  ].join('|'),
  'i',
);

function truncate(value, max) {
  if (typeof value !== 'string' || value.length <= max) return value;
  return `${value.slice(0, max)}…(truncated)`;
}

/** Strip the markdown a label can be wearing — heading hashes, a bullet, a table pipe, a
 *  blockquote arrow, emphasis — so that `## Done`, `- **Done:**` and `| Done |` are all
 *  recognised as the same label rather than as three near-misses. */
function stripDecoration(line) {
  return String(line)
    .replace(/^\s*(?:>\s*)*/, '')
    .replace(/^\s*\|\s*/, '')
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)?/, '')
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/^[*_`~]+/, '')
    .trim();
}

/**
 * True when this line HEADS a section rather than merely opening a sentence with the
 * same word. "Done — verified here: 4 commits" heads one; "Done some refactoring of the
 * loader before the tests ran" does not, and treating it as one would let a report pass
 * on a coincidence.
 */
function labelsSection(line, pattern) {
  const stripped = stripDecoration(line);
  const match = pattern.exec(stripped);
  if (!match) return false;
  const rest = stripped.slice(match[0].length);
  if (/^[\s*_`:~]*$/.test(rest)) return true; // a bare heading: "## Done"
  // A colon, a dash of any width, or the next cell of a table row: "| Running | child-7f2 |"
  // is the shape a status table uses, and rejecting it would block a perfectly good report.
  if (/^[^A-Za-z0-9]{0,4}[:\-–—|]/.test(rest)) return true;
  return /^[^:\n]{0,32}:/.test(rest); // "Done so far: …"
}

function lines(message) {
  return String(message).split('\n').slice(0, MAX_LINES_SCANNED);
}

/** Does the message carry a heading line for this section? */
export function hasSectionLabel(message, section) {
  const pattern = LABEL_PATTERNS[section];
  if (!pattern) return false;
  return lines(message).some((line) => labelsSection(line, pattern));
}

/**
 * The running section's own text: the labelled line and everything under it, up to the
 * next section label or heading. Returns `''` when there is no running label — the
 * caller reports that as its own separate failure rather than as an empty section.
 */
export function runningBlock(message) {
  const all = lines(message);
  const start = all.findIndex((line) => labelsSection(line, LABEL_PATTERNS.running));
  if (start === -1) return '';
  const collected = [all[start]];
  for (const line of all.slice(start + 1)) {
    const heads = SECTION_IDS.some((id) => id !== 'running' && labelsSection(line, LABEL_PATTERNS[id]));
    if (heads || /^\s*#{1,6}\s/.test(line)) break;
    collected.push(line);
  }
  // Drop the label itself before the state scan: "Running:" would otherwise satisfy the
  // state check with its own heading, and every running section would pass it for free.
  collected[0] = stripDecoration(collected[0]).replace(LABEL_PATTERNS.running, '');
  return collected.join('\n');
}

export function hasStateToken(text) {
  return STATE_PATTERN.test(String(text));
}

export function hasFreshnessToken(text) {
  return FRESHNESS_PATTERN.test(String(text));
}

export function declaresEmpty(text) {
  return EMPTY_SECTION_PATTERN.test(String(text));
}

/**
 * FAMILY A, delegation. True when this `SubagentStart` is a subagent whose transcript the
 * user will not read, and which this turn is therefore accountable for.
 *
 * Two exclusions, each with a reason it is not squeamishness:
 *
 *   `workflow-subagent`  A workflow's children start ASYNCHRONOUSLY, at times no turn owns.
 *     A child starting while the session sits idle would arm whatever the next turn happened
 *     to be about. Workflow work is already covered by the in-flight register, which is
 *     anchored to turn ends by construction, so excluding it here removes a false-refusal
 *     source and loses no coverage.
 *   `""` and absent  The shape internal compaction summarisation fires with (../NOTES.md:
 *     a `SubagentStop` with `agent_type: ""` and no matching `SubagentStart`). Arming on it
 *     would demand a progress report on the turn after a `/compact`. Never arm on the
 *     absence of evidence — the principle that decides every borderline case in this file.
 *
 * Any other non-empty `agent_type` arms, including one this file has never heard of: an
 * unfamiliar subagent kind is still a subagent.
 */
export function armsForSubagentStart(payload) {
  const type = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload.agent_type : undefined;
  if (typeof type !== 'string') return false;
  const trimmed = type.trim().toLowerCase();
  return trimmed !== '' && trimmed !== WORKFLOW_SUBAGENT_TYPE;
}

/** The allowlist, parsed. Trimmed, lower-cased, blanks dropped, bounded. Default empty. */
export function resolveWatchedSkills(env = process.env) {
  return String(env[SKILLS_ENV_FLAG] ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== '')
    .slice(0, MAX_WATCHED_SKILLS);
}

/**
 * FAMILY A, opt-in half. An EXACT match against a name the user typed, and nothing else:
 * no substring, no prefix, no regex. `codex-helper` is not `codex`, and the one time this
 * file is tempted to be clever about a name is the time it starts demanding reports for
 * calls nobody delegated.
 */
export function armsForSkill(payload, allowlist = []) {
  if (!Array.isArray(allowlist) || allowlist.length === 0) return false;
  const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload.tool_input : undefined;
  const name = input && typeof input === 'object' && !Array.isArray(input) ? input.skill : undefined;
  if (typeof name !== 'string') return false;
  const trimmed = name.trim().toLowerCase();
  return trimmed !== '' && allowlist.includes(trimmed);
}

/**
 * FAMILY B, the harness's own register of work in flight, read out of the `Stop` payload the
 * gate is already holding: `background_tasks[] = {id, type, status, description, …}`.
 *
 * Two rules, and both are bugs if they are got wrong:
 *
 *   Count only `status === "running"`. That was the only value ever OBSERVED on this array,
 *   and an entry with a status this file does not recognise is not evidence that anything is
 *   running. A finished task is REMOVED from the array rather than re-labelled (OBSERVED,
 *   ../NOTES.md addendum 2026-09-14), so there is no terminal status to read here at all.
 *
 *   Never enumerate `type`. `shell`, `workflow` and `subagent` have all been seen; a
 *   backgrounded `Agent` subagent registers as `subagent` with its `agent_id` as the entry's
 *   `id`. A build that adds a fourth kind must not become invisible to this gate.
 */
export function runningTaskIds(backgroundTasks) {
  if (!Array.isArray(backgroundTasks)) return [];
  const ids = [];
  for (const task of backgroundTasks) {
    if (!task || typeof task !== 'object' || Array.isArray(task)) continue;
    if (task.status !== 'running') continue;
    if (typeof task.id !== 'string' || task.id === '') continue;
    if (!ids.includes(task.id)) ids.push(task.id);
    if (ids.length >= MAX_REGISTER_IDS) break;
  }
  return ids;
}

/**
 * The EDGE in that register, never its level.
 *
 * Arming on the level — "something is running, so report" — would demand a report on every
 * turn for as long as a dev server sits in the background, which is the noise that gets a
 * gate uninstalled. The edge matches the skill's own trigger wording exactly: before ending a
 * turn in which background work was started, or in which a background result arrived.
 *
 * An ABSENT baseline is EMPTY, not unknown. A session's first `Stop` has neither, so
 * absent-as-empty is right there. Where it is wrong, as with a swept temp directory, it costs
 * one block, once. The other reading would make the FIRST appearance of any task unarmable,
 * which is the one that matters most.
 *
 * `resumed` covers the opposite case: a baseline that is present, but was written by a process
 * that no longer exists. That is a session resumed in a fresh CLI process, whose register starts
 * empty. The `SessionStart` half notes the resume, and without `resumed` the first `Stop` would
 * read every old task as gone.
 */
export function registerEdge({ current = [], previous = [], resumed = false } = {}) {
  const now = new Set(Array.isArray(current) ? current : []);
  const before = new Set(Array.isArray(previous) ? previous : []);
  // A NEW PROCESS CANNOT STILL LIST ANY OF THE OLD PROCESS'S TASKS, because its register starts empty. So
  // after a resume the disappearances are dropped only when none of the baseline is listed now. Where one
  // still is, this `Stop` came from the process that wrote the baseline, which is what the parent of a
  // fork looks like, since the fork's `SessionStart` carried the parent's id. What went away there really
  // went away.
  const newProcess = resumed === true && ![...before].some((id) => now.has(id));
  return {
    appeared: [...now].filter((id) => !before.has(id)),
    disappeared: newProcess ? [] : [...before].filter((id) => !now.has(id)),
  };
}

/**
 * The whole check, as a pure function: a message in, a list of failures out. Empty list
 * means the shape is there.
 *
 * A blank or missing message returns NO failures on purpose. `last_assistant_message`
 * absent is a fact about the payload, not evidence that the agent skipped the report,
 * and a gate that blocks on what it could not read is a gate that fires at random.
 */
export function findReportFailures(message, { runningTaskCount = 0 } = {}) {
  if (typeof message !== 'string' || message.trim() === '') return [];
  const failures = [];

  // CONTRADICTION DETECTION, NOT CONTENT VERIFICATION. When the harness listed n tasks as
  // running in the very payload this gate is reading, the report may not assert the absence
  // of what the harness just stated. The gate still cannot tell whether any row is TRUE; it
  // can now tell when one denies something it is holding in its hand. That catches a real
  // lie by string matching and cannot refuse an honest report, because an honest report
  // about n running tasks says neither of the two things below.
  const inFlight = Number.isFinite(runningTaskCount) && runningTaskCount > 0;
  const tally = `${runningTaskCount} background task${runningTaskCount === 1 ? '' : 's'}`;
  const noEvidence = message.includes(NO_EVIDENCE_SENTENCE);
  // `agent-lifecycle`'s sentence is for a run with NO evidence source. The register in this
  // payload is one, so it stands in for the section only when there is nothing in flight.
  const standsIn = noEvidence && !inFlight;

  // A DENIAL IS A SECTION WITH NOTHING IN IT, not a word that appears somewhere inside one.
  // Both contradiction checks below are gated on this, and that is not fussiness: the patterns
  // they use are scanned over the WHOLE running block, so "state running, last observed just
  // now — none of the tests failed", "Failures: none so far" and "(queue empty)" all match
  // `declaresEmpty`, and a report may quote the no-evidence sentence while explaining it. Each
  // of those was measured to block an honest report before this guard existed. A section that
  // carries a real row — a literal state AND a freshness, which is everything this gate can
  // ask of a row — is not denying anything, whatever words sit beside it.
  const running = runningBlock(message);
  const carriesRow = running !== '' && hasStateToken(running) && hasFreshnessToken(running);

  for (const id of SECTION_IDS) {
    if (id === 'running' && standsIn) continue;
    if (!hasSectionLabel(message, id)) {
      failures.push({ code: `missing-${id}`, detail: `no "${SECTION_NAMES[id]}" section` });
    }
  }

  if (noEvidence && inFlight && !carriesRow) {
    failures.push({
      code: 'no-evidence-claimed-while-tasks-in-flight',
      detail: `the report says there is no lifecycle evidence, while the harness register in this same payload lists ${tally} still running`,
    });
    return failures;
  }
  // The no-evidence sentence stands in place of the section, states and freshness included.
  if (standsIn) return failures;

  if (running === '') return failures;
  if (declaresEmpty(running) && !carriesRow) {
    if (inFlight) {
      failures.push({
        code: 'running-declared-empty-while-tasks-in-flight',
        detail: `the running section says it is empty, while the harness register in this same payload lists ${tally} still running`,
      });
    }
    return failures;
  }

  if (!hasStateToken(running)) {
    failures.push({ code: 'running-row-without-state', detail: 'the running section names no literal state (running, waiting, completed, failed, cancelled, lost)' });
  }
  if (!hasFreshnessToken(running)) {
    failures.push({ code: 'running-row-without-freshness', detail: 'the running section carries no freshness — how long ago the child was last observed' });
  }
  return failures;
}

/**
 * The text the harness delivers to the model as a plain user-role message prefixed
 * "Stop hook feedback:" (../HOOK-OUTPUT-NOTES.md). Assembled from fixed sentences and
 * the failing checks' own names — rule 3: nothing here is drafted from anyone's prose.
 *
 * Three things it must say, and each is here because leaving it out has a cost:
 * what is actually missing (otherwise the model guesses and guesses wrong), that this
 * is a shape check (otherwise a passing report reads as a verified one), and that the
 * gate stands down after this (otherwise the model treats an unresolvable loop as
 * possible and starts negotiating with it).
 */
const CAUSE_SENTENCES = Object.freeze({
  'agent-tool': 'a subagent was dispatched through the Agent tool',
  'subagent-start': 'a subagent was started',
  'watched-skill': "a skill on this gate's external-agent list was invoked",
  'tasks-appeared': 'the harness registered background work during this turn',
  // A DISAPPEARANCE IS NOT A COMPLETION, and this sentence is where that is enforced. The
  // gate sees exactly one snapshot omission, with no heartbeat and no terminal status to
  // read; `agent-lifecycle` owns terminal states and they are immutable once set. So the
  // sentence says what was observed and stops there.
  'tasks-disappeared': 'work this session listed as running at the previous turn end is no longer listed by the harness (this gate cannot see a terminal state — only that the listing stopped)',
});

/** The causes, as one clause. Unknown codes are dropped rather than printed. */
function causeClause(causes) {
  const sentences = (Array.isArray(causes) ? causes : [])
    .filter((cause) => Object.hasOwn(CAUSE_SENTENCES, cause))
    .map((cause) => CAUSE_SENTENCES[cause]);
  if (sentences.length === 0) return CAUSE_SENTENCES['agent-tool'];
  if (sentences.length === 1) return sentences[0];
  return `${sentences.slice(0, -1).join(', ')}, and ${sentences[sentences.length - 1]}`;
}

export function buildBlockReason(failures, { causes = ['agent-tool'], runningCount = 0, turnHook = false } = {}) {
  const missing = failures.map((failure) => `- ${failure.detail}`).join('\n');
  const inFlight = Number.isFinite(runningCount) && runningCount > 0;
  // Counts this gate computed are facts and may be stated. Text it copied out of the payload
  // — a task's `description`, its `command`, a workflow's name — is somebody else's prose
  // arriving in a channel the model reads as instructions, and rule 3 forbids it.
  const register = inFlight
    ? [
      '',
      `The harness's own register listed ${runningCount} background task${runningCount === 1 ? '' : 's'} still running at this turn end. The running section may not say it is empty, and the no-evidence sentence may not stand in its place: there is evidence, in this same payload.`,
      'Nothing in this harness carries a timestamp, so a row sourced from that register can honestly carry only "last observed just now (harness register at turn end)" as its freshness. Do not invent an interval nothing measured.',
      'One row per unit the harness registers: a workflow of twelve agents is ONE row, not twelve. Twelve rows carrying states nobody observed is invention wearing a status block.',
    ]
    : [];
  return truncate([
    `Progress-report gate: ${causeClause(causes)}, so a progress report is owed before the turn ends, and this message does not carry the shape of one.`,
    '',
    'Missing:',
    missing,
    ...register,
    '',
    // The shape alone teaches the shape. Measured in live sessions: the gate fired, the three
    // headings came back, and the skill was never loaded — so none of what it is for (numbers the
    // author checked kept apart from numbers they were told, the user-facing consequence,
    // corrections said out loud) reached the reader. Naming the skill first costs one line and is the only pointer
    // the model gets: skills load by description match, and a gate's reason is not one.
    'Load the `report-progress` skill and follow it: this gate matches a shape, and the skill carries what makes the report worth reading — numbers you checked yourself kept apart from numbers you were told, the user-facing consequence named, and corrections stated out loud. If it is not installed, write the shape below from here.',
    'Write the report now, in the report-progress shape: what is done, what is running, what is next — each item carrying a count or a named artefact. Every running row needs a literal state and a freshness (for example: "child-7f2, state running, last observed 40s ago"). Where there is no lifecycle evidence at all, use exactly this sentence in place of the running section:',
    NO_EVIDENCE_SENTENCE,
    'An empty section says it is empty ("Running: none") rather than being omitted.',
    '',
    'This gate matches strings. It can see whether the shape is present; it cannot tell whether any number in the report is real, and satisfying it is not evidence that anything in the report is true.',
    // Two sentences, because what holds the ceiling differs. With the turn hook declared, this gate's own
    // record does. Without it, a re-arm later in the turn is kept quiet only by the harness marking the
    // turn's later stops, so "once per turn" is not this gate's to promise there.
    turnHook
      ? 'It blocks once per turn and then stands down: if the next message still has no report, the turn ends anyway. Do not fight it — write the report.'
      : 'It stands down after this block: the harness marks the rest of this turn\'s stops and the gate does not block on those, so if the next message still has no report, the turn ends anyway. Do not fight it — write the report.',
    'To remove it: run the pack adapter\'s install-report-progress-gate.mjs with --remove.',
  ].join('\n'), MAX_REASON_CHARS);
}

/**
 * `off` unless the environment says otherwise, and `off` for any value this file does not
 * recognise. A typo in a settings file must leave the gate inert rather than guessing that
 * the user meant the mode that can end a turn.
 */
export function resolveMode(env = process.env) {
  const raw = String(env[GATE_ENV_FLAG] ?? '').trim().toLowerCase();
  if (raw === 'block' || raw === '1') return 'block';
  if (raw === 'observe') return 'observe';
  return 'off';
}

/**
 * How wide the gate arms. `2` or nothing. See `COVERAGE_ENV_FLAG` for why this is not part
 * of the mode: an unrecognised value falls back to the NARROWER armed level, never to `off`
 * and never to the wider one.
 */
export function resolveCoverage(env = process.env) {
  return String(env[COVERAGE_ENV_FLAG] ?? '').trim() === '2' ? 2 : 1;
}

/** True only when the command declares the `UserPromptSubmit` half. See `TURN_HOOK_ENV_FLAG`. */
export function resolveTurnHook(env = process.env) {
  return String(env[TURN_HOOK_ENV_FLAG] ?? '').trim() === TURN_HOOK_EVENT;
}

/** The session-keyed directory both files live in, and the sanitised session name. */
function sessionPath(env, sessionId, suffix) {
  const directory = env[GATE_DIR_ENV]?.trim() || path.join(tmpdir(), 'agent-skills-report-progress-gate');
  const safe = String(sessionId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 96) || 'no-session';
  return path.join(directory, `${safe}${suffix}`);
}

/** Where this session's marker lives. One file per session id, in a temp directory. */
export function markerFile(env = process.env, sessionId = '') {
  return sessionPath(env, sessionId, '.json');
}

/**
 * Where this session's REGISTER BASELINE lives, and why it is a second file rather than a
 * field on the marker: the marker is deleted by the `Stop` that ends a turn, and the
 * baseline has to survive that. It is what the NEXT turn's edge is computed against.
 */
export function registerFile(env = process.env, sessionId = '') {
  return sessionPath(env, sessionId, '.register.json');
}

/**
 * Where this session's RECORD OF A SPENT BLOCK lives, and why it is a third file: the marker is
 * rewritten by every arm and deleted by every stand-down, and this record has to outlive both until
 * the turn is over. Only `UserPromptSubmit` removes it.
 */
export function spentFile(env = process.env, sessionId = '') {
  return sessionPath(env, sessionId, '.spent.json');
}

/** True when a block is on record. Its content is not read: a file there is the record. */
export function hasSpentBlock(file) {
  try {
    readFileSync(file);
    return true;
  } catch {
    return false; // absent — or not a file this gate could have written, which is not a record either
  }
}

/** True when the record is on disk. The Stop half acts on that answer: a gate that cannot record a
 *  block must not spend one. */
export function recordSpentBlock(file) {
  return writeJsonAtomically(file, { version: MARKER_VERSION, spentAt: Date.now() });
}

export function clearSpentBlock(file) {
  removeQuietly(file);
}

export function readMarker(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null; // absent, unreadable, or hand-edited into nonsense: not armed
  }
}

/** Atomic tmp+rename. Renaming rather than writing in place is what keeps a `Stop` hook
 *  from reading a half-written file: a marker with no `armedAt` reads as an unarmed turn,
 *  and a baseline with half its ids reads as a burst of appearances and disappearances. */
function writeJsonAtomically(file, value) {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    renameSync(temporary, file);
    return true;
  } catch {
    return false;
  }
}

function removeQuietly(file) {
  try {
    rmSync(file, { force: true });
  } catch {
    // Nothing to do: both files expire on MARKER_MAX_AGE_MS anyway.
  }
}

/** True when the marker is on disk. The Stop half acts on that answer: a gate that cannot
 *  record a block must not spend one. */
export function writeMarker(file, marker) {
  // A marker that could not be written means this turn is simply not gated (rule 1).
  return writeJsonAtomically(file, marker);
}

export function clearMarker(file) {
  removeQuietly(file);
}

/**
 * The ids that were running at this session's PREVIOUS `Stop`.
 *
 * Every failure returns `[]` — absent, unreadable, hand-edited, stale — because absent means
 * empty here, and the cost of being wrong in that direction is one block, once, on a turn
 * where every id reads as new. Being wrong in the other direction would make the first
 * appearance of any task unarmable, which is the appearance that matters most.
 */
export function readRegisterBaseline(file, nowMs = Date.now()) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const updatedAt = Number(parsed.updatedAt);
    // Shared with the marker: a session that crashed hours ago must not make a later turn
    // read as a burst of disappearances.
    if (!Number.isFinite(updatedAt) || nowMs - updatedAt > MARKER_MAX_AGE_MS || nowMs < updatedAt - MARKER_MAX_AGE_MS) return [];
    if (!Array.isArray(parsed.ids)) return [];
    return parsed.ids.filter((id) => typeof id === 'string' && id !== '').slice(0, MAX_REGISTER_IDS);
  } catch {
    return [];
  }
}

export function writeRegisterBaseline(file, ids) {
  return writeJsonAtomically(file, {
    version: MARKER_VERSION,
    updatedAt: Date.now(),
    ids: (Array.isArray(ids) ? ids : []).slice(0, MAX_REGISTER_IDS),
  });
}

export function clearRegisterBaseline(file) {
  removeQuietly(file);
}

/**
 * Where a RESUME NOTE lives. This file's `SessionStart` half leaves one when a session is resumed in a
 * fresh CLI process, and that session's next coverage-2 `Stop` spends it. See the header's A RESUME.
 */
export function resumeFile(env = process.env, sessionId = '') {
  return sessionPath(env, sessionId, '.resumed.json');
}

export function writeResumeNote(file) {
  return writeJsonAtomically(file, { version: MARKER_VERSION, resumedAt: Date.now() });
}

/** True when a note is on disk and within MARKER_MAX_AGE_MS. A stale note is the same as none. */
export function readResumeNote(file, nowMs = Date.now()) {
  try {
    const at = Number(JSON.parse(readFileSync(file, 'utf8'))?.resumedAt);
    return Number.isFinite(at) && nowMs - at <= MARKER_MAX_AGE_MS && nowMs >= at - MARKER_MAX_AGE_MS;
  } catch {
    return false; // absent, unreadable, or hand-edited: no resume on record
  }
}

export function clearResumeNote(file) {
  removeQuietly(file);
}

/**
 * The Stop decision, with the file system factored out so every branch is testable.
 *
 * `disarm` means "delete the marker": the turn is over as far as this gate is concerned,
 * and leaving it armed would carry the obligation into a turn that did not earn it.
 */
export function decideStop({ payload = {}, marker = null, nowMs = Date.now(), coverage = 1, edge = null, spentThisTurn = false, turnHook = false } = {}) {
  const wide = coverage === 2;
  // At coverage 1 the register is not read AT ALL — not for arming, and not for the
  // contradiction checks. An updated pack under a v0.16.1 settings entry behaves exactly as
  // v0.16.1 did, which is the whole point of the level.
  const appeared = wide && edge && Array.isArray(edge.appeared) ? edge.appeared : [];
  const disappeared = wide && edge && Array.isArray(edge.disappeared) ? edge.disappeared : [];
  const runningCount = wide ? runningTaskIds(payload.background_tasks).length : 0;

  // A stale marker is dropped rather than short-circuiting the whole decision: the register
  // edge can legitimately arm the same turn, and standing down on it because of a marker
  // left behind six hours ago would be the gate losing a real obligation to an old one.
  const armedAt = marker ? Number(marker.armedAt) : Number.NaN;
  const markerIsStale = marker !== null
    && (!Number.isFinite(armedAt) || nowMs - armedAt > MARKER_MAX_AGE_MS || nowMs < armedAt - MARKER_MAX_AGE_MS);
  const live = markerIsStale ? null : marker;

  const causes = [];
  if (live) {
    const recorded = Array.isArray(live.causes) ? live.causes.filter((cause) => CAUSES.includes(cause)) : [];
    causes.push(...(recorded.length > 0 ? recorded : ['agent-tool']));
  }
  if (appeared.length > 0) causes.push('tasks-appeared');
  if (disappeared.length > 0) causes.push('tasks-disappeared');

  if (causes.length === 0) {
    if (markerIsStale) return { block: false, disarm: true, owed: false, causes, note: 'the marker is stale; the turn it belonged to is long gone' };
    return { block: false, disarm: false, owed: false, causes, note: 'no report owed on this turn' };
  }

  // The documented way to avoid an unresolvable loop, and the reason the shared 8-block
  // budget is never a risk here: the second Stop of a turn carries this set.
  if (payload.stop_hook_active === true) {
    return { block: false, disarm: true, owed: true, causes, note: 'a block was already spent on this turn' };
  }
  // The gate's own record, which no arm and no stand-down inside the turn can erase. It is what holds
  // the ceiling where stop_hook_active is missing; the caller passes it only when the turn hook that
  // clears it is declared.
  if (spentThisTurn === true) {
    return { block: false, disarm: true, owed: true, causes, note: 'this gate already blocked once on this turn' };
  }
  if (live && live.blocked === true) {
    return { block: false, disarm: true, owed: true, causes, note: 'this gate already blocked once on this turn' };
  }

  const message = payload.last_assistant_message;
  if (typeof message !== 'string' || message.trim() === '') {
    return { block: false, disarm: true, owed: true, causes, note: 'no final message on the payload; nothing to check' };
  }

  const failures = findReportFailures(message, { runningTaskCount: runningCount });
  if (failures.length === 0) return { block: false, disarm: true, owed: true, causes, note: 'the report is there' };

  return {
    block: true,
    disarm: false,
    owed: true,
    causes,
    runningCount,
    failures,
    reason: buildBlockReason(failures, { causes, runningCount, turnHook }),
    note: 'blocking once',
  };
}

/**
 * Record that this turn owes a report, and what made it owe one. Silent, always — the
 * arming half of this gate has never printed anything and must not start: every byte it
 * emitted would be a byte in the model's context on a turn that is going to pass.
 *
 * `dispatches` counts arms, which is a fact this gate computed and may state. `causes` is a
 * set, so three subagents in one turn arm once and say "a subagent was started" once.
 */
function armMarker(file, cause) {
  const existing = readMarker(file);
  const previous = Number(existing?.dispatches);
  const causes = Array.isArray(existing?.causes)
    ? existing.causes.filter((value) => CAUSES.includes(value))
    : [];
  if (!causes.includes(cause)) causes.push(cause);
  writeMarker(file, {
    version: MARKER_VERSION,
    armedAt: Date.now(),
    dispatches: (Number.isFinite(previous) ? previous : 0) + 1,
    causes,
    blocked: false,
  });
}

async function readStdin(timeoutMs) {
  const reader = (async () => {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
  })();
  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve(''), timeoutMs).unref?.();
  });
  return Promise.race([reader, timeout]).catch(() => '');
}

function writeStdout(line) {
  try {
    process.stdout.write(`${line}\n`);
  } catch {
    // A closed pipe must never escape a hook (rule 1).
  }
}

async function main() {
  const mode = resolveMode(process.env);
  if (mode === 'off') return; // not armed: read nothing, say nothing

  const raw = await readStdin(STDIN_TIMEOUT_MS);
  if (!raw || !raw.trim()) return;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return; // malformed payload: not this file's turn to complain
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;

  const coverage = resolveCoverage(process.env);
  const file = markerFile(process.env, payload.session_id ?? '');

  if (payload.hook_event_name === TURN_HOOK_EVENT) {
    // A new turn: the block this session spent in the previous one no longer counts. Nothing is armed and
    // nothing is printed — this hook's stdout would reach the model on every turn of the session.
    clearSpentBlock(spentFile(process.env, payload.session_id ?? ''));
    return;
  }

  if (payload.hook_event_name === SESSION_START_EVENT) {
    // A session resumed in a fresh CLI process. Only `resume` means a new process on an existing session.
    // `compact` fires inside the running process with its register intact, and `startup` and `clear`
    // begin a session id with no baseline to misread. Coverage 1 never reads the register, so it notes
    // nothing. Silent, like every half that is not `Stop`.
    if (coverage === 2 && payload.source === RESUME_SOURCE) writeResumeNote(resumeFile(process.env, payload.session_id ?? ''));
    return;
  }

  if (payload.hook_event_name === 'PostToolUse') {
    // Scoped twice: the installer's matcher keeps the harness from invoking this on
    // unrelated tools at all, and this check keeps a hand-widened matcher from arming
    // the gate on every Read and Bash call in the session.
    //
    // `Agent` stays wired at every level. At coverage 2 the installer writes `SubagentStart`
    // instead, so this branch normally never fires there — but a hand-wired or left-behind
    // entry must still arm rather than sit inert, which is the worse silence.
    if (payload.tool_name === 'Agent') {
      armMarker(file, 'agent-tool');
      return;
    }
    if (coverage === 2 && payload.tool_name === 'Skill' && armsForSkill(payload, resolveWatchedSkills(process.env))) {
      armMarker(file, 'watched-skill');
    }
    return; // PostToolUse output is never used by this gate: arming is silent
  }

  if (payload.hook_event_name === 'SubagentStart') {
    if (coverage === 2 && armsForSubagentStart(payload)) armMarker(file, 'subagent-start');
    return; // likewise silent
  }

  if (payload.hook_event_name !== 'Stop') return;

  const marker = readMarker(file);
  let edge = null;
  if (coverage === 2) {
    const baseline = registerFile(process.env, payload.session_id ?? '');
    const current = runningTaskIds(payload.background_tasks);
    // The first Stop that reads a resume note spends it, whatever that Stop then decides. A stale note
    // goes too.
    const note = resumeFile(process.env, payload.session_id ?? '');
    const resumed = readResumeNote(note);
    clearResumeNote(note);
    edge = registerEdge({ current, previous: readRegisterBaseline(baseline), resumed });
    // Persisted BEFORE the decision, and on every `Stop` whatever the decision is. The
    // second `Stop` of a blocked turn must see no edge at all: a gate that recomputed the
    // same change would arm itself again on work it has already spoken about once.
    if (current.length > 0) writeRegisterBaseline(baseline, current);
    else clearRegisterBaseline(baseline);
  }
  const turnHook = resolveTurnHook(process.env);
  const spentRecord = spentFile(process.env, payload.session_id ?? '');
  const decision = decideStop({ payload, marker, coverage, edge, turnHook, spentThisTurn: turnHook && hasSpentBlock(spentRecord) });

  if (decision.block && mode === 'block') {
    // Record the spent block FIRST, and stand down if that record cannot be made. Every
    // Stop is a fresh process, so this file on disk is the gate's only memory: without it
    // the next Stop of the same turn blocks again, and again, until the shared 8-block
    // budget is gone — whose failure mode is `result: ""` reported as a clean run.
    // Observed: with the marker directory made unwritable after arming, the gate returned
    // a block on three consecutive Stops. `stop_hook_active` does stop that, but it is the
    // harness's backstop, and a gate that cannot count its own blocks must not spend them.
    //
    // The register edge can arm a turn with NO marker on disk at all: no tool call made it,
    // so nothing wrote one. The record therefore has to be brought into being here,
    // `armedAt` included — without it the next Stop reads the record as stale, and the gate
    // has forgotten it already spoke.
    //
    // `armedAt` is STAMPED FRESH rather than carried over, and that is load-bearing now that a
    // stale marker no longer short-circuits the decision. A stale marker left by a crashed turn
    // is dropped for ARMING, but it was still spread into this record — so the record of the
    // block came back out of `readMarker` wearing a timestamp six hours old, read as stale
    // again, and `blocked: true` was discarded every time. Measured: a stale marker plus a
    // register that kept changing blocked on three consecutive Stops, leaving `stop_hook_active`
    // as the only thing between this gate and the shared 8-block budget — which is exactly what
    // the paragraph above refuses to rely on. The block IS this turn's arming event, so now is
    // the right time to stamp.
    const spent = {
      ...(marker && typeof marker === 'object' && !Array.isArray(marker) ? marker : { version: MARKER_VERSION, dispatches: 0 }),
      armedAt: Date.now(),
      causes: decision.causes,
      blocked: true,
      blockedAt: Date.now(),
    };
    // With the turn hook declared, the record that holds the ceiling is written first, and a gate that
    // cannot write it stands down exactly as one that cannot write the marker does.
    const recorded = turnHook ? recordSpentBlock(spentRecord) : true;
    if (!recorded || !writeMarker(file, spent)) {
      // Both halves land or neither counts. When the record landed and the marker did not, the block
      // is refused here — so the record of it goes too. Left behind, it silences the rest of the turn
      // over a block the reader never saw, which is the same silence the ceiling exists to bound,
      // arriving through the door marked "failed write".
      if (recorded && turnHook) clearSpentBlock(spentRecord);
      try {
        process.stderr.write('report-progress gate: could not record a spent block, so not spending one\n');
      } catch {
        // Not worth a failed turn (rule 1).
      }
      return;
    }
    // `decision: "block"` at exit 0 is the channel verified on this harness: the turn
    // continues and the reason arrives as a user-role message (../HOOK-OUTPUT-NOTES.md).
    writeStdout(JSON.stringify({ decision: 'block', reason: decision.reason }));
    return;
  }

  if (decision.block) {
    // observe mode: the same verdict, delivered where it cannot cost the user a turn.
    // The marker is cleared because nothing is coming to resolve it.
    clearMarker(file);
    const codes = decision.failures.map((failure) => failure.code).join(', ');
    try {
      process.stderr.write(`report-progress gate (observe): would have blocked — ${codes}\n`);
    } catch {
      // Not worth a failed turn (rule 1).
    }
    return;
  }

  if (decision.disarm) clearMarker(file);
  // Everything else prints nothing to stdout at all. A Stop hook that emits
  // additionalContext without a decision was observed to force continuations exactly
  // like a block does, so "standing down, and here is why" goes to stderr, which Claude
  // Code does not deliver to the model on exit 0 — and only when a report was owed, so
  // an armed session with nothing owed stays entirely quiet.
  if (!decision.owed) return;
  try {
    process.stderr.write(`report-progress gate: ${decision.note}\n`);
  } catch {
    // Not worth a failed turn (rule 1).
  }
}

// Only when this file IS the hook. Without this guard, importing the module — which a
// test does, and which the installer does for its own constants — runs `main()` and then
// `process.exit(0)`, killing the importing process mid-flight with a success code and no
// output. That is precisely how the installer was observed to write nothing at all and
// report exit 0 while doing so. The guard then produced that same silence from the other
// direction: asked as a raw path comparison, it was false whenever the pack was reached
// through the symlink the Skills CLI installs, and the hook ran as an empty exit 0.
if (isEntrypoint(import.meta.url)) {
  main()
    .catch(() => {})
    .finally(() => process.exit(0));
}
