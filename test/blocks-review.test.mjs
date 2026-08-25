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

test('collects comments, reviews, and inline comments through an injected GitHub reader', async () => {
  const calls = [];
  const read = async (kind) => {
    calls.push(kind);
    if (kind === 'pr') return { state: 'OPEN', comments: [], reviews: [], reviewRequests: [] };
    return [];
  };
  const result = await collectBlocksStatus({ repo: 'owner/repo', pr: 17, requestedAt, read });
  assert.deepEqual(calls, ['pr', 'inline']);
  assert.equal(result.state, 'requested');
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
