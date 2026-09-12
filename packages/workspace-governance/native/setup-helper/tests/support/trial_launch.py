"""External exec-boundary observer. No production fault hooks."""
import os,signal,pathlib,ctypes,time,json
from controller_crash import trace

def observe(argv,node,helper,callback,logdir,kill_node=False):
 pid=os.fork()
 if pid==0:
  try:
   for fd,name in [(1,'stdout'),(2,'stderr')]:
    out=os.open(logdir/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);os.dup2(out,fd);os.close(out)
   trace(0,0);os.kill(os.getpid(),signal.SIGSTOP);os.execve(argv[0],argv,{})
  finally:os._exit(127)
 _,status=os.waitpid(pid,0);assert os.WIFSTOPPED(status)
 options=0x2|0x4|0x8|0x10|0x40|0x100000 # fork/vfork/clone/exec/exit/exitkill
 trace(0x4200,pid,0,options);trace(7,pid)
 live={pid};events=[];node_pid=None;helper_pid=None;changed=False;exitcode=None;adopted=None
 try:
  while live:
   who,status=os.waitpid(-1,0x40000000)
   if os.WIFEXITED(status) or os.WIFSIGNALED(status):
    live.discard(who)
    if who==pid:exitcode=os.waitstatus_to_exitcode(status)
    continue
   assert os.WIFSTOPPED(status)
   event=status>>16;sig=os.WSTOPSIG(status)
   if event in [1,2,3]:
    child=ctypes.c_ulonglong();trace(0x4201,who,0,ctypes.byref(child));live.add(child.value)
   if event==4:
    exe=os.readlink(f'/proc/{who}/exe');entry=dict(pid=who,exe=exe,argv=pathlib.Path(f'/proc/{who}/cmdline').read_bytes().split(b'\0')[:-1],environment=pathlib.Path(f'/proc/{who}/environ').read_bytes(),fds={})
    entry['argv']=[a.decode() for a in entry['argv']];entry['environment']=entry['environment'].decode()
    for fd in pathlib.Path(f'/proc/{who}/fd').iterdir():
     try:entry['fds'][fd.name]=os.readlink(fd)
     except FileNotFoundError:pass
    events.append(entry)
    if exe==str(node):
     node_pid=who
     if not changed:callback();changed=True
    if exe==str(helper):
     helper_pid=who
     if kill_node:os.kill(node_pid,signal.SIGKILL)
   if event==6 and who==helper_pid and kill_node:
    # At helper exit stop, the Node's fatal signal may still be queued. Observe
    # adoption after Node actually exits, not merely after kill() returns.
    deadline=time.monotonic()+5
    while time.monotonic()<deadline:
     stat=pathlib.Path(f'/proc/{helper_pid}/stat').read_text().rsplit(') ',1)[1].split();parent=int(stat[1])
     if parent!=node_pid:
      adopted=parent
      if parent==pid:
       import fcntl,hashlib
       registry=pathlib.Path(argv[2]).parent/'registry';lock=registry/('.workspacectl-lock-'+hashlib.sha256(str(registry).encode()).hexdigest())
       fd=os.open(lock,os.O_RDWR|os.O_NOFOLLOW)
       try:
        try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:pass
        else:raise AssertionError('registry released before helper exit/reap')
       finally:os.close(fd)
      break
     # Node cannot finish group-exit while one of its traced threads is stopped.
     # Drain every other tracee's exit stops, not just the thread-group leader.
     for other in list(live-{helper_pid}):
      try:w,s=os.waitpid(other,os.WNOHANG|0x40000000)
      except ChildProcessError:live.discard(other);continue
      if w:
       if os.WIFSTOPPED(s):trace(7,w)
       else:
        live.discard(w)
        if w==pid:exitcode=os.waitstatus_to_exitcode(s)
     time.sleep(.01)
   trace(7,who,0,0 if sig in [signal.SIGTRAP,signal.SIGSTOP] else sig)
  receipt=dict(controller=pid,node=node_pid,helper=helper_pid,exit=exitcode,changed=changed,adopted=adopted,events=events)
  (logdir/'trace.json').write_text(json.dumps(receipt,indent=2));return receipt
 finally:
  for p in live:
   try:os.kill(p,signal.SIGKILL)
   except ProcessLookupError:pass
