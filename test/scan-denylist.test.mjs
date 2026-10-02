import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers/temp-dir.mjs';

// Every term here is invented for this file. The real list is private, lives outside every
// repository, and never appears in this one.
const scanner = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'scan-denylist.mjs');
const TERMS = ['Globex', 'Jane Roe', 'build.intranet.example.net', '~/projects/', 'widget++'];
const DENYLIST = `# a comment line, ignored\n\n${TERMS.join('\n')}\n`;
// Line numbers in DENYLIST: the comment is 1, the blank line 2, the terms 3 onward.
const lineOf = (term) => TERMS.indexOf(term) + 3;

const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.com',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.com',
};

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: gitEnv });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

/** A repository with one commit on main and a branch cut from it, plus a denylist outside it. */
async function fixture({ branch = 'feature/work' } = {}) {
  const repo = await tempDir('scan-denylist-repo-');
  const outside = await tempDir('scan-denylist-list-');
  git(repo, 'init', '-q', '-b', 'main');
  await writeFile(path.join(repo, 'README.md'), '# Fixture\n\nAn old mention of Globex that is already public.\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  git(repo, 'checkout', '-q', '-b', branch);
  const denylist = path.join(outside, 'denylist.txt');
  await writeFile(denylist, DENYLIST);
  return { repo, denylist };
}

async function commit(repo, files, message = 'feat: add work') {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(repo, name)), { recursive: true });
    await writeFile(path.join(repo, name), content);
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

function scan(repo, ...args) {
  const result = spawnSync(process.execPath, [scanner, ...args], { cwd: repo, encoding: 'utf8', env: gitEnv });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, output: result.stdout + result.stderr };
}

/** Without --show-matches, no term the list holds may appear anywhere in what the scan prints. */
function assertNoTermPrinted(output) {
  for (const term of TERMS) {
    assert.ok(!output.toLowerCase().includes(term.toLowerCase()), `the scan printed a denylist term:\n${output}`);
  }
}

test('a branch that adds nothing on the list passes, and says what it covered', async () => {
  const { repo, denylist } = await fixture();
  await commit(repo, { 'skills/demo/SKILL.md': '---\nname: demo\n---\n\nA neutral line.\n' });

  const result = scan(repo, '--denylist', denylist, '--base', 'main');

  assert.equal(result.status, 0, result.output);
  assert.match(result.stdout, /no denylist term/i);
  assert.match(result.stdout, /1 commit/);
  assert.match(result.stdout, /1 file/);
  assert.match(result.stdout, /1 added line|[0-9]+ added lines/);
  assert.match(result.stdout, /the branch name/);
});

test('an added line in a fixture is a hit, named by file, line and denylist line, never by term', async () => {
  const { repo, denylist } = await fixture();
  await commit(repo, {
    'test/fixtures/session.jsonl': '{"type":"user"}\n{"text":"ask globex about it"}\n',
  });

  const result = scan(repo, '--denylist', denylist, '--base', 'main');

  assert.equal(result.status, 1, result.output);
  assert.match(result.stdout, new RegExp(`added line\\s+test/fixtures/session\\.jsonl:2:\\d+\\s+denylist line ${lineOf('Globex')}`));
  assertNoTermPrinted(result.output);
});

test('only what the branch adds is read: a line already on the base, or removed, is not a hit', async () => {
  const { repo, denylist } = await fixture();
  // README.md already names a term on main; this branch removes that line and adds a clean one.
  await commit(repo, { 'README.md': '# Fixture\n\nA rewritten, neutral line.\n' });

  const result = scan(repo, '--denylist', denylist, '--base', 'main');

  assert.equal(result.status, 0, result.output);
});

