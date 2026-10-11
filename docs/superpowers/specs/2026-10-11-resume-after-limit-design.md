# resume-after-limit — a session stopped by a usage limit continues when the quota returns

- **Status:** implemented in `skills/resume-after-limit` (1.0.0); the notes below record where the build departed from the first draft
- **Date:** 2026-10-11
- **Repository:** crissmoldovan/agent-skills
- **Harness:** Claude Code CLI and the sessions it runs (terminal, VS Code extension, background, `-p`), on
  macOS first and Linux second. Codex, Conductor cloud workspaces and Windows are out of scope.
- **Builds on:** the adapter and hook rules in CONTRIBUTING ("Adapters and hooks"), `adapters/claude-code/`
  ownership helpers, and the capture discipline of `adapters/NOTES.md`.

## 1. The problem, as observed

- **A limited session stops and waits for a person.** On a Claude subscription, a session that reaches the
  five-hour or weekly limit ends its turn with a synthetic assistant message and does nothing more until
  someone types again.
- **People resume by hand, again and again.** On one real machine, three weeks of transcripts held 413
  limit records in 236 transcript files (most of them subagent transcripts). In the 16 main-session
  transcripts, most resumptions were typed messages: "continue", "continue.", "Continue.",
  "continue, please." and "I switched the account. You can continue." Several came before the recorded
  reset time, after the person switched accounts; several came more than five hours after it.
- **The built-in wait does not cover these sessions.** Claude Code's "Continue automatically at usage limit"
  (`autoContinueAtUsageLimit`, v2.1.234+) is documented for interactive sessions with a reset under 24 hours.
  It is not offered for background sessions or `-p` runs, it does not survive the session exiting, it re-arms
  at most twice, and after a long sleep it waits for Enter. Every observed record came from the VS Code
  extension (`entrypoint: "claude-vscode"`), and no automatic continue was found after any of them.
- **Many sessions share one quota.** The same machine had 25 live sessions at once. Resuming all of them the
  moment a window resets would spend the fresh quota in minutes.
- **Accounts change under a session.** A person switches accounts to keep working, so a reset time recorded
  against one account says nothing about the next.

## 2. Goals and non-goals

**Goals**

1. A session stopped by a usage limit continues on its own once quota is available again, if it has not
   been dormant too long.
2. Checking spends no model tokens. The only tokens spent are the resumed turn itself.
3. One switch for all sessions, or a chosen few; status and interval on request.
4. Safe with many sessions, several accounts and config directories, a sleeping laptop and early resets.

**Non-goals**

- Resuming after days. A session dormant past the window stays stopped.
- Bypassing permissions or answering permission prompts. A resumed session runs under its own settings.
- Conductor cloud workspaces, Claude Code on the web, Windows, API-key billing (it has no usage limits).
- Coordinating across machines. Each machine runs its own watcher over its own sessions.

## 3. Decisions

| # | Decision | Reason |
|---|---|---|
| D1 | A scheduler outside any session runs the check: launchd on macOS, a systemd user timer or cron on Linux | A session cannot check for itself while it is stopped; in-session crons spend a model turn per fire and die with the session |
| D2 | The scheduler fires every 5 minutes; the configured interval (default 10, multiples of 5) is enforced by the tick itself | Changing the interval is a config edit, never a reinstall |
| D3 | The limit is read from the session's own transcript: the last main-chain entry carries `quotaLimits` with `status: "rejected"`, `rateLimitType` and `resetsAt` | Observed on real sessions (§6); exact, free, per session; `error: "rate_limit"` alone also marks temporary server throttling |
| D4 | The usage endpoint is a second, optional source, **off by default**, polled at most hourly per account and only while a session of that account waits | Catches early resets and account switches; it is undocumented and rate-limited, so it never becomes the only source |
| D5 | Modes `all`, `selected`, `off`; in `all`, a session can be excluded; in `selected`, a session must be watched | The two scopes asked for, with the per-session override each needs |
| D6 | Resume only if quota returned within 5 hours of the hit (`maxDormancyHours`, default 5) and the tick runs within 30 minutes of that (`lateGraceMinutes`) | Every five-hour reset qualifies; weekly resets do not, unless the account switched; a laptop that slept through does not wake hours later and resume stale work |
| D7 | A live session is resumed through its inbox socket; an exited one through `claude --bg --resume <id> "<prompt>"` | The socket is documented for scripts posting into a session and starts a turn when the session is idle; resuming a live session by id starts a copy |
| D8 | At most three resumes per account per tick, oldest hit first, a short pause between them; a bounce holds the rest until the new reset | Many sessions do not drain a fresh window at once, and a bounce is seen before the next batch |
| D9 | The first release runs in observe mode: it logs what it would do and resumes nothing until switched off | The parser meets real limits on the user's machine before anything acts |
| D10 | The watcher ships off; only the user's own run of the installer, which the skill carries in `scripts/`, arms it | CONTRIBUTING: anything that can speak into a session ships off |
| D11 | No `StopFailure` hook in the first release | The transcript scan finds every limit within one interval, and the hook's payload carries no reset time anyway |
| D12 | The usage probe sends an honest User-Agent and never refreshes a token | Impersonating Claude Code and refreshing from outside are both outside what this pack should do; a 429 or 401 just skips the probe |

