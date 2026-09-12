import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyBlocksEvidence,
  collectBlocksStatus,
  createBlocksSession,
  getBlocksSession,
  parseBlocksWorkspaceId,
  resolveBlocksApiKey,
  resolveBlocksWorkspace,
  sendBlocksFollowUp,
  waitForBlocksFinalMessage,
  waitForBlocksReview,
} from '../skills/blocks/scripts/blocks-review.mjs';

const requestedAt = '2026-08-24T23:44:13Z';

function snapshot({ comments = [], reviews = [], inline = [] } = {}) {
  return { comments, reviews, inline };
}

test('distinguishes integration help and courtesy messages from a real review', () => {
  const result = classifyBlocksEvidence(snapshot({ comments: [
    { id: 1, author: 'blocksorg', createdAt: '2026-08-24T23:00:00Z', body: 'Mention Blocks like a regular teammate' },
    { id: 2, author: 'blocksorg', createdAt: '2026-08-24T23:44:15Z', body: "I'm taking a look. Review in progress." },
  ] }), { requestedAt });

  assert.equal(result.state, 'reviewing');
  assert.equal(result.terminal, false);
  assert.equal(result.findings.length, 0);
});

test('recognizes a clean terminal Blocks summary comment', () => {
  const result = classifyBlocksEvidence(snapshot({ comments: [{
    id: 3,
    author: 'blocksorg',
    createdAt: '2026-08-24T23:44:17Z',
    body: 'Reviewed PR #17 end to end. No actionable findings at severity ≥7, so I left no inline comments.\n\n[View on dashboard](https://blocks.team/app/workspace/sessions/session-id)',
  }] }), { requestedAt });

  assert.equal(result.state, 'clean');
  assert.equal(result.terminal, true);
  assert.equal(result.dashboardUrl, 'https://blocks.team/app/workspace/sessions/session-id');
});

test('recognizes real reviews and inline findings without treating courtesy as completion', () => {
  const result = classifyBlocksEvidence(snapshot({
    reviews: [{ id: 4, author: 'blocksorg', submittedAt: '2026-08-24T23:45:00Z', state: 'CHANGES_REQUESTED', body: 'Two correctness issues found.' }],
    inline: [{ id: 5, author: 'blocksorg', createdAt: '2026-08-24T23:45:01Z', path: 'src/a.ts', line: 42, body: '**Severity: 8** Null state can crash.' }],
  }), { requestedAt });

  assert.equal(result.state, 'findings');
  assert.equal(result.terminal, true);
  assert.deepEqual(result.findings.map(({ severity, path, line }) => ({ severity, path, line })), [
    { severity: 8, path: 'src/a.ts', line: 42 },
  ]);
});

// Blocks posts verdicts as top-level comments as well as formal reviews. Each body
// below is the shape of a verdict observed on a real pull request.
test('a re-review verdict comment reporting a fixed finding is terminal and clean', () => {
  const result = classifyBlocksEvidence(snapshot({ comments: [{
    id: 10,
    author: 'blocksorg',
    createdAt: '2026-08-24T23:50:00Z',
    body: 'Re-review complete: the unchecked null dereference in src/a.ts is fixed. Nothing else to flag.',
  }] }), { requestedAt });

  assert.equal(result.state, 'clean');
  assert.equal(result.terminal, true);
  assert.equal(result.findings.length, 0);
});

test('a "Reviewed PR" verdict comment without a summary review is terminal and clean', () => {
  const result = classifyBlocksEvidence(snapshot({ comments: [{
    id: 11,
    author: 'blocksorg',
    createdAt: '2026-08-24T23:50:00Z',
    body: 'Reviewed PR #42. No actionable findings at severity ≥ 7.',
  }] }), { requestedAt });

  assert.equal(result.state, 'clean');
  assert.equal(result.terminal, true);
});

