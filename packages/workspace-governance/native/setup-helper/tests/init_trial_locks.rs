//! Multi-resource locking primitive evidence, not under-lock trial admission.
use std::{env,fs,os::unix::fs::{DirBuilderExt,MetadataExt},path::PathBuf,time::{SystemTime,UNIX_EPOCH}};
use workspace_governance_setup_native::fs::{InitLockSet,Failure};
fn fixture()->PathBuf{let root=PathBuf::from(env::var_os("WG_NATIVE_TEST_ROOT").unwrap());let p=root.join(format!("init-lockset-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));fs::DirBuilder::new().mode(0o700).create(&p).unwrap();p}
#[test]
fn independent_parents_sort_by_literal_bytes_and_keep_persistent_inodes(){
 let r=fixture();for d in ["a","a/z","a-b"]{fs::DirBuilder::new().mode(0o700).create(r.join(d)).unwrap()}
 let m=r.join("a-b/manifest.json");let s=r.join("a/z/state");
 let prepared=InitLockSet::prepare(&m,&s).unwrap();let paths=prepared.paths().to_vec();
 assert!(paths[0].as_os_str().as_encoded_bytes()<paths[1].as_os_str().as_encoded_bytes());
 assert_eq!(paths[0].parent().unwrap(),r.join("a-b"));assert!(paths.iter().all(|p|!p.exists()));
 let held=prepared.acquire().unwrap();let facts=paths.iter().map(|p|fs::metadata(p).unwrap()).collect::<Vec<_>>();
 assert!(matches!(InitLockSet::prepare(&m,&r.join("a/z/other-state")).unwrap().acquire(),Err(Failure::Locked)));
 assert!(matches!(InitLockSet::prepare(&r.join("a-b/other-manifest"),&s).unwrap().acquire(),Err(Failure::Locked)));
 drop(held);let held=InitLockSet::prepare(&m,&s).unwrap().acquire().unwrap();
 for(p,before)in paths.iter().zip(facts){let after=fs::metadata(p).unwrap();assert_eq!((before.dev(),before.ino()),(after.dev(),after.ino()));assert_eq!(after.mode()&0o7777,0o600);assert_eq!(fs::read(p).unwrap(),b"");}
 drop(held);
}
#[test]
fn invalid_second_parent_creates_no_first_lock(){
 let r=fixture();let m=r.join("manifest.json");let s=r.join("missing/state");assert!(InitLockSet::prepare(&m,&s).is_err());assert_eq!(fs::read_dir(r).unwrap().count(),0);
}
