//! Bounded independent JSON/initial-manifest derivation, not an execution authority.
//! Strings deliberately retain UTF-16 code units: legacy JSON accepts escaped lone
//! surrogates. Replacing them with U+FFFD or rejecting them would change approval bytes.
use std::collections::BTreeSet;
#[path = "init_preview.rs"]
mod preview;
pub use preview::verify_preview;
#[path = "init_trial.rs"]
pub mod trial;
#[path = "init_trial_protocol.rs"]
pub mod trial_protocol;
#[path = "init_policy.rs"]
mod policy;
pub use policy::derive_policy;

#[derive(Debug, PartialEq, Eq)]
pub enum Error { Invalid, Limit, DestinationExists, StalePlan }
impl Error {
    pub fn code(&self) -> &'static str { match self { Self::Invalid => "INVALID", Self::Limit => "LIMIT", Self::DestinationExists=>"DESTINATION_EXISTS", Self::StalePlan=>"STALE_PLAN" } }
}
type Result<T> = std::result::Result<T, Error>;
#[derive(Debug, Clone, PartialEq)]
enum Value { Null, Bool(bool), Number(f64), String(Vec<u16>), Array(Vec<Value>), Object(Vec<(Vec<u16>, Value)>) }
fn string(s: &str) -> Value { Value::String(s.encode_utf16().collect()) }
fn object(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(fields.into_iter().map(|(k,v)| (k.encode_utf16().collect(),v)).collect())
}
fn units(s: &str) -> Vec<u16> { s.encode_utf16().collect() }
fn forbidden(k: &[u16]) -> bool { ["__proto__","prototype","constructor"].iter().any(|s| k == units(s)) }
fn invalid<T>() -> Result<T> { Err(Error::Invalid) }

