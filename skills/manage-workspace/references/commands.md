# Guard, cleanup, memory and process commands

Run the bundled helper from the installed skill directory with Node.js 22 or newer. Set
`PROJECT` to the project directory. Set `SCRATCH_ROOT` to a dedicated, existing directory
you own outside the project on the volume receiving bulk writes. Give it permissions
that disallow group or other writes. The helper keeps one active or unretired run per
scratch root. Set `REQUIRED_FREE_MIB` to the measured or estimated peak plus any project reserve.

```bash
node scripts/workspace-storage.mjs guard --project "$PROJECT" \
  --volume "$SCRATCH_ROOT" --min-free-mib "$REQUIRED_FREE_MIB"
node scripts/workspace-storage.mjs start --project "$PROJECT" \
  --scratch-root "$SCRATCH_ROOT" --min-free-mib "$REQUIRED_FREE_MIB"
```

`guard` is read-only. It fails with exit status 1 if available bytes are below the supplied
minimum or .context exceeds the first limit reached. The defaults are 128 MiB of
regular-file logical size and 10,000 directory entries. Use `--context-max-mib` or
`--context-max-entries` to supply the project's own budget. A successful check prints
byte counts and the inspected paths as JSON. `--volume` defaults to the project path.
Guard checks the given volume at the time of the call. Invoke it separately for other
volumes that receive writes. A periodic check or preflight is only active where a caller
actually runs it.

`start` runs the same guard and creates a private run directory containing a `work`
directory and an ownership record. It prints `run` and `work` as JSON. Set `RUN` to the
reported run path and direct disposable output into `work`. Keep durable evidence outside
the run. For dependency caches, Git worktrees, and other state with a manager, use the
manager's own configuration and removal commands.

```bash
node scripts/workspace-storage.mjs cleanup --project "$PROJECT" --run "$RUN"
```

The preview prints the run path, logical bytes, and entry count. Cleanup accepts only a
run the helper created for this project. It refuses symlinked roots, mismatched ownership
records, mounts, and nested Git metadata. It does not follow symlinks during removal.

Once the original writer and dependent jobs are terminal and all required evidence reads
back, apply the previewed removal within the authorized scope. `--closed` records the
caller's confirmation. The helper has no access to the run's process or evidence system.

```bash
node scripts/workspace-storage.mjs cleanup --project "$PROJECT" --run "$RUN" --apply --closed
```

The result verifies the path is absent and prints available bytes before and after.
If deletion fails partway through, inspect the same run again. Retire any remaining
Git checkout through Git and resolve the reported issue before retrying. Keep the
same project and run identity. Run paths are unique. If an abrupt exit leaves an empty
reservation directory or an incomplete run without an ownership record, first verify no
helper or job still owns it. Inspect the residue and remove only the confirmed empty
reservation or explicitly reviewed residue. The helper does not sweep old scratch roots or
remove unmarked files from a shared directory.

The onboarding metadata marks this skill as request-only for project recommendations.
The installed skill remains discoverable by its description.

## Memory and processes

```bash
node scripts/leftovers.mjs memory --need-mib "$JOB_MIB"   # exit 0: start; 1: do not; 2: usage
node scripts/leftovers.mjs processes                      # what agents left running, read-only
node scripts/leftovers.mjs processes --stop-helpers       # preview; add --yes, on the user's word
```

Set `JOB_MIB` to the job's peak memory: a virtual machine's configured memory, or a build's measured
peak. `memory` counts swap as well as the free percentage, so call it before a heavy command or a VM
start, and put it in front of a heavy-command queue or a VM harness as its preflight. `--min-free-pct`
and `--max-swap-mib` change the floor (20%) and the swap limit (a quarter of RAM). What `processes`
finds, what may be stopped and the limits are in [the process and memory guide](processes.md).

The enforcement hooks, their `note`, `keep` and `done` commands, and the setup script's preview,
install and uninstall are described in [the enforcement guide](enforcement.md).
