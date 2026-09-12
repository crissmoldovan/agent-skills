//! Local operator issuer. Registry effects only; NEVER calls the transaction engine.
//! Startup may inspect a consumed attempt; only the controller owns its lock.
use super::super::{action_value, canonical, policy};
use super::*;
use std::{collections::BTreeMap, io::Write, sync::Arc};
#[path = "init_trial_startup.rs"]
pub mod startup;
#[path = "init_trial_recovery.rs"]
mod recovery;
const CHECKS: [&str; 12] = [
    "artifact-consumer",
    "capability-isolation",
    "disconnect-orphan",
    "filesystem-crash",
    "flock-contention",
    "gate-subreaper",
    "init-approval",
    "init-integration",
    "init-terminal-recovery",
    "native-audit",
    "rename-fsync",
    "runtime-closure",
];
fn wire(v: &Value) -> Result<Vec<u8>> {
    canonical(v).map_err(|_| Failure::Limit)
}
fn json(bytes: &[u8]) -> Result<Value> {
    parse(bytes).map_err(|_| Failure::Invalid)
}
fn eq(a: &Value, b: &Value) -> Result<()> {
    if wire(a)? != wire(b)? {
        return invalid();
    }
    Ok(())
}
fn literal_eq(v: &Value, s: &str) -> Result<()> {
    if !is(v, s) {
        return invalid();
    }
    Ok(())
}
fn id(v: &Value) -> Result<String> {
    let s = text(v)?;
    if s.is_empty()
        || s.len() > 64
        || !s
            .bytes()
            .enumerate()
            .all(|(i, b)| b.is_ascii_alphanumeric() || (i > 0 && b"._-".contains(&b)))
    {
        return invalid();
    }
    Ok(s)
}
fn ascii(v: &Value) -> Result<String> {
    let s = text(v)?;
    if s.is_empty() || s.len() > 256 || !s.bytes().all(|b| (32..=126).contains(&b)) {
        return invalid();
    }
    Ok(s)
}
fn arr(v: &Value) -> Result<&Vec<Value>> {
    if let Value::Array(v) = v {
        Ok(v)
    } else {
        invalid()
    }
}
fn n(n: u64) -> Value {
    Value::Number(n as f64)
}
fn reference(v: &Value) -> Result<PathBuf> {
    exact(v, &["path", "sha256"])?;
    hash(field(v, "sha256")?)?;
    path(field(v, "path")?)
}
fn now() -> Result<u64> {
    let mut t = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    if unsafe { libc::clock_gettime(libc::CLOCK_BOOTTIME, &mut t) } != 0 || t.tv_sec < 0 {
        return Err(Failure::Unsupported);
    }
    (t.tv_sec as u64)
        .checked_mul(1_000_000_000)
        .and_then(|a| a.checked_add(t.tv_nsec as u64))
        .ok_or(Failure::Unsupported)
}
fn random() -> Result<String> {
    let mut b = [0u8; 32];
    let mut offset = 0;
    while offset < b.len() {
        let r = unsafe { libc::getrandom(b[offset..].as_mut_ptr().cast(), b.len() - offset, 0) };
        if r < 0 {
            if std::io::Error::last_os_error().raw_os_error() == Some(libc::EINTR) {
                continue;
            }
            return Err(Failure::Unsupported);
        }
        if r == 0 {
            return Err(Failure::Unsupported);
        }
        offset += r as usize;
    }
    Ok(b.iter().map(|x| format!("{x:02x}")).collect())
}
fn system_text(p: &str) -> Result<String> {
    String::from_utf8(kernel_bytes(p, 4096)?)
        .map(|s| s.trim_end_matches('\n').to_owned())
        .map_err(|_| Failure::Invalid)
}
fn environment(v: &Value, dirs: &[&DirectoryIdentity]) -> Result<()> {
    exact(
        v,
        &[
            "bootId",
            "kernelRelease",
            "glibcVersion",
            "mountNamespaceIno",
            "mountinfoSha256",
            "mounts",
        ],
    )?;
    literal_eq(
        field(v, "bootId")?,
        &system_text("/proc/sys/kernel/random/boot_id")?,
    )?;
    literal_eq(
        field(v, "kernelRelease")?,
        &system_text("/proc/sys/kernel/osrelease")?,
    )?;
    let glibc = unsafe { std::ffi::CStr::from_ptr(libc::gnu_get_libc_version()) }
        .to_str()
        .map_err(|_| Failure::Unsupported)?;
    literal_eq(field(v, "glibcVersion")?, glibc)?;
    if decimal(field(v, "mountNamespaceIno")?)?
        != std::fs::metadata("/proc/self/ns/mnt")
            .map_err(|_| Failure::Unsupported)?
            .ino()
    {
        return invalid();
    }
    let mi = kernel_bytes("/proc/self/mountinfo", 2097152)?;
    literal_eq(field(v, "mountinfoSha256")?, &sha256(&mi))?;
    let mut needed = BTreeMap::new();
    for d in dirs {
        validate_mountinfo(&mi, d)?;
        needed.insert(d.mount_id, d.dev);
    }
    let mut expected = Vec::new();
    let txt = std::str::from_utf8(&mi).map_err(|_| Failure::Invalid)?;
    for (mount, dev) in needed {
        let line = txt
            .lines()
            .find(|l| l.split(' ').next() == Some(mount.to_string().as_str()))
            .ok_or(Failure::Unsupported)?;
        let (left, right) = line.split_once(" - ").ok_or(Failure::Invalid)?;
        let l: Vec<_> = left.split(' ').collect();
        let r: Vec<_> = right.split(' ').collect();
        expected.push(object(vec![
            ("mountId", string(&mount.to_string())),
            ("dev", string(&dev.to_string())),
            ("filesystem", string(r[0])),
            (
                "optionsSha256",
                string(&sha256(format!("{}\n{}", l[5], r[2]).as_bytes())),
            ),
        ]));
    }
    eq(field(v, "mounts")?, &Value::Array(expected))
}
struct Candidate {
    value: Value,
    files: CandidateFiles,
}
fn candidate(bytes: &[u8], trust: &TrustCapture) -> Result<Candidate> {
    if sha256(bytes) != trust.candidate_manifest_sha256 {
        return invalid();
    }
    let v = json(bytes)?;
    exact(
        &v,
        &[
            "apiVersion",
            "classification",
            "release",
            "abi",
            "target",
            "helperArchive",
            "packedCli",
            "provenance",
            "engine",
            "helper",
            "launcher",
            "node",
            "capabilities",
            "runtimeFiles",
        ],
    )?;
    literal_eq(
        field(&v, "apiVersion")?,
        "workspace-governance/init-candidate-manifest-v1",
    )?;
    literal_eq(
        field(&v, "classification")?,
        "development-candidate/pending",
    )?;
    id(field(&v, "release")?)?;
    literal_eq(field(&v, "abi")?, "linux-init-helper-v1")?;
    literal_eq(field(&v, "target")?, "linux-x86_64-glibc236")?;
    let mut refs = BTreeMap::new();
    let mut add = |r: &Value| -> Result<()> {
        let p = reference(r)?;
        if let Some(old) = refs.insert(p, r.clone()) {
            eq(&old, r)?;
        }
        Ok(())
    };
    for k in ["helperArchive", "packedCli", "launcher", "capabilities"] {
        add(field(&v, k)?)?;
    }
    let provenance = field(&v, "provenance")?;
    exact(provenance, &["source", "build"])?;
    for k in ["source", "build"] {
        add(field(provenance, k)?)?;
    }
    for (k, extra) in [("helper", "abi"), ("node", "version")] {
        let a = field(&v, k)?;
        exact(a, &["path", "sha256", extra])?;
        if k == "helper" {
            literal_eq(field(a, extra)?, "linux-init-helper-v1")?;
        } else {
            let version = ascii(field(a, extra)?)?;
            if version
                .strip_prefix('v')
                .and_then(|v| v.split('.').next())
                .and_then(|v| v.parse::<u32>().ok())
                .is_none_or(|v| v < 24)
            {
                return Err(Failure::Unsupported);
            }
        }
        add(&object(vec![
            ("path", field(a, "path")?.clone()),
            ("sha256", field(a, "sha256")?.clone()),
        ]))?;
    }
    let runtime = arr(field(&v, "runtimeFiles")?)?;
    CandidateFiles::capture(&wire(field(&v, "runtimeFiles")?)?)?;
    if !runtime.contains(field(&v, "launcher")?) {
        return invalid();
    }
    for r in runtime {
        add(r)?;
    }
    let engine = field(&v, "engine")?;
    exact(engine, &["path", "treeSha256", "version"])?;
    eq(field(engine, "version")?, field(&v, "release")?)?;
    hash(field(engine, "treeSha256")?)?;
    let root = path(field(engine, "path")?)?;
    open_directory(&root)?;
    // The current issuer accepts regular-file-only engine trees. Symlink candidates
    // fail closed rather than claiming an unimplemented resolved-target closure audit.
    let mut pending = vec![root.clone()];
    let mut entries = BTreeMap::new();
    let mut count = 0;
    while let Some(d) = pending.pop() {
        open_directory(&d)?;
        for e in std::fs::read_dir(&d).map_err(|_| Failure::Unsupported)? {
            let p = e.map_err(|_| Failure::Unsupported)?.path();
            let rel = p
                .strip_prefix(&root)
                .map_err(|_| Failure::Invalid)?
                .to_str()
                .ok_or(Failure::Invalid)?
                .to_owned();
            let m = std::fs::symlink_metadata(&p).map_err(|_| Failure::Unsupported)?;
            count += 1;
            if count > 4096 {
                return Err(Failure::Limit);
            }
            if m.is_dir() {
                open_directory(&p)?;
                entries.insert(
                    rel.clone(),
                    object(vec![("path", string(&rel)), ("kind", string("directory"))]),
                );
                pending.push(p);
            } else if m.is_file() {
                let content = read_file_as(&p, 134217728, m.mode() & 0o7777, m.uid())?;
                let h = sha256(&content);
                let r = object(vec![
                    ("path", string(p.to_str().ok_or(Failure::Invalid)?)),
                    ("sha256", string(&h)),
                ]);
                add(&r)?;
                entries.insert(
                    rel.clone(),
                    object(vec![
                        ("path", string(&rel)),
                        ("kind", string("file")),
                        ("sha256", string(&h)),
                    ]),
                );
            } else {
                return Err(Failure::Unsupported);
            }
        }
    }
    literal_eq(
        field(engine, "treeSha256")?,
        &sha256(&wire(&Value::Array(entries.into_values().collect()))?),
    )?;
    let mut ordered: Vec<_> = refs.into_iter().collect();
    ordered.sort_by(|a, b| {
        a.0.as_os_str()
            .as_encoded_bytes()
            .cmp(b.0.as_os_str().as_encoded_bytes())
    });
    let files = CandidateFiles::capture(&wire(&Value::Array(
        ordered.into_iter().map(|(_, v)| v).collect(),
    ))?)?;
    // Reject known non-native executable/launcher bytes even while ABI/closure audit is pending.
    for role in ["helper", "node", "launcher"] {
        let p = path(field(field(&v, role)?, "path")?)?;
        let measured = files
            .files
            .iter()
            .find(|a| a.path == p)
            .ok_or(Failure::Invalid)?;
        if role != "launcher" && measured.mode & 0o100 == 0 {
            return Err(Failure::Unsupported);
        }
        let bytes = read_file_as(&p, 134217728, measured.mode, measured.uid)?;
        if bytes.len() < 64
            || &bytes[..7] != b"\x7fELF\x02\x01\x01"
            || u16::from_le_bytes([bytes[18], bytes[19]]) != 62
            || ![2, 3].contains(&u16::from_le_bytes([bytes[16], bytes[17]]))
            || (role == "launcher" && u16::from_le_bytes([bytes[16], bytes[17]]) != 3)
        {
            return Err(Failure::Unsupported);
        }
    }
    let helper_path = path(field(field(&v, "helper")?, "path")?)?;
    if helper_path != trust.install_root.join("bin/workspacectl-init-helper")
        || reference(field(&v, "launcher")?)? != trust.install_root.join("lib/init-launcher.node")
        || reference(field(&v, "capabilities")?)?
            != trust
                .install_root
                .join("share/init-helper-capabilities.json")
    {
        return invalid();
    }
    let cap_path = reference(field(&v, "capabilities")?)?;
    let caps = json(&read_file(&cap_path, 262144, 0o600)?)?;
    eq(
        &caps,
        &object(vec![
            (
                "apiVersion",
                string("workspace-governance/init-helper-capabilities-v1"),
            ),
            ("abi", string("linux-init-helper-v1")),
            ("release", field(&v, "release")?.clone()),
            ("target", string("linux-x86_64-glibc236")),
            (
                "helperSha256",
                field(field(&v, "helper")?, "sha256")?.clone(),
            ),
            (
                "operations",
                Value::Array(
                    ["capabilities", "begin", "cancel"]
                        .iter()
                        .map(|s| string(s))
                        .collect(),
                ),
            ),
            ("kinds", Value::Array(vec![string("manifest-init")])),
            ("maxFrameBytes", n(2097152)),
            ("filesystemProfile", string("local-durable-v1")),
            ("profileId", string("manifest-init-only-v1")),
            ("authKinds", Value::Array(vec![])),
        ]),
    )?;
    Ok(Candidate { value: v, files })
}
fn limits(v: &Value) -> Result<()> {
    eq(
        v,
        &object(vec![
            ("maxBegins", n(1)),
            ("maxActions", n(1)),
            ("maxStageContainers", n(0)),
        ]),
    )
}
fn intent(bytes: &[u8], trust: &TrustCapture) -> Result<(Value, FixtureCapture)> {
    intent_input(bytes, trust, None)
}
fn intent_input(bytes: &[u8], trust: &TrustCapture, saved: Option<&[u8]>) -> Result<(Value, FixtureCapture)> {
    let v = json(bytes)?;
    exact(
        &v,
        &[
            "apiVersion",
            "candidateManifestSha256",
            "environment",
            "fixture",
            "limits",
        ],
    )?;
    literal_eq(
        field(&v, "apiVersion")?,
        "workspace-governance/init-trial-intent-v1",
    )?;
    literal_eq(
        field(&v, "candidateManifestSha256")?,
        &trust.candidate_manifest_sha256,
    )?;
    limits(field(&v, "limits")?)?;
    let f = capture_fixture_input(trust, &wire(field(&v, "fixture")?)?, saved)?;
    let mut dirs = vec![trust.registry_root.clone(), trust.fixture_parent.clone()];
    for k in ["root", "manifestParent", "stateParent", "evidenceRoot"] {
        dirs.push(declared_directory(field(field(&v, "fixture")?, k)?)?);
    }
    environment(field(&v, "environment")?, &dirs.iter().collect::<Vec<_>>())?;
    Ok((v, f))
}
fn resource(p: &Path, tree: Option<&Value>) -> Result<Value> {
    literal(p)?;
    let parent = open_directory(p.parent().ok_or(Failure::Invalid)?)?;
    let name = p
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or(Failure::Invalid)?;
    let cp = cstr(name)?;
    let fd = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            cp.as_ptr(),
            libc::O_PATH | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    let (kind, identity, h, fs) = if fd < 0 {
        if std::io::Error::last_os_error().raw_os_error() != Some(libc::ENOENT) {
            return Err(Failure::Unsupported);
        }
        ("absent", Value::Null, Value::Null, Value::Null)
    } else {
        let f = unsafe { File::from_raw_fd(fd) };
        let m = metadata(&f)?;
        let mount = mount_id(&f)?;
        if !m.is_file() && !m.is_dir() {
            return Err(Failure::Unsupported);
        }
        if m.is_dir() {
            open_directory(p)?;
        } else if m.nlink() != 1
            || (m.uid() != 0 && m.uid() != unsafe { libc::geteuid() })
            || m.mode() & 0o7022 != 0
        {
            return Err(Failure::Unsupported);
        }
        let h = if m.is_file() {
            string(&sha256(&read_file_as(
                p,
                134217728,
                m.mode() & 0o7777,
                m.uid(),
            )?))
        } else {
            Value::Null
        };
        (
            if m.is_dir() { "directory" } else { "file" },
            object(vec![
                ("dev", string(&m.dev().to_string())),
                ("ino", string(&m.ino().to_string())),
            ]),
            h,
            object(vec![
                ("uid", string(&m.uid().to_string())),
                ("gid", string(&m.gid().to_string())),
                ("mode", string(&format!("{:04o}", m.mode() & 0o7777))),
                ("nlink", string(&m.nlink().to_string())),
                ("mountId", string(&mount.to_string())),
            ]),
        )
    };
    Ok(object(vec![
        ("path", string(p.to_str().ok_or(Failure::Invalid)?)),
        ("kind", string(kind)),
        ("identity", identity),
        ("sha256", h),
        ("treeDigest", tree.cloned().unwrap_or(Value::Null)),
        ("filesystem", fs),
    ]))
}
fn derive_plan(
    candidate_path: &Path,
    intent_path: &Path,
    trust: &TrustCapture,
    c: &Candidate,
    intent_bytes: &[u8],
    iv: &Value,
    f: &FixtureCapture,
) -> Result<Value> {
    derive_plan_input(candidate_path, intent_path, trust, c, intent_bytes, iv, f, None)
}
fn derive_plan_input(candidate_path: &Path, intent_path: &Path, trust: &TrustCapture, c: &Candidate, intent_bytes: &[u8], iv: &Value, f: &FixtureCapture, history: Option<(Option<&[u8]>, &BTreeMap<PathBuf, Value>)>) -> Result<Value> {
    let ctx = object(vec![
        (
            "apiVersion",
            string("workspace-governance/init-trial-setup-context-v1"),
        ),
        ("kind", string("manifest-init")),
        (
            "manifestPath",
            string(f.manifest_path.to_str().ok_or(Failure::Invalid)?),
        ),
        (
            "stateDir",
            string(f.state_path.to_str().ok_or(Failure::Invalid)?),
        ),
        ("root", Value::Null),
        ("nodeId", Value::Null),
        ("principal", Value::Null),
        (
            "requestPath",
            field(field(field(iv, "fixture")?, "request")?, "path")?.clone(),
        ),
        (
            "executorProfilePath",
            string(candidate_path.to_str().ok_or(Failure::Invalid)?),
        ),
    ]);
    let expected_executor = object(vec![
        (
            "apiVersion",
            string("workspace-governance/init-trial-executor-binding-v1"),
        ),
        ("profileId", string("manifest-init-only-trial-v1")),
        ("intentSha256", string(&sha256(intent_bytes))),
        (
            "candidateManifestSha256",
            field(iv, "candidateManifestSha256")?.clone(),
        ),
        ("helper", field(&c.value, "helper")?.clone()),
        (
            "platform",
            object(vec![
                ("os", string("linux")),
                ("arch", string("x64")),
                ("filesystemProfile", string("local-durable-v1")),
            ]),
        ),
    ]);
    let req = json(&f.request_bytes)?;
    let existing = if let Some((before, _)) = history {before.map(|b| b.to_vec())} else {match std::fs::symlink_metadata(&f.manifest_path) {
        Ok(_) => Some(read_file(&f.manifest_path, 262144, 0o600)?),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => return Err(Failure::Unsupported),
    }};
    let rev = existing
        .as_ref()
        .map(|b| string(&sha256(b)))
        .unwrap_or(Value::Null);
    let policy = policy::policy_value(&f.request_bytes).map_err(|_| Failure::Invalid)?;
    let action = action_value(
        &f.request_bytes,
        f.manifest_path.to_str().ok_or(Failure::Invalid)?,
        existing.as_deref(),
    )
    .map_err(|_| Failure::Invalid)?;
    let actions = if action == Value::Null {
        vec![]
    } else {
        vec![action]
    };
    let effects = object(vec![
        ("repositoryId", Value::Null),
        ("target", Value::Null),
        (
            "outcome",
            string(if actions.is_empty() {
                "already-initialized"
            } else {
                "manifest-created"
            }),
        ),
        ("refReview", Value::Null),
    ]);
    let mut locks = vec![];
    for p in [&f.manifest_path, &f.state_path] {
        locks.push(
            p.parent()
                .ok_or(Failure::Invalid)?
                .join(format!(
                    ".workspacectl-lock-{}",
                    sha256(p.as_os_str().as_encoded_bytes())
                ))
                .to_str()
                .ok_or(Failure::Invalid)?
                .to_owned(),
        );
    }
    locks.sort();
    locks.dedup();
    let bookkeeping = object(vec![
        (
            "stateParent",
            string(
                f.state_path
                    .parent()
                    .ok_or(Failure::Invalid)?
                    .to_str()
                    .ok_or(Failure::Invalid)?,
            ),
        ),
        (
            "stateDir",
            string(f.state_path.to_str().ok_or(Failure::Invalid)?),
        ),
        ("rootRegistration", Value::Null),
        (
            "lockPaths",
            Value::Array(locks.iter().map(|s| string(s)).collect()),
        ),
        ("operationNamespace", string("operations/")),
        ("maxActions", n(64)),
        ("maxStageContainers", n(1)),
        ("maxStageBytes", n(1073741824)),
    ]);
    // Rederive the complete captured issuance resource set, never trust supplied subsets.
    let mut paths = std::collections::BTreeSet::new();
    for a in &c.files.files {
        paths.insert(a.path.clone());
    }
    for p in [
        candidate_path,
        intent_path,
        trust.controller_path.as_path(),
        trust.registry_root.path.as_path(),
        trust.fixture_parent.path.as_path(),
        trust.install_root.as_path(),
        f.manifest_path.as_path(),
        f.state_path.as_path(),
    ] {
        paths.insert(p.to_owned());
    }
    for p in [
        "operator",
        "operator/init-trial-trust-v1.json",
        "bin",
        "lib",
        "share",
    ] {
        paths.insert(trust.install_root.join(p));
    }
    let fixture = field(iv, "fixture")?;
    for k in ["root", "manifestParent", "stateParent", "evidenceRoot"] {
        paths.insert(path(field(field(fixture, k)?, "path")?)?);
    }
    paths.insert(path(field(field(fixture, "request")?, "path")?)?);
    let engine = field(&c.value, "engine")?;
    let engine_root = path(field(engine, "path")?)?;
    paths.insert(engine_root.clone());
    let mut expected = Vec::new();
    for p in paths {
        expected.push(if let Some((_, resources)) = history {
            resources.get(&p).ok_or(Failure::Invalid)?.clone()
        } else {resource(
            &p,
            if p == engine_root {
                Some(field(engine, "treeSha256")?)
            } else {
                None
            },
        )?});
    }
    expected.sort_by(|a, b| {
        text(field(a, "path").unwrap())
            .unwrap()
            .as_bytes()
            .cmp(text(field(b, "path").unwrap()).unwrap().as_bytes())
    });
    // Existing state requires strict ledger recognition, not this issuance-only initial-apply path.
    if history.is_none() && std::fs::symlink_metadata(&f.state_path).is_ok() {
        return Err(Failure::Unsupported);
    }
    for p in [candidate_path, intent_path] {
        if overlaps(p, &trust.fixture_parent.path) || overlaps(p, &trust.registry_root.path) {
            return invalid();
        }
    }
    for a in &c.files.files {
        if overlaps(&a.path, &trust.fixture_parent.path)
            || overlaps(&a.path, &trust.registry_root.path)
        {
            return invalid();
        }
    }
    let mut p = object(vec![
        (
            "apiVersion",
            string("workspace-governance/init-trial-setup-plan-v1"),
        ),
        ("executable", Value::Bool(false)),
        ("kind", string("manifest-init")),
        ("context", ctx),
        ("authorityId", field(&req, "authorityId")?.clone()),
        ("manifestRevision", rev),
        ("requestDigest", string(&sha256(&f.request_bytes))),
        ("executor", expected_executor),
        ("policy", policy),
        ("resources", Value::Array(expected)),
        ("bookkeeping", bookkeeping),
        ("actions", Value::Array(actions)),
        ("effects", effects),
    ]);
    let digest = sha256(&wire(&p)?);
    if let Value::Object(ref mut items) = p {
        items.push(("digest".encode_utf16().collect(), string(&digest)));
    }
    Ok(p)
}
fn plan(
    bytes: &[u8],
    approve: &str,
    candidate_path: &Path,
    intent_path: &Path,
    trust: &TrustCapture,
    c: &Candidate,
    intent_bytes: &[u8],
    iv: &Value,
    f: &FixtureCapture,
) -> Result<Value> {
    hash(&string(approve))?;
    let supplied = json(bytes)?;
    let expected = derive_plan(candidate_path, intent_path, trust, c, intent_bytes, iv, f)?;
    eq(&supplied, &expected)?;
    literal_eq(field(&expected, "digest")?, approve)?;
    Ok(expected)
}

