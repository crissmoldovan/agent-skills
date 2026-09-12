import { createHash } from 'node:crypto';
import { parseJson, requireThat } from '../core.ts';
import { deriveInitPolicy } from './init-policy.ts';
import { deriveInitFileAction } from './init-action.ts';
export function previewPath(path: string): void {
  requireThat(typeof path==='string' && !/[\ud800-\udfff]/u.test(path) && path.startsWith('/') && Buffer.byteLength(path)<=4096 &&
    !/[\x00-\x1f\x7f\\]/.test(path) && path.slice(1).split('/').every(p=>p.length>0 && p!=='.' && p!=='..'));
}
/** Entire preview semantics, not the qualified init setup plan or approval. */
export function deriveInitPreview(request: Uint8Array, manifestPath: string, stateDir: string, helperSha256: string, existing: Uint8Array|null) {
  previewPath(manifestPath); previewPath(stateDir);
  requireThat(manifestPath!==stateDir && !manifestPath.startsWith(stateDir+'/') && !stateDir.startsWith(manifestPath+'/'));
  requireThat(typeof helperSha256==='string' && /^[a-f0-9]{64}$/.test(helperSha256));
  const action=deriveInitFileAction(request,manifestPath,existing);
  const value=parseJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(request));
  return {apiVersion:'workspace-governance/init-preview-plan-v1',executable:false,policyStatus:'proposed-not-authority',kind:'manifest-init',manifestPath,stateDir,helperSha256,
    requestDigest:createHash('sha256').update(request).digest('hex'),policy:deriveInitPolicy(value),action};
}
