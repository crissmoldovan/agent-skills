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
