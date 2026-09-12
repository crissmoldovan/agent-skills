//! Development-only source inclusion: no production dispatcher/export/feature enables this engine.
use workspace_governance_setup_native::{fs as safe_fs, init};
#[path = "../src/init_transaction.rs"]
mod transaction;
use std::{env, fs, os::unix::fs::{DirBuilderExt, MetadataExt}, path::PathBuf, time::{SystemTime, UNIX_EPOCH}};
use sha2::{Digest,Sha256};
const REQUEST: &[u8] = br#"{"apiVersion":"workspace-governance/init-request-v1","authorityId":"example-authority","rootNode":{"id":"example-org","kind":"organization","slug":"example","parentId":null,"visibility":{"mode":"public","readers":[]}}}"#;
fn candidate() -> String {
    let expected=env::var("WG_INIT_CANDIDATE_SHA256").expect("external runner must pin candidate before execution");
    assert_eq!(expected,format!("{:x}",Sha256::digest(fs::read(env::current_exe().unwrap()).unwrap())));
    expected
}
fn fixture() -> PathBuf {
    let parent=PathBuf::from(env::var_os("WG_NATIVE_TEST_ROOT").expect("external fixture root required"));
    safe_fs::SafeDir::open(&parent).unwrap();
    let root=parent.join(format!("init-transaction-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
    fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
    println!("development fixture: {}",root.display()); root
}
#[test]
fn crash_child() {
    let Some(root)=env::var_os("WG_INIT_CRASH_ROOT") else {return};
    let root=PathBuf::from(root);
    let parent=PathBuf::from(env::var_os("WG_NATIVE_TEST_ROOT").unwrap());
    assert_eq!(root.parent(),Some(parent.as_path()));
    assert!(root.file_name().unwrap().to_str().unwrap().starts_with("init-transaction-"));
    let stop=env::var("WG_INIT_CRASH_AT").unwrap();
    transaction::run(&root,REQUEST,&candidate(),|phase| {
        if phase==stop { unsafe {libc::raise(libc::SIGKILL)}; panic!("SIGKILL returned"); }
    }).unwrap();
    panic!("unreached crash boundary {stop}");
}
#[test]
fn actual_process_crash_recovers_proven_publication_without_replacing_bytes() {
    use std::{process::Command,os::unix::process::ExitStatusExt};
    let pin=candidate();
    for phase in ["allocation","manifest-renamed","manifest-fsynced","published","result","complete"] {
        let root=fixture();
        let output=Command::new(env::current_exe().unwrap()).args(["--exact","crash_child","--nocapture"])
            .env("WG_INIT_CRASH_ROOT",&root).env("WG_INIT_CRASH_AT",phase).output().unwrap();
        assert_eq!(output.status.signal(),Some(libc::SIGKILL),"{phase}: {}",String::from_utf8_lossy(&output.stderr));
        let before=fs::metadata(root.join("manifest.json")).ok().map(|m|m.ino());
        let result_before=fs::metadata(root.join("operation/result.json")).ok().map(|m|m.ino());
        assert!(transaction::run(&root,REQUEST,&pin, |_| {}).is_ok(),"recover {phase}");
        assert_eq!(fs::read(root.join("manifest.json")).unwrap(),init::derive_manifest(REQUEST).unwrap());
        if let Some(ino)=before {assert_eq!(ino,fs::metadata(root.join("manifest.json")).unwrap().ino())}
        if let Some(ino)=result_before {assert_eq!(ino,fs::metadata(root.join("operation/result.json")).unwrap().ino())}
        println!("actual SIGKILL boundary recovered: {phase}");
    }
}
#[test]
fn tampering_and_identity_replacement_never_repair_or_complete() {
    let pin=candidate();
    for path in ["bootstrap.json","operation-identity.json","operation/request.json","operation/state.json","operation/prepared.json","operation/intent.json","operation/allocation.json","operation/published.json","operation/result.json","operation/complete.json","manifest.json"] {
        let root=fixture(); transaction::run(&root,REQUEST,&pin, |_| {}).unwrap();
        fs::write(root.join(path),b"tampered").unwrap();
        assert!(transaction::run(&root,REQUEST,&pin, |_| {}).is_err(),"{path}");
        assert_eq!(fs::read(root.join(path)).unwrap(),b"tampered");
    }
    for path in ["manifest.json","operation/result.json"] {
        let root=fixture(); transaction::run(&root,REQUEST,&pin, |_| {}).unwrap();
        let bytes=fs::read(root.join(path)).unwrap(); let old=fs::metadata(root.join(path)).unwrap().ino();
        fs::rename(root.join(path),root.join("retained-original")).unwrap();
        fs::write(root.join(path),&bytes).unwrap();
        assert_ne!(fs::metadata(root.join(path)).unwrap().ino(),old);
        assert!(transaction::run(&root,REQUEST,&pin, |_| {}).is_err(),"replaced {path}");
        assert_eq!(fs::read(root.join(path)).unwrap(),bytes);
    }
}
#[test]
fn pre_identity_crashes_remain_uncertain_without_cleanup_or_publication() {
    use std::{process::Command,os::unix::process::ExitStatusExt};
    let pin=candidate();
    for phase in ["bootstrap-intent","operation-created","operation-identity","prepared","file-intent","temp-fsynced"] {
        let root=fixture();
        let output=Command::new(env::current_exe().unwrap()).args(["--exact","crash_child","--nocapture"])
            .env("WG_INIT_CRASH_ROOT",&root).env("WG_INIT_CRASH_AT",phase).output().unwrap();
        assert_eq!(output.status.signal(),Some(libc::SIGKILL));
        let pending=fs::read(root.join("manifest.pending")).ok();
        assert!(transaction::run(&root,REQUEST,&pin, |_| {}).is_err(),"uncertain {phase}");
        assert!(!root.join("manifest.json").exists());
        assert!(!root.join("operation/complete.json").exists());
        assert_eq!(pending,fs::read(root.join("manifest.pending")).ok());
        println!("actual SIGKILL boundary conservatively refused: {phase}");
    }
}
#[test]
fn publication_race_preserves_even_identical_foreign_inode() {
    let root=fixture(); let pin=candidate(); let bytes=init::derive_manifest(REQUEST).unwrap();
    let outcome=transaction::run(&root,REQUEST,&pin, |phase| {if phase=="allocation" {fs::write(root.join("manifest.json"),&bytes).unwrap();}});
    assert_eq!(outcome,Err(transaction::Error::Occupied));
    let ino=fs::metadata(root.join("manifest.json")).unwrap().ino();
    assert!(transaction::run(&root,REQUEST,&pin, |_| {}).is_err());
    assert_eq!(ino,fs::metadata(root.join("manifest.json")).unwrap().ino());
    assert!(root.join("manifest.pending").exists()); assert!(!root.join("operation/result.json").exists());
}
#[test]
fn identical_existing_manifest_creates_noop_ledger_without_rewriting_target() {
    let root=fixture(); let pin=candidate(); let bytes=init::derive_manifest(REQUEST).unwrap();
    fs::write(root.join("manifest.json"),&bytes).unwrap();
    let before=fs::metadata(root.join("manifest.json")).unwrap();
    assert!(transaction::run(&root,REQUEST,&pin, |_| {}).is_ok());
    let result=fs::read(root.join("operation/result.json")).unwrap();
    assert!(String::from_utf8_lossy(&result).contains("result-noop"));
    assert_eq!(before.ino(),fs::metadata(root.join("manifest.json")).unwrap().ino());
    assert_eq!(bytes,fs::read(root.join("manifest.json")).unwrap());
    assert!(!root.join("manifest.pending").exists());
    assert!(transaction::run(&root,REQUEST,&pin, |_| {}).is_ok());
    assert_eq!(result,fs::read(root.join("operation/result.json")).unwrap());
}
#[test]
fn candidate_inode_replacement_after_crash_cannot_be_recertified() {
    use std::{process::Command,os::unix::process::ExitStatusExt};
    let root=fixture(); let pin=candidate();
    let output=Command::new(env::current_exe().unwrap()).args(["--exact","crash_child","--nocapture"])
        .env("WG_INIT_CRASH_ROOT",&root).env("WG_INIT_CRASH_AT","result").output().unwrap();
    assert_eq!(output.status.signal(),Some(libc::SIGKILL));
    let path=root.join("operation/result.json"); let bytes=fs::read(&path).unwrap();
    fs::rename(&path,root.join("retained-original")).unwrap(); fs::write(&path,&bytes).unwrap();
    assert!(transaction::run(&root,REQUEST,&pin, |_| {}).is_err());
    assert!(!root.join("operation/complete.json").exists());
}
#[test]
fn foreign_manifest_refuses_before_even_lock_creation() {
    let root=fixture(); let pin=candidate(); fs::write(root.join("manifest.json"),b"foreign").unwrap();
    let inode=fs::metadata(root.join("manifest.json")).unwrap().ino();
    assert_eq!(transaction::run(&root,REQUEST,&pin, |_| {}),Err(transaction::Error::Occupied));
    assert_eq!(fs::read_dir(&root).unwrap().count(),1);
    assert_eq!(fs::read(root.join("manifest.json")).unwrap(),b"foreign");
    assert_eq!(fs::metadata(root.join("manifest.json")).unwrap().ino(),inode);
}
#[test]
fn completed_replay_preserves_every_record_and_manifest_inode() {
    let root=fixture(); let pin=candidate();
    transaction::run(&root,REQUEST,&pin, |_| {}).unwrap();
    let snapshot=|p:&std::path::Path| {let mut entries=fs::read_dir(p).unwrap().map(|e|e.unwrap().path()).collect::<Vec<_>>(); entries.sort(); entries.into_iter().filter(|p|p.is_file()).map(|p|(p.clone(),fs::metadata(&p).unwrap().ino(),fs::read(p).unwrap())).collect::<Vec<_>>()};
    let before=(snapshot(&root),snapshot(&root.join("operation")));
    assert!(transaction::run(&root,REQUEST,&pin, |_| {}).is_ok());
    assert_eq!(before,(snapshot(&root),snapshot(&root.join("operation"))));
}
#[test]
fn creates_real_manifest_and_immutable_rootless_transaction() {
    let root=fixture(); let pin=candidate();
    let outcome=transaction::run(&root,REQUEST,&pin, |_| {}).unwrap();
    assert_eq!(outcome,transaction::Outcome::Created);
    assert_eq!(fs::read(root.join("manifest.json")).unwrap(),init::derive_manifest(REQUEST).unwrap());
    assert_eq!(fs::metadata(root.join("manifest.json")).unwrap().mode()&0o7777,0o600);
    assert_eq!(fs::read(root.join("operation/state.json")).unwrap(),b"{\"apiVersion\":\"workspace-governance/setup-state-v1\",\"authorityId\":\"example-authority\",\"rootRegistration\":null}\n");
    assert!(root.join("operation/result.json").is_file());
    assert!(root.join("operation/complete.json").is_file());
    let output=std::process::Command::new(env::var_os("WG_NATIVE_NODE").unwrap())
        .arg(concat!(env!("CARGO_MANIFEST_DIR"),"/../../src/cli.ts"))
        .args(["validate","--manifest"]).arg(root.join("manifest.json")).env_clear().output().unwrap();
    assert!(output.status.success(),"legacy validator: {}",String::from_utf8_lossy(&output.stderr));
    let compact=String::from_utf8_lossy(&output.stdout).split_whitespace().collect::<String>();
    assert!(compact.contains("\"valid\":true"),"{}",String::from_utf8_lossy(&output.stdout));
    println!("unchanged legacy CLI readback: {}",String::from_utf8_lossy(&output.stdout));
}
// Bytes, inode, device and full mode of EVERY object, including directories.
fn inventory(root:&std::path::Path)->std::collections::BTreeMap<PathBuf,(u64,u64,u32,Vec<u8>)> {
 fn walk(root:&std::path::Path,path:&std::path::Path,out:&mut std::collections::BTreeMap<PathBuf,(u64,u64,u32,Vec<u8>)>) {
  let m=fs::symlink_metadata(path).unwrap();
  out.insert(path.strip_prefix(root).unwrap().to_path_buf(),(m.dev(),m.ino(),m.mode(),if m.is_file(){fs::read(path).unwrap()}else{Vec::new()}));
  if m.is_dir(){for entry in fs::read_dir(path).unwrap(){walk(root,&entry.unwrap().path(),out)}}
 }
 let mut out=std::collections::BTreeMap::new();walk(root,root,&mut out);out
}
#[test]
fn fresh_orphan_bookkeeping_refuses_before_even_lock_creation() {
 let pin=candidate();
 for name in ["manifest.pending",".manifest.pending.tmp",".bootstrap.json.tmp","operation-identity.json",".operation-identity.json.tmp","operation"] {
  let root=fixture();
  if name=="operation" {fs::DirBuilder::new().mode(0o700).create(root.join(name)).unwrap();}
  else {fs::write(root.join(name),b"forged").unwrap();}
  let before=inventory(&root);
  assert_eq!(transaction::run(&root,REQUEST,&pin, |_| {}),Err(transaction::Error::NeedsAttention),"{name}");
  assert!(inventory(&root)==before,"rejection changed fixture: {name}");
 }
}
#[test]
fn noop_rejects_every_create_branch_artifact_without_effects() {
 let pin=candidate();
 for name in ["operation/intent.json","operation/allocation.json","operation/published.json","manifest.pending",".manifest.pending.tmp"] {
  let root=fixture(); fs::write(root.join("manifest.json"),init::derive_manifest(REQUEST).unwrap()).unwrap();
  transaction::run(&root,REQUEST,&pin, |_| {}).unwrap();
  fs::write(root.join(name),b"forged").unwrap(); let before=inventory(&root);
  assert_eq!(transaction::run(&root,REQUEST,&pin, |_| {}),Err(transaction::Error::NeedsAttention),"{name}");
  assert_eq!(inventory(&root),before,"rejection changed fixture: {name}");
 }
}
#[test]
fn orphan_terminal_artifacts_refuse_before_any_replay_effect() {
 use std::{process::Command,os::unix::process::ExitStatusExt};
 let pin=candidate();
 for name in ["result-identity.json","result.pending",".result.pending.tmp",".result-identity.json.tmp",".result.json.tmp",".published.json.tmp",".complete.json.tmp"] {
  let root=fixture();
  let output=Command::new(env::current_exe().unwrap()).args(["--exact","crash_child","--nocapture"]).env("WG_INIT_CRASH_ROOT",&root).env("WG_INIT_CRASH_AT","allocation").output().unwrap();
  assert_eq!(output.status.signal(),Some(libc::SIGKILL));
  fs::write(root.join("operation").join(name),b"forged").unwrap(); let before=inventory(&root);
  assert_eq!(transaction::run(&root,REQUEST,&pin, |_| {}),Err(transaction::Error::NeedsAttention),"{name}");
  assert_eq!(inventory(&root),before,"rejection changed fixture: {name}");
 }
}
