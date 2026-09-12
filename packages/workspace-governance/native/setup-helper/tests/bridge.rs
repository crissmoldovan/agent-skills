use std::{io::{Read, Write}, os::{fd::AsRawFd, unix::{net::UnixStream, process::CommandExt}}, process::{Command, Stdio}, time::Duration};

fn start_bridge() -> (UnixStream, std::process::Child) {
    let (server, child) = UnixStream::pair().unwrap();
    server.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
    let fd = child.as_raw_fd();
    let mut command = Command::new(env!("CARGO_BIN_EXE_workspacectl-setup-askpass"));
    command.env_clear().env("WORKSPACE_AUTH_FD", "4").arg("Password for 'https://x-access-token@github.com/example/service.git': ")
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    unsafe { command.pre_exec(move || {
        if libc::dup2(fd, 4) < 0 || libc::fcntl(4, libc::F_SETFD, 0) < 0 { return Err(std::io::Error::last_os_error()); }
        Ok(())
    }); }
    let process = command.spawn().unwrap(); drop(child);
    (server, process)
}
fn consume_request(server: &mut UnixStream) {
    let mut size = [0; 4]; server.read_exact(&mut size).unwrap();
    assert!(u32::from_be_bytes(size) < 1024);
    let mut request = vec![0; u32::from_be_bytes(size) as usize]; server.read_exact(&mut request).unwrap();
}

#[test]
fn bridge_disables_core_dumping_before_request_and_bounds_total_wait() {
    let (mut server, mut process) = start_bridge(); consume_request(&mut server);
    let limits = std::fs::read_to_string(format!("/proc/{}/limits", process.id())).unwrap();
    let core: Vec<_> = limits.lines().find(|line| line.starts_with("Max core file size")).unwrap().split_whitespace().collect();
    assert_eq!(&core[4..6], &["0", "0"]);
    let start = std::time::Instant::now();
    while process.try_wait().unwrap().is_none() && start.elapsed() < Duration::from_secs(7) {
        std::thread::sleep(Duration::from_millis(25));
    }
    let finished = process.try_wait().unwrap().is_some();
    if !finished { process.kill().unwrap(); }
    let output = process.wait_with_output().unwrap();
    assert!(finished, "bridge exceeded the bounded deadline");
    assert!(!output.status.success()); assert!(output.stdout.is_empty()); assert!(output.stderr.is_empty());
}

#[test]
fn bridge_refuses_ancillary_descriptors_instead_of_silently_accepting_data() {
    let (mut server, process) = start_bridge(); consume_request(&mut server);
    let data = [1u8, 0, 0, 0, 1, b'x'];
    let mut control = [0usize; 8];
    let mut io = libc::iovec { iov_base: data.as_ptr() as *mut _, iov_len: data.len() };
    unsafe {
        let mut message: libc::msghdr = std::mem::zeroed();
        message.msg_iov = &mut io; message.msg_iovlen = 1;
        message.msg_control = control.as_mut_ptr().cast();
        message.msg_controllen = libc::CMSG_SPACE(std::mem::size_of::<i32>() as u32) as usize;
        let header = libc::CMSG_FIRSTHDR(&message);
        (*header).cmsg_level = libc::SOL_SOCKET; (*header).cmsg_type = libc::SCM_RIGHTS;
        (*header).cmsg_len = libc::CMSG_LEN(std::mem::size_of::<i32>() as u32) as usize;
        std::ptr::write_unaligned(libc::CMSG_DATA(header).cast::<i32>(), server.as_raw_fd());
        assert_eq!(libc::sendmsg(server.as_raw_fd(), &message, libc::MSG_NOSIGNAL), data.len() as isize);
    }
    let output = process.wait_with_output().unwrap();
    assert!(!output.status.success()); assert!(output.stdout.is_empty()); assert!(output.stderr.is_empty());
}

#[test]
fn bridge_rejects_tcp_descriptor_and_non_utf8_prompt_silently() {
    use std::os::unix::ffi::OsStringExt;
    let output = Command::new(env!("CARGO_BIN_EXE_workspacectl-setup-askpass")).env_clear()
        .arg(std::ffi::OsString::from_vec(vec![255])).output().unwrap();
    assert!(!output.status.success()); assert!(output.stdout.is_empty()); assert!(output.stderr.is_empty());
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let client = std::net::TcpStream::connect(listener.local_addr().unwrap()).unwrap();
    let (mut server, _) = listener.accept().unwrap();
    server.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
    let fd = client.as_raw_fd();
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_workspacectl-setup-askpass"));
    cmd.env_clear().env("WORKSPACE_AUTH_FD", "4").arg("Password for 'https://x-access-token@github.com/example/service.git': ")
        .stdout(Stdio::piped()).stderr(Stdio::piped());
    unsafe { cmd.pre_exec(move || {
        if libc::dup2(fd, 4) < 0 || libc::fcntl(4, libc::F_SETFD, 0) < 0 { return Err(std::io::Error::last_os_error()); }
        Ok(())
    }); }
    let mut process = cmd.spawn().unwrap(); drop(client);
    let mut bytes = [0; 1024];
    let read = server.read(&mut bytes).unwrap_or(usize::MAX);
    if read != 0 { let _ = process.kill(); }
    let output = process.wait_with_output().unwrap();
    assert_eq!(read, 0, "non-unix socket received a request");
    assert!(!output.status.success()); assert!(output.stdout.is_empty()); assert!(output.stderr.is_empty());
}

