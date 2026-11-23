import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers/temp-dir.mjs';

const dir = fileURLToPath(new URL('../skills/manage-workspace/scripts/', import.meta.url));
const leftovers = path.join(dir, 'leftovers.mjs');
const setup = path.join(dir, 'setup-enforcement.mjs');
const { extract, tokenize } = await import(leftovers);

async function sandbox() {
  const root = await tempDir('mws-enforce-');
  const home = path.join(root, 'home dir');
  mkdirSync(home, { recursive: true });
  // a fixed, healthy memory reading, so a test never depends on how full the machine running it is
  const fixture = path.join(root, 'machine.json');
  writeFileSync(fixture, JSON.stringify({ memory: { platform: 'darwin', ramMiB: 36864, freePct: 55, swapUsedMiB: 900, swapTotalMiB: 2048 } }));
  const env = { ...process.env, HOME: home, MWS_STATE_DIR: path.join(home, 'state'), MWS_CONFIG_DIR: path.join(home, 'config'), XDG_DATA_HOME: path.join(home, 'data'), MWS_MACHINE_FIXTURE: fixture };
  delete env.MWS_CLEANUP_MODE; delete env.MWS_HELPERS; delete env.CLAUDE_CONFIG_DIR; delete env.CODEX_HOME;
  const hook = (event, input, extra = {}) => spawnSync(process.execPath, [leftovers, event], { input: JSON.stringify(input), encoding: 'utf8', env: { ...env, ...extra } });
  const cli = (...args) => spawnSync(process.execPath, [setup, ...args], { encoding: 'utf8', env });
  return { root, home, env, hook, cli };
}

const claudeLine = (command) => JSON.stringify({ type: 'assistant', cwd: '/work/repo', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } });
const codexLine = (command) => JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: command }) } });

test('the command reader finds what a session creates, and not what it only reads', () => {
  const found = (text) => extract(text, '/work/repo').found.map((c) => `${c.kind}:${c.key}`);
  assert.deepEqual(found('git worktree add -b feat /tmp/wt1 main'), ['worktree:/tmp/wt1']);
  assert.deepEqual(found('git -C /work/repo worktree add ../wt2'), ['worktree:/work/wt2']);
  assert.deepEqual(found('docker run -d --name web nginx && tart clone base vm1 && tart run vm1'), ['container:web', 'vm:vm1', 'vm:vm1']);
  assert.deepEqual(found('docker run --rm alpine true'), []);
  assert.deepEqual(found('mkdir -p /tmp/a/b && cp x /tmp/a/b/y && ls /tmp/other'), ['path:/tmp/a/b', 'path:/tmp/a/b/y']);
  assert.deepEqual(found('curl -o /tmp/dl.zip https://example.test/x'), ['path:/tmp/dl.zip']);
  assert.deepEqual(found('XDG_CACHE_HOME=/tmp/c1 npm ci > /tmp/log.txt'), ['path:/tmp/c1', 'path:/tmp/log.txt']);
  assert.deepEqual(found('mkdir build && cp a b && rm -rf /tmp/gone'), []);
  assert.equal(tokenize('echo "a b" \'c d\' ; ls').length, 2);
});

test('the stop check flags only what this session created and still left, and is quiet otherwise', async () => {
  const { root, hook, env } = await sandbox();
  const mine = path.join(root, 'mine'); const other = path.join(root, 'someone-elses'); const gone = path.join(root, 'gone');
  for (const d of [mine, other]) mkdirSync(d);
  const transcript = path.join(root, 'session.jsonl');
  writeFileSync(transcript, `${claudeLine(`mkdir -p ${mine} ${gone}`)}\n${JSON.stringify({ type: 'user', message: 'hi' })}\n`);
  const input = { session_id: 's1', transcript_path: transcript, hook_event_name: 'Stop' };

  const started = Date.now();
  const first = hook('stop', input);
  assert.ok(Date.now() - started < 2000, 'the check stays well under two seconds');
  assert.equal(first.status, 0, first.stderr);
  const message = JSON.parse(first.stdout).systemMessage;
  assert.match(message, /Clean-up reminder/);
  assert.ok(message.includes(mine));
  assert.ok(!message.includes(other), "another session's folder is never flagged");
  assert.ok(!message.includes(gone), 'a folder that no longer exists is not flagged');

  assert.equal(hook('stop', input).stdout, '', 'the same leftovers are not repeated every turn');

  writeFileSync(transcript, `${readFileSync(transcript, 'utf8')}${claudeLine(`mkdir ${other}-new`)}\n`);
  mkdirSync(`${other}-new`);
  assert.ok(JSON.parse(hook('stop', input).stdout).systemMessage.includes(`${other}-new`), 'a new leftover is reported');

  const keep = (target) => spawnSync(process.execPath, [leftovers, 'keep', '--session', 's1', '--path', target, '--reason', 'owned elsewhere'], { env, encoding: 'utf8' });
  assert.equal(keep(mine).status, 0);
  assert.equal(keep(`${other}-new`).status, 0);
  assert.equal(hook('stop', input).stdout, '', 'an item kept with a reason is no longer flagged');
  assert.equal(spawnSync(process.execPath, [leftovers, 'keep', '--session', 's1'], { env, encoding: 'utf8' }).status, 2, 'keep needs a path');
});

