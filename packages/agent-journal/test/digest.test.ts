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
  assert.match(flagged[0]!, /no source consulted/i);
});

test('an entry with a model_knowledge influence AND a source is not flagged', () => {
  const out = render([ev('mixed', { question: 'mixed', chosen: 'x', influences: [
    { type: 'model_knowledge', role: 'supporting' },
    { type: 'url', role: 'decisive', ref: 'https://example.com' },
  ] })]);
  assert.ok(!/no source consulted/i.test(out),
    'the flag means ONLY model_knowledge; a mixed entry consulted something');
});

// An empty influences[] is "nothing recorded", not "every influence was
// model_knowledge" — vacuous truth over an empty array must not flip this
// flag on. Distinct from the "an entry resting only on model_knowledge is
// flagged" test above, which never exercises an empty array (its two entries
// both carry one non-empty influences[]).
test('an entry with an empty influences array is not flagged', () => {
  const out = render([ev('empty', { question: 'no influences recorded', chosen: 'x', influences: [] })]);
  assert.ok(!/no source consulted/i.test(out),
    'an empty influences[] must not read as "rested on model_knowledge alone"');
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

// Not assessed is not none: coverage() called with no options leaves
// sessionsWithNoEvents and downgradedAnchors both null, and the digest must
// say so on THOSE lines rather than printing a 0 that claims a figure nobody
// computed (§10.3). Matching /not assessed/ anywhere in the output is not
// enough to pin this — the digest's own static footnote sentence contains
// that phrase regardless of what the field lines actually render, so this
// checks the specific lines by their labels.
test('a null coverage field renders as not assessed on its own line, never as a bare 0', () => {
  const out = render([ev('d1', { question: 'q', chosen: 'c' })]);
  const lines = out.split('\n');
  const noEventsLine = lines.find((l) => l.includes('sessions with no events at all'));
  const downgradedLine = lines.find((l) => l.includes('downgraded anchors'));
  assert.ok(noEventsLine, 'coverage block is missing the sessions-with-no-events line');
  assert.ok(downgradedLine, 'coverage block is missing the downgraded-anchors line');
  assert.match(noEventsLine!, /not assessed/i, `expected "not assessed", got: ${noEventsLine}`);
  assert.match(downgradedLine!, /not assessed/i, `expected "not assessed", got: ${downgradedLine}`);
});

// §6.4's subtlest requirement: project(events) must run over every event
// before the display list is filtered by readableAt. A private retraction
// must still suppress its target for a team reader — only the retraction
// record's OWN text is gated, never the fact that something was invalidated.
// Getting this backwards (filter, then project) makes an invalidated entry
// read as live for anyone below the retraction's disclosure level, which is
// worse than a retraction with a hidden reason: it hides that anything
// happened at all.
test('a private retraction still invalidates its target for a team reader, without leaking its own text', () => {
  const events = [
    ev('root', { question: 'the original call', chosen: 'x' }, 'team'),
    ev('r1', { invalidates: 'root', rationale: 'the secret reason it was wrong' }, 'private'),
  ];
  const out = render(events, 'team');
  assert.ok(out.includes('the original call'), 'the invalidated entry itself must still be readable');
  assert.match(out, /invalidated/i, 'the outcome must read invalidated, not live/unknown');
  assert.ok(!out.includes('the secret reason it was wrong'),
    'the private retraction record leaked its own text to a team reader');
});

// Beyond the two-event reverse check above: several events, INCLUDING TIES —
// same reversibility and same blastRadius-presence, differing only by id — so
// a comparator that dropped the id tiebreak would let a stable sort preserve
// input order and disagree across shuffles. Rendered in multiple shuffles,
// all must agree byte-for-byte — trusting only the observed strings, not the
// id tiebreak's mere presence in the source.
test('ordering is total across many shuffles, not just a two-item reverse', () => {
  const events = [
    ev('m5', { question: 'q5', chosen: 'x', reversibility: 'moderate' }),
    ev('m1', { question: 'q1', chosen: 'x', reversibility: 'trivial', blastRadius: 'wide' }),
    ev('m2', { question: 'q2', chosen: 'x', reversibility: 'hard' }),
    ev('m3', { question: 'q3', chosen: 'x', reversibility: 'one-way', blastRadius: 'narrow' }),
    ev('m4', { question: 'q4', chosen: 'x' }),
    // Ties with m1/m2/m3 on (reversibility, blastRadius-presence): only the id
    // tiebreak can order these pairs consistently.
    ev('m6', { question: 'q6', chosen: 'x', reversibility: 'trivial', blastRadius: 'wide' }),
    ev('m7', { question: 'q7', chosen: 'x', reversibility: 'hard' }),
    ev('m8', { question: 'q8', chosen: 'x', reversibility: 'one-way', blastRadius: 'narrow' }),
  ];
  const shuffles: any[][] = [
    events,
    [...events].reverse(),
    [events[3]!, events[0]!, events[5]!, events[1]!, events[4]!, events[2]!, events[7]!, events[6]!],
    [events[5]!, events[4]!, events[3]!, events[2]!, events[1]!, events[0]!, events[6]!, events[7]!],
    [events[7]!, events[6]!, events[5]!, events[4]!, events[3]!, events[2]!, events[1]!, events[0]!],
  ];
  const rendered = shuffles.map((s) => render(s));
  for (const r of rendered.slice(1)) {
    assert.equal(r, rendered[0], 'ordering is not total — shuffled input changed the output');
  }
});
