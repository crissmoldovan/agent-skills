# Hook contract notes — observed, not assumed

Dated 2026-09-08. Written for Tasks 5 and 6 (the Claude Code and Codex adapters).

**How to read this file.** Every claim below is tagged:

- **OBSERVED** — I captured this myself: a real `claude -p` headless run, in a
  throwaway project, piping its hook payload to a logging script, and I read the
  resulting log with my own eyes. The JSON shown is copy-pasted from that log
  (home-directory path segments masked — see "Masking" below).
- **DOCUMENTED (in-binary)** — found via `strings` on the installed Claude Code
  binary itself (`/opt/homebrew/Caskroom/claude-code@latest/2.1.258/claude`),
  which has its own hook-reference text and error messages baked in. This is the
  vendor's own current documentation for the exact build installed on this
  machine — more reliable than external docs or memory, but **not** something I
  triggered and watched fire. Treat as a strong hint, not a verified contract.
- **NOT OBSERVED** — attempted and did not fire, or not attempted, with what I
  tried noted. Absence here is evidence of absence *in this environment*, not
  proof the event doesn't exist.

Tasks 5/6: build the OBSERVED events with confidence. Treat DOCUMENTED-only
events as unverified in your README/reference, per the brief. Do not treat a
NOT-OBSERVED event as nonexistent — say so, the way this file does.

**Masking.** Several captured payloads carry `transcript_path` under
`/Users/<user>/.claude/projects/...`. I have replaced that prefix with `~` below
and note it here rather than reproduce a real home path. One captured
`compact_summary` also echoed the user's own email address from ambient system
context; I have not reproduced that field's full text for this reason (its
existence and shape are described in prose instead). No API keys, tokens, or
other credentials appeared in anything captured.

---

## Step 1 — the configuration shape, read from `~/.claude/settings.json`

**OBSERVED** (read-only — this file was never modified; see "Cleanup" at the
bottom for the byte-for-byte check).

Top-level structure:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          { "type": "command", "command": "...", "timeout": 300, "statusMessage": "...", "async": true, "asyncRewake": true, "rewakeMessage": "...", "rewakeSummary": "..." }
        ]
      }
    ]
  }
}
```

- Hooks live under a top-level `"hooks"` key.
- Each event name (`"SessionStart"` here) maps to an **array of matcher
  groups**. Each group has a `"matcher"` (a string — here `"startup"`, one of
  the values documented for `SessionStart`'s source) and a `"hooks"` array.
- Each entry in that array is one hook definition. The one on this machine has
  `"type": "command"` and a `"command"` string. Beyond the two required fields,
  this real example also carries `timeout` (seconds), `statusMessage` (shown
  while running), `async`/`asyncRewake` (let the hook keep running after the
  turn and wake the session later), and `rewakeMessage`/`rewakeSummary` (text
  injected on wake). Not all of these are documented as hook-input fields; they
  configure the hook's own execution, separate from what the hook receives.
- The real `command` is a `sh -c '<script>' <arg0> <arg1> <arg2>` invocation.
  **Important nuance, confirmed by Step 2/3 below:** the `$0`/`$1`/`$2`
  positional arguments in that command are *literal strings the settings
  author baked into the command string* (a node binary path and a package
  name) — **not** values the harness injects from the hook payload. In every
  payload I captured, `ARGS` (the command's own `argv`, i.e. `$*` inside the
  probe script) was **empty**. The harness's own contribution to a command hook
  is JSON on stdin; anything appearing as positional args comes only from what
  the settings author wrote into the `command` string itself. This matters for
  Task 5: don't expect the harness to append CLI arguments for you.

## Step 2/3 — Claude Code: events actually triggered

Method: built a throwaway project at `$(mktemp -d)/probe` (outside this repo,
outside `~/.claude/`), with its own `.claude/settings.json` wiring every
candidate event name to a logging script (`journal-probe.sh`, exactly as given
in the brief — captures ARGS and STDIN with a timestamp). Ran multiple
`claude -p "..."` headless invocations with `cwd` inside that project (plus
`-c`/`--permission-mode` variants to reach subagents and compaction), then read
the resulting log. Project-scoped `.claude/settings.json` **was** honoured for
hooks — no fallback to `--settings` was needed. Everything below is from that
log.

### hook_event_name values seen (own eyes, exact spelling)

```
SessionStart   (12x)   UserPromptSubmit (9x)   PreToolUse   (7x)
PostToolUse    (5x)    Stop              (9x)   SessionEnd  (11x)
SubagentStart  (1x)    SubagentStop      (2x)   PreCompact  (2x)
PostCompact    (1x)
```

All arrived as **JSON on stdin**, never as ARGS. This holds across every event
type observed.

### SessionStart — OBSERVED, 3 distinct `source` values seen

```json
{"session_id":"fe8266f9-...","transcript_path":"~/.claude/projects/.../fe8266f9-....jsonl",
 "cwd":"/private/var/.../probe","scratchpad_dir":"/private/tmp/.../scratchpad",
 "hook_event_name":"SessionStart","source":"startup"}