// Observed on cueplusplus/cue-ui#89: a verb-first completion claim the old regex
// missed entirely. It only matched the adjective "review complete" (or "review is
// complete") and the literal word "reviewed" — "Review completed for PR" satisfies
// neither, so the verdict never registered as a verdict at all, and a caller polling
// `status`/`wait` saw `requested` forever for a review that had already finished
// clean in four seconds.
test('a verb-first "Review completed" comment stating its own emptiness is clean — cue-ui PR #89', () => {
  const result = classifyBlocksEvidence(snapshot({ comments: [{
    id: 22,
    author: 'blocksorg',
    createdAt: '2026-08-24T23:50:00Z',
    body: 'Review completed for PR #89 on `feat/authored-presets` (`b863bf72`).\n\nNo actionable issues (severity ≥7) found, so I left no PR comments. I also found no existing review feedback to duplicate.\n\nNote: targeted tests could not run locally because the clone has no `node_modules` (`vitest` unavailable); static diff checks otherwise passed aside from a trailing blank line in a planning document.\n\n**[View on dashboard](https://blocks.team/app/…/sessions/…)**',
  }] }), { requestedAt });

  assert.equal(result.state, 'clean');
  assert.equal(result.terminal, true);
});

test('"Review completed" counting actionable issues is terminal findings, not clean', () => {
  const result = classifyBlocksEvidence(snapshot({ comments: [{
    id: 23,
    author: 'blocksorg',
    createdAt: '2026-08-24T23:50:00Z',
    body: 'Review completed for PR #90 on `feat/y` (`abcdef1`).\n\n2 actionable issues (severity ≥7) found; see the inline comments below.',
  }] }), { requestedAt });

  assert.equal(result.state, 'findings');
  assert.equal(result.terminal, true);
});

// The completion claim still has to survive the same partial-pass veto as every
// other phrasing: making the claim and then withdrawing it stays nonterminal.
test('"Review completed ... I need another pass" is a partial pass, not a finished verdict', () => {
  const result = classifyBlocksEvidence(snapshot({ comments: [{
    id: 24,
    author: 'blocksorg',
    createdAt: '2026-08-24T23:50:00Z',
    body: 'Review completed for PR #91 on `feat/z` (`fedcba9`). I need another pass over the retry path before I can call this done.',
  }] }), { requestedAt });

  assert.equal(result.terminal, false);
});

// Observed on cueplusplus/cue-ui#94: a clean verdict whose closing note disclaimed a
// defect — "this was an environment setup issue, not a test failure". The negation
// covers only "a test failure"; the counted-mention check read "an environment setup
// issue" as one issue outstanding, and a review that had just said "No actionable
// issues" was reported as findings. The disclaimed half is set aside only when its
// clause denies a defect AND it names the reviewer's own sandbox, so each case below
// pins one side of that.
const PR94_VERDICT = 'Reviewed PR #94 at head `8b08c61`.\n\nNo actionable issues (severity ≥7) found, so I left no inline comments. The effective diff is clean and all current CI/Vercel checks pass.\n\nIndependent targeted tests were blocked by missing generated workspace build artifacts in the fresh clone; this was an environment setup issue, not a test failure.\n\n**[View on dashboard](https://blocks.team/app/dd73b09d-4599-4160-a58c-8d17b0023108/sessions/932dc84b-a003-4cc1-b471-1a1840487cbd)**';

function verdictState(id, body) {
  return classifyBlocksEvidence(snapshot({ comments: [{ id, author: 'blocksorg', createdAt: '2026-08-24T23:50:00Z', body }] }), { requestedAt });
}

test('a clean verdict disclaiming its own sandbox as "not a test failure" is clean — cue-ui PR #94', () => {
  const result = verdictState(25, PR94_VERDICT);
  assert.equal(result.state, 'clean');
  assert.equal(result.terminal, true);
});

test('a genuine test failure beside the same disclaimer is still findings', () => {
  const result = verdictState(26, 'Reviewed PR #95 at head `1a2b3c4`.\n\nNo actionable issues (severity ≥7) found in the diff, so I left no inline comments. One test failure remains on this head: the retry suite times out after the backoff change.\n\nThe snapshot mismatch in the fresh clone was an environment setup issue, not a test failure.');
  assert.equal(result.state, 'findings');
});

