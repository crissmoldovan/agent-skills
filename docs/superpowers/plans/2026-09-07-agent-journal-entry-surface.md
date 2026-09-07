# Agent Journal — Entry Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the CLI able to write and read everything the entry schema defines — anchors, influences, all six entry kinds, and standing constraints — so the `decision-journal` skill stops documenting its own interface as a set of things it cannot do.

**Architecture:** One new module owns what an entry's `data` may contain (`entry.ts`: anchor and influence shapes, per-kind field schemas, one `normalizeEntryData` entry point). A second owns the only forward-looking projection (`constraints.ts`). The CLI gains repeatable structured flags and a `show` command; `journal.ts`, `redact.ts`, `read.ts` and `retract.ts` are untouched.

**Tech Stack:** TypeScript with `--experimental-strip-types`, Node >= 24, `node:test`, no runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-07-agent-decision-journal-design.md`

**Prior plan:** `docs/superpowers/plans/2026-09-07-agent-journal-core.md` — complete and merged. It built the envelope, redactor, journal, merge, retraction, retention and coverage, and explicitly deferred this surface.

## Global Constraints

- **Node >= 24.** `packages/agent-journal/package.json` declares `"engines": { "node": ">=24.0.0" }`. Run tests with `pnpm test` from `packages/agent-journal`, never bare `node --test`.
- **Every new test must be mutation-checked.** Break the code it covers, confirm the test goes RED, restore. A test that stays green under the mutation is not a test. This plan's predecessor shipped a Critical that eleven rounds of review missed because every fixture passed for the wrong reason.
- **`null` is not `[]`.** `null` means NOT ASSESSED; an empty array claims assessed-and-empty. Never fold one into the other.
- **Redaction is the only fail-closed path.** Do not add a second one, and do not route around `SegmentJournal.append`.
- **Preserve `unknown` capabilities rather than inferring optimistic defaults** (spec §4.3). The one permitted upgrade is defined in Task 1 and is inference *from evidence*, not from optimism.
- **No literal credentials in test fixtures.** `scripts/verify-skills.mjs` scans the repo and matches `gh[pousr]_[A-Za-z0-9_]{20,}` and `sk-[A-Za-z0-9]{20,}`. Compose test secrets from parts, as `test/redact.test.ts` already does.
- **Every CLI flag is scoped to its subcommand** and an unrecognised one exits 2. `ALLOWED_FLAGS` in `src/cli.ts` is the single source of truth.
- **`person` influences are PII** (spec §5.2) and are subject to the existing value-level redactor. Do not add a bypass.
- After every task: `pnpm verify` in `packages/agent-journal` (typecheck + tests + build) and `node scripts/verify-skills.mjs` from the repo root.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/entry.ts` (new) | What an entry's `data` may hold: anchor and influence shapes, the six per-kind field schemas, and `normalizeEntryData`. Pure; no I/O. |
| `src/constraints.ts` (new) | Standing constraints (§5.7): which are live at a moment, and the documented keyword match. Pure; no I/O. |
| `src/cli.ts` (modify) | Repeatable `--anchor`/`--influence` parsing, per-kind field flags, the `show` command. |
| `src/envelope.ts` (modify) | `capabilitiesWithAnchors` — the evidence-based upgrade from Task 1. |
| `src/index.ts` (modify) | Export the two new modules. |
| `test/entry.test.ts` (new) | Anchor/influence/kind-field validation. |
| `test/constraints.test.ts` (new) | Liveness and matching. |
| `test/cli.test.ts` (modify) | The new flags and `show`, end to end through `runCli`. |
| `skills/decision-journal/SKILL.md` + `references/entry-kinds.md`, `references/anchors.md` (modify) | Remove the limitation notes this plan makes false. |

---

## Task 1: Anchor and influence schemas

**Files:**
- Create: `packages/agent-journal/src/entry.ts`
- Modify: `packages/agent-journal/src/envelope.ts` (append `capabilitiesWithAnchors`)
- Modify: `packages/agent-journal/src/index.ts` (add `export * from './entry.ts';`)
- Test: `packages/agent-journal/test/entry.test.ts`

**Interfaces:**
- Consumes: `ANCHOR_CLASSES`, `AnchorClass`, `Capabilities`, `Capability` from `./envelope.ts`.
- Produces:
  - `INFLUENCE_TYPES: readonly ['url','document','journal','ticket','conversation','tool_result','codebase','person','model_knowledge']`
  - `type InfluenceType = (typeof INFLUENCE_TYPES)[number]`
  - `INFLUENCE_ROLES: readonly ['decisive','supporting','considered','contradicted']`
  - `type InfluenceRole = (typeof INFLUENCE_ROLES)[number]`
  - `interface Anchor { readonly type: AnchorClass; readonly ref: string }`
  - `interface Influence { readonly type: InfluenceType; readonly role: InfluenceRole; readonly ref?: string }`
  - `parseAnchor(spec: string): Anchor` — throws `TypeError` on a bad spec
  - `parseInfluence(spec: string): Influence` — throws `TypeError` on a bad spec
  - `capabilitiesWithAnchors(base: Capabilities, anchors: readonly Anchor[]): Capabilities` (exported from `envelope.ts`)

**Design decisions this task locks in, with their reasons:**

*Grammar.* `--anchor <class>:<ref>` splits on the **first** colon only, because a ref is routinely `src/x.ts:41` or a URL. `--influence <type>:<role>[:<ref>]` splits on the first **two** colons, so a ref may contain any number of them. Role comes before ref precisely so the variable-length part is last.

*`model_knowledge` needs no ref* (§5.4): it asserts that no source was consulted, so there is nothing to point at. Every other type requires one — an influence with a type and no referent is an assertion with the shape of a citation.

*Anchors upgrade capabilities.* Spec §4.3 says preserve `unknown` rather than inferring optimistic defaults. Writing an anchor of class C is not optimism — it is the evidence itself, so `capabilitiesWithAnchors` sets that class to `known`. Without this, an entry cites a commit while its own capability table says commits are unavailable here, and the table lies by omission in the one direction the spec cares about.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-journal/test/entry.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAnchor, parseInfluence, INFLUENCE_TYPES, INFLUENCE_ROLES } from '../src/entry.ts';
import { capabilitiesWithAnchors, normalizeCapabilities } from '../src/envelope.ts';

test('an anchor spec splits on the FIRST colon, so refs may contain colons', () => {
  assert.deepEqual(parseAnchor('file:src/queue.ts:41'), { type: 'file', ref: 'src/queue.ts:41' });
  assert.deepEqual(parseAnchor('commit:9f2c1ab'), { type: 'commit', ref: '9f2c1ab' });
  assert.deepEqual(parseAnchor('url:https://example.com/a:b'), { type: 'url', ref: 'https://example.com/a:b' });
});

