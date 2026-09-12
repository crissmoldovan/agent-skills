"""External x86_64 ptrace crash observer; never compiled into the candidate."""
import os, signal, ctypes, pathlib
libc=ctypes.CDLL(None,use_errno=True)
libc.ptrace.restype=ctypes.c_long
class Regs(ctypes.Structure):
 _fields_=[(k,ctypes.c_ulonglong) for k in ['r15','r14','r13','r12','rbp','rbx','r11','r10','r9','r8','rax','rcx','rdx','rsi','rdi','orig_rax','rip','cs','eflags','rsp','ss','fs_base','gs_base','ds','es','fs','gs']]
def trace(req,pid,addr=0,data=0):
 result=libc.ptrace(req,pid,ctypes.c_void_p(addr),data)
 if result==-1:raise OSError(ctypes.get_errno(),os.strerror(ctypes.get_errno()))
 return result
def change_at_registry_lock(argv,callback,logdir):
 pid=os.fork()
 if pid==0:
  try:
   for fd,name in [(1,'race.stdout'),(2,'race.stderr')]:
    out=os.open(logdir/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);os.dup2(out,fd);os.close(out)
   trace(0,0);os.kill(os.getpid(),signal.SIGSTOP);os.execve(argv[0],argv,{})
  finally:os._exit(127)
 _,status=os.waitpid(pid,0);assert os.WIFSTOPPED(status)
 trace(0x4200,pid,0,0x1|0x100000)
 changed=False
 for _ in range(100000):
  trace(24,pid,0,0);_,status=os.waitpid(pid,0)
  if os.WIFEXITED(status):return os.WEXITSTATUS(status),changed
  assert os.WIFSTOPPED(status)
  if os.WSTOPSIG(status)!=(signal.SIGTRAP|0x80):continue
  regs=Regs();trace(12,pid,0,ctypes.byref(regs))
  if regs.orig_rax==73 and not changed:callback();changed=True
 os.kill(pid,signal.SIGKILL);os.waitpid(pid,0);raise AssertionError('ptrace bound exceeded')

def crash_after_reservation(argv,record,logdir):
 pid=os.fork()
 if pid==0:
  try:
   for fd,name in [(1,'crash.stdout'),(2,'crash.stderr')]:
    out=os.open(logdir/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);os.dup2(out,fd);os.close(out)
   trace(0,0);os.kill(os.getpid(),signal.SIGSTOP);os.execve(argv[0],argv,{})
  finally:os._exit(127)
 _,status=os.waitpid(pid,0);assert os.WIFSTOPPED(status)
 trace(0x4200,pid,0,0x1|0x100000) # TRACESYSGOOD | EXITKILL
 calls=[];killed=False
 try:
  for _ in range(100000):
   trace(24,pid,0,0);_,status=os.waitpid(pid,0)
   if os.WIFEXITED(status) or os.WIFSIGNALED(status):break
   assert os.WIFSTOPPED(status)
   if os.WSTOPSIG(status)!=(signal.SIGTRAP|0x80):continue
   regs=Regs();trace(12,pid,0,ctypes.byref(regs))
   # Stop immediately BEFORE the first stdout write. The executable has already
   # completed reservation publication, parent fsync and exact readback.
   calls.append(int(regs.orig_rax))
   if regs.orig_rax==1 and regs.rdi==1 and record.is_file():
    import fcntl,hashlib
    lock=record.parent/('.workspacectl-lock-'+hashlib.sha256(str(record.parent).encode()).hexdigest());fd=os.open(lock,os.O_RDWR|os.O_NOFOLLOW)
    try:
     try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
     except BlockingIOError:pass
     else:raise AssertionError('controller must retain registry lock through observable invocation output')
    finally:os.close(fd)
    os.kill(pid,signal.SIGKILL);_,status=os.waitpid(pid,0);assert os.WIFSIGNALED(status) and os.WTERMSIG(status)==signal.SIGKILL;killed=True;break
  assert killed,('did not reach observed durable-reservation boundary',status)
  return dict(pid=pid,signal='SIGKILL',boundary='before-stdout-write-after-reservation-readback',syscallStops=len(calls),syscalls=sorted(set(calls)),reservedSha256=__import__('hashlib').sha256(record.read_bytes()).hexdigest())
 finally:
  if not killed:
   try:os.kill(pid,signal.SIGKILL);os.waitpid(pid,0)
   except ProcessLookupError:pass
