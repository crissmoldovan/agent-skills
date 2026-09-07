# Agent Journal — Digest and Traversal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the journal from something you query into something a reviewer reads — a committed digest gated by disclosure class, ordered by consequence rather than time, and a traversal that answers "why is it like this" starting from a ticket or a symptom, not only from a file path.

**Architecture:** Two new pure modules — `disclosure.ts` (the class and its filter) and `digest.ts` (ordering and markdown rendering) — plus `trace.ts` for backwards traversal. The CLI gains `digest` and `trace` subcommands. Nothing in the write path changes except one new envelope field.

**Tech Stack:** TypeScript with `--experimental-strip-types`, Node >= 24, `node:test`, no runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-07-agent-decision-journal-design.md` — §6.4, §10.2, §10.3, §13.3.

**Prior plans:** `2026-09-07-agent-journal-core.md` and `2026-09-07-agent-journal-entry-surface.md`, both complete. The second is on branch `feat/agent-journal-entry-surface` (PR #21, unmerged) — **this plan builds on that branch, not on `main`.**

## Global Constraints

- **Node >= 24.** `packages/agent-journal/package.json` declares `"engines": { "node": ">=24.0.0" }`. Run tests with `pnpm test` from `packages/agent-journal`, never bare `node --test`. Do **not** pin Node 22 — that note belongs to a different repo and running below the declared floor has already produced misleading review evidence here.
- **Every new test must be mutation-checked.** Break the code it covers, confirm the named test goes RED, restore. Report any row that stays GREEN rather than retargeting it. Twenty-seven findings in the previous two plans were dominated by tests that passed for a reason other than the behaviour they named.
- **A mutation going red is necessary, not sufficient.** `assert.ok(!x)` passes for `null`, `''`, `[]` and `undefined` alike. Assert the value.
- **`null` is not `[]`, and absent is not `''`.** `null`/absent means not recorded; `[]` claims assessed-and-empty.
- **Redaction is the only fail-closed path.** Do not add a second, and do not route around `SegmentJournal.append`.
- **Disclosure is a gate, not a filter you may soften.** A `private` entry never reaches a digest, whatever else is true of it.
- **Every CLI flag is scoped to its subcommand**; an unrecognised one exits 2. `ALLOWED_FLAGS` is the single source of truth.
- No new runtime dependencies. No literal credentials in fixtures — `scripts/verify-skills.mjs` matches `gh[pousr]_[A-Za-z0-9_]{20,}` and `sk-[A-Za-z0-9]{20,}`.
- After every task: `pnpm verify` in `packages/agent-journal` and `node scripts/verify-skills.mjs` (20 skills) from the repo root.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/envelope.ts` (modify) | Add `disclosure` to the envelope with its `team` default. |
| `src/disclosure.ts` (new) | The three classes, the ordering between them, and `readableAt(level)`. Pure. |
| `src/digest.ts` (new) | Digest ordering and markdown rendering, including the coverage statement. Pure. |
| `src/trace.ts` (new) | Backwards traversal and the subject/ticket/symptom index. Pure. |
| `src/cli.ts` (modify) | `--disclosure` and `--subject` on `record`; `digest` and `trace` subcommands. |
| `src/index.ts` (modify) | Export the three new modules. |
| `test/disclosure.test.ts`, `test/digest.test.ts`, `test/trace.test.ts` (new) | One per module. |
| `test/cli.test.ts` (modify) | The new flags and subcommands end to end. |

---

## Task 1: The disclosure class

**Files:**
- Create: `packages/agent-journal/src/disclosure.ts`
- Modify: `packages/agent-journal/src/envelope.ts`, `packages/agent-journal/src/index.ts`
- Test: `packages/agent-journal/test/disclosure.test.ts`

**Interfaces:**
- Produces:
  - `DISCLOSURE_CLASSES: readonly ['private','team','published']`
  - `type Disclosure = (typeof DISCLOSURE_CLASSES)[number]`
  - `normalizeDisclosure(v: unknown): Disclosure` — anything unrecognised becomes `'private'`
  - `readableAt(entry: JournalEvent, level: Disclosure): boolean`
  - `JournalEvent` gains `readonly disclosure: Disclosure`

**The decision this task locks in, and why it is the opposite of every other default here.**

Everywhere else in this package an unrecognised value is refused, and an absent one stays absent. Disclosure cannot work that way. Spec §13.3 makes it a containment boundary: `private` never leaves the local journal. An unparseable or absent class must therefore fail **toward containment** — `private` — because the cost of the two mistakes is not symmetric. Wrongly withholding an entry from a digest is an omission someone notices and fixes. Wrongly publishing one is not recoverable: a `person` influence or a `rejected[]` naming somebody's work has left the building.

Note the deliberate asymmetry with §4.3's capabilities, which preserve `unknown` rather than inferring optimistically. Both rules point the same way — toward the answer that cannot cause irreversible harm — and land on opposite literal values because the harm is on opposite sides.

