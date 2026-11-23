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

It prints its readings and verdict as JSON and exits 0 when the job may start, 1 when it should not,
and 2 on a usage error, so it works as a preflight in a heavy-command queue or a VM harness.

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
  | Codex companion broker (the Codex plugin for Claude Code) | `app-server-broker.mjs serve` | `CODEX_COMPANION_SESSION_ID` in its environment | its `--cwd` |

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
`sessionId`. Those files are not a documented interface. When the folder is missing or unreadable,
liveness is reported as unknown, and unknown never counts as ended. When the folder is there, a
session without a file counts as not running: every session an editor started was seen to write one,
but a headless run has not been checked, so read the preview before stopping anything it lists.

## What is stopped, and when

| When | What is stopped | Scope |
| --- | --- | --- |
| `SessionEnd` hook (Claude Code only) | every helper whose environment names the ending session | any folder |
| `Stop` hook (each turn) | this session's helpers whose folder no longer exists | this session only |
| `processes --stop-helpers --yes`, on a person's word | helpers whose session is known to have ended, or whose folder is gone | machine-wide, or one `--session` |
| never | agent CLIs, virtual machines, containers, a live session's helper in an existing folder, a helper whose liveness is unknown | |

The hooks never stop another session's process: another session's leftovers are reported at session
start so the agent tells the user, and stopping them is the user's call. `--stop-helpers` without
`--yes` only previews.

Stopping re-reads each helper first and skips it unless the pid still runs the same helper for the
same session (a pid can be reused), then sends `SIGTERM` to the helper's tree and `SIGKILL` to what is
left after 1.5 seconds. To have the hooks list helpers instead of stopping them:

```bash
node scripts/setup-enforcement.mjs helpers report --yes   # or MWS_HELPERS=report for one process
```

## When the editor dies

A session whose editor dies does not end: no `SessionEnd` hook runs while its CLI is still alive, so
its helpers are not stopped then. On the night this was written six such CLIs kept running for about
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
  current user's processes only.
- The machine check at session start reports at most twelve items, and a process table that cannot be
  read within its time budget yields no report rather than a wrong one.
- A process started under a name the check does not know is not reported. Note what you start.
