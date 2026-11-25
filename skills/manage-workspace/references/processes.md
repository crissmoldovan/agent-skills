# Processes and memory

Agent sessions leave processes behind as readily as folders: a plugin helper that outlives the
session that started it, an agent CLI that keeps running after its editor window died, a virtual
machine nobody stopped. Each one holds memory, and on a machine that already swaps, one more heavy
job can stall it. Both checks here are in `scripts/machine.mjs` and run through `leftovers.mjs`:
`memory` and `processes`. They need Node.js 22 or newer on macOS or Linux and make no network
request.

## The memory check

```bash
node scripts/leftovers.mjs memory --need-mib 6144     # before a 6 GiB virtual machine
node scripts/leftovers.mjs memory                     # before a test suite or a build
```

It prints its readings and verdict as JSON and exits 0 when the job may start, 1 when it should not
or when memory could not be read (an unknown is never a pass), and 2 on a usage error, so it works as a
preflight in a heavy-command queue or a VM harness.

| Reading | macOS | Linux |
| --- | --- | --- |
| free percentage | `kern.memorystatus_level` | `MemAvailable` / `MemTotal` in `/proc/meminfo` |
| swap in use | `vm.swapusage` | `SwapTotal` − `SwapFree` |
| physical memory | `hw.memsize` | `MemTotal` |

It refuses when any of these holds:

1. the free percentage is under the floor (`--min-free-pct`, default 20);
2. swap in use is over the limit (`--max-swap-mib`, default a quarter of physical memory);
3. the job's `--need-mib` does not fit in what is free above the floor, so starting it would leave
   the machine under the floor.

**Why swap is counted separately.** On macOS `kern.memorystatus_level`, the number `memory_pressure`
prints as "free", counts compressed memory as reclaimable and does not count swap at all. On a
36 GB Mac it was observed to read 37 to 42 while swap held more than 19 GB and the window server was
about to stall: a gate on the free percentage alone passes exactly when it should refuse. The limit is
set against physical memory rather than the swap total, because macOS grows swap one file at a time as
it needs it, so "swap used as a share of swap total" is always high once swap is in use and says
nothing. A quarter of RAM in swap is the default line: past it, the machine is paging its working set.

Limits: the check reads the machine at the moment it runs; it reserves nothing, so two jobs that check
at once can both pass. Queue heavy jobs too.

## What the process check finds

```bash
node scripts/leftovers.mjs processes                  # machine-wide, read-only
node scripts/leftovers.mjs processes --json
node scripts/leftovers.mjs processes --session <id>   # one session's
```

It reads the process table once (`ps -A -ww -o pid=,ppid=,etime=,rss=,args=`) and reports:

- **Helpers**: processes a plugin starts detached and keyed to a folder. Each is reported with its
  session, its folder (and whether that folder still exists), its whole process tree and the tree's
  resident size. The one known today:

  | Helper | Recognised by | Its session | Its folder |
  | --- | --- | --- | --- |
  | Codex companion broker (the Codex plugin for Claude Code) | a `node` binary running `app-server-broker.mjs serve --endpoint … --cwd … --pid-file …`, exactly; paths may contain spaces, and a shell or anything else that merely names the script is not it | `CODEX_COMPANION_SESSION_ID` in its environment | its `--cwd`, whole |

  That broker is keyed to the folder a Codex call runs in, and the plugin's own session-end hook
  stops only the broker of the session's own folder. A session that runs Codex inside other folders,
  one worktree per task for example, leaves one broker per folder running until reboot, each with its
  own app server and tool servers, often after the worktree is deleted. Seventeen such brokers from one
  long session, about three hundred processes, were found holding about 14 GB.
- **Agent CLIs with no parent**: a `claude` or `codex` process whose parent is the init process. That
  is what an editor's death leaves: the CLI keeps running, and keeps working, for some minutes. It is
  reported with its session where Claude Code's session file names it.
- **A session served by two processes**: when the editor reopens a session whose old process is still
  running, both work on one session and write one transcript.
- **Virtual machine processes**: `com.apple.Virtualization.VirtualMachine`, `qemu-system-*`, `vfkit`
  and `krunkit`, with their resident size. A Docker Desktop VM is one of these; it holds its fixed
  allocation whether or not a container runs.

Whether a Claude Code session is still running comes from Claude Code's session files
(`~/.claude/sessions/<pid>.json`, or under `$CLAUDE_CONFIG_DIR`), each naming a process and its
`sessionId`. Those files are not a documented interface. A session without a file counts as not
running only when every running Claude Code process has a file in that folder; a process that has none
(one from another `CLAUDE_CONFIG_DIR`, or a headless run, which has not been checked) makes absence
unknown. When the folder is missing or unreadable, liveness is unknown too, and unknown never counts as
ended. A folder counts as deleted only when it does not exist; one that cannot be read is unknown.

## What is stopped, and when

Nothing here sends a signal. A helper is **asked to shut itself down**, on its own socket, the way its
plugin's session-end hook does it: for the Codex companion broker, a `broker/shutdown` request on the
socket named by its `--endpoint`, after which the broker closes its own app server and children and
exits. Before asking, a harmless request checks it is not busy: a broker serving another client answers
"Shared Codex broker is busy", and is left running.

