import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveClaims } from '../src/claims.ts';
import { normalizeEvent } from '../src/envelope.ts';

function claim(id: string, session: string, time: string, data: Record<string, unknown>) {
  return normalizeEvent({
    schemaVersion: 1, id, source: `hook/h/${session}/primary`, sourceEpoch: 'e1', time,
    workspace: 'ws', session, agent: 'primary', author: 'agent', provenance: 'hook',
    harness: 'claude-code', context: 'coding', kind: 'path_claim', data,
  });
}
const BASE = { checkout: '/work/repo', worktree: '/work/repo', branch: 'main', ttlSeconds: '3600' };

// A foreign writer — another CLI, a hook in another language, a hand-edited
// segment — can easily record ttlSeconds as a NUMBER. Treating that as "no TTL
// stated" read a 2-hour claim as a 1-hour one and dropped it while it was still
// held: an unreadable lifetime must never shorten a claim.
test('a non-string ttlSeconds is unusable, not a silent default', () => {
  const c = claim('c1', 's1', '2026-09-08T10:00:00.000Z', { checkout: '/w/r', ttlSeconds: 7200 });
  const live = liveClaims([c], '2026-09-08T11:30:00.000Z');
  assert.equal(live.length, 1, 'a 2-hour claim was dropped 90 minutes in');
  assert.equal(live[0]!.malformedTtl, true);
  assert.ok(!('expiresAt' in live[0]!), 'an unreadable lifetime must not produce an expiry');
});

test('a claim inside its TTL is live', () => {
  const c = claim('c1', 's1', '2026-09-08T10:00:00.000Z', BASE);
  assert.equal(liveClaims([c], '2026-09-08T10:30:00.000Z').length, 1);
});

// Without expiry a crashed session holds a claim forever and the feature becomes
// noise everyone ignores.
test('a claim past its TTL is not live', () => {
  const c = claim('c1', 's1', '2026-09-08T10:00:00.000Z', BASE);
  assert.equal(liveClaims([c], '2026-09-08T11:30:00.000Z').length, 0);
});

test('the TTL boundary is inclusive of its final second', () => {
  const c = claim('c1', 's1', '2026-09-08T10:00:00.000Z', BASE);
  assert.equal(liveClaims([c], '2026-09-08T11:00:00.000Z').length, 1, 'expired one second early');
  assert.equal(liveClaims([c], '2026-09-08T11:00:00.001Z').length, 0);
});

test('a session_end retires that session\'s claims', () => {
  const events = [
    claim('c1', 's1', '2026-09-08T10:00:00.000Z', BASE),
    normalizeEvent({
      schemaVersion: 1, id: 'e1', source: 'hook/h/s1/primary', sourceEpoch: 'e1',
      time: '2026-09-08T10:05:00.000Z', workspace: 'ws', session: 's1', agent: 'primary',
      author: 'agent', provenance: 'hook', harness: 'claude-code', context: 'coding',
      kind: 'session_end', data: { reason: 'closed' },
    }),
  ];
  assert.deepEqual(liveClaims(events, '2026-09-08T10:30:00.000Z'), []);
});

test('a later claim from one session replaces its earlier one', () => {
  const events = [
    claim('c1', 's1', '2026-09-08T10:00:00.000Z', BASE),
    claim('c2', 's1', '2026-09-08T10:10:00.000Z', { ...BASE, branch: 'feature' }),
  ];
  const live = liveClaims(events, '2026-09-08T10:30:00.000Z');
  assert.equal(live.length, 1);
  assert.equal(live[0]!.branch, 'feature');
});

test('two different sessions in one checkout both surface — this is the case it exists for', () => {
  const events = [
    claim('c1', 's1', '2026-09-08T10:00:00.000Z', BASE),
    claim('c2', 's2', '2026-09-08T10:01:00.000Z', BASE),
  ];
  assert.deepEqual(liveClaims(events, '2026-09-08T10:30:00.000Z').map((c) => c.session).sort(),
    ['s1', 's2']);
});

test('a claim with no checkout is skipped — it claims nothing', () => {
  const c = claim('c1', 's1', '2026-09-08T10:00:00.000Z', { ttlSeconds: '3600' });
  assert.deepEqual(liveClaims([c], '2026-09-08T10:30:00.000Z'), []);
});

test('an unusable ttlSeconds keeps the claim live and marks it, never silently drops it', () => {
  const c = claim('c1', 's1', '2026-09-08T10:00:00.000Z', { ...BASE, ttlSeconds: 'soon' });
  const live = liveClaims([c], '2026-09-09T10:00:00.000Z');
  assert.equal(live.length, 1, 'an unreadable TTL dropped the claim — the unsafe direction');
  assert.equal(live[0]!.malformedTtl, true);
});

