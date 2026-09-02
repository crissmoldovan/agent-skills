#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { collectBlocksStatus, reviewedSha, verdictAcceptance, waitForBlocksReview } from './blocks-review.mjs';

const execFileAsync = promisify(execFile);

/**
 * The pull request's head, and the required check's conclusion ON THAT COMMIT.
 *
 * Keyed on the sha rather than the check name, deliberately. `gh pr checks` reports
 * the newest run it knows about, which after a push is still the PREVIOUS head's —
 * so a poll keyed on the name reads green for a commit CI never tested. Asking for
 * the runs belonging to one sha cannot make that mistake.
 */
async function headAndCi(repo, pr) {
  try {
    const { stdout } = await execFileAsync('gh', ['pr', 'view', String(pr), '--repo', repo, '--json', 'headRefOid']);
    const headSha = JSON.parse(stdout).headRefOid ?? null;
    if (!headSha) return { headSha: null, ciConclusion: null, headCommittedAt: null };
    let headCommittedAt = null;
    try {
      const { stdout: commit } = await execFileAsync('gh', ['api', `repos/${repo}/commits/${headSha}`, '--jq', '.commit.committer.date']);
      headCommittedAt = commit.trim() || null;
    } catch { headCommittedAt = null; }
    const { stdout: runs } = await execFileAsync('gh', ['api', `repos/${repo}/commits/${headSha}/check-runs`]);
    const checks = (JSON.parse(runs).check_runs ?? []).filter((run) => run.status === 'completed');
    if (!checks.length) return { headSha, ciConclusion: null, headCommittedAt };
    // Any completed check that did not succeed decides it; `neutral` and `skipped`
    // are not failures, and a required check that has not finished is not a pass.
    const bad = checks.find((run) => !['success', 'neutral', 'skipped'].includes(run.conclusion));
    return { headSha, ciConclusion: bad ? bad.conclusion : 'success', headCommittedAt };
  } catch {
    return { headSha: null, ciConclusion: null, headCommittedAt: null };
  }
}

function usage() {
  console.log(`Usage:
  blocks-review status --repo owner/repo --pr 17 --requested-at ISO [--json]
  blocks-review wait   --repo owner/repo --pr 17 --requested-at ISO [--timeout 600] [--interval 15] [--json]

Uses authenticated GitHub CLI data. It does not call an undocumented Blocks API.`);
}

const [command, ...argv] = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};
const repo = option('repo');
const pr = Number(option('pr'));
const requestedAt = option('requested-at');
const json = argv.includes('--json');
if (!['status', 'wait'].includes(command) || !repo || !Number.isInteger(pr) || !requestedAt) {
  usage();
  process.exitCode = 2;
} else {
  const getStatus = () => collectBlocksStatus({ repo, pr, requestedAt });
  const result = command === 'wait'
    ? await waitForBlocksReview({
      getStatus,
      timeoutMs: Number(option('timeout', 60)) * 1000,
      intervalMs: Number(option('interval', 10)) * 1000,
    })
    : await getStatus();
  // A clean verdict is not acceptance. It has to name the head under consideration,
  // and CI has to have passed on that same commit — see `verdictAcceptance`.
  const { headSha, ciConclusion, headCommittedAt } = await headAndCi(repo, pr);
  const named = (result.comments ?? []).find((item) => reviewedSha(item.body));
  const latest = (result.comments ?? [])[(result.comments ?? []).length - 1];
  const acceptance = verdictAcceptance({
    state: result.state,
    verdictSha: named ? reviewedSha(named.body) : null,
    headSha,
    ciConclusion,
    verdictAt: (named ?? latest)?.createdAt ?? null,
    headCommittedAt,
  });
  const enriched = { ...result, headSha, ciConclusion, acceptance };

  if (json) console.log(JSON.stringify(enriched, null, 2));
  else {
    console.log(`Blocks review: ${result.state}${result.timedOut ? ' (wait timed out)' : ''}`);
    if (result.dashboardUrl) console.log(`Dashboard: ${result.dashboardUrl}`);
    for (const finding of result.findings ?? []) {
      console.log(`- severity ${finding.severity} ${finding.path ?? ''}${finding.line ? `:${finding.line}` : ''} ${finding.body}`);
    }
    console.log(acceptance.acceptable
      ? `Acceptable: clean verdict for ${String(headSha).slice(0, 7)}, CI ${ciConclusion}.`
      : `NOT acceptable yet — ${acceptance.reasons.join('; ')}.`);
  }
}
