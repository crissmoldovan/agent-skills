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
// refuses an addition to a hard line, or any paragraph of the overlay that names one, that carries
// them. A word is bounded by what is not a letter or digit, as a reader bounds one: `\b` takes an
// underscore for part of a word, so `_except_` (emphasis) would pass it. A phrase may wrap.
const RELAXING = /(?<![A-Za-z0-9])(?:unless|except(?:ion|ions)?|exempt(?:s|ed|ion)?|waive[sd]?|need\s+not|needn['’]t|do(?:es)?\s+not\s+apply|(?:doesn|don)['’]t\s+apply|no\s+longer|not\s+required|may\s+skip|can\s+skip|(?:is|are)\s+optional|overrid(?:e|es|den)|relax(?:es|ed)?|(?:is|are)\s+lifted)(?![A-Za-z0-9])/i;

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

/**
 * git's own message for a remote call that failed, and, when git refused a transport, the cause:
 * a `url.<base>.insteadOf` setting, often an ssh rewrite of every GitHub address, has turned the
 * https source into one the composer does not allow.
 */
export function remoteFailure(stderr, fallback) {
  const message = stderr || fallback;
  const refused = message.match(/transport '([^']+)' not allowed/);
  if (!refused) return message;
  return `${message.replace(/\.+$/, '')}. A git setting (url.<base>.insteadOf) rewrites the https address to ${refused[1]}, and the composer reads a remote over https only: run it with that setting left out (for one in the global configuration, GIT_CONFIG_GLOBAL naming an empty file), or compose from a clone of the pack with --pack`;
}

/** `<tag> -> <commit>` for every tag the source has, peeled to the commit an annotated tag names. */
export function listRemoteTags(source) {
  const result = runGit(['ls-remote', '--tags', source], { timeout: 60_000 });
  if (result.status !== 0) throw new AdaptError(`cannot list the tags of ${source}: ${remoteFailure(result.stderr, 'git ls-remote failed')}`);
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
  if (result.status !== 0) throw new AdaptError(`cannot read ${source}: ${remoteFailure(result.stderr, 'git ls-remote failed')}`);
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
    if (fetch.status !== 0) throw new AdaptError(`cannot fetch ${base.ref} from ${sourceLabel(base.source)}: ${remoteFailure(fetch.stderr, 'git fetch failed')}`);
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

// Declarations are read exactly as the pack's verifier reads them, so the composer sees exactly
// the ids the verifier saw.
const DECLARED_FENCE_OPEN = /^\s*(`{3,}|~{3,})/;
const DECLARED_FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;

/**
 * Lines with every fenced block blanked, so line numbers still match, as the pack's verifier reads
 * declarations: a fence opens at a line that starts, at any indent, with three or more backticks or
 * tildes, closes at the next bare line of at least as many of the same character at any indent, and
 * one that never closes runs to the end of the text.
 */
function unfencedLines(text) {
  let fence = null;
  return text.split('\n').map((line) => {
    if (fence === null) {
      const open = line.match(DECLARED_FENCE_OPEN);
      if (!open) return line;
      fence = open[1];
      return '';
    }
    const close = line.match(DECLARED_FENCE_CLOSE);
    if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
    return '';
  });
}

// The overlay reads its fences closer to CommonMark, and holds each to the addition or section it
// opens in, because a fence left open there would hide the headings after it, and with them every
// check they face. Links are read everywhere, fenced or not, as the verifier reads a skill's files.

/** The column a run of spaces and tabs reaches from `from`, a tab moving to the next multiple of four. */
function column(whitespace, from = 0) {
  let at = from;
  for (const character of whitespace) at = character === '\t' ? at + 4 - (at % 4) : at + 1;
  return at;
}

const FENCE_OPENER = /^([ \t]*(?:(?:[-+*]|\d{1,9}[.)])[ \t]+)*)(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSER = /^([ \t]*)(`{3,}|~{3,})[ \t]*\r?$/;
const OPENER_LEAD = /[ \t]+|[-+*]|\d{1,9}[.)]/g;

/**
 * The fence a line opens, if any: three or more backticks or tildes after spaces and tabs, or after
 * list markers, as `- ```bash` and `1. ```bash` open one in a list item. Its indent is the column
 * the fence starts at, a marker counting its own width; a non-breaking space is not indentation.
 * A backtick fence whose info string holds a backtick is a code span, and more than four columns
 * after a marker make indented code, so neither opens a fence.
 */
function fenceOpener(line) {
  const match = line.match(FENCE_OPENER);
  if (!match) return null;
  const [, lead, fence, info] = match;
  if (fence[0] === '`' && info.includes('`')) return null;
  let at = 0;
  let afterMarker = false;
  for (const [part] of lead.matchAll(OPENER_LEAD)) {
    if (part[0] === ' ' || part[0] === '\t') {
      const from = at;
      at = column(part, at);
      if (afterMarker && at - from > 4) return null;
      afterMarker = false;
    } else {
      at += part.length;
      afterMarker = true;
    }
  }
  return { fence, indent: at };
}

