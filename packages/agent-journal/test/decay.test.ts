import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDecay, codebaseRefs } from '../src/decay.ts';
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

// The skip guard is `proj.superseded.has(id) || directInvalidated.has(id)`, and
// only the second half had a test -- removing the first left the suite green.
// Supersession does not cascade (project() only cascades invalidation), so the
// projection's set is exactly the directly-superseded entries and is the right
// thing to read; it just was not covered.
test('a superseded entry is not decay-checked either', () => {
  const old = entry('o1', [{ type: 'journal', role: 'decisive', ref: 'ghost' }]);
  const replacement = entry('n1', [], { supersedes: 'o1' });
  const r = computeDecay([old, replacement]);
  assert.deepEqual(r.findings.filter((f) => f.entryId === 'o1'), [],
    'a replaced entry still generated decay noise');
});

// An independent table, written out rather than read from the implementation's
// own sets. Asserting the sets against the switch they document proves the two
// agree; it does not prove either is right. This says what each type SHOULD be.
test('every influence type has the status this release claims for it', () => {
  const expected: Record<string, string> = {
    journal: 'failing',          // ref 'ghost' resolves to nothing
    tool_result: 'failing',      // same
    codebase: 'not-checkable',   // no map supplied
    person: 'not-checkable',
    model_knowledge: 'not-checkable',
    conversation: 'not-checkable',
    url: 'not-implemented',
    ticket: 'not-implemented',
    document: 'not-implemented',
  };
  const e = entry('c1', Object.keys(expected).map((type) => ({
    type, role: 'decisive', ...(type === 'model_knowledge' ? {} : { ref: 'ghost' }),
  })));
  const got = Object.fromEntries(
    computeDecay([e]).findings.map((f) => [f.type, f.status]),
  );
  assert.deepEqual(got, expected);
});

// Undocumented until now: what a malformed or missing ref does. `failing` is
// right -- an influence that names no source cannot be resting on one -- but it
// was a silent choice, and a silent choice is one nobody can disagree with.
test('an influence whose ref is missing or blank is failing, not skipped', () => {
  const e = entry('c1', [
    { type: 'journal', role: 'decisive' },
    { type: 'tool_result', role: 'supporting', ref: '   ' },
  ]);
  const r = computeDecay([e]);
  assert.equal(r.findings.length, 2, 'a refless influence was dropped rather than reported');
  for (const f of r.findings) assert.equal(f.status, 'failing', `${f.type} was ${f.status}`);
});

test('a codebase ref the map does not answer is not-checkable, never passing', () => {
  const e = entry('c1', [{ type: 'codebase', role: 'decisive', ref: 'src/unasked.ts' }]);
  const r = computeDecay([e], { codebase: new Map([['src/other.ts', true]]) });
  assert.equal(r.findings[0]!.status, 'not-checkable',
    'an unanswered ref must not inherit the map\'s optimism');
});

// §2.1's canonical failure, closed: an entry anchored to an `environment`
// observation carries the toolchain it was decided under, and this compares
// that against the environment this run is executing under.
function environmentObservation(id: string, data: Record<string, unknown>) {
  return normalizeEvent({
    schemaVersion: 1, id, source: 'hook/h/s/a', sourceEpoch: 'e1',
    time: '2026-09-08T10:00:00.000Z', workspace: 'ws', session: 's', agent: 'a',
    author: 'agent', provenance: 'hook', harness: 'test', context: 'coding',
    kind: 'environment', data,
  });
}

// This checker is scoped to the `environment` anchor class only (per the
// task-3 brief and the plan's own reasoning: rot is a property of
// influences, and `visual` is the one anchor-class exception, deferred). A
// `commit` anchor must never masquerade as an environment check just because
// its `ref` happens to fail an environment-observation lookup.
test('a non-environment anchor produces no environment finding at all', () => {
  const e = entry('c1', [], { anchors: [{ type: 'commit', ref: 'abc123' }] });
  const r = computeDecay([e], { now: { interpreter: '/opt/a/bin/node', version: 'v24.0.0' } });
  assert.deepEqual(r.findings, [], 'a commit anchor was checked as though it were an environment anchor');
});

test('an entry whose environment anchor differs from now is drifted, not failing', () => {
  const env = environmentObservation('env-1', { interpreter: '/opt/a/bin/node', version: 'v24.0.0' });
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
  const env = environmentObservation('env-1', { interpreter: '/opt/a/bin/node', version: 'v24.0.0' });
  const e = entry('c1', [], { anchors: [{ type: 'environment', ref: 'env-1' }] });
  const r = computeDecay([env, e], {
    now: { interpreter: '/opt/a/bin/node', version: 'v24.0.0' },
  });
  const f = r.findings.find((x) => x.type === 'environment')!;
  assert.equal(f.status, 'passing');
  assert.ok(r.findings.every((x) => x.status !== 'failing'),
    'a matching environment must never be reported as failing');
});

