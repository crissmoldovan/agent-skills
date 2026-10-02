import assert from 'node:assert/strict';
import { cp, mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers/temp-dir.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function fixture() {
  const root = await tempDir('verify-skills-');
  await cp(path.join(repository, 'scripts'), path.join(root, 'scripts'), { recursive: true });
  await mkdir(path.join(root, 'skills', 'valid-skill', 'references'), { recursive: true });
  await writeFile(path.join(root, 'skills', 'valid-skill', 'SKILL.md'), '---\nname: valid-skill\ndescription: Valid fixture\n---\n');
  await writeFile(
    path.join(root, 'skills', 'valid-skill', 'references', 'fit.json'),
    `${JSON.stringify({ version: 1, kind: 'general', useWhen: 'a fixture' }, null, 2)}\n`,
  );
  return root;
}

function verify(root) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/verify-skills.mjs'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('verifier ignores generated and temporary directories', async () => {
  const root = await fixture();
  for (const directory of ['.cache', '.next', '.tmp', '.turbo', '.vite', '.wrangler', 'build', 'coverage', 'dist', 'out', 'tmp']) {
    await mkdir(path.join(root, directory), { recursive: true });
    const assignment = ['to', 'ken'].join('');
    const generatedToken = ['generated', 'token', 'value', '1234567890'].join('-');
    await writeFile(path.join(root, directory, 'generated.txt'), `${assignment} = "${generatedToken}"\n`);
  }

  const result = await verify(root);

  assert.equal(result.status, 0, result.stderr);
});

test('verifier rejects public machine-specific absolute paths', async () => {
  const root = await fixture();
  const personalPath = ['', 'Users', 'alice', 'private', 'catalog'].join('/');
  await writeFile(path.join(root, 'README.md'), `Install from ${personalPath}.\n`);

  const result = await verify(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /README\.md: contains a machine-specific absolute path/);
});

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The scan used to read ten extensions and nothing else, so a machine path in a .toml fixture,
// a .sh helper, a .jsonl capture or an extensionless config passed in silence. A file that is
// text is now read whatever its name.
test('verifier scans every text file for machine paths and secrets, whatever its extension', async () => {
  const root = await fixture();
  const personalPath = ['', 'Users', 'alice', 'private', 'catalog'].join('/');
  const names = [
    'fixture.toml', 'helper.py', 'run.sh', 'page.html', 'style.css', 'capture.jsonl',
    'message.eml', 'table.csv', 'feed.xml', 'icon.svg', 'Dockerfile', '.npmrc', 'notes.unknownext',
  ];
  for (const name of names) await writeFile(path.join(root, name), `see ${personalPath}\n`);
  const assignment = ['to', 'ken'].join('');
  const realisticToken = ['prod', 'token', 'value', '1234567890'].join('-');
  await writeFile(path.join(root, 'settings.py'), `${assignment} = "${realisticToken}"\n`);

  const result = await verify(root);

  assert.equal(result.status, 1);
  for (const name of names) {
    assert.match(result.stderr, new RegExp(`- ${escapeRegExp(name)}: contains a machine-specific absolute path`));
  }
  assert.match(result.stderr, /- settings\.py: contains a likely secret/);
});

// A file that is not UTF-8 is still text when it holds no NUL byte, and the two patterns are
// ASCII, so a Latin-1 file is read rather than waved through as binary.
test('verifier reads a text file that is not valid UTF-8', async () => {
  const root = await fixture();
  const personalPath = ['', 'Users', 'alice', 'private', 'catalog'].join('/');
  await writeFile(path.join(root, 'latin1.txt'), Buffer.concat([Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20]), Buffer.from(personalPath)]));

  const result = await verify(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /- latin1\.txt: contains a machine-specific absolute path/);
});

// A file with a NUL byte is binary. Both patterns are ASCII, so its bytes are searched as well,
// which finds a path in an image's metadata, where fields end in NUL bytes. What an image shows
// is not read, so the run names every binary file for a person to look at.
test('verifier searches a binary file as bytes and names every binary file for a person to look at', async () => {
  const root = await fixture();
  const personalPath = ['', 'Users', 'alice', 'private', 'catalog'].join('/');
  await mkdir(path.join(root, 'assets'), { recursive: true });
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]);
  await writeFile(path.join(root, 'assets', 'shot.png'), Buffer.concat([header, Buffer.from(`tEXtSource\0${personalPath}\0`)]));
  await writeFile(path.join(root, 'assets', 'clean.png'), Buffer.concat([header, Buffer.from([0x01, 0x02])]));

  const result = await verify(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`- ${escapeRegExp(path.join('assets', 'shot.png'))}: contains a machine-specific absolute path`));
  assert.doesNotMatch(result.stderr, /clean\.png/);
  const listed = [path.join('assets', 'clean.png'), path.join('assets', 'shot.png')].map(escapeRegExp).join(', ');
  assert.match(result.stdout, new RegExp(`2 binary files searched as bytes, .* look at each: ${listed}`));
});

