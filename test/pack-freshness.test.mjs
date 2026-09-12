import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
  formatHookEnvelope,
  formatNotice,
  formatUnknownNotice,
  main,
  reportFor,
  resolveCachePath,
  resolveLockPath,
  selectPackEntries,
  skillFolderOf,
} from '../skills/update-agent-skills/scripts/check-pack-freshness.mjs';
import { buildHookEntry } from '../skills/update-agent-skills/scripts/install-freshness-hook.mjs';

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

test('an unreachable API reports unknown on stdout, the channel a verdict is actually read from', async () => {
  const home = await stateHome('exit-offline', { blocks: lockEntry('blocks', 'sha-old') });
  const result = await runChecker(['--source', SOURCE], { XDG_STATE_HOME: home, SKILLS_FRESHNESS_API_BASE: 'http://127.0.0.1:1' });

  // The exit code still says "do not break the session". It is not what carries
  // the answer, and the answer is not silence.
  assert.equal(result.status, EXIT_CURRENT);
  assert.match(result.stdout, /^PACK_FRESHNESS_UNKNOWN/m);
  assert.match(result.stdout, /not an all-clear/);
  // stderr is not a second channel here: on the hook path it REPLACES stdout, so
  // a verdict written there is a verdict any stray line can erase.
  assert.equal(result.stderr.trim(), '');
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

// ── The unknown state, which the skill promises is never silent ──────────────

test('an undetermined check formats a notice of its own rather than nothing', () => {
  const unknown = formatUnknownNotice({ state: 'unknown', source: SOURCE, reason: 'source is unreachable (ENOTFOUND)' });

  assert.match(unknown, /^PACK_FRESHNESS_UNKNOWN example-owner\/example-pack$/m);
  assert.match(unknown, /source is unreachable \(ENOTFOUND\)/);
  // The whole point: it must not read as an all-clear.
  assert.match(unknown, /not an all-clear/i);
  assert.equal(formatUnknownNotice({ state: 'current', source: SOURCE }), '');
  assert.equal(formatUnknownNotice({ state: 'untracked', source: SOURCE }), '');
});

test('a check that crashed outright still reports unknown, on stdout, and exits 0', async () => {
  // The one limb no other test here reaches. Every other failure — an unreachable source,
  // an unreadable lockfile, an entry with no comparable hash — fails INSIDE
  // checkPackFreshness, which RETURNS an unknown result. This is the case where the check
  // throws out of it entirely, and its handler is the code that used to write to stderr and
  // return 0: verified by putting that back, at which point this file's other 30 tests all
  // still passed. `env: null` is the crash — the first lockfile read cannot even be located.
  let stdout = ''; let stderr = '';
  const sink = { stdout: { write: (chunk) => { stdout += chunk; } }, stderr: { write: (chunk) => { stderr += chunk; } } };

  const status = await main(['--source', SOURCE], { env: null, ...sink });

  assert.equal(status, EXIT_CURRENT, 'a crashed check must not break the start of a session');
  assert.match(stdout, /^PACK_FRESHNESS_UNKNOWN/);
  assert.match(stdout, /not an all-clear/);
  // Not a second channel: on the hook path stderr REPLACES stdout, so a verdict written
  // there is a verdict any stray line from anything else can erase.
  assert.equal(stderr, '', 'the verdict for a crashed check must not live on stderr');

  stdout = ''; stderr = '';
  await main(['--source', SOURCE, '--hook'], { env: null, ...sink });
  const envelope = JSON.parse(stdout);
  assert.match(envelope.hookSpecificOutput.additionalContext, /PACK_FRESHNESS_UNKNOWN/);
  assert.equal(stderr, '');
});

test('the report is the drift notice or the unknown notice, and silence only means current', async () => {
  const { lockPath, cachePath } = await scratch('report');
  await writeLock(lockPath, { blocks: lockEntry('blocks', 'sha-blocks') });

  const current = await checkPackFreshness({ source: SOURCE, lockPath, cachePath, env: {}, fetchImpl: stubFetch([['git/trees', jsonResponse(treeResponse({ 'skills/blocks': 'sha-blocks' }))]]) });
  assert.equal(reportFor(current), '');

  const offline = await checkPackFreshness({ source: SOURCE, lockPath, cachePath, useCache: false, env: {}, fetchImpl: stubFetch([['git/trees', () => { throw new Error('ENOTFOUND'); }]]) });
  assert.match(reportFor(offline), /^PACK_FRESHNESS_UNKNOWN/);
});

test('a drift notice says a differing tree hash is different, not newer', async () => {
  const { lockPath, cachePath } = await scratch('ordering');
  await writeLock(lockPath, { blocks: lockEntry('blocks', 'sha-installed') });
  // Upstream was reverted: it now holds a tree this install has never had. A tree
  // hash carries no ordering, so this is indistinguishable from a new release —
  // and "updating" to it walks the user backwards.
  const fetchImpl = stubFetch([
    ['git/trees', jsonResponse(treeResponse({ 'skills/blocks': 'sha-reverted' }))],
    ['releases/latest', jsonResponse(RELEASE)],
  ]);

  const notice = formatNotice(await checkPackFreshness({ source: SOURCE, lockPath, cachePath, fetchImpl, env: {} }));

  assert.match(notice, /Different, not newer/);
  assert.match(notice, /no ordering/);
});

// ── Delivery: the envelope, not the exit code ───────────────────────────────

test('the hook envelope is a SessionStart additionalContext payload that frames what it carries', () => {
  const envelope = JSON.parse(formatHookEnvelope('PACK_UPDATE_AVAILABLE a/b 1 skill'));

  assert.equal(envelope.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(envelope.hookSpecificOutput.additionalContext, /PACK_UPDATE_AVAILABLE a\/b 1 skill/);
  // The harness has been observed labelling this channel a blocking error, and
  // models have refused it as prompt injection. The framing is load-bearing.
  assert.match(envelope.hookSpecificOutput.additionalContext, /not an error in this session/);
  assert.match(envelope.hookSpecificOutput.additionalContext, /not permission to apply one/);
  assert.equal(formatHookEnvelope(''), '');
});

test('--hook delivers drift on stdout and exits 0, because exit 2 would discard it', async () => {
  const { server, base } = await apiStandIn({ 'skills/blocks': 'sha-new' });
  try {
    const home = await stateHome('hook-stale', { blocks: lockEntry('blocks', 'sha-old') });
    const result = await runChecker(['--source', SOURCE, '--hook'], { XDG_STATE_HOME: home, SKILLS_FRESHNESS_API_BASE: base });

    // A synchronous SessionStart hook that exits 2 delivers nothing at all: it
    // throws away the stdout exit 0 would have carried.
    assert.equal(result.status, EXIT_CURRENT);
    assert.notEqual(result.status, EXIT_DRIFT);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(envelope.hookSpecificOutput.additionalContext, /npx skills update blocks --global --yes/);
    assert.equal(result.stderr.trim(), '');
  } finally {
    server.close();
  }
});

test('--hook delivers the unknown state too, which is the state that used to vanish', async () => {
  const home = await stateHome('hook-unknown', { blocks: lockEntry('blocks', 'sha-old') });
  const result = await runChecker(['--source', SOURCE, '--hook'], { XDG_STATE_HOME: home, SKILLS_FRESHNESS_API_BASE: 'http://127.0.0.1:1' });

  assert.equal(result.status, EXIT_CURRENT);
  const envelope = JSON.parse(result.stdout);
  assert.match(envelope.hookSpecificOutput.additionalContext, /PACK_FRESHNESS_UNKNOWN/);
  assert.match(envelope.hookSpecificOutput.additionalContext, /not an all-clear/i);
});

test('--hook stays silent when the pack is current, so silence still means healthy', async () => {
  const { server, base } = await apiStandIn({ 'skills/blocks': 'sha-new' });
  try {
    const home = await stateHome('hook-current', { blocks: lockEntry('blocks', 'sha-new') });
    const result = await runChecker(['--source', SOURCE, '--hook'], { XDG_STATE_HOME: home, SKILLS_FRESHNESS_API_BASE: base });

    assert.equal(result.status, EXIT_CURRENT);
    assert.equal(result.stdout.trim(), '');
  } finally {
    server.close();
  }
});

test('--hook and --print-stale-names are refused together rather than one silently winning', async () => {
  const home = await stateHome('hook-conflict', { blocks: lockEntry('blocks', 'sha-old') });
  const result = await runChecker(['--source', SOURCE, '--hook', '--print-stale-names'], { XDG_STATE_HOME: home });

  assert.equal(result.status, EXIT_USAGE);
  assert.equal(result.stdout.trim(), '');
});

// ── The auto-mode hook body, run as the shipped command string ──────────────
// buildHookEntry emits a complete `sh -c '…' <node> <checker> <source>` command.
// Running that string is the only way to test the quoting and the shell logic
// together, and the shell logic is what decides whether a verdict is delivered.

async function fakeNpx(exitStatus) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pack-freshness-npx-'));
  const file = path.join(dir, 'npx');
  await writeFile(file, [
    '#!/bin/sh',
    // Real npm writes to stderr constantly. On a rewake, stderr REPLACES stdout,
    // so an un-redirected line here would erase the hook's own verdict.
    'echo "npm warn deprecated left-pad@0.0.1" >&2',
    `echo "skills update ran: $*"`,
    `exit ${exitStatus}`,
    '',
  ].join('\n'));
  await chmod(file, 0o755);
  return dir;
}

function runAutoHook(command, env) {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], { env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

const autoCommand = () => buildHookEntry({ mode: 'auto', source: SOURCE, checkerPath: checker, nodePath: process.execPath }).command;

test('the auto hook wakes the model when the check could not tell, not only when it found drift', async () => {
  const home = await stateHome('auto-unknown', { blocks: lockEntry('blocks', 'sha-old') });
  const bin = await fakeNpx(0);

  const result = await runAutoHook(autoCommand(), { XDG_STATE_HOME: home, SKILLS_FRESHNESS_API_BASE: 'http://127.0.0.1:1', PATH: `${bin}:${process.env.PATH}` });

  // Exit 2 is what an asyncRewake hook wakes on. The checker exits 0 for BOTH
  // "current" and "could not tell", so a hook that tested the checker's exit code
  // reported a failed check by going silent — which reads as health.
  assert.equal(result.status, 2);
  assert.match(result.stdout, /PACK_FRESHNESS_UNKNOWN/);
  assert.ok(!result.stdout.includes('skills update ran'), 'an undetermined check must not trigger the update');
  assert.equal(result.stderr.trim(), '');
});

test('the auto hook stays silent when the pack is current', async () => {
  const { server, base } = await apiStandIn({ 'skills/blocks': 'sha-new' });
  try {
    const home = await stateHome('auto-current', { blocks: lockEntry('blocks', 'sha-new') });
    const bin = await fakeNpx(0);

    const result = await runAutoHook(autoCommand(), { XDG_STATE_HOME: home, SKILLS_FRESHNESS_API_BASE: base, PATH: `${bin}:${process.env.PATH}` });

    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), '');
  } finally {
    server.close();
  }
});

test('the auto hook applies the named update and reports on stdout, with nothing on stderr to replace it', async () => {
  const { server, base } = await apiStandIn({ 'skills/blocks': 'sha-new' });
  try {
    const home = await stateHome('auto-drift', { blocks: lockEntry('blocks', 'sha-old') });
    const bin = await fakeNpx(0);

    const result = await runAutoHook(autoCommand(), { XDG_STATE_HOME: home, SKILLS_FRESHNESS_API_BASE: base, PATH: `${bin}:${process.env.PATH}` });

    assert.equal(result.status, 2);
    assert.match(result.stdout, /PACK_UPDATE_AVAILABLE/);
    assert.match(result.stdout, /Applied at global scope for example-owner\/example-pack: blocks/);
    // npm wrote to stderr. If that had reached the hook's own stderr it would have
    // replaced this entire verdict on the rewake.
    assert.equal(result.stderr.trim(), '');
    assert.ok(!result.stdout.includes('left-pad'), 'a successful update reports its verdict, not npm chatter');
  } finally {
    server.close();
  }
});

test('a failed auto-update surfaces the command to re-run by hand, and the tool output that explains why', async () => {
  const { server, base } = await apiStandIn({ 'skills/blocks': 'sha-new' });
  try {
    const home = await stateHome('auto-failed', { blocks: lockEntry('blocks', 'sha-old') });
    const bin = await fakeNpx(1);

    const result = await runAutoHook(autoCommand(), { XDG_STATE_HOME: home, SKILLS_FRESHNESS_API_BASE: base, PATH: `${bin}:${process.env.PATH}` });

    assert.equal(result.status, 2);
    assert.match(result.stdout, /AUTO_UPDATE_FAILED/);
    assert.match(result.stdout, /npx skills update blocks --global --yes/);
    assert.match(result.stdout, /left-pad/, 'the failure diagnosis is the one place npm output is worth keeping');
    assert.equal(result.stderr.trim(), '');
  } finally {
    server.close();
  }
});
