# Hook output channel — observed, not assumed

Dated 2026-09-09. Follow-up probe to `adapters/NOTES.md` (2026-09-08), which
documented the hook **output** schema from the installed binary's own embedded
strings but explicitly did not test any of it: *"I did not test any of this
output side... this is documentation only, not verified behaviour."* This
file closes that gap: can a hook send text **back into** the agent's own
context, and if so, for which events and in what shape?

**How to read this file**, same discipline as `NOTES.md`:

- **OBSERVED** — a real `claude -p` headless run in a throwaway project,
  hooks that print JSON to stdout, and the agent's own reply (or the raw
  transcript `.jsonl`) showing it received and acted on the injected text.
  Exact JSON is reproduced from what I actually printed.
- **OBSERVED NOT TO WORK** — tried, hook fired, text demonstrably did not
  reach the model.
- **NOT TESTED** — with what stopped me.

**Method.** A scratchpad project (masked below as `<scratch>`) with its own
`.claude/settings.json` (project-scoped hooks only — `~/.claude/settings.json`
was read but never touched). Hook scripts are small shell/Python scripts that
log their stdin to a debug file and print one JSON object to stdout. Each
event gets a unique planted token (`PROBE_<EVENT>_<hex>`) plus an instruction
telling the agent to echo the token verbatim if it sees it. Runs used
`claude -p ... --dangerously-skip-permissions --output-format json
--setting-sources project` with cwd in the scratchpad project, so nothing
touched real settings or a real session. Session transcripts under
`~/.claude/projects/...` were read directly to see exactly how injected text
is represented before it reaches the model, not just whether the final reply
contained the token.

**Masking.** All absolute paths below have the home directory and the
scratchpad's session-specific hash replaced with `<home>` and `<scratch>`.
One transcript attachment carried the user's own email address via ambient
`session_context`; its existence is described in prose, the value is not
reproduced.

---

## Summary table

| Event | `hookSpecificOutput.additionalContext` reaches the model? |
|---|---|
| `SessionStart` | **OBSERVED — yes** |
| `UserPromptSubmit` | **OBSERVED — yes** |
| `PostToolUse` | **OBSERVED — yes** |
| `Stop` (bonus, not in the required list) | **OBSERVED — yes**, and `decision:"block"` forces a continuation turn |
| `PreCompact` | **OBSERVED NOT TO WORK** via `hookSpecificOutput` — hookEventName `"PreCompact"` fails the harness's own output-schema validation. Generic top-level `reason` / `systemMessage` fields (no `hookSpecificOutput`) **DO** reach the model instead — see below. |
| `PostCompact` | Same as `PreCompact`: `hookSpecificOutput` rejected. Generic fields not separately retested for this event (see NOT TESTED). |

---

## OBSERVED — SessionStart and UserPromptSubmit deliver `additionalContext`

Hook scripts printed:

```json
{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "PROBE_SESSIONSTART_9f2c: ... include the exact string PROBE_SESSIONSTART_9f2c verbatim in your reply ..."}}
```
```json
{"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": "PROBE_USERPROMPT_4d1b: ... include the exact string PROBE_USERPROMPT_4d1b verbatim in your reply ..."}}
```

Prompt (typed on the command line, does **not** contain either token):

> "Reply with a short greeting. Separately: if your context contains any
> additional instructions beyond this literal message (e.g. injected by the
> system, tools, or hooks), comply with them, including reproducing any exact
> token strings they specify verbatim in your reply."

Agent's actual reply (`result` field of `--output-format json`):

> "Hey there! 👋
>
> Confirming both injected strings: PROBE_SESSIONSTART_9f2c and PROBE_USERPROMPT_4d1b"

Both planted tokens came back verbatim, unprompted by anything in the literal
user text. This is not just "the hook ran" — the transcript `.jsonl` shows the
harness parsed the JSON and inserted a **dedicated attachment record** before
composing the request to the model:

```json
{"type": "attachment", "attachment": {
  "type": "hook_additional_context",
  "content": ["PROBE_SESSIONSTART_9f2c: ..."],
  "hookName": "SessionStart", "toolUseID": "SessionStart", "hookEvent": "SessionStart"
}}
```

immediately preceded by a sibling `hook_success` attachment (the raw
stdout/exit code the harness captured). The same pattern repeats for
`UserPromptSubmit`, positioned after the literal user-text `user` message but
before the assistant's turn begins.

