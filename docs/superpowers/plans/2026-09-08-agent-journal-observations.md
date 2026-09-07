# Agent Journal — The Observation Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the journal a Plane A — observations the agent does not author — so that anchors stop being hand-typed assertions and become evidence a hook captured.

**Architecture:** One new CLI verb (`observe`) writes the observation kinds §4.4 defines, through the same validated, redacting append path entries use. Two harness adapters (Claude Code, Codex) translate hook payloads into `observe` calls. `environment` and `path_claim` get first-class capture because §2.1 and §7.6 name them specifically.

**Tech Stack:** TypeScript with `--experimental-strip-types`, Node >= 24, `node:test`, POSIX shell for the adapters, no runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-07-agent-decision-journal-design.md` — §4.4, §7.6, §9.1, §9.2, and §2.1 for why `environment` matters.

**Prior plans:** `2026-09-07-agent-journal-core.md`, `2026-09-07-agent-journal-entry-surface.md`, `2026-09-07-agent-journal-digest.md` — all complete and merged to `main`.

## Why this plan is the one that makes the design true

Everything shipped so far assumes a plane of evidence that does not exist. Retention pins observations nothing writes. `coverage` counts sessions nothing registers. `tool_use` anchors reference observation ids that cannot be produced. §5.3's central claim — that influences are *selected from what the tooling saw*, not recalled — has no candidate set to select from.

Until this lands, every anchor in a real journal is something a person or an agent typed from memory, which is the failure mode §2 was written against.

## Global Constraints

- **Node >= 24.** `packages/agent-journal/package.json` declares `"engines": { "node": ">=24.0.0" }`. Run tests with `pnpm test` from `packages/agent-journal`, never bare `node --test`, and **never pin Node 22** — that note belongs to a different repo, and running below this package's declared floor has already produced misleading review evidence in this project.
- **Every new test must be mutation-checked.** Break the code it covers, confirm the named test goes RED, restore. Report any row that stays GREEN rather than retargeting it.
- **A mutation going red is necessary, not sufficient.** `assert.ok(!x)` passes for `null`, `''`, `[]` and `undefined`; `stderr.includes(code)` passes with a duplicated code present. Assert the value, or the count.
- **For every compound guard, confirm each half fails alone.** Five instances of mutually-masking guards were found in the previous plan; a guard covered only by its neighbour is not covered.
- **Report what you ran, never what you expect.** If this plan states what a mutation will do, run it anyway and report the actual result, including when it contradicts the plan. A claim of the author's entered a report as verified evidence once already and was false.
- **`null` is not `[]`, and absent is not `''`.**
- **Redaction is the only fail-closed path, and adapters must not bypass it.** Observations carry tool inputs and environment values — the highest-volume source of secrets in the whole system. Everything goes through `SegmentJournal.append`.
- **A hook must never fail the tool call it observes.** Every adapter exits 0 whatever happens inside it. A journal that breaks the agent it observes will be removed within a day.
- Every CLI flag stays scoped to its subcommand; an unrecognised one exits 2.
- No new runtime dependencies. No literal credentials in fixtures — `scripts/verify-skills.mjs` matches `gh[pousr]_[A-Za-z0-9_]{20,}` and `sk-[A-Za-z0-9]{20,}`.
- After every task: `pnpm verify` in `packages/agent-journal` and `node scripts/verify-skills.mjs` (20 skills) from the repo root.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/observe.ts` (new) | The observation kinds, their per-kind fields, and `normalizeObservation`. Pure. |
| `src/environment.ts` (new) | Capturing the resolved toolchain — §2.1's anchor class. Reads the process, no journal I/O. |
| `src/claims.ts` (new) | `path_claim` liveness and the advisory read. Pure. |
| `src/cli.ts` (modify) | The `observe` and `claims` subcommands. |
| `src/index.ts` (modify) | Export the three new modules. |
| `adapters/claude-code/` (new) | Hook script plus the settings fragment that installs it. |
| `adapters/codex/` (new) | The same for Codex's hook surface. |
| `test/observe.test.ts`, `test/environment.test.ts`, `test/claims.test.ts` (new) | One per module. |
| `test/cli.test.ts` (modify) | The two new subcommands end to end. |
| `skills/decision-journal/references/adapters.md` (new) | Installing and verifying an adapter, and what it does not capture. |

---

## Task 1: Discover the hook contract, and write down what you found

**Files:**
- Create: `adapters/NOTES.md`

**Interfaces:**
- Produces: a recorded, dated description of each harness's hook payload and configuration, which Tasks 5 and 6 build against.

**This task writes no product code, and it is the most important one in the plan.**

The author of this plan does not know the exact shape of a Claude Code or Codex hook payload and has deliberately not guessed. A previous plan in this project asserted a behaviour the author had reasoned about but not run; an implementer wrote it into a report as verified; it was false. Do not repeat that. Everything Tasks 5 and 6 rely on comes from what you observe here.

There is a real, working hook on this machine to learn from: `~/.claude/settings.json` has a `SessionStart` hook with a `matcher` and a `command`. Read it — it is a live example of the configuration shape, installed by another tool.

- [ ] **Step 1: Record the configuration shape**

Read `~/.claude/settings.json`. Record, in `adapters/NOTES.md`: which key hooks live under, how an event maps to a list of matchers, what fields a `command` hook takes, and whether the command receives arguments, stdin, or both.

- [ ] **Step 2: Capture a real payload**

Install a temporary hook that does nothing but record what it receives. Write it somewhere outside the repo — `/tmp` — so a stray file cannot be committed:

```bash
cat > /tmp/journal-probe.sh <<'EOF'
#!/bin/sh
{ printf '=== %s ===\n' "$(date -u +%FT%TZ)"; printf 'ARGS: %s\n' "$*"; printf 'STDIN:\n'; cat; printf '\n'; } >> /tmp/journal-probe.log 2>/dev/null
exit 0
EOF
chmod +x /tmp/journal-probe.sh
```

