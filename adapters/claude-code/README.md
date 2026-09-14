# Claude Code adapter

Translates Claude Code's own hook payloads into `agent-journal observe` calls,
and — opt-in only, see "Authoring floors" below — into `agent-journal floor`
prompts injected back into the same session. This is the thing that actually
feeds the observation plane — Tasks 2–4 built `observe`; this is the only
piece that calls it from a real Claude Code session. Task 3 (Plan 7) is what
makes it also *speak* into a session: until then, every hook here only
observed and wrote.

This directory also carries **two further, unrelated hooks** — the
progress-report gate and the release-notes gate — which share none of the
journal's code, configuration, or installation, and none of each other's.
Everything from here to "Authoring floors" is about the journal hook only; each
gate has its own section below, and nothing about either is on by default.

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
- `report-progress-gate.mjs` — the progress-report gate: a `Stop` hook that
  refuses a turn's final message when that turn started a subagent, invoked a
  listed external-agent skill, or changed the harness's own list of background
  work — and the message carries no progress report. Plus the `SubagentStart`
  marker writer that arms the first of those, and the `UserPromptSubmit` hook that
  clears its record of a spent block when a turn starts. Nothing to do with the journal —
  separate install, separate flag, separate settings entries. See "The
  progress-report gate" below.
- `install-report-progress-gate.mjs` — writes and removes those hooks in a
  settings file. `--mode observe|block`, `--coverage 1|2`, `--skills <names>`, `--remove`,
  `--adopt`, atomic tmp+rename, removal that scans every event key rather than only the
  ones this version writes, and a refusal to touch a hook that runs the gate but is not
  its own.
- `release-notes-gate.sh` — the release-notes gate: a `PreToolUse` hook on `Bash`
  that refuses a publish, a `gh`/`glab release create`, a release-looking `git
  tag`, or a version-bump commit when the version being released is not mentioned
  in any file that records releases. Bash rather than Node because every decision
  it makes is over a command string and a few files, and `jq` — which it needs for
  the payload and for `package.json` — is already the dependency that gates it.
  Nothing to do with the journal or with the progress gate: separate install,
  separate flag, separate settings entry. See "The release-notes gate" below.
- `install-release-notes-gate.mjs` — writes and removes that one hook in a
  settings file. Same contract as the installer above: `--mode observe|block`,
  `--remove`, `--adopt`, atomic tmp+rename, removal that scans every event key, and a
  refusal to touch a hook that runs the gate but is not its own.
- `hook-ownership.mjs` — how both installers tell their own hooks from anybody
  else's, now that Claude Code drops `describe` whenever it writes a settings file:
  a hook is an installer's own only when its whole command is exactly a shape that
  installer has released — the gate's own assignments, its interpreter and the gate
  path, quoted as it quoted them, and nothing else. Another hook that runs the gate is
  a hand-wiring for `--adopt`; one that only names the gate file is nobody's; one
  where it cannot tell whether the gate runs is named and never taken. A `describe`
  somebody else wrote vetoes ownership. No hook runs
  it; the two installers import it.

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

## The progress-report gate (separate hook, off by default)

The mechanical half of the `report-progress` skill. A skill is instructions, and
instructions get skipped silently on exactly the turns where the user has stopped
reading and four children are still running. This is the half that is not
instructions.

```sh
# try it without risking a turn: reports what it would have refused, blocks nothing.
# this is what `--mode` defaults to when it is left off.
node adapters/claude-code/install-report-progress-gate.mjs --mode observe

# arm it
node adapters/claude-code/install-report-progress-gate.mjs --mode block

# widen what arms it — read "The coverage level" below before you do
node adapters/claude-code/install-report-progress-gate.mjs --mode block --coverage 2

# …and, at coverage 2, treat named skills as external agents (exact names, no default)
node adapters/claude-code/install-report-progress-gate.mjs --mode block --coverage 2 --skills codex

# take it back out; nothing is left behind
node adapters/claude-code/install-report-progress-gate.mjs --remove

# …including a hand-wired hook that runs the gate in a shape this installer never writes
node adapters/claude-code/install-report-progress-gate.mjs --remove --adopt
```

**Updating keeps the level and the mode you have.** Re-running the installer with no
`--coverage` — which is how you pick up a new version of the pack — keeps the level of
the gate already in that settings file, and says so: `Kept coverage 1 (already installed
in this file)`. With no `--mode` it keeps that gate's mode the same way, `off` included:
`Kept mode block (already installed in this file)`. Only `--coverage` and `--mode` change
them, and then the output names the change: `Set coverage 2 (was 1)`, `Set mode observe
(was block)`. A new install with no `--coverage` gets coverage 1, and with no `--mode`,
observe.

It writes three entries at coverage 1 and four at coverage 2 into
`~/.claude/settings.json` (or the `--settings` file you name). At **coverage 2**
they are these, plus a fifth only if you named skills:

- **`SubagentStart`, matcher `*`** — arms a per-session marker when a subagent is
  started: foreground or backgrounded, of any `agent_type`. This replaced
  `PostToolUse` matcher `Agent`, which saw only `Agent`-tool dispatches and only
  in the foreground sense. Two `agent_type` values are excluded on purpose:
  `workflow-subagent`, because a workflow's children start asynchronously at
  times no turn owns and the register below already covers workflow work at a
  turn-anchored point; and `""`, which is what internal compaction
  summarisation fires as (`../NOTES.md`) and which would otherwise demand a
  progress report on the turn after a `/compact`.
- **`Stop`, matcher `*`** — reads the marker **and** the harness's own list of
  background work, which arrives in that same payload as `background_tasks[]`.
  Returns `{"decision":"block","reason":…}` at exit 0 when the final message
  carries no report. Nothing armed, no gate: a turn that delegated nothing and
  changed nothing ends exactly as it would with the hook absent.
- **`UserPromptSubmit`, matcher `*`** — clears the `Stop` half's record of a block it
  spent in the previous turn, so each turn can block once and no more. It arms
  nothing and prints nothing. Written at both levels; see "One block per turn" below.
- **`SessionStart`, matcher `resume`** — notes that the session was resumed in a
  fresh CLI process, whose background list starts empty, so the next `Stop` does
  not read the old process's tasks as gone. It arms nothing and prints nothing.
  Coverage 2 only; see "A resume is handled" below.
- **`PostToolUse`, matcher `Skill`** — written **only** when `--skills` named
  something. Arms on an exact skill name. With no list, this hook does not exist
  at all, so the default install gains no invocation on the `Skill` path.

At **coverage 1** the arming half is **`PostToolUse`, matcher `Agent`** —
v0.16.1's arming half exactly — beside `Stop` and `UserPromptSubmit`, because an
`Agent`-tool dispatch is the one signal the gate reads at that level. There is no `SubagentStart` hook, no `SessionStart` hook and no `Skill` hook
there, and `--skills` at coverage 1 is refused rather than written: the gate at
that level never reads a skill list. Moving between levels replaces the hooks
rather than adding to them, and removal scans **every** event key in your settings
for hooks this installer wrote, not just the ones the current level writes. (Before that change, the moment the installer stopped writing
`PostToolUse`, an already-installed user's `PostToolUse` hook became unremovable
by `--remove`.)

### Work in flight: no hook of its own, and the edge rather than the level

The second family needs no new event. `Stop` already carries the harness's own
register of background work — `{id, type, status, description, …}`, where `type`
has been seen as `shell`, `workflow` and `subagent` — so a workflow launched in a
turn is in that turn's own register, and a finished task has left it by the next
one. The gate compares the ids running now against the ids running at this
session's previous `Stop` and arms on the **change**:

- an id present now and absent before → something was dispatched;
- an id present before and absent now → something that was running is no longer
  listed. **That is not a report that it completed.** There is no terminal status
  on this array to read — a finished task is removed rather than re-labelled — so
  the gate concludes only that a report is owed, never what happened, and its
  reason string is written to say exactly that. Terminal states belong to
  `agent-lifecycle` and are immutable once set; nothing in a `Stop` hook may
  imply one from a single snapshot omission.
- both sets equal → nothing new; stay silent. Arming on the *level* would demand
  a report on every turn for as long as a dev server sits in the background,
  which is the noise that gets a gate uninstalled.

This is also the whole of the Workflow answer, and it is why `PostToolUse` matcher
`Workflow` is **not** wired: that event fires at `duration_ms` 3–5 — the launch,
not the work — while the dispatching turn's `Stop` fires with the workflow still
running, so arming there would demand a report about work that has produced
nothing yet.

The baseline lives in its own file beside the marker (`<session>.register.json`),
because the marker is deleted by the `Stop` that ends a turn and the baseline has
to survive that. An absent baseline is read as **empty**, not unknown: a session's
first `Stop` has neither, and the other reading would make the first appearance of
any task unarmable.

**These files accumulate.** One is written per session that backgrounds anything,
and it is removed only when a later `Stop` in that session finds the register
empty — so a session that ends with a dev server still running leaves its baseline
in the temp directory until the operating system sweeps it. Nothing reads a stale
one (anything past `MARKER_MAX_AGE_MS` is treated as absent), and a session that
never backgrounds anything writes no such file at all; but this is new state
v0.16.1 never wrote, and deleting the directory at any time costs at most one
block.

### The coverage level, `AGENT_SKILLS_PROGRESS_GATE_COVERAGE`

