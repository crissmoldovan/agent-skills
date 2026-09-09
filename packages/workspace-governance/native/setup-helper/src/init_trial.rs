//! Trial trust measurements. These are NOT execution authority: the caller must
//! additionally validate the approved plan, candidate closure, live native issuer,
//! reservation, deadline and all resources again under transaction locks.
//! No writer, record issuer, environment selector or qualification fallback exists here.
use super::{fields, get, is, object, parse, sha256, string, Value};
#[path = "init_trial_issuer.rs"]
pub mod controller;
use std::{ffi::CString, fs::{File, OpenOptions}, io::Read, os::{fd::{AsRawFd, FromRawFd}, unix::fs::{MetadataExt, OpenOptionsExt}}, path::{Path, PathBuf}};

#[derive(Debug, PartialEq, Eq)]
pub enum Failure { Invalid, Limit, Unsupported, Stale, RecoveryRequired }
type Result<T> = std::result::Result<T, Failure>;
fn invalid<T>() -> Result<T> { Err(Failure::Invalid) }
fn text(v: &Value) -> Result<String> {
    if let Value::String(s) = v { String::from_utf16(s).map_err(|_| Failure::Invalid) } else { invalid() }
}
fn field<'a>(v: &'a Value, k: &str) -> Result<&'a Value> { get(v,k).map_err(|_| Failure::Invalid) }
fn exact(v: &Value, keys: &[&str]) -> Result<()> { fields(v,keys,&[]).map_err(|_| Failure::Invalid) }
fn hash(v: &Value) -> Result<String> {
    let s=text(v)?;
    if s.len()!=64 || !s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) { return invalid(); } Ok(s)
}
fn decimal(v: &Value) -> Result<u64> {
    let s=text(v)?;
    if s.is_empty() || (s.len()>1 && s.starts_with('0')) || !s.bytes().all(|b| b.is_ascii_digit()) { return invalid(); }
    s.parse().map_err(|_| Failure::Invalid)
}
fn uid(v: &Value) -> Result<u32> {
    match v { Value::Number(n) if *n>=0.0 && *n<=u32::MAX as f64 && n.fract()==0.0 => Ok(*n as u32), _=>invalid() }
}
fn literal(path: &Path) -> Result<&str> {
    let s=path.to_str().ok_or(Failure::Invalid)?;
    if !s.starts_with('/') || s.len()>4096 || (s!="/" && s.ends_with('/')) || s.contains("//") || s.contains('\\') || s.chars().any(char::is_control) || s.split('/').any(|c| c=="." || c=="..") { return invalid(); }
    Ok(s)
}
fn path(v: &Value) -> Result<PathBuf> { let p=PathBuf::from(text(v)?); literal(&p)?; Ok(p) }
fn cstr(s: &str) -> Result<CString> { CString::new(s).map_err(|_| Failure::Invalid) }
fn openat(parent: &File, name: &str, flags: i32) -> Result<File> {
    let name=cstr(name)?;
    // SAFETY: borrowed live directory and valid CString, new FD transferred once.
    let fd=unsafe {libc::openat(parent.as_raw_fd(),name.as_ptr(),flags|libc::O_CLOEXEC|libc::O_NOFOLLOW)};
    if fd<0 { return Err(Failure::Unsupported); } Ok(unsafe { File::from_raw_fd(fd) })
}
fn metadata(file: &File) -> Result<std::fs::Metadata> { file.metadata().map_err(|_| Failure::Unsupported) }
fn mount_id(file: &File) -> Result<u64> {
    // SAFETY: initialized output, live FD and empty NUL-terminated path for AT_EMPTY_PATH.
    let mut stat: libc::statx=unsafe {std::mem::zeroed()};
    let rc=unsafe {libc::statx(file.as_raw_fd(),b"\0".as_ptr().cast(),libc::AT_EMPTY_PATH|libc::AT_SYMLINK_NOFOLLOW,libc::STATX_MNT_ID,&mut stat)};
    if rc!=0 || stat.stx_mask & libc::STATX_MNT_ID==0 { return Err(Failure::Unsupported); } Ok(stat.stx_mnt_id)
}
fn safe_dir(file: &File) -> Result<()> {
    let m=metadata(file)?;
    if !m.is_dir() || (m.uid()!=0 && m.uid()!=unsafe {libc::geteuid()}) || m.mode() & 0o022 !=0 { return Err(Failure::Unsupported); } Ok(())
}
fn open_directory(path: &Path) -> Result<File> {
    let s=literal(path)?;
    let mut f=OpenOptions::new().read(true).custom_flags(libc::O_DIRECTORY|libc::O_NOFOLLOW|libc::O_CLOEXEC).open("/").map_err(|_| Failure::Unsupported)?;
    safe_dir(&f)?;
    if s!="/" { for name in s[1..].split('/') { f=openat(&f,name,libc::O_RDONLY|libc::O_DIRECTORY)?; safe_dir(&f)?; } }
    Ok(f)
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirectoryIdentity { pub path: PathBuf, pub dev: u64, pub ino: u64, pub mount_id: u64, pub uid: u32, pub mode: u32 }
impl DirectoryIdentity {
    pub fn canonical_json(&self) -> String {
        String::from_utf8(super::canonical(&object(vec![("path",string(self.path.to_str().expect("validated path"))), ("dev",string(&self.dev.to_string())), ("ino",string(&self.ino.to_string())), ("mountId",string(&self.mount_id.to_string())), ("uid",Value::Number(self.uid as f64)), ("mode",string(&format!("{:04o}",self.mode)))] )).expect("bounded identity")).expect("UTF-8 canonical JSON")
    }
}
fn directory_facts(path: &Path, f: &File) -> Result<DirectoryIdentity> {
    let m=metadata(f)?;
    if !m.is_dir() || m.uid()!=unsafe {libc::geteuid()} || m.mode()&0o7777!=0o700 { return Err(Failure::Unsupported); }
    Ok(DirectoryIdentity {path:path.to_owned(),dev:m.dev(),ino:m.ino(),mount_id:mount_id(f)?,uid:m.uid(),mode:m.mode()&0o7777})
}
pub fn capture_directory(path: &Path) -> Result<DirectoryIdentity> { directory_facts(path,&open_directory(path)?) }
fn declared_directory(v: &Value) -> Result<DirectoryIdentity> {
    exact(v,&["path","dev","ino","mountId","uid","mode"])?;
    let mode=text(field(v,"mode")?)?;
    if mode.len()!=4 || !mode.bytes().all(|b| (b'0'..=b'7').contains(&b)) { return invalid(); }
    Ok(DirectoryIdentity {path:path(field(v,"path")?)?,dev:decimal(field(v,"dev")?)?,ino:decimal(field(v,"ino")?)?,mount_id:decimal(field(v,"mountId")?)?,uid:uid(field(v,"uid")?)?,mode:u32::from_str_radix(&mode,8).map_err(|_| Failure::Invalid)?})
}
fn same_file(a: &std::fs::Metadata,b: &std::fs::Metadata) -> bool {
    (a.dev(),a.ino(),a.mode(),a.uid(),a.gid(),a.nlink(),a.len(),a.mtime(),a.mtime_nsec(),a.ctime(),a.ctime_nsec()) == (b.dev(),b.ino(),b.mode(),b.uid(),b.gid(),b.nlink(),b.len(),b.mtime(),b.mtime_nsec(),b.ctime(),b.ctime_nsec())
}
/// O_PATH inspection precedes I/O, avoiding FIFO/device opens. Bounded bytes,
/// descriptor/path identity and metadata are compared after reading. No chmod/repair.
fn read_file(path: &Path, max: usize, mode: u32) -> Result<Vec<u8>> { read_file_as(path,max,mode,unsafe {libc::geteuid()}) }
fn read_file_as(path: &Path, max: usize, mode: u32, owner: u32) -> Result<Vec<u8>> {
    literal(path)?;
    let parent=path.parent().ok_or(Failure::Invalid)?; let name=path.file_name().and_then(|s| s.to_str()).ok_or(Failure::Invalid)?;
    let dir=open_directory(parent)?; let probe=openat(&dir,name,libc::O_PATH)?; let before=metadata(&probe)?;
    if !before.is_file() || before.nlink()!=1 || before.uid()!=owner || before.mode()&0o7777!=mode { return Err(Failure::Unsupported); }
    if before.len()>max as u64 { return Err(Failure::Limit); }
    let mut file=openat(&dir,name,libc::O_RDONLY|libc::O_NONBLOCK)?;
    if !same_file(&before,&metadata(&file)?) || mount_id(&probe)?!=mount_id(&file)? { return Err(Failure::Stale); }
    let mut bytes=Vec::new(); (&mut file).take(max as u64+1).read_to_end(&mut bytes).map_err(|_| Failure::Unsupported)?;
    if bytes.len()>max { return Err(Failure::Limit); }
    let current=openat(&dir,name,libc::O_PATH)?;
    if !same_file(&before,&metadata(&file)?) || !same_file(&before,&metadata(&current)?) || mount_id(&probe)?!=mount_id(&current)? { return Err(Failure::Stale); }
    // Reopen ancestry as well: the retained descriptor must still denote the named parent.
    let rebound=open_directory(parent)?;
    let a=metadata(&dir)?; let b=metadata(&rebound)?;
    if (a.dev(),a.ino(),mount_id(&dir)?) != (b.dev(),b.ino(),mount_id(&rebound)?) { return Err(Failure::Stale); }
    Ok(bytes)
}
fn mount_path(encoded: &str) -> Result<PathBuf> {
    let mut decoded=String::new(); let mut rest=encoded;
    while let Some(at)=rest.find('\\') {
        decoded.push_str(&rest[..at]); rest=&rest[at..];
        let escaped=rest.get(..4).ok_or(Failure::Invalid)?;
        decoded.push(match escaped { "\\040"=>' ', "\\011"=>'\t', "\\012"=>'\n', "\\134"=>'\\', _=>return invalid() });
        rest=&rest[4..];
    }
    decoded.push_str(rest); let p=PathBuf::from(decoded); literal(&p)?; Ok(p)
}
/// Pure mount-table check; tests may supply synthetic tables, runtime callers must
/// supply their independently captured /proc/self/mountinfo bytes. Not durability proof.
pub fn validate_mountinfo(bytes: &[u8], resource: &DirectoryIdentity) -> Result<()> {
    if bytes.len()>2097152 { return Err(Failure::Limit); }
    let input=std::str::from_utf8(bytes).map_err(|_| Failure::Invalid)?;
    let mut ids=std::collections::BTreeSet::new(); let mut selected=false;
    let device=format!("{}:{}",libc::major(resource.dev),libc::minor(resource.dev));
    for line in input.lines() {
        let (left,right)=line.split_once(" - ").ok_or(Failure::Invalid)?;
        let l:Vec<_>=left.split(' ').collect(); let r:Vec<_>=right.split(' ').collect();
        if l.len()<6 || r.len()!=3 || l.iter().any(|s| s.is_empty()) { return invalid(); }
        let mount=decimal(&string(l[0]))?;
        if !ids.insert(mount) { return invalid(); }
        let root=mount_path(l[3])?; let target=mount_path(l[4])?;
        if mount==resource.mount_id {
            if l[2]!=device || root!=Path::new("/") || !resource.path.starts_with(&target) || !["ext4","xfs"].contains(&r[0]) || !l[5].split(',').any(|o| o=="rw") || l[5].split(',').any(|o| o=="ro") || !r[2].split(',').any(|o| o=="rw") { return Err(Failure::Unsupported); }
            selected=true;
        } else if l[2]==device || target.starts_with(&resource.path) { return Err(Failure::Unsupported); }
    }
    if !selected { return Err(Failure::Unsupported); } Ok(())
}
fn basename(v: &Value) -> Result<String> {
    let s=text(v)?;
    if s.is_empty() || s.len()>255 || s=="." || s==".." || s.contains('/') || s.contains('\\') || s.chars().any(char::is_control) { return invalid(); } Ok(s)
}
fn kernel_bytes(path: &str,max: usize) -> Result<Vec<u8>> {
    let f=File::open(path).map_err(|_| Failure::Unsupported)?; let mut bytes=Vec::new();
    f.take(max as u64+1).read_to_end(&mut bytes).map_err(|_| Failure::Unsupported)?;
    if bytes.len()>max { return Err(Failure::Limit); } Ok(bytes)
}
#[derive(Debug)]
pub struct FixtureCapture { pub root: DirectoryIdentity, pub manifest_path: PathBuf, pub state_path: PathBuf, pub request_bytes: Vec<u8>, pub mountinfo_sha256: String }
fn checked_directory(v: &Value) -> Result<DirectoryIdentity> {
    let declared=declared_directory(v)?;
    if capture_directory(&declared.path)?!=declared { return Err(Failure::Stale); } Ok(declared)
}
/// Independently recapture the strict CandidateTrial.fixture shape. No approval,
/// freshness issuance, locks or mutations are inferred from a successful capture.
pub fn capture_fixture(trust: &TrustCapture, bytes: &[u8]) -> Result<FixtureCapture> {
    capture_fixture_input(trust, bytes, None)
}
// Only completed recognition supplies saved request bytes. This retains every
// fixture/path/mount check; it does not authorize any unperformed publication.
fn capture_fixture_input(trust: &TrustCapture, bytes: &[u8], saved: Option<&[u8]>) -> Result<FixtureCapture> {
    let value=parse(bytes).map_err(|e| if e==super::Error::Limit {Failure::Limit} else {Failure::Invalid})?;
    exact(&value,&["root","manifestParent","manifestBasename","stateParent","stateBasename","request","evidenceRoot"])?;
    let root=declared_directory(field(&value,"root")?)?;
    let manifest=declared_directory(field(&value,"manifestParent")?)?;
    let state=declared_directory(field(&value,"stateParent")?)?;
    let evidence=declared_directory(field(&value,"evidenceRoot")?)?;
    let manifest_path=manifest.path.join(basename(field(&value,"manifestBasename")?)?);
    let state_path=state.path.join(basename(field(&value,"stateBasename")?)?);
    let request=field(&value,"request")?;
    exact(request,&["path","kind","identity","sha256","treeDigest","filesystem"])?;
    let request_path=path(field(request,"path")?)?;
    if !is(field(request,"kind")?,"file") || *field(request,"treeDigest")?!=Value::Null { return invalid(); }
    // Require one direct disposable leaf, disjoint existing parents, and external
    // evidence. A string prefix never establishes containment or current identity.
    if root.path.parent()!=Some(trust.fixture_parent.path.as_path()) || manifest.path==root.path || state.path==root.path || !manifest.path.starts_with(&root.path) || !state.path.starts_with(&root.path) || !request_path.starts_with(&root.path) || overlaps(&manifest.path,&state.path) || overlaps(&request_path,&manifest.path) || overlaps(&request_path,&state.path) || overlaps(&evidence.path,&trust.fixture_parent.path) || overlaps(&evidence.path,&trust.registry_root.path) || overlaps(&evidence.path,&trust.controller_path) || overlaps(&evidence.path,&trust.install_root.join("operator")) { return invalid(); }
    let ident=field(request,"identity")?; exact(ident,&["dev","ino"])?;
    let expected_dev=decimal(field(ident,"dev")?)?; let expected_ino=decimal(field(ident,"ino")?)?;
    let expected_hash=hash(field(request,"sha256")?)?;
    let facts=field(request,"filesystem")?; exact(facts,&["uid","gid","mode","nlink","mountId"])?;
    let expected_uid=decimal(field(facts,"uid")?)?; let expected_gid=decimal(field(facts,"gid")?)?; let expected_mount=decimal(field(facts,"mountId")?)?;
    if !is(field(facts,"mode")?,"0600") || decimal(field(facts,"nlink")?)?!=1 { return invalid(); }
    let mountinfo=kernel_bytes("/proc/self/mountinfo",2097152)?;
    for declared in [&root,&manifest,&state,&evidence,&trust.registry_root,&trust.fixture_parent] {
        if capture_directory(&declared.path)?!=*declared { return Err(Failure::Stale); }
        validate_mountinfo(&mountinfo,declared)?;
    }
    let request_bytes=if let Some(bytes)=saved {
        if bytes.len()>262144 {return Err(Failure::Limit)}
        if expected_uid!=trust.issuer_uid as u64 || expected_gid>u32::MAX as u64 || expected_ino==0 || expected_mount==0 {return invalid()}
        bytes.to_vec()
    } else {
        let parent=open_directory(request_path.parent().ok_or(Failure::Invalid)?)?;
        let name=request_path.file_name().and_then(|s| s.to_str()).ok_or(Failure::Invalid)?;
        let before=openat(&parent,name,libc::O_PATH)?; let m=metadata(&before)?;
        if (m.dev(),m.ino(),m.uid() as u64,m.gid() as u64,mount_id(&before)?)!=(expected_dev,expected_ino,expected_uid,expected_gid,expected_mount) { return Err(Failure::Stale); }
        let bytes=read_file(&request_path,262144,0o600)?;
        let after=openat(&parent,name,libc::O_PATH)?;
        if !same_file(&m,&metadata(&after)?) || mount_id(&after)?!=expected_mount { return Err(Failure::Stale); }
        bytes
    };
    if sha256(&request_bytes)!=expected_hash { return Err(Failure::Stale); }
    // Whole captured input set is checked again. Transaction callers must repeat
    // this entire function after acquiring their independently derived locks.
    for (key,declared) in [("root",&root),("manifestParent",&manifest),("stateParent",&state),("evidenceRoot",&evidence)] { if checked_directory(field(&value,key)?)?!=*declared { return Err(Failure::Stale); } }
    if kernel_bytes("/proc/self/mountinfo",2097152)?!=mountinfo { return Err(Failure::Stale); }
    Ok(FixtureCapture {root,manifest_path,state_path,request_bytes,mountinfo_sha256:sha256(&mountinfo)})
}
#[derive(Debug)]
pub struct ControllerWitness {
    pid: u32, pidfd: File, parent_pid: u32, start_ticks: u64,
    boot: Vec<u8>, executable: PathBuf, executable_sha256: String, issuer_uid: u32,
}
fn process_facts(pid: u32) -> Result<(u32,u64)> {
    let bytes=kernel_bytes(&format!("/proc/{pid}/stat"),16384)?;
    let s=std::str::from_utf8(&bytes).map_err(|_| Failure::Invalid)?;
    let open=s.find(" (").ok_or(Failure::Invalid)?;
    if s[..open].parse::<u32>().map_err(|_| Failure::Invalid)?!=pid { return invalid(); }
    let close=s.rfind(") ").ok_or(Failure::Invalid)?;
    let tail:Vec<_>=s[close+2..].split_ascii_whitespace().collect();
    if tail.len()<20 || ["Z","X","x"].contains(&tail[0]) { return Err(Failure::Stale); }
    Ok((tail[1].parse().map_err(|_| Failure::Invalid)?,tail[19].parse().map_err(|_| Failure::Invalid)?))
}
impl ControllerWitness {
    /// A pidfd-bound native-executable witness, not a plan approval or trial grant.
    /// A separate ancestry validator must bind its exact Node/CLI/helper descendants.
    pub fn capture(trust: &TrustCapture, pid: u32) -> Result<Self> {
        if pid==0 || pid>i32::MAX as u32 { return invalid(); }
        // SAFETY: pidfd_open takes scalar PID/flags; fresh returned FD owned once.
        let fd=unsafe {libc::syscall(libc::SYS_pidfd_open,pid as libc::pid_t,0)};
        if fd<0 { return Err(Failure::Unsupported); }
        let pidfd=unsafe {File::from_raw_fd(fd as i32)};
        let (parent_pid,start_ticks)=process_facts(pid)?;
        let witness=Self {pid,pidfd,parent_pid,start_ticks,boot:kernel_bytes("/proc/sys/kernel/random/boot_id",256)?,executable:trust.controller_path.clone(),executable_sha256:trust.controller_sha256.clone(),issuer_uid:trust.issuer_uid};
        witness.recheck()?; Ok(witness)
    }
    pub fn recheck(&self) -> Result<()> {
        let mut poll=libc::pollfd {fd:self.pidfd.as_raw_fd(),events:libc::POLLIN,revents:0};
        // SAFETY: poll borrows one initialized pollfd for a zero-time readiness check.
        if unsafe {libc::poll(&mut poll,1,0)}!=0 || poll.revents!=0 { return Err(Failure::Stale); }
        if kernel_bytes("/proc/sys/kernel/random/boot_id",256)?!=self.boot || process_facts(self.pid)?!=(self.parent_pid,self.start_ticks) { return Err(Failure::Stale); }
        let proc_path=PathBuf::from(format!("/proc/{}/exe",self.pid));
        // /proc/PID/exe is a kernel-owned process reference, NOT an input symlink.
        // It must name the exact no-follow, safely provisioned pinned executable.
        if std::fs::read_link(&proc_path).map_err(|_| Failure::Stale)?!=self.executable { return Err(Failure::Stale); }
        let owner=std::fs::metadata(format!("/proc/{}",self.pid)).map_err(|_| Failure::Stale)?;
        if owner.uid()!=self.issuer_uid || self.issuer_uid!=unsafe {libc::geteuid()} { return Err(Failure::Unsupported); }
        let bytes=read_file(&self.executable,134217728,0o700)?;
        if bytes.len()<20 || &bytes[..7]!=b"\x7fELF\x02\x01\x01" || ![2u16,3].contains(&u16::from_le_bytes([bytes[16],bytes[17]])) || u16::from_le_bytes([bytes[18],bytes[19]])!=62 || sha256(&bytes)!=self.executable_sha256 { return Err(Failure::Stale); }
        let actual=File::open(&proc_path).map_err(|_| Failure::Stale)?;
        let pinned=std::fs::symlink_metadata(&self.executable).map_err(|_| Failure::Stale)?;
        if !same_file(&metadata(&actual)?,&pinned) { return Err(Failure::Stale); }
        if process_facts(self.pid)?!=(self.parent_pid,self.start_ticks) || unsafe {libc::poll(&mut poll,1,0)}!=0 { return Err(Failure::Stale); }
        Ok(())
    }
}
#[derive(Debug)]
pub struct TrialLifetime { issued_ns: u64, deadline_ns: u64, boot: Vec<u8> }
impl TrialLifetime {
    /// Read a fixed record lifetime using CLOCK_BOOTTIME, never wall time or a
    /// caller-supplied clock. This does not authenticate who issued the record.
    pub fn capture(bytes: &[u8]) -> Result<Self> {
        let value=parse(bytes).map_err(|_| Failure::Invalid)?;
        exact(&value,&["issuedBoottimeNs","deadlineBoottimeNs"])?;
        let issued_ns=decimal(field(&value,"issuedBoottimeNs")?)?;
        let deadline_ns=decimal(field(&value,"deadlineBoottimeNs")?)?;
        if deadline_ns<=issued_ns || deadline_ns-issued_ns>600_000_000_000 { return invalid(); }
        let lifetime=Self {issued_ns,deadline_ns,boot:kernel_bytes("/proc/sys/kernel/random/boot_id",256)?};
        lifetime.recheck()?; Ok(lifetime)
    }
    pub fn recheck(&self) -> Result<()> {
        let mut t=libc::timespec {tv_sec:0,tv_nsec:0};
        // SAFETY: valid initialized timespec output for the fixed monotonic boot clock.
        if unsafe {libc::clock_gettime(libc::CLOCK_BOOTTIME,&mut t)}!=0 || t.tv_sec<0 || t.tv_nsec<0 || t.tv_nsec>=1_000_000_000 { return Err(Failure::Unsupported); }
        let now=(t.tv_sec as u64).checked_mul(1_000_000_000).and_then(|n| n.checked_add(t.tv_nsec as u64)).ok_or(Failure::Unsupported)?;
        if now<self.issued_ns || now>=self.deadline_ns || kernel_bytes("/proc/sys/kernel/random/boot_id",256)?!=self.boot { return Err(Failure::Stale); } Ok(())
    }
}
#[derive(Debug, PartialEq, Eq)]
struct ArtifactIdentity {path: PathBuf, dev: u64, ino: u64, mount_id: u64, uid: u32, gid: u32, mode: u32, sha256: String}
#[derive(Debug)]
pub struct CandidateFiles { wire: Vec<u8>, files: Vec<ArtifactIdentity> }
impl CandidateFiles {
    /// Measure a strict sorted [{path,sha256}] candidate/runtime artifact list.
    /// This verifies declared files, NOT completeness of runtime closure, the
    /// candidate manifest schema, engine tree, archive extraction or qualification.
    pub fn capture(bytes: &[u8]) -> Result<Self> {
        let files=Self::measure(bytes)?; let captured=Self {wire:bytes.to_owned(),files};
        captured.recheck()?; Ok(captured)
    }
    pub fn recheck(&self) -> Result<()> {
        if Self::measure(&self.wire)?!=self.files { return Err(Failure::Stale); } Ok(())
    }
    fn measure(bytes: &[u8]) -> Result<Vec<ArtifactIdentity>> {
        let value=parse(bytes).map_err(|e| if e==super::Error::Limit {Failure::Limit} else {Failure::Invalid})?;
        let Value::Array(values)=value else { return invalid(); };
        if values.is_empty() || values.len()>512 { return Err(Failure::Limit); }
        let mut refs=Vec::new(); let mut previous=PathBuf::new();
        for value in values {
            exact(&value,&["path","sha256"])?;
            let p=path(field(&value,"path")?)?; let h=hash(field(&value,"sha256")?)?;
            if p.as_os_str().as_encoded_bytes()<=previous.as_os_str().as_encoded_bytes() { return invalid(); } previous=p.clone(); refs.push((p,h));
        }
        let mut out=Vec::new(); let mut identities=std::collections::BTreeSet::new(); let mut total=0u64;
        for (p,h) in refs {
            let parent=open_directory(p.parent().ok_or(Failure::Invalid)?)?;
            let name=p.file_name().and_then(|s| s.to_str()).ok_or(Failure::Invalid)?;
            let before=openat(&parent,name,libc::O_PATH)?; let m=metadata(&before)?; let mount=mount_id(&before)?;
            if !m.is_file() || m.nlink()!=1 || (m.uid()!=0 && m.uid()!=unsafe {libc::geteuid()}) || m.mode()&0o7022!=0 { return Err(Failure::Unsupported); }
            if !identities.insert((m.dev(),m.ino())) { return Err(Failure::Unsupported); }
            total=total.checked_add(m.len()).ok_or(Failure::Limit)?;
            if total>268435456 { return Err(Failure::Limit); }
            let content=read_file_as(&p,134217728,m.mode()&0o7777,m.uid())?;
            if sha256(&content)!=h { return Err(Failure::Stale); }
            let after=openat(&parent,name,libc::O_PATH)?;
            if !same_file(&m,&metadata(&after)?) || mount_id(&after)?!=mount { return Err(Failure::Stale); }
            out.push(ArtifactIdentity {path:p,dev:m.dev(),ino:m.ino(),mount_id:mount,uid:m.uid(),gid:m.gid(),mode:m.mode()&0o7777,sha256:h});
        }
        Ok(out)
    }
}
fn overlaps(a: &Path,b: &Path) -> bool { a.starts_with(b)||b.starts_with(a) }
#[derive(Debug)]
pub struct TrustCapture {
    install_root: PathBuf,
    pub sha256: String, pub bytes: Vec<u8>, pub issuer_uid: u32,
    pub controller_path: PathBuf, pub controller_sha256: String,
    pub registry_root: DirectoryIdentity, pub fixture_parent: DirectoryIdentity,
    pub candidate_manifest_sha256: String,
}
/// Reads ONLY the fixed sidecar relative to an independently validated install root.
/// Caller must derive this root from its actual executable, never request/env/profile.
/// Missing anchor remains refusal. Success is measured trust data, NOT a grant.
pub fn read_trust(install_root: &Path) -> Result<TrustCapture> {
    capture_directory(install_root)?;
    let sidecar=install_root.join("operator/init-trial-trust-v1.json");
    let bytes=read_file(&sidecar,262144,0o600)?;
    let value=parse(&bytes).map_err(|e| if e==super::Error::Limit {Failure::Limit} else {Failure::Invalid})?;
    exact(&value,&["apiVersion","issuerUid","controller","registryRoot","fixtureParent","candidateManifestSha256"])?;
    if !is(field(&value,"apiVersion")?,"workspace-governance/init-trial-trust-v1") { return invalid(); }
    let issuer_uid=uid(field(&value,"issuerUid")?)?;
    if issuer_uid!=unsafe {libc::geteuid()} { return Err(Failure::Unsupported); }
    let controller=field(&value,"controller")?; exact(controller,&["path","sha256"])?;
    let controller_path=path(field(controller,"path")?)?; let controller_sha256=hash(field(controller,"sha256")?)?;
    let registry_root=declared_directory(field(&value,"registryRoot")?)?;
    let fixture_parent=declared_directory(field(&value,"fixtureParent")?)?;
    let candidate_manifest_sha256=hash(field(&value,"candidateManifestSha256")?)?;
    if overlaps(&registry_root.path,&fixture_parent.path) || overlaps(&sidecar,&registry_root.path) || overlaps(&sidecar,&fixture_parent.path) || overlaps(&controller_path,&fixture_parent.path) || overlaps(&controller_path,&registry_root.path) { return invalid(); }
    if capture_directory(&registry_root.path)?!=registry_root || capture_directory(&fixture_parent.path)?!=fixture_parent { return Err(Failure::Stale); }
    if (registry_root.dev,registry_root.ino)==(fixture_parent.dev,fixture_parent.ino) { return invalid(); }
    if sha256(&read_file(&controller_path,134217728,0o700)?)!=controller_sha256 { return Err(Failure::Stale); }
    Ok(TrustCapture {install_root:install_root.to_owned(),sha256:sha256(&bytes),bytes,issuer_uid,controller_path,controller_sha256,registry_root,fixture_parent,candidate_manifest_sha256})
}
