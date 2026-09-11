import os, pathlib, subprocess, sys, json, tempfile, hashlib, tarfile, ctypes, platform, shutil
H=pathlib.Path(os.environ['WG_NATIVE_TEST_HARNESS']); N=pathlib.Path(__file__).resolve().parents[1]; R=N.parents[3]
os.umask(0o077)
case=sys.argv[1] if len(sys.argv)>1 else 'normal'
namespace_case=case if case.startswith('packed-namespace-') else None
manifest_basename='manifest.json';state_basename='state'
if namespace_case:
 if namespace_case in ['packed-namespace-collision','packed-namespace-collision-noop']:manifest_basename='.workspacectl-init-synthetic-issue.pending'
 elif namespace_case=='packed-namespace-nearby':manifest_basename='.workspacectl-init-synthetic-issue.pending.safe'
 elif namespace_case=='packed-namespace-state-pending':state_basename='.workspacectl-init-synthetic-issue.pending'
 elif namespace_case=='packed-namespace-bookkeeping-name':manifest_basename='.state.json.pending'
 else:raise AssertionError('unknown namespace case')
 case='packed-launch-ledger-noop' if namespace_case.endswith('-noop') else 'packed-launch-ledger'
b=pathlib.Path(os.environ['WG_TRIAL_CONTROLLER_BIN'])
assert b.is_file(), 'missing actual native issuing controller executable'
def raw(x): return json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def sha(x): return hashlib.sha256(x).hexdigest()
def artifact(p): return dict(path=str(p),sha256=sha(p.read_bytes()))
def put(p,x):
 with p.open('xb') as f: f.write(x if isinstance(x,bytes) else raw(x)); f.flush(); os.fsync(f.fileno())
def mid(p):
 fd=os.open(p,os.O_PATH|os.O_NOFOLLOW)
 try: return next(l.split()[1] for l in pathlib.Path(f'/proc/self/fdinfo/{fd}').read_text().splitlines() if l.startswith('mnt_id:'))
 finally: os.close(fd)
def di(p):
 s=p.lstat();return dict(path=str(p),dev=str(s.st_dev),ino=str(s.st_ino),mountId=mid(p),uid=s.st_uid,mode=f'{s.st_mode&0o7777:04o}')
def resource(p):
 if not p.exists():return dict(path=str(p),kind='absent',identity=None,sha256=None,treeDigest=None,filesystem=None)
 s=p.lstat();return dict(path=str(p),kind='directory' if p.is_dir() else 'file',identity=dict(dev=str(s.st_dev),ino=str(s.st_ino)),sha256=None if p.is_dir() else sha(p.read_bytes()),treeDigest=None,filesystem=dict(uid=str(s.st_uid),gid=str(s.st_gid),mode=f'{s.st_mode&0o7777:04o}',nlink=str(s.st_nlink),mountId=mid(p)))
def snapshot(p):
 out={}
 for x in [p,*p.rglob('*')]:
  s=x.lstat();out[str(x.relative_to(p))]=(s.st_dev,s.st_ino,s.st_mode,s.st_nlink,sha(x.read_bytes()) if x.is_file() else str(x.readlink()) if x.is_symlink() else None)
 return out
D=pathlib.Path(tempfile.mkdtemp(prefix='controller-issuance-',dir=H/'fixtures'))
for s in ['install','install/operator','install/bin','install/lib','install/share','registry','fixtures','fixtures/fresh','fixtures/fresh/manifest-parent','fixtures/fresh/state-parent','fixtures/fresh/inputs','evidence','candidate','candidate/engine']: (D/s).mkdir(mode=0o700)
controller=D/'controller';put(controller,b.read_bytes());controller.chmod(0o700)
def setup_native_member(member,fallback):
 if os.environ.get('WG_TRIAL_NATIVE_ARCHIVE'):
  with tarfile.open(os.environ['WG_TRIAL_NATIVE_ARCHIVE']) as archive:return archive.extractfile(member).read()
 return fallback.read_bytes()
helper=D/'install/bin/workspacectl-init-helper';put(helper,setup_native_member('bin/workspacectl-init-helper',H/'build/target/release/workspacectl-init-helper'));helper.chmod(0o700)
if case=='candidate-non-native-helper':helper.write_bytes(b'#!/bin/sh\nexit 99\n')
# This is a real, deliberately fail-closed synthetic N-API candidate, NOT a qualified launcher.
source=D/'candidate/launcher.c';put(source,b'#include <node_api.h>\nnapi_value napi_register_module_v1(napi_env e,napi_value exports){napi_throw_error(e,"UNSUPPORTED","synthetic candidate: authority launch not implemented");return exports;}\n')
launcher=D/'install/lib/init-launcher.node'
cc=subprocess.run(['/usr/bin/cc','-shared','-fPIC','-I'+str(H/'runtime/qualified-node/include/node'),str(source),'-o',str(launcher)],capture_output=True,text=True);assert cc.returncode==0,cc.stderr
if case.startswith('packed-launch'):
 launcher.write_bytes(setup_native_member('lib/init-launcher.node',H/'build/target/release/libworkspace_governance_setup_native.so'))
launcher.chmod(0o600)
node=H/'runtime/qualified-node/bin/node'
probe=subprocess.run([str(node),'-e','try{require(process.argv[1]);process.exit(1)}catch(e){if(e.code!=="UNSUPPORTED")throw e;console.log(e.code)}',str(launcher)],capture_output=True,text=True);assert probe.returncode==0,probe.stderr
put(D/'candidate/engine/package.json',dict(name='synthetic-controller-candidate',version='0.1.0'))
put(D/'candidate/engine/cli.js',b'throw new Error("synthetic candidate: no apply");\n')
for dest,items in [('helper.tar',[(helper,'bin/workspacectl-init-helper'),(launcher,'lib/init-launcher.node')]),('cli.tar',[(D/'candidate/engine/package.json','package/package.json'),(D/'candidate/engine/cli.js','package/cli.js')]),('source.tar',[(source,'launcher.c')])]:
 with tarfile.open(D/'candidate'/dest,'x') as t:
  for p,name in items:t.add(p,arcname=name)
