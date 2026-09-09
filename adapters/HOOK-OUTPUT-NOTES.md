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
