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

---

## Addendum, dated 2026-09-14: `report-progress-gate.mjs` coverage 2, driven live

Written because the pack had never watched this gate's deny path end a real turn.
The gate's own header said the block channel was verified here; what was verified
here was a *probe* hook printing `decision:"block"` (lines 135–158, re-verified at
578–582), not the shipped gate deciding to. Everything in the 0.17.0 release note —
the `SubagentStart` arm, the register EDGE, the claim that the LEVEL arms nothing,
the one-block ceiling, and the multi-block limitation the note volunteers against
itself — was reasoned from unit tests over synthetic payloads. This addendum is
fourteen real headless sessions.

**Method**, unchanged from the rest of this file. A throwaway project (`<scratch>`)
under a scratchpad, `claude -p` with `--setting-sources project` and the hooks
supplied by `--settings <file>`, so the user's own `~/.claude/settings.json` and
`~/.claude/settings.local.json` were read but **never written and never loaded**.
Every hook command in those files is the exact command the shipped installer writes,
with one debug wrapper spliced in front: it tees the hook's raw stdin to a per-invocation
log, snapshots the gate's marker directory either side of the run, executes the gate
*unmodified* with that stdin, tees stdout/stderr/exit, and reproduces stdout verbatim
so the harness sees what the gate actually said. `AGENT_SKILLS_PROGRESS_GATE_DIR`
pointed at a per-run directory, so no test ever shared marker state with anything else
on the machine. Four turns in one CLI process were driven through
`--input-format stream-json` with a small driver holding stdin open — necessary,
because `background_tasks[]` belongs to the process and a `--resume` would have
started the register from empty (which is separately measured below).

**Harness: Claude Code 2.1.181**, macOS, model `claude-opus-4-8[1m]`, Node 22.22.3.
The file under test is `adapters/claude-code/report-progress-gate.mjs` as released in
0.17.0; `adapters/` is byte-identical at 0.18.0, so every finding below applies to
both.

### OBSERVED — the deny path ends a real turn, and the model gets another

A session was told to dispatch one subagent and then reply with a single line
carrying no report. The complete hook sequence, from the logs:

```
SubagentStart   agent_type=general-purpose  agent_id=ad4851ad…   stdout: (nothing)
Stop #1         stop_hook_active=false  background_tasks=[]  last_assistant_message="SUBAGENT_DONE"
                stdout: {"decision":"block","reason":"Progress-report gate: a subagent was started, …"}
Stop #2         stop_hook_active=true
                stdout: (0 bytes)   stderr: "report-progress gate: a block was already spent on this turn"
```

The refusal reached the model. The transcript shows it as a plain `user`-role message
— the same shape this file records for a blocking `Stop` hook — followed by a genuinely
new assistant turn:

```
assistant: "I'll dispatch the subagent now."
assistant: <tool_use Agent>
user:      <tool_result>
assistant: SUBAGENT_DONE
user:      Stop hook feedback:
           Progress-report gate: a subagent was started, so a progress report is owed …
assistant: <thinking>
assistant: SUBAGENT_DONE
```

`num_turns` was 3, against 1 for a one-line reply with no dispatch in the same project.
So: **the deny path is observed, not merely documented.** The gate blocked once, the
harness delivered the reason, a second inference round happened, and the gate stood
down on the next `Stop` exactly as its own docstring promises.

**What it does not buy is compliance.** In that run the model weighed the gate's
feedback against the user's explicit "write no report" and re-sent `SUBAGENT_DONE`
unchanged; the turn then ended. The gate buys one more round, and nothing else. Where
the instruction did not contradict it (the contradiction case below), the same model
rewrote the message and the corrected message passed. Both are worth knowing: this is
enforcement of an opportunity, not of an outcome.

### OBSERVED — a report with the three sections passes, on the first `Stop`, in silence

Same dispatch, and the turn ended with the model's own report:

```
**Done**
- Subagent ran `echo alpha`; it printed `alpha`.

**Running**
- Nothing — the subagent has returned.

**Next**
- Awaiting further instructions.
```

One `Stop` invocation, `num_turns` 2, **zero bytes on stdout**, and
`report-progress gate: the report is there` on stderr, which the harness does not
deliver to the model at exit 0. Worth recording that the shape that passed was bold
labels with no colon (`**Done**`) over bullets — a report nobody wrote to satisfy a
regex — and that `Running: Nothing` was accepted as an explicitly-empty section rather
than refused for carrying no state.

### OBSERVED — family B: the register EDGE arms a turn, and the LEVEL does not

