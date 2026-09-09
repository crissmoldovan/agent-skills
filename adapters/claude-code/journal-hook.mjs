#!/usr/bin/env node
// The actual event -> observation mapping for the Claude Code adapter.
// journal-hook.sh is the thing Claude Code invokes; this is the logic it
// delegates to, because reliably parsing arbitrary nested JSON (a tool's
// `tool_input`/`tool_response`, in particular) in POSIX sh means either
// hand-rolled parsing that breaks on the first embedded quote, or depending
// on `jq`/`python3`, which are not guaranteed present. Node already is: it
// is what runs `agent-journal` itself. Using it here is not a new
// dependency, just an explicit use of one this whole adapter already
// requires to exist.
//
// Every event name and payload shape this file reads comes from
// ../NOTES.md, produced by an earlier task that captured real Claude Code
// hook payloads rather than guessing. NOTES.md outranks this file if they
// ever disagree -- do not "correct" a mapping here from memory of how Claude
// Code hooks behave.
//
// This file has TWO independent output streams now, not one:
//   1. Observations, unchanged since Task 1: every mapped event shells out
//      to `agent-journal observe`, which writes to disk. Nothing this file
//      prints to its own stdout affects this stream at all.
//   2. The authoring floors (Plan 7 / §11.2-11.3), new in this task: on
//      PostToolUse and PreCompact ONLY, and ONLY when the workspace has
//      opted in (`AGENT_JOURNAL_FLOORS=1`), this file may print ONE line of
//      JSON to its own real stdout -- which journal-hook.sh no longer
//      discards -- for Claude Code itself to read as hook output. Every
//      event name and output shape here comes from
//      ../HOOK-OUTPUT-NOTES.md, not from this file's own guess: it is the
//      probe that actually captured what the harness does with a hook's
//      stdout, and it outranks this file exactly the way NOTES.md outranks
//      it for the input side. The two floors need genuinely different
//      shapes -- see emitConsequenceFloor and emitCompactionFloor below,
//      and do not merge them.
//
// Four rules this file lives by (see ../README.md for the full versions):
//   1. It never fails the tool call it observes -- every path ends in
//      process.exit(0), whatever happened along the way. This now also
//      covers stream 2: a floor that throws, hangs, or renders a huge
//      string must be exactly as harmless as a broken observation.
//   2. It never blocks -- bounded timeouts on the stdin read and on EVERY
//      subprocess this file spawns, including the new `agent-journal floor`
//      call.
//   3. It bypasses nothing -- it always shells out to `agent-journal
//      observe`/`agent-journal floor`, never touches the journal itself.
//      `floor` only READS the journal; it cannot be how this script
//      "bypasses" redaction, because it never writes anything.
//   4. It never authors -- the floor TEXT is always exactly what
//      `agent-journal floor` printed, truncated if oversized, never
//      rewritten, added to, or drafted by this file. See floors.ts's own
//      header comment for why that boundary matters.

// Longest a single field value is allowed to be before this script
// truncates it itself. This is a client-side courtesy, not a substitute for
// redact.ts's own 262144-byte whole-event cap (src/redact.ts): a single
// large tool_input or tool_response would otherwise dominate that budget,
// and pushing a multi-hundred-KB string through argv on every tool call is
// wasteful even when it fits.
const MAX_FIELD_CHARS = 4000;

// How long to wait for the hook payload to fully arrive on stdin before
// giving up. In every capture in NOTES.md the harness writes the full JSON
// payload and closes stdin promptly; this bound exists only so a harness
// bug that never closes stdin cannot hang the tool call it is meant to
// observe, per rule 2.
const STDIN_TIMEOUT_MS = 1500;

// How long `agent-journal observe` itself gets before this script stops
// waiting on it and moves on. Per rule 3, the process spawn is an accepted
// cost, not something to remove -- this just bounds it.
const OBSERVE_TIMEOUT_MS = 3000;

// How long `agent-journal floor` gets before this script stops waiting on
// it and moves on -- the same bound as OBSERVE_TIMEOUT_MS, for the same
// reason: two Node process starts plus a journal read is the accepted cost
// of this design, not something to let run unbounded (rule 2).
const FLOOR_TIMEOUT_MS = 3000;

