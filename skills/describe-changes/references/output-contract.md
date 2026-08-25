# Describe changes — output contract

One envelope, two shapes. The envelope is JSON; every human-readable field inside
it is markdown. A consumer that wants plain text renders the markdown; a consumer
that wants markdown passes it through. There is no third format.

## The change object

```json
{
  "kind": "feature",
  "title": "Per-user watermark on the release popup",
  "short_md": "The what's-new popup now shows only entries published since you last dismissed it",
  "medium_md": "Opening the app after time away shows the changes that landed while you were gone, rather than the same list every time. Dismissing it records where you got to, and the list is capped at the last thirty days so a long absence does not produce hundreds of items.",
  "detail_md": "## What changed\n\nThe popup query is now filtered by a per-user watermark ...",
  "refs": [
    {
      "path": "src/server/release/query.ts",
      "range": "41-78",
      "sha": "9f2c1ab",
      "note": "watermark floor via greatest(watermark, now - window)"
    }
  ],
  "relations": {
    "ticket": "PROJ-412",
    "request": null,
    "reporter": "octocat"
  }
}
```

### Field rules

| Field | Type | Rules |
|---|---|---|
| `kind` | string | Exactly one of `feature`, `bug_fix`, `improvement`, `security`, `ops`, `docs`, `breaking`. Never null, never a list. |
| `title` | string | Under 80 characters. Sentence case. Names the change, not the mechanism. Not the branch name. |
| `short_md` | string | At most 140 characters. Inline code is the only markup allowed. No leading bullet, no trailing period required. |
| `medium_md` | string | One paragraph. No file paths, no function or symbol names. Written for the person who uses the product. May be null only when no diff was available. |
| `detail_md` | string | A markdown page. Headings, lists, and fenced fragments allowed. Every behavioural claim adjacent to a reference. May be null when no diff was available. |
| `refs` | array | Zero or more reference objects. Empty is valid and honest; fabricated is not. |
| `relations` | object | Always present, always with all three keys. A key is a citable identifier or `null`. |

### The reference object

```json
{ "path": "src/server/release/query.ts", "range": "41-78", "sha": "9f2c1ab", "note": "…" }
```

- **`path`** — repository-relative, using forward slashes. Required.
- **`range`** — post-change line numbers, `start-end`, or a single number.
  Optional; omit rather than guess.
- **`sha`** — the commit the range is valid at. Strongly recommended: without it
  the range stops resolving after the next merge.
- **`note`** — at most one clause saying what is at that location. Optional.

A reference to a deleted file uses the pre-change path and the pre-change range,
with a `note` saying it was removed.

## Shape A — single digest

Used when the operation is one coherent change.

```json
{
  "shape": "single",
  "operation": { "type": "pull_request", "id": "1482", "repository": "acme/widgets" },
  "change": { "…the change object…" }
}
```

## Shape B — itemized

Used when the operation contains several independent changes: a release range, a
pull request that does two things, a batch merge.

```json
{
  "shape": "itemized",
  "operation": { "type": "range", "id": "v2.3.0..v2.4.0", "repository": "acme/widgets" },
  "summary": {
    "title": "Release 2.4.0",
    "short_md": "Nine changes: three fixes, four improvements, one new export format, one breaking API change",
    "medium_md": "This release adds CSV export, changes how filters persist between sessions, and removes the deprecated v1 report endpoint. Existing v1 callers must move to v2 before the next release."
  },
  "items": [ { "…change object…" }, { "…change object…" } ]
}
```

Rules for the itemized shape:

- **`summary` has no `kind`.** A collection is not one kind. If the summary needs
  to signal danger, it says so in `short_md`, and the breaking item carries the
  `breaking` kind.
- **`summary` has no `refs`.** Its evidence is its items.
- **`items` are ordered by significance**, not by commit order: breaking first,
  then security, then everything else by size of user-visible effect.
- **An item is a change, not a commit.** Three commits that build one feature are
  one item. One commit that fixes two unrelated bugs is two items.

## Asking for the shape

Ask once, before writing, and accept a default only when the caller set one:

```text
This covers 9 merged pull requests across two subsystems. Do you want one digest
for the whole range, or an itemized array of changes with a summary on top?
```

Choose itemized without asking only when the operation is a range spanning more
than one change and the caller gave no instruction — and say that you did.

## Degraded output

When the diff is unavailable — no clone, no API access, a payload without file
data — the contract still holds, with these exact substitutions:

- `detail_md` is `null`.
- `refs` is `[]`.
- `medium_md` may be written from the pull request body, and `detail_md` staying
  null is the signal that it was.
- The description must not assert anything the body does not state.

Do not emit a `detail_md` that says "see the diff". A null is information; a
placeholder is noise.

## Worked example: a revert

```json
{
  "shape": "single",
  "operation": { "type": "commit", "id": "4d1e7c0", "repository": "acme/widgets" },
  "change": {
    "kind": "bug_fix",
    "title": "Revert the connection-pool size increase",
    "short_md": "Reverts the pool-size change from #1471, which exhausted database connections under load",
    "medium_md": "A change to how many database connections the service keeps open has been rolled back after it caused errors during busy periods. Behaviour returns to what it was before that change.",
    "detail_md": "## What changed\n\nThis reverts commit `a91b3f2` (#1471), restoring the pool size to its previous value.\n\n- `src/db/pool.ts:22` — `maxConnections` returns to 10 from 40.\n\n## Why\n\nThe increased pool exhausted the database's own connection limit when three service instances were running, producing connection errors under load. The revert is a restoration, not a fix for the underlying capacity question, which is unaddressed.",
    "refs": [
      { "path": "src/db/pool.ts", "range": "22", "sha": "4d1e7c0", "note": "maxConnections back to 10" }
    ],
    "relations": { "ticket": null, "request": null, "reporter": null }
  }
}
```

Note what this example does: it names what is reverted, it does not describe the
reverted change as if it were still in effect, and it says explicitly that the
underlying problem remains open. The `relations` are all null because nothing in
the commit cited a ticket — that is the correct output, not a gap to fill.

## Validation

A consumer should reject an envelope that:

- carries a `kind` outside the seven;
- has a `short_md` over 140 characters;
- has a non-null `detail_md` with an empty `refs` array;
- has a `relations` object missing any of the three keys;
- has a reference with a `range` but no `path`.

Each of these corresponds to a specific failure the contract exists to catch,
and the last two catch the two that are silent otherwise.
