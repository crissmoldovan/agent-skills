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

/** Like `ev`, but for kinds other than `decision` — constraints and findings
 *  title from `statement`/`claim` rather than `question`. */
function evKind(id: string, kind: string, data: Record<string, unknown>, disclosure = 'published') {
  return normalizeEvent({
    schemaVersion: 1, id, source: 'cli/h/s/a', sourceEpoch: 'e1',
    time: '2026-09-07T10:00:00.000Z', workspace: 'ws', session: 's', agent: 'a',
    author: 'agent', provenance: 'cli', harness: 'test', context: 'coding',
    kind, disclosure, data,
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

// The shuffle-ordering test at the bottom of this file only proves
// self-consistency: several renders of one input agreeing with EACH OTHER
// says nothing about whether the comparator matches the spec's stated tier
// order — a comparator that is semantically wrong but internally consistent
// (e.g. hard and moderate swapped) passes that test every time. These three
// tests assert against the spec's order directly, each holding every rank
// component but the one under test constant across its entries.
test('reversibility tiers sort one-way, then hard, then moderate, then trivial', () => {
  const out = render([
    ev('t-trivial', { question: 'trivial tier', chosen: 'x', reversibility: 'trivial' }),
    ev('t-moderate', { question: 'moderate tier', chosen: 'x', reversibility: 'moderate' }),
    ev('t-hard', { question: 'hard tier', chosen: 'x', reversibility: 'hard' }),
    ev('t-oneway', { question: 'one-way tier', chosen: 'x', reversibility: 'one-way' }),
  ]);
  const at = (s: string) => out.indexOf(s);
  assert.ok(at('one-way tier') < at('hard tier'), 'one-way must sort before hard');
  assert.ok(at('hard tier') < at('moderate tier'), 'hard must sort before moderate');
  assert.ok(at('moderate tier') < at('trivial tier'), 'moderate must sort before trivial');
});

test('an absent reversibility sorts after all four named tiers', () => {
  const out = render([
    ev('a-none', { question: 'no reversibility', chosen: 'x' }),
    ev('a-trivial', { question: 'trivial tier two', chosen: 'x', reversibility: 'trivial' }),
    ev('a-moderate', { question: 'moderate tier two', chosen: 'x', reversibility: 'moderate' }),
    ev('a-hard', { question: 'hard tier two', chosen: 'x', reversibility: 'hard' }),
    ev('a-oneway', { question: 'one-way tier two', chosen: 'x', reversibility: 'one-way' }),
  ]);
  const at = (s: string) => out.indexOf(s);
  for (const tier of ['one-way tier two', 'hard tier two', 'moderate tier two', 'trivial tier two']) {
    assert.ok(at(tier) < at('no reversibility'), `${tier} must sort before an absent reversibility`);
  }
});

test('with reversibility equal, a blastRadius present sorts before one absent', () => {
  // Ids are deliberately anti-alphabetical to the expected order: if the
  // blastRadius tier were neutralised, the id tiebreak alone would place
  // 'a-without' first, so a pass here can only come from the blastRadius
  // comparison actually running.
  const out = render([
    ev('a-without', { question: 'no blast radius', chosen: 'x', reversibility: 'hard' }),
    ev('z-with', { question: 'has blast radius', chosen: 'x', reversibility: 'hard', blastRadius: 'wide' }),
  ]);
  const at = (s: string) => out.indexOf(s);
  assert.ok(at('has blast radius') < at('no blast radius'),
    'an entry with blastRadius must sort before one without, at equal reversibility');
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

test('a blank rejected entry is dropped, not rendered as an empty bullet', () => {
  const out = render([ev('d2', { question: 'q2', chosen: 'x', rejected: ['', 'real one', '   '] })]);
  const lines = out.split('\n');
  assert.ok(lines.includes('- real one'), 'the non-blank rejected entry must still render');
  assert.ok(!lines.some((l) => /^-\s*$/.test(l)),
    'a blank rejected entry rendered as a bare bullet');
});

// Disclosure alone must not be relied on to keep voids out: this event is
// explicitly `published` (readable at every level), so only the `e.kind !==
// 'void'` filter stands between it and the digest. (The `voidEvent()` helper
// in coverage.ts always normalizes to `private` disclosure since it exposes
// no disclosure input — using it here would let readableAt mask a dropped
// kind filter instead of the kind filter itself being exercised.)
test('a void event never reaches the digest, even when otherwise readable', () => {
  const events = [
    ev('shown', { question: 'a real decision', chosen: 'x' }),
    evKind('v1', 'void', { reason: 'a refused write' }),
  ];
  const out = render(events);
  assert.ok(out.includes('a real decision'));
  // A void event's `reason` is not a field renderDigest ever displays (that
  // is the actual VoidInput shape — see coverage.ts), so asserting against
  // it would pass whether or not the entry leaked through. A void event also
  // has no question/statement/claim, so a leaked one titles from its id.
  assert.ok(!out.includes('## v1'), 'a void event reached the digest body');
});

test('a title falls back through statement (constraint) and claim (finding) when there is no question', () => {
  const out = render([
    evKind('con1', 'constraint', { statement: 'no admin api tokens in logs' }),
    evKind('find1', 'finding', { claim: 'the cache was never invalidated on write' }),
  ]);
  assert.ok(out.includes('## no admin api tokens in logs'), 'a constraint should title from statement');
  assert.ok(out.includes('## the cache was never invalidated on write'), 'a finding should title from claim');
});

test('a rationale renders as the why line when the entry is readable', () => {
  const out = render([ev('r2', { question: 'why did we do this', chosen: 'x',
    rationale: 'the vendor deprecated the old api' })]);
  assert.ok(out.includes('- **why** the vendor deprecated the old api'),
    'a readable rationale must render its why line');
});

// A careless — or hostile — title should not be able to corrupt the digest's
// heading structure. Scoped to the title only; body fields are deliberately
// left unescaped (a broader design question this fix round does not settle):
// e.g. `chosen`, `rationale` and `rejected[]` can still contain raw markdown
// or newlines that are not stripped here.
test('a markdown-heading-shaped title cannot inject a heading or leak a raw line', () => {
  const out = render([ev('inj', { question: '## nested\nsecond line', chosen: 'x' })]);
  assert.ok(out.includes('## nested second line'), 'the sanitized title must still render, on one line');
  assert.ok(!out.includes('## ## nested'), 'a leading # in the title was not stripped');
  assert.ok(!out.split('\n').includes('second line'),
    'a newline inside the title escaped into the document as a raw line');
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
