#!/usr/bin/env node
/**
 * Validate the public skill catalog without external dependencies.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { resolve, relative, dirname, sep } from 'node:path';

const root = process.cwd();
const skillsRoot = resolve(root, 'skills');
// The one file read for machine paths but not for likely secrets: the lifecycle package's tests
// write lock files with `token: '<owner>'` fields, which read as a likely secret and are none.
// The run names it whenever it reads it, so the exception is never silent.
const secretPatternExempt = ['packages', 'agent-lifecycle', 'test', 'lifecycle.test.ts'].join(sep);
const failures = [];
// Every file the repository would publish is scanned for secrets and machine paths, whatever its
// name. An extension list used to decide, and it missed what nobody listed: a .toml fixture, a
// .sh helper, a .jsonl capture, an extensionless config. Both patterns are ASCII, so the bytes are
// searched whatever their encoding: a text file (no NUL byte) is decoded as UTF-8 with
// replacement, so a Latin-1 file is read too, and a binary file (a NUL byte) one character per
// byte, which finds a path in an image's metadata. What an image shows is not read, so the run
// names every binary file for a person to look at.
// A SKILL.md body — everything after the frontmatter — is capped so that detail lives in
// carried reference files instead of the always-loaded instruction file.
const MAX_BODY_LINES = 484;
// The portable Agent Skills contract's own frontmatter limits, in characters. Other channels
// enforce them — the private catalogue's build refused a 523-character compatibility — so a
// skill that passes here has to pass there too.
const FIELD_LIMITS = { name: 64, description: 1024, compatibility: 500 };
// Any bare references/, scripts/, or assets/ token in a skill's prose is read as a promise
// that the skill carries that exact file. Prose that means "reference files, or scripts"
// must not be written as a path.
const CARRIED_FILE_PATTERN = /(?:^|[^A-Za-z0-9._/-])((?:references|scripts|assets)\/[A-Za-z0-9._/-]+)/g;
// Every skill declares WHERE IT FITS, in a form a script can evaluate, so that onboard-project
// can recommend it from evidence rather than from a description a matcher happened to like.
// `signals` is evaluated against a repository; `general` fits nearly any repository; `requestOnly`
// is never recommended by a scan. A skill with no fit.json is invisible to that scan, which is a
// silent failure — hence a loud one here.
const FIT_KINDS = new Set(['signals', 'general', 'requestOnly']);
const ignoredDirectories = new Set(['.git', '.cache', '.next', '.superpowers', '.tmp', '.turbo', '.vite', '.wrangler', 'build', 'coverage', 'dist', 'node_modules', 'out', 'tmp']);

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
  // The scalar keys checked here are extracted without introducing a YAML dependency.
  for (const key of Object.keys(FIELD_LIMITS)) {
    const value = scalar(frontmatter, key);
    if (value !== undefined) result[key] = value;
  }
  return result;
}

/** A top-level scalar: inline (quotes stripped), or a block scalar (`>`, `|`) read from its
 *  indented lines — folded with spaces, or kept with newlines — so its length is the length
 *  of the value a reader gets, not of the marker. */
