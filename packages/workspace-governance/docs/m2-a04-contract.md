# M2/A04 selected-source discovery contract

A04 extends the accepted M2/A03 setup, import, stores, and catalog readback. It adds
bounded read-only observation and one overview shared by four public commands. It
does not add/edit source or group records, accept classifications, select/adopt a
checkout, or perform a repository or host operation.

## Public commands

```text
workspacectl discover --config FILE [--source ID]... [--root PATH]... [--depth N] [--max-pages N] [--json]
workspacectl list [--config FILE] [--source ID]... [--root PATH]... [--depth N] [--max-pages N] [--json]
workspacectl report [--config FILE] [--source ID]... [--root PATH]... [--depth N] [--max-pages N] [--json]
workspacectl audit [--config FILE] [--source ID]... [--root PATH]... [--depth N] [--max-pages N] [--json]
```

`--source` and `--root` are repeatable transient selectors. `discover` requires an
explicit config and at least one selector. `--depth` is 0..32 (default 8) and needs a
root. `--max-pages` is 1..100 (default 100) and needs a source. Duplicate source IDs,
duplicate normalized roots, relative roots, unknown source IDs, duplicate scalar
flags, and unused depth/page controls refuse before observation.

Selector-free `list` remains the A03 persisted-catalog result. Selector-free
`report` and `audit` expose catalog-only overview rows whose checkout state is
unknown. Legacy report/audit remain selected by their required `--manifest` contract;
legacy `discover --root` remains available without `--config`.

A configured source supplies a validated GitHub owner, explicit owner type, include
and exclude selectors, and an optional proposed default group. No command derives an
owner/type or business assignment from a name. Each local root must be equal to or
contained by a configured trusted root. An absolute untrusted or unsafe target is
reported as unknown coverage without suppressing independent safe roots.

## GitHub coverage

Organization sources call:

```text
/orgs/OWNER/repos?per_page=100&page=N&type=all&sort=full_name&direction=asc
```

User sources call:

```text
/users/OWNER/repos?per_page=100&page=N&type=owner&sort=full_name&direction=asc
```

Pagination ends only on a valid page shorter than 100 entries. A full final permitted
page reports `partial`, `truncated:true`, and the unrequested `nextPage`. A failure,
denial, invalid response, or repeated response on page one reports `unknown`; the same
event after completed pages reports `partial` and retains completed-page records.
Only bounded codes, page, safe cause code, and HTTP status are returned; response body
and stderr text are omitted.

Every source coverage row includes source ID, owner/type, endpoint family,
`observedAt`, filters, credential-visible scope, private-visibility truth, requested
and completed pages, next page, bound/truncation, limitations/errors, and received,
selected, excluded, private, and archived counts. Organization completion describes
the active credentials' visible result; `absenceAuthoritative` is always false. The
user endpoint cannot expose private repositories and is therefore `partial` for
all-repository coverage even after a short page.

## Local coverage

Each selected root is observed independently with the retained bounded local Git
reader. It rejects symlink roots/ancestors, external Git metadata, unsafe commondir,
and executable clean/process filter configuration; uses fixed Git argv and a
sanitized environment; disables optional locks; and bounds traversal, output,
metadata text, and depth. It does not follow symlinks, widen to home, or write the Git
index/config/refs/worktree.

Per-root coverage has `complete`, `partial`, or `unknown` status, observation time,
structured target-specific errors, and repository/standalone/worktree/dirty counts.
A safe repository observation survives a sibling metadata/status failure. An invalid
or untrusted selected root is unknown rather than absent.

## Shared overview

`workspacectl-overview/1` contains:

```text
schemaVersion, format, readOnly, observedAt, revisions, selection,
coverage, groups, repositories, findings, summary
```

Canonical remote identity joins catalog, GitHub, and local observations. Registered
rows keep their stable catalog IDs; observed-only rows get deterministic observation
IDs and remain transient/unclassified. Approved primary group, persisted
`confirmed|suggested|unclassified`, additional memberships, and source-default
suggestions remain separate. Hosting ownership never approves a business grouping.

Checkout state is `present`, `duplicate`, `missing`, or `unknown`. More than one
standalone checkout is duplicate; intentional Git worktrees are listed separately and
do not create a standalone duplicate. `missing` requires at least one selected local
root and complete coverage for every selected root. No roots or any incomplete root
makes an unmatched checkout unknown. Each checkout shows path, standalone/worktree,
HEAD, dirty state, and remote availability. `checkout.selected` is always null in
A04. Archived/private flags are observations and trigger no lifecycle action.

For identical deterministic observations, selected `discover`, `list`, `report`, and
`audit` expose equal coverage, groups, repositories, findings, summary, selections,
and revisions; command/presentation and timestamps may differ. Text is the default;
`--json` emits the complete result.

Selected `partial` or `unknown` coverage is emitted on stdout with exit 3. `audit`
also exits 3 for decision findings. Complete `discover`, selected `list`, and
`report` exit 0 even when their findings need a later classification decision.
Errors retain the A03 JSON envelope and exit mapping.

All observation selections are transient. A04 writes no config, catalog, local state,
source, classification, primary checkout, Git state, credential, or host state. Group
and source edits belong to A05; primary selection and checkout adoption belong to A06.