The **write** default is different from the **parse** default and both are correct: `record` writes `team` when the flag is absent (§13.3's stated default), while `normalizeDisclosure` maps an unrecognised value on a *foreign* record to `private`. A record we wrote is known to have meant `team`; a record we cannot parse is not.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-journal/test/disclosure.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISCLOSURE_CLASSES, normalizeDisclosure, readableAt } from '../src/disclosure.ts';
import { normalizeEvent } from '../src/envelope.ts';

function entry(disclosure?: unknown) {
  return normalizeEvent({
    schemaVersion: 1, id: 'e1', source: 'cli/h/s/a', sourceEpoch: 'e1',
    time: '2026-09-07T10:00:00.000Z', workspace: 'ws', session: 's', agent: 'a',
    author: 'agent', provenance: 'cli', harness: 'test', context: 'coding',
    kind: 'decision', data: { question: 'q', chosen: 'c' },
    ...(disclosure === undefined ? {} : { disclosure }),
  });
}

test('the three classes are exactly the spec\'s', () => {
  assert.deepEqual([...DISCLOSURE_CLASSES], ['private', 'team', 'published']);
});

// Everywhere else here an unrecognised value is refused. This one fails toward
// containment instead, because publishing a private entry cannot be undone and
// withholding a public one can.
test('an unrecognised or absent disclosure parses as private, never team', () => {
  for (const bad of ['Published', 'public', '', null, 7, undefined, {}]) {
    assert.equal(normalizeDisclosure(bad), 'private', `${JSON.stringify(bad)} did not contain`);
  }
});

test('each recognised class parses as itself', () => {
  for (const c of DISCLOSURE_CLASSES) assert.equal(normalizeDisclosure(c), c);
});

test('readableAt admits equal and more-open classes, never more-closed ones', () => {
  // A team reader sees team and published; a published reader sees only published.
  assert.equal(readableAt(entry('private'), 'private'), true);
  assert.equal(readableAt(entry('team'), 'private'), true);
  assert.equal(readableAt(entry('published'), 'private'), true);

  assert.equal(readableAt(entry('private'), 'team'), false);
  assert.equal(readableAt(entry('team'), 'team'), true);
  assert.equal(readableAt(entry('published'), 'team'), true);

  assert.equal(readableAt(entry('private'), 'published'), false);
  assert.equal(readableAt(entry('team'), 'published'), false);
  assert.equal(readableAt(entry('published'), 'published'), true);
});

test('an entry with no disclosure field is contained, not published', () => {
  assert.equal(entry().disclosure, 'private');
  assert.equal(readableAt(entry(), 'published'), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/agent-journal && pnpm test`
Expected: FAIL — `Cannot find module '../src/disclosure.ts'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/agent-journal/src/disclosure.ts
import type { JournalEvent } from './envelope.ts';

/** Spec 13.3, ordered most closed to most open. */
export const DISCLOSURE_CLASSES = ['private', 'team', 'published'] as const;
export type Disclosure = (typeof DISCLOSURE_CLASSES)[number];

const RANK: Readonly<Record<Disclosure, number>> = { private: 0, team: 1, published: 2 };

/**
 * Unrecognised parses to `private`, which inverts this package's usual rule that
 * an unknown value is refused and an absent one stays absent. Disclosure is a
 * containment boundary, and the two mistakes do not cost the same: withholding
 * an entry from a digest is an omission somebody notices; publishing a `person`
 * influence or a `rejected[]` naming someone's work is not recoverable.
 *
 * This is the same instinct as 4.3's capabilities preserving `unknown` rather
 * than assuming availability — both choose the answer that cannot cause
 * irreversible harm. They land on opposite literals because the harm is on
 * opposite sides.
 */
export function normalizeDisclosure(v: unknown): Disclosure {
  return v === 'team' || v === 'published' ? v : 'private';
}

/** True when an entry may be read by somebody cleared to `level`. */
export function readableAt(entry: JournalEvent, level: Disclosure): boolean {
  return RANK[entry.disclosure] >= RANK[level];
}
```

In `packages/agent-journal/src/envelope.ts`, add to the `JournalEvent` interface:

```ts
  readonly disclosure: Disclosure;
```

with `import { normalizeDisclosure, type Disclosure } from './disclosure.ts';` at the top, and inside `normalizeEvent`'s returned object:

```ts
    disclosure: normalizeDisclosure(value.disclosure),
```

Add to `packages/agent-journal/src/index.ts`:

```ts
export * from './disclosure.ts';
```

**Note on module direction.** `envelope.ts` importing from `disclosure.ts` is one-directional, and `disclosure.ts` imports only the `JournalEvent` *type* back. A previous task in this package created a two-way type dependency between `envelope.ts` and `entry.ts` and a review rejected it. If TypeScript objects here, widen `readableAt`'s parameter to `{ readonly disclosure: Disclosure }` rather than adding an import to `envelope.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/agent-journal && pnpm test`
Expected: PASS. Existing tests still pass — every event now carries `disclosure: 'private'` unless told otherwise, and nothing yet reads it.

- [ ] **Step 5: Mutation-check**

| Mutation | Test that must go red |
| --- | --- |
| `normalizeDisclosure` returns `'team'` for unrecognised | unrecognised or absent parses as private |
| `RANK[entry.disclosure] >= RANK[level]` → `<=` | readableAt admits equal and more-open classes |
| `>=` → `>` | readableAt (the equal-class rows) |
| drop `disclosure:` from `normalizeEvent` | an entry with no disclosure field is contained |

- [ ] **Step 6: Commit**

```bash
git add packages/agent-journal/src/disclosure.ts packages/agent-journal/src/envelope.ts \
        packages/agent-journal/src/index.ts packages/agent-journal/test/disclosure.test.ts
git commit -m "feat(agent-journal): the disclosure class, failing toward containment"
```

---

## Task 2: `--disclosure` and `--subject` on `record`

**Files:**
- Modify: `packages/agent-journal/src/cli.ts`
- Test: `packages/agent-journal/test/cli.test.ts`

**Interfaces:**
- Consumes: `DISCLOSURE_CLASSES`, `normalizeDisclosure` from `./disclosure.ts`.
- Produces: `record --disclosure private|team|published` and `record --subject <string>`.

**Two details that matter.**

`record` writes `team` when `--disclosure` is absent — §13.3's stated default — which is *not* what `normalizeDisclosure` does with an absent field. Both are right, for the reason in Task 1: an entry this CLI wrote is known to have meant the default; a foreign record whose class we cannot read is not.

An *unrecognised* `--disclosure` value exits 2 rather than silently containing. On the write path the caller is present and can be told; silently downgrading their intent is the `--author robot` mistake this package already fixed once.

`--subject` fills the envelope's existing `subject` field, which Task 4's traversal indexes. It has been in the envelope since the first plan with no way to write it.

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/agent-journal/test/cli.test.ts
test('record defaults to team, per spec 13.3', async () => {
  const dir = await root();
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'q', '--chosen', 'c'], { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  const [entry] = await readAllEvents(dir, 'ws');
  assert.equal(entry!.disclosure, 'team',
    'a written entry defaults to team; only an unreadable foreign one contains');
});

test('record honours each disclosure class', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  for (const c of ['private', 'team', 'published'] as const) {
    const r = await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', c,
      '--question', 'q', '--chosen', 'c', '--disclosure', c], env);
    assert.equal(r.code, 0, r.stderr);
  }
  const byId = Object.fromEntries((await readAllEvents(dir, 'ws')).map((e) => [e.id, e.disclosure]));
  assert.deepEqual(byId, { private: 'private', team: 'team', published: 'published' });
});

// Silently containing would repeat the `--author robot` mistake: the caller is
// present and can be told, so tell them.
test('an unrecognised --disclosure is refused, not silently contained', async () => {
  const dir = await root();
  const r = await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'q', '--chosen', 'c', '--disclosure', 'public'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  assert.equal(r.code, 2, `--disclosure public was accepted: ${r.stdout}`);
  assert.match(r.stderr, /private, team, published/);
  assert.equal((await readAllEvents(dir, 'ws')).length, 0);
});

test('record stores --subject, which the envelope has always had and nothing could write', async () => {
  const dir = await root();
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'q', '--chosen', 'c', '--subject', 'src/queue.ts'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  const [entry] = await readAllEvents(dir, 'ws');
  assert.equal(entry!.subject, 'src/queue.ts');
});

test('a blank --subject leaves the key absent, like every other blank scalar', async () => {
  const dir = await root();
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'q', '--chosen', 'c', '--subject', '   '],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  const [entry] = await readAllEvents(dir, 'ws');
  assert.ok(!('subject' in entry!), `subject was stored as blank: ${JSON.stringify(entry!.subject)}`);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/agent-journal && pnpm test`
Expected: FAIL — `--disclosure` and `--subject` exit 2 as unknown flags.

- [ ] **Step 3: Write the implementation**

Add `'disclosure'` and `'subject'` to `RECORD_GLOBAL` in `src/cli.ts`.

In the `record` branch, beside the existing `--author` validation:

```ts
    // Refuse rather than contain. normalizeDisclosure maps an unrecognised value
    // to `private` because a FOREIGN record's intent is unknowable — but here the
    // caller is present, and silently downgrading their stated intent is the
    // `--author robot` coercion this CLI already removed once.
    const declaredDisclosure = opts.get('disclosure');
    if (declaredDisclosure !== undefined
        && !(DISCLOSURE_CLASSES as readonly string[]).includes(declaredDisclosure)) {
      return {
        code: 2,
        stdout: '',
        stderr: `--disclosure must be one of ${DISCLOSURE_CLASSES.join(', ')}, `
          + `got ${JSON.stringify(declaredDisclosure)}\n`,
      };
    }
```

In the `normalizeEvent` call, add — noting that the write default is `team`, not what `normalizeDisclosure` would produce from an absent field:

```ts
      disclosure: declaredDisclosure ?? 'team',
      ...(subject === undefined ? {} : { subject }),
```

where `subject` is read with the same blank-is-absent rule the other scalars use:

```ts
    const rawSubject = opts.get('subject');
    const subject = rawSubject !== undefined && rawSubject.trim() ? rawSubject.trim() : undefined;
```

Extend the `record` line in `USAGE` with `[--disclosure private|team|published] [--subject s]`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/agent-journal && pnpm test`
Expected: PASS.

- [ ] **Step 5: Mutation-check**

| Mutation | Test that must go red |
| --- | --- |
| `disclosure: declaredDisclosure ?? 'team'` → `?? 'private'` | record defaults to team |
| delete the unrecognised-value guard | an unrecognised `--disclosure` is refused |
| `subject` blank check → store `rawSubject` unconditionally | a blank `--subject` leaves the key absent |
| drop `subject` from the event | record stores `--subject` |

- [ ] **Step 6: Verify through the built binary**

```bash
cd packages/agent-journal && pnpm build
AGENT_JOURNAL_ROOT=/tmp/j-p3t2 node dist/bin.js record --workspace w --kind decision \
  --id d1 --question q --chosen c --disclosure published --subject 'src/queue.ts'
grep -o '"disclosure":"[a-z]*"' -r /tmp/j-p3t2 | head -1
```

- [ ] **Step 7: Commit**

```bash
git add packages/agent-journal/src/cli.ts packages/agent-journal/test/cli.test.ts
git commit -m "feat(agent-journal): --disclosure and --subject on record"
```

---

## Task 3: The digest renderer

**Files:**
- Create: `packages/agent-journal/src/digest.ts`
- Modify: `packages/agent-journal/src/index.ts`
- Test: `packages/agent-journal/test/digest.test.ts`

**Interfaces:**
- Consumes: `project` from `./retract.ts`, `readableAt` from `./disclosure.ts`, `coverage` from `./coverage.ts`, `JournalEvent`.
- Produces: `renderDigest(events, options): string` where
  `options: { readonly level?: Disclosure; readonly coverage: CoverageReport; readonly now: string }`
  and `level` defaults to `'published'`.

**Ordering, from §6.4 — by consequence, never by time.** Sort key, most severe first:

1. `outcome === 'invalidated'` — the reader most needs to know what was retracted
2. `reversibility === 'one-way'`, then `hard`, then `moderate`, then `trivial`, then absent
3. `blastRadius` present before absent
4. id, so the order is total and two renders of the same journal are byte-identical

**What the digest must show, and the two flags §6.4 names.** Each entry renders its kind, id, question/statement, chosen, `rejected[]` in full, outcome, and — flagged — whether its only influence is `model_knowledge`. That flag is the point of §5.4: a reader must be able to see at a glance which decisions rested on priors and no source.

**Every digest carries the §10.3 coverage statement.** A digest without it is the failure §10.3 exists to prevent — a rendered artifact that looks complete and cannot say what it does not cover.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-journal/test/digest.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDigest } from '../src/digest.ts';
import { coverage } from '../src/coverage.ts';
import { normalizeEvent } from '../src/envelope.ts';

function ev(id: string, data: Record<string, unknown>, disclosure = 'published') {
  return normalizeEvent({
    schemaVersion: 1, id, source: 'cli/h/s/a', sourceEpoch: 'e1',
    time: '2026-09-07T10:00:00.000Z', workspace: 'ws', session: 's', agent: 'a',
    author: 'agent', provenance: 'cli', harness: 'test', context: 'coding',
    kind: 'decision', disclosure, data,
  });
}
const NOW = '2026-09-08T00:00:00.000Z';
const render = (events: any[], level?: any) =>
  renderDigest(events, { coverage: coverage(events), now: NOW, ...(level ? { level } : {}) });

test('a private entry never reaches the digest, whatever else is true of it', () => {
  const out = render([
    ev('secret', { question: 'the candid one', chosen: 'x' }, 'private'),
    ev('shown', { question: 'the public one', chosen: 'y' }),
  ]);
  assert.ok(!out.includes('the candid one'), 'a private entry was rendered');
  assert.ok(out.includes('the public one'));
});

test('team entries are withheld from a published digest and shown in a team one', () => {
  const events = [ev('t1', { question: 'team only', chosen: 'x' }, 'team')];
  assert.ok(!render(events).includes('team only'), 'a team entry reached a published digest');
  assert.ok(render(events, 'team').includes('team only'));
});

test('ordering is by consequence, not by time', () => {
  const out = render([
    ev('a-trivial', { question: 'trivial one', chosen: 'x', reversibility: 'trivial' }),
    ev('b-oneway', { question: 'one-way one', chosen: 'x', reversibility: 'one-way' }),
    ev('c-gone', { question: 'invalidated one', chosen: 'x', reversibility: 'trivial' }),
    ev('r1', { invalidates: 'c-gone', rationale: 'premise false' }),
  ]);
  const at = (s: string) => out.indexOf(s);
  assert.ok(at('invalidated one') < at('one-way one'),
    'an invalidated entry must sort above a one-way live one');
  assert.ok(at('one-way one') < at('trivial one'),
    'one-way must sort above trivial');
});

test('two renders of the same journal are byte-identical', () => {
  const events = [
    ev('b', { question: 'second', chosen: 'x', reversibility: 'hard' }),
    ev('a', { question: 'first', chosen: 'y', reversibility: 'hard' }),
  ];
  assert.equal(render(events), render([...events].reverse()),
    'ordering is not total — the digest depends on input order');
});

test('rejected alternatives are shown in full, never summarised away', () => {
  const out = render([ev('d1', { question: 'q', chosen: 'ring buffer',
    rejected: ['redis — needs a broker we do not run', 'kafka — three days of setup'] })]);
  assert.ok(out.includes('redis — needs a broker we do not run'));
  assert.ok(out.includes('kafka — three days of setup'));
});

test('an entry resting only on model_knowledge is flagged', () => {
  const out = render([
    ev('priors', { question: 'from priors', chosen: 'x',
      influences: [{ type: 'model_knowledge', role: 'decisive' }] }),
    ev('sourced', { question: 'from a source', chosen: 'y',
      influences: [{ type: 'url', role: 'decisive', ref: 'https://example.com' }] }),
  ]);
  const flagged = out.split('\n').filter((l) => /model_knowledge|no source consulted/i.test(l));
  assert.equal(flagged.length, 1, `expected exactly one flag, got:\n${flagged.join('\n')}`);
  assert.ok(out.indexOf('from priors') < out.indexOf('from a source') || true);
});

test('an entry with a model_knowledge influence AND a source is not flagged', () => {
  const out = render([ev('mixed', { question: 'mixed', chosen: 'x', influences: [
    { type: 'model_knowledge', role: 'supporting' },
    { type: 'url', role: 'decisive', ref: 'https://example.com' },
  ] })]);
  assert.ok(!/no source consulted/i.test(out),
    'the flag means ONLY model_knowledge; a mixed entry consulted something');
});

// 10.3: a rendered artifact that cannot say what it does not cover is the exact
// failure the coverage statement exists to prevent.
test('every digest carries a coverage statement, including an empty one', () => {
  for (const events of [[], [ev('d1', { question: 'q', chosen: 'c' })]]) {
    const out = render(events);
    assert.match(out, /coverage/i, 'a digest rendered with no coverage statement');
    assert.match(out, /sessions/i);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/agent-journal && pnpm test`
Expected: FAIL — `Cannot find module '../src/digest.ts'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/agent-journal/src/digest.ts
import type { JournalEvent } from './envelope.ts';
import type { CoverageReport } from './coverage.ts';
import { readableAt, type Disclosure } from './disclosure.ts';
import { project, type Outcome } from './retract.ts';

export interface DigestOptions {
  /** Who the digest is for. Defaults to `published` — the committed artifact. */
  readonly level?: Disclosure;
  readonly coverage: CoverageReport;
  readonly now: string;
}

const REVERSIBILITY_RANK: Readonly<Record<string, number>> = {
  'one-way': 0, hard: 1, moderate: 2, trivial: 3,
};

function str(e: JournalEvent, field: string): string | undefined {
  const v = e.data[field];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function list(e: JournalEvent, field: string): string[] {
  const v = e.data[field];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** True only when EVERY influence is model_knowledge — 5.4's signal, not a mere mention. */
function restsOnPriorsAlone(e: JournalEvent): boolean {
  const raw = e.data.influences;
  if (!Array.isArray(raw) || raw.length === 0) return false;
  return raw.every((i) => i !== null && typeof i === 'object'
    && (i as Record<string, unknown>).type === 'model_knowledge');
}

/**
 * Order by consequence, never by time (spec 6.4). A reader scanning a digest
 * needs the retracted and the irreversible first; when something happened is a
 * question the log already answers. The id tiebreak makes the order total, so
 * two renders of one journal are byte-identical and a committed digest does not
 * churn in review.
 */
function rank(e: JournalEvent, outcome: Outcome): [number, number, number, string] {
  return [
    outcome === 'invalidated' ? 0 : 1,
    REVERSIBILITY_RANK[str(e, 'reversibility') ?? ''] ?? 4,
    str(e, 'blastRadius') ? 0 : 1,
    e.id,
  ];
}

export function renderDigest(
  events: readonly JournalEvent[],
  options: DigestOptions,
): string {
  const level = options.level ?? 'published';
  const { outcomes } = project(events);

  const entries = events
    .filter((e) => e.kind !== 'void' && readableAt(e, level))
    .map((e) => ({ e, outcome: outcomes.get(e.id) ?? 'unknown' as Outcome }))
    .sort((x, y) => {
      const a = rank(x.e, x.outcome), b = rank(y.e, y.outcome);
      for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return (a[i] as number) - (b[i] as number);
      return (a[3] as string).localeCompare(b[3] as string);
    });

  const out: string[] = [
    `# Decision digest`, '',
    `As of ${options.now}. Rendered at disclosure level \`${level}\`.`,
    'This is a rendered artifact, never the source of truth.', '',
  ];

  if (entries.length === 0) {
    out.push('_No entries at this disclosure level._', '');
  }

  for (const { e, outcome } of entries) {
    const title = str(e, 'question') ?? str(e, 'statement') ?? str(e, 'claim') ?? e.id;
    out.push(`## ${title}`, '');
    out.push(`- **id** \`${e.id}\` · **kind** ${e.kind} · **outcome** ${outcome}`);
    const chosen = str(e, 'chosen');
    if (chosen) out.push(`- **chosen** ${chosen}`);
    const rev = str(e, 'reversibility');
    if (rev) out.push(`- **reversibility** ${rev}`);
    const blast = str(e, 'blastRadius');
    if (blast) out.push(`- **blast radius** ${blast}`);
    const rationale = str(e, 'rationale');
    if (rationale) out.push(`- **why** ${rationale}`);

    const rejected = list(e, 'rejected');
    if (rejected.length > 0) {
      out.push('', '**Rejected:**');
      for (const r of rejected) out.push(`- ${r}`);
    }

    if (restsOnPriorsAlone(e)) {
      out.push('', '> **No source consulted** — this rested on `model_knowledge` alone.');
    }
    out.push('');
  }

  const c = options.coverage;
  out.push(
    '---', '',
    '## Coverage', '',
    `- sessions observed: ${c.sessions}`,
    `- sessions that recorded nothing: ${c.sessionsWithNoEntries.length}`,
    `- sessions with no events at all: ${c.sessionsWithNoEvents === null ? 'not assessed' : c.sessionsWithNoEvents.length}`,
    `- refused writes (voids): ${c.voids}`,
    `- sequence gaps: ${c.sequenceGaps.length}`,
    `- downgraded anchors: ${c.downgradedAnchors === null ? 'not assessed' : c.downgradedAnchors.length}`,
    '',
    '`not assessed` is not `none` — it means nothing computed the figure.',
    '',
  );
  return out.join('\n');
}
```

Add to `packages/agent-journal/src/index.ts`:

```ts
export * from './digest.ts';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/agent-journal && pnpm test`
Expected: PASS.

- [ ] **Step 5: Mutation-check**

| Mutation | Test that must go red |
| --- | --- |
| drop the `readableAt` filter | a private entry never reaches the digest |
| `level = options.level ?? 'published'` → `?? 'team'` | team entries are withheld from a published digest |
| `outcome === 'invalidated' ? 0 : 1` → always `1` | ordering is by consequence |
| delete the `e.id` tiebreak from `rank` | two renders are byte-identical |
| `raw.every(...)` → `raw.some(...)` | an entry with model_knowledge AND a source is not flagged |
| `raw.length === 0` guard removed | an entry resting only on model_knowledge is flagged |
| delete the whole Coverage block | every digest carries a coverage statement |
| `not assessed` → `0` for a null field | every digest carries a coverage statement |

- [ ] **Step 6: Commit**

```bash
git add packages/agent-journal/src/digest.ts packages/agent-journal/src/index.ts \
        packages/agent-journal/test/digest.test.ts
git commit -m "feat(agent-journal): the committed digest, gated by disclosure"
```

---

## Task 4: Traversal — answering "why is it like this"

**Files:**
- Create: `packages/agent-journal/src/trace.ts`
- Modify: `packages/agent-journal/src/index.ts`
- Test: `packages/agent-journal/test/trace.test.ts`

**Interfaces:**
- Consumes: `JournalEvent`, `project` from `./retract.ts`.
- Produces:
  - `indexEntries(events): TraceIndex` where `TraceIndex = ReadonlyMap<string, readonly string[]>` — key to entry ids
  - `traceFrom(events, key): TraceResult` where
    `TraceResult = { readonly matched: string[]; readonly chain: { id, via }[] }`

**§10.2's requirement, and the reason it is not just "find by path".** Support and operations questions start at a symptom, a customer-visible string, a ticket or a deployed flag — not a file path. So the index is built from four sources, and all four are equal citizens:

- `subject` — what the entry is about
- every anchor's `ref`, which covers `file`, `commit` and — the one §10.2 names specifically — `runtime`
- every influence's `ref`, which covers `ticket`, `url` and `journal`
- the entry's own id

Keys are matched **exactly**, lower-cased. This is a lookup, not a search: an index that fuzzy-matches would return entries a reader then has to disprove, and this function's whole value is that its answer needs no adjudication.

Traversal walks backwards from the matched entries through `influences` of type `journal`, `supersedes`, and `invalidates`, recording *which* edge it followed at each step, so a reader can tell "this rested on that" from "this replaced that". It terminates on a cycle rather than looping — a journal is append-only but ids are caller-supplied, so a cycle is reachable.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-journal/test/trace.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexEntries, traceFrom } from '../src/trace.ts';
import { normalizeEvent } from '../src/envelope.ts';

function ev(id: string, data: Record<string, unknown>, subject?: string) {
  return normalizeEvent({
    schemaVersion: 1, id, source: 'cli/h/s/a', sourceEpoch: 'e1',
    time: '2026-09-07T10:00:00.000Z', workspace: 'ws', session: 's', agent: 'a',
    author: 'agent', provenance: 'cli', harness: 'test', context: 'coding',
    kind: 'decision', disclosure: 'team', data,
    ...(subject === undefined ? {} : { subject }),
  });
}

test('an entry is findable by subject, by anchor ref, by influence ref, and by id', () => {
  const events = [
    ev('d1', {
      question: 'q', chosen: 'c',
      anchors: [{ type: 'runtime', ref: 'FEATURE_RETRY_QUEUE' }],
      influences: [{ type: 'ticket', role: 'decisive', ref: 'PROJ-412' }],
    }, 'src/queue.ts'),
  ];
  const ix = indexEntries(events);
  for (const key of ['src/queue.ts', 'FEATURE_RETRY_QUEUE', 'PROJ-412', 'd1']) {
    assert.deepEqual(ix.get(key.toLowerCase()), ['d1'], `not findable by ${key}`);
  }
});

// 10.2 names these three starting points specifically. A path-only index answers
// the developer's question and none of support's.
test('a ticket and a deployed flag are first-class starting points, not just a path', () => {
  const events = [
    ev('byTicket', { question: 'q', chosen: 'c',
      influences: [{ type: 'ticket', role: 'decisive', ref: 'PROJ-9' }] }),
    ev('byFlag', { question: 'q', chosen: 'c',
      anchors: [{ type: 'runtime', ref: 'enforce_grants' }] }),
  ];
  assert.deepEqual(traceFrom(events, 'PROJ-9').matched, ['byTicket']);
  assert.deepEqual(traceFrom(events, 'enforce_grants').matched, ['byFlag']);
});

test('lookup is exact and case-insensitive, never a substring match', () => {
  const events = [ev('d1', { question: 'q', chosen: 'c' }, 'src/queue.ts')];
  assert.deepEqual(traceFrom(events, 'SRC/QUEUE.TS').matched, ['d1']);
  assert.deepEqual(traceFrom(events, 'queue').matched, [],
    'a substring matched — this is a lookup, not a search');
  assert.deepEqual(traceFrom(events, 'src/queue.ts.bak').matched, []);
});

test('traversal walks backwards and names the edge it followed', () => {
  const events = [
    ev('root', { question: 'the original', chosen: 'x' }),
    ev('mid', { question: 'rests on root', chosen: 'y',
      influences: [{ type: 'journal', role: 'decisive', ref: 'root' }] }),
    ev('leaf', { question: 'replaces mid', chosen: 'z', supersedes: 'mid' }, 'src/x.ts'),
  ];
  const chain = traceFrom(events, 'src/x.ts').chain;
  assert.deepEqual(chain.map((c) => c.id), ['leaf', 'mid', 'root']);
  assert.deepEqual(chain.map((c) => c.via), [null, 'supersedes', 'influences']);
});

test('a cycle terminates instead of looping', () => {
  const events = [
    ev('a', { question: 'a', chosen: 'x', influences: [{ type: 'journal', role: 'decisive', ref: 'b' }] }),
    ev('b', { question: 'b', chosen: 'y', influences: [{ type: 'journal', role: 'decisive', ref: 'a' }] }, 'sub'),
  ];
  const chain = traceFrom(events, 'sub').chain;
  assert.deepEqual(chain.map((c) => c.id).sort(), ['a', 'b']);
});

test('an unmatched key returns empty, and says nothing more', () => {
  const r = traceFrom([ev('d1', { question: 'q', chosen: 'c' }, 'src/a.ts')], 'src/nope.ts');
  assert.deepEqual(r.matched, []);
  assert.deepEqual(r.chain, []);
});

test('an edge naming an entry that does not exist is skipped, not fatal', () => {
  const events = [ev('d1', { question: 'q', chosen: 'c', supersedes: 'ghost' }, 'src/a.ts')];
  const chain = traceFrom(events, 'src/a.ts').chain;
  assert.deepEqual(chain.map((c) => c.id), ['d1'], 'a dangling edge broke the walk');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/agent-journal && pnpm test`
Expected: FAIL — `Cannot find module '../src/trace.ts'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/agent-journal/src/trace.ts
import type { JournalEvent } from './envelope.ts';

export type TraceIndex = ReadonlyMap<string, readonly string[]>;

export interface TraceStep {
  readonly id: string;
  /** Which edge led here from the previous step; `null` for a matched root. */
  readonly via: 'influences' | 'supersedes' | 'invalidates' | null;
}

export interface TraceResult {
  readonly matched: string[];
  readonly chain: TraceStep[];
}

function refs(e: JournalEvent, field: 'anchors' | 'influences'): string[] {
  const raw = e.data[field];
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const ref = (item as Record<string, unknown>).ref;
      if (typeof ref === 'string' && ref.trim()) out.push(ref.trim());
    }
  }
  return out;
}

function journalRefs(e: JournalEvent): string[] {
  const raw = e.data.influences;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const rec = item as Record<string, unknown>;
      if (rec.type === 'journal' && typeof rec.ref === 'string' && rec.ref.trim()) {
        out.push(rec.ref.trim());
      }
    }
  }
  return out;
}

function edge(e: JournalEvent, field: 'supersedes' | 'invalidates'): string | undefined {
  const v = e.data[field];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * Spec 10.2. Four key sources, all equal: `subject`, every anchor ref (which is
 * how a `runtime` flag becomes a starting point), every influence ref (a ticket,
 * a URL), and the id.
 *
 * Keys are exact and lower-cased. A fuzzy index would return entries a reader
 * then has to disprove, and the value of this lookup is that its answer needs no
 * adjudication.
 */
export function indexEntries(events: readonly JournalEvent[]): TraceIndex {
  const ix = new Map<string, string[]>();
  const add = (key: string, id: string) => {
    const k = key.trim().toLowerCase();
    if (!k) return;
    const seen = ix.get(k);
    if (seen) { if (!seen.includes(id)) seen.push(id); }
    else ix.set(k, [id]);
  };
  for (const e of events) {
    if (e.kind === 'void') continue;
    add(e.id, e.id);
    if (e.subject) add(e.subject, e.id);
    for (const r of refs(e, 'anchors')) add(r, e.id);
    for (const r of refs(e, 'influences')) add(r, e.id);
  }
  return ix;
}

export function traceFrom(events: readonly JournalEvent[], key: string): TraceResult {
  const ix = indexEntries(events);
  const byId = new Map(events.map((e) => [e.id, e]));
  const matched = [...(ix.get(key.trim().toLowerCase()) ?? [])];

  const chain: TraceStep[] = [];
  const seen = new Set<string>();
  // Breadth-first from every match, recording the edge that led to each step.
  // Ids are caller-supplied, so a cycle is reachable in an append-only log.
  const queue: TraceStep[] = matched.map((id) => ({ id, via: null }));
  while (queue.length > 0) {
    const step = queue.shift()!;
    if (seen.has(step.id)) continue;
    const e = byId.get(step.id);
    if (!e) continue;              // a dangling edge is skipped, never fatal
    seen.add(step.id);
    chain.push(step);
    for (const ref of journalRefs(e)) queue.push({ id: ref, via: 'influences' });
    const sup = edge(e, 'supersedes');
    if (sup) queue.push({ id: sup, via: 'supersedes' });
    const inv = edge(e, 'invalidates');
    if (inv) queue.push({ id: inv, via: 'invalidates' });
  }
  return { matched, chain };
}
```

Add to `packages/agent-journal/src/index.ts`:

```ts
export * from './trace.ts';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/agent-journal && pnpm test`
Expected: PASS.

- [ ] **Step 5: Mutation-check**

| Mutation | Test that must go red |
| --- | --- |
| drop `refs(e, 'anchors')` from the index | a ticket and a deployed flag are first-class starting points |
| drop `refs(e, 'influences')` from the index | findable by influence ref |
| drop `e.subject` from the index | findable by subject |
| exact lookup → `[...ix.keys()].filter(k => k.includes(key))` | lookup is exact, never a substring |
| delete the `seen` guard | a cycle terminates instead of looping (expect a hang — treat a timeout as RED and say so) |
| `if (!e) continue` → `chain.push(step)` regardless | a dangling edge is skipped, not fatal |
| `via: 'supersedes'` → `via: 'influences'` | traversal names the edge it followed |

- [ ] **Step 6: Commit**

```bash
git add packages/agent-journal/src/trace.ts packages/agent-journal/src/index.ts \
        packages/agent-journal/test/trace.test.ts
git commit -m "feat(agent-journal): traversal from a ticket, a flag or a path"
```

---

## Task 5: `digest` and `trace` subcommands

**Files:**
- Modify: `packages/agent-journal/src/cli.ts`
- Test: `packages/agent-journal/test/cli.test.ts`

**Interfaces:**
- Consumes: `renderDigest` from `./digest.ts`, `traceFrom` from `./trace.ts`, `DISCLOSURE_CLASSES`, the existing `readAll`, `coverage`, `nowStamp`.
- Produces:
  - `agent-journal digest --workspace <id> [--level private|team|published] [--out <path>]`
  - `agent-journal trace <key> --workspace <id>`

**Both inherit the damaged-journal rule.** `readAll` returns `unreadable` and `malformed`; both subcommands exit non-zero and say so when either is non-empty, exactly as `coverage` and `show` do. A digest is a *rendered artifact* — one written from a journal that could not be fully read, with no warning, is the most misleading thing this package could produce.

**`--out` writes the digest to a file** so it can be committed under `docs/decisions/`. Writing is the only new side effect in this plan; it must refuse to write when the journal is damaged rather than write a partial digest and warn.

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/agent-journal/test/cli.test.ts
test('digest defaults to published and renders the coverage statement', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'pub',
    '--question', 'the public one', '--chosen', 'x', '--disclosure', 'published'], env);
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'priv',
    '--question', 'the candid one', '--chosen', 'y', '--disclosure', 'private'], env);

  const r = await runCli(['digest', '--workspace', 'ws'], env);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.stdout.includes('the public one'));
  assert.ok(!r.stdout.includes('the candid one'), 'a private entry reached the digest');
  assert.match(r.stdout, /Coverage/i);
});