test('"not a test failure but a real bug" negates the failure and reports the bug', () => {
  const result = verdictState(27, 'Reviewed PR #96 at head `2b3c4d5`.\n\nNo other actionable issues (severity ≥7) found. The red retry check is not a test failure but a real bug: the backoff helper resets its counter on every attempt, so the retry budget is never spent.');
  assert.equal(result.state, 'findings');
});

test('a clean verdict whose only failures are negated stays clean', () => {
  for (const [id, body] of [
    [28, 'Reviewed PR #98 at head `3c4d5e6`.\n\nNo actionable issues (severity ≥7) found, so I left no inline comments. The red check on the previous head was not a failure — the push cancelled that run — and CI on this head reports no failures.'],
    [29, 'Reviewed PR #101 at head `6f7a8b9`.\n\nNo actionable issues (severity ≥7) found, so I left no inline comments. The timeout in the snapshot suite was not a test failure but a sandbox issue: the fresh clone had no network access.'],
  ]) assert.equal(verdictState(id, body).state, 'clean', body);
});

test('a disclaimer is not a disclaimer when its sentence ties the problem to the change', () => {
  const tied = verdictState(30, 'Reviewed PR #99 at head `4d5e6f7`.\n\nNo actionable issues (severity ≥7) found. `scripts/bootstrap.sh` in this PR drops the PATH export, so the suite could not start; this was an environment setup issue, not a test failure.');
  assert.equal(tied.state, 'findings');
  // "Environment" modifying code the PR can break is not the reviewer's sandbox.
  const code = verdictState(31, 'Reviewed PR #100 at head `5e6f7a8`.\n\nNo actionable issues (severity ≥7) found in the documentation. The flaky suite is an environment variable parsing bug, not a test failure.');
  assert.equal(code.state, 'findings');
});

test('"no test failures" is not a clean verdict on its own — clean is still earned', () => {
  // Failures now count as outstanding work, but their negation is a statement about
  // CI, not about what the review found, so it must not satisfy the emptiness test.
  const result = verdictState(32, 'Reviewed PR #102 at head `7a8b9c0`. CI reports no test failures.');
  assert.equal(result.state, 'findings');
});

test('the inversion still reads as findings: "zero of these findings have been addressed"', () => {
  const result = verdictState(33, 'Reviewed PR #58 at `4f0aa11`.\n\nZero of these findings have been addressed, and this was not a test failure.');
  assert.equal(result.state, 'findings');
});

test('a verdict comment counting inline findings is terminal findings', () => {
  const result = classifyBlocksEvidence(snapshot({ comments: [{
    id: 12,
    author: 'blocksorg',
    createdAt: '2026-08-24T23:50:00Z',
    body: 'Review complete. I left two inline findings on this pull request.',
  }] }), { requestedAt });

  assert.equal(result.state, 'findings');
  assert.equal(result.terminal, true);
});

test('a bare verdict comment defers to inline comments left since the baseline', () => {
  const result = classifyBlocksEvidence(snapshot({
    comments: [{ id: 13, author: 'blocksorg', createdAt: '2026-08-24T23:50:00Z', body: 'Review complete.' }],
    inline: [{ id: 14, author: 'blocksorg', createdAt: '2026-08-24T23:50:01Z', path: 'src/b.ts', line: 7, body: '**Severity: 7** Unhandled rejection.' }],
  }), { requestedAt });

  assert.equal(result.state, 'findings');
  assert.equal(result.terminal, true);
  assert.deepEqual(result.findings.map(({ path, line }) => ({ path, line })), [{ path: 'src/b.ts', line: 7 }]);
});

test('an acknowledgement of the review request is never a verdict', () => {
  const result = classifyBlocksEvidence(snapshot({ comments: [{
    id: 15,
    author: 'blocksorg',
    createdAt: '2026-08-24T23:44:20Z',
    body: "I'm working on this request and will report back here.",
  }] }), { requestedAt });

  assert.equal(result.terminal, false);
  assert.equal(result.findings.length, 0);
});

test('help text quoting the words of a finished review stays nonterminal', () => {
  const result = classifyBlocksEvidence(snapshot({ comments: [{
    id: 16,
    author: 'blocksorg',
    createdAt: '2026-08-24T23:44:20Z',
    body: 'Mention Blocks like a regular teammate. I post a "Review complete" comment when I am done.',
  }] }), { requestedAt });

  assert.equal(result.state, 'reviewing');
  assert.equal(result.terminal, false);
});

