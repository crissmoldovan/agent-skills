import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile, chmod, mkdir, symlink } from 'node:fs/promises';
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

// Fix round 2 for Task 2: pins the OBSERVABLE contract — padding does not
// survive to disk — rather than which layer trims it. cli.ts's own
// `rawSubject.trim()` is redundant with envelope.ts's `text()`, which also
// trims; this must pass whichever one is doing the work, so it stays true
// even if the redundant call in cli.ts is later removed.
test('a padded --subject is stored trimmed', async () => {
  const dir = await root();
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'q', '--chosen', 'c', '--subject', '  src/queue.ts  '],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  const [entry] = await readAllEvents(dir, 'ws');
  assert.equal(entry!.subject, 'src/queue.ts');
});

// Fix round 1 for Task 2: invalidate was left on the wrong side of the same
// distinction record now draws. A retraction is an entry this CLI just wrote
// and knows the intent of — it should default to `team` (spec 13.3), not
// `private`, which is only right for a foreign record whose intent is
// unknowable.
test('invalidate defaults to team, not private, per spec 13.3', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'f1',
    '--question', 'q', '--chosen', 'c'], env);
  await runCli(['invalidate', 'f1', '--reason', 'wrong interpreter on PATH', '--workspace', 'ws'],
    { AGENT_JOURNAL_ROOT: dir });
  const events = await readAllEvents(dir, 'ws');
  const retraction = events.find((e) => e.data.invalidates === 'f1');
  assert.equal(retraction!.disclosure, 'team',
    'a retraction this CLI wrote defaults to team; only an unreadable foreign one contains');
});

test('invalidate --disclosure private writes private', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'f1',
    '--question', 'q', '--chosen', 'c'], env);
  const r = await runCli(
    ['invalidate', 'f1', '--reason', 'names a person', '--workspace', 'ws', '--disclosure', 'private'],
    { AGENT_JOURNAL_ROOT: dir },
  );
  assert.equal(r.code, 0, r.stderr);
  const events = await readAllEvents(dir, 'ws');
  const retraction = events.find((e) => e.data.invalidates === 'f1');
  assert.equal(retraction!.disclosure, 'private');
});

test('invalidate --disclosure public is refused, not silently contained', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'f1',
    '--question', 'q', '--chosen', 'c'], env);
  const r = await runCli(
    ['invalidate', 'f1', '--reason', 'why', '--workspace', 'ws', '--disclosure', 'public'],
    { AGENT_JOURNAL_ROOT: dir },
  );
  assert.equal(r.code, 2, `--disclosure public was accepted: ${r.stdout}`);
  assert.match(r.stderr, /private, team, published/);
  const events = await readAllEvents(dir, 'ws');
  assert.ok(!events.some((e) => e.data.invalidates === 'f1'), 'no retraction should have been written');
});

test('a retraction and the entry it retracts both land at team level by default', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'f1',
    '--question', 'q', '--chosen', 'c'], env);
  await runCli(['invalidate', 'f1', '--reason', 'wrong interpreter on PATH', '--workspace', 'ws'],
    { AGENT_JOURNAL_ROOT: dir });
  const events = await readAllEvents(dir, 'ws');
  const entry = events.find((e) => e.id === 'f1');
  const retraction = events.find((e) => e.data.invalidates === 'f1');
  // Asserting on the written disclosure values themselves, not on digest
  // output — a team-level digest does not exist yet.
  assert.equal(entry!.disclosure, 'team');
  assert.equal(retraction!.disclosure, 'team');
});

test('digest defaults to published and renders the coverage statement', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'pub',
    '--question', 'the public one', '--chosen', 'x', '--disclosure', 'published'], env);
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'priv',
    '--question', 'the candid one', '--chosen', 'y', '--disclosure', 'private'], env);

  const r = await runCli(['digest', '--workspace', 'ws'], env);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.stdout.includes('the public one'));
  assert.ok(!r.stdout.includes('the candid one'), 'a private entry reached the digest');
  assert.match(r.stdout, /Coverage/i);
});

test('digest --level team includes team entries', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 't1',
    '--question', 'team only', '--chosen', 'x'], env);   // default team
  assert.ok(!(await runCli(['digest', '--workspace', 'ws'], env)).stdout.includes('team only'));
  assert.ok((await runCli(['digest', '--workspace', 'ws', '--level', 'team'], env))
    .stdout.includes('team only'));
});

test('digest --out writes the file, and refuses when the journal is damaged', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'q', '--chosen', 'c', '--disclosure', 'published'], env);

  const out = join(dir, 'digest.md');
  const ok = await runCli(['digest', '--workspace', 'ws', '--out', out], env);
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(await readFile(out, 'utf8'), /Decision digest/);

  const segDir = join(dir, 'workspaces', 'ws', 'segments');
  const seg = (await readdir(segDir, { recursive: true }) as string[]).find((f) => f.endsWith('.jsonl'))!;
  await writeFile(join(segDir, seg), 'not json\n');
  const damaged = await runCli(['digest', '--workspace', 'ws', '--out', join(dir, 'bad.md')], env);
  assert.notEqual(damaged.code, 0, 'a damaged journal produced a digest at exit 0');
  assert.match(damaged.stderr, /malformed|unreadable/i);
  await assert.rejects(() => readFile(join(dir, 'bad.md'), 'utf8'),
    'a partial digest was written from a journal that could not be read');
});

test('an unrecognised --level is refused', async () => {
  const dir = await root();
  const r = await runCli(['digest', '--workspace', 'ws', '--level', 'public'],
    { AGENT_JOURNAL_ROOT: dir });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /private, team, published/);
});

test('trace finds an entry by ticket and walks backwards', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'root',
    '--question', 'the original', '--chosen', 'x'], env);
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'later',
    '--question', 'the newer one', '--chosen', 'y',
    '--influence', 'ticket:decisive:PROJ-412',
    '--influence', 'journal:decisive:root'], env);

  const r = await runCli(['trace', 'PROJ-412', '--workspace', 'ws'], env);
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.matched, [{ id: 'later', via: 'influence' }]);
  assert.deepEqual(out.chain.map((c: any) => c.id), ['later', 'root']);
  assert.deepEqual(out.chain.map((c: any) => c.via), [null, 'influences']);
});

test('trace with no key is refused rather than tracing everything', async () => {
  const dir = await root();
  const r = await runCli(['trace', '--workspace', 'ws'], { AGENT_JOURNAL_ROOT: dir });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /key/i);
});

