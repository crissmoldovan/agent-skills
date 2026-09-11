//! External development controller only; never linked into a production target.
use workspace_governance_setup_native::{fs as safe_fs, init};
use sha2::{Digest,Sha256};
use std::{env,fs,path::PathBuf,os::unix::fs::{DirBuilderExt,MetadataExt},process::Command,time::{SystemTime,UNIX_EPOCH}};
#[path="../src/init_transaction.rs"] mod transaction;
#[path="support/development_boundary.rs"] mod boundary;
#[test]
fn development_helper_entry() {
 let Some(root)=env::var_os("WG_BOUNDARY_ROOT") else {return};
 let root=PathBuf::from(root); let parent=PathBuf::from(env::var_os("WG_NATIVE_TEST_ROOT").unwrap());
 assert_eq!(root.parent(),Some(parent.as_path()));
 assert!(root.file_name().unwrap().to_str().unwrap().starts_with("init-boundary-"));
 let pin=env::var("WG_INIT_CANDIDATE_SHA256").unwrap(); assert_eq!(pin,hash(&fs::read(env::current_exe().unwrap()).unwrap()));
 boundary::serve(&root,&pin).unwrap();
}
const REQUEST:&[u8]=br#"{"apiVersion":"workspace-governance/init-request-v1","authorityId":"example-authority","rootNode":{"id":"example-org","kind":"organization","slug":"example","parentId":null,"visibility":{"mode":"public","readers":[]}}}"#;
fn hash(b:&[u8])->String {format!("{:x}",Sha256::digest(b))}
fn fixture()->PathBuf {
 let parent=PathBuf::from(env::var_os("WG_NATIVE_TEST_ROOT").unwrap()); safe_fs::SafeDir::open(&parent).unwrap();
 let root=parent.join(format!("init-boundary-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
 fs::DirBuilder::new().mode(0o700).create(&root).unwrap(); fs::write(root.join("request.json"),REQUEST).unwrap(); println!("development boundary fixture: {}",root.display()); root
}
fn cli(root:&PathBuf,args:&[&str])->std::process::Output {
 let exe=env::current_exe().unwrap();
 let pin=env::var("WG_INIT_CANDIDATE_SHA256").expect("external candidate pin"); assert_eq!(pin,hash(&fs::read(&exe).unwrap()));
 Command::new(env::var_os("WG_NATIVE_NODE").unwrap()).arg(format!("{}/tests/development-init-cli.mjs",env!("CARGO_MANIFEST_DIR"))).args(args)
 .env("WG_BOUNDARY_ROOT",root).env("WG_BOUNDARY_HELPER",exe).output().unwrap()
}
fn native(root:&PathBuf,packet:&[u8],ancillary:bool)->Vec<u8> {
 use std::{io::{Read,Write},os::{fd::AsRawFd,unix::{net::UnixStream,process::CommandExt}},net::Shutdown};
 let (mut host,child)=UnixStream::pair().unwrap(); let fd=child.as_raw_fd();
 let mut command=Command::new(env::current_exe().unwrap());
 command.args(["--exact","development_helper_entry","--nocapture"]).env("WG_BOUNDARY_ROOT",root).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
 unsafe {command.pre_exec(move || {if libc::dup2(fd,3)<0||libc::fcntl(3,libc::F_SETFD,0)<0{return Err(std::io::Error::last_os_error())} Ok(())});}
 let mut process=command.spawn().unwrap();drop(child);
 if ancillary {
  let file=fs::File::open(root.join("request.json")).unwrap();
  let mut control=[0usize;8]; let mut iov=libc::iovec{iov_base:packet.as_ptr() as *mut _,iov_len:packet.len()};
  unsafe {
   let mut msg:libc::msghdr=std::mem::zeroed();msg.msg_iov=&mut iov;msg.msg_iovlen=1;msg.msg_control=control.as_mut_ptr().cast();msg.msg_controllen=libc::CMSG_SPACE(4) as usize;
   let c=libc::CMSG_FIRSTHDR(&msg);(*c).cmsg_level=libc::SOL_SOCKET;(*c).cmsg_type=libc::SCM_RIGHTS;(*c).cmsg_len=libc::CMSG_LEN(4) as usize;std::ptr::write(libc::CMSG_DATA(c).cast::<i32>(),file.as_raw_fd());
   assert_eq!(libc::sendmsg(host.as_raw_fd(),&msg,0),packet.len() as isize);
  }
 } else {for byte in packet {if host.write_all(&[*byte]).is_err(){break;}}}
 let _=host.shutdown(Shutdown::Write);let mut output=Vec::new(); let _=host.read_to_end(&mut output);process.wait().unwrap();output
}
fn packet(command:&str,proposal:&str,approval:&str)->Vec<u8> {
 let bytes=format!("{command}\n{approval}\n{proposal}").into_bytes();let mut out=(bytes.len() as u32).to_be_bytes().to_vec();out.extend(bytes);out
}
#[test]
fn ancillary_descriptor_refuses_before_transaction() {
 let root=fixture();let plan=cli(&root,&["plan"]);assert!(plan.status.success());let proposal=String::from_utf8(plan.stdout).unwrap();
 let reply=native(&root,&packet("apply",&proposal,&hash(proposal.as_bytes())),true);
 assert!(!root.join("manifest.json").exists(),"ancillary request published manifest");
 assert_eq!(fs::read_dir(&root).unwrap().count(),1);
 assert!(reply.is_empty());
}
#[test]
fn native_rederives_full_development_context_even_when_host_is_bypassed() {
 let root=fixture();let planned=cli(&root,&["plan"]);assert!(planned.status.success());let proposal=String::from_utf8(planned.stdout).unwrap();
 let before=fs::metadata(root.join("request.json")).unwrap().ino();
 for field in ["action","apiVersion","candidateSha256","context","manifestFact","requestFact","rootFact","rootPathBase64","afterSha256","id","path","payload"] {
  let forged=proposal.replacen(&format!("\"{field}\":"),&format!("\"forged-{field}\":"),1);assert_ne!(forged,proposal);
  let reply=native(&root,&packet("apply",&forged,&hash(forged.as_bytes())),false);
  assert!(String::from_utf8_lossy(&reply).contains("STALE_PLAN"),"{field}");
  assert_eq!(fs::read_dir(&root).unwrap().count(),1);assert_eq!(fs::metadata(root.join("request.json")).unwrap().ino(),before);assert_eq!(fs::read(root.join("request.json")).unwrap(),REQUEST);
 }
 let reply=native(&root,&packet("apply",&proposal,&"0".repeat(64)),false);assert!(String::from_utf8_lossy(&reply).contains("APPROVAL_MISMATCH"));
 fs::rename(root.join("request.json"),root.join("original-request")).unwrap();fs::write(root.join("request.json"),REQUEST).unwrap();
 let reply=native(&root,&packet("apply",&proposal,&hash(proposal.as_bytes())),false);assert!(String::from_utf8_lossy(&reply).contains("STALE_PLAN"));assert_eq!(fs::read_dir(&root).unwrap().count(),2);
}
#[test]
fn framed_protocol_rejects_invalid_truncated_extra_and_foreign_commands() {
 for wire in [vec![],vec![0,0,0,0],vec![0,32,0,1],vec![0,0,0,4,255,255,255,255],vec![0,0,0,4,b'{'],packet("scaffold","{}","-"),[packet("verify","{}","-"),vec![1]].concat()] {
  let root=fixture();let reply=native(&root,&wire,false);assert!(!String::from_utf8_lossy(&reply).contains("\"outcome\""));assert_eq!(fs::read_dir(&root).unwrap().count(),1);
 }
}
#[test]
fn fragmented_native_valid_apply_and_identical_manifest_noop() {
 for noop in [false,true] {
  let root=fixture();if noop{fs::write(root.join("manifest.json"),init::derive_manifest(REQUEST).unwrap()).unwrap();}
  let old=fs::metadata(root.join("manifest.json")).ok().map(|m|m.ino());
  let planned=cli(&root,&["plan"]);assert!(planned.status.success());let proposal=String::from_utf8(planned.stdout).unwrap();
  let reply=native(&root,&packet("apply",&proposal,&hash(proposal.as_bytes())),false);assert!(String::from_utf8_lossy(&reply).contains("applied"));
  assert_eq!(fs::read(root.join("manifest.json")).unwrap(),init::derive_manifest(REQUEST).unwrap());
  if let Some(ino)=old{assert_eq!(fs::metadata(root.join("manifest.json")).unwrap().ino(),ino);assert!(root.join("operation/noop.json").exists());}
 }
}
#[test]
fn cli_plan_verify_apply_creates_real_manifest() {
 let root=fixture(); let plan=cli(&root,&["plan"]); assert!(plan.status.success(),"{}",String::from_utf8_lossy(&plan.stderr));
 assert_eq!(fs::read_dir(&root).unwrap().count(),1,"planning is read only");
 let proposal=String::from_utf8(plan.stdout).unwrap(); let digest=hash(proposal.as_bytes());
 println!("development CLI proposal sha256={digest}: {proposal}");
 let verified=cli(&root,&["verify",&proposal]); assert!(verified.status.success(),"{}",String::from_utf8_lossy(&verified.stderr));
 let applied=cli(&root,&["apply",&proposal,&digest]); assert!(applied.status.success(),"{}",String::from_utf8_lossy(&applied.stderr));
 assert!(String::from_utf8_lossy(&applied.stdout).contains("development-candidate"));
 println!("development CLI verify: {}apply: {}",String::from_utf8_lossy(&verified.stdout),String::from_utf8_lossy(&applied.stdout));
 assert_eq!(fs::read(root.join("manifest.json")).unwrap(),init::derive_manifest(REQUEST).unwrap());
 assert!(root.join("operation/complete.json").is_file());
 assert_eq!(fs::metadata(root.join("manifest.json")).unwrap().mode()&0o777,0o600);
}