Add it to your own Claude Code settings for **one** event first, trigger that event, and read `/tmp/journal-probe.log`.

**Record verbatim** in `adapters/NOTES.md`: whether the payload arrives on stdin or as arguments; if JSON, the exact top-level keys; whether a session identifier is present and what it is called; whether the tool name and its input are present for tool events; and whether a transcript path is present.

- [ ] **Step 3: Enumerate the events that actually fire**

Repeat for each event you can trigger. Aim to cover at least: session start, a tool call before it runs, a tool call after it runs, a subagent starting or stopping, and compaction if you can induce it. For each, record the event name **as the harness spells it** and the keys its payload carries.

**Record what you could not trigger, and why.** An event you did not observe is not an event that does not exist, and Task 5 must not treat an untested event name as verified. This distinction is the whole point of the task.

- [ ] **Step 4: Do the same for Codex, or record that you could not**

If Codex is not installed or its hooks cannot be exercised here, say so plainly in the notes with what you tried. Task 6 will then build against its published contract and mark the adapter unverified — which is honest and useful — rather than pretending to evidence nobody gathered.

- [ ] **Step 5: Remove the probe**

Restore your settings, delete `/tmp/journal-probe.sh` and `/tmp/journal-probe.log`. Confirm `git status --short` is empty apart from `adapters/NOTES.md`.

- [ ] **Step 6: Commit**

```bash
git add adapters/NOTES.md
git commit -m "docs(adapters): the hook contract, as observed rather than assumed"
```

---

## Task 2: The `observe` command

**Files:**
- Create: `packages/agent-journal/src/observe.ts`
- Modify: `packages/agent-journal/src/cli.ts`, `packages/agent-journal/src/index.ts`
- Test: `packages/agent-journal/test/observe.test.ts`, `packages/agent-journal/test/cli.test.ts`

**Interfaces:**
- Consumes: `JournalEvent`, `normalizeEvent` from `./envelope.ts`; `SegmentJournal`; the existing `journalFor` helper in `cli.ts`.
- Produces:
  - `OBSERVATION_KINDS: readonly string[]` — the fourteen §4.4 names
  - `OBSERVATION_FIELDS: Readonly<Record<string, readonly string[]>>`
  - `fieldsForObservation(kind: string): readonly string[]`
  - `normalizeObservationData(kind, given: ReadonlyMap<string, readonly string[]>): Record<string, unknown>`
  - CLI: `agent-journal observe --kind <kind> --workspace <id> [per-kind flags] [--seq <n>]`

**The fields, from §4.4 and what an anchor needs to be worth citing:**

| Kind | Fields |
| --- | --- |
| `session_start` | `harness`, `cwd`, `branch` |
| `session_end` | `reason` |
| `turn_end` | `turn` |
| `tool_call` | `tool`, `input`, `callId` |
| `tool_result` | `tool`, `callId`, `summary` |
| `tool_failure` | `tool`, `callId`, `error` |
| `permission` | `tool`, `decision` |
| `subagent_start` | `agentId`, `purpose` |
| `subagent_stop` | `agentId`, `status` |
| `compact` | `reason` |
| `heartbeat` | (none) |
| `environment` | see Task 3 — `observe` accepts it, Task 3 populates it |
| `path_claim` | see Task 4 |
| `void` | written by `voidEvent`, not by this command |

**Two decisions this task locks in.**

*`--seq` exists because observations are the only high-volume writer.* `coverage` already reports sequence gaps, and a gap is how a dropped hook becomes visible. Entries do not need it — a human writes one at a time — but a hook that fires forty times a turn does. It is optional: absent means the source declares no sequence, which `mergeEvents` already handles.

*`observe` refuses `void`.* A void records a refused write and is produced by the failure path itself; letting a caller fabricate one would let a hook manufacture evidence of its own silence, which is precisely backwards.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-journal/test/observe.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OBSERVATION_KINDS, fieldsForObservation, normalizeObservationData } from '../src/observe.ts';

test('the kinds are exactly spec 4.4\'s fourteen', () => {
  assert.deepEqual([...OBSERVATION_KINDS], [
    'session_start', 'session_end', 'turn_end', 'tool_call', 'tool_result', 'tool_failure',
    'permission', 'subagent_start', 'subagent_stop', 'compact', 'heartbeat', 'environment',
    'path_claim', 'void',
  ]);
});

test('each kind carries its own fields and no other kind\'s', () => {
  assert.deepEqual([...fieldsForObservation('tool_call')], ['tool', 'input', 'callId']);
  assert.deepEqual([...fieldsForObservation('tool_failure')], ['tool', 'callId', 'error']);
  assert.deepEqual([...fieldsForObservation('heartbeat')], []);
  assert.ok(!fieldsForObservation('tool_result').includes('input'),
    'tool_result must not accept tool_call\'s input');
});

test('an unrecognised kind carries no fields rather than guessing', () => {
  assert.deepEqual([...fieldsForObservation('not_a_kind')], []);
});

