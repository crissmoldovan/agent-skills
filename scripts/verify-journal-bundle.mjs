#!/usr/bin/env node
/**
 * Verify that the agent-journal CLI carried inside the decision-journal skill is
 * the one built from the current source, and has not been edited by hand.
 *
 * The skill carries the CLI as one bundled file so that installing the skill
 * installs the tool. That means the same program exists twice — its source in
 * packages/agent-journal/src and a generated copy in the skill — and two copies of
 * one thing is the shape of several bugs in this repository's history: a
 * duplicated list that drifted, two path resolvers that diverged. So the copy
 * records, in its header, a hash of the source it was built from and a hash of its
 * own body, and this check recomputes both.
 *
 * "Source" means every input that decides what the bundle contains: the .ts files,
 * the script that bundles them, and the esbuild version that script runs. A change
 * to any of them without regenerating is the same stale copy.
 *
 * Deliberately dependency-free: it hashes, it does not rebuild. A runner needs no
 * bundler to tell that a copy is stale — only that the inputs it claims to come
 * from are not the inputs that are here.
 *
 * Both failures have the same fix — the bundle is generated, never written:
 *   npm --prefix packages/agent-journal run bundle:skill
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const SOURCE_DIR = join(ROOT, 'packages', 'agent-journal', 'src');
export const BUNDLER_PATH = join(ROOT, 'packages', 'agent-journal', 'scripts', 'bundle-skill.mjs');
export const PACKAGE_JSON_PATH = join(ROOT, 'packages', 'agent-journal', 'package.json');
export const BUNDLE_PATH = join(ROOT, 'skills', 'decision-journal', 'scripts', 'agent-journal.mjs');
export const REGENERATE = 'npm --prefix packages/agent-journal run bundle:skill';

const SHEBANG = '#!/usr/bin/env node';
/** How a reader — and this check — knows the file is generated. */
export const GENERATED_MARKER = '// GENERATED from packages/agent-journal/src by bundle:skill. Do not edit.';
const SOURCE_LINE = '// source-sha256: ';
const BODY_LINE = '// body-sha256: ';

/**
 * One hash over every input to the bundle. The .ts files in the source directory,
 * sorted, each framed by its own name and a separator: the name is what makes a
 * rename register, the separator what stops "ab"+"cd" and "abc"+"d" — or content
 * that happens to spell another file's name — hashing alike. Only .ts: nothing
 * else in src/ is compiled. Then the bundler script and the esbuild version it
 * pins, because either one changes the bundle while every .ts file stays the same.
 */
export function sourceHash(dir = SOURCE_DIR, { bundler = BUNDLER_PATH, packageJson = PACKAGE_JSON_PATH } = {}) {
  const hash = createHash('sha256');
  const frame = (name, content) => {
    hash.update(name);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  };
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.ts')).sort()) {
    frame(`src/${file}`, readFileSync(join(dir, file)));
  }
  frame('bundler', readFileSync(bundler));
  frame('esbuild', JSON.parse(readFileSync(packageJson, 'utf8')).devDependencies?.esbuild ?? '');
  return hash.digest('hex');
}

export function bodyHash(body) {
  return createHash('sha256').update(body).digest('hex');
}

/** The header the bundler writes. Defined here so the bundler and this check can never disagree on it. */
export function renderHeader({ source, body }) {
  return [SHEBANG, GENERATED_MARKER, `${SOURCE_LINE}${source}`, `${BODY_LINE}${bodyHash(body)}`, ''].join('\n');
}

/** Split a bundle into its recorded hashes and the body they cover, or null if it has no generated header. */
export function parseBundle(text) {
  const lines = text.split('\n');
  if (lines[0] !== SHEBANG || lines[1] !== GENERATED_MARKER) return null;
  const source = lines[2]?.startsWith(SOURCE_LINE) ? lines[2].slice(SOURCE_LINE.length) : '';
  const bodyRecorded = lines[3]?.startsWith(BODY_LINE) ? lines[3].slice(BODY_LINE.length) : '';
  if (!source || !bodyRecorded) return null;
  return { source, bodyRecorded, body: lines.slice(4).join('\n') };
}

/** The whole check, pure: text in, problems out. */
export function checkBundle(text, { currentSource }) {
  const parsed = parseBundle(text);
  if (!parsed) return ['the bundle has no generated header — it was not produced by bundle:skill'];
  const problems = [];
  if (parsed.source !== currentSource) {
    problems.push(`stale: its inputs changed since this bundle was generated (recorded ${parsed.source.slice(0, 12)}…, now ${currentSource.slice(0, 12)}…)`);
  }
  if (bodyHash(parsed.body) !== parsed.bodyRecorded) {
    problems.push('edited by hand: the body no longer matches the hash it was generated with');
  }
  return problems;
}

export function main() {
  let text;
  try {
    text = readFileSync(BUNDLE_PATH, 'utf8');
  } catch (error) {
    console.error(`Journal CLI bundle missing: ${relative(ROOT, BUNDLE_PATH)} (${error.code ?? error.message})`);
    console.error(`Generate it with: ${REGENERATE}`);
    return 1;
  }
  const problems = checkBundle(text, { currentSource: sourceHash() });
  if (problems.length > 0) {
    console.error(`Journal CLI bundle check failed: ${relative(ROOT, BUNDLE_PATH)}`);
    for (const problem of problems) console.error(`- ${problem}`);
    console.error(`Regenerate with: ${REGENERATE}`);
    return 1;
  }
  console.log('Journal CLI bundle is current: built from this source, body unedited.');
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = main();
}