test('block mode stops the turn once per set of leftovers, and never loops', async () => {
  const { root, hook } = await sandbox();
  const left = path.join(root, 'left'); mkdirSync(left);
  const transcript = path.join(root, 's.jsonl');
  writeFileSync(transcript, `${codexLine(`mkdir -p ${left}`)}\n`);
  const input = { session_id: 'c1', transcript_path: transcript, hook_event_name: 'Stop', stop_hook_active: false };
  const blocked = JSON.parse(hook('stop', input, { MWS_CLEANUP_MODE: 'block' }).stdout);
  assert.equal(blocked.decision, 'block');
  assert.ok(blocked.reason.includes(left));
  assert.equal(hook('stop', { ...input, stop_hook_active: true }, { MWS_CLEANUP_MODE: 'block' }).stdout, '', 'a continued turn is not blocked again');
  assert.equal(hook('stop', input, { MWS_CLEANUP_MODE: 'block' }).stdout, '', 'the same set is not blocked twice');
  assert.equal(hook('stop', input, { MWS_CLEANUP_MODE: 'off' }).stdout, '');
});

test('a worktree is read from a Codex transcript and cleared once removed', async () => {
  const { root, hook } = await sandbox();
  const wt = path.join(root, 'wt'); mkdirSync(wt);
  const transcript = path.join(root, 'r.jsonl');
  writeFileSync(transcript, `${codexLine(`git worktree add ${wt} -b feat`)}\n`);
  const input = { session_id: 'w1', transcript_path: transcript, hook_event_name: 'Stop' };
  assert.match(JSON.parse(hook('stop', input).stdout).systemMessage, /worktree/);
  assert.equal(spawnSync('rmdir', [wt]).status, 0);
  assert.equal(hook('stop', input).stdout, '');
});

test('the session-start hook injects the policy in the form both harnesses read', async () => {
  const { hook } = await sandbox();
  const out = JSON.parse(hook('session-start', { session_id: 'abc', hook_event_name: 'SessionStart' }).stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(out.hookSpecificOutput.additionalContext, /--session abc/);
  assert.match(out.hookSpecificOutput.additionalContext, /git worktree remove/);
  assert.equal(hook('session-start', { session_id: 'abc' }, { MWS_CLEANUP_MODE: 'off' }).stdout, '');
  assert.equal(hook('stop', {}, {}).stdout, '', 'a payload with no session is ignored');
  assert.equal(hook('stop', { session_id: 'x', transcript_path: '/nonexistent/file' }).status, 0);
});

test('setup previews by default, merges without touching existing hooks, and removes only its own', async () => {
  const { home, cli } = await sandbox();
  mkdirSync(path.join(home, '.claude')); mkdirSync(path.join(home, '.codex'));
  const claude = path.join(home, '.claude', 'settings.json'); const codex = path.join(home, '.codex', 'hooks.json');
  const existing = { env: { A: '1' }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'other-stop', timeout: 10 }] }], SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'other-start' }] }] } };
  writeFileSync(claude, `${JSON.stringify(existing, null, 2)}\n`);
  writeFileSync(codex, `${JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'guard' }] }] } }, null, 2)}\n`);
  const before = [readFileSync(claude, 'utf8'), readFileSync(codex, 'utf8')];

  const preview = cli();
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /add Stop entry/);
  assert.deepEqual([readFileSync(claude, 'utf8'), readFileSync(codex, 'utf8')], before, 'a preview writes nothing');

  const applied = cli('--yes');
  assert.equal(applied.status, 0, applied.stderr);
  const c = JSON.parse(readFileSync(claude, 'utf8'));
  assert.deepEqual(c.hooks.Stop[0], existing.hooks.Stop[0], 'existing entries keep their place');
  assert.equal(c.hooks.Stop.length, 2);
  assert.equal(c.hooks.SessionStart.length, 2);
  assert.equal(c.hooks.SessionEnd.length, 1, 'Claude Code also gets the end-of-session helper stop');
  assert.match(c.hooks.SessionEnd[0].hooks[0].command, /manage-workspace\/leftovers\.mjs" session-end/);
  assert.deepEqual(c.env, existing.env);
  const x = JSON.parse(readFileSync(codex, 'utf8'));
  assert.deepEqual(Object.keys(x.hooks).sort(), ['PreToolUse', 'SessionStart', 'Stop'], 'Codex gets no SessionEnd entry: not observed there yet');
  assert.equal(readFileSync(`${claude}.bak-manage-workspace`, 'utf8'), before[0]);
  assert.equal(readFileSync(`${codex}.bak-manage-workspace`, 'utf8'), before[1]);
  for (const f of ['leftovers.mjs', 'machine.mjs']) assert.ok(existsSync(path.join(home, 'data', 'manage-workspace', f)), f);
  assert.match(applied.stdout, /\/hooks in Codex/);

  const afterApply = [readFileSync(claude, 'utf8'), readFileSync(codex, 'utf8')];
  const again = cli('--yes');
  assert.match(again.stdout, /already up to date/);
  assert.deepEqual([readFileSync(claude, 'utf8'), readFileSync(codex, 'utf8')], afterApply, 'a second run changes nothing');

  // the installed hook command runs, including through a path with a space in it
  const command = c.hooks.SessionStart[1].hooks[0].command;
  const ran = spawnSync('/bin/sh', ['-c', command], { input: JSON.stringify({ session_id: 'q' }), encoding: 'utf8', env: process.env });
  assert.equal(JSON.parse(ran.stdout).hookSpecificOutput.hookEventName, 'SessionStart');

  const removed = cli('uninstall', '--yes');
  assert.equal(removed.status, 0, removed.stderr);
  assert.deepEqual(JSON.parse(readFileSync(claude, 'utf8')), existing);
  assert.deepEqual(JSON.parse(readFileSync(codex, 'utf8')), { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'guard' }] }] } });
  assert.ok(!existsSync(path.join(home, 'data', 'manage-workspace')));
});

