# report-progress gate: extending coverage past the `Agent` tool

- **Date:** 2026-09-14
- **Target:** `adapters/claude-code/report-progress-gate.mjs` and
  `adapters/claude-code/install-report-progress-gate.mjs`, shipped at v0.16.1 (`main` @ `ba21372`).
- **Occasion:** the gate arms on one signal — `PostToolUse` with `tool_name === 'Agent'` — and the
  user asked for four more kinds of delegated work to be covered: the `Workflow` tool, subagents
  of any kind, externalised agents such as `/codex`, and long-running tools or investigations.
- **Evidence:** a read-only empirical probe of the Claude Code hook surface run the same day
  (9 headless `claude -p` runs, throwaway scratchpad project, all 27 event names in the binary's
  own hook-event enum wired at once, Claude Code 2.1.181, macOS). Nothing was committed from it;
  its artefacts live outside this repository.
- **Question:** which signals should arm the gate, what does "long-running" mean mechanically,
  what does the report then owe, and does this stay one gate?
- **Recommendation:** **arm on two families, add one new hook event, and refuse the fifth ask.**
  The in-flight register the harness already hands the `Stop` hook covers Workflow, background
  agents and background shells with **no new event at all**; `SubagentStart` replaces
  `PostToolUse:Agent` and covers every foreground subagent kind; externalised agents get a
  structured skill-name allowlist and **no command-text matching, ever**; long-running foreground
  tools are **not worth arming on** and that part should not be built.
- **Status:** design as written, then IMPLEMENTED on the same branch — see the implementation
  addendum at the end of this file, which records the blocking probes' results, the two places
  the implementation departs from this design, and the release note owed at the next version
  bump. Everything between this line and that addendum is the design as it stood before any of
  it was built, and is left unedited on purpose.

**No number in this note was measured.** The costs stated here are structural — counts of hook
invocations per turn — and the one number that would decide a cost argument (per-invocation Node
spawn time on this machine) is unmeasured and listed as probe P5. The 2026-09-13 note in this
directory is the standard this one is deliberately failing to meet, and it says so rather than
publishing an estimate in a table where a measurement belongs.

---

## The property this design is judged against

The shipped gate costs **zero bytes of the model's context on a passing turn**. The arming half
writes a file and prints nothing; the `Stop` half prints nothing to stdout unless it blocks; its
stand-down notes go to stderr, which Claude Code does not deliver to the model on exit 0
(OBSERVED, `adapters/HOOK-OUTPUT-NOTES.md`). That property is the only reason a gate on every
turn end is tolerable, and the user has already asked, unprompted, whether it creates noise.

Two consequences run through every decision below:

1. **Nothing may be emitted on a normal turn.** Not `additionalContext` — which was OBSERVED to
   force continuations exactly like a block and to spend the same shared 8-block budget — and not
   a "just so you know" line. The gate speaks once, when it refuses, or it does not speak.
2. **A false refusal is the failure that gets the gate uninstalled.** Broad arming means more
   turns owe a report. Every widening below is therefore paired with the evidence that the work
   it arms on is real, and with the reason the bar it imposes is payable in one or two lines.

A third, quieter one: a pack update must not silently widen an armed gate. See
"The contract level" below.

---

## What the probe actually gives us

Tagged the way `adapters/NOTES.md` tags everything. Only the facts this design rests on.

**OBSERVED to fire, and load-bearing here:**

| Signal | What it gives | Where it is used below |
|---|---|---|
| `Stop.background_tasks[]` | `{id, type:"shell"\|"workflow", status:"running", description, command\|name}` — the harness's own register of work in flight, delivered **in the payload the gate is already reading** | Family B, the whole of it |
| `SubagentStart` | `agent_id`, `agent_type` — fires for `Agent`-tool subagents (`general-purpose`) **and** Workflow subagents (`workflow-subagent`) | Family A |
| `PostToolUse` `tool_name:"Skill"` | `tool_input {skill:"<name>"}`, `tool_response {success, commandName}` | Family A, opt-in half |
| `PostToolUse` `tool_name:"Workflow"` | `tool_input {scriptPath}`, `tool_response {status:"async_launched", taskId, taskType:"local_workflow", workflowName, runId, …}` | **Rejected** — see Decision 1a |
| `PostToolUse` `duration_ms` | real for foreground calls (`sleep 6` → 6488ms against a 6533ms Pre→Post gap); 2–5ms for any background launch, where it means nothing | **Rejected** — see Decision 2 |
| `UserPromptSubmit` | carries the `<task-notification>` block for background completions, with `<task-id>`, `<tool-use-id>`, `<status>`, `<summary>` | **Rejected** — see Decision 5 |

**OBSERVED not to fire, in nine runs:** `TaskCreated`, `TaskCompleted`, `TeammateIdle` — not for a
background Bash, not for a background Agent, not for a dynamic Workflow, all three of which
completed during the probe. "Task" in those names belongs to a teammate/task-list subsystem, not
to background tool work. Nothing in this design may reference them.