test('an anchor with an unknown class or an empty ref is refused', () => {
  for (const bad of ['nonsense:x', 'commit:', 'commit', '', ':x']) {
    assert.throws(() => parseAnchor(bad), TypeError, `accepted ${JSON.stringify(bad)}`);
  }
});

test('an influence spec takes type, then role, then an optional ref', () => {
  assert.deepEqual(parseInfluence('url:decisive:https://example.com/a:b'),
    { type: 'url', role: 'decisive', ref: 'https://example.com/a:b' });
  assert.deepEqual(parseInfluence('journal:contradicted:7f3a'),
    { type: 'journal', role: 'contradicted', ref: '7f3a' });
});

test('model_knowledge is the one type that needs no ref', () => {
  assert.deepEqual(parseInfluence('model_knowledge:decisive'), { type: 'model_knowledge', role: 'decisive' });
  // Every other type must point at something. A citation shape with no referent
  // is an assertion wearing evidence's clothes.
  assert.throws(() => parseInfluence('url:decisive'), TypeError);
  assert.throws(() => parseInfluence('person:supporting'), TypeError);
});

test('an influence with an unknown type or role is refused', () => {
  assert.throws(() => parseInfluence('rumour:decisive:x'), TypeError);
  assert.throws(() => parseInfluence('url:vaguely:x'), TypeError);
  assert.throws(() => parseInfluence('url'), TypeError);
});

test('the taxonomies match the spec exactly', () => {
  assert.deepEqual([...INFLUENCE_TYPES], ['url', 'document', 'journal', 'ticket', 'conversation',
    'tool_result', 'codebase', 'person', 'model_knowledge']);
  assert.deepEqual([...INFLUENCE_ROLES], ['decisive', 'supporting', 'considered', 'contradicted']);
});

test('writing an anchor marks its class known — evidence, not optimism', () => {
  const base = normalizeCapabilities({});
  assert.equal(base.commit, 'unknown');
  const up = capabilitiesWithAnchors(base, [{ type: 'commit', ref: '9f2c1ab' }]);
  assert.equal(up.commit, 'known', 'an entry citing a commit must not report commits unavailable');
  assert.equal(up.visual, 'unknown', 'classes with no anchor stay unknown');
});

