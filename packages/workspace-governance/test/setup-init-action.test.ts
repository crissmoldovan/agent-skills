import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, digest } from '../src/core.ts';
import { decodePayload, encodePayload } from '../src/setup/codec.ts';
import { buildInitialManifest } from '../src/setup/authoring.ts';
import { deriveInitFileAction, verifyInitFileAction } from '../src/setup/init-action.ts';

const request = { apiVersion:'workspace-governance/init-request-v1',authorityId:'example-authority',
  rootNode:{id:'example-org',kind:'organization',slug:'example',parentId:null,visibility:{mode:'public',readers:[]}} };
const bytes = Buffer.from(JSON.stringify(request));
const target = '/example-control/manifest.json';
test('init action derives exact payload, hash and ID; exact existing bytes are no-op', () => {
  const manifest = Buffer.from(canonicalJson(buildInitialManifest(request))+'\n');
  const expected = { kind:'file.create',path:target,payload:encodePayload(manifest),afterSha256:encodePayload(manifest).sha256 };
  const action = deriveInitFileAction(bytes,target,null);
  assert.deepEqual(action,{...expected,id:digest(expected)});
  assert.deepEqual(decodePayload(action!.payload),manifest);
  assert.equal(deriveInitFileAction(bytes,target,manifest),null);
  assert.throws(()=>deriveInitFileAction(bytes,target,Buffer.from('foreign')),{code:'DESTINATION_EXISTS'});
});
test('self-consistent forged init action cannot override independent request or target', () => {
  const action = deriveInitFileAction(bytes,target,null)!;
  assert.deepEqual(verifyInitFileAction(bytes,target,null,action),action);
  for(const changed of [{...action,path:'/other/manifest.json'}, {...action,payload:encodePayload(Buffer.from('foreign')),afterSha256:encodePayload(Buffer.from('foreign')).sha256}, {...action,kind:'file.replace'}]) {
    const {id:_,...body}=changed;
    assert.throws(()=>verifyInitFileAction(bytes,target,null,{...body,id:digest(body)}),{code:'STALE_PLAN'});
  }
  assert.throws(()=>verifyInitFileAction(bytes,target,null,{...action,approve:true}),{code:'STALE_PLAN'});
  assert.throws(()=>verifyInitFileAction(bytes,target,null,null),{code:'STALE_PLAN'});
});
test('init action rejects malformed bytes and literal unsafe paths without repair', () => {
  for(const path of ['relative','/a/../b','/a//b','/a/./b','/a/b/','/','/a\\b','/a\u0000b','/a\ud800b'])
    assert.throws(()=>deriveInitFileAction(bytes,path,null),{code:'INVALID'});
  assert.throws(()=>deriveInitFileAction(Buffer.from([0xff]),target,null),{code:'INVALID'});
  assert.throws(()=>deriveInitFileAction(Buffer.alloc(262145),target,null),{code:'LIMIT'});
});
