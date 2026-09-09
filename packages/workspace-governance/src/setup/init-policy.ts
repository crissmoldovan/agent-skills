import { digest } from '../core.ts';
import { buildInitialManifest } from './authoring.ts';

/** Closed init-only semantics, NOT an authenticated legacy Snapshot/Resolution. */
export interface InitResolution {
  values: Record<string, never>;
  provenance: [];
  constraints: [];
  ancestry: [string];
  /** SHA256 of canonical output manifest JSON without LF, not the output file hash. */
  revision: string;
  authorization: 'explicit-local-administration';
  workflow: null;
}
export interface InitPolicy {
  checker: 'init-policy-v1';
  checks: [{
    nodeId: string;
    operation: 'manifest-init';
    allowed: true;
    resolutionFingerprint: string;
  }];
  resolution: InitResolution;
}
/** Normative pure init rule. NEVER authentication, trial issuance or mutation authority. */
export function deriveInitPolicy(request: unknown): InitPolicy {
  const manifest = buildInitialManifest(request);
  const resolution: InitResolution = { values:{}, provenance:[], constraints:[], ancestry:[manifest.nodes[0].id],
    revision:digest(manifest), authorization:'explicit-local-administration', workflow:null };
  return { checker:'init-policy-v1', checks:[{nodeId:manifest.nodes[0].id,operation:'manifest-init',allowed:true,
    resolutionFingerprint:digest({checker:'init-policy-v1',operation:'manifest-init',authorityId:manifest.authorityId,resolution})}], resolution };
}
