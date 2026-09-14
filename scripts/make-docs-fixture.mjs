#!/usr/bin/env node
// Materialises the layered-docs evaluation fixture: a small repository carrying
// planted documentation defects, with real history, so a run of
// `layer-repository-docs` has a baseline to read files at and a delta to update
// against. The answer key lives in the pack, never in the fixture — a session
// under test must not be able to read what it is supposed to find.
//
//   node scripts/make-docs-fixture.mjs [target-dir]
//
// Prints JSON: the path and the five commit shas.
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const template = path.join(here, '..', 'test', 'fixtures', 'layered-docs');

// Which files belong to which commit. The documentation lands after the code, so
// that the manual's "sources re-read at <sha>" names a revision that exists.
const CODE = [
  'package.json', '.github', 'src', 'scripts', 'test', 'generated', 'AGENTS.md',
  'docs/spec', 'docs/decisions.md',
];
const DOCS = ['README.md', 'HANDOFF.md', 'docs/MANUAL.md', 'docs/RUNBOOK.md'];

const git = (cwd, ...args) => execFileSync('git', args, {
  cwd,
  encoding: 'utf8',
  env: {
    ...process.env,
    GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.com',
    GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.com',
  },
}).trim();

export async function makeFixture(target) {
  const dir = target ?? await mkdtemp(path.join(tmpdir(), 'layered-docs-fixture-'));
  if (target && existsSync(target)) await rm(target, { recursive: true, force: true });
  await cp(path.join(template, 'base'), dir, { recursive: true });

  git(dir, 'init', '-q', '--initial-branch=main');
  git(dir, 'add', ...CODE);
  git(dir, 'commit', '-q', '-m', 'the service, its scripts and its records');
  const baseline = git(dir, 'rev-parse', 'HEAD');

  // The manual names the revision whose sources were read. That line is what an
  // `update` run looks for, so it has to be a real sha rather than a placeholder.
  const manual = path.join(dir, 'docs', 'MANUAL.md');
  await writeFile(manual, (await readFile(manual, 'utf8')).replace('{{BASELINE_SHA}}', baseline));
  git(dir, 'add', ...DOCS);
  git(dir, 'commit', '-q', '-m', 'a readme, a manual, a handoff and a runbook');
  const documented = git(dir, 'rev-parse', 'HEAD');

  // Three commits the documentation has not caught up with, starting here: this is
  // the delta an `update` run is supposed to find, and no document follows any of them.
  await cp(path.join(template, 'patches', '03-rename-flag'), dir, { recursive: true });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'deploy: --env becomes --target');
  const renamed = git(dir, 'rev-parse', 'HEAD');

  await cp(path.join(template, 'patches', '04-schedule'), dir, { recursive: true });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'ci: add a nightly schedule');
  const scheduled = git(dir, 'rev-parse', 'HEAD');

  // A third delta of a different shape: a manifest script renamed, which strands
  // every document — and one source string — that still says `npm run build`.
  await cp(path.join(template, 'patches', '05-rename-build'), dir, { recursive: true });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'build: the build script becomes registry');
  const rebuilt = git(dir, 'rev-parse', 'HEAD');

  return { path: dir, commits: { baseline, documented, renamed, scheduled, rebuilt } };
}

// Both sides resolved: argv[1] keeps a symlinked path as typed while import.meta.url
// is what Node resolved it to, and --preserve-symlinks-main moves the unresolved path
// to the other side. A generator that silently does nothing would leave the tests
// measuring an empty directory.
function isEntrypoint(moduleUrl) {
  const invoked = process.argv[1];
  if (!invoked) return false;
  const modulePath = fileURLToPath(moduleUrl);
  try {
    return realpathSync.native(invoked) === realpathSync.native(modulePath);
  } catch {
    return path.resolve(invoked) === modulePath;
  }
}

if (isEntrypoint(import.meta.url)) {
  console.log(JSON.stringify(await makeFixture(process.argv[2]), null, 2));
}