test('setup skips an agent that is not installed, refuses invalid JSON, and sets the mode on request', async () => {
  const { home, cli, hook } = await sandbox();
  mkdirSync(path.join(home, '.codex'));
  writeFileSync(path.join(home, '.codex', 'hooks.json'), '{ broken');
  const bad = cli('--yes');
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /not valid JSON/);
  assert.equal(readFileSync(path.join(home, '.codex', 'hooks.json'), 'utf8'), '{ broken');
  assert.match(cli('--agent', 'claude').stdout, /Claude Code: not present/);
  assert.equal(cli('mode', 'block').stdout.includes('preview only'), true);
  assert.equal(cli('mode', 'block', '--yes').status, 0);
  assert.equal(hook('mode', {}).stdout.trim(), 'block');
  assert.equal(cli('mode', 'loud').status, 2);
});

test('status reads Codex trust from config.toml by hook key, and says nothing about other hooks', async () => {
  const { home, cli } = await sandbox();
  mkdirSync(path.join(home, '.codex'));
  const hooks = path.join(home, '.codex', 'hooks.json');
  writeFileSync(hooks, `${JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'other-start' }] }] } }, null, 2)}\n`);
  assert.equal(cli('--yes').status, 0);
  // our SessionStart entry is group 1, hook 0; our Stop entry is group 0, hook 0
  assert.match(cli('status').stdout, /Codex trust: SessionStart not trusted; Stop not trusted/);
  const hash = `sha256:${'a'.repeat(64)}`;
  writeFileSync(path.join(home, '.codex', 'config.toml'), [
    '[hooks.state]', '',
    `[hooks.state."${hooks}:session_start:0:0"]`, `trusted_hash = "${hash}"`, '',
    `[hooks.state."${hooks}:session_start:1:0"]`, 'enabled = true', '',
    `[hooks.state."${hooks}:stop:0:0"]`, 'enabled = true', `trusted_hash = "${hash}"`, '',
  ].join('\n'));
  assert.match(cli('status').stdout, /Codex trust: SessionStart not trusted; Stop trusted/, 'a hash on another hook, or none on this one, does not count');
  writeFileSync(path.join(home, '.codex', 'config.toml'), `[hooks.state."${hooks}:session_start:1:0"]\ntrusted_hash = "${hash}"\n[hooks.state."${hooks}:stop:0:0"]\ntrusted_hash = "${hash}"\n`);
  assert.match(cli('status').stdout, /Codex trust: SessionStart trusted; Stop trusted/);
});

test('the Codex note says trust is per machine and needed again when a command changes', async () => {
  const { home, cli } = await sandbox();
  mkdirSync(path.join(home, '.codex'));
  const out = cli('--yes').stdout;
  assert.match(out, /\/hooks in Codex/);
  assert.match(out, /per machine/);
  assert.match(out, /again whenever a hook command changes/);
});

const skillDir = fileURLToPath(new URL('../skills/manage-workspace/', import.meta.url));
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const skillText = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
const guide = readFileSync(path.join(skillDir, 'references/enforcement.md'), 'utf8').replace(/\s+/g, ' ');
const readme = read('../README.md');
const readmeEntry = readme.slice(readme.indexOf('### `manage-workspace`'), readme.indexOf('### `onboard-project`'));

test('SKILL.md carries the install-or-update procedure an agent follows end to end', () => {
  assert.match(skillText, /^name: manage-workspace$/m);
  assert.match(skillText, /version=2\.0\.0/);
  const s = skillText.slice(skillText.indexOf('## Install or update (agents)'), skillText.indexOf('## Usage Examples'));
  assert.ok(s.length > 300, 'section present');
  for (const re of [/--agent claude-code/, /--agent codex/, /--global/, /setup-enforcement\.mjs/, /--yes/, /\/hooks/, /trusted_hash/, /already up to date/, /explicit/i, /references\/enforcement\.md/]) assert.match(s, re);
  assert.match(s, /never .*--dangerously-bypass-hook-trust/is);
  assert.match(skillText, /\[the enforcement guide\]\(references\/enforcement\.md\)/);
  assert.ok(skillText.split('\n').length <= 484);
});

