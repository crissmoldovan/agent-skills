import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {cp,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const run=(file,args,options={})=>spawnSync(file,args,{encoding:'utf8',timeout:30000,maxBuffer:1048576,...options});
const must=(file,args,options={})=>{const r=run(file,args,options);assert.equal(r.error,undefined,`${file}: ${r.error?.message}`);assert.equal(r.signal,null,`${file}: ${r.signal}`);assert.equal(r.status,0,`${file}: ${r.stderr}`);return r;};
const sudo=(args,options={})=>must('sudo',['-n',...args],options);
const sudoExists=path=>{const r=run('sudo',['-n','test','-e',path]);assert.equal(r.error,undefined,`sudo test: ${r.error?.message}`);assert.equal(r.signal,null,`sudo test: ${r.signal}`);assert.ok(r.status===0||r.status===1,`sudo test: ${r.stderr}`);assert.equal(r.stderr,'',`sudo test: ${r.stderr}`);return r.status===0;};
const snapshot=root=>{
 const facts=sudo(['find',root,'-xdev','-printf','%P\\037%y\\037%m\\037%U\\037%G\\037%D\\037%i\\037%n\\037%s\\037%T@\\037%l\\036'],{encoding:null,maxBuffer:16777216}).stdout;
 const records=facts.toString('binary').split('\x1e').filter(Boolean).sort().join('\x1e');
 return {archive:sudo(['tar','--format=ustar','--sort=name','--numeric-owner','-cf','-','-C',root,'.'],{encoding:null,maxBuffer:16777216}).stdout,facts:Buffer.from(records,'binary')};
};
const atime=path=>Number(sudo(['stat','-c','%X',path]).stdout.trim());
const cString=value=>JSON.stringify(value);
const cases=[
 {name:'ancestry-negative',rootOwner:'ruid',anchorOwner:'euid',controllerOwner:'euid',issuer:'euid',anchorRead:false,shouldRun:false},
 {name:'capture-negative',rootOwner:'euid',anchorOwner:'ruid',controllerOwner:'ruid',issuer:'euid',anchorRead:false,shouldRun:false},
 {name:'issuer-negative',rootOwner:'euid',anchorOwner:'euid',controllerOwner:'euid',issuer:'ruid',anchorRead:true,shouldRun:false},
 {name:'positive',rootOwner:'euid',anchorOwner:'euid',controllerOwner:'euid',issuer:'euid',anchorRead:true,shouldRun:true},
];

async function runBoundaryCases(installedBin,selected,expectMutation=false){
 const uid=process.getuid(),gid=process.getgid(),owner=value=>value==='euid'?0:uid,group=value=>value==='euid'?0:gid;
 const scratch=await mkdtemp(join(tmpdir(),'workspace-governance-effective-uid-'));
 const base=`/root/workspace-governance-effective-uid-${process.pid}-${randomUUID()}`;
 const invoke=(root,candidate,intent)=>run('sudo',['-n','setpriv','--ruid',String(uid),'--euid','0','--rgid',String(gid),'--egid','0','--clear-groups',process.execPath,installedBin,'manifest-init-trial-plan','--install-root',root,'--candidate',candidate,'--intent',intent]);
 let failure;
 try {
  sudo(['install','-d','-m','0700','-o','0','-g','0',base]);
  const observations=[];
  for(const entry of selected){
   const root=`${base}/${entry.name}`,controller=`${root}/controller`,anchor=`${root}/operator/init-trial-trust-v1.json`,sentinel=`${base}/${entry.name}-controller-ran`;
   const source=join(scratch,`${entry.name}.c`),binary=join(scratch,`${entry.name}-controller`),anchorInput=join(scratch,`${entry.name}-anchor.json`);
   await writeFile(source,`#include <fcntl.h>\n#include <unistd.h>\nint main(void){int fd=open(${cString(sentinel)},O_WRONLY|O_CREAT|O_EXCL,0600);if(fd>=0)close(fd);(void)write(1,"{}\\n",3);return 0;}\n`,{mode:0o600});
   must('cc',['-O2','-o',binary,source]);
   const controllerHash=hash(await readFile(binary));
   sudo(['install','-d','-m','0700','-o',String(owner(entry.rootOwner)),'-g',String(group(entry.rootOwner)),root]);
   sudo(['install','-d','-m','0700','-o',String(owner(entry.rootOwner)),'-g',String(group(entry.rootOwner)),`${root}/operator`]);
   sudo(['install','-m','0700','-o',String(owner(entry.controllerOwner)),'-g',String(group(entry.controllerOwner)),binary,controller]);
   await writeFile(anchorInput,JSON.stringify({apiVersion:'workspace-governance/init-trial-trust-v1',issuerUid:owner(entry.issuer),controller:{path:controller,sha256:controllerHash},registryRoot:{},fixtureParent:{},candidateManifestSha256:'0'.repeat(64)})+'\n',{mode:0o600});
   sudo(['install','-m','0600','-o',String(owner(entry.anchorOwner)),'-g',String(group(entry.anchorOwner)),anchorInput,anchor]);
   const before=snapshot(base);
   sudo(['touch','-a','-d','@1',anchor]);
   const result=invoke(root,`${root}/missing-candidate`,`${root}/missing-intent`);
   const observation={
    name:entry.name,
    status:result.status,
    signal:result.signal,
    stdout:result.stdout,
    errorCode:(()=>{try{return JSON.parse(result.stderr).error.code;}catch{return null;}})(),
    anchorRead:atime(anchor)>1,
    controllerRan:sudoExists(sentinel),
   };
   observations.push(observation);
   assert.equal(result.error,undefined);assert.equal(observation.signal,null);assert.equal(observation.status,2);assert.equal(observation.stdout,'');assert.equal(observation.errorCode,'INVALID');
   if(expectMutation){
    assert.equal(observation.anchorRead,true,`${entry.name}: single-boundary mutant did not reach the anchor read`);
    assert.equal(observation.controllerRan,true,`${entry.name}: single-boundary mutant did not reach the controller`);
   }else{
    assert.equal(observation.anchorRead,entry.anchorRead,`${entry.name}: anchor-read stage did not match the EUID boundary`);
    assert.equal(observation.controllerRan,entry.shouldRun,`${entry.name}: controller execution did not match the EUID boundary`);
    if(!entry.shouldRun)assert.deepEqual(snapshot(base),before,`${entry.name}: read-only refusal changed the whole fixture`);
   }
  }
  return observations;
 } catch(error) {failure=error;}
 finally {
  const cleanupFailures=[];
  try {must('sudo',['-n','rm','-rf','--',base]);assert.equal(sudoExists(base),false,'privileged fixture cleanup left the base path present');}catch(error){cleanupFailures.push(error);}
  try {await rm(scratch,{recursive:true,force:true});}catch(error){cleanupFailures.push(error);}
  if(failure&&cleanupFailures.length)throw new AggregateError([failure,...cleanupFailures],'test and cleanup both failed');
  if(cleanupFailures.length)throw new AggregateError(cleanupFailures,'cleanup failed');
 }
 if(failure)throw failure;
}

async function makeSingleBoundaryMutant(installedBin,boundary,scratch){
 const sourceDist=dirname(resolve(installedBin)),mutantDist=join(scratch,`dist-${boundary}`);
 await cp(sourceDist,mutantDist,{recursive:true,preserveTimestamps:true});
 const target=join(mutantDist,'setup','init-cli.js');
 const replacements={
  ancestry:['s.uid === process.geteuid()','s.uid === process.getuid()'],
  capture:['BigInt(process.geteuid())','BigInt(process.getuid())'],
  issuer:['anchor.issuerUid === process.geteuid()','anchor.issuerUid === process.getuid()'],
 };
 const [from,to]=replacements[boundary];let text=await readFile(target,'utf8');
 assert.equal(text.split(from).length-1,1,`${boundary}: compiled boundary pattern count`);
 text=text.replace(from,to);await writeFile(target,text);
 return join(mutantDist,'cli.js');
}

export async function verifyEffectiveUidBoundary(installedBin,onlyCase){
 if(process.platform!=='linux')return {skipped:'linux-only'};
 assert.notEqual(process.getuid?.(),0,'the RUID/EUID regression requires an unprivileged invoking user');
 must('sudo',['-n','true']);must('setpriv',['--version']);must('cc',['--version']);must('tar',['--version']);must('find',['--version']);
 const selected=cases.filter(entry=>!onlyCase||entry.name===onlyCase);
 assert.equal(selected.length,onlyCase?1:4,'unknown case selector');
 const current=await runBoundaryCases(resolve(installedBin),selected);
 const mutationControls=[];
 if(!onlyCase){
  const scratch=await mkdtemp(join(tmpdir(),'workspace-governance-effective-uid-mutants-'));
  try{
   for(const boundary of ['ancestry','capture','issuer']){
    const mutant=await makeSingleBoundaryMutant(installedBin,boundary,scratch);
    const entry=cases.find(candidate=>candidate.name===`${boundary}-negative`);
    mutationControls.push({boundary,observations:await runBoundaryCases(mutant,[entry],true)});
   }
  }finally{await rm(scratch,{recursive:true,force:true});}
 }
 return {ruid:process.getuid(),euid:0,current,mutationControls};
}

if(import.meta.url===`file://${process.argv[1]}`){
 const bin=process.argv[2];assert.ok(bin,'usage: verify-effective-uid.mjs INSTALLED_BIN [CASE]');
 console.log(JSON.stringify(await verifyEffectiveUidBoundary(bin,process.argv[3])));
}
