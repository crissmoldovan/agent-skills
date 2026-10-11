---
name: resume-after-limit
description: "Make Claude Code sessions that a subscription usage limit stopped continue on their own once the quota returns, without spending tokens to check: a scheduler the user installs runs a tick every few minutes that reads each recent transcript's limit record and reset time, resumes a stopped session through its inbox socket when it is still open or with claude --bg --resume when it has exited, staggers resumes per account, and leaves alone any session dormant longer than the window (five hours by default). Turn it on for every session or only watched ones, ask for its status, change the interval. Use when sessions stall at 'You've hit your session limit', when you keep typing continue after a reset, or for: resume after limit, auto-continue, keep working when the quota resets, watch this session, is auto-resume on. It schedules nothing itself; arming the scheduler is the user's own run of its installer. It does not report progress (report-progress) or supervise child agents (agent-lifecycle)."
license: MIT
compatibility: "Claude Code CLI sessions (terminal, VS Code extension, background, -p) on a Claude subscription, macOS (launchd) or Linux (systemd user timer or cron); limit records as observed on Claude Code 2.1.281 to 2.1.295, inbox posts on 2.1.293 (references/evidence.md). Node 22+, nothing else. Reads transcripts, session files and the account; writes only its own state directory. Not for Codex, Windows, cloud sessions or API-key billing."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Bash
---

# Resume after limit

A session on a Claude subscription that reaches its five-hour or weekly limit ends its turn with a
synthetic message — "You've hit your session limit · resets 2pm" — and then waits for a person.
Claude Code's own wait for the reset covers interactive terminal sessions only, and not after the
session exits, not past two re-arms, and not when the reset is a day away. Sessions in the VS Code
extension, background sessions and `-p` runs sit stopped until someone types "continue".

This skill is the someone. A tick, run every five minutes by a scheduler the user installs, reads
the end of each recent transcript. A session whose last entry is a usage limit is parked with the
reset time the transcript recorded. When the reset passes, and only if it passed within the
dormancy window of the limit, the tick puts a continue prompt in front of the session. Checking
reads files and costs no tokens; the resumed turn is the only thing that does.

## When to Use

- The user wants stopped sessions to continue on their own after a usage limit resets.
- The user asks whether auto-resume is on, which sessions are waiting, or what it did lately.
- The user wants it for this session only, for every session, or off; or a different interval or
  dormancy window.

Not for:

- Resuming after days. A weekly limit that resets days later is outside the window and stays
  stopped, unless the account changed and quota is there now.
- Answering permission prompts or changing a session's permissions. A resumed session runs under
  its own settings; a session that bypasses permissions holds the message (Pitfalls).
- Telling a person what a long run is doing (`report-progress`), showing what child agents are doing
  (`agent-lifecycle`), or handing work to another session (`handoff-prompt`).
- Codex, Windows, Claude Code on the web or in Conductor's cloud, and API-key billing, which has no
  usage limits.

## Prerequisites

- Node 22 or newer, and the `claude` CLI, on macOS or Linux.
- The scheduler, installed by the user themselves (step 1). This skill never installs it.

**Complete when:** `node <skill-folder>/scripts/resume.mjs status` prints a `scheduler:` line that
says installed.

## Procedure

Every command is `node <skill-folder>/scripts/resume.mjs <command>`. Run it, then tell the user what
it printed in a sentence or two; `status` can be shown as printed.

1. **Arm the scheduler — the user does this.** If `status` says the scheduler is not installed, give
   the user the command and stop. Do not run it for them: the tick it schedules speaks into their
   sessions, and arming that is their decision.

   ```bash
   node <skill-folder>/scripts/install-scheduler.mjs --install
   ```

   It writes a launchd agent on macOS (a systemd user timer or a marked crontab line on Linux),
   records where `node` and `claude` are, and leaves the watcher **off and in observe mode**. It
   prints its limits; `--remove` takes out exactly what it wrote.

   **Complete when:** `status` says `scheduler: installed (…)`.

2. **Turn it on, for every session or only watched ones.** `on all`, or `on selected` followed by
   `watch` in each session to cover. `watch` with no id covers the session the command runs in
   (from `CLAUDE_CODE_SESSION_ID`). In `all` mode, `unwatch` excludes a session.

   **Complete when:** `status` shows the mode asked for, and `this session …: covered` when the
   user asked for this session.

3. **Leave observe mode only after it has seen a real limit.** A fresh install logs what it *would*
   do — `would-resume` lines in `events.jsonl` and `observed` rows in `status` — and resumes
   nothing. Once the user has seen a correct `observed` row for a real limit, `observe off` makes
   it act. Say plainly which of the two it is in whenever you report status.

   **Complete when:** the user chose, and `status` says so.

4. **Change the cadence or the window when asked.** `interval 15m` (5 to 60, steps of 5; the
   scheduler fires every 5 minutes and the tick skips until the interval has passed, so nothing is
   reinstalled). `dormancy 3h` (1 to 24, default 5). Say what the new window means: a session
   whose quota returns later than that after its limit is never resumed.

   **Complete when:** `status` shows the new values.