test('an explicitly known capability is never downgraded by an absent anchor', () => {
  const base = normalizeCapabilities({ visual: 'known' });
  const up = capabilitiesWithAnchors(base, []);
  assert.equal(up.visual, 'known');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/agent-journal && pnpm test`
Expected: FAIL — `Cannot find module '../src/entry.ts'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/agent-journal/src/entry.ts
import { ANCHOR_CLASSES, type AnchorClass } from './envelope.ts';

export const INFLUENCE_TYPES = [
  'url', 'document', 'journal', 'ticket', 'conversation',
  'tool_result', 'codebase', 'person', 'model_knowledge',
] as const;
export type InfluenceType = (typeof INFLUENCE_TYPES)[number];

export const INFLUENCE_ROLES = ['decisive', 'supporting', 'considered', 'contradicted'] as const;
export type InfluenceRole = (typeof INFLUENCE_ROLES)[number];

export interface Anchor {
  readonly type: AnchorClass;
  readonly ref: string;
}

export interface Influence {
  readonly type: InfluenceType;
  readonly role: InfluenceRole;
  /** Absent only for `model_knowledge`, which asserts that nothing was consulted. */
  readonly ref?: string;
}

const ANCHOR_SET = new Set<string>(ANCHOR_CLASSES);
const TYPE_SET = new Set<string>(INFLUENCE_TYPES);
const ROLE_SET = new Set<string>(INFLUENCE_ROLES);

/**
 * `<class>:<ref>` — split on the FIRST colon only. A ref is routinely
 * `src/x.ts:41` or a URL, so splitting on every colon would truncate the thing
 * the anchor exists to point at.
 */
export function parseAnchor(spec: string): Anchor {
  const cut = spec.indexOf(':');
  if (cut <= 0) throw new TypeError(`an anchor needs <class>:<ref>, got ${JSON.stringify(spec)}`);
  const type = spec.slice(0, cut);
  const ref = spec.slice(cut + 1).trim();
  if (!ANCHOR_SET.has(type)) {
    throw new TypeError(`unknown anchor class ${JSON.stringify(type)}; one of ${ANCHOR_CLASSES.join(', ')}`);
  }
  if (!ref) throw new TypeError(`anchor ${type} has no ref`);
  return { type: type as AnchorClass, ref };
}

/**
 * `<type>:<role>[:<ref>]` — role comes second so the variable-length ref is
 * last and may contain colons.
 */
export function parseInfluence(spec: string): Influence {
  const first = spec.indexOf(':');
  if (first <= 0) throw new TypeError(`an influence needs <type>:<role>[:<ref>], got ${JSON.stringify(spec)}`);
  const type = spec.slice(0, first);
  const rest = spec.slice(first + 1);
  const second = rest.indexOf(':');
  const role = second === -1 ? rest : rest.slice(0, second);
  const ref = second === -1 ? '' : rest.slice(second + 1).trim();

  if (!TYPE_SET.has(type)) {
    throw new TypeError(`unknown influence type ${JSON.stringify(type)}; one of ${INFLUENCE_TYPES.join(', ')}`);
  }
  if (!ROLE_SET.has(role)) {
    throw new TypeError(`unknown influence role ${JSON.stringify(role)}; one of ${INFLUENCE_ROLES.join(', ')}`);
  }
  if (type === 'model_knowledge') {
    return ref ? { type, role: role as InfluenceRole, ref } : { type, role: role as InfluenceRole };
  }
  if (!ref) throw new TypeError(`influence ${type} has no ref; only model_knowledge may omit one`);
  return { type: type as InfluenceType, role: role as InfluenceRole, ref };
}
```

Append to `packages/agent-journal/src/envelope.ts`:

```ts
/**
 * Spec 4.3 says preserve `unknown` rather than inferring optimistic defaults.
 * An anchor is not optimism — it is the evidence itself, so the class it cites
 * becomes `known`. Without this an entry cites a commit while its own
 * capability table reports commits unavailable here, which is the table lying
 * by omission in the one direction the rule exists to prevent. Nothing is ever
 * downgraded: a declared `known` with no anchor stays `known`.
 */
export function capabilitiesWithAnchors(
  base: Capabilities,
  anchors: readonly { readonly type: AnchorClass }[],
): Capabilities {
  const out = { ...base };
  for (const a of anchors) out[a.type] = 'known';
  return out;
}
```

Add to `packages/agent-journal/src/index.ts`:

```ts
export * from './entry.ts';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/agent-journal && pnpm test`
Expected: PASS, and the total rises by 8.

- [ ] **Step 5: Mutation-check every new assertion**

Apply each mutation, run `pnpm test`, confirm the named test goes RED, then restore:

| Mutation in `src/entry.ts` / `src/envelope.ts` | Test that must go red |
| --- | --- |
| `spec.indexOf(':')` → `spec.split(':')` and take `[1]` as ref | anchor spec splits on the FIRST colon |
| delete the `if (!ref) throw` in `parseAnchor` | unknown class or empty ref is refused |
| `if (type === 'model_knowledge')` → `if (false)` | model_knowledge is the one type that needs no ref |
| delete the `if (!ROLE_SET.has(role)) throw` | unknown type or role is refused |
| `out[a.type] = 'known'` → `void a` | writing an anchor marks its class known |
| `const out = { ...base }` → `const out = normalizeCapabilities({})` | explicitly known capability is never downgraded |

- [ ] **Step 6: Commit**

```bash
git add packages/agent-journal/src/entry.ts packages/agent-journal/src/envelope.ts \
        packages/agent-journal/src/index.ts packages/agent-journal/test/entry.test.ts
git commit -m "feat(agent-journal): anchor and influence schemas"
```

---

## Task 2: Record anchors and influences from the CLI

**Files:**
- Modify: `packages/agent-journal/src/cli.ts`
- Test: `packages/agent-journal/test/cli.test.ts`

**Interfaces:**
- Consumes: `parseAnchor`, `parseInfluence`, `Anchor`, `Influence` from `./entry.ts`; `capabilitiesWithAnchors` from `./envelope.ts`.
- Produces: `record` accepts repeatable `--anchor` and `--influence`; the written event carries `data.anchors` and `data.influences` as arrays of objects, and `capabilities` reflecting the anchors.

**The parser change.** `flags()` currently returns `opts: Map<string, string>` where a repeated flag silently keeps the last value. Anchors and influences are inherently repeatable, so it gains a second map. Last-wins stays the behaviour for every scalar flag, so no existing call site changes.

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/agent-journal/test/cli.test.ts
test('record writes repeated anchors and influences as structured arrays', async () => {
  const dir = await root();
  const r = await runCli([
    'record', '--workspace', 'ws', '--kind', 'decision', '--id', 'e1',
    '--question', 'how do we bound the queue?', '--chosen', 'ring buffer',
    '--anchor', 'commit:9f2c1ab',
    '--anchor', 'file:src/queue.ts:41',
    '--influence', 'url:decisive:https://example.com/bench?a=1:2',
    '--influence', 'journal:contradicted:7f3a',
  ], { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  assert.equal(r.code, 0, r.stderr);

  const [entry] = await readAllEvents(dir, 'ws');
  assert.deepEqual(entry!.data.anchors, [
    { type: 'commit', ref: '9f2c1ab' },
    { type: 'file', ref: 'src/queue.ts:41' },
  ]);
  assert.deepEqual(entry!.data.influences, [
    { type: 'url', role: 'decisive', ref: 'https://example.com/bench?a=1:2' },
    { type: 'journal', role: 'contradicted', ref: '7f3a' },
  ]);
});

test('an anchor makes its capability known on the written entry', async () => {
  const dir = await root();
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'e1',
    '--question', 'q', '--chosen', 'c', '--anchor', 'commit:9f2c1ab'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  const [entry] = await readAllEvents(dir, 'ws');
  assert.equal(entry!.capabilities.commit, 'known');
  assert.equal(entry!.capabilities.visual, 'unknown', 'unrelated classes stay unknown');
});

test('a malformed anchor or influence is refused before anything is written', async () => {
  const dir = await root();
  for (const bad of [
    ['--anchor', 'nonsense:x'],
    ['--anchor', 'commit'],
    ['--influence', 'url:decisive'],
    ['--influence', 'rumour:decisive:x'],
  ]) {
    const r = await runCli(['record', '--workspace', 'ws', '--kind', 'decision',
      '--question', 'q', '--chosen', 'c', ...bad],
      { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
    assert.equal(r.code, 2, `${bad.join(' ')} was accepted: ${r.stdout}${r.stderr}`);
  }
  assert.equal((await readAllEvents(dir, 'ws')).length, 0, 'a rejected entry was written anyway');
});

// The point of the whole design: "consulted nothing" must be distinguishable
// from "recorded nothing", and it must be a value rather than an absence.
test('model_knowledge records that no source was consulted', async () => {
  const dir = await root();
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'e1',
    '--question', 'q', '--chosen', 'c', '--influence', 'model_knowledge:decisive'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  const [entry] = await readAllEvents(dir, 'ws');
  assert.deepEqual(entry!.data.influences, [{ type: 'model_knowledge', role: 'decisive' }]);
});

test('an entry with no influences records absence, not an empty claim', async () => {
  const dir = await root();
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'e1',
    '--question', 'q', '--chosen', 'c'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  const [entry] = await readAllEvents(dir, 'ws');
  assert.equal(entry!.data.influences, undefined,
    'an absent field must not become [], which would claim "assessed and none"');
});

// Propagation walks data.influences of type journal. Before this task the CLI
// could not emit one, so a CLI-issued invalidate suppressed only its target.
test('a CLI-recorded journal influence makes invalidation propagate', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'base',
    '--question', 'q', '--chosen', 'c'], env);
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'rests',
    '--question', 'q', '--chosen', 'c', '--influence', 'journal:decisive:base'], env);
  await runCli(['invalidate', 'base', '--workspace', 'ws', '--reason', 'premise false'], env);

  const proj = project(await readAllEvents(dir, 'ws'));
  assert.equal(proj.outcomes.get('base'), 'invalidated');
  assert.equal(proj.outcomes.get('rests'), 'invalidated',
    'an entry resting on an invalidated one was not suppressed');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/agent-journal && pnpm test`
Expected: FAIL — `--anchor` and `--influence` exit 2 as unknown flags.

- [ ] **Step 3: Write the implementation**

In `packages/agent-journal/src/cli.ts`, extend the parser result:

```ts
interface ParsedFlags {
  readonly opts: Map<string, string>;
  /** Every value seen for a flag, in order. Repeatable flags read this. */
  readonly all: Map<string, string[]>;
  readonly valueless: readonly string[];
}
```

Inside `flags()`, alongside `opts.set(name, next)`:

```ts
      opts.set(name, next);
      all.set(name, [...(all.get(name) ?? []), next]);
```

Declare `const all = new Map<string, string[]>();` beside `opts`, and return it.

Add `'anchor'` and `'influence'` to the `record` row of `ALLOWED_FLAGS`.

In the `record` branch, after the author check and before `const data`:

```ts
    // Structured, repeatable, and parsed before anything is written: a malformed
    // anchor must not produce a half-formed entry that exits 0.
    let anchors: Anchor[];
    let influences: Influence[];
    try {
      anchors = (all.get('anchor') ?? []).map(parseAnchor);
      influences = (all.get('influence') ?? []).map(parseInfluence);
    } catch (error) {
      return { code: 2, stdout: '', stderr: `${(error as Error).message}\n${USAGE}` };
    }
```

Then, where `data` is built, after the `RECORD_FIELDS` loop:

```ts
    // Absent stays absent. Writing [] would claim "assessed, none found", which
    // is the exact conflation `coverage` reports null to avoid.
    if (anchors.length > 0) data.anchors = anchors;
    if (influences.length > 0) data.influences = influences;
```

And in the `normalizeEvent` call, replace the implicit capabilities with:

```ts
      capabilities: capabilitiesWithAnchors(normalizeCapabilities({}), anchors),
```

Add the imports:

```ts
import { parseAnchor, parseInfluence, type Anchor, type Influence } from './entry.ts';
import { capabilitiesWithAnchors, normalizeCapabilities, normalizeEvent, type JournalEvent } from './envelope.ts';
```

Extend `USAGE`'s `record` lines with `[--anchor <class>:<ref>]… [--influence <type>:<role>[:<ref>]]…`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/agent-journal && pnpm test`
Expected: PASS.

- [ ] **Step 5: Mutation-check**

| Mutation | Test that must go red |
| --- | --- |
| `all.get('anchor')` → `[opts.get('anchor') ?? '']` filtered non-empty | record writes repeated anchors |
| delete the `try`/`catch`, call the parsers unguarded | malformed anchor refused before anything is written |
| `if (anchors.length > 0)` → `data.anchors = anchors` unconditionally | entry with no influences records absence — **the test must assert `data.anchors === undefined` as well as `data.influences`, or this row is green against a guard it never touches** |
| `capabilitiesWithAnchors(...)` → `normalizeCapabilities({})` | an anchor makes its capability known |

- [ ] **Step 6: Verify through the built binary, not the source tree**

```bash
cd packages/agent-journal && pnpm build
AGENT_JOURNAL_ROOT=/tmp/j-t2 node dist/bin.js record --workspace ws --kind decision \
  --question q --chosen c --influence 'url:decisive:https://example.com/a:b' --anchor commit:9f2c1ab
grep -o '"influences":\[[^]]*\]' -r /tmp/j-t2
```
Expected: the URL's colon survives intact in the stored ref.

- [ ] **Step 7: Commit**

```bash
git add packages/agent-journal/src/cli.ts packages/agent-journal/test/cli.test.ts
git commit -m "feat(agent-journal): record anchors and influences"
```

---

## Task 3: The five non-decision entry kinds

**Files:**
- Modify: `packages/agent-journal/src/entry.ts` (add `KIND_FIELDS`, `normalizeEntryData`)
- Modify: `packages/agent-journal/src/cli.ts` (per-kind flag scoping; `rejected` becomes a list)
- Test: `packages/agent-journal/test/entry.test.ts`, `packages/agent-journal/test/cli.test.ts`

**Interfaces:**
- Produces:
  - `KIND_FIELDS: Readonly<Record<string, readonly string[]>>` keyed by the six kinds
  - `LIST_FIELDS: ReadonlySet<string>` — fields stored as arrays: `rejected`, `evidence`, `premise`
  - `ENUM_FIELDS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>` — keyed by **kind**, then field
  - `fieldsFor(kind: string): readonly string[]`

**Field schemas, verbatim from spec §5.6 and §5.7:**

| Kind | Fields |
| --- | --- |
| `decision` | `question`, `chosen`, `rejected[]`, `rationale`, `reversibility`, `blastRadius`, `confidence` |
| `finding` | `claim`, `evidence[]`, `premise[]`, `scope` |
| `assumption` | `assumed`, `ifWrong`, `checked` |
| `blocker` | `blocked`, `on`, `owner`, `clearedBy` |
| `progress` | `did`, `next`, `externalRef` |
| `constraint` | `statement`, `origin`, `scope`, `expiry`, `enforcement` |

Enumerations, **keyed per kind rather than per field name**: `decision.reversibility` ∈ `trivial|moderate|hard|one-way`; `assumption.checked` ∈ `yes|no`; `constraint.enforcement` ∈ `advisory|blocking`; `finding.scope` ∈ `machine|workspace|general`.

**`scope` is two different fields sharing a name, and a global table cannot hold both.** §5.6 gives `finding.scope` three values — this machine, this workspace, general — because a machine-local fact must not propagate as a universal one. §5.7 gives `constraint.scope` a different job: where the obligation applies, which is a subject (*telemetry*, *that checkout*) and not one of three words. Enumerating both under one key would reject every real constraint.

**`rejected` becomes a list.** The spec writes it `rejected[]` and Task 1's grammar already makes repeated flags natural. It is currently stored as one flat string, so a second `--rejected` silently discarded the first. `evidence` and `premise` follow the same rule.

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/agent-journal/test/entry.test.ts
import { fieldsFor, normalizeEntryData, KIND_FIELDS } from '../src/entry.ts';

test('every kind in the spec has its fields, and no kind borrows another\'s', () => {
  assert.deepEqual([...Object.keys(KIND_FIELDS)].sort(),
    ['assumption', 'blocker', 'constraint', 'decision', 'finding', 'progress']);
  assert.deepEqual([...fieldsFor('finding')], ['claim', 'evidence', 'premise', 'scope']);
  assert.deepEqual([...fieldsFor('assumption')], ['assumed', 'ifWrong', 'checked']);
  assert.deepEqual([...fieldsFor('blocker')], ['blocked', 'on', 'owner', 'clearedBy']);
  assert.deepEqual([...fieldsFor('progress')], ['did', 'next', 'externalRef']);
  assert.deepEqual([...fieldsFor('constraint')], ['statement', 'origin', 'scope', 'expiry', 'enforcement']);
  assert.ok(!fieldsFor('finding').includes('question'), 'finding must not accept decision fields');
});

test('list fields collect every value rather than keeping the last', () => {
  const data = normalizeEntryData('decision', new Map([['rejected', ['redis — needs a broker', 'kafka — three days']]]));
  assert.deepEqual(data.rejected, ['redis — needs a broker', 'kafka — three days']);
});

test('an out-of-range enumeration is refused', () => {
  assert.throws(() => normalizeEntryData('decision', new Map([['reversibility', ['sort of']]])), TypeError);
  assert.throws(() => normalizeEntryData('assumption', new Map([['checked', ['maybe']]])), TypeError);
  assert.throws(() => normalizeEntryData('constraint', new Map([['enforcement', ['advisory-ish']]])), TypeError);
  assert.throws(() => normalizeEntryData('finding', new Map([['scope', ['everywhere']]])), TypeError);
  // and the valid ones are accepted
  assert.equal(normalizeEntryData('assumption', new Map([['checked', ['no']]])).checked, 'no');
});

// `scope` is enumerated on `finding` and free text on `constraint`. A table
// keyed by field name alone would reject every constraint anyone would write.
test('constraint scope is free text; finding scope is not', () => {
  assert.equal(
    normalizeEntryData('constraint', new Map([['scope', ['telemetry']]])).scope,
    'telemetry',
  );
  assert.throws(() => normalizeEntryData('finding', new Map([['scope', ['telemetry']]])), TypeError);
});

test('an unknown kind carries no fields rather than guessing', () => {
  assert.deepEqual([...fieldsFor('not_a_kind')], []);
});
```

```ts
// append to packages/agent-journal/test/cli.test.ts
test('each kind accepts its own fields and refuses another kind\'s', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };

  const ok = await runCli(['record', '--workspace', 'ws', '--kind', 'assumption', '--id', 'a1',
    '--assumed', 'the upstream call is idempotent', '--ifWrong', 'retries double-charge',
    '--checked', 'no'], env);
  assert.equal(ok.code, 0, ok.stderr);
  const [entry] = await readAllEvents(dir, 'ws');
  assert.equal(entry!.data.assumed, 'the upstream call is idempotent');
  assert.equal(entry!.data.checked, 'no');

  const crossed = await runCli(['record', '--workspace', 'ws', '--kind', 'assumption', '--id', 'a2',
    '--assumed', 'x', '--question', 'belongs to decision'], env);
  assert.equal(crossed.code, 2, `a decision field was accepted on an assumption: ${crossed.stdout}`);
  assert.match(crossed.stderr, /--question/);
});

