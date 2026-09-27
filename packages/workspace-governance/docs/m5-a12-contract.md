# M5/A12 isolated-worktree contract

## Public surface

- `worktree list --repo ID` is read-only. It invokes `git worktree list --porcelain` from the
  selected registered primary and marks each observed entry as owned only when its exact path is
  bound to that catalog repository in current local state.
- `worktree create` writes only an inert plan. It requires an exact 40/64-hex base commit already
  present in the selected primary, a new valid local branch, an absent safe destination below a
  trusted root, and no path/branch/binding collision.
- `worktree remove` writes only an inert plan for one exact persisted worktree ID and requires the
  explicit `--confirm-inactive` assertion. It does not accept an arbitrary path.
- `apply --approve PLAN_ID` is the only mutating route. Preview stores a separate canonical
  authority record under the configured plans directory. Apply resolves that record from the
  selected current config, rejects missing or byte-semantically different saved plans, then
  re-derives the complete plan from the authoritative request plus current catalog/local state
  and Git facts before writing any journal or performing any Git, filesystem, or state effect.

## Creation invariants

The selected catalog identity, primary binding and canonical origin must agree. The destination
must be disjoint from the primary path; symlink or replaced path components refuse. Preview
requires the branch and destination to be absent. Apply repeats those checks and executes:

```text
git -c core.hooksPath=/dev/null worktree add -b BRANCH PATH BASE_COMMIT
```

There is no checkout of the primary and no primary index or work-file write. Before local-state
CAS, apply verifies target HEAD, attached branch and common Git metadata. After CAS it lists the
worktrees again and verifies the exact persisted binding. A post-effect state failure is recorded
as `needs-attention`; the product does not guess at destructive rollback.

## Removal invariants

Preview and apply require all of the following:

- exact owned persisted `kind:"worktree"` binding, repository identity and canonical origin;
- the same common Git metadata as the registered primary;
- the exact registered path and attached branch in fresh porcelain worktree output;
- no Git lock/prunable marker, persisted host link, or observed Linux process cwd in the tree;
- no untracked, staged, modified, deleted, assume-unchanged, skip-worktree or sparse-missing data;
- HEAD reachable from at least one current `git ls-remote --refs origin` tip; and
- current config, catalog, local-state, plan semantics and explicit inactivity assertion.

Removal uses only `git worktree remove PATH`, without `--force`. It then proves the path is absent,
the local branch still exists, the binding was CAS-removed, and fresh list readback no longer
contains the path. It never deletes branches and never invokes `git worktree prune`.

## Refusal and nonmutation

Wrong/missing approval, edited or stale plans, unsafe paths, branch/path collisions, ambiguous
primaries, dirty or unpushed work, active/locked trees, foreign paths and identity mismatches
refuse before the Git effect. List and failed previews do not write plans, active documents,
repository bytes or Git metadata. Mutation tests use only isolated synthetic repositories.
