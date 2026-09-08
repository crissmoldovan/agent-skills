# Agent Journal — Decay Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer the question the journal cannot currently answer about its own contents — *is any of this still true?* — for the sources that can be checked locally, and say plainly which ones cannot.

**Architecture:** One pure module computing decay over an event list, one CLI verb reporting it, and an environment-drift check that finally closes §2.1's canonical failure. Nothing is auto-resolved: a decision does not become wrong because a source moved.

**Tech Stack:** TypeScript with `--experimental-strip-types`, Node >= 24, `node:test`, no runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-07-agent-decision-journal-design.md` §10.1, with §2.1 and §5.6 for the premise check.

**Prior plans:** core, entry-surface, digest, observations — all merged to `main`.

## What the spec's own table gets slightly wrong, and what follows from it

§10.1 tabulates rot checks against `url`, `ticket`, `journal`, `codebase`, `visual`, `person` and `model_knowledge`. Six of those seven are **`INFLUENCE_TYPES`** (`src/entry.ts:3`). Only `visual` is an **`ANCHOR_CLASS`** (`src/envelope.ts:7`), and `codebase` is *not* an anchor class at all, though the table reads as though it were.

That is not a defect in the spec so much as a consequence worth stating outright, because it decides this plan's shape: **rot is a property of influences, not anchors.** An influence is a source the agent consulted, and a source can move or die. An anchor is system-produced evidence that something happened, and a commit sha does not move. The one genuine exception is `visual`, where the artefact behind the anchor advances on every save — which is exactly why §10.1 carves out `living` for it.

So the checker walks `influences[]`, plus `anchors[]` only for `visual`.

## Scope, and what is deliberately deferred

**In:** the checks that are local, deterministic, and need no credential.

| Influence type | Check | Why it is in |
| --- | --- | --- |
| `journal` | referenced entry superseded or invalidated | `project()` already computes this; pure |
| `codebase` | file, or `path:symbol`, gone | filesystem read |
| `tool_result` | referenced observation absent from the journal | pure |
| `person`, `model_knowledge`, `conversation` | **not checkable** — reported as such, never as passing | §10.1 requires this explicitly |

**Deferred, each for a stated reason** — recorded in the report as `not-implemented`, which is a third state distinct from `passing` and `not-checkable`:

- `url` — needs network egress. Non-deterministic, and a journal command that reaches the internet on a developer's machine needs a policy decision this plan should not make quietly.
- `ticket` — needs a tracker integration and a credential.
- `document` — no ref convention exists yet to resolve one against.
- `visual` — the `visual` anchor class has no producer: nothing in this codebase writes one, so a checker for it could never run against a real entry.
- **`living`** — §10.1 introduces it to suppress *content-hash* rot. This plan implements no hash-based check, so `living` would suppress nothing. Adding it now would ship a flag whose only effect is to be stored. It arrives with `url`.

**The premise check is in, in the one form that is actually deterministic.** §10.1 asks whether a premise "still reproduces". Re-running arbitrary reasoning is not automatable. What *is* automatable, and what §2.1 actually needs, is narrower and sharper: compare the environment recorded at decision time against the environment now. §2.1's canonical failure is an entry that is perfectly anchored and worthless because the suite ran against the wrong interpreter. An entry anchored to an `environment` observation carries the interpreter it was made under; a later reader can be told that interpreter is no longer the one in play. That is a premise check that can be run, and it is the specific one the design was written around.

## Global Constraints

- **Nothing is auto-resolved.** Every check reports; none invalidates, supersedes, or edits. §10.1: "A decision does not become wrong because a source moved." A command that auto-invalidated on a moved file would destroy sound records on a rename.
- **Three states, never two.** `passing`, `failing`, `not-checkable` and `not-implemented` are four distinct outcomes and must never collapse. In particular a `person` influence must never report as passing — "we could not check this" and "we checked and it is fine" are the distinction this whole design exists to preserve.
- **Node >= 24.** `pnpm test` from `packages/agent-journal`; never bare `node --test`, never Node 22.
- No new runtime dependencies. `null` is not `[]`; absent is not `''`; absent is not `false`.
- **Every new test mutation-checked.** Break the code, confirm the named test goes RED, restore. If a mutation stays GREEN, report and investigate — never retarget. A red mutation is necessary, not sufficient: `assert.ok(!x)` passes for `null`, `''`, `[]`, `undefined`.
- **For every compound guard, confirm each half fails alone.** Seven mutually-masking guards have been found across this project.
- Filesystem reads must not escape the declared repo root — reuse `canonicalize`'s approach from `cli.ts`, and write to the vetted path, never the unresolved one.
- Gates: `pnpm verify` in the package, `node scripts/verify-skills.mjs` (20 skills), `pnpm verify` at the root.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/decay.ts` (new) | Pure decay computation over an event list. No I/O. |
| `src/codebase.ts` (new) | The one check that touches the filesystem, isolated so `decay.ts` stays pure. |
| `src/cli.ts` (modify) | The `decay` subcommand. |
| `src/index.ts` (modify) | Exports. |
| `test/decay.test.ts`, `test/codebase.test.ts` (new) | One per module. |
| `test/cli.test.ts` (modify) | The subcommand end to end. |
| `skills/decision-journal/references/decay.md` (new) | What decays, what cannot be checked, and why nothing is auto-resolved. |

