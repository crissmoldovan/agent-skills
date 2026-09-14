#!/usr/bin/env node
/**
 * WHERE A SKILL FITS, AS EVIDENCE A SCRIPT CAN EVALUATE.
 *
 * Every skill in this pack carries `references/fit.json`. This module loads those files and
 * evaluates them against one repository, producing three things per skill: whether it matched,
 * the human-readable evidence for the match, and the stable ids of the signals that were true.
 * The ids are what the fingerprint is built from, which is why they are strings a later run can
 * reproduce exactly rather than objects whose key order could vary.
 *
 * TWO SIGNAL FAMILIES, AND ONLY ONE OF THEM IS CHEAP. A `repo` signal reads files in the
 * repository and is safe to evaluate at session start. A `history` signal counts things in this
 * repository's own session history, which can run to tens of megabytes, so its counts are passed
 * IN by the caller and never gathered here. When the caller has no counts, a history signal is
 * UNKNOWN — never false. A machine that has never opened this repository must not cause a skill
 * to be dropped for lack of evidence it could not have.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/** The only three kinds. `signals` is evaluated; `general` fits nearly any repository and forms a
 *  small default set; `requestOnly` is never recommended by a scan. */
export const FIT_KINDS = Object.freeze(['signals', 'general', 'requestOnly']);

/** The counts a `history` signal may name. Anything else is an unreadable signal, not a false one. */
export const HISTORY_COUNTS = Object.freeze([
  'agentDispatches',
  'workflowLaunches',
  'backgroundCommands',
  'releaseCommands',
  'writesOutsideRepo',
]);

/** Directories a scan has no business walking: generated, vendored, or somebody else's. */
const SKIPPED = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'dist', 'build', 'out', 'target', 'vendor',
  'coverage', '.next', '.nuxt', '.turbo', '.venv', 'venv', '__pycache__', '.cache',
  '.gradle', '.idea', '.terraform', 'Pods', 'DerivedData',
]);

/** Bounds. A scan runs on somebody's laptop while they wait, and a repository can be enormous. */
const MAX_FILES = 20000;
const MAX_DEPTH = 12;
const MAX_GREP_FILES = 400;
const MAX_GREP_BYTES = 512 * 1024;

const indexCache = new Map();

/**
 * Every file in the repository, as repository-relative POSIX paths, plus the directories, so a
 * signal can ask for `.changeset/` without a file inside it. Cached per root: one scan asks many
 * questions of the same tree.
 */
export function repoIndex(repoRoot) {
  const root = resolve(repoRoot);
  const cached = indexCache.get(root);
  if (cached) return cached;
  const files = [];
  const directories = [];
  let truncated = false;
  const walk = (directory, depth) => {
    if (truncated || depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return; // unreadable: not a reason to fail a scan
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && SKIPPED.has(entry.name)) continue;
      if (SKIPPED.has(entry.name)) continue;
      const full = join(directory, entry.name);
      const rel = relative(root, full).split(sep).join('/');
      if (entry.isDirectory()) {
        directories.push(rel);
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        if (files.length >= MAX_FILES) {
          truncated = true;
          return;
        }
        files.push(rel);
      }
    }
  };
  walk(root, 0);
  const index = { root, files, directories, truncated };
  indexCache.set(root, index);
  return index;
}

/** Forget a cached tree. Tests write into a repository and scan it again. */
export function forgetRepoIndex(repoRoot) {
  indexCache.delete(resolve(repoRoot));
}

/**
 * `*` stays inside one path segment, `**` crosses them, and a trailing `/` means "this directory".
 * Deliberately small: a fit signal is a question about a repository's shape, not a shell.
 */
export function matchesGlob(path, pattern) {
  if (pattern.endsWith('/')) {
    const directory = pattern.slice(0, -1);
    return path === directory || path.startsWith(`${directory}/`);
  }
  const expression = pattern
    .split('')
    .reduce((accumulator, character, position, all) => {
      if (character === '*' && all[position - 1] === '*') return accumulator; // handled below
      if (character === '*' && all[position + 1] === '*') {
        // `**/` swallows the slash so that `**/*.ts` also matches a file at the root.
        return accumulator + (all[position + 2] === '/' ? '(?:[^/]*/)*' : '.*');
      }
      if (character === '*') return `${accumulator}[^/]*`;
      if (character === '?') return `${accumulator}[^/]`;
      if (character === '/' && all[position - 1] === '*' && all[position - 2] === '*') return accumulator;
      return accumulator + character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }, '');
  return new RegExp(`^${expression}$`).test(path);
}

