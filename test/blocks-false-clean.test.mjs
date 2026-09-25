import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  acceptVerdict,
  checkRunsFromPages,
  ciFromCheckRuns,
  classifyBlocksEvidence,
  collectBlocksStatus,
  failureReason,
  isBlocksCheck,
  waitForBlocksReview,
} from '../skills/blocks/scripts/blocks-review.mjs';

// crissmoldovan/agent-communications#34, verbatim: both Blocks replies, in every
// revision GitHub kept, and the check runs on the head. Blocks was logged out. It
// posted "I'm working on this request …", edited that into "Claude Code:
// Authentication failed … Not logged in", and concluded its `Blocks PR Review` check
// `success` with the same notice as the summary. `status` printed "Acceptable: clean
// verdict for f9f191f, CI success" for both requests. #32, #33 and #35 printed the
// same, and merged.
const PR34 = JSON.parse(readFileSync(join(import.meta.dirname, 'blocks-pr34.fixtures.json'), 'utf8'));
const HEAD = PR34.head.sha;
const FIRST_REQUEST = '2026-09-23T19:02:07Z';
const SECOND_REQUEST = '2026-09-24T07:25:57Z';

const [helpText] = PR34.comments.filter((c) => c.author === 'blocksorg[bot]' && c.body);
const replies = PR34.comments.filter((c) => c.revisions);
// A reply as it stood at one revision: 0 is the acknowledgement, the last is the notice.
const asOf = (reply, revision) => ({ id: reply.id, author: reply.author, createdAt: reply.createdAt, body: reply.revisions.at(revision).body });
const ACK = 0;
const NOTICE = -1;

const classify = (evidence, requestedAt) => classifyBlocksEvidence(
  { comments: [], reviews: [], inline: [], checks: [], prState: 'OPEN', ...evidence },
  { requestedAt },
);
// Acceptance as the CLI computes it, from the real check runs on the real head.
const accept = (result) => acceptVerdict(result, {
  headSha: HEAD,
  ciConclusion: ciFromCheckRuns(PR34.checkRuns),
  headCommittedAt: PR34.head.committedAt,
  blocksCheckCompletedAt: PR34.checkRuns.find(isBlocksCheck).completed_at,
});