---

## Task 1: The pure checks

**Files:**
- Create: `packages/agent-journal/src/decay.ts`
- Test: `packages/agent-journal/test/decay.test.ts`

**Interfaces:**
- Consumes: `JournalEvent` from `./envelope.ts`; `project` from `./retract.ts`; `INFLUENCE_TYPES` from `./entry.ts`.
- Produces:
  - `type DecayStatus = 'passing' | 'failing' | 'not-checkable' | 'not-implemented'`
  - `interface DecayFinding { entryId, type, ref: string | null, status: DecayStatus, detail: string }`
  - `interface DecayReport { findings: DecayFinding[], checked: number, notCheckable: number, notImplemented: number }`
  - `computeDecay(events: readonly JournalEvent[], options?: { codebase?: ReadonlyMap<string, boolean> }): DecayReport`

The filesystem check is injected as a pre-resolved map so this module stays pure and testable. Task 2 builds the map; Task 3 wires them.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-journal/test/decay.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDecay } from '../src/decay.ts';
import { normalizeEvent } from '../src/envelope.ts';

function entry(id: string, influences: unknown[], extra: Record<string, unknown> = {}) {
  return normalizeEvent({
    schemaVersion: 1, id, source: 'cli/h/s/a', sourceEpoch: 'e1',
    time: '2026-09-08T10:00:00.000Z', workspace: 'ws', session: 's', agent: 'a',
    author: 'agent', provenance: 'cli', harness: 'test', context: 'coding',
    kind: 'decision', data: { question: 'q?', chosen: 'x', influences, ...extra },
  });
}

test('a journal influence pointing at an invalidated entry is failing', () => {
  const target = entry('t1', []);
  const bad = normalizeEvent({
    schemaVersion: 1, id: 'inv', source: 'cli/h/s/a', sourceEpoch: 'e1',
    time: '2026-09-08T11:00:00.000Z', workspace: 'ws', session: 's', agent: 'a',
    author: 'human', provenance: 'cli', harness: 'test', context: 'coding',
    kind: 'decision', data: { question: 'r', chosen: 'r', invalidates: 't1' },
  });
  const citing = entry('c1', [{ type: 'journal', role: 'decisive', ref: 't1' }]);
  const r = computeDecay([target, bad, citing]);
  const f = r.findings.find((x) => x.entryId === 'c1' && x.type === 'journal');
  assert.equal(f?.status, 'failing');
  assert.match(f!.detail, /invalidated/i);
});

test('a journal influence pointing at a superseded entry is failing, and says which', () => {
  const old = entry('o1', []);
  const replacement = entry('n1', [], { supersedes: 'o1' });
  const citing = entry('c1', [{ type: 'journal', role: 'supporting', ref: 'o1' }]);
  const f = computeDecay([old, replacement, citing]).findings
    .find((x) => x.entryId === 'c1');
  assert.equal(f?.status, 'failing');
  assert.match(f!.detail, /superseded/i, `detail did not distinguish the edge: ${f!.detail}`);
});

test('a journal influence pointing at a live entry passes', () => {
  const target = entry('t1', []);
  const citing = entry('c1', [{ type: 'journal', role: 'decisive', ref: 't1' }]);
  const f = computeDecay([target, citing]).findings.find((x) => x.entryId === 'c1');
  assert.equal(f?.status, 'passing');
});