// Same rule as entries: a field nobody set must not appear as '' — that claims
// assessed-and-empty where nothing was assessed.
test('a blank or unsupplied field is absent, not empty', () => {
  const data = normalizeObservationData('tool_call', new Map([
    ['tool', ['Bash']], ['input', ['   ']],
  ]));
  assert.equal(data.tool, 'Bash');
  assert.ok(!('input' in data), `input was stored as ${JSON.stringify(data.input)}`);
  assert.ok(!('callId' in data));
});
```

```ts
// append to packages/agent-journal/test/cli.test.ts
test('observe writes an observation through the same validated path entries use', async () => {
  const dir = await root();
  const r = await runCli(['observe', '--workspace', 'ws', '--kind', 'tool_call',
    '--tool', 'Bash', '--input', 'git status', '--callId', 'c1'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  assert.equal(r.code, 0, r.stderr);
  const [e] = await readAllEvents(dir, 'ws');
  assert.equal(e!.kind, 'tool_call');
  assert.equal(e!.data.tool, 'Bash');
  assert.equal(e!.provenance, 'hook',
    'an observation records that a hook produced it, not the CLI');
});

// A hook firing forty times a turn is the only writer that needs this, and a gap
// in the sequence is how a dropped hook becomes visible in `coverage`.
test('observe accepts a sequence, and omits it when not given', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['observe', '--workspace', 'ws', '--kind', 'heartbeat', '--id', 'h1',
    '--seq', '7'], env);
  await runCli(['observe', '--workspace', 'ws', '--kind', 'heartbeat', '--id', 'h2'], env);
  const byId = Object.fromEntries((await readAllEvents(dir, 'ws')).map((e) => [e.id, e]));
  assert.equal(byId.h1!.sequence, 7);
  assert.ok(!('sequence' in byId.h2!), 'an absent sequence must not become 0');
});

