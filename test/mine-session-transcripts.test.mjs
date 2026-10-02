import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { encodeProjectPath as onboardEncode } from '../skills/onboard-project/scripts/history.mjs';
import {
  classify,
  encodeProjectPath,
  findTranscripts,
  normalise,
  readMessages,
  runsOf,
  scanSecrets,
} from '../skills/mine-session-transcripts/scripts/transcripts.mjs';
import { tempDir } from './helpers/temp-dir.mjs';

/**
 * The fixtures are synthetic: a history directory for an invented repository at /srv/example/repo,
 * written once by a script and committed. They hold one of each record a transcript carries beside
 * a person's words (references/record-shapes.md says which were observed on a real harness), plus
 * the traps the skill exists for: a queued message, a slash command's arguments, an older harness
 * with no origin marks, a subagent's dispatch and a relayed copy, a workflow journal, a lossy
 * directory name shared with another checkout, a session that moved into a worktree, a sibling
 * repository, and messages that hold secrets.
 */
const SCRIPT = fileURLToPath(new URL('../skills/mine-session-transcripts/scripts/transcripts.mjs', import.meta.url));
const HISTORY = fileURLToPath(new URL('./fixtures/mine-session-transcripts/history/', import.meta.url));
const REPO = '/srv/example/repo';
const SESSION = (suffix) => path.join(HISTORY, '-srv-example-repo', `00000000-0000-4000-8000-0000000000${suffix}.jsonl`);

function run(...args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
const selection = ['--repo', REPO, '--history', HISTORY];

/** Every message text the fixtures hold; none may reach the output of a command that is not `show`. */
const MESSAGE_TEXTS = [
  'say Download, and keep the old label',
  'whatever the screen',
  'the title should read Monthly report',
  'Rename the report to Quarterly summary',
  'ship the release notes after lunch',
  'keep CSV as the default format too',
  'the launch moves to the second week of March',
];
function assertNoMessageText(output, where) {
  for (const text of MESSAGE_TEXTS) assert.ok(!output.includes(text), `${where} printed message text: ${text}`);
}

test('a path is encoded exactly as onboard-project encodes it, so both find the same history directory', () => {
  for (const sample of [
    '/srv/example/repo',
    '/srv/example/repo/.claude/worktrees/feature',
    '/srv/example/my repo.v2',
    '/srv/example/under_score/trailing/',
    '/srv/example/café/ünïcode',
    'relative/path/to/repo',
    '/srv/example-repo',
  ]) {
    assert.equal(encodeProjectPath(sample), onboardEncode(sample), `the encoders disagree on ${sample}`);
  }
  assert.equal(encodeProjectPath('/srv/example/repo/.claude/worktrees/feature'), '-srv-example-repo--claude-worktrees-feature');
  // The encoding is lossy, which is why every transcript is confirmed by the paths its records carry.
  assert.equal(encodeProjectPath('/srv/example-repo'), encodeProjectPath('/srv/example/repo'));
});

test('find reads the repository, its worktree and a subdirectory, confirmed by cwd, and leaves out what only looks like them', async () => {
  const found = await findTranscripts({ repo: REPO, history: HISTORY });
  const byName = Object.fromEntries(found.directories.map((directory) => [directory.name, directory]));
  assert.deepEqual(Object.keys(byName).sort(), [
    '-srv-example-repo',
    '-srv-example-repo--claude-worktrees-feature',
    '-srv-example-repo-packages-web',
  ]);
  assert.equal(byName['-srv-example-repo'].role, 'repository');
  assert.equal(byName['-srv-example-repo--claude-worktrees-feature'].role, 'worktree');
  assert.equal(byName['-srv-example-repo-packages-web'].role, 'subdirectory');

  // The checkout whose path encodes to the same name is read by its records and left out.
  const sessions = byName['-srv-example-repo'].sessions.map((file) => path.basename(file));
  assert.ok(!sessions.includes('00000000-0000-4000-8000-0000000000e5.jsonl'), 'a lossy name match was read');
  assert.equal(sessions.length, 5);
  // A session that started elsewhere and moved into the worktree is still the worktree's.
  assert.equal(byName['-srv-example-repo--claude-worktrees-feature'].sessions.length, 1);

  const leftOut = Object.fromEntries(found.leftOut.map((item) => [item.name, item]));
  assert.ok(leftOut['-srv-example-repo'], 'the lossy twin is reported as left out');
  assert.ok(leftOut['-srv-example-repo-two'], 'a sibling repository is reported as left out');
  assert.ok(leftOut['-srv-example-repo-wt-hotfix'], 'an unnamed outside worktree is reported as left out');

  // Subagents are found beside their session; a workflow journal and a meta file are not transcripts.
  const subagents = byName['-srv-example-repo'].subagents.map(({ file }) => path.basename(file)).sort();
  assert.deepEqual(subagents, ['agent-a0000000000000001.jsonl', 'agent-b0000000000000001.jsonl']);
});

test('a worktree outside the repository is read when it is named, and a named path with no history is unknown, not zero', async () => {
  const result = run('find', ...selection, '--worktree', '/srv/example/repo-wt-hotfix', '--worktree', '/srv/example/repo-wt-gone');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /-srv-example-repo-wt-hotfix {2}\(worktree\)/);
  assert.match(result.stdout, /no history for 1 of these paths, so unknown, not zero: \/srv\/example\/repo-wt-gone/);
});

