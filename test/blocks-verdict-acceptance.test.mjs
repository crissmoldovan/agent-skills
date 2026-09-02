import assert from 'node:assert/strict';
import test from 'node:test';

import { chooseVerdictAt, classifyBlocksEvidence, coversHead, mentionedShas, reviewedSha, subThresholdCount, verdictAcceptance } from '../skills/blocks/scripts/blocks-review.mjs';

// A clean verdict is not acceptance, and both halves of that were learned the hard
// way on a real pull request rather than imagined here.
//
// A review names the commit it read. Every push moves the branch, so a verdict for
// the previous head says nothing about the current one — and its wording gives no
// hint that it is stale. Separately, `gh pr checks` reported pass while the run
// underneath belonged to the previous head, because the new run had not registered
// yet; a poll keyed on the check NAME exited satisfied for a commit CI never tested.

test('pulls the commit out of the shapes this bot actually writes', () => {
  assert.equal(reviewedSha('Reviewed PR #29 at `a0eef8b`.\n\nNo new severity >=7 findings.'), 'a0eef8b');
  assert.equal(reviewedSha('Reviewed `67b6d36` and its documentation-only diff.'), '67b6d36');
  assert.equal(reviewedSha('Review complete for `b41f0aa`. Zero findings.'), 'b41f0aa');
  assert.equal(reviewedSha('Reviewed the pull request end to end. No findings.'), null);
});

test('accepts only a clean verdict for this head with CI green on the same commit', () => {
  const ok = verdictAcceptance({ state: 'clean', verdictSha: 'a0eef8b', headSha: 'a0eef8b2ee12', ciConclusion: 'success' });
  assert.equal(ok.acceptable, true);
  assert.deepEqual(ok.reasons, []);
});

test('refuses a verdict that reviewed a superseded head', () => {
  const stale = verdictAcceptance({ state: 'clean', verdictSha: '4248476', headSha: 'a0eef8b2', ciConclusion: 'success' });
  assert.equal(stale.acceptable, false);
  assert.match(stale.reasons.join(' '), /reviewed `4248476` but the head is/);
});

test('refuses a clean verdict when CI failed or has not finished on this head', () => {
  // Not finished is not a pass. The run for a new head takes time to register, and
  // treating "no run yet" as success is how a green name gets read for a commit
  // that was never tested.
  assert.equal(verdictAcceptance({ state: 'clean', verdictSha: 'a0eef8b', headSha: 'a0eef8b', ciConclusion: 'failure' }).acceptable, false);
  const pending = verdictAcceptance({ state: 'clean', verdictSha: 'a0eef8b', headSha: 'a0eef8b', ciConclusion: null });
  assert.equal(pending.acceptable, false);
  assert.match(pending.reasons.join(' '), /no CI run for this head has completed/);
});

test('refuses anything that is not clean, whatever else lines up', () => {
  for (const state of ['findings', 'reviewing', 'requested', 'pr_closed']) {
    const result = verdictAcceptance({ state, verdictSha: 'a0eef8b', headSha: 'a0eef8b', ciConclusion: 'success' });
    assert.equal(result.acceptable, false, state);
  }
});

test('dates a verdict that names no commit rather than refusing it outright', () => {
  // Not every verdict names a sha. Refusing those would block a good review over its
  // wording — the same mistake, one layer up. A verdict posted after the head was
  // committed cannot have read an earlier one.
  const after = verdictAcceptance({
    state: 'clean', verdictSha: null, headSha: 'abc1234', ciConclusion: 'success',
    verdictAt: '2026-09-02T05:45:00Z', headCommittedAt: '2026-09-02T05:30:00Z',
  });
  assert.equal(after.acceptable, true);

  const before = verdictAcceptance({
    state: 'clean', verdictSha: null, headSha: 'abc1234', ciConclusion: 'success',
    verdictAt: '2026-09-02T05:15:00Z', headCommittedAt: '2026-09-02T05:30:00Z',
  });
  assert.equal(before.acceptable, false);
  assert.match(before.reasons.join(' '), /predates this head/);
});

test('refuses when it can neither name nor date the verdict', () => {
  const blind = verdictAcceptance({ state: 'clean', verdictSha: null, headSha: 'abc1234', ciConclusion: 'success' });
  assert.equal(blind.acceptable, false);
  assert.match(blind.reasons.join(' '), /names no commit and cannot be dated/);
});

test('dates a check-run verdict by the check, never by unrelated help text', () => {
  // The check-run delivery path has no comment to date, so before the check's own
  // completion was used it fell through to the newest comment — which is the
  // integration's help text, posted when the PR opened. That accepted on the
  // timestamp of something that was not a verdict at all.
  const helpTextAt = '2026-09-02T06:13:33Z';
  const checkAt = '2026-09-02T07:20:00Z';

  assert.equal(chooseVerdictAt({ blocksCheckCompletedAt: checkAt, latestAt: helpTextAt }), checkAt);
  assert.equal(chooseVerdictAt({ namedAt: '2026-09-02T07:30:00Z', blocksCheckCompletedAt: checkAt }), '2026-09-02T07:30:00Z');
  assert.equal(chooseVerdictAt({ latestAt: helpTextAt }), helpTextAt);
  assert.equal(chooseVerdictAt({}), null);
});