struct Parser<'a> { input: &'a [u8], cursor: usize, count: usize }
impl<'a> Parser<'a> {
    fn peek(&self) -> Option<u8> { self.input.get(self.cursor).copied() }
    fn take(&mut self, byte: u8) -> bool {
        if self.peek() == Some(byte) { self.cursor += 1; true } else { false }
    }
    fn ws(&mut self) { while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) { self.cursor += 1; } }
    fn parse_string(&mut self) -> Result<Vec<u16>> {
        if !self.take(b'"') { return invalid(); }
        let mut out = Vec::new();
        loop {
            match self.peek().ok_or(Error::Invalid)? {
                b'"' => { self.cursor += 1; return Ok(out); }
                b'\\' => {
                    self.cursor += 1;
                    let escape = self.peek().ok_or(Error::Invalid)?;
                    self.cursor += 1;
                    match escape {
                        b'"' | b'\\' | b'/' => out.push(escape as u16),
                        b'b' => out.push(8), b'f' => out.push(12), b'n' => out.push(10),
                        b'r' => out.push(13), b't' => out.push(9),
                        b'u' => {
                            let mut n = 0u16;
                            for _ in 0..4 {
                                let b = self.peek().ok_or(Error::Invalid)?;
                                let digit = (b as char).to_digit(16).ok_or(Error::Invalid)?;
                                n = n * 16 + digit as u16; self.cursor += 1;
                            }
                            out.push(n);
                        }
                        _ => return invalid(),
                    }
                }
                0..=31 => return invalid(),
                _ => {
                    // The whole input is validated UTF-8 before parsing; this cursor
                    // is always advanced by complete characters or ASCII syntax.
                    let width = match self.input[self.cursor] { 0..=127=>1, 0xc2..=0xdf=>2, 0xe0..=0xef=>3, 0xf0..=0xf4=>4, _=>return invalid() };
                    let rest = std::str::from_utf8(self.input.get(self.cursor..self.cursor+width).ok_or(Error::Invalid)?).map_err(|_| Error::Invalid)?;
                    let ch = rest.chars().next().ok_or(Error::Invalid)?;
                    let mut buf = [0;2]; out.extend_from_slice(ch.encode_utf16(&mut buf));
                    self.cursor += ch.len_utf8();
                }
            }
            if out.len() > 16384 { return invalid(); }
        }
    }
    fn value(&mut self, depth: usize) -> Result<Value> {
        self.count += 1;
        if depth > 32 || self.count > 200000 { return invalid(); }
        self.ws();
        match self.peek().ok_or(Error::Invalid)? {
            b'"' => Ok(Value::String(self.parse_string()?)),
            b'[' => {
                self.cursor += 1; self.ws(); let mut values = Vec::new();
                if self.take(b']') { return Ok(Value::Array(values)); }
                loop {
                    values.push(self.value(depth + 1)?); self.ws();
                    if self.take(b']') { break; }
                    if !self.take(b',') { return invalid(); }
                }
                Ok(Value::Array(values))
            }
            b'{' => {
                self.cursor += 1; self.ws(); let mut fields = Vec::new(); let mut seen = BTreeSet::new();
                if self.take(b'}') { return Ok(Value::Object(fields)); }
                loop {
                    self.ws(); let key = self.parse_string()?;
                    if forbidden(&key) || !seen.insert(key.clone()) { return invalid(); }
                    self.ws(); if !self.take(b':') { return invalid(); }
                    fields.push((key,self.value(depth + 1)?)); self.ws();
                    if self.take(b'}') { break; }
                    if !self.take(b',') { return invalid(); }
                }
                Ok(Value::Object(fields))
            }
            b'n' | b't' | b'f' => {
                let (literal, value): (&[u8], Value) = match self.peek() {
                    Some(b'n') => (b"null", Value::Null), Some(b't') => (b"true", Value::Bool(true)),
                    _ => (b"false", Value::Bool(false)),
                };
                if !self.input[self.cursor..].starts_with(literal) { return invalid(); }
                self.cursor += literal.len(); Ok(value)
            }
            b'-' | b'0'..=b'9' => {
                let start = self.cursor; self.take(b'-');
                if !self.take(b'0') {
                    if !matches!(self.peek(),Some(b'1'..=b'9')) { return invalid(); }
                    while matches!(self.peek(),Some(b'0'..=b'9')) { self.cursor += 1; }
                }
                if self.take(b'.') {
                    if !matches!(self.peek(),Some(b'0'..=b'9')) { return invalid(); }
                    while matches!(self.peek(),Some(b'0'..=b'9')) { self.cursor += 1; }
                }
                if self.take(b'e') || self.take(b'E') {
                    if !self.take(b'+') { self.take(b'-'); }
                    if !matches!(self.peek(),Some(b'0'..=b'9')) { return invalid(); }
                    while matches!(self.peek(),Some(b'0'..=b'9')) { self.cursor += 1; }
                }
                let n: f64 = std::str::from_utf8(&self.input[start..self.cursor]).map_err(|_| Error::Invalid)?
                    .parse().map_err(|_| Error::Invalid)?;
                if !n.is_finite() { return invalid(); } Ok(Value::Number(n))
            }
            _ => invalid(),
        }
    }
}
fn parse(bytes: &[u8]) -> Result<Value> { parse_bounded(bytes,262144) }
fn parse_bounded(bytes: &[u8], max_bytes: usize) -> Result<Value> {
    if bytes.len() > max_bytes { return Err(Error::Limit); }
    std::str::from_utf8(bytes).map_err(|_| Error::Invalid)?;
    let mut parser = Parser { input:bytes, cursor:0, count:0 };
    let value = parser.value(0)?; parser.ws();
    if parser.cursor != bytes.len() { return invalid(); }
    Ok(value)
}
fn codepoints(s: &[u16]) -> Vec<u32> {
    std::char::decode_utf16(s.iter().copied()).map(|c| match c { Ok(c)=>c as u32, Err(e)=>e.unpaired_surrogate() as u32 }).collect()
}
fn quote(s: &[u16], out: &mut String) {
    out.push('"');
    for scalar in std::char::decode_utf16(s.iter().copied()) {
        match scalar {
            Err(e) => out.push_str(&format!("\\u{:04x}", e.unpaired_surrogate())),
            Ok('"') => out.push_str("\\\""), Ok('\\') => out.push_str("\\\\"),
            Ok('\u{0008}') => out.push_str("\\b"), Ok('\u{000c}') => out.push_str("\\f"),
            Ok('\n') => out.push_str("\\n"), Ok('\r') => out.push_str("\\r"), Ok('\t') => out.push_str("\\t"),
            Ok(c) if (c as u32) < 32 => out.push_str(&format!("\\u{:04x}", c as u32)),
            Ok(c) => out.push(c),
        }
    }
    out.push('"');
}
fn encode(value: &Value, out: &mut String, depth: usize, count: &mut usize) -> Result<()> {
    *count += 1; if depth > 32 || *count > 200000 { return invalid(); }
    match value {
        Value::Null => out.push_str("null"), Value::Bool(b) => out.push_str(if *b {"true"} else {"false"}),
        Value::Number(n) => out.push_str(ryu_js::Buffer::new().format(*n)),
        Value::String(s) => quote(s,out),
        Value::Array(values) => {
            out.push('[');
            for (i,v) in values.iter().enumerate() { if i>0 { out.push(','); } encode(v,out,depth+1,count)?; }
            out.push(']');
        }
        Value::Object(fields) => {
            let mut ordered: Vec<_> = fields.iter().collect();
            ordered.sort_by_cached_key(|(k,_)| codepoints(k));
            out.push('{');
            for (i,(k,v)) in ordered.iter().enumerate() {
                if i>0 { out.push(','); } quote(k,out); out.push(':'); encode(v,out,depth+1,count)?;
            }
            out.push('}');
        }
    }
    Ok(())
}
fn fields(value: &Value, required: &[&str], optional: &[&str]) -> Result<()> {
    let Value::Object(entries) = value else { return invalid(); };
    if required.iter().any(|k| get(value,k).is_err()) ||
        entries.iter().any(|(k,_)| !required.iter().chain(optional).any(|name| *k == units(name))) { return invalid(); }
    Ok(())
}
fn get<'a>(value: &'a Value, key: &str) -> Result<&'a Value> {
    let Value::Object(entries) = value else { return invalid(); };
    entries.iter().find(|(k,_)| *k == units(key)).map(|(_,v)|v).ok_or(Error::Invalid)
}
fn is(value: &Value, s: &str) -> bool { *value == string(s) }
fn id(value: &Value) -> Result<()> {
    let Value::String(s) = value else { return invalid(); };
    if s.is_empty() || s.len()>16384 || forbidden(s) || s.iter().any(|c| *c < 32 || *c == 47 || *c == 92) { return invalid(); }
    Ok(())
}
fn slug(value: &Value) -> Result<()> {
    let Value::String(s) = value else { return invalid(); };
    if s.is_empty() || s.len()>100 || s.iter().any(|c| *c > 127) { return invalid(); }
    let text = String::from_utf16(s).map_err(|_| Error::Invalid)?;
    if !text.as_bytes()[0].is_ascii_alphanumeric() || text.ends_with('.') ||
        !text.bytes().all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c)) { return invalid(); }
    let lower = text.to_ascii_lowercase(); let first = lower.split('.').next().ok_or(Error::Invalid)?;
    if ["con","prn","aux","nul"].contains(&first) ||
        ((first.starts_with("com") || first.starts_with("lpt")) && first.len()==4 && matches!(first.as_bytes()[3],b'1'..=b'9')) { return invalid(); }
    Ok(())
}

