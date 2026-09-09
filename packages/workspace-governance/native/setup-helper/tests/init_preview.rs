use std::{io::{Read,Write},os::{fd::AsRawFd,unix::{net::UnixStream,process::CommandExt}},process::{Command,Stdio},time::Duration};
// Refusals exercise the same production binary, never the development writer.
use sha2::{Digest,Sha256};
fn helper()->&'static str {env!("CARGO_BIN_EXE_workspacectl-init-helper")}
fn frame()->Vec<u8>{
 let hash=format!("{:x}",Sha256::digest(std::fs::read(helper()).unwrap()));
 let out=Command::new(std::env::var("WG_NATIVE_NODE").unwrap()).args(["tests/init-preview-oracle.mjs",&hash]).output().unwrap();
 assert!(out.status.success(),"{}",String::from_utf8_lossy(&out.stderr));out.stdout
}
#[test] fn native_rejects_forged_complete_preview_and_all_mutation_modes(){
 let original=String::from_utf8(frame()).unwrap();
 for (from,to,code) in [
  ("\"executable\":false","\"executable\":true","STALE_PLAN"),
  ("proposed-not-authority","approved","STALE_PLAN"),
  ("\"allowed\":true","\"allowed\":false","STALE_PLAN"),
  ("file.create","checkout.clone","STALE_PLAN"),
  ("\"operation\":\"verify\"","\"operation\":\"apply\"","UNSUPPORTED"),
  ("\"operation\":\"verify\"","\"operation\":\"recover\"","UNSUPPORTED"),
  ("\"operation\":\"verify\"","\"operation\":\"exec\"","INVALID"),
  ("\"operation\":\"verify\"","\"operation\":\"verify\",\"operation\":\"verify\"","INVALID"),
  ("\"operation\":\"verify\"","\"operation\":\"verify\",\"auth\":null","INVALID")
 ]{
  assert!(original.contains(from));let modified=original.replacen(from,to,1);let (ok,response)=invoke(modified.as_bytes());
  assert!(ok);assert_eq!(&response[4..],format!("{{\"error\":\"{code}\",\"executable\":false}}").as_bytes());
 }
 for malformed in [b"{".as_slice(),b"\xff",b"null"]{
  let (ok,response)=invoke(malformed);assert!(ok);assert_eq!(&response[4..],b"{\"error\":\"INVALID\",\"executable\":false}");
 }
}
fn invoke(bytes:&[u8])->(bool,Vec<u8>){
 let (mut parent,child)=UnixStream::pair().unwrap();let fd=child.as_raw_fd();
 let mut command=Command::new(helper());command.args(["--ipc-fd","3"]).env_clear().current_dir("/").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
 unsafe{command.pre_exec(move||{if libc::dup2(fd,3)<0{return Err(std::io::Error::last_os_error())} if libc::fcntl(3,libc::F_SETFD,0)<0{return Err(std::io::Error::last_os_error())}Ok(())});}
 let mut process=command.spawn().unwrap();drop(child);
 parent.set_read_timeout(Some(Duration::from_secs(8))).unwrap();
 parent.write_all(&(bytes.len() as u32).to_be_bytes()).unwrap();parent.write_all(bytes).unwrap();parent.shutdown(std::net::Shutdown::Write).unwrap();
 let mut result=Vec::new();parent.read_to_end(&mut result).unwrap();(process.wait().unwrap().success(),result)
}
#[test] fn executable_verifies_actual_node_preview_without_effect_authority(){
 let (ok,response)=invoke(&frame());assert!(ok);assert_eq!(&response[4..],b"{\"executable\":false,\"valid\":true}");
}