The installer writes `AGENT_SKILLS_PROGRESS_GATE_COVERAGE=1` or `=2` into the
command alongside the mode. `1` — and absent, or anything unrecognised — is
v0.16.1's behaviour **exactly**: one signal, `PostToolUse` with `tool_name`
`Agent`, and no register read at all. `2` adds `SubagentStart`, `--skills`, and
the register. The level exists because the register half rides on the `Stop` hook
that is already in your settings: without it, updating the pack alone would widen a
gate you armed under different terms. An unrecognised value falls back to `1`
rather than to `off`, so a typo can neither widen a gate that can end a turn nor
silently disable one you installed.

**You choose it with `--coverage 1|2`, and updating never changes it.** With no
`--coverage`, the installer reads the level out of the gate already in the settings
file — using the gate's own resolver, so a v0.16.1 entry with no level in its command
reads as `1` — and writes that level back. Until 0.18.0 it wrote `2` on every run,
so re-running it to pick up a new version silently widened any coverage-1 gate. It now
prints which happened: `Kept coverage N (already installed in this file)`, `Set
coverage N (was M)`, or `Set coverage 1 (the default for a new install)`. **The mode is
kept the same way**: with no `--mode` it prints `Kept mode block (already installed in
this file)` — `off` too, for a gate you disarmed by hand — and only `--mode` changes it
(`Set mode observe (was block)`); a new install with no `--mode` gets `observe`. A re-run
that drops a `--skills` list it did not repeat says so.

**A new install gets coverage 1**, because coverage 2 holds more turns, including a
turn armed by a register change that needs no tool call (below).
The pack's rule is that a hook able to end a turn is off until a human arms it; the
wider level is a thing to opt into, not to inherit.

**The hooks follow the level, or keeping a level would be a lie.** Coverage 1 written
under the coverage-2 pair (`Stop` + `SubagentStart`) was measured writing no marker
and never blocking — installed, and off. So each level writes exactly the arming half
it reads.

Re-running the installer replaces whatever it wrote last time rather than stacking
a second copy beside it, so changing mode is one command.

**It recognises what it wrote by the command, not by `describe`.** Claude Code drops
`describe` from every hook entry whenever it writes a settings file — adding a plugin
marketplace, granting a permission, a `/config` toggle — and keeps `command`, `matcher`
and `timeout` byte for byte (`../HOOK-OUTPUT-NOTES.md`, third and fourth addenda of
2026-09-14). Because the command survives exactly, the rule reads the whole command, and
`hook-ownership.mjs` holds it for both gate installers. For this one the **exact shape**
is, word for word:

1. one or more assignments, each to one of the gate's own variables —
   `AGENT_SKILLS_PROGRESS_GATE`, `AGENT_SKILLS_PROGRESS_GATE_COVERAGE`,
   `AGENT_SKILLS_PROGRESS_GATE_TURN_HOOK`, `AGENT_SKILLS_PROGRESS_GATE_SKILLS` — none
   twice, `AGENT_SKILLS_PROGRESS_GATE` among them, each value bare (`block`, `2`) or
   single-quoted;
2. one interpreter word, bare or single-quoted;
3. the gate, single-quoted, whose basename is exactly `report-progress-gate.mjs`;
4. nothing else — no argument, `&&`, redirection or comment after it, and no `env`,
   `cd … &&` or other variable before it.

A command in that shape is **never unclear**: its interpreter alone decides what it is.

- **This installer's own, with no flag,** when the interpreter is a single-quoted path
  whose basename is a Node-compatible runtime's name — `node`, `nodejs` or `bun`, then an
  optional version (`node-20`, `node22`, `node-v22.11.0`), then an optional `.exe`, in any
  case — or is the name of the node binary running the installer now. The installer
  writes `process.execPath`, the path of whatever binary ran it, so that name is not the
  same on every machine or after every upgrade: `nodejs` is Debian and Ubuntu's package, a
  side-by-side install carries its version, and bun reports its own binary. Before this
  rule, hooks written under `node-20` and re-read under `node-22` were measured refused
  even under `--adopt`, where 0.19.0 took them. The pattern is `NODE_RUNTIME_NAME` in
  `hook-ownership.mjs`; `nodemon`, `node-gyp` and `bunx` are outside it.
- **Nobody's** when the interpreter only prints, reads, lists, copies or deletes files
  (`'/bin/echo'`, `cat`): it runs nothing of the gate.
- **Taken with `--adopt`** otherwise — a name outside that pattern, `deno`, a wrapper.
  Everything else in the command is pinned, so passing `--adopt` over it is a call you
  can make.

Every version from 0.13.0 on wrote that shape (`HOOK_IDENTITY` in the installer lists
the shapes), so a bare re-run or a bare `--remove` over hooks the harness has rewritten
just works, where through 0.19.0 both needed `--adopt`. **Where the harness has not
dropped it, this installer's own `describe`** on a hook that runs the gate, in any shape,
makes that hook its own too, as it did through 0.19.0: `--remove` removes it and an
install replaces it with no flag. A file whose name merely
contains the gate's — `install-report-progress-gate.mjs`, `report-progress-gate.mjs.bak`
— is not the gate, and no flag makes it one. To disarm the gate by hand, change the
value of `AGENT_SKILLS_PROGRESS_GATE` to `off` and change nothing else: a command edited
any other way is no longer recognised as this installer's own. A re-run keeps it `off`.

