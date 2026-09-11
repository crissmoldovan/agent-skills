use std::{ffi::CString, fs::{File, OpenOptions}, os::{fd::{AsRawFd, FromRawFd}, unix::fs::{MetadataExt, OpenOptionsExt}}, path::Path};

#[path = "init_locks.rs"]
mod init_locks;
pub use init_locks::{InitLockSet,HeldInitLocks};

#[derive(Debug, PartialEq, Eq)]
pub enum Failure { Invalid, Unsupported, DestinationExists, Locked, ToolFailure }

/// Owned flock descriptor. Closing releases the lock; the persistent inode is never removed.
/// This component must remain owned by the future supervisor through child shutdown.
#[derive(Debug)]
pub struct HeldLock { _file: File }

fn lock_metadata(file: &File) -> Result<std::fs::Metadata, Failure> {
    let facts = file.metadata().map_err(failure)?;
    // SAFETY: geteuid takes no pointers.
    if !facts.is_file() || facts.uid() != unsafe { libc::geteuid() } ||
        facts.mode() & 0o7777 != 0o600 || facts.nlink() != 1 {
        return Err(Failure::Unsupported);
    }
    Ok(facts)
}
fn failure(error: std::io::Error) -> Failure {
    match error.raw_os_error() {
        Some(libc::EEXIST) => Failure::DestinationExists,
        Some(libc::ENOSYS | libc::EINVAL | libc::EOPNOTSUPP | libc::EXDEV) => Failure::Unsupported,
        _ => Failure::ToolFailure,
    }
}
fn basename(value: &str) -> Result<CString, Failure> {
    if value.is_empty() || value.len() > 255 || value == "." || value == ".." ||
        value.chars().any(|c| c == '/' || c == '\\' || c.is_control()) { return Err(Failure::Invalid); }
    CString::new(value).map_err(|_| Failure::Invalid)
}
fn owned_nonwritable(file: &File) -> Result<(), Failure> {
    let metadata = file.metadata().map_err(failure)?;
    // SAFETY: geteuid has no pointer arguments or preconditions.
    let uid = unsafe { libc::geteuid() };
    if !metadata.is_dir() || (metadata.uid() != 0 && metadata.uid() != uid) || metadata.mode() & 0o022 != 0 {
        return Err(Failure::Unsupported);
    }
    Ok(())
}
/// Internal descriptor primitive. Does not replace deployment/mount/resource revalidation.
pub struct SafeDir(File);
impl SafeDir {
    pub(crate) fn file(&self) -> &File { &self.0 }
    pub fn open(path: &Path) -> Result<Self, Failure> {
        let literal = path.to_str().ok_or(Failure::Invalid)?;
        if !literal.starts_with('/') || literal.len() > 4096 || literal.contains("//") ||
            (literal.len() > 1 && literal.ends_with('/')) { return Err(Failure::Invalid); }
        let mut file = OpenOptions::new().read(true).custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open("/").map_err(failure)?;
        owned_nonwritable(&file)?;
        if literal != "/" {
            for part in literal[1..].split('/') {
                let name = basename(part)?;
                // SAFETY: live owned parent descriptor, valid NUL-terminated component; no output pointers.
                let fd = unsafe { libc::openat(file.as_raw_fd(), name.as_ptr(), libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC) };
                if fd < 0 { return Err(failure(std::io::Error::last_os_error())); }
                // SAFETY: successful openat returns a new exclusively owned descriptor, transferred exactly once.
                file = unsafe { File::from_raw_fd(fd) };
                owned_nonwritable(&file)?;
            }
        }
        Ok(Self(file))
    }
    /// Internal approved-bookkeeping primitive, not an approval or lock-order validator.
    pub fn acquire_lock(&self, name: &str) -> Result<HeldLock, Failure> {
        let hash = name.strip_prefix(".workspacectl-lock-").ok_or(Failure::Invalid)?;
        if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
            return Err(Failure::Invalid);
        }
        let name = basename(name)?;
        let flags = libc::O_RDWR | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK;
        // SAFETY: parent descriptor and CString are live; creation mode is supplied for O_CREAT.
        let mut fd = unsafe { libc::openat(self.0.as_raw_fd(), name.as_ptr(), flags | libc::O_CREAT | libc::O_EXCL, 0o600) };
        if fd < 0 {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() != Some(libc::EEXIST) { return Err(failure(error)); }
            // Inspect without opening devices/FIFOs for I/O. Quiescent-owner assumptions still apply.
            // SAFETY: live descriptor/name, no output pointers; O_PATH has no I/O effects.
            let probe = unsafe { libc::openat(self.0.as_raw_fd(), name.as_ptr(), libc::O_PATH | libc::O_NOFOLLOW | libc::O_CLOEXEC) };
            if probe < 0 { return Err(failure(std::io::Error::last_os_error())); }
            // SAFETY: the fresh descriptor is transferred once into File ownership.
            let probe = unsafe { File::from_raw_fd(probe) };
            let expected = lock_metadata(&probe)?;
            // SAFETY: validated regular path under the checked parent; no creation or truncation flags.
            fd = unsafe { libc::openat(self.0.as_raw_fd(), name.as_ptr(), flags) };
            if fd < 0 { return Err(failure(std::io::Error::last_os_error())); }
            // SAFETY: fresh descriptor is transferred once; every error below drops it.
            let file = unsafe { File::from_raw_fd(fd) };
            let observed = lock_metadata(&file)?;
            if (expected.dev(), expected.ino()) != (observed.dev(), observed.ino()) { return Err(Failure::Unsupported); }
            return self.finish_lock(file, &name);
        }
        // SAFETY: successful exclusive openat returns a new uniquely owned descriptor.
        self.finish_lock(unsafe { File::from_raw_fd(fd) }, &name)
    }
    fn finish_lock(&self, file: File, name: &CString) -> Result<HeldLock, Failure> {
        let before = lock_metadata(&file)?;
        // SAFETY: flock operates on the live owned file; no memory pointers.
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            let error = std::io::Error::last_os_error();
            return Err(if error.raw_os_error() == Some(libc::EWOULDBLOCK) { Failure::Locked } else { failure(error) });
        }
        let after = lock_metadata(&file)?;
        // SAFETY: initialized stat output, live parent descriptor and basename.
        let mut path: libc::stat = unsafe { std::mem::zeroed() };
        if unsafe { libc::fstatat(self.0.as_raw_fd(), name.as_ptr(), &mut path, libc::AT_SYMLINK_NOFOLLOW) } != 0 {
            return Err(failure(std::io::Error::last_os_error()));
        }
        if (before.dev(), before.ino()) != (after.dev(), after.ino()) ||
            (after.dev(), after.ino(), after.mode(), after.nlink()) != (path.st_dev, path.st_ino, path.st_mode, path.st_nlink) {
            return Err(Failure::Unsupported);
        }
        file.sync_all().map_err(failure)?;
        self.sync()?;
        Ok(HeldLock { _file: file })
    }
    pub fn sync(&self) -> Result<(), Failure> { self.0.sync_all().map_err(failure) }
    pub fn rename_noreplace(&self, source: &str, target: &Self, destination: &str) -> Result<(), Failure> {
        let source = basename(source)?;
        let destination = basename(destination)?;
        // SAFETY: live owned directory descriptors and NUL-terminated names live for the syscall.
        let rc = unsafe { libc::renameat2(self.0.as_raw_fd(), source.as_ptr(), target.0.as_raw_fd(), destination.as_ptr(), libc::RENAME_NOREPLACE) };
        if rc == 0 { Ok(()) } else { Err(failure(std::io::Error::last_os_error())) }
    }
}
