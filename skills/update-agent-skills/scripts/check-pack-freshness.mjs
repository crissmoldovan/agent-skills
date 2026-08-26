#!/usr/bin/env node
/**
 * Report whether one installed skill pack has drifted from its published source.
 *
 * This script only ever reads. It reads the Skills CLI lockfile, asks the source
 * repository for one git tree, compares the folder hash the lockfile already
 * records against the folder hash upstream now has, and prints a notice. It
 * writes nothing except its own cache file.
 *
 * It deliberately does not shell out to the Skills CLI to answer the question.
 * `skills check` is a bare alias for `skills update`: it mutates. There is no
 * dry-run, no `--check`, and no `outdated` command, and its exit code cannot
 * express "updates available" — exit 0 covers both "nothing to do" and "I just
 * rewrote every tracked skill". A hook that ran the CLI to *see* whether an
 * update existed would *perform* the update, non-interactively, at a scope
 * inferred from whatever directory the hook happened to inherit. So the
 * comparison is reimplemented here, read-only, in a few dozen lines.
 *
 * Detecting drift is communication. Applying it is mutation, and mutation needs
 * the user's explicit consent for a named scope. This script never crosses that
 * line; it ends at "here is the exact command".
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/** The pack this copy was published from. Any pack works via `--source`. */
export const DEFAULT_SOURCE = 'crissmoldovan/agent-skills';
export const DEFAULT_API_BASE = 'https://api.github.com';

/** Exit 2 is the drift signal an `asyncRewake` hook turns into a system reminder. */
export const EXIT_CURRENT = 0;
export const EXIT_USAGE = 1;
export const EXIT_DRIFT = 2;

/**
 * A flaky network or a captive portal must not hang the start of a session, so
 * every request is fenced by a short deadline rather than the default timeout.
 */
export const FETCH_TIMEOUT_MS = 5_000;

/**
 * Asymmetric cache lifetimes, a pattern taken from garrytan/gstack's update
 * check (`bin/gstack-update-check`, which caches "up to date" for 60 minutes and
 * "upgrade available" for 720 with the comment "keep nagging"). The reasoning
 * transfers exactly: a current install is the common case and cheap to
 * re-confirm, so its answer expires quickly; a drifted install must be announced
 * every single session until the user acts, but re-asking the API every session
 * buys nothing, because the answer cannot change until they update. The notice
 * repeats; the request does not.
 *
 * One deliberate divergence: gstack caches the *verdict*, so a user who upgrades
 * mid-window keeps being nagged by a stale cached answer. This cache stores only
 * the *remote observation*, and the verdict is recomputed against the lockfile on
 * every run — so the moment the pack is actually updated, the notice stops.
 */
export const TTL_CURRENT_MS = 60 * 60 * 1000;
export const TTL_STALE_MS = 12 * 60 * 60 * 1000;
/** A check that failed must not be retried at every session start. */
export const TTL_UNKNOWN_MS = 15 * 60 * 1000;

export const CACHE_VERSION = 1;
export const SOURCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** Names are interpolated into a printed command, so only plain slugs may pass. */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const USAGE = `Usage: check-pack-freshness.mjs [--source <owner>/<repo>] [--print-stale-names] [--no-cache] [--consented]

Reports drift between an installed pack and its published source. Reads only.
Exit 0 when current, unknown, or untracked; exit 2 when an update is available.`;

function describeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').trim().slice(0, 200) || 'unknown failure';
}

export function resolveHome(env = process.env) {
  return env.HOME || homedir();
}

/**
 * The CLI keeps the global lockfile under `$XDG_STATE_HOME/skills` when that
 * variable is set, and under `~/.agents` otherwise.
 */
export function resolveLockPath(env = process.env) {
  if (env.XDG_STATE_HOME) return path.join(env.XDG_STATE_HOME, 'skills', '.skill-lock.json');
  return path.join(resolveHome(env), '.agents', '.skill-lock.json');
}

export function resolveCachePath(env = process.env) {
  if (env.XDG_STATE_HOME) return path.join(env.XDG_STATE_HOME, 'skills-freshness', 'cache.json');
  return path.join(resolveHome(env), '.agents', '.freshness-cache.json');
}

/**
 * A lock entry records the path of the skill's `SKILL.md`; the hash it tracks is
 * the git tree of the folder containing it.
 */