Four user messages driven through **one** CLI process, so `background_tasks[]` was
continuous across all of them. The gate's complete output, per `Stop`:

| turn | prompt | `background_tasks[]` | gate |
|---|---|---|---|
| 1 | start `sleep 400` backgrounded, reply `BG_STARTED` | `[{id: biqqs6p1q, type: shell, status: running}]` | **blocked** — *"the harness registered background work during this turn"* |
| 2 | start nothing, reply `TURN_TWO` | same one id, still running | **0 bytes stdout, 0 bytes stderr** |
| 3 | start nothing, reply `TURN_THREE` | same one id, still running | **0 bytes stdout, 0 bytes stderr** |
| 4 | kill it, reply `BG_KILLED` | `[]` | **blocked** — *"work this session listed as running at the previous turn end is no longer listed by the harness (this gate cannot see a terminal state — only that the listing stopped)"* |

Every one of those four final messages was a bare one-liner with no report in it. Turns
2 and 3 were **completely silent — not even the stderr stand-down note**, which is the
`owed: false` path: the gate did not merely decline to block, it never considered itself
owed anything. That is the distinction the whole design rests on, and it holds live: a
background task that is merely *still running* costs nothing on any later turn, and a
`sleep 400` left in the background did not make every subsequent turn owe a report.

Both edges arm and each carries its own sentence. The disappearance sentence is
carefully hedged in the source and arrives at the model hedged.

### OBSERVED — the new contradiction check refuses a real denial and does not refuse an honest row

Coverage 2's one added check, exercised in the harness rather than over a synthetic
payload. A turn that started `sleep 300` in the background and then reported
`Running: none.` was refused:

```
Missing:
- the running section says it is empty, while the harness register in this same payload
  lists 1 background task still running
```

followed by the register paragraph the reason appends when work is in flight. The model
rewrote it, and the rewrite is the interesting part — it took the gate's own suggested
wording and the harness's real id:

```
Done: 1 background shell started (`sleep 300`, task bc10f1ulw).
Running: task bc10f1ulw (`sleep 300`), state running, last observed just now (harness register at turn end).
Next: wait for bc10f1ulw to complete.
```

Run back through `findReportFailures(message, { runningTaskCount: 1 })`, that message
yields `[]`. So the loop closes: refusal → correction → pass, with the corrected report
naming a real id and an honestly-bounded freshness rather than an invented interval.

The converse was run too, because the defect this check has already produced twice is
refusing an honest report. A turn with one task genuinely in flight ended with:

```
Running: bibec83nr, state running, last observed just now (harness register at turn end) — none of the checks have failed.
```

— a running section that contains the literal word `none`, which is the shape that used
to trip `declaresEmpty` over the whole block. It **passed on the first `Stop`**, zero
bytes, `the report is there`. The `carriesRow` guard works in the harness, not only in
the test file.

### OBSERVED — coverage 1 really is v0.16.1, register included

The same three scenarios under a settings file in v0.16.1's shape (`Stop` plus
`PostToolUse` matcher `Agent`, no `AGENT_SKILLS_PROGRESS_GATE_COVERAGE` in the command):

- the `Agent`-tool dispatch armed and the `Stop` blocked once, with the v0.16.1 sentence
  *"a subagent was dispatched through the Agent tool"*;
- the good report passed, silently;
- **the four-turn background sequence produced four `Stop` invocations, every one of them
  zero bytes on stdout AND zero bytes on stderr** — including the turn that started the
  task and the turn that killed it. The register is not read at coverage 1, for arming or
  for anything else.

And the new state 0.17.0 writes does not appear: after that whole sequence the gate's
marker directory was **empty** — no `<session>.register.json` was ever created. A user
whose settings were written by v0.16.1 gains no file, no block, and no behaviour from
updating the pack.

Two coverage-gating facts, checked by feeding the gate a captured `SubagentStart` payload
directly: with `AGENT_SKILLS_PROGRESS_GATE_COVERAGE` unset it writes no marker; with `=2`
it writes one; with `=3` (a typo) it writes none — the documented fallback to the
narrower armed level, not to the wider one and not to off.

### COULD NOT REPRODUCE — the second block coverage 2 is capable of

The 0.17.0 release note volunteers a limitation against itself: the gate can block on the
first `Stop`, stand down on the second, and **deleting its marker in the process** lose the
only memory it has of the block it spent — after which a further register change can arm it
fresh. Four sessions were built to reproduce that. **A second block never happened.** What
did happen is worth recording precisely, because the precondition reproduced exactly and
only one thing stopped it.

