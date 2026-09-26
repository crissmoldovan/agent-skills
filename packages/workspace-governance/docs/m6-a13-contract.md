# M6/A13 inherited workflow execution contract

## Public surface

`workflow list/show` resolve the selected repository and workspace through the current catalog and local state. `show` validates the final merged graph and the bounded typed action configurations before advertising `executable:true`. `workflow run` requires every declared required input and persists a private `workspacectl-run/1` journal under the configured plans directory.

Run control is explicit:

- `workflow status --run ID` revalidates the current config, catalog, local state, resolved workflow, workspace binding, input fingerprint, executable, and absolute argv-file fingerprints.
- `workflow submit` binds the exact run, step, attempt, and request digest. It records a claim and evidence-reference digests; it never marks the step complete.
- `workflow approve` binds only the exact pending command or external effect.
- `workflow resume` independently reads required files or typed external JSON fields and only then completes the claimed step.

## Typed actions

Execution is serial and dependency ordered. The initial action registry contains:

- `context.resolve`: verifies the run's exact repository/workspace binding.
- `workspace.check`: verifies the registered path is the Git top level.
- `agent.task`: returns `waiting-for-agent` with `{runId,stepId,attemptId,requestDigest,kind,target,objective,expectedOutputs,verification}`.
- `command`: pauses for exact approval, then invokes one absolute executable with an argv array, exact workspace cwd, only declared environment names, bounded timeout, and expected exit. No shell or eval is used. Receipts retain environment names and output digests, not values.
- `verify`: performs bounded regular-file content, digest, or typed JSON-field readback below the exact workspace.
- `external.action`: pauses with the same bound handoff tuple, requires exact approval before submission, and completes only after declared `json-file` readback for an expected output containing at least one typed handle: an absolute HTTP(S) `url` without credentials, a bounded string `id` (`A-Z`, `a-z`, digits, `.`, `_`, `:`, `/`, or `-`), or a 7–64 hexadecimal `commit`. File-only checks, JSON fields without one of those handles, malformed handle values, and typed checks unrelated to any declared output make the workflow non-executable before a run is created. The package contains no publication/deployment API executor.

## Refusal and completion

Unknown actions, cycles, missing dependencies/inputs, malformed action contracts, stale attempts/digests, missing evidence, unapproved effects, symlinks, wrong output bytes, and changed workflow/policy/trust/executable inputs refuse. Rejected control calls leave the run journal unchanged. `waiting-for-agent` and `waiting-for-approval` are not completion. A run reaches `completed` only when every required step is independently completed.

The runner has no provider, model, shell, autonomous scheduler, remote publication, or deployment capability. A host agent or human performs an `agent.task` or `external.action` and submits the same evidence-bound public contract.
