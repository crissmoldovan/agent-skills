#!/usr/bin/env node
/**
 * Compose a project's adapted copy of a pack skill, check it offline, and report newer pins.
 *
 * A project that needs a pack skill to carry its own values, hand work to its own skills and add
 * the steps it has learned adapts the skill instead of forking it. The contract is the pack's
 * project-adaptation page: the skill declares binding slots, hard lines and steps under ids that
 * never move, and the project supplies an overlay keyed to those ids. The project writes one
 * adapter folder per adapted skill — `adapter.json`, the overlay, and any project files — and
 * this script generates the adapted skill from it and from the pack skill at a pinned ref:
 *
 *   compose   read the pack skill at its pin, hold the overlay to what the skill declares, and
 *             print what it would write. With --write it writes the generated folder and vendors
 *             this file beside the adapters, so the offline check needs no network and no install.
 *   check     offline and read-only: the generated folder is byte for byte what composing its
 *             recorded inputs gives, and every rule an overlay must keep still holds.
 *   outdated  online and read-only: newer tags, whether each one changes the pinned skill's tree,
 *             an alarm when a pinned tag no longer names the commit the copy was composed from,
 *             and whether the vendored composer is the one the pinned commit ships.
 *
 * The generated folder is committed and never edited by hand, the same discipline as any other
 * generated file a test byte-compares: a hand edit, or an overlay changed without composing
 * again, turns `check` red.
 *
 * Dependency-free Node plus git. It runs git plumbing only — ls-remote, a shallow fetch into a
 * throwaway bare repository, show-ref, for-each-ref, rev-parse, ls-tree, cat-file — and never
 * checks a tree out, so nothing in a fetched tree runs, its own release's composer included. It
 * writes nothing without --write, and with it only the generated folder, its own vendored copy,
 * and a temporary directory it removes.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const posix = path.posix;

/** Bumped when the composed bytes would change for the same inputs. The lock records it. */
export const COMPOSER_VERSION = 1;
export const ADAPTER_VERSION = 1;
export const LOCK_VERSION = 1;

export const ADAPTER_FILE = 'adapter.json';
export const LOCK_FILE = 'adapted.lock.json';
export const DEFAULT_ADAPTERS_DIR = '.claude/skill-adapters';
export const DEFAULT_SKILLS_DIR = '.claude/skills';
export const TOOL_DIR = '.tool';
export const TOOL_FILE = 'adapt.mjs';
/** Where the pack keeps this composer, so a pinned commit names the composer of its release. */
export const PACK_COMPOSER_PATH = 'skills/update-agent-skills/scripts/adapt.mjs';
/** Claude Code's documentation asks for a SKILL.md under 500 lines; past it, `check` warns. */
export const LONG_SKILL_LINES = 500;