test('--no-worktrees reads the repository alone', async () => {
  const found = await findTranscripts({ repo: REPO, history: HISTORY, noWorktrees: true });
  assert.deepEqual(found.directories.map((directory) => directory.name).sort(), ['-srv-example-repo', '-srv-example-repo-packages-web']);
});

test('a repository with no history directory exits 2 and says unknown, never a count of zero', async () => {
  const result = run('messages', '--repo', '/srv/example/never-opened', '--history', HISTORY);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /unknown, not zero/);
  assert.doesNotMatch(result.stdout, /a person's messages: 0/);
});

test("messages counts typed, queued and slash-command words, and every other record by its kind", async () => {
  const found = await findTranscripts({ repo: REPO, history: HISTORY });
  const totals = await readMessages(found);
  assert.deepEqual(totals.messages, { typed: 14, queued: 1, 'command-args': 1 });
  assert.equal(totals.fallback, 1, 'the older harness turn with no origin is taken, and counted as a fallback');
  assert.equal(totals.unparsable, 1);
  assert.equal(totals.files, 7);
  assert.equal(totals.subagentFiles, 2);
  for (const [kind, count] of Object.entries({
    'tool-result': 2,
    meta: 2,
    'compact-summary': 1,
    'origin:task-notification': 1,
    'queued:task-notification': 1,
    'origin:peer': 1,
    'origin:coordinator': 1,
    'queued:coordinator': 1,
    dispatch: 2,
    headless: 1,
    'harness-markup': 1,
    'harness-text': 1,
    interruption: 1,
    'queue-bookkeeping': 2,
    'record:last-prompt': 1,
    'relayed-copy': 1,
    'duplicate-record': 1,
  })) {
    assert.equal(totals.exclusions[kind], count, `exclusions[${kind}]`);
  }
});

test('a repeated message is two messages: nothing is deduplicated by its text', async () => {
  const found = await findTranscripts({ repo: REPO, history: HISTORY });
  const seen = [];
  await readMessages(found, { visit: (message) => seen.push(message) });
  assert.equal(seen.filter((message) => message.text === 'status?').length, 2);
  const command = seen.find((message) => message.kind === 'command-args');
  assert.equal(command.command, '/goal');
  assert.equal(command.text, 'finish the export work and write down every decision we made');
  const withImage = seen.find((message) => message.attached.includes('image'));
  assert.ok(withImage, 'an image beside the words is reported as attached');
});

