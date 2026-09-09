"""Installed R1-R3 tracer. Real initial apply and recovery; no fabricated grant."""
import os,pathlib,tempfile,json,subprocess,hashlib,stat,sys
H=pathlib.Path(os.environ['WG_NATIVE_TEST_HARNESS']);N=pathlib.Path(__file__).resolve().parents[1];os.umask(0o077)
D=pathlib.Path(tempfile.mkdtemp(prefix='completed-recovery-',dir=H/'fixtures'));print(D,flush=True)
case=sys.argv[1] if len(sys.argv)>1 else 'create';rows=[]
def snapshot(root):
 out={}
 for p in [root,*sorted(root.rglob('*'))]:
  s=p.lstat();out[str(p.relative_to(root))]=dict(dev=s.st_dev,ino=s.st_ino,mode=s.st_mode,nlink=s.st_nlink,uid=s.st_uid,gid=s.st_gid,sha256=hashlib.sha256(p.read_bytes()).hexdigest() if stat.S_ISREG(s.st_mode) else None,link=str(p.readlink()) if p.is_symlink() else None)
 return out
def run(label,cmd,timeout=350):
 r=subprocess.run(cmd,capture_output=True,text=True,timeout=timeout);row=dict(label=label,argv=cmd,exit=r.returncode,stdout=r.stdout,stderr=r.stderr);rows.append(row);(D/'commands.json').write_text(json.dumps(rows,indent=2));print(label,r.returncode,r.stdout[-1000:],r.stderr[-1000:],flush=True);return r
r=run('create',['python3',str(N/'tests/controller_issuance.py'),'packed-launch-ledger-noop' if case=='noop' else 'packed-launch-ledger']);assert r.returncode==0
F=pathlib.Path(next(x.split()[0] for x in r.stdout.splitlines() if x.startswith(str(H/'fixtures/controller-issuance-'))));plan=json.loads((F/'plan.json').read_bytes());registry=F/'registry';fixture=F/'fixtures/fresh';op=pathlib.Path(plan['context']['stateDir'])/'operations/synthetic-issue'
trials=[p for p in registry.glob('*.json') if len(p.stem)==64];assert len(trials)==1;prior=trials[0].stem;original=json.loads(trials[0].read_bytes());saved=json.loads((op/'result.json').read_bytes())
if case=='removed-input':(fixture/'inputs/request.json').rename(D/'retained-request.json')
if case=='candidate-only':
 for parent in ['events','evidence']:(op/parent/'000006.json').rename(D/(parent+'-retained.json'))
if case=='pending':(op/'.result.json.pending').write_bytes(b'')
if case=='corrupt':(op/'evidence/000003.json').write_bytes(b'{}')
if case=='unsafe':(op/'result.json').chmod(0o644)
if case in ['self-consistent-input-mode','self-consistent-directory-tree']:
 import base64
 raw=lambda v:json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()+b'\n'
 sha=lambda b:hashlib.sha256(b).hexdigest()
 wrap=lambda b:dict(encoding='base64-chunks-v1',byteLength=len(b),sha256=sha(b),chunks=[base64.b64encode(b[i:i+12288]).decode() for i in range(0,len(b),12288)])
 retained=D/'retained';retained.mkdir(mode=0o700);writes=[]
 def write(p,b):
  saved_path=retained/str(len(writes));saved_path.write_bytes(p.read_bytes());writes.append(dict(path=str(p),retained=str(saved_path)));p.write_bytes(b)
 if case=='self-consistent-input-mode':next(r for r in plan['resources'] if r['path']==str(F/'candidate.json'))['filesystem']['mode']='0644'
 else:next(r for r in plan['resources'] if r['path']==str(fixture))['treeDigest']='f'*64
 plan.pop('digest');plan['digest']=sha(raw(plan)[:-1]);pb=raw(plan)
 write(registry/(prior+'.plan.json'),pb);write(op/'proposal.json',pb);write(op/'captures/approved-plan.json',raw(wrap(pb)))
 original['invocation']['approvalDigest']=plan['digest'];original['invocation']['planSha256']=sha(pb);tb=raw(original)
 write(trials[0],tb);write(op/'captures/trial-record.json',raw(wrap(tb)))
 for p in [registry/(prior+'.issued.json'),registry/(prior+'.reserved.json')]:
  v=json.loads(p.read_bytes());v['trialSha256']=sha(tb)
  if 'approvalDigest' in v:v['approvalDigest']=plan['digest']
  write(p,raw(v))
 for p in [*registry.glob('operation-*.json'),*registry.glob('fixture-*.json')]:
  v=json.loads(p.read_bytes());v['approvalDigest']=plan['digest'];write(p,raw(v))
 for p in [op/'owner.json',op/'result.json']:
  v=json.loads(p.read_bytes());v['proposalDigest']=plan['digest'];write(p,raw(v))
 for p in sorted((op/'evidence').glob('*.json')):
  v=json.loads(p.read_bytes());v['proposalDigest']=plan['digest']
  if v['phase']=='complete':v['resource']['after']['sha256']=sha((op/'result.json').read_bytes())
  write(p,raw(v))
 previous=None
 for p in sorted((op/'events').glob('*.json')):
  v=json.loads(p.read_bytes());v['proposalDigest']=plan['digest'];v['evidenceDigest']=sha((op/v['evidenceRef']).read_bytes());v['previousEventDigest']=previous;write(p,raw(v));previous=sha(p.read_bytes())
 (D/'rebinding.json').write_text(json.dumps(writes,indent=2))
