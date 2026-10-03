import assert from 'node:assert/strict';
import { cp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
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

// A skill a project may adapt declares its binding slots in a `## Bindings` table and names its
// hard lines and steps with stable ids (docs/project-adaptation.md). A project's overlay cites
// those ids, so an id that is malformed, declared twice, or a slot with no default would make an
// adapted copy compose wrong or not at all. Any file of a skill may declare the section.

const bindingsTable = (rows) => [
  '## Bindings',
  '',
  '| id | slot | kind | default |',
  '|---|---|---|---|',
  ...rows,
  '',
].join('\n');

const adaptableBody = (rows, rest = '') => [
  '---',
  'name: valid-skill',
  'description: Valid fixture',
  '---',
  '',
  bindingsTable(rows),
  '## Hard lines',
  '',
  '- **H1. Contacts nobody.** The run sends nothing to anyone.',
  '',
  '## Procedure',
  '',
  '1. **S1. Record the instruction.** Keep its words.',
  '2. **S2. Read the evidence.** Before touching the file.',
  '',
  '### S3 — Keep it verbatim',
  '',
  rest,
].join('\n');

const goodRows = [
  '| B1 | who the run answers to | value, required | ask once, and keep the answer for the run |',
  '| B2 | the zone written beside UTC | value | UTC only |',
  '| B3 | where a question for a person goes | skill | `sibling-skill` |',
];

async function adaptableFixture(body = adaptableBody(goodRows)) {
  const root = await fixture();
  await writeFile(path.join(root, 'skills', 'valid-skill', 'SKILL.md'), body);
  // The catalogue ships the skill a `skill` slot defaults to.
  await mkdir(path.join(root, 'skills', 'sibling-skill', 'references'), { recursive: true });
  await writeFile(path.join(root, 'skills', 'sibling-skill', 'SKILL.md'), '---\nname: sibling-skill\ndescription: Sibling fixture\n---\n');
  await writeFile(
    path.join(root, 'skills', 'sibling-skill', 'references', 'fit.json'),
    `${JSON.stringify({ version: 1, kind: 'general', useWhen: 'a fixture' }, null, 2)}\n`,
  );
  return root;
}

test('verifier accepts a skill whose Bindings, hard lines and steps are well formed', async () => {
  const result = await verify(await adaptableFixture());

  assert.equal(result.status, 0, result.stderr);
});

test('verifier refuses a slot id that is not one capital letter and a number from 1', async () => {
  for (const id of ['B01', 'b1', 'B-1', 'B1a', 'BB1', 'B0', '`B1`']) {
    const root = await adaptableFixture(adaptableBody([`| ${id} | a slot | value | ask once |`]));

    const result = await verify(root);

    assert.equal(result.status, 1, `${id} passed verification`);
    assert.match(result.stderr, /slot id .* is not well formed/, id);
  }
});

test('verifier refuses a slot id under H or S, the letters of hard lines and steps', async () => {
  for (const id of ['H4', 'S9']) {
    const root = await adaptableFixture(adaptableBody([`| ${id} | a slot | value | ask once |`]));

    const result = await verify(root);

    assert.equal(result.status, 1, `${id} passed verification`);
    assert.match(result.stderr, new RegExp(`slot id ${id} uses ${id[0]}, which names`));
  }
});

test('verifier refuses a slot with no default, or a placeholder in its place', async () => {
  for (const placeholder of ['', '-', '—', 'TBD', 'todo', 'n/a', '?']) {
    const root = await adaptableFixture(adaptableBody([`| B1 | a slot | value | ${placeholder} |`]));

    const result = await verify(root);

    assert.equal(result.status, 1, `default "${placeholder}" passed verification`);
    assert.match(result.stderr, /slot B1 has no default/);
  }
});

// A placeholder is still a placeholder when it is wrapped in code, emphasis or strikethrough, or
// escaped: what the reader is left with is `TBD`. A real default wrapped the same way still passes.
test('verifier refuses a placeholder default wrapped in Markdown formatting, and keeps a formatted real one', async () => {
  for (const placeholder of ['`TBD`', '`?`', '`-`', '``todo``', '*TBD*', '**n/a**', '_TBD_', '***?***', '~~TBD~~', '` `', '\\?', '**`TBD`**']) {
    const root = await adaptableFixture(adaptableBody([`| B1 | a slot | value | ${placeholder} |`]));

    const result = await verify(root);

    assert.equal(result.status, 1, `default "${placeholder}" passed verification`);
    assert.match(result.stderr, /slot B1 has no default/, placeholder);
  }
  for (const fallback of ['`UTC only`', '*ask once*', '**nobody**, and the run says so']) {
    const result = await verify(await adaptableFixture(adaptableBody([`| B1 | a slot | value | ${fallback} |`])));
    assert.equal(result.status, 0, `default "${fallback}" was refused: ${result.stderr}`);
  }
});

test('verifier refuses a slot kind other than value or skill, with an optional ", required"', async () => {
  for (const kind of ['list', 'Value', 'value required', 'skill, optional', '']) {
    const root = await adaptableFixture(adaptableBody([`| B1 | a slot | ${kind} | ask once |`]));

    const result = await verify(root);

    assert.equal(result.status, 1, `kind "${kind}" passed verification`);
    assert.match(result.stderr, /slot B1 has kind .* — use value or skill/);
  }
});

test('verifier holds a skill slot to a default that names one skill this catalogue ships', async () => {
  const cases = [
    ['sibling-skill', /slot B1 is of kind skill, so its default names one skill in backticks/],
    ['`sibling-skill` or `other-skill`', /slot B1 is of kind skill, so its default names one skill in backticks/],
    ['`missing-skill`', /slot B1 defaults to `missing-skill`, which this catalogue does not ship/],
  ];
  for (const [fallback, expected] of cases) {
    const root = await adaptableFixture(adaptableBody([`| B1 | where a question goes | skill | ${fallback} |`]));

    const result = await verify(root);

    assert.equal(result.status, 1, `default ${fallback} passed verification`);
    assert.match(result.stderr, expected);
  }
});

test('verifier refuses a Bindings section with no table, a different header, or no slot', async () => {
  const frontmatter = '---\nname: valid-skill\ndescription: Valid fixture\n---\n\n';
  const cases = [
    ['## Bindings\n\nNone yet.\n', /## Bindings has no table/],
    ['## Bindings\n\n| id | value |\n|---|---|\n| B1 | ask once |\n', /columns \| id \| slot \| kind \| default \|/],
    ['## Bindings\n\n| id | slot | kind | default |\n|---|---|---|---|\n\nNo rows.\n', /## Bindings declares no slot/],
    ['## Bindings\n\n| id | slot | kind | default |\n|---|---|---|---|\n| B1 | a slot | value |\n', /row has 3 cells; the table has 4/],
    // A delimiter row with another number of cells than the header is not a table to a renderer.
    ['## Bindings\n\n| id | slot | kind | default |\n|---|\n| B1 | a slot | value | ask once |\n', /delimiter row has 1 cell; the table has 4/],
    ['## Bindings\n\n| id | slot | kind | default |\n|---|---|---|---|---|\n| B1 | a slot | value | ask once |\n', /delimiter row has 5 cells; the table has 4/],
  ];
  for (const [section, expected] of cases) {
    const root = await adaptableFixture(frontmatter + section);

    const result = await verify(root);

    assert.equal(result.status, 1, `${section} passed verification`);
    assert.match(result.stderr, expected);
  }
});

test('verifier refuses an id declared twice, within a file or across the files of a skill', async () => {
  const twiceInOneFile = await adaptableFixture(adaptableBody([...goodRows, '| B2 | another slot | value | ask once |']));
  let result = await verify(twiceInOneFile);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /id B2 is declared twice in this skill \(first at .*SKILL\.md:\d+\)/);

  const stepTwice = await adaptableFixture(adaptableBody(goodRows, '- **S2. Read it again.** A second S2.\n'));
  result = await verify(stepTwice);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /id S2 is declared twice in this skill/);

  // A reference file is read as much as SKILL.md, and shares the skill's ids.
  const acrossFiles = await adaptableFixture();
  await writeFile(
    path.join(acrossFiles, 'skills', 'valid-skill', 'references', 'pack.md'),
    `# Pack\n\n${bindingsTable(['| B3 | where the pack goes | value | ask once |'])}\n1. **S1. Pin both ends.**\n`,
  );
  result = await verify(acrossFiles);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`${escapeRegExp(path.join('references', 'pack.md'))}:\\d+: id B3 is declared twice in this skill`));
  assert.match(result.stderr, new RegExp(`${escapeRegExp(path.join('references', 'pack.md'))}:\\d+: id S1 is declared twice in this skill`));
});

