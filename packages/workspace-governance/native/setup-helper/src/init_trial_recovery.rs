//! Root-bound completed recognition only (adopted R1-R3). No orphan repair.
use super::*;
use std::collections::BTreeSet;
fn lf(v:&Value)->Result<Vec<u8>> {let mut b=wire(v)?;b.push(b'\n');Ok(b)}
fn replace(v:&mut Value,k:&str,x:Value)->Result<()> {if let Value::Object(a)=v {for (key,val) in a {if *key==k.encode_utf16().collect::<Vec<_>>() {*val=x;return Ok(())}}}invalid()}
fn absent(p:&Path)->Result<()> {match std::fs::symlink_metadata(p){Err(e) if e.kind()==std::io::ErrorKind::NotFound=>Ok(()),_=>Err(Failure::Stale)}}
fn pending(p:&Path)->PathBuf {let mut s=p.as_os_str().to_os_string();s.push(".pending");PathBuf::from(s)}
fn basename_of(p:&Path)->Result<&str>{p.file_name().and_then(|s|s.to_str()).ok_or(Failure::Invalid)}
fn payload(v:&Value,max:usize)->Result<Vec<u8>> {crate::init::preview::payload_bounded(v,max).map_err(|_|Failure::Invalid)}
fn canonical_record(b:&[u8])->Result<Value>{let v=json(b)?;if lf(&v)?!=b{return invalid()}Ok(v)}

