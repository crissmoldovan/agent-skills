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
 * TWO EVENTS, ONE FILE, dispatched on `hook_event_name`:
 *
 *   PostToolUse, `tool_name` "Agent"  — a subagent was dispatched, so a report
 *     is now owed at the end of this turn. Writes a per-session marker file and
 *     prints nothing. The tool is named `Agent`, not `Task`, on this harness
 *     (../NOTES.md:251, confirmed in the PreToolUse/PostToolUse pair that
 *     brackets a subagent's own SubagentStart/SubagentStop).
 *
 *   Stop — reads the marker. No marker, no gate: a turn that dispatched nothing
 *     ends exactly as it would with this file absent. That silence is the whole
 *     design. A gate that fires on "yes, that file is in src/" gets uninstalled
 *     within a day, and an uninstalled gate enforces nothing at all.
 *     The marker is keyed by SESSION, not by turn, and the `Stop` that ends a turn
 *     is what clears it — so a turn that dispatched a subagent and then died
 *     without a `Stop` leaves one behind, and the next turn in that session pays
 *     one block for a dispatch it did not make (MARKER_MAX_AGE_MS bounds how long
 *     that can happen). One block, then cleared; it is a cost, not a loop.
 *
 * IT CHECKS SHAPE, NOT TRUTH, and every string it prints says so. It can see
 * that three section labels are present and that a running row carries a state
 * word and a freshness token. It cannot see whether "812 passing" was ever run,
 * whether `child-7f2` exists, or whether "40s ago" is a real observation. A
 * message that satisfies this gate can still be a fabrication; the skill's own
 * checklist, run by a reader, is what catches that, and nothing here replaces it.
 *
 * ONE BLOCK PER TURN, and the reason says so out loud. Claude Code ends a turn
 * after 8 consecutive blocks, that budget is SHARED with every other `Stop`
 * hook from every settings source, and the observed failure when it runs out is
 * not "the gate gives up": the headless result comes back `subtype: "success"`,
 * `is_error: false`, `result: ""` — an empty answer reported as a clean run
 * (../HOOK-OUTPUT-NOTES.md, "the cap is 8 continuations per turn, shared").
 * Spending one block and standing down is what keeps this gate out of that
 * failure, and is why `stop_hook_active` is honoured rather than counted on:
 * the block is emitted only after the marker on disk records it, so a gate that
 * has lost its memory declines to block rather than trusting the harness to
 * stop it.
 *
 * `SubagentStop` is deliberately NOT wired. It has no 8-block backstop at all
 * (DOCUMENTED, same file), so a bug here would hang a child agent indefinitely
 * rather than costing one continuation.
 *
 * The four rules in `journal-hook.mjs` hold here too, and this file states them
 * again because it is the one that can end a turn:
 *   1. It never fails what it observes. Every path exits 0, whatever happened.
 *   2. It never blocks on I/O. The stdin read is fenced; the only file it
 *      touches is a small marker in a temp directory; it makes no network call
 *      and spawns no process.
 *   3. It never authors. The reason is assembled from fixed sentences and the
 *      names of the checks that failed — never from the user's text, the
 *      agent's text, or a subagent's prose.
 *   4. It never speaks when it has nothing to enforce. Not armed, not owed,
 *      already spent, or passing: stdout stays empty.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

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
 * The whole check, as a pure function: a message in, a list of failures out. Empty list
 * means the shape is there.
 *
 * A blank or missing message returns NO failures on purpose. `last_assistant_message`
 * absent is a fact about the payload, not evidence that the agent skipped the report,
 * and a gate that blocks on what it could not read is a gate that fires at random.
 */
export function findReportFailures(message) {
  if (typeof message !== 'string' || message.trim() === '') return [];
  const failures = [];

  for (const id of SECTION_IDS) {
    if (id === 'running' && message.includes(NO_EVIDENCE_SENTENCE)) continue;
    if (!hasSectionLabel(message, id)) {
      failures.push({ code: `missing-${id}`, detail: `no "${SECTION_NAMES[id]}" section` });
    }
  }

  // The no-evidence sentence stands in place of the section, states and freshness included.
  if (message.includes(NO_EVIDENCE_SENTENCE)) return failures;

  const running = runningBlock(message);
  if (running === '' || declaresEmpty(running)) return failures;

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
export function buildBlockReason(failures) {
  const missing = failures.map((failure) => `- ${failure.detail}`).join('\n');
  return truncate([
    'Progress-report gate: a subagent was dispatched through the Agent tool, so a progress report is owed before the turn ends, and this message does not carry the shape of one.',
    '',
    'Missing:',
    missing,
    '',
    'Write the report now, in the report-progress shape: what is done, what is running, what is next — each item carrying a count or a named artefact. Every running row needs a literal state and a freshness (for example: "child-7f2, state running, last observed 40s ago"). Where there is no lifecycle evidence at all, use exactly this sentence in place of the running section:',
    NO_EVIDENCE_SENTENCE,
    'An empty section says it is empty ("Running: none") rather than being omitted.',
    '',
    'This gate matches strings. It can see whether the shape is present; it cannot tell whether any number in the report is real, and satisfying it is not evidence that anything in the report is true.',
    'It blocks once per turn and then stands down: if the next message still has no report, the turn ends anyway. Do not fight it — write the report.',
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

/** Where this session's marker lives. One file per session id, in a temp directory. */
export function markerFile(env = process.env, sessionId = '') {
  const directory = env[GATE_DIR_ENV]?.trim() || path.join(tmpdir(), 'agent-skills-report-progress-gate');
  const safe = String(sessionId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 96) || 'no-session';
  return path.join(directory, `${safe}.json`);
}

export function readMarker(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null; // absent, unreadable, or hand-edited into nonsense: not armed
  }
}

/** True when the marker is on disk. The Stop half acts on that answer: a gate that cannot
 *  record a block must not spend one. */
export function writeMarker(file, marker) {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(marker)}\n`, { mode: 0o600 });
    // Rename rather than write in place: a Stop hook reading a half-written marker
    // would see no `armedAt` and treat an armed turn as unarmed.
    renameSync(temporary, file);
    return true;
  } catch {
    // A marker that could not be written means this turn is simply not gated (rule 1).
    return false;
  }
}

export function clearMarker(file) {
  try {
    rmSync(file, { force: true });
  } catch {
    // Nothing to do: a marker that cannot be removed expires on MARKER_MAX_AGE_MS.
  }
}

/**
 * The Stop decision, with the file system factored out so every branch is testable.
 *
 * `disarm` means "delete the marker": the turn is over as far as this gate is concerned,
 * and leaving it armed would carry the obligation into a turn that did not earn it.
 */
export function decideStop({ payload = {}, marker = null, nowMs = Date.now() } = {}) {
  if (!marker) return { block: false, disarm: false, note: 'no report owed on this turn' };

  // The documented way to avoid an unresolvable loop, and the reason the shared 8-block
  // budget is never a risk here: the second Stop of a turn carries this set.
  if (payload.stop_hook_active === true) {
    return { block: false, disarm: true, note: 'a block was already spent on this turn' };
  }
  if (marker.blocked === true) {
    return { block: false, disarm: true, note: 'this gate already blocked once on this turn' };
  }
  const armedAt = Number(marker.armedAt);
  if (!Number.isFinite(armedAt) || nowMs - armedAt > MARKER_MAX_AGE_MS || nowMs < armedAt - MARKER_MAX_AGE_MS) {
    return { block: false, disarm: true, note: 'the marker is stale; the turn it belonged to is long gone' };
  }

  const message = payload.last_assistant_message;
  if (typeof message !== 'string' || message.trim() === '') {
    return { block: false, disarm: true, note: 'no final message on the payload; nothing to check' };
  }

  const failures = findReportFailures(message);
  if (failures.length === 0) return { block: false, disarm: true, note: 'the report is there' };

  return { block: true, disarm: false, failures, reason: buildBlockReason(failures), note: 'blocking once' };
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

  const file = markerFile(process.env, payload.session_id ?? '');

  if (payload.hook_event_name === 'PostToolUse') {
    // Scoped twice: the installer's matcher keeps the harness from invoking this on
    // unrelated tools at all, and this check keeps a hand-widened matcher from arming
    // the gate on every Read and Bash call in the session.
    if (payload.tool_name !== 'Agent') return;
    const existing = readMarker(file);
    const previous = Number(existing?.dispatches);
    writeMarker(file, {
      version: 1,
      armedAt: Date.now(),
      dispatches: (Number.isFinite(previous) ? previous : 0) + 1,
      blocked: false,
    });
    return; // PostToolUse output is never used by this gate: arming is silent
  }

  if (payload.hook_event_name !== 'Stop') return;

  const marker = readMarker(file);
  const decision = decideStop({ payload, marker });

  if (decision.block && mode === 'block') {
    // Record the spent block FIRST, and stand down if that record cannot be made. Every
    // Stop is a fresh process, so this file on disk is the gate's only memory: without it
    // the next Stop of the same turn blocks again, and again, until the shared 8-block
    // budget is gone — whose failure mode is `result: ""` reported as a clean run.
    // Observed: with the marker directory made unwritable after arming, the gate returned
    // a block on three consecutive Stops. `stop_hook_active` does stop that, but it is the
    // harness's backstop, and a gate that cannot count its own blocks must not spend them.
    if (!writeMarker(file, { ...marker, blocked: true, blockedAt: Date.now() })) {
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
  // Code does not deliver to the model on exit 0 — and only when there was a marker, so
  // an armed session with nothing owed stays entirely quiet.
  if (!marker) return;
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
// report exit 0 while doing so.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main()
    .catch(() => {})
    .finally(() => process.exit(0));
}
