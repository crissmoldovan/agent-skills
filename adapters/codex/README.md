# Codex adapter — UNVERIFIED

**This adapter has never run against a real Codex session.** Codex is not
installed on the machine that built it — checked plainly, not skipped (see
[`../NOTES.md`](../NOTES.md), Step 4: no `codex` binary on `PATH`, no Homebrew
formula or cask, no global npm package, no `pip3` package; the only
`*codex*` hits were an unrelated Claude Code marketplace plugin named
`codex` and an unrelated personal app's `~/.codex/` data directory). Nothing
below was captured from a payload. Read this file's confidence level as
"built from the vendor's own published documentation," never as "tested,"
and treat every field mapping as something to re-verify against a real
payload before trusting it in production. An adapter labelled tested when it
was not is worse than one honestly labelled untested — this project has
already shipped one false "verified" claim and paid for it. This one does
not repeat that.

## Authoring floors (Plan 7) — deliberately NOT wired here

The Claude Code adapter gained two opt-in "authoring floors" in a later task
(Plan 7 / spec §11.2–11.3): on a real, observed harness, a hook can now print
JSON back to stdout and have text delivered into the same session —
`PostToolUse` prompts about a consequence-bearing tool call, `PreCompact`
prompts for a flush before context is destroyed. **This adapter does not do
either, on purpose, not as an oversight left for later.**

Reasons, plainly, in order of how much each one alone would already be
disqualifying:

1. **The whole basis for the Claude Code floors is a probe that actually ran
   against a real harness** — [`../HOOK-OUTPUT-NOTES.md`](../HOOK-OUTPUT-NOTES.md),
   which planted tokens in real hook output and read the real transcript to
   confirm what reached the model, for which event, in which shape, and
   found that `PreCompact` *rejects* the shape that works for `PostToolUse`
   (`hookSpecificOutput` fails that event's own schema validation outright —
   the probe captured the literal error). Nothing equivalent exists for
   Codex. There is no probe, because there is no Codex install to probe with
   (see the top of this file, and `../NOTES.md` Step 4). Building the same
   two-mechanism split here would mean guessing at a THIRD thing — Codex's
   actual output-side behaviour per event — on top of the two guesses this
   file already discloses (field names, and the wildcard matcher).

2. **This is the one place in this adapter where "unverified" stops being a
   merely academic caveat.** Everything else this file documents (event
   names, field guesses) degrades safely if wrong — a wrong guess means a
   field silently comes out empty, per `journal-hook.mjs`'s own `str()`
   helper, never a crash and never a change in what the observed tool call
   does. Hook *output* is different in kind, and this file already says so
   under "The three rules" below: Codex's own documentation states plainly
   that exit code 2 (with stderr) on `PreToolUse` blocks the tool call, the
   same on `PermissionRequest` denies it, and `decision:"block"` on `Stop`/
   `SubagentStop` forces continuation. An untested guess at Codex's
   `PostToolUse`/`PreCompact` output shape is not "the floor doesn't
   arrive" the way a wrong field name is "the field is absent" — it is
   guessing at the boundary of a channel this same documentation says can
   change whether code runs. Rule 1 ("never fail the call it observes") is
   this adapter's cardinal rule, ranked above every feature in the task that
   added it — guessing here is exactly the kind of guess rule 1 forbids.

3. **`journal-hook.sh` already made a deliberate, load-bearing decision that
   floors would directly reverse.** It redirects the Node subprocess's
   stdout to `/dev/null` specifically so nothing this adapter does could
   ever be read by Codex as hook output of any kind — see "The three rules"
   below, "a sharper version of this rule applies to Codex specifically".
   Wiring floors here means reversing that decision on the one harness where
   getting it wrong was judged too risky to attempt even for the
   *observation* side's output. Nothing about that risk assessment has
   changed; if anything, floors make the case for it stronger, not weaker.

**What would actually close this gap:** the same thing that closed it for
Claude Code — a real Codex install, a probe script that plants tokens in
`PostToolUse`/`PreCompact` output and reads back what the model actually
received, written up the way `HOOK-OUTPUT-NOTES.md` was. Until that exists,
this adapter's Codex support stays exactly where Task 1 left it: observations
only, one direction, never speaking back into a session.

## What is documented, and where it came from

Read 2026-09-08 from OpenAI's own Codex documentation:
[developers.openai.com/codex/hooks](https://developers.openai.com/codex/hooks)
(mirrored at
[learn.chatgpt.com/docs/hooks](https://learn.chatgpt.com/docs/hooks)) and
[developers.openai.com/codex/config-reference](https://developers.openai.com/codex/config-reference) /
[config-advanced](https://developers.openai.com/codex/config-advanced).

Codex documents **two separate extensibility surfaces**, and conflating them
would misrepresent both:

1. **`notify`** — the older, simpler mechanism. A single external program,
   configured in `~/.codex/config.toml` (`notify = ["python3", "/path/to/notify.py"]`),
   invoked with the event **as a single JSON string passed as a command-line
   argument — not on stdin**. Documented to fire for exactly one event,
   `agent-turn-complete`, with fields including `type`, `thread-id`,
   `turn-id`, `cwd`, `input-messages`, `last-assistant-message` (note the
   hyphenated keys — a different naming convention from the hooks system
   below). This is real, stable, and long-documented, but it covers one
   event this adapter would otherwise get a strictly richer version of from
   `Stop` in the system below — see "Why `notify` is not wired separately."
2. **`hooks`** (`~/.codex/hooks.json`, `<repo>/.codex/hooks.json`, or an
   inline `[hooks]` table in either `config.toml`) — a considerably newer,
   far more elaborate system. Its documented event names — `SessionStart`,
   `SessionEnd`, `PreToolUse`, `PostToolUse`, `PermissionRequest`,
   `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStart`,
   `SubagentStop`, `Stop`, `Interrupt` — and its stdin-JSON-in,
   stdout-JSON-out shape are close enough to Claude Code's own hook system
   that the naming looks deliberately convergent, not coincidental. **This
   adapter is built against this second surface.**

This near-identity between the two harnesses' hook contracts is itself the
most surprising finding of this task, and it deserves the same scrutiny as
any other claim here: it comes from prose documentation pages, summarised
through an automated fetch, not from reading Codex's own source or running
it. Two separate fetches of adjacent doc pages returned an inconsistent
statement of whether a hook's `timeout` field is seconds or milliseconds —
a small thing, but a concrete instance of this documentation not always
being internally consistent, and a reason to treat everything below as a
strong lead, not a spec.

### What is NOT claimed

- **No field-level JSON example was found for most events.** Codex's docs
  explicitly name `tool_input` and `tool_use_id` for `PreToolUse`, and
  `tool_response` for `PostToolUse` — those four field names are
  **documented**, not guessed. Everything else this adapter reads
  (`agent_id`, `agent_type`, `reason`, `trigger`, `last_assistant_message`)
  is **carried over from Claude Code's own naming by analogy**, because nothing
  fetched for this adapter spelled out Codex's actual per-event payload down
  to that level. See the per-case comments in `journal-hook.mjs` for exactly
  which fields fall into which bucket.
- **No confirmation the wildcard matcher (`"*"`) behaves as documented.**
  The docs state a `matcher` of `"*"` or an omitted `matcher` both mean
  "match everything." Untested here, same caveat the Claude Code adapter's
  own README already carries for its `"*"` matcher, and for the same reason:
  nobody has run either against a real session from this environment.
- **No confirmation of the hook-command env story.** Codex's documented hook
  handler fields are `type`, `command`, `timeout`, `statusMessage`, `async`,
  `additionalContextLimit` — no separate env block, matching Claude Code.
  This adapter assumes (untested) that prefixing environment variables
  inline in the `command` string, the same technique the Claude Code adapter
  uses, works the same way here.

## Files

- `journal-hook.sh` — the script Codex's `command` hook type would invoke.
  POSIX `sh`, no bash-isms. Structurally identical to
  [`../claude-code/journal-hook.sh`](../claude-code/journal-hook.sh), same
  reasoning throughout, adjusted comments to say what is documented versus
  assumed for Codex specifically.
- `journal-hook.mjs` — the mapping logic (event → observation kind and
  fields), run by `journal-hook.sh` as a Node subprocess, for the identical
  reason the Claude Code adapter runs one: `tool_input`/`tool_response`
  arrive as arbitrarily nested JSON, and Node is not a new dependency —
  `agent-journal` itself already requires it.
- `hooks-fragment.json` — the `"hooks"` object to drop into
  `~/.codex/hooks.json` (or a project-scoped `<repo>/.codex/hooks.json`), or
  merge into an existing one.

## Installing it — UNVERIFIED, follow at your own risk and re-check each step

1. Build the package once (`pnpm build` from `packages/agent-journal`), or
   plan to use `AGENT_JOURNAL_CMD` below to run it straight from source.
2. Copy `hooks-fragment.json`'s `"hooks"` object into `~/.codex/hooks.json`
   (create the file if it does not exist), or into a project-scoped
   `<repo>/.codex/hooks.json`, or the equivalent `[hooks]` table in either
   `config.toml`. Merge with any existing `"hooks"` key rather than
   replacing it.
3. In every `command` string, replace:
   - `REPLACE_ME_WORKSPACE` with your `agent-journal` workspace id.
   - `/absolute/path/to/agent-skills` with this repo's actual absolute path
     on the machine running Codex.
4. Make sure `agent-journal` is resolvable — either put it on `PATH`, or set
   `AGENT_JOURNAL_CMD` inside the same `command` string.
5. **A step Claude Code's adapter does not need: trust the hooks.** Codex's
   own documentation describes a trust model where non-managed hooks (this
   one) require explicit review before they run at all — via the `/hooks`
   command inside an interactive Codex session, or by passing
   `--dangerously-bypass-hook-trust` (a flag whose name is a legitimate
   warning, not decoration — it is documented as skipping the persistent
   trust check entirely, and should not be reached for as a convenience).
   Until a hook is trusted, it is documented to simply not run — which would
   look identical to a silently misconfigured workspace unless you know to
   check this specifically.
6. Run a real Codex session, then check:
   ```
   AGENT_JOURNAL_ROOT=<your root> agent-journal coverage --workspace <id>
   ```
   Coverage reporting a session with events is the confirmation that the
   hook actually fired and actually wrote something. If it reports nothing,
   the trust step above is the first thing to check, ahead of anything in
   this adapter's own code.

## Configuration (environment variables)

Same variables, same meanings, as
[`../claude-code/README.md`](../claude-code/README.md)'s table — this
adapter reuses the identical scheme rather than inventing a Codex-specific
one, since nothing documented about Codex's `command` hook type requires a
different approach:

| Variable | Read by | Meaning |
| --- | --- | --- |
| `AGENT_JOURNAL_WORKSPACE` | `journal-hook.sh` | Required. Unset or blank: the hook does nothing and exits 0. |
| `AGENT_JOURNAL_CMD` | `journal-hook.mjs` | The command that runs `agent-journal`, split on whitespace. Defaults to `agent-journal`. In a dev checkout: `AGENT_JOURNAL_CMD="node /abs/path/to/packages/agent-journal/dist/bin.js"`. |
| `AGENT_JOURNAL_NODE` | `journal-hook.sh` | Overrides the `node` used to run `journal-hook.mjs`. Defaults to `node`. |
| `AGENT_JOURNAL_ROOT`, `AGENT_JOURNAL_HARNESS` | `agent-journal` (the CLI) | Passed straight through the environment. Set `AGENT_JOURNAL_HARNESS=codex` so the envelope's own `harness` field matches the `session_start` observation's `data.harness`, which this adapter always hardcodes to `"codex"` regardless. |
| `AGENT_JOURNAL_SESSION`, `AGENT_JOURNAL_AGENT` | `agent-journal` (the CLI) | **Set by `journal-hook.mjs` itself** from the payload's own `session_id` (documented on every event) and, for `SubagentStart`/`SubagentStop` only, an assumed `agent_id` field — see `journal-hook.mjs`'s comments on that assumption. |

## What this costs — not measured, extrapolated

No timing measurement exists for this adapter — there is no Codex session to
time it against. The Claude Code adapter's own measured cost (68–78ms per
mapped event warm, 168–327ms on the first cold call, five back-to-back
`PreToolUse` calls against the built binary — see that adapter's README for
the full table and the machine it was measured on) is the only real number
either adapter has, and this one does the same two-process work (`journal-hook.sh` spawning
`journal-hook.mjs` spawning `agent-journal observe`), so it is a reasonable
planning estimate — **not a claim about Codex**. Measure it for real on the
machine this actually runs on before treating any number as authoritative.

**A Codex-specific wrinkle worth planning around, not measured either way:**
its own hooks documentation describes `SessionEnd` and `Interrupt` hooks as
subject to a much shorter default timeout than other events — on the order
of a second, with a low cap even when raised — before Codex kills the hook
process outright. If the two-process cost above (or worse, on a slow disk)
exceeds that window for `SessionEnd`, Codex kills this script mid-run. That
still satisfies rule 1 — a killed hook process cannot fail the call it was
observing, because `SessionEnd` has nothing left to fail — but it does mean
`SessionEnd` observations could go missing under load in a way the other
mapped events would not, and only `agent-journal coverage` would show it as
a gap.

## Why it shells out instead of writing JSONL directly

Identical reasoning to
[`../claude-code/README.md`](../claude-code/README.md#why-it-shells-out-instead-of-writing-jsonl-directly):
`agent-journal observe` redacts (`src/redact.ts`) before anything reaches
disk, and `tool_input`/`tool_response` are exactly the fields most likely to
carry a secret. This has not been separately re-verified for Codex payloads
specifically — the redaction path itself is harness-agnostic (it runs on
whatever string this script hands it), so there is no reason to expect a
different result, but "no reason to expect" is not the same claim as
"tested," and this file says which one it is making.

## The three rules, and how each is actually enforced

1. **It never fails the call it observes.** Every exit from
   `journal-hook.sh` is `exit 0`, unconditionally, mirroring the Claude Code
   adapter exactly — including avoiding the same broken sketch
   (`: "${VAR:?}" 2>/dev/null || exit 0`, which ends the shell with its own
   nonzero code before `||` ever runs). Verified live for this file too:
   `packages/agent-journal/test/adapter-codex.test.ts` runs
   `journal-hook.sh` for real, the same discipline the brief requires —
   reading a script is not verifying it.

   **A sharper version of this rule applies to Codex specifically, and did
   not apply the same way to Claude Code.** Codex's own documentation states
   plainly that a hook's *output* can steer the harness: exit code 2 (with
   stderr text) on `PreToolUse` blocks the tool call; the same on
   `PermissionRequest` can deny it; `decision: "block"` on `Stop` or
   `SubagentStop` forces the agent to keep going instead of stopping.
   Claude Code's own in-binary strings describe a comparable output schema,
   but NOTES.md is explicit that side was never tested there either — for
   Codex, the documentation is unambiguous that this is live behaviour, not
   a maybe. This adapter's answer is the same for both: never write
   anything to its own stdout (the Node subprocess's stdout/stderr are
   redirected to `/dev/null` inside `journal-hook.sh`, before that script's
   own unconditional `exit 0`), so there is nothing for Codex to read as a
   decision regardless of which harness is asking. This is enforced by the
   same design as the Claude Code adapter, but it is a materially higher-
   stakes property here: on Codex, getting this wrong would not just add
   noise, it could change whether a tool call runs at all.

2. **It never blocks.** Same bounded timeouts as the Claude Code adapter
   (1.5s stdin read, 3s `agent-journal observe` spawn), tested the same way
   (a FIFO whose writer end is held open and never closed). See "What this
   costs" above for the Codex-specific timeout wrinkle this does not fully
   cover.

3. **It bypasses nothing.** See "Why it shells out" above.

## Events wired

| Codex event | agent-journal kind | Fields sent | Confidence |
| --- | --- | --- | --- |
| `SessionStart` | `session_start` | `harness` (hardcoded `"codex"`), `cwd` | `cwd` and `hook_event_name` are documented common fields. |
| `SessionEnd` | `session_end` | `reason` | `reason`'s field name is assumed by analogy to Claude Code; not confirmed for Codex. |
| `Stop` | `turn_end` | `turn` = `last_assistant_message` (truncated to 4000 chars) | Field name assumed by analogy; `Stop` itself, and its documented ability to force continuation via `decision: "block"`, is confirmed in Codex's own docs. |
| `PreToolUse` | `tool_call` | `tool` = `tool_name`, `input` = JSON of `tool_input` (truncated), `callId` = `tool_use_id` | `tool_input` and `tool_use_id` are **documented** Codex fields. `tool_name` is assumed (used as the matcher key in Codex's own examples, so likely but not spelled out as a payload field). |
| `PostToolUse` | `tool_result` | `tool`, `callId`, `summary` = JSON of `tool_response` (truncated) | `tool_response` is a **documented** Codex field. Generic JSON rendering, not a per-tool extraction — doubly justified here, since no Codex `tool_response` shape for any tool was ever captured. |
| `SubagentStart` | `subagent_start` | `agentId` = `agent_id`, `purpose` = `agent_type` | Both field names assumed by analogy; `SubagentStart` itself is a documented Codex event name. |
| `SubagentStop` | `subagent_stop` | `agentId` = `agent_id`, `status` = fixed literal `"stopped"` | Same assumption on field names. `status` is not a guess at success/failure, for the same reason the Claude Code adapter does not guess: nothing documented distinguishes the two. |
| `PostCompact` | `compact` | `reason` = `trigger` | `PreCompact`/`PostCompact` and `trigger` values (`manual`/`auto`) are documented as matcher values for these events, which is weaker evidence than a confirmed payload field but the best available. |

`AGENT_JOURNAL_SESSION` is set on every mapped call from the payload's own
`session_id`; `AGENT_JOURNAL_AGENT` is additionally set, only for
`SubagentStart`/`SubagentStop`, from the assumed `agent_id`.

**Not wired: `--seq`.** Same reasoning as the Claude Code adapter: this
script is stateless and one-shot per invocation, with no safe place to keep
a persistent per-session counter without inventing a new failure mode.

## Events NOT wired — and why, plainly

- **`heartbeat` — never wired, structurally, not an oversight.** Codex's
  documented event list, like Claude Code's observed one, contains nothing
  that fires on a timer or on idle — every event exists because the agent
  acted or a phase changed. `Interrupt` is user-driven (a cutoff), not a
  clock. See [`../NOTES.md`](../NOTES.md)'s "structurally unavailable"
  section, which this adapter treats as applying to Codex too, on the same
  mechanical grounds, not because Codex was checked separately.

- **`PermissionRequest` — a DIFFERENT and more serious reason than Claude
  Code's.** Claude Code's own README leaves this unwired because it was
  never confirmed to fire at all. Codex's documentation confirms
  `PermissionRequest` exists and describes its hook output as actively
  choosing `allow`/`deny` for the underlying request — this is not an
  evidentiary gap, it is a live steering mechanism this adapter has no way
  to test safely from an environment with no Codex to test it in. Wiring it
  unverified would risk the single thing rule 1 exists to prevent: an
  observer becoming the thing that denies the call. Left unwired as a
  **safety decision**, not a research gap to close later by finding more
  documentation — closing it means testing it against a real Codex install.

- **`UserPromptSubmit` — documented, and left unmapped for the same reason
  Claude Code's is.** It matches none of the fourteen observation kinds —
  it fires at the start of a turn, and `turn_end` is defined as the end of
  one. Both adapters independently reach the same conclusion for the same
  event name, which is itself worth noting as a genuine cross-harness
  parallel.

- **`Interrupt` — a Codex-only event with no Claude Code analogue.** Fires
  on a user interruption mid-turn, documented with a 1–3 second timeout cap
  and no ability to actually prevent the interruption. None of the fourteen
  observation kinds fit a mid-turn cutoff, and no kind was invented for it.

- **`PreCompact` alone does not record a `compact`.** Mirrors the Claude
  Code adapter's rule, but on weaker footing: Claude Code's NOTES.md
  *observed* a real case of `PreCompact` firing with no `PostCompact`
  following (not enough conversation to compact). Nothing here confirms
  Codex behaves the same way — this is an **assumed parallel**, kept because
  the spec has one `compact` kind, not a start/end pair, and the wrong way
  to be wrong here is recording a compaction that never completed.

- **A distinct tool-failure event** — Codex's own hooks documentation, unlike
  Claude Code's in-binary strings, does not name one at all. `PostToolUse`
  appears to be the only tool-completion hook; whatever a failed call looks
  like presumably arrives inside `tool_response`, which this adapter's
  generic `summarize()` already forwards without needing a separate case.

## Known gaps, stated rather than hidden

- **Every field mapping beyond `session_id`/`cwd`/`hook_event_name`,
  `tool_input`/`tool_use_id`/`tool_response` is inferred, not confirmed.**
  See the per-case comments in `journal-hook.mjs`. A wrong field name
  degrades to "that field is absent" (the `str()` helper returns `undefined`
  for anything not a string, including a missing key), never a crash — but
  "does not crash" is a much weaker claim than "is correct," and this
  README does not conflate the two.
- **The wildcard `matcher: "*"` in `hooks-fragment.json`** follows Codex's
  own documented convention for "match everything," untested here for the
  same reason everything else is untested.
- **The trust-review step is the most likely single point of silent
  failure** for anyone installing this for real — an untrusted hook is
  documented to simply not run, which looks identical to a workspace
  misconfiguration from the coverage report's point of view. Check trust
  status first if `agent-journal coverage` shows nothing after a real
  session.
- **This adapter has not been exercised end-to-end even once.** Everything
  above is the result of reading documentation and writing defensively
  against the possibility that the documentation is wrong or incomplete —
  it is not a substitute for someone with a real Codex install running it
  and reporting back what actually happened, the way Task 1 did for Claude
  Code.