test('an environment anchor with no current environment supplied is not-checkable', () => {
  const env = environmentObservation('env-1', { interpreter: '/opt/a/bin/node', version: 'v24.0.0' });
  const e = entry('c1', [], { anchors: [{ type: 'environment', ref: 'env-1' }] });
  // No `now` in options -- computeDecay must not guess a comparison.
  const r = computeDecay([env, e]);
  const f = r.findings.find((x) => x.type === 'environment')!;
  assert.equal(f.status, 'not-checkable');
});

test('an environment anchor naming no observation in this journal is failing, not drifted', () => {
  const e = entry('c1', [], { anchors: [{ type: 'environment', ref: 'ghost' }] });
  const r = computeDecay([e], { now: { interpreter: '/opt/a/bin/node', version: 'v24.0.0' } });
  const f = r.findings.find((x) => x.type === 'environment')!;
  assert.equal(f.status, 'failing');
  assert.match(f.detail, /not present|unknown|no such/i);
});

// The observation lookup is keyed by `kind === 'environment'`, not merely by
// id. Without that filter, an anchor could resolve against ANY event that
// happens to share the referenced id and carry lookalike `interpreter`/
// `version` fields in its `data` -- a foreign or malicious writer's entry
// spoofing a capture it never made -- and get compared as though it were a
// genuine one.
test('an anchor naming an entry of the WRONG kind is failing, not compared as an impostor environment', () => {
  const impostor = entry('impostor-id', [], { interpreter: '/fake/bin/node', version: 'v1.0.0' });
  const e = entry('c1', [], { anchors: [{ type: 'environment', ref: 'impostor-id' }] });
  const r = computeDecay([impostor, e], { now: { interpreter: '/fake/bin/node', version: 'v1.0.0' } });
  const f = r.findings.find((x) => x.type === 'environment')!;
  assert.equal(f.status, 'failing',
    `a non-environment-kind event was compared as though it were a real capture: ${f.status}`);
});

// Same convention `extractInfluences` already established: only a truly
// empty string (`''`) becomes `null`; whitespace is a value someone actually
// wrote, and is passed through as-is. Either way it names no real observation
// id, so the lookup fails and the result is `failing`.
test('an environment anchor with a whitespace ref is failing, not skipped', () => {
  const e = entry('c1', [], { anchors: [{ type: 'environment', ref: '   ' }] });
  const r = computeDecay([e], { now: { interpreter: '/opt/a/bin/node', version: 'v24.0.0' } });
  const f = r.findings.find((x) => x.type === 'environment')!;
  assert.equal(f.status, 'failing');
});

test('an environment anchor with an empty ref is null, not the empty string', () => {
  const e = entry('c1', [], { anchors: [{ type: 'environment', ref: '' }] });
  const r = computeDecay([e], { now: { interpreter: '/opt/a/bin/node', version: 'v24.0.0' } });
  const f = r.findings.find((x) => x.type === 'environment')!;
  assert.equal(f.status, 'failing');
  assert.equal(f.ref, null);
  // A `null` ref is a structurally broken anchor -- distinct from a ref that
  // names an id absent from the journal, even though both land on `failing`.
  // Without this the two branches are behaviourally indistinguishable to a
  // status-only assertion: `Map.get(null)` also misses, so removing the
  // `ref === null` guard entirely still returns `failing` (mutation-checked;
  // it is `checkEnvironmentAnchor`'s null-ref early return that this test
  // exists to hold in place, matching the null-ref detail wording
  // `checkJournal`/`checkToolResult` already establish for the same reason).
  assert.match(f.detail, /no ref to check/);
  assert.doesNotMatch(f.detail, /not present/);
});

test('an environment observation missing interpreter or version is not-checkable', () => {
  const env = environmentObservation('env-1', {}); // neither field recorded
  const e = entry('c1', [], { anchors: [{ type: 'environment', ref: 'env-1' }] });
  const r = computeDecay([env, e], { now: { interpreter: '/opt/a/bin/node', version: 'v24.0.0' } });
  const f = r.findings.find((x) => x.type === 'environment')!;
  assert.equal(f.status, 'not-checkable');
});