test('a headless prompt is left out unless asked for, and the window applies to the messages', async () => {
  const found = await findTranscripts({ repo: REPO, history: HISTORY });
  const withHeadless = await readMessages(found, { includeHeadless: true });
  assert.equal(withHeadless.messages.headless, 1);

  const windowed = await readMessages(found, { since: '2030-01-08T00:00:00Z' });
  assert.equal(Object.values(windowed.messages).reduce((sum, n) => sum + n, 0), 9);
  assert.equal(windowed.outsideWindow, 7);
  assert.equal(windowed.first, '2030-01-08T10:00:00.000Z');
});

test('the messages command prints counts and coverage, and no message text', () => {
  const result = run('messages', ...selection);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /a person's messages: 16/);
  assert.match(result.stdout, /of which taken by the fallback \(no origin marked\): 1/);
  assert.match(result.stdout, /left out, by kind:/);
  assert.match(result.stdout, /unparsable lines: 1/);
  assert.match(result.stdout, /left out: 1 transcript in -srv-example-repo-two/);
  assert.match(result.stdout, /not read: history this machine no longer keeps/);
  assertNoMessageText(result.stdout, 'messages');
});

test('locate gives the line, time, session and kind of each hit, never the text, and says where else the phrase occurs', () => {
  const result = run('locate', ...selection, '--phrase', 'keep CSV as the default format', '--zone', 'UTC');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^2 messages from a person contain the phrase$/m);
  assert.match(result.stdout, /-srv-example-repo\/00000000-0000-4000-8000-0000000000a1\.jsonl:5 {2}2030-01-07T09:01:30Z \| .*\(UTC\) {2}session 00000000-0000-4000-8000-0000000000a1 {2}queued/);
  assert.match(result.stdout, /-srv-example-repo--claude-worktrees-feature\/00000000-0000-4000-8000-0000000000f6\.jsonl:3 .* typed/);
  // The sibling repository says the same words, and is never read.
  assert.doesNotMatch(result.stdout, /0000000000a8/);
  assert.match(result.stdout, /also occurs in records that are not a person's: .*1 compact-summary/);
  assert.match(result.stdout, /1 queue-bookkeeping/);
  assert.match(result.stdout, /1 relayed-copy/);
  assertNoMessageText(result.stdout, 'locate');
});

test('locate matches a fixed phrase literally, not as a pattern', () => {
  const literal = run('locate', ...selection, '--phrase', 'status?');
  assert.match(literal.stdout, /^2 messages from a person contain the phrase$/m);
  const pattern = run('locate', ...selection, '--phrase', 'stat.s');
  assert.match(pattern.stdout, /^0 messages from a person contain the phrase$/m);
});

test('show prints one message that passes the scan, with its line, time and session', () => {
  const result = run('show', '--file', SESSION('d4'), '--line', '4');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /:4 {2}2030-01-08T10:03:00Z {2}session 00000000-0000-4000-8000-0000000000d4 {2}typed/);
  assert.match(result.stdout, /Nothing secret here: ship the release notes after lunch\./);
});

test('show refuses a message holding a shaped secret, names the kind, and prints none of it', () => {
  const hex = run('show', '--file', SESSION('d4'), '--line', '1');
  assert.equal(hex.status, 3);
  assert.match(hex.stdout, /a hex run of 32 or more characters; nothing shown/);
  assert.doesNotMatch(hex.stdout, /0123456789abcdef|fingerprint/);

  const jwt = run('show', '--file', SESSION('d4'), '--line', '2');
  assert.equal(jwt.status, 3);
  assert.match(jwt.stdout, /a JSON web token/);
  assert.doesNotMatch(jwt.stdout, /eyJ/);
});

test('show refuses an unshaped secret only when a terms file names it, and never prints the term', async () => {
  const open = run('show', '--file', SESSION('d4'), '--line', '3');
  assert.equal(open.status, 0, 'with no terms file the scan cannot see a secret that has no shape');

  const dir = await tempDir('mine-terms-');
  const terms = path.join(dir, 'terms.txt');
  await writeFile(terms, '# private terms, one per line\nalpha-4417\n');
  const refused = run('show', '--file', SESSION('d4'), '--line', '3', '--terms-file', terms);
  assert.equal(refused.status, 3);
  assert.match(refused.stdout, /a term from the terms file; nothing shown/);
  assert.doesNotMatch(refused.stdout, /4417/i);
});