**OBSERVED, and a trap already recorded in `adapters/NOTES.md`:** internal compaction
summarisation is itself a subagent dispatch, seen as a `SubagentStop` with `agent_type: ""` and
**no matching `SubagentStart`**. Any design that arms on `SubagentStop` demands a progress report
on the turn after a `/compact`. This one does not arm on `SubagentStop`.

**NOT OBSERVED / absent:** no event carries a wall-clock timestamp of any kind; nothing at all
fires between `PreToolUse` and `PostToolUse`; `scratchpad_dir` and `prompt_id` appeared on no
event in any of the nine runs on 2.1.181, though `adapters/NOTES.md` records both from 2.1.258
captures. Nothing here may depend on any of the four.

---

## The re-framing that decides most of it

The four asks look like four features. They are two, and the line between them is not what kind
of thing was dispatched — it is **what the user cannot see**:

- **Family A — opaque delegation.** Work happened inside something whose transcript the user will
  not read: a subagent, a workflow's child, an external agent binary. It may already be finished
  when the turn ends. The hole is that the only account of it is the parent's prose, which is
  precisely the "narrating the child's self-report" failure the skill exists to stop.
- **Family B — work in flight at turn end.** The user is about to stop reading and something is
  still running. The hole is that nothing will tell them; there is no mid-flight event, and the
  next thing they see is a turn that begins minutes later.

"Long-running tool" is not a third family. A foreground tool call that took six minutes is over
by the time the turn ends, and the user watched it happen — they were blocked on it. A background
task that has been running for six minutes is Family B and always was. That collapse is the
single most useful thing in this note, because it removes the only ask that would have needed a
wall clock the harness does not have.

---

## Decision 1 — what arms the gate

### 1a. Family B: the in-flight edge, from `Stop.background_tasks[]`, with no new event

`Stop` already fires for every turn end, the gate already reads its payload, and that payload
already carries the register: `{id, type, status, description, command|name}`. Workflow launches
appear in it as `type:"workflow"`; `run_in_background` Bash as `type:"shell"`; background agents
likewise. **The gate can therefore see Family B without a single additional hook, without a
matcher, and without inferring anything.**

**Arm on the edge, never on the level.** Compare the set of `id`s whose `status` is `running`
against the set recorded at this session's previous `Stop`:

- an id present now and absent before → **something new was dispatched in this turn**;
- an id present before and absent now → **something that was running is no longer listed**;
- both sets equal → **nothing new; stay silent**.

Arming on the *level* — "anything is running, so report" — would demand a report on every turn for
as long as a dev server sits in the background, which is the noise that gets a gate uninstalled.
Arming on the *edge* matches the skill's own trigger list exactly: *"before ending a turn in which
background work was started, or in which a background result arrived."*

This also disposes of the Workflow ask without touching the `Workflow` tool at all. A workflow
launched in turn *T* is in *T*'s `Stop.background_tasks[]`, so *T* is armed by the appearance
edge. The finding that `PostToolUse` for `Workflow` fires at `duration_ms` 3–5 — the launch, not
the work — is a trap only for a design that arms there; reading the register instead means the
gate never sees the launch event and never has to reason about its asynchrony. **Do not wire
`PostToolUse` matcher `Workflow`.** It is a second signal for a turn the register already arms,
and its `tool_response` would tempt an implementer into echoing `workflowName` into a reason
string, which rule 3 of the hook contract forbids.

Three implementation constraints, each of which is a bug if it is got wrong:

- **The baseline lives in its own file.** The obligation marker is cleared by the `Stop` that ends
  the turn; the register baseline must survive it. Two files in the same session-keyed directory,
  same atomic tmp+rename write, same age expiry, same silent failure.
- **Absent baseline means empty, not unknown.** A session's first `Stop` has no file and no tasks,
  so absent-as-empty is correct there. Where it is wrong — a temp sweep mid-session — it costs at
  most one block, because every id then reads as new. The other direction (absent-as-unknown)
  would make the *first* appearance of any task unarmable, which is the one that matters most.
- **Count only `status === "running"`, and only entries carrying a string `id`.** An entry with a
  missing or unrecognised status is not evidence of anything and must be ignored rather than
  counted. Never arm on the absence of evidence — the principle that decides every borderline
  case in this note.

Write the baseline only while the set is non-empty and delete it when the set returns to empty, so
a session that never backgrounds anything creates no new file at all.

### 1b. Family A: `SubagentStart` replaces `PostToolUse` matcher `Agent`

`SubagentStart` fires for `Agent`-tool subagents and Workflow subagents alike, paired 1:1 to
`SubagentStop` by `agent_id` (OBSERVED, both kinds). It is one event where the alternative is two,
it carries `agent_id` so dispatches are countable rather than merely detectable, and it is
unaffected by whether the subagent was backgrounded.

