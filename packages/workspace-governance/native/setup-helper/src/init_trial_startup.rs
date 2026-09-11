//! Authenticated fixed startup and strict initial-trial transport.
//! A successful trial result proves fixture barriers, NOT qualification.
use super::*;
use std::{
    // Strict dispatcher shares the authenticated fixed launch only.
    os::unix::{net::UnixStream, process::CommandExt},
    process::{Child, Command, Stdio},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
#[path = "init_trial_dispatch.rs"]
mod dispatch;
const TAG: &str = "workspace-governance/init-trial-startup-v1";
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn startup_output_deadline_bounds_full_socket() {
        let (a, _b) = UnixStream::pair().unwrap();
        let size: libc::c_int = 4096;
        assert_eq!(
            unsafe {
                libc::setsockopt(
                    a.as_raw_fd(),
                    libc::SOL_SOCKET,
                    libc::SO_SNDBUF,
                    (&size as *const libc::c_int).cast(),
                    std::mem::size_of_val(&size) as u32,
                )
            },
            0
        );
        // Safety backstop for the RED implementation's blocking syscall.
        a.set_write_timeout(Some(Duration::from_millis(500)))
            .unwrap();
        let start = Instant::now();
        assert!(frame_write(
            a.as_raw_fd(),
            &vec![0; 262144],
            start + Duration::from_millis(50)
        )
        .is_err());
        assert!(
            start.elapsed() < Duration::from_millis(250),
            "a poll timeout must also bound the following write syscall"
        );
    }
}

