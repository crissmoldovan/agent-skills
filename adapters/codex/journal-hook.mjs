#!/usr/bin/env node
// The event -> observation mapping for the Codex adapter.
//
// UNVERIFIED, in full. Codex is not installed on the machine that wrote this
// file (../NOTES.md, Step 4 -- searched for, plainly absent, not skipped).
// Everything below is built against OpenAI's published Codex documentation
// for its "hooks" system (developers.openai.com/codex/hooks, mirrored at
// learn.chatgpt.com/docs/hooks, read 2026-09-08) rather than a payload
// anyone here captured. Where a field name below is a documented Codex
// field, the comment says so; where it is inferred by analogy to Claude
// Code's own field names because Codex's own docs did not spell out the
// per-event JSON down to that level, the comment says that too. Nothing in
// this file has been run against a real Codex session -- see
// ../codex/README.md for the full accounting and do not read this file's
// confidence as higher than that.
//
// Codex documents two separate extensibility surfaces, not one:
//   - `notify`: a long-standing, simpler mechanism -- a single external
//     program invoked with the event JSON as a CLI ARGUMENT (not stdin),
//     documented to fire only for one event, "agent-turn-complete".
//   - `hooks` (hooks.json / an inline [hooks] table in config.toml): a
//     considerably newer, more elaborate system whose event names
//     (SessionStart, SessionEnd, PreToolUse, PostToolUse, PermissionRequest,
//     PreCompact, PostCompact, UserPromptSubmit, SubagentStart, SubagentStop,
//     Stop, Interrupt) and stdin-JSON-in/JSON-out shape closely mirror
//     Claude Code's own hook system. This file is built against the SECOND
//     of those, because it is the one with tool-level events, and because
//     its shape is the closer analogue to what the Claude Code adapter
//     already does. `notify`'s one event is a strict subset of what `Stop`
//     already gives here, so it adds nothing this file would otherwise
//     miss -- see README.md for why it is not wired separately.
//
// Three rules this file lives by (see ../README.md for the full versions,
// and for a Codex-specific sharpening of rule 1 that Claude Code's own
// adapter did not need to state, because Claude Code's documented hook
// output side was never exercised or confirmed to steer behaviour the way
// Codex's is explicitly documented to):
//   1. It never fails the call it observes -- every path ends in
//      process.exit(0), whatever happened along the way, and this script
//      never writes anything to its own stdout (see journal-hook.sh).
//   2. It never blocks -- bounded timeouts on both the stdin read and the
//      `agent-journal observe` spawn.
//   3. It bypasses nothing -- it always shells out to `agent-journal
//      observe`, which redacts. It never appends to the journal itself.

// Longest a single field value is allowed to be before this script
// truncates it itself. Mirrors the Claude Code adapter's own value and the
// same reasoning: a client-side courtesy ahead of redact.ts's own
// 262144-byte whole-event cap (src/redact.ts), not a substitute for it.
const MAX_FIELD_CHARS = 4000;

// How long to wait for the hook payload to fully arrive on stdin before
// giving up. Codex's own documentation was not fetched showing how promptly
// it closes stdin after writing a hook payload (nothing here was captured
// to check, per the file header) -- this bound exists purely as a safety
// net against a harness that never closes stdin, per rule 2, mirroring the
// Claude Code adapter's own value pending real evidence either way.
const STDIN_TIMEOUT_MS = 1500;

// How long `agent-journal observe` itself gets before this script stops
// waiting on it and moves on. Worth flagging a Codex-specific wrinkle here:
// its own hooks documentation describes SessionEnd and Interrupt hooks as
// defaulting to a much shorter timeout than other events (on the order of a
// second, capped low even when raised) before Codex itself kills the hook
// process outright. This script's own 3s bound is therefore a ceiling this
// process imposes on itself, not a guarantee Codex will wait that long for
// SessionEnd -- if Codex's own shorter timeout fires first, the hook is
// killed before this bound ever matters, and per rule 1 that must still not
// fail the SessionEnd call, which is Codex's responsibility, not this
// script's. Not verified either way.
const OBSERVE_TIMEOUT_MS = 3000;

function truncate(value, max) {
  if (typeof value !== 'string' || value.length <= max) return value;
  return `${value.slice(0, max)}...(truncated ${value.length - max} more chars)`;
}

