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
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateRepoSignals, forgetRepoIndex, loadCatalogue, repoIndex, signalId } from './fit.mjs';
import { historyCounts } from './history.mjs';
import {
  PROFILE_VERSION,
  RULES_RELATIVE,
  fingerprintOf,
  installedSkills,
  localProfilePath,
  profilePaths,
  readProfile,
  readSuggestionMarker,
  renderRules,
  rulesDrifted,
  rulesPath,
  userConfig,
  writeProfile,
  writeSuggestionMarker,
  writeTextAtomically,
} from './profile.mjs';

const PACK_ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const PACK_SOURCE = 'crissmoldovan/agent-skills';
const VERSION = '1.0.1';

const USAGE = `Usage: onboard.mjs plan  [--repo <path>] [--json] [--weak <names>] [--drop <names>] [--decline <names>]
       onboard.mjs apply [--repo <path>] [--yes] [--weak <names>] [--drop <names>] [--decline <names>]
       onboard.mjs check [--repo <path>] [--hook]

plan   print the change list and write nothing.
apply  write the files the plan named, on --yes, and print the commands to run next. Stops at the
       first write that fails, and then prints no install or hook command at all.
check  say nothing unless a required skill is missing, the repository's evidence moved, or the
       generated rules file no longer matches its profile. --hook wraps that line in the
       SessionStart envelope. This command never reads session history.

--weak    a comma-separated list of installed skills the caller matched from their descriptions
          rather than from declared fit; they are listed as weaker, never marked required, and
          kept on every later apply until dropped.
--drop    remove these skills from the profile. A scan never removes a listed skill on its own:
          one whose evidence has gone is kept, with a row saying so, until it is dropped.
--decline record a no against each skill's own evidence, so it is not offered again until that
          evidence changes.`;

/* ------------------------------------------------------------------ the scan */

/** Plain code-point order. Nothing this skill writes may depend on the machine's locale. */
function byName(left, right) {
  return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
}

/**
 * Where git keeps this checkout's metadata: `gitDir` for this working tree, `commonDir` for what
 * every working tree of the repository shares — the config holding `origin`, and `info/exclude`.
 *
 * In a linked worktree `.git` is a FILE naming the gitdir, and that gitdir holds no config: 0.22.0
 * looked for one there, found nothing, and reported "no origin remote" for every worktree of a
 * repository that plainly has one — so placement silently fell back to local.
 */
export function gitDirs(repoRoot) {
  const root = resolve(repoRoot);
  const dotGit = join(root, '.git');
  try {
    if (statSync(dotGit).isDirectory()) return { gitDir: dotGit, commonDir: dotGit };
    const pointer = readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+)$/m);
    if (!pointer) return null;
    const gitDir = resolve(root, pointer[1].trim());
    let commonDir = gitDir;
    try {
      commonDir = resolve(gitDir, readFileSync(join(gitDir, 'commondir'), 'utf8').trim());
    } catch {
      // No commondir file: this gitdir is the common directory.
    }
    return { gitDir, commonDir };
  } catch {
    return null;
  }
}

