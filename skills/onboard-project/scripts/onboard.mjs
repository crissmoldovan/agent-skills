#!/usr/bin/env node
/**
 * ONBOARD-PROJECT: pick this repository's skills from evidence, and wire them into every session.
 *
 * Three commands, and the split between them is the whole design:
 *
 *   plan    reads everything and writes NOTHING. It prints the change list — one row per skill,
 *           per file and per hook, each with the evidence that justified it and the undo that
 *           takes it back.
 *   apply   writes the FILES on one explicit yes, and prints the install and hook commands for
 *           the caller to run in order. It runs no installs itself: the network stays out of a
 *           module the session-start check also loads, and every install stays visible.
 *   check   reads, never writes anything but its own one-time suggestion marker, and says nothing
 *           at all unless something is missing or has changed. This is the command the
 *           SessionStart hook runs, so silence is its normal output and failure is silent too.
 *
 * WHAT IT NEVER TOUCHES: CLAUDE.md, AGENTS.md, and any context file another tool generates. The
 * routing lives in its own generated rules file, which is why nothing it writes can be clobbered
 * by a regeneration somebody else owns.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateRepoSignals, forgetRepoIndex, loadCatalogue, repoIndex } from './fit.mjs';
import { historyCounts } from './history.mjs';
import {
  PROFILE_VERSION,
  RULES_RELATIVE,
  fingerprintOf,
  installedSkills,
  localProfilePath,
  profilePaths,
  readProfile,
  renderRules,
  rulesDrifted,
  rulesPath,
  userConfig,
  writeJsonAtomically,
  writeProfile,
  writeTextAtomically,
} from './profile.mjs';

const PACK_ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const PACK_SOURCE = 'crissmoldovan/agent-skills';
const VERSION = '1.0.0';

const USAGE = `Usage: onboard.mjs plan  [--repo <path>] [--json] [--weak <names>]
       onboard.mjs apply [--repo <path>] [--yes]
       onboard.mjs check [--repo <path>] [--hook]

plan   print the change list and write nothing.
apply  write the files the plan named, on --yes, and print the commands to run next.
check  say nothing unless a required skill is missing, the repository's evidence moved, or the
       generated rules file no longer matches its profile. --hook wraps that line in the
       SessionStart envelope. This command never reads session history.

--weak a comma-separated list of installed skills the caller matched from their descriptions
       rather than from declared fit; they are listed as weaker, and never marked required.`;

/* ------------------------------------------------------------------ the scan */

/** The origin owner, read out of .git/config rather than by spawning git. */
export function originOwner(repoRoot) {
  const gitPath = join(resolve(repoRoot), '.git');
  let configPath = join(gitPath, 'config');
  try {
    if (!existsSync(gitPath)) return null;
    const stat = readFileSync(gitPath, 'utf8');
    // A worktree's .git is a file pointing at the real directory.
    const pointer = stat.match(/^gitdir:\s*(.+)$/m);
    if (pointer) configPath = join(pointer[1].trim(), 'config');
  } catch {
    // .git is a directory, which is the ordinary case: fall through to its config.
  }
  try {
    const source = readFileSync(configPath, 'utf8');
    const url = source.match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/s)?.[1];
    if (!url) return null;
    const owner = url.match(/[:/]([^/:]+)\/[^/]+?(?:\.git)?$/)?.[1];
    return owner ?? null;
  } catch {
    return null;
  }
}

/**
 * The repository a hook has landed in.
 *
 * A session-start hook runs wherever the session was opened, which is often a package inside the
 * repository rather than its root. Walk up until something says "this is the top" — the git
 * directory, or a profile somebody has already written — and fall back to where we started, which
 * is the honest answer for a directory that is not in a repository at all.
 */