```

- `source:"startup"` — a fresh `claude -p` invocation.
- `source:"resume"` — a `claude -p -c "..."` continuing a prior session. This
  variant also carried extra keys not present on `"startup"`:
  `seconds_since_last_response`, `context_tokens`, `prompt_cache_likely_expired`,
  `estimated_cache_write_usd`.
- `source:"compact"` — fired automatically as a new "leg" the instant
  compaction finished (see PostCompact below); carried a `model` key instead of
  the resume-specific ones.

Keys common to all three: `session_id`, `transcript_path`, `cwd`,
`scratchpad_dir`, `hook_event_name`, `source`.

**Caveat on `scratchpad_dir`:** this key was present on *every* event in every
run, always pointing at a path under `/private/tmp/...`. I cannot confirm
whether this is a standard Claude Code hook field or an artifact of the sandbox
this probing session itself runs inside (this conversation's own system prompt
describes a "scratchpad directory" concept, and the nested `claude -p` process
may be inheriting something from that environment). Task 5 should not build a
hard dependency on `scratchpad_dir` being present in an ordinary user
environment without re-checking there.

### UserPromptSubmit — OBSERVED

```json
{"session_id":"...","transcript_path":"~/...","cwd":"...","scratchpad_dir":"...",
 "prompt_id":"1599a89e-...","permission_mode":"default",
 "hook_event_name":"UserPromptSubmit","prompt":"List the files in this directory..."}
```

Adds `prompt_id`, `permission_mode` (seen value: `"default"` — `manual` was
requested via `--permission-mode manual` on one run but the payload still read
`"default"`; inconclusive, see "Not observed" below), and `prompt` (the raw
user text).

### PreToolUse — OBSERVED, for tool_name `Bash`, `Read`, `Agent`

```json
{"session_id":"...","...":"...","prompt_id":"...","permission_mode":"default",
 "effort":{"level":"xhigh"},
 "hook_event_name":"PreToolUse","tool_name":"Bash",
 "tool_input":{"command":"ls -la \"...\"","description":"List files in the working directory"},
 "tool_use_id":"toolu_01Dz6TmJrR6pixJyKLFYaGw2"}
```

- `tool_name` and `tool_input` are present and shaped exactly like the tool's
  own arguments (e.g. Read's `tool_input` is `{"file_path": "..."}`).
- `tool_use_id` is present and is the same id that later shows up on the
  matching `PostToolUse`.
- `effort` is present (an object, `{"level": "xhigh"}` here) on tool-context
  hooks; **absent** on session-lifecycle events like `SessionStart`/`SessionEnd`
  — matches an in-binary doc string found separately (see Documented section).
- **Important negative case, itself an observation:** when a tool call is
  denied at the permission layer before it runs (e.g. `Read` on a path outside
  the project directory, or `Bash "exit 7"` under default permissions), the
  `PreToolUse` event still fires with the same shape, but **no matching
  `PostToolUse` follows** — the harness fires PreToolUse before the permission
  check resolves, not after. Task 5 must not assume every `PreToolUse`
  `tool_use_id` gets a paired `PostToolUse`.

### PostToolUse — OBSERVED, for tool_name `Bash`, `Read`, `Agent`

```json
{"...":"...","hook_event_name":"PostToolUse","tool_name":"Bash",
 "tool_input":{"command":"ls -la \"...\"","description":"..."},
 "tool_response":{"stdout":"total 24\n...","stderr":"","interrupted":false,"isImage":false,"noOutputExpected":false},
 "tool_use_id":"toolu_01Dz6TmJrR6pixJyKLFYaGw2","duration_ms":617}
