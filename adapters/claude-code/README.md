# Claude Code adapter

Translates Claude Code's own hook payloads into `agent-journal observe` calls,
and — opt-in only, see "Authoring floors" below — into `agent-journal floor`
prompts injected back into the same session. This is the thing that actually
feeds the observation plane — Tasks 2–4 built `observe`; this is the only
piece that calls it from a real Claude Code session. Task 3 (Plan 7) is what
makes it also *speak* into a session: until then, every hook here only
observed and wrote.

**Everything this file claims about payload shapes and event names comes from
[`../NOTES.md`](../NOTES.md)**, produced by capturing real hook payloads from
a throwaway project rather than assuming how Claude Code hooks behave. If
this README and NOTES.md ever disagree, NOTES.md wins — it's the primary
record. **Everything this file claims about hook OUTPUT — what a hook can
print back and have Claude Code actually act on — comes from
[`../HOOK-OUTPUT-NOTES.md`](../HOOK-OUTPUT-NOTES.md)**, the follow-up probe
that closes the gap NOTES.md itself left open ("I did not test any of this
output side"). Same rule: it outranks this file if they ever disagree.

## Files

- `journal-hook.sh` — the script Claude Code's `command` hook actually
  invokes. POSIX `sh`, no bash-isms. Forwards `journal-hook.mjs`'s stdout
  through to Claude Code (stderr stays discarded) — this is how the floors
  below actually reach a session; see that file's own comment on why this is
  safe with floors off.
- `journal-hook.mjs` — the mapping logic (event → observation kind and
  fields), run by `journal-hook.sh` as a Node subprocess. Not a new runtime
  dependency: Node is already required for `agent-journal` itself to run at
  all. It exists as a separate file rather than being inlined into the `.sh`
  because reliably parsing the arbitrarily-nested JSON in `tool_input` /
  `tool_response` needs a real JSON parser, and depending on `jq` or
  `python3` (neither guaranteed present) is a worse trade than the one
  already-required interpreter. Also where the two authoring floors (below)
  are built and emitted.
- `settings-fragment.json` — copy the `"hooks"` object into
  `~/.claude/settings.json` (merge with any existing `"hooks"` key rather
  than replacing it). Now includes a `PreCompact` block (Floor 1 needs it;
  nothing before this task ever wired that event at all).

## Installing it

1. Put `agent-journal` on your `PATH`. The `decision-journal` skill carries the
   CLI, and its installer writes a small wrapper to `~/.local/bin`: from this
   repo, `node skills/decision-journal/scripts/install-cli.mjs`; from an installed
   copy of the skill, `node <skill-folder>/scripts/install-cli.mjs`. Or build the
   package (`pnpm build` from `packages/agent-journal`), or plan to use
   `AGENT_JOURNAL_CMD` below to run it straight from source.
2. Copy `settings-fragment.json`'s `"hooks"` object into
   `~/.claude/settings.json` (or a project-scoped `.claude/settings.json`).
3. In every `command` string, replace:
   - `REPLACE_ME_WORKSPACE` with your `agent-journal` workspace id.
   - `/absolute/path/to/agent-skills` with this repo's actual absolute path
     on the machine running Claude Code. `settings.json` commands run
     wherever Claude Code invokes them from, not relative to this repo.
4. Make sure `agent-journal` is resolvable from where Claude Code runs hooks —
   on its `PATH` (step 1), or via `AGENT_JOURNAL_CMD` (below) inside the same
   `command` string. Claude Code launched from a desktop app may not inherit your
   shell's `PATH`; the absolute path the installer printed always works.
5. **Optional:** to turn on the authoring floors, add `AGENT_JOURNAL_FLOORS=1`
   to the `PostToolUse` and `PreCompact` blocks' `command` strings specifically
   (harmless, but pointless, on the others — see "Authoring floors" below).
   Off by default, deliberately: see that section for why.
6. Run a real Claude Code session, then check:
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
| `AGENT_JOURNAL_FLOORS` | `journal-hook.mjs` | Opt-in for the authoring floors — see below. Must be the exact string `1`. Unset, blank, `0`, `true`, or anything else means off. |

## Authoring floors

New in Task 3 (Plan 7, spec §11.2–11.3). Until this task, every hook here
only observed and wrote; these two are the first that speak back into the
session. **Off by default.** Set `AGENT_JOURNAL_FLOORS=1` in the `PostToolUse`
and `PreCompact` blocks' `command` strings to turn them on for a workspace —
every other value, including unset, leaves both floors completely inert,
which is also the state every workspace that predates this task is already
in (adding `PreCompact` to `settings-fragment.json` and forwarding stdout in
`journal-hook.sh` are both no-ops for a workspace that has not opted in — see
the mutation-check note in this task's report for direct proof neither
change is a silent behaviour shift on its own).

Why opt-in, not on by default: a floor that starts talking into a session
nobody asked it to talk into is a floor that gets the whole adapter
uninstalled within a day — and an uninstalled adapter records nothing at
all, which is strictly worse than the gap these floors close. See the plan's
own "opt-in per workspace" decision.

**The two floors use genuinely different mechanisms — this is not an
implementation detail, it is the one finding `HOOK-OUTPUT-NOTES.md` exists
to establish:**

| | Floor 2 (consequence) | Floor 1 (compaction) |
| --- | --- | --- |
| Fires on | `PostToolUse` | `PreCompact` |
| Text from | `agent-journal floor --kind consequence` | `agent-journal floor --kind compaction` |
| Wire shape | `{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"…"}}` | `{"reason":"…","systemMessage":"…"}` — **no `hookSpecificOutput` key, ever** |
| Why | Confirmed delivered mid-turn, right after the tool call (`HOOK-OUTPUT-NOTES.md`, "PostToolUse delivers additionalContext") | `hookSpecificOutput.hookEventName:"PreCompact"` is **rejected outright** by the harness's own schema validation — the probe captured the literal error banner. The generic top-level fields are what the harness actually folds into the compaction summary instead. |

Putting `hookSpecificOutput` on the `PreCompact` path — even by accident, even
alongside the correct generic fields — reproduces that rejection and shows
the human a validation-error banner instead of delivering the prompt. There
is a test for exactly this (`adapter-claude-code.test.ts`, "prints
reason/systemMessage, never hookSpecificOutput"), and it is written to fail
if that key ever appears there again.

**`--subject` and `--since`.** Floor 2 passes `--subject` as the tool's
`tool_input`, stringified and truncated — not the bare tool name — because
`constraintsMatching` (constraints.ts) checks a constraint's `scope` word
against this text, and a scope word like `redis` or `prod-db` shows up in a
command far more often than in a tool name like `Bash`. Floor 2 also passes
`--since`, bounded to just before *this* call's own `tool_call` observation
was written, computed from the PostToolUse payload's own `duration_ms` plus a
10-second buffer for hook dispatch overhead and clock slack (overridable via
`AGENT_JOURNAL_FLOOR_LOOKBACK_MS`, mainly for tests). This is a heuristic,
stated as one: `agent-journal floor` has no way to be told "only the
observation this exact call produced," only a timestamp cutoff, and this
script keeps no state across invocations to remember "the last time this
session checked" (the same reason `--seq` is left unwired below). Without
this bound, a single old mutation would resurface on every unrelated tool
call for the rest of the workspace's history — exactly the every-call noise
the opt-in decision above exists to prevent. A burst of several genuinely
consequence-bearing calls within the buffer window can legitimately appear
together; that is a real limitation of the heuristic, not a bug. Floor 1
passes neither flag: `PreCompact` fires rarely enough (only when the harness
is actually about to compact) that the same noise concern does not apply —
every compaction moment is a legitimate point to ask "did you flush, and did
you sweep for assumptions."

**Size.** `HOOK-OUTPUT-NOTES.md`'s probe hit a harness-side cap around 215KB,
past which content is swapped for a 2KB preview plus a file pointer.
`journal-hook.mjs` truncates its own floor text to 8,000 characters *before*
building the JSON — far below that cap, and never relying on the harness to
cope. Verified directly: feed the adapter a stubbed 300KB floor render and
what reaches stdout is truncated, not the whole thing (`adapter-claude-code.test.ts`,
"a 300KB floor render is truncated by this adapter").

**Never authors.** The floor TEXT is always exactly what `agent-journal
floor` printed — truncated if oversized, otherwise byte-for-byte, always
passed through `JSON.stringify`, never hand-built with string interpolation.
That last point matters more than it looks: a floor prompt can legitimately
contain quotes, backslashes, newlines, or text that merely *looks* like
broken JSON (a bulleted consequence line quoting a shell command), and none
of that is this adapter's problem to parse — it is a plain string value
being embedded, never re-interpreted. Verified directly with adversarial
content (`adapter-claude-code.test.ts`, "floor output containing quotes,
backslashes, newlines and unicode still round-trips as valid JSON", "a
malformed (non-JSON) floor render is never forwarded").

**A real limitation, found while verifying this end to end, not a footnote:**
`PostToolUse` does not fire for a `Bash` call whose underlying command exits
non-zero — confirmed live (Claude Code 2.1.258) for a missing binary, a real
program erroring out, and a bare `false`; contrast-confirmed with a
succeeding call, which fires it every time. This was never previously
tested here — `../NOTES.md`'s own negative case is about a permission
*denial*, a different mechanism, not a call that ran and merely returned
nonzero. Practically: Floor 2 cannot prompt about a mutation attempt that
*failed* — expired auth, a typo'd flag, the tool not installed — which is
at least as common as one that succeeds for exactly the commands
`MUTATION_PATTERNS` targets. See `../HOOK-OUTPUT-NOTES.md`'s addendum
(dated 2026-09-09, Task 3) for the full verification, including the exact
payloads and logs.

**Silence stays the common case.** `agent-journal floor` prints nothing and
exits 0 when there is nothing to say — most tool calls are not
consequence-bearing, and most `PreCompact` events fire on a workspace that
has already flushed. This adapter treats empty stdout from `floor` the same
way: nothing is written to its own stdout, so Claude Code never sees a hook
output at all for that call, exactly as if floors were off. It does **not**
inspect `floor`'s exit code — `floor` can exit 1 on a partially unreadable
journal while still printing a valid partial prompt on stdout (cli.ts's own
documented behaviour), and using stdout regardless of status is what lets
that partial-read case still reach the agent instead of being silently
dropped, mirroring how `recordObservation` already ignores `observe`'s own
exit code.

**PreCompact's two independent purposes.** `PreCompact` was never wired to
an *observation* before this task, and still is not — see "Events NOT
wired" below for why. It is now wired to *Floor 1*, which is a different
question entirely ("should I prompt for a flush before this destroys
context", asked *before* compaction, never *whether compaction happened*,
which only `PostCompact` can answer). `main()` keeps these as two genuinely
independent streams: `mapPayload(payload)` returning `null` for `PreCompact`
must not — and, per the mutation-check in this task's report, once briefly
did — short-circuit the function before the floor stream ever runs.

## What this costs, honestly

Every mapped hook event spawns two subprocesses: `node journal-hook.mjs`,
which in turn spawns `agent-journal observe`. That is the price of routing
through `agent-journal`'s own redaction rather than writing JSONL directly —
see "Why it shells out" below — and it is not optimised away.

Measured here, five back-to-back `PreToolUse` calls with `performance.now()`
around the whole `sh journal-hook.sh` invocation (macOS 26.3.1, arm64, Node
v26.7.0), `AGENT_JOURNAL_CMD` pointing at the built `dist/bin.js`:

| | per hook |
| --- | --- |
| warm — the steady state after the first call of a session | **68–78ms** |
| the first call after a fresh `pnpm build`, cold caches | 168–327ms |
| running from TypeScript source via `--experimental-strip-types` instead | 109–143ms |

Read those as the shape of the cost, not as a constant: they are two Node
process starts, so they track whatever this machine's process-start cost is
at that moment. An earlier revision of this file claimed 270–470ms, measured
by the same five-call method; re-running it here produced the table above
instead, and the gap is almost entirely cold-versus-warm. Measure it on the
machine this actually runs on rather than trusting either number. On a fast
local disk this may not be noticeable; on a slow one, or under load, it will
be. This is the accepted cost of the fail-closed path, not a bug to file.

Two bounded timeouts exist purely as safety nets against a harness that
doesn't behave the way every capture in NOTES.md shows: reading the payload
off stdin gives up after 1.5s (every capture shows the harness writing the
full payload and closing stdin immediately), and the `agent-journal observe`
subprocess itself is killed after 3s if still running. Neither should
normally fire.

**With floors on**, `PostToolUse` and `PreCompact` calls each spawn a
**third** subprocess (`agent-journal floor`), bounded by its own 3s timeout,
on top of the two above — not measured separately here (no reason to expect
it differs meaningfully from `observe`'s own number; it is the same kind of
call, one more journal read instead of a write), and only ever paid on those
two event names, only when `AGENT_JOURNAL_FLOORS=1`. Every other event, and
every workspace that has not opted in, pays nothing extra.

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

**These predate the authoring floors and still hold with them on — the
floors are additive, not an exception.** The one genuinely new risk they
introduce is covered directly in "Authoring floors" above (the JSON-safety
and size-cap paragraphs); this section is about the rules as they applied
before this task and continue to apply now.

1. **It never fails the tool call it observes.** Every exit from
   `journal-hook.sh` is `exit 0`, unconditionally, and `journal-hook.mjs`
   never sets `process.exitCode` and always calls `process.exit(0)` in a
   `finally`. The result of the `agent-journal observe` subprocess — its
   exit code, stdout, stderr, even a spawn error for a missing binary — is
   never inspected. A redaction refusal (`agent-journal`'s own exit 1) is
   treated exactly the same as success: nothing was recorded, and the hook
   still exits 0. The same now holds for `agent-journal floor`: its exit
   code is never inspected either, a hang is bounded by its own timeout, and
   a missing binary degrades to "print nothing" — verified directly
   (`adapter-claude-code.test.ts`, "a floor check that hangs still exits 0",
   "agent-journal being unavailable for the floor call still exits 0").

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

`PreCompact` is deliberately absent from this table — see "Events NOT wired"
below for the observation side. With floors on, it is separately wired to
*Floor 1* (a hook output, not an observation) — see "Authoring floors" above.

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
  `PostCompact` is mapped **to an observation**. That is unchanged by this
  task. `PreCompact` is, however, now wired to *Floor 1* — a hook output, a
  different question ("should I prompt for a flush now") answered
  independently of whether an observation is ever written for this event.
  See "Authoring floors" above.

- **`Notification`, `PostToolBatch`** — named only in the installed binary's
  own embedded strings; never observed to fire, never attempted (NOTES.md
  has no reliable way to force either from a scripted run). Not wired.

## Known gaps, stated rather than hidden

- **Floor 2's `--since` bound is a heuristic, not a precise correlation.**
  See "Authoring floors" above for the full reasoning — the short version is
  that this adapter has no persisted state across invocations, so it bounds
  "recent" by the current call's own `duration_ms` plus a fixed buffer
  rather than by "since the last time this session actually checked". A
  burst of genuinely consequence-bearing calls close together can appear
  together in one prompt; that is accepted, not fixed.
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