The decisive run started five background shells with staggered lifetimes, and kept the turn
alive past the gate's stand-down with a second, independent `Stop` hook that blocked three
times with neutral feedback (the same "hooks from separate sources merge into one event"
shape this file records at line 584). Marker-directory snapshots are from the wrapper, taken
immediately before each gate invocation:

```
Stop #1  stop_hook_active=false  bg=5 ids   marker: absent → written   BLOCKED
Stop #2  stop_hook_active=true   bg=2 ids   marker: present → deleted  stood down
Stop #3  stop_hook_active=true   bg=1 id    marker: ABSENT             stood down
Stop #4  stop_hook_active=true   bg=1 id    marker: absent             silent (nothing owed)
```

**`Stop #3` is the finding.** The marker was gone — `Stop #2` had deleted it. The register
had changed again underneath the turn (two ids down to one, a real disappearance). And the
gate printed `report-progress gate: a block was already spent on this turn`, which is emitted
from exactly one branch: the `stop_hook_active` short-circuit, which is only reached when
`causes` is non-empty. With no marker on disk, those causes can only have come from the
register edge. So the gate **did** re-arm from the register with no memory of the block it
had already spent, and the only thing between it and a second block on that turn was the
harness's own flag — which is the precise thing this gate's source says it refuses to rely
on.

`stop_hook_active` held. Across four sessions and **nine in-turn `Stop` invocations following
a first block, it was `true` on every single one.** It is not set only for the immediately
next `Stop`: it stayed set through a third and a fourth while a different hook was doing the
blocking. Within a turn, the flag alone makes a second block unreachable.

So: **could not reproduce, and the reason is the backstop rather than the gate.** That is a
smaller problem than "it blocks twice" and a larger one than "it cannot happen": every run of
this shape is one harness behaviour away from spending two of a budget that is shared with
every other `Stop` hook on the machine, whose exhaustion this file records as
`subtype: "success"`, `is_error: false`, `result: ""`. Nothing observed here contradicts the
release note; it upgrades "measured in tests" to "live, the harness catches it, and here is
the exact `Stop` where it had to."

### OBSERVED — a `stop_hook_active: false` that looks like a same-turn reset is a new turn

A trap for anyone reading these logs after me. In two runs a later `Stop` in what looked like
one `claude -p` invocation carried `stop_hook_active: false`, which would mean the flag resets
mid-turn. It does not. The transcript shows a `<task-notification>` user message arriving in
between — a background shell had finished, the harness woke a **new turn** to say so, and the
model answered it. `stop_hook_active` is per turn, and a background completion starts one.

This is also the confirmation, from the other side, of why this gate deliberately does not
wire `UserPromptSubmit`: the completion notice does arrive on that channel, and the `Stop`
hook sees the same event as a disappearance from the register one turn later at no extra cost.

### OBSERVED — resuming in a fresh CLI process costs exactly one block

The installer warns about this; it is real, and it is cheap. A session ended a turn with a
good report and one `sleep 300` still registered, leaving `{"ids":["bibec83nr"]}` on disk. The
same session was then resumed with `--resume` in a **new** CLI process and asked for a
one-line answer that started nothing:

```
Stop  stop_hook_active=false  background_tasks=[]   →  BLOCKED
      "work this session listed as running at the previous turn end is no longer listed …"
```

One block, then the usual stand-down. The register belongs to the process, not to the session
id, so the first `Stop` after a resume reads the whole previous register as a burst of
disappearances. Anyone measuring this gate's false-positive rate should expect one per resume
of a session that had background work.

### MEASURED — what the gate costs per invocation

Twenty runs of each, real captured payloads on stdin, on this machine:

| invocation | ms |
|---|---|
| unarmed (`AGENT_SKILLS_PROGRESS_GATE` unset), `Stop` payload | 33.4 |
| coverage 1, `Stop`, nothing armed | 33.3 |
| coverage 2, `Stop`, nothing armed | 33.6 |
| coverage 2, `Stop`, one running task (reads baseline, writes baseline) | 34.1 |
| coverage 2, `SubagentStart` (writes a marker) | 32.3 |
| bare `node -e ''` on this machine | 24.6 |
| sibling `release-notes-gate.sh`, armed, non-release `Bash` payload | 30.2 |
| sibling `release-notes-gate.sh`, unarmed | 7.8 |

