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
// A skill a project may adapt (docs/project-adaptation.md) declares its binding slots in a
// `## Bindings` table, and names its hard lines and steps with ids that a project's overlay cites.
// Any file of a skill may declare the section — a reference a project adapts as much as SKILL.md —
// so every such file is read, and its ids are held unique across all of them, because "S4" has to
// mean one step wherever the skill or an overlay cites it. Fenced code is not read, at any
// indentation, so a fence nested in a list item counts: an example of a table is not a declaration.
const BINDINGS_COLUMNS = ['id', 'slot', 'kind', 'default'];
const WELL_FORMED_ID = /^[A-Z][1-9][0-9]*$/;
const SLOT_KIND = /^(?:value|skill)(?:, required)?$/;
const NO_DEFAULT = /^(?:|[-–—]+|tbd|todo|n\/a|\?)$/i;
// A default is held to NO_DEFAULT as the reader is left with it: a backslash escape undone, and
// code, emphasis or strikethrough marks around it taken off, so `TBD` in backticks is still TBD.
const DEFAULT_MARKS = /^[\s`*_~]+|[\s`*_~]+$/g;
// A hard line (H) or a step (S) is declared by a list item that opens with its id in bold, or by a
// heading of any level that opens with it: `- **H1. Contacts nobody.**`, `1. **S2. Hash it.**`,
// `### S3 — Keep it`. The candidate is read wider than the form, so a malformed id fails rather
// than passing unread: H or S in either case, then a digit, straight after the letter or after up
// to three characters that are neither a letter nor a digit (`S04`, `H2a`, `S-1`, `H_1`, `S 6`,
// `s4`). A letter after the H or S makes it a word (`## Hard lines`, `- **Sweep the day.**`), which
// stays ordinary text. A citation written as a bold lead-in (`- **S2 skipped:**`), which the page
// tells authors not to write, is read too: it fails as a second declaration.
const LINE_ID = /^\s*(?:(?:[-*+]|\d+[.)])\s+\*\*|#{1,6}\s+)([HhSs][^\p{L}\p{N}*`]{0,3}[0-9][0-9A-Za-z]*)/u;
const LINE_ID_KIND = { H: 'hard-line', S: 'step' };
const LINE_ID_NAMES = { H: 'hard lines', S: 'steps' };
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

/** The column a run of leading whitespace reaches, a tab moving to the next multiple of four. */
function indentColumns(whitespace) {
  let column = 0;
  for (const character of whitespace) column = character === '\t' ? column + 4 - (column % 4) : column + 1;
  return column;
}

/**
 * The file's lines with every fenced code block blanked, so line numbers still match. A fence is
 * read at any indentation, because one nested in a list item sits past the three spaces a fence at
 * the top level may have, and is code all the same. Without reading the lists around it, a fence is
 * taken the strictest way it could be meant, so that it never hides a line Markdown would show: it
 * closes at a bare run of at least as many of its character, indented at most three columns more
 * than it, and only if that comes before any line that is not blank and is indented less than it. A
 * fence that does not close so opens nothing: its line is read as text, and so are the lines after
 * it. That is an indented code line that merely shows a fence, or a fence left open, which would
 * otherwise hide every declaration after it. A less indented line that would have closed it is the
 * closing line its writer meant, so it does not open a fence of its own. A backtick fence whose info
 * string holds a backtick is not a fence.
 */
