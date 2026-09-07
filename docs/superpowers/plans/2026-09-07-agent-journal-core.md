# Agent Journal Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/agent-journal` — a validated append-only decision journal with value-level redaction, workspace identity, projection with retraction, retention with anchor pinning, and a CLI that records and invalidates entries.

**Architecture:** A new sibling package to `agent-lifecycle`, not an extension of it. One append-only JSONL segment per writer process, so concurrent sessions never contend and merging is set union with dedup by id. Every write passes one validator and one value-level redactor; the redactor is the only fail-closed path. Reads are projections over segments — any index or digest is derived and rebuildable.

**Tech Stack:** TypeScript 5.9, Node >=24 ESM, `node:test` with `--experimental-strip-types`, zero runtime dependencies.

**Spec:** [docs/superpowers/specs/2026-09-07-agent-decision-journal-design.md](../specs/2026-09-07-agent-decision-journal-design.md)

**Scope:** Spec sections 4 (envelope), 5.8 (retraction), 6 (storage, identity, retention), 10.3 (void/coverage), 12.1 (redaction), and the CLI half of 10. A second plan covers the Claude Code and Codex adapters (9.2), the digest renderer (6.4), and the `decision-journal` skill.

## Global Constraints

- Node `>=24.0.0` in `engines`. Tests run under `node --test --experimental-strip-types test/*.ts`.
- `"type": "module"`. ESM only, no CommonJS interop.
- **Zero runtime dependencies.** `@types/node` and `typescript` are devDependencies only, matching `packages/agent-lifecycle`.
- **Do not modify `packages/agent-lifecycle`.** Its redactor is explicitly not reusable (spec 12.1, 14); this package writes its own.
- Every Markdown file must be non-empty and end with a newline — the repo's `check:markdown` enforces this.
- **Every relative import in `src/` and `test/` uses a `.ts` extension, never `.js`.** Node's
  `--experimental-strip-types` resolves the real file, so a `.js` specifier fails at runtime with
  `ERR_MODULE_NOT_FOUND`. `rewriteRelativeImportExtensions` (TypeScript 5.7+) rewrites them to
  `.js` on emit, so `dist/` is correct ESM. Verified: typecheck clean, build emits `./envelope.js`,
  and `import('./src/index.ts')` loads. Do not "fix" a `.ts` specifier to `.js`.
- RFC3339 UTC timestamps only: `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/`.
- Wall-clock time is display-only across sources. Ordering within a source uses `sequence` (spec 8.4). Never infer causality from timestamps.
- Bare `node` may resolve to a v26 install ahead of nvm on PATH. That satisfies the `>=24` floor so it is fine — but run `node -v` before diagnosing any test failure as real.
- **`scripts/verify-skills.mjs` scans every `.ts`/`.md`/`.json` file in the repo except `packages/agent-lifecycle`, and fails on two patterns.** This package is NOT exempt, so no file you write may contain either:
  - a literal secret shape — `gh[pousr]_` followed by 20+ word characters, or `sk-` followed by 20+ alphanumerics;
  - a literal absolute home path — a leading slash followed by `Users` or `home` and a username, or the Windows `C:` equivalent, where that path is preceded by start-of-line, whitespace, a quote, a backtick or a paren.
  Test fixtures that need those shapes **must build them at runtime** by concatenation or `join`, never as literals. Task 10's `npm run verify` fails otherwise.

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/agent-journal/src/envelope.ts` | Event types, anchor types, `normalizeEvent` validator |
| `packages/agent-journal/src/redact.ts` | Value-level redaction with a detectable failure verdict |
| `packages/agent-journal/src/identity.ts` | Workspace identity cascade, including worktree resolution |
| `packages/agent-journal/src/journal.ts` | Segment paths, append, rotation |
| `packages/agent-journal/src/read.ts` | Incremental parse, dedup, ordering |
| `packages/agent-journal/src/retract.ts` | `supersedes` / `invalidates` / `outcome` projection |
| `packages/agent-journal/src/retention.ts` | Anchor pinning, expiry, tombstones |
| `packages/agent-journal/src/coverage.ts` | `void` events and the coverage report |
| `packages/agent-journal/src/cli.ts` | `record`, `invalidate`, `coverage` subcommands |
| `packages/agent-journal/src/index.ts` | Public exports |

Tests mirror `src/` one-to-one under `test/*.test.ts`.

---

### Task 1: Package scaffold and the envelope validator

**Files:**
- Create: `packages/agent-journal/package.json`
- Create: `packages/agent-journal/tsconfig.json`
- Create: `packages/agent-journal/tsconfig.build.json`
- Create: `packages/agent-journal/src/envelope.ts`
- Create: `packages/agent-journal/src/index.ts`
- Test: `packages/agent-journal/test/envelope.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `JournalEvent`, `AnchorClass`, `Capabilities`, `Author`, `Provenance`, `normalizeEvent(value: unknown): JournalEvent`, `normalizeCapabilities(value: unknown): Capabilities`.

- [ ] **Step 1: Create the package manifest**

`packages/agent-journal/package.json`:

```json
{
  "name": "@crissmoldovan/agent-journal",
  "version": "0.1.0",
  "description": "Append-only decision journal for coding agents.",
  "license": "MIT",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    },
    "./package.json": "./package.json"
  },
  "engines": { "node": ">=24.0.0" },
  "files": ["dist/", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "node --experimental-strip-types --test test/*.ts",
    "check:types": "tsc --noEmit -p tsconfig.json",
    "verify": "npm run check:types && npm test && npm run build"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "^5.9.0"
  }
}
```

- [ ] **Step 2: Create both tsconfigs**

`packages/agent-journal/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

`packages/agent-journal/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Write the failing test**

`packages/agent-journal/test/envelope.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvent } from '../src/envelope.ts';

const base = {
  schemaVersion: 1,
  id: 'e1',
  source: 'claude-code/machine-a/sess-1/agent-0',
  sourceEpoch: 'epoch-1',
  time: '2026-09-07T10:00:00.000Z',
  workspace: 'ws-1',
  session: 'sess-1',
  agent: 'agent-0',
  author: 'agent',
  provenance: 'cli',
  harness: 'claude-code',
  context: 'coding',
  kind: 'decision',
  data: {},
};

test('accepts a minimal valid event', () => {
  const e = normalizeEvent(base);
  assert.equal(e.id, 'e1');
  assert.equal(e.context, 'coding');
});

test('omitted capabilities default to unknown, never to known', () => {
  const e = normalizeEvent(base);
  assert.equal(e.capabilities.commit, 'unknown');
  assert.equal(e.capabilities.tool_use, 'unknown');
});

test('an unregistered context passes through rather than erroring', () => {
  const e = normalizeEvent({ ...base, context: 'gardening' });
  assert.equal(e.context, 'gardening');
});

test('rejects a non-RFC3339 time', () => {
  assert.throws(() => normalizeEvent({ ...base, time: '2026-09-07 10:00:00' }), /RFC3339/);
});

test('rejects an unknown author', () => {
  assert.throws(() => normalizeEvent({ ...base, author: 'robot' }), /author/);
});

test('rejects a negative sequence', () => {
  assert.throws(() => normalizeEvent({ ...base, sequence: -1 }), /sequence/);
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd packages/agent-journal && npm test`
Expected: FAIL — cannot find module `../src/envelope.ts`.

- [ ] **Step 5: Write the implementation**

`packages/agent-journal/src/envelope.ts`:

```ts
export type Author = 'agent' | 'human';
export type Provenance = 'hook' | 'cli' | 'http' | 'mcp' | 'transcript';
export type Capability = 'known' | 'unknown';

export const ANCHOR_CLASSES = [
  'commit', 'file', 'environment', 'visual', 'runtime', 'tool_use', 'message', 'url', 'external',
] as const;
export type AnchorClass = (typeof ANCHOR_CLASSES)[number];
export type Capabilities = Record<AnchorClass, Capability>;

export interface JournalEvent {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly source: string;
  readonly sourceEpoch: string;
  readonly sequence?: number;
  readonly time: string;
  readonly workspace: string;
  readonly session: string;
  readonly agent: string;
  readonly author: Author;
  readonly provenance: Provenance;
  readonly harness: string;
  readonly context: string;
  readonly capabilities: Capabilities;
  readonly kind: string;
  readonly subject?: string;
  readonly data: Readonly<Record<string, unknown>>;
}

const AUTHORS = new Set<string>(['agent', 'human']);
const PROVENANCES = new Set<string>(['hook', 'cli', 'http', 'mcp', 'transcript']);
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function text(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new TypeError(`${field} is required`);
  return v.trim();
}

function timestamp(v: unknown, field: string): string {
  const s = text(v, field);
  if (!RFC3339.test(s) || Number.isNaN(Date.parse(s))) {
    throw new TypeError(`${field} must be RFC3339 UTC`);
  }
  return s;
}

/** Omitted anchor classes resolve to `unknown`. Never infer an optimistic default. */
export function normalizeCapabilities(v: unknown): Capabilities {
  const given = isRecord(v) ? v : {};
  const out = {} as Record<AnchorClass, Capability>;
  for (const cls of ANCHOR_CLASSES) out[cls] = given[cls] === 'known' ? 'known' : 'unknown';
  return out;
}

