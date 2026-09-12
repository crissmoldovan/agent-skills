import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { acceptVerdict, classifyBlocksEvidence, latestVerdict } from '../skills/blocks/scripts/blocks-review.mjs';

// Which verdict decides, and which verdict acceptance asks about — the same one.
//
// Observed on cueplusplus/cue-ui#94. With the window opened before three rounds, the
// classifier took the FIRST verdict it met (a clean review of `e428be3`, two heads
// back) and the CLI took head coverage from whichever comment named the current head.
// It printed "Acceptable: clean verdict for 8b08c61" on the strength of a review of
// another commit; had the newest round found something, a stale clean would still
// have decided the state and a fresh comment would still have supplied the head.
const SCENARIOS = JSON.parse(readFileSync(join(import.meta.dirname, 'blocks-verdict-selection.fixtures.json'), 'utf8'));

function run(scenario) {
  const result = classifyBlocksEvidence(
    { comments: scenario.comments, reviews: [], inline: [], checks: [], prState: 'OPEN' },
    { requestedAt: scenario.requestedAt, baselineIds: {} },
  );
  const acceptance = acceptVerdict(result, {
    headSha: scenario.headSha,
    ciConclusion: scenario.ciConclusion,
    headCommittedAt: scenario.headCommittedAt,
  });
  return { result, acceptance };
}

for (const scenario of SCENARIOS) {
  test(`verdict selection: ${scenario.id}`, () => {
    const { result, acceptance } = run(scenario);
    const { expected } = scenario;
    assert.equal(result.state, expected.state, scenario.why);
    assert.equal(result.verdict?.id, expected.verdictId, 'the deciding verdict');
    assert.equal(acceptance.acceptable, expected.acceptable, acceptance.reasons.join('; '));
    if (expected.reason) assert.ok(acceptance.reasons.some((reason) => reason.includes(expected.reason)), acceptance.reasons.join('; '));
    if (expected.dashboardSession) assert.ok(result.dashboardUrl?.includes(expected.dashboardSession), result.dashboardUrl);
  });
}

test('the latest verdict is chosen by time, then by position, and never from help or acknowledgement text', () => {
  const clean = (id, createdAt, sha) => ({ id, author: 'blocksorg', createdAt, body: `Reviewed PR #7 at \`${sha}\`. No actionable issues (severity ≥7) found.` });
  assert.equal(latestVerdict([]), null);
  assert.equal(latestVerdict([{ id: 1, author: 'blocksorg', createdAt: '2026-09-12T10:00:00Z', body: "I'm taking a look. Review in progress." }]), null);
  assert.equal(latestVerdict([clean(1, '2026-09-12T11:00:00Z', 'aaaaaaa'), clean(2, '2026-09-12T10:00:00Z', 'bbbbbbb')]).id, 1);
  // Same second: the later position wins, so a page never reorders the answer.
  assert.equal(latestVerdict([clean(1, '2026-09-12T10:00:00Z', 'aaaaaaa'), clean(2, '2026-09-12T10:00:00Z', 'bbbbbbb')]).id, 2);
  const withHelp = [
    clean(1, '2026-09-12T10:00:00Z', 'aaaaaaa'),
    { id: 2, author: 'blocksorg', createdAt: '2026-09-12T10:05:00Z', body: 'Mention Blocks like a regular teammate with your question or request:\n\nRun `@blocks /help` for more information.' },
    { id: 3, author: 'blocksorg', createdAt: '2026-09-12T10:06:00Z', body: 'Taking a look — I will respond here shortly.' },
  ];
  assert.equal(latestVerdict(withHelp).id, 1);
});

test('acknowledgements alone never become a verdict: the state stays non-terminal', () => {
  const result = classifyBlocksEvidence(
    { comments: [{ id: 1, author: 'blocksorg', createdAt: '2026-09-12T10:00:00Z', body: "I'm taking a look. Review in progress." }], reviews: [], inline: [], checks: [], prState: 'OPEN' },
    { requestedAt: '2026-09-12T09:00:00Z', baselineIds: {} },
  );
  assert.equal(result.terminal, false);
  assert.equal(result.verdict, null);
  assert.equal(acceptVerdict(result, { headSha: 'b'.repeat(40), ciConclusion: 'success', headCommittedAt: '2026-09-12T09:30:00Z' }).acceptable, false);
});

test('a verdict naming no commit is dated by its own timestamp, not by a newer comment', () => {
  const comments = [
    { id: 1, author: 'blocksorg', createdAt: '2026-09-12T10:00:00Z', body: 'Reviewed PR #7. No actionable issues (severity ≥7) found.' },
    { id: 2, author: 'blocksorg', createdAt: '2026-09-12T12:00:00Z', body: 'Mention Blocks like a regular teammate with your question or request.' },
  ];
  const result = classifyBlocksEvidence({ comments, reviews: [], inline: [], checks: [], prState: 'OPEN' }, { requestedAt: '2026-09-12T09:00:00Z', baselineIds: {} });
  assert.equal(result.verdict.id, 1);
  // Head committed after the verdict: the verdict cannot have read it, and the newer
  // help text must not be what dates it.
  const late = acceptVerdict(result, { headSha: 'b'.repeat(40), ciConclusion: 'success', headCommittedAt: '2026-09-12T11:00:00Z' });
  assert.equal(late.acceptable, false);
  const early = acceptVerdict(result, { headSha: 'b'.repeat(40), ciConclusion: 'success', headCommittedAt: '2026-09-12T09:30:00Z' });
  assert.equal(early.acceptable, true, early.reasons.join('; '));
});