test('a file name, a commit message and the branch name are each scanned', async () => {
  const { repo, denylist } = await fixture({ branch: 'fix/globex-export' });
  const sha = await commit(
    repo,
    { 'docs/jane-roe-notes.md': 'Neutral text.\n' },
    'docs: add notes\n\nAs agreed with Jane  Roe on the call.\n',
  );

  const result = scan(repo, '--denylist', denylist, '--base', 'main');

  assert.equal(result.status, 1, result.output);
  assert.match(result.stdout, new RegExp(`branch name\\s+denylist line ${lineOf('Globex')}`));
  assert.match(result.stdout, new RegExp(`commit message\\s+${sha.slice(0, 12)} line 3\\s+denylist line ${lineOf('Jane Roe')}`));
  // A term written with a space does not match its hyphenated spelling: a list that needs both
  // lists both.
  assert.doesNotMatch(result.stdout, /file name\s+docs\//);
  assertNoTermPrinted(result.output);
});

test('a file name that holds a term is a hit, and the printed path masks the term', async () => {
  const { repo, denylist } = await fixture();
  await commit(repo, { 'test/fixtures/globex_export.csv': 'id,value\n1,2\n' });

  const result = scan(repo, '--denylist', denylist, '--base', 'main');

  assert.equal(result.status, 1, result.output);
  assert.match(result.stdout, new RegExp(`file name\\s+test/fixtures/‹denylist line ${lineOf('Globex')}›_export\\.csv\\s+denylist line ${lineOf('Globex')}`));
  assertNoTermPrinted(result.output);
});

test('a term matches as a word: case-insensitive, across an underscore, a hyphen or a camelCase hump, never inside a longer word', async () => {
  const { repo, denylist } = await fixture();
  await commit(repo, {
    'a.md': [
      'GLOBEX in capitals',
      'globex_id with an underscore',
      'the globex-client package',
      'const globexClient = 1',
      'const myGlobex = 2',
      'Globexian is a different word',
      'megaglobex is a different word',
      'Globex2 runs a digit on, so it is a different word',
    ].join('\n') + '\n',
  });

  const result = scan(repo, '--denylist', denylist, '--base', 'main');

  assert.equal(result.status, 1, result.output);
  const lines = [...result.stdout.matchAll(/added line\s+a\.md:(\d+):/g)].map((match) => Number(match[1]));
  assert.deepEqual(lines, [1, 2, 3, 4, 5]);
});

test('a term that starts or ends in punctuation, or holds a host name, matches where it is written', async () => {
  const { repo, denylist } = await fixture();
  await commit(repo, {
    'b.md': [
      'clone it into ~/projects/demo first',
      'widget++ is the name',
      'see https://build.intranet.example.net/job/1',
      'build.intranet.example.network is another host',
    ].join('\n') + '\n',
  });

  const result = scan(repo, '--denylist', denylist, '--base', 'main');

  assert.equal(result.status, 1, result.output);
  assert.match(result.stdout, new RegExp(`b\\.md:1:\\d+\\s+denylist line ${lineOf('~/projects/')}`));
  assert.match(result.stdout, new RegExp(`b\\.md:2:\\d+\\s+denylist line ${lineOf('widget++')}`));
  assert.match(result.stdout, new RegExp(`b\\.md:3:\\d+\\s+denylist line ${lineOf('build.intranet.example.net')}`));
  assert.doesNotMatch(result.stdout, /b\.md:4:/);
  assertNoTermPrinted(result.output);
});

test('an added line that itself starts with "++ " is read as content, not as a file header', async () => {
  const { repo, denylist } = await fixture();
  await commit(repo, { 'c.md': 'first\n++ globex\n' });

  const result = scan(repo, '--denylist', denylist, '--base', 'main');

  assert.equal(result.status, 1, result.output);
  assert.match(result.stdout, /added line\s+c\.md:2:4\s/);
});

test('a path with spaces and quotes is read and reported whole', async () => {
  const { repo, denylist } = await fixture();
  await commit(repo, { 'notes/a "quoted" name.md': 'neutral\nwidget++ here\n' });

  const result = scan(repo, '--denylist', denylist, '--base', 'main');

  assert.equal(result.status, 1, result.output);
  assert.match(result.stdout, /added line\s+notes\/a "quoted" name\.md:2:1\s/);
});

test('a binary file is searched as bytes, and listed as not looked at as a picture', async () => {
  const { repo, denylist } = await fixture();
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]), Buffer.from('tEXtAuthor\0Jane Roe\0')]);
  const clean = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]);
  await commit(repo, { 'assets/shot.png': png, 'assets/clean.png': clean });

  const result = scan(repo, '--denylist', denylist, '--base', 'main');

  assert.equal(result.status, 1, result.output);
  assert.match(result.stdout, new RegExp(`binary file\\s+assets/shot\\.png byte \\d+\\s+denylist line ${lineOf('Jane Roe')}`));
  assert.doesNotMatch(result.stdout, /binary file\s+assets\/clean\.png/);
  assert.match(result.stdout, /2 binary/);
  assert.match(result.stdout, /assets\/clean\.png, assets\/shot\.png/);
  assertNoTermPrinted(result.output);
});