// Longest a rendered floor prompt is allowed to be before THIS script
// truncates it, independent of and far below the harness's own ~215KB cap
// (adapters/HOOK-OUTPUT-NOTES.md, "Size limit"): "keep the prompt far below
// that and truncate in the adapter rather than relying on the harness to
// cope" is the brief's own instruction. A real floor prompt -- a handful of
// sentences, or a short bulleted list of consequence-bearing observations
// bounded by the lookback window below -- should never approach this in
// ordinary use; it exists as a hard backstop, not a size this script
// expects to hit.
const MAX_FLOOR_OUTPUT_CHARS = 8000;

// Floor 2's default lookback window in milliseconds, added on top of the
// PostToolUse payload's own `duration_ms` -- see emitConsequenceFloor's own
// comment for why this exists and what it trades away. Overridable via
// AGENT_JOURNAL_FLOOR_LOOKBACK_MS purely so a test can shrink it rather than
// sleep for the production default; not documented as a user-facing knob in
// ../README.md's configuration table because getting it wrong in either
// direction degrades gracefully (too small: a real consequence might be
// missed on a slow machine; too large: an old one might resurface once) --
// nothing here treats it as load-bearing enough to be worth exposing.
const DEFAULT_FLOOR_LOOKBACK_MS = 10_000;

function truncate(value, max) {
  if (typeof value !== 'string' || value.length <= max) return value;
  return `${value.slice(0, max)}...(truncated ${value.length - max} more chars)`;
}

// Only for fields NOTES.md shows arriving as plain strings (tool_name,
// tool_use_id, cwd, reason, trigger, agent_id, agent_type,
// last_assistant_message). A non-string here is an unexpected shape this
// script was not built against, and the field is dropped rather than
// stringified as a guess -- absent stays absent, same rule
// normalizeObservationData (src/observe.ts) follows for the same reason.
function str(value) {
  return typeof value === 'string' ? value : undefined;
}

// For fields NOTES.md shows arriving as objects (tool_input, tool_response)
// -- these vary per tool, and only three shapes were ever confirmed
// (Bash, Read, Agent). Rather than special-case those three and guess at
// every other tool, this renders whatever came through as JSON uniformly.
function summarize(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}


/** A shell tool's `command` verbatim where there is one; otherwise the generic
 *  JSON rendering. `tool_input.command` is the field NOTES.md records Bash
 *  carrying, and it is what a reader of `show` actually wants to see. */
function commandOrSummary(toolInput) {
  if (toolInput && typeof toolInput === 'object' && typeof toolInput.command === 'string'
      && toolInput.command.trim()) {
    return toolInput.command;
  }
  return summarize(toolInput);
}

/**
 * Map one Claude Code hook payload to an agent-journal observation, or
 * `null` if this event has nothing to record. `null` is the expected
 * outcome for most event names this adapter sees -- see the `default` case
 * below for exactly which, and why each is left unmapped on purpose.
 *
 * A mapping may also carry `subject`: what the observation is ABOUT, which is
 * the key `agent-journal trace` indexes it under. Four of the seven mapped
 * events set one (tool_call, tool_result, subagent_start, subagent_stop) and
 * three deliberately do not: session_start, session_end and turn_end are
 * about the session, which the envelope's own `session` field already
 * carries, and compact is about nothing a reader would search for by name.
 * An invented subject on those would be a key matching every one of them,
 * which is worse than no key at all.
 */
