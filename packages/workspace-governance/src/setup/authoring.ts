import { canonicalJson, requireThat, validateManifest, type Manifest } from '../core.ts';

/** Pure construction only: this function does not authorize or write a manifest. */
export function buildInitialManifest(request: unknown): Manifest {
  // Reuse the unchanged legacy object/prototype/depth/node budget defenses.
  canonicalJson(request);
  requireThat(request !== null && typeof request === 'object' && !Array.isArray(request));
  const r = request as Record<string, unknown>;
  const keys = ['apiVersion', 'authorityId', 'rootNode'];
  requireThat(Object.keys(r).length === keys.length && keys.every(k => Object.hasOwn(r, k)));
  requireThat(r.apiVersion === 'workspace-governance/init-request-v1');
  const root = r.rootNode;
  requireThat(root !== null && typeof root === 'object' && !Array.isArray(root));
  requireThat(Object.hasOwn(root, 'visibility'));
  return validateManifest({
    apiVersion: 'workspace-governance/v1',
    authorityId: r.authorityId,
    nodes: [root],
    policies: [], workflows: [], metadata: {},
  });
}