/** A bare line of backticks or tildes, which may close a fence: its fence and the column it starts at. */
function fenceCloser(line) {
  const match = line.match(FENCE_CLOSER);
  return match ? { fence: match[2], indent: column(match[1]) } : null;
}

const isBlank = (line) => /^[ \t]*\r?$/.test(line);

/** Numbers by position, asking for the first position at or after one whose number is at most a bound. */
class FirstAtMost {
  constructor(values) {
    let size = 1;
    while (size < values.length) size *= 2;
    this.size = size;
    this.least = new Float64Array(2 * size).fill(Infinity);
    this.least.set(values, size);
    for (let node = size - 1; node >= 1; node -= 1) this.least[node] = Math.min(this.least[2 * node], this.least[2 * node + 1]);
  }

  set(position, value) {
    let node = position + this.size;
    this.least[node] = value;
    for (node >>= 1; node >= 1; node >>= 1) this.least[node] = Math.min(this.least[2 * node], this.least[2 * node + 1]);
  }

  /** The first position at or after `from` holding at most `most`, else -1. */
  first(from, most, node = 1, low = 0, high = this.size) {
    if (high <= from || this.least[node] > most) return -1;
    if (high - low === 1) return low;
    const middle = (low + high) >> 1;
    const left = this.first(from, most, 2 * node, low, middle);
    return left !== -1 ? left : this.first(from, most, 2 * node + 1, middle, high);
  }
}

/**
 * For each line, the fence it opens; for each such fence, its closing line, the first bare line
 * after it of at least as many of the same character indented at most three columns more than the
 * fence (`close`), and the first line after it that is not blank and is indented less than it
 * (`shallower`). Each answer is read from a tree in O(log n), the openers longest fence first so
 * that the tree holds exactly the closing lines long enough, so a text is read in O(n log n)
 * however many fence lengths and indents it holds.
 */
function fenceTable(lines) {
  const count = lines.length;
  const opens = lines.map(fenceOpener);
  const closes = lines.map(fenceCloser);
  const close = new Int32Array(count).fill(count);
  for (const character of ['`', '~']) {
    const asked = [];
    const closing = [];
    opens.forEach((open, index) => { if (open?.fence[0] === character) asked.push(index); });
    closes.forEach((line, index) => { if (line?.fence[0] === character) closing.push(index); });
    if (asked.length === 0 || closing.length === 0) continue;
    asked.sort((a, b) => opens[b].fence.length - opens[a].fence.length);
    closing.sort((a, b) => closes[b].fence.length - closes[a].fence.length);
    const tree = new FirstAtMost(new Float64Array(count).fill(Infinity));
    let added = 0;
    for (const index of asked) {
      const { fence, indent } = opens[index];
      for (; added < closing.length && closes[closing[added]].fence.length >= fence.length; added += 1) tree.set(closing[added], closes[closing[added]].indent);
      const found = tree.first(index + 1, indent + 3);
      if (found !== -1) close[index] = found;
    }
  }
  const depth = new FirstAtMost(lines.map((line) => (isBlank(line) ? Infinity : column(line.match(/^[ \t]*/)[0]))));
  const shallower = (index) => {
    const found = depth.first(index + 1, opens[index].indent - 1);
    return found === -1 ? count : found;
  };
  return { count, opens, close, shallower };
}

/**
 * The fences of an overlay, each read as if in a list item, the strictest way it could be meant: a
 * fence closes at its closing line, and also ends at the first line that is not blank and is
 * indented less than it, a closing line included, and at a line `ends` holds, when one is given. A fence that
 * ends either way, or never closes, opens nothing: its opening line is read as text, like the
 * lines after it, which are read again from the next line. Each such fence is listed in
 * `unclosed`, with the line that ended it and why. A shallower line that would have closed it is
 * the closing line its writer meant, so it is not read as opening a fence of its own.
 */
