"""Independent filesystem oracle for installed strict trial initial apply."""
import base64, hashlib, json, os, pathlib, stat, subprocess

def raw(v): return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()+b'\n'
def sha(b): return hashlib.sha256(b).hexdigest()
def load(p):
 b=p.read_bytes();v=json.loads(b);assert b==raw(v),(p,'canonical one-LF record');return v

def decode(v):
 assert set(v)=={'encoding','byteLength','sha256','chunks'} and v['encoding']=='base64-chunks-v1'
 chunks=[base64.b64decode(c,validate=True) for c in v['chunks']]
 assert all(len(c)==12288 for c in chunks[:-1]) and all(base64.b64encode(c).decode()==s for c,s in zip(chunks,v['chunks']))
 b=b''.join(chunks);assert len(b)==v['byteLength'] and sha(b)==v['sha256'];return b

def fact(p):
 s=p.lstat();assert stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_uid==os.geteuid() and stat.S_IMODE(s.st_mode)==0o600
 return dict(identity=dict(dev=str(s.st_dev),ino=str(s.st_ino)),mode='0600',sha256=sha(p.read_bytes()),treeDigest=None)

def verify(D,f,plan,trial,candidate,completed,launch,node,engine):
 manifest=pathlib.Path(plan['context']['manifestPath']);state=pathlib.Path(plan['context']['stateDir']);op=state/'operations/synthetic-issue'
 assert completed.returncode==0 and not completed.stderr,(completed.returncode,completed.stdout,completed.stderr)
 result=load(op/'result.json');assert json.loads(completed.stdout)==dict(apiVersion='workspace-governance/init-helper-response-v1',body=result,kind='result',ok=True,request=2)
 request=json.loads((f/'inputs/request.json').read_bytes())
 expected_manifest=dict(apiVersion='workspace-governance/v1',authorityId=request['authorityId'],nodes=[request['rootNode']],policies=[],workflows=[],metadata={})
 assert manifest.read_bytes()==raw(expected_manifest)
 mf=fact(manifest)
 assert load(state/'state.json')==dict(apiVersion='workspace-governance/setup-state-v1',authorityId=request['authorityId'],rootRegistration=None)
 assert load(op/'proposal.json')==plan and load(op/'context.json')==plan['context']
 exact={'captures/request.json':f/'inputs/request.json','captures/trial-intent.json':D/'intent.json','captures/trial-record.json':D/'registry'/(trial['trialId']+'.json'),'captures/candidate-manifest.json':D/'candidate.json','captures/trial-anchor.json':D/'install/operator/init-trial-trust-v1.json','captures/approved-plan.json':D/'plan.json','payloads/manifest-after.json':manifest,'payloads/state.json':state/'state.json'}
 for relative,source in exact.items(): assert decode(load(op/relative))==source.read_bytes(),relative
 noop=not plan['actions']
 if noop:assert decode(load(op/'captures/manifest-before.json'))==manifest.read_bytes()
 else:assert load(op/'captures/manifest-before.json') is None
 owner=load(op/'owner.json');assert set(owner)=={'operationId','proposalDigest','pid','bootId','processStartTicks','nonce'} and owner['operationId']=='synthetic-issue' and owner['proposalDigest']==plan['digest']
 reservation=json.loads((D/'registry'/(trial['trialId']+'.reserved.json')).read_bytes());assert owner['nonce']==reservation['attemptId'] and owner['bootId']==trial['environment']['bootId']
 phases=['prepared','file-intent','file-published']+([] if noop else ['file-intent','file-published'])+['complete']
 previous=None
 for i,phase in enumerate(phases,1):
  ep=op/f'evidence/{i:06}.json';vp=op/f'events/{i:06}.json';e=load(ep);v=load(vp)
  action=plan['actions'][0]['id'] if not noop and i in [4,5] else None
  assert set(e)=={'apiVersion','operationId','proposalDigest','sequence','actionId','phase','resource','stage','clone','child'}
  assert e['apiVersion']=='workspace-governance/init-trial-setup-evidence-v1' and e['phase']==phase
  assert (e['operationId'],e['proposalDigest'],e['sequence'],e['actionId'])==('synthetic-issue',plan['digest'],i,action)
  assert e['stage'] is None and e['clone'] is None and e['child'] is None
  if i==1: assert e['resource'] is None
  else:
   target=state/'state.json' if i in [2,3] else op/'result.json' if phase=='complete' else manifest
   ref='payloads/state.json' if i in [2,3] else None if phase=='complete' else 'payloads/manifest-after.json'
   assert e['resource']==dict(path=str(target),before=None,after=fact(target) if phase in ['file-published','complete'] else None,payloadRef=ref)
  assert v==dict(apiVersion='workspace-governance/init-trial-journal-event-v1',sequence=i,previousEventDigest=previous,operationId='synthetic-issue',proposalDigest=plan['digest'],actionId=action,event=phase,evidenceDigest=sha(ep.read_bytes()),evidenceRef=f'evidence/{i:06}.json')
  previous=sha(vp.read_bytes())
 assert result==dict(apiVersion='workspace-governance/init-trial-setup-result-v1',operationId='synthetic-issue',proposalDigest=plan['digest'],state='verified',actions=[] if noop else [dict(id=plan['actions'][0]['id'],state='verified',evidenceRef='evidence/000005.json')],manifestRevision=mf['sha256'],checkout=None)
 expected_files={'state.json','operations/synthetic-issue/proposal.json','operations/synthetic-issue/context.json','operations/synthetic-issue/owner.json','operations/synthetic-issue/result.json'}|{'operations/synthetic-issue/'+r for r in exact}|{'operations/synthetic-issue/captures/manifest-before.json'}|{f'operations/synthetic-issue/{d}/{i:06}.json' for d in ['events','evidence'] for i in range(1,len(phases)+1)}
 assert {str(p.relative_to(state)) for p in state.rglob('*') if p.is_file()}==expected_files
 for p in [state,*state.rglob('*')]:
  s=p.lstat();assert s.st_uid==os.geteuid() and stat.S_IMODE(s.st_mode)==(0o700 if p.is_dir() else 0o600)
  if p.is_file():fact(p)
 for lock in plan['bookkeeping']['lockPaths']: assert pathlib.Path(lock).read_bytes()==b'' and fact(pathlib.Path(lock))['mode']=='0600'
 assert set(p.name for p in manifest.parent.iterdir())=={manifest.name,pathlib.Path(next(p for p in plan['bookkeeping']['lockPaths'] if pathlib.Path(p).parent==manifest.parent)).name}
 cmd=[str(node),str(engine/'dist/cli.js'),'validate','--manifest',str(manifest)]
 validation=subprocess.run(cmd,capture_output=True,text=True);assert validation.returncode==0,(validation.stdout,validation.stderr)
 for ref in [candidate['helper'],candidate['launcher'],candidate['capabilities'],candidate['packedCli'],candidate['helperArchive']]:assert sha(pathlib.Path(ref['path']).read_bytes())==ref['sha256']
 members=json.loads((D/'archive-members.json').read_bytes())['members']
 for member in members:
  assert sha((engine/member['path']).read_bytes())==member['sha256']
  assert stat.S_IMODE((engine/member['path']).stat().st_mode)==member['installedMode']
 if (D/'native-archive-members.json').exists():
  for member in json.loads((D/'native-archive-members.json').read_bytes())['members']:
   p=D/'install'/member['path'];assert sha(p.read_bytes())==member['sha256'] and stat.S_IMODE(p.stat().st_mode)==member['mode']
 receipt=dict(argv=launch,exit=completed.returncode,stdout=completed.stdout,stderr=completed.stderr,validator=dict(argv=cmd,exit=validation.returncode,stdout=validation.stdout,stderr=validation.stderr),manifest=mf,result=fact(op/'result.json'),events=len(phases),strictReadback=True,qualification=False)
 with (D/'ledger-readback.json').open('x') as out:json.dump(receipt,out,indent=2)
