import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_SOURCE,
  EXIT_CURRENT,
  EXIT_DRIFT,
  EXIT_USAGE,
  TTL_CURRENT_MS,
  TTL_STALE_MS,
  TTL_UNKNOWN_MS,
  checkPackFreshness,
  formatNotice,
  resolveCachePath,
  resolveLockPath,
  selectPackEntries,
  skillFolderOf,
} from '../skills/update-agent-skills/scripts/check-pack-freshness.mjs';

const checker = fileURLToPath(new URL('../skills/update-agent-skills/scripts/check-pack-freshness.mjs', import.meta.url));
const SOURCE = 'example-owner/example-pack';

// The lockfile records the SKILL.md file; the tracked hash is its folder's git tree.
function lockEntry(name, hash, extra = {}) {
  return {
    source: SOURCE,
    sourceType: 'github',
    sourceUrl: `https://github.com/${SOURCE}.git`,
    skillPath: `skills/${name}/SKILL.md`,
    skillFolderHash: hash,
    installedAt: '2026-08-25T05:39:36.069Z',
    updatedAt: '2026-08-26T07:09:08.989Z',
    ...extra,
  };
}

function lockFile(skills) {
  return { version: 3, skills, dismissed: [], lastSelectedAgents: [] };
}

function treeResponse(folders, { truncated = false } = {}) {
  return {
    sha: 'tree-root',
    tree: [
      { path: 'README.md', type: 'blob', sha: 'blob-readme' },
      ...Object.entries(folders).map(([folder, sha]) => ({ path: folder, type: 'tree', sha })),
    ],
    truncated,
  };
}

