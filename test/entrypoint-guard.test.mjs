import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { lstat, mkdtemp, readFile, readdir, rm, symlink, unlink } from 'node:fs/promises';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isEntrypoint } from '../skills/update-agent-skills/scripts/check-pack-freshness.mjs';

/**
 * Every script in this pack that can be RUN decides, at its last line, whether it
 * was run or merely imported. That decision was made by comparing the path as
 * typed against the path Node resolved, and those two are not the same file name
 * when the pack is reached through a symlink — which is how the Skills CLI
 * installs it: ~/.claude/skills/<name> points at ~/.agents/skills/<name>.
 *
 * Observed on 2026-09-12, against the installed pack:
 *
 *   node ~/.claude/skills/update-agent-skills/scripts/install-freshness-hook.mjs \
 *     --mode notify --source crissmoldovan/agent-skills --settings /tmp/probe.json
 *   -> exit 0, no output, /tmp/probe.json unchanged
 *
 * The same command through ~/.agents/skills/... installed the hook. So a user who
 * followed the pack's own documented instruction was told nothing, saw a success
 * code, and believed they had armed a hook that did not exist. The freshness
 * CHECKER fails the same way and worse: it is the file the hook runs, and this
 * pack defines its silence as "current", so a checker that never ran reports the
 * pack as up to date forever.
 *
 * These tests run the real scripts through a real symlink. The last one is the
 * sweep: no file in the pack may go back to comparing an as-typed path.
 */

const REPO = fileURLToPath(new URL('../', import.meta.url));
const SOURCE = 'example-owner/example-pack';

/**
 * A temp directory holding a symlink to one shippable unit of the pack — a skill
 * directory, the adapters directory — and the script's path as reached THROUGH it.
 * The unit is symlinked whole, not the single file, because that is the shape the
 * Skills CLI creates and the shape that broke.
 */
async function throughSymlink(unitDir, relativeScript) {
  const root = await mkdtemp(path.join(tmpdir(), 'entrypoint-symlink-'));
  const link = path.join(root, path.basename(unitDir));
  await symlink(path.join(REPO, unitDir), link, 'dir');
  assert.ok((await lstat(link)).isSymbolicLink(), 'this filesystem did not create a symlink; the test would prove nothing');
  return {
    script: path.join(link, relativeScript),
    // The link is unlinked BEFORE the directory is removed. A recursive remove that
    // ever followed it would delete the checked-out pack, and no test is worth that.
    async cleanup() {
      await unlink(link);
      await rm(root, { recursive: true, force: true });
    },
  };
}

function run(script, argv, { env, stdin } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...argv], {
      stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      env: env ? { PATH: process.env.PATH, ...env } : process.env,
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    if (stdin !== undefined) child.stdin.end(stdin);
  });
}

const scratch = (prefix) => mkdtemp(path.join(tmpdir(), prefix));
/** What a silent no-op looks like, so a failure says so rather than printing two empty strings. */
const observed = (result) => `exit ${result.status}, stdout ${JSON.stringify(result.stdout)}, stderr ${JSON.stringify(result.stderr)}`;

test('the freshness-hook installer installs through a symlink, the path the Skills CLI creates', async () => {
  const linked = await throughSymlink('skills/update-agent-skills', path.join('scripts', 'install-freshness-hook.mjs'));
  const settings = path.join(await scratch('entrypoint-settings-'), 'settings.json');
  try {
    const result = await run(linked.script, ['--mode', 'notify', '--source', SOURCE, '--settings', settings]);

    assert.match(result.stdout, /Installed the notify freshness hook/, `the installer printed nothing: ${observed(result)}`);
    assert.equal(result.status, 0, result.stderr);
    const written = JSON.parse(await readFile(settings, 'utf8'));
    const hooks = (written.hooks?.SessionStart ?? []).flatMap((group) => group.hooks ?? []);
    assert.equal(hooks.length, 1, 'the settings file was not written through the symlinked path');
    assert.match(hooks[0].command, /check-pack-freshness\.mjs/);
  } finally {
    await linked.cleanup();
  }
});

test('the freshness checker still reports through a symlink, where silence would read as current', async () => {
  const linked = await throughSymlink('skills/update-agent-skills', path.join('scripts', 'check-pack-freshness.mjs'));
  // No lockfile under this state home, so the verdict is `unknown` — reached without a
  // network call, and the verdict that matters here: unknown printed is a warning, and
  // unknown swallowed is indistinguishable from a pack that is up to date.
  const stateHome = await scratch('entrypoint-state-');
  try {
    const result = await run(linked.script, ['--source', SOURCE], { env: { XDG_STATE_HOME: stateHome } });

    assert.match(result.stdout, /PACK_FRESHNESS_UNKNOWN/, `the checker said nothing at all, which this pack reads as current: ${observed(result)}`);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await linked.cleanup();
  }
});