struct Bundle { tid:String, record:Value, bytes:Vec<u8>, candidate:Vec<u8>, intent:Vec<u8>, plan:Vec<u8>, inputs:Value, reservation:Option<Value> }
fn load(captures:&mut Vec<RegistryCapture>,parent:&Arc<RegistryParentWitness>,p:PathBuf,total:&mut usize)->Result<Vec<u8>> {
    absent(&pending(&p))?;
    let c=RegistryCapture::capture_with_parent(p,parent)?;
    *total=total.checked_add(c.bytes.len()).ok_or(Failure::Limit)?;
    if *total>16777216{return Err(Failure::Limit)}
    let bytes=c.bytes.clone();captures.push(c);Ok(bytes)
}
fn bundle(trust:&TrustCapture,parent:&Arc<RegistryParentWitness>,tid:&str,consumed:bool,captures:&mut Vec<RegistryCapture>,total:&mut usize)->Result<Bundle>{
    hash(&string(tid))?;let reg=&trust.registry_root.path;
    let bytes=load(captures,parent,reg.join(format!("{tid}.json")),total)?;let r=json(&bytes)?;
    exact(&r,&["apiVersion","classification","trialId","issuerUid","trustAnchorSha256","candidateManifestSha256","environment","lifetime","fixture","invocation","limits","pendingCheckIds"])?;
    literal_eq(field(&r,"apiVersion")?,"workspace-governance/init-candidate-trial-v1")?;literal_eq(field(&r,"classification")?,"development-candidate/pending")?;
    literal_eq(field(&r,"trialId")?,tid)?;if uid(field(&r,"issuerUid")?)?!=trust.issuer_uid{return invalid()}
    literal_eq(field(&r,"trustAnchorSha256")?,&trust.sha256)?;literal_eq(field(&r,"candidateManifestSha256")?,&trust.candidate_manifest_sha256)?;
    limits(field(&r,"limits")?)?;eq(field(&r,"pendingCheckIds")?,&Value::Array(CHECKS.iter().map(|s|string(s)).collect()))?;
    let inv=field(&r,"invocation")?;exact(inv,&["mode","operationId","planSha256","approvalDigest","priorTrialId"])?;
    id(field(inv,"operationId")?)?;hash(field(inv,"approvalDigest")?)?;hash(field(inv,"planSha256")?)?;
    match text(field(inv,"mode")?)?.as_str(){"apply"=>eq(field(inv,"priorTrialId")?,&Value::Null)?,"recover"=>{hash(field(inv,"priorTrialId")?)?;},_=>return invalid()}
    let lifetime=field(&r,"lifetime")?;exact(lifetime,&["issuedBoottimeNs","deadlineBoottimeNs"])?;
    let issued=decimal(field(lifetime,"issuedBoottimeNs")?)?;let deadline=decimal(field(lifetime,"deadlineBoottimeNs")?)?;
    if deadline<=issued||deadline-issued>600_000_000_000{return invalid()}
    let candidate=load(captures,parent,reg.join(format!("{tid}.candidate.json")),total)?;
    let intent=load(captures,parent,reg.join(format!("{tid}.intent.json")),total)?;
    let plan=load(captures,parent,reg.join(format!("{tid}.plan.json")),total)?;
    let input_bytes=load(captures,parent,reg.join(format!("{tid}.inputs.json")),total)?;let inputs=json(&input_bytes)?;
    exact(&inputs,&["candidatePath","intentPath","planPath"])?;for k in ["candidatePath","intentPath","planPath"]{path(field(&inputs,k)?)?;}
    let receipt=json(&load(captures,parent,reg.join(format!("{tid}.issued.json")),total)?)?;
    eq(&receipt,&object(vec![("apiVersion",string("workspace-governance/init-trial-issuance-v1")),("trialId",string(tid)),("trialSha256",string(&sha256(&bytes))),("inputsSha256",string(&sha256(&input_bytes)))]))?;
    literal_eq(field(inv,"planSha256")?,&sha256(&plan))?;literal_eq(field(inv,"approvalDigest")?,&text(field(&json(&plan)?,"digest")?)?)?;
    literal_eq(field(&r,"candidateManifestSha256")?,&sha256(&candidate))?;
    let iv=json(&intent)?;for k in ["candidateManifestSha256","environment","fixture","limits"]{eq(field(&r,k)?,field(&iv,k)?)?;}
    absent(&reg.join(format!("{tid}.reserved.json.pending")))?;
    let reservation=if consumed {
        let res=json(&load(captures,parent,reg.join(format!("{tid}.reserved.json")),total)?)?;
        exact(&res,&["apiVersion","trialId","trialSha256","state","attemptId","approvalDigest","controller","reservedBoottimeNs"])?;
        let ctrl=field(&res,"controller")?;exact(ctrl,&["pid","startTicks","bootId"])?;
        let pid=decimal(field(ctrl,"pid")?)?;if pid==0||pid>i32::MAX as u64||decimal(field(ctrl,"startTicks")?)?==0{return invalid()}
        eq(field(ctrl,"bootId")?,field(field(&r,"environment")?,"bootId")?)?;
        let ns=decimal(field(&res,"reservedBoottimeNs")?)?;if ns<issued||ns>=deadline{return invalid()}
        hash(field(&res,"attemptId")?)?;
        eq(&res,&object(vec![("apiVersion",string("workspace-governance/init-trial-reservation-v1")),("trialId",string(tid)),("trialSha256",string(&sha256(&bytes))),("state",string("consumed/reserved")),("attemptId",field(&res,"attemptId")?.clone()),("approvalDigest",field(inv,"approvalDigest")?.clone()),("controller",ctrl.clone()),("reservedBoottimeNs",string(&ns.to_string()))]))?;Some(res)
    }else{absent(&reg.join(format!("{tid}.reserved.json")))?;None};
    Ok(Bundle{tid:tid.into(),record:r,bytes,candidate,intent,plan,inputs,reservation})
}
fn root_mapping(reg:&Path,tid:&str)->Result<Value>{Ok(object(vec![("candidatePath",string(literal(&reg.join(format!("{tid}.candidate.json")))?)),("intentPath",string(literal(&reg.join(format!("{tid}.intent.json")))?)),("planPath",string(literal(&reg.join(format!("{tid}.plan.json")))?))]))}
struct History {root:Bundle,captures:Vec<RegistryCapture>,parent:Arc<RegistryParentWitness>}
impl History {
 fn capture(trust:&TrustCapture,prior:&str,operation:&str,approve:&str)->Result<Self>{
    let parent=RegistryParentWitness::capture(&trust.registry_root.path)?;
    Self::capture_with_parent(trust,prior,operation,approve,parent)
 }
 fn capture_with_parent(trust:&TrustCapture,prior:&str,operation:&str,approve:&str,parent:Arc<RegistryParentWitness>)->Result<Self>{
    hash(&string(prior))?;id(&string(operation))?;hash(&string(approve))?;
    let mut seen=BTreeSet::new();let mut captures=vec![];let mut total=0;let mut tid=prior.to_owned();let mut chain=vec![];
    loop {
        if seen.len()>=256{return Err(Failure::Limit)}
        if !seen.insert(tid.clone()){return invalid()}
        let b=bundle(trust,&parent,&tid,true,&mut captures,&mut total)?;
        let inv=field(&b.record,"invocation")?;literal_eq(field(inv,"operationId")?,operation)?;literal_eq(field(inv,"approvalDigest")?,approve)?;
        let end=is(field(inv,"mode")?,"apply");let next=if end{None}else{Some(hash(field(inv,"priorTrialId")?)?)};
        chain.push(b);if end{break}tid=next.ok_or(Failure::Invalid)?;
    }
    let root=chain.pop().ok_or(Failure::Invalid)?;
    let mapping=root_mapping(&trust.registry_root.path,&root.tid)?;
    for b in &chain {
        for k in ["issuerUid","trustAnchorSha256","candidateManifestSha256","environment","fixture","limits","pendingCheckIds"]{eq(field(&b.record,k)?,field(&root.record,k)?)?;}
        if b.candidate!=root.candidate||b.intent!=root.intent||b.plan!=root.plan{return invalid()}
        eq(&b.inputs,&mapping)?;
    }
    let expected=object(vec![("trialId",string(&root.tid)),("operationId",string(operation)),("approvalDigest",string(approve))]);
    let fixture_path=path(field(field(field(&root.record,"fixture")?,"root")?,"path")?)?;
    for name in [format!("operation-{}.json",sha256(operation.as_bytes())),format!("fixture-{}.json",sha256(fixture_path.as_os_str().as_encoded_bytes()))] {
        eq(&json(&load(&mut captures,&parent,trust.registry_root.path.join(name),&mut total)?)?,&expected)?;
    }
    let h=Self{root,captures,parent};h.recheck()?;Ok(h)
 }
 fn recheck(&self)->Result<()> {for c in &self.captures{absent(&pending(&c.path))?;c.recheck()?;}Ok(())}
}