const RELEASE = { tag_name: 'v1.2.3', name: 'Example Pack v1.2.3', html_url: `https://github.com/${SOURCE}/releases/tag/v1.2.3` };

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// Records every URL asked for, so a test can prove the network was not touched.
function stubFetch(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    for (const [fragment, responder] of routes) {
      if (String(url).includes(fragment)) return typeof responder === 'function' ? responder() : responder;
    }
    throw new Error(`unexpected request: ${url}`);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

async function scratch(name) {
  const root = await mkdtemp(path.join(tmpdir(), `pack-freshness-${name}-`));
  return { root, lockPath: path.join(root, 'lock.json'), cachePath: path.join(root, 'cache.json') };
}

async function writeLock(lockPath, skills) {
  await writeFile(lockPath, JSON.stringify(lockFile(skills)));
}

test('a skill folder is derived from the SKILL.md path the lockfile records', () => {
  assert.equal(skillFolderOf('skills/blocks/SKILL.md'), 'skills/blocks');
  assert.equal(skillFolderOf('nested/pack/skills/blocks/SKILL.md'), 'nested/pack/skills/blocks');
  assert.equal(skillFolderOf('SKILL.md'), null);
  assert.equal(skillFolderOf(''), null);
  assert.equal(skillFolderOf(undefined), null);
});

test('selection keeps one source and separates entries no hash can verify', () => {
  const lock = lockFile({
    blocks: lockEntry('blocks', 'hash-blocks'),
    'model-routing': lockEntry('model-routing', 'hash-routing'),
    foreign: { ...lockEntry('foreign', 'hash-foreign'), source: 'other/pack' },
    'local-copy': { ...lockEntry('local-copy', 'hash-local'), sourceType: 'local' },
    'no-hash': { ...lockEntry('no-hash', 'hash'), skillFolderHash: undefined },
  });

  const selection = selectPackEntries(lock, SOURCE);

  assert.deepEqual(selection.comparable.map((entry) => entry.name), ['blocks', 'model-routing']);
  assert.deepEqual(selection.comparable.map((entry) => entry.folder), ['skills/blocks', 'skills/model-routing']);
  // Doctrine: where no comparable digest exists, freshness is unknown — never "current".
  assert.deepEqual(selection.unverifiable, ['local-copy', 'no-hash']);
});

test('lock and cache locations honour XDG_STATE_HOME and fall back to the agents directory', () => {
  const home = path.join(path.sep, 'somewhere', 'home');
  const state = path.join(path.sep, 'somewhere', 'state');

  assert.equal(resolveLockPath({ HOME: home }), path.join(home, '.agents', '.skill-lock.json'));
  assert.equal(resolveCachePath({ HOME: home }), path.join(home, '.agents', '.freshness-cache.json'));
  assert.equal(resolveLockPath({ HOME: home, XDG_STATE_HOME: state }), path.join(state, 'skills', '.skill-lock.json'));
  assert.equal(resolveCachePath({ HOME: home, XDG_STATE_HOME: state }), path.join(state, 'skills-freshness', 'cache.json'));
});

test('a pack whose folder hashes all match reports current and says nothing', async () => {
  const { lockPath, cachePath } = await scratch('current');
  await writeLock(lockPath, { blocks: lockEntry('blocks', 'sha-blocks') });
  const fetchImpl = stubFetch([['git/trees', jsonResponse(treeResponse({ 'skills/blocks': 'sha-blocks' }))]]);

  const result = await checkPackFreshness({ source: SOURCE, lockPath, cachePath, fetchImpl, env: {} });

  assert.equal(result.state, 'current');
  assert.deepEqual(result.stale, []);
  assert.equal(formatNotice(result), '');
  // The release call is only worth making when there is something to announce.
  assert.equal(fetchImpl.calls.filter((url) => url.includes('releases')).length, 0);
});

test('a drifted pack names the stale skills, the release, and the exact scoped command', async () => {
  const { lockPath, cachePath } = await scratch('stale');
  await writeLock(lockPath, {
    blocks: lockEntry('blocks', 'sha-old'),
    'model-routing': lockEntry('model-routing', 'sha-old'),
    'agent-lifecycle': lockEntry('agent-lifecycle', 'sha-current'),
  });
  const fetchImpl = stubFetch([
    ['git/trees', jsonResponse(treeResponse({
      'skills/blocks': 'sha-new',
      'skills/model-routing': 'sha-new',
      'skills/agent-lifecycle': 'sha-current',
    }))],
    ['releases/latest', jsonResponse(RELEASE)],
  ]);

  const result = await checkPackFreshness({ source: SOURCE, lockPath, cachePath, fetchImpl, env: {} });

  assert.equal(result.state, 'stale');
  assert.deepEqual(result.stale, ['blocks', 'model-routing']);
  assert.deepEqual(result.current, ['agent-lifecycle']);
  assert.equal(result.release.tag, 'v1.2.3');

  const notice = formatNotice(result);
  assert.match(notice, /^PACK_UPDATE_AVAILABLE/m);
  assert.ok(notice.includes('Example Pack v1.2.3'));
  // Named skills bound the mutation, --global defeats cwd-dependent scope detection,
  // and --yes makes an upstream deletion a printed warning rather than a removal.
  assert.ok(notice.includes('npx skills update blocks model-routing --global --yes'));
});

test('a skill that vanished upstream is a removal candidate, never a stale update', async () => {
  const { lockPath, cachePath } = await scratch('missing');
  await writeLock(lockPath, {
    blocks: lockEntry('blocks', 'sha-old'),
    retired: lockEntry('retired', 'sha-retired'),
  });
  const fetchImpl = stubFetch([
    ['git/trees', jsonResponse(treeResponse({ 'skills/blocks': 'sha-new' }))],
    ['releases/latest', jsonResponse(RELEASE)],
  ]);

  const result = await checkPackFreshness({ source: SOURCE, lockPath, cachePath, fetchImpl, env: {} });

  assert.deepEqual(result.stale, ['blocks']);
  assert.deepEqual(result.missing, ['retired']);
  const notice = formatNotice(result);
  assert.ok(notice.includes('removal candidate'));
  assert.ok(!notice.includes('update blocks retired'));
});

test('a truncated tree cannot prove absence, so nothing is called missing', async () => {
  const { lockPath, cachePath } = await scratch('truncated');
  await writeLock(lockPath, { blocks: lockEntry('blocks', 'sha-old'), absent: lockEntry('absent', 'sha-absent') });
  const fetchImpl = stubFetch([
    ['git/trees', jsonResponse(treeResponse({ 'skills/blocks': 'sha-new' }, { truncated: true }))],
    ['releases/latest', jsonResponse(RELEASE)],
  ]);

  const result = await checkPackFreshness({ source: SOURCE, lockPath, cachePath, fetchImpl, env: {} });

  assert.deepEqual(result.missing, []);
  assert.ok(result.unverifiable.includes('absent'));
});

test('a network failure is unknown, never current, and exits without breaking the session', async () => {
  const { lockPath, cachePath } = await scratch('offline');
  await writeLock(lockPath, { blocks: lockEntry('blocks', 'sha-old') });
  const fetchImpl = stubFetch([['git/trees', () => { throw new Error('getaddrinfo ENOTFOUND'); }]]);

  const result = await checkPackFreshness({ source: SOURCE, lockPath, cachePath, fetchImpl, env: {} });

  // gstack's own lesson, learned one step further: silence means healthy, so a
  // failed check must never be recorded as healthy.
  assert.equal(result.state, 'unknown');
  assert.notEqual(result.state, 'current');
  assert.match(result.reason, /ENOTFOUND|unreachable|failed/i);
  assert.equal(formatNotice(result), '');
});

test('an HTML error page is rejected rather than parsed as a tree', async () => {
  const { lockPath, cachePath } = await scratch('html');
  await writeLock(lockPath, { blocks: lockEntry('blocks', 'sha-old') });
  const fetchImpl = stubFetch([['git/trees', { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }]]);

  const result = await checkPackFreshness({ source: SOURCE, lockPath, cachePath, fetchImpl, env: {} });

  assert.equal(result.state, 'unknown');
});

test('an unreadable lockfile is unknown, and a lockfile with no entry for the source is untracked', async () => {
  const { lockPath, cachePath } = await scratch('lock');
  const never = stubFetch([]);

  const absent = await checkPackFreshness({ source: SOURCE, lockPath, cachePath, fetchImpl: never, env: {} });
  assert.equal(absent.state, 'unknown');

  await writeLock(lockPath, { foreign: { ...lockEntry('foreign', 'sha'), source: 'other/pack' } });
  const untracked = await checkPackFreshness({ source: SOURCE, lockPath, cachePath, fetchImpl: never, env: {} });
  assert.equal(untracked.state, 'untracked');
  assert.equal(never.calls.length, 0, 'nothing to check must cost no request');
});

test('a fresh current observation is reused without a request until its 60-minute TTL expires', async () => {
  const { lockPath, cachePath } = await scratch('ttl-current');
  await writeLock(lockPath, { blocks: lockEntry('blocks', 'sha-blocks') });
  const routes = [['git/trees', jsonResponse(treeResponse({ 'skills/blocks': 'sha-blocks' }))]];

  const first = stubFetch(routes);
  await checkPackFreshness({ source: SOURCE, lockPath, cachePath, fetchImpl: first, now: 0, env: {} });
  assert.equal(first.calls.length, 1);

  const cached = stubFetch(routes);
  const withinTtl = await checkPackFreshness({ source: SOURCE, lockPath, cachePath, fetchImpl: cached, now: TTL_CURRENT_MS - 1000, env: {} });
  assert.equal(cached.calls.length, 0);
  assert.equal(withinTtl.state, 'current');
  assert.equal(withinTtl.fetched, false);

  const expired = stubFetch(routes);
  await checkPackFreshness({ source: SOURCE, lockPath, cachePath, fetchImpl: expired, now: TTL_CURRENT_MS + 1000, env: {} });
  assert.equal(expired.calls.length, 1);
});

test('a drift observation keeps re-announcing for 12 hours without re-asking GitHub', async () => {
  const { lockPath, cachePath } = await scratch('ttl-stale');
  await writeLock(lockPath, { blocks: lockEntry('blocks', 'sha-old') });
  const routes = [
    ['git/trees', jsonResponse(treeResponse({ 'skills/blocks': 'sha-new' }))],
    ['releases/latest', jsonResponse(RELEASE)],
  ];

  const first = stubFetch(routes);
  await checkPackFreshness({ source: SOURCE, lockPath, cachePath, fetchImpl: first, now: 0, env: {} });
  assert.ok(first.calls.length >= 1);

  // Well past the 60-minute current TTL, and still no request: the answer cannot
  // change until the user updates, but the notice must keep appearing.
  const cached = stubFetch(routes);
  const later = await checkPackFreshness({ source: SOURCE, lockPath, cachePath, fetchImpl: cached, now: TTL_CURRENT_MS * 6, env: {} });
  assert.equal(cached.calls.length, 0);
  assert.equal(later.state, 'stale');
  assert.equal(later.fetched, false);
  assert.ok(formatNotice(later).includes('npx skills update blocks --global --yes'));

  const expired = stubFetch(routes);
  await checkPackFreshness({ source: SOURCE, lockPath, cachePath, fetchImpl: expired, now: TTL_STALE_MS + 1000, env: {} });
  assert.ok(expired.calls.length >= 1);
});

test('updating the pack silences the notice immediately instead of nagging out the cached window', async () => {
  const { lockPath, cachePath } = await scratch('reverify');
  await writeLock(lockPath, { blocks: lockEntry('blocks', 'sha-old') });
  const routes = [
    ['git/trees', jsonResponse(treeResponse({ 'skills/blocks': 'sha-new' }))],
    ['releases/latest', jsonResponse(RELEASE)],
  ];
  await checkPackFreshness({ source: SOURCE, lockPath, cachePath, fetchImpl: stubFetch(routes), now: 0, env: {} });

  // The user ran the update; the lock now matches what the cached snapshot saw.
  await writeLock(lockPath, { blocks: lockEntry('blocks', 'sha-new') });
  const cached = stubFetch(routes);
  const result = await checkPackFreshness({ source: SOURCE, lockPath, cachePath, fetchImpl: cached, now: 60_000, env: {} });

  assert.equal(cached.calls.length, 0, 'the verdict is recomputed from the lock, not replayed from cache');
  assert.equal(result.state, 'current');
});

test('a failed check is not retried on every session start', async () => {
  const { lockPath, cachePath } = await scratch('ttl-unknown');
  await writeLock(lockPath, { blocks: lockEntry('blocks', 'sha-old') });
  const failing = stubFetch([['git/trees', () => { throw new Error('network down'); }]]);

  await checkPackFreshness({ source: SOURCE, lockPath, cachePath, fetchImpl: failing, now: 0, env: {} });
  assert.equal(failing.calls.length, 1);

  const soon = stubFetch([['git/trees', () => { throw new Error('network down'); }]]);
  const result = await checkPackFreshness({ source: SOURCE, lockPath, cachePath, fetchImpl: soon, now: TTL_UNKNOWN_MS - 1000, env: {} });
  assert.equal(soon.calls.length, 0);
  assert.equal(result.state, 'unknown');

  const retry = stubFetch([['git/trees', () => { throw new Error('network down'); }]]);
  await checkPackFreshness({ source: SOURCE, lockPath, cachePath, fetchImpl: retry, now: TTL_UNKNOWN_MS + 1000, env: {} });
  assert.equal(retry.calls.length, 1);
});

test('a corrupt cache is discarded and the check refetches', async () => {
  const { lockPath, cachePath } = await scratch('corrupt');
  await writeLock(lockPath, { blocks: lockEntry('blocks', 'sha-blocks') });
  await writeFile(cachePath, '{ this is not json');
  const fetchImpl = stubFetch([['git/trees', jsonResponse(treeResponse({ 'skills/blocks': 'sha-blocks' }))]]);

  const result = await checkPackFreshness({ source: SOURCE, lockPath, cachePath, fetchImpl, now: 0, env: {} });

  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(result.state, 'current');
  // The corrupt file is replaced by a well-formed one rather than left to rot.
  const rewritten = JSON.parse(await readFile(cachePath, 'utf8'));
  assert.ok(rewritten.sources[SOURCE]);
});

test('a cache holding no snapshot for a newly installed skill refetches rather than guessing', async () => {
  const { lockPath, cachePath } = await scratch('newskill');
  await writeLock(lockPath, { blocks: lockEntry('blocks', 'sha-blocks') });
  const routes = [['git/trees', jsonResponse(treeResponse({ 'skills/blocks': 'sha-blocks', 'skills/added': 'sha-added' }))]];
  await checkPackFreshness({ source: SOURCE, lockPath, cachePath, fetchImpl: stubFetch(routes), now: 0, env: {} });

  await writeLock(lockPath, { blocks: lockEntry('blocks', 'sha-blocks'), added: lockEntry('added', 'sha-added') });
  const refetch = stubFetch(routes);
  const result = await checkPackFreshness({ source: SOURCE, lockPath, cachePath, fetchImpl: refetch, now: 1000, env: {} });

  assert.equal(refetch.calls.length, 1);
  assert.equal(result.state, 'current');
});

test('the checker never shells out to the skills CLI, whose check is a mutating alias for update', async () => {
  const source = await readFile(checker, 'utf8');
  // The contract is that the checker cannot start a process at all.
  for (const forbidden of ['child_process', 'execFile(', 'execSync(', 'spawn(', 'spawnSync(']) {
    assert.ok(!source.includes(forbidden), `the read-only checker must not contain ${forbidden}`);
  }
  // And that the reason is written down where the next maintainer will read it.
  assert.match(source, /`skills check` is a bare alias for `skills update`/);
});

// End-to-end through the real process boundary, against a local API stand-in,
// because the exit code is the entire contract with asyncRewake.
async function runChecker(argv, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [checker, ...argv], { env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

async function apiStandIn(folders) {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url.includes('/releases/latest')) return response.end(JSON.stringify(RELEASE));
    if (request.url.includes('/git/trees/')) return response.end(JSON.stringify(treeResponse(folders)));
    response.statusCode = 404;
    response.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function stateHome(name, skills) {
  const root = await mkdtemp(path.join(tmpdir(), `pack-freshness-${name}-`));
  await mkdir(path.join(root, 'skills'), { recursive: true });
  await writeFile(path.join(root, 'skills', '.skill-lock.json'), JSON.stringify(lockFile(skills)));
  return root;
}

test('exit 0 and silence when current; exit 2 and a notice when drifted', async () => {
  const { server, base } = await apiStandIn({ 'skills/blocks': 'sha-new' });
  try {
    const currentHome = await stateHome('exit-current', { blocks: lockEntry('blocks', 'sha-new') });
    const current = await runChecker(['--source', SOURCE], { XDG_STATE_HOME: currentHome, SKILLS_FRESHNESS_API_BASE: base });
    assert.equal(current.status, EXIT_CURRENT);
    assert.equal(current.stdout.trim(), '');

    const staleHome = await stateHome('exit-stale', { blocks: lockEntry('blocks', 'sha-old') });
    const stale = await runChecker(['--source', SOURCE], { XDG_STATE_HOME: staleHome, SKILLS_FRESHNESS_API_BASE: base });
    assert.equal(stale.status, EXIT_DRIFT);
    assert.ok(stale.stdout.includes('npx skills update blocks --global --yes'));
  } finally {
    server.close();
  }
});

test('an unreachable API exits 0 with the failure on stderr, never a silent all-clear', async () => {
  const home = await stateHome('exit-offline', { blocks: lockEntry('blocks', 'sha-old') });
  const result = await runChecker(['--source', SOURCE], { XDG_STATE_HOME: home, SKILLS_FRESHNESS_API_BASE: 'http://127.0.0.1:1' });

  assert.equal(result.status, EXIT_CURRENT);
  assert.equal(result.stdout.trim(), '');
  assert.match(result.stderr, /PACK_FRESHNESS_UNKNOWN/);
});

test('stale names print alone for the auto-mode hook, and only well-formed names', async () => {
  const { server, base } = await apiStandIn({ 'skills/blocks': 'sha-new', 'skills/model-routing': 'sha-new' });
  try {
    const home = await stateHome('names', {
      blocks: lockEntry('blocks', 'sha-old'),
      'model-routing': lockEntry('model-routing', 'sha-old'),
    });
    const result = await runChecker(['--source', SOURCE, '--print-stale-names'], { XDG_STATE_HOME: home, SKILLS_FRESHNESS_API_BASE: base });

    assert.equal(result.status, EXIT_CURRENT);
    assert.equal(result.stdout.trim(), 'blocks model-routing');
  } finally {
    server.close();
  }
});

test('a malformed source is a usage error, not a drift signal', async () => {
  const home = await stateHome('usage', { blocks: lockEntry('blocks', 'sha-old') });
  const result = await runChecker(['--source', 'not a repo; rm -rf /'], { XDG_STATE_HOME: home });

  assert.equal(result.status, EXIT_USAGE);
  assert.notEqual(result.status, EXIT_DRIFT);
});

test('the default source is the pack this copy was published from', () => {
  assert.match(DEFAULT_SOURCE, /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/);
});