test('trace on an unmatched key exits 0 with an empty result, and says so', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'q', '--chosen', 'c'], env);
  const r = await runCli(['trace', 'nothing-matches-this', '--workspace', 'ws'], env);
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.stdout).matched, []);
  assert.match(r.stderr, /no entry/i, 'an empty result was silent');
});

// runCli's generic catch stringifies I/O failures as `${e.code}: ${e.message}`,
// but Node's fs errors already begin their `message` with the code
// (`EISDIR: illegal operation on a directory, open '...'`), so the naive
// concatenation doubled it: `could not complete: EISDIR: EISDIR: ...`. `--out`
// is what made this reachable by a user doing something ordinary — pointing at
// a directory that already exists where the digest should go. `includes` would
// pass with the bug present; only a count nails it down.
test('digest --out at an existing directory reports EISDIR exactly once, not doubled', async () => {
  const dir = await root();
  const outDir = join(dir, 'digest.md');
  await mkdir(outDir);
  const r = await runCli(['digest', '--workspace', 'ws', '--out', outDir], { AGENT_JOURNAL_ROOT: dir });
  assert.equal(r.code, 1, r.stdout);
  const count = r.stderr.split('EISDIR').length - 1;
  assert.equal(count, 1, `expected EISDIR exactly once, got ${count} in: ${r.stderr}`);
});

test('digest --out at an unwritable existing file reports EACCES exactly once, not doubled', async () => {
  const dir = await root();
  const outFile = join(dir, 'digest.md');
  await writeFile(outFile, 'pre-existing\n', 'utf8');
  await chmod(outFile, 0o400);
  try {
    const r = await runCli(['digest', '--workspace', 'ws', '--out', outFile], { AGENT_JOURNAL_ROOT: dir });
    assert.equal(r.code, 1, r.stdout);
    const count = r.stderr.split('EACCES').length - 1;
    assert.equal(count, 1, `expected EACCES exactly once, got ${count} in: ${r.stderr}`);
  } finally {
    await chmod(outFile, 0o600);
  }
});

// readAll() walks every `*.jsonl` under a workspace's segments/ tree, so a
// digest written there becomes journal input on the very next read of this
// workspace — coverage/show/trace would parse this command's own artifact as
// journal data, and a name ending in `.jsonl` gets treated as a segment,
// wedging the damaged-journal refusal against a corruption this command
// inflicted on itself. A non-`.jsonl` name in the same directory is harmless,
// which is what makes this a plausible typo rather than an obviously silly
// path.
test("digest --out inside the workspace's own segment tree is refused, not written", async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'q', '--chosen', 'c', '--disclosure', 'published'], env);

  const segDir = join(dir, 'workspaces', 'ws', 'segments');
  const insideOut = join(segDir, 'oops.jsonl');

  const r = await runCli(['digest', '--workspace', 'ws', '--out', insideOut], env);
  assert.equal(r.code, 2, `a digest into the segment tree was accepted: ${r.stdout}`);
  assert.match(r.stderr, /segment/i);
  await assert.rejects(() => readFile(insideOut, 'utf8'),
    "a digest was written inside the workspace's own segment tree");

  // The workspace must still read cleanly afterward — nothing this command
  // did should have become input to the next read. `coverage`'s JSON always
  // carries a `malformed` key (empty when clean), so assert on the parsed
  // array being empty rather than the substring's mere presence.
  const after = await runCli(['coverage', '--workspace', 'ws'], env);
  assert.equal(after.code, 0, after.stderr);
  assert.deepEqual(JSON.parse(after.stdout).malformed, []);
  assert.deepEqual(JSON.parse(after.stdout).unreadable, []);
});

// The same containment check must not be defeated by a `..` segment that a
// naive string-prefix comparison (`resolvedOut.startsWith(segmentsDir)`)
// would miss unless both sides are actually resolved. Built as a raw string,
// not via path.join/resolve in the test itself, so the traversal reaches the
// CLI's own resolution unnormalized — the same way a shell argument would.
test('digest --out defeats containment via a `..` traversal is still refused', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'q', '--chosen', 'c', '--disclosure', 'published'], env);

  const traversalOut = `${dir}/workspaces/ws/not-a-real-dir/../segments/oops.jsonl`;
  const r = await runCli(['digest', '--workspace', 'ws', '--out', traversalOut], env);
  assert.equal(r.code, 2, `a traversal into the segment tree was accepted: ${r.stdout}`);
  assert.match(r.stderr, /segment/i);
  await assert.rejects(
    () => readFile(join(dir, 'workspaces', 'ws', 'segments', 'oops.jsonl'), 'utf8'),
    'a `..` traversal reached inside the segment tree despite the guard',
  );
});

// `digest --out` to a path OUTSIDE the segment tree must still work — the
// guard above is scoped to the segment tree specifically, not the whole
// journal root, since a digest at `<root>/digest.md` is odd but harmless and
// refusing every path under the root would block a legitimate layout choice
// for no safety gain.
test('digest --out to a legitimate path outside the segment tree still works', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'q', '--chosen', 'c', '--disclosure', 'published'], env);

  const out = join(dir, 'docs', 'decisions', 'digest.md');
  const r = await runCli(['digest', '--workspace', 'ws', '--out', out], env);
  assert.equal(r.code, 0, r.stderr);
  assert.match(await readFile(out, 'utf8'), /Decision digest/);
});

// I1 — `realpath()` throws ENOENT for a DANGLING symlink's target exactly the
// same way it throws for a path that simply does not exist yet. The old
// `canonicalize` treated both cases identically — walk up, lexically rejoin
// the basename — which for a dangling final-component symlink reconstructs
// the LINK'S OWN location, never where it points. `writeFile` then follows
// the link anyway: `--out` at a symlink whose (nonexistent) target lives
// inside the segment tree slipped past the guard, exited 0, and the write
// landed inside the tree — reproduced here exactly as in the review finding.
test('digest --out through a dangling symlink into the segment tree is refused, not written through', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'q', '--chosen', 'c', '--disclosure', 'published'], env);

  const segDir = join(dir, 'workspaces', 'ws', 'segments');
  const poisonTarget = join(segDir, 'poison.jsonl'); // does not exist — the dangling half
  const linkPath = join(dir, 'out-link.md'); // outside the segment tree entirely
  await symlink(poisonTarget, linkPath);

  const r = await runCli(['digest', '--workspace', 'ws', '--out', linkPath], env);
  assert.equal(r.code, 2, `a dangling symlink into the segment tree was accepted: ${r.stdout}`);
  assert.match(r.stderr, /segment/i);
  await assert.rejects(() => readFile(poisonTarget, 'utf8'),
    'a dangling symlink let the digest write through into the segment tree');

  // The workspace must still read cleanly afterward.
  const after = await runCli(['coverage', '--workspace', 'ws'], env);
  assert.equal(after.code, 0, after.stderr);
  assert.deepEqual(JSON.parse(after.stdout).malformed, []);
  assert.deepEqual(JSON.parse(after.stdout).unreadable, []);
});