## 4. Components

### 4.1 `resume-after-limit` (new pack skill)

The skill holds the instructions and one script, `scripts/resume.mjs` (Node 22+, no dependencies), with
small modules beside it (`detect`, `quota`, `deliver`, `state`). The agent runs the script for every request:

| Request | Command | Effect |
|---|---|---|
| "status" | `resume.mjs status` | mode, interval, dormancy window, observe flag, scheduler installed, last tick, waiting sessions with reset times and next action, whether this session is covered |
| "turn it on" / "on for selected sessions" | `resume.mjs on [all\|selected]` | sets the mode; refuses with the installer command if the scheduler is not installed |
| "turn it off" | `resume.mjs off` | ticks keep firing and exit at once |
| "watch this session" / "stop watching this session" | `resume.mjs watch [id]` / `unwatch [id]` | adds or removes the session (default: `CLAUDE_CODE_SESSION_ID`); in `all` mode `unwatch` excludes it |
| "check every 15 minutes" | `resume.mjs interval 15m` | 5 to 60 minutes, multiples of 5 |
| "only resume within 3 hours" | `resume.mjs dormancy 3h` | 1 to 24 hours |
| "start resuming for real" | `resume.mjs observe off` | leaves observe mode |
| (scheduler) | `resume.mjs tick` | one check, described in §5 |

`references/fit.json` is `requestOnly`: this is a machine utility a person asks for, never something a
repository scan should recommend.

### 4.2 `skills/resume-after-limit/scripts/install-scheduler.mjs`

Run by the user, never by an agent. It is carried by the skill, as `update-agent-skills` carries its hook installer, so an installed copy has it and the scheduler can point at the installed `resume.mjs`. It records the absolute paths of `node`, `claude` and the installed
`resume.mjs`, writes the scheduler entry, and creates the state directory with mode `off` and observe on.

- **macOS:** `~/Library/LaunchAgents/<label>.plist` with `StartInterval` 300, loaded with
  `launchctl bootstrap gui/<uid>`. launchd runs a missed interval on wake.
- **Linux:** a systemd user timer when `systemctl --user` works, otherwise one crontab line marked as owned.
- `--uninstall` removes exactly what it wrote, found by label or marker, and leaves the state directory.

### 4.3 State, machine-wide

Default `~/.claude/resume-after-limit/`, overridable with `RESUME_AFTER_LIMIT_HOME`. Nothing here enters
the repository.

