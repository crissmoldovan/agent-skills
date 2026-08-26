# The mermaid contract

The classic output. It renders in forge comments, docs sites, chat surfaces, notebooks and
plain markdown previews, needs no toolchain, and survives being pasted somewhere nobody
anticipated. It is the primary artefact; the interactive file is the optional extra.

## `flowchart`, never `graph`

Mermaid accepts both keywords and they look interchangeable in small examples. They are not:
**only `flowchart` allows edges to and from subgraphs.** This diagram needs those edges — a
`deploys-before` constraint runs between whole surfaces, and a blindspot frequently attaches to
a surface rather than to a node inside it. Under `graph` those lines either do nothing useful or
break the parse, and the failure looks like a rendering problem rather than a syntax choice.

`LR` for direction. Surfaces read as columns of consequence left to right, and horizontal
layout keeps `path:line` labels legible instead of stacking them into a tower.

## Fixed ids, fixed order, always present

Twelve subgraphs, in the map's order, whether or not they contain anything. The id is the
surface id with hyphens replaced by underscores and prefixed `s_` — mermaid ids are safest
without hyphens, and a fixed scheme means two renders of the same repository diff cleanly.

| # | Surface id | Subgraph id |
|---|---|---|
| 1 | `callers` | `s_callers` |
| 2 | `data-contracts` | `s_data_contracts` |
| 3 | `jobs` | `s_jobs` |
| 4 | `ui` | `s_ui` |
| 5 | `tests-and-guards` | `s_tests_and_guards` |
| 6 | `config-and-toolchains` | `s_config_and_toolchains` |
| 7 | `deploy-ordering` | `s_deploy_ordering` |
| 8 | `docs-and-data-resident` | `s_docs_and_data_resident` |
| 9 | `external-consumers` | `s_external_consumers` |
| 10 | `second-order` | `s_second_order` |
| 11 | `reversibility` | `s_reversibility` |
| 12 | `work-in-flight` | `s_work_in_flight` |

Plus `s_legend`, last.

Node ids are the envelope's own `id` values, verbatim. Blindspot ids likewise. Never renumber:
the ids are how a reader moves between the picture, the envelope and the prose.

**An empty subgraph carries exactly one node stating its coverage** — `checked · empty` where a
negative with a fired control established it, `not checked` where nobody looked. An empty box is
read as "nothing here", which is a claim the map may not have made.

## Edges

Plain `-->`, every time. The relationship and the confidence ride in the label:

```
n1 -->|calls · enumerated| n4
n4 -->|derives · inferred| n9
s_deploy_ordering -->|deploys-before · measured| s_data_contracts
```

Dotted (`-.->`) and thick (`==>`) arrows are tempting for confidence, and they are the wrong
carrier: they render inconsistently across mermaid versions, they are the first thing lost when
generated output is minified, and they vanish entirely in a monochrome print. A label is text.
Text survives.

Edge `kind` comes from the map's closed set — `calls`, `reads`, `writes`, `derives`,
`registers`, `renders`, `deploys-before`. Confidence comes from the five fixed words. Both
appear, separated by a middle dot, in that order.

## Styling

`classDef` for the states, applied with `class`. Per-node `style` works identically and is fine
for a one-off, but the class form keeps the palette in one place where it can be checked.

```
classDef changed   fill:#fde68a,stroke:#b45309,stroke-width:3px,color:#1f2937
classDef affected  fill:#dbeafe,stroke:#1d4ed8,stroke-width:1px,color:#1f2937
classDef unknown   fill:#f3f4f6,stroke:#6b7280,stroke-width:1px,stroke-dasharray:4 3,color:#374151
classDef blindspot fill:#fee2e2,stroke:#b91c1c,stroke-width:2px,stroke-dasharray:6 3,color:#7f1d1d
classDef coverage  fill:#ffffff,stroke:#9ca3af,stroke-width:1px,color:#6b7280
```

State comes **from the envelope's `state` field**. It is never re-derived at render time: the
most-severe-wins reconciliation — `changed` over `affected` over `unknown` — already happened
when the map was built, and repeating it is how one node ends up in two colours.

**Break timing goes in the label, as a tag**, because fill and stroke are already carrying state
and a third visual channel is unreadable:

```
n7["recomputeTotals() · path:line · silent"]
```

`silent` is the tag that matters. It is the class the map exists to surface, and a reader
scanning the picture should be able to find every one of them without opening anything.

## Blind spots are nodes

One node per `blindspots` entry, inside the subgraph named by its `surface`, in the `blindspot`
class, labelled with what is unseen and — where it fits — the probe that would settle it. Long
probes go in the table that accompanies the diagram, keyed by the blindspot id.

A blindspot rendered as a caption under the picture is read as a disclaimer about the drawing. A
blindspot rendered as a node is read as part of the map, which is what it is. Nothing else in
this contract matters more than this paragraph.

## The legend

A `s_legend` subgraph, last, with one node per style in use: changed, affected, unknown, blind
spot, coverage. Plus one line naming the confidence vocabulary. A diagram travels; the person
who ends up reading it was not in the conversation where the colours were explained.

## The node cap

Renderers have input limits, and past them a large diagram fails as a **blank box** rather than
as an error message — which reads as a broken renderer, not as an oversized graph. Generated
mermaid is often minified by default for exactly this reason.

Take **around 120 nodes** as a working ceiling for a single diagram. That figure is **reasoned,
not measured**: it is awaiting benchmark measurement, so treat it as a starting point, measure it
against the renderer you are actually targeting, and adjust. What is not adjustable is the
behaviour at the ceiling:

- **Collapse within a surface.** Replace the tail of a surface's nodes with one count node that
  keeps the confidence of what it stands for: `+14 more callers · measured`. The count is exact.
- **Or split by surface**, one diagram each, with a fixed index listing all twelve so the
  missing ones are visibly deliberate.
- **Never truncate silently.** A shortened diagram with no marker is a map with a lie in it.
- **Never collapse a blindspot.** They are the smallest set on the page and the reason the page
  is trustworthy.

## The metadata line

Immediately under the fenced block, in prose: base and head revision, dirty state, `resolver`,
tools and versions, envelope fingerprint, `notScanned[]`, and whether collapsing happened and
where. The diagram will outlive the conversation that produced it.
