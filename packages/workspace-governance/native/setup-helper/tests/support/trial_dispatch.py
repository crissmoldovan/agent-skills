"""External syscall observer/transport adversary; no candidate fault hooks.
Linux x86_64 only. Captures real framed write syscalls and transaction flock.
"""
import os, signal, pathlib, ctypes, json, time, struct
from controller_crash import trace, Regs

def packet(v):
 b=json.dumps(v,sort_keys=True,separators=(',',':')).encode();return struct.pack('>I',len(b))+b

def observe(argv,node,helper,locks,mode,callback,logdir):
 pid=os.fork()
 if pid==0:
  try:
   for fd,name in [(1,'stdout'),(2,'stderr')]:
    out=os.open(logdir/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);os.dup2(out,fd);os.close(out)
   trace(0,0);os.kill(os.getpid(),signal.SIGSTOP);os.execve(argv[0],argv,{})
  finally:os._exit(127)
 _,status=os.waitpid(pid,0);assert os.WIFSTOPPED(status)
 trace(0x4200,pid,0,0x1|0x2|0x4|0x8|0x10|0x40|0x100000);trace(7,pid)
 live={pid};roles={};events=[];changed=False;exitcode=None;held=[];start=time.monotonic();count=0;pending={};received=bytearray();seen_locks=set();hardware={};stepping=set();failed_sync=set()
 def read(who,addr,size):
  out=bytearray()
  for at in range(0,size,8):
   ctypes.set_errno(0)
   from controller_crash import libc
   word=libc.ptrace(2,who,ctypes.c_void_p(addr+at),0)
   if word==-1 and ctypes.get_errno():raise OSError(ctypes.get_errno(),'peek')
   out.extend((word&((1<<64)-1)).to_bytes(8,'little'))
  return bytes(out[:size])
 try:
  while live:
   who,status=os.waitpid(-1,0x40000000);count+=1
   assert count<500000 and time.monotonic()-start<300,'external observation bound'
   if os.WIFEXITED(status) or os.WIFSIGNALED(status):
    live.discard(who)
    if who==pid:exitcode=os.waitstatus_to_exitcode(status)
    continue
   event=status>>16;sig=os.WSTOPSIG(status)
   if event in [1,2,3]:
    child=ctypes.c_ulonglong();trace(0x4201,who,0,ctypes.byref(child));live.add(child.value)
    if who in roles:roles[child.value]=roles[who]
   if event==4:
    exe=os.readlink(f'/proc/{who}/exe')
    if exe==str(node):roles[who]='node'
    if exe==str(helper):roles[who]='helper'
   if sig==signal.SIGTRAP and event==0 and who in hardware:
    trace(6,who,904,0);stepping.add(who)
   if sig==(signal.SIGTRAP|0x80) and who in roles:
    regs=Regs();trace(12,who,0,ctypes.byref(regs))
    # -ENOSYS marks syscall entry, not the corresponding successful exit.
    if regs.rax==2**64-38:
     if roles[who]=='helper' and regs.orig_rax==157 and regs.rdi==4 and regs.rsi==0:
      # Before dumpability is disabled, measure libc's mapping. Hardware execute
      # breakpoint observes flock without tracing hundreds of thousands of
      # unrelated filesystem syscalls or weakening the candidate's dumpability.
      from controller_crash import libc
      local=next(l for l in pathlib.Path('/proc/self/maps').read_text().splitlines() if 'libc.so.6' in l and l.split()[2]=='00000000')
      remote=next(l for l in pathlib.Path(f'/proc/{who}/maps').read_text().splitlines() if 'libc.so.6' in l and l.split()[2]=='00000000')
      address=ctypes.cast(libc.flock,ctypes.c_void_p).value-int(local.split('-')[0],16)+int(remote.split('-')[0],16)
      trace(6,who,848,ctypes.c_void_p(address));trace(6,who,904,1);hardware[who]=address
      if mode.startswith('ledger-'):
       native_libc=ctypes.CDLL(local.split()[-1])
       for offset,symbol in [(856,native_libc.renameat2),(864,native_libc.fsync)]:
        address=ctypes.cast(symbol,ctypes.c_void_p).value-int(local.split('-')[0],16)+int(remote.split('-')[0],16)
        trace(6,who,offset,ctypes.c_void_p(address))
       trace(6,who,904,21)
     if roles[who]=='node' and regs.orig_rax==1 and regs.rdx>=4 and regs.rdx<=2097156 and regs.rdi>2:
      # PEEKDATA remains available to the existing tracer after PR_SET_DUMPABLE.
      raw=read(who,regs.rsi,regs.rdx)
      try:v=json.loads(raw[4:]) if int.from_bytes(raw[:4],'big')==len(raw)-4 else None
      except (ValueError,UnicodeDecodeError):v=None
      if isinstance(v,dict) and str(v.get('apiVersion','')).startswith('workspace-governance/'):
       events.append(dict(role=roles[who],frame=v))
       if roles[who]=='node' and v.get('op')=='begin' and not changed and mode in ['cancel','malformed','repeat','unsafe']:
        if mode=='unsafe':callback('wire');changed=True;trace(24,who);continue
        if mode=='malformed':v['body']['approvalDigest']='f'*64;replacement=packet(v)
        else:
         follow=dict(v,request=3,op='cancel',body=dict(operationId=v['body']['operationId'])) if mode=='cancel' else dict(v,request=3)
         replacement=raw+packet(follow)
        # Scratch below the stopped thread's stack pointer; never production code.
        scratch=(regs.rsp-len(replacement)-4096)&~7
        backup=read(who,scratch,len(replacement)+8)
        for at in range(0,len(replacement),8):
         word=int.from_bytes(replacement[at:at+8].ljust(8,b'\0'),'little');trace(5,who,scratch+at,ctypes.c_void_p(word))
        regs.rsi=scratch;regs.rdx=len(replacement);trace(13,who,0,ctypes.byref(regs))
        # Scratch is below active stack frames; process will exit without reuse.
        events.append(dict(injected=mode,bytes=len(replacement)));callback('wire');changed=True
     if regs.orig_rax==73 and roles[who]=='helper':
      path=next((p for p in locks if p not in seen_locks and pathlib.Path(p).is_file()),None)
      if path:
       seen_locks.add(path)
       events.append(dict(flock=path,operation=int(regs.rsi)))
       if path==locks[-1] and mode in ['stale','contention','controllers'] and not changed:
        if mode=='contention':
         import fcntl
         fd=os.open(path,os.O_RDWR|os.O_NOFOLLOW);fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);held.append(fd)
        callback('lock');changed=True
     if roles[who]=='helper' and mode.startswith('ledger-') and regs.orig_rax in [316,74]:
      boundary='rename' if regs.orig_rax==316 else 'fsync'
      selected=callback(boundary)
      events.append(dict(boundary=boundary,fd=int(regs.rdi),selected=bool(selected)))
      if selected and not changed:
       changed=True
       if mode=='ledger-fsync-fail':
        regs.orig_rax=39;trace(13,who,0,ctypes.byref(regs));failed_sync.add(who)
     if regs.orig_rax==47 and roles[who]=='node':
      if mode=='eof' and not changed and any(e.get('frame',{}).get('op')=='begin' for e in events):
       regs.orig_rax=48;regs.rsi=1;trace(13,who,0,ctypes.byref(regs));callback('wire');changed=True
       trace(24,who);continue
      iov=int.from_bytes(read(who,regs.rsi+16,8),'little');pending[who]=int.from_bytes(read(who,iov,8),'little')
    elif who in failed_sync:
     regs.rax=2**64-5;trace(13,who,0,ctypes.byref(regs));failed_sync.remove(who)
     events.append(dict(boundary='fsync-return',result=-5))
     stepping.discard(who);trace(6,who,904,21)
    elif regs.orig_rax in [73,316,74] and who in stepping:
     if mode.startswith('ledger-'):events.append(dict(boundary='syscall-return',syscall=int(regs.orig_rax),result=int(regs.rax)))
     stepping.remove(who);trace(6,who,904,21 if mode.startswith('ledger-') else 1)
    elif regs.orig_rax==47 and roles[who]=='node':
     address=pending.pop(who,None)
     if address and 0<regs.rax<=2097152:
      received.extend(read(who,address,regs.rax))
      while len(received)>=4 and len(received)>=4+int.from_bytes(received[:4],'big'):
       size=int.from_bytes(received[:4],'big');v=json.loads(received[4:4+size]);del received[:4+size];events.append(dict(role='helper',frame=v))
   trace(24 if who in roles and (who not in hardware or who in stepping) else 7,who,0,0 if sig in [signal.SIGTRAP,signal.SIGSTOP,signal.SIGTRAP|0x80] else sig)
  receipt=dict(exit=exitcode,changed=changed,events=events,syscallStops=count)
  (logdir/'trace.json').write_text(json.dumps(receipt,indent=2));return receipt
 finally:
  (logdir/'partial-trace.json').write_text(json.dumps(dict(events=events,count=count,elapsed=time.monotonic()-start,changed=changed,exit=exitcode),indent=2))
  for fd in held:os.close(fd)
  for child in live:
   try:os.kill(child,signal.SIGKILL)
   except ProcessLookupError:pass
