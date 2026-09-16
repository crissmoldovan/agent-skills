import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers/temp-dir.mjs';
import { localProfilePath } from '../skills/onboard-project/scripts/profile.mjs';

const packRoot = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(packRoot, 'skills', 'onboard-project', 'scripts', 'onboard.mjs');

const scratch = (name) => tempDir(`${name}-`);

function run(args, { home, cwd } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: cwd ?? packRoot,
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

/** A repository that a release-notes signal matches, with no git metadata unless asked for. */
async function repository(name, { git = true, origin = 'https://github.com/an-owner/a-repo.git' } = {}) {
  const root = await scratch(name);
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'a-repo', version: '1.0.0' }, null, 2));
  await writeFile(path.join(root, 'README.md'), '# A repo\n');
  if (git) {
    await mkdir(path.join(root, '.git'), { recursive: true });
    await writeFile(path.join(root, '.git', 'config'), `[remote "origin"]\n\turl = ${origin}\n`);
  }
  return root;
}

const planJson = async (repo, home, extra = []) => {
  const result = await run(['plan', '--repo', repo, '--json', ...extra], { home });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

test('plan recommends a skill from declared fit, with the evidence that justified it', async () => {
  const repo = await repository('onboard-plan');
  const home = await scratch('onboard-plan-home');
  const result = await run(['plan', '--repo', repo], { home });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\+ release-notes/);
  assert.match(result.stdout, /package\.json has a version/);
  assert.match(result.stdout, /npx skills add/);
  assert.match(result.stdout, /Nothing has been written/);
});

test('plan writes nothing at all', async () => {
  const repo = await repository('onboard-plan-readonly');
  const home = await scratch('onboard-plan-readonly-home');
  await run(['plan', '--repo', repo], { home });
  assert.equal(existsSync(path.join(repo, 'skills-profile.json')), false);
  assert.equal(existsSync(path.join(repo, '.claude', 'rules', 'skill-routing.md')), false);
});

test('an already-installed skill is listed, not offered', async () => {
  const repo = await repository('onboard-installed');
  const home = await scratch('onboard-installed-home');
  await writeFile(path.join(repo, 'skills-lock.json'), JSON.stringify({ version: 1, skills: { 'release-notes': { source: 'x' } } }));

  const plan = await planJson(repo, home);
  const row = plan.rows.find((entry) => entry.name === 'release-notes');
  assert.equal(row.kind, '=');
  assert.equal(row.scope, 'project');
  assert.ok(!row.install, 'an installed skill was given an install command');
});

test('the files it would write are rows of their own, each with its undo', async () => {
  const repo = await repository('onboard-writes');
  const home = await scratch('onboard-writes-home');
  const plan = await planJson(repo, home);
  const writes = plan.rows.filter((row) => row.kind === '~').map((row) => row.path);
  // A local placement in a git repository also appends one line to .git/info/exclude, and the
  // change list the user says yes to has to name it.
  assert.deepEqual(writes.sort(), ['.claude/rules/skill-routing.md', '.git/info/exclude', 'skills-profile.json']);
  for (const row of plan.rows.filter((entry) => entry.kind === '~')) assert.ok(row.undo, `${row.path} has no undo`);
});

test('a hook is a row of its own and says it affects all projects', async () => {
  const repo = await repository('onboard-hook-row');
  const home = await scratch('onboard-hook-row-home');
  const plan = await planJson(repo, home);
  const hook = plan.rows.find((row) => row.kind === '!');
  assert.ok(hook, 'no hook row');
  assert.match(hook.note, /affects all projects/i);
  assert.match(hook.command, /install-check-hook\.mjs/);
  assert.match(hook.undo, /--remove/);
});

test('placement follows the origin owner, and a repository with no git stays local', async () => {
  const home = await scratch('onboard-placement-home');
  const stranger = await repository('onboard-placement-stranger');
  assert.equal((await planJson(stranger, home)).placement, 'local');

  await mkdir(path.join(home, '.agents'), { recursive: true });
  await writeFile(path.join(home, '.agents', 'onboard-project.json'), JSON.stringify({ commitOwners: ['an-owner'] }));
  assert.equal((await planJson(stranger, home)).placement, 'committed');

  const noGit = await repository('onboard-placement-nogit', { git: false });
  assert.equal((await planJson(noGit, home)).placement, 'local');
});