test('show refuses a line that is not a person\'s message, and one that does not parse', () => {
  const tool = run('show', '--file', SESSION('a1'), '--line', '3');
  assert.equal(tool.status, 3);
  assert.match(tool.stdout, /line 3 is a tool-result record, not a person's message; nothing shown/);
  const broken = run('show', '--file', SESSION('a1'), '--line', '14');
  assert.equal(broken.status, 3);
  assert.match(broken.stdout, /does not parse/);
});

test('the scan knows each secret shape, built here at run time so no fixture holds one', () => {
  const samples = {
    'a provider API key': `key ${'sk-'}${'a1B2'.repeat(6)}`,
    'a GitHub token': `${'ghp'}_${'Zx'.repeat(18)}`,
    'a Slack token': `${'xoxb'}-${'1'.repeat(12)}`,
    'an AWS access key id': `${'AKIA'}${'A'.repeat(16)}`,
    'a private key block': `-----BEGIN ${'RSA PRIVATE'} KEY-----`,
    'a credential assignment': `pass${'word'}=${'x'.repeat(10)}`,
    'a URL with a password in it': `https://user:${'p'.repeat(8)}@example.com/`,
  };
  for (const [name, sample] of Object.entries(samples)) {
    assert.deepEqual(scanSecrets(sample), [name], `${name} was not recognised`);
  }
  assert.deepEqual(scanSecrets('ship it after lunch'), []);
});

test('normalisation is one function for both sides, and runs are eight words', () => {
  assert.equal(normalise('PLEASE make the export-button say “Download” — now!'), 'please make the export button say download now');
  assert.equal(normalise('Café, crème'), 'café crème');
  assert.deepEqual(runsOf('one two three four five six seven'), []);
  assert.deepEqual(runsOf('a b c d e f g h i j k l m n o p q'), ['a b c d e f g h', 'i j k l m n o p']);
});

/** A small repository to check the messages against, with the record written in other punctuation. */
async function corpus() {
  const dir = await tempDir('mine-corpus-');
  await mkdir(path.join(dir, 'docs'), { recursive: true });
  await mkdir(path.join(dir, 'generated'), { recursive: true });
  await writeFile(path.join(dir, 'README.md'), '# Example\n\nThe export page lists every report the team can download as a file.\n');
  await writeFile(
    path.join(dir, 'docs', 'decisions.md'),
    'PLEASE make the export-button say “Download” — and keep the old label in the changelog, for one release.\n'
    + 'Rename the report to "Quarterly summary" before the release goes out (Friday).\n',
  );
  // Excluded, binary and oversized files hold the queued message, which must still read as not written down.
  await writeFile(path.join(dir, 'generated', 'copy.md'), 'Also, keep CSV as the default format for every export, whatever the screen.\n');
  await writeFile(path.join(dir, 'image.bin'), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('Also, keep CSV as the default format for every export, whatever the screen.')]));
  await writeFile(path.join(dir, 'big.md'), `${'filler words '.repeat(400)}Also, keep CSV as the default format for every export, whatever the screen.\n`);
  return dir;
}
const CONTROL = 'The export page lists every report the team can download as a file.';

