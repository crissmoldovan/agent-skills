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
    // `question`/`chosen` are decision fields (task 3 scopes fields per kind);
    // this test is about invalidate/retraction, not which kind was recorded.
    ['record', '--kind', 'decision', '--question', 'why', '--chosen', 'wrong',
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
  // `question`/`chosen` are decision fields (task 3 scopes fields per kind);
  // this test is about retraction ordering, not which kind was recorded.
  await runCli(['record', '--kind', 'decision', '--question', 'why', '--chosen', 'wrong',
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
  // `rejected` is a list field (task 3): one --rejected still lands as a
  // one-element array, not a bare string.
  assert.deepEqual(entry!.data.rejected, ['redis — needs a broker we do not run']);
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

test('each kind accepts its own fields and refuses another kind\'s', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };

  const ok = await runCli(['record', '--workspace', 'ws', '--kind', 'assumption', '--id', 'a1',
    '--assumed', 'the upstream call is idempotent', '--ifWrong', 'retries double-charge',
    '--checked', 'no'], env);
  assert.equal(ok.code, 0, ok.stderr);
  const [entry] = await readAllEvents(dir, 'ws');
  assert.equal(entry!.data.assumed, 'the upstream call is idempotent');
  assert.equal(entry!.data.checked, 'no');

  const crossed = await runCli(['record', '--workspace', 'ws', '--kind', 'assumption', '--id', 'a2',
    '--assumed', 'x', '--question', 'belongs to decision'], env);
  assert.equal(crossed.code, 2, `a decision field was accepted on an assumption: ${crossed.stdout}`);
  assert.match(crossed.stderr, /--question/);
});

test('a repeated --rejected keeps every alternative, not just the last', async () => {
  const dir = await root();
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'q', '--chosen', 'c',
    '--rejected', 'redis — needs a broker we do not run',
    '--rejected', 'kafka — three days of setup for one queue'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  const [entry] = await readAllEvents(dir, 'ws');
  assert.deepEqual(entry!.data.rejected, [
    'redis — needs a broker we do not run',
    'kafka — three days of setup for one queue',
  ]);
});

// IMPORTANT 2 (fix round 1): finding, blocker, progress and constraint had no
// end-to-end proof of life — only fieldsFor() name checks. blocker and
// progress in particular never reached normalizeEntryData with real values
// through the CLI at all. Round-trip all four through runCli and read back
// exactly what landed in `data`.
test('finding, blocker, progress and constraint each round-trip through the CLI with their own fields', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };

  await runCli(['record', '--workspace', 'ws', '--kind', 'finding', '--id', 'f1',
    '--claim', 'the upstream API times out after 30s, not 10s as documented',
    '--evidence', 'observed 28.7s round trip in prod logs',
    '--evidence', 'support ticket #4821 confirms 30s server-side timeout',
    '--premise', 'the docs were last updated two years ago',
    '--scope', 'workspace'], env);

  await runCli(['record', '--workspace', 'ws', '--kind', 'blocker', '--id', 'b1',
    '--blocked', 'cannot deploy to staging',
    '--on', 'staging cluster credentials rotation',
    '--owner', 'platform-team',
    '--clearedBy', 'new creds land in vault'], env);

  await runCli(['record', '--workspace', 'ws', '--kind', 'progress', '--id', 'p1',
    '--did', 'migrated the queue consumer to the ring buffer',
    '--next', 'add backpressure metrics',
    '--externalRef', 'JIRA-4821'], env);

  await runCli(['record', '--workspace', 'ws', '--kind', 'constraint', '--id', 'c1',
    '--statement', 'telemetry must not leave the EU region',
    '--origin', 'GDPR data residency policy',
    '--scope', 'telemetry',
    '--expiry', 'none',
    '--enforcement', 'blocking'], env);

  const events = await readAllEvents(dir, 'ws');
  const byId = new Map(events.map((e) => [e.id, e]));

  const finding = byId.get('f1')!;
  assert.equal(finding.data.claim, 'the upstream API times out after 30s, not 10s as documented');
  assert.deepEqual(finding.data.evidence, [
    'observed 28.7s round trip in prod logs',
    'support ticket #4821 confirms 30s server-side timeout',
  ]);
  assert.deepEqual(finding.data.premise, ['the docs were last updated two years ago']);
  assert.equal(finding.data.scope, 'workspace');

  const blocker = byId.get('b1')!;
  assert.equal(blocker.data.blocked, 'cannot deploy to staging');
  assert.equal(blocker.data.on, 'staging cluster credentials rotation');
  assert.equal(blocker.data.owner, 'platform-team');
  assert.equal(blocker.data.clearedBy, 'new creds land in vault');

  const progress = byId.get('p1')!;
  assert.equal(progress.data.did, 'migrated the queue consumer to the ring buffer');
  assert.equal(progress.data.next, 'add backpressure metrics');
  assert.equal(progress.data.externalRef, 'JIRA-4821');

  const constraint = byId.get('c1')!;
  assert.equal(constraint.data.statement, 'telemetry must not leave the EU region');
  assert.equal(constraint.data.origin, 'GDPR data residency policy');
  assert.equal(constraint.data.scope, 'telemetry');
  assert.equal(constraint.data.expiry, 'none');
  assert.equal(constraint.data.enforcement, 'blocking');
});