**Coverage 2 costs under a millisecond more than coverage 1** — the register work is one small
read and one small write — and roughly three quarters of the whole figure is Node process
startup, which the gate pays before it can read anything. The comparison with the sibling gate
is the useful one: armed, they are within 10% of each other (33ms vs 30ms); unarmed they are
not, because the shell gate can decide it is off in 8ms while this one must start a Node
process to find out. "Off unless armed" saves the user's *context* and *turns*; on this file it
saves no wall clock at all. A normal turn pays this once; a blocked turn pays it twice, plus
once per subagent started.

### Incidental — `--remove` scans every event key, and the count it prints is honest

Checked because this installer has a history here. A settings file was built holding the
0.17.0 trio (`Stop`, `SubagentStart`, `PostToolUse` matcher `Skill`) **plus** a simulated
v0.16.1 leftover (`PostToolUse` matcher `Agent`) **plus** an unrelated third-party `Stop` hook.
`--remove` reported `Removed 4 report-progress gate hooks`, removed all four including the
leftover this version no longer writes, left the foreign hook and its group untouched, and
pruned the now-empty event keys. The "reported Removed 1 while the hook survived" failure did
not reproduce.

### NOT TESTED

- **`observe` mode, live.** Every run above used `block`. The observe branch writes to stderr
  and clears the marker; neither was exercised in a session.
- **The watched-skill arm (`--skills`).** `armsForSkill` was not driven by a real `Skill` tool
  call; only the `PostToolUse` matcher `Skill` hook the installer writes was inspected, and the
  `--remove` test above is the only place that entry appeared at all.
- **A workflow.** Family B was exercised with backgrounded `shell` entries and one backgrounded
  subagent kill. No `workflow` entry was ever present in `background_tasks[]` here, so
  "a workflow of twelve agents is ONE row" remains reasoned from the register's shape rather
  than watched.
- **A `workflow-subagent` `SubagentStart`.** The exclusion in `armsForSubagentStart` was never
  exercised by a real event; the only `agent_type` observed live was `general-purpose`.
- **Whether the gate can be made to block twice.** See above — the precondition reproduced, the
  block did not. What would settle it is a harness build (or an interrupt path) where
  `stop_hook_active` is not set on a later `Stop` of a turn that already blocked. Nothing here
  produced one.
- **A true interactive session.** Everything above is headless, as with the rest of this file.
- **Anything about the 8-block cap under this gate.** No run came close; the highest block count
  on any turn was four, three of them from the probe hook that existed to keep the turn alive.

### Cleanup

Everything ran from a throwaway project under a scratchpad, never under this repo. The user's
`~/.claude/settings.json` was read and never written. Marker state was redirected to per-run
directories via `AGENT_SKILLS_PROGRESS_GATE_DIR`, so the real temp path was untouched — verified
by listing it before and after. The scratch project, its hook scripts, its per-run logs and every
session transcript Claude Code created for it were deleted after this file was written.

---

## Addendum, dated 2026-09-14 (later): what a `Stop` hook can see of the process that ran it

Written to settle one question the addendum above leaves open. A resume in a fresh CLI process
costs one false block, because `background_tasks[]` belongs to the process while the gate keys its
baseline by `session_id`, which a resume keeps. Scoping the baseline to the process would remove
that block, **if** a hook can tell "a new CLI process" from "the same process, and a task is gone".
The second case is a real disappearance and has to keep arming. So the question is whether anything
reliably identifies the process, and what happens where it does not.

**Method.** A probe hook, not the gate, wired to `Stop` and `SessionStart` through `--settings` with
`--setting-sources project` in a throwaway project, in the exact command shape the installer writes
(leading `AGENT_SKILLS_PROGRESS_GATE…=` assignments, then a quoted node and script). It logged the
payload's keys, its own `pid` and `ppid`, the process ancestry above it (via `ps`, which a probe may
run and the gate may not), and every environment variable with its value hashed, so a variable that
differs between invocations shows up without its value being recorded. One CLI process was driven
for two turns over `--input-format stream-json`; then two separate `--resume` processes on the same
session id ran one turn each. **Harness: Claude Code 2.1.181**, macOS, model `haiku`, Node 22.22.3.

### OBSERVED — the `Stop` payload carries nothing that identifies the process

Every `Stop`, in all three processes, carried exactly these keys:

```
background_tasks, cwd, hook_event_name, last_assistant_message, permission_mode,
session_crons, session_id, stop_hook_active, transcript_path
```

`session_id` and `transcript_path` were identical across all three processes, as a resume keeps
them. `prompt_id`, recorded on other events earlier in these notes, was on none of these payloads.

### OBSERVED — neither does the hook's environment

