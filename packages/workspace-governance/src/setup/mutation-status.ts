import {constants, type BigIntStats} from 'node:fs';
import {open, lstat, opendir, type FileHandle} from 'node:fs/promises';
import {dirname, basename} from 'node:path';
import {GovernanceError, requireThat} from '../core.ts';
import {previewPath} from './init-preview.ts';
import {saved,parse,lf,eq,obj,sha,hash,type Saved} from './trial-saved.ts';

const changed=()=>new GovernanceError('RECOVERY_REQUIRED');
const same=(a:BigIntStats,b:BigIntStats)=>['dev','ino','mode','uid','gid','nlink','size','mtimeNs','ctimeNs'].every(k=>a[k as keyof BigIntStats]===b[k as keyof BigIntStats]);
async function kernel(path:string,max:number):Promise<Buffer>{
 const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const b=Buffer.alloc(max+1);let n=0;while(n<b.length){const r=await f.read(b,n,b.length-n,null);if(!r.bytesRead)break;n+=r.bytesRead;}requireThat(n<=max,'LIMIT');return b.subarray(0,n);}finally{await f.close();}
}
/** Descriptor-anchored, no-follow observation. No writable descriptor is opened.
 * Retain every ancestor and negative witness through one bounded snapshot.
 * /proc/self/fd is the Linux kernel's handle namespace, never caller input.
 */