// Completed recognition allocates nothing in these directories or their parents.
// Retain original facts: two live descriptors agree even after same-inode chmod.
struct Dir {path:PathBuf,file:File,parent:File,facts:std::fs::Metadata,parent_facts:std::fs::Metadata,mount:u64,parent_mount:u64,names:BTreeSet<String>}
impl Dir {
 fn capture(path:PathBuf,names:BTreeSet<String>)->Result<Self>{
    let file=open_directory(&path)?;let facts=metadata(&file)?;
    if facts.uid()!=unsafe{libc::geteuid()}||facts.mode()&0o7777!=0o700{return Err(Failure::Unsupported)}
    let parent=open_directory(path.parent().ok_or(Failure::Invalid)?)?;
    let parent_facts=metadata(&parent)?;let mount=mount_id(&file)?;let parent_mount=mount_id(&parent)?;
    let d=Self{path,file,parent,facts,parent_facts,mount,parent_mount,names};d.recheck()?;Ok(d)
 }
 fn recheck(&self)->Result<()> {
    let file=open_directory(&self.path)?;let parent=open_directory(self.path.parent().ok_or(Failure::Invalid)?)?;
    for f in [&self.file,&file]{let m=metadata(f)?;if !m.is_dir()||m.uid()!=unsafe{libc::geteuid()}||m.mode()&0o7777!=0o700||!same_file(&self.facts,&m)||mount_id(f)?!=self.mount{return Err(Failure::Stale)}}
    for f in [&self.parent,&parent]{if !same_file(&self.parent_facts,&metadata(f)?)||mount_id(f)?!=self.parent_mount{return Err(Failure::Stale)}}
    let mut names=BTreeSet::new();for e in std::fs::read_dir(&self.path).map_err(|_|Failure::Stale)? {let e=e.map_err(|_|Failure::Stale)?;if names.len()>=1024{return Err(Failure::Limit)}names.insert(e.file_name().to_str().ok_or(Failure::Invalid)?.to_owned());}
    if names!=self.names{return Err(Failure::RecoveryRequired)}Ok(())
 }
}
fn names(items:&[&str])->BTreeSet<String>{items.iter().map(|s|s.to_string()).collect()}
fn file_fact(p:&Path)->Result<Value>{let r=resource(p,None)?;literal_eq(field(&r,"kind")?,"file")?;let fs=field(&r,"filesystem")?;literal_eq(field(fs,"mode")?,"0600")?;literal_eq(field(fs,"uid")?,&unsafe{libc::geteuid()}.to_string())?;Ok(object(vec![("identity",field(&r,"identity")?.clone()),("mode",string("0600")),("sha256",field(&r,"sha256")?.clone()),("treeDigest",Value::Null)]))}
fn resource_fact(p:&Path,after:Value,reference:Option<&str>)->Result<Value>{Ok(object(vec![("path",string(literal(p)?)),("before",Value::Null),("after",after),("payloadRef",reference.map(string).unwrap_or(Value::Null))]))}
#[cfg(test)]
mod tests {
 use super::*;
 #[test]
 fn completed_directory_retains_original_metadata() {
  use std::os::unix::fs::PermissionsExt;
  let root=PathBuf::from(std::env::var("WG_NATIVE_TEST_ROOT").unwrap()).join(format!("recovery-dir-{}",random().unwrap()));
  std::fs::create_dir(&root).unwrap();
  let path=root.join("captures");std::fs::create_dir(&path).unwrap();
  let witness=Dir::capture(path.clone(),names(&[])).unwrap();
  witness.recheck().unwrap();
  std::fs::set_permissions(&path,std::fs::Permissions::from_mode(0o755)).unwrap();
  assert!(witness.recheck().is_err(),"same-inode private mode drift must refuse");
 }
 #[test]
 fn registry_parent_preserves_safety_during_allocation() {
  use std::os::unix::fs::PermissionsExt;
  let root=PathBuf::from(std::env::var("WG_NATIVE_TEST_ROOT").unwrap()).join(format!("registry-parent-{}",random().unwrap()));
  std::fs::create_dir(&root).unwrap();let path=root.join("capture.json");std::fs::write(&path,b"{}").unwrap();
  let witness=RegistryCapture::capture(path).unwrap();
  std::fs::write(root.join("new-record.json"),b"{}").unwrap();
  witness.recheck().unwrap(); // Registry publication legitimately changes size/times.
  std::fs::set_permissions(&root,std::fs::Permissions::from_mode(0o755)).unwrap();
  assert!(witness.recheck().is_err(),"registry allocation does not authorize parent mode drift");
 }
 #[test]
 fn nonengine_directory_cannot_claim_a_tree_digest() {
  let value=object(vec![("path",string("/fixture")),("kind",string("directory")),("identity",object(vec![("dev",string("1")),("ino",string("2"))])),("sha256",Value::Null),("treeDigest",string(&"f".repeat(64))),("filesystem",object(vec![("uid",string("1000")),("gid",string("1000")),("mode",string("0700")),("nlink",string("2")),("mountId",string("1"))]))]);
  assert!(resource_schema(&value).is_err(),"an arbitrary historical tree must not be echoed by recapture");
 }
}
fn resource_schema(v:&Value)->Result<PathBuf>{
 eq(field(v,"treeDigest")?,&Value::Null)?;resource_schema_tree(v)
}
fn resource_schema_tree(v:&Value)->Result<PathBuf>{
 exact(v,&["path","kind","identity","sha256","treeDigest","filesystem"])?;let p=path(field(v,"path")?)?;let kind=text(field(v,"kind")?)?;
 if kind=="absent"{for k in ["identity","sha256","treeDigest","filesystem"]{eq(field(v,k)?,&Value::Null)?;}return Ok(p)}
 if kind!="file"&&kind!="directory"{return invalid()}
 let i=field(v,"identity")?;exact(i,&["dev","ino"])?;decimal(field(i,"dev")?)?;if decimal(field(i,"ino")?)?==0{return invalid()}
 let fs=field(v,"filesystem")?;exact(fs,&["uid","gid","mode","nlink","mountId"])?;
 for k in ["uid","gid"]{if decimal(field(fs,k)?)?>u32::MAX as u64{return invalid()}}
 for k in ["nlink","mountId"]{if decimal(field(fs,k)?)?==0{return invalid()}}
 let m=text(field(fs,"mode")?)?;if m.len()!=4||!m.bytes().all(|b|(b'0'..=b'7').contains(&b))||u32::from_str_radix(&m,8).map_err(|_|Failure::Invalid)?&0o7022!=0{return invalid()}
 if kind=="file"{hash(field(v,"sha256")?)?;eq(field(v,"treeDigest")?,&Value::Null)?;literal_eq(field(fs,"nlink")?,"1")?;}else{eq(field(v,"sha256")?,&Value::Null)?;if field(v,"treeDigest")?!=&Value::Null{hash(field(v,"treeDigest")?)?;}}
 Ok(p)
}

