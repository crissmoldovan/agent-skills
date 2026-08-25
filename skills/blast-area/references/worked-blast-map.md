# A worked blast map

One change set, mapped end to end, with the parts that usually get skipped left in: the premise
that did not survive, the negative that decided the outcome, the silent breaks, and the blindspot
that was still there when the map was delivered.

The repository is a monorepo of roughly 2,500 TypeScript files across four build pipelines, with
a relational database, a background job runner and a dashboard. Names below are generic.

## The brief, as received

> "Drop the `sync_state` column from `documents`. It's dead — the dashboard stopped showing it
> months ago, nothing writes it any more, and the only reader is the stale-record job which we
> are deleting in the same change."

Three checkable premises: (a) nothing writes it, (b) the only reader is one job, (c) the
dashboard no longer shows it.

## Step 1 — restate, and refute what does not hold

Change set, written as things and operations:

| Thing | Operation |
|---|---|
| `documents.sync_state` (column) | drop |
| the stale-record job | delete |
| the job's registry entry | delete |

Findings against the premises, after the searching:

- **(a) "nothing writes it" — refuted, with a number.** Two writers: the import path writes it on
  every insert (`import/persist.ts:118`), and a repair script sets it in bulk
  (`ops/repair-sync.ts:44`). The import writer is live; the script last ran in the interval
  covered by the history search.
- **(b) "the only reader is the stale-record job" — refuted, with a number.** Four readers: the
  job, a string-built analytics query, a database view, and a report column derived from the
  view. Three of the four are invisible to the typechecker.
- **(c) "the dashboard no longer shows it" — holds.** No component references the field; the
  search that established this fired its control.

Two of three premises fail. The map continues on the surviving one rather than refusing the
brief; the refutation itself is the most consequential line in the deliverable, because it
changes the change.

## Step 2 — the twelve surfaces

| Surface | Nodes | Break | Confidence |
|---|---|---|---|
| `callers` | `import/persist.ts:118` (writer), `jobs/stale-records.ts:31` (reader) | `compile` — both are typed field accesses | `measured` |
| `data-contracts` | the column; view `v_document_health`; derived report column `health_score` | `runtime` for the view, **`silent`** for `health_score` | `measured` |
| `jobs` | the stale-record job; its registry entry | `silent` if the registry entry is removed without the job, or the reverse | `enumerated` (the runtime reads this registry) |
| `ui` | none | `none` | `measured` — control fired |
| `tests-and-guards` | 3 tests referencing the field; 1 schema-drift guard keyed on the column list | tests `compile`; **the guard `silent`** | `measured` |
| `config-and-toolchains` | 4 build pipelines process the touched files; 1 generates types from the schema | `compile` in the generator, `none` elsewhere | `enumerated` (manifests counted) |
| `deploy-ordering` | code-first, two steps | `runtime` inside the window | `measured` |
| `docs-and-data-resident` | 1 saved analytics query row naming the column | **`silent`** | `measured` — the store was queried |
| `external-consumers` | none found; warehouse sync does not select it | `none` | `measured` — control fired |
| `second-order` | `health_score` consumers: 1 report, 1 alert threshold | **`silent`** — the alert stops firing | `measured` |
| `reversibility` | column drop is **irreversible** for the data; job deletion is revertible | — | `enumerated` |
| `work-in-flight` | 1 open pull request renames the same job key; 1 written, unapplied migration touches the same table | **`compile`** for the rename collision at merge; **`silent`** for the two migrations, which claim the same version | `enumerated` (forge queried, applied history read) |

### The three silent breaks

1. **`health_score`.** The view keeps returning rows; the derived score keeps computing, now
   against a missing input absorbed by a `COALESCE`. Nothing throws. The score simply drifts, and
   it drives an alert threshold two hops downstream. *Observed instead of an error:* the alert
   stops firing.
2. **The schema-drift guard.** Its pattern names the column list. With the column gone, the
   pattern matches nothing and the guard passes — permanently, in green, protecting nothing.
   Mutating a fixture confirmed the guard currently fires; it will not after the change.
