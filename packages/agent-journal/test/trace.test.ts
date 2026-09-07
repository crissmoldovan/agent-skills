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
  assert.deepEqual(traceFrom(events, 'PROJ-9').matched, [{ id: 'byTicket', via: 'influence' }]);
  assert.deepEqual(traceFrom(events, 'enforce_grants').matched, [{ id: 'byFlag', via: 'anchor' }]);
});

// Four sources share one key space, so a reader must be able to tell an entry
// that IS about something from one that merely cites it.
test('a match reports which source produced it', () => {
  const events = [
    ev('about', { question: 'q', chosen: 'c' }, 'src/queue.ts'),
    ev('cites', { question: 'q', chosen: 'c', anchors: [{ type: 'file', ref: 'src/queue.ts' }] }),
    ev('names', { question: 'q', chosen: 'c' }, 'about'),
  ];
  assert.deepEqual(traceFrom(events, 'src/queue.ts').matched, [
    { id: 'about', via: 'subject' }, { id: 'cites', via: 'anchor' },
  ]);
  // The sharpest case: a subject equal to another entry's id.
  assert.deepEqual(traceFrom(events, 'about').matched, [
    { id: 'about', via: 'id' }, { id: 'names', via: 'subject' },
  ]);
});

// The discriminating fixture: one field CONTAINS the key while a different
// field of the SAME entry EQUALS it. Only `matchSource`'s own exactness
// distinguishes the two — the index's Map lookup being exact only guarantees
// the entry is a candidate, not which field earned it that.
test('an entry whose id merely contains the key is not reported via id when its subject IS the key', () => {
  const events = [ev('dx1', { question: 'q', chosen: 'c' }, 'x')];
  assert.deepEqual(traceFrom(events, 'x').matched, [{ id: 'dx1', via: 'subject' }]);
});

// I1 — nothing previously defended "the walk starts from EVERY match", not
// just the first. Two decisions independently cite the same ticket, and each
// supersedes a DIFFERENT ancestor. If only one matched root were walked, one
// ancestor would silently vanish from the "why is it like this" answer.
test('the walk starts from every match, not just the first', () => {
  const events = [
    ev('anc1', { question: 'first ancestor', chosen: 'x' }),
    ev('anc2', { question: 'second ancestor', chosen: 'y' }),
    ev('d1', { question: 'q', chosen: 'c', supersedes: 'anc1',
      influences: [{ type: 'ticket', role: 'decisive', ref: 'PROJ-1' }] }),
    ev('d2', { question: 'q', chosen: 'c', supersedes: 'anc2',
      influences: [{ type: 'ticket', role: 'decisive', ref: 'PROJ-1' }] }),
  ];
  const ids = traceFrom(events, 'PROJ-1').chain.map((c) => c.id);
  assert.ok(ids.includes('anc1'), `anc1 missing from chain: ${JSON.stringify(ids)}`);
  assert.ok(ids.includes('anc2'), `anc2 missing from chain: ${JSON.stringify(ids)}`);
});

// I2 — the match precedence (id, subject, anchor, influence) was only ever
// exercised across DIFFERENT entries sharing a key. A single entry whose own
// four sources all tie on the same key never appeared, so an adjacent swap in
// matchSource's check order had nothing to catch it.
test('within a single entry, id beats subject beats anchor beats influence', () => {
  const allTie = [ev('tieall', {
    question: 'q', chosen: 'c',
    anchors: [{ type: 'file', ref: 'tieall' }],
    influences: [{ type: 'ticket', role: 'decisive', ref: 'tieall' }],
  }, 'tieall')];
  assert.deepEqual(traceFrom(allTie, 'tieall').matched, [{ id: 'tieall', via: 'id' }]);

  const subjectTie = [ev('other', {
    question: 'q', chosen: 'c',
    anchors: [{ type: 'file', ref: 'tieB' }],
    influences: [{ type: 'ticket', role: 'decisive', ref: 'tieB' }],
  }, 'tieB')];
  assert.deepEqual(traceFrom(subjectTie, 'tieB').matched, [{ id: 'other', via: 'subject' }]);

  const anchorTie = [ev('another', {
    question: 'q', chosen: 'c',
    anchors: [{ type: 'file', ref: 'tieC' }],
    influences: [{ type: 'ticket', role: 'decisive', ref: 'tieC' }],
  })];
  assert.deepEqual(traceFrom(anchorTie, 'tieC').matched, [{ id: 'another', via: 'anchor' }]);
});

// I3 — journalRefs's `rec.type === 'journal'` clause is what stops a ticket-
// or url-typed influence from driving the backward walk. Such refs are
// indexed for lookup (found the entry above) but must never be traversed.
test('a ticket influence does not drive the backward walk, only a journal one does', () => {
  const events = [
    ev('unrelated', { question: 'q', chosen: 'c' }),
    ev('start', { question: 'q', chosen: 'c',
      influences: [{ type: 'ticket', role: 'decisive', ref: 'unrelated' }] }, 'src/y.ts'),
  ];
  const chain = traceFrom(events, 'src/y.ts').chain;
  assert.deepEqual(chain.map((c) => c.id), ['start'],
    'a ticket influence drove the walk — only journal influences should');
});

test('lookup is exact and case-insensitive, never a substring match', () => {
  const events = [ev('d1', { question: 'q', chosen: 'c' }, 'src/queue.ts')];
  assert.deepEqual(traceFrom(events, 'SRC/QUEUE.TS').matched, [{ id: 'd1', via: 'subject' }]);
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

// I6 — the `invalidates` traversal edge (trace.ts:138) had zero coverage:
// every existing chain test used `supersedes` or a `journal` influence, so
// deleting `if (inv) queue.push(...)` left all 239 tests green and `via:
// 'invalidates'` appeared in no assertion anywhere in the suite.
test('traversal follows an invalidates edge backwards too, naming it', () => {
  const events = [
    ev('root', { question: 'the original', chosen: 'x' }),
    ev('leaf', { question: 'says root was wrong', chosen: 'z', invalidates: 'root' }, 'src/z.ts'),
  ];
  const chain = traceFrom(events, 'src/z.ts').chain;
  assert.deepEqual(chain.map((c) => c.id), ['leaf', 'root']);
  assert.deepEqual(chain.map((c) => c.via), [null, 'invalidates']);
});

// I9 — three `!== null` shape guards (trace.ts:36 and :49, digest.ts:45)
// protect against a foreign record whose `influences` array holds a bare
// `null` rather than an object — a shape this package's own CLI never
// writes, but a hand-edited or foreign-tool-written line legitimately can.
// `typeof null === 'object'` in JS, so removing either guard in this file
// throws a TypeError out of `traceFrom` instead of skipping the malformed
// element. One fixture with `influences: [null]` exercises both: `refs`
// (shared by anchors and influences, indexing time) and `journalRefs`
// (influences only, traversal time) are both called on it by this one
// `traceFrom` invocation.
test('a null element in influences is skipped, not a thrown TypeError', () => {
  const events = [ev('shaky', { question: 'q', chosen: 'c', influences: [null] }, 'src/z.ts')];
  assert.doesNotThrow(() => traceFrom(events, 'src/z.ts'));
  const result = traceFrom(events, 'src/z.ts');
  assert.deepEqual(result.matched, [{ id: 'shaky', via: 'subject' }]);
  assert.deepEqual(result.chain.map((c) => c.id), ['shaky']);
});