function readFences(text, { ends = null } = {}) {
  const lines = text.split('\n');
  const { count, opens, close, shallower } = fenceTable(lines);
  const meantToClose = new Set();
  const nextEnd = new Int32Array(count + 1).fill(count);
  if (ends) for (let index = count - 1; index >= 0; index -= 1) nextEnd[index] = ends(lines[index]) ? index : nextEnd[index + 1];
  const fenced = lines.map(() => false);
  const unclosed = [];
  for (let at = 0; at < count;) {
    const open = opens[at];
    if (!open || meantToClose.has(at)) {
      at += 1;
      continue;
    }
    const end = close[at];
    const under = shallower(at);
    const part = nextEnd[at + 1];
    const stop = Math.min(under, part);
    if (stop <= end) {
      const why = stop === count ? 'never closes' : stop === part ? 'ends' : 'shallower';
      const closer = why === 'shallower' ? fenceCloser(lines[stop]) : null;
      const closes = closer?.fence[0] === open.fence[0] && closer.fence.length >= open.fence.length;
      if (closes) meantToClose.add(stop);
      unclosed.push({ line: at, fence: open.fence, at: stop, why: closes ? 'closes shallower' : why });
      at += 1;
      continue;
    }
    fenced.fill(true, at, end + 1);
    at = end + 1;
  }
  return { fenced, unclosed };
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
 * Whether a line, read on its own, opens a part of an overlay: a section an overlay has, or an
 * addition, a `### ` heading whose first word is an id. A fence open across one ends there. A
 * `### ` heading indented one to three spaces counts, since Markdown reads it as a heading too:
 * where the composer's fences and CommonMark's differ, as in an HTML comment or an ordered list
 * item that cannot interrupt a paragraph, a fence the composer reads could otherwise hide a
 * heading the copy shows.
 */
function opensOverlayPart(line) {
  if (/^ {0,3}####/.test(line)) return false;
  const addition = line.match(/^ {0,3}###\s+(\S+)/);
  if (addition) return ID.test(addition[1].replace(/[.:,;]$/, ''));
  const section = line.match(/^##\s+(.+?)\s*$/);
  return Boolean(section) && OVERLAY_SECTIONS.has(section[1].toLowerCase());
}

/**
 * The overlay in its three parts: `## Bindings` (a two-column `| id | value |` table), `## Additions`
 * (one `### <id>` heading per step or hard line it adds to), and `## Project traps`. Anything
 * else would be dropped from the copy without a word, so it is refused instead.
 *
 * Fences are read as in a list item, the strictest way they could be meant, and a fence closes
 * inside the addition or the section it opens in. One that does not would swallow every heading
 * after it until something closed it, and with them every check those headings face, so it is
 * refused, and read as text so that what follows is still read: a line that opens another part of
 * the overlay ends it.
 *
 * An addition's heading starts at the left margin. Markdown also reads a `### ` line indented one
 * to three spaces as a heading, so one whose first word is an id would show the lines after it as
 * an addition to that id, which the checks read as part of what comes before; it is refused.
 */
export function parseOverlay(source) {
  const text = lf(source);
  const problems = [];
  const rows = text.split('\n');
  const fences = readFences(text, { ends: opensOverlayPart });
  const plain = rows.map((line, index) => (fences.fenced[index] ? '' : line));
  plain.forEach((line, index) => {
    const indented = line.match(/^ {1,3}###[ \t]+(\S+)/);
    const id = indented?.[1].replace(/[.:,;]$/, '');
    // A hard line's heading is shown only in the addition to it (check 5), so indenting it further
    // is no remedy for one.
    const remedy = id?.startsWith('H') ? `start it at the left margin to add to ${id}; a heading for a hard line is shown only in the addition to it` : `start it at the left margin to add to ${id}, or indent it four spaces to show it as an example`;
    if (id && ID.test(id)) problems.push(`overlay line ${index + 1}: "### ${id}" is indented, and Markdown still reads it as a heading: the copy would show the lines after it as an addition to ${id}, which the checks read as part of what comes before; ${remedy}`);
  });
  // Where each line sits, so a fence that does not close can be named by where it opened.
  const where = new Map();
  const sections = new Map();
  let current = null;
  plain.forEach((line, index) => {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading && !line.startsWith('###')) {
      const key = heading[1].toLowerCase();
      if (!OVERLAY_SECTIONS.has(key)) {
        problems.push(`overlay line ${index + 1}: unknown section "## ${heading[1]}" — an overlay has ## Bindings, ## Additions and ## Project traps, and nothing else reaches the copy`);
        // Its body is already refused with the heading, so it is not reported line by line.
        current = { key: null, name: heading[1], start: index + 1, lines: [] };
        return;
      }
      if (sections.has(key)) problems.push(`overlay line ${index + 1}: ## ${OVERLAY_SECTIONS.get(key)} appears twice`);
      current = { key, name: OVERLAY_SECTIONS.get(key), start: index + 1, lines: [] };
      sections.set(key, current);
      return;
    }
    if (current) {
      current.lines.push(index);
      where.set(index, `under ## ${current.name}`);
    } else if (rows[index].trim() !== '' && !/^#\s/.test(rows[index]) && !/^\s*<!--.*-->\s*$/.test(rows[index])) {
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
        open = { id, heading: rows[index], line: index + 1, last: index + 1, lines: [] };
        additions.push(open);
        continue;
      }
      if (open) {
        open.lines.push(rows[index]);
        open.last = index + 1;
        where.set(index, `in the addition to ${open.id}`);
      } else if (rows[index].trim() !== '') problems.push(`overlay line ${index + 1}: text under ## Additions sits under a ### <id> heading`);
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

  // A fence left open explains what else is refused around it, so it is named first.
  problems.unshift(...fences.unclosed.map((fence) => {
    let why = 'it never closes';
    if (fence.why === 'ends') why = `line ${fence.at + 1} opens ${rows[fence.at].trim()} first`;
    else if (fence.why === 'shallower') why = `line ${fence.at + 1} is indented less than the fence, which ends it`;
    else if (fence.why === 'closes shallower') why = `line ${fence.at + 1} would close it, but is indented less than the fence, which in a list item ends the fence instead`;
    let example = '';
    if (fence.why === 'ends') {
      const id = rows[fence.at].match(/^ {0,3}###\s+(\S+)/)?.[1].replace(/[.:,;]$/, '');
      example = id?.startsWith('H') ? `; a heading for ${id}, a hard line, is shown only in the addition to ${id} (check 5)` : '; to show such a heading in an example, indent the fence and its lines four spaces';
    }
    return `overlay line ${fence.line + 1}: the fence opened ${where.get(fence.line) ?? 'before the first section'} does not close there (${why}); close it with a bare line of at least ${fence.fence.length} ${fence.fence[0] === '`' ? 'backticks' : 'tildes'}, indented as far as the fence, or it hides the headings after it from the checks${example}`;
  }));

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

// How check 5 reads an id and the words of an exception: as a reader sees the text, not as it is
// typed. A numeric character reference is decoded, and a named one that shows nothing (a soft
// hyphen, a zero-width space) is dropped, any other read as a space; a compatibility form (a
// full-width letter, a superscript digit) folds to what it shows; and a format character, which
// shows nothing, is dropped. Emphasis, strikethrough, inline HTML and comments are read both ways
// they can join what they split: removed, so `H<b></b>1` and `H*1*` read H1, and as a space, so
// `H1<br>is lifted` keeps H1 a word of its own.
const INVISIBLE_REFERENCES = new Set([
  'shy', 'zwnj', 'zwj', 'lrm', 'rlm', 'ZeroWidthSpace', 'NegativeVeryThinSpace', 'NegativeThinSpace', 'NegativeMediumSpace',
  'NegativeThickSpace', 'NoBreak', 'ApplyFunction', 'af', 'InvisibleTimes', 'it', 'InvisibleComma', 'ic',
]);
const HTML_TAG = /<\/?[A-Za-z][A-Za-z0-9-]*(?:[\s/][^<>]*)?>/g;

function decodeReferences(text) {
  return text
    .replace(/&#(?:([0-9]{1,7})|[xX]([0-9A-Fa-f]{1,6}));/g, (whole, decimal, hex) => {
      const code = decimal === undefined ? Number.parseInt(hex, 16) : Number(decimal);
      return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : '�';
    })
    .replace(/&([A-Za-z][A-Za-z0-9]{0,31});/g, (whole, name) => (INVISIBLE_REFERENCES.has(name) ? '' : ' '));
}

/** A text with every HTML comment and tag in it replaced by `by`, read once from left to right. */
function withoutMarkup(text, by) {
  const parts = [];
  let at = 0;
  for (let open = text.indexOf('<!--'); open !== -1; open = text.indexOf('<!--', at)) {
    const close = text.indexOf('-->', open + 4);
    if (close === -1) break;
    parts.push(text.slice(at, open), by);
    at = close + 3;
  }
  parts.push(text.slice(at));
  return parts.join('').replace(HTML_TAG, by);
}

/** The two readings of a text that check 5 matches an id and an exception in. */
function readings(text) {
  const shown = decodeReferences(text).normalize('NFKC').replace(/\p{Cf}/gu, '');
  return [withoutMarkup(shown, '').replace(/[*_~]/g, ''), withoutMarkup(shown, ' ').replace(/[*_~]/g, ' ')];
}

// An id as a reader finds one: not run on from a letter or digit on either side. An underscore is
// no part of it, so `_H1_` (emphasis) names H1, which `\b` would not see.
const ID_MATCHERS = new Map();
function idMatcher(id) {
  if (!ID_MATCHERS.has(id)) ID_MATCHERS.set(id, new RegExp(`(?<![A-Za-z0-9])${id}(?![0-9A-Za-z])`));
  return ID_MATCHERS.get(id);
}
const namesIn = (read, id) => read.some((reading) => idMatcher(id).test(reading));
// A sentence that opens with the words of an exception (`Except the weekly digest.`) makes one to
// the sentence before it.
const EXCEPTION_OPENING = new RegExp(`^[^A-Za-z0-9]*${RELAXING.source}`, 'i');
function relaxingIn(read) {
  for (const reading of read) {
    const word = reading.match(RELAXING);
    if (word) return word;
  }
  return null;
}

// What reads as a heading in an overlay, for check 5, read on every line, fenced or not, and at any
// indent: a fence the composer reads as code may not be one, a line indented four columns may sit in
// a list item, and a heading the check skipped would be checked by nothing.
const CONTAINER_MARKER = /^(?:>|[-+*](?=[ \t]|$)|\d{1,9}[.)](?=[ \t]|$))/;
const ATX_HEADING = /^#{1,6}(?:[ \t]|$)/;
const SETEXT_UNDERLINE = /^(?:=+|-+)[ \t]*$/;
const BOLD_ONLY = /^(?:(\*\*|__)(?=\S)(.*?\S)\1|<(b|strong)(?:\s[^<>]*)?>(.*?)<\/\3\s*>)[ \t]*(?:[.:][ \t]*)?$/i;
const BOLD_PARAGRAPH = /^(?:(\*\*|__)(?=\S)([\s\S]*?\S)\1|<(b|strong)(?:\s[^<>]*)?>([\s\S]*?)<\/\3\s*>)\s*(?:[.:]\s*)?$/i;
const HTML_HEADING = /<h([1-6])(?=[\s>/])[^<>]*>([\s\S]*?)(?:<\/h\1\s*>|$)/gi;
// A line that opens with bold, as a skill declares a hard line (`- **H1. Contacts nobody.**`), and
// the id a reading of it opens with.
const LEAD_IN = /^(?:[*_~]*(?:\*\*|__)|<(?:b|strong)(?=[\s/>]))/i;
const LEAD_ID = /^[^A-Za-z0-9]*([A-Z][1-9][0-9]*)(?![0-9A-Za-z])/;

/** A line without the quote and list markers it opens with, and whether one of them opens a list item. */
function inContainer(line) {
  let rest = line.replace(/^[ \t]*/, '');
  let item = false;
  for (let marker = rest.match(CONTAINER_MARKER); marker; marker = rest.match(CONTAINER_MARKER)) {
    if (marker[0] !== '>') item = true;
    rest = rest.slice(marker[0].length).replace(/^[ \t]*/, '');
  }
  return { rest, item };
}

/**
 * Every part of a text that reads as a heading, in any shape Markdown gives one: a `#` heading at
 * any level, after any quote or list markers; a paragraph underlined with `=` or `-`; a line, or a
 * paragraph, that is only bold; and an HTML `<h1>` to `<h6>`, its opening tag and its text over as
 * many lines as they take. Each gives its first line and its last (1-based), the first line as
 * written, and its text. Indentation is not read: four columns in, a heading may be code, or may sit
 * in a list item. Each line is read once, and each paragraph once more, so a text is read in O(n).
 */
export function headingsIn(text) {
  const lines = text.split('\n');
  const found = new Map();
  const add = (first, last, words) => {
    if (!found.has(first)) found.set(first, { line: first + 1, last: last + 1, shown: lines[first].trim(), text: words });
  };
  let paragraph = -1;
  const endParagraph = (end) => {
    if (paragraph !== -1 && end - paragraph > 1) {
      const bold = lines.slice(paragraph, end).map((row) => inContainer(row).rest).join('\n').match(BOLD_PARAGRAPH);
      if (bold) add(paragraph, end - 1, bold[2] ?? bold[4]);
    }
    paragraph = -1;
  };
  lines.forEach((line, index) => {
    const { rest } = inContainer(line);
    if (rest === '') {
      endParagraph(index);
      return;
    }
    if (ATX_HEADING.test(rest)) {
      endParagraph(index);
      add(index, index, rest.replace(/^#+/, '').replace(/[ \t]#+[ \t]*$/, ''));
      return;
    }
    if (paragraph !== -1 && SETEXT_UNDERLINE.test(rest)) {
      add(paragraph, index, lines.slice(paragraph, index).map((row) => inContainer(row).rest).join('\n'));
      paragraph = -1;
      return;
    }
    const bold = rest.match(BOLD_ONLY);
    if (bold) add(index, index, bold[2] ?? bold[4]);
    if (paragraph === -1) paragraph = index;
  });
  endParagraph(lines.length);
  let line = 0;
  let at = 0;
  for (const match of text.matchAll(HTML_HEADING)) {
    for (; at < match.index; at += 1) if (text[at] === '\n') line += 1;
    const first = line;
    let last = line;
    for (let end = at; end < match.index + match[0].length; end += 1) if (text[end] === '\n') last += 1;
    add(first, Math.max(first, last - (match[0].endsWith('\n') ? 1 : 0)), match[2]);
  }
  return [...found.values()].sort((a, b) => a.line - b.line);
}

/**
 * A text a block at a time, as check 5 reads the words of an exception: a paragraph, and a heading,
 * a list item or a table row on its own. Each gives its first line and its last (1-based) and its
 * lines.
 */
function blocksIn(text) {
  const lines = text.split('\n');
  const blocks = [];
  let start = -1;
  const close = (end) => {
    if (start !== -1) blocks.push({ first: start + 1, last: end, lines: lines.slice(start, end) });
    start = -1;
  };
  lines.forEach((line, index) => {
    const { rest, item } = inContainer(line);
    if (rest === '') {
      close(index);
      return;
    }
    const alone = ATX_HEADING.test(rest) || rest.startsWith('|');
    if (alone || item) close(index);
    if (start === -1) start = index;
    if (alone || SETEXT_UNDERLINE.test(rest)) close(index + 1);
  });
  close(lines.length);
  return blocks;
}

// A sentence ends at a full stop, a question mark or an exclamation mark, after any closing quote,
// bracket or parenthesis, where white space follows. One inside emphasis, as in a lead-in written
// `**H1.** In this repository`, ends none.
const SENTENCE_END = /(?<=[.!?]["'”’)\]]*)\s+/g;

/** The sentences of a block's lines, each with its text and the indexes of its first and last line. */
function sentencesIn(lines) {
  const text = lines.join('\n');
  const sentences = [];
  let line = 0;
  let lineEnd = lines[0].length;
  const lineAt = (offset) => {
    while (offset > lineEnd && line < lines.length - 1) {
      line += 1;
      lineEnd += lines[line].length + 1;
    }
    return line;
  };
  let from = 0;
  const push = (to) => {
    if (to > from) {
      const first = lineAt(from);
      sentences.push({ text: text.slice(from, to), first, last: lineAt(to) });
    }
  };
  for (const match of text.matchAll(SENTENCE_END)) {
    push(match.index);
    from = match.index + match[0].length;
  }
  push(text.length);
  return sentences;
}

function trimBlank(text) {
  const lines = text.split('\n');
  while (lines.length && lines[0].trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// links

// A link's destination as CommonMark reads one, after every `](`, whatever the brackets before it
// hold, so an image inside a link (a badge) gives both: after spaces and at most one line ending,
// with the quote markers that continue a quote (sixteen deep at most, so that a run of `>` is not
// read again for every way to split it), in angle brackets, spaces allowed, or a run with no
// space whose parentheses balance; then an optional title in quotes or parentheses, and the closing
// parenthesis. A definition is read after any quote or list markers, at any indent, its destination
// on its line or the next. The groups are what comes before the destination, the destination, and
// what comes after it, so the rewriter moves only the destination.
const LINK_GAP = String.raw`[ \t]*(?:\r?\n(?:[ \t]*>){0,16}[ \t]*)?`;
const LINK_TITLE = String.raw`"[^"\n]{0,2000}"|'[^'\n]{0,2000}'|\([^()\n]{0,2000}\)`;
const INLINE_LINK = new RegExp(String.raw`(\]\(${LINK_GAP})(<[^<>\n]*>|(?!<)(?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))+)((?:${LINK_GAP}(?:${LINK_TITLE}))?${LINK_GAP}\))`, 'g');
const LINK_DEFINITION = new RegExp(String.raw`^((?:[ \t]*(?:>|[-+*](?=[ \t])|\d{1,9}[.)](?=[ \t])))*[ \t]*\[(?:[^\[\]\\\n]|\\.){1,999}\]:${LINK_GAP})(<[^<>\n]*>|\S+)`, 'gm');

function splitTarget(target) {
  const wrapped = target.startsWith('<') && target.endsWith('>');
  const inner = wrapped ? target.slice(1, -1) : target;
  if (!inner || inner.startsWith('#') || inner.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(inner)) return null;
  const cut = inner.search(/[#?]/);
  const pathname = cut === -1 ? inner : inner.slice(0, cut);
  if (!pathname) return null;
  return { wrapped, pathname, suffix: cut === -1 ? '' : inner.slice(cut), rooted: pathname.startsWith('/') };
}

/**
 * Every link target in a Markdown text that is not a URL or an anchor: inline links, images and
 * link definitions, fenced code included, as the pack's verifier reads a skill's files. A link this
 * scan skipped would be checked by nothing, and no reading of fences by hand matches CommonMark, so
 * an example writes a path as code instead. A target written from the root (`/docs/guide.md`) is
 * read too, marked `rooted`, so check 10 can refuse it: where it lands depends on where the copy is
 * read, not on the file that holds it.
 */
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
 * holds, fenced code included, is rewritten for its new place. A link to its own skill's SKILL.md
 * is refused: that file is not carried, and the adapted SKILL.md that takes its place is not what
 * the link meant.
 */
export function rewriteEntryLinks(text, entry) {
  const from = posix.dirname(entry);
  const problems = [];
  const move = (target) => {
    const parts = splitTarget(target);
    if (!parts || parts.rooted) return target;
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

/** Check 10: every relative link in the generated folder resolves, none leaves the repository, and none is written from the root. */
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
    for (const { pathname, rooted } of relativeLinks(utf8(content.bytes))) {
      if (rooted) {
        problems.push(`${file} links to ${pathname}, a path from the root rather than from ${file}; write it relative to the file`);
        continue;
      }
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
      // The heading is read with the text: a heading can say as much as the line under it.
      const word = relaxingIn(readings(`${addition.heading}\n${addition.text}`));
      if (word) fail(5, `overlay line ${addition.line}: the addition to ${addition.id} reads as relaxing it ("${word[0]}"); a hard line is only made stricter. If the text is stricter, say so without an exception word`);
      notes.push(`For review against ${addition.id}: the overlay adds to this hard line.`);
    }
  }
  const hardLines = [...declared.lines.values()].filter((line) => line.kind === 'H');
  const inAdditionTo = (id, line) => overlay.additions.some((addition) => addition.id === id && line >= addition.line && line <= addition.last);
  // The words of an exception beside a hard line's id: on one line, in one sentence over the lines it
  // wraps across, or opening the sentence after one that names it. A paragraph, list item, table row
  // or heading in the addition to the hard line it names is the addition's to answer for, above. A
  // paragraph that names a hard line in one sentence and holds the words of an exception in another
  // is listed for review: the words may qualify something else, as in "a commentary, unless it
  // changed. Every update carries the rows (H2)."
  for (const block of blocksIn(overlay.text)) {
    const read = readings(block.lines.join('\n'));
    const word = relaxingIn(read);
    if (!word) continue;
    const ids = hardLines.map((hard) => hard.id).filter((id) => namesIn(read, id) && !inAdditionTo(id, block.first));
    if (ids.length === 0) continue;
    const lineReads = block.lines.map((line) => readings(line));
    const refused = new Set();
    const refuse = (id, named, relaxed, where) => {
      if (refused.has(id)) return;
      refused.add(id);
      const shown = relaxingIn(lineReads[relaxed])?.[0] ?? word[0];
      if (where === null) fail(5, `overlay line ${block.first + named} names ${id} and reads as relaxing it ("${shown}"); a hard line is only made stricter`);
      else fail(5, `overlay line ${block.first + named} names ${id}, and line ${block.first + relaxed} reads as relaxing it ("${shown}") ${where}; a hard line is only made stricter`);
    };
    lineReads.forEach((lineRead, index) => {
      if (relaxingIn(lineRead)) for (const id of ids) if (namesIn(lineRead, id)) refuse(id, index, index, null);
    });
    const sentences = sentencesIn(block.lines);
    const firstLine = (sentence, holds) => {
      for (let index = sentence.first; index <= sentence.last; index += 1) if (holds(lineReads[index])) return index;
      return sentence.first;
    };
    sentences.forEach((sentence, index) => {
      const sentenceRead = readings(sentence.text);
      const next = sentences[index + 1];
      const opensAnException = next !== undefined && readings(next.text).some((reading) => EXCEPTION_OPENING.test(reading));
      for (const id of ids) {
        if (!namesIn(sentenceRead, id)) continue;
        const named = firstLine(sentence, (lineRead) => namesIn(lineRead, id));
        if (relaxingIn(sentenceRead)) refuse(id, named, firstLine(sentence, relaxingIn), 'in the same sentence');
        else if (opensAnException) refuse(id, named, next.first, 'in the sentence after it');
      }
    });
    for (const id of ids) {
      if (!refused.has(id)) notes.push(`For review against ${id}: overlay lines ${block.first} to ${block.last} name it in a paragraph that holds the words of an exception ("${word[0]}").`);
    }
  }
  // A heading says what the lines under it are about, so outside the addition to a hard line, a
  // heading that names one would show text for that hard line that no check reads as an addition
  // to it. It is refused in every shape, wherever the id sits in it and at any indent, fenced or
  // not: four columns in, a heading may sit in a list item. So is a line that opens with a hard
  // line's id in bold, the form a skill declares one in.
  const reported = new Set();
  for (const heading of headingsIn(overlay.text)) {
    const read = readings(heading.text);
    for (const hard of hardLines) {
      if (!namesIn(read, hard.id) || inAdditionTo(hard.id, heading.line)) continue;
      reported.add(`${heading.line} ${hard.id}`);
      fail(5, `overlay line ${heading.line}: "${heading.shown}" reads as a heading for ${hard.id} outside the addition to ${hard.id}; the copy would show the lines under it as text for that hard line that no check reads as an addition to it. Add to ${hard.id} under ## Additions as ### ${hard.id}, or name it in a sentence`);
    }
  }
  overlay.text.split('\n').forEach((line, index) => {
    const { rest } = inContainer(line);
    if (!LEAD_IN.test(rest)) return;
    for (const id of new Set(readings(rest).map((reading) => reading.match(LEAD_ID)?.[1]))) {
      if (!id || declared.lines.get(id)?.kind !== 'H' || inAdditionTo(id, index + 1) || reported.has(`${index + 1} ${id}`)) continue;
      fail(5, `overlay line ${index + 1}: "${line.trim()}" opens with ${id} in bold, as a skill declares a hard line, outside the addition to ${id}; the copy would show it as a declaration of that hard line that no check reads as an addition to it. Add to ${id} under ## Additions as ### ${id}, or name it in a sentence`);
    }
  });
  for (const hard of hardLines) {
    const read = readings(hard.text);
    for (const id of bound.keys()) if (namesIn(read, id)) notes.push(`For review against ${hard.id}: it names ${id}, which the overlay binds.`);
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
    if (!slot.skill || !slot.defaultSkill || !adaptedHere.has(slot.defaultSkill)) continue;
    const adapters = adaptedHere.get(slot.defaultSkill);
    const listed = adapters.map((name) => `\`${name}\``).join(' and ');
    const binding = bound.get(slot.id);
    // Bound to another skill than the adapted copy is refused too: the project keeps an adapted
    // copy of this skill for this work, so a different name is a typo or a second answer.
    if (binding && binding.skill !== slot.defaultSkill) {
      if (!adapters.includes(binding.skill)) fail(4, `${slot.id} hands work to \`${slot.defaultSkill}\`, which this repository adapts as ${listed}, and the overlay binds it to \`${binding.skill}\`; bind ${slot.id} to the adapted copy`);
      continue;
    }
    if (!names.has(slot.defaultSkill)) fail(4, `${slot.id} hands work to \`${slot.defaultSkill}\`, which this repository adapts as ${listed}; bind ${slot.id} to it, or the agent is sent to the generic copy`);
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
      for (const { pathname, rooted } of relativeLinks(utf8(content.bytes))) {
        if (rooted || posix.normalize(posix.join(posix.dirname(file), pathname)) !== 'SKILL.md') continue;
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

/**
 * The tags `outdated` compares a pin with. A catalogue pin: the newest newer catalogue tag. A
 * per-skill pin: the newest newer tag of its own, and the newest catalogue tag, because a later
 * catalogue release can change the skill without a per-skill tag beside it. A sha pin: the newest
 * of each. Versions order tags only within one family, so a comparison across families, or with a
 * sha, says whether the trees differ and never which is newer.
 */
export function newerTags(tags, pinRef, skill) {
  const pinned = tagVersion(pinRef, skill);
  const newest = new Map();
  for (const tag of tags.keys()) {
    const parsed = tagVersion(tag, skill);
    if (!parsed) continue;
    if (pinned?.family === 'catalogue' && parsed.family !== 'catalogue') continue;
    if (pinned && parsed.family === pinned.family && compareVersions(parsed.version, pinned.version) <= 0) continue;
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
      if (fetched.status !== 0) throw new AdaptError(`cannot fetch ${refspec} from ${sourceLabel(pinned.source)}: ${remoteFailure(fetched.stderr, 'git fetch failed')}`);
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
      const pinFamily = tagVersion(pinned.ref, pinned.skill)?.family ?? null;
      for (const tag of newer) {
        const reader = readerFor();
        fetchRef(reader, `+refs/tags/${tag}:refs/tags/${tag}`);
        const commit = reader.commitOf(`refs/tags/${tag}`);
        const tree = commit ? reader.treeAt(commit, `skills/${pinned.skill}`) : null;
        // A version orders tags of one family only; against a sha, or across families, the trees
        // can only differ, so the line says which to read and never claims the tag is newer.
        const ordered = pinFamily !== null && tagVersion(tag, pinned.skill)?.family === pinFamily;
        if (!tree) {
          io.out(`  ${tag} exists, and skills/${pinned.skill} is gone from it: read the release notes before moving the pin`);
          attention = true;
        } else if (tree === pinned.tree) io.out(`  ${tag} exists; skills/${pinned.skill} unchanged: moving the pin is a no-op`);
        else if (ordered) {
          io.out(`  ${tag} exists; skills/${pinned.skill} changed (tree ${short(pinned.tree)} -> ${short(tree)}): read \`git diff ${pinned.ref} ${tag} -- skills/${pinned.skill}\``);
          attention = true;
        } else {
          io.out(`  ${tag} exists; skills/${pinned.skill} differs (tree ${short(pinned.tree)} -> ${short(tree)}), and ${pinFamily ? 'a per-skill tag' : 'a commit'} is not ordered against ${tag}: read \`git diff ${pinned.ref} ${tag} -- skills/${pinned.skill}\` and the release notes before moving the pin`);
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
      // git's own message runs over several lines; the verdict stays on one.
      io.out(`  unknown: ${error.message.replace(/\s*\n\s*/g, ' ').replace(/\.+$/, '')}. Unknown is not current.`);
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