Across all seven hook invocations, the only variable whose value differed at all was
`CLAUDE_ENV_FILE`, and it differed by event, not by process: present on `SessionStart`, absent on
`Stop`. `CLAUDE_CODE_SESSION_ID` is the session id, identical across the resumes. `CLAUDE_PID` was
set, but to the pid of the session that launched the probe, on every invocation in all three
processes: the nested CLI did not set it, so here it was inherited, and it names no process the gate
cares about.

### OBSERVED, and NOT RELIABLE — `process.ppid` was the CLI, because the shell got out of the way

```
process  event                 hook ppid  that parent
A        SessionStart startup  20949      claude, started 05:48:23
A        Stop "ONE"            20949      claude, started 05:48:23
A        Stop "TWO"            20949      claude, started 05:48:23
B        SessionStart resume   21958      claude, started 05:48:33
B        Stop "THREE"          21958      claude, started 05:48:33
C        SessionStart resume   22164      claude, started 05:48:36
C        Stop "FOUR"           22164      claude, started 05:48:36
```

On this machine the hook's parent was the CLI itself: stable within a process, different across
processes. That is only because `/bin/sh -c "<assignments> '<node>' '<gate>'"` ran its one simple
command by `exec` and left no shell in between. It is a property of the shell and of how this build
spawns a hook, not a contract. Where a shell does not exec its last command, or a build wraps the
command in anything, the parent is a fresh shell on every invocation. A baseline scoped to that
would read EVERY `Stop` as a new process and suppress every real disappearance, which is the one
failure this gate must not have. And the gate cannot check which case it is in: confirming that its
parent is the long-lived CLI takes `ps` on macOS, and the gate spawns no process.

### OBSERVED — `SessionStart` does say `resume`, on an event the gate does not wire

`SessionStart` fired once per process, before that process's first `Stop`: `source: "startup"` in
the stream-json process and `source: "resume"` in each `--resume` process. That field is
structural, and it does distinguish the case. But it arrives on an event the gate does not wire, so
using it means writing a new hook into users' settings. That changes what the installer writes, and
it was not done here.

### Result

**Nothing in the `Stop` payload or in the hook's environment reliably identifies the CLI process.**
The one block per resume stays, and the gate's documented limitations say so. A heuristic built on
the parent pid would suppress real disappearances wherever its assumption fails, and that is worse
than one false block per resume.

The probe project, its hook, its logs and the transcripts it created were deleted after this was
written. The user's own settings files were neither loaded nor written.

---

## Addendum, dated 2026-09-14 (third): Claude Code drops `describe` from hook entries when it writes a settings file

Both gate installers decide which hooks are theirs by a `describe` prefix. A real user's settings
file held this gate's `Stop` and `SubagentStart` hooks, written by the 0.17.0 installer, whose
builder sets `describe` on both. Neither hook had a `describe` key, and neither did any other hook
in that file. The question here is whether the harness itself removes the key.

**Method.** A throwaway directory with `HOME` and `CLAUDE_CONFIG_DIR` both pointed inside it, so
the user's own settings could be neither read nor written: the real file's SHA-1 was identical
before and after. Two settings files were prepared, a project's `.claude/settings.json` and the
redirected user `settings.json`. Each held two hooks carrying a `describe`, one of them with this
gate's prefix, plus an unknown top-level key. A local directory marketplace was then added with
`claude plugin marketplace add <dir> --scope project`, and again with `--scope user`. That command
writes `extraKnownMarketplaces` into the settings file for its scope, and needs no network and no
model. **Harness: Claude Code 2.1.181**, macOS.

### OBSERVED — every hook entry lost `describe`, and nothing else was dropped

After each run, the file for that scope had gained `extraKnownMarketplaces`. Every hook entry in it
had been rewritten to `type`, `command` and `timeout` only, with `timeout` only where it had been
set. Both `describe` keys were gone, including the one with the gate's prefix. The unknown
top-level key survived in both files. So the harness does not drop unknown keys in general: it
rewrites each hook entry to the fields it knows.

### Result

**A `describe` does not survive the harness writing the file it sits in.** Any Claude Code action
that writes that settings file removes `describe` from every hook. After that, a gate an installer
wrote cannot be told apart from a hand-wiring by its `describe`. For
`install-report-progress-gate.mjs`, that is the case `--adopt` exists for, and it is the common
case, not a rare one. Which other harness actions rewrite a settings file was not enumerated here.

`install-release-notes-gate.mjs` identifies its hooks the same way and has no `--adopt`. Measured
against a copy with `describe` removed, its `--remove` printed "No release-notes gate was installed
… Nothing changed." while the hook was still in the file, and its install refused with "Remove it
by hand first".

