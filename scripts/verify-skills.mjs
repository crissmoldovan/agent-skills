#!/usr/bin/env node
/**
 * Validate the public skill catalog without external dependencies.
 */
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { resolve, relative, dirname, sep } from 'node:path';

const root = process.cwd();
const skillsRoot = resolve(root, 'skills');
const runtimeRoot = resolve(root, 'packages', 'agent-lifecycle');
const failures = [];
const textExtensions = new Set(['.md', '.mdx', '.txt', '.json', '.yml', '.yaml', '.js', '.mjs', '.cjs', '.ts']);
const ignoredDirectories = new Set(['.git', '.cache', '.next', '.tmp', '.turbo', '.vite', '.wrangler', 'build', 'coverage', 'dist', 'node_modules', 'out', 'tmp']);

function fail(message) {
  failures.push(message);
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  const entries = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) entries.push(...walk(path));
    else if (entry.isFile()) entries.push(path);
  }
  return entries;
}

function isWithin(candidate, container) {
  const path = relative(container, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !path.includes(`${sep}..${sep}`));
}

function parseFrontmatter(source, file) {
  if (!source.startsWith('---\n')) {
    fail(`${relative(root, file)}: SKILL.md must start with YAML frontmatter`);
    return null;
  }
  const close = source.indexOf('\n---\n', 4);
  if (close < 0) {
    fail(`${relative(root, file)}: frontmatter must close with ---`);
    return null;
  }
  const frontmatter = source.slice(4, close);
  const result = Object.create(null);
  // The catalog deliberately accepts YAML maps, lists, and folded scalars.
  // The two required scalar keys are extracted without introducing a YAML dependency.
  for (const key of ['name', 'description']) {
    const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'));
    if (match) result[key] = match[1].replace(/^(['"])(.*)\1$/, '$2');
  }
  return result;
}

function validateLinks(source, file, skillDirectory) {
  const markdownLink = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+['"][^)]*['"])?\)/g;
  for (const match of source.matchAll(markdownLink)) {
    const target = match[1].replace(/^<|>$/g, '');
    if (!target || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    const pathname = target.split('#', 1)[0].split('?', 1)[0];
    if (!pathname) continue;
    const resolved = resolve(dirname(file), pathname);
    if (!isWithin(resolved, skillDirectory)) {
      fail(`${relative(root, file)}: local link escapes its skill directory: ${target}`);
    } else if (!existsSync(resolved)) {
      fail(`${relative(root, file)}: local link does not resolve: ${target}`);
    }
  }
}

const rootSkill = resolve(root, 'SKILL.md');
if (existsSync(rootSkill)) fail('SKILL.md at repository root is forbidden; use skills/<name>/SKILL.md');

const skillFiles = walk(skillsRoot).filter((file) => file.endsWith(`${sep}SKILL.md`));
const readmePath = resolve(root, 'README.md');
const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : null;
for (const file of skillFiles) {
  const skillDirectory = dirname(file);
  const expectedDirectory = resolve(skillsRoot, relative(skillsRoot, skillDirectory).split(sep)[0]);
  if (skillDirectory !== expectedDirectory) {
    fail(`${relative(root, file)}: skill must be exactly skills/<name>/SKILL.md`);
    continue;
  }
  const name = relative(skillsRoot, skillDirectory);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    fail(`${relative(root, file)}: skill directory name must use lowercase letters, digits, and single hyphens`);
  }
  const source = readFileSync(file, 'utf8');
  const frontmatter = parseFrontmatter(source, file);
  if (frontmatter) {
    if (!frontmatter.name) fail(`${relative(root, file)}: missing frontmatter name`);
    else if (frontmatter.name !== name) fail(`${relative(root, file)}: frontmatter name must match directory (${name})`);
    if (!frontmatter.description) fail(`${relative(root, file)}: missing frontmatter description`);
    else if (readme !== null && !readme.includes(frontmatter.description)) fail(`${relative(root, file)}: README must list the exact frontmatter description`);
  }
  validateLinks(source, file, skillDirectory);
}

for (const file of walk(root)) {
  const relativeFile = relative(root, file);
  if (relativeFile.split(sep).includes('.git') || relativeFile.startsWith('node_modules')) continue;
  if (isWithin(file, runtimeRoot)) continue;
  const extension = relativeFile.slice(relativeFile.lastIndexOf('.')).toLowerCase();
  if (!textExtensions.has(extension) && !['README', 'LICENSE', 'CONTRIBUTING', 'SECURITY'].includes(relativeFile)) continue;
  const source = readFileSync(file, 'utf8');
  const secret = /(?:-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----|(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"](?!(?:not-a-real-secret|example(?:[-_](?:token|secret|key))?|test(?:[-_](?:token|secret|key))?|your[-_](?:token|secret|key)[-_]here|changeme)['"])[^'"\s]{8,}['"]|gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,})/i;
  if (secret.test(source)) fail(`${relativeFile}: contains a likely secret`);
  const absolutePath = /(?:^|[\s'"`(])(?:\/Users\/|\/home\/|C:\\Users\\)[^\s'"`)]+/m;
  if (absolutePath.test(source)) fail(`${relativeFile}: contains a machine-specific absolute path`);
}

if (failures.length) {
  console.error(`Skill verification failed (${failures.length} issue${failures.length === 1 ? '' : 's'}):`);
  for (const message of failures) console.error(`- ${message}`);
  process.exitCode = 1;
} else {
  console.log(`Skill verification passed: ${skillFiles.length} skill${skillFiles.length === 1 ? '' : 's'} discovered.`);
}
