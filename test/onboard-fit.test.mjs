import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers/temp-dir.mjs';

import {
  FIT_KINDS,
  LIMITS,
  evaluateRepoSignals,
  forgetRepoIndex,
  loadCatalogue,
  matchesGlob,
  readManifestField,
  repoIndex,
  signalId,
} from '../skills/onboard-project/scripts/fit.mjs';

const fixture = (name) => fileURLToPath(new URL(`fixtures/onboard/${name}/`, import.meta.url));
const packRoot = fileURLToPath(new URL('../', import.meta.url));

const signals = (list, kind = 'anyOf') => ({ version: 1, kind: 'signals', useWhen: 'a test', [kind]: list });

test('the three kinds are the only ones, and nothing else is a signals kind', () => {
  assert.deepEqual([...FIT_KINDS], ['signals', 'general', 'requestOnly']);
});

test('exists matches a file, a directory written with a trailing slash, and a glob', () => {
  const file = signals([{ repo: { exists: 'CHANGELOG.md' } }]);
  assert.equal(evaluateRepoSignals(file, fixture('bare')).matched, false);

  const directory = signals([{ repo: { exists: '.changeset/' } }]);
  assert.equal(evaluateRepoSignals(directory, fixture('changesets')).matched, true);
  assert.equal(evaluateRepoSignals(directory, fixture('versioned-node')).matched, false);

  const glob = signals([{ repo: { exists: '**/*.ts' } }]);
  assert.equal(evaluateRepoSignals(glob, fixture('webhooks')).matched, true);
  assert.equal(evaluateRepoSignals(glob, fixture('bare')).matched, false);
});

test('a json field is read by its dotted path, and a missing field is false, not an error', () => {
  const version = signals([{ repo: { json: 'package.json', field: 'version' } }]);
  assert.equal(evaluateRepoSignals(version, fixture('versioned-node')).matched, true);
  // The changesets fixture has a package.json with no version: present file, absent field.
  assert.equal(evaluateRepoSignals(version, fixture('changesets')).matched, false);
  assert.equal(evaluateRepoSignals(version, fixture('bare')).matched, false);

  const nested = signals([{ repo: { json: 'package.json', field: 'scripts.build' } }]);
  assert.equal(evaluateRepoSignals(nested, fixture('versioned-node')).matched, true);
  assert.equal(evaluateRepoSignals(nested, fixture('changesets')).matched, false);
});

test('shallow toml and yaml field readers find a version where a json one cannot', () => {
  const cargo = signals([{ repo: { toml: 'Cargo.toml', field: 'package.version' } }]);
  assert.equal(evaluateRepoSignals(cargo, fixture('rust-crate')).matched, true);
  assert.equal(evaluateRepoSignals(cargo, fixture('versioned-node')).matched, false);

  const pubspec = signals([{ repo: { yaml: 'pubspec.yaml', field: 'version' } }]);
  assert.equal(evaluateRepoSignals(pubspec, fixture('flutter-app')).matched, true);
  const sdk = signals([{ repo: { yaml: 'pubspec.yaml', field: 'environment.sdk' } }]);
  assert.equal(evaluateRepoSignals(sdk, fixture('flutter-app')).matched, true);
  const absent = signals([{ repo: { yaml: 'pubspec.yaml', field: 'publish_to' } }]);
  assert.equal(evaluateRepoSignals(absent, fixture('flutter-app')).matched, false);

  assert.equal(readManifestField(fixture('rust-crate'), 'toml', 'Cargo.toml', 'package.name'), 'example-crate');
  assert.equal(readManifestField(fixture('bare'), 'toml', 'Cargo.toml', 'package.name'), undefined);
});

test('grep searches a bounded glob and says how many files carried the pattern', () => {
  const webhook = signals([{ repo: { grep: 'createHmac', globs: ['**/*.ts'] } }]);
  const hit = evaluateRepoSignals(webhook, fixture('webhooks'));
  assert.equal(hit.matched, true);
  assert.match(hit.evidence[0], /createHmac appears in src\/webhook\.ts/);
  assert.equal(evaluateRepoSignals(webhook, fixture('versioned-node')).matched, false);
});

