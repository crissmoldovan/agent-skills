import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { encodeProjectPath, historyCounts } from '../skills/onboard-project/scripts/history.mjs';
import { tempDir } from './helpers/temp-dir.mjs';

const scratch = (name) => tempDir(`${name}-`);

/** One assistant turn's worth of transcript, in the shape Claude Code writes. */
const toolUse = (name, input) => JSON.stringify({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] },
});

async function historyFor(repoRoot, lines) {
  const home = await scratch('onboard-home');
  const directory = path.join(home, '.claude', 'projects', encodeProjectPath(repoRoot));
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'session-one.jsonl'), `${lines.join('\n')}\n`);
  return home;
}

test('a repository path is encoded the way Claude Code names its project directories', () => {
  assert.equal(encodeProjectPath('/a/b/my-repo'), '-a-b-my-repo');
  assert.equal(encodeProjectPath('/a/b/my repo.v2'), '-a-b-my-repo-v2');
});

test('the five counts come out of the transcript, and known says the history was there', async () => {
  const repo = await scratch('onboard-repo');
  const home = await historyFor(repo, [
    toolUse('Agent', { description: 'do a thing', subagent_type: 'general-purpose' }),
    toolUse('Agent', { description: 'do another', subagent_type: 'general-purpose' }),
    toolUse('Task', { description: 'older name for the same tool' }),
    toolUse('Workflow', { script: 'export const meta = {}' }),
    toolUse('Bash', { command: 'npm run dev', run_in_background: true }),
    toolUse('Bash', { command: 'npm publish --access public' }),
    toolUse('Bash', { command: 'gh release create v1.2.3' }),
    toolUse('Write', { file_path: path.join(repo, 'src', 'inside.ts') }),
    toolUse('Edit', { file_path: '/somewhere/else/outside.ts' }),
    'not json at all',
  ]);

  const counts = historyCounts(repo, { home });
  assert.equal(counts.known, true);
  assert.equal(counts.agentDispatches, 3, 'Agent and Task are the same dispatch');
  assert.equal(counts.workflowLaunches, 1);
  assert.equal(counts.backgroundCommands, 1);
  assert.equal(counts.releaseCommands, 2);
  assert.equal(counts.writesOutsideRepo, 1);
});

test('no history directory means unknown, not zero', async () => {
  const repo = await scratch('onboard-repo-nohistory');
  const home = await scratch('onboard-home-empty');
  const counts = historyCounts(repo, { home });
  assert.equal(counts.known, false);
  assert.equal(counts.agentDispatches, undefined, 'an absent history must not report a count');
});

test('a malformed transcript still yields the counts around it', async () => {
  const repo = await scratch('onboard-repo-malformed');
  const home = await historyFor(repo, ['{ "truncated": ', toolUse('Agent', { description: 'x' }), '']);
  const counts = historyCounts(repo, { home });
  assert.equal(counts.known, true);
  assert.equal(counts.agentDispatches, 1);
});

test('sibling worktree histories of the same repository are counted too', async () => {
  const parent = await scratch('onboard-parent');
  const repo = path.join(parent, 'project');
  const worktree = path.join(parent, 'project-wt-feature');
  await mkdir(repo, { recursive: true });
  const home = await historyFor(repo, [toolUse('Agent', { description: 'in the main checkout' })]);
  const worktreeDirectory = path.join(home, '.claude', 'projects', encodeProjectPath(worktree));
  await mkdir(worktreeDirectory, { recursive: true });
  await writeFile(path.join(worktreeDirectory, 's.jsonl'), `${toolUse('Agent', { description: 'in the worktree' })}\n`);

  const counts = historyCounts(repo, { home, worktrees: [worktree] });
  assert.equal(counts.agentDispatches, 2, 'the worktree\'s own history was not counted');
});