test('digest --level team includes team entries', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 't1',
    '--question', 'team only', '--chosen', 'x'], env);   // default team
  assert.ok(!(await runCli(['digest', '--workspace', 'ws'], env)).stdout.includes('team only'));
  assert.ok((await runCli(['digest', '--workspace', 'ws', '--level', 'team'], env))
    .stdout.includes('team only'));
});

test('digest --out writes the file, and refuses when the journal is damaged', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'q', '--chosen', 'c', '--disclosure', 'published'], env);

  const out = join(dir, 'digest.md');
  const ok = await runCli(['digest', '--workspace', 'ws', '--out', out], env);
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(await readFile(out, 'utf8'), /Decision digest/);

  const segDir = join(dir, 'workspaces', 'ws', 'segments');
  const seg = (await readdir(segDir, { recursive: true }) as string[]).find((f) => f.endsWith('.jsonl'))!;
  await writeFile(join(segDir, seg), 'not json\n');
  const damaged = await runCli(['digest', '--workspace', 'ws', '--out', join(dir, 'bad.md')], env);
  assert.notEqual(damaged.code, 0, 'a damaged journal produced a digest at exit 0');
  assert.match(damaged.stderr, /malformed|unreadable/i);
  await assert.rejects(() => readFile(join(dir, 'bad.md'), 'utf8'),
    'a partial digest was written from a journal that could not be read');
});

