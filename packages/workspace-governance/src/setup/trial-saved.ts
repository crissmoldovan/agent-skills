// Historical data validation only. Never consults a live issuer or candidate.
import {createHash} from 'node:crypto';
import {dirname,relative} from 'node:path';
import {canonicalJson,parseJson,requireThat,digest} from '../core.ts';
import {decodePayload} from './codec.ts';
import {previewPath as validatePreviewPath} from './init-preview.ts';
// Native historical paths also reject Unicode C1 controls (char::is_control).
// Keep the legacy preview surface unchanged; never open saved authority paths.
function previewPath(path:string):void{validatePreviewPath(path);requireThat(!/[\u0080-\u009f]/.test(path));}
import {deriveInitFileAction} from './init-action.ts';
import {deriveInitPolicy} from './init-policy.ts';
import {buildInitialManifest} from './authoring.ts';
export const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
export const lf=(v:unknown)=>Buffer.from(canonicalJson(v)+'\n');
export const eq=(a:unknown,b:unknown)=>requireThat(canonicalJson(a)===canonicalJson(b));
export function obj(v:any,keys:string):void{requireThat(v!==null && typeof v==='object' && !Array.isArray(v));eq(Object.keys(v).sort(),keys.split(' ').sort());}
export function hash(v:any):void{requireThat(typeof v==='string' && /^[a-f0-9]{64}$/.test(v));}
function dec(v:any,positive=false):void{requireThat(typeof v==='string' && /^(0|[1-9][0-9]*)$/.test(v) && BigInt(v)<=18446744073709551615n && (!positive||BigInt(v)>0n));}
function uid(v:any):void{requireThat(Number.isSafeInteger(v)&&v>=0&&v<=4294967295);}
function ascii(v:any):void{requireThat(typeof v==='string'&&/^[\x20-\x7e]{1,256}$/.test(v));}
function id(v:any):void{requireThat(typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(v));}
function mode(v:any):void{requireThat(typeof v==='string'&&/^[0-7]{4}$/.test(v));}
function identity(v:any):void{obj(v,'dev ino');dec(v.dev);dec(v.ino,true);}
function directory(v:any):void{obj(v,'path dev ino mountId uid mode');previewPath(v.path);dec(v.dev);dec(v.ino,true);dec(v.mountId,true);uid(v.uid);eq(v.mode,'0700');}
export function resource(v:any):void{
 obj(v,'path kind identity sha256 treeDigest filesystem');previewPath(v.path);
 requireThat(['absent','file','directory'].includes(v.kind));
 if(v.kind==='absent'){eq([v.identity,v.sha256,v.treeDigest,v.filesystem],[null,null,null,null]);return;}
 identity(v.identity);obj(v.filesystem,'uid gid mode nlink mountId');for(const k of ['uid','gid']){dec(v.filesystem[k]);requireThat(BigInt(v.filesystem[k])<=4294967295n);}
 for(const k of ['nlink','mountId'])dec(v.filesystem[k],true);mode(v.filesystem.mode);requireThat((parseInt(v.filesystem.mode,8)&0o7022)===0);
 if(v.kind==='file'){hash(v.sha256);eq(v.filesystem.nlink,'1');eq(v.treeDigest,null);}else {eq(v.sha256,null);if(v.treeDigest!==null)hash(v.treeDigest);}
}
export function parse(bytes:Buffer,canonical=false):any{const v=parseJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));if(canonical)requireThat(lf(v).equals(bytes));return v;}
const checks=['artifact-consumer','capability-isolation','disconnect-orphan','filesystem-crash','flock-contention','gate-subreaper','init-approval','init-integration','init-terminal-recovery','native-audit','rename-fsync','runtime-closure'];
const sort=(a:string[])=>a.sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
const within=(p:string,q:string)=>p.startsWith(q+'/');
const overlaps=(p:string,q:string)=>p===q||within(p,q)||within(q,p);
export interface Saved {plan:any;context:any;manifest:Buffer;state:Buffer;before:Buffer|null;manifestResource:any;operation:string;operationId:string;result:any;}
/** Rederive every semantic field from closed saved captures and original facts.
 * The historical resource set is evidence, not current authority. Never open its
 * paths. Engine directory entries are reconstructed from captured file paths;
 * an unrepresentable historical empty-directory tree fails conservatively.
 */