test('anyOf needs one, allOf needs every one', () => {
  const either = signals([
    { repo: { exists: 'CHANGELOG.md' } },
    { repo: { json: 'package.json', field: 'version' } },
  ]);
  assert.equal(evaluateRepoSignals(either, fixture('versioned-node')).matched, true);

  const both = signals([
    { repo: { exists: 'CHANGELOG.md' } },
    { repo: { json: 'package.json', field: 'version' } },
  ], 'allOf');
  assert.equal(evaluateRepoSignals(both, fixture('versioned-node')).matched, false);

  const bothPresent = signals([
    { repo: { exists: 'README.md' } },
    { repo: { json: 'package.json', field: 'version' } },
  ], 'allOf');
  assert.equal(evaluateRepoSignals(bothPresent, fixture('versioned-node')).matched, true);
});

test('a history signal is unknown, not false, when this repository has no history here', () => {
  const fit = signals([{ history: { count: 'agentDispatches', atLeast: 5 } }]);
  const noCounts = evaluateRepoSignals(fit, fixture('bare'), { counts: { known: false } });
  assert.equal(noCounts.matched, false);
  assert.deepEqual(noCounts.unknownSignals, ['history:agentDispatches>=5']);

  const enough = evaluateRepoSignals(fit, fixture('bare'), { counts: { known: true, agentDispatches: 9 } });
  assert.equal(enough.matched, true);
  assert.deepEqual(enough.unknownSignals, []);
  assert.match(enough.evidence[0], /9 agent dispatches/);

  const tooFew = evaluateRepoSignals(fit, fixture('bare'), { counts: { known: true, agentDispatches: 1 } });
  assert.equal(tooFew.matched, false);
  assert.deepEqual(tooFew.unknownSignals, []);
});

test('a repo signal never depends on history, so the same fit evaluates identically without counts', () => {
  const fit = signals([
    { repo: { json: 'package.json', field: 'version' } },
    { history: { count: 'releaseCommands', atLeast: 1 } },
  ]);
  const withoutHistory = evaluateRepoSignals(fit, fixture('versioned-node'), { counts: { known: false } });
  assert.equal(withoutHistory.matched, true);
  assert.deepEqual(withoutHistory.trueSignals, ['json:package.json#version']);
});

test('signal ids are stable strings, which is what the fingerprint is built from', () => {
  assert.equal(signalId({ repo: { exists: '.changeset/' } }), 'exists:.changeset/');
  assert.equal(signalId({ repo: { json: 'package.json', field: 'version' } }), 'json:package.json#version');
  assert.equal(signalId({ repo: { grep: 'createHmac', globs: ['**/*.ts', '**/*.js'] } }), 'grep:createHmac@**/*.ts,**/*.js');
  assert.equal(signalId({ history: { count: 'agentDispatches', atLeast: 5 } }), 'history:agentDispatches>=5');
});

test('the glob matcher keeps * inside one segment and ** across segments', () => {
  assert.equal(matchesGlob('src/webhook.ts', '**/*.ts'), true);
  assert.equal(matchesGlob('webhook.ts', '**/*.ts'), true);
  assert.equal(matchesGlob('src/webhook.ts', '*.ts'), false);
  assert.equal(matchesGlob('src/deep/webhook.ts', 'src/**/*.ts'), true);
  assert.equal(matchesGlob('.changeset/config.json', '.changeset/'), true);
});

test('the repository index skips the directories a scan has no business walking', () => {
  const index = repoIndex(fixture('webhooks'));
  assert.ok(index.files.includes('src/webhook.ts'));
  assert.ok(!index.files.some((file) => file.includes('node_modules')));
  assert.equal(index.truncated, false);
});

test('the pack catalogue loads every skill that carries a fit.json', () => {
  const catalogue = loadCatalogue(packRoot);
  assert.ok(catalogue.size >= 1, 'no fit.json files discovered');
  for (const [name, fit] of catalogue) {
    assert.ok(FIT_KINDS.includes(fit.kind), `${name}: unknown kind ${fit.kind}`);
    if (fit.kind === 'signals') assert.ok(fit.useWhen, `${name}: a signals fit needs a useWhen line`);
  }
});