The throwaway directory and its marketplace were deleted after this was written.

---

## Addendum, dated 2026-09-14 (fourth): what survives a settings rewrite, and where a turn starts

Written for three changes to the report-progress gate and to both gate installers: recognising an
installer's own hooks without `describe`, keeping one block per turn, and not counting a resume as
a burst of disappearances. Each change stands on one question about the harness, and each question
is answered here before it is built on.

**Method.** Claude Code 2.1.181, macOS, Node 22.22.3. `HOME` and `CLAUDE_CONFIG_DIR` pointed at a
throwaway directory (`<scratch>`), and every `CLAUDE*` variable inherited from the session running
the probe was removed from the environment. Hooks were passed with `--settings <file>
--setting-sources project`, except where the settings file itself was the thing under test. A
throwaway `HOME` is not logged in, so model runs pointed `ANTHROPIC_BASE_URL` at a local scripted
Messages endpoint that logged every request body, with a dummy API key: **the harness was the real
binary and the model was a script.** A probe hook logged every payload it received, and a
stream-json driver held each CLI process open where a test needed one.

### OBSERVED — a settings rewrite keeps `command`, `matcher` and `timeout` exactly, and drops `describe`

The fixture held 15 hook commands spread over `Stop`, `SubagentStart`, `PreToolUse`, `SessionStart`,
`UserPromptSubmit` and `PostToolUse`. They included the exact shapes both gate installers write —
`AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 '<node>' '<gate>.mjs'` and
`AGENT_SKILLS_RELEASE_NOTES_GATE=block bash '<gate>.sh'` — and edge cases: doubled spaces, tabs,
trailing and leading whitespace, empty assignments, embedded `\n`, `\r\n` and `\r`, `${HOME:-/tmp}`,
`$(…)`, backticks, `~` and `#`, backslashes, non-ASCII (NFC and NFD forms of one letter, a
zero-width space, a no-break space, U+2028, a byte-order mark), control characters, an
8000-character command, a duplicated entry, a group with no matcher, matchers `" Skill "` and `""`,
and a fractional timeout.

The file was re-injected before each operation, and every decoded value was compared both with
`===` and as UTF-8 bytes. Operations that rewrote it: `claude plugin marketplace add`, `plugin
install`, `plugin disable`, `plugin enable`, `plugin uninstall -y` and `plugin marketplace remove`,
each at `--scope user`, `project` and `local`; `marketplace add` over a file written with
non-canonical JSON escapes, at all three scopes; an in-session permission grant to each of the
three settings destinations; and, in the real TUI under a pty, `/config` toggles and `/model`'s
"set as default".

**In every write, all 15 commands, all 9 matchers and all 7 timeouts came back byte-identical.**
`async`, `asyncRewake`, `statusMessage`, `once`, `shell`, a prompt-type hook, group order, hook
order, the duplicate and the absent matcher all survived. Dropped every time: `describe` on every
hook, and an unknown key on a group. An unknown top-level key survived. The file's bytes were
re-serialised, but no decoded string changed. `plugin list`, `mcp add` and `mcp remove` did not
change the file at all.

Two further results on unusual entries, each against fresh state. An event key the harness does not
know (`NotAnEvent`), and an event whose value was not an array, were **deleted** by the write. And
several malformed entries — a string timeout, an unknown `type`, a missing command, a numeric
matcher — were written verbatim but left the file one the harness could not read back.

### OBSERVED — `UserPromptSubmit` fires at the start of every turn, and never inside a `Stop`-forced continuation

- **Blocks do not start turns.** A `Stop` hook blocking three times gave four `Stop`s —
  `stop_hook_active` false, true, true, true — and exactly one `UserPromptSubmit`, for the user's
  prompt. The next user message fired `UserPromptSubmit` again, and its `Stop` carried
  `stop_hook_active: false`.
- **Nor does the cap.** A second `Stop` hook blocking until the harness overrode it gave 9 `Stop`s,
  8 continuations and `result: ""`, and the only events in that stretch were `Stop` and
  `MessageDisplay`.
- **Nor does a subagent inside a continuation.** An `Agent` call made in a continuation fired
  `PreToolUse`, `SubagentStart`, `SubagentStop` and `PostToolUse`, and no `UserPromptSubmit`.
- **A background completion after the turn is a turn.** It fired `UserPromptSubmit` with a prompt
  beginning `<task-notification>`. A completion, or user text, arriving while a continuation's model
  call was in flight, or while a blocking or non-blocking `Stop` hook ran, was held until the turn
  ended and then started a new turn with `UserPromptSubmit`.
