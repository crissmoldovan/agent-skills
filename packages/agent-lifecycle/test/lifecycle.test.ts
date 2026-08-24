import { deepEqual, equal, rejects, throws } from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

import {
  JsonlLifecycleJournal, JsonlLifecycleParser, LifecycleProjector,
  normalizeLifecycleEvent, type LifecycleEvent,
} from '../src/index.ts';

const caps = { history: 'unknown', heartbeat: 'known', snapshot: 'known', cancel: 'unknown', terminalCause: 'unknown' } as const;
const lineage = { rootChildId: 'child', attempt: 0, external: false } as const;
function event(overrides: Partial<LifecycleEvent> = {}): LifecycleEvent {
  return {
    schemaVersion: 1, eventId: 'evt-1', source: 'runner', sourceEpoch: 'epoch-1', childId: 'child', lineage,
    kind: 'created', state: 'created', observedAt: '2026-08-24T09:00:00.000Z', sequence: 1, capabilities: caps,
    ...overrides,
  };
}

test('normalizes canonical v1 identity, lineage and conservative capabilities', () => {
  deepEqual(normalizeLifecycleEvent(event({ eventId: ' evt ', lineage: { ...lineage, external: true, adoptedAt: '2026-08-24T09:00:00.000Z' } })), event({ eventId: 'evt', lineage: { ...lineage, external: true, adoptedAt: '2026-08-24T09:00:00.000Z' } }));
  throws(() => normalizeLifecycleEvent({ ...event(), schemaVersion: 2 }), /schemaVersion/);
  throws(() => normalizeLifecycleEvent({ ...event(), capabilities: { ...caps, cancel: 'yes' } }), /capabilities/);
});

test('enforces the complete legal transition table and activity never transitions', () => {
  const p = new LifecycleProjector();
  for (const [from, to] of [['created', 'starting'], ['starting', 'running'], ['running', 'waiting'], ['waiting', 'running'], ['running', 'completed']] as const) {
    const id = `legal-${from}-${to}`;
    p.apply(event({ eventId: `${id}-0`, childId: id, lineage: { ...lineage, rootChildId: id }, sequence: 1 }));
    const path: Record<string, readonly string[]> = { created: [], starting: ['starting'], running: ['starting', 'running'], waiting: ['starting', 'running', 'waiting'] };
    let seq = 1;
    for (const state of (path[from] ?? [])) p.apply(event({ eventId: `${id}-${++seq}`, childId: id, lineage: { ...lineage, rootChildId: id }, kind: 'state_changed', state: state as Exclude<LifecycleEvent['state'], undefined>, sequence: seq }));
    equal(p.apply(event({ eventId: `${id}-next`, childId: id, lineage: { ...lineage, rootChildId: id }, kind: 'state_changed', state: to, sequence: ++seq })).record?.state, to);
  }
  const id = 'no-activity-transition';
  p.apply(event({ childId: id, lineage: { ...lineage, rootChildId: id } }));
  throws(() => p.apply(event({ eventId: 'activity', childId: id, lineage: { ...lineage, rootChildId: id }, kind: 'activity', sequence: 2, activity: 'work' })), /state/);
  throws(() => p.apply(event({ eventId: 'jump', childId: id, lineage: { ...lineage, rootChildId: id }, kind: 'state_changed', state: 'completed', sequence: 2 })), /Illegal transition/);
});

test('deduplicates only byte-equivalent identity and reports sequence gap and conflict', () => {
  const p = new LifecycleProjector();
  p.apply(event());
  equal(p.apply(event()).status, 'deduplicated');
  equal(p.apply(event({ kind: 'state_changed', state: 'starting' })).status, 'conflict');
  equal(p.apply(event({ eventId: 'gap', kind: 'state_changed', state: 'starting', sequence: 3 })).status, 'provisional');
  equal(p.apply(event({ eventId: 'same-sequence-other-epoch', sourceEpoch: 'epoch-2', kind: 'state_changed', state: 'running', sequence: 1 })).status, 'conflict');
});

test('terminal states cannot be changed, duplicated conflictingly, or revived by a snapshot', () => {
  const p = new LifecycleProjector();
  p.apply(event());
  p.apply(event({ eventId: 'start', kind: 'state_changed', state: 'starting', sequence: 2 }));
  p.apply(event({ eventId: 'run', kind: 'state_changed', state: 'running', sequence: 3 }));
  p.apply(event({ eventId: 'done', kind: 'terminal', state: 'completed', sequence: 4 }));
  equal(p.apply(event({ eventId: 'late', kind: 'state_changed', state: 'running', sequence: 5 })).status, 'terminal_immutable');
  const result = p.reconcile({ source: 'runner', sourceEpoch: 'epoch-1', snapshotId: 'snap-1', observedAt: '2026-08-24T09:01:00.000Z', complete: true, coverage: 'all', children: [{ childId: 'child', state: 'running', sequence: 4 }] });
  equal(result.diagnostics[0]?.code, 'terminal_immutable');
  equal(p.snapshot('runner', 'child')?.state, 'completed');
});