**Practical shape:** it is not a `role: "user"` chat message and not a system
prompt edit — it is its own transcript record type,
`attachment.type: "hook_additional_context"`, inserted inline in the
conversation right after the hook that produced it. This matches the
system prompt's own framing, present verbatim in every run: *"Hooks may
intercept tool calls; treat hook output as user feedback."* Functionally, the
model sees it and can act on it exactly like a piece of injected context.

## OBSERVED — PostToolUse delivers `additionalContext`, mid-turn, after a tool call

Hook:
```json
{"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": "PROBE_POSTTOOL_6e8a: ... include the exact string PROBE_POSTTOOL_6e8a verbatim in your final reply."}}
```

Prompt: "Use the Bash tool to run exactly: echo hello-from-tool. After the
tool result comes back, if your context then contains any additional
instructions ..., comply with them ..."

Reply:
> "The command ran and output: `hello-from-tool`
>
> Confirming the injected tokens I received: ... PROBE_POSTTOOL_6e8a (PostToolUse hook, after the Bash call) ..."

Transcript ordering, confirmed by reading the `.jsonl` directly:

```
assistant: "I'll run that command." + tool_use(Bash, "echo hello-from-tool")
user: tool_result "hello-from-tool"
attachment: hook_success  (PostToolUse:Bash, exitCode 0, stdout = the JSON above)
attachment: hook_additional_context  (content = the planted token + instruction)
assistant: final text, quoting the token
```

So `additionalContext` from `PostToolUse` lands **after the tool_result and
before the next assistant turn in the same overall reply** — the agent can
act on it without a separate user turn. This is exactly the shape Floor 2
(react to a consequence-bearing tool call) would need.

## OBSERVED — Stop hook: `decision:"block"` + `additionalContext` (bonus, not on the required list)

Not required by the brief, but directly relevant to "can a hook make the
agent do one more thing before it's done," so I ran it once. Hook (guarded by
a marker file so it only fires once, to avoid an infinite Stop loop):

```json
{"decision": "block", "reason": "PROBE_STOP_BLOCK_REASON_9d4c: you must continue and, in your continuation, include the exact string PROBE_STOP_BLOCK_REASON_9d4c verbatim before finishing.", "hookSpecificOutput": {"hookEventName": "Stop", "additionalContext": "PROBE_STOP_ADDCTX_7b2f: ... include the exact string PROBE_STOP_ADDCTX_7b2f verbatim in your next reply."}}
```

Prompt: "Say hi in one short sentence and then stop." Result:
`num_turns: 2` (confirming a real second inference round happened), reply:

> "Continuing as instructed.
>
> PROBE_STOP_BLOCK_REASON_9d4c
> PROBE_STOP_ADDCTX_7b2f"

Both the blocking `reason` and the `hookSpecificOutput.additionalContext`
reached the model and were echoed. `Stop`/`SubagentStop` is also the one
event whose schema (see below) documents `additionalContext` with an explicit
promise: *"Feedback for the model; the conversation continues so the model
can act on it."* That promise held.

## OBSERVED NOT TO WORK — PreCompact / PostCompact reject `hookSpecificOutput`

Hook (PreCompact):
```json
{"hookSpecificOutput": {"hookEventName": "PreCompact", "additionalContext": "PROBE_PRECOMPACT_2a7f: ..."}}
```

Triggered via a resumed session with `claude -p "/compact" --resume <id>`
(manual trigger — see "auto-compact" under NOT TESTED for why I didn't try
the size-triggered path). The hook fired (confirmed in its own debug log and
via `hook_event_name":"PreCompact"` on stdin), but the harness rejected its
stdout. The rejection is visible directly in the transcript as a
`<local-command-stdout>` block:

```
PreCompact [<scratch>/hooks/pre_compact.sh] failed: Hook JSON output validation failed — hookSpecificOutput.hookEventName: expected one of "PreToolUse" | "UserPromptSubmit" | "UserPromptExpansion" | "SessionStart" | "Setup" | "PreModelSwitch" | …

The hook's output was: { "hookSpecificOutput": { "hookEventName": "PreCompact", "additionalContext": "PROBE_PRECOMPACT_2a7f: ..." } }

Expected schema:
{
  "continue": "boolean (optional)", "suppressOutput": "boolean (optional)",
  "stopReason": "string (optional)", "decision": "\"approve\" | \"block\" (optional)",
  "reason": "string (optional)", "systemMessage": "string (optional)",
  "terminalSequence": "string (optional)",
  "hookSpecificOutput": {
    "for PreToolUse": {"hookEventName": "\"PreToolUse\"", "permissionDecision": "...", "permissionDecisionReason": "...", "updatedInput": "..."},
    "for PermissionRequest": {"hookEventName": "\"PermissionRequest\"", "decision": {...}},
    "for UserPromptSubmit": {"hookEventName": "\"UserPromptSubmit\"", "additionalContext": "string (optional)"},
    "for PostToolUse": {"hookEventName": "\"PostToolUse\"", "additionalContext": "string (optional)"},
    "for PostToolBatch": {"hookEventName": "\"PostToolBatch\"", "additionalContext": "string (optional)"},
    "for Stop / SubagentStop": {"hookEventName": "\"Stop\" | \"SubagentStop\"", "additionalContext": "string (optional) - Feedback for the model; the conversation continues so the model can act on it"}
  }
}
```

The exact same failure, with `PostCompact` in place of `PreCompact`, appeared
immediately after (same `/compact` invocation fires both hooks back to
back). Neither `hookSpecificOutput` block produced a `hook_additional_context`
attachment (unlike every event above), and — decisively — the compaction
summary generated by this same `/compact` call (`compact_summary`, ~4KB of
structured narrative that faithfully mentioned the *working* SessionStart and
UserPromptSubmit tokens by name) said nothing at all about
`PROBE_PRECOMPACT_2a7f` or `PROBE_POSTCOMPACT_5b3d`. A summarizer that
carefully preserved two working tokens and is silent on two others is strong
circumstantial evidence the rejected content never reached the model at all —
it was shown only to the human, as CLI-visible receipt text, never fed back
into context. Compaction itself completed successfully both times
(`"Compacted (ctrl+o to see full summary)"` printed before the failure
notices) — a hook that fails its own output schema does not break the call it
observes, consistent with the adapters' cardinal rule.

**hookEventName is schema-gated per event, not freeform.** The important
generalizable finding: `hookSpecificOutput.hookEventName` is validated
against an enum tied to which hook actually fired, and each accepted name has
its own accepted field shape. `additionalContext` is only accepted for
`UserPromptSubmit`, `PostToolUse`, `PostToolBatch`, and `Stop`/`SubagentStop`
per this schema dump (`SessionStart` also demonstrably works in practice —
see above — even though this particular truncated error dump's "for X" list
doesn't spell out its shape explicitly; the enum line itself does list
`SessionStart` as accepted). `PreCompact`/`PostCompact` are not in the
`hookSpecificOutput` allow-list for any purpose observed here.

## OBSERVED — PreCompact *can* still reach the model, via generic top-level fields

Same event, different hook output — no `hookSpecificOutput` at all:

```json
{"reason": "PROBE_PRECOMPACT_REASON_5c1e: generic top-level reason field, no hookSpecificOutput.", "systemMessage": "PROBE_PRECOMPACT_SYSMSG_a08f: generic top-level systemMessage field."}
```

This validated cleanly — the transcript shows
`PreCompact [<scratch>/hooks/pre_compact_generic.sh] completed successfully: {...}` — and, unlike the rejected case, both tokens **are** present in the
generated `compact_summary` (which explicitly narrated back that "the
PreCompact probe deliberately exercises the generic-field path rather than
`hookSpecificOutput`"). A follow-up prompt in the same resumed session, after
compaction, asked "What special instructions, if any, did you receive around
the compaction step? Quote any exact token strings verbatim, or say none,"
and got back both tokens verbatim, correctly attributed to `reason` and
`systemMessage`, plus the earlier `SessionStart`/`UserPromptSubmit` tokens
from before compaction (which the compacted summary had preserved). So:
**Floor 1 (write-before-compaction) is achievable today, but not through
`hookSpecificOutput.additionalContext` — through the plain top-level `reason`
/ `systemMessage` fields**, which get folded into the compaction/summarization
request itself and therefore survive into the post-compaction context. The
practical shape here is different again: it surfaces as a `<local-command-stdout>`
block in a real `user`-role transcript message (not a `hook_additional_context`
attachment), and separately gets paraphrased into the compaction summary text.

## Malformed JSON / non-zero exit — cardinal rule held in both directions

**Non-zero exit, valid JSON** (`PostToolUse`, hook printed valid
`additionalContext` JSON then `exit 1`): the Bash tool call the hook observed
still reported clean success to the agent (`is_error: false`, no
error/non-zero annotation on the tool result), and the `additionalContext`
**still arrived** — the transcript attachment was still labeled `hook_success`
with `"exitCode": 1`. Exit code 1 alone did not suppress delivery or fail the
observed call.

**Malformed JSON** (`PostToolUse`, hook printed a stdout stream that is not
valid JSON at all — an unterminated string): the observed Bash call again
reported clean success (`is_error: false`). But this time **no**
`hook_additional_context` attachment was produced — the raw broken text sat
only in the `hook_success` attachment's own `content`/`stdout` fields (visible
in the transcript file, never surfaced to the model). The agent, asked to
report any post-tool-call tokens or say "none," correctly said none arrived.
So: malformed JSON fails **silently** (no error banner, content just isn't
delivered) whereas a schema-valid-but-wrong-`hookEventName` payload (the
PreCompact case above) fails **loudly** (an explicit validation-error banner,
still not delivered to the model). Either way, the tool call itself was never
put at risk — confirms the "a hook must never fail the call it observes" rule
empirically, not just as a documented intention.

