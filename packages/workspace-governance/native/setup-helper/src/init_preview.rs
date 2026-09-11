//! Read-only preview verification. Deliberately not init-setup-plan or apply authority.
use super::*;
use base64::{Engine,engine::general_purpose::STANDARD};
fn text(value:&Value)->Result<String>{let Value::String(s)=value else{return invalid()};String::from_utf16(s).map_err(|_|Error::Invalid)}
fn payload(value:&Value)->Result<Vec<u8>>{payload_bounded(value,262144)}
pub(super) fn payload_bounded(value:&Value,max_bytes:usize)->Result<Vec<u8>>{
 fields(value,&["encoding","byteLength","sha256","chunks"],&[])?;
 if !is(get(value,"encoding")?,"base64-chunks-v1"){return invalid()}
 let Value::Number(size)=get(value,"byteLength")? else{return invalid()};
 if *size<0.0||size.fract()!=0.0{return invalid()} if *size>max_bytes as f64{return Err(Error::Limit)}
 let size=*size as usize;let Value::Array(chunks)=get(value,"chunks")? else{return invalid()};
 if chunks.len()!=size.div_ceil(12288){return invalid()}
 let mut bytes=Vec::with_capacity(size);
 for (index,chunk) in chunks.iter().enumerate(){let encoded=text(chunk)?;let b=STANDARD.decode(&encoded).map_err(|_|Error::Invalid)?;
  if STANDARD.encode(&b)!=encoded||b.len()!=12288.min(size-index*12288){return invalid()} bytes.extend(b);}
 if !is(get(value,"sha256")?,&sha256(&bytes)){return invalid()} Ok(bytes)
}
fn path(value:&Value)->Result<String>{let s=text(value)?;
 if !s.starts_with('/')||s.len()>4096||s.bytes().any(|c|c<32||c==127||c==b'\\')||s[1..].split('/').any(|p|p.is_empty()||p=="."||p==".."){return invalid()}Ok(s)
}
/// Verify every preview field using the existing independent authoring engine.
/// Captures are supplied data, not recaptured resources. No filesystem mutation API.
pub fn verify_preview(frame:&[u8],helper_hash:&str)->std::result::Result<(),&'static str>{
 fn verify(frame:&[u8],helper_hash:&str)->Result<()>{
  let envelope=parse_bounded(frame,2097152)?;
  fields(&envelope,&["apiVersion","operation","request","existing","manifestPath","stateDir","proposal"],&[])?;
  if !is(get(&envelope,"apiVersion")?,"workspace-governance/init-preview-helper-request-v1")||!is(get(&envelope,"operation")?,"verify"){return invalid()}
  let request=payload(get(&envelope,"request")?)?;let existing=get(&envelope,"existing")?;
  let existing=if *existing==Value::Null{None}else{Some(payload(existing)?)};
  let target=path(get(&envelope,"manifestPath")?)?;let state=path(get(&envelope,"stateDir")?)?;
  if target==state||target.starts_with(&(state.clone()+"/"))||state.starts_with(&(target.clone()+"/")){return invalid()}
  let expected=object(vec![("apiVersion",string("workspace-governance/init-preview-plan-v1")),("executable",Value::Bool(false)),
   ("policyStatus",string("proposed-not-authority")),("kind",string("manifest-init")),("manifestPath",string(&target)),("stateDir",string(&state)),
   ("helperSha256",string(helper_hash)),("requestDigest",string(&sha256(&request))),("policy",policy::policy_value(&request)?),
   ("action",action_value(&request,&target,existing.as_deref())?)]);
  if canonical(get(&envelope,"proposal")?)?!=canonical(&expected)?{return Err(Error::StalePlan)}Ok(())
 }
 // No valid mutation operation exists, even with an otherwise correct proposal.
 let value=parse_bounded(frame,2097152).map_err(|e|e.code())?;
 fields(&value,&["apiVersion","operation","request","existing","manifestPath","stateDir","proposal"],&[]).map_err(|e|e.code())?;
 if is(get(&value,"apiVersion").map_err(|e|e.code())?,"workspace-governance/init-preview-helper-request-v1") &&
  ["apply","recover"].iter().any(|mode|get(&value,"operation").is_ok_and(|v|is(v,mode))){return Err("UNSUPPORTED")}
 verify(frame,helper_hash).map_err(|e|e.code())
}
