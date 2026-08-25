#!/usr/bin/env node
import { collectBlocksStatus, waitForBlocksReview } from './blocks-review.mjs';

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
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Blocks review: ${result.state}${result.timedOut ? ' (wait timed out)' : ''}`);
    if (result.dashboardUrl) console.log(`Dashboard: ${result.dashboardUrl}`);
    for (const finding of result.findings ?? []) {
      console.log(`- severity ${finding.severity} ${finding.path ?? ''}${finding.line ? `:${finding.line}` : ''} ${finding.body}`);
    }
  }
}