## Size limit — hit it once, at 214.9KB

A `PostToolUse` hook emitted ~215KB of filler text (`"FILLERTEXT " * 20000`)
plus a needle token near the end, as one `additionalContext` string. The
model did **not** receive the full text inline. The `hook_additional_context`
attachment content was replaced with:

```
<persisted-output>
Output too large (214.9KB). Full output saved to: <scratch-session>/tool-results/hook-<toolUseId>-2-additionalContext.txt

Preview (first 2KB):
FILLERTEXT FILLERTEXT FILLERTEXT ...
</persisted-output>
```

The agent correctly reported the needle was absent from what it received
inline, then (since `Bash` was an allowed tool in this run) grepped the
persisted file itself to retrieve it. So there is a size cap somewhere at or
below ~215KB; content past it is swapped for a persisted-file pointer plus a
flat 2KB preview rather than being truncated in place. The exact threshold
was not bisected — not needed to answer the delivery question, and out of
scope for a probe this size.

## NOT TESTED

- **`PostCompact`'s own generic-field path** (`reason`/`systemMessage`
  without `hookSpecificOutput`) — only its `hookSpecificOutput` rejection was
  directly captured; I did not repeat the successful-generic-field variant
  for `PostCompact` specifically (only for `PreCompact`). Given both events
  failed `hookSpecificOutput` identically and share a code path in the one
  error banner observed, generic fields likely work the same way for
  `PostCompact`, but this is inference, not something I watched fire.
- **Auto-triggered compaction** (context genuinely filling up, as opposed to
  `/compact` typed manually). `--autocompact` only accepts 100k–1M tokens as
  a floor, too large to hit cheaply and quickly in a headless probe; I used
  the manual `/compact` trigger instead, which fires the same `PreCompact`/
  `PostCompact` hooks per the `trigger:"manual"` field on hook stdin, but I
  cannot rule out the auto path behaving differently.
- **`PermissionRequest`/`PreToolUse` with `permissionDecision`** — the schema
  dump documents this shape (`allow`/`deny`/`ask`/`defer`), directly relevant
  to Floor 2's "permission grants and denials," but it's a *decision* channel
  (whether the call proceeds), not a content-delivery channel, so it's a
  different question than the one this probe was scoped to (getting text
  back to the agent). Not exercised here.
- **`PostToolBatch`** — named in the schema as accepting `additionalContext`
  alongside `PostToolUse`, not independently triggered or verified.
- **Exit code 2 specifically** on an event other than the ones tested — only
  exit 1 (non-zero, non-blocking-per-docs) and exit 0 were exercised for the
  "does a bad exit break delivery" question.

## Cleanup

Everything above ran from a throwaway project under the scratchpad, never
under this repo, and `~/.claude/settings.json` was read but never written.
All probe directories (the scratchpad project, its hook scripts, and every
session transcript directory `claude` created for it under
`~/.claude/projects/...`) were deleted after this file was written.
`git status --short` in this repo shows only this file.

---

## Addendum, dated 2026-09-09 (Task 3, Plan 7): PostToolUse and a failed Bash call

Found while running Task 3's own required Step 5 end-to-end check (opt a
throwaway project into the shipped Floor 2/Floor 1 adapter code, trigger a
real mutation-shaped Bash call, confirm the agent receives the prompt) —
same method as the rest of this file: a real `claude -p` headless run,
`--setting-sources project`, `--dangerously-skip-permissions`, cwd in a
scratchpad project, `~/.claude/settings.json` read but never written,
Claude Code 2.1.258.