/** A dotted path into a parsed object. Returns `undefined` for anything absent. */
function dotted(value, field) {
  return field.split('.').reduce((current, key) => (current === undefined || current === null ? undefined : current[key]), value);
}

/**
 * A field out of a manifest, by format. JSON is parsed properly; TOML and YAML are read SHALLOWLY
 * — enough for `[package] version = "..."` and two levels of indented YAML keys, which is what fit
 * signals ask for. A fit signal that needs a real parser is a fit signal asking too much.
 */
export function readManifestField(repoRoot, format, file, field) {
  const path = join(resolve(repoRoot), file);
  if (!existsSync(path)) return undefined;
  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  if (format === 'json') {
    try {
      return dotted(JSON.parse(source), field);
    } catch {
      return undefined;
    }
  }
  if (format === 'toml') return tomlField(source, field);
  if (format === 'yaml') return yamlField(source, field);
  return undefined;
}

/** `[section]` headers plus `key = value`, which is the whole of what a fit signal asks a TOML. */
function tomlField(source, field) {
  const parts = field.split('.');
  const key = parts.pop();
  const section = parts.join('.');
  let current = '';
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#') || line === '') continue;
    const header = line.match(/^\[\[?([^\]]+)\]\]?$/);
    if (header) {
      current = header[1].trim();
      continue;
    }
    if (current !== section) continue;
    const pair = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/);
    if (pair && pair[1] === key) return pair[2].replace(/^['"]|['"]$/g, '').trim() || undefined;
  }
  return undefined;
}

