import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../src/cli.ts';
import type { JournalEvent } from '../src/envelope.ts';
import { project } from '../src/retract.ts';

async function root(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'journal-cli-'));
}

// Reads every event back off disk, so tests assert what landed rather than what
// was printed. Without this the CLI tests only prove exit codes.
//
// It MUST mirror `readAll` in src/cli.ts, including the mergeEvents call. An
// earlier version collected raw parsed events and skipped the merge, so every
// assertion in this file read `readdir` order rather than the order a consumer
// sees — which made the retraction-ordering test unsatisfiable while the code
// under test was correct.
async function readAllEvents(root: string, workspace: string) {
  const { readdir, readFile } = await import('node:fs/promises');
  const { parseSegment, mergeEvents } = await import('../src/read.ts');
  // Typed: an untyped [] here is TS7034/TS7005 across the closure.
  const base = join(root, 'workspaces', workspace, 'segments');
  const batches: JournalEvent[][] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.endsWith('.jsonl')) batches.push(parseSegment(await readFile(full, 'utf8')).events);
    }
  }
  await walk(base);
  return mergeEvents(batches);
}

test('record writes one entry and reports its id', async () => {
  const dir = await root();
  const r = await runCli(
    ['record', '--kind', 'decision', '--question', 'db?', '--chosen', 'postgres', '--workspace', 'ws'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' },
  );
  assert.equal(r.code, 0);
  assert.match(r.stdout, /recorded /);

  // Assert it reached disk with the right content, not just that it printed.
  const events = await readAllEvents(dir, 'ws');
  assert.equal(events.length, 1);
  assert.equal(events[0]!.kind, 'decision');
  assert.equal(events[0]!.data.chosen, 'postgres');
  assert.equal(events[0]!.provenance, 'cli');
});

test('record refuses and exits non-zero when redaction fails', async () => {
  const dir = await root();
  const r = await runCli(
    ['record', '--kind', 'decision', '--question', 'q', '--chosen', 'x',
      '--workspace', 'ws', '--rationale', 'y'.repeat(300000)],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' },
  );
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /redaction/i);
});

