import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deriveInitPreview } from '../src/setup/init-preview.ts';
import { deriveInitPolicy } from '../src/setup/init-policy.ts';
import { deriveInitFileAction } from '../src/setup/init-action.ts';
const request={apiVersion:'workspace-governance/init-request-v1',authorityId:'example-authority',rootNode:{id:'example-org',kind:'organization',slug:'example',parentId:null,visibility:{mode:'public',readers:[]}}};
const bytes=Buffer.from(JSON.stringify(request));
test('read-only preview binds raw input, explicit paths and helper, never authorizes apply',()=>{
  const hash='a'.repeat(64), manifestPath='/example/manifest.json',stateDir='/example/state';
  assert.deepEqual(deriveInitPreview(bytes,manifestPath,stateDir,hash,null),{
    apiVersion:'workspace-governance/init-preview-plan-v1',executable:false,policyStatus:'proposed-not-authority',kind:'manifest-init',manifestPath,stateDir,helperSha256:hash,
    requestDigest:createHash('sha256').update(bytes).digest('hex'),policy:deriveInitPolicy(request),action:deriveInitFileAction(bytes,manifestPath,null)});
  for(const path of ['/example/../state','relative','/example/manifest.json','/example/manifest.json/state']) assert.throws(()=>deriveInitPreview(bytes,manifestPath,path,hash,null));
  assert.throws(()=>deriveInitPreview(bytes,manifestPath,stateDir,'bad',null));
});
