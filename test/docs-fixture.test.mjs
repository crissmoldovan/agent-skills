// The evaluation fixture for `layer-repository-docs`: a small repository with
// planted documentation defects and real history. These tests keep the fixture
// and its answer key honest about each other — a key that drifts from the
// fixture turns an evaluation into a measurement of nothing.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { makeFixture } = await import(path.join(root, 'scripts', 'make-docs-fixture.mjs'));
const answers = JSON.parse(await readFile(path.join(root, 'test', 'fixtures', 'layered-docs.answers.json'), 'utf8'));

const fixture = await makeFixture();
const read = (relative) => readFile(path.join(fixture.path, relative), 'utf8');
const git = (...args) => execFileSync('git', args, { cwd: fixture.path, encoding: 'utf8' }).trim();

test.after(() => rm(fixture.path, { recursive: true, force: true }));

test('the fixture materialises as a real repository with a documentation baseline and a delta after it', () => {
  const log = git('log', '--format=%H').split('\n');
  assert.equal(log.length, 5, 'five commits: code, documentation, and three the documentation has not caught up with');
  assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  assert.equal(git('status', '--porcelain'), '', 'the materialised fixture starts clean');
  // The delta an `update` run is supposed to find, and nothing else.
  const changed = git('diff', '--name-only', `${fixture.commits.documented}..HEAD`).split('\n').sort();
  assert.deepEqual(changed, ['.github/workflows/verify.yml', 'package.json', 'scripts/deploy.sh']);
});

test('the manual names a baseline revision that exists, which is what an update run reads', async () => {
  const manual = await read('docs/MANUAL.md');
  assert.doesNotMatch(manual, /\{\{|\}\}/, 'no placeholder survived into the fixture');
  assert.match(manual, new RegExp(`Sources re-read at ${fixture.commits.baseline}`));
  assert.equal(git('cat-file', '-t', fixture.commits.baseline), 'commit');
});

test('every planted defect and observed behaviour is present exactly once, and locatable by its marker', async () => {
  for (const defect of [...answers.defects, ...answers.behaviours]) {
    const contents = await read(defect.file);
    if (defect.absent_marker) {
      assert.doesNotMatch(contents, new RegExp(defect.absent_marker, 'i'),
        `${defect.id}: ${defect.file} must not mention ${defect.absent_marker} — the gap is the defect`);
      continue;
    }
    const hits = contents.split(defect.marker).length - 1;
    assert.equal(hits, 1, `${defect.id}: expected exactly one "${defect.marker}" in ${defect.file}, found ${hits}`);
    for (const other of defect.also_in ?? []) {
      assert.ok(existsSync(path.join(fixture.path, other)), `${defect.id}: also_in names ${other}, which must exist`);
    }
    if (defect.contradicted_by) {
      assert.ok(existsSync(path.join(fixture.path, defect.contradicted_by)),
        `${defect.id}: names ${defect.contradicted_by} as the source that contradicts it, and that file must exist`);
    }
  }
});

test('the answer key never reaches the repository under test', () => {
  assert.equal(existsSync(path.join(fixture.path, 'layered-docs.answers.json')), false);
  const tracked = git('ls-files').split('\n');
  assert.equal(tracked.some((file) => file.includes('answers')), false,
    'a session that can read the answer key is not being evaluated');
  assert.ok(tracked.includes('README.md') && tracked.includes('docs/MANUAL.md'));
});

test('the fixture is a working repository: its own test suite passes with no install', () => {
  // `draft` runs the repository's own tests with the drafts in place, so a fixture
  // whose suite cannot run would fail that step for the wrong reason.
  // NODE_TEST_CONTEXT is set in this process because these tests run under
  // `node --test`; a child that inherits it reports to its parent runner instead
  // of stdout, and the assertion below would read an empty string.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const out = execFileSync('node', ['--test', 'test/sample.test.js'], { cwd: fixture.path, encoding: 'utf8', env });
  assert.match(out, /pass 2/);
  assert.match(out, /fail 0/);
});

test('the defects cover the shapes the skill claims to find, across all three entry points', () => {
  const kinds = new Set(answers.defects.map((defect) => defect.kind));
  for (const kind of ['trigger-mismatch', 'stale-count', 'command-does-not-exist', 'credential-in-prose',
    'restated-fact-disagrees', 'status-contradiction', 'overtaken-flag', 'overtaken-script-name']) {
    assert.ok(kinds.has(kind), `the fixture plants no ${kind}`);
  }
  for (const entry of ['audit', 'draft', 'update']) {
    assert.ok(answers.defects.some((defect) => defect.found_by.includes(entry)),
      `no planted defect is attributed to ${entry}`);
  }
  // An update run with only one shape of delta to find cannot be told apart from a run
  // that only diffs one kind of file.
  const updateShapes = new Set(answers.defects.filter((d) => d.found_by.includes('update')).map((d) => d.kind));
  assert.ok(updateShapes.size >= 3, `update has only ${updateShapes.size} shapes of delta to find`);
  // A behaviour is observed, not counted: keeping it out of the defects array keeps recall honest.
  assert.ok(answers.behaviours.some((b) => b.kind === 'closed-subject-held-back'));
  assert.equal(answers.defects.some((d) => d.kind.includes('closed-subject')), false);
});

test('the fixture narrates nothing about what it is testing', async () => {
  // A comment that says what a file plants hands the answer key to the session under test.
  for (const file of git('ls-files').split('\n')) {
    const contents = await read(file);
    assert.doesNotMatch(contents, /\bplant(ed|s)?\b|answer key|fixture/i, `${file} tells a reading session what is being graded`);
  }
});