/** Top-level and one-level-nested `key: value`, by indentation. Lists and anchors are not read. */
function yamlField(source, field) {
  const parts = field.split('.');
  let depth = 0;
  let expected = parts[depth];
  for (const raw of source.split('\n')) {
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    const pair = raw.trim().match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!pair) continue;
    if (indent !== depth * 2) {
      if (indent < depth * 2) return undefined; // left the subtree without finding it
      continue;
    }
    if (pair[1] !== expected) continue;
    if (depth === parts.length - 1) {
      const value = pair[2].replace(/^['"]|['"]$/g, '').trim();
      return value === '' ? undefined : value;
    }
    depth += 1;
    expected = parts[depth];
  }
  return undefined;
}

/** The stable id of one signal. The fingerprint is built from these, so the shape is frozen. */
export function signalId(signal) {
  if (signal?.repo?.exists) return `exists:${signal.repo.exists}`;
  if (signal?.repo?.missing) return `missing:${signal.repo.missing}`;
  for (const format of ['json', 'toml', 'yaml']) {
    if (signal?.repo?.[format]) return `${format}:${signal.repo[format]}#${signal.repo.field ?? ''}`;
  }
  if (signal?.repo?.grep) return `grep:${signal.repo.grep}@${(signal.repo.globs ?? []).join(',')}`;
  if (signal?.history?.count) return `history:${signal.history.count}>=${signal.history.atLeast ?? 1}`;
  return 'unreadable';
}

/** One signal against one repository. `null` means unknown — history with no counts to read. */
function evaluateSignal(signal, repoRoot, counts) {
  if (signal?.repo?.exists) {
    const pattern = signal.repo.exists;
    const index = repoIndex(repoRoot);
    const pool = pattern.endsWith('/') ? [...index.directories, ...index.files] : index.files;
    const hit = pool.find((path) => matchesGlob(path, pattern));
    return hit ? { true: true, evidence: `${hit} is present` } : { true: false };
  }
  if (signal?.repo?.missing) {
    // The absence of a file is evidence too, and it is the signal that matters most for the
    // skills whose whole job is the thing nobody has written yet: a repository with no README,
    // no agent context file. Kept deliberately narrow — a missing path, never a missing glob —
    // because "nothing matched this pattern" is a much weaker claim than "this file is not here".
    const pattern = signal.repo.missing;
    const index = repoIndex(repoRoot);
    const present = [...index.files, ...index.directories].some((path) => path === pattern.replace(/\/$/, ''));
    return present ? { true: false } : { true: true, evidence: `${pattern} is not in this repository` };
  }
  for (const format of ['json', 'toml', 'yaml']) {
    if (!signal?.repo?.[format]) continue;
    const file = signal.repo[format];
    const field = signal.repo.field ?? '';
    const value = readManifestField(repoRoot, format, file, field);
    return value === undefined || value === null || value === false
      ? { true: false }
      : { true: true, evidence: `${file} has a ${field.split('.').pop()}` };
  }
  if (signal?.repo?.grep) {
    const globs = signal.repo.globs ?? ['**/*'];
    const index = repoIndex(repoRoot);
    const candidates = index.files.filter((path) => globs.some((glob) => matchesGlob(path, glob))).slice(0, MAX_GREP_FILES);
    let expression;
    try {
      expression = new RegExp(signal.repo.grep);
    } catch {
      return { true: false }; // an unreadable pattern is not evidence of anything
    }
    let hits = 0;
    for (const path of candidates) {
      let source;
      try {
        const full = join(resolve(repoRoot), path);
        if (statSync(full).size > MAX_GREP_BYTES) continue;
        source = readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      if (expression.test(source)) hits += 1;
    }
    return hits > 0
      ? { true: true, evidence: `${signal.repo.grep} appears in ${hits} file${hits === 1 ? '' : 's'} under ${globs.join(', ')}` }
      : { true: false };
  }
  if (signal?.history?.count) {
    const name = signal.history.count;
    const atLeast = Number(signal.history.atLeast ?? 1);
    if (!counts || counts.known !== true || !HISTORY_COUNTS.includes(name)) return { unknown: true };
    const value = Number(counts[name] ?? 0);
    return value >= atLeast
      ? { true: true, evidence: `${value} ${humanCount(name)} in this repository's history (needs ${atLeast})` }
      : { true: false };
  }
  return { true: false };
}

function humanCount(name) {
  return {
    agentDispatches: 'agent dispatches',
    workflowLaunches: 'workflow launches',
    backgroundCommands: 'background commands',
    releaseCommands: 'release commands',
    writesOutsideRepo: 'writes outside this repository',
  }[name] ?? name;
}

/**
 * One skill's fit against one repository.
 *
 * Returns `matched`, the evidence for every signal that was true, the ids of those signals (the
 * fingerprint's input), and the ids of the signals that could not be read at all. `allOf` needs
 * every signal true; `anyOf` needs one. An unknown signal never makes a match and never breaks
 * one: it is reported so the caller can say "unknown" rather than "no".
 */
export function evaluateRepoSignals(fit, repoRoot, { counts = null } = {}) {
  const empty = { matched: false, evidence: [], trueSignals: [], unknownSignals: [] };
  if (!fit || fit.kind !== 'signals') return empty;
  const mode = Array.isArray(fit.allOf) ? 'allOf' : 'anyOf';
  const list = Array.isArray(fit[mode]) ? fit[mode] : [];
  if (list.length === 0) return empty;

  const evidence = [];
  const trueSignals = [];
  const unknownSignals = [];
  let falses = 0;
  for (const signal of list) {
    const result = evaluateSignal(signal, repoRoot, counts);
    if (result.unknown) {
      unknownSignals.push(signalId(signal));
      continue;
    }
    if (result.true) {
      trueSignals.push(signalId(signal));
      if (result.evidence) evidence.push(result.evidence);
    } else {
      falses += 1;
    }
  }
  const matched = mode === 'anyOf'
    ? trueSignals.length > 0
    : falses === 0 && unknownSignals.length === 0 && trueSignals.length === list.length;
  return { matched, evidence, trueSignals, unknownSignals };
}

/** Every `skills/<name>/references/fit.json` in a pack checkout, by skill name. */
export function loadCatalogue(packRoot) {
  const skillsRoot = join(resolve(packRoot), 'skills');
  const catalogue = new Map();
  let entries;
  try {
    entries = readdirSync(skillsRoot, { withFileTypes: true });
  } catch {
    return catalogue;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(skillsRoot, entry.name, 'references', 'fit.json');
    if (!existsSync(path)) continue;
    try {
      const fit = JSON.parse(readFileSync(path, 'utf8'));
      catalogue.set(entry.name, { name: entry.name, ...fit });
    } catch {
      // An unparseable fit.json is a verify-skills failure, not a reason to abandon a scan.
    }
  }
  return catalogue;
}