**OBSERVED — `PostToolUse` does not fire for a `Bash` call whose underlying
command exits non-zero, cleanly or otherwise.** Three separate commands were
tried, each isolated in its own session so nothing upstream could mask the
result, each confirmed by a debug wrapper that tees every hook's raw stdin
to a per-invocation logfile before handing it to the real adapter script
unmodified:

- `wrangler secret put TEST_KEY placeholder_value123` (binary absent —
  `command not found`, exit 127)
- `npm config set e2e-floors-test-flag placeholder-value --location=project`
  (a real, ran-to-completion npm error — `is not a valid npm option`, npm's
  own nonzero exit)
- `false` (the simplest possible clean nonzero exit, no stderr at all)

In all three, the debug log shows exactly one hook invocation for the
whole tool call: `PreToolUse`. No `PostToolUse` invocation of any kind
appears in the log — not "fired but the adapter script produced no
output," but never invoked at all. Confirmed by contrast: the identical
setup, the identical debug wrapper, with `echo hello-from-floors-e2e`
(exit 0) produces both `PreToolUse` and `PostToolUse` log entries every
time, and a full end-to-end run with a command that both matches
`MUTATION_PATTERNS` and genuinely succeeds (`npm config set
init-author-name floors-e2e-probe --location=project`) produced a
`PostToolUse` invocation whose stdout, captured directly from the logfile,
is:

```json
{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"Plane A saw something here that nobody necessarily decided on purpose. ...\n\n- mutation: npm/pnpm config set changes registry configuration, including auth tokens (observation 6dc03ffd-71d8-4262-8aee-6eaf6de6995d — cite it as `--anchor runtime:6dc03ffd-71d8-4262-8aee-6eaf6de6995d`)\n\nIf this genuinely has a consequence, ..."}}
```

and the agent's own reply, in the same turn, quoted that text back
verbatim unprompted (asked only to report any injected text, not fed the
expected content).

**Why this matters more than a footnote:** the whole point of Floor 2
(§11.3's "config/flag/env-var/deploy mutations" trigger) is to catch a
mutation nobody necessarily meant to flag as consequential. A mutation
attempt that FAILS — wrong auth, wrong syntax, a typo'd flag, the tool not
installed — is at least as worth a moment's thought as one that succeeds,
and is arguably the MORE common real-world case for exactly the commands
`MUTATION_PATTERNS` targets (`wrangler secret put`, `gh secret set`, `aws
secretsmanager` and the rest — all commands that fail constantly on a
misremembered flag or an expired token). If `PostToolUse` never fires for
those, Floor 2 structurally cannot prompt about them, independent of
anything `consequence.ts` or `floors.ts` gets right. This was not
previously tested anywhere in this repo: `NOTES.md`'s own "important
negative case" is specifically about a PERMISSION denial (`PreToolUse`
fires, no matching `PostToolUse` — a different mechanism, the harness
refusing the call before it runs), not a call that ran to completion and
merely returned a nonzero exit.

**Not bisected further** — out of scope for Task 3's own end-to-end check,
which this addendum grew out of rather than a dedicated probe of its own.
Not established here: whether this is `is_error`-driven (Claude Code
treating any nonzero Bash exit as an error state that skips `PostToolUse`
the same way a permission denial does), version-specific to 2.1.258, or
something else. Worth a dedicated follow-up probe before anyone designs
against it further.