test('a declined skill is not offered again until its own evidence changes', async () => {
  const repo = await repository('onboard-declined');
  const home = await scratch('onboard-declined-home');
  const before = await planJson(repo, home);
  const declinedFingerprint = before.rows.find((row) => row.name === 'release-notes').fingerprint;
  assert.ok(declinedFingerprint, 'a row carries no fingerprint of its own evidence');

  await writeFile(path.join(repo, 'skills-profile.json'), JSON.stringify({
    version: 1,
    placement: 'committed',
    skills: {},
    declined: { 'release-notes': { at: '2026-09-14', fingerprint: declinedFingerprint } },
  }));
  const after = await planJson(repo, home);
  assert.equal(after.rows.some((row) => row.name === 'release-notes' && row.kind === '+'), false);

  // Its evidence changes: a changeset directory appears, so the skill is offered again.
  await mkdir(path.join(repo, '.changeset'), { recursive: true });
  await writeFile(path.join(repo, '.changeset', 'config.json'), '{}');
  const later = await planJson(repo, home);
  assert.equal(later.rows.some((row) => row.name === 'release-notes' && row.kind === '+'), true);
});

test('apply writes nothing without a yes, and exactly the planned files with one', async () => {
  const repo = await repository('onboard-apply');
  const home = await scratch('onboard-apply-home');
  await mkdir(path.join(home, '.agents'), { recursive: true });
  await writeFile(path.join(home, '.agents', 'onboard-project.json'), JSON.stringify({ commitOwners: ['an-owner'] }));

  const dry = await run(['apply', '--repo', repo], { home });
  assert.equal(dry.status, 0);
  assert.match(dry.stdout, /--yes/);
  assert.equal(existsSync(path.join(repo, 'skills-profile.json')), false);

  const applied = await run(['apply', '--repo', repo, '--yes'], { home });
  assert.equal(applied.status, 0, applied.stderr);
  const profile = JSON.parse(await readFile(path.join(repo, 'skills-profile.json'), 'utf8'));
  assert.equal(profile.placement, 'committed');
  assert.ok(profile.skills['release-notes'], 'the matched skill is not in the profile');
  assert.ok(profile.fingerprint, 'no fingerprint was recorded');

  const rules = await readFile(path.join(repo, '.claude', 'rules', 'skill-routing.md'), 'utf8');
  assert.match(rules, /Generated by onboard-project/);
  assert.match(rules, /`release-notes`/);

  // The install commands are printed for the caller to run, in the plan's order.
  assert.match(applied.stdout, /npx skills add .* release-notes/);
  assert.match(applied.stdout, /in order, and stop at the first failure/i);
});

test('applying twice changes nothing the second time', async () => {
  const repo = await repository('onboard-apply-twice');
  const home = await scratch('onboard-apply-twice-home');
  await run(['apply', '--repo', repo, '--yes'], { home });
  const first = await readFile(localProfilePath(repo, { home }), 'utf8');
  const second = await run(['apply', '--repo', repo, '--yes'], { home });
  assert.equal(second.status, 0);
  const again = await readFile(localProfilePath(repo, { home }), 'utf8');
  assert.equal(JSON.parse(first).fingerprint, JSON.parse(again).fingerprint);
});

test('a local placement keeps the repository clean and says where the profile went', async () => {
  const repo = await repository('onboard-local');
  const home = await scratch('onboard-local-home');
  const applied = await run(['apply', '--repo', repo, '--yes'], { home });
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(existsSync(path.join(repo, 'skills-profile.json')), false, 'a local placement committed a file');
  assert.ok(existsSync(path.join(home, '.agents', 'project-profiles')), 'no local profile was written');
  // The rules file is still written: it is what makes the skills visible in this repository.
  assert.ok(existsSync(path.join(repo, '.claude', 'rules', 'skill-routing.md')));
  assert.match(applied.stdout, /git\/info\/exclude|not committed/i);
});