A hook with no `describe` that **runs** the gate in any other shape is a hand-wiring. It
runs the gate when, in some simple command of it, the gate file is the program, or is the
word straight after an interpreter given no options (a Node-compatible runtime as above,
`sh`, `bash`, `zsh`, `dash`, `ksh`, `sh.exe`, `bash.exe`, `.`, `source`), or runs inside a
`sh -c` script or a `$(…)`, backtick or `<(…)` substitution. Such a
hook is refused, not overwritten, and `--remove` names it, by event and matcher, rather
than reporting the gate gone: it exits 1 while any hook still runs the gate. (It used to
print "No report-progress gate was installed … Nothing changed." over two such hooks.)
**`--adopt`** takes such a hook — a hand-wiring, a `cd … &&` or an `env` in front, a
bare unquoted `node` — as this installer's own: `--remove` removes it and an
install replaces it, keeping the level its command runs at when no `--coverage` is
named, and both say how many they adopted. A command this installer cannot read the
level from (one that sets the level after `env`, `cd … &&` or `export`, or from an
expansion) is refused until `--coverage` names the level, and so are hooks that run at
different levels.

**Some hooks no flag takes.** A hook that only **mentions** the gate file — as an
argument of `echo`, `printf`, `cat`, `grep`, `ls`, `test`, `cp`, `mv`, `rm` or a similar
command that prints, reads, lists, copies or deletes files, in the exact shape or any other — is
not the gate: `--remove` ignores it, and an install writes the gate beside it, whatever
`describe` it wears. (0.19.0 took such a hook under its own describe, and under `--adopt`; that
is the one hook this version leaves where 0.19.0 took it.) A hook where the installer
**cannot tell** whether the gate runs — the file is an argument of a program it does not
know (`timeout`, `sudo`, `xargs`, a wrapper), follows an interpreter's options
(`node --check`), is piped on from a command that prints or reads it, or sits in a
variable, a here-document, a substitution or a function body — is named, and never
taken, with or without `--adopt`: `--remove` exits 1 and an install refuses until you
remove it by hand. Over-reporting a hook can be undone; deleting one that was not the
gate cannot. A hook whose `describe` something else wrote is never taken either, even
over the exact command this installer writes: somebody else put it there, and it is
theirs to remove.

It is deliberately **not** in `settings-fragment.json`. That fragment is the
journal hook's, and it is meant to be copied wholesale — a gate that can end a
turn must never arrive that way. Running the installer is the only thing that
arms this one.

**Off unless armed.** `report-progress-gate.mjs` exits without reading its input
unless `AGENT_SKILLS_PROGRESS_GATE` is `block` or `observe` in its environment,
and the installer is what puts that assignment in the command it writes — in the
command rather than in an exported variable, because a hook inherits whatever
environment Claude Code launched with, and a desktop launch inherits no shell
profile at all. Changing that one word to `off` in `settings.json` disarms the
gate without uninstalling it.

**It checks shape, not truth, and every string it prints says so.** It can see
that the three section labels are present and that a running row carries a state
word and a freshness token (`last observed 40s ago`), or that
`agent-lifecycle`'s exact no-evidence sentence stands in place of the section. It
cannot see whether `npm test` was ever run, whether `child-7f2` exists, or
whether `40s ago` was an observation rather than a guess. A message that
satisfies this gate can still be a fabrication.

**One check goes further, and it is contradiction detection rather than
verification.** When the register in that same payload lists *n* tasks as
running, the report may not assert the absence of what the harness just stated:
not `Running: none` (`running-declared-empty-while-tasks-in-flight`), and not the
no-evidence sentence (`no-evidence-claimed-while-tasks-in-flight`), which is for
a run with no evidence source at all — and the register is one. The gate still
cannot tell whether any row is *true*; it can now tell when one denies something
it is holding in its hand. It cannot refuse an honest report either, because an
honest report about *n* running tasks says neither of those things. A denial here
means a section with **no row in it**: a running section that carries a literal
state *and* a freshness is a row, and the check stands down whatever words sit
beside it — `state running, last observed just now — none of the tests failed`,
`Failures: none so far`, `(queue empty)`, or a report quoting the no-evidence
sentence while explaining it. Each of those was measured refusing an honest
report before that guard existed. There is
deliberately **no** row-count check and **no** id matching: a report may
legitimately group ("2 background shells, both running"), and forcing it to echo
harness ids would buy a number nobody could verify. The bar is **one row per unit
the harness itself registers** — a workflow of twelve agents owes one row, not
twelve, because twelve is not a number this gate can see and twelve invented
states would be the fabrication the skill exists to stop.