test('an unrecognised --level is refused', async () => {
  const dir = await root();
  const r = await runCli(['digest', '--workspace', 'ws', '--level', 'public'],
    { AGENT_JOURNAL_ROOT: dir });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /private, team, published/);
});

test('trace finds an entry by ticket and walks backwards', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'root',
    '--question', 'the original', '--chosen', 'x'], env);
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'later',
    '--question', 'the newer one', '--chosen', 'y',
    '--influence', 'ticket:decisive:PROJ-412',
    '--influence', 'journal:decisive:root'], env);

  const r = await runCli(['trace', 'PROJ-412', '--workspace', 'ws'], env);
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.matched, ['later']);
  assert.deepEqual(out.chain.map((c: any) => c.id), ['later', 'root']);
  assert.deepEqual(out.chain.map((c: any) => c.via), [null, 'influences']);
});

test('trace with no key is refused rather than tracing everything', async () => {
  const dir = await root();
  const r = await runCli(['trace', '--workspace', 'ws'], { AGENT_JOURNAL_ROOT: dir });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /key/i);
});

test('trace on an unmatched key exits 0 with an empty result, and says so', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'q', '--chosen', 'c'], env);
  const r = await runCli(['trace', 'nothing-matches-this', '--workspace', 'ws'], env);
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.stdout).matched, []);
  assert.match(r.stderr, /no entry/i, 'an empty result was silent');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/agent-journal && pnpm test`
Expected: FAIL — `unknown command: digest`.

- [ ] **Step 3: Write the implementation**

Add to `ALLOWED_FLAGS`:

```ts
  digest: ['workspace', 'level', 'out'],
  trace: ['workspace'],