// RULING (fix round 1): an unrecognised kind must not be refused outright —
// retention.ts (spec 4.4) deliberately keeps a kind in neither of its sets
// unclassified rather than destroying what may be a legitimate future kind.
// record keeps exit 0 and still writes the entry, but now warns on stderr —
// the same idiom invalidate already uses for a target with no match — and
// stores no kind-specific fields, since fieldsFor() of an unknown kind is empty.
test('an unrecognised kind still writes, warning instead of refusing', async () => {
  const dir = await root();
  const r = await runCli(
    ['record', '--workspace', 'ws', '--kind', 'not_a_real_kind', '--id', 'x1'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' },
  );
  assert.equal(r.code, 0, `an unrecognised kind was refused: ${r.stderr}`);
  assert.match(r.stderr, /WARNING/);
  assert.match(r.stderr, /not_a_real_kind/);

  const [entry] = await readAllEvents(dir, 'ws');
  assert.equal(entry!.kind, 'not_a_real_kind');
  assert.deepEqual(entry!.data, {}, 'no kind-specific fields should have been stored');
});

// IMPORTANT (fix round 2): 'constructor' is a prototype-chain key, not just
// an arbitrary unrecognised string. Before this round it took a different,
// broken path — the CLI's own iteration over fieldsFor('constructor') threw,
// since KIND_FIELDS['constructor'] resolves to Object's constructor function
// rather than undefined. It must land on the exact same unrecognised-kind
// path as 'not_a_real_kind': exit 0, entry written, warning on stderr.
test('an unrecognised kind that collides with a prototype key takes the same path as any other', async () => {
  const dir = await root();
  const r = await runCli(
    ['record', '--workspace', 'ws', '--kind', 'constructor', '--id', 'x2'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' },
  );
  assert.equal(r.code, 0, `--kind constructor was refused instead of taking the unrecognised-kind path: ${r.stderr}`);
  assert.match(r.stderr, /WARNING/);
  assert.match(r.stderr, /constructor/);

  const [entry] = await readAllEvents(dir, 'ws');
  assert.equal(entry!.kind, 'constructor');
  assert.deepEqual(entry!.data, {}, 'no kind-specific fields should have been stored');
});

test('show reports outcomes, liveness and evidence per entry', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'base',
    '--question', 'q', '--chosen', 'c', '--anchor', 'commit:9f2c1ab'], env);
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'rests',
    '--question', 'q', '--chosen', 'c', '--influence', 'journal:decisive:base'], env);
  await runCli(['invalidate', 'base', '--workspace', 'ws', '--reason', 'premise false'], env);

  const r = await runCli(['show', '--workspace', 'ws'], env);
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);

  const byId = Object.fromEntries(out.entries.map((e: any) => [e.id, e]));
  assert.equal(byId.base.outcome, 'invalidated');
  assert.equal(byId.base.live, false);
  assert.equal(byId.rests.outcome, 'invalidated', 'propagation is not visible through show');
  assert.deepEqual(byId.base.anchors, [{ type: 'commit', ref: '9f2c1ab' }]);
  assert.equal(byId.rests.anchors, null, 'no anchors must read as null, never []');

  // The influences twin of the anchors assertion above. anchors was protected;
  // influences was not — mutating its `: null` fallback to `: []` left the
  // whole suite green until this was added. Asserting the actual value, not
  // `assert.ok(!x)`, which passes for null, [] and undefined alike.
  assert.deepEqual(byId.rests.influences, [{ type: 'journal', role: 'decisive', ref: 'base' }]);
  assert.equal(byId.base.influences, null, 'no influences must read as null, never []');
});

