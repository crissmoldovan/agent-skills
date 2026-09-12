import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, parseJson, type Resolution } from '../src/core.ts';
import { deriveInitPolicy, type InitResolution, type InitPolicy } from '../src/setup/init-policy.ts';
import { deriveInitFileAction } from '../src/setup/init-action.ts';

const request = {apiVersion:'workspace-governance/init-request-v1',authorityId:'example-authority',rootNode:{id:'example-org',kind:'organization',slug:'example',parentId:null,visibility:{mode:'restricted',readers:['example-reader']}}};
// This file is checked by the actual package tsc --noEmit, not only stripped Node.
function typeBoundary(resolution: InitResolution, policy: InitPolicy): void {
  const basis: 'explicit-local-administration' = resolution.authorization;
  const empty: [] = resolution.constraints;
  const oneRoot: [string] = resolution.ancestry;
  const allowed: true = policy.checks[0].allowed;
  // @ts-expect-error InitResolution is not storage authorization or legacy Resolution.
  const ordinary: Resolution = resolution;
  // @ts-expect-error No arbitrary setting is admitted in the closed empty values object.
  resolution.values['invented'] = true;
  void [basis, empty, oneRoot, allowed, ordinary];
}
void typeBoundary;

test('init policy has a closed independent type and fixed no-LF revision versus LF file hash', () => {
  const actual: InitPolicy = deriveInitPolicy(request);
  assert.equal(actual.resolution.revision, '9c4506c55c7e68651025629ec5747fbaf3e1be76eedd0ffc1f5a0eb79c783604');
  assert.equal(actual.checks[0].resolutionFingerprint, 'f8dfc1b9b7612f715a91105cca57e764ef02c098476d23a7492b30b86a434c57');
  const raw = Buffer.from(JSON.stringify(request));
  const action = deriveInitFileAction(raw, '/synthetic/manifest.json', null)!;
  assert.equal(action.afterSha256, '6b25e22c337ee913f81fc4a13def15bcef3abba507eb7a09700f3127a02e8e67');
  assert.notEqual(actual.resolution.revision, action.afterSha256);
  assert.deepEqual(deriveInitPolicy(parseJson(JSON.stringify(request, null, 2))), actual);
  assert.deepEqual(deriveInitPolicy(parseJson(canonicalJson(request))), actual);
  for (const changed of [
    {...request, authorityId:'other-authority'},
    {...request, rootNode:{...request.rootNode, id:'other-root'}},
    {...request, rootNode:{...request.rootNode, metadata:{label:'different'}}},
    {...request, rootNode:{...request.rootNode, visibility:{mode:'restricted', readers:['other-reader']}}},
  ]) {
    const next = deriveInitPolicy(changed);
    assert.notEqual(next.resolution.revision, actual.resolution.revision);
    assert.notEqual(next.checks[0].resolutionFingerprint, actual.checks[0].resolutionFingerprint);
  }
  for (const key of ['principal', 'policies', 'workflows', 'defaults', 'invocation']) {
    assert.throws(() => deriveInitPolicy({...request, [key]:{}}));
  }
});