export function skillFolderOf(skillPath) {
  if (typeof skillPath !== 'string' || !skillPath) return null;
  const posixPath = skillPath.split('\\').join('/').replace(/^\.\//, '');
  const folder = posixPath.endsWith('/SKILL.md') ? posixPath.slice(0, -'/SKILL.md'.length) : path.posix.dirname(posixPath);
  return folder && folder !== '.' && folder !== '/' ? folder : null;
}

/**
 * Split the lockfile into the entries this check can prove something about and
 * the entries it cannot. An entry with no comparable digest is reported as
 * unknown freshness — never quietly counted as current.
 */
export function selectPackEntries(lock, source) {
  const skills = lock && typeof lock === 'object' && !Array.isArray(lock) ? lock.skills : null;
  if (!skills || typeof skills !== 'object' || Array.isArray(skills)) throw new Error('lockfile has no skills map');

  const comparable = [];
  const unverifiable = [];
  for (const [name, entry] of Object.entries(skills)) {
    if (!entry || typeof entry !== 'object' || entry.source !== source) continue;
    const folder = skillFolderOf(entry.skillPath);
    // `local`, `git` and `well-known` sources carry no comparable tree hash; the
    // CLI itself skips them with the reason "No version tracking".
    if (entry.sourceType !== 'github' || !entry.skillFolderHash || !folder || !SKILL_NAME_PATTERN.test(name)) {
      unverifiable.push(name);
      continue;
    }
    comparable.push({ name, folder, hash: entry.skillFolderHash, ref: typeof entry.ref === 'string' && entry.ref ? entry.ref : 'HEAD' });
  }
  comparable.sort((left, right) => left.name.localeCompare(right.name));
  unverifiable.sort();
  return { comparable, unverifiable };
}

export function indexTree(tree) {
  const byPath = new Map();
  if (!Array.isArray(tree)) return byPath;
  for (const node of tree) {
    if (node && node.type === 'tree' && typeof node.path === 'string' && typeof node.sha === 'string') byPath.set(node.path, node.sha);
  }
  return byPath;
}

/**
 * Compare tracked entries against a snapshot of `{ref: {folder: sha|null}}`.
 * `null` means the folder was asked for and is not there any more.
 */
export function verdictFrom(comparable, snapshot, truncated) {
  const stale = [];
  const current = [];
  const missing = [];
  const unverifiable = [];
  for (const entry of comparable) {
    const observed = snapshot?.[entry.ref]?.[entry.folder];
    if (observed === undefined || observed === null) {
      // A truncated tree listing cannot prove absence, so it proves nothing.
      if (truncated || observed === undefined) unverifiable.push(entry.name);
      else missing.push(entry.name);
      continue;
    }
    if (observed === entry.hash) current.push(entry.name);
    else stale.push(entry.name);
  }
  return { stale, current, missing, unverifiable };
}

function snapshotCovers(comparable, snapshot) {
  return comparable.every((entry) => snapshot?.[entry.ref] && Object.hasOwn(snapshot[entry.ref], entry.folder));
}

async function readCache(cachePath) {
  try {
    const parsed = JSON.parse(await readFile(cachePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || parsed.version !== CACHE_VERSION) return null;
    if (!parsed.sources || typeof parsed.sources !== 'object') return null;
    return parsed;
  } catch {
    // A corrupt or absent cache means one extra request, never a wrong answer.
    return null;
  }
}

async function writeCache(cachePath, cache) {
  try {
    await mkdir(path.dirname(cachePath), { recursive: true });
    const temporary = `${cachePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(cache, null, 2)}\n`);
    await rename(temporary, cachePath);
  } catch {
    // A cache we cannot write makes the check slower, not wrong.
  }
}

function observationIsFresh(record, now) {
  if (!record || typeof record.observedAt !== 'number') return false;
  const age = now - record.observedAt;
  if (age < 0) return false;
  if (record.outcome === 'unknown') return age < TTL_UNKNOWN_MS;
  if (record.outcome !== 'observed') return false;
  return age < (record.driftSeen ? TTL_STALE_MS : TTL_CURRENT_MS);
}

async function fetchJson(url, { fetchImpl, token, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();
  try {
    const headers = { accept: 'application/vnd.github+json', 'user-agent': 'agent-skills-pack-freshness' };
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetchImpl(url, { headers, signal: controller.signal });
    if (!response || typeof response.status !== 'number') throw new Error('malformed response');
    if (!response.ok) throw new Error(`source returned HTTP ${response.status}`);
    // An error page or a captive-portal interception must not parse as a tree.
    const body = await response.json();
    if (!body || typeof body !== 'object') throw new Error('response was not a JSON object');
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkPackFreshness(options = {}) {
  const {
    source = DEFAULT_SOURCE,
    env = process.env,
    fetchImpl = globalThis.fetch,
    now = Date.now(),
    useCache = true,
    consented = false,
  } = options;
  const lockPath = options.lockPath ?? resolveLockPath(env);
  const cachePath = options.cachePath ?? resolveCachePath(env);
  const apiBase = (env.SKILLS_FRESHNESS_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');
  const token = env.GITHUB_TOKEN || env.GH_TOKEN || null;

  const result = {
    source,
    state: 'unknown',
    stale: [],
    current: [],
    missing: [],
    unverifiable: [],
    release: null,
    reason: null,
    fetched: false,
    checkedAt: now,
    consented,
  };

  const persist = async (record) => {
    const cache = (await readCache(cachePath)) ?? { version: CACHE_VERSION, sources: {} };
    cache.sources[source] = record;
    await writeCache(cachePath, cache);
  };

  const unknown = async (reason, { record = true } = {}) => {
    result.state = 'unknown';
    result.reason = reason;
    if (record) await persist({ observedAt: now, outcome: 'unknown', driftSeen: false, reason, folderHashes: {}, truncated: false, release: null });
    return result;
  };

  let lock;
  try {
    lock = JSON.parse(await readFile(lockPath, 'utf8'));
  } catch (error) {
    return unknown(`lockfile is unreadable (${describeError(error)})`);
  }

  let selection;
  try {
    selection = selectPackEntries(lock, source);
  } catch (error) {
    return unknown(describeError(error));
  }
  result.unverifiable = [...selection.unverifiable];

  if (selection.comparable.length === 0) {
    if (selection.unverifiable.length > 0) return unknown('installed copies of this source carry no comparable folder hash');
    // Nothing from this source is installed. Nothing to check, nothing to say.
    result.state = 'untracked';
    return result;
  }

  const cached = useCache ? (await readCache(cachePath))?.sources?.[source] : null;
  if (cached && observationIsFresh(cached, now)) {
    if (cached.outcome === 'unknown') {
      result.state = 'unknown';
      result.reason = cached.reason ?? 'the previous check failed';
      return result;
    }
    if (snapshotCovers(selection.comparable, cached.folderHashes)) {
      return settle(result, selection, cached.folderHashes, cached.truncated === true, cached.release ?? null, false);
    }
    // A skill was installed since the snapshot; guessing is not an option.
  }

  const snapshot = {};
  let truncated = false;
  try {
    const refs = [...new Set(selection.comparable.map((entry) => entry.ref))].sort();
    const treesByRef = new Map();
    for (const ref of refs) {
      const body = await fetchJson(`${apiBase}/repos/${source}/git/trees/${encodeURIComponent(ref)}?recursive=1`, { fetchImpl, token, timeoutMs: FETCH_TIMEOUT_MS });
      if (!Array.isArray(body.tree)) throw new Error('tree response carried no tree');
      if (body.truncated === true) truncated = true;
      treesByRef.set(ref, indexTree(body.tree));
    }
    for (const entry of selection.comparable) {
      snapshot[entry.ref] ??= {};
      snapshot[entry.ref][entry.folder] = treesByRef.get(entry.ref)?.get(entry.folder) ?? null;
    }
  } catch (error) {
    return unknown(`source is unreachable (${describeError(error)})`);
  }
  result.fetched = true;

  const preview = verdictFrom(selection.comparable, snapshot, truncated);
  let release = null;
  // The release is decoration on a notice, so it is only worth a request when
  // there is a notice to decorate, and its failure never fails the check.
  if (preview.stale.length > 0) {
    try {
      const body = await fetchJson(`${apiBase}/repos/${source}/releases/latest`, { fetchImpl, token, timeoutMs: FETCH_TIMEOUT_MS });
      release = {
        tag: typeof body.tag_name === 'string' ? body.tag_name : null,
        name: typeof body.name === 'string' ? body.name : null,
        url: typeof body.html_url === 'string' ? body.html_url : null,
      };
    } catch {
      release = null;
    }
  }

  await persist({ observedAt: now, outcome: 'observed', driftSeen: preview.stale.length > 0, reason: null, folderHashes: snapshot, truncated, release });
  return settle(result, selection, snapshot, truncated, release, true);
}

function settle(result, selection, snapshot, truncated, release, fetched) {
  const verdict = verdictFrom(selection.comparable, snapshot, truncated);
  result.stale = verdict.stale;
  result.current = verdict.current;
  result.missing = verdict.missing;
  result.unverifiable = [...new Set([...result.unverifiable, ...verdict.unverifiable])].sort();
  result.release = release;
  result.fetched = fetched;
  result.state = verdict.stale.length > 0 ? 'stale' : 'current';
  return result;
}

/**
 * The first token is a stable vocabulary for machines; the rest is for a human.
 * Silence is the only "you are current" signal, which is exactly why a failed
 * check must never render as silence.
 */
export function formatNotice(result) {
  if (!result || result.state !== 'stale' || result.stale.length === 0) return '';
  const lines = [`PACK_UPDATE_AVAILABLE ${result.source} ${result.stale.length} skill${result.stale.length === 1 ? '' : 's'}`];
  lines.push(`Stale: ${result.stale.join(', ')}`);
  if (result.release?.tag) lines.push(`Latest release: ${result.release.name || result.release.tag} (${result.release.tag})`);
  if (result.missing.length > 0) lines.push(`Gone upstream — removal candidates needing separate confirmation, not deletions: ${result.missing.join(', ')}`);
  if (result.unverifiable.length > 0) lines.push(`Freshness unknown, no comparable hash: ${result.unverifiable.join(', ')}`);
  // Named skills bound what is rewritten, --global pins the scope instead of
  // letting it be inferred from the current directory, and --yes keeps an
  // upstream deletion a printed warning rather than a removal.
  lines.push(`Update with: npx skills update ${result.stale.join(' ')} --global --yes`);
  lines.push(result.consented
    ? 'Auto-update is armed for this source at global scope; it was applied or attempted by the hook that printed this.'
    : 'This is a notice, not an update. Nothing has been changed.');
  return lines.join('\n');
}

function parseArguments(argv) {
  const options = { source: DEFAULT_SOURCE, printStaleNames: false, useCache: true, consented: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--source') {
      index += 1;
      options.source = argv[index] ?? '';
    } else if (argument === '--print-stale-names') options.printStaleNames = true;
    else if (argument === '--no-cache') options.useCache = false;
    else if (argument === '--consented') options.consented = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`unknown argument: ${argument}`);
  }
  if (!SOURCE_PATTERN.test(options.source)) throw new Error('--source must be <owner>/<repo>');
  return options;
}

export async function main(argv = process.argv.slice(2), context = {}) {
  const { env = process.env, stdout = process.stdout, stderr = process.stderr } = context;
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    stderr.write(`${describeError(error)}\n${USAGE}\n`);
    return EXIT_USAGE;
  }
  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return EXIT_CURRENT;
  }

  let result;
  try {
    result = await checkPackFreshness({ ...options, env, fetchImpl: context.fetchImpl, now: context.now });
  } catch (error) {
    // Nothing this script can hit is worth breaking the start of a session over.
    stderr.write(`PACK_FRESHNESS_UNKNOWN ${options.source}: ${describeError(error)}\n`);
    return EXIT_CURRENT;
  }

  if (options.printStaleNames) {
    const names = result.stale.filter((name) => SKILL_NAME_PATTERN.test(name));
    if (names.length > 0) stdout.write(`${names.join(' ')}\n`);
    return EXIT_CURRENT;
  }
  if (result.state === 'stale') {
    stdout.write(`${formatNotice(result)}\n`);
    return EXIT_DRIFT;
  }
  if (result.state === 'unknown') {
    // Unknown is its own state. It is reported, and it is not an all-clear.
    stderr.write(`PACK_FRESHNESS_UNKNOWN ${result.source}: ${result.reason}\n`);
  }
  return EXIT_CURRENT;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = await main();
}
