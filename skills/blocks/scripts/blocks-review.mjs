import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
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

export function parseBlocksWorkspaceId(value) {
  if (!value) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!['blocks.team', 'www.blocks.team'].includes(url.hostname)) return null;
  const match = url.pathname.match(/^\/app\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\/|$)/iu);
  return match?.[1] ?? null;
}

export function resolveBlocksWorkspace({ repo, workspaceId, workspaceUrl, workspaces = [] } = {}) {
  const parsedId = workspaceId ?? parseBlocksWorkspaceId(workspaceUrl);
  const byId = parsedId ? workspaces.filter((workspace) => workspace.id === parsedId) : [];
  const byRepo = repo ? workspaces.filter((workspace) => (workspace.repositories ?? []).includes(repo)) : [];
  const matches = byId.length ? byId : byRepo;
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error('Multiple Blocks workspaces match; ask the user to confirm the workspace ID or URL');
  if (repo) throw new Error(`Blocks workspace is not known for repository ${repo}; ask the user to confirm a workspace URL or ID`);
  throw new Error('Cannot infer the Blocks workspace; ask the user to confirm a workspace URL or ID');
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

export async function waitForBlocksFinalMessage({ finalMessageUrl, apiKey = process.env.BLOCKS_API_KEY, fetchImpl, timeoutMs = 60_000, intervalMs = 5_000, signal, now = Date.now, sleep, onProgress = () => {} }) {
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
    if (current.items?.length) {
      await onProgress({ state: 'completed', elapsedMs: Math.max(0, now() - started), message: current.items[0] });
      return { message: current.items[0], current, timedOut: false };
    }
    await onProgress({ state: 'waiting', elapsedMs: Math.max(0, now() - started), message: null });
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

/** The nouns this bot uses for one unit of outstanding work. */
const NOUN = String.raw`(?:findings?|inline\s+comments?|issues?|blockers?|problems?|defects?|bugs?)`;
const re = (source, flags = 'i') => new RegExp(source, flags);

// Acknowledgement, progress, or onboarding text: the review has not finished.
//
// Deliberately narrow, and narrower than it was. "queued" and "may take a few
// minutes" used to live here and had to go: a finished verdict says them about
// somebody else's CI job — "the preview deployment queued at push time finished" —
// and demoting a real verdict to nonterminal burns a waiting loop's whole timeout.
// What stays is language a comment can only be making about *itself*.
function isCourtesy(body = '') {
  const text = String(body);
  return /\b(?:i'?m|i am)\s+(?:working|reviewing|comparing|checking|looking|reading|analys|analyz)/i.test(text)
    || /\bwill respond\b|\brespond here shortly\b|\btaking a look\b|\bhang tight\b/i.test(text)
    || /\bmention (?:blocks like a regular teammate|me in a comment)\b|@blocks \/help/i.test(text)
    || /\bwhen a pass finishes\b|\bto get started\b/i.test(text)
    || /\breview (?:is )?in progress\b|\brunning analysis\b|\bqueued for review\b/i.test(text);
}

// Clean is a verdict that finished and left nothing behind — never a phrase list of
// its own. The old version asked whether the prose contained approving words, which
// meant "LGTM apart from one blocker" and "looks good … the retry path is the
// exception" both read as clean while naming the thing that was not.
function isClean(body = '') {
  return isVerdict(body) && !reportsFindings(body);
}

// Blocks also posts its verdict as a plain top-level comment, not only as a formal
// review. Such a comment names its own completion; an acknowledgement or help text
// never does, so courtesy phrasing keeps a comment nonterminal even when it quotes
// the words a finished review would use.
//
// What this asks is whether the comment makes a PAST-TENSE claim about a review it
// finished — not whether it contains one of two hardcoded strings. It used to demand
// the literal "reviewed pr" or "review complete", so a real verdict opening
// "Reviewed `67b6d36` and its documentation-only diff" matched nothing and a caller
// waited forty minutes for a verdict that had arrived in four seconds.
//
// Two things veto the claim. Help text quotes the words a verdict uses — "when a
// pass finishes I reply with **Reviewed PR #<number>**" — so courtesy still wins. And
// a partial pass makes the claim and then withdraws it: "Reviewed PR #29 up to
// `packages/guards/` … I need another pass over the rest."
function isVerdict(body = '') {
  const text = String(body);
  const claims = /\b(?:re-?)?reviewed\b/i.test(text)
    || /\b(?:re-?)?review\s+(?:is\s+)?complete\b/i.test(text)
    || /\bfinished\s+reviewing\b/i.test(text)
    || /\blgtm\b/i.test(text)
    || /\blooks good\b/i.test(text);
  if (!claims || isCourtesy(text)) return false;
  return !(/\banother pass\b|\bbefore i can (?:say|post|give|call)\b|\bneeds? (?:another|more)\b/i.test(text)
    || /\bstill (?:need|have|review|working|going)/i.test(text)
    || /\bnot (?:yet )?(?:finished|complete|done)\b/i.test(text)
    || /\bhave not (?:opened|looked|reviewed|got to|read)\b|\bnot opened yet\b/i.test(text)
    || /\bwill (?:continue|finish)\b/i.test(text)
    || /\bmore commits\b|\bhalf of the diff\b|\bremaining files\b|\bpartial (?:pass|review)\b/i.test(text)
    || /\bso far\b/i.test(text));
}

// An explicit statement that this round found nothing, which is what a verdict has
// to produce before it is allowed to mean clean.
function statesEmptiness(text) {
  return re(String.raw`\b(?:no|zero|0|none|nothing|not any)\b[^.!?;:\n]{0,40}?(?:${NOUN}|actionable|to act on|outstanding|blocking)`).test(text)
    || /\bnothing (?:is |was )?(?:outstanding|left|to act on|for you to act on|else)\b/i.test(text)
    || /\bnothing actionable\b|\bfound nothing\b|\bnothing (?:at or )?above severity\b/i.test(text)
    || /\blgtm\b|\blooks good\b/i.test(text)
    || re(String.raw`#+\s*${NOUN}\s*\n+\s*(?:none|nil|n/a)`).test(text)
    || re(String.raw`\|[^|\n]*${NOUN}[^|\n]*\|\s*0\s*\|`).test(text)
    || re(String.raw`${NOUN}[^.!?;\n]{0,30}?\b(?:is|are)\s+empty\b`).test(text)
    // Saying the findings are resolved IS saying nothing is outstanding. A re-review
    // that clears what it named never needs to add "and there are none left".
    || re(String.raw`${NOUN}(?:(?!\b(?:but|however|though)\b)[^.!?;\n]){0,140}?\b(?:is|are|was|were|has been|have been|had been)\s+(?:now\s+)?(?:all\s+)?(?:fixed|resolved|addressed|cleared|gone)\b`).test(text)
    || /\b(?:neither|none of them|all (?:three|two|four|of them))\s+(?:survives?|remains?|stands?|persists?)/i.test(text);
}

// "no actionable findings" and "that finding is fixed" are both completion, not work
// left. Only a counted or plural mention surviving those two readings means findings
// remain in a verdict that left no inline comment to read.
//
// A resolution reaches back over however much attribution names the findings it
// clears — a module list can run long — so bound that span by punctuation rather
// than by a character count. Stop it at a clause break or a contrasting "but", where
// the sentence turns to what is still outstanding: "two findings in the retry path,
// but the null dereference is fixed" must keep its findings, not lose them to the fix.
// Decided per mention rather than per document, and the default is findings.
//
// The old version ended in a bare `/\b(?:findings|inline comments)\b/` fallback, so
// ANY surviving mention of the word meant outstanding work — and its negation strip
// allowed at most two `\w+` between "no" and the noun. "No new severity >=7 findings"
// is three tokens wide and ">=7" is not a word character, so the strip missed, the
// bare mention fired, and a clean review was reported as having findings. The gaps
// here are bounded by clause punctuation instead of by a word count.
//
// The default matters more than any pattern below. Of the three ways to be wrong,
// only calling an unreviewed or unclean head "clean" is unrecoverable — it is the one
// that merges. A spurious findings costs a reader the seconds it takes to open the
// comment and see nothing there. So clean must be EARNED by {@link statesEmptiness};
// anything a verdict leaves ambiguous is treated as work outstanding.
function reportsFindings(body = '') {
  // Quoted lines recount an earlier round. They are set aside, because a verdict
  // that quotes three old findings to say none of them survive is a clean one.
  const own = String(body).split(/\n/).filter((line) => !/^\s*>/.test(line)).join('\n');

  // A NEGATED RESOLUTION means the work stands, so it is checked before the strips
  // below can eat it: "Zero of these findings have been addressed" is the strongest
  // possible findings statement and reads, to a stripper, like the weakest.
  if (re(String.raw`\b(?:zero|none|no|not one|not any|nothing)\s+(?:of\s+)?(?:these|those|them|the)?\s*(?:${NOUN})?[^.!?;\n]{0,60}?\b(?:have|has|are|is|were|was)\s+been\s+(?:fixed|resolved|addressed|cleared)`).test(own)) return true;
  if (/\b(?:zero|none|no)\s+of\s+(?:these|those|them)\b/i.test(own) && /\b(?:fixed|resolved|addressed|cleared)\b/i.test(own)) return true;
  if (/\bnothing\s+(?:is|has been)\s+(?:fixed|resolved|addressed|cleared)\b/i.test(own)) return true;
  if (/\b(?:is back|are back|regressed|reintroduced|reappeared|back in its original)\b/i.test(own)) return true;

  // A mention that already carries its own standing predicate is outstanding work,
  // and must be settled BEFORE any resolution is stripped. Otherwise "two findings
  // remain open on the queue worker, and the bypass from round two was fixed" loses
  // its findings to a resolution that belongs to the other half of the sentence.
  // The gap is wide because the noun and its predicate can be far apart — "the
  // finding about the missing retry budget in the billing retry helper is still open"
  // — but it is still bounded by clause punctuation, which is what keeps "…accurate;
  // upstream PR #15 is still open" out: the semicolon ends the reach.
  if (re(String.raw`${NOUN}[^.!?;\n]{0,80}?\b(?:remain|remains|stand|standing|persist|still\s+open|are\s+open|is\s+open|are\s+outstanding|reproduce)`).test(own)) return true;
  // A verdict can clear last round's findings and open new ones in the same breath:
  // "the three from round two are resolved and the new ones are listed below".
  if (/\bopen items\b|\bthe new ones\b|\bnew (?:findings?|issues?) (?:are|is) listed\b/i.test(own)) return true;

  // A dashboard link can carry `/findings` in its path. That is a URL, not a finding.
  let text = own.replace(/https?:\/\/\S+/gi, ' ');

  // Resolutions. The window stops at a conjunction as well as at clause punctuation,
  // so it cannot bridge "two findings remain open, and the other one is resolved".
  text = text.replace(re(String.raw`${NOUN}(?:(?!\b(?:but|however|though)\b)[^.!?;\n]){0,140}?\b(?:is|are|was|were|has been|have been|had been)\s+(?:now\s+)?(?:all\s+)?(?:fixed|resolved|addressed|cleared|gone)\b`, 'gi'), ' ');
  text = text.replace(/\b(?:neither|none of them|all (?:three|two|four|of them))\s+(?:survives?|remain|stand|persist)/gi, ' ');
  text = text.replace(re(String.raw`\ball\s+(?:\w+\s+)?${NOUN}[^.!?;\n]{0,80}?\b(?:addressed|fixed|resolved|cleared)\b`, 'gi'), ' ');

  // Negated mentions, in every shape this bot writes them.
  text = text.replace(re(String.raw`\b(?:no|zero|0|none|nothing|without|not)\b[^.!?;:\n]{0,40}?${NOUN}`, 'gi'), ' ');
  text = text.replace(re(String.raw`\bhave not opened\b[^.!?;\n]{0,40}?${NOUN}`, 'gi'), ' ');
  text = text.replace(re(String.raw`\bnot opened it as a\s+${NOUN}`, 'gi'), ' ');
  text = text.replace(re(String.raw`\|[^|\n]*${NOUN}[^|\n]*\|\s*0\s*\|`, 'gi'), ' ');
  text = text.replace(re(String.raw`${NOUN}[^.!?;\n]{0,30}?\b(?:is|are)\s+empty\b`, 'gi'), ' ');
  text = text.replace(re(String.raw`^\s*#+\s*${NOUN}\s*\n+\s*(?:none|nil|n\/a)\.?`, 'gim'), ' ');

  if (re(String.raw`\b(?:\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|several|multiple|some|few|new|remaining|outstanding|both|each|every)\s+(?:\w+[\s-]+){0,3}?${NOUN}`).test(text)) return true;
  if (re(String.raw`\b${NOUN}\b[^.!?;\n]{0,40}?\b(?:remain|stand|outstanding|unresolved|untouched|reproduce)`).test(text)) return true;
  // "still open" is NOT in this unscoped set, deliberately. Pull requests, issues and
  // tickets are open; only the scoped check above may read "open" as a defect still
  // standing, because there it has a findings noun in front of it. A verdict saying
  // "upstream PR #15 is still open" is reporting news, not a finding.
  if (/\b(?:untouched|unresolved|still (?:stands|outstanding)|not (?:been )?(?:fixed|addressed|resolved))\b/i.test(text)) return true;

  // A contrastive turn followed by a concrete defect is outstanding work even when
  // the word "finding" never appears: "LGTM apart from one blocker", "no actionable
  // findings in the docs commit — the code commit is a different matter".
  const CONTRAST = /\b(?:apart from|aside from|except(?: for| that)?|other than|the exception|a different matter|different story|would push back|but|however|though|caveat|one concern|that said)\b/i;
  const DEFECT = /\b(?:blocker|blocking|severity\s*(?:[7-9]|10)|bug|defect|race|leak|unbounded|missing|bypass|vulnerab|incorrect|wrong|crash|drops? the|swallow|never|silently|before the handler|after it has)\b/i;
  if (CONTRAST.test(own) && DEFECT.test(own)) return true;

  return !statesEmptiness(own);
}

/**
 * The commit a verdict says it reviewed, or null when it names none.
 *
 * Blocks writes the head into its summary — "Reviewed PR #29 at `a0eef8b`",
 * "Reviewed `67b6d36` and its documentation-only diff" — which is the only thing
 * that ties a verdict to a commit. A review of a superseded head cannot accept the
 * current one, and nothing else in the payload says which head it read.
 */
export function reviewedSha(body = '') {
  const match = String(body).match(/\b(?:reviewed|re-?reviewed|review complete[^\n]{0,20}?)\b[^\n]{0,60}?`([0-9a-f]{7,40})`/i)
    ?? String(body).match(/\b(?:at|for|on)\s+`([0-9a-f]{7,40})`/i);
  return match?.[1] ?? null;
}

/**
 * Whether a verdict may be acted on, given the commit it read and what CI said.
 *
 * A `clean` review is not acceptance on its own, and this is the gap that made it
 * worth writing down. Two failures motivated it, both observed rather than imagined:
 *
 * 1. **A verdict for a superseded head.** Every push moves the branch; a review that
 *    named the previous commit says nothing about the current one, and its wording
 *    gives no hint that it is stale.
 * 2. **A green check name for a commit it never tested.** `gh pr checks` reported
 *    pass while the run under it belonged to the previous head, because the new run
 *    had not registered yet. A poll keyed on the check name exited satisfied.
 *
 * So acceptance asks for three things at once: a clean verdict, a verdict that names
 * the head under consideration, and CI success **on that same commit**. Anything less
 * is reported with a reason rather than silently downgraded, because a caller that
 * cannot tell "not yet" from "no" will read both as "go".
 *
 * @param state One of the classifier's states.
 * @param verdictSha The commit the verdict named, from {@link reviewedSha}.
 * @param headSha The pull request's current head.
 * @param ciConclusion The required check's conclusion on `headSha` — `success`,
 *   something else, or null when no run for that commit exists yet.
 * @param verdictAt When the verdict was posted. Used only when it names no commit.
 * @param headCommittedAt When the head commit was authored. Same.
 */
export function verdictAcceptance({ state, verdictSha, headSha, ciConclusion, verdictAt, headCommittedAt }) {
  const reasons = [];
  if (state !== 'clean') reasons.push(`review state is \`${state}\`, not clean`);
  if (!headSha) reasons.push('the pull request head is unknown');
  else if (verdictSha) {
    // A named commit is the strong form: compare it directly.
    if (!String(headSha).startsWith(String(verdictSha)) && !String(verdictSha).startsWith(String(headSha))) {
      reasons.push(`the verdict reviewed \`${verdictSha}\` but the head is \`${String(headSha).slice(0, 7)}\``);
    }
  } else if (verdictAt && headCommittedAt) {
    // Not every verdict names a commit, and refusing those outright would block a
    // perfectly good review over its wording — the mistake this file keeps making in
    // other forms. A verdict posted after the head was committed cannot have read an
    // earlier one, so the timestamps settle it without asking the prose to.
    if (Date.parse(verdictAt) < Date.parse(headCommittedAt)) {
      reasons.push('the verdict predates this head, so it reviewed an earlier commit');
    }
  } else {
    reasons.push('the verdict names no commit and cannot be dated against this head');
  }
  if (ciConclusion === null || ciConclusion === undefined) reasons.push('no CI run for this head has completed');
  else if (ciConclusion !== 'success') reasons.push(`CI on this head concluded \`${ciConclusion}\``);
  return { acceptable: reasons.length === 0, reasons };
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
  const verdictComment = relevantComments.find((item) => isVerdict(item.body));
  const cleanComment = relevantComments.find((item) => isClean(item.body));
  const cleanReview = relevantReviews.find((item) => isClean(item.body) || (item.state ?? '').toUpperCase() === 'APPROVED');
  const dashboardUrl = [...relevantComments, ...relevantReviews].map((item) => dashboard(item.body)).find(Boolean) ?? null;

  if (findings.length || summaryFindingReviews.length) {
    return { state: 'findings', terminal: true, prState, findings, comments: relevantComments, reviews: relevantReviews, dashboardUrl };
  }
  // Inline comments and formal reviews above are the stronger evidence and already
  // returned. A verdict comment is the next authority: reaching here means the inline
  // sweep found nothing, so the verdict's own wording decides between the two states.
  if (verdictComment) {
    return { state: reportsFindings(verdictComment.body) ? 'findings' : 'clean', terminal: true, prState, findings, comments: relevantComments, reviews: relevantReviews, dashboardUrl };
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
    const pages = await runGh(['api', '--method', 'GET', `repos/${repo}/pulls/${pr}/comments?per_page=100`, '--paginate', '--slurp']);
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