test('the progress gate arms through a symlink', async () => {
  const linked = await throughSymlink('adapters/claude-code', 'report-progress-gate.mjs');
  const markers = await scratch('entrypoint-markers-');
  try {
    const dispatch = JSON.stringify({
      hook_event_name: 'PostToolUse',
      session_id: 'sess-symlink',
      tool_name: 'Agent',
      tool_input: { description: 'Reply with done', subagent_type: 'general-purpose', run_in_background: false },
    });
    const result = await run(linked.script, [], {
      env: { AGENT_SKILLS_PROGRESS_GATE: 'block', AGENT_SKILLS_PROGRESS_GATE_DIR: markers },
      stdin: dispatch,
    });

    assert.equal(result.status, 0, result.stderr);
    // A gate that never ran writes no marker, and a gate with no marker blocks nothing
    // for the rest of the session — it is off while reporting that it is installed.
    assert.equal((await readdir(markers)).length, 1, `the dispatch was not recorded: ${observed(result)}`);
  } finally {
    await linked.cleanup();
  }
});

test('the progress-gate installer writes settings through a symlink', async () => {
  const linked = await throughSymlink('adapters/claude-code', 'install-report-progress-gate.mjs');
  const settings = path.join(await scratch('entrypoint-settings-'), 'settings.json');
  try {
    const result = await run(linked.script, ['--mode', 'block', '--settings', settings]);

    assert.match(result.stdout, /Installed the block report-progress gate/, `the installer printed nothing: ${observed(result)}`);
    assert.equal(result.status, 0, result.stderr);
    const written = JSON.parse(await readFile(settings, 'utf8'));
    assert.ok(written.hooks?.Stop?.length > 0, 'the settings file was not written through the symlinked path');
  } finally {
    await linked.cleanup();
  }
});

test('the journal CLI installer writes its command through a symlink', async () => {
  const linked = await throughSymlink('skills/decision-journal', path.join('scripts', 'install-cli.mjs'));
  const home = await scratch('entrypoint-home-');
  const binDir = path.join(home, 'bin');
  try {
    const result = await run(linked.script, ['--bin-dir', binDir], { env: { HOME: home, PATH: binDir } });

    assert.match(result.stdout, /Installed /, `the installer printed nothing: ${observed(result)}`);
    assert.equal(result.status, 0, result.stderr);
    const wrapper = await readFile(path.join(binDir, 'agent-journal'), 'utf8');
    assert.match(wrapper, /installed-by: decision-journal install-cli\.mjs/);
  } finally {
    await linked.cleanup();
  }
});

test('the journal bundle check reports through a symlink instead of passing by saying nothing', async () => {
  const linked = await throughSymlink('scripts', 'verify-journal-bundle.mjs');
  try {
    const result = await run(linked.script, []);

    assert.match(result.stdout, /Journal CLI bundle is current/, `a verifier that prints nothing and exits 0 is a verifier nobody ran: ${observed(result)}`);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await linked.cleanup();
  }
});

test('a path that cannot be resolved answers false rather than throwing at load', () => {
  // This runs at module load, before anything is in a try block, and every one of these
  // files is imported — by its own installer, and by the tests. A resolver that throws
  // there turns an import into a crash, so an unresolvable path falls back to comparing
  // the paths as given, which is false here, and never propagates.
  const missing = pathToFileURL(path.join(tmpdir(), 'entrypoint-guard-no-such-dir', 'gone.mjs')).href;
  assert.equal(isEntrypoint(missing), false);
});

// ---------------------------------------------------------------------------
// The sweep. Six files carried the same guard; only the ones above can be run in
// this suite, and one of them (verify-effective-uid.mjs) needs Linux and sudo.
// ---------------------------------------------------------------------------

function packScripts() {
  const roots = ['adapters', 'packages', 'scripts', 'skills'];
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.mjs') && statSync(full).size > 0) found.push(full);
    }
  };
  for (const root of roots) walk(path.join(REPO, root));
  return found;
}

test('no script in the pack decides it is the entrypoint by comparing an as-typed path', () => {
  const files = packScripts();
  assert.ok(files.length >= 7, 'the sweep found almost nothing, so it is sweeping the wrong tree');

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const where = path.relative(REPO, file);
    // Both forms of the defect. The first was in five files; the second, in
    // verify-effective-uid.mjs, additionally breaks on any path with a space.
    assert.ok(
      !/pathToFileURL\(process\.argv\[1\]\)\.href\s*===\s*import\.meta\.url/.test(text),
      `${where}: argv[1] keeps the symlink Node resolved away, so this is false whenever the pack is reached through one — and the script exits 0 having done nothing`,
    );
    assert.ok(
      !/import\.meta\.url\s*===\s*`file:\/\/\$\{process\.argv\[1\]\}`/.test(text),
      `${where}: same silent no-op through a symlink, plus a path with a space never matches at all`,
    );
    // Whatever replaces them must resolve both sides: --preserve-symlinks-main
    // moves the unresolved path to the other side of the comparison.
    if (/process\.argv\[1\]/.test(text) && /import\.meta\.url/.test(text)) {
      assert.match(text, /realpathSync\.native/, `${where}: compares argv[1] with import.meta.url without resolving either to a real path`);
    }
  }
});
