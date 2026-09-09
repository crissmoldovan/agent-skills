use std::{env, fs, io::Write, os::unix::fs::{DirBuilderExt, OpenOptionsExt}, path::PathBuf, time::{SystemTime, UNIX_EPOCH}};
use workspace_governance_setup_native::init::trial::{capture_directory, read_trust};

fn sha(b: &[u8]) -> String { use sha2::{Digest, Sha256}; format!("{:x}", Sha256::digest(b)) }
fn fixture() -> PathBuf {
    let p = PathBuf::from(env::var_os("WG_NATIVE_TEST_ROOT").unwrap()).join(format!("trial-trust-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
    fs::DirBuilder::new().mode(0o700).create(&p).unwrap(); p
}
fn file(p: &std::path::Path, bytes: &[u8], mode: u32) {
    let mut f = fs::OpenOptions::new().write(true).create_new(true).mode(mode).open(p).unwrap(); f.write_all(bytes).unwrap();
}
fn directory(p: &std::path::Path) { fs::DirBuilder::new().mode(0o700).create(p).unwrap(); }
fn anchor(root: &std::path::Path) -> String {
    format!("{{\"apiVersion\":\"workspace-governance/init-trial-trust-v1\",\"issuerUid\":{},\"controller\":{{\"path\":\"{}\",\"sha256\":\"{}\"}},\"registryRoot\":{},\"fixtureParent\":{},\"candidateManifestSha256\":\"{}\"}}", unsafe {libc::geteuid()}, root.join("controller").display(), sha(b"native-controller-placeholder-is-not-executed"), capture_directory(&root.join("registry")).unwrap().canonical_json(), capture_directory(&root.join("fixtures")).unwrap().canonical_json(), "a".repeat(64))
}
#[test]
fn mount_aliases_and_nested_mounts_are_rejected_without_mount_operations() {
    use workspace_governance_setup_native::init::trial::validate_mountinfo;
    let root = fixture(); let facts = capture_directory(&root).unwrap();
    let device = format!("{}:{}", libc::major(facts.dev), libc::minor(facts.dev));
    let line = format!("{} 1 {} / / rw,relatime - ext4 /dev/test rw\n", facts.mount_id, device);
    assert!(validate_mountinfo(line.as_bytes(), &facts).is_ok());
    for extra in [format!("999 1 {} / /alias rw - ext4 /dev/test rw\n",device), format!("999 1 0:999 / {}/nested rw - tmpfs none rw\n", root.display())] {
        assert!(validate_mountinfo(format!("{line}{extra}").as_bytes(), &facts).is_err());
    }
    for changed in [line.replace("ext4", "overlay"), line.replace(" / / ", " /subtree / "), line.replace("rw,relatime", "ro,relatime"), format!("{line}{line}")] {
        assert!(validate_mountinfo(changed.as_bytes(), &facts).is_err());
    }
}
#[test]
fn fixture_capture_rederives_request_identity_and_refuses_escape() {
    use workspace_governance_setup_native::init::trial::capture_fixture;
    use std::os::unix::fs::MetadataExt;
    let root = fixture();
    for name in ["operator", "registry", "fixtures", "evidence"] { directory(&root.join(name)); }
    file(&root.join("controller"), b"native-controller-placeholder-is-not-executed", 0o700);
    file(&root.join("operator/init-trial-trust-v1.json"), anchor(&root).as_bytes(), 0o600);
    let trust=read_trust(&root).unwrap(); let leaf=root.join("fixtures/fresh"); directory(&leaf);
    for name in ["manifest-parent","state-parent","inputs"] { directory(&leaf.join(name)); }
    let request=leaf.join("inputs/request.json"); file(&request,b"exact request bytes",0o600);
    let meta=fs::metadata(&request).unwrap(); let input_dir=capture_directory(&leaf.join("inputs")).unwrap();
    let bytes=format!("{{\"root\":{},\"manifestParent\":{},\"manifestBasename\":\"manifest.json\",\"stateParent\":{},\"stateBasename\":\"state\",\"request\":{{\"path\":\"{}\",\"kind\":\"file\",\"identity\":{{\"dev\":\"{}\",\"ino\":\"{}\"}},\"sha256\":\"{}\",\"treeDigest\":null,\"filesystem\":{{\"uid\":\"{}\",\"gid\":\"{}\",\"mode\":\"0600\",\"nlink\":\"1\",\"mountId\":\"{}\"}}}},\"evidenceRoot\":{}}}",capture_directory(&leaf).unwrap().canonical_json(),capture_directory(&leaf.join("manifest-parent")).unwrap().canonical_json(),capture_directory(&leaf.join("state-parent")).unwrap().canonical_json(),request.display(),meta.dev(),meta.ino(),sha(b"exact request bytes"),meta.uid(),meta.gid(),input_dir.mount_id,capture_directory(&root.join("evidence")).unwrap().canonical_json());
    let captured=capture_fixture(&trust,bytes.as_bytes()).unwrap();
    assert_eq!(captured.request_bytes,b"exact request bytes");
    assert_eq!(captured.manifest_path,leaf.join("manifest-parent/manifest.json"));
    assert_eq!(captured.state_path,leaf.join("state-parent/state"));
    for forged in [bytes.replace("\"manifest.json\"", "\"../escape\""),bytes.replace("\"state\"", "\".\""), bytes.replace("\"0600\"", "\"0644\""),bytes.replace("\"nlink\":\"1\"", "\"nlink\":\"2\""),bytes.replace("\"treeDigest\":null", "\"treeDigest\":\"forged\"")] { assert!(capture_fixture(&trust,forged.as_bytes()).is_err()); }
    for forbidden_evidence in [&root, &root.join("operator")] {
        let forged=bytes.replace(&capture_directory(&root.join("evidence")).unwrap().canonical_json(),&capture_directory(forbidden_evidence).unwrap().canonical_json());
        assert!(capture_fixture(&trust,forged.as_bytes()).is_err(),"evidence must not contain or alias the trust anchor");
    }
    fs::rename(&request,leaf.join("inputs/original.json")).unwrap(); file(&request,b"exact request bytes",0o600);
    assert!(capture_fixture(&trust,bytes.as_bytes()).is_err(),"same bytes/new inode must stale");
}
#[test]
fn native_controller_child_waits_on_private_stdin() {
    if env::var_os("WG_TRIAL_NATIVE_CHILD").is_some() {
        use std::io::{Read, Write};
        println!("ready"); std::io::stdout().flush().unwrap();
        let mut byte=[0]; let _=std::io::stdin().read(&mut byte);
    }
}
#[test]
fn controller_witness_pins_real_native_process_and_detects_exit() {
    use workspace_governance_setup_native::init::trial::ControllerWitness;
    use std::{io::{BufRead, BufReader}, process::{Command, Stdio}};
    let root=fixture();
    for name in ["operator","registry","fixtures"] { directory(&root.join(name)); }
    let executable=fs::read(env::current_exe().unwrap()).unwrap();
    file(&root.join("controller"),&executable,0o700);
    let bytes=anchor(&root).replace(&sha(b"native-controller-placeholder-is-not-executed"),&sha(&executable));
    file(&root.join("operator/init-trial-trust-v1.json"),bytes.as_bytes(),0o600);
    let trust=read_trust(&root).unwrap();
    let mut child=Command::new(root.join("controller")).args(["--exact","native_controller_child_waits_on_private_stdin","--nocapture"]).env_clear().env("WG_TRIAL_NATIVE_CHILD","1").stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
    let mut lines=BufReader::new(child.stdout.take().unwrap()); let mut ready=String::new();
    loop { ready.clear(); assert!(lines.read_line(&mut ready).unwrap()>0); if ready.trim()=="ready" { break; } }
    let witness=ControllerWitness::capture(&trust,child.id()).unwrap();
    witness.recheck().unwrap();
    assert!(ControllerWitness::capture(&trust,std::process::id()).is_err(),"same UID and native code at a different path is not the pinned controller");
    drop(child.stdin.take()); assert!(child.wait().unwrap().success());
    assert!(witness.recheck().is_err(),"pidfd death must invalidate authority facts");
}
fn snapshot(root: &std::path::Path) -> std::collections::BTreeMap<PathBuf,(u64,u64,u32,u64,Vec<u8>)> {
    use std::os::unix::fs::MetadataExt;
    let mut out=std::collections::BTreeMap::new(); let mut pending=vec![root.to_owned()];
    while let Some(p)=pending.pop() {
        let m=fs::symlink_metadata(&p).unwrap();
        let bytes=if m.is_file() {fs::read(&p).unwrap()} else if m.file_type().is_symlink() {fs::read_link(&p).unwrap().as_os_str().as_encoded_bytes().to_vec()} else {vec![]};
        if m.is_dir() {for e in fs::read_dir(&p).unwrap() {pending.push(e.unwrap().path());}}
        out.insert(p.strip_prefix(root).unwrap().to_owned(),(m.dev(),m.ino(),m.mode(),m.nlink(),bytes));
    } out
}
#[test]
fn trust_refusals_preserve_entire_fixture_and_never_repair() {
    for shape in ["missing","symlink","hardlink","fifo","directory","wrong-mode","unsafe-parent","unknown","duplicate-escaped","null","decimal","hash","uid","registry-drift","overlap","oversize"] {
        let root=fixture();
        for name in ["operator","registry","fixtures"] {directory(&root.join(name));}
        file(&root.join("controller"),b"native-controller-placeholder-is-not-executed",0o700);
        let mut bytes=anchor(&root); let sidecar=root.join("operator/init-trial-trust-v1.json");
        match shape {
            "missing"=>{},
            "symlink"=>{file(&root.join("outside"),bytes.as_bytes(),0o600);std::os::unix::fs::symlink("../outside",&sidecar).unwrap();},
            "hardlink"=>{file(&root.join("outside"),bytes.as_bytes(),0o600);fs::hard_link(root.join("outside"),&sidecar).unwrap();},
            "fifo"=>{let p=std::ffi::CString::new(sidecar.to_str().unwrap()).unwrap();assert_eq!(unsafe{libc::mkfifo(p.as_ptr(),0o600)},0);},
            "directory"=>directory(&sidecar),
            "wrong-mode"=>file(&sidecar,bytes.as_bytes(),0o400),
            "unsafe-parent"=>{fs::rename(root.join("operator"),root.join("old-operator")).unwrap();fs::DirBuilder::new().mode(0o777).create(root.join("operator")).unwrap();file(&sidecar,bytes.as_bytes(),0o600);},
            _=>{
                match shape {
                    "unknown"=>bytes=bytes.replacen('{',"{\"unrecognized\":true,",1),
                    "duplicate-escaped"=>bytes=bytes.replacen('{',"{\"issuer\\u0055id\":0,",1),
                    "null"=>bytes=bytes.replace(&format!("\"candidateManifestSha256\":\"{}\"","a".repeat(64)),"\"candidateManifestSha256\":null"),
                    "decimal"=>bytes=bytes.replacen("\"dev\":\"","\"dev\":\"0",1),
                    "hash"=>bytes=bytes.replace(&"a".repeat(64),&"A".repeat(64)),
                    "uid"=>bytes=bytes.replace(&format!("\"issuerUid\":{}",unsafe{libc::geteuid()}),"\"issuerUid\":4294967295"),
                    "registry-drift"=>{fs::rename(root.join("registry"),root.join("old-registry")).unwrap();directory(&root.join("registry"));},
                    "overlap"=>bytes=bytes.replace(&capture_directory(&root.join("registry")).unwrap().canonical_json(),&capture_directory(&root.join("fixtures")).unwrap().canonical_json()),
                    "oversize"=>bytes=" ".repeat(262145),
                    _=>unreachable!(),
                }
                file(&sidecar,bytes.as_bytes(),0o600);
            }
        }
        // Fixtures are constructed before measurement; no permissions on existing
        // source/runtime directories are changed. umask would mask the hostile mode.
        if shape=="unsafe-parent" {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(root.join("operator"),fs::Permissions::from_mode(0o777)).unwrap();
        }
        let before=snapshot(&root); assert!(read_trust(&root).is_err(),"{shape}"); assert_eq!(snapshot(&root),before,"{shape}");
    }
}
#[test]
fn boottime_deadline_is_fixed_bounded_and_cannot_be_renewed() {
    use workspace_governance_setup_native::init::trial::TrialLifetime;
    let now=|| {let mut t=libc::timespec {tv_sec:0,tv_nsec:0};assert_eq!(unsafe{libc::clock_gettime(libc::CLOCK_BOOTTIME,&mut t)},0);t.tv_sec as u64*1_000_000_000+t.tv_nsec as u64};
    let started=now();
    let wire=|issued:u64,deadline:u64| format!("{{\"issuedBoottimeNs\":\"{issued}\",\"deadlineBoottimeNs\":\"{deadline}\"}}");
    let valid=wire(started,started+600_000_000_000);
    let lifetime=TrialLifetime::capture(valid.as_bytes()).unwrap(); lifetime.recheck().unwrap();
    for invalid in [wire(started,started),wire(started,started+600_000_000_001),wire(started+60_000_000_000,started+120_000_000_000),wire(0,1),valid.replace("\"deadline", "\"extra\":true,\"deadline"),valid.replace(&started.to_string(),&format!("0{started}"))] {assert!(TrialLifetime::capture(invalid.as_bytes()).is_err());}
}
#[test]
fn candidate_files_are_measured_and_recaptured_not_self_attested() {
    use workspace_governance_setup_native::init::trial::CandidateFiles;
    let root=fixture(); file(&root.join("a"),b"actual artifact a",0o600); file(&root.join("b"),b"actual artifact b",0o700);
    let refs=format!("[{{\"path\":\"{}\",\"sha256\":\"{}\"}},{{\"path\":\"{}\",\"sha256\":\"{}\"}}]",root.join("a").display(),sha(b"actual artifact a"),root.join("b").display(),sha(b"actual artifact b"));
    let captured=CandidateFiles::capture(refs.as_bytes()).unwrap(); captured.recheck().unwrap();
    for invalid in ["[]".to_owned(),refs.replace(&sha(b"actual artifact a"),&"0".repeat(64)),refs.replace("\"sha256\":", "\"passed\":true,\"sha256\":"),refs.replace(&root.join("b").display().to_string(),&root.join("a").display().to_string())] {let before=snapshot(&root);assert!(CandidateFiles::capture(invalid.as_bytes()).is_err());assert_eq!(snapshot(&root),before);}
    fs::rename(root.join("a"),root.join("old-a")).unwrap();file(&root.join("a"),b"actual artifact a",0o600);
    assert!(captured.recheck().is_err(),"same bytes at new inode invalidate the captured candidate");
}
#[test]
fn candidate_paths_use_bytewise_not_component_order() {
    use workspace_governance_setup_native::init::trial::CandidateFiles;
    let root=fixture();directory(&root.join("a"));file(&root.join("a-b"),b"one",0o600);file(&root.join("a/z"),b"two",0o600);
    let first=format!("{{\"path\":\"{}\",\"sha256\":\"{}\"}}",root.join("a-b").display(),sha(b"one"));
    let second=format!("{{\"path\":\"{}\",\"sha256\":\"{}\"}}",root.join("a/z").display(),sha(b"two"));
    assert!(CandidateFiles::capture(format!("[{first},{second}]").as_bytes()).is_ok());
    assert!(CandidateFiles::capture(format!("[{second},{first}]").as_bytes()).is_err());
}
#[test]
fn fixed_sidecar_recaptures_directory_identities_and_controller_bytes() {
    let root = fixture();
    for name in ["operator", "registry", "fixtures"] { directory(&root.join(name)); }
    file(&root.join("controller"), b"native-controller-placeholder-is-not-executed", 0o700);
    let bytes = anchor(&root);
    file(&root.join("operator/init-trial-trust-v1.json"), bytes.as_bytes(), 0o600);
    let captured = read_trust(&root).unwrap();
    assert_eq!(captured.sha256, sha(bytes.as_bytes()));
    assert_eq!(captured.fixture_parent.path, root.join("fixtures"));
    assert_eq!(captured.registry_root.path, root.join("registry"));
    assert_eq!(captured.candidate_manifest_sha256, "a".repeat(64));
    // This returns measurements, not an execution grant or controller-liveness attestation.
    fs::rename(root.join("controller"), root.join("old-controller")).unwrap();
    file(&root.join("controller"), b"changed", 0o700);
    assert!(read_trust(&root).is_err());
}
