import assert from 'node:assert/strict';
import test from 'node:test';

import { chooseVerdictAt, reviewedSha, verdictAcceptance } from '../skills/blocks/scripts/blocks-review.mjs';

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
