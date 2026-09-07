import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
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
  // value would consume the flag and produce an id of "--author".
  await runCli(['record', '--kind', 'decision', '--workspace', 'ws', '--id', '--author', 'human'],
    { AGENT_JOURNAL_ROOT: dir, AGENT_JOURNAL_SESSION: 's1' });
  const [entry] = await readAllEvents(dir, 'ws');
  assert.notEqual(entry!.id, '--author');
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