test('requires authoritative complete epoch-qualified snapshots and audits permitted correction', () => {
  const p = new LifecycleProjector();
  p.apply(event());
  throws(() => p.reconcile({ source: 'runner', sourceEpoch: 'epoch-1', snapshotId: 'x', observedAt: '2026-08-24T09:00:01.000Z', complete: false as true, coverage: 'all', children: [] }), /complete/);
  const result = p.reconcile({ source: 'runner', sourceEpoch: 'epoch-1', snapshotId: 'x', observedAt: '2026-08-24T09:00:01.000Z', complete: true, coverage: 'all', children: [{ childId: 'child', state: 'starting', sequence: 2 }] });
  equal(result.audit[0]?.reason, 'authoritative_snapshot');
  equal(p.snapshot('runner', 'child')?.state, 'starting');
});

test('marks stale before exactly one failed reconciliation can lose a child', () => {
  const p = new LifecycleProjector({ staleAfterMs: 60_000, reconcileDeadlineMs: 30_000 });
  p.apply(event());
  equal(p.markStale('2026-08-24T09:01:00.000Z')[0]?.record?.stale, true);
  equal(p.markStale('2026-08-24T09:02:00.000Z').length, 0);
  equal(p.reconciliationFailed('runner', 'child', '2026-08-24T09:01:30.000Z').record?.state, 'lost');
  equal(p.reconciliationFailed('runner', 'child', '2026-08-24T09:02:00.000Z').status, 'terminal_immutable');
});

test('incrementally recovers JSONL valid records around malformed, oversized and truncated data with offsets', () => {
  const parser = new JsonlLifecycleParser({ maxLineBytes: 512, redact: /secret\w*/gi });
  const valid = JSON.stringify(event());
  parser.push(new TextEncoder().encode(`${valid}\nnot secret-value\n${'x'.repeat(513)}\n${valid.slice(0, 20)}`));
  equal(parser.records.length, 1);
  equal(parser.diagnostics.length, 2);
  equal(parser.diagnostics[0]?.offset, valid.length + 1);
  equal(parser.diagnostics[0]?.raw?.includes('secret-value'), false);
  equal(parser.end().diagnostics.at(-1)?.code, 'truncated');
});

test('journal rejects unsupported multiple writer instances and refuses append after nonfinal corruption', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lifecycle-'));
  const path = join(dir, 'events.jsonl');
  const journal = new JsonlLifecycleJournal(path);
  await journal.append(event());
  throws(() => new JsonlLifecycleJournal(path), /single writer/i);
  await writeFile(path, `${JSON.stringify(event())}\nnot-json\n${JSON.stringify(event({ eventId: 'after' }))}\n`);
  await rejects(journal.append(event({ eventId: 'retry' })), /integrity/i);
  const text = await readFile(path, 'utf8'); equal(text.includes('not-json'), true);
});

test('reports a lower unseen sequence as out_of_order rather than deduplicated', () => {
  const p = new LifecycleProjector();
  p.apply(event());
  p.apply(event({ eventId: 'third', kind: 'state_changed', state: 'starting', sequence: 3 }));
  const late = p.apply(event({ eventId: 'second', kind: 'state_changed', state: 'starting', sequence: 2 }));
  equal(late.status, 'out_of_order');
  equal(late.diagnostics[0]?.code, 'out_of_order');
});

test('rejects events and snapshots from a different epoch without mutating the current epoch', () => {
  const p = new LifecycleProjector();
  p.apply(event());
  const wrongEvent = p.apply(event({ eventId: 'wrong-event', sourceEpoch: 'epoch-attacker', kind: 'state_changed', state: 'starting', sequence: 2 }));
  equal(wrongEvent.status, 'conflict');
  equal(wrongEvent.diagnostics[0]?.code, 'epoch_conflict');
  const wrongSnapshot = p.reconcile({ source: 'runner', sourceEpoch: 'epoch-attacker', snapshotId: 'wrong-snapshot', observedAt: '2026-08-24T09:00:01.000Z', complete: true, coverage: 'all', children: [{ childId: 'child', state: 'lost', sequence: 2 }] });
  equal(wrongSnapshot.diagnostics[0]?.code, 'epoch_conflict');
  equal(p.snapshot('runner', 'child')?.state, 'created');
});

test('validates authoritative snapshot identity, RFC3339 time, coverage, and child fields before mutation', () => {
  const p = new LifecycleProjector();
  p.apply(event());
  const base = { source: 'runner', sourceEpoch: 'epoch-1', snapshotId: 'snap', observedAt: '2026-08-24T09:00:01.000Z', complete: true as const, coverage: 'all' as const, children: [{ childId: 'child', state: 'starting' as const, sequence: 2 }] };
  throws(() => p.reconcile({ ...base, source: '' }), /source/);
  throws(() => p.reconcile({ ...base, observedAt: 'not-a-time' }), /observedAt/);
  throws(() => p.reconcile({ ...base, coverage: [] }), /coverage/);
  throws(() => p.reconcile({ ...base, coverage: ['other-child'] }), /coverage/);
  throws(() => p.reconcile({ ...base, children: [{ childId: '', state: 'starting', sequence: 2 }] }), /childId/);
  throws(() => p.reconcile({ ...base, children: [{ childId: 'child', state: 'nope' as never, sequence: 2 }] }), /state/);
  equal(p.snapshot('runner', 'child')?.state, 'created');
});

