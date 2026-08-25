#!/usr/bin/env node
import {
  createBlocksSession,
  getBlocksSession,
  resolveBlocksApiKey,
  sendBlocksFollowUp,
  waitForBlocksFinalMessage,
} from './blocks-review.mjs';
import { execFileSync } from 'node:child_process';

function usage() {
  console.log(`Usage:
  blocks-session create --profile cue --agent claude --message "..." [--wait] [--timeout 600]
  blocks-session get --profile cue --session <uuid>
  blocks-session follow-up --profile rgc --session <uuid> --message "..." [--wait]
  blocks-session wait --profile cue --final-url <opaque Blocks final_message URL> [--timeout 600]

Profiles are user-defined identifiers and map to BLOCKS_API_KEY_<PROFILE>. Never pass keys as arguments.`);
}

const [command, ...argv] = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};
let apiKey;
try {
  const profile = option('profile');
  try {
    apiKey = resolveBlocksApiKey({ profile });
  } catch {
    if (process.platform !== 'darwin') throw new Error(`BLOCKS_API_KEY_${profile?.toUpperCase()} is required`);
    apiKey = execFileSync('security', [
      'find-generic-password', '-w', '-a', process.env.USER ?? '',
      '-s', `blocks-api-key-${profile}`,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  }
} catch (error) {
  console.error(error.message);
  usage();
  process.exit(2);
}
const timeoutMs = Number(option('timeout', 60)) * 1000;
const intervalMs = Number(option('interval', 5)) * 1000;
const progress = async ({ state, elapsedMs }) => {
  if (!process.stderr.isTTY && process.env.BLOCKS_PROGRESS !== '1') return;
  process.stderr.write(`[blocks] ${state} (${Math.round(elapsedMs / 1000)}s)\n`);
};
let result;
if (command === 'create' && option('message')) {
  result = await createBlocksSession({ agentName: option('agent', 'claude'), message: option('message'), apiKey });
  if (argv.includes('--wait')) result.final = await waitForBlocksFinalMessage({ finalMessageUrl: result._links.final_message.href, apiKey, timeoutMs, intervalMs, onProgress: progress });
} else if (command === 'get' && option('session')) {
  result = await getBlocksSession({ sessionId: option('session'), apiKey });
} else if (command === 'follow-up' && option('session') && option('message')) {
  result = await sendBlocksFollowUp({ sessionId: option('session'), message: option('message'), apiKey });
  if (argv.includes('--wait')) result.final = await waitForBlocksFinalMessage({ finalMessageUrl: result._links.final_message.href, apiKey, timeoutMs, intervalMs, onProgress: progress });
} else if (command === 'wait' && option('final-url')) {
  result = await waitForBlocksFinalMessage({ finalMessageUrl: option('final-url'), apiKey, timeoutMs, intervalMs, onProgress: progress });
} else {
  usage();
  process.exitCode = 2;
}
if (result) console.log(JSON.stringify(result, null, 2));
