# Guard and cleanup commands

Run the bundled helper from the installed skill directory with Node.js 22 or newer. Set
`PROJECT` to the project directory. Set `SCRATCH_ROOT` to a dedicated, existing directory
you own outside the project on the volume receiving bulk writes. Give it permissions
that disallow group or other writes. The helper keeps one active or unretired run per
scratch root. Set `REQUIRED_FREE_MIB` to the measured or estimated peak plus any project reserve.

```bash
node scripts/workspace-storage.mjs guard --project "$PROJECT" \
  --volume "$SCRATCH_ROOT" --min-free-mib "$REQUIRED_FREE_MIB"
node scripts/workspace-storage.mjs start --project "$PROJECT" \
  --scratch-root "$SCRATCH_ROOT" --min-free-mib "$REQUIRED_FREE_MIB" \
  --purpose "Tauri packaged verification"
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
directory and an ownership record with its creation date and supplied purpose. It prints
`run` and `work` as JSON. Set `RUN` to the
reported run path and direct disposable output into `work`. Keep durable evidence outside
the run. For dependency caches, Git worktrees, and other state with a manager, use the
manager's own configuration and removal commands.

Reuse the same project-owned scratch root for successive runs so `start` can detect an
unretired attempt. For fixed output paths, run the named cleanup step during closeout after
verifying process and fixture closure. If a later check needs one build ID, executable, or
export, record that exact path and its consumer, and review the surrounding generated files
as a separate cleanup scope. Use any already approved run-specific cleanup scope.

For a shared directory of historical or mixed artifacts, pass the project checkouts
you already know about. Supply `--owner-project` once per additional project.

```bash
node scripts/workspace-storage.mjs inventory --project "$PROJECT" \
  --artifact-root "$ARTIFACT_ROOT" --owner-project "$OTHER_PROJECT"
```

The read-only report sorts top-level folders by allocated bytes and records matches
from Git worktree registrations and valid managed run markers. A folder may have evidence
for several projects. Empty `ownerEvidence` means ownership needs review. Git read
failures appear in `worktreeReadErrors`. Use exact receipts to resolve historical ownership
and active dependencies. APFS clones can share blocks, so use the totals to prioritize review.

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

## Check known consumers before retiring legacy paths

Check inbound links from the project's known checkouts and dependency directories before
approving a legacy cleanup. Include ignored dependency entries. Resolve each symlink target
and compare whether it falls inside the proposed removal path. An unexplained inbound link
keeps the candidate on hold until its consumer is retired or deliberately repointed and
verified. Bound the search to known consumers. Report any directories you could not check.

To check the procedure, use two disposable worktrees. Put an ignored dependency symlink in
one that points into a generated directory in the other. Both Git statuses can be clean.
The review should find the link and keep its target on hold. The bundled cleanup preview
checks its own run directory, so do this consumer check separately when reviewing legacy
paths or outputs shared across checkouts.

## Check worktrees managed by a desktop app

When a candidate appears in both Git and an app's workspace registry, inspect the saved
attachment and its session before planning removal. Confirm whether archiving keeps the
session and which operation removes the checkout. With the run closed and removal
authorized, use that operation. Read back both registries. The checkout and its active
registration should be gone, and any retained session should still be reachable as the
app documents.

Onboarding recommends this skill when a project has Cargo, Tauri or browser-test
configuration, or its agent instructions refer to the skill.