function scalar(frontmatter, key) {
  const lines = frontmatter.split('\n');
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (index < 0) return undefined;
  const inline = lines[index].slice(key.length + 1).trim();
  if (!/^[>|][+-]?$/.test(inline)) return inline.replace(/^(['"])(.*)\1$/, '$2') || undefined;
  const block = [];
  for (const line of lines.slice(index + 1)) {
    if (line.trim() !== '' && !/^\s/.test(line)) break;
    block.push(line.trim());
  }
  return block.join(inline.startsWith('>') ? ' ' : '\n').trim();
}

function bodyLineCount(source) {
  if (!source.startsWith('---\n')) return source.split('\n').length;
  const close = source.indexOf('\n---\n', 4);
  if (close < 0) return source.split('\n').length;
  const body = source.slice(close + 5);
  if (body === '') return 0;
  return body.split('\n').length - (body.endsWith('\n') ? 1 : 0);
}

// Bare tokens are resolved against the skill directory, which is the form the authoring
// rule prescribes; markdown links are separately resolved against their containing file.
function validateCarriedFiles(source, file, skillDirectory) {
  for (const match of source.matchAll(CARRIED_FILE_PATTERN)) {
    const token = match[1].replace(/[.,;:)\]]+$/, '');
    if (!existsSync(resolve(skillDirectory, token))) {
      fail(`${relative(root, file)}: names a carried file the skill does not carry: ${token}`);
    }
  }
}

/** `references/fit.json`: present, parseable, and one of the three kinds. */
function validateFit(skillDirectory, file) {
  const fitPath = resolve(skillDirectory, 'references', 'fit.json');
  const where = relative(root, file);
  if (!existsSync(fitPath)) {
    fail(`${where}: no references/fit.json — declare where this skill fits (kinds: ${[...FIT_KINDS].join(', ')})`);
    return;
  }
  let fit;
  try {
    fit = JSON.parse(readFileSync(fitPath, 'utf8'));
  } catch (error) {
    fail(`${where}: references/fit.json does not parse: ${error.message}`);
    return;
  }
  if (!fit || typeof fit !== 'object' || Array.isArray(fit)) {
    fail(`${where}: references/fit.json must be a JSON object`);
    return;
  }
  if (!FIT_KINDS.has(fit.kind)) {
    fail(`${where}: references/fit.json kind must be one of ${[...FIT_KINDS].join(', ')}`);
    return;
  }
  if (typeof fit.useWhen !== 'string' || fit.useWhen.trim() === '') {
    fail(`${where}: references/fit.json needs a useWhen line — it is what the generated routing file says`);
  }
  if (fit.kind !== 'signals') return;
  const list = Array.isArray(fit.anyOf) ? fit.anyOf : Array.isArray(fit.allOf) ? fit.allOf : null;
  if (!list || list.length === 0) {
    fail(`${where}: references/fit.json kind "signals" needs a non-empty anyOf or allOf`);
    return;
  }
  for (const signal of list) {
    const repo = signal?.repo;
    const history = signal?.history;
    const readable = (repo && (repo.exists || repo.missing || repo.grep || repo.json || repo.toml || repo.yaml)) || (history && history.count);
    if (!readable) fail(`${where}: references/fit.json carries a signal this catalogue cannot read: ${JSON.stringify(signal)}`);
  }
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
    for (const [key, limit] of Object.entries(FIELD_LIMITS)) {
      const length = [...(frontmatter[key] ?? '')].length;
      if (length > limit) fail(`${relative(root, file)}: ${key} is ${length} characters; the portable spec allows ${limit}`);
    }
  }
  const bodyLines = bodyLineCount(source);
  if (bodyLines > MAX_BODY_LINES) {
    fail(`${relative(root, file)}: body is ${bodyLines} lines; the cap is ${MAX_BODY_LINES} — move detail into carried reference files`);
  }
  validateFit(skillDirectory, file);
  validateLinks(source, file, skillDirectory);
  for (const carried of walk(skillDirectory)) {
    const extension = carried.slice(carried.lastIndexOf('.')).toLowerCase();
    if (!['.md', '.mdx', '.txt'].includes(extension)) continue;
    validateCarriedFiles(readFileSync(carried, 'utf8'), carried, skillDirectory);
  }
}

