//! DEVELOPMENT CANDIDATE ONLY. Source-included by an external test executable;
//! deliberately absent from lib.rs, production targets, CLI and package exports.
//! This bounded engine is NOT the init wire supervisor or qualification authority.
use crate::{init, safe_fs::SafeDir};
use sha2::{Digest, Sha256};
use std::{ffi::CString, fs::{File, OpenOptions}, io::{Read,Write}, os::{fd::{AsRawFd,FromRawFd},unix::fs::{MetadataExt,OpenOptionsExt}}, path::Path};
#[derive(Debug,PartialEq,Eq)]
pub enum Error { Invalid, Occupied, NeedsAttention, Io }
#[derive(Debug,PartialEq,Eq)]
pub enum Outcome { Created, AlreadyInitialized }
type Result<T> = std::result::Result<T,Error>;
fn io(_: std::io::Error)->Error { Error::Io }
fn hash(bytes:&[u8])->String { format!("{:x}",Sha256::digest(bytes)) }
fn name(s:&str)->Result<CString> {
    if s.is_empty() || s.len()>255 || s=="." || s==".." || s.contains('/') {return Err(Error::Invalid)}
    CString::new(s).map_err(|_|Error::Invalid)
}
struct Dir { file:File, safe:SafeDir }
impl Dir {
    fn open(path:&Path)->Result<Self> {
        let safe=SafeDir::open(path).map_err(|_|Error::Invalid)?;
        let file=OpenOptions::new().read(true).custom_flags(libc::O_DIRECTORY|libc::O_NOFOLLOW|libc::O_CLOEXEC).open(path).map_err(io)?;
        Ok(Self{file,safe})
    }
    fn sync(&self)->Result<()> {self.file.sync_all().map_err(io)}
    fn read(&self,n:&str)->Result<Option<(Vec<u8>,String)>> {
        let n=name(n)?;
        // SAFETY: valid owned directory and NUL-terminated basename; no creation.
        let fd=unsafe{libc::openat(self.file.as_raw_fd(),n.as_ptr(),libc::O_RDONLY|libc::O_NOFOLLOW|libc::O_CLOEXEC|libc::O_NONBLOCK)};
        if fd<0 {return if std::io::Error::last_os_error().raw_os_error()==Some(libc::ENOENT){Ok(None)}else{Err(Error::NeedsAttention)}}
        // SAFETY: successful openat transfers one fresh descriptor.
        let mut f=unsafe{File::from_raw_fd(fd)};
        let m=f.metadata().map_err(io)?;
        // SAFETY: geteuid has no preconditions.
        if !m.is_file()||m.nlink()!=1||m.uid()!=unsafe{libc::geteuid()}||m.mode()&0o7777!=0o600||m.len()>262144 {return Err(Error::NeedsAttention)}
        let mut bytes=Vec::new(); (&mut f).take(262145).read_to_end(&mut bytes).map_err(io)?;
        if bytes.len()>262144{return Err(Error::NeedsAttention)}
        let identity=format!("{}:{}:{}:{}",m.dev(),m.ino(),m.mode()&0o7777,hash(&bytes));
        Ok(Some((bytes,identity)))
    }
    fn write(&self,n:&str,bytes:&[u8])->Result<()> {
        if bytes.len()>262144{return Err(Error::Invalid)}
        let temp=format!(".{n}.tmp"); let c=name(&temp)?;
        // SAFETY: owned descriptor/name and mode for exclusive create.
        let fd=unsafe{libc::openat(self.file.as_raw_fd(),c.as_ptr(),libc::O_WRONLY|libc::O_NOFOLLOW|libc::O_CLOEXEC|libc::O_CREAT|libc::O_EXCL,0o600)};
        if fd<0{return Err(Error::NeedsAttention)}
        // SAFETY: fresh descriptor transferred exactly once.
        let mut f=unsafe{File::from_raw_fd(fd)}; f.write_all(bytes).map_err(io)?; f.sync_all().map_err(io)?;
        self.safe.rename_noreplace(&temp,&self.safe,n).map_err(|_|Error::NeedsAttention)?;
        self.sync()
    }
    fn mkdir(&self,n:&str)->Result<()> {
        let c=name(n)?;
        // SAFETY: owned descriptor, valid basename, explicit private mode.
        if unsafe{libc::mkdirat(self.file.as_raw_fd(),c.as_ptr(),0o700)}!=0{return Err(Error::NeedsAttention)}
        self.sync()
    }
    fn sync_file(&self,n:&str)->Result<()> {
        self.read(n)?.ok_or(Error::NeedsAttention)?;
        let c=name(n)?;
        // SAFETY: checked regular file in held directory; no create/truncate flags.
        let fd=unsafe{libc::openat(self.file.as_raw_fd(),c.as_ptr(),libc::O_RDONLY|libc::O_NOFOLLOW|libc::O_CLOEXEC|libc::O_NONBLOCK)};
        if fd<0{return Err(Error::Io)}
        // SAFETY: unique newly returned descriptor.
        unsafe{File::from_raw_fd(fd)}.sync_all().map_err(io)
    }
    fn identity(&self)->Result<String> {let m=self.file.metadata().map_err(io)?; Ok(format!("{}:{}",m.dev(),m.ino()))}
}
fn exact(dir:&Dir,n:&str,expected:&[u8])->Result<String> {
    let (bytes,fact)=dir.read(n)?.ok_or(Error::NeedsAttention)?;
    if bytes!=expected{return Err(Error::NeedsAttention)}
    Ok(fact)
}
// Quiescent-owner development contract: same-UID concurrent namespace mutation
// and coherently rewritten unkeyed ledgers are not authenticated provenance.
fn terminal_inventory(op:&Dir)->Result<()> {
    // Interrupted exclusive temporary publication is uncertain. Never create or
    // publish anything before recognizing every final/pending/staging path.
    for n in ["request.json","state.json","prepared.json","noop.json","intent.json","allocation.json","published.json","result.pending","result-identity.json","result.json","complete.json"] {
        if op.read(&format!(".{n}.tmp"))?.is_some(){return Err(Error::NeedsAttention)}
    }
    let result=op.read("result.json")?.is_some();
    if op.read("result.pending")?.is_some() || op.read("result-identity.json")?.is_some()!=result {
        return Err(Error::NeedsAttention)
    }
    Ok(())
}
fn replay(dir:&Dir,op:&Dir,request:&[u8],state:&[u8],manifest:&[u8],binding:&str)->Result<Outcome> {
    terminal_inventory(op)?;
    for n in [".bootstrap.json.tmp",".operation-identity.json.tmp",".manifest.pending.tmp"] {
        if dir.read(n)?.is_some(){return Err(Error::NeedsAttention)}
    }
    let boot=record("directory-intent",binding,"",""); exact(dir,"bootstrap.json",&boot)?;
    let identity=record("directory-created",binding,&hash(&boot),&op.identity()?); exact(dir,"operation-identity.json",&identity)?;
    exact(op,"request.json",request)?; exact(op,"state.json",state)?;
    let prepared=record("prepared",binding,&hash(&identity),&hash(manifest)); exact(op,"prepared.json",&prepared)?;
    if op.read("noop.json")?.is_some() {
        return noop(dir,op,manifest,binding,&prepared,false);
    }
    let intent=record("file-intent",binding,&hash(&prepared),&hash(manifest)); exact(op,"intent.json",&intent)?;
    let target=dir.read("manifest.json")?;
    let pending=dir.read("manifest.pending")?;
    if target.is_some() && pending.is_some(){return Err(Error::NeedsAttention)}
    let (bytes,fact)=target.as_ref().or(pending.as_ref()).ok_or(Error::NeedsAttention)?;
    if bytes!=manifest{return Err(Error::NeedsAttention)}
    let allocation=record("file-allocated",binding,&hash(&intent),fact); exact(op,"allocation.json",&allocation)?;
    let published=record("file-published",binding,&hash(&allocation),fact);
    let result=record("result-candidate",binding,&hash(&published),fact);
    let has_published=op.read("published.json")?.is_some();
    let has_result=op.read("result.json")?.is_some();
    let has_complete=op.read("complete.json")?.is_some();
    if (has_result && !has_published)||(has_complete && !has_result)||(has_published && target.is_none()){return Err(Error::NeedsAttention)}
    // Validate every existing terminal record BEFORE publishing anything missing.
    if has_published {exact(op,"published.json",&published)?;}
    if has_result {verify_result(op,&result,binding)?;}
    if has_complete {
        let result_fact=exact(op,"result.json",&result)?;
        exact(op,"complete.json",&record("complete",binding,&hash(&result),&result_fact))?;
    }
    if target.is_none() {
        dir.sync_file("manifest.pending")?;
        dir.safe.rename_noreplace("manifest.pending",&dir.safe,"manifest.json").map_err(|_|Error::Occupied)?;
    }
    dir.sync_file("manifest.json")?; dir.sync()?;
    if exact(dir,"manifest.json",manifest)?!=*fact{return Err(Error::NeedsAttention)}
    if !has_published {op.write("published.json",&published)?;}
    if !has_result {publish_result(op,&result,binding)?;}
    let result_fact=exact(op,"result.json",&result)?;
    if !has_complete {op.write("complete.json",&record("complete",binding,&hash(&result),&result_fact))?;}
    for n in ["manifest.json","bootstrap.json","operation-identity.json"]{dir.sync_file(n)?;} dir.sync()?;
    for n in ["request.json","state.json","prepared.json","intent.json","allocation.json","published.json","result-identity.json","result.json","complete.json"]{op.sync_file(n)?;} op.sync()?;
    Ok(Outcome::Created)
}
fn noop(dir:&Dir,op:&Dir,manifest:&[u8],binding:&str,prepared:&[u8],create:bool)->Result<Outcome> {
    for n in ["intent.json","allocation.json","published.json"] {
        if op.read(n)?.is_some(){return Err(Error::NeedsAttention)}
    }
    for n in ["manifest.pending",".manifest.pending.tmp"] {
        if dir.read(n)?.is_some(){return Err(Error::NeedsAttention)}
    }
    let fact=exact(dir,"manifest.json",manifest)?;
    let observed=record("file-observed",binding,&hash(prepared),&fact);
    let result=record("result-noop",binding,&hash(&observed),&fact);
    if create {op.write("noop.json",&observed)?; publish_result(op,&result,binding)?;}
    exact(op,"noop.json",&observed)?;
    let result_fact=verify_result(op,&result,binding)?;
    let complete=record("complete",binding,&hash(&result),&result_fact);
    if create {op.write("complete.json",&complete)?;}
    exact(op,"complete.json",&complete)?;
    for n in ["manifest.json","bootstrap.json","operation-identity.json"]{dir.sync_file(n)?;} dir.sync()?;
    for n in ["request.json","state.json","prepared.json","noop.json","result-identity.json","result.json","complete.json"]{op.sync_file(n)?;} op.sync()?;
    Ok(Outcome::AlreadyInitialized)
}
fn verify_result(op:&Dir,result:&[u8],binding:&str)->Result<String> {
    let fact=exact(op,"result.json",result)?;
    exact(op,"result-identity.json",&record("result-identity",binding,&hash(result),&fact))?;
    Ok(fact)
}
fn publish_result(op:&Dir,result:&[u8],binding:&str)->Result<()> {
    op.write("result.pending",result)?;
    let fact=exact(op,"result.pending",result)?;
    op.write("result-identity.json",&record("result-identity",binding,&hash(result),&fact))?;
    op.safe.rename_noreplace("result.pending",&op.safe,"result.json").map_err(|_|Error::NeedsAttention)?;
    op.sync()?; verify_result(op,result,binding)?; Ok(())
}
fn record(phase:&str,binding:&str,previous:&str,fact:&str)->Vec<u8> {
    // All interpolated fields are engine-produced ASCII hashes, integers or constants.
    format!("{{\"apiVersion\":\"workspace-governance/development-init-record-v1\",\"phase\":\"{phase}\",\"binding\":\"{binding}\",\"previous\":\"{previous}\",\"fact\":\"{fact}\"}}\n").into_bytes()
}
fn fresh_inventory(dir:&Dir)->Result<()> {
    for n in ["manifest.pending",".manifest.pending.tmp",".bootstrap.json.tmp","operation-identity.json",".operation-identity.json.tmp","operation"] {
        if dir.read(n)?.is_some(){return Err(Error::NeedsAttention)}
    }
    Ok(())
}
/// Caller is an externally controlled development harness, NOT a production plan.
/// Root is an existing private disposable control directory; paths are fixed.
pub fn run(root:&Path,request:&[u8],candidate:&str,mut boundary:impl FnMut(&str))->Result<Outcome> {
    if candidate.len()!=64||!candidate.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){return Err(Error::Invalid)}
    let manifest=init::derive_manifest(request).map_err(|_|Error::Invalid)?;
    let state=init::derive_rootless_state(request).map_err(|_|Error::Invalid)?;
    let dir=Dir::open(root)?;
    let binding=hash(format!("development-init-v1\n{candidate}\n{}\n{}\n{}",root.display(),dir.identity()?,hash(request)).as_bytes());
    if let Some((bytes,_))=dir.read("manifest.json")? {
        if bytes!=manifest{return Err(Error::Occupied)}
    }
    if let Some((bytes,_))=dir.read("bootstrap.json")? {
        if bytes!=record("directory-intent",&binding,"",""){return Err(Error::NeedsAttention)}
    } else {fresh_inventory(&dir)?;}
    let mut locks=vec![format!(".workspacectl-lock-{}",hash(root.join("manifest.json").as_os_str().as_encoded_bytes())),format!(".workspacectl-lock-{}",hash(root.join("operation").as_os_str().as_encoded_bytes()))];
    locks.sort(); locks.dedup();
    let _held=locks.iter().map(|n|dir.safe.acquire_lock(n).map_err(|_|Error::NeedsAttention)).collect::<Result<Vec<_>>>()?;
    if dir.read("bootstrap.json")?.is_some() {
        return replay(&dir,&Dir::open(&root.join("operation"))?,request,&state,&manifest,&binding);
    }
    fresh_inventory(&dir)?;
    let existing=dir.read("manifest.json")?;
    if existing.as_ref().is_some_and(|(bytes,_)|bytes!=&manifest){return Err(Error::Occupied)}
    let boot=record("directory-intent",&binding,"",""); dir.write("bootstrap.json",&boot)?; boundary("bootstrap-intent");
    dir.mkdir("operation")?; boundary("operation-created");
    let op=Dir::open(&root.join("operation"))?;
    let identity=record("directory-created",&binding,&hash(&boot),&op.identity()?); dir.write("operation-identity.json",&identity)?; boundary("operation-identity");
    op.write("request.json",request)?; op.write("state.json",&state)?;
    let prepared=record("prepared",&binding,&hash(&identity),&hash(&manifest)); op.write("prepared.json",&prepared)?; boundary("prepared");
    if existing.is_some() {return noop(&dir,&op,&manifest,&binding,&prepared,true);}
    let intent=record("file-intent",&binding,&hash(&prepared),&hash(&manifest)); op.write("intent.json",&intent)?; boundary("file-intent");
    dir.write("manifest.pending",&manifest)?; boundary("temp-fsynced");
    let fact=dir.read("manifest.pending")?.ok_or(Error::NeedsAttention)?.1;
    let allocation=record("file-allocated",&binding,&hash(&intent),&fact); op.write("allocation.json",&allocation)?; boundary("allocation");
    dir.safe.rename_noreplace("manifest.pending",&dir.safe,"manifest.json").map_err(|_|Error::Occupied)?; boundary("manifest-renamed"); dir.sync()?; boundary("manifest-fsynced");
    let observed=dir.read("manifest.json")?.ok_or(Error::NeedsAttention)?;
    if observed.0!=manifest||observed.1!=fact{return Err(Error::NeedsAttention)}
    let published=record("file-published",&binding,&hash(&allocation),&fact); op.write("published.json",&published)?; boundary("published");
    let result=record("result-candidate",&binding,&hash(&published),&fact); publish_result(&op,&result,&binding)?; boundary("result");
    let result_fact=op.read("result.json")?.ok_or(Error::NeedsAttention)?.1;
    let complete=record("complete",&binding,&hash(&result),&result_fact); op.write("complete.json",&complete)?; boundary("complete");
    Ok(Outcome::Created)
}
