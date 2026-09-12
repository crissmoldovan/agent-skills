import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { encodePayload, decodePayload } from '../src/setup/codec.ts';

test('payload refuses noncanonical base64, layout, hash, keys and limits', () => {
  const good = encodePayload(Buffer.from('f'));
  for (const bad of [null, {}, { ...good, extra: 0 }, { ...good, encoding: 'base64' },
    { ...good, byteLength: 0 }, { ...good, sha256: '0'.repeat(64) },
    ...['Zg', 'Zh==', 'Zg==\n', 'Zg-_', 'Zg==='].map(c => ({ ...good, chunks: [c] })),
    { ...good, chunks: ['', 'Zg=='] }, { ...good, chunks: ['Zg==', ''] }]) {
    assert.throws(() => decodePayload(bad as any), { code: 'INVALID' });
  }
  assert.throws(() => encodePayload(Buffer.alloc(262145)), { code: 'LIMIT' });
  assert.throws(() => decodePayload({ ...good, byteLength: 262145 }), { code: 'LIMIT' });
});

test('payload round trips large and split UTF8 bytes in canonical bounded chunks', async () => {
  const modulePath = '../src/setup/codec.ts';
  const { encodePayload, decodePayload } = await import(modulePath);
  for (const bytes of [Buffer.alloc(0), Buffer.from('a'.repeat(12287) + '😀' + 'b'.repeat(17000)), Buffer.alloc(262144, 0xff)]) {
    const payload = encodePayload(bytes);
    assert.equal(payload.encoding, 'base64-chunks-v1');
    assert.equal(payload.byteLength, bytes.length);
    assert.equal(payload.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.ok(payload.chunks.every((c: string) => c.length <= 16384));
    assert.ok(payload.chunks.slice(0, -1).every((c: string) => Buffer.from(c, 'base64').length === 12288));
    assert.deepEqual(decodePayload(payload), bytes);
  }
});