test('a repeated --rejected keeps every alternative, not just the last', async () => {
  const dir = await root();
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'q', '--chosen', 'c',
    '--rejected', 'redis — needs a broker we do not run',
    '--rejected', 'kafka — three days of setup for one queue'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  const [entry] = await readAllEvents(dir, 'ws');
  assert.deepEqual(entry!.data.rejected, [
    'redis — needs a broker we do not run',
    'kafka — three days of setup for one queue',
  ]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/agent-journal && pnpm test`
Expected: FAIL — `fieldsFor` is not exported; `--assumed` exits 2.

- [ ] **Step 3: Write the implementation**

Append to `packages/agent-journal/src/entry.ts`:

```ts
/** Spec 5.6 and 5.7, verbatim. A kind carries its own fields and no other's. */
export const KIND_FIELDS: Readonly<Record<string, readonly string[]>> = {
  decision: ['question', 'chosen', 'rejected', 'rationale', 'reversibility', 'blastRadius', 'confidence'],
  finding: ['claim', 'evidence', 'premise', 'scope'],
  assumption: ['assumed', 'ifWrong', 'checked'],
  blocker: ['blocked', 'on', 'owner', 'clearedBy'],
  progress: ['did', 'next', 'externalRef'],
  constraint: ['statement', 'origin', 'scope', 'expiry', 'enforcement'],
};

/** Stored as arrays. A second `--rejected` used to discard the first. */
export const LIST_FIELDS: ReadonlySet<string> = new Set(['rejected', 'evidence', 'premise']);

/**
 * Keyed by kind, then field. `scope` exists on both `finding` and `constraint`
 * and means different things: 5.6 constrains a finding's reach to three values
 * so a machine-local fact cannot propagate as a universal one, while 5.7's
 * constraint scope is the subject an obligation covers and is free text. One
 * table keyed by field name alone would reject every real constraint.
 */
export const ENUM_FIELDS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  decision: { reversibility: ['trivial', 'moderate', 'hard', 'one-way'] },
  assumption: { checked: ['yes', 'no'] },
  constraint: { enforcement: ['advisory', 'blocking'] },
  finding: { scope: ['machine', 'workspace', 'general'] },
};

/** An unrecognised kind gets no fields rather than a guess. */
export function fieldsFor(kind: string): readonly string[] {
  return KIND_FIELDS[kind] ?? [];
}

/**
 * Build an entry's `data` from the values a caller supplied per field. Absent
 * stays absent: a field nobody set must not appear as '' or [], both of which
 * read as "assessed, nothing there".
 */
export function normalizeEntryData(
  kind: string,
  given: ReadonlyMap<string, readonly string[]>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fieldsFor(kind)) {
    const values = given.get(field);
    if (!values || values.length === 0) continue;
    const allowed = ENUM_FIELDS[kind]?.[field];
    if (allowed) {
      for (const v of values) {
        if (!allowed.includes(v)) {
          throw new TypeError(`--${field} must be one of ${allowed.join(', ')}, got ${JSON.stringify(v)}`);
        }
      }
    }
    out[field] = LIST_FIELDS.has(field) ? [...values] : values[values.length - 1];
  }
  return out;
}
```

In `packages/agent-journal/src/cli.ts`, replace `RECORD_FIELDS` and the `record` row of `ALLOWED_FLAGS` with a per-kind computation. Because the allowed set now depends on `--kind`, move the unknown-flag check for `record` to after `kind` is read:

```ts
const RECORD_GLOBAL = ['workspace', 'kind', 'id', 'author', 'context',
  'supersedes', 'invalidates', 'anchor', 'influence'] as const;
```

`ALLOWED_FLAGS.record` becomes `[...RECORD_GLOBAL, ...Object.values(KIND_FIELDS).flat()]` so a wrong-kind field still passes the generic gate, and the per-kind check that follows produces the precise message:

```ts
    const allowedForKind = new Set<string>([...RECORD_GLOBAL, ...fieldsFor(kind)]);
    const wrongKind = [...opts.keys()].filter((k) => !allowedForKind.has(k)).sort();
    if (wrongKind.length > 0) {
      return {
        code: 2,
        stdout: '',
        stderr: `${wrongKind.map((f) => `--${f}`).join(', ')} `
          + `${wrongKind.length > 1 ? 'are' : 'is'} not a field of kind '${kind}'; `
          + `it takes ${fieldsFor(kind).map((f) => `--${f}`).join(', ') || 'no fields'}\n`,
      };
    }
```

Replace the `RECORD_FIELDS` loop with:

```ts
    let data: Record<string, unknown>;
    try {
      data = normalizeEntryData(kind, all);
    } catch (error) {
      return { code: 2, stdout: '', stderr: `${(error as Error).message}\n` };
    }
```

`supersedes` and `invalidates` are retraction edges rather than kind fields, so set them after:

```ts
    for (const edge of ['supersedes', 'invalidates'] as const) {
      const v = opts.get(edge);
      if (v !== undefined) data[edge] = v;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/agent-journal && pnpm test`
Expected: PASS. Existing decision tests still pass because `decision`'s field list is unchanged apart from `rejected` becoming a list — update the one existing assertion that reads `data.rejected` as a string.

- [ ] **Step 5: Mutation-check**

| Mutation | Test that must go red |
| --- | --- |
| `KIND_FIELDS[kind] ?? []` → `?? KIND_FIELDS.decision` | unknown kind carries no fields |
| delete the `allowed.includes(v)` throw | out-of-range enumeration is refused |
| `LIST_FIELDS.has(field) ? [...values] : ...` → always last value | repeated `--rejected` keeps every alternative |
| `ENUM_FIELDS[kind]?.[field]` → `ENUM_FIELDS.finding?.[field]` | constraint scope is free text |
| `allowedForKind` → `new Set(Object.values(KIND_FIELDS).flat())` | each kind refuses another kind's fields |

- [ ] **Step 6: Commit**

```bash
git add packages/agent-journal/src/entry.ts packages/agent-journal/src/cli.ts \
        packages/agent-journal/test/entry.test.ts packages/agent-journal/test/cli.test.ts
git commit -m "feat(agent-journal): the five non-decision entry kinds"
```

---

## Task 4: Standing constraints at projection

**Files:**
- Create: `packages/agent-journal/src/constraints.ts`
- Modify: `packages/agent-journal/src/index.ts`
- Test: `packages/agent-journal/test/constraints.test.ts`

**Interfaces:**
- Consumes: `JournalEvent` from `./envelope.ts`, `project` from `./retract.ts`.
- Produces:
  - `interface Constraint { id, statement, origin?, scope?, expiry?, enforcement: 'advisory'|'blocking' }`
  - `liveConstraints(events: readonly JournalEvent[], now: string): Constraint[]`
  - `constraintsBearingOn(entry: JournalEvent, live: readonly Constraint[]): Constraint[]`

**What this deliberately does not do.** Spec §5.7: constraints are checked at projection, never at write time; nothing blocks and nothing auto-resolves. `constraintsBearingOn` is a **keyword** match on the constraint's `scope`, not a semantic one, and it is named and documented as such. A reader who believes it understands meaning will trust a silence it never earned.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-journal/test/constraints.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveConstraints, constraintsBearingOn } from '../src/constraints.ts';
import { normalizeEvent } from '../src/envelope.ts';

function ev(id: string, kind: string, data: Record<string, unknown>, time = '2026-09-07T10:00:00.000Z') {
  return normalizeEvent({
    schemaVersion: 1, id, source: 'cli/h/s/a', sourceEpoch: 'e1', time,
    workspace: 'ws', session: 's', agent: 'a', author: 'agent', provenance: 'cli',
    harness: 'test', context: 'coding', kind, data,
  });
}

test('a constraint with no expiry is live', () => {
  const live = liveConstraints([
    ev('c1', 'constraint', { statement: 'never a third-party sink for this telemetry',
      origin: 'client contract', scope: 'telemetry', enforcement: 'blocking' }),
  ], '2027-01-01T00:00:00.000Z');
  assert.equal(live.length, 1);
  assert.equal(live[0]!.enforcement, 'blocking');
});

test('an expired constraint is not live, and expiry is inclusive of its day', () => {
  const c = ev('c1', 'constraint', { statement: 's', scope: 'x', enforcement: 'advisory',
    expiry: '2026-09-30' });
  assert.equal(liveConstraints([c], '2026-09-30T23:59:59.000Z').length, 1, 'live on its expiry day');
  assert.equal(liveConstraints([c], '2026-10-01T00:00:01.000Z').length, 0, 'not live after it');
});

test('an invalidated constraint stops constraining', () => {
  const events = [
    ev('c1', 'constraint', { statement: 's', scope: 'telemetry', enforcement: 'blocking' }),
    ev('r1', 'decision', { invalidates: 'c1', rationale: 'the contract changed' }),
  ];
  assert.deepEqual(liveConstraints(events, '2026-09-08T00:00:00.000Z'), []);
});

test('a superseded constraint stops constraining too', () => {
  const events = [
    ev('c1', 'constraint', { statement: 's', scope: 'telemetry', enforcement: 'blocking' }),
    ev('c2', 'constraint', { statement: 's2', scope: 'telemetry', enforcement: 'advisory',
      supersedes: 'c1' }),
  ];
  const live = liveConstraints(events, '2026-09-08T00:00:00.000Z');
  assert.deepEqual(live.map((c) => c.id), ['c2']);
});

test('matching is by keyword on scope, and says nothing about meaning', () => {
  const live = liveConstraints([
    ev('c1', 'constraint', { statement: 'no third-party sink', scope: 'telemetry',
      enforcement: 'blocking' }),
  ], '2026-09-08T00:00:00.000Z');

  const hit = ev('d1', 'decision', { question: 'where does telemetry go?', chosen: 'a vendor' });
  const miss = ev('d2', 'decision', { question: 'what colour is the button?', chosen: 'blue' });
  // Whole-word, case-insensitive: `telemetrics` is a different word.
  const near = ev('d3', 'decision', { question: 'telemetrics dashboard', chosen: 'x' });

  assert.deepEqual(constraintsBearingOn(hit, live).map((c) => c.id), ['c1']);
  assert.deepEqual(constraintsBearingOn(miss, live), []);
  assert.deepEqual(constraintsBearingOn(near, live), []);
});

test('a constraint never matches itself or another constraint', () => {
  const live = liveConstraints([
    ev('c1', 'constraint', { statement: 'telemetry stays in-house', scope: 'telemetry',
      enforcement: 'advisory' }),
  ], '2026-09-08T00:00:00.000Z');
  const other = ev('c2', 'constraint', { statement: 'telemetry retention is 30 days',
    scope: 'telemetry', enforcement: 'advisory' });
  assert.deepEqual(constraintsBearingOn(other, live), [],
    'constraints surface against decisions, not against each other');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/agent-journal && pnpm test`
Expected: FAIL — `Cannot find module '../src/constraints.ts'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/agent-journal/src/constraints.ts
import type { JournalEvent } from './envelope.ts';
import { project } from './retract.ts';

export interface Constraint {
  readonly id: string;
  readonly statement: string;
  readonly origin?: string;
  readonly scope?: string;
  readonly expiry?: string;
  readonly enforcement: 'advisory' | 'blocking';
}

function text(event: JournalEvent, field: string): string | undefined {
  const v = event.data[field];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * Constraints live at projection, never at write time (spec 5.7) — the same
 * precedent as 7.5's contradictions. A constraint stops constraining when it
 * expires, when a later constraint supersedes it, or when it is invalidated.
 *
 * `expiry` is a date, so it is inclusive of its own day: "expires 2026-09-30"
 * is how people write an obligation, and treating it as midnight would retire
 * the constraint a day early.
 */
export function liveConstraints(events: readonly JournalEvent[], now: string): Constraint[] {
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) {
    throw new TypeError(`now must be a parseable timestamp, got ${JSON.stringify(now)}`);
  }
  const { superseded, invalidated } = project(events);

  const out: Constraint[] = [];
  for (const e of events) {
    if (e.kind !== 'constraint') continue;
    if (superseded.has(e.id) || invalidated.has(e.id)) continue;
    const statement = text(e, 'statement');
    if (!statement) continue;

    const expiry = text(e, 'expiry');
    if (expiry) {
      const end = Date.parse(`${expiry}T23:59:59.999Z`);
      if (Number.isNaN(end)) continue;
      if (nowMs > end) continue;
    }
    const enforcement = e.data.enforcement === 'blocking' ? 'blocking' : 'advisory';
    out.push({
      id: e.id, statement, enforcement,
      ...(text(e, 'origin') === undefined ? {} : { origin: text(e, 'origin')! }),
      ...(text(e, 'scope') === undefined ? {} : { scope: text(e, 'scope')! }),
      ...(expiry === undefined ? {} : { expiry }),
    });
  }
  return out;
}

/**
 * KEYWORD matching, not semantic. A constraint bears on an entry when its
 * `scope` appears as a whole word in the entry's own text. This is deliberately
 * crude and is named so nobody reads a quiet result as "no constraint applies":
 * it means "no constraint's scope word appeared", which is a much weaker claim.
 * Nothing blocks and nothing auto-resolves; the output is for a human to read.
 */
export function constraintsBearingOn(
  entry: JournalEvent,
  live: readonly Constraint[],
): Constraint[] {
  if (entry.kind === 'constraint') return [];
  const haystack = Object.values(entry.data)
    .flatMap((v) => (Array.isArray(v) ? v : [v]))
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .toLowerCase();

  return live.filter((c) => {
    if (!c.scope) return false;
    const word = c.scope.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`).test(haystack);
  });
}
```

Add to `packages/agent-journal/src/index.ts`:

```ts
export * from './constraints.ts';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/agent-journal && pnpm test`
Expected: PASS.

- [ ] **Step 5: Mutation-check**

| Mutation | Test that must go red |
| --- | --- |
| drop `superseded.has(e.id) ||` | a superseded constraint stops constraining |
| drop `invalidated.has(e.id)` | an invalidated constraint stops constraining |
| `T23:59:59.999Z` → `T00:00:00.000Z` | expiry is inclusive of its day |
| the whole-word regex → `haystack.includes(word)` | matching is by keyword on scope (the `telemetrics` case) |
| `if (entry.kind === 'constraint') return [];` → `return live;` | a constraint never matches another constraint |

- [ ] **Step 6: Commit**

```bash
git add packages/agent-journal/src/constraints.ts packages/agent-journal/src/index.ts \
        packages/agent-journal/test/constraints.test.ts