- **One exception, and it is in the safe direction.** Text or a completion that arrives **during a
  foreground tool call** is folded into the current turn: the transcript records it as a queued
  command appended to the tool result, no `UserPromptSubmit` fires, and the next `Stop` still
  carries `stop_hook_active: true`. It does not start a turn, and it does not end one.
- `/compact` and `/clear` fired neither `UserPromptSubmit` nor `Stop`. The `UserPromptSubmit`
  payload carried `cwd`, `hook_event_name`, `permission_mode`, `prompt`, `session_id` and
  `transcript_path`, and no `prompt_id`.

**A hook that prints nothing adds nothing to the model request.** The first request body was
compared, with ids normalised, against a run with no hooks at all. It was identical for a
`UserPromptSubmit` hook that printed nothing and exited 0, one that printed nothing and exited 1,
one that printed only a newline, and one that printed only `{}`; for a `SessionStart` hook that
printed nothing; and for both together. A control hook emitting `additionalContext` did change it.

### OBSERVED — `SessionStart` says `resume` before the resumed process's first `Stop`, and a fork carries the parent's id

- A CLI process started `sleep 90` in the background. On that session, `-p --resume <id>` fired
  `SessionStart` with `source: "resume"` about 276ms after spawn, then `UserPromptSubmit`, then a
  `Stop` whose `background_tasks` was `[]`: the empty register a resume starts with, confirmed.
  `-p --continue` also gave `source: "resume"`.
- **`-p --resume <id> --fork-session` gave `source: "resume"`, but `SessionStart` carried the
  ORIGINAL session id**, while that process's `UserPromptSubmit`, `Stop` and `SessionEnd` carried the
  new fork id. Anything keyed by `SessionStart`'s `session_id` names the parent on a fork, not the
  session whose `Stop`s follow.
- With stream-json `--resume` and `--continue` and a 3-second delay before the first message,
  `SessionStart` still fired at spawn, 264–279ms in, so it precedes the first `Stop` whenever a
  message arrives. A fresh process gave `source: "startup"`.
- **Inside a running process**, `/compact` after seven turns, with the background task still
  running, fired `PreCompact`, then a `SubagentStop` with no matching `SubagentStart`, then
  `SessionStart` with `source: "compact"` and the same session id, then `PostCompact`, and the next
  `Stop` still listed the task. `/clear` fired `SessionEnd`, then `SessionStart` with
  `source: "clear"` and a new session id, in the same process. So not every `SessionStart` is a new
  process: only `resume` is. The `SessionStart` payload carried `cwd`, `hook_event_name`,
  `session_id`, `source` and `transcript_path`.

### MEASURED — what a hook on each of these events costs

Spawned through `/bin/sh -c` with the payload on stdin, medians of 20: `true` 1.5ms, `node -e ''`
22.3ms, a parse-only Node hook 27.1ms, and `report-progress-gate.mjs` at coverage 2 in block mode
31.7ms on `SessionStart` and 29.9ms on `UserPromptSubmit`, printing 0 bytes. Inside the harness,
spawn to first model request over 8 rounds: 280ms with no hooks, 328ms with a minimal hook on
`SessionStart` and `UserPromptSubmit`, and 330ms with the real gate on both. **About 25ms once per
process for `SessionStart`, and about 22ms once per turn for `UserPromptSubmit`**, notification turns
included.

### NOT TESTED

- A real model: a throwaway `HOME` has no credentials.
- A human-driven interactive session for the turn and resume results. One pty TUI session was used,
  for `/config` and `/model` only.
- Writes made from the `/hooks` menu; auto-compaction (only a manual `/compact` was run).
- **Slash-command and `UserPromptExpansion` prompt turns** — whether `UserPromptSubmit` fires for a
  turn that starts that way.
- Whether one invalid hook in a settings file disables the other hooks in that file at runtime.
- Other harness versions, and Windows.

The throwaway directory, its settings files, the scripted endpoint's logs and every transcript the
runs created were deleted after this was written.

---

## Addendum, dated 2026-09-14 (fifth): which matchers reach `SessionStart` and `UserPromptSubmit`, and the gate's new hooks end to end

Written for the two hooks the report-progress installer now adds: `UserPromptSubmit`, which clears
the gate's record of a spent block, and `SessionStart` on matcher `resume`, which marks a resume.
The fourth addendum settled the events. This one settles the matchers those hooks are written on,
and whether the hooks, as the installer writes them, do their job inside the harness.

