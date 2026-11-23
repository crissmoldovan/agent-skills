import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers/temp-dir.mjs';

const dir = fileURLToPath(new URL('../skills/manage-workspace-storage/scripts/', import.meta.url));
const leftovers = path.join(dir, 'leftovers.mjs');
const setup = path.join(dir, 'setup-enforcement.mjs');
const { extract, tokenize } = await import(leftovers);

async function sandbox() {
  const root = await tempDir('mws-enforce-');
  const home = path.join(root, 'home dir');
  const env = { ...process.env, HOME: home, MWS_STATE_DIR: path.join(home, 'state'), MWS_CONFIG_DIR: path.join(home, 'config'), XDG_DATA_HOME: path.join(home, 'data') };
  delete env.MWS_CLEANUP_MODE; delete env.CLAUDE_CONFIG_DIR; delete env.CODEX_HOME;
  mkdirSync(home, { recursive: true });
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
  assert.deepEqual(c.env, existing.env);
  const x = JSON.parse(readFileSync(codex, 'utf8'));
  assert.deepEqual(Object.keys(x.hooks).sort(), ['PreToolUse', 'SessionStart', 'Stop']);
  assert.equal(readFileSync(`${claude}.bak-manage-workspace-storage`, 'utf8'), before[0]);
  assert.equal(readFileSync(`${codex}.bak-manage-workspace-storage`, 'utf8'), before[1]);
  assert.ok(existsSync(path.join(home, 'data', 'manage-workspace-storage', 'leftovers.mjs')));
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
  assert.ok(!existsSync(path.join(home, 'data', 'manage-workspace-storage')));
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

const skillDir = fileURLToPath(new URL('../skills/manage-workspace-storage/', import.meta.url));
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const skillText = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
const guide = readFileSync(path.join(skillDir, 'references/enforcement.md'), 'utf8').replace(/\s+/g, ' ');
const readme = read('../README.md');
const readmeEntry = readme.slice(readme.indexOf('### `manage-workspace-storage`'), readme.indexOf('### `onboard-project`'));

test('SKILL.md carries the install-or-update procedure an agent follows end to end', () => {
  assert.match(skillText, /version=1\.2\.0/);
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
  assert.match(prompt, /crissmoldovan\/agent-skills#v0\.34\.0|v0\.34\.0/);
  for (const re of [/codex --version/, /codex features list/, /--agent codex/, /--agent claude-code/, /--global/, /--copy/, /setup-enforcement\.mjs/, /status/, /already up to date/, /session-start/, /\/hooks/]) assert.match(prompt, re);
  assert.doesNotMatch(prompt, /\/Users\/|linear|@[a-z0-9-]+\.(com|dev)|token|secret/i);
  assert.doesNotMatch(readmeEntry, /review the new hooks once|trust .* once/i, 'trust is not "once"');
  assert.match(readmeEntry, /per machine/);
  assert.match(readmeEntry, /npx skills update manage-workspace-storage --global --yes/, 'the human commands stay');
});

test('CONTRIBUTING lets the setup script run on request and self-approval only with the owner explicit authorisation', () => {
  const c = read('../CONTRIBUTING.md');
  assert.match(c, /No skill installs one/);
  assert.match(c, /manage-workspace-storage/);
  assert.match(c, /explicitly asks to install or update (that|the) skill/);
  assert.match(c, /explicit authorisation in the request/);
});