**Arm when `agent_type` is a non-empty string other than `workflow-subagent`. Otherwise do not
arm.** Two exclusions, each with a reason:

- `workflow-subagent` — a workflow's children start **asynchronously**, at times no turn owns. A
  child starting while the session is idle would arm the *next* turn, whatever that turn is about.
  Workflow work is already covered by the register in 1a, which is anchored to turn ends by
  construction, so excluding it here removes a false-refusal source and loses no coverage.
- `""` and absent — the compaction subagent's shape. Never arm on absence of evidence.

**Do not wire `SubagentStop`.** It is DOCUMENTED to have no 8-block backstop, so a bug in a hook
that blocks there hangs a child agent indefinitely rather than costing one continuation. It is
also the event the compaction subagent does fire. The gate has no business there.

**Do not arm on the `agent_id`-tagged tool calls that subagents make in the parent's hooks.** The
probe establishes that delegated work is countable that way. Counting it would mean a hook on
`PostToolUse` matcher `*` — a Node spawn on every `Read`, `Grep` and `Edit` in every subagent —
bought for a number the gate is forbidden to verify and the report is not required to carry.

### 1c. Family A, opt-in half: externalised agents, by skill name and by nothing else

The probe is unambiguous about the Bash path: `tool_name` is `"Bash"`, full stop; a
`codex --version` call is indistinguishable in payload *shape* from any other Bash call; a
main-session Bash call carries no `agent_id`, so nothing in the payload says "delegation". **The
only signal that says which binary ran is `tool_input.command`, and that is text.**

Matching it is the exact class of defect the sibling gate produced five times this week. From
`2026-09-13-release-notes-gate-matching-layer.md`, defects 1, 5, 6a and 6e are *literally the same
bug found four times*: a regex over raw text mistook argument text for command structure. Rounds
8 and 9 then found it twice more, in a `sed` and in an invocation-boundary read, after two
separate structural guards had been written specifically to prevent recurrence. Doing it correctly
needs the invocation-splitting pass that round 9 forced — and that same note measures what the
full tokenizer buys on the hard shapes: **nothing.** `sh -c "codex exec"`, `$(codex …)`,
backticks, an unbalanced quote and a heredoc body are missed by the tokenizer exactly as they are
missed by the regexes.

And the payoff here is worse than it was there. The release gate's false positive denies a
command. This gate's false positive demands a **progress report on a turn where the agent merely
mentioned codex in a commit message**. That is the report-shaped ceremony over a one-step answer
that the skill's own pitfall list names, arriving from the machine half, which cannot be argued
with.

**So: no command-text matching. Not for `codex`, not behind a flag, not with an allowlist of
binaries.** What is offered instead:

- **A skill-name allowlist**, default empty, compared with `===` against `tool_input.skill` on a
  `PostToolUse` hook scoped by matcher `Skill`. The `Skill` path is the one clean signal the probe
  found for externalised work: `tool_name "Skill"`, `tool_input {skill:"<name>"}`. The installed
  `codex` skill declares Bash and shells out to `codex exec`, so the sequence a hook sees is
  `Skill(skill:"codex")` followed by ordinary Bash calls — and the first of those is structured,
  exact, and free of prose. Configured as `AGENT_SKILLS_PROGRESS_GATE_SKILLS=codex,gpt-researcher`
  in the hook command the installer writes; when the list is empty the installer **writes no
  `Skill` hook at all**, so the default configuration gains no invocation.
- **Backgrounding, which the harness registers for you.** A `run_in_background` external agent is
  a `type:"shell"` entry in `background_tasks[]` with its own id — Family B, exactly tracked, zero
  text matching. For a user who wants `/codex` delegations visible, changing that skill's own
  invocation to background is a one-flag change at the call site that buys exact tracking, and it
  is strictly better than anything this gate could infer from the outside.

**The honest statement of the remaining hole:** a foreground `codex exec` in a session where the
user has configured no skill allowlist is invisible to this gate, by choice. The obligation to
report it rests on the skill — which is instructions, and skippable. That is a real loss, and it
is a smaller loss than five false-positive bugs in a gate that runs on every turn end.

### The contract level

`SubagentStart` and the `Skill` hook are new settings entries, so they cannot appear without the
user re-running the installer. The register edge in 1a is different: it rides on the `Stop` hook
that is already installed, so a pack update would widen an armed gate silently. That violates the
adapter rule that a hook which can end a turn is off until a human arms it.

Fix: the installer writes an explicit level into the hook command —
`AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2` — and the gate treats absent or `1` as today's behaviour
(marker-only, `Agent`-tool dispatches). An updated pack under an old settings entry behaves
exactly as it did before, until the user runs the installer again and can read what changed in its
output.

---

## Decision 2 — what "long-running" means, mechanically

**It means: still listed as `running` in `Stop.background_tasks[]` at a turn end.** That is the
whole definition, and it is a definition made of a field the harness supplies rather than of a
threshold someone chose.

