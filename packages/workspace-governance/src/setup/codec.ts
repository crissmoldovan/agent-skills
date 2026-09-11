import { createHash } from 'node:crypto';
import { canonicalJson, requireThat } from '../core.ts';

export interface BytePayload {
  encoding: 'base64-chunks-v1';
  byteLength: number;
  sha256: string;
  chunks: string[];
}
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export function encodePayload(bytes: Uint8Array): BytePayload {
  requireThat(bytes instanceof Uint8Array);
  requireThat(bytes.byteLength <= 262144, 'LIMIT');
  const buffer = Buffer.from(bytes);
  const chunks: string[] = [];
  for (let offset = 0; offset < buffer.length; offset += 12288)
    chunks.push(buffer.subarray(offset, offset + 12288).toString('base64'));
  return { encoding: 'base64-chunks-v1', byteLength: buffer.length, sha256: sha256(buffer), chunks };
}

export function decodePayload(input: unknown, maxBytes: 262144 | 2097152 = 262144): Buffer {
  canonicalJson(input);
  requireThat(input !== null && typeof input === 'object' && !Array.isArray(input));
  const p = input as Record<string, any>;
  const keys = ['encoding', 'byteLength', 'sha256', 'chunks'];
  requireThat(Object.keys(p).length === keys.length && keys.every(k => Object.hasOwn(p, k)));
  requireThat(p.encoding === 'base64-chunks-v1');
  requireThat(Number.isSafeInteger(p.byteLength) && p.byteLength >= 0);
  requireThat(maxBytes === 262144 || maxBytes === 2097152);
  requireThat(p.byteLength <= maxBytes, 'LIMIT');
  requireThat(typeof p.sha256 === 'string' && /^[a-f0-9]{64}$/.test(p.sha256));
  requireThat(Array.isArray(p.chunks) && p.chunks.length === Math.ceil(p.byteLength / 12288));
  const chunks = p.chunks.map((chunk: unknown, index: number) => {
    requireThat(typeof chunk === 'string' && chunk.length > 0 && chunk.length <= 16384);
    const bytes = Buffer.from(chunk, 'base64');
    requireThat(bytes.toString('base64') === chunk);
    requireThat(bytes.length === Math.min(12288, p.byteLength - index * 12288));
    return bytes;
  });
  const result = Buffer.concat(chunks);
  requireThat(result.length === p.byteLength && sha256(result) === p.sha256);
  return result;
}
