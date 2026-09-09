import {constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {dirname} from 'node:path';
import {spawn} from 'node:child_process';
import type {Duplex} from 'node:stream';
import {createHash} from 'node:crypto';
import {canonicalJson,parseJson,requireThat} from '../core.ts';
import {encodePayload} from './codec.ts';
import {deriveInitPreview,previewPath} from './init-preview.ts';
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
async function ancestry(path:string):Promise<void>{
 for(let p=path;;p=dirname(p)){
  const s=await lstat(p);requireThat(s.isDirectory() && !s.isSymbolicLink() && (s.mode&0o022)===0 && (s.uid===0 || s.uid===process.getuid!()));
  if(p==='/')break;
 }
}
async function capture(path:string,max:number,absent=false):Promise<Buffer|null>{
 previewPath(path);await ancestry(dirname(path));
 let f;try{f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}catch(e){if(absent && (e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
 try{
  const before=await f.stat({bigint:true});requireThat(before.isFile() && before.nlink===1n && before.uid===BigInt(process.getuid!()) && (before.mode&0o022n)===0n && before.size<=BigInt(max));
  const bytes=Buffer.alloc(max+1);let count=0;
  while(count<bytes.length){const {bytesRead}=await f.read(bytes,count,bytes.length-count,null);if(!bytesRead)break;count+=bytesRead;}
  requireThat(count<=max,'LIMIT');const after=await f.stat({bigint:true}),named=await lstat(path,{bigint:true});
  requireThat(['dev','ino','size','mtimeNs','ctimeNs','mode','uid','nlink'].every(k=>before[k as keyof typeof before]===after[k as keyof typeof after] && before[k as keyof typeof before]===named[k as keyof typeof named]) && before.size===BigInt(count),'STALE_PLAN');
  return bytes.subarray(0,count);
 }finally{await f.close();}
}
function strict(value:unknown,keys:string[]):asserts value is Record<string,any>{
 requireThat(value!==null && typeof value==='object' && !Array.isArray(value));
 requireThat(Object.keys(value).length===keys.length && keys.every(k=>Object.hasOwn(value,k)));
}
/** Private bounded read-only transport. NOT the future N-API authority launcher. */
async function verifyNative(helper:string,frame:Buffer):Promise<void>{
 requireThat(frame.length>0 && frame.length<=2097152,'LIMIT');
 await new Promise<void>((resolve,reject)=>{
  const child=spawn(helper,['--ipc-fd','3'],{cwd:'/',env:{},stdio:['ignore','ignore','ignore','pipe']});
  const channel=child.stdio[3] as Duplex;let bytes=Buffer.alloc(0);let failed=false;
  const fail=()=>{if(failed)return;failed=true;child.kill('SIGKILL');channel.destroy();};
  const timer=setTimeout(fail,7000);
  child.on('error',()=>{fail();});channel.on('error',fail);
  channel.on('data',(chunk:Buffer)=>{if(bytes.length+chunk.length>4100){fail();return;}bytes=Buffer.concat([bytes,chunk]);});
  child.on('close',(code)=>{clearTimeout(timer);try{
   requireThat(!failed && code===0 && bytes.length>=4 && bytes.readUInt32BE(0)===bytes.length-4);
   const result=parseJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(4)));
   requireThat(canonicalJson(result)===canonicalJson({executable:false,valid:true}),'STALE_PLAN');resolve();
  }catch(e){reject(e);}});
  const header=Buffer.alloc(4);header.writeUInt32BE(frame.length);channel.end(Buffer.concat([header,frame]));
 });
}
export async function manifestInitTrialPlan(flags:Record<string,string>){
 requireThat(process.platform==='linux' && process.arch==='x64','UNSUPPORTED');
 for(const k of ['install-root','candidate','intent'])previewPath(flags[k]);
 await ancestry(flags['install-root']);
 const anchorPath=flags['install-root']+'/operator/init-trial-trust-v1.json';
 const anchorBytes=(await capture(anchorPath,262144))!;
 const anchor=parseJson(new TextDecoder('utf-8',{fatal:true}).decode(anchorBytes));
 strict(anchor,['apiVersion','issuerUid','controller','registryRoot','fixtureParent','candidateManifestSha256']);
 requireThat(anchor.apiVersion==='workspace-governance/init-trial-trust-v1' && anchor.issuerUid===process.getuid!());
 strict(anchor.controller,['path','sha256']);previewPath(anchor.controller.path);
 requireThat(typeof anchor.controller.sha256==='string' && /^[a-f0-9]{64}$/.test(anchor.controller.sha256));
 const controller=(await capture(anchor.controller.path,16777216))!;
 requireThat(sha(controller)===anchor.controller.sha256,'STALE_PLAN');
 requireThat(controller.length>=64 && controller.subarray(0,7).equals(Buffer.from([127,69,76,70,2,1,1])) && controller.readUInt16LE(18)===62,'UNSUPPORTED');
 // Fixed read-only argv only. This does not launch a trial, helper or candidate child.
 const bytes=await new Promise<Buffer>((resolve,reject)=>{
  const child=spawn(anchor.controller.path,['plan',flags['install-root'],flags.candidate,flags.intent],{cwd:'/',env:{},stdio:['ignore','pipe','ignore']});
  let bytes=Buffer.alloc(0),failed=false;
  const fail=()=>{failed=true;child.kill('SIGKILL');};
  const timer=setTimeout(fail,30000);
  child.on('error',fail);child.stdout.on('error',fail);
  child.stdout.on('data',(chunk:Buffer)=>{if(bytes.length+chunk.length>262144){fail();return;}bytes=Buffer.concat([bytes,chunk]);});
  child.on('close',code=>{clearTimeout(timer);try{requireThat(!failed && code===0 && bytes.length>0,'UNSUPPORTED');resolve(bytes);}catch(e){reject(e);}});
 });
 requireThat((await capture(anchorPath,262144))!.equals(anchorBytes) && sha((await capture(anchor.controller.path,16777216))!)===anchor.controller.sha256,'STALE_PLAN');
 const plan=parseJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 strict(plan,['apiVersion','executable','kind','context','authorityId','manifestRevision','requestDigest','executor','policy','resources','bookkeeping','actions','effects','digest']);
 requireThat(plan.apiVersion==='workspace-governance/init-trial-setup-plan-v1' && plan.executable===false && plan.kind==='manifest-init');
 const {digest,...body}=plan;requireThat(digest===sha(Buffer.from(canonicalJson(body))),'STALE_PLAN');
 return plan;
}

export async function manifestInitPlan(flags:Record<string,string>){
 requireThat(process.platform==='linux' && process.arch==='x64','UNSUPPORTED');
 for(const k of ['manifest','request','state-dir','executor-profile'])previewPath(flags[k]);
 const paths=['manifest','request','state-dir','executor-profile'].map(k=>flags[k]);
 requireThat(paths.every((p,i)=>paths.every((q,j)=>i===j || (p!==q && !p.startsWith(q+'/') && !q.startsWith(p+'/')))));
 await ancestry(dirname(flags['state-dir']));
 const profileBytes=(await capture(flags['executor-profile'],262144))!;
 const profile=parseJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(profileBytes));strict(profile,['apiVersion','helper']);
 requireThat(profile.apiVersion==='workspace-governance/init-preview-profile-v1','UNSUPPORTED');strict(profile.helper,['path','sha256']);
 previewPath(profile.helper.path);requireThat(typeof profile.helper.sha256==='string' && /^[a-f0-9]{64}$/.test(profile.helper.sha256));
 requireThat(paths.every(p=>p!==profile.helper.path && !profile.helper.path.startsWith(p+'/')));
 const helper=(await capture(profile.helper.path,16777216))!;requireThat(sha(helper)===profile.helper.sha256,'STALE_PLAN');
 const request=(await capture(flags.request,262144))!,existing=await capture(flags.manifest,262144,true);
 const plan=deriveInitPreview(request,flags.manifest,flags['state-dir'],profile.helper.sha256,existing);
 const frame=Buffer.from(canonicalJson({apiVersion:'workspace-governance/init-preview-helper-request-v1',operation:'verify',request:encodePayload(request),existing:existing===null?null:encodePayload(existing),manifestPath:flags.manifest,stateDir:flags['state-dir'],proposal:plan}));
 await verifyNative(profile.helper.path,frame);
 // Recheck bytes via fresh safe captures after exit, not original-inode reservation.
 requireThat((await capture(flags.request,262144))!.equals(request) && (await capture(flags['executor-profile'],262144))!.equals(profileBytes) && sha((await capture(profile.helper.path,16777216))!)===profile.helper.sha256,'STALE_PLAN');
 const current=await capture(flags.manifest,262144,true);requireThat(existing===null?current===null:current!==null&&existing.equals(current),'STALE_PLAN');
 return {nativeVerified:true,plan};
}
