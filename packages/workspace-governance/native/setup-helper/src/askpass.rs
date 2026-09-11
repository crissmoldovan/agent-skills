use std::{env, io::Write, os::{fd::{AsRawFd, FromRawFd}, unix::net::UnixStream}, process::ExitCode, time::{Duration, Instant}};
use workspace_governance_setup_native::prompt::{parse_prompt, Field};

fn receive(channel: &UnixStream, mut bytes: &mut [u8], deadline: Instant) -> Option<()> {
    while !bytes.is_empty() {
        let remaining = deadline.checked_duration_since(Instant::now())?;
        channel.set_read_timeout(Some(remaining)).ok()?;
        let mut io = libc::iovec { iov_base: bytes.as_mut_ptr().cast(), iov_len: bytes.len() };
        // SAFETY: zero msghdr has no ancillary buffer; iovec points to live uniquely borrowed output.
        // Linux discards/closes unrepresentable SCM_RIGHTS; MSG_CTRUNC causes unconditional refusal.
        let (count, flags) = unsafe {
            let mut message: libc::msghdr = std::mem::zeroed();
            message.msg_iov = &mut io; message.msg_iovlen = 1;
            let count = libc::recvmsg(channel.as_raw_fd(), &mut message, libc::MSG_CMSG_CLOEXEC);
            (count, message.msg_flags)
        };
        if count <= 0 || flags & (libc::MSG_CTRUNC | libc::MSG_TRUNC) != 0 { return None; }
        bytes = &mut bytes[count as usize..];
    }
    Some(())
}
fn emit(mut bytes: &[u8], deadline: Instant) -> Option<()> {
    while !bytes.is_empty() {
        let remaining = deadline.checked_duration_since(Instant::now())?;
        let mut wait = libc::pollfd { fd: 1, events: libc::POLLOUT, revents: 0 };
        // SAFETY: one initialized pollfd; write reads only the live borrowed byte slice.
        let count = unsafe {
            if libc::poll(&mut wait, 1, remaining.as_millis().min(5000) as i32) <= 0 || wait.revents & libc::POLLOUT == 0 { return None; }
            libc::write(1, bytes.as_ptr().cast(), bytes.len())
        };
        if count < 0 {
            if std::io::Error::last_os_error().raw_os_error() == Some(libc::EAGAIN) { continue; }
            return None;
        }
        if count == 0 { return None; }
        bytes = bytes.get(count as usize..)?;
    }
    Some(())
}

struct Secret(Vec<u8>);
impl Drop for Secret {
    fn drop(&mut self) {
        // SAFETY: Vec storage is writable and lives through the call; explicit_bzero is not optimized away.
        unsafe { libc::explicit_bzero(self.0.as_mut_ptr().cast(), self.0.len()); }
    }
}
fn run() -> Option<()> {
    // SAFETY: valid initialized rlimit pointer; PR_SET_DUMPABLE takes an integer and no memory pointers.
    unsafe {
        let limit = libc::rlimit { rlim_cur: 0, rlim_max: 0 };
        if libc::setrlimit(libc::RLIMIT_CORE, &limit) != 0 || libc::prctl(libc::PR_SET_DUMPABLE, 0, 0, 0, 0) != 0 { return None; }
    }
    let arguments: Vec<_> = env::args_os().collect();
    if arguments.len() != 2 || env::var("WORKSPACE_AUTH_FD").ok().as_deref() != Some("4") { return None; }
    let prompt = parse_prompt(arguments[1].to_str()?)?;
    // SAFETY: initialized scalar/ucred output storage and accurate socklen_t lengths;
    // getsockopt validates fd4 before it is transferred into an owned stream.
    unsafe {
        for (option, expected) in [(libc::SO_DOMAIN, libc::AF_UNIX), (libc::SO_TYPE, libc::SOCK_STREAM)] {
            let mut value: libc::c_int = 0;
            let mut length = std::mem::size_of_val(&value) as libc::socklen_t;
            if libc::getsockopt(4, libc::SOL_SOCKET, option, (&mut value as *mut libc::c_int).cast(), &mut length) != 0 ||
                length as usize != std::mem::size_of_val(&value) || value != expected { return None; }
        }
        let mut peer = libc::ucred { pid: 0, uid: 0, gid: 0 };
        let mut length = std::mem::size_of_val(&peer) as libc::socklen_t;
        if libc::getsockopt(4, libc::SOL_SOCKET, libc::SO_PEERCRED, (&mut peer as *mut libc::ucred).cast(), &mut length) != 0 ||
            length as usize != std::mem::size_of_val(&peer) || peer.uid != libc::geteuid() || peer.pid <= 0 { return None; }
    }
    // SAFETY: fd4 is a valid Unix stream, transferred exactly once from the inherited protocol endpoint.
    let mut channel = unsafe { UnixStream::from_raw_fd(4) };
    let deadline = Instant::now() + Duration::from_secs(5);
    channel.set_write_timeout(Some(Duration::from_secs(5))).ok()?;
    let field = match prompt.field { Field::Username => "username", Field::Password => "password" };
    let request = format!("{{\"apiVersion\":\"workspace-governance/askpass-v1\",\"field\":\"{field}\",\"url\":\"{}\"}}", prompt.url);
    channel.write_all(&(request.len() as u32).to_be_bytes()).ok()?;
    channel.write_all(request.as_bytes()).ok()?;
    let mut header = [0; 5]; receive(&channel, &mut header, deadline)?;
    let size = u32::from_be_bytes(header[1..].try_into().ok()?) as usize;
    if header[0] != 1 || size == 0 || size > 4096 { return None; }
    let mut bytes = Secret(vec![0; size]); receive(&channel, &mut bytes.0, deadline)?;
    if !bytes.0.iter().all(|b| (0x21..=0x7e).contains(b)) { return None; }
    // Avoid stdio's persistent line buffer: only the explicitly wiped allocation owns token bytes.
    // SAFETY: valid stat storage; fcntl changes only the bridge's required Git stdout pipe.
    unsafe {
        let mut facts: libc::stat = std::mem::zeroed();
        if libc::fstat(1, &mut facts) != 0 || facts.st_mode & libc::S_IFMT != libc::S_IFIFO { return None; }
        let flags = libc::fcntl(1, libc::F_GETFL);
        if flags < 0 || libc::fcntl(1, libc::F_SETFL, flags | libc::O_NONBLOCK) < 0 { return None; }
    }
    emit(&bytes.0, deadline)?;
    emit(b"\n", deadline)?;
    Some(())
}
fn main() -> ExitCode { if run().is_some() { ExitCode::SUCCESS } else { ExitCode::FAILURE } }