test('a missing file is evidence, and only for an exact path', () => {
  const noReadme = signals([{ repo: { missing: 'README.md' } }]);
  assert.equal(evaluateRepoSignals(noReadme, fixture('rust-crate')).matched, true);
  assert.equal(evaluateRepoSignals(noReadme, fixture('bare')).matched, false);
  assert.match(evaluateRepoSignals(noReadme, fixture('rust-crate')).evidence[0], /README\.md is not in this repository/);
  assert.equal(signalId({ repo: { missing: 'CLAUDE.md' } }), 'missing:CLAUDE.md');
});

test('the shipped fit.json files match the repositories they should, and not the ones they should not', () => {
  const catalogue = loadCatalogue(packRoot);
  const table = [
    ['release-notes', 'versioned-node', 'bare'],
    ['release-notes', 'rust-crate', 'bare'],
    ['release-notes', 'changesets', 'bare'],
    ['github-webhooks', 'webhooks', 'versioned-node'],
    ['secure-credential-setup', 'webhooks', 'bare'],
    ['derive-codebase-context', 'bare', null],
    ['layer-repository-docs', 'rust-crate', 'versioned-node'],
  ];
  for (const [skill, matching, notMatching] of table) {
    const fit = catalogue.get(skill);
    assert.ok(fit, `${skill} carries no fit.json`);
    assert.equal(evaluateRepoSignals(fit, fixture(matching)).matched, true, `${skill} did not match ${matching}`);
    if (notMatching) {
      assert.equal(evaluateRepoSignals(fit, fixture(notMatching)).matched, false, `${skill} matched ${notMatching}, which it should not`);
    }
  }
});

test('every shipped signals fit is readable by the evaluator, and every skill declares a kind', () => {
  const catalogue = loadCatalogue(packRoot);
  assert.ok(catalogue.size >= 26, `only ${catalogue.size} fit.json files found`);
  for (const [name, fit] of catalogue) {
    assert.ok(FIT_KINDS.includes(fit.kind), `${name}: ${fit.kind}`);
    assert.ok(typeof fit.useWhen === 'string' && fit.useWhen.length > 0, `${name}: no useWhen`);
    if (fit.kind !== 'signals') continue;
    const list = fit.anyOf ?? fit.allOf;
    for (const signal of list) assert.notEqual(signalId(signal), 'unreadable', `${name}: ${JSON.stringify(signal)}`);
  }
});

test('exists and missing answer the filesystem, not a case-sensitive string set', async () => {
  // Found on a real repository: the file on disk was `claude.md`, the signal asked for `CLAUDE.md`,
  // and the volume was case-insensitive — so the session loaded the file while the scan reported it
  // missing, and recommended the skill whose whole job is a repository with no context file.
  const { existsSync } = await import('node:fs');
  const nodePath = path;

  const root = await tempDir('fit-case-');
  await writeFile(nodePath.join(root, 'claude.md'), '# context\n');
  await writeFile(nodePath.join(root, 'README.md'), '# readme\n');
  forgetRepoIndex(root);

  // Whatever this filesystem says about the differently-cased name, both signals must agree with it.
  const filesystemSaysPresent = existsSync(nodePath.join(root, 'CLAUDE.md'));
  const exists = { version: 1, kind: 'signals', useWhen: 'x', anyOf: [{ repo: { exists: 'CLAUDE.md' } }] };
  const missing = { version: 1, kind: 'signals', useWhen: 'x', anyOf: [{ repo: { missing: 'CLAUDE.md' } }] };
  assert.equal(evaluateRepoSignals(exists, root).matched, filesystemSaysPresent);
  assert.equal(evaluateRepoSignals(missing, root).matched, !filesystemSaysPresent);

  // And the exact-case cases are unambiguous on every filesystem.
  assert.equal(evaluateRepoSignals({ ...exists, anyOf: [{ repo: { exists: 'README.md' } }] }, root).matched, true);
  assert.equal(evaluateRepoSignals({ ...missing, anyOf: [{ repo: { missing: 'README.md' } }] }, root).matched, false);
  assert.equal(evaluateRepoSignals({ ...missing, anyOf: [{ repo: { missing: 'nothing-here.md' } }] }, root).matched, true);
});