test('a check-run verdict is acceptable when the check finished after this head', () => {
  const accepted = verdictAcceptance({
    state: 'clean', verdictSha: null, headSha: '221728c', ciConclusion: 'success',
    verdictAt: '2026-09-02T07:20:00Z', headCommittedAt: '2026-09-02T07:05:00Z',
  });
  assert.equal(accepted.acceptable, true, accepted.reasons.join('; '));

  const stale = verdictAcceptance({
    state: 'clean', verdictSha: null, headSha: '221728c', ciConclusion: 'success',
    verdictAt: '2026-09-02T07:00:00Z', headCommittedAt: '2026-09-02T07:05:00Z',
  });
  assert.equal(stale.acceptable, false);
});

// `.blocks/review.md` asks the reviewer to list what the platform dropped below
// severity 7. Those summaries carry "Severity 5 — ..." lines, and reading them as
// outstanding work made every honest review permanently `findings` and therefore
// never mergeable — which punishes the disclosure and teaches everyone to stop.
const DISCLOSING_VERDICT = `Reviewed PR #14 at \`f38ec17\`.

The two commits since the last reviewed state address the severity-4 finding from the prior round.

### No findings at or above severity 7

No inline comments posted.

### Sub-threshold observations

**Severity 5 — usage examples trimmed**
The G2 example carried a guard the others do not.

**Severity 2 — description counts stale**
The body says one file; the diff is two.`;

const classify = (body) => classifyBlocksEvidence(
  { comments: [{ id: 1, author: 'blocksorg', createdAt: '2026-01-01T00:00:10Z', body }], reviews: [], inline: [], checks: [], prState: 'OPEN' },
  { requestedAt: '2026-01-01T00:00:00Z', baselineIds: {} },
).state;

test('a disclosed sub-threshold section does not make a clean review findings', () => {
  assert.equal(classify(DISCLOSING_VERDICT), 'clean');
});

test('the disclosed observations are counted rather than lost', () => {
  assert.equal(subThresholdCount(DISCLOSING_VERDICT), 2);
  assert.equal(subThresholdCount('Reviewed PR #14.\n\n### Sub-threshold observations\n\nNo sub-threshold observations.'), 0);
  assert.equal(subThresholdCount('Reviewed PR #14. No findings.'), 0);
});

test('findings at or above the bar still count, even beside a disclosed section', () => {
  // The section is excluded, not the whole verdict. Real findings above it stand.
  const withReal = DISCLOSING_VERDICT.replace('No inline comments posted.', 'Two findings remain open in the retry path.');
  assert.equal(classify(withReal), 'findings');
});

test('a resolution in the active voice is not a report of outstanding work', () => {
  // "the two commits address the severity-4 finding from the prior round" describes
  // what was fixed; the passive pattern alone read it as what is broken.
  assert.equal(classify('Reviewed PR #14 at `f38ec17`. The commits address the severity-4 finding from the prior round. No findings at or above severity 7.'), 'clean');
});

// Asking "which sha did this verdict review" was the wrong question, and both ways
// of getting it wrong were observed on one pull request.
test('a verdict naming two commits is read as covering the head, not the older one', () => {
  // "Review of `f38ec17` (two commits since `3190f35`)" — taking the first sha by
  // position reported a review of the superseded commit, on a comment whose own
  // title named the current head.
  const body = 'Review of `f38ec17` (two commits since `3190f35`). No findings at or above severity 7.';
  assert.deepEqual(mentionedShas(body), ['f38ec17', '3190f35']);
  assert.equal(coversHead(body, 'f38ec17aa1122'), true);
  assert.equal(coversHead(body, '3190f35'), true);
  assert.equal(coversHead(body, 'deadbee'), false);
});

test('coverage does not depend on a phrasing being anticipated', () => {
  // Each of these returned null from the phrase-matching version, which left the
  // verdict tied to nothing and refused for a reason that was not true.
  for (const body of [
    'Review of `f38ec17`.',
    '## Review — PR #14 sync on `f38ec17`',
    'I have everything I need. Reviewed `f38ec17` end to end.',
    'Verdict for `f38ec17`: nothing outstanding.',
  ]) {
    assert.equal(coversHead(body, 'f38ec17'), true, body);
  }
});

test('a verdict naming only older commits does not cover this head', () => {
  const body = 'Reviewed PR #14 at `3190f35`. No findings at or above severity 7.';
  assert.equal(coversHead(body, 'f38ec17'), false);
  const stale = verdictAcceptance({ state: 'clean', verdictSha: '3190f35', headSha: 'f38ec17', ciConclusion: 'success' });
  assert.equal(stale.acceptable, false);
});

test('no commit mentioned at all is not coverage', () => {
  assert.equal(coversHead('Reviewed the pull request end to end. No findings.', 'f38ec17'), false);
  assert.deepEqual(mentionedShas('no backticked shas here'), []);
});