test('the #34 fixture is what the test says it is', () => {
  assert.equal(replies.length, 2, 'two Blocks replies, one per request');
  for (const reply of replies) {
    assert.match(reply.revisions.at(ACK).body, /^I'm working on this request and will respond here shortly\./);
    assert.match(reply.revisions.at(NOTICE).body, /^Claude Code: Authentication failed\./);
  }
  const blocks = PR34.checkRuns.filter(isBlocksCheck);
  assert.equal(blocks.length, 1, 'one Blocks check on the head: the re-request created none');
  assert.equal(blocks[0].conclusion, 'success');
  assert.match(blocks[0].output.summary, /Authentication failed/);
  assert.equal(ciFromCheckRuns(PR34.checkRuns), 'success', 'CI really was green, so only the review can refuse');
});

test('#34: neither real Blocks reply is clean or acceptable, in any revision, under either request', () => {
  for (const [requestedAt, reply] of [[FIRST_REQUEST, replies[0]], [SECOND_REQUEST, replies[1]]]) {
    for (const revision of [ACK, NOTICE]) {
      for (const checks of [[], PR34.checkRuns]) {
        const result = classify({ comments: [helpText, asOf(reply, revision)], checks }, requestedAt);
        const label = `${reply.id} revision ${revision} with ${checks.length} check runs`;
        assert.notEqual(result.state, 'clean', label);
        assert.equal(accept(result).acceptable, false, label);
      }
    }
  }
});

test('#34 first request: the authentication failure is `failed`, terminal, and says why', () => {
  // The case that printed "Acceptable". The check is inside this request's window
  // and green; its summary is the notice.
  const result = classify({ comments: [helpText, asOf(replies[0], NOTICE)], checks: PR34.checkRuns }, FIRST_REQUEST);
  assert.equal(result.state, 'failed');
  assert.equal(result.terminal, true);
  assert.match(result.reason, /^Claude Code: Authentication failed\./);
  const acceptance = accept(result);
  assert.equal(acceptance.acceptable, false);
  assert.match(acceptance.reasons[0], /^Blocks did not review this request: Claude Code: Authentication failed/);
});

test('#34 first request: the check summary alone is enough, before the comment is edited', () => {
  // At 19:02:39 the check had completed and the comment still read "I'm working on
  // this request" — it was edited at 19:02:41. The check is the only evidence of the
  // failure, and it concluded `success`.
  const result = classify({ comments: [helpText, asOf(replies[0], ACK)], checks: PR34.checkRuns }, FIRST_REQUEST);
  assert.equal(result.state, 'failed');
  assert.equal(result.terminal, true);
  assert.equal(result.check.head_sha, HEAD);
});

test('#34 second request: the acknowledgement is `reviewing`, not clean on the previous day\'s check', () => {
  // Re-requesting on an unchanged head created no check run, so the only Blocks check
  // is yesterday's. It is outside this request's window and must not speak for it.
  const result = classify({ comments: [helpText, asOf(replies[1], ACK)], checks: PR34.checkRuns }, SECOND_REQUEST);
  assert.equal(result.state, 'reviewing');
  assert.equal(result.terminal, false);
  assert.equal(accept(result).acceptable, false);
});

test('#34 second request: before Blocks replies at all, the state is `requested`', () => {
  // Without the window this was `clean` at t=0, so `wait` returned before Blocks had
  // said anything.
  const result = classify({ comments: [helpText], checks: PR34.checkRuns }, SECOND_REQUEST);
  assert.equal(result.state, 'requested');
  assert.equal(result.terminal, false);
});

test('#34 second request: once edited into the notice, the reply is `failed` from the comment alone', () => {
  const result = classify({ comments: [helpText, asOf(replies[1], NOTICE)], checks: PR34.checkRuns }, SECOND_REQUEST);
  assert.equal(result.state, 'failed');
  assert.equal(result.terminal, true);
  assert.equal(result.dashboardUrl, 'https://blocks.team/app/00000000-0000-4000-8000-000000000001/sessions/00000000-0000-4000-8000-000000000002');
});

test('a wait ends on the first `failed` status instead of burning its timeout', async () => {
  let polls = 0;
  const result = await waitForBlocksReview({
    timeoutMs: 600_000,
    intervalMs: 15_000,
    getStatus: async () => { polls += 1; return classify({ comments: [asOf(replies[1], NOTICE)] }, SECOND_REQUEST); },
    sleep: async () => { throw new Error('a terminal state must not sleep'); },
  });
  assert.equal(result.state, 'failed');
  assert.equal(result.timedOut, false);
  assert.equal(polls, 1);
});

test('a verdict newer than a failure notice decides; a notice newer than a verdict wins', () => {
  const notice = { id: 1, author: 'blocksorg[bot]', createdAt: '2026-09-24T07:26:01Z', body: replies[1].revisions.at(NOTICE).body };
  const verdict = { id: 2, author: 'blocksorg[bot]', createdAt: '2026-09-24T08:00:00Z', body: `Reviewed \`${HEAD.slice(0, 7)}\`. No actionable findings.` };
  assert.equal(classify({ comments: [notice, verdict] }, SECOND_REQUEST).state, 'clean');
  assert.equal(classify({ comments: [verdict, { ...notice, createdAt: '2026-09-24T08:30:00Z' }] }, SECOND_REQUEST).state, 'failed');
  // One comment that is both — a verdict with the notice appended — is a tie, and a
  // tie refuses.
  assert.equal(classify({ comments: [{ ...verdict, body: `${verdict.body}\n\n---\n\n${notice.body}` }] }, SECOND_REQUEST).state, 'failed');
});

// Every `Blocks PR Review` check run on crissmoldovan/agent-communications #1–#35,
// verbatim, labelled by reading each one. 33 are rate-limit notices and 5 are
// "Authentication failed"; every one of those 38 concluded `success`, and all 38 used
// to read as clean. 31 are real clean reviews, which must stay clean. One edit to the
// verbatim text: two example paths in the prose of two `failure`-concluded reviews
// (#1@2a51ffc, #1@f9f3488) were under a user's home directory and now sit under
// `/srv/user/`, because `verify-skills` refuses a home-directory path in any file.
// Neither run's classification depends on them.
const RUNS = JSON.parse(readFileSync(join(import.meta.dirname, 'blocks-check-runs.fixtures.json'), 'utf8'));
const stateOf = ({ check }) => classify({ checks: [check] }, new Date(Date.parse(check.started_at) - 5000).toISOString()).state;

test('no real check run that is a failure notice, or that reports a finding, reads as clean', () => {
  assert.equal(RUNS.length, 96);
  const wrong = RUNS.filter((run) => run.expected === 'not-clean' && stateOf(run) === 'clean');
  assert.deepEqual(wrong.map((run) => run.id), []);
});

test('every real failure notice among those check runs reads as `failed`', () => {
  const notices = RUNS.filter((run) => /^Claude Code: (?:Authentication failed|Rate limit or quota exceeded)\./m.test(run.check.output.summary ?? ''));
  assert.equal(notices.length, 38);
  assert.deepEqual(notices.filter((run) => stateOf(run) !== 'failed').map((run) => run.id), []);
});

test('every real check run that states its own emptiness still reads as clean', () => {
  const lost = RUNS.filter((run) => run.expected === 'clean' && stateOf(run) !== 'clean');
  assert.equal(RUNS.filter((run) => run.expected === 'clean').length, 31);
  assert.deepEqual(lost.map((run) => `${run.id}: ${stateOf(run)}`), []);
});

// agent-skills delivers its verdict ONLY as a check. These two are real clean reviews;
// the first discusses rate limits and unpaged reads at length.
const CHECK_ONLY = JSON.parse(readFileSync(join(import.meta.dirname, 'blocks-check-only-clean.fixtures.json'), 'utf8')).checkRuns;
const helpOnly = (at) => ({ id: 1, author: 'blocksorg[bot]', createdAt: at, body: helpText.body });

test('a check-only clean review stays clean and acceptable for its own commit', () => {
  for (const check of CHECK_ONLY) {
    assert.equal(failureReason(check.output.summary), null, 'a review discussing rate limits is not a notice');
    const requestedAt = new Date(Date.parse(check.started_at) - 30_000).toISOString();
    const result = classify({ comments: [helpOnly(requestedAt)], checks: [check] }, requestedAt);
    assert.equal(result.state, 'clean', check.head_sha);
    assert.equal(result.terminal, true);
    const accepted = acceptVerdict(result, { headSha: check.head_sha, ciConclusion: 'success', headCommittedAt: requestedAt });
    assert.equal(accepted.acceptable, true, accepted.reasons.join('; '));
  }
});

test('acceptance of a check-delivered verdict is bound to the commit that check ran on', () => {
  const [check] = CHECK_ONLY;
  const requestedAt = new Date(Date.parse(check.started_at) - 30_000).toISOString();
  const result = classify({ checks: [check] }, requestedAt);
  // Committed before the check finished, so dating alone would accept it.
  const accepted = acceptVerdict(result, { headSha: 'f'.repeat(40), ciConclusion: 'success', headCommittedAt: requestedAt });
  assert.equal(accepted.acceptable, false);
  assert.match(accepted.reasons.join('; '), new RegExp(`reviewed \`${check.head_sha}\``));
});

test('an acknowledgement newer than a completed clean check keeps the review open', () => {
  const [check] = CHECK_ONLY;
  const requestedAt = new Date(Date.parse(check.started_at) - 30_000).toISOString();
  const ack = { id: 2, author: 'blocksorg[bot]', createdAt: new Date(Date.parse(check.completed_at) + 60_000).toISOString(), body: replies[0].revisions.at(ACK).body };
  const result = classify({ comments: [ack], checks: [check] }, requestedAt);
  assert.equal(result.state, 'reviewing');
  assert.equal(result.terminal, false);
});

test('a Blocks check is identified by its app, not by a name containing "blocks"', () => {
  const [clean] = CHECK_ONLY;
  const requestedAt = new Date(Date.parse(clean.started_at) - 30_000).toISOString();
  const lint = { ...clean, name: 'lint-blocks', app: { slug: 'github-actions' } };
  assert.equal(isBlocksCheck(lint), false);
  assert.equal(classify({ checks: [lint] }, requestedAt).state, 'requested', 'a CI job is not a review verdict');
  assert.equal(ciFromCheckRuns([lint]), 'success', 'and it stays in the CI gate');
  assert.equal(isBlocksCheck({ name: 'Blocks PR Review' }), true, 'the exact name is the fallback when no app is given');
});

test('CI is `pending`, never success, while any repository check is still running', () => {
  const done = PR34.checkRuns.filter((run) => !isBlocksCheck(run));
  const running = [...done, { name: 'verify (windows-latest, node 24)', app: { slug: 'github-actions' }, status: 'in_progress', conclusion: null }];
  assert.equal(ciFromCheckRuns(done), 'success');
  assert.equal(ciFromCheckRuns(running), 'pending');
  const reasons = acceptVerdict({ state: 'clean', verdict: { createdAt: '2026-09-23T20:00:00Z', body: `Reviewed \`${HEAD.slice(0, 7)}\`. No actionable findings.` } }, {
    headSha: HEAD, ciConclusion: ciFromCheckRuns(running), headCommittedAt: PR34.head.committedAt,
  }).reasons;
  assert.deepEqual(reasons, ['CI on this head is still running']);
  // Blocks's own check running is the review's business, not CI's.
  assert.equal(ciFromCheckRuns([...done, { name: 'Blocks PR Review', app: { slug: 'blocksorg' }, status: 'in_progress' }]), 'success');
});

test('check runs are read on every page', async () => {
  const calls = [];
  const pages = [
    { total_count: 31, check_runs: Array.from({ length: 30 }, (_, i) => ({ name: `job ${i}`, app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success' })) },
    { total_count: 31, check_runs: [PR34.checkRuns.find(isBlocksCheck)] },
  ];
  const runGh = async (args) => {
    calls.push(args);
    if (args[0] === 'pr') return { state: 'OPEN', headRefOid: HEAD, comments: [], reviews: [] };
    return args.some((arg) => arg.includes('/check-runs')) ? pages : [];
  };
  const result = await collectBlocksStatus({ repo: PR34.repo, pr: PR34.pr, requestedAt: FIRST_REQUEST, runGh });
  const checkCall = calls.find((args) => args.some((arg) => arg.includes('/check-runs')));
  assert.ok(checkCall.includes('--paginate') && checkCall.includes('--slurp'), checkCall.join(' '));
  assert.equal(checkRunsFromPages(pages).length, 31);
  assert.equal(result.state, 'failed', 'the Blocks check on page two was read');
});