test('a verdict comment is only evidence when Blocks posted it after the baseline', () => {
  const body = 'Review complete. I left two inline findings on this pull request.';
  const stale = classifyBlocksEvidence(snapshot({ comments: [
    { id: 17, author: 'blocksorg', createdAt: '2026-08-24T22:00:00Z', body },
  ] }), { requestedAt });
  const human = classifyBlocksEvidence(snapshot({ comments: [
    { id: 18, author: 'maintainer', createdAt: '2026-08-24T23:50:00Z', body },
  ] }), { requestedAt });

  assert.equal(stale.terminal, false);
  assert.equal(human.terminal, false);
});

// However much attribution a re-review puts between the findings it names and the
// verb that clears them, the verdict is still clean.
test('a clean re-review survives a long attribution before its resolving verb', () => {
  const result = classifyBlocksEvidence(snapshot({ comments: [{
    id: 19,
    author: 'blocksorg',
    createdAt: '2026-08-24T23:50:00Z',
    body: 'Re-review complete. The critical findings in the authentication and session management modules are now resolved.',
  }] }), { requestedAt });

  assert.equal(result.state, 'clean');
  assert.equal(result.terminal, true);
});

test('a clean re-review survives an attribution listing every module it touched', () => {
  const result = classifyBlocksEvidence(snapshot({ comments: [{
    id: 20,
    author: 'blocksorg',
    createdAt: '2026-08-24T23:50:00Z',
    body: 'Re-review complete. The three high-severity findings in the authentication middleware, the session management store, and the refresh-token rotation path have been addressed.',
  }] }), { requestedAt });

  assert.equal(result.state, 'clean');
  assert.equal(result.terminal, true);
});

test('a verdict resolving one finding while leaving others keeps reporting findings', () => {
  const result = classifyBlocksEvidence(snapshot({ comments: [{
    id: 21,
    author: 'blocksorg',
    createdAt: '2026-08-24T23:50:00Z',
    body: 'Review complete. I left two new inline findings in the retry path and the token refresh helper, but the null dereference from the last round is fixed.',
  }] }), { requestedAt });

  assert.equal(result.state, 'findings');
  assert.equal(result.terminal, true);
});

test('ignores Blocks evidence older than the request baseline', () => {
  const result = classifyBlocksEvidence(snapshot({ comments: [{
    id: 6,
    author: 'blocksorg',
    createdAt: '2026-08-24T22:00:00Z',
    body: 'Reviewed PR #16. No actionable findings.',
  }] }), { requestedAt });

  assert.equal(result.state, 'requested');
  assert.equal(result.terminal, false);
});

test('baseline IDs exclude pre-existing evidence at the same timestamp', () => {
  const result = classifyBlocksEvidence(snapshot({ comments: [{
    id: 'old-comment', author: 'blocksorg', createdAt: requestedAt,
    body: 'Reviewed PR. No actionable findings.',
  }] }), { requestedAt, baselineIds: { comments: ['old-comment'] } });
  assert.equal(result.state, 'requested');
});

test('collects comments, reviews, inline comments and checks through an injected GitHub reader', async () => {
  // `checks` is the third channel and it is not optional. Which one a finished
  // review arrives on depends on how the integration is configured: one repository
  // gets a summary comment naming the head, another gets only help text and a
  // `Blocks PR Review` check. Reading comments alone left a completed, clean,
  // zero-finding review looking like `reviewing` forever.
  const calls = [];
  const read = async (kind) => {
    calls.push(kind);
    if (kind === 'pr') return { state: 'OPEN', comments: [], reviews: [], reviewRequests: [] };
    return [];
  };
  const result = await collectBlocksStatus({ repo: 'owner/repo', pr: 17, requestedAt, read });
  assert.deepEqual(calls, ['pr', 'inline', 'checks']);
  assert.equal(result.state, 'requested');
});

