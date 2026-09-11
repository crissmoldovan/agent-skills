use workspace_governance_setup_native::init::{derive_policy, derive_manifest};
use sha2::{Digest, Sha256};
const REQUEST: &str = r#"{"apiVersion":"workspace-governance/init-request-v1","authorityId":"example-authority","rootNode":{"id":"example-org","kind":"organization","slug":"example","parentId":null,"visibility":{"mode":"restricted","readers":["example-reader"]}}}"#;
#[test]
fn normative_native_policy_pins_no_lf_revision_and_lf_file_hash() {
    let bytes=derive_policy(REQUEST.as_bytes()).unwrap();
    let expected=r#"{"checker":"init-policy-v1","checks":[{"allowed":true,"nodeId":"example-org","operation":"manifest-init","resolutionFingerprint":"f8dfc1b9b7612f715a91105cca57e764ef02c098476d23a7492b30b86a434c57"}],"resolution":{"ancestry":["example-org"],"authorization":"explicit-local-administration","constraints":[],"provenance":[],"revision":"9c4506c55c7e68651025629ec5747fbaf3e1be76eedd0ffc1f5a0eb79c783604","values":{},"workflow":null}}"#;
    assert_eq!(bytes,expected.as_bytes());
    let manifest=derive_manifest(REQUEST.as_bytes()).unwrap(); assert_eq!(manifest.last(),Some(&b'\n'));
    assert_eq!(format!("{:x}",Sha256::digest(&manifest)),"6b25e22c337ee913f81fc4a13def15bcef3abba507eb7a09700f3127a02e8e67");
    assert_eq!(format!("{:x}",Sha256::digest(&manifest[..manifest.len()-1])),"9c4506c55c7e68651025629ec5747fbaf3e1be76eedd0ffc1f5a0eb79c783604");
    assert_eq!(derive_policy(format!(" \n {} \t",REQUEST.replace(",",",\n")).as_bytes()).unwrap(),bytes);
    for changed in [REQUEST.replace("example-authority","other-authority"),REQUEST.replace("example-org","other-root"),REQUEST.replace("example-reader","other-reader"),REQUEST.replace("\"slug\":", "\"metadata\":{\"label\":\"different\"},\"slug\":")] {
        assert_ne!(derive_policy(changed.as_bytes()).unwrap(),bytes);
    }
    for field in ["principal","policies","workflows","defaults","invocation"] {
        assert!(derive_policy(REQUEST.replacen('{',&format!("{{\"{field}\":{{}},"),1).as_bytes()).is_err());
    }
}