// The lifecycle package used to be skipped whole for one test file's token fixtures. Only that
// file is now spared, only from the secret pattern, and the run names it; the rest of the
// package is read like any other file.
test('verifier reads the lifecycle package, sparing one named test file the secret pattern only', async () => {
  const root = await fixture();
  const personalPath = ['', 'Users', 'alice', 'private', 'catalog'].join('/');
  const assignment = ['to', 'ken'].join('');
  const fixtureToken = ['live', 'owner'].join('-');
  const testDirectory = path.join(root, 'packages', 'agent-lifecycle', 'test');
  await mkdir(testDirectory, { recursive: true });
  await writeFile(path.join(testDirectory, 'lifecycle.test.ts'), `const lock = { ${assignment}: '${fixtureToken}' };\n`);
  await writeFile(path.join(root, 'packages', 'agent-lifecycle', 'README.md'), `Built in ${personalPath}.\n`);

  const result = await verify(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`- ${escapeRegExp(path.join('packages', 'agent-lifecycle', 'README.md'))}: contains a machine-specific absolute path`));
  assert.doesNotMatch(result.stderr, /lifecycle\.test\.ts/);
  assert.match(result.stdout, new RegExp(`${escapeRegExp(path.join('packages', 'agent-lifecycle', 'test', 'lifecycle.test.ts'))} read for machine paths only`));
});

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
}

// In a git checkout the scan reads what the repository would publish: a tracked file wherever it
// sits, even under a directory name the walk skips, an untracked file git would add, and a
// symbolic link as the path it stores. A file git ignores is never published, so a local .env
// cannot fail the run, and untracked generated output is still skipped.
test('in a git checkout the verifier reads what git tracks or would add, and nothing git ignores', async () => {
  const root = await fixture();
  const personalPath = ['', 'Users', 'alice', 'private', 'catalog'].join('/');
  const assignment = ['to', 'ken'].join('');
  const realisticToken = ['prod', 'token', 'value', '1234567890'].join('-');
  await writeFile(path.join(root, '.gitignore'), '.env\n');
  await mkdir(path.join(root, 'out'), { recursive: true });
  await writeFile(path.join(root, 'out', 'tracked.txt'), `see ${personalPath}\n`);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'fixture');
  await writeFile(path.join(root, '.env'), `${assignment} = "${realisticToken}"\n`);
  await writeFile(path.join(root, 'new.toml'), `${assignment} = "${realisticToken}"\n`);
  await mkdir(path.join(root, 'build'), { recursive: true });
  await writeFile(path.join(root, 'build', 'generated.txt'), `${assignment} = "${realisticToken}"\n`);
  await symlink(personalPath, path.join(root, 'link'));

  const result = await verify(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`- ${escapeRegExp(path.join('out', 'tracked.txt'))}: contains a machine-specific absolute path`));
  assert.match(result.stderr, /- new\.toml: contains a likely secret/);
  assert.match(result.stderr, /- link: contains a machine-specific absolute path/);
  assert.doesNotMatch(result.stderr, /\.env|generated\.txt/);
  assert.match(result.stdout, /\(the files git tracks or would add\)/);
});

test('verifier accepts neutral credential fixtures', async () => {
  const root = await fixture();
  const assignment = ['to', 'ken'].join('');
  const neutralToken = ['not', 'a', 'real', 'secret'].join('-');
  await writeFile(path.join(root, 'README.md'), `# Fixture\n\nValid fixture\n\nSet ${assignment} = "${neutralToken}" in your local environment.\n`);

  const result = await verify(root);

  assert.equal(result.status, 0, result.stderr);
});

test('verifier rejects realistic quoted credentials', async () => {
  const root = await fixture();
  const assignment = ['to', 'ken'].join('');
  const realisticToken = ['prod', 'token', 'value', '1234567890'].join('-');
  await writeFile(path.join(root, 'README.md'), `${assignment} = "${realisticToken}"\n`);

  const result = await verify(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /README\.md: contains a likely secret/);
});

test('verifier rejects a bare carried-file token the skill does not carry', async () => {
  const root = await fixture();
  const skill = path.join(root, 'skills', 'valid-skill');
  await writeFile(path.join(skill, 'SKILL.md'), '---\nname: valid-skill\ndescription: Valid fixture\n---\n\nSee references/missing.md for detail.\n');

  const result = await verify(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /names a carried file the skill does not carry: references\/missing\.md/);
});

