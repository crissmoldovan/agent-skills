#!/usr/bin/env node
/**
 * WHAT THIS REPOSITORY'S OWN SESSIONS ACTUALLY DID, counted cheaply enough to be worth reading.
 *
 * Some skills fit a repository because of its files, and some fit because of how it is worked on:
 * a repository where implementation is routinely delegated needs a different set from one where
 * every change is typed by hand, and no file in the tree says which it is. The evidence for that
 * lives in the harness's own session history.
 *
 * TWO RULES HOLD THIS DOWN. It is read ONLY by onboard and refresh — never by the session-start
 * check, because these files run to tens of megabytes and a check that costs a second at every
 * session start will be removed by the person paying for it. And an absent history is UNKNOWN,
 * never zero: this machine may simply never have opened this repository, and a skill must not be
 * dropped for lack of evidence that was never going to be here.
 *
 * Nothing read here is ever written into a committed file. The counts are numbers; the transcripts
 * they came from carry prompts, paths and output that belong to the person who ran them.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

/** How much transcript one scan will read. Past this the counts are what was seen so far. */
const MAX_BYTES_PER_PROJECT = 64 * 1024 * 1024;

/** Commands that mean a release was cut here. Deliberately narrow: a mention is not a release. */
const RELEASE_COMMAND = /(?:^|\s|&&|;|\|)(?:npm|pnpm|yarn)\s+publish\b|changeset\s+publish\b|(?:gh|glab)\s+release\s+create\b|git\s+tag\s+-a?\s*v?\d+\.\d+/;

/** The dispatch tool has had two names; both are one dispatch. */
const DISPATCH_TOOLS = new Set(['Agent', 'Task']);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit', 'MultiEdit']);

/** Claude Code names a project's history directory after its path, with every character that is
 *  not a letter or a digit replaced by a hyphen. */
export function encodeProjectPath(repoRoot) {
  return resolve(repoRoot).replace(/[^A-Za-z0-9]/g, '-');
}

/** Where this machine keeps session history for one repository path. */
export function historyDirectory(repoRoot, { home = homedir() } = {}) {
  return join(home, '.claude', 'projects', encodeProjectPath(repoRoot));
}

function countLine(line, counts, repoRoot) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return; // a truncated or half-written line is not a reason to abandon the file
  }
  const content = entry?.message?.content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block?.type !== 'tool_use') continue;
    const name = block.name;
    const input = block.input ?? {};
    if (DISPATCH_TOOLS.has(name)) counts.agentDispatches += 1;
    else if (name === 'Workflow') counts.workflowLaunches += 1;
    else if (name === 'Bash') {
      if (input.run_in_background === true) counts.backgroundCommands += 1;
      if (typeof input.command === 'string' && RELEASE_COMMAND.test(input.command)) counts.releaseCommands += 1;
    } else if (WRITE_TOOLS.has(name) && typeof input.file_path === 'string') {
      const path = resolve(input.file_path);
      if (path !== repoRoot && !path.startsWith(`${repoRoot}${sep}`)) counts.writesOutsideRepo += 1;
    }
  }
}

/**
 * The five counts for one repository, including the histories of any worktrees given.
 *
 * Returns `{ known: false }` and NO counts when this machine has no history for the repository —
 * the distinction a caller needs to report a history signal as unknown rather than unmet.
 */
export function historyCounts(repoRoot, { home = homedir(), worktrees = [] } = {}) {
  const root = resolve(repoRoot);
  const directories = [root, ...worktrees.map((path) => resolve(path))]
    .map((path) => historyDirectory(path, { home }))
    .filter((directory) => existsSync(directory));
  if (directories.length === 0) return { known: false };

  const counts = {
    known: true,
    agentDispatches: 0,
    workflowLaunches: 0,
    backgroundCommands: 0,
    releaseCommands: 0,
    writesOutsideRepo: 0,
    truncated: false,
  };
  let budget = MAX_BYTES_PER_PROJECT;
  for (const directory of directories) {
    let files;
    try {
      files = readdirSync(directory).filter((name) => name.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const name of files) {
      const path = join(directory, name);
      let size = 0;
      try {
        size = statSync(path).size;
      } catch {
        continue;
      }
      if (size > budget) {
        counts.truncated = true;
        continue;
      }
      budget -= size;
      let source;
      try {
        source = readFileSync(path, 'utf8');
      } catch {
        continue;
      }
      for (const line of source.split('\n')) {
        if (line.trim() === '') continue;
        countLine(line, counts, root);
      }
    }
  }
  return counts;
}
