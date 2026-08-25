# The smart HTML contract

Optional. Produce it when the map is big enough to explore rather than read, and when the
audience will open a browser. The mermaid diagram is still the primary artefact; this is the
one people dig into.

## The four absolutes

1. **One file.** Not a directory, not an index plus assets. One `.html` that can be attached to
   a message, dropped in a ticket, or committed as a single artefact.
2. **No external requests.** No CDN script, no remote font, no stylesheet fetch, no analytics,
   no image pulled from a host. Open it from a disk with the network switched off and it must
   look and behave identically. The test is not hypothetical: artefacts get read on planes,
   behind corporate proxies, and two years later when the CDN path has moved.
3. **No build step.** No bundler, no transpile, no package install. Plain HTML, plain CSS, plain
   script in the page. Anything requiring a toolchain is a dependency on the reader's machine.
4. **No runtime fetch of the data.** The envelope is *in* the file. A page that loads its data
   from anywhere is a page that will one day render an empty graph and no error.

## One literal, unedited

The whole payload is a single generated literal, and its name is fixed so that a reader
searching the file finds it immediately:

```js
const BLAST = {
  meta:       { /* … */ },
  surfaces:   [ /* eleven, fixed order, including empty */ ],
  nodes:      [ /* one state and one break each */ ],
  edges:      [ /* confidence and evidence on every one */ ],
  blindspots: [ /* reason and probe on every one */ ]
};
```

It is the blast-area envelope, **unedited**. Not reshaped for convenience, not pruned of fields
the interface does not use, not re-keyed. Everything the page displays is derived from `BLAST`
at load time. The moment the generator edits the envelope on the way in, the picture and the
decision surface can disagree, and nothing in the file will reveal that they have.

If a derived structure is needed for rendering — an adjacency index, a per-surface bucket —
compute it in the page from `BLAST`, at load. Never ship it alongside as a second source of
truth.

## What `meta` must pin

Provenance is not a footer. It is displayed in the interface, in a panel a reader can open
without viewing source:

- **`tool` and its version**, plus the version of whatever generated this page.
- **`baseRevision`, `headRevision`, `dirty`** — the tree the map describes.
- **`resolver`** — how symbols were resolved, carried through from the map verbatim.
- **`fingerprint`** — a hash of the envelope. Two pages claiming to show the same map either
  match here or one of them is stale.
- **`toolsUsed`** — what actually ran, with versions.
- **`notScanned[]`** — every store, repository, language or surface left out. This is the
  machine-readable half of "what this map cannot see", and in the interface it belongs beside
  the graph, not below it.

## Affordances

Enough to explore, and no more. Every one of these is derivable from `BLAST` alone:

- **Expand and collapse a surface.** Eleven surfaces open at once is a wall. Collapsed by
  default with counts on the header is readable; a surface that is empty shows its coverage word
  in the header rather than a zero.
- **Filter by state** — changed, affected, unknown.
- **Filter by break timing** — compile, runtime, silent, none. The `silent` filter is the one
  people will use, because it isolates the class that a typechecker and a CI run both miss.
- **Filter by confidence**, from the five fixed words.
- **Follow an edge to its evidence.** Selecting an edge shows its `kind`, its `confidence` and
  its `evidence` string — the `path:line @ sha` or the verbatim query that established it. This
  is the single affordance that most changes how the artefact is used: it turns "the diagram
  says so" into "here is the line".
- **Select a node** to see its path, state, break class and its `note` — required on every
  `silent` node, and the field that says what is observed *instead of* an error.

## Styling from the fixed vocabulary

State drives the node's primary colour. Break timing rides as a tag on the label, exactly as in
the mermaid contract, so the two artefacts read the same way. Confidence styles the **edge** —
weight, or a dash pattern, plus the word itself in the edge's detail panel. Five words, never a
sixth, and never a percentage: nobody computed one, and a number on a page is read as a
measurement forever.

## Blind spots are a panel that cannot be filtered away

They appear in the graph, in their surface, styled as their own class — and they also get a
permanent panel listing every one with its `reason` and its `probe`. Filters do not hide them.
A filter that can empty the blind-spot list turns the artefact into a machine for producing
false confidence with two clicks.

## Skeleton

```html
<!doctype html>
<meta charset="utf-8">
<title>Blast area — &lt;change name&gt;</title>
<style>
  /* everything inline; system font stack only; no @import, no remote font */
</style>
<body>
  <header id="meta"></header>
  <nav id="filters"></nav>
  <main id="graph"></main>
  <aside id="detail"></aside>
  <section id="blindspots"></section>
<script>
const BLAST = { /* generated literal — the envelope, unedited */ };

// index, render and wire — all from BLAST, all at load, nothing fetched.
</script>
</body>
```

Layout engine: whatever can be written in the page without a dependency. A deterministic
column-per-surface layout with straight edges is enough and diffs better than a force-directed
one, which produces a different picture every time it is opened and makes two runs
incomparable.

## Verification for this artefact

- Opens from disk with the network disabled and looks identical.
- Contains exactly one `const BLAST` literal, matching the envelope field for field.
- `meta` is visible in the interface, including `notScanned[]`.
- Every edge's detail shows both its confidence and its evidence.
- No filter combination can empty the blind-spot panel.
- No `http://` or `https://` request is issued at load. Grep the file for `src=` and `href=`
  pointing off-file, and for `fetch(`.
