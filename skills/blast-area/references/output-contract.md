# The output contract

One envelope. It is the map's deliverable, and it is also `visualise-blast-area`'s input, so it
is built to be **decided on** first and rendered second. Everything a renderer needs is here;
nothing here exists because it renders well.

```json
{
  "meta": {
    "baseRevision": "sha",
    "headRevision": "sha or null",
    "dirty": false,
    "resolver": "language-server | index | registries | name-based",
    "collisions": 184,
    "toolsUsed": ["git grep", "language server", "database query"],
    "notScanned": ["the infrastructure repository", "the hosted flag store"]
  },
  "surfaces": [
    {
      "id": "callers",
      "label": "Callers",
      "confidence": "measured",
      "searched": [
        { "query": "verbatim", "tool": "git grep", "hits": 41, "consumers": 36, "discards": 5 }
      ],
      "negatives": [
        {
          "target": "what was looked for",
          "query": "verbatim",
          "tool": "git grep",
          "control": "the positive variant that was run",
          "control_fired": true,
          "verdict": "absent | inconclusive"
        }
      ],
      "discarded": [
        {
          "hit": "path:line",
          "queryText": "the SELECT as written",
          "resolvedTarget": "the table it actually names",
          "reason": "why it is not a hit on this change"
        }
      ]
    }
  ],
  "nodes": [
    {
      "id": "n1",
      "label": "human-readable",
      "path": "path:line",
      "surface": "callers",
      "state": "changed | affected | unknown",
      "break": "compile | runtime | silent | none",
      "note": "for a silent break: what is observed instead of an error"
    }
  ],
  "edges": [
    {
      "from": "n1",
      "to": "n2",
      "kind": "calls | reads | writes | derives | registers | renders | deploys-before",
      "confidence": "enumerated | measured | sampled | inferred | not checked",
      "evidence": "path:line @ sha, or the verbatim query that found it"
    }
  ],
  "blindspots": [
    {
      "id": "b1",
      "label": "human-readable",
      "surface": "docs-and-data-resident",
      "reason": "why this is outside the map",
      "probe": "what would settle it"
    }
  ]
}
```

## `meta`

- **`baseRevision` / `headRevision` / `dirty`** — the tree the map describes. A map drawn against
  uncommitted work describes a state nobody else has; say so rather than implying HEAD.
- **`resolver`** — how symbols were resolved, from the four values. This is the single most
  load-bearing field for a reader deciding how much to trust the caller surface.
- **`collisions`** — how many exported names in this repository are defined in more than one
  file, where you could measure it; `null` where you could not, which is itself reportable.
- **`toolsUsed`** — what actually ran. A renderer pins this into its own metadata.
- **`notScanned`** — every store, repository or surface deliberately or unavoidably left out.
  This is the machine-readable half of "what this map cannot see"; the prose section still gets
  written, because the four named limits are an argument, not a list.

## `surfaces`

**All twelve, in the fixed order, always present — including the empty ones.** The ids are fixed
so that renderers can lay out stable subgraphs and so that two maps diff cleanly:

`callers`, `data-contracts`, `jobs`, `ui`, `tests-and-guards`, `config-and-toolchains`,
`deploy-ordering`, `docs-and-data-resident`, `external-consumers`, `second-order`,
`reversibility`, `work-in-flight`.

- **`confidence`** — one word from the fixed vocabulary, describing the *coverage of this
  surface*, not the certainty of any single node.
- **`searched`** — the queries that produced the nodes, verbatim, with tool and hit count, and
  the hit count **split**: `consumers` kept plus `discards` recorded. Verbatim matters: a query
  paraphrased into prose cannot be re-run, and re-running it is the only way anybody checks this
  map. **The accounting identity holds per sweep: `hits = consumers + discards`.** A sweep that
  does not balance has lost a hit somewhere between the search and the map, and the surface is
  incomplete until it does — the map states the arithmetic rather than leaving it to be derived.
- **`negatives`** — the searched-empty results. Each carries its control and whether the control
  fired; a negative whose control did not fire has `verdict: "inconclusive"`, never `"absent"`.
  An empty `negatives` array on an empty surface means the surface was **not checked**, and the
  surface's `confidence` must say `not checked` to match.
- **`discarded`** — the hits that were returned and not kept. Each carries the `hit` as
  `path:line`, the `queryText` as written, the `resolvedTarget` it actually names, and the
  `reason` it is not a hit on this change. A discard is a decision, and a decision with no
  record is indistinguishable from a hit nobody opened. **Required wherever the surface makes an
  exclusivity claim** — "only X reads this" is a claim about exactly these rows, and it is the
  claim that authorises a drop. On the `data-contracts` surface the `resolvedTarget` is read out
  of the query text: a hit is classified by the table the query targets, never by the file's
  name or the module's domain. `discarded` is also the **other half of the accounting identity**:
  a hit that is in neither `nodes` nor `discarded` is invisible on its own, and becomes visible
  only as a number — `hits` exceeding `consumers + discards` by exactly the hits nobody bucketed.
  Each discard's `evidence` quotes the statement at the hit line itself; citing a different line
  in the same file leaves the discard unverified.

## `nodes`

- **`state`** — exactly one of `changed` (in the change set itself), `affected` (reached by an
  edge from something changed), `unknown` (reached, but whether it breaks could not be
  established). **One state per node**: where several paths reach the same node, the most severe
  wins — `changed` over `affected` over `unknown` — so a node never renders in two colours and
  never has to be reconciled at render time. `unknown` is a first-class outcome, not a failure to
  finish: a node nobody could resolve is information, provided it is labelled as one.
- **`break`** — the timing class, from `break-timing.md`. `none` is legitimate and useful: an
  affected-but-unbroken node is what makes the affected set trustworthy.
- **`note`** — required on every `silent` node, carrying what is observed **instead of** an
  error. That clause is what turns a silent break into something monitorable.
- **`path`** — `path:line` wherever one exists. A node with no path is either a datastore row, an
  external consumer, or a blindspot in disguise; check which.

## `edges`

**Every edge carries `confidence` and `evidence`. No exceptions.** An edge without evidence is a
guess with an arrowhead on it, and on a rendered diagram it is indistinguishable from a measured
one — which is precisely how an inference becomes a fact in somebody else's planning document.

`kind` comes from a closed set so that a renderer can style by relationship and a reader can
filter: `calls`, `reads`, `writes`, `derives`, `registers`, `renders`, `deploys-before`. Add a
kind only by extending the set deliberately; a free-text kind breaks both the styling and the
diff.

`deploys-before` edges are the ordering surface expressed as graph structure. Their evidence is
the constraint that forces the order — "old code selects the column at `path:line`" — not the
conclusion.

## `blindspots`

The parts of the map that are known to be missing. Each needs a **reason** (why it is outside)
and a **probe** (what would settle it). A blindspot without a probe is a shrug; with one, it is a
task somebody can pick up.

Blindspots are rendered **on** the diagram as visible elements, not as a caption — an
unverifiable criterion is a blind spot, not a failure, and it has to occupy space on the page or
it will be read as absence.

## Validity

An envelope is complete when: all twelve surfaces are present; every node has a state and a break
class; every `silent` node has its `note`; every edge has confidence and evidence; every empty
surface either has a negative with a control or a `not checked` confidence; **every sweep in
`searched` balances, `hits = consumers + discards`**; every exclusivity claim carries a non-empty
`discarded`; and `meta.notScanned` agrees with the prose "what this map cannot see". A renderer
may assume all of this, which is why the map must actually do it.