// Only for fields expected to arrive as plain strings. A non-string here is
// a shape this script was not built against -- for a field whose very name
// is a documented-by-analogy guess (agent_id, agent_type, trigger,
// last_assistant_message; see the per-case comments below), a wrong guess
// at the name means this simply returns undefined and the field is dropped,
// not a crash. Absent stays absent, same rule normalizeObservationData
// (src/observe.ts) follows for the same reason -- and the reason this
// script can afford to guess at all: a wrong guess degrades to "nothing
// recorded for that field", never to a thrown error that could touch rule 1.
function str(value) {
  return typeof value === 'string' ? value : undefined;
}

// For fields expected to arrive as objects (tool_input, tool_response) --
// these vary per tool, and Codex's own tool set (its docs mention
// `apply_patch` alongside shell-style commands, not necessarily Claude
// Code's Read/Write/Edit/Bash/Agent names) was never captured here either.
// Rather than special-case any tool's shape, this renders whatever came
// through as JSON uniformly -- the same choice the Claude Code adapter
// makes, and for Codex it additionally means this mapping does not depend
// on knowing Codex's actual tool names at all.
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
 * Map one Codex hook payload to an agent-journal observation, or `null` if
 * this event has nothing to record. `null` is the expected outcome for most
 * event names this adapter sees -- see the `default` case below for exactly
 * which, and why each is left unmapped on purpose.
 */