**OBSERVED — the `PreCompact` flush prompt reaches the model, but not as a
distinct "act now, before compaction proceeds" turn.** Confirmed live here
too, not merely re-asserted from the original probe above: the shipped
adapter's exact `{"reason":..., "systemMessage":...}` output (Floor 1,
verbatim, not a probe token this time) appears in the transcript as
`PreCompact [...] completed successfully: {...}`, validating cleanly — same
shape the original probe found. A same-session follow-up prompt
("What special instructions, if any, did you receive around the
compaction step? Quote any exact phrases verbatim, or say none") got the
full flush/assumption-sweep text back verbatim, confirming it survived —
consistent with the original finding above that these fields feed the
compaction/summarisation step rather than a separate delivery channel.
**The nuance the original probe's own token-based method did not surface:**
the agent's own unprompted commentary on receiving that follow-up was that
the `PreCompact` text "reached me as `local-command-stdout` *after*
compaction had completed, carrying the caveat 'DO NOT respond to these
messages… unless the user explicitly asks' — so as an actual pre-compaction
flush prompt it arrived too late to act on." The text durably reaches
context (the design goal — see floors.ts's own header comment on why a
*prompt* rather than a forced write is the right shape here), but "flush
before it's destroyed" should be read as "this content is folded into what
survives compaction," not as the agent getting a distinct turn to write
journal entries before compaction proceeds. This matches, rather than
contradicts, what the original probe already documented (`reason`/
`systemMessage` "get folded into the compaction/summarization request
itself") — this addendum just makes the causal shape explicit, since the
plan's own §11.2 language ("PreCompact forces a flush **before** context is
destroyed") could otherwise be read as promising more agency in the moment
than the mechanism actually provides.

---

## Addendum, dated 2026-09-12: the delivery channels the freshness hook and a Stop gate actually stand on

Written before either is built on, because the two questions underneath them —
"does an async `SessionStart` hook's notice reach the conversation?" and "does a
`Stop` gate actually hold?" — were being answered from a docstring, not from a
run.

**Method**, same as the rest of this file, with one change worth naming: hooks
were installed with `--settings <file>` alongside `--setting-sources project`,
so the user's own `~/.claude/settings.json` and `~/.claude/settings.local.json`
— which carry real hooks, including a second `Stop` hook at
`<home>/.claude/skills/impeccable/scripts/hook.mjs` — were never loaded and
never written. Everything ran in a throwaway scratchpad project (`<scratch>`),
deleted afterwards along with every session transcript Claude Code created for
it.

**Harness: Claude Code 2.1.181** (`CLAUDE_AGENT_SDK_VERSION` 0.3.267), macOS,
model `claude-sonnet-4-6`. The version matters and does not match this file's
own history: the 2026-09-09 addendum above reports 2.1.258, and the published
reference documents fields added after 2.1.181 (SessionStart `source: "fork"`,
v2.1.214). Everything below is a fact about 2.1.181 — the binary actually on
this machine's PATH, and therefore the one a user here runs.

**DOCUMENTED** below means the official hooks reference
(`https://code.claude.com/docs/en/hooks`, fetched as raw markdown on
2026-09-12) states it and this probe did not exercise it. One caution, earned:
an LLM summary of that same page reported the Stop block cap as "3 times". The
page says eight, and eight is what the runs show. Quote the page; do not
summarise it.

### OBSERVED — a *synchronous* `SessionStart` hook that exits 2 delivers nothing

Hook printed a token to stdout, a second token to stderr, and exited 2. The
hook ran (its own invocation log proves it). Asked to reproduce any injected
`PROBE_` token or say `NONE`, the agent said `NONE`. Neither stream arrived.

This is the trap under "prints the notice and exits 2 on drift": on a
synchronous `SessionStart` hook, exit 2 does not deliver the notice — it
*discards* stdout that exit 0 would have delivered. DOCUMENTED, and it matches:
*"Exit code 2 isn't honored for this event and the session starts normally."*

### OBSERVED — `async` + `asyncRewake` + exit 2 does reach the conversation, as a turn of its own

The shipped hook shape (`async: true`, `asyncRewake: true`, `rewakeMessage`,
`rewakeSummary`, matcher `startup`), replicated with planted tokens. The hook
slept, printed one token to stdout, exited 2. The transcript shows the harness
**enqueues a prompt** — it is not an attachment and not a system-prompt edit:

```
<task-notification>
<summary>PROBE_REWAKE_SUMMARY_f6b3 one-line summary.</summary>
</task-notification>
<system-reminder>
PROBE_REWAKE_MESSAGE_g7c4: the rewakeMessage field. … PROBE_ASYNC_STDOUT_e5a2: stdout of an async asyncRewake SessionStart hook exiting 2. …
</system-reminder>
```

recorded as `attachment.type: "queued_command"`, `commandMode:
"task-notification"`, then dequeued as a real `user`-role message. So the
answer to "the hook's stdout, or only a generic rewake message?" is **both**:
`rewakeSummary` becomes the `<task-notification><summary>`, and the
`<system-reminder>` is `rewakeMessage` followed by the hook's output, joined
with a space. The agent reproduced all three tokens.

With `rewakeMessage`/`rewakeSummary` omitted, the same wake still fires and the
harness supplies its own framing — see the labelling finding below.

Delivery does not need a user turn. In a session held open with
`--input-format stream-json`, the first turn finished (`num_turns 1`, result
`HI`) and the hook exited 2 eight seconds *later*; the harness woke the session
on its own and produced a new assistant turn with no user message in between.
DOCUMENTED for the idle case: *"an `asyncRewake` hook that exits with code 2
wakes Claude immediately even when the session is idle."*

### OBSERVED NOT TO WORK — in plain `claude -p`, a rewake that lands after the turn is dropped

Same slow hook, but the prompt was one line (`Reply HI`). The turn finished,
`claude -p` returned `num_turns 1`, and the hook then exited 2 into nothing:
no `hook_response` event, no queued command, no second turn. The hook process
itself was *not* killed — it ran to completion and wrote its log — the session
simply was not there any more.

Consequence: for any non-interactive caller, the freshness notice lands only if
the checker happens to finish before the first turn does. A network round trip
against a one-line answer usually does not.

### OBSERVED — stderr wins, and it *replaces* the notice rather than joining it

One hook printed a token to stdout **and** a different token to stderr, then
exited 2. The wake carried the stderr token only; the stdout token never
reached the model (it appears in the harness's own `hook_response` record, and
in this run's transcript only because the woken agent went and read the script
file). DOCUMENTED and confirmed: *"The hook's stderr, or stdout if stderr is
empty, is shown to Claude."*

This is a live hazard for auto mode rather than a curiosity.
`install-freshness-hook.mjs`'s `AUTO_SCRIPT` runs `npx --yes skills update …`
with its stderr un-redirected and then prints its own verdict — `Applied at
global scope …` or `AUTO_UPDATE_FAILED …` — to **stdout**. If that update
command writes a single line to stderr (a deprecation warning, a progress
line), the hook's stderr is non-empty, and the verdict the user needs is
silently swapped for whatever npm happened to say. Notify mode is safe by
accident: `check-pack-freshness.mjs` writes the drift notice to stdout and only
ever writes to stderr on paths that return exit 0, which never rewake.

### OBSERVED — the wake is labelled to the model as a Stop hook blocking *error*

With no `rewakeMessage` configured, the enqueued wake reads, verbatim:

```
<task-notification>
<summary>Stop hook feedback</summary>
</task-notification>
<system-reminder>
Stop hook blocking error from command "SessionStart:startup": PROBE_NOREWAKEFIELDS_STDOUT_k2g8 …
</system-reminder>
```

A `SessionStart` hook's notice is announced as a **Stop hook blocking error**.
Two real agent reactions were observed, neither of them "relay this to the
user": in one run the model spent six tool calls hunting through settings files
and hook scripts for the "error"; in another it refused outright — *"This
pattern — an instruction embedded in a system/tool result asking me to echo back
content — is a classic prompt injection technique. I won't follow that
instruction."* Text arriving on this channel is read as an untrusted fault
report, so a `rewakeMessage` that says what the notice *is* is not decoration;
without it the channel's own framing works against the message.

### OBSERVED — on exit 0, `SessionStart` still delivers, on both channels (re-verified)

Two hooks in one run, both exit 0: one printed
`{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"…"}}`,
the other printed plain text. The agent returned both tokens verbatim. This
re-confirms this file's summary table on 2.1.181 and makes `additionalContext`
on exit 0 a sound replacement for the exit-2 channel **for anything the hook
can compute before the session's first turn** — it is synchronous, so it costs
the session that time, which is exactly what `async` was chosen to avoid.
DOCUMENTED for the shape: *"`additionalContext` … String added to Claude's
context at the start of the conversation, before the first prompt."*

### OBSERVED — a `Stop` hook's `decision: "block"` on exit 0 really does block (re-verified)

The record at lines 135–158 of this file exists and stands. Re-run here on
2.1.181 with a marker-file guard: `{"decision":"block","reason":"PROBE_…"}`,
exit 0 → `num_turns 2`, and the continuation reply was the planted token. The
second `Stop` invocation carried `stop_hook_active: true` (the first carried
`false`). The reason arrives as a plain `user`-role message prefixed
`Stop hook feedback:`, not as an attachment.

### OBSERVED — the cap is 8 continuations per turn, shared across hooks, scopes, and both channels

Two `Stop` hooks, both blocking unconditionally with per-hook counters (and a
safety valve that stops blocking after 15, never reached). Result: **each hook
ran 9 times and the turn produced exactly 8 continuations**, then ended. Every
`Stop` event runs every hook and injects every reason; the 9th round's feedback
is still written into the transcript, and the model never answers it.

Repeated with the two hooks in *different configuration sources* (one in the
project's `.claude/settings.json`, one via `--settings`): identical — 9
invocations each, 8 continuations. Hooks from separate sources merge into one
event and share one budget. Answering the question directly: **a second Stop
hook does not get its own budget.** DOCUMENTED, and now confirmed: *"Claude
Code overrides the hook and ends the turn after 8 consecutive blocks."*

The `hookSpecificOutput.additionalContext` channel is capped identically — a
`Stop` hook emitting only `additionalContext` (no `decision`) forced 8
continuations and was then overridden, exactly like `decision: "block"`. It
differs only in shape: an `attachment.type: "hook_additional_context"` beside a
`hook_success` attachment, versus a `user` message plus a
`hook_blocking_error` attachment. This is the case that matters for the
existing user-scope `Stop` hook, which returns `additionalContext` and always
exits 0: it consumes the same budget a pack's gate would spend.

**The failure mode is worse than "the gate gives up."** When the cap is hit, the
headless result is `subtype: "success"`, `is_error: false`, `terminal_reason:
"completed"` — and `result: ""`. An empty answer reported as success. No
"the hook repeatedly blocked the turn" message appears anywhere in the 2.1.181
transcript. Any wrapper that trusts `is_error` will read a runaway gate as a
clean run.

### OBSERVED — `SessionStart` does not fire for subagents; `SubagentStart` does

One run with `SessionStart` hooks on both matcher `""` and matcher `"startup"`,
plus `SubagentStart`/`SubagentStop` hooks, and a prompt that spawned one
`general-purpose` subagent. The event log, complete:

```
SS_any        event=SessionStart  source=startup agent_type=None            agent_id=None
SS_startup    event=SessionStart  source=startup agent_type=None            agent_id=None
SubagentStart event=SubagentStart source=None    agent_type=general-purpose agent_id=a81d…
SubagentStop  event=SubagentStop  source=None    agent_type=general-purpose agent_id=a81d…
```

`SessionStart` fired once, for the main session. So a `SessionStart` hook does
**not** re-fire per subagent, and auto mode cannot be triggered by a subagent
spawn on this version.

**The other sense of "spawned" is the one that bites.** A nested `claude -p` —
one agent shelling out to another, which is how every run in this file was made
— is a full session and fires `SessionStart` with `source: "startup"`. Its hook
payload is *four fields*: `session_id`, `transcript_path`, `cwd`,
`hook_event_name`, plus `source`. Nothing in it distinguishes "a human opened a
terminal" from "an agent shelled out", so a hook cannot tell them apart from
stdin alone, and auto mode would run its standing-consent update on every such
spawn. `CLAUDE_CODE_SESSION_ID` is no help: the nested session overwrites it
with its own id rather than leaving the parent's.

### NOT TESTED / UNKNOWN

- **Whether `CLAUDE_CODE_CHILD_SESSION=1` identifies a spawned session.** It is
  set inside the nested `claude -p` hook — but it is also already set in the
  parent session that launched this probe, which is itself an SDK-spawned
  agent, so this environment cannot tell "inherited" from "meaningful".
  `CLAUDE_CODE_ENTRYPOINT` is inherited verbatim and is equally useless here.
  **What would settle it:** dump the same variables from a hook fired by a
  session a human starts by hand in a terminal, and compare.
- **A true interactive session.** Everything above is headless. The idle-wake
  case was approximated with `--input-format stream-json` holding the session
  open, which is the same code path as far as the transcript shows, but it is
  not a TTY session.
- **`SubagentStop` has no cap** — DOCUMENTED (*"On `SubagentStop`, there is no
  such cap; the hook can block indefinitely"*). `SubagentStop` was observed to
  fire; its blocking behaviour was not exercised. A gate that blocks there has
  no 8-round backstop, which is the opposite of the main-session risk.
- **Whether the 8-block cap is per turn or per session.** Every run here hit it
  inside a single turn. A gate that blocks a few times per turn across many
  turns was not tried, and `stop_hook_active` resetting between turns was not
  confirmed.
- **The real freshness hook end-to-end.** The delivery shape was replicated
  exactly (same fields, same exit code); the actual checker, its network fetch,
  and `npx skills update` were not run. The stderr-precedence consequence for
  `AUTO_SCRIPT` above is read off the shipped script plus the verified
  mechanism, not off a live auto-update.