test('verifier checks a Bindings section in a reference file, not only in SKILL.md', async () => {
  const root = await fixture();
  await writeFile(
    path.join(root, 'skills', 'valid-skill', 'references', 'assessing.md'),
    `# Assessing\n\n${bindingsTable(['| B1 | who rules the severity | value | |'])}`,
  );

  const result = await verify(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`${escapeRegExp(path.join('references', 'assessing.md'))}:\\d+: slot B1 has no default`));
});

test('verifier refuses a malformed hard-line or step id, and slots under two letters in one skill', async () => {
  const malformed = await adaptableFixture(adaptableBody(goodRows, '- **S04. Hash it.** A leading zero.\n\n### H2a — A suffix\n'));
  let result = await verify(malformed);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /S04 is not a well-formed step id/);
  assert.match(result.stderr, /H2a is not a well-formed hard-line id/);

  const twoLetters = await adaptableFixture(adaptableBody([...goodRows, '| F4 | the event source | value | ask once |']));
  result = await verify(twoLetters);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /slots in this skill use more than one letter \(B, F\)/);

  // Another letter than B is allowed, as long as the skill uses only that one.
  const ownLetter = await adaptableFixture(adaptableBody(['| F1 | the event source | value | ask once |', '| F2 | the table | value | ask once |']));
  result = await verify(ownLetter);
  assert.equal(result.status, 0, result.stderr);
});