The alternatives, and why each is rejected:

- **A wall-clock threshold.** No hook event carries a timestamp of any kind (OBSERVED). A hook can
  stamp its own clock, but there is no mid-flight event to stamp — nothing at all fires between
  `PreToolUse` and `PostToolUse` — so the earliest a foreground call's duration can be known is
  the moment it is over.
- **`duration_ms` on `PostToolUse`.** It is real and accurate for foreground calls (verified in
  the probe against the Pre→Post gap), and arming on it would be easy. It is still wrong, for
  three reasons. It measures work the user already watched: they were blocked on it, and the
  turn's answer arrives immediately after. It is meaningless for exactly the calls that matter —
  every background launch reports 2–5ms. And seeing it at all requires `PostToolUse` matcher `*`
  or a hand-maintained tool-name regex, which is a Node spawn on every tool call in the session to
  buy a fact that changes nothing the user can act on.
- **A cadence rule** — "forty minutes of tool calls with no report". The gate does see every
  `Stop`, so this is buildable. It is a different concern with a different bar and a much higher
  false-refusal risk: the shape it produces is a status block demanded of a turn whose entire
  content was a one-line answer to a one-line question. Not now; see Decision 4.

So the answer to "some investigations that are long-running would be good to be tracked as well"
is partly yes and partly no, and the no should be said plainly: **an investigation that runs long
inside a single foreground turn is not a visibility problem this gate can improve.** An
investigation dispatched to a subagent is Family A. An investigation left running in the
background is Family B. An investigation the agent is simply taking a long time over, in the
user's full view, is a report the skill asks for at phase boundaries and that no hook can detect.

---

## Decision 3 — what the report must then contain

### The bar does not scale with the number of children

If a turn dispatches a Workflow of 12 agents, it owes **one row, not twelve.**

- The harness registers **one** entry for that workflow (`type:"workflow"`, one id). Twelve is not
  a number the gate can see, so requiring twelve rows would be requiring something uncheckable.
- The parent cannot observe those twelve children's *state* in any useful sense. `SubagentStart`
  and `SubagentStop` give existence and end; there is no activity, no heartbeat, no freshness.
  A report with twelve rows carrying invented states is rule 5's invention wearing a status
  block's formatting — the exact failure mode the skill was written against, manufactured by the
  gate that was supposed to prevent it.
- An unreasonable bar is a bar people evade. Twelve rows per dispatch, produced under a block, is
  a formatting exercise that teaches the reader to skim.

The rule, stated for the reason string: **one row per unit the harness itself registers.** A
workflow is one row. Naming its child count is welcome where it was observed, and required never.

### The checks, unchanged

Everything the shipped gate checks stays as it is: three section labels present; the running
section carries a literal lifecycle state and a freshness token; `agent-lifecycle`'s exact
no-evidence sentence may stand in place of the section; an empty section says it is empty.

### One check added, and only on armed turns

When the register lists at least one `running` task at this `Stop`, the running section must not
**assert the absence** of what the harness is reporting in the same payload. Two failure codes:

- `running-declared-empty-while-tasks-in-flight` — the report says "Running: none" while the
  register lists *n*.
- `no-evidence-claimed-while-tasks-in-flight` — the report substitutes "Background work visibility
  unavailable; state unknown." while the register lists *n* ids with states.

This is the one genuinely new thing the register buys: **contradiction detection, not content
verification.** The gate still cannot tell whether any row is true. It can now tell when a report
denies something the harness stated in the payload the gate is holding. That is a real lie caught
by string matching, and it cannot refuse an honest report, because an honest report about *n*
running tasks says neither of those two things.

Three things deliberately **not** added, each because it would shade shape-checking into
content-checking and produce false refusals:

- no row-count check (a report may legitimately group: "2 background shells, both running");
- no requirement that the report's ids match the register's (it would force the model to echo
  harness ids, and the gate could not verify the row's truth anyway);
- no check at all on unarmed turns. The gate inspects the message only when a report is owed.

### The freshness phrasing, for the reason string

There is no timestamp anywhere in the harness, so the only freshness a register-sourced row can
honestly carry is "as of this turn's end". The reason string should offer the literal phrasing
`last observed just now (harness register at turn end)`, which the shipped freshness pattern
already accepts, rather than leaving the model to invent an interval it never measured.

---

## Decision 4 — one gate, or two?

**One.** The argument is not tidiness; it is the block budget.

Claude Code ends a turn after 8 consecutive `Stop` blocks, that budget is **shared** across every
`Stop` hook from every settings source (OBSERVED, re-verified), and when it runs out the headless
result is `subtype:"success"`, `is_error:false`, `result:""` — an empty answer reported as a clean
run. A second blocking `Stop` gate does not get its own budget; it competes for this one, and two
gates disagreeing about the same turn can spend two blocks on one missing report.

The two families also want the same artefact. Family A and Family B both end in "what is done,
what is running, what is next", both source the running section from lifecycle evidence, and both
are satisfied by one message. Splitting them would produce two hooks that block for the same
sentence.

What *is* a second gate, if it is ever built, is the **cadence** rule rejected in Decision 2: a
different trigger (elapsed work, not delegation), a different bar (a phase boundary, not a child
row), and a far higher false-refusal risk. It should be its own installer, its own flag, and its
own note — and the block-budget argument above is the reason it must never be armed at the same
time as this one without someone having thought about it.

---

## Decision 5 — what NOT to do

Explicit, because over-arming is the main risk in this design.

1. **Do not match Bash command text** for `codex` or any other binary — see 1c.
2. **Do not wire `SubagentStop`** to anything. No 8-block backstop (DOCUMENTED); fires for the
   compaction subagent (OBSERVED).
3. **Do not wire `UserPromptSubmit`.** It is the completion channel for background work, and it is
   tempting for that reason. It is also the channel for *every real user prompt*, so a hook there
   runs on the one path where a bug leaks text into every turn of the session. Every completion it
   would catch is already visible to the `Stop` hook as a disappearance from the register, one
   turn later at the latest, at zero additional cost.
4. **Do not wire `PostToolUse` matcher `Workflow`** — 1a.
5. **Do not arm on `PostToolUse` duration thresholds** — Decision 2.
6. **Do not arm on `Skill` calls generally.** Most skills are instructions loaded into the same
   context; that is not delegation. Only an exact, user-configured name.
7. **Do not arm on `SubagentStart` with `agent_type` `workflow-subagent`, `""`, or absent** — 1b.
8. **Do not emit `hookSpecificOutput.additionalContext` from any of these hooks.** OBSERVED to
   force continuations exactly like a block and to spend the same shared budget. The gate's
   silence on passing turns is the property being protected.
9. **Do not echo harness-supplied text into the reason.** Not `description`, not `command`, not
   `workflowName`, not `last_assistant_message`. Counts the gate computed are facts; text it
   copied is somebody else's prose in a channel the model reads as instructions.
10. **Do not use `TaskCreated`, `TaskCompleted` or `TeammateIdle`.** Never fired, for any of the
    three kinds of delegated work, in nine runs.
11. **Do not depend on `scratchpad_dir` or `prompt_id`.** Absent on 2.1.181.
12. **Do not add hook event keys that have not been checked against the versions users run.** See
    probe P3: an unknown event key in `settings.json` could, in the worst case, invalidate the
    whole file — which would disable every hook the user has, not just this one.

---

## Coverage: the four asks against what this buys

| Ask | Covered | By what | Not covered |
|---|---|---|---|
| (a) Workflow | yes | register appearance at the dispatching turn's `Stop`; disappearance when it ends | the 12 children individually — by decision (Decision 3) |
| (b) Subagents generally | yes | `SubagentStart` for foreground and backgrounded `Agent` subagents of any `agent_type`; the register for backgrounded ones | workflow-spawned children as *individuals*; nested grandchildren as separate obligations |
| (c) Externalised agents | partly | backgrounded ones structurally, via the register; foreground ones only through a user-configured skill name | a foreground `codex exec` in an unconfigured session — stated, not hidden |
| (d) Long-running work | redefined, then covered | in flight at turn end = the register | long foreground calls — deliberately not built (Decision 2) |

### Holes this design accepts, named

- **The flicker hole.** The register is sampled at `Stop`. A background task that appears and
  disappears between two samples is invisible to it. The exact fix is to arm from the launching
  `PostToolUse`'s `tool_response.backgroundTaskId` — a structural field, not text — but that needs
  a `PostToolUse` hook on `Bash`, which is a Node spawn on the most frequent mutating tool in the
  session. Not worth it for work short enough to start and finish inside one turn. Revisit if it
  is ever *observed* to matter.
- **The idle-arrival cost.** A background task completing while the user asks something trivial
  arms that trivial turn. This is the skill's own trigger ("a background result arrived") and it
  is also the shape most likely to annoy. It costs one block, once, and the reason says which of
  the two edges fired.
- **Temp-sweep resync.** A cleaned temp directory mid-session makes every running id read as new:
  one block, once.
- **Foreground external agents** — 1c.

---

## Where this consumes `agent-lifecycle`, and the one place they conflict

The vocabulary is `agent-lifecycle`'s and this design invents none of it. `status:"running"` in
the register maps to the lifecycle state `running`; `type` (`shell`/`workflow`) and `agent_type`
(`general-purpose`/`workflow-subagent`) are runtime and lineage, not state, and must never be
printed where a state belongs. The gate marks nothing `lost`, produces no heartbeat, and asserts
no activity — it has no authority over lifecycle state and should not acquire one.

**The conflict, stated plainly.** `agent-lifecycle` procedure step 6 says: *do not conclude
anything from an incomplete snapshot omitting a child*, and, where an adapter can establish
complete coverage, surface stale/unknown only after a documented grace threshold. The
disappearance edge in 1a concludes something from exactly one omission, with no proof that
`background_tasks[]` is a complete snapshot and no grace count at all.

Resolution, in three parts:

1. **The gate is not a lifecycle projection and must not speak like one.** It concludes only *"a
   report is owed"*, never *"the task completed"*. The reason string must say what was observed —
   "a task this session's previous turn listed as running is no longer listed" — and must not name
   a terminal state. Terminal states are `agent-lifecycle`'s and they are immutable once set;
   nothing in a `Stop` hook may imply one.
2. **Grace does not apply to a trigger.** The grace threshold exists so that an intermittent
   snapshot cannot silently *complete or lose* work in a projection. Arming a report obligation
   one turn early costs one block and no false state anywhere.
3. **Completeness is a precondition, not an assumption** — probe P2. If `background_tasks[]` turns
   out to be partial or filtered, the disappearance edge must be **dropped entirely**, because it
   would then fire at random. The appearance edge survives that finding; the disappearance edge
   does not.

One place they agree, worth recording because it justifies a new check: `agent-lifecycle`'s
no-evidence sentence is for a run with *no evidence source*. When the register lists *n* running
ids with states, an evidence source exists — in the payload the gate is reading — so refusing that
sentence there follows the lifecycle contract rather than straining it.

---

## Probes that must run before implementation

Each of these is a fact this design assumes and the 2026-09-14 probe did not establish. P1 and P2
**block** the register edge; P3 blocks the new hook entries. Results belong in
`adapters/NOTES.md` or `adapters/HOOK-OUTPUT-NOTES.md`, tagged the way those files tag everything.

- **P1 — are `background_tasks[].id` values stable across `Stop`s within one session?** The entire
  edge rule rests on it. If ids are regenerated per `Stop`, every turn reads as "everything
  disappeared, everything is new" and the gate blocks on every turn until it is uninstalled. The
  probe saw a single `Stop` carrying running tasks; it never compared two.
- **P2 — is `background_tasks[]` the complete register, or a filtered view?** Decides whether the
  disappearance edge ships at all (see the conflict above). Launch three background tasks of
  different kinds and compare the array against the harness's own task list across several turns.
- **P3 — is `SubagentStart` a settings key the versions users run will accept, and what does an
  *unknown* event key do to `settings.json` validation?** All 27 names are schema-valid on 2.1.181
  (OBSERVED, the 27-key file validated and its hooks fired). What an older or newer build does
  with a key it does not know is unknown, and the bad outcome is not "this hook is ignored" but
  "this settings file is rejected".
- **P4 — matcher semantics for `SubagentStart`.** It has no `tool_name`. `Stop` is installed with
  matcher `*`; confirm the same works here rather than assuming it.
- **P5 — the per-invocation cost of this gate's Node process on a real machine.** The sibling gate
  measured a bash hook's floor at 1.7ms and its whole run at 20–44ms. A Node hook's floor is
  higher and unmeasured here. It decides nothing in this note — every hook proposed fires on turn
  ends, subagent starts and `Skill` calls, none of them hot paths — but it is the number to have
  before anyone proposes a `PostToolUse` matcher `*`.
- **P6 (nice to have) — can a `workflow-subagent`'s `SubagentStart` fire while no turn is open?**
  If it cannot, the `agent_type` exclusion in 1b is belt-and-braces rather than load-bearing.
  Either way the exclusion stays: the register covers workflows at a better anchor point.

---

## Ordered work list

Unimplemented. Each item is small enough to land with its failing test first.

1. **Installer: make removal event-agnostic before anything else changes.** `removeHooks` iterates
   the module's own `EVENTS` list, so the moment `EVENTS` stops naming `PostToolUse`, an existing
   user's `PostToolUse` hook becomes unremovable by `--remove` and stays in their settings forever,
   arming a marker nothing reads. Scan **every** key under `settings.hooks` for entries whose
   `describe` starts with `DESCRIBE_PREFIX`. Test: a settings file carrying the v0.16.1 pair is
   left empty by `--remove` from the new installer.
2. **Run P1, P2, P3, P4.** Record them in the adapter notes. If P1 or P2 fails, stop and re-scope:
   items 3 and 4 are the register edge.
3. **Gate: the register baseline.** Second session-keyed file, atomic write, absent-as-empty,
   `running`-only, string-`id`-only, delete when empty, age expiry shared with the marker. Pure
   function `registerEdge({ current, previous })` returning `{ appeared, disappeared }` so every
   branch is testable without a filesystem.
4. **Gate: arm on the edge, behind `AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2`.** Absent or `1` keeps
   v0.16.1 behaviour exactly. Test both levels against the same payloads.
5. **Gate: the two contradiction checks**, armed turns only, with their own failure codes.
6. **Gate: `SubagentStart` arming**, with the `agent_type` exclusions, replacing the
   `PostToolUse`/`Agent` branch. Keep the dispatch counter; it is a fact the gate computed and the
   reason may state it.
7. **Gate + installer: the skill allowlist.** `AGENT_SKILLS_PROGRESS_GATE_SKILLS`, exact
   case-insensitive match on a trimmed comma list against `tool_input.skill`; installer writes the
   `Skill` hook **only** when the list is non-empty.
8. **Reason strings, one per arming family**, assembled from fixed sentences plus counts. Each must
   say what armed it, that this is a shape check, that it blocks once, and — for the register
   family — that a disappearance is not a completion.
9. **Documentation, in every place the adapter rules require it**: the gate's header comment, the
   installer's output, `adapters/claude-code/README.md`, `skills/report-progress/SKILL.md`'s
   "mechanical half" section, and the release note. Each has to carry the new coverage *and* its
   limits — what it cannot see (foreground external agents, individual workflow children) is as
   load-bearing as what it can.

### Tests this needs, named

Added to `test/report-progress-gate.test.mjs`: appearance arms; steady state stays silent;
disappearance arms; absent baseline behaves as empty; non-`running` statuses are not counted;
entries without a string id are ignored; malformed `background_tasks` (not an array, entries not
objects) arms nothing and throws nothing; contract level absent/`1`/`2`; "Running: none" against a
non-empty register fails, and against an empty register passes; the no-evidence sentence against a
non-empty register fails, and with no register passes; `SubagentStart` arms for `general-purpose`
and for an unknown non-empty type, and does not arm for `workflow-subagent`, `""` or absent; the
skill allowlist matches exactly and not by substring; every arming path writes nothing to stdout;
and — the property the whole design is judged against — a passing turn writes nothing to stdout
under every combination above.

---

## What this note did not check

- **Nothing was measured.** See the opening. P5 is the number, and it is absent by admission.
- **Nothing was implemented**, so no claim here has survived contact with the gate's actual code
  beyond reading it. In particular the `runningBlock` extractor and the freshness pattern were
  read, not exercised, against the phrasings this note proposes for the reason string.
- **Whether `stop_hook_active` resets between turns** is still unconfirmed (recorded as unknown in
  `adapters/HOOK-OUTPUT-NOTES.md`). The one-block-per-turn ceiling here rests on the marker, not on
  that flag, which is why the gap is tolerable — but a design that leaned on it would be building
  on an untested assumption.
- **Interactive sessions.** Every observation behind this note came from headless `claude -p` runs.
  Background work and idle arrivals are exactly where an interactive session might differ, and it
  was not tried.
- **The `Workflow` tool's own `taskId` against the register's `id`.** The probe records both; that
  they are the same value is plausible and unverified. Nothing in this design needs them to match —
  the register is read on its own terms — but anyone tempted to correlate them should check first.
- **Other harnesses.** This is the Claude Code adapter only. The Codex adapter in `adapters/codex/`
  has a different event surface and is out of scope; nothing here should be copied across without
  its own probe.

---

## Implementation addendum, 2026-09-14 — what was built, and what the probes changed

The note above is the design. This section records that it was implemented on the same
branch, what the blocking probes returned, where the implementation departs from the design,
and the release note that is **owed at the next version bump** — the repository refuses
staged prose under `docs/releases.md`'s `## Unreleased` while `package.json`'s version
already has a `CHANGELOG.md` entry, and bumping that version is a release act with its own
checklist, so the note is parked here rather than staged early.

### The probes returned, and none of them blocks

Recorded in full, with payloads, as the 2026-09-14 addendum in `adapters/NOTES.md`.

- **P1 — ids stable across `Stop`s?** YES, within one CLI process: two shells kept
  byte-identical ids across four consecutive `Stop`s. The edge rule stands.
- **P2 — is the register complete?** Every launch's own id — `tool_response.backgroundTaskId`
  for a backgrounded `Bash`, `agent_id` for a backgrounded `Agent` — appeared in the register,
  six for six, across four runs. And a finished entry is **removed** rather than re-labelled:
  no terminal status value was ever seen on the array. The disappearance edge ships, and it is
  the only way a completion is visible at all.
- **P3 — is `SubagentStart` an accepted settings key, and what does an unknown key do?**
  Accepted and fired. An invented key beside a real one did not invalidate the file: the
  sibling `Stop` hook still fired.
- **P4 — matcher semantics.** `matcher: "*"` works, the same as the `Stop` half already uses.
- **P5** (per-invocation Node cost) and **P6** (idle `workflow-subagent` starts) remain
  unmeasured and unattempted. Neither gates anything here; both are still open.

**One probe finding changed the design's shape.** `background_tasks[]` belongs to the CLI
PROCESS, not to the session id. A `claude -p` run that backgrounds three shells, resumed with
`--resume <the same session id>`, reports that same `session_id` and an **empty** register.
Since both files this gate writes are keyed by session id, the first `Stop` after a resume
reads as a burst of disappearances: one block, once. It is the same shape as the temp-sweep
hole the design already accepted, and it is now named in the installer's output, the gate's
header, the adapter README and the skill.

A second finding widened one line of code: `type` has a **third** value. A backgrounded
`Agent` subagent registers as `{"type":"subagent", "id": <the agent_id>, "agent_type": …}`.
The design's shape table said `shell|workflow`. `runningTaskIds` therefore never enumerates
`type` at all — it reads `status` and `id`, and a fourth kind stays visible.

### Where the implementation departs from the design

- **The `Agent`-tool branch was kept, not replaced.** The design said `SubagentStart`
  *replaces* `PostToolUse` matcher `Agent`. The INSTALLER does replace it — coverage 2 writes
  no `PostToolUse:Agent` hook. The gate FILE still honours one, at every level, so a settings
  entry written by v0.16.1 keeps arming instead of sitting inert. Silence is the worse failure
  for a hook whose whole job is to not be skippable, and re-running the installer removes the
  old entry anyway.
- **A stale marker no longer short-circuits the whole decision.** v0.16.1 returned "stale,
  stand down" the moment the marker aged out. With a second arming family that carries no
  marker, that would have let a six-hour-old file suppress a live register edge, so the stale
  marker is dropped and the edge is still evaluated.
- **The release note is parked here** rather than staged in `docs/releases.md`. See above.
- **`docs/releases.md`, `CHANGELOG.md` and `package.json` are untouched.** No version was
  bumped, nothing was tagged, nothing was published.

### The release note, owed at the next version bump

> **What.** The `report-progress` gate armed on one signal — `PostToolUse` with `tool_name`
> `Agent`. It now arms on two families. **Opaque delegation** moves to `SubagentStart`, which
> fires for every subagent kind, foreground or backgrounded, and optionally to a
> user-configured list of skill names treated as external agents (`--skills codex`, exact
> match, empty by default, and no hook is written when the list is empty). **Work in flight at
> a turn end** needs no new event at all: `Stop` already carries `background_tasks[]`, the
> harness's own register of background shells, workflows and backgrounded subagents, so the
> gate compares the ids running now against the ids running at the session's previous `Stop`
> and arms on the **change** — something appeared, or something that was running is no longer
> listed. A task that is merely still running arms nothing. One check is added, on armed turns
> only: a report may not say "Running: none", or claim there is no lifecycle evidence, while
> the register in that same payload lists tasks as running.
> `test/report-progress-gate.test.mjs` grows from 41 tests to 76. No skill was added or
> removed; twenty-four stay twenty-four.
>
> **Why.** The gate enforced a report for one kind of delegated work and was blind to the
> rest: a Workflow, a backgrounded subagent, an external agent, a background shell left
> running when the user stopped reading. The silence it was built to prevent was available
> through four doors and closed on one.
>
> **What this buys.** The register answers the Workflow question without the gate ever reading
> the `Workflow` tool's own event — that one fires at `duration_ms` 3–5, the launch rather
> than the work, while the dispatching turn's `Stop` fires with the workflow still running. It
> answers "long-running" by redefining it as something a field can settle: still listed as
> running at a turn end. No hook event carries a wall-clock timestamp, so there is no
> threshold to set, and arming on a foreground call's `duration_ms` was considered and
> declined — it measures work the user already watched, blocked, in full view.
>
> **What it still does not see.** A foreground external agent (a bare `codex exec` in a `Bash`
> call) unless the skill that runs it is listed. That path carries no distinguishing tool
> name, and matching command text is refused outright, for any binary, not behind a flag: the
> sibling release gate found the same defect — a regex reading argument text as command
> structure — four times in one round and twice more after two structural guards were written
> to stop it, and there a false positive merely denied a command. Here it would demand a
> progress report because a commit message mentioned codex. Backgrounding such a call makes it
> a register entry with its own id, exactly tracked. Also unseen: a workflow's individual
> children (one registered entry owes one row, not twelve), and background work that starts
> and finishes inside one turn.
>
> **Compatibility, and why there is a flag.** The two new hooks cannot appear in a user's
> settings without them re-running the installer. The register half rides on the `Stop` hook
> already installed, so updating the pack alone would have widened an armed gate silently. The
> installer now writes `AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2` into the command; absent, `1`,
> or anything unrecognised is v0.16.1's behaviour **exactly**, register included. An
> unrecognised value falls back to the narrower armed level rather than to `off`, so a typo
> can neither widen a gate that can end a turn nor silently disable one.
>
> **One thing to do if you have this gate installed.** Re-run the installer. `--remove` now
> scans every event key in your settings rather than the list this version happens to write —
> without that, the moment the installer stopped writing `PostToolUse`, an existing
> `PostToolUse` hook became unremovable and would have stayed there arming a marker nothing
> reads. Re-installing also replaces the v0.16.1 pair rather than orphaning half of it.
