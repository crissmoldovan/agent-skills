import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCompactionFloor, renderConsequenceFloor } from '../src/floors.ts';
import { normalizeEvent } from '../src/envelope.ts';

function obs(id: string, kind: string, data: Record<string, unknown>, time = '2026-09-09T10:00:00.000Z') {
  return normalizeEvent({
    schemaVersion: 1, id, source: 'hook/h/s/a', sourceEpoch: 'e1', time,
    workspace: 'ws', session: 's', agent: 'a', author: 'agent', provenance: 'hook',
    harness: 'test', context: 'coding', kind, data,
  });
}
const bash = (id: string, input: string, time?: string) =>
  obs(id, 'tool_call', { tool: 'Bash', input }, time);

function constraint(
  id: string,
  fields: { statement: string; scope: string; enforcement?: 'advisory' | 'blocking' },
  time = '2026-09-01T00:00:00.000Z',
) {
  return normalizeEvent({
    schemaVersion: 1, id, source: 'cli/h/s/a', sourceEpoch: 'e1', time,
    workspace: 'ws', session: 's', agent: 'a', author: 'agent', provenance: 'cli',
    harness: 'test', context: 'coding', kind: 'constraint',
    data: { statement: fields.statement, scope: fields.scope, enforcement: fields.enforcement ?? 'advisory' },
  });
}

const NOW = '2026-09-09T12:00:00.000Z';

// ---------------------------------------------------------------- compaction

test('renderCompactionFloor returns null (not "") on an empty journal', () => {
  assert.equal(renderCompactionFloor([]), null);
});

test('renderCompactionFloor asks for both the flush and the assumption sweep, in so many words', () => {
  const text = renderCompactionFloor([bash('o1', 'ls')]);
  assert.notEqual(text, null);
  assert.match(text!, /assumption sweep/i, 'must name the sweep explicitly, not just imply it');
  assert.match(text!, /`assumption` entry/i, 'must say which kind to write it as');
  assert.match(text!, /checked: no/, 'must say the sweep entries carry checked: no');
  // The other half: pending work not yet flushed. A reader who only sees the
  // sweep half would miss that §11.2 asks for two things, not one.
  assert.match(text!, /decision|finding|blocker|progress/i);
});

test('renderCompactionFloor never contains a pre-written record invocation', () => {
  const text = renderCompactionFloor([bash('o1', 'wrangler secret put X')]);
  assert.notEqual(text, null);
  assert.doesNotMatch(text!, /agent-journal record/);
  // Also true in spirit: no --kind/--chosen/--rationale-shaped fragment that
  // could be pasted straight into a shell.
  assert.doesNotMatch(text!, /--kind\s+\w+.*--\w+/);
});

test('renderCompactionFloor returns null when nothing happened after `since`, even though the journal is not empty', () => {
  const events = [bash('old', 'ls', '2026-09-01T00:00:00.000Z')];
  assert.equal(renderCompactionFloor(events, { since: '2026-09-08T00:00:00.000Z' }), null);
});

test('renderCompactionFloor fires when something happened after `since`', () => {
  const events = [
    bash('old', 'ls', '2026-09-01T00:00:00.000Z'),
    bash('new', 'ls', '2026-09-09T00:00:00.000Z'),
  ];
  assert.notEqual(renderCompactionFloor(events, { since: '2026-09-08T00:00:00.000Z' }), null);
});

// `since` must be exclusive, matching consequencesIn's own documented
// semantics: replaying the same cutoff twice must never re-flag the boundary
// event itself.
test('renderCompactionFloor treats `since` as exclusive: an event exactly at the cutoff does not count', () => {
  const events = [bash('boundary', 'ls', '2026-09-08T00:00:00.000Z')];
  assert.equal(renderCompactionFloor(events, { since: '2026-09-08T00:00:00.000Z' }), null);
});

test('renderCompactionFloor rejects an unparseable `since`', () => {
  assert.throws(
    () => renderCompactionFloor([bash('o1', 'ls')], { since: 'not-a-timestamp' }),
    /parseable timestamp/,
  );
});

// ---------------------------------------------------------------- consequence

test('renderConsequenceFloor returns null (not "") on an empty journal with no subject', () => {
  assert.equal(renderConsequenceFloor([], { now: NOW }), null);
});

test('renderConsequenceFloor returns null for a benign call and no matching constraint', () => {
  const events = [bash('o1', 'git log --oneline -20')];
  assert.equal(renderConsequenceFloor(events, { now: NOW }), null);
});

test('renderConsequenceFloor names the observation id so it can be cited as an anchor', () => {
  const events = [bash('o1', 'wrangler secret put API_KEY')];
  const text = renderConsequenceFloor(events, { now: NOW });
  assert.notEqual(text, null);
  assert.match(text!, /o1/, 'the observation id must appear so the agent can cite it');
  assert.match(text!, /anchor/i);
});

test('renderConsequenceFloor never contains a pre-written record invocation', () => {
  const events = [bash('o1', 'wrangler secret put API_KEY')];
  const text = renderConsequenceFloor(events, { now: NOW });
  assert.notEqual(text, null);
  assert.doesNotMatch(text!, /agent-journal record/);
  assert.doesNotMatch(text!, /--kind\s+\w+.*--\w+/);
});

test('renderConsequenceFloor respects `since`', () => {
  const events = [bash('old', 'wrangler secret put A', '2026-09-01T00:00:00.000Z')];
  assert.equal(
    renderConsequenceFloor(events, { since: '2026-09-08T00:00:00.000Z', now: NOW }),
    null,
    'the only consequence-bearing observation happened before the cutoff',
  );
});