test('a plain path is found below the index walk depth, where a glob cannot reach', async () => {
  const nodePath = path;
  const root = await tempDir('fit-deep-');
  const deep = nodePath.join(root, ...Array.from({ length: 14 }, (_, index) => `level-${index}`));
  await mkdir(deep, { recursive: true });
  await writeFile(nodePath.join(deep, 'buried.txt'), 'x\n');
  forgetRepoIndex(root);

  const relative = nodePath.relative(root, nodePath.join(deep, 'buried.txt')).split(nodePath.sep).join('/');
  const fit = { version: 1, kind: 'signals', useWhen: 'x', anyOf: [{ repo: { exists: relative } }] };
  assert.equal(evaluateRepoSignals(fit, root).matched, true, 'a named path below the walk depth was reported absent');
});


// ---- review of 0.22.0: truncation, directory globs, grep order, history budget ------------------

/** Run `body` with the evaluator's bounds lowered, and put them back whatever happens. */
async function withLimits(overrides, body) {
  const saved = { ...LIMITS };
  Object.assign(LIMITS, overrides);
  try {
    return await body();
  } finally {
    Object.assign(LIMITS, saved);
  }
}

test('a glob that finds nothing in a truncated index is unknown, not false', async () => {
  const root = await tempDir('fit-truncated-');
  await mkdir(path.join(root, 'aaa-big'), { recursive: true });
  for (let index = 0; index < 12; index += 1) await writeFile(path.join(root, 'aaa-big', `f${index}.txt`), 'x\n');
  await mkdir(path.join(root, 'zzz', 'migrations'), { recursive: true });
  await writeFile(path.join(root, 'zzz', 'migrations', '0001.sql'), 'select 1;\n');

  await withLimits({ files: 5 }, () => {
    forgetRepoIndex(root);
    assert.equal(repoIndex(root).truncated, true, 'the fixture did not truncate the walk');
    const result = evaluateRepoSignals(signals([{ repo: { exists: '**/*.sql' } }]), root);
    assert.equal(result.matched, false);
    assert.deepEqual(result.unknownSignals, ['exists:**/*.sql'], 'an incomplete walk reported a glob as absent');
    assert.deepEqual(result.trueSignals, []);
  });
  forgetRepoIndex(root);
});

test('a glob that does find something in a truncated index is still true', async () => {
  const root = await tempDir('fit-truncated-hit-');
  for (let index = 0; index < 12; index += 1) await writeFile(path.join(root, `a${index}.sql`), 'select 1;\n');
  await withLimits({ files: 5 }, () => {
    forgetRepoIndex(root);
    assert.equal(evaluateRepoSignals(signals([{ repo: { exists: '*.sql' } }]), root).matched, true);
  });
  forgetRepoIndex(root);
});

test('a walk cut short by depth says it was cut short', async () => {
  const root = await tempDir('fit-depth-flag-');
  await mkdir(path.join(root, 'a', 'b', 'c', 'd'), { recursive: true });
  await writeFile(path.join(root, 'a', 'b', 'c', 'd', 'deep.txt'), 'x\n');
  await withLimits({ depth: 1 }, () => {
    forgetRepoIndex(root);
    assert.equal(repoIndex(root).truncated, true);
  });
  forgetRepoIndex(root);
});

test('a directory pattern with a wildcard is a glob, not a literal', () => {
  assert.equal(matchesGlob('app/migrations/0001_initial.py', '**/migrations/'), true);
  assert.equal(matchesGlob('app/migrations', '**/migrations/'), true);
  assert.equal(matchesGlob('migrations/0001.sql', '**/migrations/'), true);
  assert.equal(matchesGlob('src/db/migrations/x.ts', 'src/*/migrations/'), true);
  assert.equal(matchesGlob('app/migrations-old/0001.py', '**/migrations/'), false);
  assert.equal(matchesGlob('app/notmigrations/0001.py', '**/migrations/'), false);
});

test('land-complex-change matches a repository whose only cross-surface evidence is a migrations directory', async () => {
  const root = await tempDir('fit-django-');
  await mkdir(path.join(root, 'shop', 'migrations'), { recursive: true });
  await writeFile(path.join(root, 'shop', 'migrations', '0001_initial.py'), '# generated\n');
  await writeFile(path.join(root, 'manage.py'), '#!/usr/bin/env python\n');
  forgetRepoIndex(root);
  const fit = loadCatalogue(packRoot).get('land-complex-change');
  const result = evaluateRepoSignals(fit, root);
  assert.equal(result.matched, true, 'the shipped **/migrations/ signal still never matches');
  assert.ok(result.trueSignals.includes('exists:**/migrations/'));
});

