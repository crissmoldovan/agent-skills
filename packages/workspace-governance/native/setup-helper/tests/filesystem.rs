use std::{env, fs, os::unix::fs::{DirBuilderExt, MetadataExt}, path::PathBuf, time::{SystemTime, UNIX_EPOCH}};
use workspace_governance_setup_native::fs::{SafeDir, Failure};

fn fixture() -> PathBuf {
    let root = PathBuf::from(env::var_os("WG_NATIVE_TEST_ROOT").expect("explicit private harness required"));
    let path = root.join(format!("native-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
    fs::DirBuilder::new().mode(0o700).create(&path).unwrap();
    path
}

#[test]
fn directory_walk_rejects_symlink_and_writable_ancestors_and_literal_traversal() {
    let root = fixture();
    fs::create_dir(root.join("real")).unwrap();
    fs::create_dir(root.join("real/child")).unwrap();
    std::os::unix::fs::symlink(root.join("real"), root.join("alias")).unwrap();
    assert!(SafeDir::open(&root.join("alias/child")).is_err());
    assert!(SafeDir::open(std::path::Path::new("/tmp")).is_err());
    assert!(SafeDir::open(&root.join("real/../real")).is_err());
    let dir = SafeDir::open(&root).unwrap();
    for name in ["", ".", "..", "../missing", "real/child", "/missing", "line\nfeed", "back\\slash"] {
        assert_eq!(dir.rename_noreplace(name, &dir, "other"), Err(Failure::Invalid));
        assert_eq!(dir.rename_noreplace("missing", &dir, name), Err(Failure::Invalid));
    }
}

#[test]
fn no_replace_preserves_foreign_empty_directory_and_source_identity() {
    let root = fixture();
    fs::create_dir(root.join("source")).unwrap();
    fs::create_dir(root.join("foreign")).unwrap();
    let source = fs::metadata(root.join("source")).unwrap().ino();
    let foreign = fs::metadata(root.join("foreign")).unwrap().ino();
    let dir = SafeDir::open(&root).unwrap();
    assert_eq!(dir.rename_noreplace("source", &dir, "foreign"), Err(Failure::DestinationExists));
    assert_eq!(fs::metadata(root.join("source")).unwrap().ino(), source);
    assert_eq!(fs::metadata(root.join("foreign")).unwrap().ino(), foreign);
    dir.rename_noreplace("source", &dir, "published").unwrap();
    dir.sync().unwrap();
    assert!(!root.join("source").exists());
    assert_eq!(fs::metadata(root.join("published")).unwrap().ino(), source);
}
