import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISCLOSURE_CLASSES, normalizeDisclosure, readableAt } from '../src/disclosure.ts';
import { normalizeEvent } from '../src/envelope.ts';

function entry(disclosure?: unknown) {
  return normalizeEvent({
    schemaVersion: 1, id: 'e1', source: 'cli/h/s/a', sourceEpoch: 'e1',
    time: '2026-09-07T10:00:00.000Z', workspace: 'ws', session: 's', agent: 'a',
    author: 'agent', provenance: 'cli', harness: 'test', context: 'coding',
    kind: 'decision', data: { question: 'q', chosen: 'c' },
    ...(disclosure === undefined ? {} : { disclosure }),
  });
}

test('the three classes are exactly the spec\'s', () => {
  assert.deepEqual([...DISCLOSURE_CLASSES], ['private', 'team', 'published']);
});

// Everywhere else here an unrecognised value is refused. This one fails toward
// containment instead, because publishing a private entry cannot be undone and
// withholding a public one can.
test('an unrecognised or absent disclosure parses as private, never team', () => {
  for (const bad of ['Published', 'public', '', null, 7, undefined, {}]) {
    assert.equal(normalizeDisclosure(bad), 'private', `${JSON.stringify(bad)} did not contain`);
  }
});

test('each recognised class parses as itself', () => {
  for (const c of DISCLOSURE_CLASSES) assert.equal(normalizeDisclosure(c), c);
});

test('readableAt admits equal and more-open classes, never more-closed ones', () => {
  // A team reader sees team and published; a published reader sees only published.
  assert.equal(readableAt(entry('private'), 'private'), true);
  assert.equal(readableAt(entry('team'), 'private'), true);
  assert.equal(readableAt(entry('published'), 'private'), true);

  assert.equal(readableAt(entry('private'), 'team'), false);
  assert.equal(readableAt(entry('team'), 'team'), true);
  assert.equal(readableAt(entry('published'), 'team'), true);

  assert.equal(readableAt(entry('private'), 'published'), false);
  assert.equal(readableAt(entry('team'), 'published'), false);
  assert.equal(readableAt(entry('published'), 'published'), true);
});

test('an entry with no disclosure field is contained, not published', () => {
  assert.equal(entry().disclosure, 'private');
  assert.equal(readableAt(entry(), 'published'), false);
});