export const EXIT_OK = 0;
/** A refusal, a failed check, or a usage error. */
export const EXIT_FAILED = 1;
/** `outdated` found something a person should read: a changed tree, a moved tag, or no answer. */
export const EXIT_ATTENTION = 2;

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID = /^[A-Z][1-9][0-9]*$/;
const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
// A ref is interpolated into git arguments, so only a plain tag-shaped name passes: no leading
// dash (an option), no `..`, no `//`, nothing git itself refuses in a ref name.
const REF_NAME = /^(?![-/.])(?!.*\.\.)(?!.*\/\/)(?!.*@\{)(?!.*\.lock$)(?!.*[/.]$)[A-Za-z0-9._/+-]+$/;
const GITHUB_SOURCE = /^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PROJECT_DIRS = ['references/project/', 'scripts/project/', 'assets/project/'];
const BASE_BEGIN = '<!-- base:begin';
const BASE_END = '<!-- base:end -->';
const ADAPTER_KEYS = new Set(['version', 'name', 'description', 'base', 'widenTools', 'overlay', 'projectFiles', 'names']);
const BASE_KEYS = new Set(['source', 'skill', 'entry', 'ref', 'commit', 'tree']);
const OVERLAY_SECTIONS = new Map([['bindings', 'Bindings'], ['additions', 'Additions'], ['project traps', 'Project traps']]);

// Read exactly as the pack's verifier reads a skill (scripts/verify-skills.mjs in the pack), so
// that what the pack holds declared and what an overlay may cite are the same set of ids.
const BINDINGS_COLUMNS = ['id', 'slot', 'kind', 'default'];
const SLOT_KIND = /^(?:value|skill)(?:, required)?$/;
const LINE_ID = /^\s*(?:(?:[-*+]|\d+[.)])\s+\*\*|#{1,6}\s+)([HS][0-9][0-9A-Za-z]*)/;

// A hard line is only ever made stricter (merge rule 4). No script can tell stricter from looser
// in prose, so this is a tripwire for the words an exception is written in, backed by review: it
// refuses an addition to a hard line, or any overlay line that names one, that carries them.
const RELAXING = /\b(?:unless|except(?:ion|ions)?|exempt(?:s|ed|ion)?|waive[sd]?|need not|needn't|do(?:es)? not apply|doesn't apply|don't apply|no longer|not required|may skip|can skip|(?:is|are) optional|overrid(?:e|es|den)|relax(?:es|ed)?|(?:is|are) lifted)\b/i;

/**
 * A refusal: the message is for the person. `check` is the number of the check it would break, which
 * a reader looks up in the guide's table; a refusal of the pin itself carries none and prints as
 * `[pin]`, and a refusal of the adapter folder's shape prints as `[adapter]`.
 */
export class AdaptError extends Error {
  constructor(message, check = 0) {
    super(message);
    this.check = check;
  }
}

const finding = (check, message) => ({ check, message });

/**
 * True when this file is the program being run, false when it was imported. Both sides are
 * resolved to real paths, because a skill installed through a symlink is run through a path that
 * is not the one Node resolved, and a guard that compared them as typed would never run main().
 */
export function isEntrypoint(moduleUrl) {
  const invoked = process.argv[1];
  if (!invoked) return false;
  const modulePath = fileURLToPath(moduleUrl);
  try {
    return realpathSync.native(invoked) === realpathSync.native(modulePath);
  } catch {
    return path.resolve(invoked) === modulePath;
  }
}

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const short = (hex) => (typeof hex === 'string' ? hex.slice(0, 12) : '?');
const toPosix = (value) => value.split(path.sep).join('/');
const utf8 = (bytes) => (Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes));
const lf = (text) => text.replace(/\r\n?/g, '\n');
const sortedEntries = (map) => [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

// ---------------------------------------------------------------------------------------------
// git

// Variables that point git at another repository. A composer run from inside a git hook inherits
// them, and they would win over `-C`, so they are dropped for every call.
const GIT_LOCATION_VARIABLES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE', 'GIT_PREFIX'];

function gitEnvironment() {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  for (const name of GIT_LOCATION_VARIABLES) delete env[name];
  return env;
}

/**
 * One git call. Hooks are pointed at nothing and only the https and file transports are allowed,
 * so a source can neither run code nor reach for another transport.
 */
function runGit(args, { timeout = 120_000 } = {}) {
  const config = ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.file.allow=always', '-c', 'core.quotepath=off'];
  const result = spawnSync('git', [...config, ...args], { env: gitEnvironment(), maxBuffer: 512 * 1024 * 1024, timeout });
  if (result.error) {
    if (result.error.code === 'ENOENT') throw new AdaptError('git is not installed or not on PATH; the composer reads the pack with git');
    throw new AdaptError(`git ${args[0] === '-C' ? args[2] : args[0]} failed: ${result.error.message}`);
  }
  return { status: result.status, stdout: result.stdout ?? Buffer.alloc(0), stderr: utf8(result.stderr ?? '').trim() };
}

/** Reads one repository through plumbing commands only. */
export class GitReader {
  constructor(directory) {
    this.directory = directory;
  }

  run(args, options) {
    return runGit(['-C', this.directory, ...args], options);
  }

  succeeds(args) {
    return this.run(args).status === 0;
  }

  isRepository() {
    return this.succeeds(['rev-parse', '--git-dir']);
  }

  hasTag(name) {
    return this.succeeds(['show-ref', '--verify', '--quiet', `refs/tags/${name}`]);
  }

  /** A local branch, or a remote-tracking one such as `refs/remotes/origin/<name>` in a clone. */
  hasBranch(name) {
    const result = this.run(['for-each-ref', '--format=%(refname)', `refs/heads/${name}`, `refs/remotes/*/${name}`]);
    if (result.status !== 0) return false;
    // A pattern also matches a ref that continues past it, so only the exact names count.
    return utf8(result.stdout).split('\n').some((ref) => ref === `refs/heads/${name}` || (/^refs\/remotes\/[^/]+\//.test(ref) && ref.endsWith(`/${name}`) && ref.split('/').length === 3 + name.split('/').length));
  }

  commitOf(revision) {
    const result = this.run(['rev-parse', '--verify', '--quiet', `${revision}^{commit}`]);
    return result.status === 0 ? utf8(result.stdout).trim() : null;
  }

  /** The tree a path names at a commit, or null when the path is absent or is not a folder. */
  treeAt(commit, folder) {
    const result = this.run(['rev-parse', '--verify', '--quiet', `${commit}:${folder}`]);
    if (result.status !== 0) return null;
    const sha = utf8(result.stdout).trim();
    const type = this.run(['cat-file', '-t', sha]);
    return type.status === 0 && utf8(type.stdout).trim() === 'tree' ? sha : null;
  }

  /** Every entry under a folder at a commit: mode, object and path relative to the folder. */
  listFolder(commit, folder) {
    const result = this.run(['ls-tree', '-r', '-z', '--full-tree', commit, '--', `${folder}/`]);
    if (result.status !== 0) throw new AdaptError(`cannot list ${folder} at ${short(commit)}: ${result.stderr || 'git ls-tree failed'}`);
    const entries = [];
    for (const record of utf8(result.stdout).split('\0')) {
      if (!record) continue;
      const tab = record.indexOf('\t');
      const [mode, type, object] = record.slice(0, tab).split(' ');
      entries.push({ mode, type, object, path: record.slice(tab + 1).slice(folder.length + 1) });
    }
    return entries;
  }

  blob(object) {
    const result = this.run(['cat-file', 'blob', object]);
    if (result.status !== 0) throw new AdaptError(`cannot read object ${short(object)}: ${result.stderr || 'git cat-file failed'}`);
    return result.stdout;
  }

  /** A file at a commit, or null when it is not there. */
  fileAt(commit, file) {
    const result = this.run(['cat-file', 'blob', `${commit}:${file}`]);
    return result.status === 0 ? result.stdout : null;
  }
}

/** `<tag> -> <commit>` for every tag the source has, peeled to the commit an annotated tag names. */
export function listRemoteTags(source) {
  const result = runGit(['ls-remote', '--tags', source], { timeout: 60_000 });
  if (result.status !== 0) throw new AdaptError(`cannot list the tags of ${source}: ${result.stderr || 'git ls-remote failed'}`);
  const tags = new Map();
  const peeled = new Map();
  for (const line of utf8(result.stdout).split('\n')) {
    const match = line.match(/^([0-9a-f]+)\trefs\/tags\/(.+)$/);
    if (!match) continue;
    if (match[2].endsWith('^{}')) peeled.set(match[2].slice(0, -3), match[1]);
    else tags.set(match[2], match[1]);
  }
  for (const [name, commit] of peeled) tags.set(name, commit);
  return tags;
}

function remoteHeads(source, ref) {
  const result = runGit(['ls-remote', source, `refs/tags/${ref}`, `refs/heads/${ref}`], { timeout: 60_000 });
  if (result.status !== 0) throw new AdaptError(`cannot read ${source}: ${result.stderr || 'git ls-remote failed'}`);
  const names = new Set(utf8(result.stdout).split('\n').map((line) => line.split('\t')[1]).filter(Boolean));
  return { tag: names.has(`refs/tags/${ref}`), branch: names.has(`refs/heads/${ref}`) };
}

// ---------------------------------------------------------------------------------------------
// sources and pins

export function isGithubSource(source) {
  return GITHUB_SOURCE.test(source);
}

/**
 * A source is `https://github.com/<owner>/<repo>` or a local path to a clone of the pack. Every
 * other form is refused: another transport could run code or reach a host nobody reviewed.
 */
export function sourceProblem(source) {
  if (typeof source !== 'string' || source.trim() === '') return 'base.source is required';
  if (isGithubSource(source)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(source) || source.includes(':') || source.startsWith('-') || /[\0\n\r]/.test(source)) {
    return `base.source must be https://github.com/<owner>/<repo> or a local path to a clone of the pack, not ${JSON.stringify(source)}`;
  }
  return null;
}

/** The label a reader recognises: `owner/repo` for GitHub, the path as written otherwise. */
export function sourceLabel(source) {
  return isGithubSource(source) ? source.slice('https://github.com/'.length).replace(/\.git$/, '') : source;
}

/**
 * Open the repository a pin is read from: a local clone named by `--pack`, a local source, or a
 * shallow fetch of exactly one ref from GitHub into a throwaway bare repository.
 */
export function openSource(base, { repo, pack } = {}) {
  if (pack) {
    const reader = new GitReader(path.resolve(pack));
    if (!reader.isRepository()) throw new AdaptError(`--pack ${pack} is not a git repository`);
    return { reader, cleanup() {}, origin: `the local pack at ${pack}` };
  }
  if (!isGithubSource(base.source)) {
    const reader = new GitReader(path.resolve(repo ?? '.', base.source));
    if (!reader.isRepository()) throw new AdaptError(`base.source ${base.source} is not a git repository`);
    return { reader, cleanup() {}, origin: base.source };
  }
  if (!FULL_SHA.test(base.ref)) {
    const found = remoteHeads(base.source, base.ref);
    if (!found.tag && found.branch) throw new AdaptError(`ref ${base.ref} is a branch of ${sourceLabel(base.source)}; a branch is refused, because it moves. Pin a tag or a full commit sha`);
    if (!found.tag) throw new AdaptError(`${sourceLabel(base.source)} has no tag ${base.ref}`);
  }
  const scratch = mkdtempSync(path.join(tmpdir(), 'adapt-skill-'));
  const cleanup = () => rmSync(scratch, { recursive: true, force: true });
  try {
    const init = runGit(['-c', 'init.templateDir=', 'init', '--quiet', '--bare', scratch]);
    if (init.status !== 0) throw new AdaptError(`cannot create a scratch repository: ${init.stderr}`);
    const reader = new GitReader(scratch);
    const refspec = FULL_SHA.test(base.ref) ? base.ref : `+refs/tags/${base.ref}:refs/tags/${base.ref}`;
    const fetch = reader.run(['fetch', '--quiet', '--depth', '1', '--no-tags', base.source, refspec], { timeout: 300_000 });
    if (fetch.status !== 0) throw new AdaptError(`cannot fetch ${base.ref} from ${sourceLabel(base.source)}: ${fetch.stderr || 'git fetch failed'}`);
    return { reader, cleanup, origin: sourceLabel(base.source) };
  } catch (error) {
    cleanup();
    throw error;
  }
}

/**
 * Resolve a pin to its commit and the skill folder's tree. A full sha pins exactly; a tag is a
 * release a reader can read about; a branch is refused, because it moves. When adapter.json
 * records the commit or tree it was reviewed at, a ref that now resolves elsewhere is refused.
 */
export function resolvePin(reader, base) {
  let commit;
  if (FULL_SHA.test(base.ref)) {
    commit = reader.commitOf(base.ref);
    if (commit !== base.ref) throw new AdaptError(`the pack has no commit ${base.ref}`);
  } else if (reader.hasTag(base.ref)) {
    commit = reader.commitOf(`refs/tags/${base.ref}`);
  } else if (reader.hasBranch(base.ref)) {
    throw new AdaptError(`ref ${base.ref} is a branch; a branch is refused, because it moves. Pin a tag or a full commit sha`);
  } else {
    throw new AdaptError(`the pack has no tag ${base.ref}${/^[0-9a-f]{7,39}$/.test(base.ref) ? '; an abbreviated sha is refused, give all of it' : ''}`);
  }
  if (!commit) throw new AdaptError(`cannot resolve ${base.ref} to a commit`);
  const folder = `skills/${base.skill}`;
  const tree = reader.treeAt(commit, folder);
  if (!tree) throw new AdaptError(`the pack has no ${folder} at ${base.ref}`);
  if (base.commit && base.commit !== commit) {
    throw new AdaptError(`adapter.json records commit ${short(base.commit)} for ${base.ref}, which now names ${short(commit)}${base.tree === tree ? ' (the skill tree is unchanged)' : ''}. A published tag should never move: read why, then set base.commit and base.tree to the new values, or remove them to take what the ref names now`);
  }
  if (base.tree && base.tree !== tree) {
    throw new AdaptError(`adapter.json records tree ${short(base.tree)} for ${folder}, but ${base.ref} has ${short(tree)}. Read the change, then set base.tree to the new value, or remove it`);
  }
  return { source: base.source, skill: base.skill, entry: base.entry, ref: base.ref, commit, tree };
}

// ---------------------------------------------------------------------------------------------
// frontmatter

/** The frontmatter block and the body after it, as the pack's verifier splits them. */
export function splitFrontmatter(text) {
  if (!text.startsWith('---\n')) return null;
  const close = text.indexOf('\n---\n', 3);
  if (close >= 0) return { frontmatter: text.slice(4, close), body: text.slice(close + 5) };
  if (text.endsWith('\n---')) return { frontmatter: text.slice(4, -4), body: '' };
  return null;
}

/** One top-level frontmatter value as a string: plain, quoted, folded, literal or a list. */
export function frontmatterValue(frontmatter, key) {
  const lines = frontmatter.split('\n');
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (index < 0) return null;
  const inline = lines[index].slice(key.length + 1).trim();
  const following = [];
  for (const line of lines.slice(index + 1)) {
    if (line.trim() !== '' && !/^\s/.test(line)) break;
    following.push(line);
  }
  if (/^[>|][+-]?$/.test(inline)) {
    const kept = following.map((line) => line.trim());
    while (kept.length && kept[kept.length - 1] === '') kept.pop();
    return kept.join(inline.startsWith('>') ? ' ' : '\n').trim();
  }
  if (inline === '' && following.some((line) => /^\s*-\s/.test(line))) {
    return following.filter((line) => /^\s*-\s/.test(line)).map((line) => line.replace(/^\s*-\s+/, '').trim()).join(' ');
  }
  const raw = [inline, ...following.map((line) => line.trim()).filter(Boolean)].join(' ');
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.replace(/^"|"$/g, '').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
  }
  if (raw.startsWith("'")) return raw.replace(/^'|'$/g, '').replace(/''/g, "'");
  return raw.replace(/\s+#.*$/, '').trim();
}

const YAML_RESERVED = /^(?:true|false|yes|no|on|off|null|y|n|~)$/i;

/** A value YAML reads back as the same string: plain when that is safe, double-quoted otherwise. */
export function yamlString(value) {
  const text = String(value);
  if (/^[A-Za-z][A-Za-z0-9 ._()/-]*$/.test(text) && !/ $/.test(text) && !YAML_RESERVED.test(text)) return text;
  return JSON.stringify(text);
}

function widenTools(baseTools, widen) {
  const tools = baseTools ? baseTools.split(/\s+/).filter(Boolean) : [];
  for (const tool of widen) if (!tools.includes(tool)) tools.push(tool);
  return tools.join(' ');
}

// ---------------------------------------------------------------------------------------------
// what a skill declares

/** Lines with every fenced block blanked, so line numbers still match; a fence at any indent. */
function unfencedLines(text) {
  let fence = null;
  return text.split('\n').map((line) => {
    if (fence === null) {
      const open = line.match(/^\s*(`{3,}|~{3,})/);
      if (!open) return line;
      fence = open[1];
      return '';
    }
    const close = line.match(/^\s*(`{3,}|~{3,})\s*$/);
    if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
    return '';
  });
}

function tableCells(line) {
  const inner = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return inner.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

/**
 * The slots, hard lines and steps a set of files declares. A file declares ids only when it
 * declares `## Bindings`, exactly as the pack's verifier reads them, so an id the verifier never
 * saw is never one an overlay can cite.
 */
export function parseDeclarations(files) {
  const slots = new Map();
  const lines = new Map();
  const problems = [];
  const declare = (map, id, record) => {
    if (slots.has(id) || lines.has(id)) problems.push(`${record.file} declares ${id} a second time`);
    else map.set(id, record);
  };
  for (const { path: file, text } of files) {
    const rows = unfencedLines(text);
    const heading = rows.findIndex((line) => /^##\s+Bindings\s*$/.test(line));
    if (heading < 0) continue;
    let end = heading + 1;
    while (end < rows.length && !/^#{1,2}\s/.test(rows[end])) end += 1;
    let index = heading + 1;
    while (index < end && !rows[index].trim().startsWith('|')) index += 1;
    if (index < end && tableCells(rows[index]).map((cell) => cell.toLowerCase()).join('|') === BINDINGS_COLUMNS.join('|')) {
      for (index += 2; index < end && rows[index].trim().startsWith('|'); index += 1) {
        const [id, slot, kind, fallback] = tableCells(rows[index]);
        if (!ID.test(id ?? '') || !SLOT_KIND.test(kind ?? '')) continue;
        const defaultSkill = (fallback ?? '').match(/^`([a-z0-9]+(?:-[a-z0-9]+)*)`$/)?.[1] ?? null;
        declare(slots, id, { id, file, slot, kind, default: fallback, required: kind.endsWith(', required'), skill: kind.startsWith('skill'), defaultSkill });
      }
    }
    rows.forEach((line) => {
      const match = line.match(LINE_ID);
      if (match && ID.test(match[1])) declare(lines, match[1], { id: match[1], file, kind: match[1][0], text: line.trim() });
    });
  }
  return { slots, lines, problems };
}

// ---------------------------------------------------------------------------------------------
// the overlay

/**
 * The overlay in its three parts: `## Bindings` (a two-column `| id | value |` table), `## Additions`
 * (one `### <id>` heading per step or hard line it adds to), and `## Project traps`. Anything
 * else would be dropped from the copy without a word, so it is refused instead.
 */
export function parseOverlay(source) {
  const text = lf(source);
  const problems = [];
  const rows = text.split('\n');
  const plain = unfencedLines(text);
  const sections = new Map();
  let current = null;
  plain.forEach((line, index) => {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading && !line.startsWith('###')) {
      const key = heading[1].toLowerCase();
      if (!OVERLAY_SECTIONS.has(key)) {
        problems.push(`overlay line ${index + 1}: unknown section "## ${heading[1]}" — an overlay has ## Bindings, ## Additions and ## Project traps, and nothing else reaches the copy`);
        // Its body is already refused with the heading, so it is not reported line by line.
        current = { key: null, start: index + 1, lines: [] };
        return;
      }
      if (sections.has(key)) problems.push(`overlay line ${index + 1}: ## ${OVERLAY_SECTIONS.get(key)} appears twice`);
      current = { key, start: index + 1, lines: [] };
      sections.set(key, current);
      return;
    }
    if (current) current.lines.push(index);
    else if (rows[index].trim() !== '' && !/^#\s/.test(rows[index]) && !/^\s*<!--.*-->\s*$/.test(rows[index])) {
      problems.push(`overlay line ${index + 1}: text before the first section would not reach the copy; put it under ## Additions or ## Project traps`);
    }
  });
  const body = (key) => {
    const section = sections.get(key);
    if (!section) return '';
    return trimBlank(section.lines.map((index) => rows[index]).join('\n'));
  };

  const bindings = [];
  const bindingSection = sections.get('bindings');
  if (bindingSection) {
    const table = bindingSection.lines.filter((index) => plain[index].trim().startsWith('|'));
    if (table.length > 0) {
      const header = tableCells(rows[table[0]]).map((cell) => cell.toLowerCase());
      const delimiter = table[1] === undefined ? [] : tableCells(rows[table[1]]);
      if (header.join('|') !== 'id|value') problems.push(`overlay line ${table[0] + 1}: the ## Bindings table has the columns | id | value |`);
      else if (table[1] !== table[0] + 1 || delimiter.length !== 2 || !delimiter.every((cell) => /^:?-+:?$/.test(cell))) {
        problems.push(`overlay line ${table[0] + 2}: the ## Bindings table needs a delimiter row under its header`);
      } else {
        for (const index of table.slice(2)) {
          const cells = tableCells(rows[index]);
          const id = cells[0]?.match(/^([A-Z][0-9][0-9A-Za-z]*)(?:\s|$)/)?.[1];
          if (cells.length !== 2 || !id || !ID.test(id)) {
            problems.push(`overlay line ${index + 1}: a ## Bindings row is | <slot id> [label] | <value> |, and this one is not`);
            continue;
          }
          bindings.push({ id, label: cells[0].slice(id.length).trim(), value: cells[1], line: index + 1 });
        }
      }
    }
  }

  const additions = [];
  const additionSection = sections.get('additions');
  if (additionSection) {
    let open = null;
    for (const index of additionSection.lines) {
      const heading = plain[index].match(/^###\s+(\S+)(.*)$/);
      if (heading && !plain[index].startsWith('####')) {
        const id = heading[1].replace(/[.:,;]$/, '');
        if (!ID.test(id)) {
          problems.push(`overlay line ${index + 1}: an addition's heading opens with the id it adds to (### S3), not "${heading[1]}"`);
          open = null;
          continue;
        }
        open = { id, heading: rows[index], line: index + 1, lines: [] };
        additions.push(open);
        continue;
      }
      if (open) open.lines.push(rows[index]);
      else if (rows[index].trim() !== '') problems.push(`overlay line ${index + 1}: text under ## Additions sits under a ### <id> heading`);
    }
    for (const addition of additions) {
      addition.text = trimBlank(addition.lines.join('\n'));
      delete addition.lines;
      const first = addition.text.split('\n').find((line) => line.trim() !== '') ?? '';
      addition.replaces = null;
      if (/^replaces:/i.test(first.trim())) {
        const match = first.trim().match(/^replaces:\s*([A-Z][1-9][0-9]*)\b[.:,;]?\s*(.*)$/);
        addition.replaces = match ? { id: match[1], reason: match[2].trim() } : { id: null, reason: '' };
      }
    }
  }

  return {
    text,
    problems,
    bindings,
    additions,
    bindingsText: body('bindings'),
    additionsText: body('additions'),
    trapsText: body('project traps'),
  };
}

function trimBlank(text) {
  const lines = text.split('\n');
  while (lines.length && lines[0].trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// links

const INLINE_LINK = /(!?\[[^\]]*\]\()([^)\s]+)((?:\s+['"][^)]*['"])?\))/g;
const LINK_DEFINITION = /^( {0,3}\[[^\]]+\]:[ \t]*)(\S+)/gm;

function splitTarget(target) {
  const wrapped = target.startsWith('<') && target.endsWith('>');
  const inner = wrapped ? target.slice(1, -1) : target;
  if (!inner || inner.startsWith('#') || inner.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(inner)) return null;
  const cut = inner.search(/[#?]/);
  const pathname = cut === -1 ? inner : inner.slice(0, cut);
  if (!pathname) return null;
  return { wrapped, pathname, suffix: cut === -1 ? '' : inner.slice(cut) };
}

/** Every relative link target in a Markdown text: inline links, images and link definitions. */
export function relativeLinks(text) {
  const found = [];
  for (const match of text.matchAll(INLINE_LINK)) {
    const target = splitTarget(match[2]);
    if (target) found.push(target);
  }
  for (const match of text.matchAll(LINK_DEFINITION)) {
    const target = splitTarget(match[2]);
    if (target) found.push(target);
  }
  return found;
}

/**
 * A reference file becomes the body of SKILL.md at the folder root, so every relative link it
 * holds is rewritten for its new place. A link to its own skill's SKILL.md is refused: that file
 * is not carried, and the adapted SKILL.md that takes its place is not what the link meant.
 */
export function rewriteEntryLinks(text, entry) {
  const from = posix.dirname(entry);
  const problems = [];
  const move = (target) => {
    const parts = splitTarget(target);
    if (!parts) return target;
    const resolved = posix.normalize(posix.join(from, parts.pathname));
    if (resolved === '..' || resolved.startsWith('../')) {
      problems.push(`${entry} links to ${target}, outside its skill`);
      return target;
    }
    if (resolved.replace(/\/$/, '') === 'SKILL.md') {
      problems.push(`${entry} links to its skill's SKILL.md (${target}), which an adapted copy does not carry; name the skill in backticks instead, so the names map can route it`);
      return target;
    }
    const moved = `${resolved}${parts.suffix}`;
    return parts.wrapped ? `<${moved}>` : moved;
  };
  const rewritten = text
    .replace(INLINE_LINK, (whole, open, target, close) => `${open}${move(target)}${close}`)
    .replace(LINK_DEFINITION, (whole, open, target) => `${open}${move(target)}`);
  return { text: rewritten, problems };
}

/** Check 10: every relative link in the generated folder resolves, and none leaves the repository. */
export function linkProblems(files, { folder, exists }) {
  const problems = [];
  const directories = new Set();
  for (const file of files.keys()) {
    let parent = posix.dirname(file);
    while (parent !== '.' && !directories.has(parent)) {
      directories.add(parent);
      parent = posix.dirname(parent);
    }
  }
  for (const [file, content] of sortedEntries(files)) {
    if (!/\.mdx?$/i.test(file)) continue;
    for (const { pathname } of relativeLinks(utf8(content.bytes))) {
      const resolved = posix.normalize(posix.join(posix.dirname(file), pathname)).replace(/\/$/, '');
      if (resolved === '.') continue;
      if (resolved === '..' || resolved.startsWith('../')) {
        const inRepository = posix.normalize(posix.join(folder, resolved));
        if (inRepository === '..' || inRepository.startsWith('../')) problems.push(`${file} links to ${pathname}, outside the repository`);
        else if (!exists(inRepository)) problems.push(`${file} links to ${pathname}, which does not resolve`);
        continue;
      }
      if (!files.has(resolved) && !directories.has(resolved)) problems.push(`${file} links to ${pathname}, which does not resolve`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// adapters

/**
 * Validate one adapter.json. Every key is known, because a misspelt one would otherwise be read
 * as absent and the copy would silently lack what it was meant to carry.
 */
export function validateAdapter(adapter, folderName) {
  const problems = [];
  if (!adapter || typeof adapter !== 'object' || Array.isArray(adapter)) return { problems: ['adapter.json is not a JSON object'] };
  for (const key of Object.keys(adapter)) if (!ADAPTER_KEYS.has(key)) problems.push(`adapter.json has an unknown key "${key}"`);
  if (adapter.version !== ADAPTER_VERSION) problems.push(`adapter.json version must be ${ADAPTER_VERSION}`);
  if (typeof adapter.name !== 'string' || !SKILL_NAME.test(adapter.name) || adapter.name.length > 64) problems.push('name must be a skill name: lowercase letters, digits and single hyphens, at most 64 characters');
  else if (folderName !== undefined && adapter.name !== folderName) problems.push(`name ${adapter.name} differs from its folder ${folderName}`);
  if (typeof adapter.description !== 'string' || adapter.description.trim() === '' || adapter.description.length > 1024) problems.push('description must be the project\'s own trigger text, 1 to 1024 characters');
  const base = adapter.base;
  if (!base || typeof base !== 'object' || Array.isArray(base)) problems.push('base must be an object naming source, skill and ref');
  else {
    for (const key of Object.keys(base)) if (!BASE_KEYS.has(key)) problems.push(`base has an unknown key "${key}"`);
    const sourceIssue = sourceProblem(base.source);
    if (sourceIssue) problems.push(sourceIssue);
    // A name that is the skill's own is check 6's to refuse, at compose and at check.
    if (typeof base.skill !== 'string' || !SKILL_NAME.test(base.skill)) problems.push('base.skill must be the pack skill\'s name');
    if (base.entry !== undefined && !(typeof base.entry === 'string' && /^[A-Za-z0-9._/-]+\.md$/.test(base.entry) && posix.normalize(base.entry) === base.entry && !base.entry.startsWith('/') && !base.entry.split('/').includes('..'))) {
      problems.push('base.entry must be SKILL.md or the relative path of a Markdown file inside the skill');
    }
    if (typeof base.ref !== 'string' || !REF_NAME.test(base.ref)) problems.push('base.ref must be a tag or a full commit sha');
    if (base.commit !== undefined && !(typeof base.commit === 'string' && FULL_SHA.test(base.commit))) problems.push('base.commit, when given, is the full commit sha');
    if (base.tree !== undefined && !(typeof base.tree === 'string' && FULL_SHA.test(base.tree))) problems.push('base.tree, when given, is the full tree sha');
  }
  if (adapter.widenTools !== undefined && !(Array.isArray(adapter.widenTools) && adapter.widenTools.every((tool) => typeof tool === 'string' && /^\S+$/.test(tool)))) {
    problems.push('widenTools must be a list of tool names, each one word');
  }
  if (adapter.overlay !== undefined && (typeof adapter.overlay !== 'string' || !/^(?!\.\.?\/)[A-Za-z0-9._-]+\.md$/.test(adapter.overlay))) problems.push('overlay must name a Markdown file in the adapter folder');
  if (adapter.projectFiles !== undefined) {
    if (!Array.isArray(adapter.projectFiles)) problems.push('projectFiles must be a list of paths');
    else {
      const seen = new Set();
      for (const file of adapter.projectFiles) {
        const normal = typeof file === 'string' ? posix.normalize(file) : '';
        if (typeof file !== 'string' || normal !== file || file.split('/').includes('..') || !PROJECT_DIRS.some((prefix) => file.startsWith(prefix)) || file.endsWith('/')) {
          problems.push(`project file ${JSON.stringify(file)} must sit under ${PROJECT_DIRS.join(', ')}, so it never collides with the skill's own files`);
        } else if (seen.has(file)) problems.push(`project file ${file} is listed twice`);
        seen.add(file);
      }
    }
  }
  if (adapter.names !== undefined) {
    if (!adapter.names || typeof adapter.names !== 'object' || Array.isArray(adapter.names)) problems.push('names must map a pack skill\'s name to this repository\'s skill');
    else {
      for (const [from, to] of Object.entries(adapter.names)) {
        if (!SKILL_NAME.test(from) || typeof to !== 'string' || !SKILL_NAME.test(to) || from === to) problems.push(`names maps ${JSON.stringify(from)} to ${JSON.stringify(to)}; both must be skill names, and different`);
      }
    }
  }
  if (problems.length) return { problems };
  return {
    problems,
    adapter: {
      version: adapter.version,
      name: adapter.name,
      description: adapter.description,
      base: { source: base.source, skill: base.skill, entry: base.entry ?? 'SKILL.md', ref: base.ref, commit: base.commit ?? null, tree: base.tree ?? null },
      widenTools: adapter.widenTools ?? [],
      overlay: adapter.overlay ?? 'overlay.md',
      projectFiles: [...(adapter.projectFiles ?? [])].sort(),
      names: adapter.names ?? {},
    },
  };
}

function walkFiles(root, relative = '') {
  const found = [];
  const directory = path.join(root, relative);
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...walkFiles(root, child));
    else found.push({ path: child, symlink: entry.isSymbolicLink(), file: entry.isFile() });
  }
  return found;
}

/** Every adapter folder under the adapters directory, read and validated, with its inputs. */
export function loadAdapters(layout) {
  const adapters = [];
  if (!existsSync(layout.adaptersPath)) return adapters;
  for (const entry of readdirSync(layout.adaptersPath, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const folder = path.join(layout.adaptersPath, entry.name);
    const record = { folderName: entry.name, folder, problems: [], adapter: null, raw: null };
    adapters.push(record);
    const file = path.join(folder, ADAPTER_FILE);
    if (!existsSync(file)) {
      record.problems.push(`${layout.adaptersRel}/${entry.name} has no ${ADAPTER_FILE}`);
      continue;
    }
    let parsed;
    try {
      record.raw = readFileSync(file);
      parsed = JSON.parse(utf8(record.raw));
    } catch (error) {
      record.problems.push(`${ADAPTER_FILE} does not parse: ${error.message}`);
      continue;
    }
    const { problems, adapter } = validateAdapter(parsed, entry.name);
    record.problems.push(...problems);
    if (!adapter) continue;
    record.adapter = adapter;
    const overlayPath = path.join(folder, adapter.overlay);
    if (!existsSync(overlayPath)) record.problems.push(`the overlay ${adapter.overlay} is missing; an empty file is a valid overlay`);
    else record.overlay = readFileSync(overlayPath);
    record.projectFiles = new Map();
    for (const projectFile of adapter.projectFiles) {
      const full = path.join(folder, projectFile);
      let stat = null;
      try {
        stat = lstatSync(full);
      } catch {
        stat = null;
      }
      if (!stat || !stat.isFile()) record.problems.push(`project file ${projectFile} is missing or is not a regular file`);
      else record.projectFiles.set(projectFile, { bytes: readFileSync(full), executable: (stat.mode & 0o111) !== 0 });
    }
    for (const prefix of PROJECT_DIRS) {
      const directory = path.join(folder, prefix);
      if (!existsSync(directory)) continue;
      for (const found of walkFiles(directory)) {
        const relative = `${prefix}${found.path}`;
        if (!adapter.projectFiles.includes(relative)) record.problems.push(`${relative} is in the adapter folder but not in projectFiles, so the copy would not carry it`);
      }
    }
  }
  return adapters;
}

export function layoutFor({ repo = '.', adaptersDir = DEFAULT_ADAPTERS_DIR, skillsDir = DEFAULT_SKILLS_DIR } = {}) {
  const root = path.resolve(repo);
  const clean = (value, flag) => {
    const normal = posix.normalize(toPosix(value)).replace(/\/$/, '');
    if (normal.startsWith('/') || normal === '..' || normal.startsWith('../') || normal === '.') throw new AdaptError(`${flag} must be a folder inside the repository`);
    return normal;
  };
  const adaptersRel = clean(adaptersDir, '--adapters-dir');
  const skillsRel = clean(skillsDir, '--skills-dir');
  return {
    root,
    adaptersRel,
    skillsRel,
    adaptersPath: path.join(root, adaptersRel),
    skillsPath: path.join(root, skillsRel),
    toolPath: path.join(root, adaptersRel, TOOL_DIR, TOOL_FILE),
  };
}

// ---------------------------------------------------------------------------------------------
// reading the base

/** The pack skill at a resolved pin: its files, its frontmatter, its entry text and the licence. */
export function readBase(reader, pin) {
  const folder = `skills/${pin.skill}`;
  const files = new Map();
  for (const entry of reader.listFolder(pin.commit, folder)) {
    if (entry.mode === '120000') throw new AdaptError(`${folder}/${entry.path} is a symbolic link; the composer carries files only`);
    if (entry.type !== 'blob') throw new AdaptError(`${folder}/${entry.path} is a ${entry.type}; the composer carries files only`);
    files.set(entry.path, { bytes: reader.blob(entry.object), executable: entry.mode === '100755' });
  }
  const skill = files.get('SKILL.md');
  if (!skill) throw new AdaptError(`${folder} has no SKILL.md at ${pin.ref}`);
  const split = splitFrontmatter(lf(utf8(skill.bytes)));
  if (!split) throw new AdaptError(`${folder}/SKILL.md has no frontmatter`);
  const declared = frontmatterValue(split.frontmatter, 'name');
  if (declared !== pin.skill) throw new AdaptError(`${folder}/SKILL.md names itself ${declared}, not ${pin.skill}`);
  if (pin.entry !== 'SKILL.md' && !files.has(pin.entry)) throw new AdaptError(`${folder} has no ${pin.entry} at ${pin.ref}`);
  const carried = new Map([...files].filter(([file]) => file !== 'SKILL.md'));
  return {
    identity: pin,
    frontmatter: {
      license: frontmatterValue(split.frontmatter, 'license'),
      'allowed-tools': frontmatterValue(split.frontmatter, 'allowed-tools'),
      compatibility: frontmatterValue(split.frontmatter, 'compatibility'),
    },
    entryText: pin.entry === 'SKILL.md' ? split.body : utf8(files.get(pin.entry).bytes),
    skillText: utf8(skill.bytes),
    carried,
    hashes: Object.fromEntries(sortedEntries(files).map(([file, content]) => [file, sha256(content.bytes)])),
    license: files.has('LICENSE') ? null : reader.fileAt(pin.commit, 'LICENSE'),
  };
}

// ---------------------------------------------------------------------------------------------
// composing

/**
 * Compose one adapted skill from its inputs. Pure: the same inputs give the same bytes, with LF
 * line endings, files in sorted order and no timestamps, which is what lets `check` compare a
 * fresh compose with the committed copy byte for byte.
 */
export function composeAdapted({ adapter, overlay: overlaySource, projectFiles = new Map(), base, composer, layout, others = [] }) {
  const errors = [];
  const notes = [];
  const warnings = [];
  const { identity } = base;
  const fail = (check, message) => errors.push(finding(check, message));

  if (adapter.name === identity.skill) fail(6, `the adapted copy takes the name of its skill, ${identity.skill}; it needs a name of its own, so neither copy hides the other`);

  const declarationFiles = [];
  if (identity.entry === 'SKILL.md') declarationFiles.push({ path: 'SKILL.md', text: base.entryText });
  for (const [file, content] of sortedEntries(base.carried)) if (/\.mdx?$/i.test(file)) declarationFiles.push({ path: file, text: utf8(content.bytes) });
  const declared = parseDeclarations(declarationFiles);
  for (const problem of declared.problems) fail(4, problem);
  // Ids declared only in the skill's own SKILL.md are named, so a refusal can say why.
  const skillOnly = identity.entry !== 'SKILL.md' && base.skillText ? parseDeclarations([{ path: 'SKILL.md', text: base.skillText }]) : null;

  const overlay = parseOverlay(utf8(overlaySource ?? ''));
  for (const problem of overlay.problems) fail(0, problem);
  for (const marker of [BASE_BEGIN, BASE_END]) {
    if (overlay.text.includes(marker)) fail(2, `the overlay contains "${marker}", the marker that fences the skill's own text`);
    if (base.entryText.includes(marker)) fail(2, `${identity.entry} contains "${marker}", the marker that fences the skill's own text`);
  }

  const notCarried = (id) => (skillOnly && (skillOnly.slots.has(id) || skillOnly.lines.has(id)) ? `: ${id} is declared only in ${identity.skill}'s SKILL.md, which a copy over ${identity.entry} does not carry` : '');

  // Merge rule 1: a binding replaces a default, binds only a declared slot, and fills every required one.
  const bound = new Map();
  for (const binding of overlay.bindings) {
    if (binding.id[0] === 'H' || binding.id[0] === 'S') {
      fail(4, `overlay line ${binding.line}: ${binding.id} is a ${binding.id[0] === 'H' ? 'hard line' : 'step'}, not a slot; add to it under ## Additions`);
      continue;
    }
    const slot = declared.slots.get(binding.id);
    if (!slot) {
      fail(4, `overlay line ${binding.line} binds ${binding.id}, which no carried file of ${identity.skill} declares${notCarried(binding.id)}`);
      continue;
    }
    if (bound.has(binding.id)) {
      fail(4, `overlay line ${binding.line} binds ${binding.id} a second time`);
      continue;
    }
    if (slot.skill) {
      const named = binding.value.match(/^`([a-z0-9]+(?:-[a-z0-9]+)*)`/);
      if (!named) {
        fail(4, `overlay line ${binding.line}: ${binding.id} is a skill slot, so its value opens with one skill's name in backticks, such as \`${slot.defaultSkill ?? 'a-skill'}\``);
        continue;
      }
      bound.set(binding.id, { ...binding, skill: named[1] });
    } else if (binding.value.trim() === '') {
      fail(4, `overlay line ${binding.line} binds ${binding.id} to nothing; leave the row out to keep its default`);
    } else bound.set(binding.id, binding);
  }
  for (const slot of declared.slots.values()) {
    if (slot.required && !bound.has(slot.id)) fail(4, `${slot.id} is required (${slot.slot}), and the overlay does not bind it`);
  }

  // Merge rules 3 to 5: an addition extends a declared step or hard line, a hard line is never
  // relaxed, and `replaces:` is explicit, carries its reason, and never touches a hard line.
  const added = new Set();
  for (const addition of overlay.additions) {
    if (declared.slots.has(addition.id)) {
      fail(4, `overlay line ${addition.line}: ${addition.id} is a slot; bind it under ## Bindings rather than adding to it`);
      continue;
    }
    if (!declared.lines.has(addition.id)) {
      fail(4, `overlay line ${addition.line} adds to ${addition.id}, which no carried file of ${identity.skill} declares${notCarried(addition.id)}`);
      continue;
    }
    if (added.has(addition.id)) fail(4, `overlay line ${addition.line} adds to ${addition.id} a second time; one addition per id`);
    added.add(addition.id);
    if (addition.text.trim() === '') fail(4, `overlay line ${addition.line}: the addition to ${addition.id} is empty`);
    if (addition.replaces) {
      if (addition.id[0] === 'H') fail(5, `overlay line ${addition.line}: replaces: on ${addition.id}, a hard line; a hard line is never replaced or relaxed`);
      else if (addition.replaces.id !== addition.id) fail(5, `overlay line ${addition.line}: a replacement opens "replaces: ${addition.id}." and then says why`);
      else if (addition.replaces.reason === '') fail(5, `overlay line ${addition.line}: replaces: ${addition.id} gives no reason; say why, and where the decision is recorded`);
      else notes.push(`For review: the overlay replaces ${addition.id} ("${addition.replaces.reason}").`);
    }
    if (addition.id[0] === 'H') {
      const word = addition.text.match(RELAXING);
      if (word) fail(5, `overlay line ${addition.line}: the addition to ${addition.id} reads as relaxing it ("${word[0]}"); a hard line is only made stricter. If the text is stricter, say so without an exception word`);
      notes.push(`For review against ${addition.id}: the overlay adds to this hard line.`);
    }
  }
  const hardLines = [...declared.lines.values()].filter((line) => line.kind === 'H');
  overlay.text.split('\n').forEach((line, index) => {
    if (/^###\s/.test(line)) return;
    for (const hard of hardLines) {
      if (!new RegExp(`\\b${hard.id}\\b`).test(line)) continue;
      const inAddition = overlay.additions.some((addition) => addition.id === hard.id && addition.text.includes(line));
      const word = line.match(RELAXING);
      if (word && !inAddition) fail(5, `overlay line ${index + 1} names ${hard.id} and reads as relaxing it ("${word[0]}"); a hard line is only made stricter`);
    }
  });
  for (const hard of hardLines) {
    for (const id of bound.keys()) if (new RegExp(`\\b${id}\\b`).test(hard.text)) notes.push(`For review against ${hard.id}: it names ${id}, which the overlay binds.`);
  }

  // Merge rule 2: a skill slot maps a name and never edits the text.
  const names = new Map();
  const mapName = (from, to, why) => {
    const existing = names.get(from);
    if (existing && existing.to !== to) fail(4, `${why} maps \`${from}\` to \`${to}\`, and ${existing.why} maps it to \`${existing.to}\`; the names map can say one thing`);
    else if (!existing) names.set(from, { to, why });
  };
  for (const [id, binding] of bound) {
    const slot = declared.slots.get(id);
    if (slot.skill && slot.defaultSkill && binding.skill !== slot.defaultSkill) mapName(slot.defaultSkill, binding.skill, `slot ${id}`);
  }
  const skillDefaults = new Set([...declared.slots.values()].filter((slot) => slot.skill && slot.defaultSkill).map((slot) => slot.defaultSkill));
  const carriedText = [base.entryText, ...[...base.carried.entries()].filter(([file]) => /\.mdx?$/i.test(file)).map(([, content]) => utf8(content.bytes))].join('\n');
  for (const [from, to] of Object.entries(adapter.names).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (skillDefaults.has(from)) fail(4, `adapter.json names maps \`${from}\`, which a skill slot hands work to; bind that slot instead`);
    else if (!carriedText.includes(`\`${from}\``)) fail(4, `adapter.json names maps \`${from}\`, which the carried text never names`);
    else mapName(from, to, 'adapter.json names');
  }
  // Check 4: a handoff to a skill this repository adapts goes to the adapted copy, never the generic one.
  const adaptedHere = new Map();
  for (const other of others) if (other.name !== adapter.name) adaptedHere.set(other.skill, [...(adaptedHere.get(other.skill) ?? []), other.name]);
  for (const slot of declared.slots.values()) {
    if (!slot.skill || !slot.defaultSkill || !adaptedHere.has(slot.defaultSkill) || names.has(slot.defaultSkill)) continue;
    fail(4, `${slot.id} hands work to \`${slot.defaultSkill}\`, which this repository adapts as ${adaptedHere.get(slot.defaultSkill).map((name) => `\`${name}\``).join(' and ')}; bind ${slot.id} to it, or the agent is sent to the generic copy`);
  }
  if (identity.entry !== 'SKILL.md' && adaptedHere.has(identity.skill) && base.entryText.includes(`\`${identity.skill}\``) && !names.has(identity.skill)) {
    fail(4, `${identity.entry} sends the reader to \`${identity.skill}\`, which this repository adapts as ${adaptedHere.get(identity.skill).map((name) => `\`${name}\``).join(' and ')}; map it in adapter.json names`);
  }

  // The skill's own text, byte for byte, but for the links a reference-file entry has rewritten.
  let segment = base.entryText;
  if (identity.entry !== 'SKILL.md') {
    const rewritten = rewriteEntryLinks(segment, identity.entry);
    for (const problem of rewritten.problems) fail(10, problem);
    segment = rewritten.text;
  }
  if (!segment.endsWith('\n')) segment += '\n';

  const skillMarkdown = composeSkillMarkdown({ adapter, base, names, overlay, segment, layout });

  const files = new Map();
  for (const [file, content] of base.carried) files.set(file, content);
  for (const [file, content] of projectFiles) {
    if (files.has(file)) fail(0, `project file ${file} collides with a file of ${identity.skill}`);
    else files.set(file, content);
  }
  if (base.license) files.set('LICENSE', { bytes: base.license, executable: false });
  else if (!files.has('LICENSE')) warnings.push(`${sourceLabel(identity.source)} has no LICENSE at ${identity.ref}, so the copy carries none; check the terms the skill is shared under`);
  files.set('SKILL.md', { bytes: Buffer.from(skillMarkdown, 'utf8'), executable: false });

  const lineCount = skillMarkdown.split('\n').length - 1;
  if (lineCount > LONG_SKILL_LINES) warnings.push(`SKILL.md is ${lineCount} lines, past the ${LONG_SKILL_LINES} that agents are asked to keep a skill under; move project traps into a project reference file`);

  for (const problem of linkProblems(files, { folder: posix.join(layout.skillsRel, adapter.name), exists: layout.exists ?? (() => false) })) fail(10, problem);
  // Over a reference file, this copy's SKILL.md holds that file's text. Another carried file that
  // links to the skill's SKILL.md is carried byte for byte, so its link resolves, and reaches the
  // wrong text; it cannot be rewritten without editing the skill, so it is named instead.
  if (identity.entry !== 'SKILL.md') {
    const named = new Set();
    for (const [file, content] of sortedEntries(base.carried)) {
      if (!/\.mdx?$/i.test(file)) continue;
      for (const { pathname } of relativeLinks(utf8(content.bytes))) {
        if (posix.normalize(posix.join(posix.dirname(file), pathname)) !== 'SKILL.md') continue;
        named.add(`${file} links to ${pathname}, ${identity.skill}'s own SKILL.md; it is carried byte for byte, so in this copy that link reaches the text of ${identity.entry}`);
      }
    }
    warnings.push(...named);
  }

  const lock = {
    version: LOCK_VERSION,
    name: adapter.name,
    composer: { version: COMPOSER_VERSION, sha256: composer.sha256 },
    layout: { adapters: layout.adaptersRel, skills: layout.skillsRel },
    base: {
      source: identity.source,
      skill: identity.skill,
      entry: identity.entry,
      ref: identity.ref,
      commit: identity.commit,
      tree: identity.tree,
      frontmatter: base.frontmatter,
      license: base.license ? sha256(base.license) : null,
      body: sha256(segment),
      files: base.hashes,
    },
    adapter: Object.fromEntries([
      [ADAPTER_FILE, sha256(adapter.raw ?? '')],
      [adapter.overlay, sha256(overlay.text)],
      ...sortedEntries(projectFiles).map(([file, content]) => [file, sha256(content.bytes)]),
    ].sort(([a], [b]) => (a < b ? -1 : 1))),
    files: Object.fromEntries(sortedEntries(files).map(([file, content]) => [file, sha256(content.bytes)])),
  };
  files.set(LOCK_FILE, { bytes: Buffer.from(`${JSON.stringify(lock, null, 2)}\n`, 'utf8'), executable: false });

  return { files: new Map(sortedEntries(files)), errors, warnings, notes: [...new Set(notes)], lock, names, declared };
}

function composeSkillMarkdown({ adapter, base, names, overlay, segment, layout }) {
  const { identity, frontmatter } = base;
  const lines = ['---', `name: ${adapter.name}`, `description: ${yamlString(adapter.description)}`];
  if (frontmatter.license) lines.push(`license: ${yamlString(frontmatter.license)}`);
  const tools = widenTools(frontmatter['allowed-tools'], adapter.widenTools);
  if (tools) lines.push(`allowed-tools: ${yamlString(tools)}`);
  if (frontmatter.compatibility) lines.push(`compatibility: ${yamlString(frontmatter.compatibility)}`);
  lines.push(
    'metadata:',
    `  adapted-from: ${JSON.stringify(`${identity.source} skills/${identity.skill}`)}`,
    `  entry: ${JSON.stringify(identity.entry)}`,
    `  ref: ${JSON.stringify(identity.ref)}`,
    `  commit: ${JSON.stringify(identity.commit)}`,
    `  tree: ${JSON.stringify(short(identity.tree))}`,
    '---',
  );
  const adapterFolder = `${layout.adaptersRel}/${adapter.name}/`;
  const folders = [
    layout.adaptersRel === DEFAULT_ADAPTERS_DIR ? '' : ` --adapters-dir ${layout.adaptersRel}`,
    layout.skillsRel === DEFAULT_SKILLS_DIR ? '' : ` --skills-dir ${layout.skillsRel}`,
  ].join('');
  lines.push(`<!-- GENERATED by adapt.mjs from ${identity.skill} at ${identity.ref}. Do not edit it by hand: edit ${adapterFolder} and run node ${layout.adaptersRel}/${TOOL_DIR}/${TOOL_FILE} compose --repo .${folders} --write -->`, '');
  const what = identity.entry === 'SKILL.md' ? `\`${identity.skill}\`` : `\`${identity.entry}\` of \`${identity.skill}\``;
  // The skill's text is carried unchanged, so a replaced step still reads as it did upstream; the
  // copy says which instruction wins, or an agent reading it would find two for one step.
  const replaced = overlay.additions.filter((addition) => addition.replaces).map((addition) => addition.id);
  const supersedes = replaced.length === 0 ? '' : ` Where an addition there opens with \`replaces:\` (${replaced.join(', ')}), it supersedes that step: follow the addition, not the step's text between the markers.`;
  const rest = identity.entry === 'SKILL.md' ? '' : ` The skill's own SKILL.md is not part of this copy.`;
  lines.push(`This is ${what} at \`${identity.ref}\` from \`${sourceLabel(identity.source)}\`, adapted to this repository. Its own text is carried unchanged between the \`base:begin\` and \`base:end\` markers below; the bindings fill its slots, and "In this repository" adds to its steps and hard lines by id.${supersedes} Nothing here relaxes a hard line.${rest}`, '');
  if (names.size > 0) {
    lines.push('## Names in this copy', '', 'Where the text below names another skill, use this repository\'s skill instead:', '', '| the text says | use |', '|---|---|');
    for (const [from, { to }] of sortedEntries(names)) lines.push(`| \`${from}\` | \`${to}\` |`);
    lines.push('');
  }
  if (overlay.bindingsText) lines.push('## This repository\'s bindings', '', overlay.bindingsText, '');
  lines.push(`${BASE_BEGIN} ${identity.skill}@${identity.ref} ${identity.entry} -->`);
  const text = `${lines.join('\n')}\n${segment}${BASE_END}\n`;
  const after = [];
  if (overlay.additionsText || overlay.trapsText) {
    after.push('', '## In this repository', '');
    if (overlay.additionsText) after.push(overlay.additionsText, '');
    if (overlay.trapsText) after.push('### Project traps', '', overlay.trapsText, '');
  }
  return after.length ? `${text}${after.join('\n')}` : text;
}

/** The skill's own text between the markers of a composed SKILL.md, or null when it cannot be found. */
export function extractSegment(skillMarkdown) {
  const begin = skillMarkdown.indexOf(BASE_BEGIN);
  if (begin < 0) return null;
  const open = skillMarkdown.indexOf('\n', begin);
  const end = skillMarkdown.indexOf(BASE_END, open);
  if (open < 0 || end < 0 || skillMarkdown.indexOf(BASE_END, end + 1) >= 0) return null;
  return skillMarkdown.slice(open + 1, end);
}

// ---------------------------------------------------------------------------------------------
// reading and writing generated folders

function readGenerated(folder) {
  const files = new Map();
  const problems = [];
  for (const found of walkFiles(folder)) {
    if (found.symlink) problems.push(`${found.path} is a symbolic link`);
    else if (found.file) {
      const full = path.join(folder, found.path);
      files.set(found.path, { bytes: readFileSync(full), executable: (statSync(full).mode & 0o111) !== 0 });
    }
  }
  return { files, problems };
}

function readLock(folder) {
  const file = path.join(folder, LOCK_FILE);
  if (!existsSync(file)) return null;
  try {
    const lock = JSON.parse(readFileSync(file, 'utf8'));
    return lock && typeof lock === 'object' && lock.version === LOCK_VERSION && lock.base && lock.files ? lock : { unreadable: `${LOCK_FILE} is not a lock this composer reads` };
  } catch (error) {
    return { unreadable: `${LOCK_FILE} does not parse: ${error.message}` };
  }
}

/** Check 1: the folder holds exactly the files its lock lists, each with the recorded sha256. */
export function integrityProblems(generated, lock) {
  const problems = [];
  const expected = new Map(Object.entries(lock.files ?? {}));
  for (const [file, content] of sortedEntries(generated)) {
    if (file === LOCK_FILE) continue;
    if (!expected.has(file)) problems.push(`${file} is not in the lock: added by hand`);
    else if (sha256(content.bytes) !== expected.get(file)) problems.push(`${file} differs from the lock: edited by hand, or composed by something else`);
  }
  for (const file of expected.keys()) if (!generated.has(file)) problems.push(`${file} is in the lock and missing from the folder`);
  return problems;
}

function writeGenerated(target, files) {
  const parent = path.dirname(target);
  mkdirSync(parent, { recursive: true });
  const staging = mkdtempSync(path.join(parent, `.${path.basename(target)}.compose-`));
  try {
    for (const [file, content] of files) {
      const full = path.join(staging, ...file.split('/'));
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, content.bytes);
      chmodSync(full, content.executable ? 0o755 : 0o644);
    }
    const previous = existsSync(target) ? `${staging}.previous` : null;
    if (previous) renameSync(target, previous);
    renameSync(staging, target);
    if (previous) rmSync(previous, { recursive: true, force: true });
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function composerBytes() {
  return readFileSync(fileURLToPath(import.meta.url));
}

/**
 * The composer a pinned commit ships, or null when the source carries none there. It is read and
 * compared, never run: compose runs nothing it fetched, so the composer moves with a pin only when
 * a person runs the one the new ref ships.
 */
export function composerAt(reader, commit) {
  return reader.fileAt(commit, PACK_COMPOSER_PATH);
}

const takeComposer = (ref) => `To move the composer with the pin, compose --write with ${PACK_COMPOSER_PATH} from a clone of the pack at ${ref}`;

// ---------------------------------------------------------------------------------------------
// commands

function others(adapters) {
  return adapters.filter((record) => record.adapter).map((record) => ({ name: record.adapter.name, skill: record.adapter.base.skill }));
}

function selectAdapters(adapters, name) {
  if (!name) return adapters;
  const selected = adapters.filter((record) => record.folderName === name);
  if (selected.length === 0) throw new AdaptError(`no adapter folder named ${name}`);
  return selected;
}

function existsInRepository(layout) {
  return (relative) => existsSync(path.join(layout.root, ...relative.split('/')));
}

/**
 * `compose`: read each pin, compose, and print the change. With `--write`, write the generated
 * folder and vendor this file. It refuses to overwrite a folder that is not exactly what its own
 * lock says, so a hand edit is never lost without `--discard-hand-edits`.
 */
export function runCompose(options, io) {
  const layout = { ...layoutFor(options) };
  layout.exists = existsInRepository(layout);
  const adapters = loadAdapters(layout);
  if (adapters.length === 0) {
    io.out(`No adapters under ${layout.adaptersRel}/. Each adapted skill is a folder there holding ${ADAPTER_FILE} and its overlay.`);
    return EXIT_OK;
  }
  const selected = selectAdapters(adapters, options.adapter);
  const bytes = composerBytes();
  const composer = { sha256: sha256(bytes) };
  let failed = false;
  for (const record of selected) {
    const label = record.folderName;
    if (record.problems.length) {
      io.out(`${label}: refused`);
      for (const problem of record.problems) io.out(`  [adapter] ${problem}`);
      failed = true;
      continue;
    }
    const { adapter } = record;
    adapter.raw = record.raw;
    let source;
    try {
      source = openSource(adapter.base, { repo: layout.root, pack: options.pack });
      const pin = resolvePin(source.reader, adapter.base);
      const base = readBase(source.reader, pin);
      const shipped = composerAt(source.reader, pin.commit);
      const result = composeAdapted({ adapter, overlay: record.overlay, projectFiles: record.projectFiles, base, composer, layout, others: others(adapters) });
      const target = path.join(layout.skillsPath, adapter.name);
      const targetRel = `${layout.skillsRel}/${adapter.name}`;
      io.out(`${label}: ${pin.skill} at ${pin.ref} (commit ${short(pin.commit)}, tree ${short(pin.tree)}), read from ${source.origin}`);
      if (result.errors.length) {
        io.out('  refused:');
        for (const error of result.errors) io.out(`  [${error.check || 'adapter'}] ${error.message}`);
        failed = true;
        continue;
      }

      const existing = existsSync(target) ? readGenerated(target) : null;
      const previousLock = existing ? readLock(target) : null;
      if (existing) {
        const handEdits = !previousLock ? [`${targetRel} has no ${LOCK_FILE}: it was not composed, and its files would be replaced`]
          : previousLock.unreadable ? [previousLock.unreadable]
            : [...existing.problems, ...integrityProblems(existing.files, previousLock)];
        if (handEdits.length && !options.discardHandEdits) {
          io.out(`  refused: ${targetRel} is not what its lock says, and composing would overwrite it:`);
          for (const problem of handEdits) io.out(`  - ${problem}`);
          io.out('  Move anything worth keeping into the adapter folder, then compose again with --discard-hand-edits.');
          failed = true;
          continue;
        }
        if (handEdits.length) io.out(`  discarding hand edits in ${targetRel}, as --discard-hand-edits asks`);
      }

      if (previousLock && !previousLock.unreadable && previousLock.base) {
        const was = previousLock.base;
        // The same tag naming another commit is a moved tag, not a release. It is taken only when
        // adapter.json records the new commit, which is a person saying they read why.
        if (was.ref === pin.ref && was.source === pin.source && was.commit !== pin.commit && adapter.base.commit !== pin.commit) {
          io.out(`  refused: [pin] ${pin.ref} named ${short(was.commit)} when this copy was composed, and names ${short(pin.commit)} now. A published tag should never move: read why, then re-pin to a full sha or a new tag, or set base.commit to ${pin.commit} to take it`);
          failed = true;
          continue;
        }
        if (was.ref === pin.ref && was.commit === pin.commit) io.out('  pin unchanged');
        else if (was.tree === pin.tree) io.out(`  pin moves from ${was.ref} to ${pin.ref}; skills/${pin.skill} is unchanged, so there is nothing to review`);
        else io.out(`  pin moves from ${was.ref} to ${pin.ref}; skills/${pin.skill} changed (tree ${short(was.tree)} -> ${short(pin.tree)}): read \`git diff ${was.ref} ${pin.ref} -- skills/${pin.skill}\` in the pack, then the diff below`);
      } else io.out('  first compose');

      const before = existing?.files ?? new Map();
      let changes = 0;
      for (const [file, content] of result.files) {
        if (!before.has(file)) {
          io.out(`  + ${file}`);
          changes += 1;
        } else if (!before.get(file).bytes.equals(content.bytes)) {
          io.out(`  ~ ${file}`);
          changes += 1;
        }
      }
      for (const file of before.keys()) {
        if (!result.files.has(file)) {
          io.out(`  - ${file}`);
          changes += 1;
        }
      }
      if (changes === 0) io.out('  no change');
      for (const note of result.notes) io.out(`  ${note}`);
      if (shipped && !shipped.equals(bytes)) {
        io.out(`  Note: ${pin.ref} ships another composer (sha256 ${short(sha256(shipped))}) than this one (sha256 ${short(composer.sha256)}), which composes the copy and is the one vendored. ${takeComposer(pin.ref)}.`);
      }
      for (const warning of result.warnings) io.out(`  Warning: ${warning}`);

      const vendored = existsSync(layout.toolPath) ? readFileSync(layout.toolPath) : null;
      if (!options.write) {
        if (!vendored || !vendored.equals(bytes)) io.out(`  the composer would be vendored at ${layout.adaptersRel}/${TOOL_DIR}/${TOOL_FILE}`);
        continue;
      }
      if (changes > 0) writeGenerated(target, result.files);
      if (!vendored || !vendored.equals(bytes)) {
        mkdirSync(path.dirname(layout.toolPath), { recursive: true });
        writeFileSync(layout.toolPath, bytes);
        io.out(`  vendored the composer at ${layout.adaptersRel}/${TOOL_DIR}/${TOOL_FILE}`);
      }
      io.out(changes > 0 ? `  wrote ${targetRel}/` : `  ${targetRel}/ is already current`);
    } catch (error) {
      if (!(error instanceof AdaptError)) throw error;
      io.out(`${label}: refused`);
      io.out(`  [${error.check || 'pin'}] ${error.message}`);
      failed = true;
    } finally {
      source?.cleanup();
    }
  }
  if (!options.write && !failed) io.out('Nothing written. Run again with --write to write it.');
  return failed ? EXIT_FAILED : EXIT_OK;
}

/** Rebuild the base a copy was composed from, out of the copy and its lock alone. */
function baseFromCopy(lock, generated) {
  const recorded = lock.base;
  const carried = new Map();
  for (const file of Object.keys(recorded.files ?? {})) {
    if (file === 'SKILL.md') continue;
    if (!generated.has(file)) return { problem: `${file} of ${recorded.skill} is missing from the copy` };
    carried.set(file, generated.get(file));
  }
  let entryText;
  if (recorded.entry === 'SKILL.md') {
    const skill = generated.get('SKILL.md');
    entryText = skill ? extractSegment(utf8(skill.bytes)) : null;
    if (entryText === null) return { problem: 'the base:begin and base:end markers in SKILL.md are missing or repeated' };
  } else entryText = utf8(carried.get(recorded.entry)?.bytes ?? '');
  const license = recorded.license ? generated.get('LICENSE')?.bytes ?? null : null;
  if (recorded.license && !license) return { problem: 'LICENSE is missing from the copy' };
  return {
    base: {
      identity: { source: recorded.source, skill: recorded.skill, entry: recorded.entry, ref: recorded.ref, commit: recorded.commit, tree: recorded.tree },
      frontmatter: recorded.frontmatter ?? {},
      entryText,
      skillText: null,
      carried,
      hashes: recorded.files,
      license,
    },
  };
}

/** Check 9: the frontmatter follows the skill's, widened only by widenTools, with metadata a map. */
function frontmatterProblems(skillMarkdown, lock, adapter) {
  const split = splitFrontmatter(skillMarkdown);
  if (!split) return ['SKILL.md has no frontmatter'];
  const problems = [];
  const recorded = lock.base.frontmatter ?? {};
  const expectedTools = widenTools(recorded['allowed-tools'], adapter.widenTools) || null;
  if ((frontmatterValue(split.frontmatter, 'allowed-tools') || null) !== expectedTools) problems.push(`allowed-tools is not ${recorded['allowed-tools'] ?? 'absent'}${adapter.widenTools.length ? ` widened by ${adapter.widenTools.join(' ')}` : ''}, as the skill and widenTools give`);
  if ((frontmatterValue(split.frontmatter, 'compatibility') || null) !== (recorded.compatibility || null)) problems.push('compatibility differs from the skill\'s');
  const metadata = split.frontmatter.split('\n');
  const at = metadata.findIndex((line) => line.startsWith('metadata:'));
  if (at < 0 || metadata[at].trim() !== 'metadata:' || !/^\s+[A-Za-z-]+:\s/.test(metadata[at + 1] ?? '')) problems.push('metadata is not a YAML map');
  return problems;
}

/**
 * `check`: offline and read-only. Each adapted copy is held to its lock (1), its base text to the
 * recorded hash (2), a fresh compose of its recorded inputs (3, and with it 4, 5 and 10), its
 * name (6), the vendored composer (7), its length (8, a warning) and its frontmatter (9).
 */
export function runCheck(options, io) {
  const layout = { ...layoutFor(options) };
  layout.exists = existsInRepository(layout);
  const adapters = loadAdapters(layout);
  const running = composerBytes();
  const vendored = existsSync(layout.toolPath) ? readFileSync(layout.toolPath) : null;
  let failures = 0;
  let checked = 0;

  const names = new Set(adapters.map((record) => record.folderName));
  if (existsSync(layout.skillsPath)) {
    for (const entry of readdirSync(layout.skillsPath, { withFileTypes: true })) {
      if (entry.isDirectory() && !names.has(entry.name) && existsSync(path.join(layout.skillsPath, entry.name, LOCK_FILE))) {
        io.out(`${entry.name}: FAILED`);
        io.out(`  [1] ${layout.skillsRel}/${entry.name} was composed from an adapter that is no longer in ${layout.adaptersRel}/; restore the adapter, or delete the folder`);
        failures += 1;
      }
    }
  }

  for (const record of selectAdapters(adapters, options.adapter)) {
    checked += 1;
    const problems = [];
    const warnings = [];
    const add = (check, message) => problems.push(finding(check, message));
    for (const problem of record.problems) add(0, problem);
    const adapter = record.adapter;
    const target = path.join(layout.skillsPath, record.folderName);
    const lock = existsSync(target) ? readLock(target) : null;
    if (!existsSync(target)) add(1, `${layout.skillsRel}/${record.folderName} does not exist: compose it with --write`);
    else if (!lock) add(1, `${layout.skillsRel}/${record.folderName} has no ${LOCK_FILE}: it was not composed`);
    else if (lock.unreadable) add(1, lock.unreadable);

    if (lock && !lock.unreadable) {
      const generated = readGenerated(target);
      for (const problem of generated.problems) add(1, problem);
      for (const problem of integrityProblems(generated.files, lock)) add(1, problem);
      const skill = generated.files.get('SKILL.md');
      const segment = skill ? extractSegment(utf8(skill.bytes)) : null;
      if (segment === null) add(2, 'the base:begin and base:end markers in SKILL.md are missing or repeated');
      else if (sha256(segment) !== lock.base.body) add(2, `the skill's own text between the markers is not the text composed from ${lock.base.skill} at ${lock.base.ref}`);
      if (lock.base.skill === record.folderName) add(6, `the adapted copy takes the name of its skill, ${lock.base.skill}`);
      if (!vendored) add(7, `the composer is not vendored at ${layout.adaptersRel}/${TOOL_DIR}/${TOOL_FILE}; compose with --write`);
      else if (sha256(vendored) !== lock.composer?.sha256) add(7, `the vendored composer is not the one that composed this copy; compose again with --write`);
      else if (!running.equals(vendored)) add(7, `run the check with the vendored composer, ${layout.adaptersRel}/${TOOL_DIR}/${TOOL_FILE}; another composer composes differently`);
      if (lock.layout && (lock.layout.adapters !== layout.adaptersRel || lock.layout.skills !== layout.skillsRel)) {
        add(3, `composed with --adapters-dir ${lock.layout.adapters} and --skills-dir ${lock.layout.skills}; check with the same`);
      }

      if (adapter) {
        const stale = ['source', 'skill', 'entry', 'ref'].filter((key) => adapter.base[key] !== lock.base[key]);
        if (adapter.base.commit && adapter.base.commit !== lock.base.commit) stale.push('commit');
        if (adapter.base.tree && adapter.base.tree !== lock.base.tree) stale.push('tree');
        if (stale.length) add(3, `adapter.json pins ${adapter.base.skill} at ${adapter.base.ref}, but the copy was composed from ${lock.base.skill} at ${lock.base.ref} (${stale.join(', ')} differ): compose again`);
        else {
          const rebuilt = baseFromCopy(lock, generated.files);
          if (rebuilt.problem) add(3, rebuilt.problem);
          else if (!record.problems.length) {
            adapter.raw = record.raw;
            // A composer mismatch is check 7's to report; recomposing with the recorded hash keeps
            // check 3 about the bytes rather than repeating it.
            const result = composeAdapted({ adapter, overlay: record.overlay, projectFiles: record.projectFiles, base: rebuilt.base, composer: { sha256: lock.composer?.sha256 ?? sha256(running) }, layout, others: others(adapters) });
            for (const error of result.errors) add(error.check, error.message);
            warnings.push(...result.warnings);
            if (!result.errors.length) {
              const differ = [];
              for (const [file, content] of result.files) if (!generated.files.get(file)?.bytes.equals(content.bytes)) differ.push(file);
              for (const file of generated.files.keys()) if (!result.files.has(file)) differ.push(file);
              if (differ.length) add(3, `composing again gives different bytes for ${[...new Set(differ)].sort().join(', ')}: the adapter folder changed without a compose, or the copy was edited`);
            }
          }
          if (skill) for (const problem of frontmatterProblems(utf8(skill.bytes), lock, adapter)) add(9, problem);
        }
      }
    }

    const pin = lock && !lock.unreadable ? `${lock.base.skill} at ${lock.base.ref}, tree ${short(lock.base.tree)}` : 'not composed';
    if (problems.length) {
      failures += 1;
      io.out(`${record.folderName}: FAILED (${pin})`);
      const seen = new Set();
      for (const problem of problems.sort((a, b) => a.check - b.check)) {
        const line = `  [${problem.check || 'adapter'}] ${problem.message}`;
        if (!seen.has(line)) io.out(line);
        seen.add(line);
      }
    } else io.out(`${record.folderName}: ok (${pin})`);
    for (const warning of warnings) io.out(`  Warning: ${warning}`);
  }
  if (checked === 0 && failures === 0) io.out(`No adapted skills under ${layout.adaptersRel}/.`);
  else io.out(`${checked} adapted skill${checked === 1 ? '' : 's'} checked, ${failures} failed.`);
  return failures ? EXIT_FAILED : EXIT_OK;
}

/** `vX.Y.Z` is a catalogue tag; `<skill>-vX.Y.Z` is one skill's tag. Anything else is not ordered. */
export function tagVersion(tag, skill) {
  const catalogue = tag.match(/^v(\d+)\.(\d+)\.(\d+)$/);
  if (catalogue) return { family: 'catalogue', version: catalogue.slice(1).map(Number) };
  if (tag.startsWith(`${skill}-v`)) {
    const own = tag.slice(skill.length + 2).match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (own) return { family: 'skill', version: own.slice(1).map(Number) };
  }
  return null;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) if (left[index] !== right[index]) return left[index] - right[index];
  return 0;
}

/** The newest tag of each family that is newer than the pin, or the newest of each for a sha pin. */
export function newerTags(tags, pinRef, skill) {
  const pinned = tagVersion(pinRef, skill);
  const newest = new Map();
  for (const tag of tags.keys()) {
    const parsed = tagVersion(tag, skill);
    if (!parsed) continue;
    if (pinned && (parsed.family !== pinned.family || compareVersions(parsed.version, pinned.version) <= 0)) continue;
    const best = newest.get(parsed.family);
    if (!best || compareVersions(parsed.version, best.version) > 0) newest.set(parsed.family, { tag, version: parsed.version });
  }
  return [...newest.values()].map((entry) => entry.tag).sort();
}

/**
 * `outdated`: online and read-only. For each adapted copy: whether its pinned tag still names the
 * commit it was composed from, the newest newer tag and whether that tag changes the skill, whether
 * the vendored composer is the one the pinned commit ships, and, with `--verify`, whether every
 * carried file is still the upstream bytes.
 */
export function runOutdated(options, io) {
  const layout = layoutFor(options);
  const adapters = selectAdapters(loadAdapters(layout), options.adapter);
  let attention = false;
  let failed = false;
  if (adapters.length === 0) io.out(`No adapters under ${layout.adaptersRel}/.`);
  for (const record of adapters) {
    const target = path.join(layout.skillsPath, record.folderName);
    const lock = existsSync(target) ? readLock(target) : null;
    if (!lock || lock.unreadable) {
      io.out(`${record.folderName}: not composed yet; compose it first`);
      attention = true;
      continue;
    }
    const pinned = lock.base;
    io.out(`${record.folderName} adapts ${pinned.skill} at ${pinned.ref} (commit ${short(pinned.commit)}, tree ${short(pinned.tree)}) from ${sourceLabel(pinned.source)}`);
    if (record.adapter && (record.adapter.base.ref !== pinned.ref || record.adapter.base.skill !== pinned.skill)) {
      io.out(`  adapter.json now pins ${record.adapter.base.skill} at ${record.adapter.base.ref}; compose to adopt it`);
      attention = true;
    }
    const source = isGithubSource(pinned.source) ? pinned.source : path.resolve(layout.root, pinned.source);
    const scratch = { dir: null };
    const readerFor = () => {
      if (!isGithubSource(pinned.source)) return new GitReader(source);
      if (!scratch.dir) {
        scratch.dir = mkdtempSync(path.join(tmpdir(), 'adapt-outdated-'));
        const init = runGit(['-c', 'init.templateDir=', 'init', '--quiet', '--bare', scratch.dir]);
        if (init.status !== 0) throw new AdaptError(`cannot create a scratch repository: ${init.stderr}`);
      }
      return new GitReader(scratch.dir);
    };
    const fetchedRefs = new Set();
    const fetchRef = (reader, refspec) => {
      if (!isGithubSource(pinned.source) || fetchedRefs.has(refspec)) return;
      const fetched = reader.run(['fetch', '--quiet', '--depth', '1', '--no-tags', pinned.source, refspec], { timeout: 300_000 });
      if (fetched.status !== 0) throw new AdaptError(`cannot fetch ${refspec} from ${sourceLabel(pinned.source)}: ${fetched.stderr || 'git fetch failed'}`);
      fetchedRefs.add(refspec);
    };
    try {
      const tags = listRemoteTags(source);
      if (!FULL_SHA.test(pinned.ref)) {
        if (!tags.has(pinned.ref)) {
          io.out(`  ALARM: the tag ${pinned.ref} is gone from the source. Read why before composing again, and re-pin to a full sha or a new tag.`);
          attention = true;
        } else if (tags.get(pinned.ref) !== pinned.commit) {
          io.out(`  ALARM: the tag ${pinned.ref} now names ${short(tags.get(pinned.ref))}, not ${short(pinned.commit)}, the commit this copy was composed from. A published tag should never move: read why before composing again, and re-pin to a full sha or a new tag.`);
          attention = true;
        }
      }
      const newer = newerTags(tags, pinned.ref, pinned.skill);
      if (newer.length === 0) io.out(FULL_SHA.test(pinned.ref) ? '  no release tag to compare with' : `  no newer release than ${pinned.ref}`);
      for (const tag of newer) {
        const reader = readerFor();
        fetchRef(reader, `+refs/tags/${tag}:refs/tags/${tag}`);
        const commit = reader.commitOf(`refs/tags/${tag}`);
        const tree = commit ? reader.treeAt(commit, `skills/${pinned.skill}`) : null;
        if (!tree) {
          io.out(`  ${tag} exists, and skills/${pinned.skill} is gone from it: read the release notes before moving the pin`);
          attention = true;
        } else if (tree === pinned.tree) io.out(`  ${tag} exists; skills/${pinned.skill} unchanged: moving the pin is a no-op`);
        else {
          io.out(`  ${tag} exists; skills/${pinned.skill} changed (tree ${short(pinned.tree)} -> ${short(tree)}): read \`git diff ${pinned.ref} ${tag} -- skills/${pinned.skill}\``);
          attention = true;
        }
      }
      // The vendored composer against the one the pinned commit ships. A pin moved with the old
      // composer keeps it, and nothing else would say so.
      const pinReader = readerFor();
      fetchRef(pinReader, pinned.commit);
      const shipped = composerAt(pinReader, pinned.commit);
      const vendored = existsSync(layout.toolPath) ? readFileSync(layout.toolPath) : null;
      if (!shipped) io.out(`  composer: ${pinned.ref} ships none to compare with`);
      else if (!vendored) {
        io.out(`  composer: none is vendored at ${layout.adaptersRel}/${TOOL_DIR}/${TOOL_FILE}; compose with --write`);
        attention = true;
      } else if (shipped.equals(vendored)) io.out(`  composer: the vendored one is the one ${pinned.ref} ships`);
      else {
        io.out(`  composer: the vendored one (sha256 ${short(sha256(vendored))}) is not the one ${pinned.ref} ships (sha256 ${short(sha256(shipped))}). ${takeComposer(pinned.ref)}`);
        attention = true;
      }
      if (options.verify) {
        const reader = readerFor();
        fetchRef(reader, pinned.commit);
        const problems = verifyAgainstUpstream(reader, lock, path.join(layout.skillsPath, record.folderName));
        if (problems.length) {
          failed = true;
          io.out('  verify: FAILED, the copy is not the upstream bytes:');
          for (const problem of problems) io.out(`  - ${problem}`);
        } else io.out(`  verify: every carried file is the upstream bytes at ${short(pinned.commit)}`);
      }
    } catch (error) {
      if (!(error instanceof AdaptError)) throw error;
      io.out(`  unknown: ${error.message}. Unknown is not current.`);
      attention = true;
    } finally {
      if (scratch.dir) rmSync(scratch.dir, { recursive: true, force: true });
    }
  }
  return failed ? EXIT_FAILED : attention ? EXIT_ATTENTION : EXIT_OK;
}

/** `outdated --verify`: the copy's base files, text and licence against the pinned upstream commit. */
function verifyAgainstUpstream(reader, lock, folder) {
  const problems = [];
  const pinned = lock.base;
  if (!reader.commitOf(pinned.commit)) return [`the source has no commit ${pinned.commit}`];
  const tree = reader.treeAt(pinned.commit, `skills/${pinned.skill}`);
  if (tree !== pinned.tree) problems.push(`skills/${pinned.skill} at ${short(pinned.commit)} is tree ${short(tree)}, and the lock records ${short(pinned.tree)}`);
  const upstream = readBase(reader, { ...pinned });
  const generated = readGenerated(folder).files;
  for (const [file, hash] of Object.entries(upstream.hashes)) if (pinned.files?.[file] !== hash) problems.push(`the lock records another hash for ${file}`);
  for (const file of Object.keys(pinned.files ?? {})) if (!(file in upstream.hashes)) problems.push(`the lock lists ${file}, which upstream does not have`);
  for (const [file, content] of upstream.carried) {
    if (!generated.get(file)?.bytes.equals(content.bytes)) problems.push(`${file} differs from upstream`);
  }
  if (pinned.entry === 'SKILL.md') {
    const segment = extractSegment(utf8(generated.get('SKILL.md')?.bytes ?? ''));
    const expected = upstream.entryText.endsWith('\n') ? upstream.entryText : `${upstream.entryText}\n`;
    if (segment !== expected) problems.push('the text between the base markers in SKILL.md differs from upstream SKILL.md');
  }
  if (upstream.license && !generated.get('LICENSE')?.bytes.equals(upstream.license)) problems.push('LICENSE differs from upstream');
  return problems;
}

// ---------------------------------------------------------------------------------------------
// command line

const USAGE = `Usage: adapt.mjs <compose|check|outdated> [options]

  compose   compose each adapted skill from its pinned pack skill and the project overlay;
            prints the change and writes nothing without --write
  check     offline and read-only: the generated folders are exactly what composing gives
  outdated  online and read-only: newer tags, changed trees and moved tags

Options:
  --repo <dir>             the project (default: the current directory)
  --adapter <name>         one adapter folder instead of all of them
  --pack <dir>             compose from a local clone of the pack instead of fetching
  --write                  compose: write the generated folders and vendor the composer
  --discard-hand-edits     compose: overwrite a generated folder that was edited by hand
  --verify                 outdated: also compare every carried file with the upstream bytes
  --adapters-dir <dir>     default ${DEFAULT_ADAPTERS_DIR}
  --skills-dir <dir>       default ${DEFAULT_SKILLS_DIR}`;

export function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = { command, repo: '.', adapter: null, pack: null, write: false, discardHandEdits: false, verify: false, adaptersDir: DEFAULT_ADAPTERS_DIR, skillsDir: DEFAULT_SKILLS_DIR, help: false };
  if (command === '--help' || command === '-h' || command === 'help') return { ...options, help: true };
  if (!['compose', 'check', 'outdated'].includes(command)) throw new AdaptError(command ? `unknown command: ${command}` : 'name a command');
  const valued = { '--repo': 'repo', '--adapter': 'adapter', '--pack': 'pack', '--adapters-dir': 'adaptersDir', '--skills-dir': 'skillsDir' };
  const flags = { '--write': 'write', '--discard-hand-edits': 'discardHandEdits', '--verify': 'verify' };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (valued[argument]) {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith('--')) throw new AdaptError(`${argument} needs a value`);
      options[valued[argument]] = value;
      index += 1;
    } else if (flags[argument]) options[flags[argument]] = true;
    else throw new AdaptError(`unknown argument: ${argument}`);
  }
  if (options.write && command !== 'compose') throw new AdaptError('--write is for compose; check and outdated only read');
  if (options.discardHandEdits && command !== 'compose') throw new AdaptError('--discard-hand-edits is for compose');
  if (options.verify && command !== 'outdated') throw new AdaptError('--verify is for outdated');
  if (options.pack && command !== 'compose') throw new AdaptError('--pack is for compose; check reads no pack, and outdated reads the source itself');
  return options;
}

export async function main(argv = process.argv.slice(2), context = {}) {
  const stdout = context.stdout ?? process.stdout;
  const stderr = context.stderr ?? process.stderr;
  const io = { out: (line) => stdout.write(`${line}\n`) };
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    stderr.write(`${error.message}\n${USAGE}\n`);
    return EXIT_FAILED;
  }
  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return EXIT_OK;
  }
  try {
    if (options.command === 'compose') return runCompose(options, io);
    if (options.command === 'check') return runCheck(options, io);
    return runOutdated(options, io);
  } catch (error) {
    if (!(error instanceof AdaptError)) throw error;
    stderr.write(`${error.message}\n`);
    return EXIT_FAILED;
  }
}

if (isEntrypoint(import.meta.url)) {
  process.exitCode = await main();
}
