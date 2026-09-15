import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { tempDir } from './helpers/temp-dir.mjs';

import {
  BUNDLER_PATH,
  BUNDLE_PATH,
  PACKAGE_JSON_PATH,
  SOURCE_DIR,
  checkBundle,
  parseBundle,
  renderHeader,
  sourceHash,
} from '../scripts/verify-journal-bundle.mjs';
import {
  COMMAND,
  MIN_NODE_MAJOR,
  buildWrapper,
  isOurs,
  main as installMain,
  onPath,
  shellQuote,
} from '../skills/decision-journal/scripts/install-cli.mjs';

// The decision-journal skill carries the agent-journal CLI as one bundled file,
// so that installing the skill installs the tool. That makes the same program
// exist twice, and every test here keeps the copy honest: that it IS the
// program, that it is current, that the check for "current" can detect what it
// names, and that the installer putting it on PATH never takes what isn't its.

const SOURCE_BIN = path.join(SOURCE_DIR, 'bin.ts');
const SKILL_DIR = path.join(SOURCE_DIR, '..', '..', '..', 'skills', 'decision-journal');

function runNode(args, env = {}) {
  return spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, ...env } });
}
const scratch = (prefix) => tempDir(prefix);
function sink() {
  let text = '';
  return { write(chunk) { text += chunk; }, get text() { return text; } };
}

// ---------------------------------------------------------------------------
// The bundle is the program.

test('the committed bundle is current: built from this source, body unedited', () => {
  assert.deepEqual(checkBundle(readFileSync(BUNDLE_PATH, 'utf8'), { currentSource: sourceHash() }), []);
});

test('the bundle is the same program as the source, at the interface', () => {
  const bundled = runNode([BUNDLE_PATH, 'help']);
  const source = runNode(['--experimental-strip-types', SOURCE_BIN, 'help']);
  assert.equal(bundled.status, 0, bundled.stderr);
  assert.equal(source.status, 0, source.stderr);
  assert.equal(bundled.stdout, source.stdout);
});

// Redaction is the one fail-closed path in this package. A bundle that lost it
// would write a credential to disk while every hash check above still passed.
test('the bundle still redacts, end to end', async () => {
  const env = { AGENT_JOURNAL_ROOT: await scratch('journal-bundle-'), AGENT_JOURNAL_SESSION: 's1' };
  const token = 'ghp' + '_' + 'a1b2c3d4e5'.repeat(3);
  const recorded = runNode([BUNDLE_PATH, 'record', '--workspace', 'w', '--kind', 'decision',
    '--question', 'q', '--chosen', 'c', '--rationale', `pushed with ${token} by mistake`], env);
  assert.equal(recorded.status, 0, recorded.stderr);
  const shown = runNode([BUNDLE_PATH, 'show', '--workspace', 'w'], env);
  assert.equal(shown.status, 0, shown.stderr);
  assert.ok(!shown.stdout.includes(token), 'a token survived the bundled redactor');
  assert.match(shown.stdout, /\[REDACTED\]/);
});

// ---------------------------------------------------------------------------
// The check for "current" can detect what it names.

const BODY = 'console.log(1);\n';
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

test('a bundle built from other source is reported stale', () => {
  const problems = checkBundle(renderHeader({ source: A, body: BODY }) + BODY, { currentSource: B });
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], /^stale:/);
});

test('a bundle edited by hand is reported even when its source hash is current', () => {
  const text = renderHeader({ source: A, body: BODY }) + BODY.replace('1', '2');
  const problems = checkBundle(text, { currentSource: A });
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], /^edited by hand:/);
});

test('a file without the generated header is not accepted as a bundle', () => {
  assert.equal(parseBundle(`#!/usr/bin/env node\n${BODY}`), null);
  assert.match(checkBundle(BODY, { currentSource: A })[0], /no generated header/);
});

test('an intact bundle from current source passes', () => {
  assert.deepEqual(checkBundle(renderHeader({ source: A, body: BODY }) + BODY, { currentSource: A }), []);
});