export function normalizeEvent(value: unknown): JournalEvent {
  if (!isRecord(value)) throw new TypeError('event must be an object');
  if (value.schemaVersion !== 1) throw new TypeError('schemaVersion must be 1');

  const author = text(value.author, 'author');
  if (!AUTHORS.has(author)) throw new TypeError(`author must be agent or human, got ${author}`);

  const provenance = text(value.provenance, 'provenance');
  if (!PROVENANCES.has(provenance)) throw new TypeError(`provenance is not recognised: ${provenance}`);

  let sequence: number | undefined;
  if (value.sequence !== undefined) {
    if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0) {
      throw new TypeError('sequence must be a non-negative integer');
    }
    sequence = value.sequence as number;
  }

  if (value.data !== undefined && !isRecord(value.data)) throw new TypeError('data must be an object');

  return {
    schemaVersion: 1,
    id: text(value.id, 'id'),
    source: text(value.source, 'source'),
    sourceEpoch: text(value.sourceEpoch, 'sourceEpoch'),
    ...(sequence === undefined ? {} : { sequence }),
    time: timestamp(value.time, 'time'),
    workspace: text(value.workspace, 'workspace'),
    session: text(value.session, 'session'),
    agent: text(value.agent, 'agent'),
    author: author as Author,
    provenance: provenance as Provenance,
    harness: text(value.harness, 'harness'),
    context: text(value.context, 'context'),
    capabilities: normalizeCapabilities(value.capabilities),
    kind: text(value.kind, 'kind'),
    ...(value.subject === undefined ? {} : { subject: text(value.subject, 'subject') }),
    data: isRecord(value.data) ? value.data : {},
  };
}
```

`packages/agent-journal/src/index.ts`:

```ts
export * from './envelope.ts';
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd packages/agent-journal && npm test`
Expected: PASS — 6 tests.

- [ ] **Step 7: Verify types compile**

Run: `cd packages/agent-journal && npm run check:types`
Expected: no output, exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/agent-journal
git commit -m "feat(journal): package scaffold and schema-v1 envelope validator"
```

---

### Task 2: Value-level redactor with a detectable failure verdict

Spec 12.1. The `agent-lifecycle` redactor matches key *names*, so it never fires on `rationale`, `excerpt`, `person` or `environment`, and it has no failure state — meaning the spec's only fail-closed rule can never trigger. This task builds the replacement.

**Files:**
- Create: `packages/agent-journal/src/redact.ts`
- Modify: `packages/agent-journal/src/index.ts`
- Test: `packages/agent-journal/test/redact.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `redact(value: unknown, options?: RedactOptions): RedactionResult`, `RedactionVerdict = 'clean' | 'redacted' | 'failed'`, `RedactionResult = { value: unknown; verdict: RedactionVerdict; hits: readonly string[]; reason?: string }`.

- [ ] **Step 1: Write the failing test**

`packages/agent-journal/test/redact.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../src/redact.ts';

// Fixtures are BUILT, never written as literals: scripts/verify-skills.mjs
// scans this file and fails on literal secret shapes and home paths.
const GH_TOKEN = `gh${'p'}_${'a1b2c3d4e5'.repeat(3)}`;
const HOME_NODE = ['', 'Users', 'alice', '.local', 'bin', 'node'].join('/');

test('redacts a secret in free text, not just under a suspicious key', () => {
  const r = redact({ rationale: `used ${GH_TOKEN} to fetch it` });
  assert.equal(r.verdict, 'redacted');
  assert.match(JSON.stringify(r.value), /\[REDACTED]/);
  assert.doesNotMatch(JSON.stringify(r.value), /a1b2c3d4e5/);
});

test('redacts an email address appearing in an excerpt', () => {
  const r = redact({ excerpt: 'raised by someone@example.com in review' });
  assert.equal(r.verdict, 'redacted');
  assert.doesNotMatch(JSON.stringify(r.value), /someone@example\.com/);
});

test('redacts a home directory path that leaks a username', () => {
  const r = redact({ environment: { node: HOME_NODE } });
  assert.equal(r.verdict, 'redacted');
  assert.doesNotMatch(JSON.stringify(r.value), /alice/);
});

test('leaves clean content untouched and reports clean', () => {
  const r = redact({ rationale: 'chose the projector because reconnect had to converge' });
  assert.equal(r.verdict, 'clean');
  assert.deepEqual([...r.hits], []);
});

test('reports a failure verdict when input exceeds the scan budget', () => {
  const r = redact({ blob: 'x'.repeat(200000) }, { maxBytes: 1024 });
  assert.equal(r.verdict, 'failed');
  assert.match(r.reason ?? '', /budget/);
});

test('reports a failure verdict on a value it cannot serialize', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const r = redact(cyclic);
  assert.equal(r.verdict, 'failed');
});

test('a secret inside a boxed String is redacted, not decomposed', () => {
  const r = redact({ rationale: new String(`used ${GH_TOKEN}`) });
  assert.equal(r.verdict, 'redacted');
  assert.doesNotMatch(JSON.stringify(r.value), /a1b2c3d4e5/);
});

test('a secret inside a Buffer is redacted — execSync returns Buffers by default', () => {
  const r = redact({ environment: { raw: Buffer.from(GH_TOKEN) } });
  assert.equal(r.verdict, 'redacted');
  assert.doesNotMatch(JSON.stringify(r.value), /a1b2c3d4e5/);
});

test('a Date is scanned via toJSON rather than silently becoming {}', () => {
  const r = redact({ environment: { at: new Date('2026-09-07T10:00:00.000Z') } });
  assert.equal(r.verdict, 'clean');
  assert.match(JSON.stringify(r.value), /2026-09-07T10:00:00/);
});

test('the depth guard fails closed and reports no partial hits', () => {
  let deep: Record<string, unknown> = { leaf: GH_TOKEN };
  for (let i = 0; i < 40; i += 1) deep = { nest: deep };
  const r = redact(deep, { maxDepth: 8 });
  assert.equal(r.verdict, 'failed');
  assert.equal(r.value, undefined);
  assert.deepEqual([...r.hits], []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/agent-journal && npm test`
Expected: FAIL — cannot find module `../src/redact.ts`.

- [ ] **Step 3: Write the implementation**

`packages/agent-journal/src/redact.ts`:

```ts
export type RedactionVerdict = 'clean' | 'redacted' | 'failed';

export interface RedactionResult {
  readonly value: unknown;
  readonly verdict: RedactionVerdict;
  readonly hits: readonly string[];
  readonly reason?: string;
}

export interface RedactOptions {
  /** Maximum serialized size scanned. Exceeding it is a failure, never a silent pass. */
  readonly maxBytes?: number;
  /** Maximum object depth traversed. */
  readonly maxDepth?: number;
}

/** Patterns applied to string CONTENT rather than to key names. */
const PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g },
  { name: 'openai-key', re: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: 'bearer', re: /\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi },
  { name: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { name: 'home-path', re: /\/(?:Users|home)\/[^/\s"']+/g },
  { name: 'home-path-win', re: /[A-Za-z]:\\Users\\[^\\\s"']+/g },
];

const DEFAULT_MAX_BYTES = 262144;
const DEFAULT_MAX_DEPTH = 32;

function scrub(input: string, hits: string[], path: string): string {
  let out = input;
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    if (!re.test(out)) continue;
    re.lastIndex = 0;
    hits.push(`${path}:${name}`);
    out = name === 'home-path' ? out.replace(re, '/[REDACTED]') : out.replace(re, '[REDACTED]');
  }
  return out;
}

export function redact(value: unknown, options: RedactOptions = {}): RedactionResult {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const hits: string[] = [];

  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? '';
  } catch (error) {
    return {
      value: undefined,
      verdict: 'failed',
      hits: [],
      reason: `unscannable value: ${(error as Error).message}`,
    };
  }
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    return {
      value: undefined,
      verdict: 'failed',
      hits: [],
      reason: `value exceeds the ${maxBytes}-byte scan budget`,
    };
  }

  function walk(node: unknown, depth: number, path: string): unknown {
    if (depth > maxDepth) throw new RangeError(`depth exceeds ${maxDepth} at ${path}`);
    const here = path || '$';
    if (typeof node === 'string') return scrub(node, hits, here);
    if (node === null || typeof node !== 'object') return node;

    // Boxed primitives. Without this, Object.entries decomposes a boxed String
    // into one entry PER CHARACTER, every pattern needs contiguous characters,
    // nothing matches, and a secret returns verdict 'clean' fully intact.
    if (node instanceof String) return scrub(node.valueOf(), hits, here);
    if (node instanceof Number || node instanceof Boolean) return node.valueOf();

    // Binary. Buffer is what execSync returns by default, so raw captured
    // command output reaches here routinely. Decode and scan it as text.
    if (node instanceof ArrayBuffer || ArrayBuffer.isView(node)) {
      const view = node instanceof ArrayBuffer
        ? new Uint8Array(node)
        : new Uint8Array((node as ArrayBufferView).buffer,
                         (node as ArrayBufferView).byteOffset,
                         (node as ArrayBufferView).byteLength);
      return scrub(new TextDecoder().decode(view), hits, here);
    }

    // Align the scan with the byte-budget pre-check, which uses JSON.stringify
    // semantics. Without this a Date scans as {} — no own enumerable keys — and
    // reports 'clean' for content that was never examined.
    const toJson = (node as { toJSON?: unknown }).toJSON;
    if (typeof toJson === 'function') {
      return walk((toJson as () => unknown).call(node), depth + 1, path);
    }

    if (Array.isArray(node)) return node.map((item, i) => walk(item, depth + 1, `${path}[${i}]`));

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = walk(v, depth + 1, path ? `${path}.${k}` : k);
    }
    return out;
  }

  try {
    const scrubbed = walk(value, 0, '');
    return { value: scrubbed, verdict: hits.length > 0 ? 'redacted' : 'clean', hits };
  } catch (error) {
    // hits is reset: a failed verdict yields no usable value, so reporting
    // partial hits would mislead any caller that branches on hits.length.
    hits.length = 0;
    return { value: undefined, verdict: 'failed', hits, reason: (error as Error).message };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/agent-journal && npm test`
Expected: PASS.

- [ ] **Step 5: Export it**

Append to `packages/agent-journal/src/index.ts`:

```ts
export * from './redact.ts';
```

- [ ] **Step 6: Commit**

```bash
git add packages/agent-journal
git commit -m "feat(journal): value-level redactor with a detectable failure verdict"
```

---

### Task 3: Workspace identity, including worktree resolution

Spec 6.1. The winning method must be recorded, and a worktree must resolve to the same workspace as its main checkout or 7.4's collision-avoidance silently never fires.

**Files:**
- Create: `packages/agent-journal/src/identity.ts`
- Modify: `packages/agent-journal/src/index.ts`
- Test: `packages/agent-journal/test/identity.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveWorkspace(cwd: string, options?: ResolveOptions): WorkspaceIdentity`, where `WorkspaceIdentity = { id: string; method: 'explicit' | 'git' | 'cwd' | 'host' | 'declared' | 'ephemeral'; detail: string }`.

- [ ] **Step 1: Write the failing test**

`packages/agent-journal/test/identity.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveWorkspace } from '../src/identity.ts';

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'journal-id-'));
}

