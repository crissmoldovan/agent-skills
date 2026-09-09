use workspace_governance_setup_native::init::{derive_manifest, derive_file_action, verify_file_action, Error};

#[test]
fn native_init_action_rederives_bytes_and_refuses_occupied_or_forged_target() {
    let request = br#"{"apiVersion":"workspace-governance/init-request-v1","authorityId":"example-authority","rootNode":{"id":"example-org","kind":"organization","slug":"example","parentId":null,"visibility":{"mode":"public","readers":[]}}}"#;
    let target = "/example-control/manifest.json";
    let manifest = derive_manifest(request).unwrap();
    let action = derive_file_action(request,target,None).unwrap();
    assert_eq!(verify_file_action(request,target,None,&action).unwrap(),action);
    assert_eq!(derive_file_action(request,target,Some(&manifest)).unwrap(),b"null\n");
    assert_eq!(derive_file_action(request,target,Some(b"foreign")),Err(Error::DestinationExists));
    assert_eq!(verify_file_action(request,"/other/manifest.json",None,&action),Err(Error::StalePlan));
    assert_eq!(verify_file_action(request,target,None,b"null"),Err(Error::StalePlan));
    // This forgery has a correctly recomputed payload hash AND action ID. Digest
    // consistency must not substitute for deriving bytes from the independent request.
    let other_request = std::str::from_utf8(request).unwrap().replace("\"slug\":\"example\"","\"slug\":\"different\"");
    let forged = derive_file_action(other_request.as_bytes(),target,None).unwrap();
    assert_ne!(forged,action);
    assert_eq!(verify_file_action(request,target,None,&forged),Err(Error::StalePlan));
    assert_eq!(verify_file_action(request,target,Some(&manifest),&action),Err(Error::StalePlan));
    for path in ["relative","/a/../b","/a//b","/a/./b","/a/b/","/","/a\\b","/a\0b"] {
        assert_eq!(derive_file_action(request,path,None),Err(Error::Invalid));
    }
    assert_eq!(derive_manifest(&[0xff]),Err(Error::Invalid));
    assert_eq!(derive_manifest(&vec![b' ';262145]),Err(Error::Limit));
}

#[test]
fn native_action_payload_ids_match_node_independently() {
    let node = std::env::var("WG_NATIVE_NODE").expect("set WG_NATIVE_NODE");
    let output = Command::new(node).arg(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/init-differential.mjs"))
        .arg("--action").env_clear().output().unwrap();
    assert!(output.status.success(), "{}",String::from_utf8_lossy(&output.stderr));
    let mut count = 0;
    for line in std::str::from_utf8(&output.stdout).unwrap().lines() {
        let fields: Vec<_> = line.split('\t').collect(); assert_eq!(fields.len(),3);
        let actual = match derive_file_action(&unhex(fields[1]),"/example-control/manifest.json",None) {
            Ok(bytes)=>format!("ok:{}",hex(&bytes)), Err(error)=>format!("error:{}",error.code())
        };
        assert_eq!(actual,fields[2],"action fixture {}",fields[0]); count+=1;
    }
    assert!(count>=60); println!("independent action fixtures compared: {count}");
}
use std::process::Command;

fn hex(bytes: &[u8]) -> String { bytes.iter().map(|b| format!("{b:02x}")).collect() }
fn unhex(s: &str) -> Vec<u8> {
    assert_eq!(s.len() % 2, 0);
    s.as_bytes().chunks_exact(2).map(|p| u8::from_str_radix(std::str::from_utf8(p).unwrap(),16).unwrap()).collect()
}

#[test]
fn independent_native_derivation_matches_unchanged_node_oracle() {
    let node = std::env::var("WG_NATIVE_NODE").expect("set WG_NATIVE_NODE to the approved Node >=24 executable");
    let output = Command::new(node).arg(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/init-differential.mjs"))
        .env_clear().output().unwrap();
    assert!(output.status.success(), "oracle failed: {}", String::from_utf8_lossy(&output.stderr));
    let output = String::from_utf8(output.stdout).unwrap();
    let mut count = 0;
    for line in output.lines() {
        let fields: Vec<_> = line.split('\t').collect();
        assert_eq!(fields.len(),3);
        let actual = match derive_manifest(&unhex(fields[1])) {
            Ok(bytes) => format!("ok:{}",hex(&bytes)),
            Err(error) => format!("error:{}",error.code()),
        };
        assert_eq!(actual, fields[2], "fixture {}", fields[0]);
        count += 1;
    }
    assert!(count >= 60, "oracle must not silently become empty/narrow: {count}");
    println!("independent init fixtures compared: {count}");
}


#[test]
fn derives_exact_legacy_manifest_bytes_from_independent_request() {
    let request = br#"{"apiVersion":"workspace-governance/init-request-v1","authorityId":"example-authority","rootNode":{"id":"example-org","kind":"organization","slug":"example","parentId":null,"visibility":{"mode":"restricted","readers":["example-operator"]}}}"#;
    let expected = b"{\"apiVersion\":\"workspace-governance/v1\",\"authorityId\":\"example-authority\",\"metadata\":{},\"nodes\":[{\"id\":\"example-org\",\"kind\":\"organization\",\"parentId\":null,\"slug\":\"example\",\"visibility\":{\"mode\":\"restricted\",\"readers\":[\"example-operator\"]}}],\"policies\":[],\"workflows\":[]}\n";
    assert_eq!(derive_manifest(request).unwrap(), expected);
}