before=snapshot(fixture);old_registry=snapshot(registry);(D/'before.json').write_text(json.dumps(dict(fixture=before,registry=old_registry),indent=2))
cmd=[str(F/'controller'),'issue-recovery',str(F/'install'),'--prior-trial-id',prior,'--operation-id','synthetic-issue','--approve',plan['digest'] if case!='wrong-binding' else '0'*64]
r=run('issue',cmd)
if case in ['candidate-only','pending','corrupt','unsafe','wrong-binding','self-consistent-input-mode','self-consistent-directory-tree']:
 assert r.returncode!=0 and snapshot(fixture)==before and snapshot(registry)==old_registry
 (D/'result.json').write_text(json.dumps(dict(case=case,fixture=str(F),refused=True,preserved=True)));sys.exit(0)
assert r.returncode==0,('required issued recovery',r.returncode,r.stdout,r.stderr)
t=json.loads(r.stdout);tid=t['trialId'];assert tid!=prior and t['invocation']==dict(original['invocation'],mode='recover',priorTrialId=prior)
assert (registry/(tid+'.json')).read_bytes()==r.stdout.encode()
assert json.loads((registry/(tid+'.inputs.json')).read_bytes())==dict(candidatePath=str(registry/(prior+'.candidate.json')),intentPath=str(registry/(prior+'.intent.json')),planPath=str(registry/(prior+'.plan.json')))
for suffix in ['candidate','intent','plan']:assert (registry/(tid+'.'+suffix+'.json')).read_bytes()==(registry/(prior+'.'+suffix+'.json')).read_bytes()
assert snapshot(fixture)==before
for k,v in old_registry.items():
 if k!='.':assert snapshot(registry)[k]==v
launch=[str(F/'controller'),'launch',str(F/'install'),tid,'--approve',plan['digest']]
# An issued but unconsumed trial is never predecessor evidence.
if case=='create':
 unconsumed=snapshot(registry);bad=cmd.copy();bad[bad.index('--prior-trial-id')+1]=tid
 q=run('unconsumed-predecessor',bad);assert q.returncode!=0 and snapshot(registry)==unconsumed and snapshot(fixture)==before
if case=='expiry':
 t['lifetime']={'issuedBoottimeNs':'1','deadlineBoottimeNs':'2'}
 raw=lambda v:json.dumps(v,sort_keys=True,separators=(',',':')).encode()+b'\n'
 (registry/(tid+'.json')).write_bytes(raw(t));issued_path=registry/(tid+'.issued.json');issued=json.loads(issued_path.read_bytes());issued['trialSha256']=hashlib.sha256(raw(t)).hexdigest();issued_path.write_bytes(raw(issued))
 old=snapshot(registry);q=run('expired',launch);assert q.returncode!=0 and snapshot(registry)==old and snapshot(fixture)==before
 (D/'result.json').write_text(json.dumps(dict(case=case,fixture=str(F),refused=True,preserved=True)));sys.exit(0)
if case=='pending-at-launch':
 (registry/(prior+'.inputs.json.pending')).write_bytes(b'');old=snapshot(registry);q=run('pending-at-launch',launch);assert q.returncode!=0 and snapshot(registry)==old and snapshot(fixture)==before
 (D/'result.json').write_text(json.dumps(dict(case=case,fixture=str(F),refused=True,preserved=True)));sys.exit(0)
r=run('recognize',launch);assert r.returncode==0 and json.loads(r.stdout)==dict(apiVersion='workspace-governance/init-helper-response-v1',request=2,ok=True,kind='result',body=saved)
assert snapshot(fixture)==before
consumed=snapshot(registry);r=run('consumed-retry',launch);assert r.returncode!=0 and snapshot(registry)==consumed and snapshot(fixture)==before
if case=='create':
 for label,predecessor in [('sibling',prior),('ancestry',tid)]:
  q=cmd.copy();q[q.index('--prior-trial-id')+1]=predecessor
  rr=run(label+'-issue',q);assert rr.returncode==0
  sibling=json.loads(rr.stdout);assert sibling['trialId'] not in [prior,tid]
  q=launch.copy();q[3]=sibling['trialId'];rr=run(label+'-recognize',q)
  assert rr.returncode==0 and json.loads(rr.stdout)['body']==saved and snapshot(fixture)==before
 for k,v in old_registry.items():
  if k!='.':assert snapshot(registry)[k]==v
(D/'result.json').write_text(json.dumps(dict(case=case,fixture=str(F),trialId=tid,originalTrialId=prior,preserved=True,installedGreen=True,after=snapshot(fixture),registry=snapshot(registry)),indent=2))
