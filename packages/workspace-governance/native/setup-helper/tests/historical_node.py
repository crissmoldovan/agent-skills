import os,pathlib,json,hashlib,subprocess,sys,tempfile
os.umask(0o077)
H=pathlib.Path(os.environ['WG_NATIVE_TEST_HARNESS'])
D=pathlib.Path(tempfile.mkdtemp(prefix='historical-node-',dir=H/'fixtures'))
N=pathlib.Path(__file__).resolve().parents[1]
env=dict(os.environ)
def run(label,cmd,timeout):
 r=subprocess.run(cmd,cwd=N,env=env,capture_output=True,text=True,timeout=timeout)
 (D/(label+'.log')).write_text(r.stdout+r.stderr)
 return {'exit':r.returncode}
print(D,flush=True)
import base64,stat,traceback

sha=lambda b:hashlib.sha256(b).hexdigest()
raw=lambda v:json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()+b'\n'
def load(q):return json.loads(q.read_bytes())
def unwrap(q):return b''.join(base64.b64decode(x) for x in load(q)['chunks'])
def wrap(b):return dict(encoding='base64-chunks-v1',byteLength=len(b),sha256=sha(b),chunks=[base64.b64encode(b[i:i+12288]).decode() for i in range(0,len(b),12288)])
def snapshot(root):
 out={}
 for p in [root,*sorted(root.rglob('*'))]:
  s=p.lstat();out[str(p.relative_to(root))]=[s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns,sha(p.read_bytes()) if stat.S_ISREG(s.st_mode) else None]
 return out
rows=[]
cases=[('v24.20.0',True),('v20.20.0',False),('v21.20.0',False),('v22.20.0',False),('v23.20.0',False),('v4294967295.0',True),('v4294967296.0',False),('v+024.any suffix',True),('v24',True),('path-C1',False),('path-unicode',True)]
if len(sys.argv)>1:cases=[cases[int(sys.argv[1])]]
for version,allowed in cases:
 label='historical-node-'+version;cr=run(label+'-create',['python3','tests/controller_issuance.py','packed-launch-ledger'],timeout=300);assert cr['exit']==0
 root=pathlib.Path(next(x.split()[0] for x in (D/(label+'-create.log')).read_text().splitlines() if x.startswith(str(H/'fixtures/controller-issuance-'))))
 e=D/label;e.mkdir(mode=0o700);ret=e/'retained';ret.mkdir(mode=0o700);p=load(root/'plan.json');s=pathlib.Path(p['context']['stateDir']);o=s/'operations/synthetic-issue'
 def write(q,b):
  (ret/(str(len(list(ret.iterdir())))+'-'+str(q.relative_to(root)).replace('/','__'))).write_bytes(q.read_bytes());q.write_bytes(b)
 c=json.loads(unwrap(o/'captures/candidate-manifest.json'))
 if not version.startswith('path-'):c['node']['version']=version
 cb=raw(c)
 a=json.loads(unwrap(o/'captures/trial-anchor.json'));a['candidateManifestSha256']=sha(cb)
 if version.startswith('path-'):
  old=a['controller']['path'];a['controller']['path']+= '\u0085' if version=='path-C1' else 'é'
  next(r for r in p['resources'] if r['path']==old)['path']=a['controller']['path']
  p['resources'].sort(key=lambda r:r['path'].encode())
 ab=raw(a)
 i=json.loads(unwrap(o/'captures/trial-intent.json'));i['candidateManifestSha256']=sha(cb);ib=raw(i)
 for name,b in [('candidate-manifest',cb),('trial-anchor',ab),('trial-intent',ib)]:write(o/('captures/'+name+'.json'),raw(wrap(b)))
 p['executor']['candidateManifestSha256']=sha(cb);p['executor']['intentSha256']=sha(ib)
 for path,h in [(str(root/'candidate.json'),sha(cb)),(str(root/'intent.json'),sha(ib)),(str(root/'install/operator/init-trial-trust-v1.json'),sha(ab))]:next(r for r in p['resources'] if r['path']==path)['sha256']=h
 p.pop('digest');p['digest']=sha(raw(p)[:-1]);pb=raw(p);write(o/'proposal.json',pb);write(o/'captures/approved-plan.json',raw(wrap(pb)))
 t=json.loads(unwrap(o/'captures/trial-record.json'));t['candidateManifestSha256']=sha(cb);t['trustAnchorSha256']=sha(ab);t['invocation']['approvalDigest']=p['digest'];t['invocation']['planSha256']=sha(pb);write(o/'captures/trial-record.json',raw(wrap(raw(t))))
 for name in ['owner.json','result.json']:
  v=load(o/name);v['proposalDigest']=p['digest'];write(o/name,raw(v))
 for q in sorted((o/'evidence').glob('*.json')):
  v=load(q);v['proposalDigest']=p['digest']
  if v['phase']=='complete':v['resource']['after']['sha256']=sha((o/'result.json').read_bytes())
  write(q,raw(v))
 previous=None
 for q in sorted((o/'events').glob('*.json')):
  v=load(q);v['proposalDigest']=p['digest'];v['evidenceDigest']=sha((o/v['evidenceRef']).read_bytes());v['previousEventDigest']=previous;write(q,raw(v));previous=sha(q.read_bytes())
 before={k:snapshot(root/k) for k in ['fixtures','registry']};(e/'before.json').write_text(json.dumps(before,indent=2))
 argv=[str(root/'consumer/node_modules/.bin/workspacectl'),'mutation-status','--state-dir',str(s),'--operation-id','synthetic-issue'];r=subprocess.run(argv,env=env,capture_output=True,text=True,timeout=20)
 after={k:snapshot(root/k) for k in ['fixtures','registry']};(e/'after.json').write_text(json.dumps(after,indent=2))
 actual=json.loads(r.stdout)['state'] if r.returncode==0 else json.loads(r.stderr)['error']['code'];expected='verified' if allowed else 'RECOVERY_REQUIRED'
 row=dict(version=version,root=str(root),argv=argv,exit=r.returncode,stdout=r.stdout,stderr=r.stderr,expected=expected,actual=actual,preserved=before==after,passed=actual==expected and r.returncode==(0 if allowed else 3) and before==after,fullyRebound=True);rows.append(row);(D/'historical-node-index.json').write_text(json.dumps(rows,indent=2));print(json.dumps(row),flush=True)
assert len(rows)==len(cases) and all(r['passed'] for r in rows)
