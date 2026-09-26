# M6/A14 failure, resume, and exactly-once contract

## Failed gates and safe retry

A command attempt persists its actual exit, signal/error, bounded stdout/stderr, digests, exact executable/argv/cwd, and declared environment names. A nonmatching exit leaves the run and step `failed`; it never claims completion. `workflow resume` retries only a step declared `retry.mode:"safe"`, within `maxAttempts`. Before creating a fresh attempt it independently rechecks every completed reusable agent/output verification and records whether each bound file fingerprint changed. The fresh attempt has a new digest and needs a new exact approval. A `never` retry or exhausted limit remains blocked.

Completed command and external-effect outcomes are immutable. Status and repeated resume on a completed run perform no effect and do not rewrite those outcomes.

## Ambiguous interruption

`workflow interrupt` is the supported synthetic/host interruption seam. It accepts the exact current run/step/attempt/digest only after the command or `external.action` was approved, and persists the step as `ambiguous` with run status `interrupted`. It does not assert whether the effect happened and never automatically replays it.

Resolve ambiguity through the same bound `workflow submit` route with one or more absolute regular inspection-evidence files:

- `unknown` appends immutable evidence and stays blocked;
- `completed` records inspected completion as a claim; resume still performs the declared external readback before completion;
- `not-completed` records inspected absence and creates a new attempt with a new digest. The old approval cannot authorize it.

A command resolved as completed is still only a claim until resume independently executes every directly dependent declared `verify` check against the workspace. Command workflows without such a typed readback are invalid, and a missing or mismatched artifact leaves the claimed run blocked without journal mutation. External completion always requires its typed URL/ID/commit readback.

Every public resume acquires one path-safe per-run ownership lock before loading or checking the run and holds it through effect execution, journal save, and downstream readback. A concurrent contender returns `BUSY` before any effect. Existing, replaced, unreadable, unknown, or apparently stale locks are preserved rather than guessed away; there is no global lock daemon. The owner removes only the exact regular lock inode and nonce it created.

## Staleness and refusal

`workflow status` always returns inspectable saved state. It adds `validity` and explicit `blockers`; stale status exits 3. Changed run inputs, workflow/command definition, config/trust, applicable catalog or workspace policy, workspace identity, executable bytes, or absolute argv-file bytes invalidate the saved authority. Approve, submit, interrupt, and resume then refuse without changing the journal. Start a reviewed replacement run against the current definition; old approvals are never carried forward.

No private journal edit is a public recovery route. Public status, bound submit/approve/interrupt/resume, independent readback, and a new run are the supported controls.