// "Coherent counts": a drifted finding was evaluated, but §10.1's own
// distinction is that a moved environment is not the same claim as a moved
// (broken) source -- folding it into `checked` would silently redefine what
// `checked` means, and dropping it from every counter would make the totals
// stop adding up to `findings.length`.
test('a drifted finding is counted separately, never inside `checked`', () => {
  const env = environmentObservation('env-1', { interpreter: '/opt/a/bin/node', version: 'v24.0.0' });
  const e = entry('c1', [], { anchors: [{ type: 'environment', ref: 'env-1' }] });
  const r = computeDecay([env, e], {
    now: { interpreter: '/opt/b/bin/node', version: 'v26.7.0' },
  });
  assert.equal(r.drifted, 1);
  assert.equal(r.checked, 0, 'a drifted finding must not also count as checked');
  assert.equal(r.notCheckable, 0);
  assert.equal(r.notImplemented, 0);
  assert.equal(r.checked + r.notCheckable + r.notImplemented + r.drifted, r.findings.length,
    'the published counts must add back up to every finding');
});

test('a retracted entry\'s environment anchor is not decay-checked either', () => {
  const env = environmentObservation('env-1', { interpreter: '/opt/a/bin/node', version: 'v24.0.0' });
  const dead = entry('d1', [], { anchors: [{ type: 'environment', ref: 'env-1' }] });
  const killer = entry('k1', [], { invalidates: 'd1' });
  const r = computeDecay([env, dead, killer], {
    now: { interpreter: '/opt/b/bin/node', version: 'v26.7.0' },
  });
  assert.deepEqual(r.findings.filter((f) => f.entryId === 'd1'), []);
});

// The "has no recorded interpreter/version" guard is `!recordedInterpreter ||
// !recordedVersion` -- each half must fail alone, or a mutation dropping one
// half stays green.
test('an environment observation missing ONLY interpreter is not-checkable', () => {
  const env = environmentObservation('env-1', { version: 'v24.0.0' }); // no interpreter
  const e = entry('c1', [], { anchors: [{ type: 'environment', ref: 'env-1' }] });
  const r = computeDecay([env, e], { now: { interpreter: '/opt/a/bin/node', version: 'v24.0.0' } });
  const f = r.findings.find((x) => x.type === 'environment')!;
  assert.equal(f.status, 'not-checkable');
});

test('an environment observation missing ONLY version is not-checkable', () => {
  const env = environmentObservation('env-1', { interpreter: '/opt/a/bin/node' }); // no version
  const e = entry('c1', [], { anchors: [{ type: 'environment', ref: 'env-1' }] });
  const r = computeDecay([env, e], { now: { interpreter: '/opt/a/bin/node', version: 'v24.0.0' } });
  const f = r.findings.find((x) => x.type === 'environment')!;
  assert.equal(f.status, 'not-checkable');
});

// The "passing" guard is `interpreter === now.interpreter && version ===
// now.version` -- each half must independently be able to force `drifted`,
// or a mutation weakening `&&` to `||` stays green.
test('a matching interpreter but a different version is still drifted', () => {
  const env = environmentObservation('env-1', { interpreter: '/opt/a/bin/node', version: 'v24.0.0' });
  const e = entry('c1', [], { anchors: [{ type: 'environment', ref: 'env-1' }] });
  const r = computeDecay([env, e], { now: { interpreter: '/opt/a/bin/node', version: 'v26.7.0' } });
  const f = r.findings.find((x) => x.type === 'environment')!;
  assert.equal(f.status, 'drifted', 'a differing version alone must be enough to drift');
});

test('a matching version but a different interpreter is still drifted', () => {
  const env = environmentObservation('env-1', { interpreter: '/opt/a/bin/node', version: 'v24.0.0' });
  const e = entry('c1', [], { anchors: [{ type: 'environment', ref: 'env-1' }] });
  const r = computeDecay([env, e], { now: { interpreter: '/opt/b/bin/node', version: 'v24.0.0' } });
  const f = r.findings.find((x) => x.type === 'environment')!;
  assert.equal(f.status, 'drifted', 'a differing interpreter alone must be enough to drift');
});

// `codebaseRefs` -- what the CLI resolves against the filesystem before
// `computeDecay` runs. It must pull out ONLY `codebase`-type refs: a
// `journal` influence's ref names an entry id, not a path, and asking the
// filesystem about it would be nonsense, not merely wasted work.
test('codebaseRefs extracts only codebase-type refs, deduplicated', () => {
  const e = entry('c1', [
    { type: 'codebase', role: 'decisive', ref: 'src/a.ts' },
    { type: 'codebase', role: 'supporting', ref: 'src/a.ts' }, // duplicate
    { type: 'codebase', role: 'considered', ref: 'src/b.ts' },
    { type: 'journal', role: 'decisive', ref: 'some-entry-id' },
    { type: 'person', role: 'decisive', ref: 'ada' },
  ]);
  const refs = codebaseRefs([e]);
  assert.deepEqual([...refs].sort(), ['src/a.ts', 'src/b.ts']);
});
