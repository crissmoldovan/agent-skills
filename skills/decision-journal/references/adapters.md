# The observation plane: what hooks capture, and what they don't

This document covers **Plane A** — the record of what the agent *did*, captured by a
harness's own hook system and written by `agent-journal observe`. It is a different
thing from everything else in this skill, which is Plane B: the record of what the
agent *decided*, written by `agent-journal record`. Confusing the two is the single
easiest way to misread a journal.

## Why this exists, and why it is not the agent's own account

Every entry `record` writes is self-reported. The agent says what it read, what it ran,
what it chose. That is exactly what makes an anchor valuable and exactly what limits it
— [references/anchors.md](anchors.md) already covers the general case (anchoring proves
a decision happened, not that its premise was true), but observations sharpen the same
point in one specific way: a `tool_use` anchor is currently only as good as the agent's
memory of what it ran. If the agent is wrong about that — misremembers a flag, elides a
failed attempt, asserts a call it never actually made — nothing in Plane B catches it,
because Plane B *is* the agent's testimony.

Hooks are a second, independent witness. A harness's own hook system fires from the
harness's own code, not from the model's account of its own actions, so a `tool_call` /
`tool_result` observation exists whether or not the agent later describes that call
accurately — or describes it at all. This is the entire value proposition of the
observation plane: **it lets a later reader check the agent's account against something
the agent did not author.**

It is not a stronger record than Plane B. It is a *different* one, with its own gaps —
see "What is not captured" below — and the two are meant to be read together, not as a
replacement for each other. An observation with no matching decision entry just means
the agent acted without narrating why; a decision entry with no matching observations
(on a harness that has hooks wired) is itself worth noticing.

## Installing an adapter

Two adapters exist, in `adapters/claude-code/` and `adapters/codex/`, each a
self-contained POSIX `sh` script plus a Node mapping script plus a fragment of harness
configuration. Each adapter's own README is the install guide — read it before wiring
anything, because the two harnesses' installation stories are not identical (see
"Honest status of each adapter" below for the sharpest difference: Codex requires an
explicit hook-trust step that Claude Code does not).

In outline, for either adapter:

1. Build `packages/agent-journal` once, or point `AGENT_JOURNAL_CMD` at the source.
2. Copy the adapter's settings/hooks fragment into the harness's own hook
   configuration, merging rather than replacing any hooks already configured.
3. Replace the placeholder workspace id and the placeholder absolute path to this repo.
4. Run a real session with that harness, then check `agent-journal coverage` (next
   section) to confirm something actually arrived.

Every mapped hook event costs two subprocess spawns (`journal-hook.sh` → `node
journal-hook.mjs` → `agent-journal observe`) — see "What this costs" below before
wiring every event on every tool call in a latency-sensitive setting.

## Verifying observations are actually arriving

Do not trust that a hook fired because the configuration looks right. Run a real
session against the harness, then:

```bash
agent-journal coverage --workspace <id>
```

Read this the same way [the main skill file](../SKILL.md) already teaches for the
decision plane, because the exact same honesty rule applies: `sessions`,
`sessionsWithNoEntries`, `voids` and `sequenceGaps` are real counts; `null` fields
(`sessionsWithNoEvents`, `downgradedAnchors`) mean **not assessed**, not **assessed and
clean**. A coverage report with a nonzero `sessions` count and observation-kind entries
in the underlying journal is the actual proof a hook fired — a hooks-configuration file
that merely parses is not.

If coverage shows nothing after a real session with hooks configured, check in this
order, cheapest first:

1. **Is `AGENT_JOURNAL_WORKSPACE` actually set** in the hook `command` string, and does
   it match the `--workspace` you're querying?
2. **Is `agent-journal` resolvable** from wherever the harness invokes the hook —
   `PATH`, or `AGENT_JOURNAL_CMD`? A hook that can't find the binary exits 0 and writes
   nothing, per the adapters' own first rule (below) — silently, by design.
3. **Codex only: is the hook trusted?** Codex's documented trust model means an
   unreviewed hook simply does not run at all — see the "Installing it" section of
   `adapters/codex/README.md` (in the repository root, outside this skill's own
   directory, so referenced by path rather than by link here). This has no equivalent
   step on Claude Code and is the single likeliest cause of "I configured it and
   nothing shows up" on Codex specifically.
4. **Was the AGENT_JOURNAL_ROOT the coverage command reads the same one the hook
   wrote to?** A mismatched root looks identical to a hook that never fired.

## What is not captured — and therefore which anchors stay hand-typed

The observation plane is not a transcript. It is exactly as complete as the events a
harness's hooks expose, and no more. Both adapters were built to say plainly what falls
outside that, rather than let a reader assume completeness:

- **`heartbeat` is wired on neither adapter, structurally, not by omission.** Every
  event either harness exposes fires because the agent acted or a phase changed — there
  is no hook that fires because time passed and nothing happened. A session that is
  open and idle between turns is indistinguishable, from hooks alone, from one that has
  ended. Spec §7.3's active/stale/ended liveness classification and §7.6's path-claim
  TTL both already route around this; this document just names the mechanical cause:
  no hook-based harness can emit a true heartbeat, by construction.