3. **The saved analytics query row.** A row in a table, not a file. No code search would have
   returned it. The query fails at execution time inside a scheduled report, which retries and
   then goes quiet.

## Step 3 — the negative that decided the outcome

The external-consumers surface was the one everybody expected to be the problem, and it was
empty. That emptiness is only worth anything because it is recorded as a finding:

```json
{
  "target": "warehouse sync selecting documents.sync_state",
  "query": "git grep -n \"sync_state\" -- warehouse/",
  "tool": "git grep",
  "hits": 0,
  "control": "git grep -n \"documents\" -- warehouse/ → 27 hits",
  "control_fired": true,
  "verdict": "absent"
}
```

The first attempt at this search used `git grep -E '\bsync_state\b'` and returned nothing — as it
always would, because POSIX ERE has no `\b`. Without the control, the map would have recorded an
absence that was a property of the regular expression, on the one surface where being wrong meant
breaking somebody else's system.

The literal search on the data-contract surface returned nine hits and kept four, so the map
carries the five it dropped — each opened, each classified by the table its query names rather
than by the module it sits in:

```text
discarded | reports/health.ts:44   | SELECT ... FROM document_health_daily | document_health_daily | rollup table, not the base table
discarded | export/csv.ts:19       | SELECT ... FROM exports              | exports               | different table, shared column name
discarded | jobs/backfill.ts:71    | comment naming sync_state            | —                     | comment, not a query
discarded | test/fixtures/doc.ts:6 | fixture literal                      | —                     | fixture, not a read
discarded | api/status.ts:33       | SELECT ... FROM documents            | documents             | selects the row, never the column
```

The last row is the one that matters: it is a query against the changed table, kept out on what
it selects rather than on where it lives. The map's claim is "two readers, both in the ingest
path" — which is an exclusivity claim, and the five rows above are its evidence.

## Step 4 — deploy ordering, with its reason

**Code-first, two steps.** The schema half would break readers that are live right now: the import
path writes the column on every insert, so dropping it first fails in the window rather than at
deploy time.

1. Deploy the code that stops writing and reading it — import path, job, view, saved query row,
   guard pattern.
2. Drain: in-flight imports, the job's current run, and any warm instance of the previous
   deployment. Then drop the column.

Window contents: new code against the old schema, which is safe — the column simply goes unused.
The reverse window is not.

## Step 5 — what this map cannot see

- **Dynamic dispatch.** Two registries were found and read: the job registry (which the runtime
  itself reads — `enumerated`) and the generated type registry. Anything dispatched through a
  string assembled at runtime is outside this map, and one code path assembles a query name from
  configuration.
- **Data-resident references.** The application database **was** queried, for saved queries,
  report definitions and flag rules; one hit, listed above. The hosted feature-flag service was
  **not** reachable from this run — that is the blindspot below.
- **Resolution basis.** Name-based, with a language server available for TypeScript only. The
  measured collision count for this repository is 184 exported names defined in more than one
  file. The two SQL-embedded readers were found by literal search, not by resolution.
- **Runtime-only edges.** The alert threshold lives in a monitoring system outside the repository;
  its dependency on `health_score` was established from a dashboard definition, not from code.

**Precision ceiling.** No compiler-resolved symbol index exists here. `derive-codebase-context`
argues that such an index is the only thing that answers blast radius correctly in a repository
with duplicate exported names, and that it costs about a week — so it is deferred deliberately.
This map reports at the ceiling it has: name-based resolution, four surfaces at `measured` rather
than `enumerated`.

**Blindspot carried into the deliverable:**

```json
{
  "id": "b1",
  "label": "hosted feature-flag rules naming sync_state",
  "surface": "docs-and-data-resident",
  "reason": "the flag service was not reachable from this run; no credentials in this context",
  "probe": "export the flag rule set and grep it for the column name"
}
```

## What the map changed

The brief asked for a column drop and a job deletion. The map returned a two-step deploy, three
silent breaks with what each one would look like instead of an error, one guard that needed
re-arming, one datastore row that no code search would have found, an irreversibility on the data
half, one open pull request renaming the same job key — and a refutation of two of the brief's
three premises, with counts. The change that got made was not the change that was asked for,
which is the point.
