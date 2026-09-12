//! Independent manifest/state lock preparation. This is NOT approval/admission.
//! Caller must complete no-write native admission before acquire, then recapture
//! the full approved trial under the returned locks before any transaction effect.
use super::{basename,Failure,HeldLock,SafeDir};
use sha2::{Digest,Sha256};
use std::path::{Path,PathBuf};
pub struct InitLockSet { paths:Vec<PathBuf>, parents:Vec<SafeDir> }
pub struct HeldInitLocks { locks:Vec<HeldLock>, _parents:Vec<SafeDir> }
impl Drop for HeldInitLocks { fn drop(&mut self){while self.locks.pop().is_some(){}} }
impl InitLockSet {
 pub fn prepare(manifest:&Path,state:&Path)->Result<Self,Failure>{
  let mut paths=Vec::new();
  for target in [manifest,state] {
   let text=target.to_str().ok_or(Failure::Invalid)?;
   if !text.starts_with('/')||text.len()>4096||text.ends_with('/')||text.contains("//"){return Err(Failure::Invalid)}
   let parent=target.parent().ok_or(Failure::Invalid)?;
   basename(target.file_name().and_then(|s|s.to_str()).ok_or(Failure::Invalid)?)?;
   paths.push(parent.join(format!(".workspacectl-lock-{:x}",Sha256::digest(text.as_bytes()))));
  }
  // PathBuf Ord compares path components, which is NOT the contract's order.
  paths.sort_by(|a,b|a.as_os_str().as_encoded_bytes().cmp(b.as_os_str().as_encoded_bytes()));paths.dedup();
  let parents=paths.iter().map(|p|SafeDir::open(p.parent().ok_or(Failure::Invalid)?)).collect::<Result<Vec<_>,_>>()?;
  Ok(Self{paths,parents})
 }
 pub fn paths(&self)->&[PathBuf]{&self.paths}
 pub fn acquire(self)->Result<HeldInitLocks,Failure>{
  let mut held=HeldInitLocks{locks:Vec::new(),_parents:self.parents};
  for (p,parent) in self.paths.iter().zip(&held._parents){
   held.locks.push(parent.acquire_lock(p.file_name().and_then(|s|s.to_str()).ok_or(Failure::Invalid)?)?);
  }
  Ok(held)
 }
}