if case.startswith('packed-'):
 archive=pathlib.Path(os.environ['WG_PACKED_CLI'])
 # Install the exact npm archive offline, without lifecycle scripts or symlinks in engine.
 (D/'consumer').mkdir(mode=0o700)
 installed=subprocess.run([str(node),str(H/'runtime/qualified-node/lib/node_modules/npm/bin/npm-cli.js'),'install','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',str(D/'consumer'),str(archive)],capture_output=True,text=True)
 assert installed.returncode==0,installed.stderr
 engine=D/'consumer/node_modules/@crissmoldovan/workspace-governance'
 # CLI archive itself is the candidate binding, not a repack.
 (D/'candidate/cli.tar').write_bytes(archive.read_bytes())
 members=[]
 with tarfile.open(archive) as t:
  for m in t.getmembers():
   if not m.isfile():continue
   rel=pathlib.PurePosixPath(m.name).relative_to('package');content=t.extractfile(m).read()
   assert (engine/rel).read_bytes()==content
   assert (D/'consumer/node_modules/@crissmoldovan/workspace-governance'/rel).read_bytes()==content
   members.append(dict(path=str(rel),sha256=sha(content),archiveMode=m.mode,installedMode=(engine/rel).stat().st_mode&0o7777))
 put(D/'archive-members.json',dict(archive=artifact(archive),members=members))
put(D/'candidate/build.json',dict(classification='synthetic-pending-controller-test',argv=cc.args,exit=cc.returncode,launcherLoad=probe.stdout.strip()))
caps=dict(apiVersion='workspace-governance/init-helper-capabilities-v1',abi='linux-init-helper-v1',release='0.1.0',target='linux-x86_64-glibc236',helperSha256=sha(helper.read_bytes()),operations=['capabilities','begin','cancel'],kinds=['manifest-init'],maxFrameBytes=2097152,filesystemProfile='local-durable-v1',profileId='manifest-init-only-v1',authKinds=[])
if case=='caps-extra':caps['forged']=True
put(D/'install/share/init-helper-capabilities.json',caps)
if os.environ.get('WG_TRIAL_NATIVE_ARCHIVE'):
 archive=pathlib.Path(os.environ['WG_TRIAL_NATIVE_ARCHIVE']);native_members=[]
 with tarfile.open(archive) as tar:
  for member in tar.getmembers():
   rel=pathlib.PurePosixPath(member.name)
   assert member.isfile() and not rel.is_absolute() and '..' not in rel.parts
   dest=D/'install'/rel;dest.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
   contents=tar.extractfile(member).read()
   if dest.exists():dest.write_bytes(contents)
   else:put(dest,contents)
   dest.chmod(member.mode)
   assert dest.read_bytes()==contents
   native_members.append(dict(path=member.name,sha256=sha(contents),mode=member.mode))
 (D/'candidate/helper.tar').write_bytes(archive.read_bytes())
 (D/'candidate/source.tar').write_bytes(pathlib.Path(os.environ['WG_TRIAL_NATIVE_SOURCE']).read_bytes())
 (D/'candidate/build.json').write_bytes(pathlib.Path(os.environ['WG_TRIAL_NATIVE_BUILD']).read_bytes())
 assert json.loads((D/'install/share/init-helper-capabilities.json').read_bytes())==caps
 put(D/'native-archive-members.json',dict(archive=artifact(archive),members=native_members,qualification=False))