export function findRepoRoot(start) {
  let current = resolve(start);
  for (let depth = 0; depth < 40; depth += 1) {
    if (existsSync(join(current, '.git')) || existsSync(join(current, 'skills-profile.json'))) return current;
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return resolve(start);
}

export function isGitRepository(repoRoot) {
  return existsSync(join(resolve(repoRoot), '.git'));
}

/** Where this repository's files should go: committed for an owner the user trusts, else local. */
export function resolvePlacement(repoRoot, { home = homedir() } = {}) {
  if (!isGitRepository(repoRoot)) return { placement: 'local', why: 'not a git repository' };
  const owner = originOwner(repoRoot);
  const owners = userConfig({ home }).commitOwners ?? [];
  if (owner && owners.includes(owner)) return { placement: 'committed', why: `origin owner ${owner} takes committed files` };
  return { placement: 'local', why: owner ? `origin owner ${owner} is not in commitOwners` : 'no origin remote' };
}

/**
 * Evaluate the whole catalogue against one repository.
 *
 * `counts` is passed in rather than gathered, so the caller decides whether history is read at
 * all — `check` never does. The repo-only fingerprint is computed in the same pass, because it is
 * what the check recomputes later and the two must be built the same way or every check drifts.
 */
export function scan(repoRoot, { home = homedir(), counts = null, pack = PACK_ROOT } = {}) {
  forgetRepoIndex(repoRoot);
  const catalogue = loadCatalogue(pack);
  const matches = new Map();
  const repoOnlyTrue = {};
  for (const [name, fit] of catalogue) {
    if (fit.kind === 'requestOnly') continue;
    if (fit.kind === 'general') {
      matches.set(name, { match: 'general', evidence: [], useWhen: fit.useWhen, trueSignals: [], unknownSignals: [] });
      continue;
    }
    const withHistory = evaluateRepoSignals(fit, repoRoot, { counts });
    const repoOnly = evaluateRepoSignals(fit, repoRoot, { counts: null });
    if (repoOnly.trueSignals.length > 0) repoOnlyTrue[name] = repoOnly.trueSignals;
    if (!withHistory.matched) continue;
    matches.set(name, {
      match: 'strong',
      evidence: withHistory.evidence,
      useWhen: fit.useWhen,
      trueSignals: withHistory.trueSignals,
      unknownSignals: withHistory.unknownSignals,
    });
  }
  return { matches, fingerprint: fingerprintOf(repoOnlyTrue), repoOnlyTrue };
}

/* ------------------------------------------------------------------ the plan */

function hookInstalled({ home = homedir() } = {}) {
  try {
    const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
    const groups = settings?.hooks?.SessionStart ?? [];
    return groups.some((group) => (group.hooks ?? []).some((hook) => String(hook.command ?? '').includes('onboard-project')));
  } catch {
    return false;
  }
}

function installCommand(name, placement) {
  const scope = placement === 'committed' ? '--project' : '--global';
  return `npx skills add ${PACK_SOURCE} --skill ${name} ${scope} --yes`;
}

function removeCommand(name, placement) {
  return `npx skills remove ${name} ${placement === 'committed' ? '--project' : '--global'}`;
}

/**
 * The change list: every skill row, every file the apply would write, and every hook it would
 * arm — each carrying its undo, because a change nobody can take back is not a change anybody
 * should agree to in one line.
 */
export function buildPlan(repoRoot, { home = homedir(), pack = PACK_ROOT, weak = [] } = {}) {
  const root = resolve(repoRoot);
  const counts = historyCounts(root, { home });
  const { matches, fingerprint, repoOnlyTrue } = scan(root, { home, counts, pack });
  const existing = readProfile(root, { home });
  const placement = existing?.placement ?? resolvePlacement(root, { home }).placement;
  const why = existing ? 'the placement recorded in this repository\'s profile' : resolvePlacement(root, { home }).why;
  const installed = installedSkills({ repoRoot: root, home });
  const declined = existing?.declined ?? {};

  const rows = [];
  const skills = {};
  for (const [name, match] of [...matches].sort((left, right) => left[0].localeCompare(right[0]))) {
    const own = fingerprintOf({ [name]: repoOnlyTrue[name] ?? [] });
    const wasDeclined = declined[name]?.fingerprint === own;
    const scope = installed.get(name) ?? (placement === 'committed' ? 'project' : 'global');
    const required = match.match === 'strong';
    if (!wasDeclined) {
      skills[name] = { match: match.match, evidence: match.evidence, useWhen: match.useWhen, required, scope };
    }
    rows.push({
      kind: wasDeclined ? 'declined' : installed.has(name) ? '=' : '+',
      name,
      match: match.match,
      evidence: match.evidence,
      scope: installed.get(name) ?? null,
      required,
      fingerprint: own,
      install: installed.has(name) || wasDeclined ? null : installCommand(name, placement),
      undo: installed.has(name) || wasDeclined ? null : removeCommand(name, placement),
    });
  }
  for (const name of weak) {
    if (skills[name] || !installed.has(name)) continue;
    skills[name] = { match: 'weak', evidence: ['suggested from description, not checked'], useWhen: null, required: false, scope: installed.get(name) };
    rows.push({ kind: '=', name, match: 'weak', evidence: ['suggested from description, not checked'], scope: installed.get(name), required: false, install: null, undo: null });
  }

  const profile = {
    version: PROFILE_VERSION,
    generatedBy: `onboard-project ${VERSION}`,
    scannedAt: new Date().toISOString(),
    placement,
    fingerprint,
    skills,
    declined,
  };

  const profileTarget = placement === 'committed'
    ? relative(root, profilePaths(root, { home }).committed)
    : localProfilePath(root, { home });
  rows.push({
    kind: '~',
    path: 'skills-profile.json',
    where: placement === 'committed' ? 'in this repository' : 'under your agents directory, not in this repository',
    absolute: placement === 'committed' ? profilePaths(root, { home }).committed : profileTarget,
    undo: placement === 'committed' ? 'delete it, or git revert' : 'delete the file under your agents directory',
  });
  rows.push({
    kind: '~',
    path: RULES_RELATIVE.split('\\').join('/'),
    absolute: rulesPath(root),
    undo: 'delete it, or git revert',
  });

  if (!hookInstalled({ home })) {
    rows.push({
      kind: '!',
      name: 'session-start check',
      note: 'affects all projects on this machine, not only this one',
      command: `node ${join(pack, 'skills', 'onboard-project', 'scripts', 'install-check-hook.mjs')}`,
      undo: `node ${join(pack, 'skills', 'onboard-project', 'scripts', 'install-check-hook.mjs')} --remove`,
    });
  }

  return { repo: root, placement, why, rows, profile, fingerprint, counts: counts.known ? 'read' : 'unknown' };
}

function renderPlan(plan) {
  const lines = [`onboard-project: ${plan.repo}`, `placement: ${plan.placement} — ${plan.why}`];
  if (plan.counts === 'unknown') lines.push('session history: none on this machine, so history signals are unknown rather than unmet');
  lines.push('');
  for (const row of plan.rows) {
    if (row.kind === '+') {
      lines.push(`+ ${row.name}  (${row.match})  ${row.evidence.join('; ') || 'a default for any repository'}`);
      lines.push(`    install: ${row.install}`);
      lines.push(`    undo:    ${row.undo}`);
    } else if (row.kind === '=') {
      lines.push(`= ${row.name}  (${row.match})  already installed${row.scope ? ` (${row.scope})` : ''}`);
    } else if (row.kind === 'declined') {
      lines.push(`  ${row.name}  declined earlier, and its evidence has not changed`);
    } else if (row.kind === '~') {
      lines.push(`~ write ${row.path}${row.where ? ` — ${row.where}` : ''}`);
      lines.push(`    undo:    ${row.undo}`);
    } else if (row.kind === '!') {
      lines.push(`! arm the ${row.name} — ${row.note}`);
      lines.push(`    command: ${row.command}`);
      lines.push(`    undo:    ${row.undo}`);
    }
  }
  lines.push('');
  lines.push('Nothing has been written. Run `apply --yes` to write the files, then run the commands above');
  lines.push('in order, and stop at the first failure.');
  return `${lines.join('\n')}\n`;
}

/* ------------------------------------------------------------------ the apply */

function excludeRules(repoRoot) {
  const exclude = join(resolve(repoRoot), '.git', 'info', 'exclude');
  const entry = `/${RULES_RELATIVE.split('\\').join('/')}`;
  try {
    if (!existsSync(join(resolve(repoRoot), '.git'))) return false;
    mkdirSync(join(resolve(repoRoot), '.git', 'info'), { recursive: true });
    const current = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
    if (current.includes(entry)) return true;
    appendFileSync(exclude, `${current.endsWith('\n') || current === '' ? '' : '\n'}${entry}\n`);
    return true;
  } catch {
    return false;
  }
}

function applyPlan(plan, { home = homedir() } = {}) {
  const written = [];
  const failed = [];
  if (!writeProfile(plan.repo, plan.profile, { home })) failed.push('the profile');
  else written.push(plan.placement === 'committed' ? 'skills-profile.json' : 'the profile under your agents directory');
  if (failed.length === 0) {
    if (!writeTextAtomically(rulesPath(plan.repo), renderRules(plan.profile))) failed.push(RULES_RELATIVE);
    else written.push(RULES_RELATIVE);
  }
  let excluded = false;
  if (failed.length === 0 && plan.placement === 'local') excluded = excludeRules(plan.repo);
  return { written, failed, excluded };
}

/* ------------------------------------------------------------------ the check */

/** Remembers that onboarding was suggested here once, so it is not suggested every session. */
function suggestionMarker(repoRoot, { home }) {
  return localProfilePath(repoRoot, { home });
}

/**
 * Everything the check can say, in order of how much it matters. It returns at most ONE line: a
 * session-start hook that writes a paragraph is a session-start hook that gets removed.
 */
export function checkRepository(repoRoot, { home = homedir(), pack = PACK_ROOT } = {}) {
  const root = resolve(repoRoot);
  if (!existsSync(root)) return null;
  const profile = readProfile(root, { home });
  // The marker written by an earlier suggestion lives where a local profile would: it says
  // "already suggested here", and reading it as a profile would make the check complain about a
  // rules file that no onboarding ever wrote.
  if (!profile || (profile.onboarding && !profile.skills)) {
    const index = repoIndex(root);
    if (!isGitRepository(root) || index.files.length === 0) return null;
    const marker = suggestionMarker(root, { home });
    if (existsSync(marker)) return null;
    writeJsonAtomically(marker, { version: PROFILE_VERSION, onboarding: 'suggested', at: new Date().toISOString() });
    return 'onboard-project: this repository has no skills profile. Run the onboard-project skill to choose and wire its skills.';
  }

  const problems = [];
  const required = Object.entries(profile.skills ?? {}).filter(([, entry]) => entry?.required).map(([name]) => name);
  const installed = installedSkills({ repoRoot: root, home });
  const missing = required.filter((name) => !installed.has(name));
  if (missing.length > 0) problems.push(`${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} listed for this project but not installed`);

  const { fingerprint } = scan(root, { home, counts: null, pack });
  if (profile.fingerprint && fingerprint !== profile.fingerprint) problems.push("this repository's evidence has changed since the profile was written");

  if (rulesDrifted(root, profile)) problems.push(`${RULES_RELATIVE.split('\\').join('/')} no longer matches the profile`);

  if (problems.length === 0) return null;
  return `onboard-project: ${problems.join('; ')} — run the onboard-project skill (refresh) to review.`;
}

/* ------------------------------------------------------------------ the entry point */

/** The hook payload on stdin, when there is one. A hook that waits on a pipe nobody writes to is
 *  a hook that hangs a session start, so this gives up quickly and carries on. */
async function readPayload(stream) {
  if (!stream || stream.isTTY) return null;
  return new Promise((settle) => {
    let source = '';
    const finish = () => {
      clearTimeout(timer);
      try {
        settle(JSON.parse(source));
      } catch {
        settle(null);
      }
    };
    const timer = setTimeout(() => {
      stream.removeAllListeners('data');
      settle(null);
    }, 500);
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => { source += chunk; });
    stream.on('end', finish);
    stream.on('error', () => {
      clearTimeout(timer);
      settle(null);
    });
  });
}

