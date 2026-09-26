# M6/A15 contract — coordinated two-repository workflow

A coordination workflow is selected with `workflow show|run --coordination ID --workflow ID`.
The selected binding must be a persisted project-scoped `CoordinationWorkspace` with exactly two
members. Before a run file is created, the CLI reopens the coordination directory and verifies the
binding revision, generated files, exact ordered `memberWorkspaceIds`, selected repository/workspace
pairs, checkout paths, and canonical remotes. Missing, duplicate, swapped, foreign, ambiguous, or
stale members refuse without starting a task or command.

The executable graph begins with one `coordination.check`. Every `context.resolve`,
`workspace.check`, `agent.task`, `command`, `verify`, and `external.action` in a coordination graph
names an exact member `repositoryId` and `workspaceId`. Agent and command handoffs include that
member's verified path, shared project context, and only its repository context. Repository-local
instructions from the other member are never included. Commands use the named member path as cwd;
output checks resolve below that same path. Both members require context steps, and normal workflow
output validation still requires independently checkable declared outputs before completion.

`rules.distribute` is read-only. Its reviewed definition binds an absolute trusted regular source
file, source repository identity, source revision, source content digest, every selected member,
and for each carrying copy an exact relative path plus repository-local review target. Execution
re-reads the source and each carrying copy. A drifted carrier emits exactly one
`rule-set.proposal` with source provenance/revision/digest, carrying-copy current digest,
repository/workspace/path, proposed digest, review target, and a digest over the complete proposal.
The receipt states `merged:false` and `applied:false`. A selected member with no copy emits an
explicit `not-carrying` row and no proposal. The package never rewrites a carrying file or invokes
a remote review, merge, or apply route.

Saved coordination runs bind all member checkout fingerprints, the coordination revision, resolved
workflow, catalog/local-state revisions, executable bytes, inputs, and frozen isolated contexts.
Status, approval, submission, and resume reject stale selection or identity. The existing per-run
lock, attempt tuple, approval, interruption, safe-retry, and independent-readback semantics remain
unchanged.