test('invalidate works with no session and is attributed to a human', async () => {
  const dir = await root();
  await runCli(
    ['record', '--kind', 'finding', '--question', 'why', '--chosen', 'wrong',
      '--workspace', 'ws', '--id', 'f1'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' },
  );
  const r = await runCli(
    ['invalidate', 'f1', '--reason', 'wrong interpreter on PATH', '--workspace', 'ws'],
    { AGENT_JOURNAL_ROOT: dir },
  );
  assert.equal(r.code, 0);

  // Assert the entry ACTUALLY LANDED with the right shape. An exit code alone
  // would pass even if invalidate did nothing at all.
  const events = await readAllEvents(dir, 'ws');
  const retraction = events.find((e) => e.data.invalidates === 'f1');
  assert.ok(retraction, 'a retraction event must be on disk');
  assert.equal(retraction!.author, 'human');
  assert.equal(retraction!.session, '-');
  assert.equal(retraction!.data.rationale, 'wrong interpreter on PATH');
});

test('a refused write leaves a void on disk, not just an error code', async () => {
  const dir = await root();
  const r = await runCli(
    ['record', '--kind', 'decision', '--question', 'q', '--chosen', 'x',
      '--workspace', 'ws', '--rationale', 'y'.repeat(300000)],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' },
  );
  assert.notEqual(r.code, 0);
  // The error code is not the guarantee. Without a persisted void the refusal
  // never reaches coverage()'s voids count and the silence stays invisible.
  const events = await readAllEvents(dir, 'ws');
  const voided = events.filter((e) => e.kind === 'void');
  assert.equal(voided.length, 1, 'a refusal must be recorded, not only reported');
  assert.equal(voided[0]!.provenance, 'cli');
  assert.match(String(voided[0]!.data.reason), /redaction/);
});

test('record honours --author human on the entry itself', async () => {
  const dir = await root();
  await runCli(
    ['record', '--kind', 'decision', '--question', 'q', '--chosen', 'x',
      '--workspace', 'ws', '--id', 'e1', '--author', 'human'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' },
  );
  const [entry] = await readAllEvents(dir, 'ws');
  // Computing the author and then hardcoding it on the entry is the bug this
  // catches — the flag was threaded into the refusal void but not the entry.
  assert.equal(entry!.author, 'human');
});

test('--workspace is required', async () => {
  const r = await runCli(['record', '--kind', 'decision'], { AGENT_JOURNAL_ROOT: await root() });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /--workspace is required/);
});

test('coverage reports unassessed fields as null, and counts voids', async () => {
  const dir = await root();
  await runCli(['record', '--kind', 'decision', '--question', 'q', '--chosen', 'x', '--workspace', 'ws'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  await runCli(['record', '--kind', 'decision', '--question', 'q', '--chosen', 'x',
    '--workspace', 'ws', '--rationale', 'z'.repeat(300000)],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });

  const r = await runCli(['coverage', '--workspace', 'ws'], { AGENT_JOURNAL_ROOT: dir });
  assert.equal(r.code, 0);
  const report = JSON.parse(r.stdout);
  assert.equal(report.voids, 1);
  // This command runs no retention pass and is told of no sessions, so both
  // must read as NOT ASSESSED. Passing [] would claim a clean bill of health
  // the command never established.
  assert.equal(report.downgradedAnchors, null);
  assert.equal(report.sessionsWithNoEvents, null);
});

test('a flag with no value does not swallow the next flag', async () => {
  const dir = await root();
  // `--id` immediately followed by `--author`: treating the next token as a
  // value would consume the flag and produce an id of "--author". This test
  // used to assert only that, and passed while the id was silently the string
  // "true" and the entry was written anyway. Refusing is the real contract:
  // nothing is written, and the caller is told which flag was bare.
  const r = await runCli(
    ['record', '--kind', 'decision', '--workspace', 'ws', '--id', '--author', 'human'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' },
  );
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--id/);
  assert.equal((await readAllEvents(dir, 'ws')).length, 0);
});

test('a refused INVALIDATE leaves a void too, not just record', async () => {
  const dir = await root();
  const r = await runCli(
    ['invalidate', 'f1', '--reason', 'z'.repeat(300000), '--workspace', 'ws'],
    { AGENT_JOURNAL_ROOT: dir },
  );
  assert.notEqual(r.code, 0);
  // The guarantee is not scoped to one subcommand. This is the human-retraction
  // path the command exists for, and its refusal was previously invisible.
  const voided = (await readAllEvents(dir, 'ws')).filter((e) => e.kind === 'void');
  assert.equal(voided.length, 1);
  assert.equal(voided[0]!.author, 'human');
  assert.equal(voided[0]!.session, '-');
});

test('invalidate warns when the target id is not present', async () => {
  const dir = await root();
  const r = await runCli(['invalidate', 'nope', '--reason', 'typo', '--workspace', 'ws'],
    { AGENT_JOURNAL_ROOT: dir });
  assert.equal(r.code, 0);
  assert.match(r.stderr, /no entry with id nope/);
});

test('record defaults author to agent when --author is absent', async () => {
  const dir = await root();
  await runCli(['record', '--kind', 'decision', '--question', 'q', '--chosen', 'x', '--workspace', 'ws'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  // Flipping the default would pass every other test in this file.
  assert.equal((await readAllEvents(dir, 'ws'))[0]!.author, 'agent');
});

test('the refusal void carries the author it was told, not a hardcoded one', async () => {
  const dir = await root();
  await runCli(
    ['record', '--kind', 'decision', '--question', 'q', '--chosen', 'x', '--workspace', 'ws',
      '--author', 'human', '--rationale', 'y'.repeat(300000)],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' },
  );
  const voided = (await readAllEvents(dir, 'ws')).filter((e) => e.kind === 'void');
  assert.equal(voided[0]!.author, 'human');
});

test('--workspace is actually parsed, not assumed', async () => {
  const dir = await root();
  // Every other test uses the literal "ws". A build hardcoding it would pass
  // them all, and fail here.
  await runCli(['record', '--kind', 'decision', '--question', 'q', '--chosen', 'x',
    '--workspace', 'other-space'], { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  assert.equal((await readAllEvents(dir, 'other-space')).length, 1);
  assert.equal((await readAllEvents(dir, 'ws')).length, 0);
});

test('record requires --kind', async () => {
  const r = await runCli(['record', '--workspace', 'ws'], { AGENT_JOURNAL_ROOT: await root() });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--kind is required/);
});

test('a retraction takes effect regardless of merge order', async () => {
  const dir = await root();
  await runCli(['record', '--kind', 'finding', '--question', 'why', '--chosen', 'wrong',
    '--workspace', 'ws', '--id', 'f1'], { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  await runCli(['invalidate', 'f1', '--reason', 'bad premise', '--workspace', 'ws'],
    { AGENT_JOURNAL_ROOT: dir });

  // NOT an ordering assertion. An earlier version of this test asserted the
  // finding sorts before its retraction, which the spec explicitly disclaims:
  // wall clock is "display only across sources" and "causality is never
  // inferred from timestamps". record and invalidate ARE different sources —
  // `cli/host/s1/primary` and `cli/host/-/-` — so their relative order is
  // arbitrary by design, and measured at 9 of 20 runs either way.
  //
  // What must hold is that the EDGE carries the meaning. project() is
  // order-independent, so the retraction lands whichever way the merge fell.
  const events = await readAllEvents(dir, 'ws');
  assert.equal(events.length, 2);
  assert.ok(project(events).invalidated.has('f1'), 'the retraction must apply either way');
});

test('record stores rejected — the field the design exists for', async () => {
  const dir = await root();
  await runCli(['record', '--kind', 'decision', '--workspace', 'ws', '--id', 'e1',
    '--question', 'how do we bound the queue?', '--chosen', 'ring buffer',
    '--rejected', 'redis — needs a broker we do not run'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  const [entry] = await readAllEvents(dir, 'ws');
  // This was silently dropped for as long as the field list omitted it: exit 0,
  // entry written, the alternatives gone. Nothing else in the system records them.
  assert.equal(entry!.data.rejected, 'redis — needs a broker we do not run');
});

test('record stores the other decision fields it advertises', async () => {
  const dir = await root();
  await runCli(['record', '--kind', 'decision', '--workspace', 'ws', '--id', 'e1',
    '--question', 'q', '--chosen', 'c',
    '--reversibility', 'one-way', '--blastRadius', 'every signed-in user',
    '--confidence', 'low'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  const [entry] = await readAllEvents(dir, 'ws');
  assert.equal(entry!.data.reversibility, 'one-way');
  assert.equal(entry!.data.blastRadius, 'every signed-in user');
  assert.equal(entry!.data.confidence, 'low');
});

test('an unknown flag is refused, not silently dropped', async () => {
  const dir = await root();
  // A typo must stop rather than lose the value with an exit code saying it worked.
  const r = await runCli(['record', '--kind', 'decision', '--workspace', 'ws', '--rejcted', 'oops'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown flag: --rejcted/);
  assert.equal((await readAllEvents(dir, 'ws')).length, 0, 'nothing should be written');
});

test('an unknown subcommand exits non-zero with usage', async () => {
  const r = await runCli(['frobnicate', '--workspace', 'ws'], { AGENT_JOURNAL_ROOT: await root() });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /usage/i);
});

test('help exits 0 on stdout, so it is usable as an install check', async () => {
  for (const form of [['help'], ['--help'], ['-h']]) {
    const r = await runCli(form, { AGENT_JOURNAL_ROOT: '/nonexistent' });
    assert.equal(r.code, 0, `${form[0]} should exit 0`);
    assert.match(r.stdout, /usage:/, `${form[0]} should print usage on stdout`);
    assert.equal(r.stderr, '', `${form[0]} should write nothing to stderr`);
  }
});

test('help does not hit the --workspace guard', async () => {
  const r = await runCli(['help'], { AGENT_JOURNAL_ROOT: '/nonexistent' });
  assert.doesNotMatch(r.stdout + r.stderr, /--workspace is required/);
});

// `reason` belongs to `invalidate`. Listing it as a GLOBAL flag let it pass the
// unknown-flag guard on `record`, where nothing stores it — so the single most
// likely mistyping of `--rationale` was the one flag name that exited 0 and
// threw the text away. Every other kind's field is correctly refused.
test('record refuses --reason instead of swallowing it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journal-scope-'));
  const r = await runCli(
    ['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'r1',
     '--question', 'q', '--chosen', 'c', '--reason', 'THE WHOLE POINT'],
    { AGENT_JOURNAL_ROOT: root },
  );
  assert.equal(r.code, 2, `expected refusal, got ${r.code}: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /--reason/);
});

test('invalidate refuses record-only flags instead of dropping them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journal-scope-'));
  const r = await runCli(
    ['invalidate', 'x1', '--workspace', 'ws', '--reason', 'wrong',
     '--kind', 'finding', '--question', 'ignored'],
    { AGENT_JOURNAL_ROOT: root },
  );
  assert.equal(r.code, 2, `expected refusal, got ${r.code}: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /--kind|--question/);
});

// `--workspace` with an unset shell variable expands to nothing, so the parser
// saw a flag with no value and stored the string "true". The entry was written
// to a workspace literally named `true` and the command reported success.
test('a flag given no value is an error, never the string "true"', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journal-noval-'));
  const cases: readonly string[][] = [
    ['record', '--kind', 'decision', '--id', 'a1', '--question', 'q', '--workspace'],
    ['record', '--workspace', 'ws', '--id', 'a2', '--kind'],
    ['record', '--workspace', 'ws', '--kind', 'decision', '--id', '--author', 'human'],
  ];
  for (const argv of cases) {
    const r = await runCli(argv, { AGENT_JOURNAL_ROOT: root });
    assert.equal(r.code, 2, `${argv.join(' ')} → exit ${r.code}: ${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stdout, /recorded/, `${argv.join(' ')} wrote an entry`);
  }
  const found = await readdir(join(root, 'workspaces')).catch(() => [] as string[]);
  assert.ok(!found.includes('true'), `a workspace named "true" was created: ${found.join(',')}`);
});

// Prerequisite 1 of the skill tells the reader to run this and copy from it.
test('help names the installed binary, not an internal module name', async () => {
  const r = await runCli(['help'], { AGENT_JOURNAL_ROOT: '/nonexistent' });
  assert.match(r.stdout, /agent-journal record/);
  assert.doesNotMatch(r.stdout, /^\s+journal /m);
});

// `coverage` exists to make silence legible, and it was the one command where
// "nothing was ever recorded" and "the record is unreadable" produced the same
// all-zero report at exit 0. The read path swallowed every readdir error and
// discarded the parser's diagnostics; an unreadable FILE meanwhile threw a raw
// stack. Both halves of that asymmetry are the failure.
test('coverage does not report a clean journal when the record is corrupt', async () => {
  const dir = await root();
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'a1',
    '--question', 'q', '--chosen', 'c'], { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });

  const segDir = join(dir, 'workspaces', 'ws', 'segments');
  const seg = (await readdir(segDir, { recursive: true }) as string[])
    .find((f) => f.endsWith('.jsonl'))!;
  await writeFile(join(segDir, seg), 'this is not json\nnor is this\n');

  const r = await runCli(['coverage', '--workspace', 'ws'], { AGENT_JOURNAL_ROOT: dir });
  assert.notEqual(r.code, 0, 'a corrupt journal reported success');
  assert.match(r.stdout + r.stderr, /malformed/i,
    `corruption was not surfaced: ${r.stdout}${r.stderr}`);
});

test('coverage reports an unreadable segment instead of crashing or reporting zero', async () => {
  const dir = await root();
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'a1',
    '--question', 'q', '--chosen', 'c'], { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });

  const segDir = join(dir, 'workspaces', 'ws', 'segments');
  const seg = (await readdir(segDir, { recursive: true }) as string[])
    .find((f) => f.endsWith('.jsonl'))!;
  await chmod(join(segDir, seg), 0o000);
  try {
    const r = await runCli(['coverage', '--workspace', 'ws'], { AGENT_JOURNAL_ROOT: dir });
    assert.notEqual(r.code, 0, 'an unreadable segment reported success');
    assert.match(r.stdout + r.stderr, /unreadable/i,
      `unreadability was not surfaced: ${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stderr, /at \w+ \(/, 'a raw stack trace reached the user');
  } finally {
    await chmod(join(segDir, seg), 0o600);
  }
});

test('coverage still reports cleanly for a workspace that genuinely has nothing', async () => {
  const dir = await root();
  const r = await runCli(['coverage', '--workspace', 'never-used'], { AGENT_JOURNAL_ROOT: dir });
  assert.equal(r.code, 0, `an absent workspace should not be an error: ${r.stderr}`);
  assert.match(r.stdout, /"sessions": 0/);
});

// Merge dedups by id, first writer wins. So a second `record --id dup` landed on
// disk, was told "recorded dup", and was then invisible to every read path — the
// journal held two lines and no reader could ever see the second. Silent,
// unrecoverable data loss with a success message on top.
test('a duplicate explicit --id is refused, not written and hidden', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  const first = await runCli(['record', '--workspace', 'ws', '--kind', 'decision',
    '--id', 'dup', '--question', 'first', '--chosen', 'a'], env);
  assert.equal(first.code, 0);

  const second = await runCli(['record', '--workspace', 'ws', '--kind', 'decision',
    '--id', 'dup', '--question', 'second', '--chosen', 'b'], env);
  assert.equal(second.code, 2, `duplicate id accepted: ${second.stdout}${second.stderr}`);
  assert.match(second.stderr, /dup/);

  const events = await readAllEvents(dir, 'ws');
  assert.equal(events.length, 1, 'a second, unreachable entry was written');
  assert.equal((events[0]!.data as Record<string, unknown>).question, 'first');
});

test('auto-generated ids do not pay for the duplicate check', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  for (let i = 0; i < 3; i += 1) {
    const r = await runCli(['record', '--workspace', 'ws', '--kind', 'decision',
      '--question', `q${i}`, '--chosen', 'c'], env);
    assert.equal(r.code, 0, r.stderr);
  }
  assert.equal((await readAllEvents(dir, 'ws')).length, 3);
});

// The directory case, distinct from the file case above: `walk` swallowed every
// readdir error, so an unreadable segments directory produced output
// byte-identical to a workspace that had never been written to.
test('coverage reports an unreadable segments DIRECTORY, not an empty journal', async () => {
  const dir = await root();
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'a1',
    '--question', 'q', '--chosen', 'c'], { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });

  const segDir = join(dir, 'workspaces', 'ws', 'segments');
  await chmod(segDir, 0o000);
  try {
    const r = await runCli(['coverage', '--workspace', 'ws'], { AGENT_JOURNAL_ROOT: dir });
    assert.notEqual(r.code, 0, 'an unreadable segments directory reported success');
    assert.match(r.stdout + r.stderr, /unreadable/i,
      `unreadability was not surfaced: ${r.stdout}${r.stderr}`);
  } finally {
    await chmod(segDir, 0o700);
  }
});

// `--author robot` was silently coerced to `agent` at exit 0, while
// normalizeEvent rejects an unknown author outright. Attribution is the one
// field a retraction's credibility rests on, so guessing at it is worse than
// refusing — and the CLI was the only layer that guessed.
test('an unrecognised --author is refused, not coerced', async () => {
  const dir = await root();
  const r = await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'a1',
    '--question', 'q', '--chosen', 'c', '--author', 'robot'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  assert.equal(r.code, 2, `--author robot was accepted: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /author/);
  assert.equal((await readAllEvents(dir, 'ws')).length, 0);
});

test('both recognised authors still work', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  for (const [id, author] of [['h1', 'human'], ['a1', 'agent']] as const) {
    const r = await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', id,
      '--question', 'q', '--chosen', 'c', '--author', author], env);
    assert.equal(r.code, 0, `--author ${author} rejected: ${r.stderr}`);
  }
  const events = await readAllEvents(dir, 'ws');
  assert.deepEqual(events.map((e) => e.author).sort(), ['agent', 'human']);
});

// `--supersedes` and `--invalidates` are accepted by record and reach the
// projection, but had no test while their four siblings each got one.
test('record --supersedes and --invalidates reach the projection', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  const mk = (id: string, extra: string[]) => runCli(
    ['record', '--workspace', 'ws', '--kind', 'decision', '--id', id,
     '--question', id, '--chosen', 'c', ...extra], env);

  assert.equal((await mk('old', [])).code, 0);
  assert.equal((await mk('wrong', [])).code, 0);
  assert.equal((await mk('newer', ['--supersedes', 'old'])).code, 0);
  assert.equal((await mk('fix', ['--invalidates', 'wrong'])).code, 0);

  const proj = project(await readAllEvents(dir, 'ws'));
  assert.equal(proj.outcomes.get('old'), 'reverted', 'supersedes did not reach the projection');
  assert.equal(proj.outcomes.get('wrong'), 'invalidated', 'invalidates did not reach the projection');
  const live = proj.live.map((e) => e.id).sort();
  assert.deepEqual(live, ['fix', 'newer'], `live set wrong: ${live.join(',')}`);
});

// The redaction-refusal path was handled; the I/O-error path was not, so a
// filesystem failure escaped runCli as an unhandled rejection and the process
// died with a raw stack instead of an exit code the caller can branch on.
test('a filesystem failure is reported, not thrown as a raw stack', async () => {
  const dir = await root();
  await chmod(dir, 0o500);          // readable, not writable
  try {
    for (const argv of [
      ['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'a1',
       '--question', 'q', '--chosen', 'c'],
      ['invalidate', 'x1', '--workspace', 'ws', '--reason', 'wrong'],
    ]) {
      const r = await runCli(argv, { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
      assert.notEqual(r.code, 0, `${argv[0]} reported success on an unwritable root`);
      assert.match(r.stderr, /EACCES|permission|could not/i,
        `${argv[0]} gave no usable message: ${r.stderr}`);
      assert.doesNotMatch(r.stderr, /\n\s+at /, 'a raw stack trace reached the user');
    }
  } finally {
    await chmod(dir, 0o700);
  }
});

// `invalidated <id>` on stdout at exit 0 is what a script reads as success. The
// append-only design deliberately allows retracting an entry that has not
// arrived yet, so this is not an error — but stdout must not claim something
// was suppressed when nothing matched.
test('invalidate does not claim success on stdout when nothing matched', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'real',
    '--question', 'q', '--chosen', 'c'], env);

  const hit = await runCli(['invalidate', 'real', '--workspace', 'ws', '--reason', 'w'], env);
  assert.equal(hit.code, 0);
  assert.match(hit.stdout, /^invalidated real/, `matched target: ${hit.stdout}`);

  const miss = await runCli(['invalidate', 'ghost', '--workspace', 'ws', '--reason', 'w'], env);
  assert.doesNotMatch(miss.stdout, /^invalidated ghost/,
    `stdout claimed an unmatched id was invalidated: ${miss.stdout}`);
  assert.match(miss.stdout + miss.stderr, /no matching entry|not present/i);
});

test('record writes repeated anchors and influences as structured arrays', async () => {
  const dir = await root();
  const r = await runCli([
    'record', '--workspace', 'ws', '--kind', 'decision', '--id', 'e1',
    '--question', 'how do we bound the queue?', '--chosen', 'ring buffer',
    '--anchor', 'commit:9f2c1ab',
    '--anchor', 'file:src/queue.ts:41',
    '--influence', 'url:decisive:https://example.com/bench?a=1:2',
    '--influence', 'journal:contradicted:7f3a',
  ], { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  assert.equal(r.code, 0, r.stderr);

  const [entry] = await readAllEvents(dir, 'ws');
  assert.deepEqual(entry!.data.anchors, [
    { type: 'commit', ref: '9f2c1ab' },
    { type: 'file', ref: 'src/queue.ts:41' },
  ]);
  assert.deepEqual(entry!.data.influences, [
    { type: 'url', role: 'decisive', ref: 'https://example.com/bench?a=1:2' },
    { type: 'journal', role: 'contradicted', ref: '7f3a' },
  ]);
});

test('an anchor makes its capability known on the written entry', async () => {
  const dir = await root();
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'e1',
    '--question', 'q', '--chosen', 'c', '--anchor', 'commit:9f2c1ab'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  const [entry] = await readAllEvents(dir, 'ws');
  assert.equal(entry!.capabilities.commit, 'known');
  assert.equal(entry!.capabilities.visual, 'unknown', 'unrelated classes stay unknown');
});

test('a malformed anchor or influence is refused before anything is written', async () => {
  const dir = await root();
  for (const bad of [
    ['--anchor', 'nonsense:x'],
    ['--anchor', 'commit'],
    ['--influence', 'url:decisive'],
    ['--influence', 'rumour:decisive:x'],
  ]) {
    const r = await runCli(['record', '--workspace', 'ws', '--kind', 'decision',
      '--question', 'q', '--chosen', 'c', ...bad],
      { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
    assert.equal(r.code, 2, `${bad.join(' ')} was accepted: ${r.stdout}${r.stderr}`);
  }
  assert.equal((await readAllEvents(dir, 'ws')).length, 0, 'a rejected entry was written anyway');
});

// The point of the whole design: "consulted nothing" must be distinguishable
// from "recorded nothing", and it must be a value rather than an absence.
test('model_knowledge records that no source was consulted', async () => {
  const dir = await root();
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'e1',
    '--question', 'q', '--chosen', 'c', '--influence', 'model_knowledge:decisive'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  const [entry] = await readAllEvents(dir, 'ws');
  assert.deepEqual(entry!.data.influences, [{ type: 'model_knowledge', role: 'decisive' }]);
});

test('an entry with no influences records absence, not an empty claim', async () => {
  const dir = await root();
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'e1',
    '--question', 'q', '--chosen', 'c'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  const [entry] = await readAllEvents(dir, 'ws');
  assert.equal(entry!.data.influences, undefined,
    'an absent field must not become [], which would claim "assessed and none"');
  // The same claim applies to anchors, and nothing else in this file pins it —
  // added alongside the influences assertion so the `data.anchors` guard is
  // mutation-covered too.
  assert.equal(entry!.data.anchors, undefined,
    'an absent field must not become [], which would claim "assessed and none"');
});

// Propagation walks data.influences of type journal. Before this task the CLI
// could not emit one, so a CLI-issued invalidate suppressed only its target.
test('a CLI-recorded journal influence makes invalidation propagate', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'base',
    '--question', 'q', '--chosen', 'c'], env);
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'rests',
    '--question', 'q', '--chosen', 'c', '--influence', 'journal:decisive:base'], env);
  await runCli(['invalidate', 'base', '--workspace', 'ws', '--reason', 'premise false'], env);

  const proj = project(await readAllEvents(dir, 'ws'));
  assert.equal(proj.outcomes.get('base'), 'invalidated');
  assert.equal(proj.outcomes.get('rests'), 'invalidated',
    'an entry resting on an invalidated one was not suppressed');
});