export function saved(files:Map<string,Buffer>,stateDir:string,operationId:string):Saved{
 const get=(name:string)=>{const b=files.get(name);requireThat(b);return b;};
 const record=(name:string)=>parse(get(name),true);
 const capture=(name:string,max:262144|2097152=262144)=>decodePayload(record('captures/'+name+'.json'),max);
 const request=capture('request'),beforeValue=record('captures/manifest-before.json');
 const before=beforeValue===null?null:decodePayload(beforeValue);
 const cb=capture('candidate-manifest'),ib=capture('trial-intent'),tb=capture('trial-record'),ab=capture('trial-anchor'),pb=capture('approved-plan',2097152);
 const c=parse(cb),i=parse(ib),t=parse(tb),a=parse(ab),p=record('proposal.json'),ctx=record('context.json');
 eq(parse(pb),p);obj(p,'apiVersion executable kind context authorityId manifestRevision requestDigest executor policy resources bookkeeping actions effects digest');
 eq(p.apiVersion,'workspace-governance/init-trial-setup-plan-v1');eq(p.executable,false);eq(p.kind,'manifest-init');eq(p.context,ctx);
 obj(ctx,'apiVersion kind manifestPath stateDir root nodeId principal requestPath executorProfilePath');
 eq(ctx.apiVersion,'workspace-governance/init-trial-setup-context-v1');eq(ctx.kind,'manifest-init');eq(ctx.stateDir,stateDir);eq([ctx.root,ctx.nodeId,ctx.principal],[null,null,null]);
 for(const k of ['manifestPath','stateDir','requestPath','executorProfilePath'])previewPath(ctx[k]);
 obj(a,'apiVersion issuerUid controller registryRoot fixtureParent candidateManifestSha256');eq(a.apiVersion,'workspace-governance/init-trial-trust-v1');uid(a.issuerUid);directory(a.registryRoot);directory(a.fixtureParent);
 obj(c,'apiVersion classification release abi target helperArchive packedCli provenance engine helper launcher node capabilities runtimeFiles');
 eq(c.apiVersion,'workspace-governance/init-candidate-manifest-v1');eq(c.classification,'development-candidate/pending');id(c.release);eq(c.abi,'linux-init-helper-v1');eq(c.target,'linux-x86_64-glibc236');
 const refs=new Map<string,string>();const ref=(v:any,extra='')=>{obj(v,'path sha256'+(extra?' '+extra:''));previewPath(v.path);hash(v.sha256);requireThat(!refs.has(v.path)||refs.get(v.path)===v.sha256);refs.set(v.path,v.sha256);};
 ref(a.controller);for(const k of ['helperArchive','packedCli','launcher','capabilities'])ref(c[k]);obj(c.provenance,'source build');ref(c.provenance.source);ref(c.provenance.build);ref(c.helper,'abi');eq(c.helper.abi,c.abi);ref(c.node,'version');ascii(c.node.version);
 // Match init_trial_issuer.rs: strip one 'v', take the first dot-delimited
 // component, then Rust u32::from_str (optional '+', leading zeros allowed).
 // This is not semver: a dot/suffix is optional and only the major is parsed.
 const major=c.node.version.slice(1).split('.')[0];
 requireThat(c.node.version.startsWith('v')&&/^\+?[0-9]+$/.test(major));
 requireThat(BigInt(major)>=24n&&BigInt(major)<=4294967295n);
 requireThat(Array.isArray(c.runtimeFiles)&&c.runtimeFiles.length>0&&c.runtimeFiles.length<=4096);let last='';for(const r of c.runtimeFiles){ref(r);requireThat(last===''||Buffer.compare(Buffer.from(last),Buffer.from(r.path))<0);last=r.path;}requireThat(c.runtimeFiles.some((r:any)=>canonicalJson(r)===canonicalJson(c.launcher)));
 obj(c.engine,'path treeSha256 version');previewPath(c.engine.path);hash(c.engine.treeSha256);eq(c.engine.version,c.release);
 const install=dirname(dirname(c.helper.path));eq(c.helper.path,install+'/bin/workspacectl-init-helper');eq(c.launcher.path,install+'/lib/init-launcher.node');eq(c.capabilities.path,install+'/share/init-helper-capabilities.json');
 eq(a.candidateManifestSha256,sha(cb));obj(i,'apiVersion candidateManifestSha256 environment fixture limits');eq(i.apiVersion,'workspace-governance/init-trial-intent-v1');eq(i.candidateManifestSha256,sha(cb));eq(i.limits,{maxBegins:1,maxActions:1,maxStageContainers:0});
 const f=i.fixture;obj(f,'root manifestParent manifestBasename stateParent stateBasename request evidenceRoot');for(const k of ['root','manifestParent','stateParent','evidenceRoot']){directory(f[k]);eq(f[k].uid,a.issuerUid);}
 eq(a.registryRoot.uid,a.issuerUid);eq(a.fixtureParent.uid,a.issuerUid);
 requireThat(dirname(f.root.path)===a.fixtureParent.path);for(const k of ['manifestParent','stateParent'])requireThat(within(f[k].path,f.root.path));
 requireThat(!overlaps(f.manifestParent.path,f.stateParent.path));
 for(const k of ['manifestBasename','stateBasename']){requireThat(typeof f[k]==='string'&&Buffer.byteLength(f[k])<=255&&f[k]!=='.'&&f[k]!=='..'&&!/[\/\\\x00-\x1f\x7f]/.test(f[k]));}
 eq(ctx.manifestPath,f.manifestParent.path+'/'+f.manifestBasename);eq(ctx.stateDir,f.stateParent.path+'/'+f.stateBasename);resource(f.request);eq(f.request.kind,'file');eq(f.request.sha256,sha(request));eq(f.request.filesystem.mode,'0600');eq(f.request.filesystem.uid,String(a.issuerUid));eq(ctx.requestPath,f.request.path);
 requireThat(within(ctx.requestPath,f.root.path)&&!overlaps(ctx.requestPath,f.manifestParent.path)&&!overlaps(ctx.requestPath,f.stateParent.path));
 for(const external of [f.evidenceRoot.path,a.registryRoot.path,install])requireThat(!overlaps(external,a.fixtureParent.path));
 obj(i.environment,'bootId kernelRelease glibcVersion mountNamespaceIno mountinfoSha256 mounts');const env=i.environment;
 requireThat(typeof env.bootId==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(env.bootId));ascii(env.kernelRelease);ascii(env.glibcVersion);dec(env.mountNamespaceIno,true);hash(env.mountinfoSha256);
 const mounts=new Map<string,string>();for(const d of [a.registryRoot,a.fixtureParent,f.root,f.manifestParent,f.stateParent,f.evidenceRoot]){requireThat(!mounts.has(d.mountId)||mounts.get(d.mountId)===d.dev);mounts.set(d.mountId,d.dev);}
 requireThat(Array.isArray(env.mounts));eq(env.mounts.map((m:any)=>m.mountId),[...mounts.keys()].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1));for(const m of env.mounts){obj(m,'mountId dev filesystem optionsSha256');eq(m.dev,mounts.get(m.mountId));requireThat(['ext4','xfs'].includes(m.filesystem));hash(m.optionsSha256);}
 obj(t,'apiVersion classification trialId issuerUid trustAnchorSha256 candidateManifestSha256 environment lifetime fixture invocation limits pendingCheckIds');eq(t.apiVersion,'workspace-governance/init-candidate-trial-v1');eq(t.classification,c.classification);hash(t.trialId);eq(t.issuerUid,a.issuerUid);eq(t.trustAnchorSha256,sha(ab));for(const k of ['candidateManifestSha256','environment','fixture','limits'])eq(t[k],i[k]);eq(t.pendingCheckIds,checks);
 obj(t.lifetime,'issuedBoottimeNs deadlineBoottimeNs');dec(t.lifetime.issuedBoottimeNs);dec(t.lifetime.deadlineBoottimeNs,true);const duration=BigInt(t.lifetime.deadlineBoottimeNs)-BigInt(t.lifetime.issuedBoottimeNs);requireThat(duration>0n&&duration<=600000000000n);
 obj(t.invocation,'mode operationId planSha256 approvalDigest priorTrialId');eq(t.invocation,{mode:'apply',operationId,planSha256:sha(pb),approvalDigest:p.digest,priorTrialId:null});
 const manifest=lf(buildInitialManifest(parse(request))),state=lf({apiVersion:'workspace-governance/setup-state-v1',authorityId:parse(request).authorityId,rootRegistration:null});
 requireThat(decodePayload(record('payloads/manifest-after.json')).equals(manifest));requireThat(decodePayload(record('payloads/state.json')).equals(state));
 const action=deriveInitFileAction(request,ctx.manifestPath,before);eq(p.actions,action?[action]:[]);eq(p.authorityId,parse(request).authorityId);eq(p.manifestRevision,before===null?null:sha(before));eq(p.requestDigest,sha(request));eq(p.policy,deriveInitPolicy(parse(request)));
 eq(p.executor,{apiVersion:'workspace-governance/init-trial-executor-binding-v1',profileId:'manifest-init-only-trial-v1',intentSha256:sha(ib),candidateManifestSha256:sha(cb),helper:c.helper,platform:{os:'linux',arch:'x64',filesystemProfile:'local-durable-v1'}});
 const locks=sort([ctx.manifestPath,stateDir].map(x=>dirname(x)+'/.workspacectl-lock-'+sha(x)));
 eq(p.bookkeeping,{stateParent:dirname(stateDir),stateDir,rootRegistration:null,lockPaths:locks,operationNamespace:'operations/',maxActions:64,maxStageContainers:1,maxStageBytes:1073741824});
 const slots=[ctx.manifestPath,dirname(ctx.manifestPath)+'/.workspacectl-init-'+operationId+'.pending',stateDir,...locks];requireThat(slots.every((x,j)=>slots.every((y,k)=>j===k||!overlaps(x,y))));
 eq(p.effects,{repositoryId:null,target:null,outcome:action?'manifest-created':'already-initialized',refReview:null});
 requireThat(Array.isArray(p.resources)&&p.resources.length<=4096);const resources=new Map<string,any>();for(const r of p.resources){resource(r);requireThat(!resources.has(r.path));resources.set(r.path,r);}eq(p.resources.map((r:any)=>r.path),sort([...resources.keys()]));
 const intentPaths=p.resources.filter((r:any)=>r.sha256===sha(ib)&&r.path!==ctx.executorProfilePath);requireThat(intentPaths.length===1);const intentPath=intentPaths[0].path;
 const required=new Set([...refs.keys(),ctx.executorProfilePath,intentPath,a.registryRoot.path,a.fixtureParent.path,install,ctx.manifestPath,stateDir,ctx.requestPath,c.engine.path,...['operator','operator/init-trial-trust-v1.json','bin','lib','share'].map(x=>install+'/'+x),...['root','manifestParent','stateParent','evidenceRoot'].map(k=>f[k].path)]);
 // Derive the engine tree without following arbitrary historical resource paths.
 const tree=new Map<string,any>();for(const r of p.resources){if(within(r.path,c.engine.path)){eq(r.kind,'file');required.add(r.path);let rel=relative(c.engine.path,r.path);tree.set(rel,{path:rel,kind:'file',sha256:r.sha256});while(dirname(rel)!=='.'){rel=dirname(rel);requireThat(!tree.has(rel)||tree.get(rel).kind==='directory');tree.set(rel,{path:rel,kind:'directory'});}}}
 requireThat(tree.size>0&&tree.size<=4096);eq(digest(sort([...tree.keys()]).map(k=>tree.get(k))),c.engine.treeSha256);eq([...resources.keys()],sort([...required]));
 for(const [path,h] of [...refs,[ctx.executorProfilePath,sha(cb)],[intentPath,sha(ib)],[install+'/operator/init-trial-trust-v1.json',sha(ab)]] as [string,string][]){const r=resources.get(path);eq(r.kind,'file');eq(r.sha256,h);}
 for(const d of [a.registryRoot,a.fixtureParent,f.root,f.manifestParent,f.stateParent,f.evidenceRoot]){const r=resources.get(d.path);eq(r.kind,'directory');eq(r.identity,{dev:d.dev,ino:d.ino});eq(r.filesystem.uid,String(d.uid));eq(r.filesystem.mode,d.mode);eq(r.filesystem.mountId,d.mountId);}
 for(const path of [install,...['operator','bin','lib','share'].map(x=>install+'/'+x),c.engine.path])eq(resources.get(path).kind,'directory');
 for(const r of p.resources){eq(r.treeDigest,r.path===c.engine.path?c.engine.treeSha256:null);requireThat(r.kind==='absent'||r.filesystem.uid==='0'||r.filesystem.uid===String(a.issuerUid));}
 eq(resources.get(ctx.requestPath),f.request);eq(resources.get(stateDir),{path:stateDir,kind:'absent',identity:null,sha256:null,treeDigest:null,filesystem:null});const mr=resources.get(ctx.manifestPath);eq(mr.kind,before===null?'absent':'file');eq(mr.sha256,before===null?null:sha(before));if(before!==null){eq(mr.filesystem.mode,'0600');eq(mr.filesystem.uid,String(a.issuerUid));}
 for(const path of [ctx.executorProfilePath,intentPath,...refs.keys()])requireThat(!overlaps(path,a.fixtureParent.path)&&!overlaps(path,a.registryRoot.path));
 const {digest:pd,...body}=p;hash(pd);eq(pd,digest(body));
 const operation=stateDir+'/operations/'+operationId;
 return {plan:p,context:ctx,manifest,state,before,manifestResource:mr,operation,operationId,result:{apiVersion:'workspace-governance/init-trial-setup-result-v1',operationId,proposalDigest:pd,state:'interrupted',actions:p.actions.map((x:any)=>({id:x.id,state:'pending',evidenceRef:null})),manifestRevision:before===null?null:sha(before),checkout:null}};
}
