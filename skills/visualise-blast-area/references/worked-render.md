# A worked render

One envelope taken end to end. The change is a column drop — the `status` column on a `jobs`
table, with the value moving to a derived view. Names are illustrative; the shape is the point.

## The envelope, trimmed

Fields not needed to draw are elided. Nothing that *is* needed has been added.

```json
{
  "meta": {
    "baseRevision": "3f9c1ab", "headRevision": null, "dirty": false,
    "resolver": "name-based", "collisions": 184,
    "toolsUsed": ["git grep", "watskeburt 1.x"],
    "notScanned": ["the prompt-template store", "repositories outside this checkout"]
  },
  "surfaces": [
    { "id": "callers", "label": "Callers", "confidence": "measured" },
    { "id": "ui", "label": "UI", "confidence": "measured",
      "negatives": [{ "target": "any screen rendering the field", "query": "rg -n \"status\" app/",
                      "tool": "ripgrep", "control": "rg -n \"jobId\" app/", "control_fired": true,
                      "verdict": "absent" }] },
    { "id": "docs-and-data-resident", "label": "Docs, prompts, data-resident",
      "confidence": "not checked" }
  ],
  "nodes": [
    { "id": "n1", "label": "jobs.status column", "path": "schema/jobs.sql:12",
      "surface": "data-contracts", "state": "changed", "break": "none" },
    { "id": "n4", "label": "summary query (string-built)", "path": "reports/summary.ts:88",
      "surface": "data-contracts", "state": "affected", "break": "silent",
      "note": "returns rows with the field undefined; the report renders zero" }
  ],
  "edges": [
    { "from": "n4", "to": "n1", "kind": "reads", "confidence": "measured",
      "evidence": "rg -n \"SELECT .*status\" reports/ -> 1 hit @ 3f9c1ab" }
  ],
  "blindspots": [
    { "id": "b1", "label": "prompt and saved-query rows naming the field",
      "surface": "docs-and-data-resident",
      "reason": "no datastore was reachable from this run",
      "probe": "query the template table for rows containing the field name" }
  ]
}
```

## The diagram

```mermaid
flowchart LR
  subgraph s_callers["1 · Callers — measured"]
    n3["listJobs() · api/jobs.ts:41 · compile"]
    n5["+14 more callers · measured"]
  end
  subgraph s_data_contracts["2 · Data contracts and derivers — measured"]
    n1["jobs.status column · schema/jobs.sql:12"]
    n2["JobRow type · types/jobs.ts:8 · compile"]
    n4["summary query, string-built · reports/summary.ts:88 · silent"]
  end
  subgraph s_jobs["3 · Jobs and registries — enumerated"]
    n6["retry-failed-jobs worker · workers/retry.ts:12 · runtime"]
  end
  subgraph s_ui["4 · UI — measured"]
    c1["checked · empty — no screen renders the field"]
  end
  subgraph s_tests_and_guards["5 · Tests and guards — measured"]
    n9["guard no-raw-status · ci/guards/status.mjs:4 · silent"]
  end
  subgraph s_config_and_toolchains["6 · Config and toolchains — measured"]
    n10["two bundlers process reports/ · build/ · none"]
  end
  subgraph s_deploy_ordering["7 · Deploy ordering — enumerated"]
    n11["code half — stops selecting the field"]
    n12["schema half — drop the column"]
  end
  subgraph s_docs_and_data_resident["8 · Docs, prompts, data-resident — not checked"]
    b1["BLIND SPOT · prompt and saved-query rows · probe: query the template table"]
  end
  subgraph s_external_consumers["9 · External consumers — sampled"]
    n13["warehouse job reading the field · unknown"]
    b2["BLIND SPOT · repositories outside this checkout · probe: org-wide code search"]
  end
  subgraph s_second_order["10 · Second-order readers — inferred"]
    n14["daily completion-rate metric · silent"]
  end
  subgraph s_reversibility["11 · Reversibility — measured"]
    n15["revert restores the column, not the rows written in the window"]
  end
  subgraph s_work_in_flight["12 · Work in flight — enumerated"]
    n16["open PR renaming the same worker · workers/retry.ts · compile"]
    n17["written, unapplied migration on the same table · migrations/ · silent"]
  end
  subgraph s_legend["Legend"]
    L1["changed"]
    L2["affected"]
    L3["unknown"]
    L4["blind spot"]
    L5["confidence: enumerated · measured · sampled · inferred · not checked"]
  end

  n3 -->|calls · measured| n2
  n2 -->|reads · enumerated| n1
  n4 -->|reads · measured| n1
  n6 -->|reads · measured| n1
  n9 -->|reads · measured| n1
  n13 -->|reads · inferred| n1
  n14 -->|derives · inferred| n4
  n11 -->|deploys-before · measured| n12
  s_callers -->|deploys-before · measured| n12

  classDef changed   fill:#fde68a,stroke:#b45309,stroke-width:3px,color:#1f2937
  classDef affected  fill:#dbeafe,stroke:#1d4ed8,stroke-width:1px,color:#1f2937
  classDef unknown   fill:#f3f4f6,stroke:#6b7280,stroke-width:1px,stroke-dasharray:4 3,color:#374151
  classDef blindspot fill:#fee2e2,stroke:#b91c1c,stroke-width:2px,stroke-dasharray:6 3,color:#7f1d1d
  classDef coverage  fill:#ffffff,stroke:#9ca3af,stroke-width:1px,color:#6b7280

  class n1,n11,n12 changed
  class n2,n3,n4,n5,n6,n9,n10,n14,n15,n16,n17 affected
  class n13 unknown
  class b1,b2 blindspot
  class c1,L5 coverage
```

