//! Installed preview endpoint and authenticated strict initial-trial dispatcher.
use std::{io::{Read,Write},os::{fd::{AsRawFd,FromRawFd},unix::net::UnixStream},time::{Duration,Instant},process::ExitCode};
use sha2::{Digest,Sha256};
fn receive(stream:&UnixStream,bytes:&mut[u8],deadline:Instant)->Option<usize>{
 stream.set_read_timeout(Some(deadline.checked_duration_since(Instant::now())?)).ok()?;
 let mut iov=libc::iovec{iov_base:bytes.as_mut_ptr().cast(),iov_len:bytes.len()};
 // No ancillary buffer: Linux closes discarded rights. Reject at EVERY receive.
 let (n,flags)=unsafe{let mut msg:libc::msghdr=std::mem::zeroed();msg.msg_iov=&mut iov;msg.msg_iovlen=1;
  (libc::recvmsg(stream.as_raw_fd(),&mut msg,libc::MSG_CMSG_CLOEXEC),msg.msg_flags)};
 if n<0||flags&(libc::MSG_CTRUNC|libc::MSG_TRUNC)!=0{None}else{Some(n as usize)}
}
fn exact(stream:&UnixStream,mut bytes:&mut[u8],deadline:Instant)->Option<()>{
 while !bytes.is_empty(){let n=receive(stream,bytes,deadline)?;if n==0{return None}bytes=&mut bytes[n..];}Some(())
}
fn run()->Option<()>{
 let args:Vec<_>=std::env::args_os().collect();
 if args.len()!=3||args[1]!="--ipc-fd"||args[2]!="3"||std::env::vars_os().next().is_some(){return None}
 unsafe{
  let limit=libc::rlimit{rlim_cur:0,rlim_max:0};
  if libc::setrlimit(libc::RLIMIT_CORE,&limit)!=0||libc::prctl(libc::PR_SET_DUMPABLE,0,0,0,0)!=0{return None}
  for(option,expected)in[(libc::SO_DOMAIN,libc::AF_UNIX),(libc::SO_TYPE,libc::SOCK_STREAM)]{
   let mut v:libc::c_int=0;let mut len=std::mem::size_of_val(&v)as libc::socklen_t;
   if libc::getsockopt(3,libc::SOL_SOCKET,option,(&mut v as *mut libc::c_int).cast(),&mut len)!=0||v!=expected||len as usize!=std::mem::size_of_val(&v){return None}}
  let mut peer:libc::ucred=std::mem::zeroed();let mut len=std::mem::size_of_val(&peer)as libc::socklen_t;
  if libc::getsockopt(3,libc::SOL_SOCKET,libc::SO_PEERCRED,(&mut peer as *mut libc::ucred).cast(),&mut len)!=0||len as usize!=std::mem::size_of_val(&peer)||peer.uid!=libc::geteuid()||peer.pid!=libc::getppid(){return None}
  // Close unexpected inherited descriptors, never expose a general descriptor API.
  if libc::syscall(libc::SYS_close_range,4u32,u32::MAX,0u32)!=0{return None}
 }
 let mut stream=unsafe{UnixStream::from_raw_fd(3)};let deadline=Instant::now()+Duration::from_secs(5);
 let mut header=[0;4];exact(&stream,&mut header,deadline)?;let size=u32::from_be_bytes(header)as usize;
 if size==0||size>2097152{return None}let mut frame=vec![0;size];exact(&stream,&mut frame,deadline)?;
 if workspace_governance_setup_native::init::trial::controller::startup::is_startup(&frame) {
  return workspace_governance_setup_native::init::trial::controller::startup::helper_session(&frame,stream.as_raw_fd()).ok();
 }
 if receive(&stream,&mut[0],deadline)?!=0{return None}
 let mut binary=Vec::new();std::fs::File::open("/proc/self/exe").ok()?.take(16777217).read_to_end(&mut binary).ok()?;
 if binary.len()>16777216{return None}let hash=format!("{:x}",Sha256::digest(&binary));
 let response=match workspace_governance_setup_native::init::verify_preview(&frame,&hash){
  Ok(())=>"{\"executable\":false,\"valid\":true}".to_owned(),Err(code)=>format!("{{\"error\":\"{code}\",\"executable\":false}}")};
 stream.set_write_timeout(Some(deadline.checked_duration_since(Instant::now())?)).ok()?;
 stream.write_all(&(response.len()as u32).to_be_bytes()).ok()?;stream.write_all(response.as_bytes()).ok()?;Some(())
}
fn main()->ExitCode{if run().is_some(){ExitCode::SUCCESS}else{ExitCode::FAILURE}}