// An id written with a separator or in lower case (`S-1`, `H_1`, `s4`) is a malformed id, not
// prose: it fails rather than passing unread. A heading or lead-in where a letter follows the H or
// S is a word (`## Hard lines`, `- **Sweep the day.**`) and stays ordinary text.
test('verifier refuses an id written with a separator or in lower case, and leaves a word after H or S alone', async () => {
  const cases = [
    ['- **S-1. Do work.** A hyphen.', /S-1 is not a well-formed step id/],
    ['### H_1 — Guard', /H_1 is not a well-formed hard-line id/],
    ['1. **S.5 Dotted.** A full stop.', /S\.5 is not a well-formed step id/],
    ['### S 6 — Spaced', /S 6 is not a well-formed step id/],
    ['- **H–3. An en dash.**', /H–3 is not a well-formed hard-line id/],
    ['- **s4. Lower case.**', /s4 is not a well-formed step id/],
    ['### h2 — Lower case', /h2 is not a well-formed hard-line id/],
  ];
  for (const [line, expected] of cases) {
    const result = await verify(await adaptableFixture(adaptableBody(goodRows, `${line}\n`)));

    assert.equal(result.status, 1, `${line} passed verification`);
    assert.match(result.stderr, expected, line);
  }

  const words = [
    '## Scope',
    '',
    '### Sweep the day',
    '',
    '- **Severity: the evidence decides it.**',
    '- **Hash it before and after.**',
    '- **Signed in, or not.**',
    '- **S-curve:** a word, not an id.',
    '1. **How this was checked.**',
    '#### H-bridge',
    '',
  ].join('\n');
  const result = await verify(await adaptableFixture(adaptableBody(goodRows, words)));
  assert.equal(result.status, 0, result.stderr);
});

test('verifier ignores fenced examples and files that declare no Bindings', async () => {
  const fencedOnly = [
    '# Showing an overlay',
    '',
    '```markdown',
    '## Bindings',
    '',
    '| id | value |',
    '|---|---|',
    '| B01 | not a slot of this skill |',
    '```',
    '',
    '- **S1. A step in a file that is not adaptable.**',
    '- **S1. The same id again, which no rule reads here.**',
    '',
  ].join('\n');
  const root = await adaptableFixture();
  await writeFile(path.join(root, 'skills', 'valid-skill', 'references', 'overlay-example.md'), fencedOnly);
  const withFenceInAdaptable = adaptableBody(goodRows, ['```markdown', '- **S1. An example step inside a fence.**', '| B9 | x | list | |', '```', ''].join('\n'));
  await writeFile(path.join(root, 'skills', 'valid-skill', 'SKILL.md'), withFenceInAdaptable);

  const result = await verify(root);

  assert.equal(result.status, 0, result.stderr);
});

