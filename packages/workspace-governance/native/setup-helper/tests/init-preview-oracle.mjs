import {deriveInitPreview} from '../../../src/setup/init-preview.ts';
import {encodePayload} from '../../../src/setup/codec.ts';
const request=Buffer.from(JSON.stringify({apiVersion:'workspace-governance/init-request-v1',authorityId:'example-authority',rootNode:{id:'example-org',kind:'organization',slug:'example',parentId:null,visibility:{mode:'public',readers:[]},metadata:{number:1e-7,text:'😀\ud800'}}}));
const manifestPath='/example/manifest.json',stateDir='/example/state',helperSha256=process.argv[2];
console.log(JSON.stringify({apiVersion:'workspace-governance/init-preview-helper-request-v1',operation:'verify',request:encodePayload(request),existing:null,manifestPath,stateDir,proposal:deriveInitPreview(request,manifestPath,stateDir,helperSha256,null)}));