// A dangling reference is not the same as a retracted one, and collapsing them
// would tell a reader their source was withdrawn when it was never there.
test('a journal influence pointing at nothing is failing, distinctly from retraction', () => {
  const citing = entry('c1', [{ type: 'journal', role: 'decisive', ref: 'ghost' }]);
  const f = computeDecay([citing]).findings.find((x) => x.entryId === 'c1');
  assert.equal(f?.status, 'failing');
  assert.match(f!.detail, /not present|unknown|no such/i);
  assert.doesNotMatch(f!.detail, /superseded|invalidated/i);
});

// 10.1 is explicit: never reported as passing. "We could not check" and "we
// checked and it is fine" are the distinction this design exists to preserve.
test('person and model_knowledge are not-checkable, never passing', () => {
  const citing = entry('c1', [
    { type: 'person', role: 'decisive', ref: 'ada' },
    { type: 'model_knowledge', role: 'supporting' },
    { type: 'conversation', role: 'considered', ref: 'thread-9' },
  ]);
  const r = computeDecay([citing]);
  for (const t of ['person', 'model_knowledge', 'conversation']) {
    const f = r.findings.find((x) => x.type === t);
    assert.equal(f?.status, 'not-checkable', `${t} reported ${f?.status}`);
  }
  assert.equal(r.notCheckable, 3);
  assert.equal(r.checked, 0, 'a not-checkable influence must not count as checked');
});

test('deferred types are not-implemented, which is not not-checkable', () => {
  const citing = entry('c1', [
    { type: 'url', role: 'decisive', ref: 'https://example.com/a' },
    { type: 'ticket', role: 'supporting', ref: 'ABC-1' },
  ]);
  const r = computeDecay([citing]);
  assert.equal(r.findings.find((x) => x.type === 'url')?.status, 'not-implemented');
  assert.equal(r.notImplemented, 2);
  assert.equal(r.notCheckable, 0, 'deferred and uncheckable are different claims');
});

test('a model_knowledge influence has no ref, and that is null rather than empty', () => {
  const citing = entry('c1', [{ type: 'model_knowledge', role: 'decisive' }]);
  const f = computeDecay([citing]).findings[0]!;
  assert.equal(f.ref, null);
});

// An entry that is itself retracted must not generate noise: its sources'
// health stopped mattering the moment it stopped counting.
test('a retracted entry is not decay-checked', () => {
  const dead = entry('d1', [{ type: 'journal', role: 'decisive', ref: 'ghost' }]);
  const killer = entry('k1', [], { invalidates: 'd1' });
  const r = computeDecay([dead, killer]);
  assert.deepEqual(r.findings.filter((f) => f.entryId === 'd1'), []);
});

test('observations carry no influences and produce no findings', () => {
  const obs = normalizeEvent({
    schemaVersion: 1, id: 'o1', source: 'hook/h/s/a', sourceEpoch: 'e1',
    time: '2026-09-08T10:00:00.000Z', workspace: 'ws', session: 's', agent: 'a',
    author: 'agent', provenance: 'hook', harness: 'test', context: 'coding',
    kind: 'tool_call', data: { tool: 'Bash' },
  });
  assert.deepEqual(computeDecay([obs]).findings, []);
});

// A tool_result influence names an observation. Plane A is exactly what makes
// this checkable at all -- before the observation plane there was nothing to
// look the ref up in.
test('a tool_result influence is checked against the observations present', () => {
  const obs = normalizeEvent({
    schemaVersion: 1, id: 'obs-1', source: 'hook/h/s/a', sourceEpoch: 'e1',
    time: '2026-09-08T10:00:00.000Z', workspace: 'ws', session: 's', agent: 'a',
    author: 'agent', provenance: 'hook', harness: 'test', context: 'coding',
    kind: 'tool_call', data: { tool: 'Bash' },
  });
  const ok = entry('c1', [{ type: 'tool_result', role: 'decisive', ref: 'obs-1' }]);
  const bad = entry('c2', [{ type: 'tool_result', role: 'decisive', ref: 'obs-missing' }]);
  const r = computeDecay([obs, ok, bad]);
  assert.equal(r.findings.find((x) => x.entryId === 'c1')?.status, 'passing');
  assert.equal(r.findings.find((x) => x.entryId === 'c2')?.status, 'failing');
});