test('--subject wires constraintsBearingOn\'s matcher: a matching live constraint surfaces with no other consequence present', () => {
  const events = [
    constraint('c1', { statement: 'no unmanaged brokers', scope: 'redis', enforcement: 'blocking' }),
    bash('o1', 'ls'), // benign; consequencesIn alone would yield nothing
  ];
  const text = renderConsequenceFloor(events, { subject: 'redis cache client', now: NOW });
  assert.notEqual(text, null, 'a live constraint matching the subject must surface something');
  assert.match(text!, /c1/);
  assert.match(text!, /redis/i);
});

test('--subject that matches no live constraint scope stays null when nothing else fired', () => {
  const events = [
    constraint('c1', { statement: 'no unmanaged brokers', scope: 'redis', enforcement: 'blocking' }),
    bash('o1', 'ls'),
  ];
  const text = renderConsequenceFloor(events, { subject: 'postgres', now: NOW });
  assert.equal(text, null);
});

test('--subject matching is whole-word, same as constraintsBearingOn: "telemetrics" does not match scope "telemetry"', () => {
  const events = [
    constraint('c1', { statement: 'no third-party sink', scope: 'telemetry', enforcement: 'blocking' }),
  ];
  assert.equal(renderConsequenceFloor(events, { subject: 'telemetrics dashboard', now: NOW }), null);
  assert.notEqual(renderConsequenceFloor(events, { subject: 'telemetry pipeline', now: NOW }), null);
});

test('an expired constraint does not surface via --subject', () => {
  const events = [
    constraint('c1', { statement: 'no third-party sink', scope: 'telemetry', enforcement: 'blocking' }),
  ];
  const expired = renderConsequenceFloor(events, {
    subject: 'telemetry pipeline',
    now: '2099-01-01T00:00:00.000Z',
  });
  // No expiry was set on the fixture, so it never expires — this asserts the
  // wiring actually threads `now` through to liveConstraints rather than
  // skipping liveness. Re-expressed with an explicit expiry below.
  assert.notEqual(expired, null, 'sanity: an unexpired constraint still matches at a later `now`');

  const expiring = normalizeEvent({
    schemaVersion: 1, id: 'c2', source: 'cli/h/s/a', sourceEpoch: 'e1',
    time: '2026-09-01T00:00:00.000Z', workspace: 'ws', session: 's', agent: 'a',
    author: 'agent', provenance: 'cli', harness: 'test', context: 'coding', kind: 'constraint',
    data: { statement: 'temp rule', scope: 'staging', enforcement: 'advisory', expiry: '2026-09-05' },
  });
  const afterExpiry = renderConsequenceFloor([expiring], { subject: 'staging deploy', now: NOW });
  assert.equal(afterExpiry, null, 'a constraint past its own expiry must not surface');
  const beforeExpiry = renderConsequenceFloor([expiring], {
    subject: 'staging deploy', now: '2026-09-02T00:00:00.000Z',
  });
  assert.notEqual(beforeExpiry, null, 'the same constraint, checked before its expiry, is live');
});

test('a mutation consequence and a constraint match can both surface for one call', () => {
  const events = [
    constraint('c1', { statement: 'no unmanaged brokers', scope: 'redis', enforcement: 'blocking' }),
    bash('o1', 'wrangler secret put REDIS_URL'),
  ];
  const text = renderConsequenceFloor(events, { subject: 'redis', now: NOW });
  assert.notEqual(text, null);
  assert.match(text!, /o1/);
  assert.match(text!, /c1/);
});

// Found via mutation-checking: `now` is only EVER dereferenced on the branch
// that has a subject to check — liveConstraints(), which requires a
// parseable `now`, must never run at all when there is no subject, so an
// unusable `now` from a caller with nothing to check must not blow up a call
// that was never going to need it.
test('no subject means no constraint check runs at all — an unparseable `now` does not matter without one', () => {
  assert.doesNotThrow(() => renderConsequenceFloor([], { now: 'not-a-timestamp' }));
  assert.equal(renderConsequenceFloor([], { now: 'not-a-timestamp' }), null);
});

test('a blank --subject (whitespace only) is treated as absent, not a literal empty match', () => {
  const events = [
    constraint('c1', { statement: 'no unmanaged brokers', scope: 'redis', enforcement: 'blocking' }),
    bash('o1', 'ls'),
  ];
  assert.equal(renderConsequenceFloor(events, { subject: '   ', now: NOW }), null);
});

// §4.3 defines `runtime` as covering exactly the mutation case — "a deployed
// config or flag change that has no commit and no file, and is exactly what a
// support question is about" — and §11.3 lists these mutations as `runtime`
// anchors in so many words. Telling an agent to cite a secret rotation as
// `tool_use` loses that at the one moment anybody is thinking about it, which
// is also the moment this whole floor exists to create.
test('a mutation is offered as a runtime anchor, not a tool_use one', () => {
  const out = renderConsequenceFloor(
    [bash('obs-1', 'wrangler secret put API_KEY')],
    { now: NOW },
  )!;
  assert.match(out, /--anchor runtime:obs-1/);
  assert.doesNotMatch(out, /--anchor tool_use:obs-1/,
    'a config mutation was offered under the wrong anchor class');
});

// ...and the others really are tool calls: what is cited is that the call
// happened, which is what tool_use means.
test('an unfamiliar API call is offered as a tool_use anchor', () => {
  const out = renderConsequenceFloor(
    [bash('obs-2', 'curl https://brand-new.example.com/v1/thing')],
    { now: NOW },
  )!;
  assert.match(out, /--anchor tool_use:obs-2/);
});