function parse(argv) {
  const options = { command: argv[0], repo: null, json: false, yes: false, hook: false, weak: [] };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--repo') options.repo = argv[index += 1];
    else if (argument === '--json') options.json = true;
    else if (argument === '--yes') options.yes = true;
    else if (argument === '--hook') options.hook = true;
    else if (argument === '--weak') options.weak = String(argv[index += 1] ?? '').split(',').map((name) => name.trim()).filter(Boolean);
    else if (argument === '--pack') options.pack = argv[index += 1];
    else throw new Error(`unknown option: ${argument}`);
  }
  return options;
}

export async function main(argv, { stdout = process.stdout, stderr = process.stderr, stdin = process.stdin, home = homedir() } = {}) {
  let options;
  try {
    options = parse(argv);
  } catch (error) {
    stderr.write(`${error.message}\n${USAGE}\n`);
    return 1;
  }
  const pack = options.pack ? resolve(options.pack) : PACK_ROOT;

  if (options.command === 'check') {
    // Fails open, always: this runs at session start, and an error here must cost nothing.
    let line = null;
    try {
      const payload = options.repo ? null : await readPayload(stdin);
      const start = options.repo ?? payload?.cwd ?? process.cwd();
      line = checkRepository(options.repo ? start : findRepoRoot(start), { home, pack });
    } catch {
      return 0;
    }
    if (!line) return 0;
    stdout.write(options.hook
      ? `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: line } })}\n`
      : `${line}\n`);
    return 0;
  }

  if (options.command === 'plan' || options.command === 'apply') {
    options.repo = options.repo ?? findRepoRoot(process.cwd());
    if (!existsSync(resolve(options.repo))) {
      stderr.write(`no such directory: ${options.repo}\n`);
      return 1;
    }
    const plan = buildPlan(options.repo, { home, pack, weak: options.weak });
    if (options.command === 'plan') {
      stdout.write(options.json ? `${JSON.stringify(plan, null, 2)}\n` : renderPlan(plan));
      return 0;
    }
    if (!options.yes) {
      stdout.write(`${renderPlan(plan)}\nNothing was written: re-run with --yes once the list above is what you want.\n`);
      return 0;
    }
    const result = applyPlan(plan, { home });
    const lines = [];
    for (const file of result.written) lines.push(`written: ${file}`);
    for (const file of result.failed) lines.push(`FAILED to write: ${file} — stopped here, nothing after this was applied`);
    if (result.excluded) lines.push(`.git/info/exclude now carries the rules file, so this repository stays clean (placement: local, not committed)`);
    const commands = plan.rows.filter((row) => row.install).map((row) => row.install);
    const hooks = plan.rows.filter((row) => row.kind === '!').map((row) => row.command);
    if (commands.length > 0 || hooks.length > 0) {
      lines.push('');
      lines.push('Now run these, in order, and stop at the first failure:');
      for (const command of [...commands, ...hooks]) lines.push(`  ${command}`);
    }
    stdout.write(`${lines.join('\n')}\n`);
    return result.failed.length > 0 ? 1 : 0;
  }

  stderr.write(`${USAGE}\n`);
  return 1;
}

/**
 * Whether this file is the program being run.
 *
 * `process.argv[1]` is the path as typed — through a symlinked install, that is the link — while
 * `import.meta.url` is what Node resolved it to, so comparing them as written is false on every
 * symlinked install and `main()` silently never runs. Both sides are resolved, because under
 * `--preserve-symlinks-main` it is `import.meta.url` that keeps the link; `realpathSync.native`
 * because it also returns the on-disk case, and a case-insensitive volume hands the JS
 * implementation back a differently-cased path that compares unequal. Resolving can throw, and a
 * guard that throws at load turns an import into a crash, so a failure falls back to the plain
 * comparison, which is right when no link is in play.
 */
export function isEntrypoint(moduleUrl) {
  const invoked = process.argv[1];
  if (!invoked) return false;
  const modulePath = fileURLToPath(moduleUrl);
  try {
    return realpathSync.native(invoked) === realpathSync.native(modulePath);
  } catch {
    return resolve(invoked) === modulePath;
  }
}

if (isEntrypoint(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
