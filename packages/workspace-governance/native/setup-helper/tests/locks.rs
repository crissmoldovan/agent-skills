use std::{env, fs, os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt}, path::PathBuf, process::Command, time::{SystemTime, UNIX_EPOCH}};
use workspace_governance_setup_native::fs::{SafeDir, Failure};

const NAME: &str = ".workspacectl-lock-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
fn fixture() -> PathBuf {
    let root = PathBuf::from(env::var_os("WG_NATIVE_TEST_ROOT").expect("explicit private harness required"));
    let path = root.join(format!("locks-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
    fs::DirBuilder::new().mode(0o700).create(&path).unwrap();
    path
}

#[test]
fn lock_child_probe() {
    let Some(path) = env::var_os("WG_LOCK_CHILD") else { return };
    let dir = SafeDir::open(&PathBuf::from(path)).unwrap();
    assert!(matches!(dir.acquire_lock(NAME), Err(Failure::Locked)));
    let lock = fs::metadata(PathBuf::from(env::var_os("WG_LOCK_CHILD").unwrap()).join(NAME)).unwrap();
    for entry in fs::read_dir("/proc/self/fd").unwrap() {
        if let Ok(facts) = fs::metadata(entry.unwrap().path()) {
            assert_ne!((facts.dev(), facts.ino()), (lock.dev(), lock.ino()), "lock descriptor leaked across exec");
        }
    }
}

#[test]
fn lock_rejects_nonderived_names_without_creating_files() {
    let root = fixture();
    let dir = SafeDir::open(&root).unwrap();
    for name in ["", "anything", "../outside", ".workspacectl-lock-", ".workspacectl-lock-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"] {
        assert!(matches!(dir.acquire_lock(name), Err(Failure::Invalid)));
    }
    assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
}

#[test]
fn persistent_lock_excludes_independent_process_and_survives_release() {
    let root = fixture();
    let dir = SafeDir::open(&root).unwrap();
    let held = dir.acquire_lock(NAME).unwrap();
    let before = fs::metadata(root.join(NAME)).unwrap();
    assert_eq!(before.mode() & 0o7777, 0o600);
    assert_eq!(before.nlink(), 1);
    assert!(matches!(dir.acquire_lock(NAME), Err(Failure::Locked)));
    let child = Command::new(env::current_exe().unwrap())
        .args(["--exact", "lock_child_probe", "--nocapture"])
        .env("WG_LOCK_CHILD", &root).output().unwrap();
    assert!(child.status.success(), "{}", String::from_utf8_lossy(&child.stderr));
    drop(held);
    let reacquired = dir.acquire_lock(NAME).unwrap();
    let after = fs::metadata(root.join(NAME)).unwrap();
    assert_eq!((before.dev(), before.ino()), (after.dev(), after.ino()));
    assert_eq!(fs::read(root.join(NAME)).unwrap(), b"");
    drop(reacquired);
    assert!(root.join(NAME).exists());
}

#[test]
fn lock_refuses_aliases_and_foreign_shapes_without_repair() {
    for shape in ["symlink", "hardlink", "directory", "mode", "fifo"] {
        let root = fixture();
        let path = root.join(NAME);
        match shape {
            "symlink" => std::os::unix::fs::symlink("absent", &path).unwrap(),
            "hardlink" => { fs::write(root.join("source"), b"retain").unwrap(); fs::hard_link(root.join("source"), &path).unwrap(); },
            "directory" => fs::create_dir(&path).unwrap(),
            "mode" => { fs::OpenOptions::new().write(true).create_new(true).mode(0o400).open(&path).unwrap(); },
            "fifo" => { let name = std::ffi::CString::new(path.to_str().unwrap()).unwrap(); assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0); },
            _ => unreachable!(),
        }
        let before = fs::symlink_metadata(&path).unwrap();
        assert!(SafeDir::open(&root).unwrap().acquire_lock(NAME).is_err());
        let after = fs::symlink_metadata(&path).unwrap();
        assert_eq!((before.ino(), before.mode(), before.nlink()), (after.ino(), after.mode(), after.nlink()));
    }
}
