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
