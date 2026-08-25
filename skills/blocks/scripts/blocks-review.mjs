import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const TERMINAL_REVIEW_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED']);
const BLOCKS_API = 'https://api.blocks.team/rest/v1';

function positive(name, value) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a finite positive number`);
}

function validateFinalMessageUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('finalMessageUrl must be a valid final-message URL'); }
  if (!['https://api.blocks.team', 'https://api.prod.blocks.team'].includes(url.origin)) throw new Error('finalMessageUrl must use an official Blocks API origin');
  if (!/^\/rest\/v1\/sessions\/[^/]+\/(?:threads\/[^/]+\/)?messages$/u.test(url.pathname)) throw new Error('finalMessageUrl must target a Blocks final-message messages endpoint');
  if (url.searchParams.get('type') !== 'final_message' || url.searchParams.get('role') !== 'assistant') throw new Error('finalMessageUrl must filter type=final_message and role=assistant');
  return url.href;
}

function combinedDeadlineSignal(timeoutMs, signal) {
  const timeoutSignal = AbortSignal.timeout(Math.ceil(timeoutMs));
  return { timeoutSignal, signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal };
}

export function resolveBlocksApiKey({ profile, env = process.env } = {}) {
  if (!profile) throw new Error('Blocks profile is required');
  const normalized = profile.toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,31}$/u.test(normalized)) throw new Error(`invalid Blocks profile: ${profile}`);
  const key = env[`BLOCKS_API_KEY_${normalized.toUpperCase()}`];
  if (!key) throw new Error(`BLOCKS_API_KEY_${normalized.toUpperCase()} is required`);
  return key;
}

async function blocksJson(url, { apiKey, fetchImpl = fetch, method = 'GET', body, signal } = {}) {
  if (!apiKey) throw new Error('BLOCKS_API_KEY is required');
  const response = await fetchImpl(url, {
    method,
    signal,
    headers: {
      Authorization: `ApiKey ${apiKey}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`Blocks API ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response.json();
}

export function createBlocksSession({ agentName, agentId, profile, message, configValues, apiKey = process.env.BLOCKS_API_KEY, fetchImpl, signal }) {
  return blocksJson(`${BLOCKS_API}/sessions`, {
    apiKey, fetchImpl, signal, method: 'POST',
    body: {
      ...(agentName ? { agent_name: agentName } : {}),
      ...(agentId ? { agent_id: agentId } : {}),
      ...(profile ? { profile } : {}),
      ...(configValues ? { config_values: configValues } : {}),
      message,
    },
  });
}

export function getBlocksSession({ sessionId, apiKey = process.env.BLOCKS_API_KEY, fetchImpl, signal }) {
  return blocksJson(`${BLOCKS_API}/sessions/${encodeURIComponent(sessionId)}`, { apiKey, fetchImpl, signal });
}

export function sendBlocksFollowUp({ sessionId, message, apiKey = process.env.BLOCKS_API_KEY, fetchImpl, signal }) {
  return blocksJson(`${BLOCKS_API}/sessions/${encodeURIComponent(sessionId)}/messages`, {
    apiKey, fetchImpl, signal, method: 'POST', body: { message },
  });
}

export async function waitForBlocksFinalMessage({ finalMessageUrl, apiKey = process.env.BLOCKS_API_KEY, fetchImpl, timeoutMs = 60_000, intervalMs = 5_000, signal, now = Date.now, sleep }) {
  positive('timeoutMs', timeoutMs);
  positive('intervalMs', intervalMs);
  const finalUrl = validateFinalMessageUrl(finalMessageUrl);
  const started = now();
  const deadline = started + timeoutMs;
  const deadlineSignals = combinedDeadlineSignal(timeoutMs, signal);
  const pause = sleep ?? ((ms) => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason ?? new Error('aborted')); }, { once: true });
  }));
  let current;
  while (true) {
    if (signal?.aborted) throw signal.reason ?? new Error('aborted');
    try {
      current = await blocksJson(finalUrl, { apiKey, fetchImpl, signal: deadlineSignals.signal });
    } catch (error) {
      if (deadlineSignals.timeoutSignal.aborted && !signal?.aborted) return { message: null, current: current ?? null, timedOut: true };
      throw error;
    }
    if (current.items?.length) return { message: current.items[0], current, timedOut: false };
    const remaining = deadline - now();
    if (remaining <= 0) return { message: null, current, timedOut: true };
    await pause(Math.min(intervalMs, remaining));
  }
}

function timestamp(item) {
  return Date.parse(item.submittedAt ?? item.createdAt ?? 0);
}

function isBlocks(item) {
  return /^blocks(?:org)?(?:\[bot\])?$/i.test(item.author ?? item.user?.login ?? '');
}

function severity(body = '') {
  const explicit = body.match(/severity\s*[:=-]?\s*(\d{1,2})/i);
  if (explicit) return Math.min(10, Number(explicit[1]));
  if (/critical|blocker|security|data loss/i.test(body)) return 9;
  if (/\bhigh\b|correctness|crash|broken contract/i.test(body)) return 7;
  if (/\bmedium\b|refactor|quality/i.test(body)) return 5;
  return 3;
}

function dashboard(body = '') {
  return body.match(/https:\/\/blocks\.team\/[^\s)]+\/sessions\/[^\s)]+/i)?.[0] ?? null;
}

function isCourtesy(body = '') {
  return /taking a look|queued|review in progress|running analysis|may take a few minutes|mention blocks like a regular teammate/i.test(body);
}

function isClean(body = '') {
  return /reviewed .*(?:end to end|pull request)|no actionable findings|no findings|\blgtm\b|looks good/i.test(body)
    && /no actionable findings|no findings|\blgtm\b|looks good|left no inline comments/i.test(body);
}

export function classifyBlocksEvidence({ comments = [], reviews = [], inline = [], prState = 'OPEN' }, { requestedAt, baselineIds = {} }) {
  const baseline = Date.parse(requestedAt ?? 0);
  const after = (kind) => (item) => isBlocks(item) && timestamp(item) >= baseline && !(baselineIds[kind] ?? []).map(String).includes(String(item.id));
  const relevantComments = comments.filter(after('comments'));
  const relevantReviews = reviews.filter(after('reviews'));
  const relevantInline = inline.filter(after('inline'));
  const findings = relevantInline.map((item) => ({
    id: item.id,
    severity: severity(item.body),
    path: item.path ?? null,
    line: item.line ?? null,
    body: item.body ?? '',
    url: item.url ?? item.htmlUrl ?? null,
  }));
  const summaryFindingReviews = relevantReviews.filter((item) => ['CHANGES_REQUESTED'].includes((item.state ?? '').toUpperCase()) || (/\S/.test(item.body ?? '') && /issue|finding|severity|requesting changes/i.test(item.body)));
  const cleanComment = relevantComments.find((item) => isClean(item.body));
  const cleanReview = relevantReviews.find((item) => isClean(item.body) || (item.state ?? '').toUpperCase() === 'APPROVED');
  const dashboardUrl = [...relevantComments, ...relevantReviews].map((item) => dashboard(item.body)).find(Boolean) ?? null;

  if (findings.length || summaryFindingReviews.length) {
    return { state: 'findings', terminal: true, prState, findings, comments: relevantComments, reviews: relevantReviews, dashboardUrl };
  }
  if (cleanComment || cleanReview) {
    return { state: 'clean', terminal: true, prState, findings: [], comments: relevantComments, reviews: relevantReviews, dashboardUrl };
  }
  if (relevantComments.some((item) => isCourtesy(item.body)) || relevantReviews.length) {
    return { state: 'reviewing', terminal: false, prState, findings: [], comments: relevantComments, reviews: relevantReviews, dashboardUrl };
  }
  if (prState !== 'OPEN') {
    return { state: 'pr_closed', terminal: true, prState, findings: [], comments: relevantComments, reviews: relevantReviews, dashboardUrl };
  }
  return { state: 'requested', terminal: false, prState, findings: [], comments: relevantComments, reviews: relevantReviews, dashboardUrl };
}

async function ghJson(args) {
  const { stdout } = await execFileAsync('gh', args, { encoding: 'utf8' });
  return JSON.parse(stdout);
}

export async function collectBlocksStatus({ repo, pr, requestedAt, baselineIds, read, runGh = ghJson }) {
  const reader = read ?? (async (kind) => {
    if (kind === 'pr') return runGh(['pr', 'view', String(pr), '--repo', repo, '--json', 'state,comments,reviews,reviewRequests']);
    const pages = await runGh(['api', `repos/${repo}/pulls/${pr}/comments`, '--paginate', '--slurp', '-f', 'per_page=100']);
    return Array.isArray(pages?.[0]) ? pages.flat() : pages;
  });
  const prData = await reader('pr');
  const inlineRaw = await reader('inline');
  const normalize = (item) => ({
    ...item,
    author: item.author?.login ?? item.author ?? item.user?.login,
    createdAt: item.createdAt ?? item.created_at,
    submittedAt: item.submittedAt ?? item.submitted_at,
    htmlUrl: item.htmlUrl ?? item.html_url,
  });
  return classifyBlocksEvidence({
    prState: prData.state,
    comments: (prData.comments ?? []).map(normalize),
    reviews: (prData.reviews ?? []).map(normalize),
    inline: (inlineRaw ?? []).map(normalize),
  }, { requestedAt, baselineIds });
}

export async function waitForBlocksReview({ getStatus, timeoutMs = 60_000, intervalMs = 10_000, signal, now = Date.now, sleep }) {
  positive('timeoutMs', timeoutMs);
  positive('intervalMs', intervalMs);
  const started = now();
  const deadline = started + timeoutMs;
  const deadlineSignals = combinedDeadlineSignal(timeoutMs, signal);
  const pause = sleep ?? ((ms) => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason ?? new Error('aborted')); }, { once: true });
  }));
  let current;
  try { current = await getStatus({ signal: deadlineSignals.signal }); }
  catch (error) {
    if (deadlineSignals.timeoutSignal.aborted && !signal?.aborted) return { state: 'requested', terminal: false, timedOut: true };
    throw error;
  }
  while (!current.terminal) {
    if (signal?.aborted) throw signal.reason ?? new Error('aborted');
    const remaining = deadline - now();
    if (remaining <= 0) return { ...current, timedOut: true };
    await pause(Math.min(intervalMs, remaining));
    try { current = await getStatus({ signal: deadlineSignals.signal }); }
    catch (error) {
      if (deadlineSignals.timeoutSignal.aborted && !signal?.aborted) return { ...current, timedOut: true };
      throw error;
    }
  }
  return { ...current, timedOut: false };
}