**Method.** Claude Code 2.1.181, macOS. The method is the fourth addendum's. `HOME` and
`CLAUDE_CONFIG_DIR` pointed at a throwaway directory (`<scratch>`), with every `CLAUDE*`,
`ANTHROPIC*` and `AGENT_SKILLS_*` variable removed. Settings were passed with `--settings <file>
--setting-sources project`. `ANTHROPIC_BASE_URL` pointed at a local scripted Messages endpoint that
returned the same text to every request and logged every request body, with a dummy API key: the
harness was the real binary, and the model was a script. Probe hooks appended a label to a file and
printed nothing.

### OBSERVED — `SessionStart` matcher `resume` fires on a resume and not on a fresh start; `*` fires on both

One `-p` run, then `-p --resume <id>` on the same session. The settings held `SessionStart` groups on
matcher `""`, `"*"` and `"resume"`, plus one group with no matcher, and `UserPromptSubmit` groups on
matcher `"*"` and with no matcher.

- **Fresh start** (`source: "startup"`): the `""`, `"*"` and no-matcher groups fired, and `"resume"`
  did not.
- **Resume** (`source: "resume"`): all four groups fired.
- **`UserPromptSubmit`**: both groups fired, on both runs.

This settles a doubt `claude-code/README.md` raises: `"*"` on `SessionStart` was never observed
directly before. It is observed here, on these two sources.

### OBSERVED — the gate's hooks, as its installer writes them, end to end

The real installer wrote the gate at coverage 2 in block mode into a throwaway settings file:
`Stop` `"*"`, `UserPromptSubmit` `"*"`, `SessionStart` `"resume"` and `SubagentStart` `"*"`. The
probe hooks were added beside them. Between runs, the gate's temp directory was seeded with the
files an earlier process would leave behind. The scripted reply carried no progress report, so an
armed turn always had something to block. A block was counted from the probe's `Stop` events,
because each block forces a continuation and each continuation ends in another `Stop`.

- **Resume, with a baseline listing a task the old process had running.** With the installer from
  before the `SessionStart` hook existed, `-p --resume <id>` blocked once. With the hook, the
  resumed turn ended without a block, and the note and the baseline were both gone afterwards. The
  same resume, with only the gate's `SessionStart` hook removed from the file, blocked once.
- **`--continue`, with the same seeded baseline.** It blocked once without the hook and not at all
  with it, so matcher `resume` reaches `--continue` too.
- **A spent-block record left from a previous turn, plus an armed marker, then a resumed turn.** With
  the gate's `UserPromptSubmit` hook, the turn blocked once, and the continuation's `Stop` stood down.
  With only that hook removed from the file, the turn did not block, and the record was still on
  disk. The hook fires before the turn's first `Stop`, and is what clears the record.
- **Nothing reached the model from any of these hooks.** No request body in any run contained
  `UserPromptSubmit hook`, `SessionStart hook`, or the gate's own stderr prefix.

### NOT TESTED

- `--fork-session` against the gate's hooks. The fork's session-id behaviour is taken from the
  fourth addendum.
- A real model, or a human-driven interactive session.
- Slash-command turns.
- Two processes holding one session id at the same time.
- A spent block produced by a live subagent dispatch, as opposed to a seeded marker.

The throwaway directories, settings files, endpoint logs and transcripts were deleted after this was
written.

## Addendum: a generated rules file, and the onboard-project check (2026-09-14)

Two live headless runs against the real CLI and a real model, in throwaway directories, to settle
the two mechanisms `onboard-project` depends on. Both were run with the machine's own settings
untouched: the first needed no settings at all, the second used `--settings <temporary file>`.

**1. A rules file with no `paths` frontmatter loads at session start, verbatim.** A throwaway git
repository carrying only `package.json` and
`.claude/rules/skill-routing.md`, whose single routing line named a deliberately unguessable skill.
Asked, with no tools, to list the routing lines it had been given, the model returned that line
exactly, and named the file it came from. This is the whole mechanism `onboard-project` relies on:
no forcing, no hook, no matcher — the file is simply there at the start of every session, at the
same priority as the project CLAUDE.md.

**2. The check's `SessionStart` line arrives as context.** The check hook was armed into a
temporary settings file by `install-check-hook.mjs --settings`, in a repository whose profile was
deliberately stale. Run by hand, the hook emitted one `additionalContext` envelope. Run through
`claude -p --settings <file>`, the model quoted that same line back verbatim when asked what note
it had been given at session start.

Neither run tested the interactive client, a resumed session, or a repository where the check has
nothing to say — that last one is covered by the unit tests, which assert zero bytes on stdout.