5. **Report status when asked.** `status` (or `status --json`) gives the mode, observe flag,
   interval, window, probe, scheduler, the last tick's age and outcome, whether this session is
   covered, the sessions waiting with their limit and reset times, and what finished lately and
   why. A last tick older than twice the interval means the scheduler is not running: say so.

   **Complete when:** the user has the answer to what they asked, including any stale tick.

6. **Turn it off when asked.** `off` stops every tick from acting at once. Removing the scheduler is
   the user's `install-scheduler.mjs --remove`, which also turns it off.

   **Complete when:** `status` says `mode: off`.

### What a tick decides

A session is resumed only when all of these hold ([how it decides](references/how-it-decides.md)):

- its transcript's last main-chain entry is a usage limit with a recorded reset (`quotaLimits`,
  status `rejected`) — limit wording without one is recorded as `unparsed` and never acted on;
- the mode covers it;
- quota is back: the reset passed (plus two minutes, so Claude Code's own wait goes first), or the
  account changed, or the optional usage probe shows the window open;
- quota came back within the dormancy window of the limit, and this tick is no more than 30 minutes
  (or one interval plus five, if longer) late — so a laptop that slept through a reset does not wake hours later and resume stale work;
- nothing newer happened in the session, and it has not used its two attempts.

A live idle session gets the prompt on its inbox socket; a live busy one is left alone; an exited
one is resumed with `claude --bg --resume <id> "<prompt>"` in its own directory. At most three per
account per tick, oldest limit first. A session that hits the limit again is re-parked once, and the
other sessions on that account wait for the new reset.

## Usage Examples

```text
Turn on auto-resume for all my sessions. If a session runs out of quota,
it should pick up again when the limit resets.
```

```text
Only watch this session: resume it after the limit, but leave my other sessions alone.
```

```text
Is auto-resume on? Which sessions are waiting, and when do they reset?
```

```bash
node <skill-folder>/scripts/install-scheduler.mjs --install
node <skill-folder>/scripts/resume.mjs on all
node <skill-folder>/scripts/resume.mjs watch
node <skill-folder>/scripts/resume.mjs interval 10m
node <skill-folder>/scripts/resume.mjs status
node <skill-folder>/scripts/resume.mjs observe off
node <skill-folder>/scripts/resume.mjs off
```

## What it looks like

```text
resume-after-limit
  mode:        on, every session — observe only: logs what it would do, resumes nothing
  checks:      every 10 min · resume only within 5 h of the limit · at most 30 min late
  usage probe: off
  scheduler:   installed (launchd)
  last tick:   3 min ago (ok)
  this session 1a2b3c4d: covered
  waiting:
    5e6f7a8b  parked     five_hour  hit 13:42 · resets 17:00 · web-app
  recent:
    9c0d1e2f  observed   would-resume-via-inbox · 2 h ago · api
    3a4b5c6d  expired    dormant · 1 h ago · docs
```

## Pitfalls

- **Running the installer for the user.** It arms something that speaks into every covered
  session. Give them the command; they run it.
- **Calling it on while it is in observe mode.** Observe mode resumes nothing. Every status report
  says which mode it is in.
- **A session that bypasses permissions.** Claude Code holds an inbox message from outside the
  session when the receiving session bypasses permission prompts, and the VS Code extension drops a
  held message after five minutes. The tick reports it delivered; the session never sees it. Such a
  session is resumed only once it has exited.
- **Treating `error: "rate_limit"` as a usage limit.** Temporary server throttling carries the same
  error. Only a rejected `quotaLimits` (or the older epoch format) counts.
- **Trusting the reset clock time in the message text.** "resets 2pm" is local time with no date.
  The tick uses the epoch the transcript records, and never acts on the text alone.
- **Expecting it to work while the machine sleeps.** Nothing runs then. On wake, a reset more than
  30 minutes past is not resumed.
- **Turning the usage probe on casually.** The endpoint is undocumented and answers 429 readily, and
  on macOS reading the token from the Keychain may prompt. It is off by default; the transcript's
  reset time is enough for five-hour limits.

## Verification

- [ ] The scheduler was installed by the user, and `status` says installed.
- [ ] `status` shows the mode the user asked for and whether it is observe-only.
- [ ] A covered session shows as covered; an excluded or unwatched one does not.
- [ ] The last tick is younger than twice the interval.
- [ ] Before `observe off`, the user saw an `observed` row for a real limit with the right channel.

## Deeper reading

- [How it decides](references/how-it-decides.md) — the record states, the rules, the state files.
- [Evidence](references/evidence.md) — what was observed, what is documented, what is not yet seen.
- [scripts/resume.mjs](scripts/resume.mjs) and [scripts/install-scheduler.mjs](scripts/install-scheduler.mjs).