test('check is silent when the profile, the signals, the skills and the rules all agree', async () => {
  const repo = await repository('onboard-check-silent');
  const home = await scratch('onboard-check-silent-home');
  await run(['apply', '--repo', repo, '--yes'], { home });
  // Install what the profile requires, so nothing is missing.
  const profile = JSON.parse(await readFile(localProfilePath(repo, { home }), 'utf8'));
  for (const [name, entry] of Object.entries(profile.skills)) {
    if (!entry.required) continue;
    await mkdir(path.join(home, '.claude', 'skills', name), { recursive: true });
    await writeFile(path.join(home, '.claude', 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
  }

  const check = await run(['check', '--repo', repo], { home });
  assert.equal(check.status, 0);
  assert.equal(check.stdout, '', 'the check spoke when it had nothing to say');
});

test('check says one line when a required skill is missing, the evidence moved, or the rules drifted', async () => {
  const repo = await repository('onboard-check-speaks');
  const home = await scratch('onboard-check-speaks-home');
  await run(['apply', '--repo', repo, '--yes'], { home });

  const missing = await run(['check', '--repo', repo], { home });
  assert.equal(missing.status, 0);
  assert.equal(missing.stdout.trimEnd().split('\n').length, 1, 'the check wrote more than one line');
  assert.match(missing.stdout, /release-notes/);

  // Satisfy the missing skill, then move the evidence.
  await mkdir(path.join(home, '.claude', 'skills', 'release-notes'), { recursive: true });
  await writeFile(path.join(home, '.claude', 'skills', 'release-notes', 'SKILL.md'), '---\nname: release-notes\n---\n');
  await mkdir(path.join(repo, '.changeset'), { recursive: true });
  await writeFile(path.join(repo, '.changeset', 'config.json'), '{}');
  const moved = await run(['check', '--repo', repo], { home });
  assert.match(moved.stdout, /refresh/i);
  assert.equal(moved.stdout.trimEnd().split('\n').length, 1);

  // Put the evidence back and hand-edit the rules file instead.
  await rm(path.join(repo, '.changeset'), { recursive: true, force: true });
  await writeFile(path.join(repo, '.claude', 'rules', 'skill-routing.md'), '# edited by hand\n');
  const drifted = await run(['check', '--repo', repo], { home });
  assert.match(drifted.stdout, /skill-routing\.md/);
});

test('check suggests onboarding once for a repository that has no profile at all', async () => {
  const repo = await repository('onboard-check-none');
  const home = await scratch('onboard-check-none-home');
  const first = await run(['check', '--repo', repo], { home });
  assert.match(first.stdout, /onboard-project/);
  assert.equal(first.stdout.trimEnd().split('\n').length, 1);

  const second = await run(['check', '--repo', repo], { home });
  assert.equal(second.stdout, '', 'the suggestion was repeated');
});

test('check fails open: a corrupt profile, an unreadable repository and a missing home each print nothing', async () => {
  const repo = await repository('onboard-check-open');
  const home = await scratch('onboard-check-open-home');
  await writeFile(path.join(repo, 'skills-profile.json'), '{ not json');
  const corrupt = await run(['check', '--repo', repo], { home });
  assert.equal(corrupt.status, 0);

  const absent = await run(['check', '--repo', path.join(repo, 'no-such-directory')], { home });
  assert.equal(absent.status, 0);
  assert.equal(absent.stdout, '');
});

test('--hook wraps the line in the SessionStart envelope, and stays empty when silent', async () => {
  const repo = await repository('onboard-check-hook');
  const home = await scratch('onboard-check-hook-home');
  await run(['apply', '--repo', repo, '--yes'], { home });

  const speaking = await run(['check', '--repo', repo, '--hook'], { home });
  const envelope = JSON.parse(speaking.stdout);
  assert.equal(envelope.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(envelope.hookSpecificOutput.additionalContext, /release-notes/);

  const profile = JSON.parse(await readFile(localProfilePath(repo, { home }), 'utf8'));
  for (const [name, entry] of Object.entries(profile.skills)) {
    if (!entry.required) continue;
    await mkdir(path.join(home, '.claude', 'skills', name), { recursive: true });
    await writeFile(path.join(home, '.claude', 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
  }
  const silent = await run(['check', '--repo', repo, '--hook'], { home });
  assert.equal(silent.stdout, '', 'the hook emitted an envelope with nothing in it');
});

test('check never reads session history: the same answer with and without it', async () => {
  const repo = await repository('onboard-check-history');
  const home = await scratch('onboard-check-history-home');
  await run(['apply', '--repo', repo, '--yes'], { home });
  await mkdir(path.join(home, '.claude', 'skills', 'release-notes'), { recursive: true });
  await writeFile(path.join(home, '.claude', 'skills', 'release-notes', 'SKILL.md'), '---\nname: release-notes\n---\n');
  const without = await run(['check', '--repo', repo], { home });

  const history = path.join(home, '.claude', 'projects', repo.replace(/[^A-Za-z0-9]/g, '-'));
  await mkdir(history, { recursive: true });
  const dispatch = JSON.stringify({ message: { content: [{ type: 'tool_use', name: 'Agent', input: {} }] } });
  await writeFile(path.join(history, 's.jsonl'), `${new Array(50).fill(dispatch).join('\n')}\n`);
  const withHistory = await run(['check', '--repo', repo], { home });

  assert.equal(withHistory.stdout, without.stdout, 'history changed what the check said');
});

test('an unknown command explains itself and exits non-zero', async () => {
  const home = await scratch('onboard-usage-home');
  const result = await run(['sideways'], { home });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage/);
});


// ---- review of 0.22.0 ----------------------------------------------------------------------------

const git = (cwd, ...args) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
};

async function installRequired(home, profile) {
  for (const [name, entry] of Object.entries(profile.skills)) {
    if (!entry.required) continue;
    await mkdir(path.join(home, '.claude', 'skills', name), { recursive: true });
    await writeFile(path.join(home, '.claude', 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
  }
}

test('refresh never drops a listed skill silently: it keeps it and says its evidence is gone', async () => {
  const repo = await repository('onboard-refresh-keep');
  const home = await scratch('onboard-refresh-keep-home');
  await run(['apply', '--repo', repo, '--yes'], { home });

  // The evidence goes away: no version field any more.
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'a-repo' }, null, 2));
  const plan = await planJson(repo, home);
  const row = plan.rows.find((entry) => entry.name === 'release-notes');
  assert.ok(row, 'release-notes vanished from the change list without a row');
  assert.equal(row.kind, '-');
  assert.match(row.note, /--drop release-notes/);

  const kept = await run(['apply', '--repo', repo, '--yes'], { home });
  assert.equal(kept.status, 0, kept.stderr);
  const profile = JSON.parse(await readFile(localProfilePath(repo, { home }), 'utf8'));
  assert.ok(profile.skills['release-notes'], 'a plain apply removed a listed skill');
  assert.match(await readFile(path.join(repo, '.claude', 'rules', 'skill-routing.md'), 'utf8'), /`release-notes`/);

  const dropped = await run(['apply', '--repo', repo, '--yes', '--drop', 'release-notes'], { home });
  assert.equal(dropped.status, 0, dropped.stderr);
  const after = JSON.parse(await readFile(localProfilePath(repo, { home }), 'utf8'));
  assert.equal(after.skills['release-notes'], undefined, '--drop did not remove it');
  assert.doesNotMatch(await readFile(path.join(repo, '.claude', 'rules', 'skill-routing.md'), 'utf8'), /`release-notes`/);
});

test('a weak skill stays in the profile until it is dropped, whether or not --weak is passed again', async () => {
  const repo = await repository('onboard-weak-keep');
  const home = await scratch('onboard-weak-keep-home');
  await mkdir(path.join(home, '.claude', 'skills', 'some-local-skill'), { recursive: true });
  await writeFile(path.join(home, '.claude', 'skills', 'some-local-skill', 'SKILL.md'), '---\nname: some-local-skill\n---\n');

  await run(['apply', '--repo', repo, '--yes', '--weak', 'some-local-skill'], { home });
  await run(['apply', '--repo', repo, '--yes'], { home });
  const profile = JSON.parse(await readFile(localProfilePath(repo, { home }), 'utf8'));
  assert.equal(profile.skills['some-local-skill']?.match, 'weak', 'a weak skill vanished on the next apply');
});

test('--decline records a no against that skill\'s own evidence, so it is not offered again until the evidence moves', async () => {
  const repo = await repository('onboard-decline');
  const home = await scratch('onboard-decline-home');
  const declined = await run(['apply', '--repo', repo, '--yes', '--decline', 'release-notes'], { home });
  assert.equal(declined.status, 0, declined.stderr);
  const profile = JSON.parse(await readFile(localProfilePath(repo, { home }), 'utf8'));
  assert.equal(profile.skills['release-notes'], undefined);
  assert.match(profile.declined['release-notes']?.fingerprint ?? '', /^[0-9a-f]{64}$/);
  const plan = await planJson(repo, home);
  assert.equal(plan.rows.find((row) => row.name === 'release-notes')?.kind, 'declined');
});

test('placement inside a git worktree reads the origin the worktree shares with its repository', async () => {
  const parent = await scratch('onboard-worktree');
  const main = path.join(parent, 'main');
  await mkdir(main, { recursive: true });
  git(main, 'init', '-q');
  git(main, 'remote', 'add', 'origin', 'https://github.com/an-owner/a-repo.git');
  await writeFile(path.join(main, 'package.json'), JSON.stringify({ name: 'a-repo', version: '1.0.0' }));
  git(main, 'add', 'package.json');
  git(main, 'commit', '-q', '-m', 'init');
  const lane = path.join(parent, 'lane');
  git(main, 'worktree', 'add', '-q', lane);

  const home = await scratch('onboard-worktree-home');
  await mkdir(path.join(home, '.agents'), { recursive: true });
  await writeFile(path.join(home, '.agents', 'onboard-project.json'), JSON.stringify({ commitOwners: ['an-owner'] }));
  const plan = await planJson(lane, home);
  assert.equal(plan.placement, 'committed', `placement in a worktree was ${plan.placement}: ${plan.why}`);

  // And a local placement in a worktree writes its exclude line where git reads it: the common dir.
  const localHome = await scratch('onboard-worktree-local-home');
  const applied = await run(['apply', '--repo', lane, '--yes'], { home: localHome });
  assert.equal(applied.status, 0, applied.stderr);
  const exclude = await readFile(path.join(main, '.git', 'info', 'exclude'), 'utf8');
  assert.match(exclude, /^\/\.claude\/rules\/skill-routing\.md$/m);
  assert.equal(git(lane, 'status', '--porcelain'), '', 'the routing file shows up as untracked in the worktree');
});

test('a failed exclude write fails the apply, and no install command follows a failure', async () => {
  const repo = await repository('onboard-exclude-fails');
  const home = await scratch('onboard-exclude-fails-home');
  await writeFile(path.join(repo, '.git', 'info'), 'a file where a directory belongs\n');
  const applied = await run(['apply', '--repo', repo, '--yes'], { home });
  assert.equal(applied.status, 1, 'apply exited 0 with the exclude unwritten');
  assert.match(applied.stdout, /FAILED.*\.git\/info\/exclude/);
  assert.doesNotMatch(applied.stdout, /Now run these/);
  assert.doesNotMatch(applied.stdout, /npx skills add/);
});

test('a failed rules write stops the apply without handing over the install list', async () => {
  const repo = await repository('onboard-rules-fails');
  const home = await scratch('onboard-rules-fails-home');
  await writeFile(path.join(repo, '.claude'), 'a file where a directory belongs\n');
  const applied = await run(['apply', '--repo', repo, '--yes'], { home });
  assert.equal(applied.status, 1);
  assert.match(applied.stdout, /FAILED/);
  assert.doesNotMatch(applied.stdout, /Now run these/);
});

test('the check\'s own suggestion marker is not mistaken for a recorded placement', async () => {
  const repo = await repository('onboard-marker-plan');
  const home = await scratch('onboard-marker-plan-home');
  const suggested = await run(['check', '--repo', repo], { home });
  assert.match(suggested.stdout, /no skills profile/);
  const plan = await planJson(repo, home);
  assert.doesNotMatch(plan.why, /recorded/, `plan claims a recorded placement: ${plan.why}`);
});

test('a skill added to the catalogue is not reported as this repository\'s evidence changing', async () => {
  const repo = await repository('onboard-catalogue-moves');
  const home = await scratch('onboard-catalogue-moves-home');

  // Pack A: the shipped fits. Pack B: the same, plus one new skill whose signal is true here.
  const packA = await scratch('onboard-pack-a');
  for (const name of await readdir(path.join(packRoot, 'skills'))) {
    const fit = path.join(packRoot, 'skills', name, 'references', 'fit.json');
    if (!existsSync(fit)) continue;
    await mkdir(path.join(packA, 'skills', name, 'references'), { recursive: true });
    await cp(fit, path.join(packA, 'skills', name, 'references', 'fit.json'));
  }
  const packB = await scratch('onboard-pack-b');
  await cp(packA, packB, { recursive: true });
  await mkdir(path.join(packB, 'skills', 'brand-new-skill', 'references'), { recursive: true });
  await writeFile(path.join(packB, 'skills', 'brand-new-skill', 'references', 'fit.json'), JSON.stringify({
    version: 1, kind: 'signals', useWhen: 'a skill this repository has never been scanned for', anyOf: [{ repo: { exists: 'package.json' } }],
  }));

  await run(['apply', '--repo', repo, '--yes', '--pack', packA], { home });
  await installRequired(home, JSON.parse(await readFile(localProfilePath(repo, { home }), 'utf8')));
  assert.equal((await run(['check', '--repo', repo, '--pack', packA], { home })).stdout, '', 'not silent before the catalogue moved');

  const afterCatalogueMoved = await run(['check', '--repo', repo, '--pack', packB], { home });
  assert.equal(afterCatalogueMoved.stdout, '', `a new skill in the catalogue read as repository drift: ${afterCatalogueMoved.stdout}`);
});

test('a skill listed for its history reads as unreadable, not gone, on a machine with no history', async () => {
  const repo = await repository('onboard-history-listed');
  const home = await scratch('onboard-history-listed-home');
  await mkdir(path.dirname(localProfilePath(repo, { home })), { recursive: true });
  await writeFile(localProfilePath(repo, { home }), JSON.stringify({
    version: 1,
    placement: 'local',
    repo: path.resolve(repo),
    skills: {
      'report-progress': { match: 'strong', evidence: ["29 agent dispatches in this repository's history (needs 3)"], useWhen: 'delegating', required: true, scope: 'global' },
    },
    declined: {},
  }));
  const plan = await planJson(repo, home);
  const row = plan.rows.find((entry) => entry.name === 'report-progress');
  assert.equal(row?.kind, '?', `a history-listed skill on a machine with no history read as ${row?.kind}`);
  assert.match(row.note, /could not be read here/);
});

test('a routing file that was edited by hand is shown as a diff before it is rewritten', async () => {
  const repo = await repository('onboard-rules-diff');
  const home = await scratch('onboard-rules-diff-home');
  await run(['apply', '--repo', repo, '--yes'], { home });
  const rules = path.join(repo, '.claude', 'rules', 'skill-routing.md');
  await writeFile(rules, `${await readFile(rules, 'utf8')}- a line somebody added by hand → \`their-skill\`\n`);

  const plan = await planJson(repo, home);
  const row = plan.rows.find((entry) => entry.kind === '~' && entry.path === '.claude/rules/skill-routing.md');
  assert.deepEqual(row.diff?.removed, ['- a line somebody added by hand → `their-skill`'], 'the hand-added line is not shown as going away');
  assert.match(row.where, /no longer matches/);
  const text = await run(['plan', '--repo', repo], { home });
  assert.match(text.stdout, /their-skill/, 'the text change list does not show the line it would remove');

  // Unchanged means no diff at all.
  await run(['apply', '--repo', repo, '--yes'], { home });
  const again = (await planJson(repo, home)).rows.find((entry) => entry.kind === '~' && entry.path === '.claude/rules/skill-routing.md');
  assert.equal(again.diff, undefined);
});


// ---- re-review of the 0.22.1 patch -------------------------------------------------------------

test('--decline also works on a listed skill that no longer matches', async () => {
  const repo = await repository('onboard-decline-listed');
  const home = await scratch('onboard-decline-listed-home');
  await run(['apply', '--repo', repo, '--yes'], { home });
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'a-repo' }, null, 2));

  const declined = await run(['apply', '--repo', repo, '--yes', '--decline', 'release-notes'], { home });
  assert.equal(declined.status, 0, declined.stderr);
  const profile = JSON.parse(await readFile(localProfilePath(repo, { home }), 'utf8'));
  assert.equal(profile.skills['release-notes'], undefined, '--decline left a listed, unmatched skill in the profile');
  assert.match(profile.declined['release-notes']?.fingerprint ?? '', /^[0-9a-f]{64}$/);
});