git commit -m "feat(agent-journal): standing constraints checked at projection"
```

---

## Task 5: The `show` command

**Files:**
- Modify: `packages/agent-journal/src/cli.ts`
- Test: `packages/agent-journal/test/cli.test.ts`

**Interfaces:**
- Consumes: `project` from `./retract.ts`; `liveConstraints`, `constraintsBearingOn` from `./constraints.ts`; the existing `readAll`.
- Produces: `agent-journal show --workspace <id> [--id <entry-id>]`, printing JSON.

**Why this exists.** `decision-journal`'s Verification section tells a reader to confirm that retractions took effect and that entries cite something. With no read command that instruction was unrunnable through the shipped binary, and the skill says so as an apology. This removes the apology.

Output shape:

```json
{
  "entries": [
    { "id": "…", "kind": "decision", "outcome": "invalidated", "live": false,
      "anchors": [{ "type": "commit", "ref": "9f2c1ab" }],
      "influences": [{ "type": "model_knowledge", "role": "decisive" }],
      "constraintsBearingOn": ["c1"] }
  ],
  "liveConstraints": [{ "id": "c1", "statement": "…", "enforcement": "blocking" }],
  "unreadable": [],
  "malformed": []
}
```

`anchors` and `influences` are `null` when the entry has none — absent, not assessed-and-empty — matching `coverage`'s rule.

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/agent-journal/test/cli.test.ts
test('show reports outcomes, liveness and evidence per entry', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'base',
    '--question', 'q', '--chosen', 'c', '--anchor', 'commit:9f2c1ab'], env);
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'rests',
    '--question', 'q', '--chosen', 'c', '--influence', 'journal:decisive:base'], env);
  await runCli(['invalidate', 'base', '--workspace', 'ws', '--reason', 'premise false'], env);

  const r = await runCli(['show', '--workspace', 'ws'], env);
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);

  const byId = Object.fromEntries(out.entries.map((e: any) => [e.id, e]));
  assert.equal(byId.base.outcome, 'invalidated');
  assert.equal(byId.base.live, false);
  assert.equal(byId.rests.outcome, 'invalidated', 'propagation is not visible through show');
  assert.deepEqual(byId.base.anchors, [{ type: 'commit', ref: '9f2c1ab' }]);
  assert.equal(byId.rests.anchors, null, 'no anchors must read as null, never []');
});

test('show surfaces live constraints and which entries they bear on', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'constraint', '--id', 'c1',
    '--statement', 'never a third-party sink for this telemetry',
    '--scope', 'telemetry', '--enforcement', 'blocking'], env);
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'where does telemetry go?', '--chosen', 'a vendor'], env);

  const out = JSON.parse((await runCli(['show', '--workspace', 'ws'], env)).stdout);
  assert.deepEqual(out.liveConstraints.map((c: any) => c.id), ['c1']);
  const d1 = out.entries.find((e: any) => e.id === 'd1');
  assert.deepEqual(d1.constraintsBearingOn, ['c1']);
});

test('show --id narrows to one entry', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  for (const id of ['a1', 'b1']) {
    await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', id,
      '--question', 'q', '--chosen', 'c'], env);
  }
  const out = JSON.parse((await runCli(['show', '--workspace', 'ws', '--id', 'a1'], env)).stdout);
  assert.deepEqual(out.entries.map((e: any) => e.id), ['a1']);
});

test('show inherits coverage\'s honesty about a damaged journal', async () => {
  const dir = await root();
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'a1',
    '--question', 'q', '--chosen', 'c'], { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  const segDir = join(dir, 'workspaces', 'ws', 'segments');
  const seg = (await readdir(segDir, { recursive: true }) as string[]).find((f) => f.endsWith('.jsonl'))!;
  await writeFile(join(segDir, seg), 'not json\n');

  const r = await runCli(['show', '--workspace', 'ws'], { AGENT_JOURNAL_ROOT: dir });
  assert.notEqual(r.code, 0, 'a corrupt journal reported success');
  assert.match(r.stdout + r.stderr, /malformed/i);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/agent-journal && pnpm test`