test('observe refuses a non-numeric or negative sequence', async () => {
  const dir = await root();
  for (const bad of ['x', '-1', '1.5', '']) {
    const r = await runCli(['observe', '--workspace', 'ws', '--kind', 'heartbeat',
      '--seq', bad], { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
    assert.equal(r.code, 2, `--seq ${JSON.stringify(bad)} was accepted`);
  }
});

// A void records a refused write and is produced by the failure path itself.
// Letting a caller fabricate one lets a hook manufacture evidence of its own
// silence, which is exactly backwards.
test('observe refuses to write a void', async () => {
  const dir = await root();
  const r = await runCli(['observe', '--workspace', 'ws', '--kind', 'void'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /void/i);
  assert.equal((await readAllEvents(dir, 'ws')).length, 0);
});

test('observe refuses an entry kind — record writes those', async () => {
  const dir = await root();
  const r = await runCli(['observe', '--workspace', 'ws', '--kind', 'decision'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /record/i);
});

// Observations carry tool inputs — the highest-volume source of secrets here.
test('an observation goes through the redactor like any other write', async () => {
  const dir = await root();
  const token = 'ghp' + '_' + 'a1b2c3d4e5'.repeat(3);
  await runCli(['observe', '--workspace', 'ws', '--kind', 'tool_call', '--tool', 'Bash',
    '--input', `git push https://${token}@example.com/r.git`],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  const [e] = await readAllEvents(dir, 'ws');
  assert.ok(!JSON.stringify(e!.data).includes(token), 'a token reached disk from an observation');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/agent-journal && pnpm test`
Expected: FAIL — `Cannot find module '../src/observe.ts'`, and `unknown command: observe`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/agent-journal/src/observe.ts

/** Spec 4.4's observation kinds, in the order the spec lists them. */
export const OBSERVATION_KINDS = [
  'session_start', 'session_end', 'turn_end', 'tool_call', 'tool_result', 'tool_failure',
  'permission', 'subagent_start', 'subagent_stop', 'compact', 'heartbeat', 'environment',
  'path_claim', 'void',
] as const;

export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

/** What each kind carries. `environment` and `path_claim` are populated by their
 *  own capture paths; `void` is written by the failure path and never by a caller. */
export const OBSERVATION_FIELDS: Readonly<Record<string, readonly string[]>> = {
  session_start: ['harness', 'cwd', 'branch'],
  session_end: ['reason'],
  turn_end: ['turn'],
  tool_call: ['tool', 'input', 'callId'],
  tool_result: ['tool', 'callId', 'summary'],
  tool_failure: ['tool', 'callId', 'error'],
  permission: ['tool', 'decision'],
  subagent_start: ['agentId', 'purpose'],
  subagent_stop: ['agentId', 'status'],
  compact: ['reason'],
  heartbeat: [],
  environment: ['interpreter', 'version', 'platform', 'packageManager', 'flags'],
  path_claim: ['checkout', 'worktree', 'branch', 'ttlSeconds'],
  void: [],
};

export function fieldsForObservation(kind: string): readonly string[] {
  return Object.prototype.hasOwnProperty.call(OBSERVATION_FIELDS, kind)
    ? OBSERVATION_FIELDS[kind]!
    : [];
}

/**
 * Build an observation's `data`. Absent stays absent, and a blank value counts as
 * absent — the same rule entries follow, for the same reason: `''` claims
 * assessed-and-empty where nothing was assessed.
 */
export function normalizeObservationData(
  kind: string,
  given: ReadonlyMap<string, readonly string[]>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fieldsForObservation(kind)) {
    const values = given.get(field);
    if (!values || values.length === 0) continue;
    const last = values[values.length - 1]!;
    if (!last.trim()) continue;
    out[field] = last.trim();
  }
  return out;
}
```

In `src/cli.ts`: add `observe: [...OBSERVATION_GLOBAL, ...Object.values(OBSERVATION_FIELDS).flat()]` to `ALLOWED_FLAGS`, where

```ts
const OBSERVATION_GLOBAL = ['workspace', 'kind', 'id', 'context', 'seq'] as const;
```

Note the absences: no `--author` (an observation is never authored by a human — that is what makes it Plane A) and no `--disclosure` (observations are machinery, not candour; they take the envelope default).

Add the branch, modelled on `record`'s:

```ts
  if (command === 'observe') {
    const kind = opts.get('kind');
    if (!kind) return { code: 2, stdout: '', stderr: `--kind is required\n${USAGE}` };
    if (kind === 'void') {
      return { code: 2, stdout: '',
        stderr: 'void observations are written by the refusal path itself, never by a caller\n' };
    }
    if (ENTRY_KINDS_SET.has(kind)) {
      return { code: 2, stdout: '',
        stderr: `${kind} is an entry kind — use \`agent-journal record\`\n` };
    }
    const allowed = new Set<string>([...OBSERVATION_GLOBAL, ...fieldsForObservation(kind)]);
    const wrong = [...opts.keys()].filter((k) => !allowed.has(k)).sort();
    if (wrong.length > 0) {
      return { code: 2, stdout: '',
        stderr: `${wrong.map((f) => `--${f}`).join(', ')} `
          + `${wrong.length > 1 ? 'are' : 'is'} not a field of observation '${kind}'\n` };
    }

    let sequence: number | undefined;
    const rawSeq = opts.get('seq');
    if (rawSeq !== undefined) {
      if (!/^\d+$/.test(rawSeq)) {
        return { code: 2, stdout: '',
          stderr: `--seq must be a non-negative whole number, got ${JSON.stringify(rawSeq)}\n` };
      }
      sequence = Number(rawSeq);
    }

    const session = env.AGENT_JOURNAL_SESSION ?? 'unknown';
    const agent = env.AGENT_JOURNAL_AGENT ?? 'primary';
    const event = normalizeEvent({
      schemaVersion: 1, id: opts.get('id') ?? randomUUID(),
      source: `hook/${hostname()}/${session}/${agent}`, sourceEpoch: 'e1',
      ...(sequence === undefined ? {} : { sequence }),
      time: nowStamp(), workspace, session, agent,
      author: 'agent', provenance: 'hook',
      harness: env.AGENT_JOURNAL_HARNESS ?? 'other',
      context: opts.get('context') ?? 'coding',
      kind, data: normalizeObservationData(kind, all),
    });

    const journal = journalFor(root, workspace, session, agent);
    const result = await journal.append(event);
    if (!result.written) {
      return { code: 1, stdout: '', stderr: `refused: redaction ${result.verdict}\n` };
    }
    return { code: 0, stdout: `observed ${event.id}\n`, stderr: '' };
  }
```

Define `ENTRY_KINDS_SET` from `entry.ts`'s `KIND_FIELDS` keys, and add the usage line. Export `./observe.ts` from `index.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/agent-journal && pnpm test`

- [ ] **Step 5: Mutation-check**

| Mutation | Test that must go red |
| --- | --- |
| `provenance: 'hook'` → `'cli'` | observe writes through the same validated path |
| drop the `!last.trim()` skip | a blank or unsupplied field is absent |
| `if (kind === 'void')` → `if (false)` | observe refuses to write a void |
| `ENTRY_KINDS_SET.has(kind)` → `false` | observe refuses an entry kind |
| `/^\d+$/` → `/\d/` | observe refuses a non-numeric or negative sequence |
| `...(sequence === undefined ? {} : { sequence })` → `sequence: sequence ?? 0` | observe omits sequence when not given |
| `hasOwnProperty` → `OBSERVATION_FIELDS[kind] ?? []` | an unrecognised kind carries no fields — **also try `--kind constructor`** |

- [ ] **Step 6: Verify through the built binary**

```bash
cd packages/agent-journal && pnpm build
export AGENT_JOURNAL_ROOT=/tmp/j-p4t2 && rm -rf "$AGENT_JOURNAL_ROOT"
node dist/bin.js observe --workspace w --kind tool_call --tool Bash --input 'git status' --seq 1
node dist/bin.js observe --workspace w --kind tool_result --tool Bash --summary 'clean' --seq 2
node dist/bin.js coverage --workspace w
```
Expected: both written; `coverage` reports one session and no sequence gaps. Then repeat omitting `--seq 2` on a third write and confirm a gap is *not* invented for a source that declares no sequence.

- [ ] **Step 7: Commit**

```bash
git add packages/agent-journal/src/observe.ts packages/agent-journal/src/cli.ts \
        packages/agent-journal/src/index.ts packages/agent-journal/test/observe.test.ts \
        packages/agent-journal/test/cli.test.ts
git commit -m "feat(agent-journal): observe — the plane the agent does not author"
```

---

## Task 3: `environment` capture

**Files:**
- Create: `packages/agent-journal/src/environment.ts`
- Modify: `packages/agent-journal/src/cli.ts`, `packages/agent-journal/src/index.ts`
- Test: `packages/agent-journal/test/environment.test.ts`, `packages/agent-journal/test/cli.test.ts`

**Interfaces:**
- Produces:
  - `interface Environment { interpreter, version, platform, packageManager?, flags? }`
  - `captureEnvironment(proc?: NodeJS.Process): Environment`
  - CLI: `agent-journal observe --kind environment` with **no field flags** populates itself.

**Why this class exists at all, from §2.1.** The canonical failure in this design is an entry that is perfectly formed and worthless: real anchors, a real failing suite, an honest note that no source was consulted — reached by running against the wrong interpreter. `environment` is the class that would have caught it, because it records *the toolchain that actually ran* rather than the one anyone assumed.

So the capture must record the **resolved** interpreter — `process.execPath`, not `"node"` — because the entire value is distinguishing the binary that ran from the name that was typed.

§4.3 also warns these values are machine-identifying: paths contain usernames, hostnames leak. They go through the redactor like everything else, and the `home-path` pattern already masks `/Users/<name>`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-journal/test/environment.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureEnvironment } from '../src/environment.ts';

test('the interpreter is the resolved path, never the word that was typed', () => {
  const e = captureEnvironment();
  assert.ok(e.interpreter.includes('/'),
    `expected a resolved path, got ${JSON.stringify(e.interpreter)}`);
  assert.notEqual(e.interpreter, 'node');
});

test('version and platform come from the running process', () => {
  const e = captureEnvironment();
  assert.equal(e.version, process.version);
  assert.equal(e.platform, `${process.platform}/${process.arch}`);
});

test('a fake process is read rather than the real one, so this is testable at all', () => {
  const e = captureEnvironment({
    execPath: '/opt/weird/bin/node', version: 'v22.0.0',
    platform: 'linux', arch: 'arm64', env: { npm_config_user_agent: 'pnpm/9.0.0' },
  } as unknown as NodeJS.Process);
  assert.equal(e.interpreter, '/opt/weird/bin/node');
  assert.equal(e.version, 'v22.0.0');
  assert.equal(e.platform, 'linux/arm64');
  assert.equal(e.packageManager, 'pnpm/9.0.0');
});

test('an absent package manager is omitted, not empty', () => {
  const e = captureEnvironment({
    execPath: '/x/node', version: 'v24.0.0', platform: 'darwin', arch: 'x64', env: {},
  } as unknown as NodeJS.Process);
  assert.ok(!('packageManager' in e), `packageManager was ${JSON.stringify(e.packageManager)}`);
});
```

```ts
// append to packages/agent-journal/test/cli.test.ts
test('observe --kind environment populates itself, needing no flags', async () => {
  const dir = await root();
  const r = await runCli(['observe', '--workspace', 'ws', '--kind', 'environment'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  assert.equal(r.code, 0, r.stderr);
  const [e] = await readAllEvents(dir, 'ws');
  assert.equal(e!.kind, 'environment');
  assert.equal(e!.data.version, process.version);
  assert.ok(String(e!.data.interpreter).includes('/'));
});

// 4.3: these values are machine-identifying. The home-path pattern already
// masks them and must not be bypassed for this kind.
test('an environment observation is redacted like anything else', async () => {
  const dir = await root();
  await runCli(['observe', '--workspace', 'ws', '--kind', 'environment'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  const [e] = await readAllEvents(dir, 'ws');
  const written = JSON.stringify(e!.data);
  assert.ok(!/\/Users\/[^/"]+/.test(written) && !/\/home\/[^/"]+/.test(written),
    `a home path reached disk: ${written}`);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Expected: FAIL — `Cannot find module '../src/environment.ts'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/agent-journal/src/environment.ts

export interface Environment {
  /** The RESOLVED interpreter path. Recording "node" would defeat the purpose:
   *  the class exists to distinguish the binary that ran from the name typed. */
  readonly interpreter: string;
  readonly version: string;
  readonly platform: string;
  readonly packageManager?: string;
  readonly flags?: string;
}

/**
 * Spec 2.1's anchor class. The canonical failure this design targets is an entry
 * that is perfectly anchored and worthless because the suite ran against the
 * wrong interpreter; this is what makes that premise checkable.
 *
 * `proc` is injectable so the capture is testable without spawning a process
 * under a different toolchain.
 */
export function captureEnvironment(proc: NodeJS.Process = process): Environment {
  const pm = proc.env?.npm_config_user_agent?.split(' ')[0]?.trim();
  const flags = proc.execArgv?.join(' ').trim();
  return {
    interpreter: proc.execPath,
    version: proc.version,
    platform: `${proc.platform}/${proc.arch}`,
    ...(pm ? { packageManager: pm } : {}),
    ...(flags ? { flags } : {}),
  };
}
```

In `cli.ts`'s `observe` branch, before building `data`:

```ts
    const data = kind === 'environment'
      ? { ...captureEnvironment(), ...normalizeObservationData(kind, all) }
      : normalizeObservationData(kind, all);
```

Explicit flags win over the capture, so a hook that knows better than the current process — a remote runner, a container — can say so.

- [ ] **Step 4: Run the tests to verify they pass**

- [ ] **Step 5: Mutation-check**

| Mutation | Test that must go red |
| --- | --- |
| `proc.execPath` → `'node'` | the interpreter is the resolved path |
| `proc: NodeJS.Process = process` → always use `process` | a fake process is read rather than the real one |
| `...(pm ? { packageManager: pm } : {})` → `packageManager: pm` | an absent package manager is omitted |
| `${proc.platform}/${proc.arch}` → `proc.platform` | version and platform come from the running process |
| drop the `kind === 'environment'` branch in `cli.ts` | observe --kind environment populates itself |

- [ ] **Step 6: Commit**

```bash
git add packages/agent-journal/src/environment.ts packages/agent-journal/src/cli.ts \
        packages/agent-journal/src/index.ts packages/agent-journal/test/environment.test.ts \
        packages/agent-journal/test/cli.test.ts
git commit -m "feat(agent-journal): capture the toolchain that actually ran"
```

---

## Task 4: `path_claim` and the advisory read

**Files:**
- Create: `packages/agent-journal/src/claims.ts`
- Modify: `packages/agent-journal/src/cli.ts`, `packages/agent-journal/src/index.ts`
- Test: `packages/agent-journal/test/claims.test.ts`, `packages/agent-journal/test/cli.test.ts`

**Interfaces:**
- Consumes: `JournalEvent`.
- Produces:
  - `interface PathClaim { id, session, checkout, worktree?, branch?, claimedAt, expiresAt }`
  - `liveClaims(events, now: string): PathClaim[]`
  - CLI: `agent-journal claims --workspace <id>`

**§7.6, and the two things it forbids.**

A claim answers *"is another session in this checkout right now"* **before any entry exists** — at session start no files are in play, so decisions ranked by file relevance cannot answer it.

It is **advisory**. A starting session reads live claims and surfaces them; **it does not block**. Enforcing would need write-time coordination and would forfeit §7.1's "writes need no coordination". Do not add a refusal, a lock, or a wait anywhere in this task.

A claim also **expires**. Without a TTL a crashed session holds a claim forever and the feature becomes noise everyone learns to ignore. `ttlSeconds` is recorded on the observation and `expiresAt` is derived at read time — deriving at write time would bake in a clock the reader cannot re-evaluate.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-journal/test/claims.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveClaims } from '../src/claims.ts';
import { normalizeEvent } from '../src/envelope.ts';

function claim(id: string, session: string, time: string, data: Record<string, unknown>) {
  return normalizeEvent({
    schemaVersion: 1, id, source: `hook/h/${session}/primary`, sourceEpoch: 'e1', time,
    workspace: 'ws', session, agent: 'primary', author: 'agent', provenance: 'hook',
    harness: 'claude-code', context: 'coding', kind: 'path_claim', data,
  });
}
const BASE = { checkout: '/work/repo', worktree: '/work/repo', branch: 'main', ttlSeconds: '3600' };

test('a claim inside its TTL is live', () => {
  const c = claim('c1', 's1', '2026-09-08T10:00:00.000Z', BASE);
  assert.equal(liveClaims([c], '2026-09-08T10:30:00.000Z').length, 1);
});

// Without expiry a crashed session holds a claim forever and the feature becomes
// noise everyone ignores.
test('a claim past its TTL is not live', () => {
  const c = claim('c1', 's1', '2026-09-08T10:00:00.000Z', BASE);
  assert.equal(liveClaims([c], '2026-09-08T11:30:00.000Z').length, 0);
});

test('the TTL boundary is inclusive of its final second', () => {
  const c = claim('c1', 's1', '2026-09-08T10:00:00.000Z', BASE);
  assert.equal(liveClaims([c], '2026-09-08T11:00:00.000Z').length, 1, 'expired one second early');
  assert.equal(liveClaims([c], '2026-09-08T11:00:00.001Z').length, 0);
});

test('a session_end retires that session\'s claims', () => {
  const events = [
    claim('c1', 's1', '2026-09-08T10:00:00.000Z', BASE),
    normalizeEvent({
      schemaVersion: 1, id: 'e1', source: 'hook/h/s1/primary', sourceEpoch: 'e1',
      time: '2026-09-08T10:05:00.000Z', workspace: 'ws', session: 's1', agent: 'primary',
      author: 'agent', provenance: 'hook', harness: 'claude-code', context: 'coding',
      kind: 'session_end', data: { reason: 'closed' },
    }),
  ];
  assert.deepEqual(liveClaims(events, '2026-09-08T10:30:00.000Z'), []);
});

test('a later claim from one session replaces its earlier one', () => {
  const events = [
    claim('c1', 's1', '2026-09-08T10:00:00.000Z', BASE),
    claim('c2', 's1', '2026-09-08T10:10:00.000Z', { ...BASE, branch: 'feature' }),
  ];
  const live = liveClaims(events, '2026-09-08T10:30:00.000Z');
  assert.equal(live.length, 1);
  assert.equal(live[0]!.branch, 'feature');
});

test('two different sessions in one checkout both surface — this is the case it exists for', () => {
  const events = [
    claim('c1', 's1', '2026-09-08T10:00:00.000Z', BASE),
    claim('c2', 's2', '2026-09-08T10:01:00.000Z', BASE),
  ];
  assert.deepEqual(liveClaims(events, '2026-09-08T10:30:00.000Z').map((c) => c.session).sort(),
    ['s1', 's2']);
});

test('a claim with no checkout is skipped — it claims nothing', () => {
  const c = claim('c1', 's1', '2026-09-08T10:00:00.000Z', { ttlSeconds: '3600' });
  assert.deepEqual(liveClaims([c], '2026-09-08T10:30:00.000Z'), []);
});

test('an unusable ttlSeconds keeps the claim live and marks it, never silently drops it', () => {
  const c = claim('c1', 's1', '2026-09-08T10:00:00.000Z', { ...BASE, ttlSeconds: 'soon' });
  const live = liveClaims([c], '2026-09-09T10:00:00.000Z');
  assert.equal(live.length, 1, 'an unreadable TTL dropped the claim — the unsafe direction');
  assert.equal(live[0]!.malformedTtl, true);
});
```

```ts
// append to packages/agent-journal/test/cli.test.ts
test('claims lists live claims and says plainly that nothing is enforced', async () => {
  const dir = await root();
  await runCli(['observe', '--workspace', 'ws', '--kind', 'path_claim',
    '--checkout', '/work/repo', '--branch', 'main', '--ttlSeconds', '3600'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  const r = await runCli(['claims', '--workspace', 'ws'], { AGENT_JOURNAL_ROOT: dir });
  assert.equal(r.code, 0, 'claims must never fail on a healthy journal — it is advisory');
  const out = JSON.parse(r.stdout);
  assert.equal(out.claims.length, 1);
  assert.equal(out.claims[0].branch, 'main');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Expected: FAIL — `Cannot find module '../src/claims.ts'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/agent-journal/src/claims.ts
import type { JournalEvent } from './envelope.ts';

export interface PathClaim {
  readonly id: string;
  readonly session: string;
  readonly checkout: string;
  readonly worktree?: string;
  readonly branch?: string;
  readonly claimedAt: string;
  readonly expiresAt?: string;
  /** Set only when `ttlSeconds` was present and unreadable. */
  readonly malformedTtl?: true;
}

const DEFAULT_TTL_SECONDS = 3600;

function text(e: JournalEvent, field: string): string | undefined {
  const v = e.data[field];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * Spec 7.6. Advisory only: this reports, and nothing anywhere blocks, waits or
 * refuses on the result. Enforcing would need write-time coordination and would
 * forfeit 7.1's "writes need no coordination".
 *
 * `expiresAt` is derived here rather than stamped at write time, so a reader can
 * re-evaluate it against its own clock instead of trusting the writer's.
 *
 * An unreadable `ttlSeconds` keeps the claim LIVE and marks it, matching the
 * constraint-expiry rule: dropping is the unsafe direction, because a claim we
 * cannot read the lifetime of might still be held.
 */
export function liveClaims(events: readonly JournalEvent[], now: string): PathClaim[] {
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) {
    throw new TypeError(`now must be a parseable timestamp, got ${JSON.stringify(now)}`);
  }

  const ended = new Set<string>();
  for (const e of events) if (e.kind === 'session_end') ended.add(e.session);

  // Last claim per session wins; a session re-claiming replaces its own earlier one.
  const latest = new Map<string, JournalEvent>();
  for (const e of events) {
    if (e.kind !== 'path_claim' || ended.has(e.session)) continue;
    const prev = latest.get(e.session);
    if (!prev || Date.parse(e.time) >= Date.parse(prev.time)) latest.set(e.session, e);
  }

  const out: PathClaim[] = [];
  for (const e of latest.values()) {
    const checkout = text(e, 'checkout');
    if (!checkout) continue;                 // claims nothing

    const rawTtl = text(e, 'ttlSeconds');
    const ttl = rawTtl === undefined ? DEFAULT_TTL_SECONDS
      : /^\d+$/.test(rawTtl) ? Number(rawTtl) : null;

    const claimedMs = Date.parse(e.time);
    if (ttl !== null) {
      const expiresMs = claimedMs + ttl * 1000;
      if (nowMs > expiresMs) continue;
      out.push({
        id: e.id, session: e.session, checkout, claimedAt: e.time,
        expiresAt: new Date(expiresMs).toISOString(),
        ...(text(e, 'worktree') === undefined ? {} : { worktree: text(e, 'worktree')! }),
        ...(text(e, 'branch') === undefined ? {} : { branch: text(e, 'branch')! }),
      });
    } else {
      out.push({
        id: e.id, session: e.session, checkout, claimedAt: e.time, malformedTtl: true,
        ...(text(e, 'worktree') === undefined ? {} : { worktree: text(e, 'worktree')! }),
        ...(text(e, 'branch') === undefined ? {} : { branch: text(e, 'branch')! }),
      });
    }
  }
  return out;
}
```

In `cli.ts`, add `claims: ['workspace']` to `ALLOWED_FLAGS`, a usage line, and:

```ts
  if (command === 'claims') {
    const { events, unreadable, malformed } = await readAll(root, workspace);
    const claims = liveClaims(events, nowStamp());
    const damaged = unreadable.length > 0 || malformed.length > 0;
    return {
      code: damaged ? 1 : 0,
      stdout: `${JSON.stringify({ claims, advisory: true, unreadable, malformed }, null, 2)}\n`,
      stderr: damaged
        ? 'WARNING: this journal could not be fully read — the claims above are a floor.\n'
        : '',
    };
  }
```

`advisory: true` is in the payload deliberately: a consumer reading this must not be able to mistake it for a lock, and the field says so without a human having read the docs.

- [ ] **Step 4: Run the tests to verify they pass**

- [ ] **Step 5: Mutation-check**

| Mutation | Test that must go red |
| --- | --- |
| `nowMs > expiresMs` → `nowMs >= expiresMs` | the TTL boundary is inclusive |
| drop the `ended` filter | a session_end retires that session's claims |
| `>=` → `>` in the latest-per-session compare | a later claim replaces its earlier one |
| key `latest` by checkout instead of session | two different sessions in one checkout both surface |
| `if (!checkout) continue` removed | a claim with no checkout is skipped |
| unreadable ttl → `continue` instead of live-and-marked | an unusable ttlSeconds keeps the claim live |
| `malformedTtl: true` → `malformedTtl: false` on the good path | an unusable ttlSeconds marks it (absent vs false) |

- [ ] **Step 6: Commit**

```bash
git add packages/agent-journal/src/claims.ts packages/agent-journal/src/cli.ts \
        packages/agent-journal/src/index.ts packages/agent-journal/test/claims.test.ts \
        packages/agent-journal/test/cli.test.ts
git commit -m "feat(agent-journal): advisory path claims"
```

---

## Task 5: The Claude Code adapter

**Files:**
- Create: `adapters/claude-code/journal-hook.sh`, `adapters/claude-code/settings-fragment.json`, `adapters/claude-code/README.md`
- Test: `packages/agent-journal/test/adapter-claude-code.test.ts`

**Interfaces:**
- Consumes: the payload shape recorded in `adapters/NOTES.md` (Task 1) — **use what is written there, not what you assume**; `agent-journal observe`.

**Three rules this adapter lives by.**

1. **It never fails the tool call it observes.** Every path exits 0. A journal that breaks the agent it watches is uninstalled within a day, and then it records nothing at all. Redirect all output, trap errors, exit 0 unconditionally.
2. **It never blocks.** Hooks run inline. A hook that waits on a slow disk adds its latency to every tool call.
3. **It bypasses nothing.** It shells out to `agent-journal observe`, which redacts. A hook writing JSONL directly would be faster and would put tool inputs — the richest source of secrets in the system — on disk unscanned. The process spawn is the price of the fail-closed path, and it is worth paying; note the cost in the README rather than optimising it away.

- [ ] **Step 1: Write the hook script**

Derive event-name mapping and field extraction from `adapters/NOTES.md`. Structure:

```sh
#!/bin/sh
# Claude Code -> agent-journal. Never fails the call it observes: every path exits 0.
# See ../NOTES.md for the payload shape this parses, recorded by observation.
set -u
: "${AGENT_JOURNAL_WORKSPACE:?}" 2>/dev/null || exit 0   # unconfigured: do nothing, quietly
command -v agent-journal >/dev/null 2>&1 || exit 0

payload=$(cat 2>/dev/null) || exit 0
# ... map the event to a kind and its fields, per NOTES.md ...
agent-journal observe --workspace "$AGENT_JOURNAL_WORKSPACE" --kind "$kind" ... >/dev/null 2>&1
exit 0
```

- [ ] **Step 2: Write the test**

Test the script as a black box — feed it a payload on stdin with a scratch `AGENT_JOURNAL_ROOT`, then read the journal:

```ts
// packages/agent-journal/test/adapter-claude-code.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

// Rule 1, and the one that decides whether this ships at all: a hook that can
// fail the call it observes gets uninstalled, and then nothing is recorded.
test('the hook exits 0 on every malformed input', async () => {
  for (const payload of ['', 'not json', '{}', '{"hook_event_name":"Unknown"}', '[]']) {
    const { code } = await run('sh', [HOOK], { input: payload })
      .then(() => ({ code: 0 }))
      .catch((e: { code?: number }) => ({ code: e.code ?? 1 }));
    assert.equal(code, 0, `exited non-zero on ${JSON.stringify(payload)}`);
  }
});

test('the hook does nothing when the workspace is unconfigured', async () => {
  // no AGENT_JOURNAL_WORKSPACE: exits 0, writes nothing
});

test('a tool-call payload becomes a tool_call observation', async () => {
  // feed a payload shaped as NOTES.md records, then assert on the journal
});

test('a secret in a tool input does not reach disk', async () => {
  // the adapter must not be the one path that bypasses redaction
});
```

Fill these in from the real payload shape. **If `adapters/NOTES.md` records that an event could not be triggered, do not write a test asserting its payload** — mark it unverified in the README instead.

- [ ] **Step 3: Run, mutation-check, and verify the exit-0 rule by breaking the script deliberately**

Make `agent-journal` unavailable, make the payload garbage, make the journal root unwritable. In every case the hook exits 0 and the caller is unaffected.

- [ ] **Step 4: Write `settings-fragment.json` and the README**

The fragment is copy-pasteable into `~/.claude/settings.json`. The README covers installing it, setting `AGENT_JOURNAL_WORKSPACE`, verifying with `agent-journal coverage`, **the per-call process-spawn cost**, and — plainly — which events are wired and which are not.

- [ ] **Step 5: Commit**

```bash
git add adapters/claude-code packages/agent-journal/test/adapter-claude-code.test.ts
git commit -m "feat(adapters): Claude Code hooks write the observation plane"
```

---

## Task 6: The Codex adapter, and the skill reference

**Files:**
- Create: `adapters/codex/` (same three files), `skills/decision-journal/references/adapters.md`
- Modify: `skills/decision-journal/SKILL.md`
- Test: `packages/agent-journal/test/adapter-codex.test.ts`

**Why two adapters and not one.** Spec §16: *"Two adapters deliberately: a portable abstraction cannot be validated against one implementation."* The second adapter's job is to find out what the first one accidentally assumed. Where the two harnesses disagree, say so in `references/adapters.md` rather than papering over it.

**If Codex could not be exercised** (Task 1 will have recorded this), build against its published contract and mark the adapter **unverified** in its README and in the skill — clearly, not in a footnote. An adapter documented as tested when it was not is worse than one honestly labelled untested, and this project has already shipped one false "verified" claim.

- [ ] **Step 1: Build the adapter against `adapters/NOTES.md`**

- [ ] **Step 2: Write the same black-box tests**, including the exit-0-on-everything rule.

- [ ] **Step 3: Write `references/adapters.md`**

Covering: what the observation plane is and why it is not the agent's own account; installing each adapter; verifying with `coverage` that observations are arriving; **what is not captured** and therefore what anchors remain hand-typed; the per-call cost; and the honest status of each adapter.

- [ ] **Step 4: Add a short step to `SKILL.md`** pointing at it, in the skill's register — capability, and its limits, without marketing.

- [ ] **Step 5: Run every command block in the skill files verbatim, in document order, against one scratch workspace.** Watch for `--id` collisions across files. This step has caught a broken example in each of the last two plans.

- [ ] **Step 6: Gates and commit**

```bash
cd packages/agent-journal && pnpm verify
cd ../.. && node scripts/verify-skills.mjs && node --test test/*.test.mjs
git add adapters/codex skills/decision-journal packages/agent-journal/test/adapter-codex.test.ts
git commit -m "feat(adapters): Codex, and the adapter reference"
```

---

## Self-Review

**1. Spec coverage.** §4.4's observation family → Task 2. §2.1/§4.3's `environment` class → Task 3. §7.6 path claims, advisory and expiring → Task 4. §9.1/§9.2's adapters and the fallback ladder's rung 1 → Tasks 5 and 6. §16's "two adapters deliberately" → Task 6's framing.

**Not in this plan, and named so nobody assumes otherwise:** the HTTP and MCP sinks (§9.2 rungs 3 and 4) and the hosted sink (§9.3), which §13.1 makes a governance question before an infrastructure one; §10.1's rot and premise re-checks, now unblocked by Plan 3's traversal and the natural head of Plan 5; the `visual` anchor class.

**2. Placeholders.** Tasks 1–4 carry complete code. Tasks 5 and 6 deliberately carry *structure* rather than final scripts, because their content depends on Task 1's observations — writing the script here would be exactly the guessing this plan exists to avoid. That is a stated dependency, not an omission.

**3. Type consistency.** `OBSERVATION_KINDS`/`OBSERVATION_FIELDS`/`fieldsForObservation`/`normalizeObservationData` are defined in Task 2 and consumed in Tasks 3 and 4. `captureEnvironment` returns the `Environment` whose fields match `OBSERVATION_FIELDS.environment`. `PathClaim`'s fields match `OBSERVATION_FIELDS.path_claim` plus the derived `expiresAt`. `liveClaims` mirrors `liveConstraints`'s shape from Plan 3 on purpose — same failure direction, same marker convention.

**4. Ordering.** Task 1 gates 5 and 6. Task 2 gates 3 and 4 (both extend `observe`). Tasks 3 and 4 both edit `cli.ts` and `index.ts`, so they run sequentially even though they are logically independent.

**5. The risk worth naming.** Task 1 may find that a harness does not expose an event this plan assumes. That is a finding, not a failure: record it, wire what exists, and let `references/adapters.md` say what is not captured. A plan that quietly drops an unavailable event teaches the reader the journal is more complete than it is.