engine=D/'consumer/node_modules/@crissmoldovan/workspace-governance' if case.startswith('packed-') else D/'candidate/engine'
entries=[dict(path=str(p.relative_to(engine)),kind='directory') if p.is_dir() else dict(path=str(p.relative_to(engine)),kind='file',sha256=sha(p.read_bytes())) for p in sorted(engine.rglob('*'),key=lambda p:str(p).encode())]
candidate=dict(apiVersion='workspace-governance/init-candidate-manifest-v1',classification='development-candidate/pending',release='0.1.0',abi='linux-init-helper-v1',target='linux-x86_64-glibc236',helperArchive=artifact(D/'candidate/helper.tar'),packedCli=artifact(D/'candidate/cli.tar'),provenance=dict(source=artifact(D/'candidate/source.tar'),build=artifact(D/'candidate/build.json')),engine=dict(path=str(engine),treeSha256=sha(raw(entries)),version='0.1.0'),helper=dict(**artifact(helper),abi='linux-init-helper-v1'),launcher=artifact(launcher),node=dict(**artifact(node),version=subprocess.check_output([str(node),'--version'],text=True).strip()),capabilities=artifact(D/'install/share/init-helper-capabilities.json'),runtimeFiles=[artifact(launcher)])
if case=='candidate-extra':candidate['forged']=True
if case=='candidate-abi':candidate['abi']='linux-setup-helper-v2'
if case=='candidate-runtime-empty':candidate['runtimeFiles']=[]
if case=='candidate-runtime-order':candidate['runtimeFiles']=[artifact(launcher),artifact(helper)]
if case=='candidate-tree':candidate['engine']['treeSha256']='0'*64
if case=='candidate-node-version':candidate['node']['version']='v1.0.0'
if case=='candidate-provenance':candidate['provenance']['passed']=True
put(D/'candidate.json',candidate)
shared=pathlib.Path(os.environ['WG_DISPATCH_SHARED_FIXTURE']) if case=='packed-launch-dispatch-peer' else None
trust=dict(apiVersion='workspace-governance/init-trial-trust-v1',issuerUid=os.geteuid(),controller=artifact(controller),registryRoot=di(D/'registry'),fixtureParent=di(shared.parent if shared else D/'fixtures'),candidateManifestSha256=sha(raw(candidate)))
put(D/'install/operator/init-trial-trust-v1.json',trust)
f=shared or D/'fixtures/fresh'; request=dict(apiVersion='workspace-governance/init-request-v1',authorityId='example-authority',rootNode=dict(id='example-org',kind='organization',slug='example',parentId=None,visibility=dict(mode='restricted',readers=['example-reader'])))
if not shared:put(f/'inputs/request.json',request)
fixture=dict(root=di(f),manifestParent=di(f/'manifest-parent'),manifestBasename=manifest_basename,stateParent=di(f/'state-parent'),stateBasename=state_basename,request=resource(f/'inputs/request.json'),evidenceRoot=di(D/'evidence'))
mi=pathlib.Path('/proc/self/mountinfo').read_bytes(); line=next(l for l in mi.decode().splitlines() if l.split()[0]==di(D)['mountId']);left,right=line.split(' - ');l=left.split();r=right.split();libc=ctypes.CDLL(None);libc.gnu_get_libc_version.restype=ctypes.c_char_p
environment=dict(bootId=pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip(),kernelRelease=platform.release(),glibcVersion=libc.gnu_get_libc_version().decode(),mountNamespaceIno=str(pathlib.Path('/proc/self/ns/mnt').stat().st_ino),mountinfoSha256=sha(mi),mounts=[dict(mountId=l[0],dev=str(D.stat().st_dev),filesystem=r[0],optionsSha256=sha((l[5]+'\n'+r[2]).encode()))])
intent=dict(apiVersion='workspace-governance/init-trial-intent-v1',candidateManifestSha256=sha(raw(candidate)),environment=environment,fixture=fixture,limits=dict(maxBegins=1,maxActions=1,maxStageContainers=0))
if case=='intent-extra':intent['qualification']={'passed':True}
if case=='intent-limits':intent['limits']['maxBegins']=2
if case=='intent-namespace':intent['environment']['mountNamespaceIno']='0'
if case=='intent-fixture':intent['fixture']['root']=di(D/'registry')
put(D/'intent.json',intent)
# Full-plan approval input. Unchanged real Node derivation is the independent pure oracle.
oracle='import {deriveInitPreview} from "'+str(R/'packages/workspace-governance/src/setup/init-preview.ts')+'";import fs from "node:fs";console.log(JSON.stringify(deriveInitPreview(fs.readFileSync(process.argv[1]),process.argv[2],process.argv[3],process.argv[4],null)));'
target=str(f/'manifest-parent'/manifest_basename);state=str(f/'state-parent'/state_basename)
p=subprocess.run([str(node),'--input-type=module','-e',oracle,str(f/'inputs/request.json'),target,state,sha(helper.read_bytes())],capture_output=True,text=True);assert p.returncode==0,p.stderr
preview=json.loads(p.stdout)
if case=='packed-launch-ledger-noop':
 import base64
 put(pathlib.Path(target),b''.join(base64.b64decode(c) for c in preview['action']['payload']['chunks']))
 preview['action']=None
context=dict(apiVersion='workspace-governance/init-trial-setup-context-v1',kind='manifest-init',manifestPath=target,stateDir=state,root=None,nodeId=None,principal=None,requestPath=str(f/'inputs/request.json'),executorProfilePath=str(D/'candidate.json'))
binding=dict(apiVersion='workspace-governance/init-trial-executor-binding-v1',profileId='manifest-init-only-trial-v1',intentSha256=sha(raw(intent)),candidateManifestSha256=sha(raw(candidate)),helper=candidate['helper'],platform=dict(os='linux',arch='x64',filesystemProfile='local-durable-v1'))
plan=dict(apiVersion='workspace-governance/init-trial-setup-plan-v1',executable=False,kind='manifest-init',context=context,authorityId=request['authorityId'],manifestRevision=None,requestDigest=sha(raw(request)),executor=binding,policy=preview['policy'],resources=[fixture['request']],bookkeeping=dict(stateParent=str(f/'state-parent'),stateDir=state,rootRegistration=None,lockPaths=sorted([str(pathlib.Path(x).parent/('.workspacectl-lock-'+sha(x.encode()))) for x in [target,state]]),operationNamespace='operations/',maxActions=64,maxStageContainers=1,maxStageBytes=1073741824),actions=[preview['action']],effects=dict(repositoryId=None,target=None,outcome='manifest-created',refReview=None))
if case=='packed-launch-ledger-noop':
 plan['actions']=[];plan['manifestRevision']=sha(pathlib.Path(target).read_bytes());plan['effects']['outcome']='already-initialized'
