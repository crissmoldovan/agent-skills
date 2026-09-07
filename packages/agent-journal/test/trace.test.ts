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
