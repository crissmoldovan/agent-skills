//! Bounded strict wire/lifecycle parser. This module grants no filesystem authority.
//! A Begin is untrusted until native full semantic/admission checks have succeeded.
use super::*;
/// In-memory decision only; Success requires the owning transaction to report
/// all real terminal barriers. This type performs no I/O or authority checks.
#[derive(Debug,Clone,Copy,PartialEq,Eq)]
pub enum Decision { Success, Error }
#[derive(Default)]
pub struct Terminal { cancelled:bool, active:bool, decision:Option<Decision>, reply_finalized:bool }
impl Terminal {
 pub fn new()->Self {Self::default()}
 /// While terminalization is active this queues cancellation; it cannot alter
 /// an in-flight visibility/fsync decision. EOF uses the same stop rule.
 pub fn cancel(&mut self) {self.cancelled=true;}
 pub fn enter_terminal(&mut self)->bool {
  if self.cancelled||self.active||self.decision.is_some(){return false}
  self.active=true;true
 }
 pub fn finish(&mut self,barriers_succeeded:bool)->Decision {
  if let Some(d)=self.decision{return d}
  let d=if self.active&&barriers_succeeded{Decision::Success}else{Decision::Error};
  self.active=false;self.decision=Some(d);d
 }
 /// Call before the first output syscall. A partial/lost frame is never retried.
 pub fn finalize_reply(&mut self)->Option<Decision> {
  if self.reply_finalized{return None}
  let d=self.decision?;self.reply_finalized=true;Some(d)
 }
}
#[derive(Debug,PartialEq)]
pub enum Dispatch { Capabilities, Begin { request:u32, operation_id:String, body:Vec<u8> }, Cancel, DuplicateCancel }
pub struct Session { next:u32, capability:bool, operation:Option<String>, cancel:Option<Vec<u8>>, trial:Option<Value> }
impl Default for Session { fn default()->Self {Self::new()} }
fn text(v:&Value)->Result<String>{if let Value::String(s)=v{String::from_utf16(s).map_err(|_|Error::Invalid)}else{invalid()}}
fn hash(v:&Value)->Result<()> {let s=text(v)?;if s.len()!=64||!s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){return invalid()}Ok(())}
fn decimal(v:&Value)->Result<u64>{let s=text(v)?;if s.is_empty()||(s.len()>1&&s.starts_with('0'))||!s.bytes().all(|b|b.is_ascii_digit()){return invalid()}s.parse().map_err(|_|Error::Invalid)}
fn operation(v:&Value)->Result<String>{let s=text(v)?;if s.is_empty()||s.len()>64||!s.as_bytes()[0].is_ascii_alphanumeric()||!s.bytes().all(|b|b.is_ascii_alphanumeric()||b"._-".contains(&b)){return invalid()}Ok(s)}
fn absolute(v:&Value)->Result<String>{let p=text(v)?;if !p.starts_with('/')||p.len()>4096||p.bytes().any(|b|b<32||b==127||b==b'\\')||p[1..].split('/').any(|s|s.is_empty()||s=="."||s==".."){return invalid()}Ok(p)}
fn canonical(v:&Value)->Result<Vec<u8>> {let mut s=String::new();encode(v,&mut s,0,&mut 0)?;Ok(s.into_bytes())}
impl Session {
 pub fn new()->Self{Self{next:1,capability:false,operation:None,cancel:None,trial:None}}
 pub fn accept(&mut self,bytes:&[u8])->Result<Dispatch>{
  if self.cancel.as_deref()==Some(bytes){return Ok(Dispatch::DuplicateCancel)}
  let v=parse_bounded(bytes,2097152)?;
  fields(&v,&["apiVersion","request","op","body","trial"],&[])?;
  if !is(get(&v,"apiVersion")?,"workspace-governance/init-trial-helper-request-v1"){return invalid()}
  let number=get(&v,"request")?;
  if *number!=Value::Number(self.next as f64){return invalid()}
  let trial=get(&v,"trial")?;fields(trial,&["path","sha256"],&[])?;hash(get(trial,"sha256")?)?;
  let path=text(get(trial,"path")?)?;
  if !path.starts_with('/')||path.len()>4096||path.bytes().any(|b|b<32||b==127||b==b'\\')||path[1..].split('/').any(|s|s.is_empty()||s=="."||s==".."){return invalid()}
  let basename=path.rsplit('/').next().ok_or(Error::Invalid)?;
  hash(&string(basename.strip_suffix(".json").ok_or(Error::Invalid)?))?;
  if let Some(t)=self.trial.as_ref(){if canonical(t)?!=canonical(trial)?{return invalid()}}
  let op=get(&v,"op")?;let body=get(&v,"body")?;
  let dispatch=if is(op,"capabilities"){
   fields(body,&[],&[])?;
   if self.capability||self.operation.is_some(){return invalid()}
   self.capability=true;Dispatch::Capabilities
  }else if is(op,"begin"){
   if self.operation.is_some()||!self.capability{return invalid()}
   fields(body,&["mode","host","operationId","approvalDigest","context","proposal"],&[])?;
   if !is(get(body,"mode")?,"apply")&&!is(get(body,"mode")?,"recover"){return invalid()}
   hash(get(body,"approvalDigest")?)?;
   let host=get(body,"host")?;fields(host,&["pid","bootId","startTicks"],&[])?;
   let pid=decimal(get(host,"pid")?)?;if pid==0||pid>i32::MAX as u64||decimal(get(host,"startTicks")?)?==0{return invalid()}
   let boot=text(get(host,"bootId")?)?;
   if boot.len()!=36||boot.bytes().enumerate().any(|(i,b)|if [8,13,18,23].contains(&i){b!=b'-'}else{!b.is_ascii_digit()&&!(b'a'..=b'f').contains(&b)}){return invalid()}
   let context=get(body,"context")?;
   fields(context,&["apiVersion","kind","manifestPath","stateDir","root","nodeId","principal","requestPath","executorProfilePath"],&[])?;
   if !is(get(context,"apiVersion")?,"workspace-governance/init-trial-setup-context-v1")||!is(get(context,"kind")?,"manifest-init"){return invalid()}
   for key in ["root","nodeId","principal"] {if *get(context,key)?!=Value::Null{return invalid()}}
   for key in ["manifestPath","stateDir","requestPath","executorProfilePath"] {absolute(get(context,key)?)?;}
   // Decode and authenticate the bounded payload using the existing native codec.
   preview::payload_bounded(get(body,"proposal")?,2097152)?;
   let operation_id=operation(get(body,"operationId")?)?;
   let encoded=canonical(body)?;
   self.operation=Some(operation_id.clone());
   Dispatch::Begin{request:self.next,operation_id,body:encoded}
  }else if is(op,"cancel"){
   fields(body,&["operationId"],&[])?;
   let id=operation(get(body,"operationId")?)?;
   if self.operation.as_ref()!=Some(&id)||self.cancel.is_some(){return invalid()}
   self.cancel=Some(bytes.to_vec());Dispatch::Cancel
  }else{return invalid()};
  self.trial=Some(trial.clone());self.next+=1;Ok(dispatch)
 }
}