Expected: FAIL — `unknown command: show`.

- [ ] **Step 3: Write the implementation**

Add `show: ['workspace', 'id']` to `ALLOWED_FLAGS`, add the usage line, and add the branch after `coverage`:

```ts
  if (command === 'show') {
    const { events, unreadable, malformed } = await readAll(root, workspace);
    const proj = project(events);
    const live = liveConstraints(events, nowStamp());
    const liveIds = new Set(proj.live.map((e) => e.id));
    const wanted = opts.get('id');

    const entries = events
      .filter((e) => e.kind !== 'void' && (wanted === undefined || e.id === wanted))
      .map((e) => {
        const anchors = Array.isArray(e.data.anchors) ? e.data.anchors : null;
        const influences = Array.isArray(e.data.influences) ? e.data.influences : null;
        return {
          id: e.id, kind: e.kind, time: e.time, author: e.author,
          outcome: proj.outcomes.get(e.id) ?? 'unknown',
          live: liveIds.has(e.id),
          // null, never []: an entry with no anchors has none recorded, which is
          // not the same claim as "assessed and found none".
          anchors, influences,
          constraintsBearingOn: constraintsBearingOn(e, live).map((c) => c.id),
        };
      });

    const damaged = unreadable.length > 0 || malformed.length > 0;
    return {
      code: damaged ? 1 : 0,
      stdout: `${JSON.stringify({ entries, liveConstraints: live, unreadable, malformed }, null, 2)}\n`,
      stderr: damaged
        ? 'WARNING: this journal could not be fully read — the entries above are a floor, not a total.\n'
        : '',
    };
  }
```