test('show surfaces live constraints and which entries they bear on', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'constraint', '--id', 'c1',
    '--statement', 'never a third-party sink for this telemetry',
    '--scope', 'telemetry', '--enforcement', 'blocking'], env);
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'where does telemetry go?', '--chosen', 'a vendor'], env);

  const out = JSON.parse((await runCli(['show', '--workspace', 'ws'], env)).stdout);
  assert.deepEqual(out.liveConstraints.map((c: any) => c.id), ['c1']);
  const d1 = out.entries.find((e: any) => e.id === 'd1');
  assert.deepEqual(d1.constraintsBearingOn, ['c1']);
});

test('show --id narrows to one entry', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  for (const id of ['a1', 'b1']) {
    await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', id,
      '--question', 'q', '--chosen', 'c'], env);
  }
  const out = JSON.parse((await runCli(['show', '--workspace', 'ws', '--id', 'a1'], env)).stdout);
  assert.deepEqual(out.entries.map((e: any) => e.id), ['a1']);
});

test('show inherits coverage\'s honesty about a damaged journal', async () => {
  const dir = await root();
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'a1',
    '--question', 'q', '--chosen', 'c'], { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  const segDir = join(dir, 'workspaces', 'ws', 'segments');
  const seg = (await readdir(segDir, { recursive: true }) as string[]).find((f) => f.endsWith('.jsonl'))!;
  await writeFile(join(segDir, seg), 'not json\n');

  const r = await runCli(['show', '--workspace', 'ws'], { AGENT_JOURNAL_ROOT: dir });
  assert.notEqual(r.code, 0, 'a corrupt journal reported success');
  assert.match(r.stdout + r.stderr, /malformed/i);
});

// Fix round 1 (Task 5 review): the void-event filter (`e.kind !== 'void'` in
// cli.ts's `show`) had no test — dropping it left the whole suite green,
// because no other `show` fixture produces a void event. A refusal must
// actually refuse for this fixture to mean anything, so that is asserted too.
test('show excludes void events — a refusal must never render as a live entry', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'good',
    '--question', 'q', '--chosen', 'c'], env);
  const refused = await runCli(
    ['record', '--workspace', 'ws', '--kind', 'decision', '--question', 'q', '--chosen', 'x',
      '--rationale', 'y'.repeat(300000)],
    env,
  );
  assert.notEqual(refused.code, 0, 'the fixture must actually trigger a redaction refusal');

  const out = JSON.parse((await runCli(['show', '--workspace', 'ws'], env)).stdout);
  assert.deepEqual(out.entries.map((e: any) => e.id), ['good'], 'a void event leaked into show\'s entries');
});

// Fix round 1 (Task 5 review, RULING): `invalidate` writes its retraction as
// an ordinary `kind: 'decision'` event carrying `data.invalidates`. Without a
// marker it renders indistinguishable from a real live decision — outcome
// unknown, no anchors — inflating "what is live" by one per retraction. This
// already fooled a later task's brief, which expected two entries where three
// actually render; `retracts` is the fix, not hiding the record or changing
// its stored kind.
test('show marks a retraction record with retracts, distinct from an ordinary decision', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'q', '--chosen', 'c'], env);
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'a1',
    '--question', 'q', '--chosen', 'c'], env);
  await runCli(['invalidate', 'd1', '--workspace', 'ws', '--reason', 'premise false'], env);

  const out = JSON.parse((await runCli(['show', '--workspace', 'ws'], env)).stdout);
  assert.equal(out.entries.length, 3, 'record, record, invalidate renders as three entries on disk');

  const byId = Object.fromEntries(out.entries.map((e: any) => [e.id, e]));
  assert.deepEqual(byId.d1.retracts, null);
  assert.deepEqual(byId.a1.retracts, null);

  const retraction = out.entries.find((e: any) => e.id !== 'd1' && e.id !== 'a1');
  assert.ok(retraction, 'the retraction record itself must be present, not hidden');
  assert.deepEqual(retraction.retracts, [{ type: 'invalidates', target: 'd1' }]);
});