| When | What is asked to shut down | Scope |
| --- | --- | --- |
| `SessionEnd` hook (Claude Code only) | every helper whose environment names the ending session, except one in a workspace another live session works in (the folder the plugin keys a broker by: git's top level, or the folder itself outside a repository, real path resolved); without the session files, none, since sharing cannot be ruled out | any folder |
| `Stop` hook (each turn) | this session's helpers whose folder no longer exists, unless another live session works in their workspace; without the session files, none | this session only |
| `processes --stop-helpers --yes`, on a person's word | helpers of a known session whose folder is gone, and helpers whose session is known to have ended unless another live session works in their workspace | machine-wide, or one `--session` |
| never | a busy helper, a helper whose session is unknown, a live session's helper in an existing folder, agent CLIs, virtual machines, containers | |

The hooks never stop another session's process: another session's leftovers are reported at session
start so the agent tells the user, and stopping them is the user's call. `--stop-helpers` without
`--yes` only previews.

Before asking, the process table is read again, and a helper is skipped unless its pid still has the
same command line and its environment still names the same session. A helper with no socket (a broker
replaced without being stopped has lost its socket), one that does not answer, or one that refuses is
left running, and the report gives the `kill <pid>` a person can run after checking it is not in use.
A helper counts as stopped once it has accepted the request. To have the hooks ask nothing (the
end-of-turn check then lists this session's helpers in deleted folders instead, and session end does
nothing):

```bash
node scripts/setup-enforcement.mjs helpers report --yes   # or MWS_HELPERS=report for one process
```

## When the editor dies

A session whose editor dies does not end: no `SessionEnd` hook runs while its CLI is still alive, so
its helpers are not stopped then. Two sessions working in one folder share its broker; the first to end
leaves it to the other, and a session that works in a folder only by changing into it from elsewhere is
not seen as working there. On the night this was written six such CLIs kept running for about
ten minutes after the window server was killed and then exited on their own, while the editor reopened
three of their sessions in new processes. Treat a parentless agent CLI as possibly mid-work: report it,
let the user decide, and expect it to exit. The time it took to exit was observed once, not documented.

## Adding a helper

A new helper is one entry in `HELPERS` in `scripts/machine.mjs`: an `id`, a `label`, a `match`
expression for its command line, the environment variable that names its session, and the argument
that names its folder. Without a session variable it can be reported but never stopped by a hook.

## Limits

- Sizes are resident (RSS): what is in physical memory now. Pages compressed or swapped out are not
  counted, so under pressure a process's real share is larger than shown.
- A helper's environment is read with `ps -E` on macOS and `/proc/<pid>/environ` on Linux, for the
  current user's processes only. `ps -E` runs entries together with spaces, so a value with a space in it
  can look like another entry: when the session variable appears with two different values, the session
  is read as unknown and the helper is never stopped.
- A folder is "deleted" only when it does not exist; a symlink is followed, and a folder that cannot be
  read is unknown. A session file whose process started at another time than its pid's (the pid was
  reused) is ignored.
- Asking a helper to stop connects to the socket its command line names. A process that merely
  carries a broker's command line would receive the request on that socket; nothing else is sent to
  it, and no signal is sent to anything.
- The busy check and the shutdown request go on one connection, the second the moment the first is
  answered, but the protocol has no "shut down only if idle": a request another client starts in that
  instant is cut off. The plugin's own session-end hook does not check at all.
- The busy check sees only what the broker knows: when a client that started a Codex turn crashes or
  disconnects, the broker forgets it was busy while its app server may still be running that turn, and a
  shutdown then cuts the turn off, as the plugin's own session-end hook would.
- The workspace guard keys each folder as the plugin does, by asking git: `git rev-parse
  --show-toplevel` in the folder, or the folder itself when git says it is not in a repository or git
  is not installed, then the real path. So a repository nested inside another has its own key, and a
  `.git` folder git does not accept as a repository makes no new one. Git cannot be asked about a
  deleted folder, so it is asked about the nearest folder that still exists: a deleted folder inside a
  repository another live session works in keeps its broker, even when it was a worktree with a broker
  of its own. Git runs with the session's environment, as the plugin's does, so `GIT_DIR` and its
  kin count. Each other session's plugin asked git with that session's environment, which the hook
  cannot see, so when the hook's session sets any `GIT_` variable, every folder is keyed a second time
  without them, and a match either way keeps the broker: a session that sets `GIT_DIR` for its whole
  life can no longer split a repository another session works in. The git calls of one hook share an
  8-second budget, each at most 1.5 seconds and killed at its limit; when git times out, does not
  start, or the budget is spent, the helper is kept. The budget is read on the monotonic clock, so a
  wall clock that stops or is set back does not stretch it, and `MWS_GIT_BUDGET_MS` can set it to at
  most 15 seconds, half the hook's 30-second timeout, so the shutdown requests still fit.
- Another session's environment cannot be seen, so its folder is keyed with the hook's environment and
  with no `GIT_` variables, never with its own. A session that itself sets `GIT_DIR` or
  `GIT_WORK_TREE` for its whole life can therefore still be keyed differently from its own plugin, and
  a broker it uses between requests can be asked to shut down. A request in progress is still
  protected by the busy check, and that session's next Codex call starts a new broker, as it does after
  the plugin's own session-end hook, which stops its folder's broker without checking for other
  sessions at all.
- The machine check at session start reports at most twelve items, and a process table that cannot be
  read within its time budget yields no report rather than a wrong one.
- A process started under a name the check does not know is not reported. Note what you start.