Add the imports:

```ts
import { project } from './retract.ts';
import { liveConstraints, constraintsBearingOn } from './constraints.ts';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/agent-journal && pnpm test`
Expected: PASS.

- [ ] **Step 5: Mutation-check**

| Mutation | Test that must go red |
| --- | --- |
| `anchors` → `Array.isArray(...) ? ... : []` | no anchors must read as null |
| drop the `wanted` filter | `show --id` narrows to one entry |
| `code: damaged ? 1 : 0` → `code: 0` | show inherits coverage's honesty |
| `constraintsBearingOn(e, live)` → `[]` | show surfaces which entries constraints bear on |

- [ ] **Step 6: Commit**

```bash
git add packages/agent-journal/src/cli.ts packages/agent-journal/test/cli.test.ts
git commit -m "feat(agent-journal): a show command, so retractions are observable"
```

---

## Task 6: Retire the limitation notes this plan makes false

**Files:**
- Modify: `skills/decision-journal/SKILL.md`
- Modify: `skills/decision-journal/references/entry-kinds.md`
- Modify: `skills/decision-journal/references/anchors.md`
- Modify: `README.md` (usage examples only; the catalogue row is unchanged)

**Interfaces:**
- Consumes: the CLI surface from Tasks 2, 3 and 5.

