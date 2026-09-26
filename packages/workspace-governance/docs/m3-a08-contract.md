# M3/A08 bounded relevant-context contract

`workspacectl context REPOSITORY` and `explain` reuse the A07 resolver. The JSON `context` contains the selected organization/project, exact repository/workspace, revisions, effective settings and complete A07 provenance, instructions, references, inactive command definitions, inert selected workflow, warnings, and an explicit display budget. Object ordering and arrays are deterministic for unchanged inputs.

## Selection and nonmixing

Only base/user, the selected repository's organization/area/project ancestry, that repository, the selected workspace, and the selected workflow participate. Unrelated organizations and repositories are never swept. The public `resolveProjectContexts` helper resolves one shared project context through the same A07 resolver plus independently resolved, repository-specific contexts; local records do not cross between them. Shared resolution clones the catalog and chooses the first deterministic internal repository ID absent from the complete user repository registry, so colliding `$shared-PROJECT`-style user IDs neither fail resolution nor select their repository policies, and caller-owned catalog bytes and requested repository IDs remain unchanged.

## References and trust

References stay linked by default. `--load knowledge:ID` and `--load skill:ID` select individual records. Relative paths resolve from the declaring external source document when provenance supplies `sourcePath`, otherwise from the catalog document. Every target and ancestor is checked for symlinks and its real path must be below one configured trusted root. The loader records device, inode, type, and canonical path for that root and every traversed directory before opening the leaf, then revalidates the complete chain and the leaf descriptor after the bounded read. Files are opened through a descriptor with `O_NOFOLLOW` where supported. On platforms that reject that flag, the portable fallback still applies complete-chain and leaf identity checks before and after descriptor reading; any drift refuses the result. URLs are never fetched.

A selected reference loads only when `--approve-content CATEGORY:ID=sha256:DIGEST` exactly matches its current bytes. Changed content returns `UNTRUSTED_INPUT` with current and approved revisions; approvals naming no resolved command/reference are invalid. Repository-provided external provenance requires exact approval regardless of the resolved scope. Commands, URLs, skills, workflow steps, and loaded references remain `active:false`; workflows remain `executable:false`. Natural-language instructions report `status:"loaded"`, never enforced. Resolution does not write host files or activate anything.

Every textual target is shape- and UTF-8-validated even while linked. Missing required targets return `INCOMPLETE`; escaped, symlinked, malformed, oversized, raced, or untrusted required targets refuse with bounded details. Invalid optional targets remain inactive and add a warning.

## Budget

The default display budget is a deterministic 16,000 UTF-8 bytes, documented as the 4,000-token equivalent at four bytes per token. `usedBytes` is the larger of the complete canonical JSON context and the exact default text rendering, so labels, settings, commands, workflow, provenance, trust/status fields, references, warnings, and serialization overhead all count. Required output that cannot fit returns `INCOMPLETE` with `reason:"oversized-context"`, bounded offending IDs/count, required bytes, and the limit. Optional selected material is removed from inline content first, remains linked, and adds an explicit warning.

The executable output schema is `schemas/v2/resolved-context.schema.json`. Context resolution is read-only: it does not execute commands, access URLs, install skills, execute workflows, alter catalog/local-state/reference bytes, or overwrite `AGENTS.md`, `.hermes.md`, `CLAUDE.md`, or host state.