/// Read-only initial trial planning. No registry lock, publication or launch.
pub fn planning(args: &[String]) -> Result<Vec<u8>> {
    if args.len() != 4 || args[0] != "plan" {
        return Err(Failure::Unsupported);
    }
    let root = Path::new(&args[1]);
    let trust = read_trust(root)?;
    let witness = ControllerWitness::capture(&trust, std::process::id())?;
    let cb = bytes_file(&string(&args[2]))?;
    let ib = bytes_file(&string(&args[3]))?;
    let c = candidate(&cb, &trust)?;
    let (iv, f) = intent(&ib, &trust)?;
    let expected = derive_plan(
        Path::new(&args[2]),
        Path::new(&args[3]),
        &trust,
        &c,
        &ib,
        &iv,
        &f,
    )?;
    witness.recheck()?;
    c.files.recheck()?;
    let fresh = read_trust(root)?;
    if fresh.bytes != trust.bytes
        || bytes_file(&string(&args[2]))? != cb
        || bytes_file(&string(&args[3]))? != ib
    {
        return Err(Failure::Stale);
    }
    let c2 = candidate(&cb, &fresh)?;
    let (iv2, f2) = intent(&ib, &fresh)?;
    let current = derive_plan(
        Path::new(&args[2]),
        Path::new(&args[3]),
        &fresh,
        &c2,
        &ib,
        &iv2,
        &f2,
    )?;
    eq(&expected, &current)?;
    let bytes = wire(&expected)?;
    if bytes.len() > 262144 {
        return Err(Failure::Limit);
    }
    Ok(bytes)
}