test('a codebase influence uses the injected map, and is not-checkable without one', () => {
  const citing = entry('c1', [
    { type: 'codebase', role: 'decisive', ref: 'src/gone.ts' },
    { type: 'codebase', role: 'supporting', ref: 'src/here.ts' },
  ]);
  const withMap = computeDecay([citing], {
    codebase: new Map([['src/gone.ts', false], ['src/here.ts', true]]),
  });
  assert.equal(withMap.findings.find((f) => f.ref === 'src/gone.ts')?.status, 'failing');
  assert.equal(withMap.findings.find((f) => f.ref === 'src/here.ts')?.status, 'passing');
  // Without a map nothing was resolved, and saying "passing" would be a lie.
  const noMap = computeDecay([citing]);
  assert.equal(noMap.findings.find((f) => f.ref === 'src/gone.ts')?.status, 'not-checkable');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/agent-journal && pnpm test`
Expected: FAIL — `Cannot find module '../src/decay.ts'`.

- [ ] **Step 3: Write the implementation**

Key decisions to honour:

- Use `project(events)` for retraction state rather than re-deriving it. It already walks `influences` of type `journal` transitively; re-implementing that here would be a second traversal to keep in sync with the first.
- Skip entries whose own outcome is `invalidated` or `reverted`.
- `NOT_CHECKABLE = new Set(['person', 'model_knowledge', 'conversation'])`, `NOT_IMPLEMENTED = new Set(['url', 'ticket', 'document'])`. Anything in `INFLUENCE_TYPES` that is in neither set and has no checker is a bug, not a default — make the switch exhaustive so a new influence type fails the type-check rather than silently reporting `passing`.
- `ref` is `string | null`, never `''`.

- [ ] **Step 4: Run the tests to verify they pass**

- [ ] **Step 5: Mutation-check**

| Mutation | Test that must go red |
| --- | --- |
| `not-checkable` → `passing` for `person` | person and model_knowledge are not-checkable |
| merge `NOT_IMPLEMENTED` into `NOT_CHECKABLE` | deferred types are not-implemented |
| count not-checkable in `checked` | a not-checkable influence must not count as checked |
| drop the retracted-entry skip | a retracted entry is not decay-checked |
| dangling ref reported as `superseded` | a journal influence pointing at nothing |
| `codebase` with no map → `passing` | a codebase influence is not-checkable without one |
| `ref: ''` instead of `null` | a model_knowledge influence has no ref |

- [ ] **Step 6: Commit**

```bash
git add packages/agent-journal/src/decay.ts packages/agent-journal/test/decay.test.ts
git commit -m "feat(agent-journal): decay checks that never report unchecked as clean"
```

---

## Task 2: The filesystem check

**Files:**
- Create: `packages/agent-journal/src/codebase.ts`
- Test: `packages/agent-journal/test/codebase.test.ts`

**Interfaces:**
- Produces: `resolveCodebaseRefs(refs: readonly string[], repoRoot: string): Promise<Map<string, boolean>>`

**The ref convention, which this task defines:** `path/to/file.ts`, or `path/to/file.ts:symbolName`. A bare path checks existence. A `:symbol` form additionally requires the symbol's name to appear in the file — a grep, not a parse. Say so in the docs: this catches a deleted or renamed symbol and does not catch one that changed meaning, and claiming otherwise would be the overclaiming this project keeps correcting.

**Two guards, both load-bearing:**
- A ref must not escape `repoRoot`. `../../etc/passwd` is a ref an entry can legitimately contain by accident, and resolving it would let a journal read anywhere. Resolve, then verify containment, then read the *vetted* path — the same order and the same reason as `digest --out`.
- A ref that escapes is **not** `false` (which would read as "the file is gone"). It is a refusal, reported distinctly.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-journal/test/codebase.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveCodebaseRefs } from '../src/codebase.ts';

async function repo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'journal-repo-'));
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'src', 'here.ts'), 'export function present() {}\n');
  return dir;
}

test('an existing file resolves true, a missing one false', async () => {
  const dir = await repo();
  const m = await resolveCodebaseRefs(['src/here.ts', 'src/gone.ts'], dir);
  assert.equal(m.get('src/here.ts'), true);
  assert.equal(m.get('src/gone.ts'), false);
});

test('a symbol present in the file resolves true', async () => {
  const dir = await repo();
  const m = await resolveCodebaseRefs(['src/here.ts:present'], dir);
  assert.equal(m.get('src/here.ts:present'), true);
});

test('a symbol absent from an existing file resolves false', async () => {
  const dir = await repo();
  const m = await resolveCodebaseRefs(['src/here.ts:vanished'], dir);
  assert.equal(m.get('src/here.ts:vanished'), false);
});

test('a symbol in a missing file resolves false, not an error', async () => {
  const dir = await repo();
  const m = await resolveCodebaseRefs(['src/gone.ts:whatever'], dir);
  assert.equal(m.get('src/gone.ts:whatever'), false);
});

// A ref escaping the repo is a refusal, NOT `false` -- `false` reads as "the
// file is gone", which would be a false statement about a file that exists.
test('a ref escaping the repo root is refused, not reported missing', async () => {
  const dir = await repo();
  const m = await resolveCodebaseRefs(['../../../etc/hosts', '/etc/hosts'], dir);
  assert.equal(m.has('../../../etc/hosts'), false, 'an escaping ref must not be answered');
  assert.equal(m.has('/etc/hosts'), false);
});

test('a symlink pointing out of the repo is refused too', async () => {
  const dir = await repo();
  await symlink('/etc', join(dir, 'escape'));
  const m = await resolveCodebaseRefs(['escape/hosts'], dir);
  assert.equal(m.has('escape/hosts'), false, 'containment was checked before resolution');
});

test('a directory is not a file', async () => {
  const dir = await repo();
  const m = await resolveCodebaseRefs(['src'], dir);
  assert.equal(m.get('src'), false);
});
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement**

Read each file once even when several refs name it. Treat any read error as `false` except a containment failure, which omits the ref entirely.

- [ ] **Step 4: Run to verify they pass**

- [ ] **Step 5: Mutation-check**

| Mutation | Test that must go red |
| --- | --- |
| containment check removed | a ref escaping the repo root is refused |
| containment checked before symlink resolution | a symlink pointing out of the repo is refused |
| escaping ref → `false` instead of omitted | an escaping ref must not be answered |
| symbol check always true | a symbol absent from an existing file |
| `stat` existence without `isFile()` | a directory is not a file |

- [ ] **Step 6: Commit**

---

## Task 3: The `decay` command, and the environment-drift check

**Files:**
- Modify: `packages/agent-journal/src/cli.ts`, `packages/agent-journal/src/index.ts`, `packages/agent-journal/src/decay.ts`
- Test: `packages/agent-journal/test/cli.test.ts`, `packages/agent-journal/test/decay.test.ts`

**Interfaces:**
- CLI: `agent-journal decay --workspace <id> [--repo <path>]`
- Adds to `decay.ts`: environment drift, comparing an entry's `environment` anchor against a supplied current environment.

**The environment-drift check — the reason this plan matters most.** §2.1's canonical failure is an entry that is perfectly anchored and worthless because the suite ran against the wrong interpreter. An entry anchored `environment:<observation-id>` carries the toolchain it was decided under. Compare that observation's `interpreter` and `version` against `captureEnvironment()` now. A difference is **not** a failure — it is `drifted`, a distinct status, reported for a human to judge. The entry may be perfectly fine; what the reader needs to know is that its recorded ground has moved.

Add `'drifted'` to `DecayStatus`. It is not `failing`: a moved source is broken, a moved *environment* may simply be a different machine.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/agent-journal/test/decay.test.ts — append
test('an entry whose environment anchor differs from now is drifted, not failing', () => {
  const env = normalizeEvent({
    schemaVersion: 1, id: 'env-1', source: 'hook/h/s/a', sourceEpoch: 'e1',
    time: '2026-09-08T10:00:00.000Z', workspace: 'ws', session: 's', agent: 'a',
    author: 'agent', provenance: 'hook', harness: 'test', context: 'coding',
    kind: 'environment', data: { interpreter: '/opt/a/bin/node', version: 'v24.0.0' },
  });
  const e = entry('c1', [], { anchors: [{ type: 'environment', ref: 'env-1' }] });
  const r = computeDecay([env, e], {
    now: { interpreter: '/opt/b/bin/node', version: 'v26.7.0' },
  });
  const f = r.findings.find((x) => x.type === 'environment')!;
  assert.equal(f.status, 'drifted');
  assert.match(f.detail, /v24\.0\.0/, 'the recorded version must appear');
  assert.match(f.detail, /v26\.7\.0/, 'the current version must appear');
});

test('a matching environment passes, and drift is not reported as failing', () => {
  // ...same shape, identical interpreter and version -> 'passing'
  // and assert no finding anywhere in the report has status 'failing'
});

test('an environment anchor with no current environment supplied is not-checkable', () => {
  // computeDecay without `now` must not guess
});
```

```ts
// packages/agent-journal/test/cli.test.ts — append
test('decay reports findings and exits 0 on a healthy journal', async () => {
  // record an entry citing a live journal entry, run `decay`, expect code 0
  // and a findings array
});

// A reporting command that fails the build the moment a source moves would be
// switched off within a week, and 10.1 forbids auto-resolution anyway.
test('decay exits 0 even when findings are failing — it reports, it does not judge', async () => {
  // dangling journal ref -> a failing finding, still exit 0
});

test('decay warns and exits 1 when the journal itself could not be fully read', async () => {
  // mirrors `claims` and `show`: damaged journal is a different thing from
  // decayed sources
});

test('decay --repo is required before any codebase ref is resolved', async () => {
  // without --repo, codebase influences come back not-checkable, never passing
});
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement**

Register `decay: ['workspace', 'repo']` in `ALLOWED_FLAGS` — `unknownFlags()` returns `[]` for any unregistered command, so without this entry no flag is checked at all. Add the usage line. Default `--repo` to nothing rather than to `cwd`: silently scanning whatever directory the user happens to be in is a surprise, and `not-checkable` is the honest default.

- [ ] **Step 4: Run to verify they pass**

- [ ] **Step 5: Mutation-check**

| Mutation | Test that must go red |
| --- | --- |
| `drifted` → `failing` | drifted, not failing |
| exit 1 when findings are failing | decay exits 0 even when findings are failing |
| omit `decay` from `ALLOWED_FLAGS` | a typo'd flag on `decay` is accepted (add this test) |
| default `--repo` to `process.cwd()` | decay --repo is required before any codebase ref |
| drop the damaged-journal branch | decay warns and exits 1 when the journal could not be read |

- [ ] **Step 6: Commit**

---

## Task 4: Documentation

**Files:**
- Create: `skills/decision-journal/references/decay.md`
- Modify: `skills/decision-journal/SKILL.md`

Cover: what decays and what does not; the four statuses and why `not-checkable` exists as its own state; why nothing is auto-resolved; the `codebase` ref convention **and its honest limit** (a grep finds a deleted symbol, not a changed one); which types are deferred and why; and the environment-drift check with its link back to §2.1's failure.

**Then run every command block in the skill's files verbatim, in document order, against one scratch workspace**, watching for `--id` collisions. This step has caught a broken documented example in two of the last three plans.

- [ ] **Step 1: Write `references/decay.md`**
- [ ] **Step 2: Add a step to `SKILL.md`** — capability and its limits, no marketing.
- [ ] **Step 3: Execute every documented command block**
- [ ] **Step 4: Gates** — `pnpm verify`, `node scripts/verify-skills.mjs` (20 skills), root `pnpm verify`
- [ ] **Step 5: Commit**

---

## Self-Review

**1. Spec coverage.** §10.1's rot table → Task 1, with the deferred rows named and reasoned rather than dropped. §10.1's "reported, never auto-resolved" → a global constraint and a CLI test. §10.1's premise check and §2.1 → Task 3's environment drift. §10.1's `living` → deliberately deferred, with the reason stated (it suppresses hash-based rot, and no hash check ships here).

**2. Placeholders.** Tasks 1 and 2 carry complete test code. Task 3's CLI tests are described rather than written out, because their exact fixtures depend on Task 1's final `DecayFinding` shape — a stated dependency. Task 3's two `decay.test.ts` additions after the first are sketched for the same reason; the first is complete and establishes the pattern.

**3. Type consistency.** `DecayStatus` gains `'drifted'` in Task 3 — noted there explicitly rather than silently widening Task 1's union. `DecayFinding.ref` is `string | null` throughout. `resolveCodebaseRefs` returns exactly the `ReadonlyMap<string, boolean>` that `computeDecay`'s `codebase` option consumes.

**4. The risk worth naming.** The `codebase` symbol check is a grep. It will report `passing` for a symbol that still exists under the same name and now means something else. That is a real limit, it is stated in the docs rather than hidden, and the alternative — parsing every language a journal might reference — is not a thing this plan should attempt.