```

Add both usage lines to `USAGE`, and the two branches after `show`:

```ts
  if (command === 'digest') {
    const level = opts.get('level');
    if (level !== undefined && !(DISCLOSURE_CLASSES as readonly string[]).includes(level)) {
      return { code: 2, stdout: '',
        stderr: `--level must be one of ${DISCLOSURE_CLASSES.join(', ')}, got ${JSON.stringify(level)}\n` };
    }
    const { events, unreadable, malformed } = await readAll(root, workspace);
    const damaged = unreadable.length > 0 || malformed.length > 0;
    if (damaged) {
      // Refuse rather than write a partial artifact. A digest is a rendered
      // document somebody commits and reviews; one written from a journal that
      // could not be fully read, warning or not, is the most misleading thing
      // this package can produce.
      return {
        code: 1, stdout: '',
        stderr: `refusing to render: ${unreadable.length} unreadable path(s), `
          + `${malformed.length} malformed line(s)\n`,
      };
    }
    const rendered = renderDigest(events, {
      coverage: coverage(events), now: nowStamp(),
      ...(level === undefined ? {} : { level: level as Disclosure }),
    });
    const out = opts.get('out');
    if (out) {
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, rendered, 'utf8');
      return { code: 0, stdout: `wrote ${out}\n`, stderr: '' };
    }
    return { code: 0, stdout: rendered, stderr: '' };
  }

  if (command === 'trace') {
    const key = rest[0];
    if (!key || key.startsWith('--')) {
      return { code: 2, stdout: '', stderr: `a key is required: trace <key> --workspace <id>\n` };
    }
    const { events, unreadable, malformed } = await readAll(root, workspace);
    const result = traceFrom(events, key);
    const damaged = unreadable.length > 0 || malformed.length > 0;
    return {
      code: damaged ? 1 : 0,
      stdout: `${JSON.stringify({ ...result, unreadable, malformed }, null, 2)}\n`,
      stderr: damaged
        ? 'WARNING: this journal could not be fully read — the result is a floor, not a total.\n'
        : result.matched.length === 0
          ? `no entry is indexed under ${JSON.stringify(key)} in this workspace\n`
          : '',
    };
  }