// The "later claim replaces its earlier one" test above uses two distinct
// timestamps, so it cannot distinguish `>=` from `>` in the tie-break — both
// operators pick the same winner when the later event's time is strictly
// greater. Equal timestamps are the only case the operator choice controls.
test('when two claims from one session share a timestamp, the later-listed one wins', () => {
  const events = [
    claim('c1', 's1', '2026-09-08T10:00:00.000Z', BASE),
    claim('c2', 's1', '2026-09-08T10:00:00.000Z', { ...BASE, branch: 'feature' }),
  ];
  const live = liveClaims(events, '2026-09-08T10:30:00.000Z');
  assert.equal(live.length, 1);
  assert.equal(live[0]!.branch, 'feature', 'a same-timestamp later claim did not replace the earlier one');
});

// The kind check and the `ended` check are ORed in one guard. A test that only
// ever pairs a path_claim with a session_end cannot tell whether the kind half
// is doing anything, because `ended` is already true by the time that event is
// reached. This pairs a path_claim with a later event of a THIRD kind, for a
// session that has NOT ended, to exercise the kind half on its own.
test('a later non-claim event from the same session must not hide its still-live claim', () => {
  const c = claim('c1', 's1', '2026-09-08T10:00:00.000Z', BASE);
  const laterUnrelated = normalizeEvent({
    schemaVersion: 1, id: 'tc1', source: 'hook/h/s1/primary', sourceEpoch: 'e1',
    time: '2026-09-08T10:05:00.000Z', workspace: 'ws', session: 's1', agent: 'primary',
    author: 'agent', provenance: 'hook', harness: 'claude-code', context: 'coding',
    kind: 'tool_call', data: { tool: 'Bash' },
  });
  const live = liveClaims([c, laterUnrelated], '2026-09-08T10:30:00.000Z');
  assert.equal(live.length, 1, 'a later, unrelated event on the same session hid a still-live claim');
  assert.equal(live[0]!.checkout, '/work/repo');
});

// ---------------------------------------------------------------------------
// DEFAULT_TTL_SECONDS. Every test above supplies a ttlSeconds, so nothing
// exercised the default at all — and that default is the only thing stopping a
// crashed session from holding a claim forever. Both halves of the guard that
// selects it were individually deletable with the suite green.
// ---------------------------------------------------------------------------

// Half one: `rawTtl === undefined`. `OBSERVATION_FIELDS.path_claim` lists
// ttlSeconds but nothing requires a caller supply it, so this is the ordinary
// CLI-reachable shape: `observe --kind path_claim --checkout=…` and nothing more.
test('a claim with no ttlSeconds at all gets the one-hour default, not a malformed mark', () => {
  const c = claim('c1', 's1', '2026-09-08T10:00:00.000Z', { checkout: '/w/r' });
  const live = liveClaims([c], '2026-09-08T10:30:00.000Z');
  assert.equal(live.length, 1, 'a claim with no stated TTL was dropped');
  // The exact default, derived from the claim's own timestamp — not merely
  // "some expiry". 10:00 + 3600s.
  assert.equal(live[0]!.expiresAt, '2026-09-08T11:00:00.000Z');
  assert.ok(!('malformedTtl' in live[0]!),
    'an absent TTL is not an unreadable one — absent is not malformed');
});

test('the default TTL actually expires, rather than holding the claim forever', () => {
  const c = claim('c1', 's1', '2026-09-08T10:00:00.000Z', { checkout: '/w/r' });
  assert.equal(liveClaims([c], '2026-09-08T11:00:00.000Z').length, 1, 'expired one second early');
  assert.equal(liveClaims([c], '2026-09-08T11:00:00.001Z').length, 0,
    'a defaulted claim never expires — a crashed session would hold it forever');
});

// Half two: present-but-blank. NOT reachable through this CLI —
// normalizeObservationData drops a blank value, so `--ttlSeconds=` cannot even
// be typed (it is a valueless flag) and `--ttlSeconds ''` normalizes to absent.
// This is the foreign-writer shape, the same class as the non-string case
// above, which was a real bug: a key present and empty states no lifetime, and
// stating none is not the same act as stating an unreadable one.
test('a present-but-blank ttlSeconds is no TTL stated, not an unreadable one', () => {
  for (const blank of ['', '   ', '\t\n']) {
    const c = claim('c1', 's1', '2026-09-08T10:00:00.000Z', { checkout: '/w/r', ttlSeconds: blank });
    const live = liveClaims([c], '2026-09-08T10:30:00.000Z');
    assert.equal(live.length, 1, `dropped for ttlSeconds ${JSON.stringify(blank)}`);
    assert.equal(live[0]!.expiresAt, '2026-09-08T11:00:00.000Z',
      `blank ttlSeconds ${JSON.stringify(blank)} did not take the default`);
    assert.ok(!('malformedTtl' in live[0]!),
      `blank ttlSeconds ${JSON.stringify(blank)} was marked unreadable`);
  }
});
