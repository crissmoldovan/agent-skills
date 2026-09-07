import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../src/cli.ts';
import type { JournalEvent } from '../src/envelope.ts';

async function root(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'journal-cli-'));
}

// Reads every event back off disk, so tests assert what landed rather than what
// was printed. Without this the CLI tests only prove exit codes.
async function readAllEvents(root: string, workspace: string) {
  const { readdir, readFile } = await import('node:fs/promises');
  const { parseSegment } = await import('../src/read.ts');
  // Typed: an untyped [] here is TS7034/TS7005 across the closure.
  const base = join(root, 'workspaces', workspace, 'segments');
  const out: JournalEvent[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.endsWith('.jsonl')) out.push(...parseSegment(await readFile(full, 'utf8')).events);
    }
  }
  await walk(base);
  return out;
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

test('an unknown subcommand exits non-zero with usage', async () => {
  const r = await runCli(['frobnicate', '--workspace', 'ws'], { AGENT_JOURNAL_ROOT: await root() });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /usage/i);
});
