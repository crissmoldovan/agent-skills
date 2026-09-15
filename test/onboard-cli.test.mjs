import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const packRoot = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(packRoot, 'skills', 'onboard-project', 'scripts', 'onboard.mjs');

const scratch = (name) => mkdtemp(path.join(tmpdir(), `${name}-`));

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
  assert.deepEqual(writes.sort(), ['.claude/rules/skill-routing.md', 'skills-profile.json']);
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
  const first = await readFile(path.join(home, '.agents', 'project-profiles', `${repo.replace(/[^A-Za-z0-9]/g, '-')}.json`), 'utf8');
  const second = await run(['apply', '--repo', repo, '--yes'], { home });
  assert.equal(second.status, 0);
  const again = await readFile(path.join(home, '.agents', 'project-profiles', `${repo.replace(/[^A-Za-z0-9]/g, '-')}.json`), 'utf8');
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
  const profile = JSON.parse(await readFile(path.join(home, '.agents', 'project-profiles', `${repo.replace(/[^A-Za-z0-9]/g, '-')}.json`), 'utf8'));
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

  const profile = JSON.parse(await readFile(path.join(home, '.agents', 'project-profiles', `${repo.replace(/[^A-Za-z0-9]/g, '-')}.json`), 'utf8'));
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