// The page that defines the convention shows a skill declaring it, and lists the placeholders the
// verifier refuses as a default. Its example has to pass the verifier inside this catalogue, and
// each placeholder it names has to be refused, so the page and the check cannot drift apart.
test('the project-adaptation page: its example passes in this catalogue, and every placeholder it names is refused', async () => {
  const page = await readFile(path.join(repository, 'docs', 'project-adaptation.md'), 'utf8');
  const example = page.slice(page.indexOf('## Declaring them')).match(/```markdown\n([\s\S]*?)\n```/)[1];
  const withExample = (fallback) => `---\nname: valid-skill\ndescription: Valid fixture\n---\n\n${example.replace('| value | UTC only |', `| value | ${fallback} |`)}\n`;
  const root = await fixture();
  await cp(path.join(repository, 'skills'), path.join(root, 'skills'), { recursive: true });
  const skill = path.join(root, 'skills', 'valid-skill', 'SKILL.md');

  await writeFile(skill, withExample('UTC only'));
  const passed = await verify(root);
  assert.equal(passed.status, 0, passed.stderr);

  const listed = page.match(/a slot has no default \(([^)]*)\)/);
  assert.ok(listed, 'the page lists the placeholders it says are refused');
  const placeholders = [...listed[1].matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  assert.ok(placeholders.length >= 4, `too few placeholders read from the page: ${placeholders.join(', ')}`);
  for (const placeholder of [...placeholders, '', '-']) {
    await writeFile(skill, withExample(placeholder));
    const refused = await verify(root);
    assert.equal(refused.status, 1, `the page says "${placeholder}" is refused as a default, and it passed`);
    assert.match(refused.stderr, /slot B2 has no default/);
  }
});

test('verifier refuses a file that declares Bindings twice, and a slot that does not say what it holds', async () => {
  const twice = await adaptableFixture(`${adaptableBody(goodRows)}\n${bindingsTable(['| B4 | another | value | ask once |'])}`);
  let result = await verify(twice);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SKILL\.md:\d+: ## Bindings is declared twice in this file/);

  const unsaid = await adaptableFixture(adaptableBody(['| B1 |  | value | ask once |']));
  result = await verify(unsaid);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /slot B1 does not say what it holds/);
});

// A fence nested in a list item is indented past three spaces and is still code, so an example
// step inside it declares nothing; and a heading at any level declares, level one included.
test('verifier leaves out a fence nested in a list item, and reads a level-one heading', async () => {
  const nested = adaptableBody(goodRows, [
    '- A pitfall with an example:',
    '  - The example, in a nested list:',
    '',
    '     ```markdown',
    '     1. **S1. An example step inside a nested fence.**',
    '     ```',
    '',
  ].join('\n'));
  let result = await verify(await adaptableFixture(nested));
  assert.equal(result.status, 0, result.stderr);

  result = await verify(await adaptableFixture(adaptableBody(goodRows, '# S2 — The same step, at level one\n')));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /id S2 is declared twice in this skill/);
});

// Only a declaration opens a list item with an id in bold. A citation written as a bold lead-in
// is read as a declaration, which is why the page tells authors to cite an id inside the sentence.
test('verifier reads a bold lead-in that opens with an id as declaring it', async () => {
  const leadIn = adaptableBody(goodRows, '## Pitfalls\n\n- **S2 skipped:** the evidence was never read.\n');
  const result = await verify(await adaptableFixture(leadIn));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /id S2 is declared twice in this skill/);

  const inSentence = adaptableBody(goodRows, '## Pitfalls\n\n- **Evidence skipped:** if S2 was skipped, the evidence was never read.\n');
  assert.equal((await verify(await adaptableFixture(inSentence))).status, 0);
});