fn ecmascript_trim_whitespace(c: u16) -> bool {
    matches!(c, 0x0009..=0x000d | 0x0020 | 0x00a0 | 0x1680 | 0x2000..=0x200a |
        0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff)
}
fn label(value: &Value) -> Result<()> {
    let Value::String(s) = value else { return invalid(); };
    if s.is_empty() || std::char::decode_utf16(s.iter().copied()).count() > 256 ||
        s.first().is_some_and(|c| ecmascript_trim_whitespace(*c)) ||
        s.last().is_some_and(|c| ecmascript_trim_whitespace(*c)) ||
        s.iter().any(|c| *c <= 0x001f || *c == 0x007f) { return invalid(); }
    Ok(())
}

/// Independently validate an init request and derive the exact original manifest-v1
/// canonical bytes + LF. No Node callback, supplied action bytes, filesystem or effects.
/// This is a prerequisite for, NOT complete semantic plan/resource rederivation.
pub fn derive_manifest(request_bytes: &[u8]) -> Result<Vec<u8>> {
    let request = parse(request_bytes)?;
    fields(&request,&["apiVersion","authorityId","rootNode"],&[])?;
    if !is(get(&request,"apiVersion")?,"workspace-governance/init-request-v1") { return invalid(); }
    let authority = get(&request,"authorityId")?; id(authority)?;
    let root = get(&request,"rootNode")?;
    fields(root,&["id","kind","slug","parentId","visibility"],&["label","metadata"])?;
    let root_id = get(root,"id")?; id(root_id)?;
    if is(root_id,"$defaults") || is(root_id,"$invocation") { return invalid(); }
    let kind = get(root,"kind")?;
    if !(is(kind,"user") || is(kind,"organization")) || *get(root,"parentId")? != Value::Null { return invalid(); }
    slug(get(root,"slug")?)?;
    if let Ok(value) = get(root,"label") { label(value)?; }
    if let Ok(metadata) = get(root,"metadata") { if !matches!(metadata,Value::Object(_)) { return invalid(); } }
    let visibility = get(root,"visibility")?; fields(visibility,&["mode","readers"],&[])?;
    let mode = get(visibility,"mode")?;
    if !(is(mode,"public") || is(mode,"restricted")) { return invalid(); }
    let Value::Array(readers) = get(visibility,"readers")? else { return invalid(); };
    if is(mode,"restricted") && readers.is_empty() { return invalid(); }
    let mut unique = BTreeSet::new();
    for reader in readers { id(reader)?; if let Value::String(s) = reader { if !unique.insert(s) { return invalid(); } } }
    let manifest = object(vec![ ("apiVersion",string("workspace-governance/v1")),("authorityId",authority.clone()),
        ("nodes",Value::Array(vec![root.clone()])),("policies",Value::Array(vec![])),
        ("workflows",Value::Array(vec![])),("metadata",object(vec![])) ]);
    let mut out = String::new(); encode(&manifest,&mut out,0,&mut 0)?; out.push('\n');
    if out.len() > 262144 { return Err(Error::Limit); }
    Ok(out.into_bytes())
}