**One block per turn, and the reason says so.** Claude Code ends a turn after 8
consecutive `Stop` blocks; that budget is **shared** across every `Stop` hook
from every settings source, and when it runs out the headless result comes back
`subtype: "success"`, `is_error: false`, `result: ""` — an empty answer reported
as a clean run (`../HOOK-OUTPUT-NOTES.md`). The gate records the spent block in
its marker *before* it emits one, and a gate that cannot write that record
declines to block at all: every `Stop` is a fresh process, so that file is the
only memory it has of having fired. `stop_hook_active` is honoured as the
harness's own backstop rather than relied on as the ceiling — observed, with the
marker directory made unwritable after arming, a gate that trusted it returned
`decision: "block"` on three consecutive `Stop`s. One block, then it stands down.

**The record of a spent block is a file of its own, and a turn start clears it.**
Through 0.19.0 the marker was that record, and nothing inside a turn could be allowed
to touch it, yet arming rewrote it as unspent and standing down deleted it. A turn
could block, stand down, and then arm again with no record that it had already spoken.
The next arm could be another `Agent` dispatch, a subagent starting, or the register
changing again. Measured against that gate with `stop_hook_active` absent, both levels
blocked a second time. So a block is now also written to `<session>.spent.json`
before it is emitted, and nothing inside the turn touches that file. The
installer writes a **`UserPromptSubmit`** hook at both levels, which deletes it and
prints nothing. That event fires at the start of every turn, including the turn a
background completion's `<task-notification>` starts, and never inside a `Stop`-forced
continuation. Text that arrives during a foreground tool call is folded into the
current turn without it, which keeps a spent block spent. A hook that prints nothing
adds nothing to the model's request (all OBSERVED, `../HOOK-OUTPUT-NOTES.md`, fourth
addendum of 2026-09-14). If a turn starts without it, the failure is a missed block,
never a second one. Slash-command turns were not tested.

Every command the installer writes declares that hook as
`AGENT_SKILLS_PROGRESS_GATE_TURN_HOOK=UserPromptSubmit`, and the gate reads the
record only when the command declares it. A command an older installer wrote does not
declare it, and its settings file has no hook to clear the record. Reading the record
there would make that gate block once per session. So under those hooks the gate
decides exactly as 0.19.0 did, and after a re-arm only `stop_hook_active` stops a
second block. The reason it prints then does not promise once per turn. Re-running
the installer adds the hook, and says that it did. `SubagentStop` is
deliberately not wired: it has no 8-block backstop at all, so a bug there would
hang a child agent instead of costing one continuation.

**What it is careful not to do.** It does not fire on a turn that delegated
nothing and changed nothing, which is the whole reason it is survivable — a guard
that blocks "yes, that file is in `src/`" gets uninstalled within a day, and an
uninstalled guard enforces nothing. It never prints
`hookSpecificOutput.additionalContext` on `Stop`: that channel was observed to
force continuations exactly like a block does, so its stand-down notice goes to
stderr, which Claude Code does not deliver to the model at exit 0. It never echoes
harness-supplied text into a reason — not a task's `description`, not its
`command`, not a workflow's name: counts it computed are facts, text it copied is
somebody else's prose arriving in a channel the model reads as instructions. Every
path exits 0, and a passing turn puts **zero bytes** into the model's context.

**What it costs when it is wrong, named rather than left to be discovered.** Each
of these is one block, once:

- the marker is keyed by session and cleared by the `Stop` that ends the turn, so
  a turn that armed and then died without one — a crash, a kill — leaves one
  behind, and the next turn in that session pays a block for a dispatch it did not
  make. A marker older than six hours (`MARKER_MAX_AGE_MS`) is stale and cleared
  without a block, which bounds how long a stranded one can cost anything. That is
  why the reason says "a subagent was dispatched" and not "this turn dispatched a
  subagent": the marker cannot support the second;
- a background result arriving while you ask something trivial arms that trivial
  turn. This is the skill's own trigger ("a background result arrived") and also
  the shape most likely to annoy;
- a swept temp directory loses the baseline, so tasks still running read as new
  at the next `Stop`.

**A resume is handled, at coverage 2.** A resumed session starts in a fresh CLI
process whose background list is empty again, because the list belongs to the
process, not to the session id (`../NOTES.md` addendum, 2026-09-14). So through
0.19.0 the first `Stop` after a resume read as a burst of disappearances and cost a
block. Nothing in the `Stop` payload or the hook's environment identifies the CLI
process. The hook's parent pid is the CLI only where the shell execs the command,
and a baseline scoped to it would suppress every real disappearance wherever that
does not hold (`../HOOK-OUTPUT-NOTES.md`, second addendum of 2026-09-14).