// I2 — the segment-tree guard was scoped to only the RENDERED workspace's own
// tree. `--out` naming a DIFFERENT workspace's segment tree — one that may
// never have been written to before — slipped past entirely and wedged that
// sibling's damaged-journal refusal permanently, while this command exited 0
// for the workspace it was actually asked about.
test("digest --out into a DIFFERENT workspace's segment tree is refused, even one that never existed", async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'q', '--chosen', 'c', '--disclosure', 'published'], env);

  // `other` has never been recorded to — its segments/ directory does not
  // exist on disk yet.
  const poison = join(dir, 'workspaces', 'other', 'segments', 'p.jsonl');
  const r = await runCli(['digest', '--workspace', 'ws', '--out', poison], env);
  assert.equal(r.code, 2, `a sibling workspace's segment tree was accepted: ${r.stdout}`);
  assert.match(r.stderr, /segment/i);
  await assert.rejects(() => readFile(poison, 'utf8'),
    "a digest was written inside a different workspace's segment tree");

  // `other` must still read as a genuinely empty, undamaged workspace.
  const otherCoverage = await runCli(['coverage', '--workspace', 'other'], env);
  assert.equal(otherCoverage.code, 0, otherCoverage.stderr);
  assert.deepEqual(JSON.parse(otherCoverage.stdout).malformed, []);
  assert.deepEqual(JSON.parse(otherCoverage.stdout).unreadable, []);
});

// I8, half A — `resolvedOut === segmentsDir` (no filename at all, `--out`
// pointed directly AT the tree) is a separate condition from "strictly
// inside", and nothing previously exercised it on its own: every existing
// test used a path WITH a filename under the tree.
test('digest --out pointed AT a segments directory itself (no filename) is refused', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'q', '--chosen', 'c', '--disclosure', 'published'], env);

  const segDir = join(dir, 'workspaces', 'ws', 'segments');
  const r = await runCli(['digest', '--workspace', 'ws', '--out', segDir], env);
  assert.equal(r.code, 2, `--out at the segments dir itself was accepted: ${r.stdout}`);
  assert.match(r.stderr, /segment/i);
});

// I8, half B — a sibling directory that merely shares the `segments` PREFIX,
// e.g. `segments-backup`, must not be caught by a `startsWith(segmentsDir)`
// missing the trailing separator. Nothing previously exercised this: no
// existing test wrote to a sibling of the segment tree with a matching
// prefix.
test('digest --out to a sibling directory that only shares the "segments" prefix is not refused', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'q', '--chosen', 'c', '--disclosure', 'published'], env);

  const out = join(dir, 'workspaces', 'ws', 'segments-backup', 'd.md');
  const r = await runCli(['digest', '--workspace', 'ws', '--out', out], env);
  assert.equal(r.code, 0, `a legitimate sibling of the segment tree was refused: ${r.stderr}`);
  assert.match(await readFile(out, 'utf8'), /Decision digest/);
});

// I5 — §13.3, verbatim: "private never leaves the local journal — not to
// sync, not to a hosted sink, not to a digest." Writing a file is leaving;
// stdout is local inspection and stays available.
test('digest --level private --out is refused; stdout remains available', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'the candid one', '--chosen', 'c', '--disclosure', 'private'], env);

  const out = join(dir, 'priv-digest.md');
  const r = await runCli(['digest', '--workspace', 'ws', '--level', 'private', '--out', out], env);
  assert.equal(r.code, 2, `--level private --out was accepted: ${r.stdout}`);
  assert.match(r.stderr, /private/i);
  assert.match(r.stderr, /stdout/i);
  await assert.rejects(() => readFile(out, 'utf8'), 'a private digest was written to a file');

  const stdoutR = await runCli(['digest', '--workspace', 'ws', '--level', 'private'], env);
  assert.equal(stdoutR.code, 0, stdoutR.stderr);
  assert.ok(stdoutR.stdout.includes('the candid one'),
    'stdout must remain available for local inspection at --level private');
});

// I7 — `digest`'s damage check is `unreadable.length > 0 || malformed.length
// > 0`. Every existing damaged-digest test corrupted a segment's CONTENT
// (malformed), never made one unreadable (chmod 000) — so the `unreadable`
// disjunct on its own had no test defending it.
test('digest refuses when a segment is unreadable, not just when one is malformed', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'd1',
    '--question', 'q', '--chosen', 'c', '--disclosure', 'published'], env);

  const segDir = join(dir, 'workspaces', 'ws', 'segments');
  const seg = (await readdir(segDir, { recursive: true }) as string[]).find((f) => f.endsWith('.jsonl'))!;
  await chmod(join(segDir, seg), 0o000);
  try {
    const out = join(dir, 'digest.md');
    const r = await runCli(['digest', '--workspace', 'ws', '--out', out], env);
    assert.notEqual(r.code, 0, 'an unreadable segment produced a digest at exit 0');
    assert.match(r.stderr, /unreadable/i);
    await assert.rejects(() => readFile(out, 'utf8'),
      'a digest was written from a journal with an unreadable segment');
  } finally {
    await chmod(join(segDir, seg), 0o600);
  }
});

// `rest[0]` for `trace --workspace ws` (no positional at all) is the literal
// string `'--workspace'` — always truthy, so only the `key.startsWith('--')`
// half of the guard is ever exercised by that test. An explicitly empty key
// (`trace '' --workspace ws`) is the only input that exercises the `!key`
// half on its own; nothing previously did.
test('trace with an explicitly empty key is refused, not treated as no key at all', async () => {
  const dir = await root();
  const r = await runCli(['trace', '', '--workspace', 'ws'], { AGENT_JOURNAL_ROOT: dir });
  assert.equal(r.code, 2, r.stdout);
  assert.match(r.stderr, /key/i);
});