function unfencedLines(source) {
  const lines = source.split('\n');
  const result = [...lines];
  const meantToClose = new Set();
  for (let at = 0; at < lines.length; at += 1) {
    const open = lines[at].match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    if (!open || meantToClose.has(at) || (open[2][0] === '`' && open[3].includes('`'))) continue;
    const [, lead, fence] = open;
    const indent = indentColumns(lead);
    let end = -1;
    for (let next = at + 1; next < lines.length; next += 1) {
      if (lines[next].trim() === '') continue;
      const close = lines[next].match(/^(\s*)(`{3,}|~{3,})\s*$/);
      const closes = close !== null && close[2][0] === fence[0] && close[2].length >= fence.length;
      const depth = indentColumns(lines[next].match(/^\s*/)[0]);
      if (depth < indent) {
        if (closes) meantToClose.add(next);
        break;
      }
      if (closes && depth <= indent + 3) {
        end = next;
        break;
      }
    }
    if (end < 0) continue;
    result.fill('', at, end + 1);
    at = end;
  }
  return result;
}

/** A table row's cells, split on every pipe that is not escaped, as GitHub's tables split them. */
function tableCells(line) {
  const inner = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return inner.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

/** The `## Bindings` table: the four columns, and per slot a well-formed id, a kind and a default. */
function validateBindingsTable(lines, heading, where, declare, slotLetters, shipped) {
  let end = heading + 1;
  while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end += 1;
  let index = heading + 1;
  while (index < end && !lines[index].trim().startsWith('|')) index += 1;
  const columns = `| ${BINDINGS_COLUMNS.join(' | ')} |`;
  if (index >= end) {
    fail(`${where(heading)}: ## Bindings has no table — declare each slot as a row of ${columns}`);
    return;
  }
  if (tableCells(lines[index]).map((cell) => cell.toLowerCase()).join('|') !== BINDINGS_COLUMNS.join('|')) {
    fail(`${where(index)}: the ## Bindings table has the columns ${columns}, in that order`);
    return;
  }
  const delimiter = lines[index + 1] ?? '';
  if (!delimiter.trim().startsWith('|') || !tableCells(delimiter).every((cell) => /^:?-+:?$/.test(cell))) {
    fail(`${where(index + 1)}: the ## Bindings table needs a delimiter row under its header`);
    return;
  }
  // A renderer takes the lines as a table only when the delimiter row has as many cells as the
  // header, so a table a composer or a reader would not see is not accepted here either.
  const delimiterCells = tableCells(delimiter).length;
  if (delimiterCells !== BINDINGS_COLUMNS.length) {
    fail(`${where(index + 1)}: the ## Bindings delimiter row has ${delimiterCells} cell${delimiterCells === 1 ? '' : 's'}; the table has ${BINDINGS_COLUMNS.length}`);
    return;
  }
  let rows = 0;
  for (index += 2; index < end && lines[index].trim().startsWith('|'); index += 1) {
    rows += 1;
    const row = tableCells(lines[index]);
    if (row.length !== BINDINGS_COLUMNS.length) {
      fail(`${where(index)}: a ## Bindings row has ${row.length} cells; the table has ${BINDINGS_COLUMNS.length}`);
      continue;
    }
    const [id, slot, kind, fallback] = row;
    if (!WELL_FORMED_ID.test(id)) {
      fail(`${where(index)}: slot id ${id || '(empty)'} is not well formed — one capital letter and a number from 1, no leading zero (B1, B12)`);
      continue;
    }
    if (LINE_ID_NAMES[id[0]]) {
      fail(`${where(index)}: slot id ${id} uses ${id[0]}, which names ${LINE_ID_NAMES[id[0]]}; slots take another letter, B unless the skill has a reason`);
      continue;
    }
    declare(id, index);
    if (!slotLetters.has(id[0])) slotLetters.set(id[0], where(index));
    if (slot === '') fail(`${where(index)}: slot ${id} does not say what it holds`);
    if (!SLOT_KIND.test(kind)) {
      fail(`${where(index)}: slot ${id} has kind "${kind}" — use value or skill, optionally followed by ", required"`);
    }
    if (NO_DEFAULT.test(fallback.replace(/\\(\p{P}|\p{S})/gu, '$1').replace(DEFAULT_MARKS, ''))) {
      fail(`${where(index)}: slot ${id} has no default — every slot needs one, and "ask once" is one`);
      continue;
    }
    if (kind.startsWith('skill')) {
      const named = fallback.match(/^`([a-z0-9]+(?:-[a-z0-9]+)*)`$/);
      if (!named) fail(`${where(index)}: slot ${id} is of kind skill, so its default names one skill in backticks, such as \`request-answers\``);
      else if (!shipped.has(named[1])) fail(`${where(index)}: slot ${id} defaults to \`${named[1]}\`, which this catalogue does not ship`);
    }
  }
  if (rows === 0) fail(`${where(heading)}: ## Bindings declares no slot — a file with nothing to bind does not declare the section`);
}

/** Every file of one skill that declares `## Bindings`: its slots, hard lines and steps. */
function validateAdaptation(skillDirectory, shipped) {
  // SKILL.md first, then the rest in path order, so "first at" names the same file on every run.
  const order = (file) => (relative(skillDirectory, file) === 'SKILL.md' ? '' : relative(skillDirectory, file));
  const files = walk(skillDirectory)
    .filter((file) => /\.mdx?$/i.test(file))
    .sort((a, b) => order(a).localeCompare(order(b)));
  const declared = new Map();
  const slotLetters = new Map();
  for (const file of files) {
    const lines = unfencedLines(readFileSync(file, 'utf8'));
    const headings = lines.flatMap((line, index) => (/^##\s+Bindings\s*$/.test(line) ? [index] : []));
    if (headings.length === 0) continue;
    const where = (index) => `${relative(root, file)}:${index + 1}`;
    const declare = (id, index) => {
      const first = declared.get(id);
      if (first) fail(`${where(index)}: id ${id} is declared twice in this skill (first at ${first})`);
      else declared.set(id, where(index));
    };
    if (headings.length > 1) fail(`${where(headings[1])}: ## Bindings is declared twice in this file`);
    validateBindingsTable(lines, headings[0], where, declare, slotLetters, shipped);
    lines.forEach((line, index) => {
      const match = line.match(LINE_ID);
      if (!match) return;
      const id = match[1];
      if (WELL_FORMED_ID.test(id)) declare(id, index);
      else {
        const letter = id[0].toUpperCase();
        fail(`${where(index)}: ${id} is not a well-formed ${LINE_ID_KIND[letter]} id — one capital letter and a number from 1, no leading zero (${letter}1, ${letter}12)`);
      }
    });
  }
  if (slotLetters.size > 1) {
    fail(`${relative(root, skillDirectory)}: slots in this skill use more than one letter (${[...slotLetters.keys()].sort().join(', ')}) — a skill's slots share one letter`);
  }
}

const rootSkill = resolve(root, 'SKILL.md');
if (existsSync(rootSkill)) fail('SKILL.md at repository root is forbidden; use skills/<name>/SKILL.md');

const skillFiles = walk(skillsRoot).filter((file) => file.endsWith(`${sep}SKILL.md`));
const readmePath = resolve(root, 'README.md');
const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : null;
const shipped = new Set(skillFiles.map((file) => relative(skillsRoot, file).split(sep)[0]));
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
  validateAdaptation(skillDirectory, shipped);
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
  return { from: 'the files git tracks or would add', files: [...new Set([...paths(tracked), ...added])] };
}

const scan = filesToScan();
const binaries = [];
let scanned = 0;
let exemptRead = false;
for (const relativeFile of scan.files) {
  if (relativeFile.split(sep).includes('.git') || relativeFile.startsWith('node_modules')) continue;
  const file = resolve(root, relativeFile);
  let stat;
  try {
    stat = lstatSync(file);
  } catch {
    continue; // tracked, but deleted from this working tree or outside a sparse checkout
  }
  let source;
  if (stat.isSymbolicLink()) {
    // Git stores a symbolic link as the path it points to, and publishes that path.
    source = readlinkSync(file);
    scanned += 1;
  } else if (stat.isFile()) {
    const bytes = readFileSync(file);
    const binary = bytes.includes(0);
    source = bytes.toString(binary ? 'latin1' : 'utf8');
    if (binary) binaries.push(relativeFile);
    else scanned += 1;
  } else {
    continue; // a submodule or a nested repository: its files are not this repository's to publish
  }
  const secret = /(?:-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----|(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"](?!(?:not-a-real-secret|example(?:[-_](?:token|secret|key))?|test(?:[-_](?:token|secret|key))?|your[-_](?:token|secret|key)[-_]here|changeme)['"])[^'"\s]{8,}['"]|gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,})/i;
  if (relativeFile === secretPatternExempt) exemptRead = true;
  else if (secret.test(source)) fail(`${relativeFile}: contains a likely secret`);
  // A path may follow a control character as well as a space or a quote: a binary format
  // separates its metadata fields with NUL bytes.
  const absolutePath = /(?:^|[\s'"`(\x00-\x1f])(?:\/Users\/|\/home\/|C:\\Users\\)[^\s'"`)\x00]+/m;
  if (absolutePath.test(source)) fail(`${relativeFile}: contains a machine-specific absolute path`);
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