refs=[candidate[k] for k in ['helperArchive','packedCli','helper','launcher','node','capabilities']]+[x for x in candidate['provenance'].values() if isinstance(x,dict)]+candidate['runtimeFiles']
paths={pathlib.Path(x['path']) for x in refs}|{p for p in engine.rglob('*') if p.is_file()}|{engine,D/'candidate.json',D/'intent.json',controller,D/'registry',shared.parent if shared else D/'fixtures',D/'install',pathlib.Path(target),pathlib.Path(state),f/'inputs/request.json'}|{D/'install'/s for s in ['operator','operator/init-trial-trust-v1.json','bin','lib','share']}|{pathlib.Path(fixture[k]['path']) for k in ['root','manifestParent','stateParent','evidenceRoot']}
plan['resources']=[resource(p) for p in sorted(paths,key=lambda p:str(p).encode())]
next(r for r in plan['resources'] if r['path']==str(engine))['treeDigest']=candidate['engine']['treeSha256']
if case=='plan-policy':plan['policy']['checks'][0]['allowed']=False
if case=='plan-context':plan['context']['manifestPath']=str(D/'forged-target.json')
if case=='plan-bookkeeping':plan['bookkeeping']['lockPaths']=[]
if case=='plan-effect':plan['effects']['outcome']='already-initialized'
if case=='plan-action':plan['actions'][0]['afterSha256']='0'*64
if case=='plan-resource':plan['resources'][0]['filesystem']['uid']='0'
plan['digest']=sha(raw(plan))
if case=='native-plan' or case.startswith('packed-'):
 command=[str(controller),'plan',str(D/'install'),str(D/'candidate.json'),str(D/'intent.json')]
 if case.startswith('packed-'):
  command=[str(node),str(D/'consumer/node_modules/.bin/workspacectl'),'manifest-init-trial-plan','--install-root',str(D/'install'),'--candidate',str(D/'candidate.json'),'--intent',str(D/'intent.json')]
 if case=='packed-occupied':put(pathlib.Path(target),b'foreign occupied manifest')
 if case=='packed-stale':(f/'inputs/request.json').write_bytes(raw(dict(request,authorityId='changed-authority')))
 before=snapshot(D)
 planned=subprocess.run(command,capture_output=True,text=True)
 if case in ['packed-occupied','packed-stale']:
  assert planned.returncode!=0 and snapshot(D)==before,'invalid planning must refuse without any effect'
  put(D/'planning-refusal.json',dict(case=case,argv=command,exit=planned.returncode,stderr=planned.stderr,preserved=True))
  print(D,'planning refusal preserved');sys.exit(0)
 assert planned.returncode==0,('missing read-only full native planner',planned.stderr)
 assert json.loads(planned.stdout)==plan,'native capture/derivation must equal complete independent oracle'
 assert snapshot(D)==before,'planning must not create locks or registry/fixture effects'
 put(D/'planning-receipt.json',dict(argv=command,exit=planned.returncode,stdoutSha256=sha(planned.stdout.encode()),stderr=planned.stderr,readOnly=True,oracleEqual=True))
 plan=json.loads(planned.stdout)
 if case=='packed-forged':
  plan['policy']['checks'][0]['allowed']=False
  plan.pop('digest');plan['digest']=sha(raw(plan))
put(D/'plan.json',planned.stdout.encode() if (case=='native-plan' or case.startswith('packed-')) and case!='packed-forged' else plan)
if case in ['packed-issue-stale','packed-issue-occupied']:
 if case=='packed-issue-stale':(f/'inputs/request.json').write_bytes(raw(dict(request,authorityId='changed-authority')))
 else:put(pathlib.Path(target),b'foreign occupied after planning')