So the installer writes a **`SessionStart`** hook on matcher `resume`. It fires for
`--resume` and `--continue` before the resumed process's first `Stop`, and it was
observed not firing on a fresh start. The gate acts only on `source: "resume"`.
`compact` keeps its process and register, and `startup` and `clear` start a session
id with no baseline. The hook leaves `<session>.resumed.json`, and that session's
next `Stop` spends it. That `Stop` drops the disappearances only when none of the
baseline's tasks is still listed, which a new process, whose register starts empty,
cannot do.

`--fork-session` fires the hook with the **parent's** session id, so the note can
reach the parent's next `Stop` rather than the fork's. The fork has no baseline to
misread. The parent keeps every disappearance while any of its tasks is still
listed, and misses one only when all of them went away in that same turn. A gate
installed without the hook still pays one block after a resume. Re-running the
installer adds the hook, and says that it did.

Measured end to end on Claude Code 2.1.181, with a scripted model and a baseline
left by the old process: `--resume` and `--continue` each ended without a block.
The same resume without the hook blocked once (`../HOOK-OUTPUT-NOTES.md`, fifth
addendum of 2026-09-14). Two processes holding one session id at once share one
baseline; that was not tested.

**What it cannot see at all**, kept accurate rather than aspirational:

- a **foreground external agent** — a bare `codex exec` in a `Bash` call — unless
  you listed the skill that runs it. That path carries no distinguishing tool name
  (`tool_name` is `Bash`; the only signal is `tool_input.command` text), and this
  gate does no command-text matching for any binary, not behind a flag. The
  sibling release gate's eight defects over five rounds were four repeats of one
  bug — a regex reading argument text as command structure — and a false positive
  there merely denied a command, where a false positive here would demand a
  progress report because a commit message mentioned codex. Backgrounding such a
  call makes it a register entry with its own id, exactly tracked, no guessing;
- the **individual children of a workflow**. One registered entry, one row;
- **background work that starts and finishes inside one turn**. The register is
  sampled at `Stop`, so it is never sampled in time to see it. The exact fix would
  be arming from the launching call's `tool_response.backgroundTaskId` — a
  structural field, not text — which costs a `PostToolUse` hook on every `Bash`
  call in the session and is not worth it for work that short;
- **how long anything has been running.** No hook event carries a wall-clock
  timestamp, and nothing fires between `PreToolUse` and `PostToolUse`. "Long
  running" here means, mechanically, *still listed as running at a turn end* —
  there is no threshold, because there is no clock to compare one against.

## The release-notes gate (separate hook, off by default)

The mechanical half of the `release-notes` skill. The skill can be skipped in exactly the
moment it matters — a release is being cut, the note is the last thing between here and
`npm publish`, and nobody is reading. This is the half that is not instructions.

```sh
# try it without risking a release: reports what it would have refused, stops nothing.
# this is what `--mode` defaults to when it is left off.
node adapters/claude-code/install-release-notes-gate.mjs --mode observe

# arm it
node adapters/claude-code/install-release-notes-gate.mjs --mode block

# take it back out; nothing is left behind
node adapters/claude-code/install-release-notes-gate.mjs --remove

# …including a hand-wired hook that runs the gate in a shape this installer never writes
node adapters/claude-code/install-release-notes-gate.mjs --remove --adopt
```

It writes **one** entry into `~/.claude/settings.json` (or the `--settings` file you name):
`PreToolUse`, matcher `Bash`. One is enough because the release command is itself the
trigger — there is no earlier event to arm a marker on, and nothing is kept between calls.
Scoped to `Bash` so the hook is not invoked on `Read`, `Edit` or anything else.

Re-running the installer replaces whatever it wrote last time rather than stacking a second
copy beside it. **A re-run with no `--mode` keeps the mode of the gate already in the file** —
`off` too, if you disarmed it by hand — and says so: `Kept mode block (already installed in this
file). Pass --mode observe to change it.` Only `--mode` changes it (`Set mode observe (was
block)`), and only a new install with no `--mode` gets `observe`. It recognises that hook by its
command, by the same rule as the progress gate's installer. The exact shape is
`AGENT_SKILLS_RELEASE_NOTES_GATE=<value>` and no other assignment, then one interpreter word,
then the gate path, single-quoted, whose basename is exactly `release-notes-gate.sh`, and
nothing after it. With the bare word `bash` — what every version since 0.16.0 wrote — that is
this installer's own; with any other interpreter (`/bin/bash`, `sh`) it is taken by `--adopt`,
never read as unclear; with one that only reads files (`shellcheck`, `cat`) it is nobody's.
Where the harness has not dropped it, this installer's own `describe` on a hook that runs the
gate, in any shape, makes that hook its own too, as it did through 0.19.0. Until this version
it went by `describe` alone, which Claude Code drops
whenever it writes the file, so on a rewritten file `--remove` printed "No release-notes gate
was installed … Nothing changed." and exited 0 with the hook still running. `--remove` now
scans every event key, never reports the gate gone while any hook still runs it, and exits 1
when one does; it also leaves the file untouched when it removed nothing. A hook with no
`describe` that runs the gate in any other shape — a `2>/dev/null` or `&& …` after it — is
refused, not overwritten, until `--adopt` takes it. A hook that only mentions the gate file, as
`echo`, `cat` or `shellcheck` do, is not the gate and is left alone, whatever its `describe`
says. One where the installer cannot tell whether the gate runs, and one under a `describe`
somebody else wrote, are never taken, with or without `--adopt` — they are named, and left for
you to remove by hand. It is deliberately not in `settings-fragment.json`, for the same reason the progress gate is not —
that fragment is the journal hook's and is meant to be copied wholesale, and a hook that can
refuse a tool call must never arrive that way.