// What the scan reads. In a git checkout, what the repository would publish: every file git
// tracks, wherever it sits, and every untracked file `git add -A` would take outside the
// generated and temporary directories above. A file git ignores is never published, so a local
// `.env` cannot fail the run. Outside a git checkout (an exported tree, a test fixture), every
// file outside those directories. Paths come back relative to the root.
function filesToScan() {
  const run = (args) => spawnSync('git', ['-c', 'core.quotepath=off', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const top = run(['rev-parse', '--show-toplevel']);
  let isTop = false;
  try {
    isTop = !top.error && top.status === 0 && realpathSync(top.stdout.trim()) === realpathSync(root);
  } catch {
    isTop = false;
  }
  const tracked = isTop ? run(['ls-files', '-z', '--cached']) : null;
  const untracked = isTop ? run(['ls-files', '-z', '--others', '--exclude-standard']) : null;
  if (!tracked || tracked.status !== 0 || untracked.status !== 0) {
    return { from: 'every file under this directory', files: walk(root).map((file) => relative(root, file)) };
  }
  const paths = (listing) => listing.stdout.split('\0').filter(Boolean).map((path) => path.split('/').join(sep));
  const added = paths(untracked).filter((path) => !path.split(sep).some((segment) => ignoredDirectories.has(segment)));
  // A commit publishes the index, and a push publishes HEAD, so where either holds another copy
  // of a tracked file than the working tree does, that copy is read as well: one deleted from the
  // working tree without the deletion being staged, or left out of a sparse checkout, one with a
  // clean edit not yet staged over it, and one whose deletion is staged but not committed.
  const unstaged = run(['diff', '-z', '--name-only', '--no-renames']);
  const staged = run(['diff', '-z', '--name-only', '--no-renames', '--cached']);
  const copies = new Map();
  const copy = (path, object) => copies.set(path, [...(copies.get(path) ?? []), object]);
  if (unstaged.status === 0) for (const path of paths(unstaged)) copy(path, `:${path.split(sep).join('/')}`);
  if (staged.status === 0) for (const path of paths(staged)) copy(path, `HEAD:${path.split(sep).join('/')}`);
  // A file left out of a sparse checkout is in the index but not in the working tree, and git diff
  // does not name it, so a tracked file the working tree lacks is read from the index whatever
  // git diff says.
  const indexed = new Set(paths(tracked));
  return { from: 'the files git tracks or would add', files: [...new Set([...indexed, ...added, ...copies.keys()])], copies, indexed };
}

// The bytes of one copy git holds (`:path` in the index, `HEAD:path` in the last commit), or null
// where it holds none: a deletion, or a submodule's entry, which has no blob. A symbolic link's
// copy is the path it stores, and is read as text like any other.
function gitCopy(object) {
  const read = spawnSync('git', ['cat-file', 'blob', object], { cwd: root, maxBuffer: 256 * 1024 * 1024 });
  return !read.error && read.status === 0 ? read.stdout : null;
}

const scan = filesToScan();
const binaries = [];
let scanned = 0;
let exemptRead = false;
const secret = /(?:-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----|(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"](?!(?:not-a-real-secret|example(?:[-_](?:token|secret|key))?|test(?:[-_](?:token|secret|key))?|your[-_](?:token|secret|key)[-_]here|changeme)['"])[^'"\s]{8,}['"]|gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,})/i;
// A path may follow a control character as well as a space or a quote: a binary format
// separates its metadata fields with NUL bytes.
const absolutePath = /(?:^|[\s'"`(\x00-\x1f])(?:\/Users\/|\/home\/|C:\\Users\\)[^\s'"`)\x00]+/m;
for (const relativeFile of scan.files) {
  if (relativeFile.split(sep).includes('.git')) continue;
  const file = resolve(root, relativeFile);
  const sources = [];
  let binary = false;
  let stat = null;
  try {
    stat = lstatSync(file);
  } catch {
    stat = null; // not in this working tree; a copy git holds may still be
  }
  if (stat?.isSymbolicLink()) {
    // Git stores a symbolic link as the path it points to, and publishes that path.
    sources.push(readlinkSync(file));
  } else if (stat?.isFile()) {
    const bytes = readFileSync(file);
    binary ||= bytes.includes(0);
    sources.push(bytes);
  } else if (stat !== null) {
    continue; // a submodule or a nested repository: its files are not this repository's to publish
  }
  const held = [...(scan.copies?.get(relativeFile) ?? [])];
  const indexCopy = `:${relativeFile.split(sep).join('/')}`;
  if (stat === null && scan.indexed?.has(relativeFile) && !held.includes(indexCopy)) held.push(indexCopy);
  for (const object of held) {
    const bytes = gitCopy(object);
    if (bytes === null) continue;
    binary ||= bytes.includes(0);
    sources.push(bytes);
  }
  if (sources.length === 0) continue; // in neither the working tree nor the index nor HEAD
  const texts = sources.map((source) => (typeof source === 'string' ? source : source.toString(binary ? 'latin1' : 'utf8')));
  if (binary) binaries.push(relativeFile);
  else scanned += 1;
  if (relativeFile === secretPatternExempt) exemptRead = true;
  else if (texts.some((text) => secret.test(text))) fail(`${relativeFile}: contains a likely secret`);
  if (texts.some((text) => absolutePath.test(text))) fail(`${relativeFile}: contains a machine-specific absolute path`);
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
let coverage = `${plural(scanned, 'text file')} scanned for secrets and machine paths (${scan.from})`;
if (exemptRead) coverage += `; ${secretPatternExempt} read for machine paths only, as its token fields are fixtures`;
if (binaries.length) {
  coverage += `; ${plural(binaries.length, 'binary file')} searched as bytes, which cannot see what an image shows, so look at each: ${binaries.sort().join(', ')}`;
}

if (failures.length) {
  console.error(`Skill verification failed (${failures.length} issue${failures.length === 1 ? '' : 's'}):`);
  for (const message of failures) console.error(`- ${message}`);
  console.log(`${coverage}.`);
  process.exitCode = 1;
} else {
  console.log(`Skill verification passed: ${plural(skillFiles.length, 'skill')} discovered; ${coverage}.`);
}