```

- Carries everything `PreToolUse` did, plus `tool_response` (tool-specific
  shape — Bash: `{stdout,stderr,interrupted,isImage,noOutputExpected}`; Read:
  `{type,file:{filePath,content,numLines,startLine,totalLines}}`) and
  `duration_ms`.
- For the `Agent` tool (a subagent dispatch — see below), `tool_response`
  included `status`, `agentId`, `agentType`, `content` (an array of
  `{type:"text",text:"..."}` blocks), `resolvedModel`, `totalDurationMs`,
  `totalTokens`, and a full `usage` object (input/output/cache token counts).

### SubagentStart / SubagentStop — OBSERVED

Triggered by prompting the top-level session to "use the Task tool to launch a
general-purpose subagent." The tool the model actually calls for this is named
**`Agent`** in `tool_name` (not `Task`) — confirmed directly in the
`PreToolUse`/`PostToolUse` pair that bracket the subagent's own
`SubagentStart`/`SubagentStop`.

```json
{"session_id":"...","...":"...","prompt_id":"...","agent_id":"a73cac92a2fbb653e",
 "agent_type":"general-purpose","hook_event_name":"SubagentStart"}
```

```json
{"...":"...","agent_id":"a73cac92a2fbb653e","agent_type":"general-purpose",
 "permission_mode":"default","effort":{"level":"xhigh"},
 "hook_event_name":"SubagentStop","stop_hook_active":false,
 "agent_transcript_path":"~/.claude/projects/.../subagents/agent-a73cac92a2fbb653e.jsonl",
 "last_assistant_message":"done","background_tasks":[],"session_crons":[]}
```

- `SubagentStart` is lean: `agent_id`, `agent_type`, plus the common session
  fields. No `tool_name`/`tool_input` here — that lives on the parent's
  `PreToolUse` for the `Agent` tool call, not on `SubagentStart` itself.
- `SubagentStop` adds `agent_transcript_path` (the subagent's own transcript,
  separate from the parent's), `last_assistant_message` (the subagent's final
  text), `stop_hook_active`, `background_tasks`, `session_crons`.
- **A surprising, confirmed finding:** internal compaction summarisation is
  itself implemented as a subagent dispatch. During a real `/compact`, I
  observed a `SubagentStop` with `"agent_type": ""` (empty string) sandwiched
  between `PreCompact` and the post-compaction `SessionStart`. Its
  `last_assistant_message` was the `<analysis>…<summary>…</summary>` text that
  then reappears verbatim as `PostCompact`'s `compact_summary`. No matching
  `SubagentStart` was logged for this one — worth flagging to Task 5/6 as an
  event pairing that isn't always 1:1.

### PreCompact / PostCompact — OBSERVED (trigger: manual)

Reached by chaining several `claude -p -c "..."` turns to build up context,
then issuing `claude -p -c "/compact"`.

```json
{"session_id":"...","...":"...","prompt_id":"...",
 "hook_event_name":"PreCompact","trigger":"manual","custom_instructions":null}
```

```json
{"...":"...","hook_event_name":"PostCompact","trigger":"manual",
 "compact_summary":"<analysis>\n...\n</analysis>\n\n<summary>\n...\n</summary>"}
```

- `trigger` was `"manual"` both times I saw it (I only exercised `/compact`
  explicitly; never got a real auto-compact to fire — the one automatic
  attempt via a small `--autocompact` budget wasn't tried, noted under "Not
  observed"). The in-binary docs (see below) list `"manual"`/`"auto"` as the
  two values.
- `custom_instructions` was present and `null` on `PreCompact` (a `/compact`
  with no extra instructions).
- **A real trap I hit and Task 5/6 should design around:** issuing `/compact`
  when the CLI itself judges there isn't enough conversation to compact
  (its own reply was literally "Not enough messages to compact.") **still
  fired `PreCompact`** — but no `PostCompact` followed, and the session ended
  normally right after. A hook that assumes `PreCompact` implies compaction
  actually happens will be wrong some of the time; only `PostCompact` (or the
  next `SessionStart` with `source:"compact"`) confirms it went through.
- `PostCompact` fires, then a fresh `SessionStart` with `source:"compact"`
  fires in the same instant (same `session_id`, same `prompt_id`), then
  `SessionEnd`. Order observed: `PreCompact` → (internal `SubagentStop`) →
  `SessionStart(source=compact)` → `PostCompact` → `SessionEnd`.

### Stop — OBSERVED

```json
{"...":"...","hook_event_name":"Stop","stop_hook_active":false,
 "last_assistant_message":"...","background_tasks":[],"session_crons":[]}