```

Add the imports:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { renderDigest } from './digest.ts';
import { traceFrom } from './trace.ts';
import { DISCLOSURE_CLASSES, type Disclosure } from './disclosure.ts';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/agent-journal && pnpm test`
Expected: PASS.

- [ ] **Step 5: Mutation-check**

| Mutation | Test that must go red |
| --- | --- |
| drop the damaged check in `digest` | digest `--out` refuses when damaged |
| `damaged` branch writes the file anyway | digest `--out` refuses when damaged |
| drop the `--level` validation | an unrecognised `--level` is refused |
| `trace`'s missing-key guard removed | trace with no key is refused |
| `result.matched.length === 0` stderr removed | trace on an unmatched key says so |

- [ ] **Step 6: Verify through the built binary**

```bash
cd packages/agent-journal && pnpm build
export AGENT_JOURNAL_ROOT=/tmp/j-p3t5 && rm -rf "$AGENT_JOURNAL_ROOT"
node dist/bin.js record --workspace w --kind decision --id d1 --question 'why postgres' \
  --chosen postgres --rejected 'sqlite — reconnect must converge' \
  --reversibility one-way --disclosure published --subject 'src/db.ts'
node dist/bin.js digest --workspace w
node dist/bin.js trace 'src/db.ts' --workspace w
```
Expected: the digest shows the rejection and a coverage statement; `trace` matches `d1`.