/// Retains every complete operation file, named parent and exact directory set.
/// Recheck has no fsync; only the authenticated helper calls barriers under locks.
pub(super) struct Completed {files:Vec<RegistryCapture>,dirs:Vec<Dir>,absent:Vec<PathBuf>,pub(super) result:Value,intent:Vec<u8>,candidate:Vec<u8>,request:Vec<u8>,trust_bytes:Vec<u8>,current_files:CandidateFiles,barriers:Vec<PathBuf>}
impl Completed {
 pub(super) fn authority(&self,root:&Path)->Result<()> {self.current_files.recheck()?;let trust=read_trust(root)?;if trust.bytes!=self.trust_bytes{return Err(Failure::Stale)}candidate(&self.candidate,&trust)?;intent_input(&self.intent,&trust,Some(&self.request))?;Ok(())}
 pub(super) fn recheck(&self)->Result<()> {
    for p in &self.absent{absent(p)?;}for d in &self.dirs{d.recheck()?;}for f in &self.files{f.recheck()?;}Ok(())
 }
 fn capture(trust:&TrustCapture,h:&History)->Result<Self>{
    let root=&h.root;let p=json(&root.plan)?;let ctx=field(&p,"context")?;
    let operation=id(field(field(&root.record,"invocation")?,"operationId")?)?;
    let state_parent=path(field(field(field(&root.record,"fixture")?,"stateParent")?,"path")?)?;
    let state=state_parent.join(basename(field(field(&root.record,"fixture")?,"stateBasename")?)?);
    let op=state.join("operations").join(&operation);
    eq(field(ctx,"stateDir")?,&string(literal(&state)?))?;
    let actions=arr(field(&p,"actions")?)?;if actions.len()>1{return invalid()}
    let count=if actions.is_empty(){4}else{6};
    // B accepts exactly the initial producer's completed phase schedule. No C
    // orphan adoption or candidate-only inference, including genuine originals.
    let mut dirs=vec![Dir::capture(state.clone(),names(&["state.json","operations"]))?,Dir::capture(state.join("operations"),names(&[&operation]))?,Dir::capture(op.clone(),names(&["proposal.json","context.json","owner.json","result.json","captures","payloads","evidence","events"]))?,Dir::capture(op.join("captures"),names(&["request.json","manifest-before.json","trial-intent.json","trial-record.json","candidate-manifest.json","trial-anchor.json","approved-plan.json"]))?,Dir::capture(op.join("payloads"),names(&["manifest-after.json","state.json"]))?];
    for dir in ["evidence","events"]{dirs.push(Dir::capture(op.join(dir),(1..=count).map(|i|format!("{i:06}.json")).collect())?);}
    let mut files=vec![];let mut total=0usize;
    let mut take=|path:PathBuf|->Result<Vec<u8>> {let c=RegistryCapture::capture(path)?;total=total.checked_add(c.bytes.len()).ok_or(Failure::Limit)?;if total>16777216{return Err(Failure::Limit)}let b=c.bytes.clone();files.push(c);Ok(b)};
    if take(op.join("proposal.json"))?!=lf(&p)?||take(op.join("context.json"))?!=lf(ctx)?{return invalid()}
    let owner=canonical_record(&take(op.join("owner.json"))?)?;exact(&owner,&["operationId","proposalDigest","pid","bootId","processStartTicks","nonce"])?;
    let res=root.reservation.as_ref().ok_or(Failure::Invalid)?;
    literal_eq(field(&owner,"operationId")?,&operation)?;eq(field(&owner,"proposalDigest")?,field(&p,"digest")?)?;eq(field(&owner,"nonce")?,field(res,"attemptId")?)?;eq(field(&owner,"bootId")?,field(field(&root.record,"environment")?,"bootId")?)?;
    let pid=decimal(field(&owner,"pid")?)?;if pid==0||pid>i32::MAX as u64||decimal(field(&owner,"processStartTicks")?)?==0{return invalid()}
    let mut captured=BTreeMap::new();let mut aggregate=0;
    for (name,expected) in [("trial-intent",&root.intent),("trial-record",&root.bytes),("candidate-manifest",&root.candidate),("trial-anchor",&trust.bytes),("approved-plan",&root.plan)]{
        let b=take(op.join(format!("captures/{name}.json")))?;aggregate+=b.len();let value=canonical_record(&b)?;let raw=payload(&value,262144)?;if raw!=*expected{return invalid()}captured.insert(name,raw);
    }
    let rb=take(op.join("captures/request.json"))?;aggregate+=rb.len();let request=payload(&canonical_record(&rb)?,262144)?;
    let bb=take(op.join("captures/manifest-before.json"))?;aggregate+=bb.len();let bv=canonical_record(&bb)?;let before=if bv==Value::Null{None}else{Some(payload(&bv,262144)?)};
    let (iv,f)=intent_input(&root.intent,trust,Some(&request))?;let c=candidate(&root.candidate,trust)?;
    let manifest=crate::init::derive_manifest(&request).map_err(|_|Failure::Invalid)?;let state_bytes=crate::init::derive_rootless_state(&request).map_err(|_|Failure::Invalid)?;
    for (name,expected) in [("manifest-after",&manifest),("state",&state_bytes)]{let b=take(op.join(format!("payloads/{name}.json")))?;aggregate+=b.len();if payload(&canonical_record(&b)?,262144)?!=*expected{return invalid()}}
    if aggregate>2097152{return Err(Failure::Limit)}
    let cp=path(field(&root.inputs,"candidatePath")?)?;let ip=path(field(&root.inputs,"intentPath")?)?;
    let engine=field(&c.value,"engine")?;
    let mut resources=BTreeMap::new();for r in arr(field(&p,"resources")?)?{if resources.len()>=4096{return Err(Failure::Limit)}
        let path=if field(r,"path")?==field(engine,"path")? {literal_eq(field(r,"kind")?,"directory")?;eq(field(r,"treeDigest")?,field(engine,"treeSha256")?)?;resource_schema_tree(r)?} else {resource_schema(r)?};
        if resources.insert(path,r.clone()).is_some(){return invalid()}
    }
    let expected=derive_plan_input(&cp,&ip,trust,&c,&root.intent,&iv,&f,Some((before.as_deref(),&resources)))?;eq(&p,&expected)?;
    let request_path=path(field(field(&iv,"fixture")?,"request").and_then(|v|field(v,"path"))?)?;
    eq(resources.get(&request_path).ok_or(Failure::Invalid)?,field(field(&iv,"fixture")?,"request")?)?;
    for (path,hash_value) in [(&cp,sha256(&root.candidate)),(&ip,sha256(&root.intent))]{let r=resources.get(path).ok_or(Failure::Invalid)?;literal_eq(field(r,"kind")?,"file")?;literal_eq(field(r,"sha256")?,&hash_value)?;let fs=field(r,"filesystem")?;literal_eq(field(fs,"mode")?,"0600")?;literal_eq(field(fs,"uid")?,&trust.issuer_uid.to_string())?;}
    for (path,r) in &resources {
        if [cp.as_path(),ip.as_path(),request_path.as_path()].contains(&path.as_path()){continue}
        if *path==state{literal_eq(field(r,"kind")?,"absent")?;continue}
        if *path==f.manifest_path {
            literal_eq(field(r,"kind")?,if before.is_some(){"file"}else{"absent"})?;
            if let Some(b)=&before{literal_eq(field(r,"sha256")?,&sha256(b))?;eq(&resource(path,None)?,r)?;}continue
        }
        let mut original=r.clone();
        if *path==state_parent {let mut fs=field(&original,"filesystem")?.clone();let links=decimal(field(&fs,"nlink")?)?.checked_add(1).ok_or(Failure::Limit)?;replace(&mut fs,"nlink",string(&links.to_string()))?;replace(&mut original,"filesystem",fs)?;}
        eq(&resource(path,Some(field(r,"treeDigest")?))?,&original).map_err(|_|Failure::Stale)?;
    }
    if take(f.manifest_path.clone())?!=manifest||take(state.join("state.json"))?!=state_bytes{return Err(Failure::Stale)}
    let result_bytes=take(op.join("result.json"))?;let stored=canonical_record(&result_bytes)?;
    let mut previous=Value::Null;let mut result_actions=vec![];let mut chain_barriers=vec![];
    for sequence in 1..=count {
        let complete=sequence==count;let state_step=sequence==2||sequence==3;
        let phase=if sequence==1{"prepared"}else if complete{"complete"}else if sequence%2==0{"file-intent"}else{"file-published"};
        let action_id=if !complete&&!state_step&&sequence!=1{field(&actions[0],"id")?.clone()}else{Value::Null};
        let target=if complete{op.join("result.json")}else if state_step{state.join("state.json")}else{f.manifest_path.clone()};
        let reference=if complete{None}else if state_step{Some("payloads/state.json")}else{Some("payloads/manifest-after.json")};
        let resource=if sequence==1{Value::Null}else{resource_fact(&target,if complete||phase=="file-published"{file_fact(&target)?}else{Value::Null},reference)?};
        let evidence=object(vec![("apiVersion",string("workspace-governance/init-trial-setup-evidence-v1")),("operationId",string(&operation)),("proposalDigest",field(&p,"digest")?.clone()),("sequence",n(sequence)),("actionId",action_id.clone()),("phase",string(phase)),("resource",resource),("stage",Value::Null),("clone",Value::Null),("child",Value::Null)]);
        let ep=op.join(format!("evidence/{sequence:06}.json"));let eb=take(ep.clone())?;if eb!=lf(&evidence)?{return Err(Failure::Stale)}
        let er=format!("evidence/{sequence:06}.json");
        let event=object(vec![("apiVersion",string("workspace-governance/init-trial-journal-event-v1")),("sequence",n(sequence)),("previousEventDigest",previous),("operationId",string(&operation)),("proposalDigest",field(&p,"digest")?.clone()),("actionId",action_id.clone()),("event",string(phase)),("evidenceDigest",string(&sha256(&eb))),("evidenceRef",string(&er))]);
        let vp=op.join(format!("events/{sequence:06}.json"));let vb=take(vp.clone())?;if vb!=lf(&event)?{return invalid()}previous=string(&sha256(&vb));
        if action_id!=Value::Null&&phase=="file-published"{result_actions.push(object(vec![("id",action_id),("state",string("verified")),("evidenceRef",string(&er))]));}
        chain_barriers.extend([ep,op.join("evidence"),vp,op.join("events")]);
    }
    let result=object(vec![("apiVersion",string("workspace-governance/init-trial-setup-result-v1")),("operationId",string(&operation)),("proposalDigest",field(&p,"digest")?.clone()),("state",string("verified")),("actions",Value::Array(result_actions)),("manifestRevision",string(&sha256(&manifest))),("checkout",Value::Null)]);eq(&stored,&result)?;
    let temporary=f.manifest_path.parent().ok_or(Failure::Invalid)?.join(format!(".workspacectl-init-{operation}.pending"));
    let locks=arr(field(field(&p,"bookkeeping")?,"lockPaths")?)?;
    let mut slots=vec![f.manifest_path.clone(),temporary.clone(),state.clone()];for l in locks{slots.push(path(l)?);}
    for (i,a) in slots.iter().enumerate(){for b in &slots[i+1..]{if overlaps(a,b){return invalid()}}}
    // Completed B fixtures already have their two persistent locks. Require safe
    // exact objects rather than manufacture a lock missing from completed history.
    for l in locks {let path=path(l)?;if take(path)?.len()!=0{return invalid()}}
    for parent in [f.manifest_path.parent().ok_or(Failure::Invalid)?,state_parent.as_path()] {
        let expected=slots.iter().filter(|p|p.parent()==Some(parent)&&**p!=temporary).map(|p|basename_of(p).map(str::to_owned)).collect::<Result<BTreeSet<_>>>()?;
        dirs.push(Dir::capture(parent.to_owned(),expected)?);
    }
    let mut barriers=vec![];
    for file in &files {if !file.path.starts_with(op.join("events"))&&!file.path.starts_with(op.join("evidence"))&&!locks.iter().any(|l|path(l).ok()==Some(file.path.clone())){barriers.push(file.path.clone());}}
    for dir in [&f.manifest_path.parent().ok_or(Failure::Invalid)?.to_owned(),&op.join("captures"),&op.join("payloads"),&op,&state.join("operations"),&state,&state_parent]{barriers.push(dir.clone());}
    barriers.extend(chain_barriers);
    let completed=Self{files,dirs,absent:vec![temporary],result,intent:root.intent.clone(),candidate:root.candidate.clone(),request,trust_bytes:trust.bytes.clone(),current_files:c.files,barriers};completed.recheck()?;h.recheck()?;Ok(completed)
 }
 pub(super) fn barriers(&self,mut gate:impl FnMut()->Result<()>)->Result<()> {
    for p in &self.barriers {
        gate()?;self.recheck()?;
        let parent=open_directory(p.parent().ok_or(Failure::Invalid)?)?;
        let file=openat(&parent,basename_of(p)?,libc::O_RDONLY|libc::O_NONBLOCK)?;
        // Rebind the opened fsync descriptor to the retained exact file/dir.
        let original=if let Some(f)=self.files.iter().find(|f|f.path==*p){&f.file}else{&self.dirs.iter().find(|d|d.path==*p).ok_or(Failure::Invalid)?.file};
        let a=metadata(original)?;let b=metadata(&file)?;if !same_file(&a,&b)||mount_id(original)?!=mount_id(&file)?{return Err(Failure::Stale)}
        file.sync_all().map_err(|_|Failure::Unsupported)?;
        self.recheck()?;gate()?;
    }
    Ok(())
 }
}