test('grep finds a match wherever it sits in walk order, and names the file it found', async () => {
  const root = await tempDir('fit-grep-order-');
  await mkdir(path.join(root, 'aaa'), { recursive: true });
  for (let index = 0; index < 450; index += 1) await writeFile(path.join(root, 'aaa', `f${String(index).padStart(3, '0')}.ts`), 'export {}\n');
  await mkdir(path.join(root, 'zzz'), { recursive: true });
  await writeFile(path.join(root, 'zzz', 'hook.ts'), "const header = 'x-hub-signature-256'\n");
  forgetRepoIndex(root);

  const fit = signals([{ repo: { grep: 'x-hub-signature', globs: ['**/*.ts'] } }]);
  const first = evaluateRepoSignals(fit, root);
  assert.equal(first.matched, true, 'a match past the first 400 candidates was missed');
  assert.match(first.evidence[0], /zzz\/hook\.ts/);

  // One more unrelated file must not move the answer, which is what moved the fingerprint.
  await writeFile(path.join(root, 'aaa', 'extra.ts'), 'export {}\n');
  forgetRepoIndex(root);
  assert.equal(evaluateRepoSignals(fit, root).matched, true);
});

test('a grep that runs out of its byte budget before finding anything is unknown, not false', async () => {
  const root = await tempDir('fit-grep-budget-');
  for (let index = 0; index < 20; index += 1) await writeFile(path.join(root, `f${index}.ts`), `${'x'.repeat(200)}\n`);
  await withLimits({ grepTotalBytes: 500 }, () => {
    forgetRepoIndex(root);
    const result = evaluateRepoSignals(signals([{ repo: { grep: 'never-present', globs: ['*.ts'] } }]), root);
    assert.equal(result.matched, false);
    assert.deepEqual(result.unknownSignals, ['grep:never-present@*.ts']);
  });
  forgetRepoIndex(root);
});

test('a history count below its threshold is unknown when the history read was cut short', () => {
  const fit = signals([{ history: { count: 'agentDispatches', atLeast: 5 } }]);
  const cutShort = evaluateRepoSignals(fit, fixture('bare'), { counts: { known: true, truncated: true, agentDispatches: 2 } });
  assert.equal(cutShort.matched, false);
  assert.deepEqual(cutShort.unknownSignals, ['history:agentDispatches>=5']);
  const enoughAnyway = evaluateRepoSignals(fit, fixture('bare'), { counts: { known: true, truncated: true, agentDispatches: 7 } });
  assert.equal(enoughAnyway.matched, true, 'a count already past its threshold is true however much was left unread');
});

test('evidence is never taken from a tool\'s own build output', async () => {
  const root = await tempDir('fit-build-output-');
  await mkdir(path.join(root, '.trigger', 'tmp', 'build-abc'), { recursive: true });
  await writeFile(path.join(root, '.trigger', 'tmp', 'build-abc', 'bundle.mjs'), 'process.env.API_KEY\n');
  forgetRepoIndex(root);
  const result = evaluateRepoSignals(signals([{ repo: { grep: 'API_KEY', globs: ['**/*.mjs'] } }]), root);
  assert.equal(result.matched, false, 'a generated bundle was read as the repository\'s own source');
});

test('a grep whose only match sits in a file too large to read is unknown, not false', async () => {
  const root = await tempDir('fit-grep-oversized-');
  await writeFile(path.join(root, 'small.ts'), 'export {}\n');
  await writeFile(path.join(root, 'large.ts'), `// ${'x'.repeat(300)}\nconst header = 'x-hub-signature-256'\n`);
  await withLimits({ grepFileBytes: 100 }, () => {
    forgetRepoIndex(root);
    const result = evaluateRepoSignals(signals([{ repo: { grep: 'x-hub-signature', globs: ['*.ts'] } }]), root);
    assert.equal(result.matched, false);
    assert.deepEqual(result.unknownSignals, ['grep:x-hub-signature@*.ts'], 'a file skipped for its size read as no match');
  });
  forgetRepoIndex(root);
});