## What to notice in it

- **All twelve surfaces are there**, in order, with their coverage word in the subgraph title.
  Surface 4 is empty and says which kind of empty it is: checked, with a control that fired.
  Surface 8 is empty of nodes and says `not checked`, and carries the blind spot that explains
  why.
- **Surface 12 is the one no checkout could have shown.** An open pull request renames the same
  worker and a written-but-unapplied migration touches the same table; neither exists in the
  tree the rest of the map was drawn against, and both meet this change in one tree later.
- **The two blind spots are nodes**, inside their own surfaces, each with its probe in the
  label. Neither is a caption. They are the first thing a reader's eye lands on, which is
  correct: they are the reason the rest of the picture is trustworthy.
- **`silent` is a label tag, not a colour.** Three nodes carry it — the string-built query, the
  guard that will pass forever once its pattern matches nothing, and the derived metric. Those
  three are the entire reason the map was drawn; a reader can find them by scanning.
- **One edge runs from a subgraph to a node.** `s_callers -->|deploys-before| n12` says every
  caller must stop reading before the column is dropped. That edge is why the diagram is a
  `flowchart` and not a `graph` — the older keyword cannot attach an edge to a subgraph.
- **One node has no edges at all.** `n10` records that two bundlers process the same directory;
  that is a property of a file, not a relationship between two nodes. Edgeless nodes are
  legitimate and the layout must keep them.
- **Evidence is not on the edge label.** Labels carry kind and confidence; the `evidence`
  string lives in the envelope and, in the interactive artefact, in the panel that opens when an
  edge is selected. Putting a `path:line @ sha` on every arrow makes the diagram unreadable and
  drops it below the node cap for the wrong reason.
- **Node states came from the envelope.** `n13` is `unknown` because nobody could establish
  whether the warehouse job breaks — it is not `affected` with a shrug attached.

## The metadata line

Directly under the diagram, in prose, every time:

> Rendered from the blast-area envelope `sha256:…` at base `3f9c1ab`, clean tree, no head
> revision. Resolver: **name-based**; 184 exported names in this repository are defined in more
> than one file, which is this map's precision ceiling. Tools: `git grep`, `watskeburt 1.x`; no
> module-graph tool was installed or present, so module-level import edges are **not checked**.
> Not scanned: the prompt-template store, repositories outside this checkout. Collapsed: 14
> caller nodes into one count node on surface 1. No comparison run.

## The blind-spot table

| id | Surface | What is unseen | Probe that would settle it |
|---|---|---|---|
| b1 | docs-and-data-resident | Prompt and saved-query rows naming the field | Query the template table for rows containing the field name |
| b2 | external-consumers | Repositories outside this checkout | Org-wide code search for the field name |

Two rows, and they are the part of this artefact most likely to be acted on. Both name a probe,
so each is a task someone can pick up rather than a shrug someone has to live with.