test('an exclude file with Windows line endings does not gain a second copy of the line', async () => {
  const repo = await repository('onboard-exclude-crlf');
  const home = await scratch('onboard-exclude-crlf-home');
  await mkdir(path.join(repo, '.git', 'info'), { recursive: true });
  await writeFile(path.join(repo, '.git', 'info', 'exclude'), '# git ls-files --others --exclude-from=.git/info/exclude\r\n/.claude/rules/skill-routing.md\r\n');
  await run(['apply', '--repo', repo, '--yes'], { home });
  await run(['apply', '--repo', repo, '--yes'], { home });
  const lines = (await readFile(path.join(repo, '.git', 'info', 'exclude'), 'utf8')).split(/\r?\n/).filter((line) => line === '/.claude/rules/skill-routing.md');
  assert.equal(lines.length, 1, `the exclude line appears ${lines.length} times`);
});

test('a skill whose fit.json changes a signal is not reported as this repository changing', async () => {
  const repo = await repository('onboard-fit-edited');
  const home = await scratch('onboard-fit-edited-home');
  const packA = await scratch('onboard-fit-edited-pack-a');
  for (const name of await readdir(path.join(packRoot, 'skills'))) {
    const fit = path.join(packRoot, 'skills', name, 'references', 'fit.json');
    if (!existsSync(fit)) continue;
    await mkdir(path.join(packA, 'skills', name, 'references'), { recursive: true });
    await cp(fit, path.join(packA, 'skills', name, 'references', 'fit.json'));
  }
  // Pack B: the same, except release-notes asks for a different manifest field — also true here.
  const packB = await scratch('onboard-fit-edited-pack-b');
  await cp(packA, packB, { recursive: true });
  const fitB = path.join(packB, 'skills', 'release-notes', 'references', 'fit.json');
  const edited = JSON.parse(await readFile(fitB, 'utf8'));
  edited.anyOf = edited.anyOf.map((signal) => (signal.repo?.json === 'package.json' ? { repo: { json: 'package.json', field: 'name' } } : signal));
  await writeFile(fitB, JSON.stringify(edited));

  await run(['apply', '--repo', repo, '--yes', '--pack', packA], { home });
  await installRequired(home, JSON.parse(await readFile(localProfilePath(repo, { home }), 'utf8')));
  const afterUpdate = await run(['check', '--repo', repo, '--pack', packB], { home });
  assert.equal(afterUpdate.stdout, '', `a changed signal definition read as repository drift: ${afterUpdate.stdout}`);

  // A real change under the signals both versions share is still reported.
  await mkdir(path.join(repo, '.changeset'), { recursive: true });
  await writeFile(path.join(repo, '.changeset', 'config.json'), '{}');
  assert.match((await run(['check', '--repo', repo, '--pack', packB], { home })).stdout, /release-notes/);
});