export function mapPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;

  const sessionId = str(payload.session_id)?.trim() || undefined;

  switch (payload.hook_event_name) {
    case 'SessionStart':
      // `harness` is hardcoded, not read from the payload -- nothing in
      // any captured SessionStart payload names the harness itself (that is
      // this adapter's own job to know). `branch` is part of session_start's
      // field set (src/observe.ts) but no captured payload carries git
      // branch info, so it is left out rather than guessed.
      return { kind: 'session_start', sessionId, fields: { harness: 'claude-code', cwd: str(payload.cwd) } };

    case 'SessionEnd':
      return { kind: 'session_end', sessionId, fields: { reason: str(payload.reason) } };

    case 'Stop':
      // NOTES.md's own heartbeat section names Stop as "fires once per
      // turn, when the agent stops responding" -- the nearest and only
      // observed per-turn boundary, which is exactly what turn_end is for.
      return {
        kind: 'turn_end',
        sessionId,
        fields: { turn: truncate(str(payload.last_assistant_message), MAX_FIELD_CHARS) },
      };

    case 'PreToolUse':
      return {
        kind: 'tool_call',
        sessionId,
        // The TOOL NAME, not the call id: it is the thing a later reader
        // actually knows to search for ("did I really run Bash here?"), and
        // `trace` matches a subject exactly, never as a substring, so
        // `Bash:toolu_01…` would be findable by nobody. The call id stays in
        // `data.callId`, which `show` now renders -- that is how a reader
        // picks the right one out of several Bash calls.
        subject: str(payload.tool_name),
        fields: {
          tool: str(payload.tool_name),
          // A Bash call's command verbatim, not a JSON rendering of the
          // envelope around it. Storing the envelope made `input` unreadable
          // as what it is, and the consequence classifier — which is written
          // against a command line — matched the JSON's own keys and
          // punctuation instead, firing on a Grep for "gh secret set".
          input: truncate(commandOrSummary(payload.tool_input), MAX_FIELD_CHARS),
          callId: str(payload.tool_use_id),
        },
      };

    case 'PostToolUse':
      // `summary` is a generic truncated JSON rendering of tool_response,
      // not a per-tool extraction. NOTES.md confirms only three
      // tool_response shapes (Bash, Read, Agent) out of an open-ended set of
      // tools; building bespoke handling for those three and guessing at
      // the rest would be exactly the kind of invention this task was
      // built to avoid.
      return {
        kind: 'tool_result',
        sessionId,
        // Same subject as the matching tool_call, deliberately: one
        // `trace <tool>` lists the call and its result together, and
        // `data.callId` is what pairs a specific two.
        subject: str(payload.tool_name),
        fields: {
          tool: str(payload.tool_name),
          callId: str(payload.tool_use_id),
          summary: truncate(summarize(payload.tool_response), MAX_FIELD_CHARS),
        },
      };

    case 'SubagentStart':
      // `purpose` is populated from `agent_type` (e.g. "general-purpose"),
      // the only descriptive field SubagentStart itself carries. The
      // richer free-text description lives on the PARENT's PreToolUse
      // `tool_input.description` for the `Agent` tool call -- a different
      // hook event, with no shared key in NOTES.md's captured payloads
      // that would let this script join the two.
      return {
        kind: 'subagent_start',
        sessionId,
        // The agent id, which is the only identifier on this payload a later
        // reader could hold -- `agent_type` names a class, not an instance.
        subject: str(payload.agent_id),
        agentId: str(payload.agent_id),
        fields: { agentId: str(payload.agent_id), purpose: str(payload.agent_type) },
      };

    case 'SubagentStop':
      // `status` is the fixed literal "stopped", not a guess at
      // success/failure. NOTES.md's captured SubagentStop payload carries
      // no field distinguishing the two -- the closest candidate,
      // tool_response.status ("completed" in the one sample captured),
      // lives on the PARENT's PostToolUse for the Agent tool call, a
      // different hook event with no shared correlation key exposed here.
      return {
        kind: 'subagent_stop',
        sessionId,
        subject: str(payload.agent_id),
        agentId: str(payload.agent_id),
        fields: { agentId: str(payload.agent_id), status: 'stopped' },
      };

    case 'PostCompact':
      // PreCompact is deliberately NOT mapped to an OBSERVATION here:
      // NOTES.md records a real case where PreCompact fired and compaction
      // never happened ("Not enough messages to compact"), with no
      // PostCompact following. Only PostCompact confirms compaction
      // actually completed, and the spec has one `compact` kind, not a
      // start/end pair -- wiring PreCompact here would sometimes record a
      // compaction that never occurred.
      //
      // PreCompact is, however, wired below to Floor 1 -- a DIFFERENT
      // question ("should I prompt for a flush before this destroys
      // context") than "did compaction happen", and one that can only be
      // asked BEFORE, not after. See emitCompactionFloor and main().
      return { kind: 'compact', sessionId, fields: { reason: str(payload.trigger) } };

    default:
      // Deliberately unmapped, each for a distinct documented reason (see
      // ../README.md for the full accounting):
      //  - UserPromptSubmit: observed and real, but matches none of the
      //    fourteen observation kinds (NOTES.md is explicit that turn_end
      //    is not a fuzzy match -- it is the END of a turn).
      //  - PreCompact: see the PostCompact case above. Still read directly
      //    off `payload.hook_event_name` in main() for the floor stream,
      //    which is independent of this function entirely.
      //  - PermissionRequest, PostToolUseFailure: no confirmed harness
      //    source in this environment (NOTES.md "Events attempted but NOT
      //    OBSERVED to fire") -- not wired on faith.
      //  - Notification, PostToolBatch: named only in in-binary strings,
      //    never observed to fire, never attempted.
      //  - heartbeat: never derived from any hook, on any event name --
      //    see NOTES.md's "structurally unavailable" section. There is no
      //    case in this switch for it and there should not be one.
      //  - anything else (a future or renamed event, "Unknown", etc.).
      return null;
  }
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