**What to remove, and what must replace it.** Each of these was written truthfully when the CLI could not do the thing. Deleting the caveat without adding the instruction leaves a reader worse off than before, so each removal pairs with the command that now works.

| Location | Claim to retire | Replace with |
| --- | --- | --- |
| `SKILL.md` step 3 | "There is no `--anchor` flag … every anchor class on it reads `unknown`" | `--anchor <class>:<ref>`, repeatable, and the note that citing an anchor marks that class `known` |
| `SKILL.md` step 4 | "Through the CLI, say it in words … there is no flag for this yet" | `--influence model_knowledge:decisive` |
| `SKILL.md` step 5 | "**The CLI cannot create them** … a CLI-issued `invalidate` suppresses the entry you name and nothing downstream" | `--influence journal:<role>:<id>`, and propagation now reaching descendants |
| `SKILL.md` Verification | "`coverage` cannot answer this for you"; "the CLI ships no `read` command" | `agent-journal show --workspace <ws>` |
| `references/entry-kinds.md` | The blockquote saying `record` accepts decision fields only | Each kind's own flags, with a worked example per kind |
| `references/anchors.md` | Nothing to retire — it describes the schema, which is now reachable | Add one line pointing at `--anchor` |

- [ ] **Step 1: Verify every claim you are about to write, by running it**

```bash
cd packages/agent-journal && pnpm build
export PATH="$PWD/node_modules/.bin:$PATH" AGENT_JOURNAL_ROOT=/tmp/j-t6
rm -rf "$AGENT_JOURNAL_ROOT"
node dist/bin.js record --workspace api --kind decision --id d1 \
  --question 'how do we bound the retry queue?' --chosen 'in-process ring buffer, 256' \
  --rejected 'redis list — needs a broker we do not run' \
  --rejected 'kafka — three days of setup for one queue' \
  --anchor file:src/queue.ts:14 --influence model_knowledge:decisive
node dist/bin.js record --workspace api --kind assumption --id a1 \
  --assumed 'the upstream call is idempotent' --ifWrong 'retries double-charge' --checked no
node dist/bin.js invalidate d1 --workspace api --reason 'the bound was measured, not assumed'
node dist/bin.js show --workspace api
```
Every command must exit 0 (the `invalidate` too) and `show` must render both entries. If any output differs from what you are about to document, the documentation follows the binary, not the other way round.

- [ ] **Step 2: Rewrite the four SKILL.md passages**

Each replacement states what the command is and what it now proves. Keep the honest register: the anchor still proves occurrence and not soundness, and §2.1's warning stays exactly as it is.

- [ ] **Step 3: Rewrite `references/entry-kinds.md`**

Delete the blockquote. Under each kind's field table add its `record` invocation, copied from a command you actually ran in Step 1.

- [ ] **Step 4: Run the repository gates**

```bash
cd packages/agent-journal && pnpm verify
cd ../.. && node scripts/verify-skills.mjs && node --test test/*.test.mjs
```
Expected: all pass, 20 skills discovered.

- [ ] **Step 5: Re-run every command block in the three files, verbatim**

A documentation task's deliverable is claims that hold. Copy each fenced `agent-journal` block out of the three edited files, run it against a clean `AGENT_JOURNAL_ROOT`, and confirm the exit code and output match the surrounding prose. This is how Task 11 of the previous plan found `--rejected` being silently dropped — by writing the documentation, not by reviewing the code.

- [ ] **Step 6: Commit**

```bash
git add skills/decision-journal README.md
git commit -m "docs(decision-journal): the CLI now does what the skill described as missing"
```

---

## Self-Review

**1. Spec coverage.** §5.1 anchors/influences separation → Task 1. §5.2 taxonomy and roles → Task 1. §5.4 `model_knowledge` as an explicit value → Tasks 1–2. §5.5 the graph (`type: journal` influences) → Task 2, and the propagation test proves the edge is now reachable. §5.6 the five kinds → Task 3. §5.7 constraints at projection → Task 4. §4.3 capabilities → Task 1's evidence-based upgrade. §10.2 traversal and §6.4 the digest are **not** in this plan and are named as Plan 3; §9.2 adapters and §7.6 path claims are Plan 4.

**2. Placeholders.** None: every code step carries the code, every enumeration its exact values, every mutation table its exact edit.

**3. Type consistency.** `Anchor`/`Influence` are defined in Task 1 and consumed under those names in Tasks 2 and 5. `fieldsFor`/`normalizeEntryData`/`KIND_FIELDS` are defined in Task 3 and used in Task 3's CLI change only. `liveConstraints`/`constraintsBearingOn` are defined in Task 4 and consumed in Task 5. `ParsedFlags.all` is introduced in Task 2 and consumed in Task 3 — Task 3 depends on Task 2 and must not be reordered ahead of it.

**4. Known ordering constraint.** Task 3 moves `record`'s unknown-flag check to after `--kind` is read. Task 2 adds `anchor`/`influence` to the pre-kind list. Doing Task 3 before Task 2 would drop those flags from the generic gate.