test('a completed Blocks check is terminal when nothing else reported anything', async () => {
  const read = async (kind) => {
    if (kind === 'pr') return { state: 'OPEN', comments: [], reviews: [], reviewRequests: [] };
    if (kind === 'checks') return [{ name: 'Blocks PR Review', status: 'completed', conclusion: 'success' }];
    return [];
  };
  const result = await collectBlocksStatus({ repo: 'owner/repo', pr: 17, requestedAt, read });
  assert.equal(result.state, 'clean');
  assert.equal(result.terminal, true);
});

test('a Blocks check still running is not terminal', async () => {
  const read = async (kind) => {
    if (kind === 'pr') return { state: 'OPEN', comments: [], reviews: [], reviewRequests: [] };
    if (kind === 'checks') return [{ name: 'Blocks PR Review', status: 'in_progress', conclusion: null }];
    return [];
  };
  const result = await collectBlocksStatus({ repo: 'owner/repo', pr: 17, requestedAt, read });
  assert.equal(result.terminal, false);
});

test('a check that completed without succeeding is not an all-clear', async () => {
  // The false clean this whole gate exists to prevent. A check can finish badly —
  // the review that found this bug concluded `action_required` — and reading that as
  // "nothing to report" infers an all-clear from silence. Its own findings may not
  // have been posted at all, which is exactly when a network error would strand them.
  for (const conclusion of ['failure', 'action_required', 'cancelled', 'timed_out']) {
    const read = async (kind) => {
      if (kind === 'pr') return { state: 'OPEN', comments: [], reviews: [], reviewRequests: [] };
      if (kind === 'checks') return [{ name: 'Blocks PR Review', status: 'completed', conclusion }];
      return [];
    };
    const result = await collectBlocksStatus({ repo: 'owner/repo', pr: 17, requestedAt, read });
    assert.notEqual(result.state, 'clean', conclusion);
    assert.equal(result.terminal, false, conclusion);
  }
});

test('neutral and skipped conclusions still count as a finished, empty review', async () => {
  for (const conclusion of ['success', 'neutral', 'skipped']) {
    const read = async (kind) => {
      if (kind === 'pr') return { state: 'OPEN', comments: [], reviews: [], reviewRequests: [] };
      if (kind === 'checks') return [{ name: 'Blocks PR Review', status: 'completed', conclusion }];
      return [];
    };
    const result = await collectBlocksStatus({ repo: 'owner/repo', pr: 17, requestedAt, read });
    assert.equal(result.state, 'clean', conclusion);
  }
});

test('a completed check does not overrule inline findings', async () => {
  // The check says the review FINISHED, never that it was clean. What it found is
  // still decided by the findings, or a false clean would merge on a green check.
  const read = async (kind) => {
    if (kind === 'pr') return { state: 'OPEN', comments: [], reviews: [], reviewRequests: [] };
    if (kind === 'checks') return [{ name: 'Blocks PR Review', status: 'completed', conclusion: 'success' }];
    return [{ id: 9, user: { login: 'blocksorg' }, created_at: '2026-08-24T23:50:00Z', path: 'a.ts', line: 3, body: 'Severity 8/10 — unbounded retry.' }];
  };
  const result = await collectBlocksStatus({ repo: 'owner/repo', pr: 17, requestedAt, read });
  assert.equal(result.state, 'findings');
});

test('default GitHub inline collection requests every page', async () => {
  const calls = [];
  const runGh = async (args) => {
    calls.push(args);
    return args[0] === 'pr' ? { state: 'OPEN', comments: [], reviews: [] } : [];
  };
  await collectBlocksStatus({ repo: 'owner/repo', pr: 17, requestedAt, runGh });
  assert.deepEqual(calls[1], [
    'api',
    '--method',
    'GET',
    'repos/owner/repo/pulls/17/comments?per_page=100',
    '--paginate',
    '--slurp',
  ]);
});

test('active wait returns immediately on terminal evidence', async () => {
  let reads = 0;
  const statuses = [
    { state: 'reviewing', terminal: false },
    { state: 'clean', terminal: true },
  ];
  const result = await waitForBlocksReview({
    getStatus: async () => statuses[Math.min(reads++, statuses.length - 1)],
    timeoutMs: 1_000,
    intervalMs: 1,
    sleep: async () => {},
  });
  assert.equal(result.state, 'clean');
  assert.equal(reads, 2);
});