// A hash of contents alone would miss a rename, and would read "ab"+"cd" and
// "abc"+"d" as the same source. Each file is framed by its name to catch both.
test('the source hash moves with content, a rename, bytes moving between files, and any file esbuild could inline', async () => {
  async function hashOf(files) {
    const dir = await scratch('journal-src-');
    for (const [name, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
      await writeFile(path.join(dir, name), content);
    }
    return sourceHash(dir);
  }
  const base = await hashOf({ 'a.ts': 'ab', 'b.ts': 'cd' });
  assert.notEqual(await hashOf({ 'a.ts': 'ab', 'b.ts': 'ce' }), base, 'a content change went unnoticed');
  assert.notEqual(await hashOf({ 'a.ts': 'ab', 'c.ts': 'cd' }), base, 'a rename went unnoticed');
  assert.notEqual(await hashOf({ 'a.ts': 'abc', 'b.ts': 'd' }), base, 'bytes moving between files went unnoticed');
  // Each file is framed as its name, `src/<file>`, then its content. Without a separator
  // between frames, a.ts="x" + b.ts="y" and a lone a.ts="xsrc/b.tsy" are the same bytes.
  assert.notEqual(await hashOf({ 'a.ts': 'x', 'b.ts': 'y' }), await hashOf({ 'a.ts': 'xsrc/b.tsy' }),
    'a file whose content spells out another file was confused with it');
  assert.equal(await hashOf({ 'b.ts': 'cd', 'a.ts': 'ab' }), base, 'the order files were written in changed the hash');
  assert.notEqual(await hashOf({ 'a.ts': 'ab', 'b.ts': 'cd', 'data.json': '{}' }), base, 'a .json the source could import went unnoticed');
  assert.notEqual(await hashOf({ 'a.ts': 'ab', 'b.ts': 'cd', 'lib/c.ts': 'x' }), base, 'a file in a subdirectory went unnoticed');
});

// Every .ts file unchanged is not the same bundle if what bundles them changed.
test('changing how the bundle is built makes it stale too: the bundler script, or the esbuild it pins', async () => {
  const dir = await scratch('journal-src-');
  await writeFile(path.join(dir, 'a.ts'), 'ab');
  const bundler = path.join(dir, 'bundle-skill.mjs');
  const packageJson = path.join(dir, 'package.json');
  async function hashWith(bundlerText, esbuildVersion) {
    await writeFile(bundler, bundlerText);
    await writeFile(packageJson, JSON.stringify({ devDependencies: { esbuild: esbuildVersion } }));
    return sourceHash(dir, { bundler, packageJson });
  }
  const base = await hashWith('build()', '0.28.2');
  assert.notEqual(await hashWith('build({ minify: true })', '0.28.2'), base, 'a bundler change went unnoticed');
  assert.notEqual(await hashWith('build()', '0.29.0'), base, 'an esbuild upgrade went unnoticed');
  assert.equal(await hashWith('build()', '0.28.2'), base);
});

// ---------------------------------------------------------------------------
// The installer puts it on PATH, and never takes what isn't its.

async function carriedBundleAt(dir) {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'agent-journal.mjs');
  await writeFile(file, readFileSync(BUNDLE_PATH));
  return file;
}

// nodeVersion is pinned so these tests do not inherit the runner's Node: below the
// installer's floor every install refuses, and tests about something else fail for a
// reason none of them names.
async function install(argv, { home, bundlePath, PATH = '', nodeVersion = '24.0.0', ...context }) {
  const out = sink();
  const err = sink();
  const code = await installMain(argv, { env: { HOME: home, PATH }, stdout: out, stderr: err, bundlePath, nodeVersion, ...context });
  return { code, out: out.text, err: err.text };
}