test('does not lose a stale child until its configured reconciliation deadline expires', () => {
  const p = new LifecycleProjector({ staleAfterMs: 60_000, reconcileDeadlineMs: 30_000 });
  p.apply(event());
  p.markStale('2026-08-24T09:01:00.000Z');
  const early = p.reconciliationFailed('runner', 'child', '2026-08-24T09:01:29.999Z');
  equal(early.status, 'provisional');
  equal(early.diagnostics[0]?.code, 'reconciliation_pending');
  equal(p.snapshot('runner', 'child')?.state, 'created');
  equal(p.reconciliationFailed('runner', 'child', '2026-08-24T09:01:30.000Z').record?.state, 'lost');
});

test('serializes same-instance journal appends and refuses truncated or corrupt journal sequences', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lifecycle-adversarial-'));
  const path = join(dir, 'events.jsonl');
  const journal = new JsonlLifecycleJournal(path);
  const [one, two] = await Promise.all([journal.append(event({ eventId: 'one' })), journal.append(event({ eventId: 'two' }))]);
  deepEqual([one.journalSequence, two.journalSequence].sort(), [1, 2]);
  await writeFile(path, `${JSON.stringify({ ...event({ eventId: 'corrupt' }), journalSequence: 4 })}\n`);
  await rejects(journal.append(event({ eventId: 'after-corrupt' })), /integrity/i);
  const truncatedPath = join(dir, 'truncated.jsonl');
  const truncated = new JsonlLifecycleJournal(truncatedPath);
  await writeFile(truncatedPath, JSON.stringify({ ...event({ eventId: 'partial' }), journalSequence: 1 }).slice(0, -1));
  await rejects(truncated.append(event({ eventId: 'after-partial' })), /integrity/i);
});

test('serializes cross-process journal appends into complete monotonic entries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lifecycle-processes-'));
  const path = join(dir, 'events.jsonl');
  const helper = join(dir, 'append-worker.ts');
  const sourceModule = pathToFileURL(join(process.cwd(), 'src/index.ts')).href;
  await writeFile(helper, `
import { JsonlLifecycleJournal } from ${JSON.stringify(sourceModule)};
const [path, worker, count] = process.argv.slice(2);
const journal = new JsonlLifecycleJournal(path);
for (let i = 0; i < Number(count); i++) await journal.append({ schemaVersion: 1, eventId: \`\${worker}-\${i}\`, source: 'worker', sourceEpoch: 'epoch-1', childId: \`child-\${worker}\`, lineage: { rootChildId: \`child-\${worker}\`, attempt: 0, external: false }, kind: 'created', state: 'created', observedAt: '2026-08-24T09:00:00.000Z', sequence: i + 1, capabilities: { history: 'unknown', heartbeat: 'unknown', snapshot: 'unknown', cancel: 'unknown', terminalCause: 'unknown' } });
`);
  await Promise.all(Array.from({ length: 6 }, (_, worker) => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', helper, path, String(worker), '5'], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`worker ${worker} exited ${code}`)));
  })));
  const raw = await readFile(path, 'utf8');
  const lines = raw.trim().split('\n');
  equal(lines.length, 30);
  const entries = lines.map(line => JSON.parse(line) as { journalSequence: number; eventId: string });
  deepEqual(entries.map(entry => entry.journalSequence), Array.from({ length: 30 }, (_, index) => index + 1));
  equal(new Set(entries.map(entry => entry.eventId)).size, 30);
  const parser = new JsonlLifecycleParser();
  parser.push(new TextEncoder().encode(raw));
  equal(parser.end().diagnostics.length, 0);
});

test('times out behind a live journal lock and only reclaims a stale dead-owner lock', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lifecycle-lock-'));
  const path = join(dir, 'events.jsonl');
  const lock = `${path}.lock`;
  await mkdir(lock);
  await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, token: 'live-owner' }));
  const blocked = new JsonlLifecycleJournal(path, { lockTimeoutMs: 200, lockRetryMs: 10, staleLockMs: 1 });
  await rejects(blocked.append(event({ eventId: 'blocked' })), /lock timeout/i);
  await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: 999_999_999, token: 'dead-owner' }));
  const old = new Date(Date.now() - 60_000);
  await utimes(lock, old, old);
  equal((await blocked.append(event({ eventId: 'recovered' }))).journalSequence, 1);
});

test('redacts sensitive JSON diagnostic values', () => {
  const parser = new JsonlLifecycleParser();
  parser.push(new TextEncoder().encode('{"token":"super-secret-value","nested":{"password":"hunter2"}}\n'));
  const raw = parser.diagnostics[0]?.raw ?? '';
  equal(raw.includes('super-secret-value'), false);
  equal(raw.includes('hunter2'), false);
});