test('active wait returns the current nonterminal state on timeout', async () => {
  let now = 0;
  const result = await waitForBlocksReview({
    getStatus: async () => ({ state: 'reviewing', terminal: false }),
    timeoutMs: 10,
    intervalMs: 5,
    now: () => (now += 6),
    sleep: async () => {},
  });
  assert.equal(result.state, 'reviewing');
  assert.equal(result.timedOut, true);
});

test('creates, inspects, and follows up on official Blocks REST sessions', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (init.method === 'POST' && url.endsWith('/sessions')) return response({
      id: 'session-1',
      session_html_url: 'https://blocks.team/app/sessions/session-1',
      _links: { final_message: { href: 'https://api.blocks.team/rest/v1/sessions/session-1/threads/thread-1/messages?type=final_message&role=assistant' } },
    });
    if (init.method === 'POST') return response({
      chat_thread_id: 'thread-2',
      _links: { final_message: { href: 'https://api.blocks.team/rest/v1/sessions/session-1/threads/thread-2/messages?type=final_message&role=assistant' } },
    });
    return response({ id: 'session-1', title: 'Review', _links: { messages: { href: 'https://api.blocks.team/rest/v1/sessions/session-1/messages' } } });
  };
  const options = { apiKey: 'example-key', fetchImpl };
  const created = await createBlocksSession({ agentName: 'claude', message: 'Review this.', ...options });
  const inspected = await getBlocksSession({ sessionId: 'session-1', ...options });
  const followed = await sendBlocksFollowUp({ sessionId: 'session-1', message: 'Any update?', ...options });
  assert.equal(created.id, 'session-1');
  assert.equal(inspected.title, 'Review');
  assert.equal(followed.chat_thread_id, 'thread-2');
  assert.ok(calls.every(({ init }) => init.headers.Authorization === 'ApiKey example-key'));
});

test('official REST wait polls the opaque final-message link and returns terminal output', async () => {
  let reads = 0;
  const fetchImpl = async () => response(reads++ ? {
    items: [{ id: 'final-1', type: 'final_message', role: 'assistant', message: 'Review complete.' }],
  } : { items: [] });
  const result = await waitForBlocksFinalMessage({
    finalMessageUrl: 'https://api.blocks.team/rest/v1/sessions/session-1/threads/thread-1/messages?type=final_message&role=assistant',
    apiKey: 'example-key',
    fetchImpl,
    timeoutMs: 1_000,
    intervalMs: 1,
    sleep: async () => {},
  });
  assert.equal(result.message.message, 'Review complete.');
  assert.equal(result.timedOut, false);
});

test('official REST wait returns empty current state on timeout', async () => {
  let now = 0;
  const result = await waitForBlocksFinalMessage({
    finalMessageUrl: 'https://api.blocks.team/rest/v1/sessions/session-1/messages?type=final_message&role=assistant',
    apiKey: 'example-key',
    fetchImpl: async () => response({ items: [], _links: { new_messages: { href: 'https://api.blocks.team/next' } } }),
    timeoutMs: 10,
    intervalMs: 5,
    now: () => (now += 6),
    sleep: async () => {},
  });
  assert.equal(result.message, null);
  assert.equal(result.timedOut, true);
  assert.equal(result.current._links.new_messages.href, 'https://api.blocks.team/next');
});

test('REST wait reports visible progress while the final message is pending', async () => {
  let reads = 0;
  const progress = [];
  const result = await waitForBlocksFinalMessage({
    finalMessageUrl: 'https://api.blocks.team/rest/v1/sessions/s/threads/t/messages?type=final_message&role=assistant',
    apiKey: 'example-key',
    fetchImpl: async () => response(reads++ ? {
      items: [{ type: 'final_message', role: 'assistant', message: 'Done.' }],
    } : { items: [] }),
    timeoutMs: 1_000,
    intervalMs: 1,
    sleep: async () => {},
    onProgress: (event) => progress.push(event),
  });
  assert.equal(result.message.message, 'Done.');
  assert.deepEqual(progress.map((event) => event.state), ['waiting', 'completed']);
  assert.ok(progress[0].elapsedMs >= 0);
});