test('installing writes a working command, even from a path with a space and a quote', async () => {
  const home = await scratch('journal-install-');
  const bundlePath = await carriedBundleAt(path.join(home, "it's a skill dir"));
  const binDir = path.join(home, 'bin');
  const result = await install(['--bin-dir', binDir], { home, bundlePath, PATH: binDir });
  assert.equal(result.code, 0, result.err);

  const command = path.join(binDir, COMMAND);
  assert.equal((await stat(command)).mode & 0o111, 0o111, 'the command is not executable');
  const ran = spawnSync(command, ['help'], { encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stderr);
  assert.match(ran.stdout, /agent-journal record/);
});

// A plugin update installs the skill to a new versioned folder and may delete the old one.
test('a command whose skill copy has moved says so, instead of a bare module-not-found', async () => {
  const home = await scratch('journal-install-');
  const bundlePath = await carriedBundleAt(path.join(home, 'skill-1.0.0'));
  const binDir = path.join(home, 'bin');
  assert.equal((await install(['--bin-dir', binDir], { home, bundlePath })).code, 0);
  await rm(bundlePath);
  const ran = spawnSync(path.join(binDir, COMMAND), ['help'], { encoding: 'utf8' });
  assert.equal(ran.status, 127, ran.stderr);
  assert.match(ran.stderr, /is gone/);
  assert.match(ran.stderr, /install-cli\.mjs/);
});

test('by default the command goes to ~/.local/bin', async () => {
  const home = await scratch('journal-install-');
  const bundlePath = await carriedBundleAt(path.join(home, 'skill'));
  const result = await install([], { home, bundlePath });
  assert.equal(result.code, 0, result.err);
  assert.ok(isOurs(await readFile(path.join(home, '.local', 'bin', COMMAND), 'utf8')));
});

test('re-running replaces its own command instead of refusing', async () => {
  const home = await scratch('journal-install-');
  const bundlePath = await carriedBundleAt(path.join(home, 'skill'));
  const binDir = path.join(home, 'bin');
  assert.equal((await install(['--bin-dir', binDir], { home, bundlePath })).code, 0);
  const again = await install(['--bin-dir', binDir], { home, bundlePath });
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /^Updated /);
});

// The rule the pack's freshness-hook installer keeps: a file wearing this name
// that this installer did not write is somebody else's decision.
test('an agent-journal this installer did not write is never overwritten', async () => {
  const home = await scratch('journal-install-');
  const bundlePath = await carriedBundleAt(path.join(home, 'skill'));
  const binDir = path.join(home, 'bin');
  await mkdir(binDir, { recursive: true });
  const foreign = '#!/bin/sh\necho "installed some other way"\n';
  await writeFile(path.join(binDir, COMMAND), foreign);

  const result = await install(['--bin-dir', binDir], { home, bundlePath });
  assert.equal(result.code, 1);
  assert.match(result.err, /refusing to overwrite/);
  assert.equal(await readFile(path.join(binDir, COMMAND), 'utf8'), foreign);
});

test('--remove deletes its own command, and only its own', async () => {
  const home = await scratch('journal-install-');
  const bundlePath = await carriedBundleAt(path.join(home, 'skill'));
  const binDir = path.join(home, 'bin');
  await install(['--bin-dir', binDir], { home, bundlePath });

  const removed = await install(['--remove', '--bin-dir', binDir], { home, bundlePath });
  assert.equal(removed.code, 0, removed.err);
  await assert.rejects(stat(path.join(binDir, COMMAND)), { code: 'ENOENT' });

  const nothing = await install(['--remove', '--bin-dir', binDir], { home, bundlePath });
  assert.equal(nothing.code, 0);
  assert.match(nothing.out, /Nothing changed/);

  const foreign = '#!/bin/sh\necho mine\n';
  await writeFile(path.join(binDir, COMMAND), foreign);
  const refused = await install(['--remove', '--bin-dir', binDir], { home, bundlePath });
  assert.equal(refused.code, 1);
  assert.equal(await readFile(path.join(binDir, COMMAND), 'utf8'), foreign);
});

test('a missing bundle is refused rather than installed as a command that runs nothing', async () => {
  const home = await scratch('journal-install-');
  const binDir = path.join(home, 'bin');
  const result = await install(['--bin-dir', binDir], { home, bundlePath: path.join(home, 'gone', 'agent-journal.mjs') });
  assert.equal(result.code, 1);
  assert.match(result.err, /missing/);
  await assert.rejects(stat(path.join(binDir, COMMAND)), { code: 'ENOENT' });
});

test('a bin directory missing from PATH is reported, and one on it is not', async () => {
  const home = await scratch('journal-install-');
  const bundlePath = await carriedBundleAt(path.join(home, 'skill'));
  const binDir = path.join(home, 'bin');
  const off = await install(['--bin-dir', binDir], { home, bundlePath, PATH: '/usr/bin' });
  assert.match(off.out, /is not on your PATH/);
  const on = await install(['--bin-dir', binDir], { home, bundlePath, PATH: `/usr/bin${path.delimiter}${binDir}` });
  assert.doesNotMatch(on.out, /is not on your PATH/);
});