fn publish(root: &Path, name: &str, bytes: &[u8]) -> Result<()> {
    if bytes.len() > 262144 {
        return Err(Failure::Limit);
    }
    let dir = open_directory(root)?;
    let temporary = format!("{name}.pending");
    let cname = cstr(&temporary)?;
    let fd = unsafe {
        libc::openat(
            dir.as_raw_fd(),
            cname.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC | libc::O_NOFOLLOW,
            0o600,
        )
    };
    if fd < 0 {
        return Err(Failure::Stale);
    }
    let mut f = unsafe { File::from_raw_fd(fd) };
    f.write_all(bytes).map_err(|_| Failure::Unsupported)?;
    f.sync_all().map_err(|_| Failure::Unsupported)?;
    dir.sync_all().map_err(|_| Failure::Unsupported)?;
    let dest = cstr(name)?;
    if unsafe {
        libc::renameat2(
            dir.as_raw_fd(),
            cname.as_ptr(),
            dir.as_raw_fd(),
            dest.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    } != 0
    {
        return Err(Failure::Stale);
    }
    dir.sync_all().map_err(|_| Failure::Unsupported)?;
    if read_file(&root.join(name), 262144, 0o600)? != bytes {
        return Err(Failure::Stale);
    }
    Ok(())
}
fn bytes_file(v: &Value) -> Result<Vec<u8>> {
    let p = path(v)?;
    read_file(&p, 262144, 0o600)
}
/// Keeps the registry descriptor owned until the operator invocation finishes output.
/// This guard is not transferable authority and offers no launch method.
pub struct Completion {
    pub bytes: Vec<u8>,
    _lock: Option<crate::fs::HeldLock>,
    captures: Vec<RegistryCapture>,
    recovery: Option<recovery::Completed>,
}
impl Completion {
    fn recheck(&self) -> Result<()> {
        if let Some(c) = &self.recovery {c.recheck()?;}
        for capture in &self.captures {
            if self.recovery.is_some() {
                let mut pending=capture.path.as_os_str().to_os_string();pending.push(".pending");
                match std::fs::symlink_metadata(PathBuf::from(pending)) {
                    Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{},
                    _=>return Err(Failure::Stale),
                }
            }
            capture.recheck()?;
        }
        Ok(())
    }
}
/// Operator-only issuance CLI, not a candidate request selector. No child path exists.
pub fn run(args: &[String]) -> Result<Completion> {
    if args.first().is_some_and(|s| s == "issue-recovery") {return recovery::issue(args)}
    if args.len() != 9
        || args[0] != "issue"
        || args[5] != "--approve"
        || args[7] != "--operation-id"
    {
        return Err(Failure::Unsupported);
    }
    let root = Path::new(&args[1]);
    let trust = read_trust(root)?;
    let witness = ControllerWitness::capture(&trust, std::process::id())?;
    id(&string(&args[8]))?;
    let cb = bytes_file(&string(&args[2]))?;
    let ib = bytes_file(&string(&args[3]))?;
    let pb = bytes_file(&string(&args[4]))?;
    let c = candidate(&cb, &trust)?;
    let (iv, f) = intent(&ib, &trust)?;
    let p = plan(
        &pb,
        &args[6],
        Path::new(&args[2]),
        Path::new(&args[3]),
        &trust,
        &c,
        &ib,
        &iv,
        &f,
    )?;
    let dir =
        crate::fs::SafeDir::open(&trust.registry_root.path).map_err(|_| Failure::Unsupported)?;
    let _lock = dir
        .acquire_lock(&format!(
            ".workspacectl-lock-{}",
            sha256(trust.registry_root.path.as_os_str().as_encoded_bytes())
        ))
        .map_err(|_| Failure::Unsupported)?;
    witness.recheck()?;
    c.files.recheck()?;
    let fresh = read_trust(root)?;
    if fresh.bytes != trust.bytes {
        return Err(Failure::Stale);
    }
    let under_candidate = candidate(&cb, &fresh)?;
    let (under_intent, under_fixture) = intent(&ib, &fresh)?;
    plan(
        &pb,
        &args[6],
        Path::new(&args[2]),
        Path::new(&args[3]),
        &fresh,
        &under_candidate,
        &ib,
        &under_intent,
        &under_fixture,
    )?;
    for (name, b) in [(&args[2], &cb), (&args[3], &ib), (&args[4], &pb)] {
        if bytes_file(&string(name))? != *b {
            return Err(Failure::Stale);
        }
    }
    let operation_name = format!("operation-{}.json", sha256(args[8].as_bytes()));
    let fixture_name = format!(
        "fixture-{}.json",
        sha256(f.root.path.as_os_str().as_encoded_bytes())
    );
    for name in [
        &operation_name,
        &format!("{operation_name}.pending"),
        &fixture_name,
        &format!("{fixture_name}.pending"),
    ] {
        match std::fs::symlink_metadata(trust.registry_root.path.join(name)) {
            Ok(_) => return Err(Failure::Stale),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(Failure::Unsupported),
        }
    }
    let tid = random()?;
    let issued = now()?;
    let lifetime = object(vec![
        ("issuedBoottimeNs", string(&issued.to_string())),
        (
            "deadlineBoottimeNs",
            string(&(issued + 600_000_000_000).to_string()),
        ),
    ]);
    TrialLifetime::capture(&wire(&lifetime)?)?;
    let trial = object(vec![
        (
            "apiVersion",
            string("workspace-governance/init-candidate-trial-v1"),
        ),
        ("classification", string("development-candidate/pending")),
        ("trialId", string(&tid)),
        ("issuerUid", n(trust.issuer_uid as u64)),
        ("trustAnchorSha256", string(&trust.sha256)),
        (
            "candidateManifestSha256",
            string(&trust.candidate_manifest_sha256),
        ),
        ("environment", field(&iv, "environment")?.clone()),
        ("lifetime", lifetime),
        ("fixture", field(&iv, "fixture")?.clone()),
        (
            "invocation",
            object(vec![
                ("mode", string("apply")),
                ("operationId", string(&args[8])),
                ("planSha256", string(&sha256(&pb))),
                ("approvalDigest", field(&p, "digest")?.clone()),
                ("priorTrialId", Value::Null),
            ]),
        ),
        ("limits", field(&iv, "limits")?.clone()),
        (
            "pendingCheckIds",
            Value::Array(CHECKS.iter().map(|s| string(s)).collect()),
        ),
    ]);
    let inputs = object(vec![
        ("candidatePath", string(&args[2])),
        ("intentPath", string(&args[3])),
        ("planPath", string(&args[4])),
    ]);
    let registry = &trust.registry_root.path;
    for name in [&fixture_name, &operation_name] {
        publish(
            registry,
            name,
            &wire(&object(vec![
                ("trialId", string(&tid)),
                ("operationId", string(&args[8])),
                ("approvalDigest", string(&args[6])),
            ]))?,
        )?;
    }
    for (suffix, b) in [
        ("candidate.json", cb),
        ("intent.json", ib),
        ("plan.json", pb),
        ("inputs.json", wire(&inputs)?),
    ] {
        publish(registry, &format!("{tid}.{suffix}"), &b)?;
    }
    let bytes = wire(&trial)?;
    publish(registry, &format!("{tid}.json"), &bytes)?;
    publish(
        registry,
        &format!("{tid}.issued.json"),
        &wire(&object(vec![
            (
                "apiVersion",
                string("workspace-governance/init-trial-issuance-v1"),
            ),
            ("trialId", string(&tid)),
            ("trialSha256", string(&sha256(&bytes))),
            ("inputsSha256", string(&sha256(&wire(&inputs)?))),
        ]))?,
    )?;
    Ok(Completion {
        bytes,
        _lock: Some(_lock),
        captures: Vec::new(),
        recovery: None,
    })
}
// Keep O_PATH witnesses alive across preflight and flock, so byte-identical
// replacement is stale too. Safe bounded reads independently rebind ancestry.
struct RegistryParentWitness {
    path: PathBuf,
    file: File,
    facts: std::fs::Metadata,
    mount: u64,
}
impl RegistryParentWitness {
    fn capture(path: &Path) -> Result<Arc<Self>> {
        literal(path)?;
        let file = open_directory(path)?;
        let facts = metadata(&file)?;
        let mount = mount_id(&file)?;
        Ok(Arc::new(Self { path: path.to_owned(), file, facts, mount }))
    }
}
struct RegistryCapture {
    path: PathBuf,
    parent: Arc<RegistryParentWitness>,
    file: File,
    facts: std::fs::Metadata,
    bytes: Vec<u8>,
}
impl RegistryCapture {
    fn capture(path: PathBuf) -> Result<Self> {
        let parent = RegistryParentWitness::capture(path.parent().ok_or(Failure::Invalid)?)?;
        Self::capture_with_parent(path, &parent)
    }
    fn capture_with_parent(path: PathBuf, parent: &Arc<RegistryParentWitness>) -> Result<Self> {
        if path.parent() != Some(parent.path.as_path()) {
            return invalid();
        }
        let file = openat(
            &parent.file,
            path.file_name()
                .and_then(|s| s.to_str())
                .ok_or(Failure::Invalid)?,
            libc::O_PATH,
        )?;
        let facts = metadata(&file)?;
        let bytes = read_file(&path, 262144, 0o600)?;
        let capture = Self {
            path,
            parent: Arc::clone(parent),
            file,
            facts,
            bytes,
        };
        capture.recheck()?;
        Ok(capture)
    }
    fn recheck(&self) -> Result<()> {
        let parent = open_directory(&self.parent.path)?;
        let a = metadata(&self.parent.file)?;
        let b = metadata(&parent)?;
        // Registry publication may evolve directory size/mtime/ctime, but not
        // identity, type/mode, ownership or link count. Completed operation
        // directories additionally retain full immutable facts in recovery::Dir.
        let safety = |m: &std::fs::Metadata| (m.dev(), m.ino(), m.mode(), m.uid(), m.gid(), m.nlink());
        if safety(&a) != safety(&self.parent.facts)
            || safety(&b) != safety(&self.parent.facts)
            || mount_id(&self.parent.file)? != self.parent.mount
            || mount_id(&parent)? != self.parent.mount
        {
            return Err(Failure::Stale);
        }
        let current = openat(
            &parent,
            self.path
                .file_name()
                .and_then(|s| s.to_str())
                .ok_or(Failure::Invalid)?,
            libc::O_PATH,
        )?;
        if (a.dev(), a.ino(), mount_id(&self.parent.file)?) != (b.dev(), b.ino(), mount_id(&parent)?)
            || !same_file(&self.facts, &metadata(&self.file)?)
            || !same_file(&self.facts, &metadata(&current)?)
            || mount_id(&self.file)? != mount_id(&current)?
            || read_file(&self.path, 262144, 0o600)? != self.bytes
        {
            return Err(Failure::Stale);
        }
        // Bind the read back to the original descriptor after I/O as well.
        let rebound = openat(
            &parent,
            self.path
                .file_name()
                .and_then(|s| s.to_str())
                .ok_or(Failure::Invalid)?,
            libc::O_PATH,
        )?;
        if !same_file(&self.facts, &metadata(&rebound)?)
            || mount_id(&self.file)? != mount_id(&rebound)?
        {
            return Err(Failure::Stale);
        }
        Ok(())
    }
}
fn reservation_inventory(
    captures: &[RegistryCapture],
    registry: &Path,
    tid: &str,
    admitted: bool,
) -> Result<()> {
    // Every completed issuance component is required; no final/pending pair is
    // a supported completed publication. Never clean up ambiguous bookkeeping.
    let mut forbidden: Vec<PathBuf> = captures
        .iter()
        .map(|c| {
            let mut name = c.path.as_os_str().to_os_string();
            name.push(".pending");
            PathBuf::from(name)
        })
        .collect();
    if !admitted {
        forbidden.push(registry.join(format!("{tid}.reserved.json")));
    }
    forbidden.push(registry.join(format!("{tid}.reserved.json.pending")));
    for path in forbidden {
        match std::fs::symlink_metadata(path) {
            Ok(_) => return Err(Failure::Stale),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(Failure::Unsupported),
        }
    }
    Ok(())
}
/// Durably consume one issued ID. No child launch, apply or recovery follows.
pub fn reserve(args: &[String]) -> Result<Completion> {
    reserve_checked(args, None)
}
// The private startup reader may inspect a consumed attempt, never reserve again.
fn reserve_checked(args: &[String], admission: Option<(u32, &[u8])>) -> Result<Completion> {
    if args.len() != 5 || args[0] != "reserve" || args[3] != "--approve" {
        return Err(Failure::Unsupported);
    }
    let tid = hash(&string(&args[2]))?;
    hash(&string(&args[4]))?;
    let root = Path::new(&args[1]);
    let trust = read_trust(root)?;
    let controller_pid = admission.map_or(std::process::id(), |a| a.0);
    let witness = ControllerWitness::capture(&trust, controller_pid)?;
    let registry = &trust.registry_root.path;
    let registry_parent = RegistryParentWitness::capture(registry)?;
    let mut captures = Vec::new();
    let mut load = |suffix: &str| -> Result<Vec<u8>> {
        let capture = RegistryCapture::capture_with_parent(
            registry.join(format!("{tid}{suffix}")),
            &registry_parent,
        )?;
        let bytes = capture.bytes.clone();
        captures.push(capture);
        Ok(bytes)
    };
    let rb = load(".json")?;
    let r = json(&rb)?;
    if is(field(field(&r,"invocation")?,"mode")?,"recover") {return recovery::reserve(args,admission)}
    exact(
        &r,
        &[
            "apiVersion",
            "classification",
            "trialId",
            "issuerUid",
            "trustAnchorSha256",
            "candidateManifestSha256",
            "environment",
            "lifetime",
            "fixture",
            "invocation",
            "limits",
            "pendingCheckIds",
        ],
    )?;
    literal_eq(
        field(&r, "apiVersion")?,
        "workspace-governance/init-candidate-trial-v1",
    )?;
    literal_eq(
        field(&r, "classification")?,
        "development-candidate/pending",
    )?;
    literal_eq(field(&r, "trialId")?, &tid)?;
    if uid(field(&r, "issuerUid")?)? != trust.issuer_uid {
        return invalid();
    }
    literal_eq(field(&r, "trustAnchorSha256")?, &trust.sha256)?;
    literal_eq(
        field(&r, "candidateManifestSha256")?,
        &trust.candidate_manifest_sha256,
    )?;
    let life = TrialLifetime::capture(&wire(field(&r, "lifetime")?)?)?;
    // This reader admits only this issuer's initial pending-only slice. A
    // subset is not a qualification result and is not an issuance we produce.
    eq(
        field(&r, "pendingCheckIds")?,
        &Value::Array(CHECKS.iter().map(|s| string(s)).collect()),
    )?;
    let invocation = field(&r, "invocation")?;
    exact(
        invocation,
        &[
            "mode",
            "operationId",
            "planSha256",
            "approvalDigest",
            "priorTrialId",
        ],
    )?;
    literal_eq(field(invocation, "mode")?, "apply")?;
    id(field(invocation, "operationId")?)?;
    eq(field(invocation, "priorTrialId")?, &Value::Null)?;
    literal_eq(field(invocation, "approvalDigest")?, &args[4])?;
    let cb = load(".candidate.json")?;
    let ib = load(".intent.json")?;
    let pb = load(".plan.json")?;
    let inputs_b = load(".inputs.json")?;
    let inputs = json(&inputs_b)?;
    exact(&inputs, &["candidatePath", "intentPath", "planPath"])?;
    let issued = json(&load(".issued.json")?)?;
    eq(
        &issued,
        &object(vec![
            (
                "apiVersion",
                string("workspace-governance/init-trial-issuance-v1"),
            ),
            ("trialId", string(&tid)),
            ("trialSha256", string(&sha256(&rb))),
            ("inputsSha256", string(&sha256(&inputs_b))),
        ]),
    )?;
    literal_eq(field(invocation, "planSha256")?, &sha256(&pb))?;
    let c = candidate(&cb, &trust)?;
    let (iv, f) = intent(&ib, &trust)?;
    let index_expected = object(vec![
        ("trialId", string(&tid)),
        ("operationId", field(invocation, "operationId")?.clone()),
        ("approvalDigest", string(&args[4])),
    ]);

    for name in [
        format!(
            "operation-{}.json",
            sha256(text(field(invocation, "operationId")?)?.as_bytes())
        ),
        format!(
            "fixture-{}.json",
            sha256(f.root.path.as_os_str().as_encoded_bytes())
        ),
    ] {
        let capture = RegistryCapture::capture_with_parent(registry.join(&name), &registry_parent)?;
        eq(&json(&capture.bytes)?, &index_expected)?;
        captures.push(capture);
    }
    for k in [
        "candidateManifestSha256",
        "environment",
        "fixture",
        "limits",
    ] {
        eq(field(&r, k)?, field(&iv, k)?)?;
    }
    plan(
        &pb,
        &args[4],
        &path(field(&inputs, "candidatePath")?)?,
        &path(field(&inputs, "intentPath")?)?,
        &trust,
        &c,
        &ib,
        &iv,
        &f,
    )?;
    for (key, b) in [
        ("candidatePath", &cb),
        ("intentPath", &ib),
        ("planPath", &pb),
    ] {
        if bytes_file(field(&inputs, key)?)? != *b {
            return Err(Failure::Stale);
        }
    }
    if let Some((pid, expected)) = admission {
        let captured = RegistryCapture::capture_with_parent(
            registry.join(format!("{tid}.reserved.json")),
            &registry_parent,
        )?;
        if captured.bytes != expected {
            return Err(Failure::Stale);
        }
        let reserved = json(&captured.bytes)?;
        exact(
            &reserved,
            &[
                "apiVersion",
                "trialId",
                "trialSha256",
                "state",
                "attemptId",
                "approvalDigest",
                "controller",
                "reservedBoottimeNs",
            ],
        )?;
        hash(field(&reserved, "attemptId")?)?;
        let reserved_ns = decimal(field(&reserved, "reservedBoottimeNs")?)?;
        if reserved_ns < life.issued_ns || reserved_ns >= life.deadline_ns || reserved_ns > now()? {
            return invalid();
        }
        let (_, start) = process_facts(pid)?;
        eq(
            &reserved,
            &object(vec![
                (
                    "apiVersion",
                    string("workspace-governance/init-trial-reservation-v1"),
                ),
                ("trialId", string(&tid)),
                ("trialSha256", string(&sha256(&rb))),
                ("state", string("consumed/reserved")),
                ("attemptId", field(&reserved, "attemptId")?.clone()),
                ("approvalDigest", string(&args[4])),
                (
                    "controller",
                    object(vec![
                        ("pid", string(&pid.to_string())),
                        ("startTicks", string(&start.to_string())),
                        (
                            "bootId",
                            field(field(&r, "environment")?, "bootId")?.clone(),
                        ),
                    ]),
                ),
                ("reservedBoottimeNs", string(&reserved_ns.to_string())),
            ]),
        )?;
        captures.push(captured);
    }
    reservation_inventory(&captures, registry, &tid, admission.is_some())?;
    let dir = crate::fs::SafeDir::open(registry).map_err(|_| Failure::Unsupported)?;
    let _lock = if admission.is_none() {
        Some(
            dir.acquire_lock(&format!(
                ".workspacectl-lock-{}",
                sha256(registry.as_os_str().as_encoded_bytes())
            ))
            .map_err(|_| Failure::Unsupported)?,
        )
    } else {
        // Existing lock only: admission cannot create, repair or acquire authority.
        let lock_path = registry.join(format!(
            ".workspacectl-lock-{}",
            sha256(registry.as_os_str().as_encoded_bytes())
        ));
        let lock_capture = RegistryCapture::capture_with_parent(lock_path.clone(), &registry_parent)?;
        let lock = openat(
            &open_directory(registry)?,
            lock_path
                .file_name()
                .and_then(|s| s.to_str())
                .ok_or(Failure::Invalid)?,
            libc::O_RDWR | libc::O_NONBLOCK,
        )?;
        if !same_file(&lock_capture.facts, &metadata(&lock)?) {
            return Err(Failure::Stale);
        }
        if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
            return Err(Failure::Stale);
        }
        if std::io::Error::last_os_error().raw_os_error() != Some(libc::EWOULDBLOCK) {
            return Err(Failure::Unsupported);
        }
        captures.push(lock_capture);
        None
    };
    reservation_inventory(&captures, registry, &tid, admission.is_some())?;
    witness.recheck()?;
    life.recheck()?;
    c.files.recheck()?;
    let fresh = read_trust(root)?;
    if fresh.bytes != trust.bytes {
        return Err(Failure::Stale);
    }
    let under_candidate = candidate(&cb, &fresh)?;
    let (under_intent, under_fixture) = intent(&ib, &fresh)?;
    plan(
        &pb,
        &args[4],
        &path(field(&inputs, "candidatePath")?)?,
        &path(field(&inputs, "intentPath")?)?,
        &fresh,
        &under_candidate,
        &ib,
        &under_intent,
        &under_fixture,
    )?;

    for (key, b) in [
        ("candidatePath", &cb),
        ("intentPath", &ib),
        ("planPath", &pb),
    ] {
        if bytes_file(field(&inputs, key)?)? != *b {
            return Err(Failure::Stale);
        }
    }
    for capture in &captures {
        capture.recheck()?;
    }
    if let Some((_, bytes)) = admission {
        witness.recheck()?;
        life.recheck()?;
        return Ok(Completion {
            bytes: bytes.to_vec(),
            _lock,
            captures,
            recovery: None,
        });
    }
    let (_, start) = process_facts(std::process::id())?;
    let reservation = object(vec![
        (
            "apiVersion",
            string("workspace-governance/init-trial-reservation-v1"),
        ),
        ("trialId", string(&tid)),
        ("trialSha256", string(&sha256(&rb))),
        ("state", string("consumed/reserved")),
        ("attemptId", string(&random()?)),
        ("approvalDigest", string(&args[4])),
        (
            "controller",
            object(vec![
                ("pid", string(&std::process::id().to_string())),
                ("startTicks", string(&start.to_string())),
                (
                    "bootId",
                    field(field(&r, "environment")?, "bootId")?.clone(),
                ),
            ]),
        ),
        ("reservedBoottimeNs", string(&now()?.to_string())),
    ]);
    let bytes = wire(&reservation)?;
    witness.recheck()?;
    life.recheck()?;
    publish(registry, &format!("{tid}.reserved.json"), &bytes)?;
    captures.push(RegistryCapture::capture_with_parent(
        registry.join(format!("{tid}.reserved.json")),
        &registry_parent,
    )?);
    Ok(Completion {
        bytes,
        _lock,
        captures,
        recovery: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        env, fs,
        os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
        process::Command,
    };

    fn identity_count(dev: u64, ino: u64) -> usize {
        fs::read_dir("/proc/self/fd")
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter_map(|entry| fs::metadata(entry.path()).ok())
            .filter(|facts| (facts.dev(), facts.ino()) == (dev, ino))
            .count()
    }

    #[test]
    fn shared_registry_capture_exec_child_probe() {
        let Some(root) = env::var_os("WG_REGISTRY_CAPTURE_CHILD") else { return };
        let root = PathBuf::from(root);
        for path in [root.clone(), root.join("first.json"), root.join("second.json")] {
            let facts = fs::metadata(path).unwrap();
            assert_eq!(identity_count(facts.dev(), facts.ino()), 0, "registry witness leaked across exec");
        }
    }

    #[test]
    fn shared_registry_parent_retains_unique_cloexec_targets() {
        let root = PathBuf::from(env::var("WG_NATIVE_TEST_ROOT").unwrap())
            .join(format!("registry-sharing-{}", random().unwrap()));
        fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
        for name in ["first.json", "second.json"] {
            fs::OpenOptions::new().write(true).create_new(true).mode(0o600)
                .open(root.join(name)).unwrap().write_all(b"{}\n").unwrap();
        }
        let parent = RegistryParentWitness::capture(&root).unwrap();
        let first = RegistryCapture::capture_with_parent(root.join("first.json"), &parent).unwrap();
        let second = RegistryCapture::capture_with_parent(root.join("second.json"), &parent).unwrap();
        assert!(Arc::ptr_eq(&first.parent, &second.parent));
        assert_eq!(identity_count(parent.facts.dev(), parent.facts.ino()), 1);
        for capture in [&first, &second] {
            assert_eq!(identity_count(capture.facts.dev(), capture.facts.ino()), 1);
            assert_ne!(capture.file.as_raw_fd(), parent.file.as_raw_fd());
            assert_ne!(unsafe { libc::fcntl(capture.file.as_raw_fd(), libc::F_GETFL) } & libc::O_PATH, 0);
            assert_ne!(unsafe { libc::fcntl(capture.file.as_raw_fd(), libc::F_GETFD) } & libc::FD_CLOEXEC, 0);
        }
        assert_ne!(first.file.as_raw_fd(), second.file.as_raw_fd());
        assert_ne!(unsafe { libc::fcntl(parent.file.as_raw_fd(), libc::F_GETFD) } & libc::FD_CLOEXEC, 0);
        let child = Command::new(env::current_exe().unwrap())
            .args(["--exact", "shared_registry_capture_exec_child_probe", "--nocapture"])
            .env("WG_REGISTRY_CAPTURE_CHILD", &root)
            .output().unwrap();
        assert!(child.status.success(), "{}", String::from_utf8_lossy(&child.stderr));
    }
}
