// Development controller CLI, NOT workspacectl or a distributable writer.
// The test controller selects fixed resources; command arguments cannot select
// roots, helpers or qualification. No production dispatcher imports this file.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {canonicalJson} from '../../../src/core.ts';
import {deriveInitFileAction} from '../../../src/setup/init-action.ts';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const root = process.env.WG_BOUNDARY_ROOT;
const helper = process.env.WG_BOUNDARY_HELPER;
const candidate = process.env.WG_INIT_CANDIDATE_SHA256;
function capture(name) {
 let fd;
 try { fd=fs.openSync(path.join(root,name),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK); }
 catch(e) {if(e.code==='ENOENT')return null; throw e;}
 try {
  const m=fs.fstatSync(fd,{bigint:true});
  if(!m.isFile()||(m.mode&4095n)!==384n||m.nlink!==1n||m.uid!==BigInt(process.geteuid())||m.size>262144n)throw Error('INVALID');
  const bytes=fs.readFileSync(fd);
  if(bytes.length>262144)throw Error('LIMIT');
  return {bytes,fact:`${m.dev}:${m.ino}:${m.mode&4095n}:${m.uid}:${m.size}:${hash(bytes)}`};
 } finally {fs.closeSync(fd);}
}
function plan() {
 if(!root||path.dirname(root)!==process.env.WG_NATIVE_TEST_ROOT||!path.basename(root).startsWith('init-boundary-')||!helper||!candidate||hash(fs.readFileSync(helper))!==candidate)throw Error('INVALID_CONTROLLER');
 const m=fs.lstatSync(root,{bigint:true});
 if(!m.isDirectory()||(m.mode&4095n)!==448n||m.uid!==BigInt(process.geteuid()))throw Error('INVALID');
 const request=capture('request.json'); if(!request)throw Error('INVALID');
 const manifest=capture('manifest.json');
 return canonicalJson({apiVersion:'workspace-governance/development-init-plan-v1',candidateSha256:candidate,
  context:{manifestFact:manifest?.fact??null,requestFact:request.fact,rootFact:`${m.dev}:${m.ino}:${m.mode&4095n}:${m.uid}`,rootPathBase64:Buffer.from(root).toString('base64')},
  action:deriveInitFileAction(request.bytes,path.join(root,'manifest.json'),manifest?.bytes??null)})+'\n';
}
async function invoke(command,proposal,approval) {
 const child=spawn(helper,['--exact','development_helper_entry','--nocapture'],{cwd:'/',env:process.env,stdio:['ignore','ignore','pipe','pipe']});
 let stderr=''; child.stderr.on('data',b=>{if(stderr.length<8192)stderr+=b;});
 const socket=child.stdio[3]; const input=Buffer.from(`${command}\n${approval}\n${proposal}`);
 if(input.length>2097152){child.kill();throw Error('LIMIT');}
 const header=Buffer.alloc(4);header.writeUInt32BE(input.length);
 const chunks=[];let size=0;
 socket.on('data',b=>{size+=b.length;if(size>2097156)child.kill();else chunks.push(b);});
 const status=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code,signal)=>resolve({code,signal}));socket.on('error',reject);});
 const timer=setTimeout(()=>child.kill('SIGKILL'),7000);
 socket.end(Buffer.concat([header,input]));
 try {
  const {code,signal}=await status; const data=Buffer.concat(chunks);
  if(code!==0||signal||data.length<4||data.readUInt32BE()!==data.length-4)throw Error(`NATIVE_REFUSAL ${stderr}`);
  const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data.subarray(4)));
  if(result.error)throw Error(result.error);
  process.stdout.write(JSON.stringify(result)+'\n');
 } finally {clearTimeout(timer);}
}
try {
 const [command,...args]=process.argv.slice(2);
 if(command==='plan'&&args.length===0)process.stdout.write(plan());
 else if((command==='verify'&&args.length===1)||(command==='apply'&&args.length===2)) {
  const current=plan(); const [proposal,approval='-']=args;
  if(current!==proposal)throw Error('STALE_PLAN');
  if(command==='apply'&&hash(proposal)!==approval)throw Error('APPROVAL_MISMATCH');
  await invoke(command,proposal,approval);
 } else throw Error('INVALID_COMMAND');
} catch(e) {process.stderr.write(`${e.message}\n`);process.exitCode=1;}
