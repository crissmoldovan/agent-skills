# M5/A11 ordinary checkout contract

## Public flow

`checkout --repo ID --path ABSENT_PATH [--ref branch:NAME|tag:NAME|commit:SHA] --plan FILE`
resolves one catalog identity and remote ref, then saves an inert `checkout` plan. Omitted
`--ref` binds the advertised remote default branch. The plan fixes the canonical remote,
commit, branch/tag/commit attachment, destination, exclusive sibling staging path, config,
catalog and local-state revisions, operation ID, actions, expected binding, and approval ID.
Preview does not clone.

`apply --plan FILE --approve PLAN_ID` revalidates all bound inputs. It uses ordinary Git
HTTPS/SSH credential mechanisms, clones without submodule recursion to the exact absent sibling
staging path, disables hooks for checkout, attaches branches, detaches tags/commits, verifies
origin/HEAD/attachment/files, and refuses unresolved Git LFS pointers. It never installs LFS,
dependencies, or other prerequisites and never runs repository setup scripts. After verification,
it renames staging to the still-absent destination, CAS-registers the primary workspace, reads
back both sides, and completes the operation journal. Credentials and Git environment values are
never serialized.

## Journal and reconciliation

Operation entries are private JSON under `PLANS/operations/` and conform to
`schemas/v2/operation.schema.json`. `operation show ID` loads that exact entry and re-inspects
only its recorded destination, staging path, Git identity/ref, and binding. Partial staging,
published-but-unbound destinations, and interrupted running state report `needs-attention` and
exit 3. No show path mutates or deletes anything.

`operation reconcile ID --plan FILE` refuses partial/ambiguous effects. It emits an inert
`checkout-reconcile` plan only when the exact destination already proves the recorded canonical
origin, commit, attachment, and absent binding, with no partial staging path. Applying the
separately approved current repair performs only the local-state CAS and journal outcome update,
then reads back the binding. It cannot clone, rename, delete, overwrite, change branches, or
invent approval.

## Refusal and nonmutation

Existing/symlink/unsafe destinations, duplicate repository bindings, wrong identity, changed
refs, stale/tampered plans, wrong approval, authentication failure, unavailable LFS content, and
catalog/state conflicts refuse. Staging or destination data that may be an interrupted effect is
preserved. Catalog bytes, unrelated local-state records, unrelated files, user credentials, Git
configuration, submodules, hooks, and repository scripts remain untouched.