test('an explicit id file wins and is reported as explicit', async () => {
  const dir = await tmp();
  await mkdir(join(dir, '.agent-journal'), { recursive: true });
  await writeFile(join(dir, '.agent-journal', 'id'), 'my-workspace\n', 'utf8');
  const id = resolveWorkspace(dir);
  assert.equal(id.id, 'my-workspace');
  assert.equal(id.method, 'explicit');
});

test('a git checkout resolves by its common directory', async () => {
  const dir = await tmp();
  const id = resolveWorkspace(dir, { gitCommonDir: '/repo/.git' });
  assert.equal(id.method, 'git');
  assert.equal(id.detail, '/repo/.git');
});

test('a worktree resolves to the SAME id as its main checkout', () => {
  const main = resolveWorkspace('/repo', { gitCommonDir: '/repo/.git' });
  const tree = resolveWorkspace('/repo-feature', { gitCommonDir: '/repo/.git' });
  assert.equal(main.id, tree.id);
});

test('falls back to a cwd hash when there is no git', async () => {
  const dir = await tmp();
  const id = resolveWorkspace(dir, { gitCommonDir: null });
  assert.equal(id.method, 'cwd');
  // realpathSync, not `dir`: on macOS mkdtemp returns /var/... which canonicalises
  // to /private/var/..., so comparing against the raw path fails there and passes
  // on Linux — a platform-dependent RED that would waste the next person's hour.
  assert.equal(id.detail, realpathSync(dir));
});

test('a declared id is used when no filesystem rung applies', () => {
  const id = resolveWorkspace('', { gitCommonDir: null, declared: 'cowork-space-7' });
  assert.equal(id.method, 'declared');
  assert.equal(id.id, 'cowork-space-7');
});

test('an explicit id file BEATS git — the rungs must actually compete', async () => {
  const dir = await tmp();
  await mkdir(join(dir, '.agent-journal'), { recursive: true });
  await writeFile(join(dir, '.agent-journal', 'id'), 'declared-wins\n', 'utf8');
  // Both rungs are satisfiable here. Reorder the cascade and this test fails.
  const id = resolveWorkspace(dir, { gitCommonDir: '/repo/.git' });
  assert.equal(id.method, 'explicit');
  assert.equal(id.id, 'declared-wins');
});

test('a host container id is used when there is no git and no explicit file', async () => {
  const dir = await tmp();
  const id = resolveWorkspace(dir, { gitCommonDir: null, hostContainer: 'cowork-space-7' });
  assert.equal(id.method, 'host');
  assert.equal(id.detail, 'cowork-space-7');
});

test('the ephemeral rung yields a distinct id per call', () => {
  const a = resolveWorkspace('', {});
  const b = resolveWorkspace('', {});
  assert.equal(a.method, 'ephemeral');
  assert.notEqual(a.id, b.id);
});

test('an unreadable id file throws rather than becoming a different workspace', async () => {
  const dir = await tmp();
  // A directory where the id file belongs: readFileSync raises EISDIR, which is
  // neither ENOENT nor ENOTDIR, so it must propagate.
  await mkdir(join(dir, '.agent-journal', 'id'), { recursive: true });
  assert.throws(() => resolveWorkspace(dir, { gitCommonDir: '/repo/.git' }));
});