if case=='plan-duplicate':(D/'plan.json').write_bytes(raw(plan).replace(b'{',b'{"digest":"'+plan['digest'].encode()+b'",',1))
receipt=dict(root=str(D),classification='synthetic-pending-candidate-controller-only',launcherProbe=dict(exit=probe.returncode,stdout=probe.stdout),records=[])
print(D,flush=True)
argv=[str(controller),'issue',str(D/'install'),str(D/'candidate.json'),str(D/'intent.json'),str(D/'plan.json'),'--approve',plan['digest'],'--operation-id','synthetic-issue']
if case=='missing-approval':argv[7]='0'*64
before_issue=snapshot(D)
if case=='under-lock-stale':
 import importlib.util
 spec=importlib.util.spec_from_file_location('controller_crash',str(N/'tests/support/controller_crash.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 trace_dir=pathlib.Path(tempfile.mkdtemp(prefix='controller-stale-observer-',dir=H/'evidence'));seen=[]
 def replace_target():
  put(pathlib.Path(target),b'foreign target changed after preflight');seen.append(snapshot(D))
 status,changed=module.change_at_registry_lock(argv,replace_target,trace_dir)
 assert changed and status==3 and snapshot(D)==seen[0],'under-registry-lock target recapture must refuse stale plan without issuance'
 print('actual ptrace-observed under-lock stale target refused unchanged');sys.exit(0)
p=subprocess.run(argv,capture_output=True,text=True)
if case in ['caps-extra','packed-forged','packed-issue-stale','packed-issue-occupied'] or case.startswith(('candidate-','intent-','plan-')) or case=='missing-approval':
 assert p.returncode!=0 and snapshot(D)==before_issue,('malformed input must refuse before issuing',case,p.stdout,p.stderr)
 put(D/'test-receipt.json',dict(case=case,exit=p.returncode,stderr=p.stderr,preserved=True,beforeSha256=sha(raw(before_issue))))
 print('malformed binding refusal preserved fixture',case);sys.exit(0)
receipt['records'].append(dict(argv=argv,exit=p.returncode,stdout=p.stdout,stderr=p.stderr))
put(D/'test-receipt.json',receipt)
assert p.returncode==0,('native issuance missing',p.returncode,p.stdout,p.stderr)
trial=json.loads(p.stdout);assert len(trial['trialId'])==64
record=D/'registry'/(trial['trialId']+'.json');assert json.loads(record.read_bytes())['invocation']['approvalDigest']==plan['digest']
print('actual immutable native trial issued',trial['trialId'])
reserve=[str(controller),'reserve',str(D/'install'),trial['trialId'],'--approve',plan['digest']]
reserved=D/'registry'/(trial['trialId']+'.reserved.json')
if case.startswith('packed-launch'):
 launch=[str(controller),'launch',str(D/'install'),trial['trialId'],'--approve',plan['digest']]
 if case in ['packed-launch-ledger','packed-launch-ledger-noop']:
  manifest_before=resource(pathlib.Path(target))
  before_launch=snapshot(D)
  completed=subprocess.run(launch,capture_output=True,text=True)
  if namespace_case in ['packed-namespace-collision','packed-namespace-collision-noop']:
   after_launch=snapshot(D)
   before_fixture={k:v for k,v in before_launch.items() if k=='fixtures' or k.startswith('fixtures/')}
   after_fixture={k:v for k,v in after_launch.items() if k=='fixtures' or k.startswith('fixtures/')}
   registry_before={k:v for k,v in before_launch.items() if k=='registry' or k.startswith('registry/')}
   registry_after={k:v for k,v in after_launch.items() if k=='registry' or k.startswith('registry/')}
   observed=dict(case=namespace_case,argv=launch,exit=completed.returncode,stdout=completed.stdout,stderr=completed.stderr,approvalDigest=plan['digest'],trialId=trial['trialId'],before=before_fixture,after=after_fixture,registryBefore=registry_before,registryAfter=registry_after)
   put(D/'namespace-readback.json',observed)
   assert completed.returncode==3 and json.loads(completed.stdout)['kind']=='error',observed
   assert before_fixture==after_fixture,'namespace overlap was not rejected before transaction effects/locks'
   assert reserved.is_file() and set(registry_after)-set(registry_before)=={'registry/'+reserved.name},'consumption must be accounted separately'
   assert all(registry_after[k]==v for k,v in registry_before.items()),'immutable registry input changed'
   assert not pathlib.Path(state).exists()
   for record_name,root in [('archive-members.json',engine),('native-archive-members.json',D/'install')]:
    for member in json.loads((D/record_name).read_bytes())['members']:
     member_path=root/member['path'];assert sha(member_path.read_bytes())==member['sha256']
     assert member_path.stat().st_mode&0o7777==member.get('installedMode',member.get('mode'))
   before_retry=snapshot(D);again=subprocess.run(launch,capture_output=True,text=True)
   assert again.returncode==3 and snapshot(D)==before_retry,'consumed collision retry must refuse unchanged'
   print('namespace refusal preserves whole mutation fixture; registry consumption separately verified');sys.exit(0)
  assert pathlib.Path(target).is_file(),('installed strict transaction did not create manifest',completed.returncode,completed.stdout,completed.stderr)
  sys.path.insert(0,str(N/'tests/support'));import trial_ledger
  trial_ledger.verify(D,f,plan,trial,candidate,completed,launch,node,engine)
  if case.endswith('-noop'):assert resource(pathlib.Path(target))==manifest_before,'noop must preserve exact manifest identity and bytes'
  before=snapshot(D);again=subprocess.run(launch,capture_output=True,text=True)
  assert again.returncode==3 and snapshot(D)==before,'consumed retry must preserve completed operation'
  print('actual installed strict manifest and independent complete-chain readback passed');sys.exit(0)
 if case in ['packed-launch-ledger-occupied-at-rename','packed-launch-ledger-fsync-fail','packed-launch-ledger-observe']:
  sys.path.insert(0,str(N/'tests/support'));import trial_dispatch,trial_ledger
  mode='ledger-occupied' if case.endswith('-rename') else 'ledger-fsync-fail' if case.endswith('-fail') else 'ledger-observe'
  traces=pathlib.Path(tempfile.mkdtemp(prefix=mode+'-',dir=H/'evidence'));seen=[]
  def boundary(kind):
   if seen:return False
   if mode=='ledger-occupied':
    if kind!='rename' or not (pathlib.Path(target).parent/'.workspacectl-init-synthetic-issue.pending').exists():return False
    put(pathlib.Path(target),b'foreign object injected at real manifest renameat2')
   elif kind!='fsync' or not (pathlib.Path(state)/'operations/synthetic-issue/events/000006.json').exists():return False
   seen.append(snapshot(D));return True
  observed=trial_dispatch.observe(launch,node,helper,plan['bookkeeping']['lockPaths'],mode,boundary,traces)
  assert observed['changed'] and len(seen)==1,observed
  frames=[e['frame'] for e in observed['events'] if e.get('role')=='helper']
  if mode=='ledger-observe':
   assert observed['exit']==0 and any(v.get('kind')=='result' for v in frames)
   selected=next(i for i,e in enumerate(observed['events']) if e.get('boundary')=='fsync' and e.get('selected'))
   barrier=next(i for i,e in enumerate(observed['events'][selected+1:],selected+1) if e.get('boundary')=='syscall-return' and e.get('syscall')==74 and e.get('result')==0)
   reply=next(i for i,e in enumerate(observed['events']) if e.get('role')=='helper' and e.get('frame',{}).get('kind')=='result')
   assert selected<barrier<reply,'actual successful complete fsync must precede begin result'
   trial_ledger.verify(D,f,plan,trial,candidate,subprocess.CompletedProcess(launch,0,(traces/'stdout').read_text(),(traces/'stderr').read_text()),launch,node,engine)
  else:
   assert observed['exit']==3 and not any(v.get('kind')=='result' for v in frames)
   assert snapshot(D)==seen[0],'publication failure must preserve complete post-injection fixture'
   if mode=='ledger-fsync-fail':assert any(e.get('boundary')=='fsync-return' and e['result']==-5 for e in observed['events'])
  put(D/'ledger-fault-receipt.json',dict(case=case,trace=str(traces),observed=observed,preserved=mode!='ledger-observe'));print('actual strict ledger publication boundary passed',mode);sys.exit(0)
 if case.startswith('packed-launch-race-'):
  sys.path.insert(0,str(N/'tests/support'));import trial_launch
  traces=pathlib.Path(tempfile.mkdtemp(prefix='trial-launch-race-',dir=H/'evidence'));seen=[]
  def mutate():
   if case.endswith('occupied'):put(pathlib.Path(target),b'foreign target at Node exec')
   elif case.endswith('stale'):(f/'inputs/request.json').write_bytes(raw(dict(request,authorityId='changed-at-node-exec')))
   elif case.endswith('forged'):reserved.write_bytes(b'{}')
   elif case.endswith('identity'):
    temp=reserved.with_suffix('.replacement');put(temp,reserved.read_bytes());temp.replace(reserved)
   elif case.endswith('pending'):put(pathlib.Path(str(reserved)+'.pending'),b'')
   else:raise AssertionError(case)
   seen.append(snapshot(D))
  observed=trial_launch.observe(launch,node,helper,mutate,traces)
  assert observed['changed'] and observed['exit']==3 and 'TRIAL_ADMITTED' not in (traces/'stdout').read_text(),('startup race must refuse',observed)
  assert snapshot(D)==seen[0] and not pathlib.Path(state).exists(),'refusal must preserve entire injected fixture'
  put(D/'launch-refusal-receipt.json',dict(case=case,trace=str(traces),preserved=True));print('actual exec-boundary refusal preserved',case);sys.exit(0)
 if case=='packed-launch-orphan':
  sys.path.insert(0,str(N/'tests/support'));import trial_launch
  traces=pathlib.Path(tempfile.mkdtemp(prefix='trial-launch-observer-',dir=H/'evidence'))
  observed=trial_launch.observe(launch,node,helper,lambda:None,traces,kill_node=True)
  assert observed['helper'] and observed['adopted']==observed['controller'],('controller must own/reap orphan helper before releasing registry lock',observed)
  assert observed['exit']==3 and 'TRIAL_ADMITTED' not in (traces/'stdout').read_text()
  assert reserved.is_file() and not pathlib.Path(target).exists() and not pathlib.Path(state).exists()
  put(D/'launch-orphan-receipt.json',observed);print('actual Node death: helper adopted/reaped by locked controller');sys.exit(0)
 if case=='packed-launch':
  before=snapshot(D)
  # A real fixed anchor/issued record still does not grant an ordinary Node process authority.
  direct=subprocess.run([str(node),'--require',str(launcher),str(engine/'dist/cli.js')],input=b'\0\0\0\2{}',env={},capture_output=True,timeout=30)
  assert direct.returncode!=0 and b'TRIAL_ADMITTED' not in direct.stdout and snapshot(D)==before
 if case.startswith('packed-launch-dispatch-') and case!='packed-launch-dispatch-peer':
  sys.path.insert(0,str(N/'tests/support'));import trial_dispatch
  mode=case.removeprefix('packed-launch-dispatch-');seen=[]
  traces=pathlib.Path(tempfile.mkdtemp(prefix='dispatch-'+mode+'-',dir=H/'evidence'))
  def inject(boundary):
   if mode=='controllers':
    peer=subprocess.run([sys.executable,str(N/'tests/controller_issuance.py'),'packed-launch-dispatch-peer'],env=dict(os.environ,WG_DISPATCH_SHARED_FIXTURE=str(f)),capture_output=True,text=True,timeout=25)
    (traces/'peer.log').write_text(peer.stdout+peer.stderr)
    assert peer.returncode==0,('second real controller failed',peer.stdout,peer.stderr)
   if mode=='unsafe':os.mkfifo(plan['bookkeeping']['lockPaths'][-1],0o600)
   if mode=='stale':(f/'inputs/request.json').write_bytes(raw(dict(request,authorityId='changed-at-transaction-flock')))
   seen.append(snapshot(D))
  observed=trial_dispatch.observe(launch,node,helper,plan['bookkeeping']['lockPaths'],mode,inject,traces)
  frames=[e['frame'] for e in observed['events'] if e.get('role')=='helper']
  assert observed['exit']==3 and observed['changed'],('missing installed strict fault boundary',mode,observed)
  assert not pathlib.Path(target).exists() and not pathlib.Path(state).exists()
  after=snapshot(D)
  if mode in ['stale','contention','malformed','unsafe','controllers']:
   assert after==seen[0],('whole post-injection fixture must be preserved',mode,set(after)-set(seen[0]))
  else:
   for key,value in seen[0].items():assert after[key]==value,('existing resource changed',key)
   assert all(str(D/key) in plan['bookkeeping']['lockPaths'] for key in set(after)-set(seen[0]))
  if mode=='stale':assert any(v.get('body',{}).get('code')=='STALE_PLAN' for v in frames),frames
  if mode=='contention':assert any(v.get('body',{}).get('code')=='LOCKED' for v in frames),frames
  if mode=='cancel':assert any(v.get('body',{}).get('code')=='TOOL_FAILURE' for v in frames),frames
  if mode in ['repeat','malformed']:assert any(v.get('body',{}).get('code')=='INVALID' for v in frames),frames
  assert not any(v.get('kind')=='result' for v in frames)
  put(D/'dispatch-fault-receipt.json',dict(mode=mode,trace=str(traces),preserved=True,manifest=False,state=False));print('installed dispatch fault preserved',mode);sys.exit(0)
 p=subprocess.run(launch,capture_output=True,text=True,timeout=60)
 if case=='packed-launch-dispatch-peer':
  assert p.returncode==3 and json.loads(p.stdout)['body']['code']=='LOCKED',('second authenticated helper must contend',p.returncode,p.stdout,p.stderr)
  assert not pathlib.Path(target).exists() and not pathlib.Path(state).exists()
  put(D/'peer-receipt.json',dict(argv=launch,exit=p.returncode,stdout=p.stdout,sharedFixture=str(f)));print('second real controller/helper LOCKED');sys.exit(0)
 if case in ['packed-launch','packed-launch-dispatch']:
  reply=json.loads(p.stdout)
  assert p.returncode==3 and reply==dict(apiVersion='workspace-governance/init-helper-response-v1',request=2,ok=False,kind='error',body=dict(code='UNSUPPORTED',operationId='synthetic-issue',reason=None)),('missing installed strict begin response',p.returncode,p.stdout,p.stderr)
  for lock in plan['bookkeeping']['lockPaths']:
   q=pathlib.Path(lock);assert q.is_file() and q.read_bytes()==b'' and q.stat().st_mode&0o7777==0o600,'missing admitted persistent transaction lock'
 else:
  assert p.returncode==3 and 'TRIAL_ADMITTED_NO_TRANSACTION' in p.stdout,('missing actual authenticated installed launch/admission',p.returncode,p.stdout,p.stderr)
 assert reserved.is_file() and not pathlib.Path(target).exists() and not pathlib.Path(state).exists()
 post=[]
 with tarfile.open(pathlib.Path(os.environ['WG_PACKED_CLI'])) as tar:
  for member in tar.getmembers():
   if member.isfile():
    rel=pathlib.PurePosixPath(member.name).relative_to('package');data=tar.extractfile(member).read()
    assert (engine/rel).read_bytes()==data
    post.append(dict(path=str(rel),sha256=sha(data),mode=(engine/rel).stat().st_mode&0o7777))
 assert helper.read_bytes()==(H/'build/target/release/workspacectl-init-helper').read_bytes()
 assert launcher.read_bytes()==(H/'build/target/release/libworkspace_governance_setup_native.so').read_bytes()
 put(D/'post-launch-members.json',post)
 before=snapshot(D);again=subprocess.run(launch,capture_output=True,text=True,timeout=60)
 assert again.returncode==3 and snapshot(D)==before and 'TRIAL_ADMITTED' not in again.stdout
 put(D/'launch-receipt.json',dict(argv=launch,exit=p.returncode,stdout=p.stdout,stderr=p.stderr,oneUse=True,transaction=False))
 print('actual installed startup/helper admission; consumed retry refused; no transaction');sys.exit(0)
if case.startswith('pending-checks-'):
 changed=json.loads(record.read_bytes());kind=case.removeprefix('pending-checks-')
 if kind=='subset':changed['pendingCheckIds']=['artifact-consumer']
 elif kind=='empty':changed['pendingCheckIds']=[]
 elif kind=='duplicate':changed['pendingCheckIds'].append(changed['pendingCheckIds'][-1])
 elif kind=='reordered':changed['pendingCheckIds'].reverse()
 else:raise AssertionError(kind)
 record.write_bytes(raw(changed));issued_path=D/'registry'/(trial['trialId']+'.issued.json');receipt=json.loads(issued_path.read_bytes());receipt['trialSha256']=sha(record.read_bytes());issued_path.write_bytes(raw(receipt))
 before=snapshot(D);p=subprocess.run(reserve,capture_output=True,text=True)
 assert p.returncode==3 and not reserved.exists() and snapshot(D)==before,'initial issuance requires exact all-twelve pending checks'
 print('exact initial pending check set enforced',case);sys.exit(0)
if case.startswith('registry-pending-'):
 selector=case.removeprefix('registry-pending-');at_lock=selector.endswith('-race');selector=selector.removesuffix('-race')
 victim=next((D/'registry').glob(selector+'-*.json')) if selector in ['operation','fixture'] else D/'registry'/(trial['trialId']+('.json' if selector=='trial' else '.'+selector+'.json'))
 pending=pathlib.Path(str(victim)+'.pending')
 if at_lock:
  import importlib.util
  spec=importlib.util.spec_from_file_location('controller_crash',str(N/'tests/support/controller_crash.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
  trace_dir=pathlib.Path(tempfile.mkdtemp(prefix='controller-pending-race-',dir=H/'evidence'));seen=[]
  def mutate():put(pending,b'');seen.append(snapshot(D))
  status,changed=module.change_at_registry_lock(reserve,mutate,trace_dir)
  assert changed and status==3 and not reserved.exists() and snapshot(D)==seen[0],'under-lock contradictory bookkeeping must refuse unchanged'
 else:
  put(pending,b'');before=snapshot(D);p=subprocess.run(reserve,capture_output=True,text=True)
  assert p.returncode==3 and not reserved.exists() and snapshot(D)==before,'contradictory bookkeeping must refuse unchanged'
 print('contradictory pending preserved',case);sys.exit(0)
if case.startswith('registry-race-'):
 import importlib.util
 spec=importlib.util.spec_from_file_location('controller_crash',str(N/'tests/support/controller_crash.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 trace_dir=pathlib.Path(tempfile.mkdtemp(prefix='controller-registry-race-',dir=H/'evidence'));seen=[]
 selector=case.removeprefix('registry-race-');replacement=selector.endswith('-identity');selector=selector.removesuffix('-identity')
 victim=next((D/'registry').glob(selector+'-*.json')) if selector in ['operation','fixture'] else D/'registry'/(trial['trialId']+('.json' if selector=='trial' else '.'+selector+'.json'))
 def mutate():
  if replacement:
   data=victim.read_bytes();tmp=victim.with_suffix('.injected');put(tmp,data);tmp.replace(victim)
  else:victim.write_bytes(b'{}')
  seen.append(snapshot(D))
 status,changed=module.change_at_registry_lock(reserve,mutate,trace_dir)
 assert changed and status==3 and not reserved.exists() and snapshot(D)==seen[0],('immutable registry change must refuse without effects',case,changed,status,reserved.exists(),(trace_dir/'race.stdout').read_text(),(trace_dir/'race.stderr').read_text())
 print('actual flock registry recapture refusal; complete injected fixture preserved',case);sys.exit(0)
if case=='contention':
 import fcntl
 lock=D/'registry'/('.workspacectl-lock-'+sha(str(D/'registry').encode()));fd=os.open(lock,os.O_RDWR|os.O_NOFOLLOW)
 try:
  fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);before=snapshot(D)
  p=subprocess.run(reserve,capture_output=True,text=True,timeout=60)
  assert p.returncode==3 and snapshot(D)==before and not reserved.exists()
 finally:os.close(fd)
 print('real persistent registry flock contention refused unchanged')
if case=='concurrent':
 lock=D/'registry'/('.workspacectl-lock-'+sha(str(D/'registry').encode()));identity=(lock.stat().st_dev,lock.stat().st_ino,lock.read_bytes())
 children=[subprocess.Popen(reserve,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True) for _ in range(2)]
 replies=[child.communicate(timeout=60) for child in children]
 assert all(child.returncode==3 for child in children) and sum(bool(out.strip()) for out,err in replies)==1
 assert reserved.is_file() and identity==(lock.stat().st_dev,lock.stat().st_ino,lock.read_bytes())
 before=snapshot(D);p=subprocess.run(reserve,capture_output=True,text=True);assert p.returncode==3 and snapshot(D)==before
 put(D/'concurrent-receipt.json',dict(replies=replies,oneReservation=True,reusePreserved=True))
 print('two real controllers: exactly one durable reservation; persistent lock inode unchanged');sys.exit(0)
if case=='under-lock-reserve-stale':
 import importlib.util
 spec=importlib.util.spec_from_file_location('controller_crash',str(N/'tests/support/controller_crash.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 trace_dir=pathlib.Path(tempfile.mkdtemp(prefix='controller-reserve-stale-',dir=H/'evidence'));seen=[]
 def replace_target():
  put(pathlib.Path(target),b'foreign target changed after preflight');seen.append(snapshot(D))
 status,changed=module.change_at_registry_lock(reserve,replace_target,trace_dir)
 assert changed and status==3 and snapshot(D)==seen[0] and not reserved.exists(),'under-lock stale target must refuse reservation'
 print('under-lock reservation stale target refused unchanged');sys.exit(0)
if case=='crash':
 import importlib.util
 spec=importlib.util.spec_from_file_location('controller_crash',str(N/'tests/support/controller_crash.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 crash=module.crash_after_reservation(reserve,reserved,D/'evidence');before=snapshot(D)
 p=subprocess.run(reserve,capture_output=True,text=True);assert p.returncode==3 and snapshot(D)==before
 assert not pathlib.Path(target).exists() and not pathlib.Path(state).exists()
 put(D/'crash-receipt.json',dict(crash=crash,reuseExit=p.returncode,preserved=True,beforeSha256=sha(raw(before))))
 print('real SIGKILL after durable reservation: reuse refused unchanged');sys.exit(0)
if case.startswith('trial-'):
 changed=json.loads(record.read_bytes())
 if case=='trial-extra':changed['passed']=True
 if case=='trial-binding':changed['fixture']['request']['sha256']='0'*64
 if case=='trial-lifetime':changed['lifetime']['deadlineBoottimeNs']=changed['lifetime']['issuedBoottimeNs']
 if case=='trial-checks':changed['pendingCheckIds']=['passed']
 put(D/'original-trial.json',record.read_bytes());record.write_bytes(raw(changed))
 # Rebind the test issuance receipt too: catches schema/binding validation, not just checksum mismatch.
 receipt_path=D/'registry'/(trial['trialId']+'.issued.json');orig=json.loads(receipt_path.read_bytes());put(D/'original-issued.json',receipt_path.read_bytes());orig['trialSha256']=sha(record.read_bytes());receipt_path.write_bytes(raw(orig))
 before=snapshot(D);p=subprocess.run(reserve,capture_output=True,text=True);assert p.returncode==3 and snapshot(D)==before and not reserved.exists()
 put(D/'refusal-receipt.json',dict(case=case,exit=p.returncode,preserved=True,beforeSha256=sha(raw(before))))
 print('forged trial refused unchanged',case);sys.exit(0)
if case=='missing-index':
 index=D/'registry'/('operation-'+sha(b'synthetic-issue')+'.json');index.rename(D/'retained-operation-index.json')
 before=snapshot(D);p=subprocess.run(reserve,capture_output=True,text=True)
 assert p.returncode==3 and snapshot(D)==before and not reserved.exists(),'ambiguous issuance indices must refuse reservation'
 print('missing issuance index refused unchanged');sys.exit(0)
if case=='ambiguous-reservation':
 put(D/'registry'/(trial['trialId']+'.reserved.json.pending'),b'')
 before=snapshot(D);p=subprocess.run(reserve,capture_output=True,text=True);assert p.returncode==3 and snapshot(D)==before and not reserved.exists()
 print('ambiguous reservation refused unchanged');sys.exit(0)
p=subprocess.run(reserve,capture_output=True,text=True)
assert reserved.is_file(),('missing durable consumed reservation',p.returncode,p.stdout,p.stderr)
rv=json.loads(reserved.read_bytes());assert rv['trialSha256']==sha(record.read_bytes()) and rv['state']=='consumed/reserved'
assert p.returncode==3 and 'UNSUPPORTED_LAUNCH' in p.stderr
put(D/'reservation-receipt.json',dict(argv=reserve,exit=p.returncode,stdout=p.stdout,stderr=p.stderr,reservedSha256=sha(reserved.read_bytes()),apply=False))
if case=='packed-normal':
 members=json.loads((D/'archive-members.json').read_bytes())
 assert sha((D/'candidate/cli.tar').read_bytes())==members['archive']['sha256']
 for member in members['members']:
  installed=engine/member['path']
  assert sha(installed.read_bytes())==member['sha256'] and installed.stat().st_mode&0o7777==member['installedMode']
 assert not pathlib.Path(target).exists() and not pathlib.Path(state).exists()
 put(D/'post-reservation-members.json',dict(unchanged=True,archiveSha256=members['archive']['sha256'],members=len(members['members']),noApply=True))
before=snapshot(D);p=subprocess.run(reserve,capture_output=True,text=True);assert p.returncode==3 and snapshot(D)==before
print('durable reservation and one-use refusal verified')
# A self-consistent digest cannot turn an incomplete resource list into a full plan.
forged=dict(plan);forged.pop('digest');forged['resources']=[fixture['request']];forged['digest']=sha(raw(forged));bad=D/'incomplete-plan.json';put(bad,forged)
before=snapshot(D);args=list(argv);args[5]=str(bad);args[7]=forged['digest'];args[9]='incomplete-resources'
p=subprocess.run(args,capture_output=True,text=True)
assert p.returncode!=0 and snapshot(D)==before,'incomplete full-plan resource closure must refuse before registry writes'
before=snapshot(D);p=subprocess.run(argv,capture_output=True,text=True)
assert p.returncode!=0 and snapshot(D)==before,'operation issuance must never silently create another apply ID'
again=list(argv);again[9]='second-operation';before=snapshot(D);p=subprocess.run(again,capture_output=True,text=True)
assert p.returncode!=0 and snapshot(D)==before,'a new apply must not reuse an already-issued fixture leaf'