struct Admission {
    root: PathBuf,
    bytes: Vec<u8>,
    candidate: Value,
    controller: ControllerWitness,
    life: TrialLifetime,
    node_pid: u32,
    node_start: u64,
    node_pidfd: File,
    records: Completion,
}
fn executable(pid: u32, expected: &Path) -> Result<()> {
    let proc = PathBuf::from(format!("/proc/{pid}/exe"));
    if std::fs::read_link(&proc).map_err(|_| Failure::Stale)? != expected {
        return Err(Failure::Stale);
    }
    let f = File::open(proc).map_err(|_| Failure::Stale)?;
    let named = openat(
        &open_directory(expected.parent().ok_or(Failure::Invalid)?)?,
        expected
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or(Failure::Invalid)?,
        libc::O_PATH,
    )?;
    if !same_file(&metadata(&f)?, &metadata(&named)?)
        || mount_id(&f)? != mount_id(&named)?
        || std::fs::metadata(format!("/proc/{pid}"))
            .map_err(|_| Failure::Stale)?
            .uid()
            != unsafe { libc::geteuid() }
    {
        return Err(Failure::Stale);
    }
    Ok(())
}
fn node_argv(c: &Value) -> Result<Vec<String>> {
    Ok(vec![
        text(field(field(c, "node")?, "path")?)?,
        "--require".into(),
        text(field(field(c, "launcher")?, "path")?)?,
        path(field(field(c, "engine")?, "path")?)?
            .join("dist/cli.js")
            .to_str()
            .ok_or(Failure::Invalid)?
            .into(),
    ])
}
fn argv_bytes(args: &[String]) -> Vec<u8> {
    let mut out = Vec::new();
    for a in args {
        out.extend_from_slice(a.as_bytes());
        out.push(0);
    }
    out
}
fn admit(root: &Path, bytes: &[u8], helper: bool) -> Result<Admission> {
    let v = json(bytes)?;
    exact(&v, &["apiVersion", "trial", "reservation"])?;
    literal_eq(field(&v, "apiVersion")?, TAG)?;
    let trust = read_trust(root)?;
    let trial_ref = field(&v, "trial")?;
    let trial_path = reference(trial_ref)?;
    let tid = hash(&string(
        trial_path
            .file_name()
            .and_then(|s| s.to_str())
            .and_then(|s| s.strip_suffix(".json"))
            .ok_or(Failure::Invalid)?,
    ))?;
    if trial_path != trust.registry_root.path.join(format!("{tid}.json")) {
        return invalid();
    }
    let tr = RegistryCapture::capture(trial_path)?;
    literal_eq(field(trial_ref, "sha256")?, &sha256(&tr.bytes))?;
    let reserved_ref = field(&v, "reservation")?;
    let reserved_path = reference(reserved_ref)?;
    if reserved_path
        != trust
            .registry_root
            .path
            .join(format!("{tid}.reserved.json"))
    {
        return invalid();
    }
    let reserved = RegistryCapture::capture(reserved_path)?;
    literal_eq(field(reserved_ref, "sha256")?, &sha256(&reserved.bytes))?;
    let r = json(&tr.bytes)?;
    let res = json(&reserved.bytes)?;
    let pid = decimal(field(field(&res, "controller")?, "pid")?)?;
    if pid == 0 || pid > i32::MAX as u64 {
        return invalid();
    }
    let controller = ControllerWitness::capture(&trust, pid as u32)?;
    let node_pid = if helper {
        (unsafe { libc::getppid() }) as u32
    } else {
        std::process::id()
    };
    let (parent, node_start) = process_facts(node_pid)?;
    if parent != pid as u32 {
        return Err(Failure::Stale);
    }
    let fd = unsafe { libc::syscall(libc::SYS_pidfd_open, node_pid, 0) };
    if fd < 0 {
        return Err(Failure::Unsupported);
    }
    let node_pidfd = unsafe { File::from_raw_fd(fd as i32) };
    let cb = read_file(
        &trust
            .registry_root
            .path
            .join(format!("{tid}.candidate.json")),
        262144,
        0o600,
    )?;
    let c = candidate(&cb, &trust)?;
    executable(node_pid, &path(field(field(&c.value, "node")?, "path")?)?)?;
    if kernel_bytes(&format!("/proc/{node_pid}/cmdline"), 16384)?
        != argv_bytes(&node_argv(&c.value)?)
        || !kernel_bytes(&format!("/proc/{node_pid}/environ"), 262144)?.is_empty()
    {
        return invalid();
    }
    if helper {
        executable(
            std::process::id(),
            &root.join("bin/workspacectl-init-helper"),
        )?;
    }
    let approve = text(field(field(&r, "invocation")?, "approvalDigest")?)?;
    let records = reserve_checked(
        &[
            "reserve".into(),
            literal(root)?.into(),
            tid,
            "--approve".into(),
            approve,
        ],
        Some((pid as u32, &reserved.bytes)),
    )?;
    tr.recheck()?;
    reserved.recheck()?;
    controller.recheck()?;
    let life = TrialLifetime::capture(&wire(field(&r, "lifetime")?)?)?;
    Ok(Admission {
        root: root.into(),
        bytes: bytes.into(),
        candidate: c.value,
        controller,
        life,
        node_pid,
        node_start,
        node_pidfd,
        records,
    })
}
impl Admission {
    fn live(&self) -> Result<()> {
        self.controller.recheck()?;
        self.life.recheck()?;
        self.records.recheck()?;
        let mut p = libc::pollfd {
            fd: self.node_pidfd.as_raw_fd(),
            events: libc::POLLIN,
            revents: 0,
        };
        if unsafe { libc::poll(&mut p, 1, 0) } != 0
            || p.revents != 0
            || process_facts(self.node_pid)? != (self.controller.pid, self.node_start)
        {
            return Err(Failure::Stale);
        }
        Ok(())
    }
}
/// Helper caller derives root from its actual executable, not this frame.
pub fn helper_session(bytes: &[u8], fd: i32) -> Result<()> {
    let exe = std::env::current_exe().map_err(|_| Failure::Unsupported)?;
    let root = exe
        .parent()
        .and_then(Path::parent)
        .ok_or(Failure::Invalid)?;
    if exe != root.join("bin/workspacectl-init-helper") {
        return invalid();
    }
    dispatch::serve(root, bytes, fd)
}
/// Called only on the already strictly validated launch completion.
pub fn launch_succeeded(bytes:&[u8])->bool {json(bytes).ok().and_then(|v|field(&v,"ok").ok().cloned())==Some(Value::Bool(true))}
pub fn is_startup(bytes: &[u8]) -> bool {
    json(bytes)
        .ok()
        .and_then(|v| field(&v, "apiVersion").ok().cloned())
        .is_some_and(|v| is(&v, TAG))
}
fn child_hygiene(parent: u32, group: bool) -> std::io::Result<()> {
    unsafe {
        if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) != 0
            || libc::getppid() != parent as i32
            || (group && libc::setpgid(0, 0) != 0)
            || libc::syscall(
                libc::SYS_close_range,
                3u32,
                u32::MAX,
                libc::CLOSE_RANGE_CLOEXEC,
            ) != 0
        {
            return Err(std::io::Error::last_os_error());
        }
        let r = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        if libc::setrlimit(libc::RLIMIT_CORE, &r) != 0 {
            return Err(std::io::Error::last_os_error());
        }
    }
    Ok(())
}
fn stop(child: &mut Child) {
    unsafe {
        libc::kill(child.id() as i32, libc::SIGTERM);
    }
    let until = Instant::now() + Duration::from_secs(5);
    while Instant::now() < until {
        if child.try_wait().ok().flatten().is_some() {
            return;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let _ = child.kill();
    let _ = child.wait();
}
fn reap_group(group: u32) -> Result<()> {
    // Only the fixed Node's private group; the controller is a subreaper.
    // TERM gets five seconds, then KILL. Do not release the registry while an
    // adopted child is still waitable (even on an error/timeout path).
    let until = Instant::now() + Duration::from_secs(5);
    let mut terminating = false;
    loop {
        let mut status = 0;
        let waited = unsafe { libc::waitpid(-(group as i32), &mut status, libc::WNOHANG) };
        if waited > 0 {
            continue;
        }
        if waited < 0 {
            return match std::io::Error::last_os_error().raw_os_error() {
                Some(libc::ECHILD) => Ok(()),
                Some(libc::EINTR) => continue,
                _ => Err(Failure::Unsupported),
            };
        }
        if !terminating {
            unsafe {
                libc::kill(-(group as i32), libc::SIGTERM);
            }
            terminating = true;
        }
        if Instant::now() >= until {
            unsafe {
                libc::kill(-(group as i32), libc::SIGKILL);
            }
            // Kernel reaping is not new trial authority and cannot be skipped
            // merely because a userspace deadline elapsed.
            let waited = unsafe { libc::waitpid(-(group as i32), &mut status, 0) };
            if waited < 0 && std::io::Error::last_os_error().raw_os_error() != Some(libc::EINTR) {
                return Err(Failure::Unsupported);
            }
        } else {
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}
fn frame_write(fd: i32, bytes: &[u8], until: Instant) -> Result<()> {
    if bytes.is_empty() || bytes.len() > 2097152 {
        return Err(Failure::Limit);
    }
    // poll readiness is not a promise that the whole frame fits. Never enter
    // a potentially unbounded blocking write after checking a deadline.
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(Failure::Unsupported);
    }
    let mut packet = (bytes.len() as u32).to_be_bytes().to_vec();
    packet.extend_from_slice(bytes);
    let mut at = 0;
    while at < packet.len() {
        poll_fd(fd, libc::POLLOUT, until)?;
        let n = unsafe { libc::write(fd, packet[at..].as_ptr().cast(), packet.len() - at) };
        if n < 0
            && matches!(
                std::io::Error::last_os_error().raw_os_error(),
                Some(libc::EAGAIN) | Some(libc::EINTR)
            )
        {
            continue;
        }
        if n <= 0 {
            return Err(Failure::Unsupported);
        }
        at += n as usize;
    }
    Ok(())
}
fn poll_fd(fd: i32, event: i16, until: Instant) -> Result<()> {
    let remaining = until
        .checked_duration_since(Instant::now())
        .ok_or(Failure::Stale)?;
    let mut p = libc::pollfd {
        fd,
        events: event,
        revents: 0,
    };
    if unsafe { libc::poll(&mut p, 1, remaining.as_millis().min(i32::MAX as u128) as i32) } <= 0
        || p.revents & (event | libc::POLLHUP) == 0
    {
        return Err(Failure::Stale);
    }
    Ok(())
}
fn exact_read(fd: i32, mut bytes: &mut [u8], until: Instant, socket: bool) -> Result<()> {
    while !bytes.is_empty() {
        poll_fd(fd, libc::POLLIN, until)?;
        let n = receive(fd, bytes, socket)?;
        if n == 0 {
            return invalid();
        }
        bytes = &mut bytes[n..];
    }
    Ok(())
}
fn receive(fd: i32, bytes: &mut [u8], socket: bool) -> Result<usize> {
    let n = if socket {
        let mut iov = libc::iovec {
            iov_base: bytes.as_mut_ptr().cast(),
            iov_len: bytes.len(),
        };
        let mut msg: libc::msghdr = unsafe { std::mem::zeroed() };
        msg.msg_iov = &mut iov;
        msg.msg_iovlen = 1;
        let n = unsafe { libc::recvmsg(fd, &mut msg, libc::MSG_CMSG_CLOEXEC) };
        if msg.msg_flags & (libc::MSG_CTRUNC | libc::MSG_TRUNC) != 0 {
            return invalid();
        }
        n
    } else {
        unsafe { libc::read(fd, bytes.as_mut_ptr().cast(), bytes.len()) }
    };
    if n < 0 {
        return Err(Failure::Unsupported);
    }
    Ok(n as usize)
}
fn frame_read(fd: i32, until: Instant, socket: bool) -> Result<Vec<u8>> {
    let mut h = [0; 4];
    exact_read(fd, &mut h, until, socket)?;
    let size = u32::from_be_bytes(h) as usize;
    if size == 0 || size > 262144 {
        return Err(Failure::Limit);
    }
    let mut b = vec![0; size];
    exact_read(fd, &mut b, until, socket)?;
    poll_fd(fd, libc::POLLIN, until)?;
    if receive(fd, &mut [0], socket)? != 0 {
        return invalid();
    }
    Ok(b)
}
/// Fixed controller-owned launch, always consumes before any candidate process.
/// The result is a strictly checked begin response, never qualification.
pub fn launch(args: &[String]) -> Result<Completion> {
    if args.len() != 5 || args[0] != "launch" || args[3] != "--approve" {
        return Err(Failure::Unsupported);
    }
    let mut reserve_args = args.to_vec();
    reserve_args[0] = "reserve".into();
    let mut completion = reserve(&reserve_args)?;
    let root = Path::new(&args[1]);
    let trust = read_trust(root)?;
    let tid = hash(&string(&args[2]))?;
    let trial_path = trust.registry_root.path.join(format!("{tid}.json"));
    let tr = RegistryCapture::capture(trial_path.clone())?;
    let r = json(&tr.bytes)?;
    let life = TrialLifetime::capture(&wire(field(&r, "lifetime")?)?)?;
    let cb = read_file(
        &trust
            .registry_root
            .path
            .join(format!("{tid}.candidate.json")),
        262144,
        0o600,
    )?;
    let c = candidate(&cb, &trust)?;
    let startup = wire(&object(vec![
        ("apiVersion", string(TAG)),
        (
            "trial",
            object(vec![
                ("path", string(literal(&trial_path)?)),
                ("sha256", string(&sha256(&tr.bytes))),
            ]),
        ),
        (
            "reservation",
            object(vec![
                (
                    "path",
                    string(literal(
                        &trust
                            .registry_root
                            .path
                            .join(format!("{tid}.reserved.json")),
                    )?),
                ),
                ("sha256", string(&sha256(&completion.bytes))),
            ]),
        ),
    ]))?;
    // Complete immutable/native recapture after durable consumption and before spawn.
    reserve_checked(&reserve_args, Some((std::process::id(), &completion.bytes)))?;
    let argv = node_argv(&c.value)?;
    let mut command = Command::new(&argv[0]);
    command
        .args(&argv[1..])
        .env_clear()
        .current_dir("/")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let parent = std::process::id();
    unsafe {
        command.pre_exec(move || child_hygiene(parent, true));
    }
    if unsafe { libc::prctl(libc::PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) } != 0 {
        return Err(Failure::Unsupported);
    }
    life.recheck()?;
    let mut child = command.spawn().map_err(|_| Failure::Unsupported)?;
    let outcome = (|| {
        let input = child.stdin.take().ok_or(Failure::Unsupported)?;
        let until = Instant::now() + Duration::from_secs(300);
        frame_write(input.as_raw_fd(), &startup, Instant::now()+Duration::from_secs(30))?;
        drop(input);
        let mut output = child.stdout.take().ok_or(Failure::Unsupported)?;
        unsafe {
            if libc::fcntl(output.as_raw_fd(), libc::F_SETFL, libc::O_NONBLOCK) < 0 {
                return Err(Failure::Unsupported);
            }
        }
        let mut bytes = Vec::new();
        let mut buf = [0; 4096];
        loop {
            life.recheck()?;
            completion.recheck()?;
            if Instant::now() >= until {
                return Err(Failure::Stale);
            }
            match output.read(&mut buf) {
                Ok(n) => {
                    bytes.extend_from_slice(&buf[..n]);
                    if bytes.len() > 262144 {
                        return Err(Failure::Limit);
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(_) => return Err(Failure::Unsupported),
            }
            if let Some(status) = child.try_wait().map_err(|_| Failure::Unsupported)? {
                output
                    .read_to_end(&mut bytes)
                    .map_err(|_| Failure::Unsupported)?;
                let operation = text(field(field(&r, "invocation")?, "operationId")?)?;
                let plan=json(&read_file(&trust.registry_root.path.join(format!("{tid}.plan.json")),262144,0o600)?)?;
                let success=dispatch::validate_response(&bytes,&operation,&plan,completion.recovery.as_ref().map(|c|&c.result))?;
                if status.code() != Some(if success{0}else{3})
                    || bytes != [wire(&json(&bytes)?)?.as_slice(), b"\n"].concat() {
                    return Err(Failure::Unsupported);
                }
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        Ok(bytes)
    })();
    // Own the direct Node and any orphaned fixed helper until proven quiescent.
    if outcome.is_err() {
        stop(&mut child);
    } else {
        let _ = child.wait();
    }
    reap_group(child.id())?;
    completion.recheck()?;
    completion.bytes = outcome?;
    Ok(completion)
}
fn run_helper(a: Admission) -> Result<Vec<u8>> {
    a.live()?;
    let fresh = admit(&a.root, &a.bytes, false)?;
    fresh.live()?;
    let (socket, peer) = UnixStream::pair().map_err(|_| Failure::Unsupported)?;
    let helper = path(field(field(&a.candidate, "helper")?, "path")?)?;
    let mut command = Command::new(helper);
    command
        .args(["--ipc-fd", "3"])
        .env_clear()
        .current_dir("/")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let fd = peer.as_raw_fd();
    let parent = std::process::id();
    unsafe {
        command.pre_exec(move || {
            child_hygiene(parent, false)?;
            if fd != 3 && libc::dup2(fd, 3) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            if libc::fcntl(3, libc::F_SETFD, 0) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    a.live()?;
    let mut child = command.spawn().map_err(|_| Failure::Unsupported)?;
    drop(peer);
    let result = (|| {
        let bytes = dispatch::exchange(&a, socket.as_raw_fd(), Instant::now()+Duration::from_secs(30))?;
        let until = Instant::now() + Duration::from_secs(5);
        a.live()?;
        loop {
            a.live()?;
            if Instant::now() >= until {
                return Err(Failure::Stale);
            }
            if let Some(status) = child.try_wait().map_err(|_| Failure::Unsupported)? {
                if !status.success() {
                    return Err(Failure::Unsupported);
                }
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        Ok(bytes)
    })();
    if result.is_err() {
        stop(&mut child);
    } else {
        let _ = child.wait();
    }
    result
}
// N-API entrypoints resolve only the Node ABI's fixed symbol names. No public
// argument, descriptor or executable selector is exported to JavaScript.
type Ptr = *mut libc::c_void;
unsafe fn symbol(name: &[u8]) -> Result<Ptr> {
    let p = libc::dlsym(libc::RTLD_DEFAULT, name.as_ptr().cast());
    if p.is_null() {
        Err(Failure::Unsupported)
    } else {
        Ok(p)
    }
}
unsafe fn throw(env: Ptr) {
    if let Ok(p) = symbol(b"napi_throw_error\0") {
        let f: unsafe extern "C" fn(Ptr, *const i8, *const i8) -> i32 = std::mem::transmute(p);
        f(
            env,
            b"UNSUPPORTED\0".as_ptr().cast(),
            b"Native trial startup refused\0".as_ptr().cast(),
        );
    }
}
static STARTUP: OnceLock<Mutex<Option<Admission>>> = OnceLock::new();
unsafe extern "C" fn invoke(env: Ptr, _info: Ptr) -> Ptr {
    let result = STARTUP
        .get()
        .and_then(|s| s.lock().ok())
        .and_then(|mut s| s.take())
        .ok_or(Failure::Stale)
        .and_then(run_helper);
    match result {
        Ok(bytes) => {
            let mut out = std::ptr::null_mut();
            if let Ok(p) = symbol(b"napi_create_string_utf8\0") {
                let f: unsafe extern "C" fn(Ptr, *const i8, usize, *mut Ptr) -> i32 =
                    std::mem::transmute(p);
                if f(env, bytes.as_ptr().cast(), bytes.len(), &mut out) == 0 {
                    return out;
                }
            }
        }
        Err(_) => {}
    }
    throw(env);
    std::ptr::null_mut()
}
#[no_mangle]
pub unsafe extern "C" fn napi_register_module_v1(env: Ptr, exports: Ptr) -> Ptr {
    let result = (|| -> Result<()> {
        let mut info: libc::Dl_info = std::mem::zeroed();
        if libc::dladdr(napi_register_module_v1 as *const () as Ptr, &mut info) == 0
            || info.dli_fname.is_null()
        {
            return Err(Failure::Unsupported);
        }
        let module = PathBuf::from(
            std::ffi::CStr::from_ptr(info.dli_fname)
                .to_str()
                .map_err(|_| Failure::Invalid)?,
        );
        literal(&module)?;
        let root = module
            .parent()
            .and_then(Path::parent)
            .ok_or(Failure::Invalid)?;
        if module != root.join("lib/init-launcher.node") {
            return invalid();
        }
        // Verify controller ancestry before reading the bounded private pipe.
        let trust = read_trust(root)?;
        ControllerWitness::capture(&trust, libc::getppid() as u32)?;
        let mut st: libc::stat = std::mem::zeroed();
        if libc::fstat(0, &mut st) != 0 || st.st_mode & libc::S_IFMT != libc::S_IFIFO {
            return invalid();
        }
        let bytes = frame_read(0, Instant::now() + Duration::from_secs(30), false)?;
        let a = admit(root, &bytes, false)?;
        if path(field(field(&a.candidate, "launcher")?, "path")?)? != module {
            return invalid();
        }
        STARTUP
            .set(Mutex::new(Some(a)))
            .map_err(|_| Failure::Stale)?;
        let get: unsafe extern "C" fn(Ptr, *mut Ptr) -> i32 =
            std::mem::transmute(symbol(b"napi_get_global\0")?);
        let create: unsafe extern "C" fn(
            Ptr,
            *const i8,
            usize,
            unsafe extern "C" fn(Ptr, Ptr) -> Ptr,
            Ptr,
            *mut Ptr,
        ) -> i32 = std::mem::transmute(symbol(b"napi_create_function\0")?);
        let set: unsafe extern "C" fn(Ptr, Ptr, *const i8, Ptr) -> i32 =
            std::mem::transmute(symbol(b"napi_set_named_property\0")?);
        let mut global = std::ptr::null_mut();
        let mut function = std::ptr::null_mut();
        let name = b"__workspacectlNativeTrialStartup\0";
        if get(env, &mut global) != 0
            || create(
                env,
                name.as_ptr().cast(),
                name.len() - 1,
                invoke,
                std::ptr::null_mut(),
                &mut function,
            ) != 0
            || set(env, global, name.as_ptr().cast(), function) != 0
        {
            return Err(Failure::Unsupported);
        }
        Ok(())
    })();
    if result.is_err() {
        throw(env);
    }
    exports
}