- [ ] **Step 7: Commit**

```bash
git add packages/agent-journal/src/cli.ts packages/agent-journal/test/cli.test.ts
git commit -m "feat(agent-journal): digest and trace subcommands"
```

---

## Task 6: Document the digest and traversal in the skill

**Files:**
- Modify: `skills/decision-journal/SKILL.md`
- Create: `skills/decision-journal/references/digest-and-disclosure.md`
- Modify: `skills/decision-journal/references/entry-kinds.md`

**What to add, and the one claim to retire.**

`entry-kinds.md` currently says `disclosure` and `outcome` are schema fields the CLI does not write. Half of that is now false — `--disclosure` exists. `outcome` is still unwritable and `held` still unreachable, so that half stays.

The new reference covers: the three classes and what each means; the write default (`team`) versus the parse default (`private`) and why they differ; that a `private` entry never reaches a digest; the ordering rule; and the fact that a digest is a rendered artifact and never the source of truth.

`SKILL.md` gains a short step after "Read the coverage": rendering a digest for review, and tracing from a ticket or a symptom.

- [ ] **Step 1: Run every command before documenting it**

Build, put a shim on PATH, and run each command you intend to show, against a scratch `AGENT_JOURNAL_ROOT`. Record the exit code and the output. A claim you have not executed does not go in — the previous plan's documentation task found a usage example that had been broken since the kinds landed, because no test runs the documentation.

