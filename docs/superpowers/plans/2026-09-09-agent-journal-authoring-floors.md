# Agent Journal — The Authoring Floors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the journal recording only what an agent felt like recording. Two moments prompt an entry regardless of the agent's own judgement: when context is about to be destroyed, and when something consequence-bearing just happened.

**Architecture:** The adapter gains a second direction. Until now hooks only observe and write; a `PostToolUse` hook can also return `additionalContext`, and a `PreCompact` hook can return generic `reason`/`systemMessage`. A pure classifier decides which observations are consequence-bearing. Nothing fires unless a workspace opts in.

**Tech Stack:** TypeScript with `--experimental-strip-types`, Node >= 24, `node:test`, POSIX shell for the adapters, no runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-07-agent-decision-journal-design.md` §11.1–11.3, with §4.3 for `runtime` and §5.7 for constraints.

**Evidence this plan rests on:** `adapters/HOOK-OUTPUT-NOTES.md` — the probe that turned the hook output channel from the binary's own documentation strings into observed behaviour. **Read it before Task 3.** It is the authority on what the harness actually does, and it outranks this plan.

## Why this exists, in the spec's own words

> **The most-repeated finding in review: the set §11.1 captures is roughly the complement of the set that hurts you.** Nobody *chose* a mutating call — a `get`-shaped name was read as a read. Nobody *decided* to flip an enforcement flag. Nobody *decided* a catch-all error string. Those never present as decisions and are exactly the ones later needed.

Self-triggered authoring writes up the deliberate choices. Incidents come from the other set. That is the whole argument, and every design decision below serves it.

## The decision that shapes everything: opt-in per workspace

Decided 2026-09-09. An installed adapter must not start injecting text into live sessions unannounced. A workspace opts in explicitly; everywhere else the adapter behaves exactly as it does today, and the floors are inert.

This is not timidity. A floor that fires where nobody asked for it is a floor people disable, and a disabled floor captures nothing — the same reasoning §10.1 uses when it exempts living sources from hash rot to stop people learning to ignore rot flags.

## Global Constraints

- **A hook must never fail the tool call it observes.** This is the adapters' cardinal rule and the new output path is the one change that could break it. The probe found malformed hook JSON and non-zero exits never broke the observed call — **confirm that still holds for everything you write**, and treat any path that could break it as a defect regardless of what else it achieves.
- **The floors prompt; they never author.** The injected text asks the agent to write an entry. It must not contain a pre-written entry, a suggested `record` command with fields filled in, or anything the agent could paste without thinking. §5.3's whole claim is that influences are *selected from what the tooling saw*, not recalled — a floor that hands over a draft manufactures exactly the perfunctory entry §11.3 warns about.
- **Classification is a heuristic and must say so.** A command that mutates config is recognisable by pattern, not by proof. The classifier will have false negatives, and an entry that cites its output must not read as though the system verified anything. `capabilities` already distinguishes `known` from `unknown`; nothing here may claim more.
- **Node >= 24.** `pnpm verify` — **not just `pnpm test`**, which does not typecheck; a `string | undefined` bug reached a commit that way. `timeout(1)` is not installed on this machine. Bare `node` may resolve to a v26 that reports false failures — prefer `pnpm exec node`.
- No new runtime dependencies. `null` is not `[]`; absent is not `''`; absent is not `false`.
- **Every new test mutation-checked.** Break the code, confirm the named test goes RED, restore. If a mutation stays GREEN, report and investigate — **never retarget**. On this project that discipline has found more real defects than any review, and **twice the test written for a fix could not detect its own subject**. Assume the tables below are wrong somewhere.
- **For every compound guard, confirm each half fails alone.** Ten mutually-masking guards found so far.
- Gates: `pnpm verify` in the package, `node scripts/verify-skills.mjs` (20 skills), `pnpm verify` at the root.
- Never write a journal into the repo. The CLI has two fallback roots and both are now git-ignored; always set `AGENT_JOURNAL_ROOT` to a scratch path. Two stray segment files have reached commits this way already.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/consequence.ts` (new) | Pure. Classifies an observation as consequence-bearing, and says which rule matched. |
| `src/floors.ts` (new) | Pure. Builds the prompt text for each floor from what the journal already holds. |
| `src/cli.ts` (modify) | `agent-journal floor --kind compaction\|consequence` — renders the prompt, or nothing. |
| `adapters/claude-code/journal-hook.mjs` (modify) | Emit hook output for the two floors, gated on opt-in. |
| `adapters/codex/journal-hook.mjs` (modify) | Same, or an honest note that its output channel is unverified. |
| `test/consequence.test.ts`, `test/floors.test.ts` (new) | One per module. |
| `skills/decision-journal/references/authoring-floors.md` (new) | What fires, when, how to opt in, and what it cannot see. |