/**
 * Stream 1: write the observation. Unchanged behaviour from before this
 * task -- extracted into its own function only so main() can run it
 * independently of the floor stream below, which PreCompact needs (it maps
 * to no observation at all, yet must still reach the floor stream).
 */
function recordObservation(spawnSync, bin, preArgs, workspace, mapped) {
  // Every flag goes out as `--flag=value`, never as `--flag value`. In the
  // space-separated form a value that itself begins with `--` parses as the
  // NEXT flag name, agent-journal reports a valueless flag and exits 2, and
  // the whole observation is lost. A markdown horizontal rule opening an
  // assistant message (`---`) is the everyday way that happens, and it is
  // not confined to `turn`: `reason`, `trigger` and a string-valued
  // `tool_input` all come from harness text this script does not control.
  // Rule 1 means this script ignores that exit code, so the loss would be
  // silent AND leave no `void` behind for `coverage` to show -- the one
  // failure mode the observation plane exists to prevent. `--flag=value`
  // cannot be misread: the name ends at the first `=`, and everything after
  // it is the value, `--` prefix, embedded `=`, newlines and all. See
  // `flags()` in src/cli.ts.
  const args = [...preArgs, 'observe', `--workspace=${workspace}`, `--kind=${mapped.kind}`];
  // `--subject` is what makes an observation FINDABLE. `agent-journal trace`
  // indexes an event's subject, so `trace Bash` lists every Bash tool_call and
  // tool_result; without one, an observation can only be reached by a uuid no
  // command prints, which made the cite-an-observation loop unreachable in
  // practice. Only set where the payload carries something a later reader
  // would actually search for -- absent stays absent, never a placeholder.
  if (typeof mapped.subject === 'string' && mapped.subject.trim()) {
    args.push(`--subject=${mapped.subject}`);
  }
  for (const [field, value] of Object.entries(mapped.fields)) {
    if (typeof value !== 'string' || !value.trim()) continue; // absent stays absent
    args.push(`--${field}=${value}`);
  }

  const childEnv = { ...process.env };
  if (mapped.sessionId) childEnv.AGENT_JOURNAL_SESSION = mapped.sessionId;
  if (mapped.agentId) childEnv.AGENT_JOURNAL_AGENT = mapped.agentId;

  // The result -- exit code, stdout, stderr, even a spawn error such as an
  // unresolvable `bin` -- is deliberately never inspected. Rule 1 applies
  // to a redaction refusal (agent-journal's own exit 1) exactly as much as
  // to a missing binary: this script does not get to fail the tool call
  // either way.
  spawnSync(bin, args, { env: childEnv, stdio: 'ignore', timeout: OBSERVE_TIMEOUT_MS });
}

/**
 * Runs `agent-journal floor <args>` and returns its trimmed stdout, or `''`
 * if anything at all went wrong -- a missing binary, a timeout, a thrown
 * spawn error, non-string stdout. Exit code is deliberately never
 * inspected: `floor` exits 1 on a partially unreadable journal but still
 * prints whatever it could render (cli.ts's own documented behaviour,
 * covered by "floor warns and exits 1 ... but still renders what it can" in
 * test/cli.test.ts) -- using stdout regardless of status is what makes that
 * partial-read case still reach the agent instead of being silently
 * discarded, and mirrors how recordObservation above already ignores
 * `observe`'s own exit code.
 */
function runFloor(spawnSync, bin, preArgs, args) {
  let result;
  try {
    result = spawnSync(bin, [...preArgs, 'floor', ...args], { encoding: 'utf8', timeout: FLOOR_TIMEOUT_MS });
  } catch {
    return '';
  }
  if (!result || typeof result.stdout !== 'string') return '';
  return result.stdout.trim();
}

function floorLookbackMs() {
  const raw = process.env.AGENT_JOURNAL_FLOOR_LOOKBACK_MS;
  if (raw === undefined || raw === '') return DEFAULT_FLOOR_LOOKBACK_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_FLOOR_LOOKBACK_MS;
}