- **`environment` anchors are not produced by either adapter.** They come from a
  separate capture path (`agent-journal observe --kind environment`, self-populating
  from the process that runs the CLI) that a hook script can invoke but neither
  adapter currently wires into a specific event. An entry that wants to anchor its
  premise to the toolchain that actually ran ([anchors.md](anchors.md)'s own worked
  example) still needs that called explicitly, or hand-typed as a `runtime` anchor if
  it wasn't.
- **`permission` is wired on neither adapter, for two different reasons that both
  matter.** On Claude Code, `PermissionRequest` was attempted directly and never fired
  in any captured session — there is no confirmed source to wire. On Codex, the
  opposite problem: its documentation confirms the event exists and describes its hook
  output as able to allow or deny the request it fires for, which is a live steering
  mechanism this project has no way to test safely without a real Codex install. Either
  way, a decision entry that wants to say a specific permission was granted or denied
  still needs a hand-typed `tool_use` anchor to whatever record of that decision exists
  outside the observation plane.
- **`tool_failure` is unresolved on Claude Code and undocumented on Codex.** A Claude
  Code probe run produced a model reply quoting an exact tool error with no
  corresponding hook event of any kind in the log — genuinely unknown whether the
  harness suppresses the hook for a client-validated failure, or the model asserted a
  call it never made. Codex's own published hooks documentation does not name a
  distinct failure event at all; a failed call there is assumed (not confirmed) to
  arrive folded into `PostToolUse`'s own `tool_response`. Either way, a claim that a
  specific tool call failed for a specific reason is not something either adapter can
  currently back with an observation — anchor it by hand, or to the transcript.
- **`UserPromptSubmit` (Claude Code) and its close Codex analogue of the same name are
  observed/documented and real, but map to none of the fourteen observation kinds.**
  Both fire at the *start* of a turn; `turn_end` is defined as the end of one, and no
  kind was invented to cover the gap. If a decision hinges on exactly what the user
  asked for, cite the prompt directly (a `message` anchor) rather than expecting an
  observation to carry it.
- **A tool call made from inside a running subagent may not be attributable to that
  subagent.** Neither adapter has ever captured a `PreToolUse`/`PostToolUse` payload
  fired from inside a dispatched subagent, so it is unconfirmed whether such a payload
  even carries an agent identifier either adapter could route on. Every current mapping
  assumes the top-level session identity for tool events.

None of this is a defect to route around quietly. It is the reason Plane B's
`--anchor` flag stays manual for these cases rather than the skill quietly implying
"the hook would have caught this" for a class of claim no hook here actually reaches.

## What this costs, honestly

Every mapped hook event spawns two subprocesses. Measured directly for the Claude Code
adapter (five back-to-back `PreToolUse` calls against the built binary): **roughly
270–470ms of wall time added to the tool call it observes**, dominated by two Node
process starts back-to-back. That number is specific to the machine and moment it was
measured on — re-measure before treating it as authoritative anywhere else, and
certainly before treating it as a claim about Codex, where no equivalent measurement
exists at all (see below).

This cost is accepted, not a bug to file: it is the price of routing every observation
through `agent-journal observe`'s own redaction rather than writing JSONL directly. See
either adapter's README, "Why it shells out instead of writing JSONL directly."

## Honest status of each adapter

| | Claude Code | Codex |
| --- | --- | --- |
| **Status** | Built and tested against **real captured payloads** from a throwaway probe session (`adapters/NOTES.md`), plus a black-box test suite that runs the actual `.sh` script. | **Unverified.** Codex is not installed on the machine that built this adapter — searched for plainly, not skipped (`adapters/NOTES.md`, Step 4). Built entirely from OpenAI's published hooks documentation. Nothing here has been run against a real Codex session. |
| **Field names** | Taken from real JSON this project captured and pasted verbatim into `adapters/NOTES.md`. | A handful (`tool_input`, `tool_use_id`, `tool_response`, `session_id`, `cwd`, `hook_event_name`) are documented explicitly by OpenAI. The rest (`agent_id`, `agent_type`, `reason`, `trigger`, `last_assistant_message`) are **carried over from Claude Code's own naming by analogy** — a wrong guess degrades to "field absent," never a crash, but "does not crash" is a much weaker claim than "is correct." |
| **Per-call cost** | Measured: 270–470ms. | Not measured — no session to measure against. Extrapolated from the identical two-subprocess design. A documented Codex-specific risk: `SessionEnd`/`Interrupt` hooks are described with a much shorter default timeout than other events, tight enough that this adapter's own cost could exceed it under load. |
| **`PermissionRequest`** | Unwired: attempted directly, never confirmed to fire. | Unwired: confirmed by Codex's own docs to exist and to be able to steer an allow/deny decision through its own hook output — left out as a **safety** decision, since this project cannot test that path without a real install. |
| **Test suite** | `packages/agent-journal/test/adapter-claude-code.test.ts` — runs the real script against both real-shaped and adversarial input. | `packages/agent-journal/test/adapter-codex.test.ts` — runs the real script (so rules 1–3 are genuinely verified: exit codes, timeouts, and redaction do not depend on Codex's payload shapes being right), but the mapping tests use payloads *built from documentation*, not captured ones. A green test here proves the adapter does what its own documentation-derived model says Codex will send — not that Codex actually sends that. |

An adapter documented as tested when it was not is worse than one honestly labelled
untested — this project has already shipped one false "verified" claim and paid for
it. The Codex row above is written to be uncomfortable to read, on purpose: closing the
gap it describes means running this against a real Codex install and reporting back
what actually happened, not finding more documentation to read.