---

## Task 1: The classifier

**Files:**
- Create: `packages/agent-journal/src/consequence.ts`
- Test: `packages/agent-journal/test/consequence.test.ts`

**Interfaces:**
- Consumes: `JournalEvent`.
- Produces:
  - `type ConsequenceRule = 'permission' | 'mutation' | 'unfamiliar-api' | 'constraint-match'`
  - `interface Consequence { readonly observationId: string; readonly rule: ConsequenceRule; readonly detail: string }`
  - `consequencesIn(events: readonly JournalEvent[], options?: { since?: string }): Consequence[]`

**§11.3's four triggers, and how each is actually detectable:**

| Trigger | Detectable from | Honest limit |
| --- | --- | --- |
| permission grants and denials | a `permission` observation | **None ship.** `adapters/NOTES.md` records `PermissionRequest` as never observed to fire. The rule exists and matches nothing today; say so rather than pretending. |
| config/flag/env-var/deploy mutations | a `tool_call` whose input matches a mutation pattern | A heuristic. `wrangler secret put` is recognisable; `curl -X POST https://api/flags` is not. |
| first use of an unfamiliar external API in a workspace | a `tool_call` naming a host not seen before in this journal | "Unfamiliar" means *absent from this journal*, which is not the same as new to the world. |
| a `constraint` matching the current subject | `constraintsBearingOn` — already built | The only one of the four that is exact rather than heuristic. |

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-journal/test/consequence.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consequencesIn } from '../src/consequence.ts';
import { normalizeEvent } from '../src/envelope.ts';

function obs(id: string, kind: string, data: Record<string, unknown>, time = '2026-09-09T10:00:00.000Z') {
  return normalizeEvent({
    schemaVersion: 1, id, source: 'hook/h/s/a', sourceEpoch: 'e1', time,
    workspace: 'ws', session: 's', agent: 'a', author: 'agent', provenance: 'hook',
    harness: 'test', context: 'coding', kind, data,
  });
}
const bash = (id: string, input: string, time?: string) =>
  obs(id, 'tool_call', { tool: 'Bash', input }, time);

test('a secret or config mutation is consequence-bearing', () => {
  const cases = [
    'wrangler secret put API_KEY',
    'gh variable set ENFORCE_AUTH --body true',
    'kubectl set env deployment/api FEATURE_X=on',
    'aws ssm put-parameter --name /prod/flag --value on',
  ];
  for (const input of cases) {
    const got = consequencesIn([bash('o1', input)]);
    assert.equal(got.length, 1, `not flagged: ${input}`);
    assert.equal(got[0]!.rule, 'mutation');
    assert.equal(got[0]!.observationId, 'o1');
  }
});

// The cost of a pattern-matcher is false positives, and a floor that fires on
// ordinary work is one people switch off — which captures nothing at all.
test('reading configuration is not mutating it', () => {
  const benign = [
    'wrangler secret list',
    'gh variable list',
    'kubectl get deployment/api -o yaml',
    'cat .env.example',
    'grep -r FEATURE_X src/',
    'git log --oneline -20',
  ];
  for (const input of benign) {
    assert.deepEqual(consequencesIn([bash('o1', input)]), [], `false positive: ${input}`);
  }
});

test('a permission observation is consequence-bearing whatever its decision', () => {
  for (const decision of ['granted', 'denied']) {
    const got = consequencesIn([obs('p1', 'permission', { tool: 'Bash', decision })]);
    assert.equal(got.length, 1, `not flagged: ${decision}`);
    assert.equal(got[0]!.rule, 'permission');
  }
});

// "Unfamiliar" means absent from THIS journal. That is a weaker claim than
// "new", and the detail must not imply otherwise.
test('a host seen before in this journal is not unfamiliar', () => {
  const events = [
    bash('o1', 'curl https://api.example.com/v1/flags', '2026-09-08T10:00:00.000Z'),
    bash('o2', 'curl https://api.example.com/v1/other', '2026-09-09T10:00:00.000Z'),
  ];
  const got = consequencesIn(events).filter((c) => c.rule === 'unfamiliar-api');
  assert.deepEqual(got.map((c) => c.observationId), ['o1'],
    'the second call to a known host was flagged as unfamiliar');
});