fn capture(trust:&TrustCapture,prior:&str,operation:&str,approve:&str)->Result<(History,Completed)>{let h=History::capture(trust,prior,operation,approve)?;let c=Completed::capture(trust,&h)?;Ok((h,c))}
fn capture_with_parent(trust:&TrustCapture,prior:&str,operation:&str,approve:&str,parent:Arc<RegistryParentWitness>)->Result<(History,Completed)>{let h=History::capture_with_parent(trust,prior,operation,approve,parent)?;let c=Completed::capture(trust,&h)?;Ok((h,c))}
fn registry_lock(trust:&TrustCapture)->Result<crate::fs::HeldLock>{crate::fs::SafeDir::open(&trust.registry_root.path).map_err(|_|Failure::Unsupported)?.acquire_lock(&format!(".workspacectl-lock-{}",sha256(trust.registry_root.path.as_os_str().as_encoded_bytes()))).map_err(|_|Failure::Unsupported)}
pub(super) fn issue(args:&[String])->Result<Completion>{
 if args.len()!=8||args[0]!="issue-recovery"{return invalid()}
 let mut flags=BTreeMap::new();for pair in args[2..].chunks_exact(2){if !["--prior-trial-id","--operation-id","--approve"].contains(&pair[0].as_str())||flags.insert(pair[0].as_str(),pair[1].as_str()).is_some(){return invalid()}}
 let prior=*flags.get("--prior-trial-id").ok_or(Failure::Invalid)?;let operation=*flags.get("--operation-id").ok_or(Failure::Invalid)?;let approve=*flags.get("--approve").ok_or(Failure::Invalid)?;
 hash(&string(prior))?;id(&string(operation))?;hash(&string(approve))?;let root=path(&string(&args[1]))?;let trust=read_trust(&root)?;let witness=ControllerWitness::capture(&trust,std::process::id())?;
 let (h,c)=capture(&trust,prior,operation,approve)?;
 let lock=registry_lock(&trust)?;h.recheck()?;c.recheck()?;witness.recheck()?;
 let fresh=read_trust(&root)?;if fresh.bytes!=trust.bytes{return Err(Failure::Stale)}let (_,under)=capture(&fresh,prior,operation,approve)?;h.recheck()?;c.recheck()?;
 let tid=random()?;let reg=&trust.registry_root.path;for suffix in [".json",".candidate.json",".intent.json",".plan.json",".inputs.json",".issued.json",".reserved.json"]{absent(&reg.join(format!("{tid}{suffix}")))?;absent(&reg.join(format!("{tid}{suffix}.pending")))?;}
 let issued=now()?;let lifetime=object(vec![("issuedBoottimeNs",string(&issued.to_string())),("deadlineBoottimeNs",string(&issued.checked_add(600_000_000_000).ok_or(Failure::Limit)?.to_string()))]);let life=TrialLifetime::capture(&wire(&lifetime)?)?;
 let mut trial=h.root.record.clone();replace(&mut trial,"trialId",string(&tid))?;replace(&mut trial,"lifetime",lifetime)?;let mut inv=field(&trial,"invocation")?.clone();replace(&mut inv,"mode",string("recover"))?;replace(&mut inv,"priorTrialId",string(prior))?;replace(&mut trial,"invocation",inv)?;
 let inputs=wire(&root_mapping(reg,&h.root.tid)?)?;let bytes=lf(&trial)?;
 let receipt=wire(&object(vec![("apiVersion",string("workspace-governance/init-trial-issuance-v1")),("trialId",string(&tid)),("trialSha256",string(&sha256(&bytes))),("inputsSha256",string(&sha256(&inputs)))]))?;
 let registry_parent=Arc::clone(&h.parent);let mut captures=h.captures;
 for (suffix,b) in [(".candidate.json",h.root.candidate),(".intent.json",h.root.intent),(".plan.json",h.root.plan),(".inputs.json",inputs),(".json",bytes.clone()),(".issued.json",receipt)]{
    witness.recheck()?;life.recheck()?;c.authority(&root)?;c.recheck()?;under.recheck()?;for cap in &captures{cap.recheck()?;absent(&pending(&cap.path))?;}
    publish(reg,&format!("{tid}{suffix}"),&b)?;captures.push(RegistryCapture::capture_with_parent(reg.join(format!("{tid}{suffix}")),&registry_parent)?);
 }
 // Controller main adds the single LF. T.json already includes it by R1.
 let mut stdout=bytes;stdout.pop();let done=Completion{bytes:stdout,_lock:Some(lock),captures,recovery:Some(c)};done.recheck()?;Ok(done)
}

