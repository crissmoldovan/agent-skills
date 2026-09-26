# M2/A06 checkout lookup and registry contract

This private v0.3.0 candidate ships three bounded public routes:

```sh
workspacectl where REPOSITORY --config "$CONFIG" --json
workspacectl workspace select-primary --repo ID --workspace ID \
  --config "$CONFIG" --plan "$PLANS/primary.json" --json
workspacectl adopt --repo ID --path PATH \
  --config "$CONFIG" --plan "$PLANS/adopt.json" --json
workspacectl apply --config "$CONFIG" --plan FILE --approve PLAN_ID --json
```

`where` matches an exact stable repository ID first, otherwise a canonical GitHub
remote, otherwise a case-insensitive approved alias. An alias shared by several
repositories returns `AMBIGUOUS` with repository candidates sorted by stable ID.
The result lists every persisted checkout binding. Exactly one explicitly selected
primary is returned as `selectedWorkspace`; no selected primary returns null; more
than one refuses with sorted workspace candidates. A linked Git worktree remains a
`kind:"worktree"` alternative, not a standalone duplicate.

`workspace select-primary` saves a `workspace-primary` plan. It can select only a
persisted primary-kind binding belonging to the named repository. Apply requires
the exact plan ID, re-derives the selection from current catalog/local state,
checks config, catalog and local-state revisions, CAS-writes only local state, and
reads all three selected documents back. Worktree bindings remain unchanged.

`adopt` accepts one existing absolute checkout path inside a configured trusted
root. Preview verifies the catalog repository, canonical origin, Git metadata,
HEAD, branch, dirty status and standalone/worktree kind under the sanitized
read-only Git observer. Dirty checkouts are valid. The saved `adopt` plan records
a digest of status facts and one local-state CAS action. Apply requires exact
approval, repeats the observation and semantic derivation, checks current
revisions, writes one binding to local state, and reads it back.

The executable schemas enforce every A06 invariant that draft-07 can express. An
adopted `observation.remote` must already be the lowercase canonical HTTPS GitHub
form accepted by the runtime: a valid 1–39 character owner and a valid 1–100
character repository name, with no `.git` suffix, trailing slash, or trailing dot.
`uniqueItems` also rejects byte-for-byte duplicate workspace records.

Two cross-record invariants remain deliberately runtime-only because standard JSON
Schema draft-07 cannot compare sibling values or project object properties for
uniqueness: `observation.path == request.path`, and all `repositoryWorkspaces` have
unique IDs and paths. Runtime validation rejects a path mismatch and duplicate
repositoryWorkspace IDs or paths before planning or persistence. Schema `$comment`
entries identify both boundaries so schema acceptance is never represented as the
entire contract.

Neither route clones, fetches, checks out, cleans, stages, commits, changes Git
configuration, creates/removes a worktree, moves files, or selects a host Project.
Wrong approval, changed observation or revision, remote mismatch, an absent
repository, an outside/untrusted path, path symlink/redirection, duplicate binding,
or ambiguous lookup refuses without an active document or checkout write. The
ordinary same-user pathname-component rename race documented for the shared file
primitives remains outside this bounded slice.