test('an observation is reported once even when several rules match', () => {
  // A mutation against an unfamiliar host is one thing that happened.
  const got = consequencesIn([bash('o1', 'curl -X POST https://new.example.com/admin/flags')]);
  assert.equal(new Set(got.map((c) => c.observationId)).size, got.length,
    `one observation produced duplicate consequences: ${JSON.stringify(got)}`);
});

test('entries are not observations and produce nothing', () => {
  const entry = normalizeEvent({
    schemaVersion: 1, id: 'e1', source: 'cli/h/s/a', sourceEpoch: 'e1',
    time: '2026-09-09T10:00:00.000Z', workspace: 'ws', session: 's', agent: 'a',
    author: 'agent', provenance: 'cli', harness: 'test', context: 'coding',
    kind: 'decision', data: { question: 'q', chosen: 'wrangler secret put X' },
  });
  assert.deepEqual(consequencesIn([entry]), [],
    'a decision that merely mentions a mutation was treated as one');
});

test('since narrows to what happened after a point, exclusive of it', () => {
  const events = [
    bash('old', 'wrangler secret put A', '2026-09-08T10:00:00.000Z'),
    bash('new', 'wrangler secret put B', '2026-09-09T10:00:00.000Z'),
  ];
  const got = consequencesIn(events, { since: '2026-09-08T10:00:00.000Z' });
  assert.deepEqual(got.map((c) => c.observationId), ['new']);
});