**Off unless armed.** `release-notes-gate.sh` exits without reading its input unless
`AGENT_SKILLS_RELEASE_NOTES_GATE` is `block` or `observe` in its environment, and the
installer is what puts that assignment in the command it writes — in the command rather than
in an exported variable, because a hook inherits whatever environment Claude Code launched
with, and a desktop launch inherits no shell profile at all. Changing that one word to `off`
in `settings.json` disarms the gate without uninstalling it.

**What it acts on.** Four command shapes: `npm|pnpm|yarn publish` and `changeset publish`
(with or without the runner it is normally reached through — `npx`, `pnpm exec`, `yarn dlx`),
`gh|glab release create <tag>`, a `git tag` whose tag looks like a release (`v1.2.3`,
`@scope/pkg@1.2.3`), and a `git commit` that stages a `package.json` whose `version` changed —
`HEAD`'s value against the index's, rather than a pattern over the diff text, so a manifest
kept on one line is gated like any other. Each verb has to sit where a command starts, so a
sentence that merely names one is not a release — and **a quoted string is data, not shell
structure**: a `;`, `|`, `&` or `(` inside quotes opens no command position, so `git commit -m
"fixes the crash; npm publish now works"` is a commit message rather than a release. The
quotes themselves are then dropped, so a release that is merely quoted — `npm "publish"`,
`git tag "v1.4.0"` — is still the release it is. For each it works out **which directory the
command will actually run in** — the last top-level `cd` *that runs before the verb*, a `-C`,
a `--filter`/`--prefix` carried by the release invocation itself
rather than by some earlier step in the same line — rather than assuming the session's
cwd, because a release cut against another checkout judged by this checkout's notes is a
refusal the released repository can never satisfy. `git -C <dir> tag` in particular contains
no `git tag` substring, and before that was handled the branch never ran at all: a
cross-repository tag went completely ungated.

**What it checks.** That the version string appears in a file whose job is recording
releases: `CHANGELOG.md` and its usual spellings, `CHANGES.md`, `HISTORY.md`, `NEWS.md`,
`docs/releases.md`, files under `docs/releases/` or `changelog.d/`, or a pending
`.changeset/` entry (which carries a bump type and no version at all, so its presence is the
only thing checkable). Deliberately weaker than "has a `## <version>` heading": that match
rejected `## [1.2.3] - 2026-01-01`, the most widespread convention there is, and every
heading dialect a changelog generator emits is a spelling this gate must not have to know.

**What it cannot check.** Anything the skill is about. A heading with a git-message body
under it satisfies this gate completely. It is a floor, not a grade, and every string it
prints says so.

**Fail-open, and loudly so.** Three answers, not two: mentioned, missing, and *no note source
at all* — and the third allows. A project that keeps no release notes in the tree is using a
different convention, not committing a violation. Every unresolvable path — no `jq`, an
unreadable `cd` target, a `--repo` naming a repository that is not the origin of the one the
command runs in, a package.json it cannot parse — allows as well. The consequence a user has
to hear: **an armed gate that never fires
is the expected outcome in such a repository**, so silence is not proof it is working. Run
`--mode observe` against a release you know has no note before trusting it.

**What it deliberately does not block**, stated so nobody has to discover it: `sudo npm
publish`, `time npm publish`, a leading env assignment such as `NPM_CONFIG_TAG=next npm
publish`, `git tag -f`, and `gh release create --draft v1.4.0` — the flag-first form, where the
tag is not the first word after the verb. (`gh release create v1.4.0 --draft` **is** gated, on
v0.16.0 and here alike; an earlier revision of this line named the shape less precisely than
it behaves.)

