#!/usr/bin/env node
/**
 * Verify the vendored agent-lifecycle skill exactly matches its recorded source.
 *
 * Usage:
 *   node scripts/check-agent-lifecycle-mirror.mjs
 *   node scripts/check-agent-lifecycle-mirror.mjs /path/to/agent-lifecycle-repository
 *
 * AGENT_LIFECYCLE_SOURCE, when set, must likewise name the source repository
 * root (the directory containing skills/agent-lifecycle), not the skill directory.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targetDir = join(scriptRoot, 'skills', 'agent-lifecycle');
const provenancePath = join(targetDir, 'provenance.json');
const sourceRoot = resolve(process.argv[2] ?? process.env.AGENT_LIFECYCLE_SOURCE ?? join(scriptRoot, '..', 'agent-lifecycle'));
const sourceDir = join(sourceRoot, 'skills', 'agent-lifecycle');
const failures = [];

function fail(message) {
  failures.push(message);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function filesUnder(directory, prefix = '') {
  if (!existsSync(directory)) return [];
  const entries = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) entries.push(...filesUnder(path, relativePath));
    else if (entry.isFile()) entries.push(relativePath);
  }
  return entries.sort();
}

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

if (!existsSync(provenancePath)) {
  fail(`missing provenance: ${relative(scriptRoot, provenancePath)}`);
} else {
  let provenance;
  try {
    provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
  } catch (error) {
    fail(`invalid provenance JSON: ${error.message}`);
  }

  if (provenance) {
    if (provenance.schemaVersion !== 1) fail(`unsupported provenance schemaVersion: ${provenance.schemaVersion}`);
    const expectedSource = provenance.source ?? {};
    const expectedFiles = provenance.files ?? {};
    const trackedFiles = Object.keys(expectedFiles).sort();

    if (!expectedSource.repository || !expectedSource.commit || !expectedSource.tag || expectedSource.path !== 'skills/agent-lifecycle') {
      fail('provenance source must include repository, commit, tag, and path skills/agent-lifecycle');
    }

    const actualTargetFiles = filesUnder(targetDir).filter((file) => file !== 'provenance.json');
    if (JSON.stringify(actualTargetFiles) !== JSON.stringify(trackedFiles)) {
      fail(`target files differ from provenance (expected ${trackedFiles.join(', ')}, got ${actualTargetFiles.join(', ')})`);
    }

    for (const file of trackedFiles) {
      const targetFile = join(targetDir, file);
      if (!existsSync(targetFile)) {
        fail(`missing target file: skills/agent-lifecycle/${file}`);
        continue;
      }
      const actualHash = sha256(targetFile);
      if (actualHash !== expectedFiles[file]) {
        fail(`target hash mismatch for ${file}: expected ${expectedFiles[file]}, got ${actualHash}`);
      }
    }

    if (!existsSync(sourceDir)) {
      fail(`source skill missing: ${sourceDir}`);
    } else {
      for (const file of trackedFiles) {
        const sourceFile = join(sourceDir, file);
        const targetFile = join(targetDir, file);
        if (!existsSync(sourceFile)) {
          fail(`source missing tracked file: ${file}`);
          continue;
        }
        if (sha256(sourceFile) !== expectedFiles[file]) fail(`source hash mismatch for ${file}`);
        if (readFileSync(sourceFile).compare(readFileSync(targetFile)) !== 0) fail(`byte drift from source for ${file}`);
      }
      const actualSourceFiles = filesUnder(sourceDir);
      if (JSON.stringify(actualSourceFiles) !== JSON.stringify(trackedFiles)) {
        fail(`source files differ from provenance (expected ${trackedFiles.join(', ')}, got ${actualSourceFiles.join(', ')})`);
      }

      try {
        const sourceCommit = git(sourceRoot, ['rev-parse', 'HEAD']);
        if (sourceCommit !== expectedSource.commit) fail(`source HEAD mismatch: expected ${expectedSource.commit}, got ${sourceCommit}`);
        const tagCommit = git(sourceRoot, ['rev-list', '-n', '1', expectedSource.tag]);
        if (tagCommit !== expectedSource.commit) fail(`source tag ${expectedSource.tag} resolves to ${tagCommit}, expected ${expectedSource.commit}`);
        const remote = git(sourceRoot, ['remote', 'get-url', 'origin']);
        if (remote !== expectedSource.repository) fail(`source origin mismatch: expected ${expectedSource.repository}, got ${remote}`);
      } catch (error) {
        fail(`could not verify source Git provenance: ${error.message}`);
      }
    }
  }
}

if (failures.length) {
  console.error(`agent-lifecycle mirror verification failed (${failures.length} issue${failures.length === 1 ? '' : 's'}):`);
  for (const message of failures) console.error(`- ${message}`);
  process.exitCode = 1;
} else {
  console.log('agent-lifecycle mirror verification passed.');
}