// Final review, finding 1 (HIGH): a bare unrecognised kind is genuine forward
// compatibility and must still write at exit 0 (covered above by "an
// unrecognised kind still writes, warning instead of refusing"). But content
// flags are a different story — fieldsFor() of an unknown kind is empty, so
// every one of them was silently thrown away while the CLI still reported
// success. `--kind decisio` (a typo of `decision`) with `--question`,
// `--chosen`, `--rejected` and `--rationale` used to write `{"kind":"decisio",
// "data":{}}` at exit 0, destroying all four with no flag named anywhere the
// caller could see without `2>&1`.
test('record refuses an unrecognised kind that carries content flags, naming them', async () => {
  const dir = await root();
  const r = await runCli(
    ['record', '--workspace', 'ws', '--kind', 'decisio', '--id', 't1',
      '--question', 'q', '--chosen', 'c', '--rejected', 'r', '--rationale', 'because'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' },
  );
  assert.equal(r.code, 2, `an unrecognised kind with content flags was not refused: ${r.stderr}`);
  assert.match(r.stderr, /--question/, 'the refusal must name the destroyed flag');
  assert.equal((await readAllEvents(dir, 'ws')).length, 0, 'nothing should have been written');
});

// Final review, finding 2 (HIGH): a constraint that states no obligation
// cannot be one. Before this, `--kind constraint` with no `--statement` (or a
// blank one) wrote and reported success, `show` rendered it `live: true`, and
// `liveConstraints` — the thing it is actually supposed to constrain — stayed
// empty with nothing explaining why.
test('record --kind constraint requires --statement, whether absent or blank', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };

  const missing = await runCli(['record', '--workspace', 'ws', '--kind', 'constraint', '--id', 'c1',
    '--scope', 'telemetry', '--enforcement', 'blocking'], env);
  assert.equal(missing.code, 2, `a constraint with no --statement was accepted: ${missing.stderr}`);
  assert.match(missing.stderr, /--statement/);

  const blank = await runCli(['record', '--workspace', 'ws', '--kind', 'constraint', '--id', 'c2',
    '--statement', '', '--scope', 'telemetry', '--enforcement', 'blocking'], env);
  assert.equal(blank.code, 2, `a constraint with a blank --statement was accepted: ${blank.stderr}`);
  assert.match(blank.stderr, /--statement/);

  const ok = await runCli(['record', '--workspace', 'ws', '--kind', 'constraint', '--id', 'c3',
    '--statement', 'never a third-party sink', '--scope', 'telemetry', '--enforcement', 'blocking'], env);
  assert.equal(ok.code, 0, `a constraint with a real statement was refused: ${ok.stderr}`);

  const events = await readAllEvents(dir, 'ws');
  assert.deepEqual(events.map((e) => e.id), ['c3'], 'only the valid constraint should have reached disk');
});

// Final review, finding 3 (MEDIUM-HIGH): an entry can carry both retraction
// edges, naming two DIFFERENT entries — this is not retract.ts's "one target,
// which outcome wins" question, so a single-winner `retracts` hid one of two
// real edges. `retracts` is now an array; invalidates still orders before
// supersedes when both are present, matching retract.ts's own precedence.
test('show renders both retraction edges when an entry carries supersedes and invalidates', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  for (const id of ['old', 'wrong']) {
    await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', id,
      '--question', 'q', '--chosen', 'c'], env);
  }
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'both',
    '--question', 'q', '--chosen', 'c', '--supersedes', 'old', '--invalidates', 'wrong'], env);

  const out = JSON.parse((await runCli(['show', '--workspace', 'ws'], env)).stdout);
  const both = out.entries.find((e: any) => e.id === 'both');
  assert.deepEqual(both.retracts, [
    { type: 'invalidates', target: 'wrong' },
    { type: 'supersedes', target: 'old' },
  ], 'both edges must appear, invalidates ordered before supersedes');

  const old = out.entries.find((e: any) => e.id === 'old');
  assert.deepEqual(old.retracts, null, 'an entry retracting nothing must read null, never []');
});

