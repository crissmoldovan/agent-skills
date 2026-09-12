//! DEVELOPMENT-ONLY protocol over a controller-created fd3 Unix stream.
//! Source-included exclusively by init_boundary integration test. This is NOT
//! linux-init-helper-v1, InitSetupPlan, production authorization, or qualification.
use crate::{init,safe_fs,transaction};
use base64::{Engine,engine::general_purpose::STANDARD};
use sha2::{Digest,Sha256};
use std::{fs::{self,OpenOptions},io::{Read,Write},os::{fd::{AsRawFd,FromRawFd},unix::{fs::{MetadataExt,OpenOptionsExt},net::UnixStream}},path::Path,time::Duration};
fn hash(b:&[u8])->String {format!("{:x}",Sha256::digest(b))}
fn capture(root:&Path,name:&str)->Result<Option<(Vec<u8>,String)>,String> {
 let path=root.join(name);
 let mut f=match OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW|libc::O_NONBLOCK|libc::O_CLOEXEC).open(&path) {
  Ok(f)=>f,Err(e) if e.kind()==std::io::ErrorKind::NotFound=>return Ok(None),Err(_)=>return Err("INVALID".into())};
 let m=f.metadata().map_err(|_|"INVALID")?;
 if !m.is_file()||m.mode()&0o7777!=0o600||m.nlink()!=1||m.uid()!=unsafe{libc::geteuid()}||m.len()>262144{return Err("INVALID".into())}
 let mut bytes=Vec::new(); (&mut f).take(262145).read_to_end(&mut bytes).map_err(|_|"INVALID")?;
 let after=f.metadata().map_err(|_|"INVALID")?; let named=fs::symlink_metadata(&path).map_err(|_|"INVALID")?;
 if bytes.len()>262144||m.len()!=bytes.len() as u64||m.dev()!=named.dev()||m.ino()!=named.ino()||m.mtime_nsec()!=after.mtime_nsec()||m.ctime_nsec()!=after.ctime_nsec(){return Err("STALE_PLAN".into())}
 let fact=format!("{}:{}:{}:{}:{}:{}",m.dev(),m.ino(),m.mode()&0o7777,m.uid(),m.len(),hash(&bytes)); Ok(Some((bytes,fact)))
}
fn derive(root:&Path,candidate:&str)->Result<(Vec<u8>,Vec<u8>),String> {
 safe_fs::SafeDir::open(root).map_err(|_|"INVALID")?;
 let m=fs::symlink_metadata(root).map_err(|_|"INVALID")?;
 let (request,request_fact)=capture(root,"request.json")?.ok_or("INVALID")?;
 let existing=capture(root,"manifest.json")?;
 let action=init::derive_file_action(&request,root.join("manifest.json").to_str().ok_or("INVALID")?,existing.as_ref().map(|x|x.0.as_slice())).map_err(|e|e.code())?;
 let action=std::str::from_utf8(&action).map_err(|_|"INVALID")?.trim_end();
 let manifest_fact=existing.map(|x|format!("\"{}\"",x.1)).unwrap_or("null".into());
 let root_fact=format!("{}:{}:{}:{}",m.dev(),m.ino(),m.mode()&0o7777,m.uid());
 let plan=format!("{{\"action\":{action},\"apiVersion\":\"workspace-governance/development-init-plan-v1\",\"candidateSha256\":\"{candidate}\",\"context\":{{\"manifestFact\":{manifest_fact},\"requestFact\":\"{request_fact}\",\"rootFact\":\"{root_fact}\",\"rootPathBase64\":\"{}\"}}}}\n",STANDARD.encode(root.as_os_str().as_encoded_bytes()));
 Ok((plan.into_bytes(),request))
}
fn execute(root:&Path,candidate:&str,frame:&[u8])->Result<&'static str,String> {
 let text=std::str::from_utf8(frame).map_err(|_|"INVALID")?;
 let mut parts=text.splitn(3,'\n'); let mode=parts.next().ok_or("INVALID")?; let approval=parts.next().ok_or("INVALID")?; let proposal=parts.next().ok_or("INVALID")?;
 if !["verify","apply"].contains(&mode){return Err("UNSUPPORTED".into())}
 if mode=="verify" {if approval!="-"{return Err("INVALID".into())}}
 else if approval.len()!=64||!approval.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))||hash(proposal.as_bytes())!=approval{return Err("APPROVAL_MISMATCH".into())}
 // Neither a caller digest nor Node's validation grants mutation authority.
 // Re-capture every development context resource and rederive the entire plan.
 let (expected,request)=derive(root,candidate)?;
 if expected!=proposal.as_bytes(){return Err("STALE_PLAN".into())}
 if mode=="verify"{return Ok("verified")}
 // Shared transaction performs its own manifest/request derivation and persistent
 // lock acquisition. Full production under-lock ResourcePrecondition recapture
 // and init wire semantics remain explicitly outside this development adapter.
 transaction::run(root,&request,candidate, |_| {}).map_err(|e|format!("{e:?}"))?;
 Ok("applied")
}
fn receive(stream:&UnixStream,bytes:&mut [u8],deadline:std::time::Instant)->Result<usize,String> {
 let remaining=deadline.checked_duration_since(std::time::Instant::now()).ok_or("TIMEOUT")?;
 stream.set_read_timeout(Some(remaining)).map_err(|_|"IO")?;
 let mut iov=libc::iovec{iov_base:bytes.as_mut_ptr().cast(),iov_len:bytes.len()};
 // No ancillary buffer: Linux closes discarded rights; MSG_CTRUNC refuses.
 let (count,flags)=unsafe {
  let mut msg:libc::msghdr=std::mem::zeroed();msg.msg_iov=&mut iov;msg.msg_iovlen=1;
  let count=libc::recvmsg(stream.as_raw_fd(),&mut msg,libc::MSG_CMSG_CLOEXEC);(count,msg.msg_flags)
 };
 if count<0||flags&(libc::MSG_CTRUNC|libc::MSG_TRUNC)!=0{return Err("INVALID".into())}
 Ok(count as usize)
}
fn receive_exact(stream:&UnixStream,mut bytes:&mut [u8],deadline:std::time::Instant)->Result<(),String> {
 while !bytes.is_empty(){let n=receive(stream,bytes,deadline)?;if n==0{return Err("INVALID".into())}bytes=&mut bytes[n..];}Ok(())
}
pub fn serve(root:&Path,candidate:&str)->Result<(),String> {
 // SAFETY: external test controller passes a fresh owned Unix stream as fd3.
 let mut stream=unsafe{UnixStream::from_raw_fd(3)};
 stream.set_read_timeout(Some(Duration::from_secs(5))).map_err(|_|"IO")?;
 stream.set_write_timeout(Some(Duration::from_secs(5))).map_err(|_|"IO")?;
 let mut peer:libc::ucred=unsafe{std::mem::zeroed()}; let mut len=std::mem::size_of::<libc::ucred>() as libc::socklen_t;
 if unsafe{libc::getsockopt(stream.as_raw_fd(),libc::SOL_SOCKET,libc::SO_PEERCRED,(&mut peer as *mut libc::ucred).cast(),&mut len)}!=0||peer.uid!=unsafe{libc::geteuid()}{return Err("INVALID".into())}
 let deadline=std::time::Instant::now()+Duration::from_secs(5);
 let mut header=[0u8;4]; receive_exact(&stream,&mut header,deadline)?;
 let size=u32::from_be_bytes(header) as usize; if size==0||size>2097152{return Err("LIMIT".into())}
 let mut frame=vec![0;size]; receive_exact(&stream,&mut frame,deadline)?;
 // One request per development invocation; writer half must close. Trailing
 // frames, truncation and a stalled peer fail before any transaction effect.
 let mut extra=[0]; if receive(&stream,&mut extra,deadline)?!=0{return Err("INVALID".into())}
 let result=execute(root,candidate,&frame);
 let response=match result {Ok(outcome)=>format!("{{\"classification\":\"development-candidate\",\"deployable\":false,\"outcome\":\"{outcome}\"}}"),Err(code)=>format!("{{\"classification\":\"development-candidate\",\"deployable\":false,\"error\":\"{code}\"}}")};
 stream.write_all(&(response.len() as u32).to_be_bytes()).and_then(|_|stream.write_all(response.as_bytes())).map_err(|_|"IO")?; Ok(())
}
