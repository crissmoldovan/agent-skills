# Evidence: what resume-after-limit relies on, and how sure it is

Every behaviour the scripts depend on is tagged here, the way the pack's adapter notes tag
everything:

- **OBSERVED**: seen on a real machine by the people who built this, with the version named.
- **DOCUMENTED**: stated by Claude Code's documentation, its `--help`, or text in its own binary,
  but not yet watched happening here.
- **NOT OBSERVED**: assumed by the design and not yet checked. The skill ships in observe mode
  until these are checked on the user's own machine.

## The limit record — OBSERVED

Read from real Claude Code transcripts on macOS, written by **Claude Code 2.1.281 to 2.1.295**
through the VS Code extension (`entrypoint: "claude-vscode"`). Ids, paths, branch and time zone are
replaced; `usage` is trimmed.

```json
{"isSidechain":false,"type":"assistant","timestamp":"2026-10-10T18:23:07.806Z","message":{"model":"<synthetic>","role":"assistant","stop_reason":"stop_sequence","content":[{"type":"text","text":"You've hit your weekly limit · resets Oct 15 at 2pm (<zone>)"}]},"apiError":"usage_limit_reached","apiErrorParams":{"rate_limit_info":{"status":"rejected","resetsAt":1792062000,"rateLimitType":"seven_day","overageStatus":"rejected","overageDisabledReason":"org_level_disabled","isUsingOverage":false}},"quotaLimits":{"status":"rejected","resetsAt":1792062000,"unifiedRateLimitFallbackAvailable":false,"rateLimitType":"seven_day","overageStatus":"rejected","overageDisabledReason":"org_level_disabled","isUsingOverage":false},"error":"rate_limit","isApiErrorMessage":true,"apiErrorStatus":429,"entrypoint":"claude-vscode","version":"2.1.294"}
```

What held across every record read:

| Field | Seen |
|---|---|
| `isApiErrorMessage` | always `true` |
| `quotaLimits` | always present, with the same seven keys, `status: "rejected"` |
| `quotaLimits.rateLimitType` | `five_hour` or `seven_day` |
| `quotaLimits.resetsAt` | epoch **seconds** |
| `error` | always `"rate_limit"`; also used for server throttling (below), so not enough alone |
| `apiError: "usage_limit_reached"` | only sometimes; not relied on |
| message text | `You've hit your session limit · resets <time> (<zone>)`, `You've hit your weekly limit · resets <date> at <time> (<zone>)` |
| subagent transcripts | carry the same record with `isSidechain: true`; ignored, the main session is what resumes |

What came after them: a typed "continue" (or "continue." and the like), sometimes before the
recorded reset after the person switched accounts, sometimes hours after it. No automatic continue
was found after any of them.

**DOCUMENTED elsewhere, not seen here:** a server throttle logged as `"error":"rate_limit"` with
`apiErrorStatus: 429` and the text "Server is temporarily limiting requests (not your usage limit)"
(anthropics/claude-code issue 64030), and the older text `Claude AI usage limit reached|<epoch>`
from Claude Code 1.0.x, which `detect.mjs` still reads.

## Live sessions — OBSERVED

`<configDir>/sessions/<pid>.json` on Claude Code 2.1.289 to 2.1.295 (macOS) and 2.1.293 (Linux)
carries `pid`, `sessionId`, `cwd`, `kind`, `entrypoint`, `status` (`idle` or `busy`),
`peerProtocol`, `messagingSocketPath` and `procStart`. Beside it, `<pid>.<64 hex>.key` holds
`{ peerToken, procStart, pidDomain }`. On Linux, `procStart` equals field 22 of `/proc/<pid>/stat`
(observed on 2.1.293), which is how `detect.mjs` refuses a reused pid.

## The inbox socket — partly OBSERVED

Claude Code documents the per-session inbox for "a script or hook to post into a session"
(https://code.claude.com/docs/en/cross-session-messaging): an idle session starts a new turn when a
message arrives, a session that prompts for permissions takes messages, and one that bypasses them
holds them; the VS Code extension cannot show the approval dialog and drops a held message after
`dialogExpiry`.

The line format is the binary's own debug text (**DOCUMENTED**, 2.1.293):

```text
{"type":"auth","token":"<token>"}
{"type":"user","message":{"role":"user","content":"hello"}}
```

**OBSERVED** on Linux, Claude Code 2.1.293, receiving session run through the Agent SDK in
bypass-permissions mode:

| Sender | Auth line | Delivered |
|---|---|---|
| the session's own child process | `CLAUDE_CODE_MESSAGING_TOKEN` | yes, shown to the session as a message from another session |
| a detached process | none | not within the observation |
| a detached process | `peerToken` from the `.key` file | not within the observation |

The two that did not arrive match the documented hold for a session that bypasses permissions.
**NOT OBSERVED:** a post from a detached process into a session that prompts for permissions — the
case `deliver.mjs` relies on for an open VS Code or terminal session.

## Resuming an exited session — DOCUMENTED

`claude --help` (2.1.289 on macOS, 2.1.293 on Linux): `--bg` "with --resume <session-id>,
continues that session in the background under the same ID, or starts a copy and says so when the
session is already running". **NOT OBSERVED:** the exact output text, which `deliver.mjs` reads
only for the word "copy".

## Claude Code's own wait — DOCUMENTED

`autoContinueAtUsageLimit`, from 2.1.234, on by default for interactive sessions signed in with a
claude.ai subscription; not offered for background sessions or `-p` runs; not started on its own
when the reset is more than 24 hours away; not restored on resume; at most two re-arms
(https://code.claude.com/docs/en/interactive-mode). **NOT OBSERVED:** what a transcript shows when
it continues a session. The tick waits two minutes past the reset and treats any new entry as
"superseded", so the two do not both resume a session.

## The usage endpoint — DOCUMENTED by others, NOT OBSERVED here

`GET https://api.anthropic.com/api/oauth/usage` with the OAuth access token and
`anthropic-beta: oauth-2025-04-20` returns `five_hour`, `seven_day`, `seven_day_opus`,
`seven_day_sonnet`, each `{ utilization, resets_at }` with an ISO time (Claude-Code-Usage-Monitor
issue 202). It is undocumented, answers 429 readily (anthropics/claude-code issue 30930), and
Claude Code's own `/usage` falls back to last-known values when it does
(https://code.claude.com/docs/en/costs). The Keychain service name, and its suffix for a
non-default config directory, are read from the binary. Whether macOS prompts when a launchd job
reads the Keychain item is not known. Hence the probe is **off by default**.
