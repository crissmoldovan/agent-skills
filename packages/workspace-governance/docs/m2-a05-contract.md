# M2/A05 catalog-edit contract

A05 ships one catalog mutation route. `config export --target catalog` emits a complete
`workspacectl-edit/1` draft with the current catalog revision. `config validate FILE` validates
that whole draft and writes nothing. `config plan FILE --config FILE --plan FILE` binds an inert
`catalog-edit` plan to the exact draft digest, selected config revision, catalog revision,
local-state revision, exact next catalog document, and a digest-covered changed-record preview.

`apply --config FILE --plan FILE --approve PLAN_ID` validates and re-derives the saved plan,
requires its exact ID, checks stable non-symlink paths and the catalog lock, performs one catalog
compare-and-swap write, and returns exact config/catalog/local-state readback. The active config
and local-state documents are not written. A stale revision, changed draft, tampered plan, wrong
selected config, absent/wrong approval, redirected path, or existing lock refuses without a
catalog write. Immediately before CAS, apply rechecks the final config/catalog/local-state
snapshots, selected-config binding, catalog target, draft digest, and approved next revision;
readback is performed after the catalog write.

The public `group create|update|reparent` and `repo membership|classify` commands call the same
catalog-change plan builder and save only an inert plan. `group list|show` and `repo list|show`
provide fresh readback. Group IDs and repository IDs are stable across label and ancestry changes.
Organizations are roots; areas and projects parent only to organizations or areas; cycles and
duplicate sibling slugs refuse. Repository membership is independent of GitHub source owner.
Additional `memberOf` entries are projects, cannot duplicate the primary project, and when a
primary placement exists must share its root business organization. A null primary may retain an
explicitly approved additional project membership.
Classification acceptance is explicit. Rejection retains the repository and remote identity as
an ordinary unclassified row.

All draft and plan operands are explicit absolute paths. A05 performs no checkout discovery,
read, move, adoption, creation, or content write as a consequence of logical catalog edits.
Policy/workflow editing and execution, host activation, and A06 repository lifecycle operations
are not shipped by this contract.