test('observe writes an observation through the same validated path entries use', async () => {
  const dir = await root();
  const r = await runCli(['observe', '--workspace', 'ws', '--kind', 'tool_call',
    '--tool', 'Bash', '--input', 'git status', '--callId', 'c1'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  assert.equal(r.code, 0, r.stderr);
  const [e] = await readAllEvents(dir, 'ws');
  assert.equal(e!.kind, 'tool_call');
  assert.equal(e!.data.tool, 'Bash');
  assert.equal(e!.provenance, 'hook',
    'an observation records that a hook produced it, not the CLI');
});

// A hook firing forty times a turn is the only writer that needs this, and a gap
// in the sequence is how a dropped hook becomes visible in `coverage`.
test('observe accepts a sequence, and omits it when not given', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['observe', '--workspace', 'ws', '--kind', 'heartbeat', '--id', 'h1',
    '--seq', '7'], env);
  await runCli(['observe', '--workspace', 'ws', '--kind', 'heartbeat', '--id', 'h2'], env);
  const byId = Object.fromEntries((await readAllEvents(dir, 'ws')).map((e) => [e.id, e]));
  assert.equal(byId.h1!.sequence, 7);
  assert.ok(!('sequence' in byId.h2!), 'an absent sequence must not become 0');
});

test('observe refuses a non-numeric or negative sequence', async () => {
  const dir = await root();
  for (const bad of ['x', '-1', '1.5', '']) {
    const r = await runCli(['observe', '--workspace', 'ws', '--kind', 'heartbeat',
      '--seq', bad], { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
    assert.equal(r.code, 2, `--seq ${JSON.stringify(bad)} was accepted`);
  }
});

// A void records a refused write and is produced by the failure path itself.
// Letting a caller fabricate one lets a hook manufacture evidence of its own
// silence, which is exactly backwards.
test('observe refuses to write a void', async () => {
  const dir = await root();
  const r = await runCli(['observe', '--workspace', 'ws', '--kind', 'void'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /void/i);
  assert.equal((await readAllEvents(dir, 'ws')).length, 0);
});

// envelope.ts does not validate `kind`, so without this an `observe --kind
// constructor` writes a garbage event and exits 0 — the exact shape of the
// word-splitting incident this project already paid for.
test('observe refuses a kind that is not an observation kind', async () => {
  const dir = await root();
  for (const bad of ['constructor', '__proto__', 'not_a_kind', '']) {
    const r = await runCli(['observe', '--workspace', 'ws', '--kind', bad],
      { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
    assert.equal(r.code, 2, `--kind ${JSON.stringify(bad)} was accepted`);
  }
  assert.equal((await readAllEvents(dir, 'ws')).length, 0, 'a garbage kind reached disk');
});

test('observe refuses an entry kind — record writes those', async () => {
  const dir = await root();
  const r = await runCli(['observe', '--workspace', 'ws', '--kind', 'decision'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /record/i);
});

test('retention still classifies observations after the list moves to observe.ts', async () => {
  const { applyRetention } = await import('../src/retention.ts');
  const { OBSERVATION_KINDS } = await import('../src/observe.ts');
  const { normalizeEvent } = await import('../src/envelope.ts');
  assert.ok(OBSERVATION_KINDS.includes('heartbeat'));

  // A known observation is subject to retention; an unknown kind is kept and named.
  // Assert on applyRetention's own report, not on the list it now imports —
  // comparing the list to itself proves agreement, not correctness.
  const OLD = '2026-01-01T00:00:00.000Z';
  const NOW = '2026-09-07T00:00:00.000Z';
  const make = (id: string, kind: string) => normalizeEvent({
    schemaVersion: 1, id, source: 'h/m/s/a', sourceEpoch: 'e1', time: OLD,
    workspace: 'ws', session: 's', agent: 'a', author: 'agent', provenance: 'hook',
    harness: 'claude-code', context: 'coding', kind, data: {},
  });

  const report = applyRetention(
    [make('o1', 'heartbeat'), make('u1', 'some_future_kind_nobody_wrote_yet')],
    { now: NOW, observationTtlMs: 30 * 86400000 },
  );
  // heartbeat is a known observation with nothing citing it: it ages out.
  assert.deepEqual(report.expired, ['o1']);
  // An unknown kind is neither entry nor observation: kept and named, never
  // silently aged, and NOT reported as expired.
  assert.deepEqual(report.unclassified, ['u1']);
  assert.equal(report.keep.length, 1);
  assert.equal(report.keep[0]!.id, 'u1');

  // Drift guard. A byte-identical private copy in retention.ts is behaviourally
  // indistinguishable from the import, so no test can catch the copy itself —
  // what a test CAN catch is the copy going stale. Every kind observe.ts declares
  // must classify here; a retention-side list missing one files it as
  // unclassified and this fails.
  const all = applyRetention(
    OBSERVATION_KINDS.map((k, i) => make(`k${i}`, k)),
    { now: NOW, observationTtlMs: 30 * 86400000 },
  );
  assert.deepEqual(all.unclassified, [],
    `retention does not recognise every kind observe.ts declares: ${all.unclassified}`);
});

// Observations carry tool inputs — the highest-volume source of secrets here.
test('an observation goes through the redactor like any other write', async () => {
  const dir = await root();
  const token = 'ghp' + '_' + 'a1b2c3d4e5'.repeat(3);
  await runCli(['observe', '--workspace', 'ws', '--kind', 'tool_call', '--tool', 'Bash',
    '--input', `git push https://${token}@example.com/r.git`],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  const [e] = await readAllEvents(dir, 'ws');
  assert.ok(!JSON.stringify(e!.data).includes(token), 'a token reached disk from an observation');
});

test('observe --kind environment populates itself, needing no flags', async () => {
  const dir = await root();
  const r = await runCli(['observe', '--workspace', 'ws', '--kind', 'environment'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  assert.equal(r.code, 0, r.stderr);
  const [e] = await readAllEvents(dir, 'ws');
  assert.equal(e!.kind, 'environment');
  assert.equal(e!.data.version, process.version);
  assert.ok(String(e!.data.interpreter).includes('/'));
});

// 4.3: these values are machine-identifying. The home-path pattern already
// masks them and must not be bypassed for this kind.
test('an environment observation is redacted like anything else', async () => {
  const dir = await root();
  await runCli(['observe', '--workspace', 'ws', '--kind', 'environment'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  const [e] = await readAllEvents(dir, 'ws');
  const written = JSON.stringify(e!.data);
  assert.ok(!/\/Users\/[^/"]+/.test(written) && !/\/home\/[^/"]+/.test(written),
    `a home path reached disk: ${written}`);
});

// The test above can only fail on a machine whose interpreter actually lives
// under a home directory. On CI with a system-wide /usr/bin/node it passes
// vacuously even if redaction were removed entirely. This one supplies the home
// path itself, so it means the same thing everywhere.
test('an environment observation is redacted even where the toolchain is not in a home dir', async () => {
  const dir = await root();
  const home = '/Users' + '/someone';
  await runCli(['observe', '--workspace', 'ws', '--kind', 'environment',
    '--interpreter', `${home}/.local/bin/node`],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  const [e] = await readAllEvents(dir, 'ws');
  assert.ok(!JSON.stringify(e!.data).includes(home),
    `a supplied home path reached disk: ${JSON.stringify(e!.data)}`);
});

// Explicit flags win over the capture — a hook that knows better than the
// current process (a remote runner, a container) can override what would
// otherwise be self-populated.
test('an explicit flag on observe --kind environment overrides the capture', async () => {
  const dir = await root();
  const r = await runCli(
    ['observe', '--workspace', 'ws', '--kind', 'environment', '--interpreter', '/remote/bin/node'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' },
  );
  assert.equal(r.code, 0, r.stderr);
  const [e] = await readAllEvents(dir, 'ws');
  assert.equal(e!.data.interpreter, '/remote/bin/node');
  // The rest of the capture still populates — only the named field was overridden.
  assert.equal(e!.data.version, process.version);
});

test('claims lists live claims and says plainly that nothing is enforced', async () => {
  const dir = await root();
  await runCli(['observe', '--workspace', 'ws', '--kind', 'path_claim',
    '--checkout', '/work/repo', '--branch', 'main', '--ttlSeconds', '3600'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  const r = await runCli(['claims', '--workspace', 'ws'], { AGENT_JOURNAL_ROOT: dir });
  assert.equal(r.code, 0, 'claims must never fail on a healthy journal — it is advisory');
  const out = JSON.parse(r.stdout);
  assert.equal(out.claims.length, 1);
  assert.equal(out.claims[0].branch, 'main');
  // The payload says so in-band, so a consumer cannot mistake `claims` for a
  // lock without having read the docs. Untested, this field could be deleted
  // or flipped and nothing would notice.
  assert.equal(out.advisory, true, 'the advisory marker is missing from the payload');
});

// ---------------------------------------------------------------------------
// `--flag=value`. The space-separated form cannot carry a value beginning with
// `--`: the parser has to read a `--`-prefixed token as the next flag name, or
// a genuinely valueless flag stops being detectable. Before `=` was accepted,
// an assistant message opening with a markdown horizontal rule made
// `--turn ---\nSummary: …` a valueless `--turn` and the CLI exited 2 — and
// because both adapters ignore that exit code by design, nothing was written
// AND no `void` was recorded, so `coverage` showed no gap at all. Silence with
// no trace is the exact failure the observation plane exists to prevent.

test('a turn_end whose value IS a markdown horizontal rule is recorded, not lost', async () => {
  const dir = await root();
  const turn = '---\nSummary: fixed it.';
  const r = await runCli(
    ['observe', '--workspace=ws', '--kind=turn_end', `--turn=${turn}`],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' },
  );
  assert.equal(r.code, 0, r.stderr);
  const [e] = await readAllEvents(dir, 'ws');
  // The whole value, both lines, byte for byte — not merely "something landed".
  assert.equal(e!.data.turn, turn);
});

test('the space-separated form still parses, unchanged', async () => {
  const dir = await root();
  const r = await runCli(
    ['observe', '--workspace', 'ws', '--kind', 'turn_end', '--turn', 'plain text'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' },
  );
  assert.equal(r.code, 0, r.stderr);
  const [e] = await readAllEvents(dir, 'ws');
  assert.equal(e!.data.turn, 'plain text');
});

test('a value that starts with -- mid-sentence survives the = form', async () => {
  const dir = await root();
  const turn = '--force was the flag that broke it';
  const r = await runCli(
    ['observe', '--workspace=ws', '--kind=turn_end', `--turn=${turn}`],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' },
  );
  assert.equal(r.code, 0, r.stderr);
  const [e] = await readAllEvents(dir, 'ws');
  assert.equal(e!.data.turn, turn);
  // And specifically NOT parsed as a `--force` flag that the unknown-flag gate
  // would have rejected, nor as a valueless `--turn`.
  assert.equal(r.stderr, '');
});

test('the split is on the FIRST =, so a value containing = survives whole', async () => {
  const dir = await root();
  const input = '{"command":"AWS_REGION=eu-west-1 make deploy"}';
  const r = await runCli(
    ['observe', '--workspace=ws', '--kind=tool_call', '--tool=Bash', `--input=${input}`],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' },
  );
  assert.equal(r.code, 0, r.stderr);
  const [e] = await readAllEvents(dir, 'ws');
  assert.equal(e!.data.input, input);
});

test('a multi-line value survives the = form intact', async () => {
  const dir = await root();
  const summary = 'line one\nline two\n\nline four';
  const r = await runCli(
    ['observe', '--workspace=ws', '--kind=tool_result', '--tool=Bash', `--summary=${summary}`],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' },
  );
  assert.equal(r.code, 0, r.stderr);
  const [e] = await readAllEvents(dir, 'ws');
  assert.equal(e!.data.summary, summary);
});

test('every other field an adapter fills from harness text takes a -- value too', async () => {
  const dir = await root();
  // session_end --reason, compact --reason (from a Codex/Claude `trigger`),
  // and a tool_call --input that arrived as a bare string rather than an
  // object. All three are harness-supplied text the adapter does not control.
  const cases: Array<[readonly string[], string, string]> = [
    [['observe', '--workspace=ws', '--kind=session_end', '--reason=--- clear'], 'reason', '--- clear'],
    [['observe', '--workspace=ws', '--kind=compact', '--reason=--auto triggered'], 'reason', '--auto triggered'],
    [['observe', '--workspace=ws', '--kind=tool_call', '--tool=Bash', '--input=--version'], 'input', '--version'],
  ];
  for (const [argv, field, expected] of cases) {
    const r = await runCli(argv, { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
    assert.equal(r.code, 0, `${argv.join(' ')}: ${r.stderr}`);
  }
  const events = await readAllEvents(dir, 'ws');
  assert.equal(events.length, 3, 'all three observations must have reached disk');
  for (const [, field, expected] of cases) {
    assert.ok(
      events.some((e) => e.data[field] === expected),
      `no event carries ${field} === ${JSON.stringify(expected)}`,
    );
  }
});

// The valueless guard is why `--flag=` cannot mean "empty value". `--workspace $WS`
// with WS unset once wrote to a workspace literally named `true` at exit 0;
// `--workspace=$WS` with WS unset expands to `--workspace=`, the same accident in
// `=` clothing. Losing that guard would be a worse regression than the bug the `=`
// form fixes.
test('--flag= with nothing after the = is an error, not an empty value', async () => {
  const dir = await root();
  const r = await runCli(
    ['observe', '--workspace=', '--kind=turn_end', '--turn=x'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' },
  );
  assert.equal(r.code, 2, 'an unset shell variable in the = form must not be a value');
  assert.match(r.stderr, /flag given no value: --workspace/);
  // Nothing may have been written under any name, least of all a plausible one.
  assert.deepEqual(await readAllEvents(dir, 'ws'), []);
  assert.deepEqual(await readAllEvents(dir, ''), []);
  assert.deepEqual(await readAllEvents(dir, 'true'), []);
});

test('a bare --flag with no following token is still an error', async () => {
  const dir = await root();
  const r = await runCli(
    ['observe', '--workspace', '--kind=turn_end', '--turn=x'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' },
  );
  assert.equal(r.code, 2);
  assert.match(r.stderr, /flag given no value: --workspace/);
});

// An explicitly quoted empty argument is a deliberate act, not an expansion
// accident, so it stays a value — which the field normalizers then treat as
// absent, per this project's blank-is-not-assessed rule.
test("--flag '' still parses as a value and normalizes to absent", async () => {
  const dir = await root();
  const r = await runCli(
    ['observe', '--workspace=ws', '--kind=turn_end', '--turn', ''],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' },
  );
  assert.equal(r.code, 0, r.stderr);
  const [e] = await readAllEvents(dir, 'ws');
  assert.ok(!('turn' in e!.data), 'a blank value must be absent, never stored as ""');
});

// ---------------------------------------------------------------------------
// The cite-an-observation loop. `record --anchor tool_use:<obs-id>` always
// worked IF you already knew the id — and nothing could tell you one.
// `observe` took no --subject, so `trace Bash` returned empty; `show`
// rendered id/kind/time/outcome/live and no data, so two `tool_call`
// observations were indistinguishable. Only raw JSONL yielded an id, which is
// not a documented command, so SKILL.md's "second witness to check your own
// account against" was unreachable through the shipped surface.

test('an observation carries a subject and trace finds it by that subject', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['observe', '--workspace=ws', '--kind=tool_call', '--subject=Bash',
    '--tool=Bash', '--callId=toolu_1', '--input={"command":"pnpm test"}'], env);
  const r = await runCli(['trace', 'Bash', '--workspace=ws'], { AGENT_JOURNAL_ROOT: dir });
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.matched.length, 1, 'trace Bash found nothing');
  assert.equal(out.matched[0].via, 'subject', 'the match must be attributed to the subject');
  const [e] = await readAllEvents(dir, 'ws');
  assert.equal(out.matched[0].id, e!.id);
  assert.equal(e!.subject, 'Bash', 'the subject must be on the envelope, not buried in data');
});

test('a blank --subject on observe is absent, never an empty subject', async () => {
  const dir = await root();
  const r = await runCli(
    ['observe', '--workspace=ws', '--kind=tool_call', '--tool=Bash', '--subject', '   '],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' },
  );
  assert.equal(r.code, 0, r.stderr);
  const [e] = await readAllEvents(dir, 'ws');
  assert.ok(!('subject' in e!), 'a blank subject must not be stored at all');
});

test('show renders subject and data, so two tool_calls are distinguishable', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['observe', '--workspace=ws', '--kind=tool_call', '--id=obs-a', '--subject=Bash',
    '--tool=Bash', '--callId=toolu_a', '--input={"command":"pnpm test"}'], env);
  await runCli(['observe', '--workspace=ws', '--kind=tool_call', '--id=obs-b', '--subject=Bash',
    '--tool=Bash', '--callId=toolu_b', '--input={"command":"pnpm build"}'], env);

  const r = await runCli(['show', '--workspace=ws'], { AGENT_JOURNAL_ROOT: dir });
  assert.equal(r.code, 0, r.stderr);
  const byId = Object.fromEntries(JSON.parse(r.stdout).entries.map((e: any) => [e.id, e]));
  assert.equal(byId['obs-a'].subject, 'Bash');
  assert.equal(byId['obs-b'].subject, 'Bash');
  // The whole point: something in the rendered payload separates the two.
  assert.equal(byId['obs-a'].data.callId, 'toolu_a');
  assert.equal(byId['obs-b'].data.callId, 'toolu_b');
  assert.equal(byId['obs-a'].data.input, '{"command":"pnpm test"}');
  assert.notDeepEqual(byId['obs-a'].data, byId['obs-b'].data,
    'two tool_call observations rendered identically');
});

test('show renders null — never "" — for an event that names no subject', async () => {
  const dir = await root();
  await runCli(['observe', '--workspace=ws', '--kind=turn_end', '--turn=done'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  const r = await runCli(['show', '--workspace=ws'], { AGENT_JOURNAL_ROOT: dir });
  const [entry] = JSON.parse(r.stdout).entries;
  assert.equal(entry.subject, null);
  assert.notEqual(entry.subject, '', 'absent is not the empty string');
});

test('the whole loop: observe, find by subject, read the id, cite it, trace back', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };

  // 1. Capture: two Bash calls, only one of which is the one being cited.
  await runCli(['observe', '--workspace=ws', '--kind=tool_call', '--subject=Bash',
    '--tool=Bash', '--callId=toolu_noise', '--input={"command":"ls"}'], env);
  await runCli(['observe', '--workspace=ws', '--kind=tool_call', '--subject=Bash',
    '--tool=Bash', '--callId=toolu_real', '--input={"command":"pnpm test"}'], env);

  // 2. Find: by the tool name, which is what a reader actually knows.
  const found = JSON.parse((await runCli(['trace', 'Bash', '--workspace=ws'],
    { AGENT_JOURNAL_ROOT: dir })).stdout);
  assert.equal(found.matched.length, 2);

  // 3. Pick: `show` renders enough to tell them apart and read the right id.
  const shown = JSON.parse((await runCli(['show', '--workspace=ws'],
    { AGENT_JOURNAL_ROOT: dir })).stdout);
  const wanted = shown.entries.find((e: any) => e.data.callId === 'toolu_real');
  assert.ok(wanted, 'show did not render enough to identify the right observation');

  // 4. Cite it from an authored entry.
  const rec = await runCli(['record', '--workspace=ws', '--kind=finding',
    '--claim=the suite passes', '--scope=workspace', `--anchor=tool_use:${wanted.id}`], env);
  assert.equal(rec.code, 0, rec.stderr);

  // 5. Trace back from the observation id: the observation itself by id, and
  //    the entry that cites it by anchor.
  const back = JSON.parse((await runCli(['trace', wanted.id, '--workspace=ws'],
    { AGENT_JOURNAL_ROOT: dir })).stdout);
  const vias = Object.fromEntries(back.matched.map((m: any) => [m.via, m.id]));
  assert.equal(vias.id, wanted.id, 'the observation itself must match by id');
  assert.ok(vias.anchor, 'the citing entry must match by anchor');
  assert.notEqual(vias.anchor, wanted.id);
});

// ---------------------------------------------------------------------------
// `help` named not one observation field. The line printed
// `Object.keys(OBSERVATION_FIELDS)` — the KIND names — under the label
// "…plus the fields for <kind>", one line below `record` doing it correctly
// via kindUsageLine. So `--checkout`, `--ttlSeconds`, `--tool` and the rest
// were undiscoverable from the CLI's own help, and `observe --kind path_claim`
// with no fields exits 0 while `claims` then reports nothing.
// ---------------------------------------------------------------------------

test('help names the FIELDS of each observation kind, not the kind names again', async () => {
  const r = await runCli(['help'], {});
  assert.equal(r.code, 0);
  // Every field of every observable kind, by flag, generated from the same
  // source of truth the parser uses — so adding a kind cannot leave help stale.
  const { OBSERVATION_FIELDS, fieldsForObservation } = await import('../src/observe.ts');
  for (const kind of Object.keys(OBSERVATION_FIELDS)) {
    if (kind === 'void') {
      // `observe` refuses void outright, so advertising it would be a lie.
      assert.ok(!/^ +void:/m.test(r.stdout), 'help advertises a kind observe refuses');
      continue;
    }
    for (const field of fieldsForObservation(kind)) {
      assert.ok(r.stdout.includes(`--${field}`),
        `help never names --${field}, a field of observation kind ${kind}`);
    }
  }
  // The two the finding named specifically: a path_claim with no fields is
  // accepted and then reports nothing, so its fields have to be findable.
  assert.match(r.stdout, /path_claim: --checkout --worktree --branch --ttlSeconds/);
  // A kind with no fields says so rather than trailing an empty space.
  assert.match(r.stdout, /heartbeat: \(no fields\)/);
});

// The documented way to answer "did a hook actually fire" is `show` -- coverage
// counts sessions and cannot distinguish a hooked session from a hookless one.
// That answer depends entirely on provenance being in the payload: `author` is
// 'agent' for both planes, so without this an observation and an entry are
// indistinguishable and the documented check verifies nothing.
test('show reports which plane an event came from', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['observe', '--workspace', 'ws', '--kind', 'tool_call', '--tool=Bash'], env);
  await runCli(['record', '--kind', 'finding', '--claim=x', '--scope', 'machine',
    '--workspace', 'ws'], env);
  const r = await runCli(['show', '--workspace', 'ws'], { AGENT_JOURNAL_ROOT: dir });
  const byKind = Object.fromEntries(
    JSON.parse(r.stdout).entries.map((e: { kind: string; provenance: string }) => [e.kind, e.provenance]),
  );
  assert.equal(byKind.tool_call, 'hook', 'an observation must be identifiable as hook-captured');
  assert.equal(byKind.finding, 'cli', 'an authored entry must not read as hook-captured');
});

// ---------------------------------------------------------------------------
// `decay` — §10.1's rot/premise report. Reports, never judges: no finding's
// status ever changes the exit code, only damage to the journal itself does.
// ---------------------------------------------------------------------------

// `unknownFlags()` returns `[]` for any command with no `ALLOWED_FLAGS` entry
// at all, so this is what proves `decay: ['workspace', 'repo']` is actually
// registered -- without a test, that registration can be deleted silently
// and every other decay test still passes.
test('a typo\'d flag on decay is rejected, not silently accepted', async () => {
  const dir = await root();
  const r = await runCli(['decay', '--workspace', 'ws', '--repoo', '/tmp'], { AGENT_JOURNAL_ROOT: dir });
  assert.equal(r.code, 2, 'a typo\'d flag on decay was accepted');
  assert.match(r.stderr, /unknown flag: --repoo/);
});

test('decay reports findings and exits 0 on a healthy journal', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--kind', 'decision', '--question', 'db?', '--chosen', 'postgres',
    '--workspace', 'ws', '--id', 't1'], env);
  await runCli(['record', '--kind', 'decision', '--question', 'cache?', '--chosen', 'redis',
    '--workspace', 'ws', '--influence', 'journal:decisive:t1'], env);

  const r = await runCli(['decay', '--workspace', 'ws'], { AGENT_JOURNAL_ROOT: dir });
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.ok(Array.isArray(out.findings), 'decay must report a findings array');
  const f = out.findings.find((x: any) => x.type === 'journal');
  assert.equal(f.status, 'passing');
});

// A reporting command that fails the build the moment a source moves would be
// switched off within a week, and §10.1 forbids auto-resolution anyway.
test('decay exits 0 even when findings are failing — it reports, it does not judge', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--kind', 'decision', '--question', 'q', '--chosen', 'c',
    '--workspace', 'ws', '--influence', 'journal:decisive:ghost'], env);

  const r = await runCli(['decay', '--workspace', 'ws'], { AGENT_JOURNAL_ROOT: dir });
  assert.equal(r.code, 0, `a failing finding must not change decay's exit code: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.ok(out.findings.some((f: any) => f.status === 'failing'),
    'the dangling reference should have produced a failing finding');
});

// Mirrors `claims`/`show`: a journal that could not be fully read is a
// different thing from a source that decayed, and must not be reported as a
// clean run.
test('decay warns and exits 1 when the journal itself could not be fully read', async () => {
  const dir = await root();
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'a1',
    '--question', 'q', '--chosen', 'c'], { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });

  const segDir = join(dir, 'workspaces', 'ws', 'segments');
  const seg = (await readdir(segDir, { recursive: true }) as string[])
    .find((f) => f.endsWith('.jsonl'))!;
  await writeFile(join(segDir, seg), 'this is not json\nnor is this\n');

  const r = await runCli(['decay', '--workspace', 'ws'], { AGENT_JOURNAL_ROOT: dir });
  assert.notEqual(r.code, 0, 'a damaged journal reported success');
  assert.match(r.stdout + r.stderr, /malformed/i,
    `corruption was not surfaced: ${r.stdout}${r.stderr}`);
});

// The damage guard is `unreadable.length > 0 || malformed.length > 0` -- the
// test above only exercises the `malformed` half. This is the `unreadable`
// half, so a mutation dropping either term still fails a test.
test('decay reports an unreadable segment, the other half of "damaged"', async () => {
  const dir = await root();
  await runCli(['record', '--workspace', 'ws', '--kind', 'decision', '--id', 'a1',
    '--question', 'q', '--chosen', 'c'], { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });

  const segDir = join(dir, 'workspaces', 'ws', 'segments');
  const seg = (await readdir(segDir, { recursive: true }) as string[])
    .find((f) => f.endsWith('.jsonl'))!;
  await chmod(join(segDir, seg), 0o000);
  try {
    const r = await runCli(['decay', '--workspace', 'ws'], { AGENT_JOURNAL_ROOT: dir });
    assert.notEqual(r.code, 0, 'an unreadable segment reported success');
    assert.match(r.stdout + r.stderr, /unreadable/i,
      `unreadability was not surfaced: ${r.stdout}${r.stderr}`);
  } finally {
    await chmod(join(segDir, seg), 0o600);
  }
});

test('decay --repo is required before any codebase ref is resolved', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  await runCli(['record', '--kind', 'decision', '--question', 'q', '--chosen', 'c',
    '--workspace', 'ws', '--influence', 'codebase:decisive:src/here.ts'], env);

  // Without --repo, a codebase influence must never come back passing --
  // that would mean guessing the filesystem answer with nothing checked.
  const withoutRepo = await runCli(['decay', '--workspace', 'ws'], { AGENT_JOURNAL_ROOT: dir });
  assert.equal(withoutRepo.code, 0);
  const noRepoFinding = JSON.parse(withoutRepo.stdout).findings
    .find((f: any) => f.type === 'codebase');
  assert.equal(noRepoFinding.status, 'not-checkable',
    'a codebase ref resolved to something without a --repo being given');

  // Prove --repo actually resolves it -- not merely that omitting it refuses
  // to guess, which the assertion above alone could satisfy vacuously.
  const repoDir = await mkdtemp(join(tmpdir(), 'journal-repo-'));
  await mkdir(join(repoDir, 'src'), { recursive: true });
  await writeFile(join(repoDir, 'src', 'here.ts'), 'export const here = true;\n');

  const withRepo = await runCli(['decay', '--workspace', 'ws', '--repo', repoDir],
    { AGENT_JOURNAL_ROOT: dir });
  assert.equal(withRepo.code, 0, withRepo.stderr);
  const repoFinding = JSON.parse(withRepo.stdout).findings.find((f: any) => f.type === 'codebase');
  assert.equal(repoFinding.status, 'passing');
});

// The reason this whole plan exists (§2.1): an entry anchored to an
// `environment` observation carries the toolchain it was decided under, and a
// reader must be told when that ground has moved -- distinctly from a broken
// source. `captureEnvironment()` (the real running process) is guaranteed to
// differ from these fabricated values, so this is deterministic rather than a
// coin flip on whatever machine runs the suite.
test('decay reports environment drift end to end, and it is `drifted`, not `failing`', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  const obs = await runCli(['observe', '--workspace', 'ws', '--kind', 'environment',
    '--interpreter', '/remote/bin/node', '--version', 'v1.0.0'], env);
  assert.equal(obs.code, 0, obs.stderr);
  const obsId = /observed (\S+)/.exec(obs.stdout)?.[1];
  assert.ok(obsId, `could not read the observed id back out of: ${obs.stdout}`);

  await runCli(['record', '--kind', 'decision', '--question', 'q', '--chosen', 'c',
    '--workspace', 'ws', '--anchor', `environment:${obsId}`], env);

  const r = await runCli(['decay', '--workspace', 'ws'], { AGENT_JOURNAL_ROOT: dir });
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  const f = out.findings.find((x: any) => x.type === 'environment');
  assert.equal(f.status, 'drifted', `expected drifted, got: ${JSON.stringify(f)}`);
  assert.match(f.detail, /v1\.0\.0/, 'the recorded (fabricated) version must appear in the detail');
  assert.equal(out.drifted, 1);
});

// Every OTHER value `decay` (or any command) ever prints was written through
// `journal.append` first, which redacts on write. The freshly-captured "now"
// environment is deliberately never persisted -- computeDecay only compares
// it -- so it never passes through that gate, which makes it the one place a
// raw interpreter path could reach stdout straight from `process`, on the
// exact field spec 4.3 already requires masked for a STORED environment
// observation. This was caught only by running the built binary end to end,
// not by any unit test, and is deterministic regardless of where THIS
// machine's own node binary happens to live: `runCli` executes in-process,
// so `process.execPath` is overridden directly rather than relying on the
// test runner's own install path being home-shaped by chance.
test('decay redacts the live "now" environment before printing it, not just the stored side', async () => {
  const dir = await root();
  const env = { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' };
  const obs = await runCli(['observe', '--workspace', 'ws', '--kind', 'environment',
    '--interpreter', '/remote/bin/node', '--version', 'v1.0.0'], env);
  const obsId = /observed (\S+)/.exec(obs.stdout)?.[1];
  await runCli(['record', '--kind', 'decision', '--question', 'q', '--chosen', 'c',
    '--workspace', 'ws', '--anchor', `environment:${obsId}`], env);

  // Built by concatenation, not one contiguous literal, for the same reason
  // the environment-observation redaction tests above do this: the repo's
  // own skill verifier flags a literal machine-shaped home-directory path in
  // source, fixture or not.
  const fakeHomeInterpreter = '/Users' + '/deterministic-fixture/bin/node';
  const originalExecPath = process.execPath;
  process.execPath = fakeHomeInterpreter;
  let r;
  try {
    r = await runCli(['decay', '--workspace', 'ws'], { AGENT_JOURNAL_ROOT: dir });
  } finally {
    process.execPath = originalExecPath;
  }

  assert.equal(r.code, 0, r.stderr);
  assert.ok(!r.stdout.includes('deterministic-fixture'),
    `decay printed an unredacted machine-identifying path in its own output: ${r.stdout}`);
  assert.match(r.stdout, /\/\[REDACTED\]\/bin\/node/,
    'the live "now" interpreter should have been redacted, not merely absent');
});