- `config.json` — `mode`, `intervalMinutes` (10), `maxDormancyHours` (5), `lateGraceMinutes` (30),
  `observe` (true), `probe` (`enabled` false, `everyMinutes` 60), `batchPerAccount` (3), `staggerSeconds` (20),
  `maxAttempts` (2), `notify` (true),
  `configDirs` (default: the user's default config directory), `prompt`, and the paths the installer
  recorded.
- `sessions.json` — the `watched` and `excluded` session ids.
- `parked/<sessionId>.json` — one record per limited session (§5.4).
- `accounts.json` — last probe per account: time, result, windows seen.
- `tick.json` — last tick start, end and outcome; `status` reports its age.
- `events.jsonl` — one line per decision, capped at 1 MiB with one rotation.
- `lock` — created exclusively; holds pid and start time; stale when the pid is gone or after 10 minutes.

## 5. The tick

### 5.1 Gate

Exit at once when `mode` is `off`, when the configured interval has not passed since the last tick, or
when another tick holds the lock.

### 5.2 Find limited sessions

For each config directory:

1. List `projects/*/*.jsonl` (main transcripts only; never `subagents/`) modified within
   `maxDormancyHours` plus one interval. Stat only; no reads.
2. Read the last 64 KiB of each and take the last main-chain entry (`isSidechain` false) of type `user` or
   `assistant`.
3. The session is **limited** when that entry is an assistant entry with `isApiErrorMessage: true`,
   `quotaLimits.status: "rejected"`, and a `quotaLimits.rateLimitType`. The record takes `resetsAt`,
   `rateLimitType`, the entry's `timestamp` as `hitAt`, `cwd`, `entrypoint` and `version`.
4. Older transcripts with `Claude AI usage limit reached|<epoch>` give `resetsAt` from the epoch and an
   unknown type. Text-only limits ("You've hit your … · resets 3pm") without `quotaLimits` are recorded as
   `unparsed` and never resumed on the text's clock time.
5. The account is the config directory's `oauthAccount.accountUuid` at first sighting.

A record is created on first sighting and updated on later ones. A session whose last main-chain entry is no
longer the limit entry is **superseded**: someone or something already continued it.

### 5.3 Decide

A record becomes **due** when all of these hold:

- the mode covers it: `all` and not excluded, or `selected` and watched;
- quota is available for its account, meaning one of:
  - `now ≥ resetsAt + 2 minutes` (the margin lets the built-in wait act first in terminal sessions);
  - the latest probe for the account shows the limited window below 100% utilization;
  - the config directory's account differs from the one recorded, and a probe of the new account shows the
    window available, or probing is disabled;
- `availableAt − hitAt ≤ maxDormancyHours`, where `availableAt` is when quota was first known to be
  available;
- `now − availableAt ≤ lateGraceMinutes`;
- `attempts < maxAttempts`.

A record that misses the dormancy or lateness rule becomes **expired** and is never resumed.

Probing (D4, D12) runs only for accounts with a parked record, at most once per `probe.everyMinutes`, and
at once (no more often than every 5 minutes) when an account switch is seen. The token comes from the
macOS Keychain item `Claude Code-credentials` (with the config-directory suffix when one applies) or
`<configDir>/.credentials.json` on Linux. It is read for the request and never stored or logged. An expired
token, a 401 or a 429 skips the probe; the transcript's `resetsAt` still applies.

### 5.4 Act

Due records are taken oldest `hitAt` first, at most `batchPerAccount` per account per tick, `staggerSeconds` apart.

1. Mark the record `delivering` and save it before acting. A crash after this point never delivers twice.
2. Find the live session: a `<configDir>/sessions/<pid>.json` with this `sessionId`, whose pid is alive and
   whose `procStart` matches.
   - **Live and idle:** connect to `messagingSocketPath` and post `prompt`. The receiving session applies
     its own inbound rules: a session that prompts for permissions gets the message; a session that
     bypasses them holds it, and the VS Code extension drops a held message after `dialogExpiry`.
   - **Live and busy:** something already resumed it. Mark it superseded.
   - **Not live:** run `claude --bg --resume <id> "<prompt>"` in the recorded `cwd`, with
     `CLAUDE_CONFIG_DIR` set when the session used one, and no permission flags. Output saying a copy was
     started marks the record `failed` and notifies.
3. Mark `delivered`. On the next tick:
   - new main-chain activity → `confirmed`;
   - a new limit entry → `bounced`: count the attempt, take the new `resetsAt`, and re-park every other
     record on the same account whose old window it shared;
   - no activity after two intervals → `failed`, and notify.

In observe mode, steps 1 to 3 are replaced by an `events.jsonl` line saying what would have happened.

The default `prompt`:

```text
Your usage limit has reset. Continue the task you were working on when the limit stopped you. If it is
already finished, say so in one line and stop.
```

Notifications use `osascript` on macOS and `notify-send` on Linux when present. Otherwise they are written to
`events.jsonl` only.

### 5.5 Record states

`parked → due → delivering → delivered → confirmed | bounced | failed`, and from `parked` also `superseded`,
`expired`, `unparsed`. Records in a final state are deleted after 7 days.

## 6. Evidence

**OBSERVED**, from one real machine's transcripts modified in the three weeks to 2026-10-10, Claude Code v2.1.281 to
v2.1.295 (redacted; ids, paths, branch and time zone masked; `usage` trimmed):

```json
{"isSidechain":false,"type":"assistant","timestamp":"2026-10-10T18:23:07.806Z","message":{"model":"<synthetic>","role":"assistant","stop_reason":"stop_sequence","content":[{"type":"text","text":"You've hit your weekly limit · resets Oct 15 at 2pm (<tz>)"}]},"apiError":"usage_limit_reached","apiErrorParams":{"rate_limit_info":{"status":"rejected","resetsAt":1792062000,"rateLimitType":"seven_day","overageStatus":"rejected","overageDisabledReason":"org_level_disabled","isUsingOverage":false}},"quotaLimits":{"status":"rejected","resetsAt":1792062000,"unifiedRateLimitFallbackAvailable":false,"rateLimitType":"seven_day","overageStatus":"rejected","overageDisabledReason":"org_level_disabled","isUsingOverage":false},"error":"rate_limit","isApiErrorMessage":true,"apiErrorStatus":429,"entrypoint":"claude-vscode","version":"2.1.294"}
```

| Shape across 413 records | Count |
|---|---|
| `rateLimitType: "five_hour"` | 359 |
| `rateLimitType: "seven_day"` | 54 |
| with `apiError: "usage_limit_reached"` | 33 |
| `quotaLimits` key set identical (`status`, `resetsAt`, `rateLimitType`, `overageStatus`, `overageDisabledReason`, `isUsingOverage`, `unifiedRateLimitFallbackAvailable`) | 413 |
| message text `You've hit your session limit · resets <time> (<tz>)` | 359 |
| message text `You've hit your weekly limit · resets <date> at <time> (<tz>)` | 54 |

`apiError` is not reliable (33 of 413); `quotaLimits` is. Live session files on the same machine carried
`kind`, `entrypoint`, `status` (`idle`/`busy`), `peerProtocol` and the socket path.

**DOCUMENTED**, not yet observed by us:

- The inbox socket, its `CLAUDE_CODE_MESSAGING_TOKEN` auth line and the inbound rules:
  https://code.claude.com/docs/en/cross-session-messaging
- `claude --bg --resume <id>` continuing an exited session under the same id (`claude --help`, v2.1.293).
- `autoContinueAtUsageLimit` and its gaps: https://code.claude.com/docs/en/interactive-mode
- The usage endpoint's existence in the binary; third-party samples of its response
  (Claude-Code-Usage-Monitor issue 202); its 429s (anthropics/claude-code issue 30930).

## 7. Captures required before observe mode can be switched off

Status at 1.0.0 (`skills/resume-after-limit/references/evidence.md`): the limit record and the
live-session files are OBSERVED; C1 is OBSERVED for a session's own child and for a bypassing
receiver (held), and NOT OBSERVED for a prompting receiver; C2 to C5 are not yet observed, which is
why the release starts in observe mode with the probe off.

Each lands in `adapters/NOTES.md` tagged OBSERVED, or the skill says it is unverified.

- **C1** The socket's message line format, posted from a non-child process into a throwaway idle session,
  in both a prompting and a bypassing session.
- **C2** `claude --bg --resume <id> "<prompt>"` on an exited session (same id, turn starts) and on a live one
  (copy notice text).
- **C3** One usage-endpoint response and the 429 rate at an hourly cadence with an honest User-Agent.
- **C4** Reading the Keychain item from a launchd job: whether macOS prompts, and what "Always Allow"
  changes.
- **C5** What a terminal session's transcript shows when the built-in wait continues it, so it reads as
  superseded and not as a second resume.

## 8. Tests

Node test runner, fixtures built from the redacted shapes in §6.

- Detection: main versus sidechain, rejected versus allowed, old epoch format, text-only, truncated tail.
- Decision table: each rule in §5.3 alone and together, including account switch with and without a probe.
- State machine: every transition in §5.5, crash after `delivering`, bounce re-parking.
- Lock: concurrent ticks, a stale lock.
- Stagger: ordering and per-account spacing.
- Commands: every row of §4.1, bounds on interval and dormancy, `watch` defaulting to the current session.
- Delivery: socket and `--bg --resume` behind injectable seams; no test touches a real session or token.
- Installer: plist and timer text, ownership markers, uninstall removing only what it wrote.

## 9. Open questions for review

1. Is the default prompt right, and should it be configurable per session?
2. Oldest hit first, or most recently active first?
3. `lateGraceMinutes` 30: is that the right tolerance for a laptop waking up?
4. Sessions that bypass permissions hold socket messages. Notify only, or also offer a per-session opt-in that
   sets `crossSessionInbound: "accept"` for them? (Changing another session's settings is a configuration
   change the user must make, not the watcher.)
5. Is deferring the `StopFailure` hook (D11) acceptable for the first release?
