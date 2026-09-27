# M7/A16 guarded checkout move contract

## Public flow

`move WORKSPACE --to ABSENT_PATH --confirm-inactive --plan FILE` accepts only one
registered primary standalone checkout. Preview verifies a clean complete checkout,
canonical catalog remote, HEAD/branch, ordinary `.git` directory, no submodule,
no observed process cwd, no other listed Git worktree, no linked-worktree registration
in the main checkout's shared Git metadata, a symlink-free absent destination, and
matching filesystem device. It binds stable repository/workspace IDs,
source/destination, Git identity, config/catalog/local-state revisions, filesystem
observations, semantic digest, and exact approval. Preview writes only the plan.

`apply --plan FILE --approve PLAN_ID` freshly re-derives the authoritative plan and
repeats every preflight before any move. It performs exactly one filesystem rename,
then CAS-updates the existing binding's path without replacing its workspace or
repository ID. Completion requires independent readback of source absence,
destination Git identity/cleanliness, and exact registry lookup. It never copies,
deletes, checks out, fetches, changes Git configuration, or changes logical groups.

## Refusal and nonmutation

Absent inactivity confirmation, wrong approval, edited/stale plan, dirty content,
observed active cwd, destination collision, nested source/destination, linked worktree,
submodule, symlink/path redirection, wrong remote/HEAD/branch, incomplete state, and
cross-filesystem destination refuse before rename. A main checkout that owns any
linked, locked, stale/prunable, malformed, symlinked, or unreadable worktree
registration also refuses; an empty registration directory is allowed. Preview and
apply inspect both Git's worktree listing and the shared metadata directory, and apply
repeats the guard so a worktree attached after preview invalidates the approved
plan without renaming either path. Neither route runs prune, repair, remove, or any other
worktree mutation. Unsupported cases have no copy or force fallback. Logical
catalog/group edits remain the independent catalog-plan route and never invoke move.

## Journal and exact repair

A move operation records source, destination, stable identities, exact pre-move Git
identity, plan digest, status, and outcome outside the checkout. `operation show ID`
re-inspects both paths and the current binding without writing.

If rename succeeds but binding CAS fails, show reports source absent, exact clean
checkout at destination, and binding still at source as `needs-attention`. Only that
unambiguous state permits `operation reconcile ID --plan FILE`. The resulting
`checkout-move-reconcile` plan contains one local-state CAS action. Applying its exact
approval revalidates the operation and destination, updates only the existing binding,
and reads back the same checkout. Dirty/replaced/ambiguous paths, both/neither paths,
or a binding elsewhere refuse. Repair never moves again, deletes, copies, broadly
rolls back, or edits a journal privately.
