import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, lstat, readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {decodePayload} from '../src/setup/codec.ts';
import {createHash} from 'node:crypto';
import {hash,resource} from '../src/setup/trial-saved.ts';
test('historical resource scalars consume the full string and retain native bounds',()=>{
 const base={path:'/historical/file',kind:'file',identity:{dev:'0',ino:'1'},sha256:'a'.repeat(64),treeDigest:null,filesystem:{uid:'0',gid:'4294967295',mode:'0600',nlink:'1',mountId:'1'}};
 assert.doesNotThrow(()=>resource(base));
 for(const [group,key,value] of [['identity','dev','0\n'],['identity','ino','1\n'],['filesystem','uid','0\n'],['filesystem','gid','1\n'],['filesystem','mode','0600\n'],['filesystem','mountId','1\n'],['identity','dev','18446744073709551616'],['filesystem','gid','4294967296'],['identity','dev','00'],['identity','dev','+0']] as const){
  const r=structuredClone(base);
  if(group==='identity'){assert.ok(key==='dev'||key==='ino');r.identity[key]=value;}
  else {assert.ok(key==='uid'||key==='gid'||key==='mode'||key==='mountId');r.filesystem[key]=value;}
  assert.throws(()=>resource(r),`${group}.${key}: ${JSON.stringify(value)}`);
 }
 assert.doesNotThrow(()=>resource({...base,identity:{dev:'18446744073709551615',ino:'18446744073709551615'}}));
 assert.doesNotThrow(()=>hash('a'.repeat(64)));assert.throws(()=>hash('a'.repeat(64)+'\n'));
 for(const control of ['\u0080','\u0085','\u009f'])assert.throws(()=>resource({...base,path:'/historical/'+control}), 'native char::is_control rejects C1 path controls');
 assert.doesNotThrow(()=>resource({...base,path:'/historical/é'}));
});
const cli=fileURLToPath(new URL('../src/cli.ts',import.meta.url));
test('saved plan decoding has a separate ceiling; ordinary captures stay bounded',()=>{
 const b=Buffer.alloc(262145,32),chunks=[];for(let i=0;i<b.length;i+=12288)chunks.push(b.subarray(i,i+12288).toString('base64'));
 const p={encoding:'base64-chunks-v1',byteLength:b.length,sha256:createHash('sha256').update(b).digest('hex'),chunks};
 assert.throws(()=>decodePayload(p));assert.deepEqual(decodePayload(p,2097152),b);
});
test('status: installed-route grammar maps unknown operation without bookkeeping',async()=>{
 const base=process.env.WG_NATIVE_TEST_ROOT || process.env.TMPDIR;
 assert.ok(base,'private test root is required');
 const root=await mkdtemp(base+'/status-unit-');await mkdir(root+'/state',{mode:0o700});
 const before=await lstat(root+'/state',{bigint:true});
 const r=spawnSync(process.execPath,[cli,'mutation-status','--state-dir',root+'/state','--operation-id','unknown'],{encoding:'utf8'});
 assert.equal(r.status,2);assert.deepEqual(JSON.parse(r.stderr),{error:{code:'UNAVAILABLE',message:'Resource unavailable.'}});
 assert.equal(r.stdout,'');assert.deepEqual(await readdir(root+'/state'),[]);
 assert.equal((await lstat(root+'/state',{bigint:true})).ino,before.ino);
});
