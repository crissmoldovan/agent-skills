import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAnchor, parseInfluence, INFLUENCE_TYPES, INFLUENCE_ROLES,
  fieldsFor, normalizeEntryData, KIND_FIELDS,
} from '../src/entry.ts';
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

// CRITICAL (fix round 1): this had zero coverage. Mutating the skip in
// normalizeEntryData to write '' / [] for an unsupplied field left all 141
// tests green, and the built binary then wrote `"rejected":[],"rationale":""`
// for a plain two-flag decision — a claim ("assessed, none found" /
// "assessed, empty") where nothing was assessed. Assert on absence itself,
// never on falsiness: `!data.rationale` passes for '' too and would not have
// caught this.
test('a field nobody supplied is absent from data, not written as empty', () => {
  const data = normalizeEntryData('decision', new Map([
    ['question', ['q']],
    ['chosen', ['c']],
  ]));
  // scalar field: must be genuinely absent, not ''
  assert.equal(data.rationale, undefined);
  assert.ok(!('rationale' in data), 'rationale must not be a key in data at all');
  // list field: must be genuinely absent, not []
  assert.equal(data.rejected, undefined);
  assert.ok(!('rejected' in data), 'rejected must not be a key in data at all');
});

// IMPORTANT 1 (fix round 1): narrowing LIST_FIELDS to just `rejected` left
// 141/141 green — evidence and premise had no coverage of their own, only
// rejected's. Both must independently prove they collect every value.
test('evidence and premise are list fields too, not just rejected', () => {
  const data = normalizeEntryData('finding', new Map([
    ['claim', ['the timeout is 30s, not 10s as documented']],
    ['evidence', ['observed 28.7s in prod logs', 'ticket #4821 confirms 30s']],
    ['premise', ['the docs were last updated two years ago']],
  ]));
  assert.deepEqual(data.evidence, ['observed 28.7s in prod logs', 'ticket #4821 confirms 30s']);
  assert.deepEqual(data.premise, ['the docs were last updated two years ago']);
});

