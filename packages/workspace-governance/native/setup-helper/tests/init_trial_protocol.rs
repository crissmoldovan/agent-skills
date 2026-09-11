//! Strict trial wire is a parser/lifecycle component, not transaction authority.
use workspace_governance_setup_native::init::trial_protocol::{Session, Dispatch};
fn frame(request:u32,op:&str,body:&str)->Vec<u8>{format!(r#"{{"apiVersion":"workspace-governance/init-trial-helper-request-v1","request":{request},"op":"{op}","body":{body},"trial":{{"path":"/private/registry/{}.json","sha256":"{}"}}}}"#,"a".repeat(64),"b".repeat(64)).into_bytes()}
#[test]
fn default_session_starts_at_one(){
 assert!(matches!(Session::default().accept(&frame(1,"capabilities","{}")),Ok(Dispatch::Capabilities)));
}
#[test]
fn control_character_trial_path_is_invalid(){
 let bad=String::from_utf8(frame(1,"capabilities","{}")).unwrap().replace("/private/registry/","/private/\\nregistry/");
 assert!(Session::new().accept(bad.as_bytes()).is_err());
}
#[test]
fn capability_then_exactly_one_begin(){
 let mut s=Session::new();
 assert!(matches!(s.accept(&frame(1,"capabilities","{}")),Ok(Dispatch::Capabilities)));
 let body=format!(r#"{{"mode":"apply","host":{{"pid":"1","bootId":"00000000-0000-0000-0000-000000000000","startTicks":"1"}},"operationId":"trial-op","approvalDigest":"{}","context":{{"apiVersion":"workspace-governance/init-trial-setup-context-v1","kind":"manifest-init","manifestPath":"/private/fixture/manifest.json","stateDir":"/private/fixture/state","root":null,"nodeId":null,"principal":null,"requestPath":"/private/request.json","executorProfilePath":"/private/candidate.json"}},"proposal":{{"encoding":"base64-chunks-v1","byteLength":2,"sha256":"{}","chunks":["e30="]}}}}"#,"c".repeat(64),"44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a");
 // Admission separately validates the bound full context/proposal before effects.
 for invalid in [body.replace("trial-op",&"a".repeat(65)),body.replace("\"root\":null","\"root\":\"/private/root\""),body.replace("\"manifest-init\"","\"scaffold\"")] {
  let mut rejected=Session::new(); rejected.accept(&frame(1,"capabilities","{}")).unwrap();
  assert!(rejected.accept(&frame(2,"begin",&invalid)).is_err(),"strict begin shape accepted: {invalid}");
 }
 let mut large=vec![b' ';262145];large[0]=b'{';large[1]=b'}';
 use base64::{Engine,engine::general_purpose::STANDARD};use sha2::{Digest,Sha256};
 let chunks=large.chunks(12288).map(|c|format!("\"{}\"",STANDARD.encode(c))).collect::<Vec<_>>().join(",");
 let large_body=body.replace("\"byteLength\":2","\"byteLength\":262145").replace("44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",&format!("{:x}",Sha256::digest(&large))).replace("\"e30=\"",&chunks);
 let mut large_session=Session::new();large_session.accept(&frame(1,"capabilities","{}")).unwrap();
 assert!(large_session.accept(&frame(2,"begin",&large_body)).is_ok(),"whole proposal uses frame limit, not individual capture limit");
 let reference=format!(r#""trial":{{"path":"/private/registry/{}.json","sha256":"{}"}}"#,"a".repeat(64),"b".repeat(64));
 let reordered=format!(r#""trial":{{"sha256":"{}","path":"/private/registry/{}.json"}}"#,"b".repeat(64),"a".repeat(64));
 let mut alternate=Session::new();alternate.accept(&frame(1,"capabilities","{}")).unwrap();
 assert!(alternate.accept(String::from_utf8(frame(2,"begin",&body)).unwrap().replace(&reference,&reordered).as_bytes()).is_ok(),"JSON key order is not authority");
 assert!(matches!(s.accept(&frame(2,"begin",&body)),Ok(Dispatch::Begin{..})));
 assert!(s.accept(&frame(3,"begin",&body)).is_err());
 assert!(matches!(s.accept(&frame(3,"cancel",r#"{"operationId":"trial-op"}"#)),Ok(Dispatch::Cancel)));
 assert!(matches!(s.accept(&frame(3,"cancel",r#"{"operationId":"trial-op"}"#)),Ok(Dispatch::DuplicateCancel)));
 assert!(s.accept(&frame(4,"cancel",r#"{"operationId":"trial-op"}"#)).is_err());
}