test('--worktree adds uncommitted changes and untracked files; without it they are not read', async () => {
  const { repo, denylist } = await fixture();
  await commit(repo, { 'tracked.md': 'neutral\n' });
  await writeFile(path.join(repo, 'tracked.md'), 'neutral\nnow globex\n');
  await writeFile(path.join(repo, 'untracked.md'), 'Jane Roe\n');

  const committedOnly = scan(repo, '--denylist', denylist, '--base', 'main');
  assert.equal(committedOnly.status, 0, committedOnly.output);

  const withTree = scan(repo, '--denylist', denylist, '--base', 'main', '--worktree');
  assert.equal(withTree.status, 1, withTree.output);
  assert.match(withTree.stdout, new RegExp(`tracked\\.md:2:5\\s+denylist line ${lineOf('Globex')}`));
  assert.match(withTree.stdout, new RegExp(`untracked\\.md:1:1\\s+denylist line ${lineOf('Jane Roe')}`));
});

test('--worktree reads an untracked symbolic link as git would store it, dangling or not', async () => {
  const { repo, denylist } = await fixture();
  await commit(repo, { 'g.md': 'neutral\n' });
  await symlink('../nowhere/jane roe/file', path.join(repo, 'link'));

  const result = scan(repo, '--denylist', denylist, '--base', 'main', '--worktree');

  assert.equal(result.status, 1, result.output);
  assert.match(result.stdout, new RegExp(`added line\\s+link:1:\\d+\\s+denylist line ${lineOf('Jane Roe')}`));
});

test('a refusal masks a term it would otherwise echo', async () => {
  const { repo, denylist } = await fixture();
  await commit(repo, { 'h.md': 'neutral\n' });

  const result = scan(repo, '--denylist', denylist, '--base', 'globex-release');

  assert.equal(result.status, 2, result.output);
  assert.match(result.stderr, new RegExp(`the base ‹denylist line ${lineOf('Globex')}›-release does not resolve`));
  assertNoTermPrinted(result.output);
});

test('--show-matches prints the matched text, for a local terminal', async () => {
  const { repo, denylist } = await fixture();
  await commit(repo, { 'd.md': 'ask GLOBEX\n' });

  const result = scan(repo, '--denylist', denylist, '--base', 'main', '--show-matches');

  assert.equal(result.status, 1, result.output);
  assert.match(result.stdout, /d\.md:1:5\s+denylist line \d+\s+"GLOBEX"/);
});

test('--branch names the branch when HEAD is detached; without it the run says the name was not read', async () => {
  const { repo, denylist } = await fixture();
  await commit(repo, { 'e.md': 'neutral\n' });
  git(repo, 'checkout', '-q', '--detach');

  const detached = scan(repo, '--denylist', denylist, '--base', 'main');
  assert.equal(detached.status, 0, detached.output);
  assert.match(detached.stdout, /branch name was not scanned/);

  const named = scan(repo, '--denylist', denylist, '--base', 'main', '--branch', 'feat/globex');
  assert.equal(named.status, 1, named.output);
  assert.match(named.stdout, /branch name\s+denylist line/);
});

test('refuses to run without a usable denylist kept outside the repository, or without a base', async () => {
  const { repo, denylist } = await fixture();
  await commit(repo, { 'f.md': 'neutral\n' });
  const inside = path.join(repo, 'denylist.txt');
  await writeFile(inside, DENYLIST);
  const emptyList = path.join(path.dirname(denylist), 'empty.txt');
  await writeFile(emptyList, '# only a comment\n\n');

  const cases = [
    [[], /--denylist/],
    [['--denylist', path.join(path.dirname(denylist), 'missing.txt')], /cannot read the denylist/i],
    [['--denylist', inside], /inside this repository/i],
    [['--denylist', emptyList], /no terms/i],
    [['--denylist', denylist, '--base', 'no-such-ref'], /does not resolve/i],
    [['--denylist', denylist, '--unknown'], /unknown option/i],
  ];
  for (const [args, expected] of cases) {
    const result = scan(repo, ...args);
    assert.equal(result.status, 2, `${args.join(' ')}: ${result.output}`);
    assert.match(result.stderr, expected);
  }
});
