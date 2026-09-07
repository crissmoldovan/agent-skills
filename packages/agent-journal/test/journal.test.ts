import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SegmentJournal } from '../src/journal.ts';
import { normalizeEvent } from '../src/envelope.ts';

function event(id: string, data: Record<string, unknown> = {}) {
  return normalizeEvent({
    schemaVersion: 1, id, source: 'claude-code/m/s/a', sourceEpoch: 'e1',
    time: '2026-09-07T10:00:00.000Z', workspace: 'ws', session: 's', agent: 'a',
    author: 'agent', provenance: 'cli', harness: 'claude-code', context: 'coding',
    kind: 'decision', data,
  });
}

async function journal(rotateBytes?: number) {
  const root = await mkdtemp(join(tmpdir(), 'journal-seg-'));
  const base = { root, workspace: 'ws', machine: 'm', session: 's', agent: 'a', epoch: 'e1' };
  const j = new SegmentJournal(rotateBytes === undefined ? base : { ...base, rotateBytes });
  return { root, j };
}

test('appends one JSON object per line', async () => {
  const { j } = await journal();
  await j.append(event('e1'));
  await j.append(event('e2'));
  const lines = (await readFile(j.segmentPath(), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[1]!).id, 'e2');
});

test('refuses to write when redaction fails — and NOTHING reaches disk', async () => {
  const { j } = await journal();
  const result = await j.append(event('REFUSED', { blob: 'x'.repeat(300000) }));
  assert.equal(result.written, false);
  assert.equal(result.verdict, 'failed');
  // The guarantee is about the filesystem, not the return value. Asserting only
  // `written: false` would still pass if the early return moved after mkdir.
  assert.equal(existsSync(result.path), false, 'a refused append must create no file');
  // And the refused payload must not appear once a later append creates the file.
  await j.append(event('KEPT'));
  const disk = await readFile(j.segmentPath(), 'utf8');
  assert.doesNotMatch(disk, /REFUSED/);
  assert.match(disk, /KEPT/);
});

test('a refusal does not poison the queue for later appends', async () => {
  const { j } = await journal();
  const [bad, good] = await Promise.all([
    j.append(event('DROP', { blob: 'x'.repeat(300000) })),
    j.append(event('SURVIVES')),
  ]);
  assert.equal(bad.written, false);
  assert.equal(good.written, true);
  // Each call must report the file IT wrote, not another caller's.
  assert.equal(good.path, j.segmentPath());
  const disk = await readFile(j.segmentPath(), 'utf8');
  assert.equal(disk.trim().split('\n').length, 1);
});

test('redacts a secret before it reaches disk', async () => {
  const { j } = await journal();
  // Built, not literal — see the verify-gate constraint in the plan header.
  const token = `gh${'p'}_${'a1b2c3d4e5'.repeat(3)}`;
  await j.append(event('e4', { rationale: `token ${token}` }));
  const written = await readFile(j.segmentPath(), 'utf8');
  assert.doesNotMatch(written, /a1b2c3d4e5/);
  assert.match(written, /\[REDACTED]/);
});

test('rotates to a new segment once the byte threshold is passed', async () => {
  const { root, j } = await journal(200);
  for (let i = 0; i < 8; i += 1) await j.append(event(`e${i}`));
  const files = await readdir(join(root, 'workspaces', 'ws', 'segments', 'm', 's'));
  assert.ok(files.length > 1, `expected rotation, saw ${files.join(', ')}`);
});

// The existing "does not poison the queue" fixture used a REFUSED write, which
// returns before the queue is touched — so it could never poison it, and the
// `.catch` that makes the guarantee true could be deleted with nothing failing.
// A rejected write is the case that actually poisons.
test('a rejected write does not poison the queue for later appends', async () => {
  const { root, j } = await journal();

  // A TRANSIENT failure, so the same instance can fail and then succeed — which
  // is the only way to tell a caught queue from a poisoned one. A regular file
  // where the segment directory belongs makes mkdir reject; deleting it clears
  // the fault. The previous fixture used a REFUSED write, which returns before
  // the queue is touched and so could never poison it.
  const segDir = join(root, 'workspaces', 'ws', 'segments', 'm');
  await mkdir(join(root, 'workspaces', 'ws', 'segments'), { recursive: true });
  await writeFile(segDir, 'not a directory', 'utf8');

  await assert.rejects(() => j.append(event('x1')), 'the blocked write did not reject');

  await rm(segDir);
  const recovered = await j.append(event('ok1'));
  assert.equal(recovered.written, true,
    'a later append inherited the earlier rejection — the queue was poisoned');
  assert.match(await readFile(j.segmentPath(), 'utf8'), /ok1/);
});

// `append` captures the path BEFORE queueing, then re-reads it after rotation.
// Without the re-read BOTH the report and the write use the stale path, so the
// two stay consistent with each other while drifting from the journal's actual
// segment — which is why checking "the reported file contains the event" passes
// under the defect. What breaks is the agreement between what append returned
// and where the journal now stands, and the segment size that follows from it:
// with the re-read, eight events fill eight segments; without it, four.
test('the path append reports agrees with the segment the journal is on', async () => {
  const { j } = await journal(200);          // rotate after ~200 bytes
  const written = new Map<string, string[]>();

  for (let i = 0; i < 8; i += 1) {
    const id = `rot-${i}`;
    const r = await j.append(event(id));
    assert.equal(r.written, true);
    assert.equal(r.path, j.segmentPath(),
      `append reported ${r.path} but the journal is on ${j.segmentPath()}`);
    written.set(r.path, [...(written.get(r.path) ?? []), id]);
  }

  assert.ok(written.size > 1, 'no rotation happened — the fixture proves nothing');
  for (const [path, ids] of written) {
    const text = await readFile(path, 'utf8');
    for (const id of ids) {
      // `"id":"…"` and not just `"…"`: every record carries sourceEpoch and a
      // source, so a bare id can match a field the event is not the subject of.
      assert.match(text, new RegExp(`"id":"${id}"`),
        `append reported ${path} for ${id}, but the event is not in that file`);
    }
  }
});