#[test]
fn bridge_deadline_also_bounds_blocked_git_output_pipe() {
    let (mut server, mut process) = start_bridge(); consume_request(&mut server);
    let output_fd = process.stdout.as_ref().unwrap().as_raw_fd();
    assert_eq!(unsafe { libc::fcntl(output_fd, libc::F_SETPIPE_SZ, 4096) }, 4096);
    server.write_all(&[1, 0, 0, 16, 0]).unwrap(); server.write_all(&vec![b'x'; 4096]).unwrap();
    let start = std::time::Instant::now();
    while process.try_wait().unwrap().is_none() && start.elapsed() < Duration::from_secs(7) {
        std::thread::sleep(Duration::from_millis(25));
    }
    let finished = process.try_wait().unwrap().is_some();
    if !finished { process.kill().unwrap(); }
    let output = process.wait_with_output().unwrap();
    assert!(finished, "blocked output escaped the five-second bridge deadline");
    assert!(!output.status.success()); assert!(output.stderr.is_empty());
}

#[test]
fn invalid_token_bytes_refuse_without_echoing_and_missing_fd_is_silent() {
    for token in [b"bad\nvalue".as_slice(), b"bad\0value".as_slice(), b"bad value".as_slice(), &[255]] {
        let (mut server, child) = UnixStream::pair().unwrap();
        let fd = child.as_raw_fd();
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_workspacectl-setup-askpass"));
        cmd.env_clear().env("WORKSPACE_AUTH_FD", "4").arg("Password for 'https://x-access-token@github.com/example/service.git': ")
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        unsafe { cmd.pre_exec(move || {
            if libc::dup2(fd, 4) < 0 || libc::fcntl(4, libc::F_SETFD, 0) < 0 { return Err(std::io::Error::last_os_error()); }
            Ok(())
        }); }
        let process = cmd.spawn().unwrap(); drop(child);
        let mut size = [0; 4]; server.read_exact(&mut size).unwrap();
        let mut request = vec![0; u32::from_be_bytes(size) as usize]; server.read_exact(&mut request).unwrap();
        server.write_all(&[1]).unwrap(); server.write_all(&(token.len() as u32).to_be_bytes()).unwrap(); server.write_all(token).unwrap();
        let output = process.wait_with_output().unwrap();
        assert!(!output.status.success()); assert!(output.stdout.is_empty()); assert!(output.stderr.is_empty());
    }
    let output = Command::new(env!("CARGO_BIN_EXE_workspacectl-setup-askpass")).env_clear()
        .arg("Username for 'https://github.com/example/service.git': ").output().unwrap();
    assert!(!output.status.success()); assert!(output.stdout.is_empty()); assert!(output.stderr.is_empty());
}

#[test]
fn bridge_uses_private_fd_four_and_exact_nonsecret_request() {
    let (mut server, child) = UnixStream::pair().unwrap();
    server.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
    let fd = child.as_raw_fd();
    let mut command = Command::new(env!("CARGO_BIN_EXE_workspacectl-setup-askpass"));
    command.env_clear().env("WORKSPACE_AUTH_FD", "4")
        .arg("Password for 'https://x-access-token@github.com/example/service.git': ")
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    // SAFETY: child-side pre-exec uses only async-signal-safe descriptor syscalls.
    unsafe { command.pre_exec(move || {
        if libc::dup2(fd, 4) < 0 || libc::fcntl(4, libc::F_SETFD, 0) < 0 { return Err(std::io::Error::last_os_error()); }
        Ok(())
    }); }
    let process = command.spawn().unwrap();
    drop(child);
    let mut size = [0; 4]; server.read_exact(&mut size).unwrap();
    let size = u32::from_be_bytes(size) as usize;
    assert!(size < 1024);
    let mut request = vec![0; size]; server.read_exact(&mut request).unwrap();
    assert_eq!(String::from_utf8(request).unwrap(), "{\"apiVersion\":\"workspace-governance/askpass-v1\",\"field\":\"password\",\"url\":\"https://github.com/example/service.git\"}");
    let fake = b"unique-synthetic-bridge-token";
    server.write_all(&[1]).unwrap();
    server.write_all(&(fake.len() as u32).to_be_bytes()).unwrap();
    server.write_all(fake).unwrap();
    let output = process.wait_with_output().unwrap();
    assert!(output.status.success());
    assert_eq!(output.stdout, [fake.as_slice(), b"\n"].concat());
    assert!(output.stderr.is_empty());
}
