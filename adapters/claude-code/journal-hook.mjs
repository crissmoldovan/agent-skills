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
// ever disagree — do not "correct" a mapping here from memory of how Claude
// Code hooks behave.
//
// Three rules this file lives by (see ../README.md for the full versions):
//   1. It never fails the tool call it observes -- every path ends in
//      process.exit(0), whatever happened along the way.
//   2. It never blocks -- bounded timeouts on both the stdin read and the
//      `agent-journal observe` spawn.
//   3. It bypasses nothing -- it always shells out to `agent-journal
//      observe`, which redacts. It never appends to the journal itself.

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

/**
 * Map one Claude Code hook payload to an agent-journal observation, or
 * `null` if this event has nothing to record. `null` is the expected
 * outcome for most event names this adapter sees -- see the `default` case
 * below for exactly which, and why each is left unmapped on purpose.
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
        fields: {
          tool: str(payload.tool_name),
          input: truncate(summarize(payload.tool_input), MAX_FIELD_CHARS),
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
        agentId: str(payload.agent_id),
        fields: { agentId: str(payload.agent_id), status: 'stopped' },
      };

    case 'PostCompact':
      // PreCompact is deliberately NOT mapped to anything: NOTES.md records
      // a real case where PreCompact fired and compaction never happened
      // ("Not enough messages to compact"), with no PostCompact following.
      // Only PostCompact confirms compaction actually completed, and the
      // spec has one `compact` kind, not a start/end pair -- wiring
      // PreCompact here would sometimes record a compaction that never
      // occurred.
      return { kind: 'compact', sessionId, fields: { reason: str(payload.trigger) } };

    default:
      // Deliberately unmapped, each for a distinct documented reason (see
      // ../README.md for the full accounting):
      //  - UserPromptSubmit: observed and real, but matches none of the
      //    fourteen observation kinds (NOTES.md is explicit that turn_end
      //    is not a fuzzy match -- it is the END of a turn).
      //  - PreCompact: see the PostCompact case above.
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

async function main() {
  const workspace = process.env.AGENT_JOURNAL_WORKSPACE;
  if (!workspace || !workspace.trim()) return; // unconfigured: nothing to do

  const raw = await readStdin(STDIN_TIMEOUT_MS);
  if (!raw || !raw.trim()) return;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return; // malformed payload: nothing to observe, nothing to report
  }

  const mapped = mapPayload(payload);
  if (!mapped) return;

  const { spawnSync } = await import('node:child_process');

  // AGENT_JOURNAL_CMD lets this run before `agent-journal` is on PATH --
  // e.g. in a dev checkout, `AGENT_JOURNAL_CMD="node /abs/path/to/packages/agent-journal/dist/bin.js"`.
  // Split on whitespace only: no support for an argument containing one.
  const commandSpec = (process.env.AGENT_JOURNAL_CMD || 'agent-journal').trim().split(/\s+/);
  const [bin, ...preArgs] = commandSpec;
  if (!bin) return;

  const args = [...preArgs, 'observe', '--workspace', workspace, '--kind', mapped.kind];
  for (const [field, value] of Object.entries(mapped.fields)) {
    if (typeof value !== 'string' || !value.trim()) continue; // absent stays absent
    args.push(`--${field}`, value);
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

main()
  .catch(() => {})
  .finally(() => process.exit(0));