/**
 * Floor 2's own output shape, confirmed working in
 * ../HOOK-OUTPUT-NOTES.md's "OBSERVED -- PostToolUse delivers
 * additionalContext" section: `hookSpecificOutput.hookEventName` must be
 * the literal string `"PostToolUse"` (the harness validates it against a
 * per-event enum, per that same file's "hookEventName is schema-gated"
 * finding), and `additionalContext` is the free text. Returns `undefined`
 * (never throws) if JSON.stringify somehow fails -- it cannot, in practice,
 * for a plain object of two strings, but rule 1 does not get to assume that
 * without a fallback.
 */
function postToolUseFloorOutput(text) {
  const truncated = truncate(text, MAX_FLOOR_OUTPUT_CHARS);
  try {
    return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: truncated } });
  } catch {
    return undefined;
  }
}

/**
 * Floor 1's own output shape -- DELIBERATELY DIFFERENT from Floor 2's, per
 * ../HOOK-OUTPUT-NOTES.md's "OBSERVED NOT TO WORK -- PreCompact rejects
 * hookSpecificOutput" and the following section: `hookSpecificOutput` with
 * `hookEventName: "PreCompact"` fails the harness's OWN schema validation
 * outright (the probe captured the literal validation-error banner), so it
 * must never appear here at all -- not as a fallback, not alongside the
 * generic fields, never. What DOES reach the model is the pair of
 * top-level `reason` / `systemMessage` fields, folded into the compaction
 * summary. Both carry the SAME text here, deliberately: the probe's own
 * two distinct planted tokens both survived into the summary under their
 * own field names, and nothing in that probe isolates which field is the
 * one that actually feeds the model versus which is merely CLI-visible
 * receipt text -- duplicating costs nothing and is not a guess either way
 * turns out to be true.
 */
function preCompactFloorOutput(text) {
  const truncated = truncate(text, MAX_FLOOR_OUTPUT_CHARS);
  try {
    return JSON.stringify({ reason: truncated, systemMessage: truncated });
  } catch {
    return undefined;
  }
}

function writeStdout(jsonLine) {
  try {
    process.stdout.write(`${jsonLine}\n`);
  } catch {
    // A closed pipe or similar write failure must never escape -- rule 1
    // covers this exactly like it covers a failed subprocess spawn.
  }
}

/**
 * Floor 2: PostToolUse, opt-in only. `agent-journal floor --kind
 * consequence` classifies `tool_call` observations (PreToolUse's own
 * mapping, above) -- `tool_result` carries no `input` field for
 * consequence.ts's `tryMutation` to read, so this depends on the paired
 * PreToolUse having already run and its own `recordObservation` call
 * having already completed. It has: PreToolUse fires, and Claude Code does
 * not start running the tool until that hook's own process exits (NOTES.md
 * never captures the two firing out of order), so by the time THIS hook
 * runs, that tool_call is already on disk.
 *
 * `--since` is a heuristic bound, not a precise correlation, and this says
 * so rather than pretending otherwise. `agent-journal floor` has no way to
 * be told "only the observation THIS call produced" -- its only lever is a
 * timestamp cutoff -- and this script has no persisted state across
 * invocations to remember "the last time this session checked" (the same
 * reason ../README.md's own "Not wired: --seq" leaves a per-session counter
 * unbuilt: a cross-invocation counter or marker file is a new failure mode
 * for a stateless, one-shot-per-hook script, for a benefit that has to
 * justify that risk). Instead this bounds `--since` to just before THIS
 * call's own tool_call write, computed from the payload's own
 * `duration_ms` (present on every PostToolUse payload NOTES.md captured):
 * the tool_call observation was written roughly `duration_ms` milliseconds
 * before this hook fired, plus a generous buffer for hook dispatch overhead
 * and clock slack (floorLookbackMs(), default 10s -- the adapter's own
 * measured per-hook overhead is two orders of magnitude smaller). Without
 * this, a single old mutation would resurface on EVERY unrelated tool call
 * for the rest of the workspace's history, which is exactly the
 * every-call noise the floors exist to avoid, not a acceptable side effect
 * of them. A burst of several genuinely consequence-bearing calls within
 * the buffer window can legitimately appear together -- that is still
 * "recent", a real limitation of this heuristic, not a bug.
 *
 * `--subject` is the command TEXT (`tool_input`, truncated), not the bare
 * tool name: constraints.ts's `constraintsMatching` checks a constraint's
 * `scope` word against whatever string this carries, and a scope word like
 * "redis" or "prod-db" is far more likely to appear in a command than in a
 * tool name like "Bash".
 */