```

No `tool_name`/`tool_input` — this is a session-lifecycle event, confirmed
absent every time.

### SessionEnd — OBSERVED

```json
{"session_id":"...","transcript_path":"~/...","cwd":"...","scratchpad_dir":"...",
 "prompt_id":"...","hook_event_name":"SessionEnd","reason":"other"}
```

Only `reason` value seen was `"other"` (every headless `-p` run ends this way).
Never saw `permission_mode` on this event. Did not observe any other `reason`
value — a normal interactive `/exit` or Ctrl-C might produce a different one;
not tested here.

## Events attempted but NOT OBSERVED to fire

- **`PermissionRequest`** — attempted twice: (1) asking for a `Read` outside
  the project directory and a `Bash "exit 7"` under default permissions — both
  were denied client-side (the model was told "requires approval" / "haven't
  granted it yet" in its own reply) with **no corresponding hook event at all**
  in the log, just a `PreToolUse` with nothing after it; (2) re-running with
  `--permission-mode manual` — the flag did not change the `permission_mode`
  value seen in payloads (`"default"` throughout) and no `PermissionRequest`
  fired. Headless mode may resolve permission entirely without going through
  this hook (there is no human to prompt), or it may require an interactive
  TTY. **Do not treat this event as verified for a headless/CI adapter.**
- **`PostToolUseFailure`** — attempted twice: a `Bash "exit 7"` (never actually
  ran — blocked at the permission layer, see above) and an `Edit` with an
  `old_string` guaranteed absent from the target file. In the second case the
  model's own reply claimed it made the call and got the exact error text back
  ("String to replace not found in file...") — **but no `PreToolUse`,
  `PostToolUse`, or `PostToolUseFailure` at all appears in the log for that
  turn.** I cannot tell whether the harness suppressed the hook for a
  client-side-validated tool error, or whether the model asserted a tool call
  it did not actually make (self-reported behaviour with no corroborating
  event — precisely the gap this task exists to catch). Either way: **not
  observed**, and Task 5/6 must not assume this event exists or is named this
  way without further testing in an environment that can watch the raw
  transcript, not just the model's prose.
- **`Notification`** — not attempted; no reliable way found to force one from
  a scripted headless run (the in-binary docs describe it as tied to
  interactive-session notifications).
- **`PostToolBatch`** — named in the in-binary docs (see below) but never seen
  fire in any run; not deliberately attempted (unclear how to force a batched
  tool call from a text prompt).
- **A real auto-triggered `PreCompact`** (`trigger:"auto"`) — only reached
  compaction via the explicit `/compact` command; never drove context high
  enough (or found the right `--autocompact` flag combination) to observe an
  automatic one. Documented as a valid `trigger` value; not personally
  observed.

## DOCUMENTED (in-binary strings, not triggered) — Claude Code

Found via `strings` on the installed CLI binary
(`/opt/homebrew/Caskroom/claude-code@latest/2.1.258/claude`), which has
embedded reference text (apparently used for an internal help/skill surface)
and its own error messages. Quoted verbatim from the binary, not from memory or
external web docs:

- The binary's own error for a bad hook name: *"Not a recognized hook event.
  Common events: PreToolUse, PostToolUse, UserPromptSubmit, SessionStart,
  SessionEnd, Stop."*
- An embedded hooks reference table lists these event names (Event | Matcher |
  Purpose), several of which I did not trigger above:

  | Event | Matcher | Purpose (as documented in-binary) |
  |---|---|---|
  | PermissionRequest | Tool name | Run before permission prompt |
  | PreToolUse | Tool name | Run before tool, can block |
  | PostToolUse | Tool name | Run after successful tool |
  | PostToolUseFailure | Tool name | Run after tool fails |
  | Notification | Notification type | Run on notifications |
  | Stop | - | Run when Claude stops (including clear, resume, compact) |
  | PreCompact | "manual"/"auto" | Before compaction |
  | PostCompact | "manual"/"auto" | After compaction (receives summary) |
  | UserPromptSubmit | - | When user submits |
  | SessionStart | - | When session starts |

- Also present as valid tool-lifecycle values in the binary's own hook-output
  validation strings: `"PostToolBatch"`, and `"Stop" | "SubagentStop"` (grouped
  together in output-schema docs, confirming `SubagentStop` is a recognised
  sibling of `Stop` rather than a separate ad hoc name). One string reads:
  *"Converting Stop hook to SubagentStop for ... (subagents trigger
  SubagentStop)"* — i.e. internally a subagent's own Stop is renamed
  SubagentStop before dispatch. This matches what I separately observed live.
- `executeSubagentStartHooks` and `executeSessionStartHooks` both exist as
  named functions in the binary, consistent with `SubagentStart` and
  `SessionStart` both being real, harness-invoked hook points (not just
  vocabulary).
- Documented hook-input stdin JSON shape (from the same embedded text):
  `session_id`, `tool_name`, `tool_input`, `tool_response` (PostToolUse only) —
  all of which match what I actually captured above.
- Documented hook JSON **output** schema (i.e. what a hook may print to stdout
  to influence the harness) includes `continue`, `stopReason`,
  `suppressOutput`, `decision`, `reason`, `hookSpecificOutput.hookEventName`,
  `hookSpecificOutput.additionalContext`, and a newer
  `hookSpecificOutput.permissionDecision` (`allow`/`deny`/`ask`/`defer`) for
  `PreToolUse`/`PermissionRequest`. **I did not test any of this output side —
  everything above is about what a hook receives, not what Task 5/6's script
  should return.** If the adapter ever needs to block or annotate (it
  shouldn't, per its own "never fails the call it observes" rule), this is
  documentation only, not verified behaviour.
- One string explicitly ties `effort` to tool-context hooks: *"Present for
  hooks that fire within a tool-use context (PreToolUse, PostToolUse, Stop,
  SubagentStop, etc.) ... absent for session-lifecycle hooks."* — matches the
  observation above.

## Step 4 — Codex

**Could not gather any evidence. No Codex CLI is installed on this machine.**

What I tried:
- `command -v codex` / `which codex` — not found.
- `brew list | grep -i codex` — no formula/cask.
- `npm ls -g --depth=0 | grep -i codex` — nothing global.
- `pip3 show codex` — not found.
- A broad `find` for anything named `*codex*` turned up only: (a) the
  `openai-codex` marketplace's **Claude Code plugin** named `codex`, enabled in
  `~/.claude/settings.json` (`"codex@openai-codex": true`) — this is a plugin
  *for* Claude Code, not a standalone Codex CLI, and it doesn't expose a
  hook runtime of its own to probe; and (b) an unrelated `~/.codex/` data
  directory belonging to some other, unrelated personal application (contents
  suggest a personal-assistant app — dictation history, a "pets" folder, goal
  tracking — nothing resembling a coding-agent hook system). I did not explore
  further inside it: it isn't the tool this task is about, and per this task's
  constraints I'm not touching or reading further into unrelated personal data
  that isn't needed for the brief.

**Conclusion for Task 6:** there is no route to empirical Codex evidence in
this environment. Build the Codex adapter against Codex's published hook
documentation only, and mark it **unverified** — plainly, per the brief — not
as a footnote.

## Cleanup confirmation

- Throwaway probe project (`$(mktemp -d)/probe`, under `/var/folders/.../T/...`,
  never under `~/.claude/` or this repo) was fully deleted, including its
  parent `mktemp` directory.
- `~/.claude/settings.json`'s `"hooks"` block was re-read after all probing and
  is byte-for-byte identical to what Step 1 quotes above — still exactly one
  `SessionStart` entry, nothing added. (Two unrelated top-level fields —
  `spinnerVerbs` and, transiently, others — changed on disk during this session
  due to that file's own live async hook running independently; I did not
  cause or touch those, and did not revert them per the instruction to leave
  externally-driven changes alone.)
- I did **not** delete the Claude Code session transcripts that headless runs
  against the probe project inevitably wrote under
  `~/.claude/projects/-private-var-...-probe/` (this happens for any `claude`
  invocation regardless of target directory, and is separate from the
  project's own `.claude/settings.json`). Deleting files under `~/.claude/` was
  judged to be itself a modification of `~/.claude/`, which this task's
  constraints forbid outright — so those inert transcripts (conversation logs
  only; no credentials) were left in place rather than risk violating "nothing
  in `~/.claude/` may be modified." Flagging this explicitly rather than
  silently leaving it out.
- This repo's `git status --short` shows only `adapters/NOTES.md` (new file).