pub(super) fn reserve(args:&[String],admission:Option<(u32,&[u8])>)->Result<Completion>{
 let tid=hash(&string(&args[2]))?;let approve=hash(&string(&args[4]))?;let root=path(&string(&args[1]))?;let trust=read_trust(&root)?;let pid=admission.map_or(std::process::id(),|a|a.0);let witness=ControllerWitness::capture(&trust,pid)?;
 let registry_parent=RegistryParentWitness::capture(&trust.registry_root.path)?;let mut captures=vec![];let mut total=0;let current=bundle(&trust,&registry_parent,&tid,admission.is_some(),&mut captures,&mut total)?;let inv=field(&current.record,"invocation")?;literal_eq(field(inv,"mode")?,"recover")?;literal_eq(field(inv,"approvalDigest")?,&approve)?;
 let operation=id(field(inv,"operationId")?)?;let prior=hash(field(inv,"priorTrialId")?)?;if prior==tid{return invalid()}
 let (h,c)=capture_with_parent(&trust,&prior,&operation,&approve,Arc::clone(&registry_parent))?;
 for k in ["issuerUid","trustAnchorSha256","candidateManifestSha256","environment","fixture","limits","pendingCheckIds"]{eq(field(&current.record,k)?,field(&h.root.record,k)?)?;}
 if current.candidate!=h.root.candidate||current.intent!=h.root.intent||current.plan!=h.root.plan{return invalid()}
 eq(&current.inputs,&root_mapping(&trust.registry_root.path,&h.root.tid)?)?;
 let life=TrialLifetime::capture(&wire(field(&current.record,"lifetime")?)?)?;
 let lock=if let Some((_,bytes))=admission {
    let res=current.reservation.as_ref().ok_or(Failure::Invalid)?;let actual=read_file(&trust.registry_root.path.join(format!("{tid}.reserved.json")),262144,0o600)?;if actual!=bytes{return Err(Failure::Stale)}
    let (_,start)=process_facts(pid)?;eq(field(res,"controller")?,&object(vec![("pid",string(&pid.to_string())),("startTicks",string(&start.to_string())),("bootId",field(field(&current.record,"environment")?,"bootId")?.clone())]))?;
    if decimal(field(res,"reservedBoottimeNs")?)?>now()?{return invalid()}
    let p=trust.registry_root.path.join(format!(".workspacectl-lock-{}",sha256(trust.registry_root.path.as_os_str().as_encoded_bytes())));let cap=RegistryCapture::capture_with_parent(p.clone(),&registry_parent)?;let f=openat(&open_directory(&trust.registry_root.path)?,basename_of(&p)?,libc::O_RDWR|libc::O_NONBLOCK)?;
    if !same_file(&cap.facts,&metadata(&f)?)||unsafe{libc::flock(f.as_raw_fd(),libc::LOCK_EX|libc::LOCK_NB)}==0{return Err(Failure::Stale)}if std::io::Error::last_os_error().raw_os_error()!=Some(libc::EWOULDBLOCK){return Err(Failure::Unsupported)}captures.push(cap);None
 }else{Some(registry_lock(&trust)?)};
 h.recheck()?;c.recheck()?;for cap in &captures{cap.recheck()?;absent(&pending(&cap.path))?;}witness.recheck()?;life.recheck()?;
 let fresh=read_trust(&root)?;if fresh.bytes!=trust.bytes{return Err(Failure::Stale)}
 // startup::launch retains the first reserve Completion (and therefore its
 // preflight captures and registry lock) while it performs the private
 // same-controller admission recapture. In that exact path, this fresh h/c
 // pair is already an independent complete under-lock pass; constructing a
 // third full history would only duplicate target descriptors and exceed the
 // supported 4096 soft limit. Child-process admissions do not own that first
 // Completion, so they retain the existing separate recapture below.
 let same_controller_admission=admission.is_some_and(|(controller,_)|controller==std::process::id());
 let under=if same_controller_admission{None}else{Some(capture(&fresh,&prior,&operation,&approve)?.1)};
 h.recheck()?;c.recheck()?;if let Some(under)=&under{under.recheck()?;}
 captures.extend(h.captures);
 let bytes=if let Some((_,bytes))=admission{bytes.to_vec()}else{
    absent(&trust.registry_root.path.join(format!("{tid}.reserved.json")))?;absent(&trust.registry_root.path.join(format!("{tid}.reserved.json.pending")))?;
    let (_,start)=process_facts(pid)?;let res=object(vec![("apiVersion",string("workspace-governance/init-trial-reservation-v1")),("trialId",string(&tid)),("trialSha256",string(&sha256(&current.bytes))),("state",string("consumed/reserved")),("attemptId",string(&random()?)),("approvalDigest",string(&approve)),("controller",object(vec![("pid",string(&pid.to_string())),("startTicks",string(&start.to_string())),("bootId",field(field(&current.record,"environment")?,"bootId")?.clone())])),("reservedBoottimeNs",string(&now()?.to_string()))]);let bytes=wire(&res)?;
    witness.recheck()?;life.recheck()?;publish(&trust.registry_root.path,&format!("{tid}.reserved.json"),&bytes)?;captures.push(RegistryCapture::capture_with_parent(trust.registry_root.path.join(format!("{tid}.reserved.json")),&registry_parent)?);bytes
 };
 let done=Completion{bytes,_lock:lock,captures,recovery:Some(c)};done.recheck()?;Ok(done)
}