test('PATH entries are compared as resolved paths', () => {
  assert.equal(onPath('/a/b', `/x${path.delimiter}/a/b/`), true);
  assert.equal(onPath('/a/b', `/x${path.delimiter}/a/bc`), false);
});

test('an older Node.js is refused at install time, not discovered at first use — and removal still works on one', async () => {
  const home = await scratch('journal-install-');
  const bundlePath = await carriedBundleAt(path.join(home, 'skill'));
  const binDir = path.join(home, 'bin');
  const old = await install(['--bin-dir', binDir], { home, bundlePath, nodeVersion: '20.19.5' });
  assert.equal(old.code, 1);
  assert.match(old.err, new RegExp(`Node\\.js ${MIN_NODE_MAJOR} or newer, and this is 20\\.19\\.5`));
  await assert.rejects(stat(path.join(binDir, COMMAND)), { code: 'ENOENT' });

  assert.equal((await install(['--bin-dir', binDir], { home, bundlePath, nodeVersion: '24.0.0' })).code, 0);
  const removed = await install(['--remove', '--bin-dir', binDir], { home, bundlePath, nodeVersion: '20.19.5' });
  assert.equal(removed.code, 0, removed.err);
});

// Observed 2026-09-13 on a machine whose PATH `node` is v22.22.3: the installer
// wrote nothing and exited 1, so the `agent-journal` command was never on PATH and
// the skill's authoring-floor hook could not be armed at all — on a Node that runs
// every one of the CLI's subcommands. The floor had been set to the version the
// repository develops on, not the oldest one the shipped bundle was run on.
test('the Node the bundle was verified on installs, instead of being refused', async () => {
  const home = await scratch('journal-install-');
  const bundlePath = await carriedBundleAt(path.join(home, 'skill'));
  const binDir = path.join(home, 'bin');
  for (const nodeVersion of ['22.0.0', '22.22.3']) {
    const result = await install(['--bin-dir', binDir], { home, bundlePath, nodeVersion });
    assert.equal(result.code, 0, `${nodeVersion}: ${result.err}`);
  }
  const ran = spawnSync(path.join(binDir, COMMAND), ['help'], { encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stderr);
});

// The same number is written out in four files that cannot import one another: the
// installer ships inside the skill, the bundler and the manifest stay in the package,
// and SKILL.md is what a reader is told before any of it runs. Nothing ties them
// together, and this repository has already had two copies of one fact drift apart.
// A bundler target above the installer's floor is the silent one: esbuild would emit
// syntax the Node the installer just approved cannot parse, and the first failure a
// user sees is a SyntaxError from a command that installed cleanly.
test('every statement of the Node floor names the same major', () => {
  const engines = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')).engines.node;
  assert.match(engines, new RegExp(`^>=${MIN_NODE_MAJOR}\\.`), `packages/agent-journal engines is ${engines}`);

  const bundler = readFileSync(BUNDLER_PATH, 'utf8');
  assert.match(bundler, new RegExp(`target: 'node${MIN_NODE_MAJOR}'`), 'the esbuild target is not the installer\'s floor');

  const skill = readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
  assert.match(skill, new RegExp(`Node\\.js ${MIN_NODE_MAJOR}\\+`), 'SKILL.md advertises a different floor');
});

test('Windows is refused, with the way to run the CLI directly instead', async () => {
  const home = await scratch('journal-install-');
  const binDir = path.join(home, 'bin');
  const result = await install(['--bin-dir', binDir], { home, bundlePath: '/skill/scripts/agent-journal.mjs', platform: 'win32' });
  assert.equal(result.code, 1);
  assert.match(result.err, /node \/skill\/scripts\/agent-journal\.mjs help/);
  await assert.rejects(stat(binDir), { code: 'ENOENT' });
});

test('an unknown argument, or --bin-dir with no value, is a usage error', async () => {
  const home = await scratch('journal-install-');
  assert.equal((await install(['--frobnicate'], { home, bundlePath: 'x' })).code, 1);
  assert.equal((await install(['--bin-dir'], { home, bundlePath: 'x' })).code, 1);
});

test('shell quoting survives an embedded single quote', () => {
  assert.equal(shellQuote("it's"), `'it'\\''s'`);
  assert.ok(buildWrapper({ bundlePath: "/x/it's/a.mjs" }).includes(`'/x/it'\\''s/a.mjs'`));
});
