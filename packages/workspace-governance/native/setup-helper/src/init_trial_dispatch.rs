//! Authenticated strict transport for initial apply and completed recognition.
//! Incomplete recovery remains unsupported. Persistent transaction locks remain.
use super::*;
use crate::init::trial_protocol::{Dispatch, Session};
use base64::{engine::general_purpose::STANDARD, Engine};
#[path = "init_trial_ledger.rs"]
mod ledger;
use std::sync::{atomic::{AtomicU8, Ordering}, Arc};
const RESPONSE: &str = "workspace-governance/init-helper-response-v1";
fn request(a: &Admission, number: u32, op: &str, body: Value) -> Result<Vec<u8>> {
    wire(&object(vec![("apiVersion",string("workspace-governance/init-trial-helper-request-v1")),("request",n(number as u64)),("op",string(op)),("body",body),("trial",field(&json(&a.bytes)?,"trial")?.clone())]))
}
fn reply(number:u32, kind:&str, body:Value, ok:bool)->Result<Vec<u8>> {
    wire(&object(vec![("apiVersion",string(RESPONSE)),("request",n(number as u64)),("ok",Value::Bool(ok)),("kind",string(kind)),("body",body)]))
}
pub(super) fn error(number:u32, operation:&str, code:&str)->Result<Vec<u8>> {
    reply(number,"error",object(vec![("code",string(code)),("operationId",string(operation)),("reason",Value::Null)]),false)
}
pub(super) fn validate_response(bytes:&[u8],operation:&str,plan:&Value,recognized:Option<&Value>)->Result<bool> {
    let parsed=json(bytes)?;
    if field(&parsed,"ok")?==&Value::Bool(true) {
        let actions=match field(plan,"actions")? {Value::Array(a)=>a,_=>return invalid()};
        let revision=if let Some(a)=actions.first(){field(a,"afterSha256")?.clone()}else{field(plan,"manifestRevision")?.clone()};
        let elements=actions.iter().map(|a|Ok(object(vec![("id",field(a,"id")?.clone()),("state",string("verified")),("evidenceRef",string("evidence/000005.json"))]))).collect::<Result<Vec<_>>>()?;
        let body=object(vec![("apiVersion",string("workspace-governance/init-trial-setup-result-v1")),("operationId",string(operation)),("proposalDigest",field(plan,"digest")?.clone()),("state",string("verified")),("actions",Value::Array(elements)),("manifestRevision",revision),("checkout",Value::Null)]);
        eq(&parsed,&json(&reply(2,"result",recognized.cloned().unwrap_or(body),true)?)?)?;Ok(true)
    } else {
        let code=text(field(field(&parsed,"body")?,"code")?)?;
        if !["UNSUPPORTED","INVALID","STALE_PLAN","LIMIT","INCOMPLETE","LOCKED","TOOL_FAILURE","RECOVERY_REQUIRED"].contains(&code.as_str()){return invalid()}
        eq(&parsed,&json(&error(2,operation,&code)?)?)?;Ok(false)
    }
}
fn saved(a:&Admission)->Result<(Value,Vec<u8>)> {
    let startup=json(&a.bytes)?;
    let trial=reference(field(&startup,"trial")?)?;
    let record=RegistryCapture::capture(trial.clone())?;
    let stem=trial.file_stem().and_then(|s|s.to_str()).ok_or(Failure::Invalid)?;
    let plan=RegistryCapture::capture(trial.parent().ok_or(Failure::Invalid)?.join(format!("{stem}.plan.json")))?;
    a.live()?;
    Ok((json(&record.bytes)?,plan.bytes))
}
fn begin(a:&Admission)->Result<Value> {
    let (r,pb)=saved(a)?;
    let p=json(&pb)?;
    let invocation=field(&r,"invocation")?;
    Ok(object(vec![
        ("mode",field(invocation,"mode")?.clone()),
        ("host",object(vec![("pid",string(&a.node_pid.to_string())),("startTicks",string(&a.node_start.to_string())),("bootId",field(field(&r,"environment")?,"bootId")?.clone())])),
        ("operationId",field(invocation,"operationId")?.clone()),
        ("approvalDigest",field(invocation,"approvalDigest")?.clone()),
        ("context",field(&p,"context")?.clone()),
        ("proposal",object(vec![("encoding",string("base64-chunks-v1")),("byteLength",n(pb.len() as u64)),("sha256",string(&sha256(&pb))),("chunks",Value::Array(pb.chunks(12288).map(|b|string(&STANDARD.encode(b))).collect()))]))
    ]))
}
fn capabilities(a:&Admission)->Result<Value> {
    // candidate() independently checks all closed compiled ABI/profile constants,
    // release and actual helper bytes before this declaration is exposed.
    json(&read_file(&reference(field(&a.candidate,"capabilities")?)?,262144,0o600)?)
}
fn packet(fd:i32,until:Instant)->Result<Vec<u8>> {
    let mut h=[0;4];exact_read(fd,&mut h,until,true)?;
    let size=u32::from_be_bytes(h) as usize;
    if size==0 || size>2097152{return Err(Failure::Limit)}
    let mut b=vec![0;size];exact_read(fd,&mut b,until,true)?;Ok(b)
}
fn stopped(state:&AtomicU8)->Result<()> {
    if state.load(Ordering::SeqCst)==0 {Ok(())}else{Err(Failure::Stale)}
}
/// The initial frame is private startup authentication, not a trial request.
/// Every following frame is strictly numbered; only this thread writes replies.
pub(super) fn serve(root:&Path, startup:&[u8], fd:i32)->Result<()> {
    let a=admit(root,startup,true)?;
    let until=Instant::now()+Duration::from_secs(30);
    let mut session=Session::new();
    let cap=packet(fd,until)?;
    if session.accept(&cap).map_err(|_|Failure::Invalid)?!=Dispatch::Capabilities {return invalid()}
    eq(field(&json(&cap)?,"trial")?,field(&json(startup)?,"trial")?)?;
    frame_write(fd,&reply(1,"capabilities",capabilities(&a)?,true)?,until)?;
    let input=packet(fd,until)?;
    let Dispatch::Begin{request:number,operation_id,body}=session.accept(&input).map_err(|_|Failure::Invalid)? else{return invalid()};
    // All semantic approval and full native admission precede even lock creation.
    let expected=begin(&a)?;
    let until=Instant::now()+Duration::from_secs(300);

    let state=Arc::new(AtomicU8::new(0));
    std::thread::scope(|scope| -> Result<()> {
        let observed=state.clone();
        let reader=scope.spawn(move || -> Result<Option<u32>> {
            // Bounded to the one legal cancel plus limited identical retransmits.
            // EOF/malformed/timeout stop new effects, never imply success.
            let mut cancel=None;
            for _ in 0..8 {
                let bytes=match packet(fd,until) {Ok(b)=>b,Err(e)=>{observed.compare_exchange(0,2,Ordering::SeqCst,Ordering::SeqCst).ok();return if cancel.is_some(){Ok(cancel)}else{Err(e)}}};
                match session.accept(&bytes) {
                    Ok(Dispatch::Cancel)=>{observed.compare_exchange(0,1,Ordering::SeqCst,Ordering::SeqCst).ok();cancel=Some(3);},
                    Ok(Dispatch::DuplicateCancel)=>{},
                    _=>{observed.compare_exchange(0,2,Ordering::SeqCst,Ordering::SeqCst).ok();return Err(Failure::Invalid)}
                }
            }
            observed.compare_exchange(0,2,Ordering::SeqCst,Ordering::SeqCst).ok();Err(Failure::Limit)
        });
        let mut held=None;
        let mut prepared=None;
        let mut transaction=None;
        let mut recovered=None;
        let mut result=None;
        let mut contended=false;
        let admission=(|| -> Result<()> {
            eq(&json(&body)?,&expected)?;
            stopped(&state)?;a.live()?;
            let pre=admit(root,startup,true)?;
            eq(&begin(&pre)?,&expected)?;
            let (_,pb)=saved(&pre)?;let plan=json(&pb)?;let context=field(&plan,"context")?;
            let locks=crate::fs::InitLockSet::prepare(&path(field(context,"manifestPath")?)?,&path(field(context,"stateDir")?)?).map_err(|_|Failure::Unsupported)?;
            let paths=Value::Array(locks.paths().iter().map(|p|literal(p).map(string)).collect::<Result<Vec<_>>>()?);
            eq(&paths,field(field(&plan,"bookkeeping")?,"lockPaths")?)?;
            if pre.records.recovery.is_none() {prepared=Some(ledger::Ledger::prepare(admit(root,startup,true)?,state.clone(),until)?);}
            // Inspect every pre-existing lock before creating any of them. In
            // particular, a FIFO/device at the second name cannot leave a new
            // first lock as a side effect of an initially unsafe invocation.
            let mut inspected=Vec::new();
            for lock in locks.paths() {
                let parent=open_directory(lock.parent().ok_or(Failure::Invalid)?)?;
                let name=cstr(lock.file_name().and_then(|s|s.to_str()).ok_or(Failure::Invalid)?)?;
                let fd=unsafe{libc::openat(parent.as_raw_fd(),name.as_ptr(),libc::O_PATH|libc::O_NOFOLLOW|libc::O_CLOEXEC)};
                if fd<0 {
                    if std::io::Error::last_os_error().raw_os_error()==Some(libc::ENOENT){continue}
                    return Err(Failure::Unsupported)
                }
                let file=unsafe{File::from_raw_fd(fd)};let facts=metadata(&file)?;
                if !facts.is_file() || facts.uid()!=unsafe{libc::geteuid()} || facts.mode()&0o7777!=0o600 || facts.nlink()!=1 {return Err(Failure::Unsupported)}
                inspected.push((parent,file));
            }
            stopped(&state)?;pre.live()?;
            held=Some(locks.acquire().map_err(|e|{contended=e==crate::fs::Failure::Locked;Failure::Unsupported})?);
            // Retain preflight witnesses and locks while recapturing the entire
            // native authority, immutable registry, plan, runtime and resources.
            stopped(&state)?;pre.live()?;a.live()?;
            let under=admit(root,startup,true)?;
            eq(&begin(&under)?,&expected)?;
            under.live()?;pre.live()?;a.live()?;stopped(&state)?;
            if under.records.recovery.is_some() {
                recovered=Some(under);
                result=Some(recognize(recovered.as_ref().ok_or(Failure::Invalid)?,&state,until)?);
            } else {
                transaction=Some(ledger::Ledger::prepare(under,state.clone(),until)?);
                result=Some(transaction.as_mut().ok_or(Failure::Invalid)?.run()?);
            }
            Ok(())
        })();
        let code=if contended {"LOCKED"} else {match state.load(Ordering::SeqCst) {
            1=>"INCOMPLETE",2=>"INVALID",
            _=>match admission {Ok(())=>"UNSUPPORTED",Err(Failure::Invalid)=>"INVALID",Err(Failure::Stale)=>"STALE_PLAN",Err(Failure::Limit)=>"LIMIT",Err(Failure::Unsupported)=>"UNSUPPORTED",Err(Failure::RecoveryRequired)=>"RECOVERY_REQUIRED"}
        }};
        let output=frame_write(fd,&match result {Some(value)=>reply(number,"result",value,true)?,None=>error(number,&operation_id,if state.load(Ordering::SeqCst)==1{"TOOL_FAILURE"}else{code})?},until);
        // The caller closes its write half after its optional cancel. Keep locks
        // until reader quiescence; no second begin response, even on output loss.
        if output.is_err(){unsafe{libc::shutdown(fd,libc::SHUT_RD);}}
        let cancelled=reader.join().map_err(|_|Failure::Unsupported)?;
        output?;
        if let Ok(Some(cancel))=cancelled {
            frame_write(fd,&reply(cancel,"cancelled",object(vec![("operationId",string(&operation_id))]),true)?,until)?;
        }
        drop(held);
        Ok(())
    })
}
fn recognize(a:&Admission,state:&AtomicU8,until:Instant)->Result<Value> {
    let completed=a.records.recovery.as_ref().ok_or(Failure::Invalid)?;
    stopped(state)?;a.live()?;completed.authority(&a.root)?;
    if state.compare_exchange(0,3,Ordering::SeqCst,Ordering::SeqCst).is_err(){return Err(Failure::Stale)}
    let mut terminal=crate::init::trial_protocol::Terminal::new();
    if !terminal.enter_terminal(){return Err(Failure::Stale)}
    let barriers=completed.barriers(||{
        if Instant::now()>=until{return Err(Failure::Stale)}
        a.live()?;completed.authority(&a.root)
    });
    terminal.finish(barriers.is_ok());barriers?;
    terminal.finalize_reply().ok_or(Failure::Stale)?;
    Ok(completed.result.clone())
}
pub(super) fn exchange(a:&Admission,fd:i32,until:Instant)->Result<Vec<u8>> {
    frame_write(fd,&a.bytes,until)?;
    frame_write(fd,&request(a,1,"capabilities",object(vec![]))?,until)?;
    let cap=packet(fd,until)?;
    eq(&json(&cap)?,&json(&reply(1,"capabilities",capabilities(a)?,true)?)?)?;
    let body=begin(a)?;let operation=text(field(&body,"operationId")?)?;
    frame_write(fd,&request(a,2,"begin",body)?,until)?;
    let until=Instant::now()+Duration::from_secs(300);
    let result=packet(fd,until)?;
    let (_,pb)=saved(a)?;
    validate_response(&result,&operation,&json(&pb)?,a.records.recovery.as_ref().map(|c|&c.result))?;
    frame_write(fd,&request(a,3,"cancel",object(vec![("operationId",string(&operation))]))?,until)?;
    if unsafe{libc::shutdown(fd,libc::SHUT_WR)}!=0{return Err(Failure::Unsupported)}
    let ack=packet(fd,until)?;
    eq(&json(&ack)?,&json(&reply(3,"cancelled",object(vec![("operationId",string(&operation))]),true)?)?)?;
    poll_fd(fd,libc::POLLIN,until)?;
    if receive(fd,&mut[0],true)?!=0{return invalid()}
    Ok(result)
}