test('documented sorts each message into a bucket only after its controls pass, and prints no message text', async () => {
  const dir = await corpus();
  const out = path.join(dir, 'register.json');
  const result = run(
    'documented', ...selection, '--corpus', dir, '--control', CONTROL,
    '--exclude', 'generated', '--max-file-bytes', '2000', '--relay-name', 'Dana', '--relay-name', 'Robin', '--out', out,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /controls: 1 found, and the negative control not found/);
  assert.match(result.stdout, /skipped .*1 binary/);
  assert.match(result.stdout, /1 excluded/);
  assert.match(result.stdout, /1 over the size cap/);
  assert.match(result.stdout, /messages relaying a named person's words: 2/);
  assertNoMessageText(result.stdout, 'documented');

  const register = JSON.parse(await readFile(out, 'utf8'));
  const row = (suffix, line) => register.rows.find((r) => r.file.endsWith(`${suffix}.jsonl`) && r.line === line);
  assert.equal(row('a1', 1).pct, 100, 'punctuation and case differ between the message and the record, and it is still found');
  assert.equal(row('b2', 1).pct, 100);
  assert.equal(row('a1', 5).pct, 0, 'the queued message is written down only in excluded, binary or oversized files');
  assert.equal(row('a1', 19).pct, null, 'a message under eight words is too short to judge');
  assert.equal(row('aa', 1).relays, true);
  assert.equal(row('aa', 2).relays, true, 'a fenced block naming a person is a relay');
  assert.equal(row('d4', 4).relays, false);
  assert.equal(register.buckets['too short to judge (under 8 words)'], 2);
  const text = JSON.stringify(register);
  assertNoMessageText(text, 'the register');
});

test('documented shows no count when a control is not found', async () => {
  const dir = await corpus();
  const result = run('documented', ...selection, '--corpus', dir, '--control', 'This sentence of more than eight words is in no file at all.');
  assert.equal(result.status, 3);
  assert.match(result.stdout, /control NOT FOUND/);
  assert.match(result.stdout, /no count is shown/);
  assert.doesNotMatch(result.stdout, /messages judged/);
});

test('documented refuses to run without a control, or with one too short to test anything', async () => {
  const dir = await corpus();
  assert.equal(run('documented', ...selection, '--corpus', dir).status, 1);
  const short = run('documented', ...selection, '--corpus', dir, '--control', 'too short');
  assert.equal(short.status, 1);
  assert.match(short.stderr, /fewer than 8 words/);
});

test('in a git checkout the corpus is the tracked files only', async () => {
  const dir = await corpus();
  const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  if (git('init', '-q').status !== 0) return; // no git on this machine: the walk is tested above
  git('add', 'README.md');
  const result = run('documented', ...selection, '--corpus', dir, '--control', CONTROL, '--json');
  assert.equal(result.status, 0, result.stderr);
  const register = JSON.parse(result.stdout);
  assert.equal(register.corpus.from, 'git ls-files');
  assert.equal(register.corpus.used, 1);
  assert.equal(register.rows.find((r) => r.file.endsWith('a1.jsonl') && r.line === 1).pct, 0, 'an untracked file is not the record');
});

test('classification: a subagent turn with no origin is a dispatch, markup is not words, a queued image is attached', () => {
  assert.equal(classify({ type: 'user', message: { content: 'Do the thing.' } }, { subagent: true }).kind, 'dispatch');
  assert.equal(classify({ type: 'user', origin: { kind: 'human' }, message: { content: '<local-command-stdout>ok</local-command-stdout>' } }).kind, 'harness-markup');
  const queued = classify({ type: 'attachment', attachment: { type: 'queued_command', commandMode: 'prompt', prompt: [{ type: 'image' }, { type: 'text', text: 'look at this' }] } });
  assert.equal(queued.person, 'queued');
  assert.deepEqual(queued.attached, ['image']);
  assert.equal(classify({ type: 'attachment', attachment: { type: 'queued_command', isMeta: true, origin: { kind: 'coordinator' }, prompt: 'x' } }).kind, 'queued:coordinator');
  assert.equal(classify({ type: 'last-prompt', lastPrompt: 'status?' }).kind, 'record:last-prompt');
});

test('bad arguments exit 1: an unknown option, an unknown zone, an unknown command', () => {
  assert.equal(run('messages', ...selection, '--phrse', 'x').status, 1);
  const zone = run('locate', ...selection, '--phrase', 'x', '--zone', 'Not/AZone');
  assert.equal(zone.status, 1);
  assert.match(zone.stderr, /is not a time zone/);
  assert.equal(run('print', ...selection).status, 1);
});

test('the script has no dependency outside Node itself', async () => {
  const source = await readFile(SCRIPT, 'utf8');
  const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map(([, from]) => from);
  assert.ok(imports.length > 0);
  for (const from of imports) assert.match(from, /^node:/, `${from} is not a Node built-in`);
});