test('the enforcement guide states Codex trust is per machine, and gives both ways to trust', () => {
  assert.match(guide, /per machine/i);
  assert.match(guide, /command changes/i);
  assert.match(guide, /## Trusting the hooks in Codex/);
  assert.match(guide, /`\/hooks`/);
  assert.match(guide, /press `t`/);
  assert.match(guide, /## Guarded self-approval/);
  for (const re of [/bypasses Codex's review step/, /machine owner's own setup/, /Codex update can break it/, /explicitly authoris/i, /github\.com\/openai\/codex/, /exact match/, /never write an unproven value/i, /--dangerously-bypass-hook-trust/, /auth\.json/, /needing review|needs review/i]) assert.match(guide, re);
});

test('the README entry has a pasteable, machine-agnostic bootstrap prompt pinned to the release', () => {
  assert.match(readmeEntry, /#### Install or update with an agent/);
  const prompt = readmeEntry.slice(readmeEntry.indexOf('#### Install or update with an agent'), readmeEntry.indexOf('More:'));
  assert.match(prompt, /```text/);
  assert.match(prompt, /crissmoldovan\/agent-skills#v0\.35\.0/);
  for (const re of [/codex --version/, /codex features list/, /--agent codex/, /--agent claude-code/, /--global/, /--copy/, /setup-enforcement\.mjs/, /status/, /already up to date/, /session-start/, /\/hooks/]) assert.match(prompt, re);
  assert.doesNotMatch(prompt, /\/Users\/|linear|@[a-z0-9-]+\.(com|dev)|token|secret/i);
  assert.doesNotMatch(readmeEntry, /review the new hooks once|trust .* once/i, 'trust is not "once"');
  assert.match(readmeEntry, /per machine/);
  assert.match(readmeEntry, /npx skills update manage-workspace --global --yes/, 'the human commands stay');
  assert.match(readmeEntry, /npx skills remove manage-workspace-storage --global --yes/, 'the switch from the old name is spelled out');
  assert.match(prompt, /manage-workspace-storage/, 'the bootstrap prompt retires the old name');
});

test('CONTRIBUTING lets the setup script run on request and self-approval only with the owner explicit authorisation', () => {
  const c = read('../CONTRIBUTING.md');
  assert.match(c, /No skill installs one/);
  assert.match(c, /`manage-workspace` alone/);
  assert.doesNotMatch(c, /manage-workspace-storage/, 'CONTRIBUTING names the skill by its new name only');
  assert.match(c, /explicitly asks to install or update (that|the) skill/);
  assert.match(c, /explicit authorisation in the request/);
});

test('setup migrates an install made under the old name, without duplicating a hook', async () => {
  const { home, cli, env } = await sandbox();
  mkdirSync(path.join(home, '.claude')); mkdirSync(path.join(home, '.codex'));
  const claude = path.join(home, '.claude', 'settings.json'); const codex = path.join(home, '.codex', 'hooks.json');
  // the exact command 1.1.0 and 1.2.0 wrote
  const legacyCommand = (script, event) => `if [ -x "${process.execPath}" ]; then exec "${process.execPath}" "${script}" ${event}; else exec node "${script}" ${event}; fi`;
  const legacy = (event) => ({ type: 'command', command: legacyCommand(path.join(home, 'data', 'manage-workspace-storage', 'leftovers.mjs'), event), timeout: 10 });
  writeFileSync(claude, `${JSON.stringify({ hooks: { SessionStart: [{ matcher: 'startup|resume|clear|compact', hooks: [legacy('session-start')] }], Stop: [{ hooks: [{ type: 'command', command: 'other-stop' }] }, { hooks: [legacy('stop')] }] } }, null, 2)}\n`);
  // as 1.1.0 and 1.2.0 wrote it for Codex too: the same matcher
  writeFileSync(codex, `${JSON.stringify({ hooks: { SessionStart: [{ matcher: 'startup|resume|clear|compact', hooks: [legacy('session-start')] }], Stop: [{ hooks: [legacy('stop')] }] } }, null, 2)}\n`);
  const oldData = path.join(home, 'data', 'manage-workspace-storage'); mkdirSync(oldData, { recursive: true });
  writeFileSync(path.join(oldData, 'leftovers.mjs'), '// 1.2.0\n');
  const oldState = path.join(home, 'old-state', 'manage-workspace-storage'); mkdirSync(path.join(oldState, 'ledger'), { recursive: true });
  writeFileSync(path.join(oldState, 'ledger', 's1.jsonl'), '{"op":"note","kind":"path","path":"/tmp/x"}\n');
  const oldConfig = path.join(home, 'old-config', 'manage-workspace-storage'); mkdirSync(oldConfig, { recursive: true });
  writeFileSync(path.join(oldConfig, 'mode'), 'block\n');
  const migrateEnv = { ...env, XDG_STATE_HOME: path.join(home, 'old-state'), XDG_CONFIG_HOME: path.join(home, 'old-config') };
  delete migrateEnv.MWS_STATE_DIR; delete migrateEnv.MWS_CONFIG_DIR;
  const run = (...args) => spawnSync(process.execPath, [setup, ...args], { encoding: 'utf8', env: migrateEnv });

  const preview = run();
  assert.match(preview.stdout, /update SessionStart entry/);
  assert.match(preview.stdout, /would move/);
  const applied = run('--yes');
  assert.equal(applied.status, 0, applied.stderr);
  const c = JSON.parse(readFileSync(claude, 'utf8'));
  assert.equal(c.hooks.SessionStart.length, 1, 'the old entry is rewritten in place, not added beside');
  assert.equal(c.hooks.SessionStart[0].matcher, 'startup|resume|clear|compact|fork', 'and its matcher gains Codex forks');
  assert.equal(c.hooks.Stop.length, 2);
  assert.equal(c.hooks.Stop[0].hooks[0].command, 'other-stop', 'other hooks keep their place');
  for (const e of ['SessionStart', 'Stop', 'SessionEnd']) assert.match(JSON.stringify(c.hooks[e]), /manage-workspace\/leftovers\.mjs/);
  assert.doesNotMatch(JSON.stringify(c.hooks), /manage-workspace-storage/);
  assert.doesNotMatch(readFileSync(codex, 'utf8'), /manage-workspace-storage/);
  assert.match(applied.stdout, /trust .* again|again whenever a hook command changes/i);
  // state and mode move to the new name; the old script path keeps working for sessions that started before
  assert.ok(existsSync(path.join(home, 'old-state', 'manage-workspace', 'ledger', 's1.jsonl')));
  assert.ok(!existsSync(oldState));
  assert.equal(readFileSync(path.join(home, 'old-config', 'manage-workspace', 'mode'), 'utf8').trim(), 'block');
  const shim = spawnSync(process.execPath, [path.join(oldData, 'leftovers.mjs'), 'version'], { encoding: 'utf8', env: migrateEnv });
  assert.equal(shim.stdout.trim(), '2.0.0', 'the old path now runs the new script');
  assert.match(run('status').stdout, /old path kept for sessions started before the rename/);
  assert.match(run('--yes').stdout, /already up to date/);

  assert.equal(run('uninstall', '--yes').status, 0);
  assert.ok(!existsSync(oldData) && !existsSync(path.join(home, 'data', 'manage-workspace')));
  assert.doesNotMatch(readFileSync(claude, 'utf8'), /leftovers\.mjs/);
});

test('the helpers switch is set by setup and read by the hooks', async () => {
  const { cli, hook } = await sandbox();
  assert.match(cli('helpers', 'report').stdout, /preview only/);
  assert.equal(cli('helpers', 'report', '--yes').status, 0);
  assert.equal(hook('helpers', {}).stdout.trim(), 'report');
  assert.equal(cli('helpers', 'sometimes').status, 2);
});

test('the skill documents processes and memory, and says free percentage ignores swap', () => {
  const procs = readFileSync(path.join(skillDir, 'references/processes.md'), 'utf8').replace(/\s+/g, ' ');
  for (const re of [/kern\.memorystatus_level/, /swap/, /quarter of (physical memory|RAM)/, /CODEX_COMPANION_SESSION_ID/, /SessionEnd/, /never stop/i, /resident/i]) assert.match(procs, re);
  assert.match(skillText, /\[the process and memory guide\]\(references\/processes\.md\)/);
  assert.match(skillText, /memory --need-mib/);
  assert.match(guide, /SessionEnd/);
  assert.match(guide, /Claude Code only/i);
  assert.match(guide, /report.*stops nothing|stop nothing/i);
  assert.match(skillText, /formerly `manage-workspace-storage`|Formerly manage-workspace-storage/i);
});

test('setup writes nothing when one agent file is invalid, even if another is fine', async () => {
  const { home, cli } = await sandbox();
  mkdirSync(path.join(home, '.claude')); mkdirSync(path.join(home, '.codex'));
  const claude = path.join(home, '.claude', 'settings.json');
  writeFileSync(claude, `${JSON.stringify({ hooks: {} }, null, 2)}\n`);
  writeFileSync(path.join(home, '.codex', 'hooks.json'), '{ broken');
  const before = readFileSync(claude, 'utf8');
  const r = cli('--yes');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /nothing was written/);
  assert.equal(readFileSync(claude, 'utf8'), before, 'Claude Code settings untouched');
  assert.ok(!existsSync(path.join(home, 'data', 'manage-workspace')), 'no script copy either');
});

test('uninstall for one agent keeps the shared scripts while the other still uses them', async () => {
  const { home, cli } = await sandbox();
  mkdirSync(path.join(home, '.claude')); mkdirSync(path.join(home, '.codex'));
  assert.equal(cli('--yes').status, 0);
  const r = cli('uninstall', '--agent', 'codex', '--purge', '--yes');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Claude Code still has clean-up hooks/);
  assert.ok(existsSync(path.join(home, 'data', 'manage-workspace', 'leftovers.mjs')), 'Claude Code hooks still have their script');
  assert.doesNotMatch(readFileSync(path.join(home, '.codex', 'hooks.json'), 'utf8'), /leftovers\.mjs/);
  assert.equal(cli('uninstall', '--yes').status, 0);
  assert.ok(!existsSync(path.join(home, 'data', 'manage-workspace')));
});

test('a hook a person wrote that runs the script is never claimed, rewritten or removed', async () => {
  const { home, cli } = await sandbox();
  mkdirSync(path.join(home, '.claude'));
  const claude = path.join(home, '.claude', 'settings.json');
  const theirs = { type: 'command', command: `node "${path.join(home, 'data', 'manage-workspace', 'leftovers.mjs')}" stop && echo audit >> /tmp/audit.log` };
  writeFileSync(claude, `${JSON.stringify({ hooks: { Stop: [{ hooks: [theirs] }] } }, null, 2)}\n`);
  assert.equal(cli('--yes').status, 0);
  const c = JSON.parse(readFileSync(claude, 'utf8'));
  assert.deepEqual(c.hooks.Stop[0].hooks[0], theirs, 'theirs is left as it was');
  assert.equal(c.hooks.Stop.length, 2, 'ours is added beside it');
  assert.equal(cli('uninstall', '--yes').status, 0);
  assert.deepEqual(JSON.parse(readFileSync(claude, 'utf8')).hooks.Stop, [{ hooks: [theirs] }]);
});

test('migration joins an old ledger into a new one, and refreshes an old script under another data folder', async () => {
  const { home, env } = await sandbox();
  mkdirSync(path.join(home, '.claude'));
  const otherData = path.join(home, 'elsewhere', 'manage-workspace-storage'); mkdirSync(otherData, { recursive: true });
  writeFileSync(path.join(otherData, 'leftovers.mjs'), '// 1.2.0\n');
  const script = path.join(otherData, 'leftovers.mjs');
  const cmd = (event) => `if [ -x "${process.execPath}" ]; then exec "${process.execPath}" "${script}" ${event}; else exec node "${script}" ${event}; fi`;
  writeFileSync(path.join(home, '.claude', 'settings.json'), `${JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: cmd('stop'), timeout: 10 }] }] } }, null, 2)}\n`);
  const state = path.join(home, 'st');
  mkdirSync(path.join(state, 'manage-workspace-storage', 'ledger'), { recursive: true });
  mkdirSync(path.join(state, 'manage-workspace', 'ledger'), { recursive: true });
  writeFileSync(path.join(state, 'manage-workspace-storage', 'ledger', 's1.jsonl'), '{"op":"note","kind":"path","path":"/tmp/old"}\n');
  writeFileSync(path.join(state, 'manage-workspace', 'ledger', 's1.jsonl'), '{"op":"note","kind":"path","path":"/tmp/new"}\n');
  const e2 = { ...env, XDG_STATE_HOME: state }; delete e2.MWS_STATE_DIR;
  const r = spawnSync(process.execPath, [setup, '--yes'], { encoding: 'utf8', env: e2 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ledgers joined/);
  assert.equal(readFileSync(path.join(state, 'manage-workspace', 'ledger', 's1.jsonl'), 'utf8'), '{"op":"note","kind":"path","path":"/tmp/old"}\n{"op":"note","kind":"path","path":"/tmp/new"}\n', 'old entries first');
  assert.ok(!existsSync(path.join(state, 'manage-workspace-storage')));
  assert.equal(spawnSync(process.execPath, [script, 'version'], { encoding: 'utf8' }).stdout.trim(), '2.0.0', 'the old path under the other data folder runs the new script');
});

test('memory changing state does not repeat a leftover reminder or block the turn again', async () => {
  const { root, hook, env } = await sandbox();
  const left = path.join(root, 'left2'); mkdirSync(left);
  const transcript = path.join(root, 'm.jsonl'); writeFileSync(transcript, `${claudeLine(`mkdir -p ${left}`)}\n`);
  const input = { session_id: 'mem1', transcript_path: transcript, hook_event_name: 'Stop', stop_hook_active: false };
  const lowFile = path.join(root, 'low.json');
  writeFileSync(lowFile, JSON.stringify({ memory: { platform: 'darwin', ramMiB: 36864, freePct: 42, swapUsedMiB: 19300, swapTotalMiB: 20480 } }));
  const first = JSON.parse(hook('stop', input, { MWS_CLEANUP_MODE: 'block' }).stdout);
  assert.equal(first.decision, 'block');
  const low = hook('stop', input, { MWS_CLEANUP_MODE: 'block', MWS_MACHINE_FIXTURE: lowFile }).stdout;
  assert.ok(!low.includes('"decision"'), 'memory falling low does not block again');
  assert.match(JSON.parse(low).systemMessage, /Memory is low/);
  assert.doesNotMatch(JSON.parse(low).systemMessage, /Clean-up reminder/, 'and does not repeat the leftovers');
  assert.equal(hook('stop', input, { MWS_CLEANUP_MODE: 'block', MWS_MACHINE_FIXTURE: lowFile }).stdout, '', 'low memory is said once');
  assert.equal(hook('stop', input, { MWS_CLEANUP_MODE: 'block', MWS_MACHINE_FIXTURE: env.MWS_MACHINE_FIXTURE }).stdout, '', 'recovering is quiet too');
});

test('round three: setup refuses a hooks array, claims no entry whose two node paths differ, and keeps scripts a person\'s hook runs', async () => {
  const { home, cli } = await sandbox();
  mkdirSync(path.join(home, '.claude'));
  const claude = path.join(home, '.claude', 'settings.json');
  writeFileSync(claude, '{"hooks": []}\n');
  const bad = cli('--yes');
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /"hooks" is not an object/);
  assert.equal(readFileSync(claude, 'utf8'), '{"hooks": []}\n');

  const script = path.join(home, 'data', 'manage-workspace', 'leftovers.mjs');
  const odd = { type: 'command', command: `if [ -x "/usr/bin/true" ]; then exec "${process.execPath}" "${script}" stop; else exec node "${script}" stop; fi` };
  writeFileSync(claude, `${JSON.stringify({ hooks: { Stop: [{ hooks: [odd] }] } }, null, 2)}\n`);
  assert.equal(cli('--yes').status, 0);
  const c = JSON.parse(readFileSync(claude, 'utf8'));
  assert.deepEqual(c.hooks.Stop[0].hooks[0], odd, 'not the shape setup writes, so not claimed');
  assert.equal(c.hooks.Stop.length, 2);
  assert.equal(cli('uninstall', '--yes').status, 0);
  assert.ok(existsSync(script), 'a hook still runs the script, so it stays');
});

test('round three: ledgers are joined in time order', async () => {
  const { home, env } = await sandbox();
  mkdirSync(path.join(home, '.claude'));
  const state = path.join(home, 'st3');
  mkdirSync(path.join(state, 'manage-workspace-storage', 'ledger'), { recursive: true });
  mkdirSync(path.join(state, 'manage-workspace', 'ledger'), { recursive: true });
  writeFileSync(path.join(state, 'manage-workspace', 'ledger', 's.jsonl'), '{"ts":"2026-11-23T01:00:00Z","op":"note","kind":"path","path":"/tmp/a"}\n');
  writeFileSync(path.join(state, 'manage-workspace-storage', 'ledger', 's.jsonl'), '{"ts":"2026-11-23T02:00:00Z","op":"keep","kind":"path","path":"/tmp/a","reason":"r"}\n');
  const e2 = { ...env, XDG_STATE_HOME: state }; delete e2.MWS_STATE_DIR;
  assert.equal(spawnSync(process.execPath, [setup, '--yes'], { encoding: 'utf8', env: e2 }).status, 0);
  const lines = readFileSync(path.join(state, 'manage-workspace', 'ledger', 's.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).op);
  assert.deepEqual(lines, ['note', 'keep'], 'the later keep still follows its note');
});

test('the generated command copied into another event is a person\'s hook and is never removed', async () => {
  const { home, cli } = await sandbox();
  mkdirSync(path.join(home, '.claude'));
  const claude = path.join(home, '.claude', 'settings.json');
  assert.equal(cli('--yes').status, 0);
  const c = JSON.parse(readFileSync(claude, 'utf8'));
  const copied = { matcher: 'Bash', hooks: [{ ...c.hooks.Stop[0].hooks[0], timeout: 5 }] };
  c.hooks.PreToolUse = [copied];
  writeFileSync(claude, `${JSON.stringify(c, null, 2)}\n`);
  assert.equal(cli('uninstall', '--yes').status, 0);
  assert.deepEqual(JSON.parse(readFileSync(claude, 'utf8')).hooks.PreToolUse, [copied]);
});

test('round four: the matcher covers Codex forks, a personal group is never claimed, and a hook running the script by args keeps it', async () => {
  const { home, cli } = await sandbox();
  mkdirSync(path.join(home, '.claude'));
  const claude = path.join(home, '.claude', 'settings.json');
  assert.equal(cli('--yes').status, 0);
  let c = JSON.parse(readFileSync(claude, 'utf8'));
  assert.equal(c.hooks.SessionStart[0].matcher, 'startup|resume|clear|compact|fork');
  const ourCommand = c.hooks.SessionStart[0].hooks[0].command;
  const personal = { matcher: 'resume', hooks: [{ type: 'command', command: ourCommand }] };
  const execForm = { hooks: [{ type: 'command', command: 'node', args: [path.join(home, 'data', 'manage-workspace', 'leftovers.mjs'), 'list'] }] };
  c.hooks.SessionStart.push(personal); c.hooks.UserPromptSubmit = [execForm];
  writeFileSync(claude, `${JSON.stringify(c, null, 2)}\n`);
  assert.match(cli('--yes').stdout, /already up to date/, 'the personal resume group is not taken for ours');
  assert.equal(cli('uninstall', '--yes').status, 0);
  c = JSON.parse(readFileSync(claude, 'utf8'));
  assert.deepEqual(c.hooks.SessionStart, [personal], 'only the stock entry was removed');
  assert.ok(existsSync(path.join(home, 'data', 'manage-workspace', 'leftovers.mjs')), 'scripts stay while a hook runs them by args or command');
});

test('round five: a hook with extra fields is a person\'s, a cd then a relative path keeps the scripts, and a user file survives uninstall', async () => {
  const { home, cli } = await sandbox();
  mkdirSync(path.join(home, '.claude'));
  const claude = path.join(home, '.claude', 'settings.json');
  assert.equal(cli('--yes').status, 0);
  const c = JSON.parse(readFileSync(claude, 'utf8'));
  const asyncCopy = { hooks: [{ ...c.hooks.Stop[0].hooks[0], async: true, timeout: 45 }] };
  writeFileSync(claude, `${JSON.stringify({ hooks: { ...c.hooks, Stop: [asyncCopy, ...c.hooks.Stop] } }, null, 2)}\n`);
  assert.match(cli('--yes').stdout, /already up to date/, 'the async copy is not taken for ours');
  assert.equal(cli('uninstall', '--yes').status, 0);
  assert.deepEqual(JSON.parse(readFileSync(claude, 'utf8')).hooks.Stop, [asyncCopy], 'and uninstall leaves it');
  assert.ok(existsSync(path.join(home, 'data', 'manage-workspace', 'leftovers.mjs')), 'it runs the script, so the script stays');

  writeFileSync(claude, `${JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: `cd "${path.join(home, 'data', 'manage-workspace')}" && node leftovers.mjs list` }] }] } }, null, 2)}\n`);
  assert.equal(cli('uninstall', '--yes').status, 0);
  assert.ok(existsSync(path.join(home, 'data', 'manage-workspace', 'leftovers.mjs')), 'a cd then a relative path still counts as a user');

  writeFileSync(claude, '{}\n');
  writeFileSync(path.join(home, 'data', 'manage-workspace', 'my-wrapper.sh'), 'echo mine\n');
  const r = cli('uninstall', '--yes');
  assert.equal(r.status, 0);
  assert.ok(existsSync(path.join(home, 'data', 'manage-workspace', 'my-wrapper.sh')), 'a file the skill did not write is kept');
  assert.ok(!existsSync(path.join(home, 'data', 'manage-workspace', 'leftovers.mjs')), 'its own scripts are removed');
  assert.match(r.stdout, /holds files this skill did not write/);
});

test('round six: ownership needs the matching event and a timeout, a ; boundary counts, purge removes only its own files', async () => {
  const { home, cli, env } = await sandbox();
  mkdirSync(path.join(home, '.claude'));
  const claude = path.join(home, '.claude', 'settings.json');
  assert.equal(cli('--yes').status, 0);
  const c = JSON.parse(readFileSync(claude, 'utf8'));
  const endUnderStop = { hooks: [{ ...c.hooks.SessionEnd[0].hooks[0] }] };
  const noTimeout = { hooks: [{ type: 'command', command: c.hooks.Stop[0].hooks[0].command }] };
  const semicolon = { hooks: [{ type: 'command', command: `cd ${path.join(home, 'data', 'manage-workspace')}; exec node ./leftovers.mjs list` }] };
  c.hooks.Stop.push(endUnderStop, noTimeout); c.hooks.UserPromptSubmit = [semicolon];
  writeFileSync(claude, `${JSON.stringify(c, null, 2)}\n`);
  assert.equal(cli('uninstall', '--yes').status, 0);
  const after = JSON.parse(readFileSync(claude, 'utf8'));
  assert.deepEqual(after.hooks.Stop, [endUnderStop, noTimeout], 'a session-end command under Stop, and a copy without a timeout, are a person\'s');
  assert.ok(existsSync(path.join(home, 'data', 'manage-workspace', 'leftovers.mjs')), 'a ; after the folder still counts as a user');

  const shared = path.join(home, 'shared-config'); mkdirSync(shared);
  writeFileSync(path.join(shared, 'settings.json'), '{"keep":true}\n'); writeFileSync(path.join(shared, 'mode'), 'block\n');
  writeFileSync(claude, '{}\n');
  const purge = spawnSync(process.execPath, [setup, 'uninstall', '--purge', '--yes'], { encoding: 'utf8', env: { ...env, MWS_CONFIG_DIR: shared } });
  assert.equal(purge.status, 0, purge.stderr);
  assert.equal(readFileSync(path.join(shared, 'settings.json'), 'utf8'), '{"keep":true}\n', 'a folder MWS_CONFIG_DIR names keeps what is not ours');
  assert.ok(!existsSync(path.join(shared, 'mode')), 'only the mode file went');
});
