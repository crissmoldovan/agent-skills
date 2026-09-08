# Claude Code adapter

Translates Claude Code's own hook payloads into `agent-journal observe` calls.
This is the thing that actually feeds the observation plane — Tasks 2–4 built
`observe`; this is the only piece that calls it from a real Claude Code
session.

**Everything this file claims about payload shapes and event names comes from
[`../NOTES.md`](../NOTES.md)**, produced by capturing real hook payloads from
a throwaway project rather than assuming how Claude Code hooks behave. If
this README and NOTES.md ever disagree, NOTES.md wins — it's the primary
record.

## Files

- `journal-hook.sh` — the script Claude Code's `command` hook actually
  invokes. POSIX `sh`, no bash-isms.
- `journal-hook.mjs` — the mapping logic (event → observation kind and
  fields), run by `journal-hook.sh` as a Node subprocess. Not a new runtime
  dependency: Node is already required for `agent-journal` itself to run at
  all. It exists as a separate file rather than being inlined into the `.sh`
  because reliably parsing the arbitrarily-nested JSON in `tool_input` /
  `tool_response` needs a real JSON parser, and depending on `jq` or
  `python3` (neither guaranteed present) is a worse trade than the one
  already-required interpreter.
- `settings-fragment.json` — copy the `"hooks"` object into
  `~/.claude/settings.json` (merge with any existing `"hooks"` key rather
  than replacing it).

## Installing it

1. Build the package once (`pnpm build` from `packages/agent-journal`), or
   plan to use `AGENT_JOURNAL_CMD` below to run it straight from source.
2. Copy `settings-fragment.json`'s `"hooks"` object into
   `~/.claude/settings.json` (or a project-scoped `.claude/settings.json`).
3. In every `command` string, replace:
   - `REPLACE_ME_WORKSPACE` with your `agent-journal` workspace id.
   - `/absolute/path/to/agent-skills` with this repo's actual absolute path
     on the machine running Claude Code. `settings.json` commands run
     wherever Claude Code invokes them from, not relative to this repo.
4. Make sure `agent-journal` is resolvable — either put it on `PATH` (after
   `npm install -g` or equivalent), or set `AGENT_JOURNAL_CMD` (below) inside
   the same `command` string.
5. Run a real Claude Code session, then check:
   ```
   AGENT_JOURNAL_ROOT=<your root> agent-journal coverage --workspace <id>
   ```
   Coverage reporting a session with events is the confirmation that the
   hook actually fired and actually wrote something — the wildcard
   (`"matcher": "*"`) config in `settings-fragment.json` was not itself
   directly observed working for every `SessionStart` source, only for the
   one (`"startup"`) NOTES.md's own capture used (see NOTES.md, Step 1).

## Configuration (environment variables)

Claude Code's `command` hook is one string with no documented way to attach
a separate env block (NOTES.md, Step 1: the real captured example is a
`sh -c '<script>' <arg0> <arg1> <arg2>` invocation with everything on stdin,
nothing injected as `argv`). So every variable below is set as a prefix
*inside* the `command` string itself, as `settings-fragment.json` shows.

| Variable | Read by | Meaning |
| --- | --- | --- |
| `AGENT_JOURNAL_WORKSPACE` | `journal-hook.sh` | Required. Unset or blank: the hook does nothing and exits 0 — most sessions have not opted in, and that's not an error. |
| `AGENT_JOURNAL_CMD` | `journal-hook.mjs` | The command that runs `agent-journal`, split on whitespace (no quoting for an argument containing a space). Defaults to `agent-journal` (needs it on `PATH`). In a dev checkout, before it's installed anywhere: `AGENT_JOURNAL_CMD="node /abs/path/to/packages/agent-journal/dist/bin.js"`. |
| `AGENT_JOURNAL_NODE` | `journal-hook.sh` | Overrides the `node` used to run `journal-hook.mjs` itself. Defaults to `node`. Mainly useful for tests. |
| `AGENT_JOURNAL_ROOT`, `AGENT_JOURNAL_HARNESS` | `agent-journal` (the CLI) | Passed straight through the environment; this adapter never sets them itself. Set `AGENT_JOURNAL_HARNESS=claude-code` so the envelope's own `harness` field (not the `session_start` observation's `data.harness`, which this adapter always sets to `"claude-code"` regardless) matches too. |
| `AGENT_JOURNAL_SESSION`, `AGENT_JOURNAL_AGENT` | `agent-journal` (the CLI) | **Set by `journal-hook.mjs` itself** on the child process it spawns, from the payload's own `session_id` (every mapped event) and, for `SubagentStart`/`SubagentStop` only, `agent_id`. Anything already in your own environment is overridden for that call — the payload's own identifiers are more authoritative than whatever a shell happened to export. |

## What this costs, honestly

