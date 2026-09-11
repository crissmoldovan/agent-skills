// Test-only oracle: the native implementation cannot delegate to this process.
import { buildInitialManifest } from '../../../src/setup/authoring.ts';
import { canonicalJson, parseJson } from '../../../src/core.ts';
import { deriveInitFileAction } from '../../../src/setup/init-action.ts';
const request = { apiVersion: 'workspace-governance/init-request-v1', authorityId: 'example-authority',
  rootNode: { id: 'example-org', kind: 'organization', slug: 'example', parentId: null,
    visibility: { mode: 'restricted', readers: ['example-operator'] } } };
const fixtures = [];
const add = (name, input) => fixtures.push([name, typeof input === 'string' ? input : JSON.stringify(input)]);
const change = (name, fn) => { const r = structuredClone(request); fn(r); add(name, r); };
add('organization', request);
change('user', r => { r.rootNode.kind = 'user'; r.rootNode.visibility = {mode:'public',readers:[]}; });
change('unicode-and-number-canonicalization', r => { r.rootNode.metadata = {
  '\ue000': 'private-use', '😀': 'astral', '\ud800': 'lone high', '\udc00': 'lone low',
  numeric: [-0, 1e-7, 1e-6, 1e20, 1e21, 1.0000000000000002, Number.MIN_VALUE, Number.MAX_VALUE,
    9007199254740992, 333333333.33333329], escaped: '\u0000\b\t\n\r\f"\\/\u2028\u2029', nested: [true,false,null,{}] };
});
change('large-valid-manifest', r => { r.rootNode.metadata = { one: 'x'.repeat(16384), two: '😀'.repeat(8192) }; });
add('whitespace-and-number-rounding', JSON.stringify({...request,rootNode:{...request.rootNode,metadata:{n:0}}}).replace('"n":0','"n":1000000000000000128'));
add('raw-negative-zero-and-exponents', JSON.stringify({...request,rootNode:{...request.rootNode,metadata:{n:0}}}).replace('"n":0','"n":[-0,-0.0,1e-999,1E+20,4.9406564584124654e-324,9007199254740993]'));
change('lone-surrogate-id-and-reader', r => { r.rootNode.id='example-\ud800'; r.rootNode.visibility.readers=['example-\udc00']; });
change('missing-visibility', r => { delete r.rootNode.visibility; });
change('extra-request', r => { r.approve = true; });
change('extra-node', r => { r.rootNode.approve = true; });
change('wrong-version', r => { r.apiVersion = 'workspace-governance/init-request-v2'; });
change('non-root-kind', r => { r.rootNode.kind = 'area'; });
change('parent', r => { r.rootNode.parentId = 'example-parent'; });
change('remote', r => { r.rootNode.remote = 'https://github.com/example/service'; });
change('metadata-array', r => { r.rootNode.metadata = []; });
change('visibility-extra', r => { r.rootNode.visibility.allow = true; });
change('visibility-empty', r => { r.rootNode.visibility.readers = []; });
change('visibility-duplicate', r => { r.rootNode.visibility.readers.push('example-operator'); });
change('visibility-mode', r => { r.rootNode.visibility.mode = 'inherit'; });
for (const field of ['id','authorityId']) for (const value of ['', 'constructor','example/name','example\\name','example\u0000name']) {
  change(`invalid-${field}-${JSON.stringify(value)}`, r => { (field === 'id' ? r.rootNode : r)[field] = value; });
}
for (const value of ['$defaults','$invocation']) change(`reserved-node-${value}`, r => { r.rootNode.id = value; });
for (const slug of ['','../example','example.','CON','com1.txt','LPT9','example/name','é','-example','x'.repeat(101)])
  change(`slug-${slug}`, r => { r.rootNode.slug = slug; });
for (const slug of ['conifer','com0','example_org','A','x'.repeat(100)])
  change(`valid-slug-${slug}`, r => { r.rootNode.slug = slug; });
add('duplicate', JSON.stringify(request).replace('"authorityId":', '"authorityId":"other","authorityId":'));
add('escaped-duplicate', JSON.stringify(request).replace('"authorityId":', '"authority\\u0049d":"other","authorityId":'));
add('prototype', JSON.stringify(request).replace('"authorityId":', '"__proto__":{},"authorityId":'));
add('nested-prototype', JSON.stringify({...request,rootNode:{...request.rootNode,metadata:{x:1}}}).replace('"x":1','"constructor":1'));
for (const text of ['null','[]','{}','{"x":1,}','[1,]','true false','{"x":01}','{"x":1e999}','{"x":"\n"}']) add(`syntax-${JSON.stringify(text)}`, text);
for (let depth of [28,29,30,31,32,33]) change(`depth-${depth}`, r => { let value = null; for(let i=0;i<depth;i++) value=[value]; r.rootNode.metadata={value}; });
change('string-limit', r => { r.rootNode.metadata={value:'x'.repeat(16385)}; });
// Deterministic IEEE-754 coverage, not a random flaky corpus.
let state = 0x12345678;
const numbers = [];
for(let i=0;i<256;i++) { state = (Math.imul(state,1664525)+1013904223)>>>0; numbers.push((state/0xffffffff-0.5)*10**((i%620)-310)); }
change('finite-number-corpus', r => { r.rootNode.metadata={numbers:numbers.filter(Number.isFinite)}; });
for(const [name, raw] of fixtures) {
  let expected;
  try { expected = 'ok:' + Buffer.from(process.argv.includes('--action')
    ? canonicalJson(deriveInitFileAction(Buffer.from(raw),'/example-control/manifest.json',null))+'\n'
    : canonicalJson(buildInitialManifest(parseJson(raw)))+'\n').toString('hex'); }
  catch(e) { expected = 'error:' + e.code; }
  console.log(name.replaceAll('\t',' ')+'\t'+Buffer.from(raw).toString('hex')+'\t'+expected);
}