test('verifier accepts a carried-file token when the skill carries that exact file', async () => {
  const root = await fixture();
  const skill = path.join(root, 'skills', 'valid-skill');
  await mkdir(path.join(skill, 'references'), { recursive: true });
  await writeFile(path.join(skill, 'references', 'present.md'), '# Present\n');
  await writeFile(path.join(skill, 'SKILL.md'), '---\nname: valid-skill\ndescription: Valid fixture\n---\n\nSee references/present.md for detail.\n');

  const result = await verify(root);

  assert.equal(result.status, 0, result.stderr);
});

// The catalogue's build enforces the portable spec's frontmatter limits; a skill that passed
// here once went there with a 523-character compatibility and broke its build.
test('verifier holds frontmatter to the portable spec limits, in characters, after folding', async () => {
  const root = await fixture();
  const skill = path.join(root, 'skills', 'valid-skill', 'SKILL.md');
  const withFields = (fields) => writeFile(skill, `---\nname: valid-skill\n${fields}\n---\n`);
  const x = (n) => 'x'.repeat(n);

  await withFields(`description: Valid fixture\ncompatibility: "${x(500)}"`);
  assert.equal((await verify(root)).status, 0, 'exactly 500 characters is allowed');

  await withFields(`description: Valid fixture\ncompatibility: "${'—'.repeat(500)}"`);
  assert.equal((await verify(root)).status, 0, '500 em dashes are 500 characters, not 1500 bytes');

  await withFields(`description: Valid fixture\ncompatibility: "${x(501)}"`);
  let result = await verify(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /compatibility is 501 characters; the portable spec allows 500/);

  // A folded block: two 251-character lines join with one space into 503.
  await withFields(`description: Valid fixture\ncompatibility: >-\n  ${x(251)}\n  ${x(251)}`);
  result = await verify(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /compatibility is 503 characters/);

  await withFields(`description: ${x(1025)}`);
  result = await verify(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /description is 1025 characters; the portable spec allows 1024/);
});

test('verifier caps the SKILL.md body at 484 lines and admits a body of exactly 484', async () => {
  const frontmatter = '---\nname: valid-skill\ndescription: Valid fixture\n---\n';
  const body = (lines) => `${'body line\n'.repeat(lines)}`;

  const atCap = await fixture();
  await writeFile(path.join(atCap, 'skills', 'valid-skill', 'SKILL.md'), frontmatter + body(484));
  const admitted = await verify(atCap);
  assert.equal(admitted.status, 0, admitted.stderr);

  const overCap = await fixture();
  await writeFile(path.join(overCap, 'skills', 'valid-skill', 'SKILL.md'), frontmatter + body(485));
  const rejected = await verify(overCap);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /body is 485 lines; the cap is 484/);
});

test('verifier requires every skill to declare where it fits', async () => {
  const root = await fixture();
  await mkdir(path.join(root, 'skills', 'unfit-skill'), { recursive: true });
  await writeFile(path.join(root, 'skills', 'unfit-skill', 'SKILL.md'), '---\nname: unfit-skill\ndescription: No fit\n---\n');

  const result = await verify(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /unfit-skill\/SKILL\.md: no references\/fit\.json/);
});

test('verifier rejects a fit.json that does not parse, names an unknown kind, or declares no signal', async () => {
  const cases = [
    ['broken', '{ not json', /does not parse/],
    ['wrong-kind', JSON.stringify({ version: 1, kind: 'sometimes', useWhen: 'x' }), /kind must be one of/],
    ['no-use-when', JSON.stringify({ version: 1, kind: 'general' }), /needs a useWhen line/],
    ['empty-signals', JSON.stringify({ version: 1, kind: 'signals', useWhen: 'x', anyOf: [] }), /needs a non-empty anyOf or allOf/],
    ['unreadable-signal', JSON.stringify({ version: 1, kind: 'signals', useWhen: 'x', anyOf: [{ repo: { vibes: 'good' } }] }), /cannot read/],
  ];
  for (const [name, body, expected] of cases) {
    const root = await fixture();
    await mkdir(path.join(root, 'skills', name, 'references'), { recursive: true });
    await writeFile(path.join(root, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: fixture\n---\n`);
    await writeFile(path.join(root, 'skills', name, 'references', 'fit.json'), body);

    const result = await verify(root);

    assert.equal(result.status, 1, `${name} passed verification`);
    assert.match(result.stderr, expected);
  }
});