/** The origin owner, read out of the repository's shared config rather than by spawning git. */
export function originOwner(repoRoot) {
  const dirs = gitDirs(repoRoot);
  if (!dirs) return null;
  try {
    const source = readFileSync(join(dirs.commonDir, 'config'), 'utf8');
    const url = source.match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/s)?.[1];
    if (!url) return null;
    return url.match(/[:/]([^/:]+)\/[^/]+?(?:\.git)?$/)?.[1] ?? null;
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
 * all — `check` never does.
 *
 * THE EVIDENCE IS KEPT PER SKILL, AND PER SIGNAL. 0.22.0 kept one fingerprint over every skill in
 * the catalogue, so installing or updating any skill that carries a fit.json changed it — and the
 * armed check told the user their repository had changed when only the catalogue had. A hash per
 * skill was still not enough: an update that edits one of a skill's signals changes that hash too.
 * `evidence` records, for each evaluated skill, the repository signals it was evaluated on and the
 * ones that were true; the check compares only signals both versions define and could read, so a
 * catalogue or a fit.json can change under a profile without the repository being blamed.
 */
export function scan(repoRoot, { home = homedir(), counts = null, pack = PACK_ROOT } = {}) {
  forgetRepoIndex(repoRoot);
  const catalogue = loadCatalogue(pack);
  const matches = new Map();
  const repoOnlyTrue = {};
  const evidence = {};
  const repoUnknown = {};
  const unmatchedUnknown = {};
  for (const [name, fit] of catalogue) {
    if (fit.kind === 'requestOnly') continue;
    if (fit.kind === 'general') {
      matches.set(name, { match: 'general', evidence: [], useWhen: fit.useWhen, trueSignals: [], unknownSignals: [] });
      continue;
    }
    const withHistory = evaluateRepoSignals(fit, repoRoot, { counts });
    const repoOnly = evaluateRepoSignals(fit, repoRoot, { counts: null });
    if (repoOnly.trueSignals.length > 0) repoOnlyTrue[name] = repoOnly.trueSignals;
    const listed = Array.isArray(fit.allOf) ? fit.allOf : Array.isArray(fit.anyOf) ? fit.anyOf : [];
    evidence[name] = {
      signals: [...new Set(listed.map(signalId).filter((id) => !id.startsWith('history:')))].sort(),
      true: [...repoOnly.trueSignals].sort(),
    };
    // History signals are always unknown in a repo-only pass; only a repository signal the scan
    // could not read makes this skill's evidence unreadable.
    repoUnknown[name] = repoOnly.unknownSignals.filter((id) => !id.startsWith('history:'));
    if (!withHistory.matched) {
      unmatchedUnknown[name] = withHistory.unknownSignals;
      continue;
    }
    matches.set(name, {
      match: 'strong',
      evidence: withHistory.evidence,
      useWhen: fit.useWhen,
      trueSignals: withHistory.trueSignals,
      unknownSignals: withHistory.unknownSignals,
    });
  }
  return { catalogue, matches, fingerprint: fingerprintOf(repoOnlyTrue), repoOnlyTrue, evidence, repoUnknown, unmatchedUnknown };
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
 *
 * A SKILL THE PROFILE ALREADY LISTS IS NEVER REMOVED BY A SCAN. 0.22.0 rebuilt the list from the
 * current scan alone, so a skill whose evidence had gone — or a weak one nobody re-passed — simply
 * vanished from the profile and the routing file, with no row and no word in the apply report.
 * Now it stays, with a `-` row saying its evidence is gone and how to remove it (`--drop`), or a
 * `?` row when its evidence could not be read here at all.
 */
export function buildPlan(repoRoot, { home = homedir(), pack = PACK_ROOT, weak = [], drop = [], decline = [] } = {}) {
  const root = resolve(repoRoot);
  const counts = historyCounts(root, { home });
  const { catalogue, matches, fingerprint, repoOnlyTrue, evidence, repoUnknown, unmatchedUnknown } = scan(root, { home, counts, pack });
  const existing = readProfile(root, { home });
  const fresh = resolvePlacement(root, { home });
  const placement = existing?.placement ?? fresh.placement;
  const why = existing?.placement ? "the placement recorded in this repository's profile" : fresh.why;
  const installed = installedSkills({ repoRoot: root, home });
  const declined = { ...(existing?.declined ?? {}) };
  const ownFingerprint = (name) => fingerprintOf({ [name]: repoOnlyTrue[name] ?? [] });

  // A decline is recorded against the skill's own evidence, so it holds until that evidence moves.
  for (const name of decline) {
    if (!matches.has(name)) continue;
    declined[name] = { at: new Date().toISOString().slice(0, 10), fingerprint: ownFingerprint(name) };
  }

  const rows = [];
  const skills = {};
  const handled = new Set();
  for (const [name, match] of [...matches].sort(byName)) {
    handled.add(name);
    const own = ownFingerprint(name);
    const wasDeclined = declined[name]?.fingerprint === own;
    const scope = installed.get(name) ?? (placement === 'committed' ? 'project' : 'global');
    const required = match.match === 'strong';
    if (drop.includes(name) && !wasDeclined) {
      rows.push({
        kind: '-', name, match: match.match, evidence: match.evidence, scope: installed.get(name) ?? null, required, fingerprint: own,
        note: 'left out on request; it still matches, so it will be offered again — pass --decline to stop that',
        install: null, undo: null,
      });
      continue;
    }
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

  for (const [name, entry] of Object.entries(existing?.skills ?? {}).sort(byName)) {
    if (handled.has(name)) continue;
    handled.add(name);
    const base = { name, match: entry.match, evidence: entry.evidence ?? [], scope: installed.get(name) ?? entry.scope ?? null, required: Boolean(entry.required), install: null, undo: null };
    if (drop.includes(name)) {
      rows.push({ ...base, kind: '-', note: 'removed on request' });
      continue;
    }
    if (decline.includes(name)) {
      declined[name] = { at: new Date().toISOString().slice(0, 10), fingerprint: ownFingerprint(name) };
      rows.push({ ...base, kind: '-', note: 'declined: removed, and not offered again until its evidence changes' });
      continue;
    }
    skills[name] = entry;
    if (entry.match === 'weak') {
      rows.push({ ...base, kind: '=', note: 'kept from the profile: suggested from its description, not checked' });
      continue;
    }
    // Unreadable only when the KIND of evidence that put it in the profile cannot be read now: a
    // repository signal the scan was bounded out of, or history on a machine that has none. A skill
    // listed for a manifest field that has since been deleted is gone, not unknown, whatever this
    // machine's history holds.
    const historyUnreadable = (unmatchedUnknown[name] ?? []).some((id) => id.startsWith('history:'));
    const listedForHistory = (entry.evidence ?? []).some((line) => /in this repository's history/.test(line));
    const unreadable = (repoUnknown[name] ?? []).length > 0 || (historyUnreadable && listedForHistory);
    rows.push({
      ...base,
      kind: unreadable ? '?' : '-',
      note: !catalogue.has(name)
        ? `no longer in the catalogue — kept; pass --drop ${name} to remove it`
        : unreadable
          ? 'its evidence could not be read here (no session history on this machine, or a bounded scan) — kept'
          : `its evidence is no longer found — kept; pass --drop ${name} to remove it`,
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
    evidence,
    skills,
    declined,
  };

  const profileTarget = placement === 'committed' ? profilePaths(root, { home }).committed : localProfilePath(root, { home });
  rows.push({
    kind: '~',
    path: 'skills-profile.json',
    where: placement === 'committed' ? 'in this repository' : 'under your agents directory, not in this repository',
    absolute: profileTarget,
    undo: placement === 'committed' ? 'delete it, or git revert' : 'delete the file under your agents directory',
  });
  // The routing file is generated, but a person or a formatter can still have touched it. Its row
  // says so and carries the lines that would change, so a rewrite is never a quiet one.
  const rulesRow = { kind: '~', path: RULES_RELATIVE.split('\\').join('/'), absolute: rulesPath(root), undo: 'delete it, or git revert' };
  let rulesNow = null;
  try {
    rulesNow = readFileSync(rulesPath(root), 'utf8');
  } catch {
    // Not there yet: a new file.
  }
  const rulesNext = renderRules(profile);
  if (rulesNow === null) {
    rulesRow.where = 'a new file';
  } else if (rulesNow !== rulesNext) {
    const before = rulesNow.split('\n').filter(Boolean);
    const after = rulesNext.split('\n').filter(Boolean);
    rulesRow.where = 'the file on disk no longer matches what this plan would write — the lines below change';
    rulesRow.diff = { removed: before.filter((line) => !after.includes(line)), added: after.filter((line) => !before.includes(line)) };
  } else {
    rulesRow.where = 'unchanged';
  }
  rows.push(rulesRow);
  const dirs = gitDirs(root);
  if (placement === 'local' && dirs) {
    rows.push({
      kind: '~',
      path: '.git/info/exclude',
      where: `one line, ${EXCLUDE_ENTRY}, so the routing file stays out of git status`,
      absolute: join(dirs.commonDir, 'info', 'exclude'),
      undo: 'remove that line',
    });
  }

  if (!hookInstalled({ home })) {
    rows.push({
      kind: '!',
      name: 'session-start check',
      note: 'affects all projects on this machine, not only this one',
      command: `node ${join(pack, 'skills', 'onboard-project', 'scripts', 'install-check-hook.mjs')}`,
      undo: `node ${join(pack, 'skills', 'onboard-project', 'scripts', 'install-check-hook.mjs')} --remove`,
    });
  }

  return { repo: root, placement, why, rows, profile, fingerprint, counts: counts.known ? (counts.truncated ? 'partial' : 'read') : 'unknown' };
}

function renderPlan(plan) {
  const lines = [`onboard-project: ${plan.repo}`, `placement: ${plan.placement} — ${plan.why}`];
  if (plan.counts === 'unknown') lines.push('session history: none on this machine, so history signals are unknown rather than unmet');
  if (plan.counts === 'partial') lines.push('session history: read only in part, so a history signal short of its threshold is unknown rather than unmet');
  lines.push('');
  for (const row of plan.rows) {
    if (row.kind === '+') {
      lines.push(`+ ${row.name}  (${row.match})  ${row.evidence.join('; ') || 'a default for any repository'}`);
      lines.push(`    install: ${row.install}`);
      lines.push(`    undo:    ${row.undo}`);
    } else if (row.kind === '=') {
      lines.push(`= ${row.name}  (${row.match})  ${row.note ?? 'already installed'}${!row.note && row.scope ? ` (${row.scope})` : ''}`);
    } else if (row.kind === '-' || row.kind === '?') {
      lines.push(`${row.kind} ${row.name}  (${row.match})  ${row.note}`);
    } else if (row.kind === 'declined') {
      lines.push(`  ${row.name}  declined earlier, and its evidence has not changed`);
    } else if (row.kind === '~') {
      lines.push(`~ write ${row.path}${row.where ? ` — ${row.where}` : ''}`);
      for (const line of row.diff?.removed ?? []) lines.push(`    removes: ${line}`);
      for (const line of row.diff?.added ?? []) lines.push(`    adds:    ${line}`);
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

const EXCLUDE_ENTRY = `/${RULES_RELATIVE.split('\\').join('/')}`;

/** One line in the repository's shared `info/exclude`, where git reads it for every worktree. */
function excludeRules(repoRoot) {
  const dirs = gitDirs(repoRoot);
  if (!dirs) return false;
  const exclude = join(dirs.commonDir, 'info', 'exclude');
  try {
    mkdirSync(join(dirs.commonDir, 'info'), { recursive: true });
    const current = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
    if (current.split(/\r?\n/).includes(EXCLUDE_ENTRY)) return true;
    appendFileSync(exclude, `${current.endsWith('\n') || current === '' ? '' : '\n'}${EXCLUDE_ENTRY}\n`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every write the plan named, in order, stopping at the first that fails. The exclude line is one
 * of them: 0.22.0 swallowed its failure and exited 0, leaving the routing file untracked in a
 * repository whose whole reason for a local placement was to stay clean.
 */
function applyPlan(plan, { home = homedir() } = {}) {
  const steps = [
    { label: plan.placement === 'committed' ? 'skills-profile.json' : 'the profile under your agents directory', run: () => writeProfile(plan.repo, plan.profile, { home }) },
    { label: RULES_RELATIVE.split('\\').join('/'), run: () => writeTextAtomically(rulesPath(plan.repo), renderRules(plan.profile)) },
  ];
  if (plan.placement === 'local' && gitDirs(plan.repo)) steps.push({ label: '.git/info/exclude', run: () => excludeRules(plan.repo) });
  const written = [];
  const failed = [];
  for (const step of steps) {
    if (step.run()) {
      written.push(step.label);
    } else {
      failed.push(step.label);
      break;
    }
  }
  return { written, failed, unapplied: steps.slice(written.length + failed.length).map((step) => step.label) };
}

/* ------------------------------------------------------------------ the check */

/**
 * Everything the check can say, in order of how much it matters. It returns at most ONE line: a
 * session-start hook that writes a paragraph is a session-start hook that gets removed.
 */
export function checkRepository(repoRoot, { home = homedir(), pack = PACK_ROOT } = {}) {
  const root = resolve(repoRoot);
  if (!existsSync(root)) return null;
  const profile = readProfile(root, { home });
  if (!profile) {
    const index = repoIndex(root);
    if (!isGitRepository(root) || index.files.length === 0) return null;
    if (readSuggestionMarker(root, { home })) return null;
    writeSuggestionMarker(root, { home });
    return 'onboard-project: this repository has no skills profile. Run the onboard-project skill to choose and wire its skills.';
  }

  const problems = [];
  const required = Object.entries(profile.skills ?? {}).filter(([, entry]) => entry?.required).map(([name]) => name);
  const installed = installedSkills({ repoRoot: root, home });
  const missing = required.filter((name) => !installed.has(name)).sort();
  if (missing.length > 0) problems.push(`${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} listed for this project but not installed`);

  // A profile written before per-skill evidence existed has nothing this check can compare fairly:
  // its one fingerprint moves whenever the catalogue does. It says nothing until a refresh writes one.
  if (profile.evidence && typeof profile.evidence === 'object') {
    const { evidence, repoUnknown } = scan(root, { home, counts: null, pack });
    const moved = Object.entries(profile.evidence)
      .filter(([name, before]) => {
        const now = evidence[name];
        if (!now || !Array.isArray(before?.signals) || !Array.isArray(before?.true)) return false;
        const unreadable = new Set(repoUnknown[name] ?? []);
        const shared = new Set(before.signals.filter((id) => now.signals.includes(id) && !unreadable.has(id)));
        const was = before.true.filter((id) => shared.has(id)).sort().join('\n');
        const is = now.true.filter((id) => shared.has(id)).sort().join('\n');
        return was !== is;
      })
      .map(([name]) => name)
      .sort();
    if (moved.length > 0) problems.push(`the evidence for ${moved.join(', ')} has changed since the profile was written`);
  }

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

const list = (value) => String(value ?? '').split(',').map((name) => name.trim()).filter(Boolean);

function parse(argv) {
  const options = { command: argv[0], repo: null, json: false, yes: false, hook: false, weak: [], drop: [], decline: [] };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${argument} needs a value`);
      index += 1;
      return next;
    };
    if (argument === '--repo') options.repo = value();
    else if (argument === '--json') options.json = true;
    else if (argument === '--yes') options.yes = true;
    else if (argument === '--hook') options.hook = true;
    else if (argument === '--weak') options.weak = list(value());
    else if (argument === '--drop') options.drop = list(value());
    else if (argument === '--decline') options.decline = list(value());
    else if (argument === '--pack') options.pack = value();
    else throw new Error(`unknown option: ${argument}`);
  }
  return options;
}

export async function main(argv, { stdout = process.stdout, stderr = process.stderr, stdin = process.stdin, home = homedir() } = {}) {
  let options;
  try {
    options = parse(argv);
  } catch (error) {
    if (argv[0] === 'check') return 0; // the check fails open, even on a malformed command line
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
    const plan = buildPlan(options.repo, { home, pack, weak: options.weak, drop: options.drop, decline: options.decline });
    const named = new Set(plan.rows.map((row) => row.name).filter(Boolean));
    for (const name of [...options.drop, ...options.decline]) {
      if (!named.has(name)) stderr.write(`ignored: ${name} is neither offered nor listed for this repository\n`);
    }
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
    if (result.failed.length > 0) {
      // Nothing after a failure is handed over. 0.22.0 printed the full install and hook list right
      // after "stopped here", and an agent following printed instructions would have installed
      // skills and armed a machine-wide hook for a wiring that was never completed.
      for (const file of result.failed) lines.push(`FAILED to write: ${file} — stopped here`);
      if (result.unapplied.length > 0) lines.push(`not attempted: ${result.unapplied.join(', ')}`);
      lines.push('No installs or hooks should be run until this is fixed and apply has been run again.');
      stdout.write(`${lines.join('\n')}\n`);
      return 1;
    }
    if (result.written.includes('.git/info/exclude')) {
      lines.push('.git/info/exclude now carries the rules file, so this repository stays clean (placement: local, not committed)');
    }
    const commands = plan.rows.filter((row) => row.install).map((row) => row.install);
    const hooks = plan.rows.filter((row) => row.kind === '!').map((row) => row.command);
    if (commands.length > 0 || hooks.length > 0) {
      lines.push('');
      lines.push('Now run these, in order, and stop at the first failure:');
      for (const command of [...commands, ...hooks]) lines.push(`  ${command}`);
    }
    stdout.write(`${lines.join('\n')}\n`);
    return 0;
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
