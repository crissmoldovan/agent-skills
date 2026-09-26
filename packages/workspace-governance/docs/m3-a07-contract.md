# M3/A07 inherited-rules contract

A07 extends schema-v2 catalog and local-state drafts with bounded typed policies and inert workflow
definitions. The existing `config export` → edit → `config validate` → `config plan` → exact
approved `apply` route supports `catalog`, `user`, and one explicitly named `workspace` target.
Apply still re-reads the draft, re-derives its semantic plan, checks revision/CAS and approval,
writes only the selected catalog or local-state document, and reads it back exactly.

## Resolution

`context REPOSITORY` and `explain REPOSITORY [FIELD]` are read-only. JSON resolution order is:
base, user, organization, outer-to-inner areas, explicitly selected legal project, repository,
selected workspace, invocation. A selected workflow contributes settings first at each scope;
ordinary settings at that same scope follow. Constraints accumulate. Hosting/source owner never
selects a business project. A project is legal only through confirmed primary placement or explicit
`memberOf` membership in the same business organization.

Plain dotted settings replace. `append`, `set-union`, `keyed-merge`, and `remove` are explicit
operations and use the retained v1 merge algebra, including type and dotted-prefix conflict checks.
Named instructions, knowledge references, skills, and workflow steps merge by stable ID. A lower
step replacement keeps position; a new step appends. Required removals, unknown removals,
mandatory conflicts, incompatible workflow I/O, missing dependencies, and cycles return
`POLICY_CONFLICT`. There is no override flag.

Workflow steps carry type, dependencies, configuration, side-effect class, approval requirement,
and bounded retry metadata for M6. A07 returns `executable:false`; it never runs configuration,
commands, URLs, or skills. A08 automatic loading/budgeting is not part of this slice.

## Provenance and external copies

Every setting operation, constraint, named record, and workflow step add/replacement/removal names
its scope and selected workflow. Carried rule sets preserve source repository, path, revision,
content SHA-256, and declared source scope. The carried policy is resolved at that declared scope;
ordinary carrying-repository policies remain repository overrides.

`--source FILE` is an explicit read-only comparison. It parses the bounded source JSON and compares
its canonical-JSON SHA-256 with both the declared digest and the canonical carried payload digest.
It reports `matching` only when all three agree, otherwise `drift`, and never corrects or writes the
source or catalog. Changed executable/reference payloads remain inert data for later trust review.

## Schema boundary

Draft-07 schemas express record shapes, limits, enums, and extra-field refusal. Runtime validation
additionally enforces property-key uniqueness, hierarchy and membership links, stable-ID uniqueness,
provenance/scope equality, required-removal safety, mandatory constraint compatibility, dotted-key
prefix/type rules, and final workflow graph validity. These cross-record invariants are deliberately
documented in schema comments because draft-07 cannot express them.
