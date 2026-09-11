import test from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest } from '../src/core.ts';

import { buildInitialManifest } from '../src/setup/authoring.ts';

const request = {
  apiVersion: 'workspace-governance/init-request-v1',
  authorityId: 'example-authority',
  rootNode: { id: 'example-org', kind: 'organization', slug: 'example', parentId: null,
    visibility: { mode: 'restricted', readers: ['example-operator'] } },
};

test('init derives the original manifest wire with explicit visibility and no permissions', async () => {
  const modulePath = '../src/setup/authoring.ts';
  const { buildInitialManifest } = await import(modulePath);
  const input = structuredClone(request);
  const result = buildInitialManifest(input);
  assert.deepEqual(result, validateManifest({ apiVersion: 'workspace-governance/v1',
    authorityId: request.authorityId, nodes: [request.rootNode], policies: [], workflows: [], metadata: {} }));
  input.rootNode.visibility.readers.push('other');
  assert.deepEqual(result.nodes[0].visibility!.readers, ['example-operator']);
});

test('init rejects unknown wires, extra fields and absent explicit root visibility', () => {
  const noVisibility: any = structuredClone(request);
  delete noVisibility.rootNode.visibility;
  for (const input of [noVisibility, { ...request, apiVersion: 'workspace-governance/init-request-v2' },
    { ...request, approve: true }, null, [], { ...request, rootNode: { ...request.rootNode, parentId: 'other' } }]) {
    assert.throws(() => buildInitialManifest(input), { code: 'INVALID' });
  }
});
