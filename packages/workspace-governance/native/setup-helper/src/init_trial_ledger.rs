//! Initial, native-admission-owned strict trial transaction. No recovery path.
//! Pre-journal reservations follow AM 245-250 conservatively; never reconstructed.
use super::*;
use std::collections::BTreeMap;
use std::io::Write;
use crate::init::trial_protocol::Terminal;

fn lf(v:&Value)->Result<Vec<u8>> { let mut b=wire(v)?;b.push(b'\n');Ok(b) }
fn payload(b:&[u8])->Value { object(vec![("encoding",string("base64-chunks-v1")),("byteLength",n(b.len() as u64)),("sha256",string(&sha256(b))),("chunks",Value::Array(b.chunks(12288).map(|x|string(&STANDARD.encode(x))).collect()))]) }
fn set(v:&mut Value,k:&str,x:Value)->Result<()> {if let Value::Object(a)=v {for (key,value) in a {if *key==k.encode_utf16().collect::<Vec<_>>() {*value=x;return Ok(())}}}invalid()}
fn name(p:&Path)->Result<&str>{p.file_name().and_then(|s|s.to_str()).ok_or(Failure::Invalid)}
fn absent(p:&Path)->Result<()> {match std::fs::symlink_metadata(p){Err(e) if e.kind()==std::io::ErrorKind::NotFound=>Ok(()),_=>Err(Failure::Stale)}}
// Each slot owns its entire subtree. In particular, state owns every fixed
// bookkeeping final/pending and directory, so none can alias a manifest slot
// or a lock. Internal finals have non-dot fixed basenames (or six-digit JSON
// sequence names); their dot-prefixed pending names are distinct in each parent.
// Admission already checks literal paths, no-alias ancestry and independent
// parents. Do not reserve a basename prefix: equal names in disjoint parents
// and nearby names are valid. This is an identity-free, no-write preflight.
fn disjoint_namespaces(slots:&[PathBuf])->Result<()> {
 for (i,a) in slots.iter().enumerate() {for b in &slots[i+1..] {
  if a.starts_with(b)||b.starts_with(a){return invalid()}
 }}
 Ok(())
}
#[cfg(test)]
mod namespace_tests {
 use super::*;
 #[test]
 fn all_external_slot_intersections_refuse() {
  let slots:Vec<PathBuf>=["/fixture/m/final","/fixture/m/temporary","/fixture/s/state","/fixture/m/lock","/fixture/s/lock"].iter().map(PathBuf::from).collect();
  assert!(disjoint_namespaces(&slots).is_ok());
  for i in 0..slots.len() {for j in i+1..slots.len() {
   for nested in [false,true] {
    let mut bad=slots.clone();bad[j]=if nested {bad[i].join("child")}else{bad[i].clone()};
    assert!(disjoint_namespaces(&bad).is_err(),"{i}/{j}/{nested}");
    bad.swap(i,j);assert!(disjoint_namespaces(&bad).is_err());
   }
  }}
 }
 #[test]
 fn operation_derived_equality_not_prefix_or_basename_blacklist() {
  for id in ["synthetic-issue","another-operation","a"] {
   let temporary=PathBuf::from(format!("/fixture/m/.workspacectl-init-{id}.pending"));
   assert!(disjoint_namespaces(&[temporary.clone(),temporary.clone()]).is_err());
   assert!(disjoint_namespaces(&[temporary.clone(),PathBuf::from(format!("{}.safe",temporary.display()))]).is_ok());
   assert!(disjoint_namespaces(&[temporary.clone(),Path::new("/fixture/s").join(temporary.file_name().unwrap())]).is_ok());
  }
 }
 #[test]
 fn fixed_bookkeeping_final_pending_slots_are_unique() {
  let root=Path::new("/fixture/state");let operation=root.join("operations/id");
  let mut finals=vec![root.join("state.json")];
  for relative in ["proposal.json","context.json","owner.json","result.json","captures/request.json","captures/manifest-before.json","captures/trial-intent.json","captures/trial-record.json","captures/candidate-manifest.json","captures/trial-anchor.json","captures/approved-plan.json","payloads/manifest-after.json","payloads/state.json"] {finals.push(operation.join(relative));}
  for sequence in 1..=256 {for parent in ["evidence","events"] {finals.push(operation.join(format!("{parent}/{sequence:06}.json")));}}
  let mut slots=finals.clone();for p in finals {slots.push(p.with_file_name(format!(".{}.pending",name(&p).unwrap())));}
  assert!(disjoint_namespaces(&slots).is_ok());
  // No file slot may be an ancestor of, or equal to, a reserved directory.
  for directory in [root.to_owned(),root.join("operations"),operation.clone(),operation.join("captures"),operation.join("payloads"),operation.join("evidence"),operation.join("events")] {
   assert!(slots.iter().all(|p| !directory.starts_with(p)));
  }
 }
}
struct Witness { expected:Value, file:Option<File>, parent:File }
impl Witness {
 fn capture(p:&Path,expected:Value)->Result<Self>{
  let parent=open_directory(p.parent().ok_or(Failure::Invalid)?)?;
  let file=if text(field(&expected,"kind")?)?=="absent"{None}else{Some(openat(&parent,name(p)?,libc::O_PATH)?)};
  let w=Self{expected,file,parent};w.check(p)?;Ok(w)
 }
 fn check(&self,p:&Path)->Result<()> {
  let parent=open_directory(p.parent().ok_or(Failure::Invalid)?)?;
  let a=metadata(&self.parent)?;let b=metadata(&parent)?;
  if (a.dev(),a.ino(),mount_id(&self.parent)?)!=(b.dev(),b.ino(),mount_id(&parent)?){return Err(Failure::Stale)}
  eq(&resource(p,Some(field(&self.expected,"treeDigest")?))?,&self.expected).map_err(|_|Failure::Stale)?;
  if let Some(f)=&self.file {
   let named=openat(&parent,name(p)?,libc::O_PATH)?;let a=metadata(f)?;let b=metadata(&named)?;
   if (a.dev(),a.ino(),mount_id(f)?)!=(b.dev(),b.ino(),mount_id(&named)?){return Err(Failure::Stale)}
  }
  Ok(())
 }
}
/// Private constructor is reached only after full under-lock native admission.
/// Expected resource evolution is restricted to owned allocations/renames and
/// one parent nlink increment per exclusive mkdir. Original plan is never edited.
pub(super) struct Ledger {
 admission:Admission, stopped:Arc<AtomicU8>, until:Instant,
 plan:Value, record:Value, intent:Vec<u8>, candidate_bytes:Vec<u8>,
 expected:BTreeMap<PathBuf,Witness>, owned:BTreeMap<PathBuf,bool>,
 state:PathBuf, manifest:PathBuf, operation:PathBuf, temporary:PathBuf,
 files:Vec<(PathBuf,Vec<u8>,usize)>, manifest_bytes:Vec<u8>,state_bytes:Vec<u8>,
 sequence:u32, previous:Value, operation_id:String,digest:String, action:Value,
 used:usize, reserved:usize, record_ceiling:usize, terminal:Terminal,
}
impl Ledger {
 pub(super) fn prepare(a:Admission,stopped:Arc<AtomicU8>,until:Instant)->Result<Self>{
  let (record,pb)=saved(&a)?;let plan=json(&pb)?;let context=field(&plan,"context")?;
  literal_eq(field(field(&record,"invocation")?,"mode")?,"apply")?;
  let operation_id=text(field(field(&record,"invocation")?,"operationId")?)?;
  let digest=text(field(&plan,"digest")?)?;
  let state=path(field(context,"stateDir")?)?;let manifest=path(field(context,"manifestPath")?)?;
  let operation=state.join("operations").join(&operation_id);
  let temporary=manifest.parent().ok_or(Failure::Invalid)?.join(format!(".workspacectl-init-{operation_id}.pending"));
  let mut slots=vec![manifest.clone(),temporary.clone(),state.clone()];
  if let Value::Array(locks)=field(field(&plan,"bookkeeping")?,"lockPaths")? {for lock in locks {slots.push(path(lock)?);}}else{return invalid()}
  // prepare runs both before transaction lock creation and after acquisition.
  disjoint_namespaces(&slots)?;absent(&state)?;absent(&temporary)?;
  let startup=json(&a.bytes)?;let trial=reference(field(&startup,"trial")?)?;
  let stem=trial.file_stem().and_then(|s|s.to_str()).ok_or(Failure::Invalid)?;
  let registry=trial.parent().ok_or(Failure::Invalid)?;
  let intent_bytes=read_file(&registry.join(format!("{stem}.intent.json")),262144,0o600)?;
  let candidate_bytes=read_file(&registry.join(format!("{stem}.candidate.json")),262144,0o600)?;
  let trust=read_trust(&a.root)?;let (_,fixture)=intent(&intent_bytes,&trust)?;
  let manifest_bytes=crate::init::derive_manifest(&fixture.request_bytes).map_err(|_|Failure::Invalid)?;
  let state_bytes=crate::init::derive_rootless_state(&fixture.request_bytes).map_err(|_|Failure::Invalid)?;
  let before=if std::fs::symlink_metadata(&manifest).is_ok(){payload(&read_file(&manifest,262144,0o600)?)}else{Value::Null};
  let actions=field(&plan,"actions")?;let action=match actions{Value::Array(v) if v.len()<=1=>v.first().map(|x|field(x,"id").cloned()).transpose()?.unwrap_or(Value::Null),_=>return invalid()};
  let reserved=json(&a.records.bytes)?;
  let owner=object(vec![("operationId",string(&operation_id)),("proposalDigest",string(&digest)),("pid",string(&std::process::id().to_string())),("bootId",field(field(&record,"environment")?,"bootId")?.clone()),("processStartTicks",string(&process_facts(std::process::id())?.1.to_string())),("nonce",field(&reserved,"attemptId")?.clone())]);
  let mut files=vec![(operation.join("proposal.json"),lf(&plan)?,2097152),(operation.join("context.json"),lf(context)?,65536),(operation.join("owner.json"),lf(&owner)?,262144)];
  let mut capture_total=0usize;
  for (relative,value) in [
   ("captures/request.json",payload(&fixture.request_bytes)),("captures/manifest-before.json",before),
   ("captures/trial-intent.json",payload(&intent_bytes)),("captures/trial-record.json",payload(&read_file(&trial,262144,0o600)?)),
   ("captures/candidate-manifest.json",payload(&candidate_bytes)),("captures/trial-anchor.json",payload(&trust.bytes)),
   ("captures/approved-plan.json",payload(&pb)),("payloads/manifest-after.json",payload(&manifest_bytes)),("payloads/state.json",payload(&state_bytes))] {
   let bytes=lf(&value)?;capture_total=capture_total.checked_add(bytes.len()).ok_or(Failure::Limit)?;files.push((operation.join(relative),bytes,2097152));
  }
  // Serialize sizing-only maxima: dev/ino are bounded u64 decimals, digests
  // exactly 64 ASCII bytes, and every runtime path/reference is already fixed.
  // These values are NEVER persisted as evidence or treated as observed facts.
  let max_fact=object(vec![("identity",object(vec![("dev",string(&u64::MAX.to_string())),("ino",string(&u64::MAX.to_string()))])),("mode",string("0600")),("sha256",string(&"f".repeat(64))),("treeDigest",Value::Null)]);
  let mut record_ceiling=0usize;
  for target in [&manifest,&state.join("state.json"),&operation.join("result.json")] {
   for phase in ["prepared","file-intent","file-published","complete","interrupted","needs-attention"] {
    let evidence=object(vec![("apiVersion",string("workspace-governance/init-trial-setup-evidence-v1")),("operationId",string(&operation_id)),("proposalDigest",string(&digest)),("sequence",n(256)),("actionId",string(&"f".repeat(64))),("phase",string(phase)),("resource",Self::file_resource(target,max_fact.clone(),Some("payloads/manifest-after.json"))?),("stage",Value::Null),("clone",Value::Null),("child",Value::Null)]);
    record_ceiling=record_ceiling.max(lf(&evidence)?.len());
    let event=object(vec![("apiVersion",string("workspace-governance/init-trial-journal-event-v1")),("sequence",n(256)),("previousEventDigest",string(&"f".repeat(64))),("operationId",string(&operation_id)),("proposalDigest",string(&digest)),("actionId",string(&"f".repeat(64))),("event",string(phase)),("evidenceDigest",string(&"f".repeat(64))),("evidenceRef",string("evidence/000256.json"))]);
    record_ceiling=record_ceiling.max(lf(&event)?.len());
   }
  }
  let max_result=object(vec![("apiVersion",string("workspace-governance/init-trial-setup-result-v1")),("operationId",string(&operation_id)),("proposalDigest",string(&digest)),("state",string("needs-attention")),("actions",Value::Array(vec![object(vec![("id",string(&"f".repeat(64))),("state",string("uncertain")),("evidenceRef",string("evidence/000256.json"))])])),("manifestRevision",string(&"f".repeat(64))),("checkout",Value::Null)]);
  record_ceiling=record_ceiling.max(lf(&max_result)?.len());
  if record_ceiling>2097152{return Err(Failure::Limit)}
  // Six normal events maximum, plus two shutdown records and singleton result.
  let reserved=8*2*record_ceiling+record_ceiling;
  let base=files.iter().try_fold(0usize,|total,(_,b,max)|if b.len()>*max {Err(Failure::Limit)}else{total.checked_add(b.len()).ok_or(Failure::Limit)})?;
  if capture_total>2097152 || base+reserved+manifest_bytes.len()+state_bytes.len()>16777216 {return Err(Failure::Limit)}
  for p in [manifest.parent().ok_or(Failure::Invalid)?,state.parent().ok_or(Failure::Invalid)?] {
   let dir=open_directory(p)?;let mut s:libc::statvfs=unsafe{std::mem::zeroed()};
   if unsafe{libc::fstatvfs(dir.as_raw_fd(),&mut s)}!=0{return Err(Failure::Unsupported)}
   if (s.f_bavail as u128)*(s.f_frsize as u128)<1073741824u128+(base+reserved) as u128{return Err(Failure::Limit)}
  }
  let mut expected=BTreeMap::new();
  if let Value::Array(resources)=field(&plan,"resources")? {for r in resources {let p=path(field(r,"path")?)?;expected.insert(p.clone(),Witness::capture(&p,r.clone())?);}}else{return invalid()}
  // Retain original input plan path as well as the registry's immutable copy.
  let inputs=json(&read_file(&registry.join(format!("{stem}.inputs.json")),262144,0o600)?)?;
  for (k,bytes) in [("planPath",&pb),("candidatePath",&candidate_bytes),("intentPath",&intent_bytes)] {
   let p=path(field(&inputs,k)?)?;
   let witness=Witness::capture(&p,resource(&p,None)?)?;
   if read_file(&p,262144,0o600)?!=*bytes{return Err(Failure::Stale)}
   witness.check(&p)?;expected.insert(p,witness);
  }
  if let Value::Array(locks)=field(field(&plan,"bookkeeping")?,"lockPaths")? {for lock in locks {let p=path(lock)?;expected.insert(p.clone(),Witness::capture(&p,resource(&p,None)?)?);}}else{return invalid()}
  expected.insert(temporary.clone(),Witness::capture(&temporary,resource(&temporary,None)?)?);
  let mut ledger=Self{admission:a,stopped,until,plan,record,intent:intent_bytes,candidate_bytes,expected,owned:BTreeMap::new(),state,manifest,operation,temporary,files,manifest_bytes,state_bytes,sequence:0,previous:Value::Null,operation_id,digest,action,used:0,reserved,record_ceiling,terminal:Terminal::new()};
  ledger.gate(false)?;Ok(ledger)
 }
 fn gate(&mut self,terminal:bool)->Result<()> {
  if Instant::now()>=self.until{return Err(Failure::Stale)}
  if !terminal {stopped(&self.stopped)?;}
  self.admission.live()?;
  let trust=read_trust(&self.admission.root)?;
  candidate(&self.candidate_bytes,&trust)?;
  intent(&self.intent,&trust)?;
  for (p,w) in &self.expected {w.check(p)?;}
  // Exact membership of owned directories, including pending allocations. An
  // unexpected file/directory can never be adopted as self-generated progress.
  for (p,isdir) in &self.owned {if *isdir {
   for entry in std::fs::read_dir(p).map_err(|_|Failure::Stale)? {
    let q=entry.map_err(|_|Failure::Stale)?.path();if !self.owned.contains_key(&q){return Err(Failure::Stale)}
   }
  }}
  self.admission.live()?;if !terminal {stopped(&self.stopped)?;}Ok(())
 }
 fn parent(&self,p:&Path)->Result<(File,crate::fs::SafeDir)> {
  let parent=p.parent().ok_or(Failure::Invalid)?;let file=open_directory(parent)?;
  let safe=crate::fs::SafeDir::open(parent).map_err(|_|Failure::Unsupported)?;
  let a=metadata(&file)?;let b=metadata(safe.file())?;
  if (a.dev(),a.ino(),mount_id(&file)?)!=(b.dev(),b.ino(),mount_id(safe.file())?){return Err(Failure::Stale)}
  // Both independently opened handles must resolve the retained named parent.
  if let Some(w)=self.expected.get(parent){w.check(parent)?;}
  Ok((file,safe))
 }
 fn observe(&mut self,p:&Path,file:File,isdir:bool,bytes:Option<&[u8]>)->Result<()> {
  let m=metadata(&file)?;
  if m.uid()!=unsafe{libc::geteuid()} || m.mode()&0o7777!=if isdir{0o700}else{0o600} || (!isdir&&m.nlink()!=1) || m.is_dir()!=isdir {return Err(Failure::Stale)}
  let r=resource(p,None)?;
  eq(field(&r,"identity")?,&object(vec![("dev",string(&m.dev().to_string())),("ino",string(&m.ino().to_string()))]))?;
  if let Some(b)=bytes {if read_file(p,2097152,0o600)?!=b{return Err(Failure::Stale)}}
  let mut witness=Witness::capture(p,r)?;witness.file=Some(file);witness.check(p)?;
  self.expected.insert(p.to_owned(),witness);self.owned.insert(p.to_owned(),isdir);Ok(())
 }
 fn mkdir(&mut self,p:&Path)->Result<()> {
  self.gate(false)?;absent(p)?;let (parent,safe)=self.parent(p)?;
  let old=resource(p.parent().ok_or(Failure::Invalid)?,None)?;
  let cname=cstr(name(p)?)?;
  if unsafe{libc::mkdirat(parent.as_raw_fd(),cname.as_ptr(),0o700)}!=0{return Err(Failure::Unsupported)}
  let file=openat(&parent,name(p)?,libc::O_RDONLY|libc::O_DIRECTORY)?;file.sync_all().map_err(|_|Failure::Unsupported)?;safe.sync().map_err(|_|Failure::Unsupported)?;
  let pp=p.parent().ok_or(Failure::Invalid)?.to_owned();let mut after=old.clone();let mut fs=field(&after,"filesystem")?.clone();let links=decimal(field(&fs,"nlink")?)?;
  set(&mut fs,"nlink",string(&(links+1).to_string()))?;set(&mut after,"filesystem",fs)?;
  eq(&resource(&pp,None)?,&after).map_err(|_|Failure::Stale)?;
  if let Some(w)=self.expected.get_mut(&pp){w.expected=after;}else{self.expected.insert(pp.clone(),Witness::capture(&pp,after)?);}
  self.observe(p,file,true,None)?;self.gate(false)
 }
 fn publish(&mut self,p:&Path,bytes:&[u8],limit:usize,terminal:bool)->Result<Value>{
  if bytes.len()>limit || self.used.checked_add(bytes.len()).ok_or(Failure::Limit)?+self.reserved>16777216{return Err(Failure::Limit)}
  self.gate(terminal)?;absent(p)?;
  let temp=if p==self.manifest{self.temporary.clone()}else{p.with_file_name(format!(".{}.pending",name(p)?))};absent(&temp)?;
  let (parent,safe)=self.parent(p)?;let cname=cstr(name(&temp)?)?;
  let fd=unsafe{libc::openat(parent.as_raw_fd(),cname.as_ptr(),libc::O_WRONLY|libc::O_CREAT|libc::O_EXCL|libc::O_NOFOLLOW|libc::O_CLOEXEC,0o600)};
  if fd<0{return Err(Failure::Unsupported)}
  let mut file=unsafe{File::from_raw_fd(fd)};
  file.write_all(bytes).map_err(|_|Failure::Unsupported)?;file.sync_all().map_err(|_|Failure::Unsupported)?;
  self.observe(&temp,file,false,Some(bytes))?;
  self.gate(terminal)?;absent(p)?;
  safe.rename_noreplace(name(&temp)?,&safe,name(p)?).map_err(|_|Failure::Unsupported)?;
  safe.sync().map_err(|_|Failure::Unsupported)?;
  let witness=self.expected.remove(&temp).ok_or(Failure::Stale)?;self.owned.remove(&temp);
  self.observe(p,witness.file.ok_or(Failure::Stale)?,false,Some(bytes))?;
  absent(&temp)?;
  self.expected.insert(temp.clone(),Witness::capture(&temp,resource(&temp,None)?)?);
  self.used+=bytes.len();self.gate(terminal)?;self.fact(p)
 }
 fn fact(&self,p:&Path)->Result<Value>{
  let r=&self.expected.get(p).ok_or(Failure::Stale)?.expected;
  Ok(object(vec![("identity",field(r,"identity")?.clone()),("mode",field(field(r,"filesystem")?,"mode")?.clone()),("sha256",field(r,"sha256")?.clone()),("treeDigest",Value::Null)]))
 }
 fn transition(&mut self,phase:&str,id:Value,resource:Value,terminal:bool)->Result<String>{
  if self.sequence>=256{return Err(Failure::Limit)}let sequence=self.sequence+1;let reference=format!("evidence/{sequence:06}.json");
  let evidence=object(vec![("apiVersion",string("workspace-governance/init-trial-setup-evidence-v1")),("operationId",string(&self.operation_id)),("proposalDigest",string(&self.digest)),("sequence",n(sequence as u64)),("actionId",id.clone()),("phase",string(phase)),("resource",resource),("stage",Value::Null),("clone",Value::Null),("child",Value::Null)]);
  let eb=lf(&evidence)?;
  let event=object(vec![("apiVersion",string("workspace-governance/init-trial-journal-event-v1")),("sequence",n(sequence as u64)),("previousEventDigest",self.previous.clone()),("operationId",string(&self.operation_id)),("proposalDigest",string(&self.digest)),("actionId",id),("event",string(phase)),("evidenceDigest",string(&sha256(&eb))),("evidenceRef",string(&reference))]);let vb=lf(&event)?;
  // This tighter preflight ceiling is a bounded first-create implementation limit.
  if eb.len()>self.record_ceiling||vb.len()>self.record_ceiling{return Err(Failure::Limit)}
  self.publish(&self.operation.join(&reference),&eb,2097152,terminal)?;
  self.publish(&self.operation.join(format!("events/{sequence:06}.json")),&vb,2097152,terminal)?;
  self.sequence=sequence;self.previous=string(&sha256(&vb));Ok(reference)
 }
 fn file_resource(p:&Path,after:Value,reference:Option<&str>)->Result<Value>{Ok(object(vec![("path",string(literal(p)?)),("before",Value::Null),("after",after),("payloadRef",reference.map(string).unwrap_or(Value::Null))]))}
 fn effect(&mut self,p:&Path,bytes:&[u8],reference:&str,id:Value)->Result<String>{
  self.transition("file-intent",id.clone(),Self::file_resource(p,Value::Null,Some(reference))?,false)?;
  let fact=self.publish(p,bytes,262144,false)?;
  self.transition("file-published",id,Self::file_resource(p,fact,Some(reference))?,false)
 }
 pub(super) fn run(&mut self)->Result<Value>{
  for p in [self.state.clone(),self.state.join("operations"),self.operation.clone(),self.operation.join("captures"),self.operation.join("payloads"),self.operation.join("evidence"),self.operation.join("events")] {self.mkdir(&p)?;}
  for (p,b,max) in self.files.clone(){self.publish(&p,&b,max,false)?;}
  self.transition("prepared",Value::Null,Value::Null,false)?;
  self.effect(&self.state.join("state.json"),&self.state_bytes.clone(),"payloads/state.json",Value::Null)?;
  let action_ref=if self.action!=Value::Null {Some(self.effect(&self.manifest.clone(),&self.manifest_bytes.clone(),"payloads/manifest-after.json",self.action.clone())?)}else{None};
  self.gate(false)?;
  if read_file(&self.manifest,262144,0o600)?!=self.manifest_bytes{return Err(Failure::Stale)}
  let actions=action_ref.map(|r|vec![object(vec![("id",self.action.clone()),("state",string("verified")),("evidenceRef",string(&r))])]).unwrap_or_default();
  let result=object(vec![("apiVersion",string("workspace-governance/init-trial-setup-result-v1")),("operationId",string(&self.operation_id)),("proposalDigest",string(&self.digest)),("state",string("verified")),("actions",Value::Array(actions)),("manifestRevision",string(&sha256(&self.manifest_bytes))),("checkout",Value::Null)]);
  // Keep the immutable plan/record bindings alive and verify action order at terminalization.
  literal_eq(field(&self.plan,"digest")?,&self.digest)?;literal_eq(field(field(&self.record,"invocation")?,"approvalDigest")?,&self.digest)?;
  let rb=lf(&result)?;if rb.len()>self.record_ceiling{return Err(Failure::Limit)}
  let target=self.operation.join("result.json");let fact=self.publish(&target,&rb,2097152,false)?;
  self.gate(false)?;
  // CAS is the terminal entry linearization with the concurrent reader. Stop
  // values 1/2 cannot become active. Value 3 queues later cancel/EOF unchanged.
  if self.stopped.compare_exchange(0,3,Ordering::SeqCst,Ordering::SeqCst).is_err(){self.terminal.cancel();return Err(Failure::Stale)}
  if !self.terminal.enter_terminal(){return Err(Failure::Stale)}
  let barriers=self.transition("complete",Value::Null,Self::file_resource(&target,fact,None)?,true);
  self.terminal.finish(barriers.is_ok());barriers?;
  self.terminal.finalize_reply().ok_or(Failure::Stale)?;Ok(result)
 }
}