// Final review, finding 4 (MEDIUM): show's own retraction predicate must match
// retract.ts's non-blank-after-trim rule (`stringField`), not a weaker
// `typeof === 'string'` check. Fix 5 (below) means the CLI itself can no
// longer produce a stored blank supersedes/invalidates — so this writes the
// raw event directly, the way a hook adapter or another non-CLI producer
// might, to prove `show` denies the retraction on its own rather than relying
// on the CLI to have filtered it upstream.
test('show does not assert a retraction from a blank supersedes written outside the CLI', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'q', '--chosen', 'c'], env);

  const segDir = join(dir, 'workspaces', 'ws', 'segments');
  const seg = (await readdir(segDir, { recursive: true }) as string[]).find((f) => f.endsWith('.jsonl'))!;
  const raw = {
    schemaVersion: 1, id: 'blank-sup', source: 'hook/host/s1/primary', sourceEpoch: 'e1',
    time: new Date().toISOString(), workspace: 'ws', session: 's1', agent: 'primary',
    author: 'agent', provenance: 'hook', harness: 'other', context: 'coding',
    capabilities: {}, kind: 'decision', data: { question: 'q', chosen: 'c', supersedes: '   ' },
  };
  await writeFile(join(segDir, seg), `${JSON.stringify(raw)}\n`, { flag: 'a' });

  const out = JSON.parse((await runCli(['show', '--workspace', 'ws'], env)).stdout);
  const entry = out.entries.find((e: any) => e.id === 'blank-sup');
  assert.ok(entry, 'the raw event must still be read back');
  assert.deepEqual(entry.retracts, null, 'a blank supersedes must not assert a retraction');
});

// Final review, finding 5 (MEDIUM): a field whose value is empty or
// whitespace-only is "not supplied" — skipped, not stored as "". Asserted
// with `!(field in data)`, never `assert.ok(!data.field)`, which passes for
// '' too and would not have caught the bug.
test('a blank scalar field is not stored — absent, never ""', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'q', '--chosen', 'c', '--rationale', ''], env);
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd2',
    '--question', 'q', '--chosen', 'c', '--rationale', '   '], env);

  const byId = new Map((await readAllEvents(dir, 'ws')).map((e) => [e.id, e]));
  assert.ok(!('rationale' in byId.get('d1')!.data), 'a blank rationale must be absent, not stored as ""');
  assert.ok(!('rationale' in byId.get('d2')!.data), 'a whitespace-only rationale must be absent too');
});

test('a blank --supersedes or --invalidates is not stored — absent, never ""', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'q', '--chosen', 'c', '--supersedes', '', '--invalidates', '   '], env);

  const [entry] = await readAllEvents(dir, 'ws');
  assert.ok(!('supersedes' in entry!.data), '--supersedes "" must be absent, not stored');
  assert.ok(!('invalidates' in entry!.data), '--invalidates "   " must be absent, not stored');
});

// Final review, finding 6 (MEDIUM): `invalidate` already warns a human when
// its target does not match; `record --supersedes`/`--invalidates`/
// `--influence journal:...` silently accepted the same mistake. Not refused —
// an edge may legitimately precede its target across replicas — but no
// longer silent either.
test('record warns when --supersedes, --invalidates or a journal influence names a nonexistent id', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };

  const sup = await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 's1e',
    '--question', 'q', '--chosen', 'c', '--supersedes', 'ghost1'], env);
  assert.equal(sup.code, 0, sup.stderr);
  assert.match(sup.stderr, /WARNING: no entry with id ghost1 is present in this workspace/);

  const inv = await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'i1e',
    '--question', 'q', '--chosen', 'c', '--invalidates', 'ghost2'], env);
  assert.equal(inv.code, 0, inv.stderr);
  assert.match(inv.stderr, /WARNING: no entry with id ghost2 is present in this workspace/);

  const infl = await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'f1e',
    '--question', 'q', '--chosen', 'c', '--influence', 'journal:decisive:ghost3'], env);
  assert.equal(infl.code, 0, infl.stderr);
  assert.match(infl.stderr, /WARNING: no entry with id ghost3 is present in this workspace/);
});

