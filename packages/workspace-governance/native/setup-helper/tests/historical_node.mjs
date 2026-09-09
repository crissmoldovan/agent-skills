// Invoke with completed fixture, external result path, and scalar-cases.json.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=process.argv[2], out=process.argv[3];
const engine=root+'/consumer/node_modules/@crissmoldovan/workspace-governance';
const {saved,lf,parse,sha}=await import(engine+'/dist/setup/trial-saved.js');
const {canonicalJson,digest}=await import(engine+'/dist/core.js');
const plan=JSON.parse(fs.readFileSync(root+'/plan.json'));
const op=plan.context.stateDir+'/operations/synthetic-issue';
const original=new Map();
for(const d of ['','captures','payloads'])for(const x of fs.readdirSync(op+(d?'/'+d:''))){const p=op+(d?'/'+d:'')+'/'+x;if(fs.lstatSync(p).isFile())original.set((d?d+'/':'')+x,fs.readFileSync(p));}
const unwrap=(f,k)=>Buffer.concat(JSON.parse(f.get('captures/'+k+'.json')).chunks.map(x=>Buffer.from(x,'base64')));
const wrap=b=>({encoding:'base64-chunks-v1',byteLength:b.length,sha256:sha(b),chunks:Array.from({length:Math.ceil(b.length/12288)},(_,i)=>b.subarray(i*12288,(i+1)*12288).toString('base64'))});
const rows=[];
for(const [version,expectedAccepted] of JSON.parse(fs.readFileSync(process.argv[4]))){
 const f=new Map(original),p=JSON.parse(f.get('proposal.json'));
 const c=JSON.parse(unwrap(f,'candidate-manifest'));c.node.version=version;const cb=lf(c);
 const a=JSON.parse(unwrap(f,'trial-anchor'));a.candidateManifestSha256=sha(cb);const ab=lf(a);
 const i=JSON.parse(unwrap(f,'trial-intent'));i.candidateManifestSha256=sha(cb);const ib=lf(i);
 for(const [k,b] of [['candidate-manifest',cb],['trial-anchor',ab],['trial-intent',ib]])f.set('captures/'+k+'.json',lf(wrap(b)));
 p.executor.candidateManifestSha256=sha(cb);p.executor.intentSha256=sha(ib);
 for(const [r,h] of [[root+'/candidate.json',sha(cb)],[root+'/intent.json',sha(ib)],[root+'/install/operator/init-trial-trust-v1.json',sha(ab)]])p.resources.find(x=>x.path===r).sha256=h;
 delete p.digest;p.digest=digest(p);const pb=lf(p);f.set('proposal.json',pb);f.set('captures/approved-plan.json',lf(wrap(pb)));
 const t=JSON.parse(unwrap(f,'trial-record'));t.candidateManifestSha256=sha(cb);t.trustAnchorSha256=sha(ab);t.invocation.planSha256=sha(pb);t.invocation.approvalDigest=p.digest;f.set('captures/trial-record.json',lf(wrap(lf(t))));
 let accepted=false,error=null;try{saved(f,plan.context.stateDir,'synthetic-issue');accepted=true;}catch(e){error=e.code;}
 rows.push({version,accepted,error,expectedAccepted});
}
fs.writeFileSync(out,JSON.stringify(rows,null,2));console.log(JSON.stringify(rows,null,2));
if(rows.some(r=>r.accepted!==r.expectedAccepted))process.exitCode=1;