/// Pure rootless state declaration for the same validated init request.
pub fn derive_rootless_state(request_bytes: &[u8]) -> Result<Vec<u8>> {
    derive_manifest(request_bytes)?;
    let request = parse(request_bytes)?;
    let state = object(vec![("apiVersion",string("workspace-governance/setup-state-v1")),
        ("authorityId",get(&request,"authorityId")?.clone()),("rootRegistration",Value::Null)]);
    let mut bytes = canonical(&state)?; bytes.push(b'\n'); Ok(bytes)
}

fn canonical(value: &Value) -> Result<Vec<u8>> {
    let mut out = String::new(); encode(value,&mut out,0,&mut 0)?; Ok(out.into_bytes())
}
fn sha256(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}",Sha256::digest(bytes))
}
fn action_value(request: &[u8], target: &str, existing: Option<&[u8]>) -> Result<Value> {
    if request.len()>262144 || existing.is_some_and(|b|b.len()>262144) { return Err(Error::Limit); }
    if !target.starts_with('/') || target.len()>4096 || target.bytes().any(|c|c<32 || c==127 || c==b'\\') ||
        target[1..].split('/').any(|s|s.is_empty() || s=="." || s=="..") { return invalid(); }
    let manifest = derive_manifest(request)?;
    if let Some(existing) = existing {
        return if existing == manifest { Ok(Value::Null) } else { Err(Error::DestinationExists) };
    }
    use base64::Engine;
    let hash = sha256(&manifest);
    let payload = object(vec![("encoding",string("base64-chunks-v1")),
        ("byteLength",Value::Number(manifest.len() as f64)), ("sha256",string(&hash)),
        ("chunks",Value::Array(manifest.chunks(12288).map(|b|string(&base64::engine::general_purpose::STANDARD.encode(b))).collect()))]);
    let mut action = object(vec![("kind",string("file.create")),("path",string(target)),
        ("payload",payload),("afterSha256",string(&hash))]);
    let id = sha256(&canonical(&action)?);
    if let Value::Object(fields) = &mut action { fields.push((units("id"),string(&id))); }
    Ok(action)
}
/// Pure deterministic init action (or null for byte-identical no-op). The caller
/// must independently capture request/path/current bytes. No path inspection or
/// enclosing plan/approval/resource validation is implied by this function.
pub fn derive_file_action(request: &[u8], target: &str, existing: Option<&[u8]>) -> Result<Vec<u8>> {
    let mut bytes = canonical(&action_value(request,target,existing)?)?; bytes.push(b'\n'); Ok(bytes)
}
/// Rederive complete action semantics instead of trusting self-consistent caller
/// hashes. Not full SetupPlanV2 verification and deliberately not an effect API.
pub fn verify_file_action(request: &[u8], target: &str, existing: Option<&[u8]>, proposed: &[u8]) -> Result<Vec<u8>> {
    let expected = derive_file_action(request,target,existing)?;
    let supplied = parse_bounded(proposed,2097152)?;
    let mut bytes = canonical(&supplied)?; bytes.push(b'\n');
    if expected != bytes { return Err(Error::StalePlan); }
    Ok(expected)
}
