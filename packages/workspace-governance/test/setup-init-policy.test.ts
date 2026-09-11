import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '../src/core.ts';
import { buildInitialManifest } from '../src/setup/authoring.ts';
import * as policy from '../src/setup/init-policy.ts';
const request = {apiVersion:'workspace-governance/init-request-v1',authorityId:'example-authority',rootNode:{id:'example-org',kind:'organization',slug:'example',parentId:null,visibility:{mode:'restricted',readers:['example-reader']}}};
test('proposed init policy binds validated output and full empty provenance without inventing a principal',()=>{
  assert.equal(typeof policy.deriveInitPolicy,'function');
  const resolution={values:{},provenance:[],constraints:[],ancestry:['example-org'],revision:digest(buildInitialManifest(request)),authorization:'explicit-local-administration',workflow:null};
  const fingerprint=digest({checker:'init-policy-v1',operation:'manifest-init',authorityId:request.authorityId,resolution});
  assert.deepEqual(policy.deriveInitPolicy(request),{checker:'init-policy-v1',checks:[{nodeId:'example-org',operation:'manifest-init',allowed:true,resolutionFingerprint:fingerprint}],resolution});
  for(const changed of [{...request,authorityId:'other'}, {...request,rootNode:{...request.rootNode,metadata:{a:1}}}])
    assert.notEqual(policy.deriveInitPolicy(changed).checks[0].resolutionFingerprint,fingerprint);
  assert.throws(()=>policy.deriveInitPolicy({...request,principal:'example-reader'}));
});