export function mapPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;

  // `session_id` is one of the few fields Codex's own hooks documentation
  // names explicitly as a common field on every hook payload, alongside
  // `cwd` and `hook_event_name` -- these three are DOCUMENTED, not guessed.
  const sessionId = str(payload.session_id)?.trim() || undefined;

  switch (payload.hook_event_name) {
    case 'SessionStart':
      // `harness` is hardcoded, not read from the payload -- nothing
      // documented for SessionStart names the harness itself (that is this
      // adapter's own job to know), matching the Claude Code adapter's own
      // reasoning. `branch` is part of session_start's field set
      // (src/observe.ts) but nothing documented for Codex's SessionStart
      // says it carries git branch info, so it is left out rather than
      // guessed, same as the Claude Code adapter.
      return { kind: 'session_start', sessionId, fields: { harness: 'codex', cwd: str(payload.cwd) } };

    case 'SessionEnd':
      // `reason` is assumed by analogy to Claude Code's own SessionEnd
      // payload (`reason: "other"` observed there) -- Codex's own docs
      // confirm SessionEnd exists and runs synchronously (advisory, ignores
      // async:true) but were not seen to spell out its field names beyond
      // the common ones. If the real field is named differently, `str()`
      // returns undefined and this field is simply absent, per rule 1's
      // fail-soft design above.
      return { kind: 'session_end', sessionId, fields: { reason: str(payload.reason) } };

    case 'Stop':
      // `turn` from `last_assistant_message`, the same assumed field name
      // Claude Code's own Stop payload actually carries. Codex's docs
      // describe Stop as "turn completion" and separately warn that a Stop
      // hook's own `decision: "block"` output can force the agent to keep
      // going instead of stopping -- this script never emits any stdout
      // (see journal-hook.sh), so it cannot trigger that path regardless of
      // whether the field name below is right.
      return {
        kind: 'turn_end',
        sessionId,
        fields: { turn: truncate(str(payload.last_assistant_message), MAX_FIELD_CHARS) },
      };

    case 'PreToolUse':
      // `tool_input` and `tool_use_id` are the two fields Codex's own docs
      // explicitly name for PreToolUse ("Receives tool_input and
      // tool_use_id"). `tool_name` (used for the matcher) is assumed
      // present by the same naming convention, not separately confirmed in
      // prose.
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
      // `tool_response` is the field Codex's own docs explicitly name for
      // PostToolUse ("Receives tool_response after execution"). As with the
      // Claude Code adapter, this is a generic truncated JSON rendering,
      // not a per-tool extraction -- doubly justified here, since Codex's
      // actual tool_response shapes were never captured at all, let alone
      // for any specific tool.
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
      // agent_id / agent_type: NOT confirmed as Codex's actual field names
      // anywhere fetched for this adapter -- Codex's docs list SubagentStart
      // as a real event name but did not spell out its payload down to
      // field level. Carried over from Claude Code's own naming as the best
      // available guess, on the same fail-soft basis as SessionEnd's
      // `reason` above: wrong name means absent field, not a crash.
      return {
        kind: 'subagent_start',
        sessionId,
        agentId: str(payload.agent_id),
        fields: { agentId: str(payload.agent_id), purpose: str(payload.agent_type) },
      };

    case 'SubagentStop':
      // `status` is the fixed literal "stopped", not a guess at
      // success/failure, same reasoning as the Claude Code adapter: nothing
      // documented for Codex's SubagentStop distinguishes the two, so this
      // does not invent a distinction it cannot support. Codex's own docs
      // additionally warn SubagentStop's `decision: "block"` output can
      // force continuation, same mechanism as Stop above -- moot here for
      // the same reason (no stdout is ever written).
      return {
        kind: 'subagent_stop',
        sessionId,
        agentId: str(payload.agent_id),
        fields: { agentId: str(payload.agent_id), status: 'stopped' },
      };

    case 'PostCompact':
      // PreCompact is deliberately NOT mapped, mirroring the Claude Code
      // adapter's own reasoning -- but note the difference in how firmly
      // that reasoning is grounded. For Claude Code, NOTES.md OBSERVED a
      // real case of PreCompact firing with no PostCompact following (not
      // enough to compact). For Codex, nothing here confirms whether the
      // same case exists at all -- this is an ASSUMED parallel, carried
      // over because the spec has one `compact` kind, not a start/end pair,
      // and mapping PreCompact here risks recording a compaction that may
      // never have completed, which is the worse of the two ways to be
      // wrong.
      return { kind: 'compact', sessionId, fields: { reason: str(payload.trigger) } };

    default:
      // Deliberately unmapped, each for a distinct reason (see
      // ../README.md for the full accounting):
      //  - UserPromptSubmit: documented as a real Codex event, but -- same
      //    finding as Claude Code's own UserPromptSubmit -- it matches none
      //    of the fourteen observation kinds. It fires at the start of a
      //    turn; turn_end is defined as the end of one. No kind was
      //    invented for it, on either adapter, which is itself worth
      //    noting as a genuine cross-harness parallel rather than a
      //    coincidence of two people making the same call independently.
      //  - PreCompact: see the PostCompact case above.
      //  - PermissionRequest: DIFFERENT reason than Claude Code's, and a
      //    more serious one than "no confirmed source" -- Codex's docs
      //    confirm this event exists and describe its hook output as
      //    actively choosing allow/deny for the underlying request. Wiring
      //    it here, unverified, risks the exact thing rule 1 forbids: an
      //    observer accidentally becoming the thing that denies the call.
      //    Left unwired as a safety decision, not an evidentiary gap.
      //  - Interrupt: a Codex-only event with no Claude Code analogue
      //    (fires on user interruption, capped to a 1-3s timeout by
      //    Codex's own docs, cannot itself prevent the interruption). None
      //    of the fourteen kinds fit a mid-turn cutoff either, and this
      //    script does not invent one.
      //  - heartbeat: never derived from any hook, on any event name, on
      //    either adapter -- Codex's documented event list, like Claude
      //    Code's, contains nothing that fires on a timer or on idle. See
      //    ../NOTES.md's "structurally unavailable" section, which this
      //    adapter treats as applying here too: every Codex event listed in
      //    its own docs fires because the agent acted or a phase changed,
      //    never because time passed and nothing happened.
      //  - a documented Codex tool-failure event: Codex's own hooks
      //    documentation, unlike Claude Code's in-binary strings, does not
      //    name a distinct tool-failure event at all -- PostToolUse appears
      //    to be the only tool-completion hook, with failure presumably
      //    folded into whatever tool_response carries for a failed call.
      //    Nothing to wire separately; PostToolUse's generic summarize()
      //    already forwards whatever shape that turns out to be.
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
  // to a missing binary: this script does not get to fail the call either
  // way.
  spawnSync(bin, args, { env: childEnv, stdio: 'ignore', timeout: OBSERVE_TIMEOUT_MS });
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