Every mapped hook event spawns two subprocesses: `node journal-hook.mjs`,
which in turn spawns `agent-journal observe`. That is the price of routing
through `agent-journal`'s own redaction rather than writing JSONL directly —
see "Why it shells out" below — and it is not optimised away. Measured
directly here (five back-to-back `PreToolUse` calls against the built
binary, `date +%s%N` around the whole `journal-hook.sh` invocation): roughly
270–470ms of wall time added to the tool call it observes, dominated by two
Node process starts back-to-back. That is specific to this machine and this
moment — measure it on the machine this actually runs on before treating any
number here as authoritative. On a fast local disk this may not be
noticeable; on a slow one, or under load, it will be. This is the accepted
cost of the fail-closed path, not a bug to file.

Two bounded timeouts exist purely as safety nets against a harness that
doesn't behave the way every capture in NOTES.md shows: reading the payload
off stdin gives up after 1.5s (every capture shows the harness writing the
full payload and closing stdin immediately), and the `agent-journal observe`
subprocess itself is killed after 3s if still running. Neither should
normally fire.

## Why it shells out instead of writing JSONL directly

`agent-journal observe` redacts (`src/redact.ts`) before anything reaches
disk. `tool_input` is the single richest source of secrets in the whole
system — a `Bash` command with an inline token, a `Write` with an API key in
the file body. Writing the journal line directly from this hook would be
faster and would skip that scan entirely. It doesn't. Verified directly: feed
this adapter a `PreToolUse` payload whose `tool_input.command` contains
`AWS_SECRET_ACCESS_KEY=AKIA...`, and the string on disk reads
`AWS_SECRET_ACCESS_KEY=[REDACTED]` (see
`packages/agent-journal/test/adapter-claude-code.test.ts`, "a secret in a
tool input does not reach disk").

## The three rules, and how each is actually enforced

1. **It never fails the tool call it observes.** Every exit from
   `journal-hook.sh` is `exit 0`, unconditionally, and `journal-hook.mjs`
   never sets `process.exitCode` and always calls `process.exit(0)` in a
   `finally`. The result of the `agent-journal observe` subprocess — its
   exit code, stdout, stderr, even a spawn error for a missing binary — is
   never inspected. A redaction refusal (`agent-journal`'s own exit 1) is
   treated exactly the same as success: nothing was recorded, and the hook
   still exits 0.

   **A pattern that looks like it belongs here and doesn't:** the original
   sketch for this script used
   `: "${AGENT_JOURNAL_WORKSPACE:?}" 2>/dev/null || exit 0`. Measured
   directly, this does not do what it looks like it does: on an unset
   variable, `${VAR:?}` ends the whole non-interactive shell right there,
   with **its own** nonzero exit code — 1 under macOS's `/bin/sh`, 2 under
   `dash` — before the `||` ever gets a chance to run. That's rule 1 broken
   on the single most common case (an unconfigured workspace). `[ -z
   "${AGENT_JOURNAL_WORKSPACE:-}" ]; then exit 0; fi` was verified, under
   both `/bin/sh` and `dash`, to actually exit 0 in that case — see the test
   "a broken exit-0 rule surfaces here first" and its mutation check in the
   report for this task.

2. **It never blocks.** Reading the hook payload off stdin races against a
   1.5s timeout; spawning `agent-journal observe` is bounded to 3s. Tested
   directly with a FIFO whose writer end is held open and never closed
   (simulating a harness that never sends EOF): the hook still exits 0,
   bounded by the timeout rather than hanging (`packages/agent-journal/test/adapter-claude-code.test.ts`,
   "the hook does not hang when stdin is never closed").

3. **It bypasses nothing.** See "Why it shells out" above.

## Events wired

| Claude Code event | agent-journal kind | Fields sent |
| --- | --- | --- |
| `SessionStart` | `session_start` | `harness` (hardcoded `"claude-code"` — nothing in the payload names the harness itself), `cwd`. `branch` is a `session_start` field but no captured payload carries git branch info, so it's left out rather than guessed. |
| `SessionEnd` | `session_end` | `reason` |
| `Stop` | `turn_end` | `turn` = `last_assistant_message` (truncated to 4000 chars). NOTES.md's own heartbeat section names `Stop` as "fires once per turn, when the agent stops responding" — the nearest and only observed per-turn boundary. |
| `PreToolUse` | `tool_call` | `tool` = `tool_name`, `input` = JSON of `tool_input` (truncated), `callId` = `tool_use_id` |
| `PostToolUse` | `tool_result` | `tool`, `callId`, `summary` = JSON of `tool_response` (truncated). This is a **generic** truncated JSON rendering, not a per-tool extraction — NOTES.md confirms only three `tool_response` shapes (`Bash`, `Read`, `Agent`) out of an open-ended set of tools, and building bespoke handling for those three while guessing at the rest was exactly the kind of invention this task exists to avoid. |
| `SubagentStart` | `subagent_start` | `agentId` = `agent_id`, `purpose` = `agent_type` (the only descriptive field this event carries — the richer free-text description lives on the *parent's* `PreToolUse` for the `Agent` tool call, a different hook event with no shared key exposed here to join the two) |
| `SubagentStop` | `subagent_stop` | `agentId` = `agent_id`, `status` = the **fixed literal `"stopped"`**, not a guess at success/failure. NOTES.md's captured `SubagentStop` payload carries no field distinguishing the two — the nearest candidate, `tool_response.status` (`"completed"` in the one sample captured), lives on the *parent's* `PostToolUse` for the `Agent` tool call, a different event with no shared correlation key exposed here. |
| `PostCompact` | `compact` | `reason` = `trigger` (`"manual"`/`"auto"`) |

`AGENT_JOURNAL_SESSION` is set on every mapped call from the payload's own
`session_id`; `AGENT_JOURNAL_AGENT` is additionally set, only for
`SubagentStart`/`SubagentStop`, from `agent_id`.

**Not wired: `--seq`.** `observe --seq` exists so a dropped hook shows up as
a gap in `agent-journal coverage`. Populating it would need a persistent
per-session counter this stateless, one-shot-per-hook-invocation script has
no safe place to keep without inventing a new failure mode (a counter-file
race between concurrent tool calls) for a benefit out of proportion to this
task. Left for a future iteration if gap-detection turns out to matter in
practice.

## Events NOT wired — and why, plainly

- **`heartbeat` — never wired, structurally, not an oversight.** See
  NOTES.md's own section on this: every hook fires only when the agent
  *acts* — there is no hook that fires because time passed and nothing
  happened. A `heartbeat` synthesised from any hook (including `Stop`) would
  be indistinguishable from `turn_end` and would go silent for exactly the
  case liveness tracking needs it for: an idle-but-attached session between
  turns. `journal-hook.mjs`'s event switch has no case for this under any
  spelling — verified directly by a test feeding `heartbeat`, `Heartbeat`,
  and `HEARTBEAT` as `hook_event_name` and asserting nothing with kind
  `heartbeat` is ever written.

- **`permission` — no confirmed harness source.** NOTES.md: `PermissionRequest`
  was attempted twice, including under `--permission-mode manual`, and never
  fired even during a real permission denial — the model was told the call
  needed approval, but no hook event of any kind appeared in the log for it.
  Not wired on faith.

- **`tool_failure` — genuinely unresolved, not wired.** NOTES.md: an `Edit`
  with a guaranteed-absent `old_string` produced a model reply that quoted
  the exact tool error text, yet **no** `PreToolUse`, `PostToolUse`, or
  `PostToolUseFailure` event of any kind appears in the log for that turn.
  Whether the harness suppresses the hook for this case, or the model
  asserted a call it never actually made, is unknown from this environment.
  Not wired on a guess either way.

- **`UserPromptSubmit` — observed and real, deliberately left unmapped, not
  dropped.** It fires at the *start* of a turn, before the model has done
  anything. NOTES.md is explicit that `turn_end` is not a fuzzy match for
  it — `turn_end` is defined as the end of a turn, and this is not that. No
  kind was invented for it.

- **`PreCompact` alone does not record a `compact`.** NOTES.md documents a
  real case: `/compact` issued when the CLI judges there isn't enough
  conversation to compact still fires `PreCompact`, with no `PostCompact`
  following. Only `PostCompact` confirms compaction actually completed, and
  the spec has one `compact` kind, not a start/end pair — so only
  `PostCompact` is mapped.

- **`Notification`, `PostToolBatch`** — named only in the installed binary's
  own embedded strings; never observed to fire, never attempted (NOTES.md
  has no reliable way to force either from a scripted run). Not wired.

## Known gaps, stated rather than hidden

- **Tool calls made from *inside* a running subagent** may not be
  attributable to that subagent through this adapter. NOTES.md never
  captured a `PreToolUse`/`PostToolUse` payload fired from inside a
  dispatched subagent (its own probe subagent never called a tool), so it's
  unconfirmed whether such a payload carries an `agent_id` this adapter
  could route on. Everything currently mapped assumes the top-level session
  identity (`AGENT_JOURNAL_AGENT` unset → `agent-journal`'s own default,
  `"primary"`), which is correct for every sample NOTES.md actually shows.
- **The `"matcher": "*"` wildcard** in `settings-fragment.json`, for events
  other than tool calls, follows documented Claude Code convention rather
  than something NOTES.md's OBSERVED section directly proved — its one real
  `SessionStart` capture used `"matcher": "startup"`, a specific source, not
  a wildcard. Confirm on your own machine with `agent-journal coverage`
  after a real session (see "Installing it" above).
- **`scratchpad_dir`** appears on every payload NOTES.md captured, but that
  file itself flags it as possibly an artifact of the sandbox the probe ran
  in. This adapter has no dependency on it either way.