// A tool_call with no input cannot be classified, and guessing would be worse
// than saying nothing.
test('an observation with nothing to match on produces nothing, not a guess', () => {
  assert.deepEqual(consequencesIn([obs('o1', 'tool_call', { tool: 'Bash' })]), []);
});
```

- [ ] **Step 2: Run to verify they fail** — `Cannot find module '../src/consequence.ts'`.

- [ ] **Step 3: Implement.** Keep the patterns in one exported, documented table so a reader can see exactly what is recognised without reading the matcher. Read tool inputs with the same non-blank-after-trim rule the rest of the package uses. **`constraint-match` is not implemented in this task** — it needs a subject, which only the caller has; Task 2 wires it.

- [ ] **Step 4: Run to verify they pass**

- [ ] **Step 5: Mutation-check**

| Mutation | Test that must go red |
| --- | --- |
| drop the read-vs-write distinction (match `wrangler secret` alone) | reading configuration is not mutating it |
| flag `denied` but not `granted` | a permission observation is consequence-bearing whatever its decision |
| unfamiliar-api compares the full URL rather than the host | a host seen before in this journal is not unfamiliar |
| `since` becomes inclusive | since narrows to what happened after a point |
| classify entries as well as observations | entries are not observations |
| drop the per-observation dedupe | an observation is reported once |
| absent input treated as an empty string and matched | an observation with nothing to match on |

- [ ] **Step 6: Commit**

---

## Task 2: The prompts

**Files:**
- Create: `packages/agent-journal/src/floors.ts`
- Modify: `packages/agent-journal/src/cli.ts`, `src/index.ts`
- Test: `packages/agent-journal/test/floors.test.ts`, `test/cli.test.ts`

**Interfaces:**
- Produces:
  - `renderCompactionFloor(events, options): string | null`
  - `renderConsequenceFloor(events, options): string | null`
  - CLI: `agent-journal floor --kind compaction|consequence --workspace <id> [--since <ts>] [--subject <s>]`

**Both return `null` when there is nothing to say, and the CLI prints nothing and exits 0.** A floor that fires on every tool call is noise; most tool calls are not consequence-bearing, and silence is the common case.

**What Floor 1 must ask for, per §11.2:** pending entries, *plus an assumption sweep* — what was taken on trust (idempotency, ordering, environment), written as `assumption` entries with `checked: no`. That second half is the part a reader will forget, and it is the half that survives compaction as a record of what was never verified.

**What the text may not contain:** a pre-written entry, or a `record` command with fields filled in. Ask the question; let the agent answer it. There is a test for this.

- [ ] **Step 1: Write the failing tests**

Cover at minimum: both renderers return `null` on an empty journal; the consequence prompt names the observation id so the agent can cite it as an anchor; the compaction prompt asks for the assumption sweep in so many words; neither output contains the string `agent-journal record`; `--subject` wires `constraintsBearingOn` so a matching live constraint appears; and the CLI exits 0 printing nothing when there is nothing to say.

- [ ] **Step 2–4: Run, implement, run**

- [ ] **Step 5: Mutation-check**, including: `null` replaced by an empty string (the CLI must still print nothing, and the test must distinguish these); the assumption sweep dropped from Floor 1's text; the observation id dropped from Floor 2's.

- [ ] **Step 6: Commit**

---

## Task 3: Wiring the adapters, opt-in

**Files:**
- Modify: `adapters/claude-code/journal-hook.mjs`, `adapters/claude-code/README.md`, `adapters/claude-code/settings-fragment.json`
- Modify: `adapters/codex/*` equivalently, or record why not
- Test: `packages/agent-journal/test/adapter-claude-code.test.ts`

**Read `adapters/HOOK-OUTPUT-NOTES.md` first. It is the authority, and the two floors need different mechanisms:**

- **Floor 2 → `PostToolUse`**, printing `{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"…"}}`. Observed working, delivered mid-turn right after the tool call.
- **Floor 1 → `PreCompact`**, printing top-level `{"reason":"…","systemMessage":"…"}` with **no `hookSpecificOutput`** — that field is rejected outright for this event by the harness's own schema validation, and the probe captured the error. The generic fields are folded into the compaction summary and survive it.

**Opt-in.** The floors are inert unless the workspace opts in — `AGENT_JOURNAL_FLOORS=1` in the hook command, alongside `AGENT_JOURNAL_WORKSPACE`. Unset, empty, or any other value means off. Test the off case first: an adapter that only works when enabled is less dangerous than one that only fails when disabled.

**The cardinal rule, under the one change that could break it.** Every path still exits 0 and never fails the observed call. The probe found malformed output does not break the call — verify that for your own output too, and verify a floor that throws, times out, or produces a 300KB string cannot take a tool call down with it. Note the probe hit a size cap around 215KB where content is swapped for a preview plus a file pointer; keep the prompt far below that and truncate rather than rely on the harness.

- [ ] **Step 1: Write the tests** — black-box, feeding payloads on stdin as the existing adapter tests do. Assert on the JSON the hook prints, not only on its exit code.

- [ ] **Step 2–4: Run, implement, run**

- [ ] **Step 5: Verify end to end against a real headless run**, the way the probe did: opt in within a throwaway project, trigger a mutation-shaped Bash call, and confirm the agent actually receives the prompt. **Do not modify `~/.claude/settings.json`.**

- [ ] **Step 6: Mutation-check and commit**

---

## Task 4: Documentation

**Files:**
- Create: `skills/decision-journal/references/authoring-floors.md`
- Modify: `skills/decision-journal/SKILL.md`, `docs/superpowers/agent-journal-remaining-work.md`

Cover: what each floor fires on and when; how to opt in, and that it is off by default and why; **what the classifier cannot see** — `permission` never fires on this harness so that rule matches nothing today, "unfamiliar" means absent from this journal rather than new, and mutation matching is a pattern list a reader should extend; that the floors prompt and never author; and the `runtime` anchor, which is what a Floor 2 prompt exists to make you notice you could cite.

Then strike the floors from the backlog, leaving the rest.

- [ ] **Step 1: Write the reference**
- [ ] **Step 2: Add a SKILL.md step**
- [ ] **Step 3: Run every documented command block verbatim, in document order, against one scratch workspace.** This has caught a broken example in four of the last five plans.
- [ ] **Step 4: Update the backlog**
- [ ] **Step 5: Gates and commit**

---

## Self-Review

**1. Spec coverage.** §11.2's compaction flush and assumption sweep → Tasks 2 and 3. §11.3's four triggers → Task 1, with the one that cannot fire named as such. §11.1's self-trigger is unchanged; the floors are additional, not a replacement. §4.3's `runtime` anchor → closed as a side effect, documented in Task 4.

**2. Placeholders.** Task 1 carries complete test code. Tasks 2 and 3 describe their tests, because both depend on Task 1's final `Consequence` shape and, for Task 3, on payload shapes that live in `HOOK-OUTPUT-NOTES.md` rather than here — a stated dependency, and the same reason Plan 4 kept its adapter tasks structural.

**3. Type consistency.** `consequencesIn` returns `Consequence[]`; `renderConsequenceFloor` consumes the same array. `ConsequenceRule` includes `constraint-match`, which Task 1 defines but does not populate and Task 2 wires — stated in both places rather than silently deferred.

**4. The risk worth naming.** This is the first change that makes the journal *speak into* a session rather than only record one. A prompt that fires too often gets the whole adapter uninstalled, and then nothing is captured at all — a worse outcome than the gap this closes. Opt-in is the mitigation; a low false-positive rate on the mutation patterns is what makes opt-in worth choosing, which is why Task 1's benign-command test matters more than its positive cases.