function emitConsequenceFloor(spawnSync, bin, preArgs, workspace, payload) {
  const durationMs =
    typeof payload.duration_ms === 'number' && Number.isFinite(payload.duration_ms) && payload.duration_ms >= 0
      ? payload.duration_ms
      : 0;
  const sinceMs = Date.now() - durationMs - floorLookbackMs();
  const since = new Date(sinceMs).toISOString();

  const subject = truncate(summarize(payload.tool_input), MAX_FIELD_CHARS);

  const args = [`--kind=consequence`, `--workspace=${workspace}`, `--since=${since}`];
  if (typeof subject === 'string' && subject.trim()) args.push(`--subject=${subject}`);

  const text = runFloor(spawnSync, bin, preArgs, args);
  if (!text) return; // most tool calls: nothing to say -- print nothing, exactly as floor did

  const out = postToolUseFloorOutput(text);
  if (out) writeStdout(out);
}

/**
 * Floor 1: PreCompact, opt-in only. Deliberately no `--since`: PreCompact
 * fires only when the harness is actually about to compact, which happens
 * far less often than every tool call, so the every-call noise concern
 * Floor 2 has to guard against does not apply the same way here -- every
 * compaction moment is a legitimate point to ask "did you flush, and did
 * you sweep for assumptions", even asked again if the answer would be
 * unchanged since the last one.
 */
function emitCompactionFloor(spawnSync, bin, preArgs, workspace) {
  const args = [`--kind=compaction`, `--workspace=${workspace}`];
  const text = runFloor(spawnSync, bin, preArgs, args);
  if (!text) return;

  const out = preCompactFloorOutput(text);
  if (out) writeStdout(out);
}

async function main() {
  const workspace = process.env.AGENT_JOURNAL_WORKSPACE;
  if (!workspace || !workspace.trim()) return; // unconfigured: nothing to do

  // Opt-in, read once, up front. See ../HOOK-OUTPUT-NOTES.md and the plan's
  // own "opt-in per workspace" decision: the floors are inert unless a
  // workspace explicitly asks for them -- unset, blank, or anything other
  // than the literal string "1" means off. Checked here rather than left
  // implicit, because this is the ONLY place this script is now capable of
  // writing to its own stdout, which Claude Code reads as hook output --
  // getting this gate wrong is the one way this file could start talking
  // into a session that never asked it to.
  const floorsEnabled = process.env.AGENT_JOURNAL_FLOORS === '1';

  const raw = await readStdin(STDIN_TIMEOUT_MS);
  if (!raw || !raw.trim()) return;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return; // malformed payload: nothing to observe, nothing to report
  }

  const { spawnSync } = await import('node:child_process');

  // AGENT_JOURNAL_CMD lets this run before `agent-journal` is on PATH --
  // e.g. in a dev checkout, `AGENT_JOURNAL_CMD="node /abs/path/to/packages/agent-journal/dist/bin.js"`.
  // Split on whitespace only: no support for an argument containing one.
  const commandSpec = (process.env.AGENT_JOURNAL_CMD || 'agent-journal').trim().split(/\s+/);
  const [bin, ...preArgs] = commandSpec;
  if (!bin) return;

  // Stream 1: the observation. Independent of stream 2 below -- PreCompact
  // never maps to one (mapPayload's own comment says why), yet Floor 1 must
  // still be able to fire for it, so `mapped` being null here must not
  // short-circuit the function the way it did before this task.
  const mapped = mapPayload(payload);
  if (mapped) {
    recordObservation(spawnSync, bin, preArgs, workspace, mapped);
  }

  if (!floorsEnabled) return;

  // Stream 2: the authoring floors. Reads the journal via `agent-journal
  // floor`; never writes to it (rule 3). Exactly one of these two branches
  // can ever apply to a single hook invocation -- `hook_event_name` cannot
  // be both -- so at most one JSON line is ever written to stdout per call.
  // Every event name that is neither falls through both and this function
  // returns having printed nothing, identical to floors being off.
  const eventName = payload && typeof payload === 'object' ? payload.hook_event_name : undefined;
  if (eventName === 'PostToolUse') {
    emitConsequenceFloor(spawnSync, bin, preArgs, workspace, payload);
  } else if (eventName === 'PreCompact') {
    emitCompactionFloor(spawnSync, bin, preArgs, workspace);
  }
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