export class Snapshot {
 handles=new Map<string,{file:FileHandle,stat:BigIntStats,named:string}>();
 missing=new Map<string,string>(); total=0;
 async bytes(path:string,max:number):Promise<Buffer>{
  requireThat(this.handles.size<1200,'LIMIT');
  const parent=await this.directory(dirname(path));const named=`/proc/self/fd/${parent.fd}/${basename(path)}`;
  const file=await open(named,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
   const stat=await file.stat({bigint:true});requireThat(stat.isFile()&&stat.nlink===1n&&stat.uid===BigInt(process.geteuid!())&&(stat.mode&0o7777n)===0o600n,'RECOVERY_REQUIRED');
   requireThat(stat.size<=BigInt(max),'LIMIT');this.total+=Number(stat.size);requireThat(this.total<=16777216,'LIMIT');
   const b=Buffer.alloc(Number(stat.size)+1);let n=0;
   while(n<b.length){const r=await file.read(b,n,b.length-n,null);if(!r.bytesRead)break;n+=r.bytesRead;}
   requireThat(n===Number(stat.size),'RECOVERY_REQUIRED');
   this.handles.set(path,{file,stat,named});return b.subarray(0,n);
  }catch(e){await file.close();throw e;}
 }
 async names(path:string):Promise<string[]>{
  const parent=await this.directory(path,true),out:string[]=[];
  const dir=await opendir(`/proc/self/fd/${parent.fd}`);
  try{while(true){const e=await dir.read();if(!e)break;requireThat(out.length<1100,'LIMIT');out.push(e.name);}}finally{await dir.close();}
  return out.sort();
 }
 async directory(path:string,privateMode=false):Promise<FileHandle>{
  const prior=this.handles.get(path);if(prior){if(privateMode)requireThat((prior.stat.mode&0o7777n)===0o700n && prior.stat.uid===BigInt(process.geteuid!()),'RECOVERY_REQUIRED');return prior.file;}
  const parent=path==='/'?null:await this.directory(dirname(path));
  const named=parent?`/proc/self/fd/${parent.fd}/${basename(path)}`:'/';
  const file=await open(named,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {const stat=await file.stat({bigint:true});requireThat(stat.isDirectory() && (stat.mode&0o7022n)===0n && (stat.uid===0n || stat.uid===BigInt(process.geteuid!())),'RECOVERY_REQUIRED');
   if(privateMode)requireThat((stat.mode&0o7777n)===0o700n && stat.uid===BigInt(process.geteuid!()),'RECOVERY_REQUIRED');
   this.handles.set(path,{file,stat,named});return file;
  }catch(e){await file.close();throw e;}
 }
 async exists(path:string):Promise<boolean>{
  const parent=await this.directory(dirname(path));const named=`/proc/self/fd/${parent.fd}/${basename(path)}`;
  try{await lstat(named);return true;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;this.missing.set(path,named);return false;}
 }
 async stable():Promise<boolean>{
  for(const {file,stat,named} of this.handles.values())try{if(!same(stat,await file.stat({bigint:true}))||!same(stat,await lstat(named,{bigint:true})))return false;}catch{return false;}
  for(const named of this.missing.values())try{await lstat(named);return false;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')return false;}
  return true;
 }
 async close(){
  const failures:unknown[]=[];
  for(const h of [...this.handles.values()].reverse())try{await h.file.close();}catch(error){failures.push(error);}
  if(failures.length===1)throw failures[0];
  if(failures.length>1)throw new AggregateError(failures,'snapshot handle close failures');
 }
}
const fixed=['proposal.json','context.json','owner.json','result.json','captures/request.json','captures/manifest-before.json','captures/trial-intent.json','captures/trial-record.json','captures/candidate-manifest.json','captures/trial-anchor.json','captures/approved-plan.json','payloads/manifest-after.json','payloads/state.json'];
function fileFact(v:any,sha256:string,mode='0600'){
 obj(v,'identity mode sha256 treeDigest');obj(v.identity,'dev ino');
 for(const k of ['dev','ino'])requireThat(typeof v.identity[k]==='string'&&/^(0|[1-9][0-9]*)$/.test(v.identity[k])&&BigInt(v.identity[k])<=18446744073709551615n&&(k!=='ino'||BigInt(v.identity[k])>0n));
 eq(v.mode,mode);eq(v.sha256,sha256);eq(v.treeDigest,null);
}
async function observe(s:Snapshot,stateDir:string,operationId:string):Promise<unknown>{
 const operation=stateDir+'/operations/'+operationId,files=new Map<string,Buffer>();let bad=false,captureSize=0;
 await s.directory(operation,true);
 // Bounded inventory: unknown names are not traversed, and cannot be blessed.
 const known=new Set(fixed);for(let n=1;n<=256;n++)for(const d of ['events','evidence'])known.add(`${d}/${String(n).padStart(6,'0')}.json`);
 const names=new Set<string>();
 for(const d of ['', 'captures','payloads','events','evidence']){
  try{
   const list=await s.names(d?operation+'/'+d:operation);
   for(const name of list){if(!d&&['captures','payloads','events','evidence'].includes(name))continue;
    const rel=d?d+'/'+name:name;names.add(rel);
    const pending=name.startsWith('.')&&name.endsWith('.pending');const final=pending?(d?d+'/':'')+name.slice(1,-8):rel;
    if(!known.has(final)){bad=true;continue;}
    try{const b=await s.bytes(operation+'/'+rel,rel==='context.json'?65536:2097152);files.set(rel,b);if(d==='captures'||d==='payloads'){captureSize+=b.length;requireThat(captureSize<=2097152,'LIMIT');}}
    catch(e){if(e instanceof GovernanceError&&e.code==='LIMIT')throw e;bad=true;}
   }
  }catch(e){if(e instanceof GovernanceError&&e.code==='LIMIT')throw e;bad=true;}
 }
 let v:Saved;try{v=saved(files,stateDir,operationId);}catch(e){if(e instanceof GovernanceError&&e.code==='LIMIT')throw e;throw changed();}
 const result=v.result;let previous:string|null=null,sequence=0,stage=0,complete=false;
 // Current safe final parents must still be the original named parents. These
 // are local filesystem checks, not recapture of historical authority inputs.
 try{
  const mi=(await kernel('/proc/self/mountinfo',2097152)).toString('utf8');
  const mounts=mi.trimEnd().split('\n').map(line=>{const [left,right]=line.split(' - ');requireThat(right);const l=left.split(' '),r=right.split(' ');return {id:l[0],root:l[3],path:l[4].replace(/\\([0-7]{3})/g,(_,x)=>String.fromCharCode(parseInt(x,8))),fs:r[0]};});
  for(const path of [dirname(v.context.manifestPath),dirname(stateDir)]){
   const f=await s.directory(path,true),st=s.handles.get(path)!.stat;
   const original=v.plan.resources.find((r:any)=>r.path===path);eq(original.identity,{dev:String(st.dev),ino:String(st.ino)});
   const info=(await kernel(`/proc/self/fdinfo/${f.fd}`,4096)).toString('ascii');const id=info.match(/^mnt_id:\s+(\d+)$/m)?.[1];const mount=mounts.find(m=>m.id===id);requireThat(mount&&['ext4','xfs'].includes(mount.fs)&&mount.root==='/');
   requireThat(!mounts.some(m=>m.path===path||m.path.startsWith(path+'/')));
  }
 }catch(e){if(e instanceof GovernanceError&&e.code==='LIMIT')throw e;bad=true;}
 const facts=new Map<string,{fact:any,bytes:Buffer}>();
 // Owner is diagnostic only: never inspect PID liveness or claim lock authority.
 try{const owner=parse(files.get('owner.json')!,true);obj(owner,'operationId proposalDigest pid bootId processStartTicks nonce');eq(owner.operationId,operationId);eq(owner.proposalDigest,v.plan.digest);hash(owner.nonce);for(const k of ['pid','processStartTicks'])requireThat(typeof owner[k]==='string'&&/^[1-9][0-9]*$/.test(owner[k])&&BigInt(owner[k])<=18446744073709551615n);requireThat(typeof owner.bootId==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(owner.bootId));}catch{bad=true;}
 const action=v.plan.actions[0];
 const transitions=[{phase:'prepared',path:null,payload:null,id:null,bytes:null},
  {phase:'file-intent',path:stateDir+'/state.json',payload:'payloads/state.json',id:null,bytes:v.state},
  {phase:'file-published',path:stateDir+'/state.json',payload:'payloads/state.json',id:null,bytes:v.state},
  ...(action?[{phase:'file-intent',path:v.context.manifestPath,payload:'payloads/manifest-after.json',id:action.id,bytes:v.manifest},{phase:'file-published',path:v.context.manifestPath,payload:'payloads/manifest-after.json',id:action.id,bytes:v.manifest}]:[])];
 const expectedTerminal=()=>({...result,state:'verified',manifestRevision:sha(v.manifest)});
 const validatePair=(n:number,eb:Buffer,jb?:Buffer)=>{
  const e=parse(eb,true);obj(e,'apiVersion operationId proposalDigest sequence actionId phase resource stage clone child');eq(e.apiVersion,'workspace-governance/init-trial-setup-evidence-v1');eq([e.operationId,e.proposalDigest,e.sequence,e.stage,e.clone,e.child],[operationId,v.plan.digest,n,null,null,null]);
  if(jb){const j=parse(jb,true);obj(j,'apiVersion sequence previousEventDigest operationId proposalDigest actionId event evidenceDigest evidenceRef');eq(j,{apiVersion:'workspace-governance/init-trial-journal-event-v1',sequence:n,previousEventDigest:previous,operationId,proposalDigest:v.plan.digest,actionId:e.actionId,event:e.phase,evidenceDigest:sha(eb),evidenceRef:`evidence/${String(n).padStart(6,'0')}.json`});}
  requireThat(!complete);
  if(['interrupted','needs-attention'].includes(e.phase)){eq(e.actionId,null);eq(e.resource,null);return e;}
  if(e.phase==='complete'){
   requireThat(stage===transitions.length);eq(e.actionId,null);obj(e.resource,'path before after payloadRef');eq([e.resource.path,e.resource.before,e.resource.payloadRef],[operation+'/result.json',null,null]);
   const rb=files.get('result.json');requireThat(rb);requireThat(lf(expectedTerminal()).equals(rb));fileFact(e.resource.after,sha(rb));return e;
  }
  const next=transitions[stage];requireThat(next);eq([e.phase,e.actionId],[next.phase,next.id]);
  if(next.path===null)eq(e.resource,null);else {obj(e.resource,'path before after payloadRef');eq([e.resource.path,e.resource.before,e.resource.payloadRef],[next.path,null,next.payload]);if(e.phase==='file-intent')eq(e.resource.after,null);else fileFact(e.resource.after,sha(next.bytes!));}
  return e;
 };
 const eventNames=[...names].filter(x=>/^events\/[0-9]{6}\.json$/.test(x)).sort();
 for(const name of eventNames){
  try{const n=sequence+1;eq(name,`events/${String(n).padStart(6,'0')}.json`);requireThat(n<=256);const eb=files.get(name.replace('events/','evidence/')),jb=files.get(name);requireThat(eb&&jb);const e=validatePair(n,eb,jb);
   if(e.phase==='complete'){complete=true;facts.set(operation+'/result.json',{fact:e.resource.after,bytes:files.get('result.json')!});}
   else if(e.phase==='interrupted'||e.phase==='needs-attention'){if(e.phase==='needs-attention')bad=true;}
   else {stage++;if(e.phase==='file-published'){facts.set(e.resource.path,{fact:e.resource.after,bytes:e.resource.path===v.context.manifestPath?v.manifest:v.state});if(e.actionId!==null){result.actions[0]={id:action.id,state:'verified',evidenceRef:name.replace('events/','evidence/')};result.manifestRevision=sha(v.manifest);}}
    if(e.phase==='file-intent'&&e.actionId!==null)result.actions[0]={id:action.id,state:'intent',evidenceRef:name.replace('events/','evidence/')};}
   sequence=n;previous=sha(jb);
  }catch{bad=true;break;}
 }
 // Next unreferenced evidence is not a committed transition. Validate if final;
 // its pending bytes may still be being written and never prove progress.
 for(const name of names){
  if(!name.includes('.pending')&&!name.startsWith('evidence/'))continue;
  if(name.startsWith('evidence/')&&!name.includes('.pending')){const n=Number(name.slice(9,15));if(n<=sequence)continue;try{requireThat(n===sequence+1&&!complete);const eb=files.get(name);requireThat(eb);const orphan=validatePair(n,eb);if(orphan.phase==='complete')facts.set(operation+'/result.json',{fact:orphan.resource.after,bytes:files.get('result.json')!});}catch{bad=true;}continue;}
  const slash=name.lastIndexOf('/'),base=name.slice(slash+1),final=name.slice(0,slash+1)+base.slice(1,-8);
  if(names.has(final)||complete){bad=true;continue;}
  const next=String(sequence+1).padStart(6,'0');
  const allowed=final===`evidence/${next}.json`||final===`events/${next}.json`||final==='result.json'&&stage===transitions.length;
  if(!allowed)bad=true;
 }
 if(files.has('result.json'))try{requireThat(stage===transitions.length);requireThat(lf(expectedTerminal()).equals(files.get('result.json')!));}catch{bad=true;}
 // State namespace and manifest temporary are observationally inspected only.
 try{const stateNames=await s.names(stateDir);requireThat(stateNames.every(x=>['operations','state.json','.state.json.pending'].includes(x)));if(stateNames.includes('.state.json.pending')){requireThat(!stateNames.includes('state.json')&&stage===2&&!complete);await s.bytes(stateDir+'/.state.json.pending',262144);}
  const temp=dirname(v.context.manifestPath)+'/.workspacectl-init-'+operationId+'.pending';if(await s.exists(temp)){requireThat(!facts.has(v.context.manifestPath)&&stage===4&&!complete);await s.bytes(temp,262144);}
 }catch(e){if(e instanceof GovernanceError&&e.code==='LIMIT')throw e;bad=true;}
 if(v.before!==null)facts.set(v.context.manifestPath,{fact:{identity:v.manifestResource.identity,mode:'0600',sha256:sha(v.manifest),treeDigest:null},bytes:v.manifest});
 for(const [path,{fact,bytes}] of facts)try{
  const b=path===operation+'/result.json'?files.get('result.json')!:await s.bytes(path,262144);requireThat(b.equals(bytes));const st=s.handles.get(path)!.stat;eq(fact,{identity:{dev:String(st.dev),ino:String(st.ino)},mode:(Number(st.mode)&0o7777).toString(8).padStart(4,'0'),sha256:sha(b),treeDigest:null});
 }catch(e){if(e instanceof GovernanceError&&e.code==='LIMIT')throw e;bad=true;if(path===v.context.manifestPath){result.manifestRevision=null;if(action)result.actions[0].state='uncertain';}}
 // An effect visible with intent but without durable identity is ambiguous,
 // even when no candidate is present. Absence does not invent ownership.
 for(const [path,intentStage] of [[stateDir+'/state.json',2],[v.context.manifestPath,4]] as [string,number][]){if(!facts.has(path))try{if(await s.exists(path)){bad=true;if(path===v.context.manifestPath&&action)result.actions[0].state='uncertain';}else if(stage===intentStage){/* valid pending prefix */}}catch{bad=true;}}
 if(bad){result.state='needs-attention';for(const a of result.actions)if(a.state!=='verified')a.state='uncertain';}
 else result.state=complete?'verified':'interrupted';
 return result;
}
/** Observational only: never attests prior fsync success or grants recovery. */
export async function readMutationStatus(stateDir:string,operationId:string):Promise<unknown>{
 previewPath(stateDir);requireThat(typeof operationId==='string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(operationId));
 requireThat(process.platform==='linux','UNSUPPORTED');
 for(let attempt=0;attempt<2;attempt++){
  const s=new Snapshot();let result:unknown,error:unknown;
  try{
   if(!await s.exists(stateDir))throw new GovernanceError('UNAVAILABLE');
   await s.directory(stateDir,true);
   if(!await s.exists(stateDir+'/operations'))throw new GovernanceError('UNAVAILABLE');
   await s.directory(stateDir+'/operations',true);
   if(!await s.exists(stateDir+'/operations/'+operationId))throw new GovernanceError('UNAVAILABLE');
   result=await observe(s,stateDir,operationId);
  }catch(e){error=e instanceof GovernanceError?e:changed();}
  const stable=await s.stable();await s.close();
  if(!stable){if(attempt===0)continue;throw changed();}
  if(error)throw error;return result;
 }
 throw changed();
}