test('two symlinked spellings of one directory share a workspace id', async () => {
  const real = await tmp();
  const link = join(await tmp(), 'link');
  await symlink(real, link, 'dir');
  assert.equal(
    resolveWorkspace(link, { gitCommonDir: null }).id,
    resolveWorkspace(real, { gitCommonDir: null }).id,
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/agent-journal && npm test`
Expected: FAIL — cannot find module `../src/identity.ts`.

- [ ] **Step 3: Write the implementation**

`packages/agent-journal/src/identity.ts`:

```ts
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type ResolutionMethod = 'explicit' | 'git' | 'cwd' | 'host' | 'declared' | 'ephemeral';

export interface WorkspaceIdentity {
  readonly id: string;
  readonly method: ResolutionMethod;
  /** What the method keyed on, so the choice can be inspected later. */
  readonly detail: string;
}

export interface ResolveOptions {
  /**
   * Output of `git rev-parse --git-common-dir`, absolute.
   * A worktree and its main checkout share this, which is what collapses them
   * into one workspace. Pass null when there is no repository.
   */
  readonly gitCommonDir?: string | null;
  /** Host container id (ChatGPT Project, Claude Project, Cowork space). */
  readonly hostContainer?: string | null;
  /** An id the agent asked for and recorded. */
  readonly declared?: string | null;
}

function hash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/** Canonicalises through symlinks where the path exists, so two spellings of one
 *  directory never open two journals. macOS `/tmp` vs `/private/tmp` is the common case. */
function canonical(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

function readExplicitId(cwd: string): string | null {
  try {
    const raw = readFileSync(join(cwd, '.agent-journal', 'id'), 'utf8').trim();
    return raw.length > 0 ? raw : null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Absent is a normal answer. Anything else — a permissions failure, a
    // directory where a file belongs — must NOT become a silently different
    // workspace. The spec requires identity be declared and recorded; falling
    // through would record `method: 'git'` for an id nobody declared.
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
}

export function resolveWorkspace(cwd: string, options: ResolveOptions = {}): WorkspaceIdentity {
  const explicit = cwd ? readExplicitId(cwd) : null;
  if (explicit) return { id: explicit, method: 'explicit', detail: join(cwd, '.agent-journal/id') };

  const common = options.gitCommonDir;
  if (common) {
    const normalized = canonical(common);
    return { id: `git-${hash(normalized)}`, method: 'git', detail: normalized };
  }

  if (options.hostContainer) {
    return { id: `host-${hash(options.hostContainer)}`, method: 'host', detail: options.hostContainer };
  }

  if (options.declared) {
    return { id: options.declared, method: 'declared', detail: 'declared by agent' };
  }

  if (cwd) {
    const normalized = canonical(cwd);
    return { id: `cwd-${hash(normalized)}`, method: 'cwd', detail: normalized };
  }

  // Random, not time-seeded: two sessions starting in the same millisecond are
  // unrelated and must not collide onto one journal.
  return {
    id: `ephemeral-${randomUUID()}`,
    method: 'ephemeral',
    detail: 'no durable identity available',
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/agent-journal && npm test`
Expected: PASS.

- [ ] **Step 5: Export it**

Append to `packages/agent-journal/src/index.ts`:

```ts
export * from './identity.ts';
```

- [ ] **Step 6: Commit**

```bash
git add packages/agent-journal
git commit -m "feat(journal): workspace identity cascade with worktree resolution"
```

---

### Task 4: Segment journal, append and rotation

Spec 6.2 and 8.3. One segment per writer process; aggressive rotation so only one small file per writer is ever mutable, which is what lets naive file-sync work.

**Files:**
- Create: `packages/agent-journal/src/journal.ts`
- Modify: `packages/agent-journal/src/index.ts`
- Test: `packages/agent-journal/test/journal.test.ts`

**Interfaces:**
- Consumes: `JournalEvent` from `envelope.ts`; `redact`, `RedactionVerdict` from `redact.ts`.
- Produces: `class SegmentJournal` with `constructor(options: SegmentJournalOptions)`, `append(event: JournalEvent): Promise<AppendResult>`, `segmentPath(): string`. `SegmentJournalOptions = { root, workspace, machine, session, agent, epoch, rotateBytes? }`. `AppendResult = { written: boolean; path: string; verdict: RedactionVerdict; reason?: string }`.

- [ ] **Step 1: Write the failing test**

`packages/agent-journal/test/journal.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SegmentJournal } from '../src/journal.ts';
import { normalizeEvent } from '../src/envelope.ts';

function event(id: string, data: Record<string, unknown> = {}) {
  return normalizeEvent({
    schemaVersion: 1, id, source: 'claude-code/m/s/a', sourceEpoch: 'e1',
    time: '2026-09-07T10:00:00.000Z', workspace: 'ws', session: 's', agent: 'a',
    author: 'agent', provenance: 'cli', harness: 'claude-code', context: 'coding',
    kind: 'decision', data,
  });
}

async function journal(rotateBytes?: number) {
  const root = await mkdtemp(join(tmpdir(), 'journal-seg-'));
  const base = { root, workspace: 'ws', machine: 'm', session: 's', agent: 'a', epoch: 'e1' };
  const j = new SegmentJournal(rotateBytes === undefined ? base : { ...base, rotateBytes });
  return { root, j };
}

test('appends one JSON object per line', async () => {
  const { j } = await journal();
  await j.append(event('e1'));
  await j.append(event('e2'));
  const lines = (await readFile(j.segmentPath(), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[1]!).id, 'e2');
});

test('refuses to write when redaction fails — and NOTHING reaches disk', async () => {
  const { j } = await journal();
  const result = await j.append(event('REFUSED', { blob: 'x'.repeat(300000) }));
  assert.equal(result.written, false);
  assert.equal(result.verdict, 'failed');
  // The guarantee is about the filesystem, not the return value. Asserting only
  // `written: false` would still pass if the early return moved after mkdir.
  assert.equal(existsSync(result.path), false, 'a refused append must create no file');
  // And the refused payload must not appear once a later append creates the file.
  await j.append(event('KEPT'));
  const disk = await readFile(j.segmentPath(), 'utf8');
  assert.doesNotMatch(disk, /REFUSED/);
  assert.match(disk, /KEPT/);
});

test('a refusal does not poison the queue for later appends', async () => {
  const { j } = await journal();
  const [bad, good] = await Promise.all([
    j.append(event('DROP', { blob: 'x'.repeat(300000) })),
    j.append(event('SURVIVES')),
  ]);
  assert.equal(bad.written, false);
  assert.equal(good.written, true);
  // Each call must report the file IT wrote, not another caller's.
  assert.equal(good.path, j.segmentPath());
  const disk = await readFile(j.segmentPath(), 'utf8');
  assert.equal(disk.trim().split('\n').length, 1);
});

test('redacts a secret before it reaches disk', async () => {
  const { j } = await journal();
  // Built, not literal — see the verify-gate constraint in the plan header.
  const token = `gh${'p'}_${'a1b2c3d4e5'.repeat(3)}`;
  await j.append(event('e4', { rationale: `token ${token}` }));
  const written = await readFile(j.segmentPath(), 'utf8');
  assert.doesNotMatch(written, /a1b2c3d4e5/);
  assert.match(written, /\[REDACTED]/);
});

test('rotates to a new segment once the byte threshold is passed', async () => {
  const { root, j } = await journal(200);
  for (let i = 0; i < 8; i += 1) await j.append(event(`e${i}`));
  const files = await readdir(join(root, 'workspaces', 'ws', 'segments', 'm', 's'));
  assert.ok(files.length > 1, `expected rotation, saw ${files.join(', ')}`);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/agent-journal && npm test`
Expected: FAIL — cannot find module `../src/journal.ts`.

- [ ] **Step 3: Write the implementation**

`packages/agent-journal/src/journal.ts`:

```ts
import { appendFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { JournalEvent } from './envelope.ts';
import { redact, type RedactionVerdict } from './redact.ts';

export interface SegmentJournalOptions {
  readonly root: string;
  readonly workspace: string;
  readonly machine: string;
  readonly session: string;
  readonly agent: string;
  readonly epoch: string;
  /** Rotate once the active segment passes this size. Small keeps the mutable surface small. */
  readonly rotateBytes?: number;
}

export interface AppendResult {
  readonly written: boolean;
  readonly path: string;
  readonly verdict: RedactionVerdict;
  readonly reason?: string;
}

const DEFAULT_ROTATE_BYTES = 524288;

export class SegmentJournal {
  readonly #options: SegmentJournalOptions;
  readonly #rotateBytes: number;
  #index = 0;
  #queue: Promise<void> = Promise.resolve();

  constructor(options: SegmentJournalOptions) {
    this.#options = options;
    this.#rotateBytes = options.rotateBytes ?? DEFAULT_ROTATE_BYTES;
  }

  get #dir(): string {
    const { root, workspace, machine, session } = this.#options;
    return join(root, 'workspaces', workspace, 'segments', machine, session);
  }

  segmentPath(): string {
    const { agent, epoch } = this.#options;
    return join(this.#dir, `${agent}.${epoch}.${this.#index}.jsonl`);
  }

  async #rotateIfNeeded(): Promise<void> {
    try {
      const info = await stat(this.segmentPath());
      if (info.size >= this.#rotateBytes) this.#index += 1;
    } catch {
      // No active segment yet; nothing to rotate.
    }
  }

  /**
   * Redaction is the only fail-closed path (spec 12). A failed verdict refuses the
   * write rather than writing a possible secret.
   */
  async append(event: JournalEvent): Promise<AppendResult> {
    const scrubbed = redact(event);
    if (scrubbed.verdict === 'failed') {
      return {
        written: false,
        path: this.segmentPath(),
        verdict: 'failed',
        ...(scrubbed.reason === undefined ? {} : { reason: scrubbed.reason }),
      };
    }

    let path = this.segmentPath();
    const write = this.#queue.then(async () => {
      await mkdir(this.#dir, { recursive: true });
      await this.#rotateIfNeeded();
      path = this.segmentPath();
      await appendFile(path, `${JSON.stringify(scrubbed.value)}\n`, 'utf8');
    });
    this.#queue = write.catch(() => undefined);
    await write;

    return { written: true, path, verdict: scrubbed.verdict };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/agent-journal && npm test`
Expected: PASS.

- [ ] **Step 5: Export it**

Append to `packages/agent-journal/src/index.ts`:

```ts
export * from './journal.ts';
```

- [ ] **Step 6: Commit**

```bash
git add packages/agent-journal
git commit -m "feat(journal): append-only segment writer with rotation and fail-closed redaction"
```

---

### Task 5: Read, dedup and order

Spec 8.1 (set union with dedup by id) and 8.4 (sequence authoritative within a source, wall clock display-only across sources).

**Files:**
- Create: `packages/agent-journal/src/read.ts`
- Modify: `packages/agent-journal/src/index.ts`
- Test: `packages/agent-journal/test/read.test.ts`

**Interfaces:**
- Consumes: `JournalEvent`, `normalizeEvent` from `envelope.ts`.
- Produces: `parseSegment(text: string): { events: JournalEvent[]; bad: ParseDiagnostic[] }`, `mergeEvents(batches: readonly (readonly JournalEvent[])[]): JournalEvent[]`, `ParseDiagnostic = { line: number; message: string }`.

- [ ] **Step 1: Write the failing test**

`packages/agent-journal/test/read.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSegment, mergeEvents } from '../src/read.ts';
import { normalizeEvent } from '../src/envelope.ts';

function ev(id: string, extra: Record<string, unknown> = {}) {
  return normalizeEvent({
    schemaVersion: 1, id, source: 'h/m/s/a', sourceEpoch: 'e1',
    time: '2026-09-07T10:00:00.000Z', workspace: 'ws', session: 's', agent: 'a',
    author: 'agent', provenance: 'cli', harness: 'claude-code', context: 'coding',
    kind: 'decision', data: {}, ...extra,
  });
}

test('recovers valid records around a corrupt line', () => {
  const good = JSON.stringify(ev('e1'));
  const also = JSON.stringify(ev('e2'));
  const { events, bad } = parseSegment(`${good}\n{not json\n${also}\n`);
  assert.deepEqual(events.map((e) => e.id), ['e1', 'e2']);
  assert.equal(bad.length, 1);
  assert.equal(bad[0]!.line, 2);
});

test('merging two replicas dedups by id', () => {
  const merged = mergeEvents([[ev('e1'), ev('e2')], [ev('e2'), ev('e3')]]);
  assert.deepEqual(merged.map((e) => e.id), ['e1', 'e2', 'e3']);
});

test('orders by sequence within one source, not by wall clock', () => {
  const a = ev('a', { sequence: 2, time: '2026-09-07T10:00:00.000Z' });
  const b = ev('b', { sequence: 1, time: '2026-09-07T11:00:00.000Z' });
  assert.deepEqual(mergeEvents([[a, b]]).map((e) => e.id), ['b', 'a']);
});

test('merge is order-independent', () => {
  const one = mergeEvents([[ev('e1'), ev('e2')], [ev('e3')]]);
  const two = mergeEvents([[ev('e3')], [ev('e2'), ev('e1')]]);
  assert.deepEqual(one.map((e) => e.id), two.map((e) => e.id));
});

test('a source with MIXED sequence presence still sorts identically every way', () => {
  // The intransitive case: sequence says A<B, wall clock says B<C<A.
  const a = ev('A', { sequence: 1, time: '2026-09-07T03:00:00.000Z' });
  const b = ev('B', { sequence: 2, time: '2026-09-07T01:00:00.000Z' });
  const c = ev('C', { time: '2026-09-07T02:00:00.000Z' });
  const permutations = [[a, b, c], [b, c, a], [c, a, b], [a, c, b], [b, a, c], [c, b, a]];
  const results = new Set(permutations.map((p) => mergeEvents([p]).map((e) => e.id).join('')));
  assert.equal(results.size, 1, `order-dependent: got ${[...results].join(' | ')}`);
});

test('a source keeps its own sequence order regardless of clock skew', () => {
  const a = ev('A', { sequence: 1, time: '2026-09-07T03:00:00.000Z' });
  const b = ev('B', { sequence: 2, time: '2026-09-07T01:00:00.000Z' });
  assert.deepEqual(mergeEvents([[b, a]]).map((e) => e.id), ['A', 'B']);
});

test('a space in source or epoch cannot merge two distinct sequence spaces', () => {
  const one = ev('one', { source: 'foo', sourceEpoch: 'bar baz', sequence: 2 });
  const two = ev('two', { source: 'foo bar', sourceEpoch: 'baz', sequence: 1 });
  // Pin the EXPECTED order, not merely self-consistency. Under the space-join
  // bug both events land in one group and sort by sequence to ['two','one'];
  // correctly separated, they are distinct groups tied on time and broken by
  // key, giving ['one','two']. Asserting only that two batch orders agree
  // passes under both, which is how the earlier version of this test failed to
  // catch anything.
  assert.deepEqual(mergeEvents([[one, two]]).map((e) => e.id), ['one', 'two']);
  assert.deepEqual(mergeEvents([[two, one]]).map((e) => e.id), ['one', 'two']);
});

test('duplicate sequence numbers in one source still order deterministically', () => {
  const a = ev('aa', { sequence: 1 });
  const b = ev('bb', { sequence: 1 });
  assert.deepEqual(mergeEvents([[a, b]]).map((e) => e.id), mergeEvents([[b, a]]).map((e) => e.id));
});

test('parse diagnostics are bounded', () => {
  const { bad } = parseSegment(Array.from({ length: 200 }, () => '{broken').join('\n'));
  assert.equal(bad.length, 32);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/agent-journal && npm test`
Expected: FAIL — cannot find module `../src/read.ts`.

- [ ] **Step 3: Write the implementation**

`packages/agent-journal/src/read.ts`:

```ts
import { normalizeEvent, type JournalEvent } from './envelope.ts';

export interface ParseDiagnostic {
  readonly line: number;
  readonly message: string;
}

/** Matches the sibling package's bound. A segment truncated repeatedly by a lossy
 *  sync tool can otherwise produce one diagnostic per line with no ceiling. */
const MAX_DIAGNOSTICS = 32;

/** Parses JSONL, retaining every valid record around any malformed one. */
export function parseSegment(text: string): { events: JournalEvent[]; bad: ParseDiagnostic[] } {
  const events: JournalEvent[] = [];
  const bad: ParseDiagnostic[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]!.trim();
    if (!raw) continue;
    try {
      events.push(normalizeEvent(JSON.parse(raw)));
    } catch (error) {
      if (bad.length < MAX_DIAGNOSTICS) {
        bad.push({ line: i + 1, message: (error as Error).message });
      }
    }
  }
  return { events, bad };
}

/**
 * Injective join. A bare space is NOT collision-free: source "foo" with epoch
 * "bar baz" and source "foo bar" with epoch "baz" both yield "foo bar baz",
 * which would make two distinct sources share one sequence space. Both fields
 * are unconstrained text. The sibling package uses NUL for the same reason.
 */
function sourceKey(e: JournalEvent): string {
  return `${e.source}\0${e.sourceEpoch}`;
}

/**
 * Set union with dedup by id, then a deterministic total order.
 *
 * ORDERING CONTRACT — read this before changing the comparator.
 *
 * A single comparator cannot both interleave sources by wall clock AND honour
 * per-source `sequence`: the two bases disagree, and applying them per-PAIR is
 * intransitive. With A(seq 1, t=3), B(seq 2, t=1) and C(no seq, t=2) in one
 * source, A<B by sequence, B<C by time and C<A by time — a cycle, and
 * `Array.prototype.sort` then yields different output for different input
 * orders. That falsifies the order-independence this function exists to give.
 *
 * The spec resolves it (8.4): `sequence` is authoritative WITHIN a source, and
 * causality is NEVER inferred from timestamps. So the output is grouped by
 * source rather than interleaved by clock. Each source's own events are
 * correctly ordered; groups are ordered by their earliest observed time, then
 * by key. Both bases are applied to DISJOINT partitions, so the order is total
 * and the result is identical for any input permutation.
 *
 * A consumer wanting a clock-interleaved view sorts a projection itself and
 * owns that view's limits. Replay needs within-source correctness, not a
 * global timeline.
 *
 * Dedup is first-writer-wins. The design assumes one id means one immutable
 * event; if a replica ever violates that, the surviving copy depends on batch
 * order. Recorded rather than defended against.
 */
export function mergeEvents(batches: readonly (readonly JournalEvent[])[]): JournalEvent[] {
  const byId = new Map<string, JournalEvent>();
  for (const batch of batches) {
    for (const e of batch) if (!byId.has(e.id)) byId.set(e.id, e);
  }

  const groups = new Map<string, JournalEvent[]>();
  for (const e of byId.values()) {
    const key = sourceKey(e);
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }

  for (const list of groups.values()) {
    list.sort((a, b) => {
      // Sequenced events form one partition and unsequenced another; a
      // comparison never mixes the two bases, which is what makes it transitive.
      const aUnsequenced = a.sequence === undefined ? 1 : 0;
      const bUnsequenced = b.sequence === undefined ? 1 : 0;
      if (aUnsequenced !== bUnsequenced) return aUnsequenced - bUnsequenced;
      if (aUnsequenced === 0) {
        // The id tiebreak is load-bearing, not decoration. Nothing enforces
        // sequence uniqueness within a source, and returning 0 for a duplicate
        // lets a stable sort preserve INPUT order — so the same events in a
        // different batch order come out differently. Found by fuzzing the
        // permutation property, after fixing the intransitivity above.
        const bySequence = a.sequence! - b.sequence!;
        return bySequence !== 0 ? bySequence : a.id.localeCompare(b.id);
      }
      const byTime = Date.parse(a.time) - Date.parse(b.time);
      return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
    });
  }

  const earliest = (list: readonly JournalEvent[]): number =>
    list.reduce((min, e) => Math.min(min, Date.parse(e.time)), Number.POSITIVE_INFINITY);

  return [...groups.entries()]
    .sort(([kx, gx], [ky, gy]) => {
      const byTime = earliest(gx) - earliest(gy);
      return byTime !== 0 ? byTime : kx.localeCompare(ky);
    })
    .flatMap(([, list]) => list);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/agent-journal && npm test`
Expected: PASS.

- [ ] **Step 5: Export it**

Append to `packages/agent-journal/src/index.ts`:

```ts
export * from './read.ts';
```

- [ ] **Step 6: Commit**

```bash
git add packages/agent-journal
git commit -m "feat(journal): JSONL parsing with corruption recovery and order-independent merge"
```

---

### Task 6: Retraction — supersedes, invalidates, outcome

Spec 5.8. `supersedes` means a later decision replaced a reasonable one; `invalidates` means the premise was false and suppresses descendants. `outcome: unknown` is displayed rather than hidden, because "nobody checked whether this held" is itself the signal.

**Files:**
- Create: `packages/agent-journal/src/retract.ts`
- Modify: `packages/agent-journal/src/index.ts`
- Test: `packages/agent-journal/test/retract.test.ts`

**Interfaces:**
- Consumes: `JournalEvent` from `envelope.ts`.
- Produces: `project(events: readonly JournalEvent[]): Projection`, `Outcome = 'unknown' | 'held' | 'reverted' | 'invalidated'`, `Projection = { live: JournalEvent[]; superseded: ReadonlySet<string>; invalidated: ReadonlySet<string>; outcomes: ReadonlyMap<string, Outcome> }`.

- [ ] **Step 1: Write the failing test**

`packages/agent-journal/test/retract.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project } from '../src/retract.ts';
import { normalizeEvent } from '../src/envelope.ts';

function entry(id: string, data: Record<string, unknown> = {}) {
  return normalizeEvent({
    schemaVersion: 1, id, source: 'h/m/s/a', sourceEpoch: 'e1',
    time: '2026-09-07T10:00:00.000Z', workspace: 'ws', session: 's', agent: 'a',
    author: 'agent', provenance: 'cli', harness: 'claude-code', context: 'coding',
    kind: 'decision', data,
  });
}

test('a superseded entry leaves the live set but is not invalidated', () => {
  const p = project([entry('old'), entry('new', { supersedes: 'old' })]);
  assert.ok(p.superseded.has('old'));
  assert.equal(p.invalidated.has('old'), false);
  assert.deepEqual(p.live.map((e) => e.id), ['new']);
});

test('an invalidated entry is suppressed and marked', () => {
  const p = project([entry('wrong'), entry('fix', { invalidates: 'wrong' })]);
  assert.ok(p.invalidated.has('wrong'));
  assert.equal(p.outcomes.get('wrong'), 'invalidated');
});

test('invalidation suppresses entries that rest on the invalidated one', () => {
  const p = project([
    entry('root'),
    entry('child', { influences: [{ type: 'journal', ref: 'root' }] }),
    entry('retraction', { invalidates: 'root' }),
  ]);
  assert.ok(p.invalidated.has('child'), 'descendant should be suppressed');
  assert.equal(p.live.some((e) => e.id === 'child'), false);
});

test('invalidation propagates through a CHAIN, not just one level', () => {
  // A <- B <- C, with C placed BEFORE B in the array. A single pass visits C
  // while B is not yet marked, so it misses C entirely and stops one level
  // short. Only a fixed-point loop catches it. The single-level test above
  // passes against a single-pass implementation, so this one is the real guard.
  const p = project([
    entry('A'),
    entry('C', { influences: [{ type: 'journal', ref: 'B' }] }),
    entry('B', { influences: [{ type: 'journal', ref: 'A' }] }),
    entry('R', { invalidates: 'A' }),
  ]);
  assert.ok(p.invalidated.has('B'), 'direct descendant suppressed');
  assert.ok(p.invalidated.has('C'), 'transitive descendant suppressed');
  assert.equal(p.live.some((e) => e.id === 'C'), false);
});

test('an entry nobody revisited reports outcome unknown, not held', () => {
  assert.equal(project([entry('lonely')]).outcomes.get('lonely'), 'unknown');
});

test('invalidation outranks supersession regardless of event order', () => {
  const x = entry('X');
  const inv = entry('inv', { invalidates: 'X' });
  const sup = entry('sup', { supersedes: 'X' });
  // Both orders must agree, and both must say invalidated: an entry whose
  // premise was false does not become merely "replaced" because someone later
  // superseded it.
  for (const order of [[x, inv, sup], [x, sup, inv]]) {
    const p = project(order);
    assert.equal(p.outcomes.get('X'), 'invalidated');
    assert.ok(p.invalidated.has('X'));
  }
});

test('a self-declared outcome never overrides a retraction edge', () => {
  const p = project([
    entry('Y', { outcome: 'held' }),
    entry('r', { invalidates: 'Y' }),
  ]);
  assert.equal(p.outcomes.get('Y'), 'invalidated');
});

test('supersedes does NOT cascade to descendants — only invalidates does', () => {
  // B rests on A. Superseding A means a newer decision replaced it, not that A
  // was wrong, so B stands. Widening the propagation test to match `superseded`
  // would conflate the two edges and pass every other test in this file.
  const p = project([
    entry('A'),
    entry('B', { influences: [{ type: 'journal', ref: 'A' }] }),
    entry('s', { supersedes: 'A' }),
  ]);
  assert.equal(p.invalidated.has('B'), false);
  assert.ok(p.live.some((e) => e.id === 'B'), 'B must remain live');
});

test('a human retraction from outside a session is honoured', () => {
  const human = normalizeEvent({
    schemaVersion: 1, id: 'r1', source: 'cli/m/-/-', sourceEpoch: 'e2',
    time: '2026-09-07T12:00:00.000Z', workspace: 'ws', session: '-', agent: '-',
    author: 'human', provenance: 'cli', harness: 'other', context: 'coding',
    kind: 'decision', data: { invalidates: 'bad', rationale: 'premise never held' },
  });
  assert.ok(project([entry('bad'), human]).invalidated.has('bad'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/agent-journal && npm test`
Expected: FAIL — cannot find module `../src/retract.ts`.

- [ ] **Step 3: Write the implementation**

`packages/agent-journal/src/retract.ts`:

```ts
import type { JournalEvent } from './envelope.ts';

export type Outcome = 'unknown' | 'held' | 'reverted' | 'invalidated';

export interface Projection {
  readonly live: JournalEvent[];
  readonly superseded: ReadonlySet<string>;
  readonly invalidated: ReadonlySet<string>;
  readonly outcomes: ReadonlyMap<string, Outcome>;
}

function stringField(event: JournalEvent, field: string): string | undefined {
  const v = event.data[field];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Ids this entry rests on, via `influences` of type `journal`. */
function journalInfluences(event: JournalEvent): string[] {
  const raw = event.data.influences;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const rec = item as Record<string, unknown>;
      if (rec.type === 'journal' && typeof rec.ref === 'string') out.push(rec.ref);
    }
  }
  return out;
}

export function project(events: readonly JournalEvent[]): Projection {
  const superseded = new Set<string>();
  const invalidated = new Set<string>();
  const outcomes = new Map<string, Outcome>();

  for (const e of events) outcomes.set(e.id, 'unknown');

  // Collect the edges FIRST, then assign outcomes by precedence. Assigning
  // inside this loop makes the result depend on array order: an entry that is
  // both invalidated and superseded would display whichever edge happened to be
  // processed last, so the same events in a different order give a different
  // answer — the defect class Task 5 shipped.
  for (const e of events) {
    const sup = stringField(e, 'supersedes');
    if (sup) superseded.add(sup);
    const inv = stringField(e, 'invalidates');
    if (inv) invalidated.add(inv);
  }

  // Precedence, weakest to strongest. Invalidation is the strongest claim there
  // is — "this was never sound" — and must never be displaced by a supersession
  // that merely says "something newer replaced it". Displaying `reverted` for an
  // invalidated entry tells a reader the original reasoning still stood, which is
  // exactly the conflation this task exists to prevent.
  for (const e of events) {
    const declared = e.data.outcome;
    if (declared === 'held' || declared === 'reverted') outcomes.set(e.id, declared);
  }
  for (const id of superseded) outcomes.set(id, 'reverted');
  for (const id of invalidated) outcomes.set(id, 'invalidated');

  // Invalidation propagates: anything resting on an invalidated entry is suppressed.
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of events) {
      if (invalidated.has(e.id)) continue;
      if (journalInfluences(e).some((ref) => invalidated.has(ref))) {
        invalidated.add(e.id);
        outcomes.set(e.id, 'invalidated');
        changed = true;
      }
    }
  }

  const live = events.filter((e) => !superseded.has(e.id) && !invalidated.has(e.id));
  return { live, superseded, invalidated, outcomes };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/agent-journal && npm test`
Expected: PASS.

- [ ] **Step 5: Export it**

Append to `packages/agent-journal/src/index.ts`:

```ts
export * from './retract.ts';
```

- [ ] **Step 6: Commit**

```bash
git add packages/agent-journal
git commit -m "feat(journal): supersedes, invalidates and propagating retraction"
```

---

### Task 7: Retention — anchor pinning and tombstones

Spec 6.3 and 13.2. An observation cited by a live entry is pinned, so retention stops deleting the proof while keeping the assertion. A tombstone suppresses a target and downgrades citing anchors.

**Files:**
- Create: `packages/agent-journal/src/retention.ts`
- Modify: `packages/agent-journal/src/index.ts`
- Test: `packages/agent-journal/test/retention.test.ts`

**Interfaces:**
- Consumes: `JournalEvent` from `envelope.ts`; `project` from `retract.ts`.
- Produces: `isEntry(event: JournalEvent): boolean`, `applyRetention(events: readonly JournalEvent[], options: RetentionOptions): RetentionResult`. `RetentionOptions = { now: string; observationTtlMs: number; tombstoned?: readonly string[] }`. `RetentionResult = { keep: JournalEvent[]; expired: string[]; pinned: string[]; downgraded: string[] }`.

- [ ] **Step 1: Write the failing test**

`packages/agent-journal/test/retention.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRetention } from '../src/retention.ts';
import { normalizeEvent } from '../src/envelope.ts';

function make(id: string, kind: string, time: string, data: Record<string, unknown> = {}) {
  return normalizeEvent({
    schemaVersion: 1, id, source: 'h/m/s/a', sourceEpoch: 'e1', time,
    workspace: 'ws', session: 's', agent: 'a', author: 'agent', provenance: 'hook',
    harness: 'claude-code', context: 'coding', kind, data,
  });
}

const OLD = '2026-01-01T00:00:00.000Z';
const NOW = '2026-09-07T00:00:00.000Z';
const THIRTY_DAYS = 30 * 86400000;

test('an old observation nothing cites is expired', () => {
  const r = applyRetention([make('o1', 'tool_call', OLD)], { now: NOW, observationTtlMs: THIRTY_DAYS });
  assert.deepEqual(r.expired, ['o1']);
  assert.equal(r.keep.length, 0);
});

test('an old observation cited by a live entry is PINNED, not expired', () => {
  const r = applyRetention([
    make('o1', 'tool_call', OLD),
    make('d1', 'decision', OLD, { anchors: [{ type: 'tool_use', ref: 'o1' }] }),
  ], { now: NOW, observationTtlMs: THIRTY_DAYS });
  assert.deepEqual(r.pinned, ['o1']);
  assert.deepEqual(r.expired, []);
});

test('entries are never expired by the observation window', () => {
  const r = applyRetention([make('d1', 'decision', OLD)], { now: NOW, observationTtlMs: THIRTY_DAYS });
  assert.deepEqual(r.expired, []);
});

test('an observation cited only by an INVALIDATED entry loses its pin', () => {
  const r = applyRetention([
    make('o1', 'tool_call', OLD),
    make('d1', 'decision', OLD, { anchors: [{ type: 'tool_use', ref: 'o1' }] }),
    make('d2', 'decision', NOW, { invalidates: 'd1' }),
  ], { now: NOW, observationTtlMs: THIRTY_DAYS });
  assert.deepEqual(r.expired, ['o1']);
});

test('a tombstoned target is removed and its citing anchors are downgraded', () => {
  const r = applyRetention([
    make('o1', 'tool_call', NOW),
    make('d1', 'decision', NOW, { anchors: [{ type: 'tool_use', ref: 'o1' }] }),
  ], { now: NOW, observationTtlMs: THIRTY_DAYS, tombstoned: ['o1'] });
  assert.equal(r.keep.some((e) => e.id === 'o1'), false);
  assert.deepEqual(r.downgraded, ['d1']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/agent-journal && npm test`
Expected: FAIL — cannot find module `../src/retention.ts`.

- [ ] **Step 3: Write the implementation**

`packages/agent-journal/src/retention.ts`:

```ts
import type { JournalEvent } from './envelope.ts';
import { project } from './retract.ts';

const ENTRY_KINDS = new Set(['decision', 'finding', 'assumption', 'blocker', 'progress', 'constraint']);

export interface RetentionOptions {
  readonly now: string;
  /** No default. Spec open question 2 leaves the window undecided; the caller supplies it. */
  readonly observationTtlMs: number;
  /** Ids suppressed by a tombstone event (spec 13.2). */
  readonly tombstoned?: readonly string[];
}

export interface RetentionResult {
  readonly keep: JournalEvent[];
  readonly expired: string[];
  readonly pinned: string[];
  /** Entries whose anchors now point at purged content and must render as `unknown`. */
  readonly downgraded: string[];
}

function anchorRefs(event: JournalEvent): string[] {
  const raw = event.data.anchors;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const ref = (item as Record<string, unknown>).ref;
      if (typeof ref === 'string') out.push(ref);
    }
  }
  return out;
}

export function isEntry(event: JournalEvent): boolean {
  return ENTRY_KINDS.has(event.kind);
}

export function applyRetention(
  events: readonly JournalEvent[],
  options: RetentionOptions,
): RetentionResult {
  const tombstoned = new Set(options.tombstoned ?? []);
  const cutoff = Date.parse(options.now) - options.observationTtlMs;
  const { invalidated } = project(events);

  // Only LIVE entries pin their anchors; an invalidated entry stops protecting them.
  const pinnedIds = new Set<string>();
  for (const e of events) {
    if (!isEntry(e) || invalidated.has(e.id)) continue;
    for (const ref of anchorRefs(e)) pinnedIds.add(ref);
  }

  const expired: string[] = [];
  const pinned: string[] = [];
  const keep: JournalEvent[] = [];

  for (const e of events) {
    if (tombstoned.has(e.id)) continue;
    if (isEntry(e)) { keep.push(e); continue; }
    if (Date.parse(e.time) >= cutoff) { keep.push(e); continue; }
    if (pinnedIds.has(e.id)) { pinned.push(e.id); keep.push(e); continue; }
    expired.push(e.id);
  }

  const gone = new Set<string>([...expired, ...tombstoned]);
  const downgraded = keep
    .filter((e) => isEntry(e) && anchorRefs(e).some((ref) => gone.has(ref)))
    .map((e) => e.id);

  return { keep, expired, pinned, downgraded };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/agent-journal && npm test`
Expected: PASS.

- [ ] **Step 5: Export it**

Append to `packages/agent-journal/src/index.ts`:

```ts
export * from './retention.ts';
```

- [ ] **Step 6: Commit**

```bash
git add packages/agent-journal
git commit -m "feat(journal): anchor pinning, expiry and tombstone suppression"
```

---

### Task 8: Void events and the coverage report

Spec 10.3. Silence must be legible: a hook failure or dropped sink is recorded, and every render states what was not captured.

**Files:**
- Create: `packages/agent-journal/src/coverage.ts`
- Modify: `packages/agent-journal/src/index.ts`
- Test: `packages/agent-journal/test/coverage.test.ts`

**Interfaces:**
- Consumes: `normalizeEvent`, `JournalEvent` from `envelope.ts`; `isEntry` from `retention.ts`.
- Produces: `voidEvent(input: VoidInput): JournalEvent`, `coverage(events, options?): CoverageReport`. `CoverageReport = { sessions: number; sessionsWithNoEntries: string[]; voids: number; sequenceGaps: string[]; downgradedAnchors: string[] }`.

- [ ] **Step 1: Write the failing test**

`packages/agent-journal/test/coverage.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverage, voidEvent } from '../src/coverage.ts';
import { normalizeEvent } from '../src/envelope.ts';

function make(id: string, kind: string, session: string, extra: Record<string, unknown> = {}) {
  return normalizeEvent({
    schemaVersion: 1, id, source: `h/m/${session}/a`, sourceEpoch: 'e1',
    time: '2026-09-07T10:00:00.000Z', workspace: 'ws', session, agent: 'a',
    author: 'agent', provenance: 'hook', harness: 'claude-code', context: 'coding',
    kind, data: {}, ...extra,
  });
}

test('a session with observations and no entries is reported', () => {
  const report = coverage([make('o1', 'tool_call', 's1'), make('d1', 'decision', 's2')]);
  assert.deepEqual(report.sessionsWithNoEntries, ['s1']);
  assert.equal(report.sessions, 2);
});

test('void events are counted', () => {
  const v = voidEvent({
    id: 'v1', source: 'h/m/s1/a', sourceEpoch: 'e1', time: '2026-09-07T10:00:00.000Z',
    workspace: 'ws', session: 's1', agent: 'a', harness: 'claude-code',
    reason: 'hook failed', detail: 'exit 1',
  });
  assert.equal(v.kind, 'void');
  assert.equal(coverage([v]).voids, 1);
});

test('a gap in a source sequence is detected', () => {
  const report = coverage([
    make('a', 'tool_call', 's1', { sequence: 1 }),
    make('b', 'tool_call', 's1', { sequence: 4 }),
  ]);
  assert.equal(report.sequenceGaps.length, 1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/agent-journal && npm test`
Expected: FAIL — cannot find module `../src/coverage.ts`.

- [ ] **Step 3: Write the implementation**

`packages/agent-journal/src/coverage.ts`:

```ts
import { normalizeEvent, type JournalEvent } from './envelope.ts';
import { isEntry } from './retention.ts';

export interface VoidInput {
  readonly id: string;
  readonly source: string;
  readonly sourceEpoch: string;
  readonly time: string;
  readonly workspace: string;
  readonly session: string;
  readonly agent: string;
  readonly harness: string;
  readonly reason: string;
  readonly detail?: string;
}

/** A refused write, dropped sink or hook failure, recorded so silence is auditable. */
export function voidEvent(input: VoidInput): JournalEvent {
  return normalizeEvent({
    schemaVersion: 1,
    id: input.id,
    source: input.source,
    sourceEpoch: input.sourceEpoch,
    time: input.time,
    workspace: input.workspace,
    session: input.session,
    agent: input.agent,
    author: 'agent',
    provenance: 'hook',
    harness: input.harness,
    context: 'coding',
    kind: 'void',
    data: { reason: input.reason, ...(input.detail === undefined ? {} : { detail: input.detail }) },
  });
}

export interface CoverageReport {
  readonly sessions: number;
  readonly sessionsWithNoEntries: string[];
  readonly voids: number;
  readonly sequenceGaps: string[];
  readonly downgradedAnchors: string[];
}

export function coverage(
  events: readonly JournalEvent[],
  options: { readonly downgradedAnchors?: readonly string[] } = {},
): CoverageReport {
  const sessions = new Set<string>();
  const withEntries = new Set<string>();
  const bySource = new Map<string, number[]>();
  let voids = 0;

  for (const e of events) {
    sessions.add(e.session);
    if (isEntry(e)) withEntries.add(e.session);
    if (e.kind === 'void') voids += 1;
    if (e.sequence !== undefined) {
      // NUL-joined, not space-joined: both fields are unconstrained text, so
      // "foo" + "bar baz" and "foo bar" + "baz" would collide into one key and
      // report a phantom sequence gap across two unrelated sources. Same defect
      // Task 5 fixed in read.ts; caught here before it was written.
      const key = `${e.source}\0${e.sourceEpoch}`;
      const list = bySource.get(key) ?? [];
      list.push(e.sequence);
      bySource.set(key, list);
    }
  }

  const sequenceGaps: string[] = [];
  for (const [key, seqs] of bySource) {
    const sorted = [...seqs].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i]! - sorted[i - 1]! > 1) {
        sequenceGaps.push(`${key.replace('\0', '@')}: ${sorted[i - 1]} to ${sorted[i]}`);
      }
    }
  }

  return {
    sessions: sessions.size,
    sessionsWithNoEntries: [...sessions].filter((s) => !withEntries.has(s)).sort(),
    voids,
    sequenceGaps,
    downgradedAnchors: [...(options.downgradedAnchors ?? [])],
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/agent-journal && npm test`
Expected: PASS.

- [ ] **Step 5: Export it**

Append to `packages/agent-journal/src/index.ts`:

```ts
export * from './coverage.ts';
```

- [ ] **Step 6: Commit**

```bash
git add packages/agent-journal
git commit -m "feat(journal): void events and a coverage report so silence is legible"
```

---

### Task 9: The CLI — record, invalidate, coverage

Spec 10 and 5.8. `invalidate` must work with no session, because the Node-26 root cause was found in a bare shell with no agent running.

**Files:**
- Create: `packages/agent-journal/src/cli.ts`
- Create: `packages/agent-journal/src/bin.ts`
- Modify: `packages/agent-journal/package.json`
- Test: `packages/agent-journal/test/cli.test.ts`

**Interfaces:**
- Consumes: `normalizeEvent`, `SegmentJournal`, `parseSegment`, `mergeEvents`, `coverage`.
- Produces: `runCli(argv: readonly string[], env: Record<string, string | undefined>): Promise<CliResult>` where `CliResult = { code: number; stdout: string; stderr: string }`.

- [ ] **Step 1: Write the failing test**

`packages/agent-journal/test/cli.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../src/cli.ts';

async function root(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'journal-cli-'));
}

// Reads every event back off disk, so tests assert what landed rather than what
// was printed. Without this the CLI tests only prove exit codes.
async function readAllEvents(root: string, workspace: string) {
  const { readdir, readFile } = await import('node:fs/promises');
  const { parseSegment } = await import('../src/read.ts');
  const base = join(root, 'workspaces', workspace, 'segments');
  const out = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.endsWith('.jsonl')) out.push(...parseSegment(await readFile(full, 'utf8')).events);
    }
  }
  await walk(base);
  return out;
}

test('record writes one entry and reports its id', async () => {
  const dir = await root();
  const r = await runCli(
    ['record', '--kind', 'decision', '--question', 'db?', '--chosen', 'postgres', '--workspace', 'ws'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' },
  );
  assert.equal(r.code, 0);
  assert.match(r.stdout, /recorded /);

  // Assert it reached disk with the right content, not just that it printed.
  const events = await readAllEvents(dir, 'ws');
  assert.equal(events.length, 1);
  assert.equal(events[0]!.kind, 'decision');
  assert.equal(events[0]!.data.chosen, 'postgres');
  assert.equal(events[0]!.provenance, 'cli');
});

test('record refuses and exits non-zero when redaction fails', async () => {
  const dir = await root();
  const r = await runCli(
    ['record', '--kind', 'decision', '--question', 'q', '--chosen', 'x',
      '--workspace', 'ws', '--rationale', 'y'.repeat(300000)],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' },
  );
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /redaction/i);
});

test('invalidate works with no session and is attributed to a human', async () => {
  const dir = await root();
  await runCli(
    ['record', '--kind', 'finding', '--question', 'why', '--chosen', 'wrong',
      '--workspace', 'ws', '--id', 'f1'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' },
  );
  const r = await runCli(
    ['invalidate', 'f1', '--reason', 'wrong interpreter on PATH', '--workspace', 'ws'],
    { AGENT_JOURNAL_ROOT: dir },
  );
  assert.equal(r.code, 0);

  // Assert the entry ACTUALLY LANDED with the right shape. An exit code alone
  // would pass even if invalidate did nothing at all.
  const events = await readAllEvents(dir, 'ws');
  const retraction = events.find((e) => e.data.invalidates === 'f1');
  assert.ok(retraction, 'a retraction event must be on disk');
  assert.equal(retraction!.author, 'human');
  assert.equal(retraction!.session, '-');
  assert.equal(retraction!.data.rationale, 'wrong interpreter on PATH');
});

test('an unknown subcommand exits non-zero with usage', async () => {
  const r = await runCli(['frobnicate', '--workspace', 'ws'], { AGENT_JOURNAL_ROOT: await root() });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /usage/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/agent-journal && npm test`
Expected: FAIL — cannot find module `../src/cli.ts`.

- [ ] **Step 3: Write the implementation**

`packages/agent-journal/src/cli.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeEvent, type JournalEvent } from './envelope.ts';
import { SegmentJournal } from './journal.ts';
import { parseSegment, mergeEvents } from './read.ts';
import { coverage } from './coverage.ts';

export interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const USAGE = [
  'usage:',
  '  journal record --kind <kind> --workspace <id> [--question q] [--chosen c] [--rationale r] [--id id]',
  '  journal invalidate <entry-id> --reason <why> --workspace <id>',
  '  journal coverage --workspace <id>',
  '',
].join('\n');

function flags(argv: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out.set(token.slice(2), next);
      i += 1;
    } else {
      out.set(token.slice(2), 'true');
    }
  }
  return out;
}

function nowStamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z');
}

function journalFor(root: string, workspace: string, session: string, agent: string): SegmentJournal {
  return new SegmentJournal({ root, workspace, machine: hostname(), session, agent, epoch: 'e1' });
}

async function readAll(root: string, workspace: string): Promise<JournalEvent[]> {
  const base = join(root, 'workspaces', workspace, 'segments');
  const batches: JournalEvent[][] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.endsWith('.jsonl')) batches.push(parseSegment(await readFile(full, 'utf8')).events);
    }
  }

  await walk(base);
  return mergeEvents(batches);
}

export async function runCli(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): Promise<CliResult> {
  const [command, ...rest] = argv;
  if (!command) return { code: 2, stdout: '', stderr: USAGE };

  const opts = flags(rest);
  const root = env.AGENT_JOURNAL_ROOT ?? join(env.HOME ?? '.', '.agents', 'journal');
  const workspace = opts.get('workspace');
  if (!workspace) return { code: 2, stdout: '', stderr: `--workspace is required\n${USAGE}` };

  if (command === 'record') {
    const kind = opts.get('kind');
    if (!kind) return { code: 2, stdout: '', stderr: `--kind is required\n${USAGE}` };

    const session = env.AGENT_JOURNAL_SESSION ?? 'unknown';
    const agent = env.AGENT_JOURNAL_AGENT ?? 'primary';
    const id = opts.get('id') ?? randomUUID();

    const data: Record<string, unknown> = {};
    for (const field of ['question', 'chosen', 'rationale', 'supersedes', 'invalidates']) {
      const v = opts.get(field);
      if (v !== undefined) data[field] = v;
    }

    const event = normalizeEvent({
      schemaVersion: 1, id, source: `cli/${hostname()}/${session}/${agent}`, sourceEpoch: 'e1',
      time: nowStamp(), workspace, session, agent, author: 'agent', provenance: 'cli',
      harness: env.AGENT_JOURNAL_HARNESS ?? 'other', context: opts.get('context') ?? 'coding',
      kind, data,
    });

    const result = await journalFor(root, workspace, session, agent).append(event);
    if (!result.written) {
      return {
        code: 1,
        stdout: '',
        stderr: `refused: redaction ${result.verdict} — ${result.reason ?? 'no detail'}\n`,
      };
    }
    return { code: 0, stdout: `recorded ${id}\n`, stderr: '' };
  }

  if (command === 'invalidate') {
    const target = rest[0];
    const reason = opts.get('reason');
    if (!target || target.startsWith('--')) {
      return { code: 2, stdout: '', stderr: `an entry id is required\n${USAGE}` };
    }
    if (!reason) return { code: 2, stdout: '', stderr: `--reason is required\n${USAGE}` };

    // No session: a human retracting from a bare shell (spec 5.8).
    const event = normalizeEvent({
      schemaVersion: 1, id: randomUUID(), source: `cli/${hostname()}/-/-`, sourceEpoch: 'e1',
      time: nowStamp(), workspace, session: '-', agent: '-', author: 'human', provenance: 'cli',
      harness: 'other', context: 'coding', kind: 'decision',
      data: { invalidates: target, rationale: reason },
    });

    const result = await journalFor(root, workspace, '-', '-').append(event);
    if (!result.written) {
      return { code: 1, stdout: '', stderr: `refused: redaction ${result.verdict}\n` };
    }
    return { code: 0, stdout: `invalidated ${target}\n`, stderr: '' };
  }

  if (command === 'coverage') {
    const report = coverage(await readAll(root, workspace));
    return { code: 0, stdout: `${JSON.stringify(report, null, 2)}\n`, stderr: '' };
  }

  return { code: 2, stdout: '', stderr: `unknown command: ${command}\n${USAGE}` };
}
```

`packages/agent-journal/src/bin.ts`:

```ts
#!/usr/bin/env node
import { runCli } from './cli.ts';

const result = await runCli(process.argv.slice(2), process.env);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.code);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/agent-journal && npm test`
Expected: PASS.

- [ ] **Step 5: Add the bin entry**

In `packages/agent-journal/package.json`, add immediately after the `"types"` line:

```json
  "bin": { "agent-journal": "./dist/bin.js" },
```

- [ ] **Step 6: Run the whole package verify**

Run: `cd packages/agent-journal && npm run verify`
Expected: types clean, all tests pass, `dist/` emitted.

- [ ] **Step 7: Commit**

```bash
git add packages/agent-journal
git commit -m "feat(journal): CLI with record, out-of-session invalidate, and coverage"
```

---

### Task 10: Wire the package into the repo verify chain

**Files:**
- Modify: `package.json`
- Create: `packages/agent-journal/README.md`
- Create: `packages/agent-journal/LICENSE`

- [ ] **Step 1: Copy the licence**

```bash
cp LICENSE packages/agent-journal/LICENSE
```

- [ ] **Step 2: Write the README**

Create `packages/agent-journal/README.md` with this exact content, ending in a newline:

```markdown
# @crissmoldovan/agent-journal

Append-only decision journal for coding agents. Implements the schema-v1 envelope,
value-level redaction, workspace identity, projection with retraction, retention with
anchor pinning, and a CLI.

See the design spec at `docs/superpowers/specs/2026-09-07-agent-decision-journal-design.md`.

## Status

Core package only. Harness adapters, the digest renderer and the `decision-journal`
skill are covered by a second plan.

## Development

Requires Node.js 24 or newer. Run `npm install` then `npm run verify`.
```

- [ ] **Step 3: Add the scripts to the root manifest**

In the root `package.json`, add these two entries to `scripts`:

```json
    "prepare:journal": "npm ci --prefix packages/agent-journal --ignore-scripts --no-audit --no-fund",
    "verify:journal": "npm run prepare:journal && npm --prefix packages/agent-journal run verify",
```

and replace the existing `verify` script with:

```json
    "verify": "npm test && node scripts/verify-skills.mjs && npm run verify:lifecycle && npm run verify:journal"
```

- [ ] **Step 4: Run the whole repo verify**

Run: `npm run verify`
Expected: PASS — repo tests, skills verification, the lifecycle package, and the new journal package.

- [ ] **Step 5: Commit**

```bash
git add package.json packages/agent-journal
git commit -m "chore(journal): wire the package into the repo verify chain"
```

---

## Self-review

**Spec coverage.** 4.1 envelope with `author` and `provenance`, 4.2 open context, 4.3 anchor classes defaulting to `unknown` — Task 1. 12.1 value-level redaction with a detectable failure — Task 2, enforced fail-closed in Task 4. 6.1 identity with worktree resolution — Task 3. 6.2 one segment per writer and 8.3 rotation — Task 4. 8.1 dedup and 8.4 ordering — Task 5. 5.8 outcome, supersedes, invalidates, propagation and out-of-session human retraction — Tasks 6 and 9. 6.3 anchor pinning and 13.2 tombstones — Task 7. 10.3 void events and coverage — Tasks 8 and 9. The CLI half of 10 — Task 9.

**Deliberately out of scope**, carried to the second plan: 9.2 harness adapters, 6.4 digest renderer, 5.6 and 5.7 entry-kind schemas as skill-level validation, 7.6 path claims, 10.1 rot and premise re-checks, 10.2 traversal, the derived index, and the `decision-journal` skill itself.

**Type consistency.** `JournalEvent` from Task 1 is the argument type throughout. `RedactionVerdict` from Task 2 appears in `AppendResult` in Task 4. `isEntry` is defined once in Task 7 and imported by Task 8. `project` from Task 6 is used by Task 7. Task 9 consumes `normalizeEvent`, `SegmentJournal`, `parseSegment`, `mergeEvents` and `coverage` under exactly the names those tasks export.

**Residuals from Task 5, for the final review's fix wave.**

1. **`localeCompare` is not guaranteed injective.** Used as the last tiebreak in three
   places in `read.ts`. Collation can equate strings differing only by case or diacritics
   under some locale, which would let sort stability leak input order back in — the exact
   defect class fixed twice in this task, unfixed for id and key ties. Ids are UUIDs in
   practice, so the risk is low. Replace with a plain codepoint comparison (`a < b ? -1 :
   a > b ? 1 : 0`), which is total by construction and needs no locale reasoning.
2. **`earliest()` is recomputed on every pairwise group comparison**, re-parsing every
   event's timestamp O(g log g) times instead of once. Correctness is unaffected;
   precompute per group before sorting.
3. **No test pins cross-group ordering** across two or more sources with differing times.
   The 1000-trial fuzz covers it functionally; the checked-in suite does not.

**Test-rigor gaps on the fail-closed guarantee, for the final review's fix wave.**
Task 4's re-review named three regressions the committed tests would still miss. The
implementation is correct; these are coverage gaps on the one guarantee that must not silently
regress, and the first two are one-line additions:

1. **A stray write under a different filename.** Both tests inspect only `result.path` and the
   current `segmentPath()`. A secret written elsewhere in the `segments/` tree — an off-by-one
   index, a wrong epoch used for the write but not the returned path — goes undetected. Fix: walk
   the whole segments directory and assert the refused payload appears nowhere in it.
2. **`mkdir` before the verdict check.** This creates the directory tree, leaking the
   workspace/session/agent shape onto disk, then returns before `appendFile`. `existsSync` on the
   file passes. The controller initially dismissed this break as invalid; the re-reviewer was
   right that it is real. Fix: assert the segment *directory* does not exist after a refusal.
3. **Multi-writer path attribution across a rotation boundary.** The "concurrency" test has only
   one real writer: `redact()` is synchronous and the failed branch returns before touching the
   queue, so the refusal completes before the good append is even called. `good.path ===
   segmentPath()` is a tautology there. Two concurrent *successful* appends straddling a rotation
   are untested. Harder to make deterministic — scope it deliberately or state it as accepted.

**Documented asymmetry — `readExplicitId` rethrows, `canonical()` swallows.**
These sit in one module with opposite error philosophies, and Task 3's re-review reasonably read
that as an inconsistency. It is deliberate. `readExplicitId` rethrows because ignoring an id the
user *declared* is a correctness violation — the session would silently write to a workspace
nobody chose. `canonical()` falls back because it is a normalisation nicety: failing hard on an
unreadable intermediate directory would block a session from starting at all, and the fallback
never lands below the pre-canonicalisation behaviour. The residual cost is real but bounded — the
same directory reachable under different ambient permissions in two environments could still get
two ids. Accepted.

**Known gap carried to the final review — `Map`, `Set` and `Error` are never scanned.**
They hold their data in internal slots or non-enumerable properties, so `Object.entries` returns
`[]`, they collapse to `{}`, and `redact()` reports `clean` for content nothing examined. This is
**not a leak** — `JSON.stringify` collapses them identically, so the value reaching disk is `{}`
and no secret is written. It is data loss with a misleading verdict. `Error` matters most: a hook
recording a caught exception would silently store `{}` and lose the message.

The fix belongs in Task 1's `normalizeEvent`, which currently passes `data` through unchecked —
the sibling package's `sanitize()` throws on non-serialisable values and this one does not.
Rejecting non-JSON-shaped `data` at validation stops these types reaching the redactor at all.
Putting the check inside the redactor instead would conflate redaction with serialisation.

**Known gap the executor must not paper over.** Spec open question 2 leaves the observation retention window undecided, so `applyRetention` takes `observationTtlMs` as a required argument with no default. Do not invent one — the caller supplies it until that question is answered.