- [ ] **Step 2: Write `references/digest-and-disclosure.md`**

Keep the skill's register: state what the mechanism does *not* do as plainly as what it does. In particular, say that disclosure is a containment boundary rather than a curation judgement — §6.4 rejects "curated in-repo" precisely because it names no curator and no rule.

- [ ] **Step 3: Add the digest and trace step to `SKILL.md`**

- [ ] **Step 4: Correct the half-false claim in `entry-kinds.md`**

`--disclosure` is writable now; `outcome` is not, and `held` remains unreachable.

- [ ] **Step 5: Re-run every command block in the four skill files, verbatim, in document order, against one scratch workspace**

Every concrete block must exit 0. Watch for id collisions across files — two blocks claiming the same `--id` in the same workspace hit the duplicate-id guard, which is how the previous plan's doc set was found to be non-composable.

- [ ] **Step 6: Run the gates**

```bash
cd packages/agent-journal && pnpm verify
cd ../.. && node scripts/verify-skills.mjs && node --test test/*.test.mjs
```

- [ ] **Step 7: Commit**

```bash
git add skills/decision-journal
git commit -m "docs(decision-journal): the digest, disclosure, and tracing from a symptom"
```

---

## Self-Review

**1. Spec coverage.** §13.3 disclosure → Tasks 1–2. §6.4 digest, its disclosure gate, its consequence ordering, `rejected[]` shown, `model_knowledge` flagged → Task 3. §10.3 coverage statement on every digest → Task 3. §10.2 traversal from subject, runtime anchor, ticket and path → Task 4. CLI surface → Task 5. Skill → Task 6. **Not in this plan and deliberately so:** §9.2 harness adapters, §7.6 path claims, §10.1's rot and premise re-checks. §10.1 depends on this plan's traversal and is the natural head of the next one.

**2. Placeholders.** None: every code step carries its code, every mutation row its exact edit.

**3. Type consistency.** `Disclosure` and `readableAt` are defined in Task 1 and consumed in Tasks 3 and 5. `CoverageReport` comes from the existing `coverage.ts`. `TraceResult`/`TraceStep` are defined in Task 4 and consumed in Task 5. `renderDigest`'s `options.coverage` is supplied by the caller rather than computed inside, so the digest module stays pure and the CLI owns the read.

**4. Ordering constraint.** Task 2 depends on Task 1's `DISCLOSURE_CLASSES`; Task 3 on Task 1's `readableAt`; Task 5 on Tasks 3 and 4. Tasks 3 and 4 are independent of each other but both edit `index.ts`, so they still run sequentially.

**5. One risk worth naming.** Task 1 adds a required field to `JournalEvent`, which every existing test constructs. If `normalizeEvent` defaults it correctly, no existing test should need changing — and if any does, that is a signal the default is wrong, not that the test is stale.