test('rejects a non-final-message Blocks URL', async () => {
  await assert.rejects(waitForBlocksFinalMessage({
    finalMessageUrl: 'https://api.blocks.team/rest/v1/sessions/session-1/messages',
    apiKey: 'example-key', fetchImpl: async () => response({ items: [] }),
  }), /final[_-]message/i);
});

test('validates finite positive wait settings', async () => {
  await assert.rejects(waitForBlocksReview({ getStatus: async () => ({}), timeoutMs: 0 }), /timeoutMs/);
  await assert.rejects(waitForBlocksFinalMessage({
    finalMessageUrl: 'https://api.blocks.team/rest/v1/sessions/s/threads/t/messages?type=final_message&role=assistant',
    apiKey: 'example-key', timeoutMs: 10, intervalMs: Number.NaN,
  }), /intervalMs/);
});

test('caller cancellation aborts a pending REST wait', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled by caller'));
  await assert.rejects(waitForBlocksFinalMessage({
    finalMessageUrl: 'https://api.blocks.team/rest/v1/sessions/s/threads/t/messages?type=final_message&role=assistant',
    apiKey: 'example-key', signal: controller.signal,
    fetchImpl: async () => response({ items: [] }),
  }), /cancelled by caller/);
});

test('closed PR is a terminal review state', () => {
  const result = classifyBlocksEvidence({ prState: 'CLOSED' }, { requestedAt });
  assert.equal(result.state, 'pr_closed');
  assert.equal(result.terminal, true);
});

test('rejects non-HTTPS, wrong-origin, and wrong-path final-message URLs', async () => {
  for (const finalMessageUrl of [
    'http://api.blocks.team/rest/v1/sessions/s/threads/t/messages?type=final_message&role=assistant',
    'https://evil.example/rest/v1/sessions/s/threads/t/messages?type=final_message&role=assistant',
    'https://api.blocks.team/rest/v1/sessions/s?type=final_message&role=assistant',
  ]) {
    await assert.rejects(waitForBlocksFinalMessage({ finalMessageUrl, apiKey: 'example-key' }), /Blocks|finalMessageUrl/);
  }
});

test('resolves arbitrary named workspace keys without product-specific names', () => {
  const env = {
    BLOCKS_API_KEY_ACME: 'acme-example-key',
    BLOCKS_API_KEY_CLIENT_B: 'client-example-key',
  };
  assert.equal(resolveBlocksApiKey({ profile: 'acme', env }), 'acme-example-key');
  assert.equal(resolveBlocksApiKey({ profile: 'client_b', env }), 'client-example-key');
  assert.throws(() => resolveBlocksApiKey({ env }), /profile is required/i);
  assert.throws(() => resolveBlocksApiKey({ profile: '../other', env }), /invalid Blocks profile/i);
});

test('parses a workspace ID from Blocks workspace and settings URLs', () => {
  const id = 'dcd858f1-c0d8-4e86-a42d-3d847c428862';
  assert.equal(parseBlocksWorkspaceId(`https://www.blocks.team/app/${id}/settings/api-keys`), id);
  assert.equal(parseBlocksWorkspaceId(`https://blocks.team/app/${id}/sessions/session-id`), id);
  assert.equal(parseBlocksWorkspaceId('https://blocks.team/settings'), null);
});

test('resolves workspace profile by repository and refuses ambiguous or unknown context', () => {
  const workspaces = [
    { id: '11111111-1111-4111-8111-111111111111', profile: 'personal', repositories: ['owner/public-pack'] },
    { id: '22222222-2222-4222-8222-222222222222', profile: 'client', repositories: ['client/app'] },
  ];
  assert.equal(resolveBlocksWorkspace({ repo: 'client/app', workspaces }).profile, 'client');
  assert.throws(() => resolveBlocksWorkspace({ repo: 'unknown/repo', workspaces }), /workspace.*not known/i);
  assert.throws(() => resolveBlocksWorkspace({ workspaces }), /confirm.*workspace/i);
});

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}