**A compound command is judged on its last gated invocation.** That is the rule that stops one
invocation's `--filter`, `-C` or `--repo` being read as another's, and it has a second half:
a command that releases **twice** is checked once. `gh release create v9.9.9 && gh release
create v1.3.0` and `git tag v9.9.9 && git tag v1.3.0` check only the second — v0.16.0 did the
same, so that is not new. One boundary case is, and it is the only shape this version blocks
*less* than v0.16.0: when the last `gh|glab release create` in a command is **argument-less**
it names no version, so that branch reads nothing and allows. `gh release create v9.9.9 && gh
release create` was refused by v0.16.0 and is allowed here, in all eight separator forms. It
is the same greedy read that produced the false refusals this release removes, so it could not
be kept for this shape and dropped for those. `git tag`, `npm|pnpm|yarn publish` and `git
commit` are unaffected — each names what it acts on without an argument, so an argument-less
one of those is itself a release — with one exception that is also v0.16.0's: `git tag ` with
a **trailing space** matches the verb, yields an empty tag, and allows. Narrowing any of this
means checking every gated invocation instead of the last, which is a different design with
its own false-denial risk.

Since quoted text is read as data, a release that reaches the shell as a **string** is also
unblocked, in four shapes rather than the one an earlier version of this paragraph named:

| shape | example |
| --- | --- |
| handed to another shell | `sh -c "build; npm publish"`, `bash -lc "…"`, `ssh host "…"` |
| a command substitution inside double quotes | `echo "$(npm publish)"`, `OUT="$(npm publish --tag next)"` |
| backticks | ``echo `npm publish` `` |
| an **unbalanced** quote | `echo it's fine; npm publish` |

The middle two matter most, and were the ones left unsaid: inside `"…"` a `$( )` re-enters
command context, so bash really does run that publish while the gate reads it as text. The
last is any command carrying an odd number of apostrophes — the span opens and never closes,
so every detector goes quiet for the rest of that command.

This is the price of the quoting rule above and it is paid on purpose. How much of it is
newly given up was understated until this release, and the measurement is the correction:
rows 2 and 4 were **not** already unblocked. Driven against the v0.16.0 build and this one
with the same fixtures, `echo "$(npm publish)"`, `OUT="$(npm publish --tag next)"`,
`printf "%s" "$(git tag v1.4.0)"`, `echo "$(gh release create v1.4.0)"`, `echo it's fine; npm
publish` and `echo don't; git tag v1.4.0` were every one of them **refused** by v0.16.0 and
are allowed here. Genuinely unblocked already: backticks, and the row-1 forms carrying no
separator inside the string (`sh -c "npm publish"`, `ssh host "npm publish"`). What changes in
row 1 is the form with a separator **and** text on both sides of the verb, `sh -c "build; npm
publish --tag next"`. The header's rule decided all of it: every one of these is the same
reading that refused ordinary commit messages, so they could not be separated, and a false
denial teaches people to route around the guard.

**The heredoc trade runs both ways**, and both halves are stated here because which one you
get depends on the punctuation in the body. A heredoc body line still reads as a command, so
a body beginning with a release verb **over**-blocks; a body containing an ordinary
apostrophe (`it's`, `don't`) is the unbalanced-quote row above and **under**-blocks the rest
of the command. Neither is narrowed: narrowing either needs real command-context tracking,
which is a different design with its own evidence.

**What reading quoted text as data costs.** This hook runs before *every* Bash tool call, so
the number belongs here and not only in the script's header. The quoting pass is linear in the
size of the command, and it is dearer than v0.16.0, which has no such pass. Median of five,
end to end through the hook, the two builds interleaved on one machine (macOS 14.5 arm64,
one-true-awk 20200816, bash 3.2), on a 512KB command: no quotes at all 265ms against 189ms
(1.3x), many short quoted spans 425ms against 235ms (1.8x), a `psql -c "INSERT …"` body 404ms
against 217ms (1.9x), a `curl -d '{JSON}'` body 755ms against 204ms (3.7x), and the same body
with its inner quotes backslash-escaped 927ms against 210ms (4.4x). The driver is how many
`'`, `"` and `\` marks the command carries, not its byte count, so the worst shapes are the
ones this pass exists for. It doubles per doubling of the input from 128KB to roughly 1.25MB;
past that this awk falls off a cliff that has nothing to do with the algorithm (1.25MB 1063ms,
1.5MB 2724ms, where v0.16.0 stays linear at 703ms) — recorded rather than chased, because a
1.5MB Bash command is not a shape this hook meets. An ordinary command pays a few milliseconds
more than it used to: a commit message measured 44ms against 30ms here. Measure it on the
machine this actually runs on rather than trusting these numbers.

**Its channels are DOCUMENTED, not OBSERVED.** The `hookSpecificOutput.permissionDecision`
shape block mode returns comes from the schema dump in `../HOOK-OUTPUT-NOTES.md`, whose probe
states plainly that it did not exercise the decision channel; and nothing in this pack has
observed whether a `PreToolUse` hook's stderr reaches a user at exit 0, which is the whole of
observe mode's output. Both remain NOT OBSERVED until somebody probes them and writes it into
that file. Every path exits 0.

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