test('record does not warn when the referenced id actually exists', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'real1',
    '--question', 'q', '--chosen', 'c'], env);
  const r = await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'real2',
    '--question', 'q', '--chosen', 'c', '--supersedes', 'real1',
    '--influence', 'journal:decisive:real1'], env);
  assert.equal(r.code, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /WARNING: no entry with id/);
});

// Final review, finding 7 (MEDIUM): an entry that names its own id in
// --supersedes/--invalidates would be written, acknowledged (exit 0) and
// project `live: false` on arrival — dead on arrival, with nothing pointing
// at the mistake. Refused outright instead.
test('an entry cannot supersede or invalidate its own id', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };

  const selfSup = await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'self1',
    '--question', 'q', '--chosen', 'c', '--supersedes', 'self1'], env);
  assert.equal(selfSup.code, 2, `self-supersede was accepted: ${selfSup.stderr}`);
  assert.match(selfSup.stderr, /--supersedes/);

  const selfInv = await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'self2',
    '--question', 'q', '--chosen', 'c', '--invalidates', 'self2'], env);
  assert.equal(selfInv.code, 2, `self-invalidate was accepted: ${selfInv.stderr}`);
  assert.match(selfInv.stderr, /--invalidates/);

  assert.equal((await readAllEvents(dir, 'ws')).length, 0, 'neither self-retracting entry should have been written');
});

// Final review, finding 8 (MEDIUM): a constraint's `live` in `show`'s
// `entries` must agree with its absence from `liveConstraints` — an expired
// constraint used to render `live: true` in one and be missing from the
// other, two meanings of "live" in one payload.
test('show reports an expired constraint as live: false, matching its absence from liveConstraints', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'constraint', '--id', 'c1',
    '--statement', 'never a third-party sink', '--scope', 'telemetry',
    '--enforcement', 'blocking', '--expiry', '2020-01-01'], env);

  const out = JSON.parse((await runCli(['show', '--workspace', 'ws'], env)).stdout);
  const c1 = out.entries.find((e: any) => e.id === 'c1');
  assert.equal(c1.live, false, 'an expired constraint must not render as live');
  assert.deepEqual(out.liveConstraints, [], 'the expired constraint must be absent from liveConstraints');
});

test('record defaults to team, per spec 13.3', async () => {
  const dir = await root();
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'q', '--chosen', 'c'], { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  const [entry] = await readAllEvents(dir, 'ws');
  assert.equal(entry!.disclosure, 'team',
    'a written entry defaults to team; only an unreadable foreign one contains');
});

test('record honours each disclosure class', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  for (const c of ['private', 'team', 'published'] as const) {
    const r = await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', c,
      '--question', 'q', '--chosen', 'c', '--disclosure', c], env);
    assert.equal(r.code, 0, r.stderr);
  }
  const byId = Object.fromEntries((await readAllEvents(dir, 'ws')).map((e) => [e.id, e.disclosure]));
  assert.deepEqual(byId, { private: 'private', team: 'team', published: 'published' });
});

// Silently containing would repeat the `--author robot` mistake: the caller is
// present and can be told, so tell them.
test('an unrecognised --disclosure is refused, not silently contained', async () => {
  const dir = await root();
  const r = await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'q', '--chosen', 'c', '--disclosure', 'public'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  assert.equal(r.code, 2, `--disclosure public was accepted: ${r.stdout}`);
  assert.match(r.stderr, /private, team, published/);
  assert.equal((await readAllEvents(dir, 'ws')).length, 0);
});

test('record stores --subject, which the envelope has always had and nothing could write', async () => {
  const dir = await root();
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'q', '--chosen', 'c', '--subject', 'src/queue.ts'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  const [entry] = await readAllEvents(dir, 'ws');
  assert.equal(entry!.subject, 'src/queue.ts');
});

test('a blank --subject leaves the key absent, like every other blank scalar', async () => {
  const dir = await root();
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'q', '--chosen', 'c', '--subject', '   '],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  const [entry] = await readAllEvents(dir, 'ws');
  assert.ok(!('subject' in entry!), `subject was stored as blank: ${JSON.stringify(entry!.subject)}`);
});
