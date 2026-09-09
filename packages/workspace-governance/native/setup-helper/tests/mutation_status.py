"""Exact installed observational status, one fresh consumed trial per case.
No resets or cleanup. Corruptions are deliberate post-create test inputs; removed
records are retained outside the mutation fixture rather than destroyed.
"""
import os,sys,pathlib,json,subprocess,hashlib,stat,tempfile
N=pathlib.Path(__file__).resolve().parents[1]
H=pathlib.Path(os.environ['WG_NATIVE_TEST_HARNESS'])
D=pathlib.Path(tempfile.mkdtemp(prefix='status-matrix-',dir=H/'fixtures'));os.umask(0o077)
node=H/'runtime/qualified-node/bin/node'
sha=lambda b:hashlib.sha256(b).hexdigest()
def raw(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()+b'\n'
def snapshot(root):
 out={}
 for p in [root,*sorted(root.rglob('*'))]:
  s=p.lstat();out[str(p.relative_to(root))]=dict(dev=s.st_dev,ino=s.st_ino,mode=s.st_mode,uid=s.st_uid,gid=s.st_gid,nlink=s.st_nlink,size=s.st_size,sha256=sha(p.read_bytes()) if stat.S_ISREG(s.st_mode) else None,link=str(p.readlink()) if p.is_symlink() else None)
 return out
CASES=['create','noop','removed-input','candidate-only','orphan-complete','missing-evidence','gap','bad-event','bad-evidence','bad-owner','bad-state','bad-result','result-inode','manifest-inode','manifest-drift','manifest-mode','result-pending','unknown-member','capture-corrupt','proposal-forged','symlink-result','fifo-result','unsafe-state','absent','bootstrap','parent-inode','self-consistent-policy','self-consistent-resources','unreferenced-next','pending-next','eio-visible']
CASES+=['orphan-result-inode']
selected=sys.argv[1:] or CASES
rows=[]
for case in selected:
 cmd=[sys.executable,str(N/'tests/controller_issuance.py'),'packed-launch-ledger-noop' if case=='noop' else 'packed-launch-ledger-fsync-fail' if case=='eio-visible' else 'packed-launch-ledger']
 r=subprocess.run(cmd,capture_output=True,text=True,timeout=300)
 (D/(case+'-create.log')).write_text(r.stdout+r.stderr)
 assert r.returncode==0,(case,r.returncode,r.stdout,r.stderr)
 root=pathlib.Path(next(x for x in r.stdout.splitlines() if x.startswith(str(H/'fixtures/controller-issuance-'))).split()[0]);plan=json.loads((root/'plan.json').read_bytes())
 f=root/'fixtures/fresh';s=pathlib.Path(plan['context']['stateDir']);o=s/'operations/synthetic-issue';m=pathlib.Path(plan['context']['manifestPath']);saved_result=json.loads((o/'result.json').read_bytes());removed=D/(case+'-retained');removed.mkdir(mode=0o700)
 def move(p):p.rename(removed/p.name)
 def edit(p,fn):
  v=json.loads(p.read_bytes());fn(v);p.write_bytes(raw(v))
 expected='verified';error=None
 if case=='removed-input':move(f/'inputs/request.json')
 elif case=='candidate-only':move(o/'events/000006.json');(removed/'000006.json').rename(removed/'event.json');move(o/'evidence/000006.json');expected='interrupted'
 elif case=='orphan-complete':move(o/'events/000006.json');expected='interrupted'
 elif case=='orphan-result-inode':
  move(o/'events/000006.json');b=(o/'result.json').read_bytes();move(o/'result.json');(o/'result.json').write_bytes(b);expected='needs-attention'
 elif case=='missing-evidence':move(o/'evidence/000003.json');expected='needs-attention'
 elif case=='gap':move(o/'events/000003.json');expected='needs-attention'
 elif case=='bad-event':(o/'events/000003.json').write_bytes(b'{}');expected='needs-attention'
 elif case=='bad-evidence':edit(o/'evidence/000003.json',lambda v:v.update(child={}));expected='needs-attention'
 elif case=='bad-owner':(o/'owner.json').write_bytes(b'{}');expected='needs-attention'
 elif case=='bad-state':(s/'state.json').write_bytes(b'{}');expected='needs-attention'
 elif case=='bad-result':edit(o/'result.json',lambda v:v.update(state='interrupted'));expected='needs-attention'
 elif case in ['result-inode','manifest-inode']:
  p=o/'result.json' if case=='result-inode' else m;b=p.read_bytes();move(p);p.write_bytes(b);expected='needs-attention'
 elif case=='manifest-drift':m.write_bytes(b'foreign');expected='needs-attention'
 elif case=='manifest-mode':m.chmod(0o644);expected='needs-attention'
 elif case=='result-pending':(o/'.result.json.pending').write_bytes(b'');expected='needs-attention'
 elif case=='unknown-member':(o/'foreign').mkdir(mode=0o700);expected='needs-attention'
 elif case=='capture-corrupt':(o/'captures/request.json').write_bytes(b'{}');error='RECOVERY_REQUIRED'
 elif case=='proposal-forged':edit(o/'proposal.json',lambda v:v.update(authorityId='forged'));error='RECOVERY_REQUIRED'
 elif case in ['symlink-result','fifo-result']:
  move(o/'result.json')
  if case=='symlink-result':(o/'result.json').symlink_to(removed/'result.json')
  else:os.mkfifo(o/'result.json',0o600)
  expected='needs-attention'
 elif case=='unsafe-state':s.chmod(0o755);error='RECOVERY_REQUIRED'
 elif case=='absent':operation='unknown-operation';error='UNAVAILABLE'
 elif case=='bootstrap':(s/'operations/bootstrap').mkdir(mode=0o700);operation='bootstrap';error='RECOVERY_REQUIRED'
 elif case=='parent-inode':
  parent=m.parent;move(parent);parent.mkdir(mode=0o700);(removed/'manifest-parent'/m.name).rename(m);expected='needs-attention'
 elif case in ['self-consistent-policy','self-consistent-resources']:
  import base64
  p=json.loads((o/'proposal.json').read_bytes())
  if case=='self-consistent-policy':p['policy']['checks'][0]['allowed']=False
  else:p['resources']=p['resources'][1:]
  p.pop('digest');p['digest']=sha(raw(p)[:-1]);(o/'proposal.json').write_bytes(raw(p))
  def payload(b):return dict(encoding='base64-chunks-v1',byteLength=len(b),sha256=sha(b),chunks=[base64.b64encode(b[i:i+12288]).decode() for i in range(0,len(b),12288)])
  (o/'captures/approved-plan.json').write_bytes(raw(payload(raw(p))))
  error='RECOVERY_REQUIRED'
 elif case in ['unreferenced-next','pending-next']:
  # Retain a valid prepared/state-intent prefix and next state evidence. Remove
  # unperformed finals and later records only in this new corruption fixture.
  for d in ['events','evidence']:
   for p in sorted((o/d).glob('*.json')):
    if int(p.stem)> (2 if d=='events' else 3):p.rename(removed/(d+'-'+p.name))
  move(o/'result.json');move(s/'state.json');move(m)
  if case=='pending-next':(o/'evidence/000003.json').rename(o/'evidence/.000003.json.pending')
  expected='interrupted'
 operation=locals().pop('operation','synthetic-issue') if case in ['absent','bootstrap'] else 'synthetic-issue'
 argv=[str(root/'consumer/node_modules/.bin/workspacectl'),'mutation-status','--state-dir',str(s),'--operation-id',operation]
 before=dict(fixture=snapshot(f),registry=snapshot(root/'registry'))
 status=subprocess.run(argv,env={'PATH':str(node.parent)+':/usr/bin:/bin','HOME':str(D)},capture_output=True,text=True,timeout=20)
 after=dict(fixture=snapshot(f),registry=snapshot(root/'registry'))
 row=dict(case=case,fixture=str(root),argv=argv,exit=status.returncode,stdout=status.stdout,stderr=status.stderr,expected=error or expected,before=before,after=after,preserved=before==after)
 rows.append(row);(D/'index.json').write_text(json.dumps(rows,indent=2));print(case,root,status.returncode,status.stdout.strip(),status.stderr.strip(),flush=True)
 assert before==after,case
 if error:assert status.returncode==(2 if error=='UNAVAILABLE' else 3) and json.loads(status.stderr)['error']['code']==error,(case,row)
 else:
  assert status.returncode==0 and json.loads(status.stdout)['state']==expected,(case,row)
  if expected=='verified':assert json.loads(status.stdout)==saved_result
 # No still-live issuer exists: successful creator/controller already exited.
 assert not any(x.name.endswith('.pending') for x in (root/'registry').iterdir())
assert len(rows)==len(selected) and len({r['case'] for r in rows})==len(selected)
print(D,flush=True)
