import { canonicalJson, digest, GovernanceError, parseJson, requireThat } from '../core.ts';
import { buildInitialManifest } from './authoring.ts';
import { encodePayload, type BytePayload } from './codec.ts';

export interface InitFileAction {
  id: string;
  kind: 'file.create';
  path: string;
  payload: BytePayload;
  afterSha256: string;
}
/** Pure action derivation over independently captured data, NOT an apply authority.
 * Does not inspect filesystem facts, approve a plan, qualify a helper or enable writes.
 */
export function deriveInitFileAction(requestBytes: Uint8Array, manifestPath: string,
  existingBytes: Uint8Array | null): InitFileAction | null {
  requireThat(requestBytes instanceof Uint8Array && (existingBytes === null || existingBytes instanceof Uint8Array));
  requireThat(requestBytes.byteLength <= 262144 && (existingBytes === null || existingBytes.byteLength <= 262144), 'LIMIT');
  requireThat(typeof manifestPath === 'string' && !/[\ud800-\udfff]/u.test(manifestPath) &&
    manifestPath.startsWith('/') && Buffer.byteLength(manifestPath) <= 4096 &&
    !/[\x00-\x1f\x7f\\]/.test(manifestPath) &&
    manifestPath.slice(1).split('/').every(p => p.length > 0 && p !== '.' && p !== '..'));
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal:true, ignoreBOM:true }).decode(requestBytes); }
  catch { throw new GovernanceError('INVALID'); }
  const manifest = Buffer.from(canonicalJson(buildInitialManifest(parseJson(text)))+'\n');
  const payload = encodePayload(manifest);
  if (existingBytes !== null) {
    requireThat(manifest.equals(existingBytes), 'DESTINATION_EXISTS');
    return null;
  }
  const body = { kind:'file.create' as const, path:manifestPath, payload, afterSha256:payload.sha256 };
  return {...body,id:digest(body)};
}
/** Full action semantic comparison; matching caller-provided hashes alone is insufficient.
 * This does NOT compare the enclosing plan/context/resources/approval digest.
 */
export function verifyInitFileAction(requestBytes: Uint8Array, manifestPath: string,
  existingBytes: Uint8Array | null, proposed: unknown): InitFileAction | null {
  const expected = deriveInitFileAction(requestBytes,manifestPath,existingBytes);
  requireThat(canonicalJson(expected) === canonicalJson(proposed), 'STALE_PLAN');
  return expected;
}
