# How resume-after-limit decides

The rules live in [`scripts/decide.mjs`](../scripts/decide.mjs) as pure functions; the tick in
[`scripts/resume.mjs`](../scripts/resume.mjs) feeds them what it read. Each rule below names the
reason string that `status` and `events.jsonl` show when it applies.

## One tick

1. **Gate.** Mode `off`: exit. Less than the interval since the last tick: exit. Another tick holds
   the lock: exit. Nothing is read before this.
2. **Find.** For each config directory, list the main transcripts
   (`projects/<project>/<session>.jsonl`, never `subagents/`) modified within the window plus the
   late grace and one interval. Read the last 64 KiB of each (up to 1 MiB if no entry is in it)
   and take the last main-chain `user` or `assistant` entry.
3. **Fold.** A limit seen for the first time is a new record, `parked`. The same entry again changes
   nothing. A new limit after a delivery is a bounce: back to `parked`, attempt kept, and the other
   sessions on the account are held until the new reset. Limit wording with no recorded reset is
   `unparsed` and never acted on.
4. **Follow up.** A waiting record whose session has a newer entry is `superseded`: someone, or
   Claude Code's own wait, continued it. A delivered record whose session has a newer entry is
   `confirmed`; with nothing newer after two intervals it is `failed` (`no-activity-after-delivery`).
   A record left `delivering` by a tick that died is `failed` (`interrupted-delivery`) and never
   sent again.
5. **Probe** (only when on): once per period per config directory with a record waiting, sooner
   (every five minutes at most) when the account changed or a limit is newer than the last probe.
6. **Decide** each parked record, and check each record already due again (below).
7. **Act** on due records, oldest limit first, at most `batchPerAccount` per account per tick, for at
   most four minutes; whatever is left stays due for the next tick.
8. **Store** every record; delete finished ones after a week; write `tick.json`.

## The rules for a waiting record

In order; the first that applies wins. The late grace in effect is `lateGraceMinutes` (30) or the
interval plus five minutes, whichever is longer, so a long interval does not expire limits a tick
simply had not reached yet.

| Rule | Result | Reason |
|---|---|---|
| it used `maxAttempts` (2) | failed | `out-of-attempts` |
| more than the window plus the late grace since the limit | expired | `dormant` |
| quota not known to be back | stays parked | — |
| quota came back more than the window after the limit | expired | `reset-beyond-window` |
| this tick is more than the late grace after quota came back | expired | `checked-too-late` |
| the mode does not cover the session | stays parked | — |
| otherwise | due | — |

A record already due is checked again every tick: a hold that appeared sends it back to parked
(`held`), the mode no longer covering it does too (`no-longer-covered`), and a gap longer than the
grace since the tick that last found it due — a machine that slept — expires it (`checked-too-late`).

While a hold from a sibling's bounce is in force on the account the session would run under now —
its own, or the one its config directory switched to — quota is not back, whatever else says so,
and it is never said to be back earlier than that hold. Otherwise it is known to be back at the
earliest of:

- the recorded reset, or a later hold from a sibling's bounce, once two minutes have passed;
- the time a probe of the config directory's current account, taken after the limit was hit, showed
  the limited window under 100%;
- the time the tick first saw the account change, when the probe is off.

## Acting on a due record

| The session | Channel | Effect |
|---|---|---|
| not covered any more | — | back to parked (`no-longer-covered`) |
| live and busy | — | `superseded` (`already-busy`) |
| live, neither idle nor busy | — | left due for the next tick |
| live and idle | inbox | the prompt on its socket, authenticated with its `peerToken` |
| not live | background | `claude --bg --resume <id> "<prompt>"` in its recorded directory and config directory |
| observe mode | — | `observed` (`would-resume-via-<channel>`), nothing sent |

The record is saved as `delivering` before anything is sent, then `delivered` or `failed`. A
notification follows each resume and each failure when `notify` is on.

## The state directory

`~/.claude/resume-after-limit/`, or `RESUME_AFTER_LIMIT_HOME`:

| File | Holds |
|---|---|
| `config.json` | mode, interval, window, late grace, observe, probe, batch, stagger, attempts, notify, config directories, prompt, recorded paths |
| `sessions.json` | watched and excluded session ids |
| `parked/<session>.json` | one record per limited session, with its last 20 state changes |
| `accounts.json` | the last probe per config directory and account, and holds from bounces |
| `tick.json` | the last tick's start, end, outcome and counts |
| `events.jsonl` | one line per decision, rotated once at 1 MiB |
| `lock` | the running tick's pid; taken over when that pid is gone, or after an hour |
| `scheduler.log` | what the scheduler's runs printed |

Nothing in it is a credential: the probe reads the token for its one request and keeps nothing.
