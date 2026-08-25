---
name: visualise-blast-area
description: "Render a change's blast map as diagrams — mermaid first, optionally one self-contained interactive HTML — with changed-vs-affected styling and blind spots stated on the diagram itself. Use when a blast-area map needs to be seen, shared, or dug into."
license: MIT
compatibility: "Consumes the blast-area output envelope — meta, surfaces, nodes, edges, blindspots — and emits mermaid that renders wherever mermaid already renders: a forge comment, a docs site, a chat surface, a notebook. Graph tooling is used only when it is already installed and is never installed by this skill; dependency-cruiser and watskeburt raise precision on JavaScript and TypeScript trees, and Graphviz is not assumed to be present. The optional interactive output is a single HTML file with no build step and no external requests, so it opens from disk in any modern browser. Nothing in the repository is changed and nothing is committed unless a run record is asked for."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Write Grep Glob Bash
---

# Visualise a blast area

A blast map is a decision surface written down. Drawing it is not decoration: a set of
surfaces, states and edges that reads as a table of facts reads as a shape the moment it is
laid out, and the shape is what a reviewer actually argues with.

The risk of drawing it is that a diagram looks finished. Whatever the map could not see
disappears when it becomes a picture, because absence has no glyph. An inferred edge and a
compiler-resolved one arrive at the reader as the same arrow. A node reached by three paths
picks up three colours and gets reconciled in someone's head, differently each time.

So this skill renders under a contract: **blind spots occupy space on the page**, changed and
affected are visually distinct, every edge carries the confidence it was born with, and the
layout is fixed so that two renders of the same repository can be put side by side.

It draws. It does not decide — `blast-area` produced the envelope and this skill does not get
a vote in what went into it.

## What a rendered map must not lose

- **The blind spots.** A map's most valuable section is what it could not see, and that
  section is exactly the one a diagram silently drops. Rendered as a caption underneath, it is
  read as a disclaimer. Rendered as nodes inside the surface they belong to, it is read as
  part of the map — which it is. An unverifiable criterion is a blind spot, not a failure.
- **The difference between changed and affected.** A diagram that paints both the same colour
  answers a different question than the one that was asked. The changed set is what someone is
  about to do; the affected set is what happens to them for it.
- **One state per node.** Where several paths reach the same node, the most severe already won
  upstream — `changed` over `affected` over `unknown`. A renderer that re-derives state gets a
  node in two colours and a reader who has to reconcile it.
- **Confidence.** An `inferred` edge drawn identically to an `enumerated` one launders a guess
  into a fact, and the fact travels. Confidence must survive the render, in the label or in the
  styling, from the same five fixed words the map used: `enumerated`, `measured`, `sampled`,
  `inferred`, `not checked`. Never a percentage.
- **Empty surfaces.** A surface that was checked and found empty is a finding. A surface that
  was never checked is a hole. Both are invisible if the renderer drops empty subgraphs, so it
  does not drop them.

Composition: **`blast-area`** owns the map and the envelope this skill consumes.
**`investigate-codebase`** owns the searching underneath it. **`land-complex-change`** turns
the same envelope into a touch-set budget rather than a picture. **`derive-codebase-context`**
builds the durable, compiler-resolved index that raises the precision of everything upstream
of here. Install the companions with `npx skills add crissmoldovan/agent-skills`.

## When to Use

- A blast map exists and has to be reviewed by people who will not read a JSON envelope.
- A pull request needs a picture of what the change reaches, inline, in a comment.
- A schema or interface change spans surfaces and the interesting part is the shape: which
  surfaces are dense, which are empty, where the graph crosses a boundary.
- Someone needs to explore the map rather than read it — expand a surface, filter to silent
  breaks, follow an edge to its evidence.
- A refactor claims "no behaviour change" and the claim needs testing against the map's own
  delta.
- A removal or deprecation needs a before-and-after that shows what stopped being reachable.
- The blind spots keep getting lost between the map and the meeting.

Do not use it to produce the map — `blast-area` does that, and a map assembled to render well
is shaped by the wrong constraint. Do not use it to answer a question about the code; that is
`investigate-codebase`. Do not use it to draw a picture of a change that already landed —
`describe-changes` reads the diff and anchors claims to hunks. Do not use it to plan or
contain the work: `land-complex-change` converts the envelope into a budget and a gate ladder.
Do not use it as a review of a diff — `request-blocks-review` and `blocks` own that loop. And
do not use it to build a durable architecture diagram that lives in the repository and is
regenerated in CI; that is `derive-codebase-context`, and its artifacts outlive one change.

## Prerequisites

1. **A validated blast-area envelope.** Not a file list, not prose — the envelope, with
   `meta`, `surfaces`, `nodes`, `edges`, `blindspots`.
   **Complete when:** all twelve surface ids are present including the empty ones; every node
   has exactly one `state` and a `break`; every edge has both `confidence` and `evidence`;
   every blindspot has a `reason` and a `probe`.
2. **The audience and the surface it will be read on.** A forge comment, a docs page, a chat
   message and a browser tab have different limits, and the answer decides whether the
   interactive file is worth generating at all.
   **Complete when:** the target surface is named, and whether mermaid alone suffices is
   decided rather than assumed.
3. **Tool attendance declared — never installed.** Record which of the optional tools are
   already present, with versions, and what each absence costs.
   **Complete when:** each tool is recorded present-with-version or absent, and the degradation
   for every absent one is written down for the render's metadata line.
4. **A node budget.** Count the nodes in the envelope against the working cap before laying
   anything out; a diagram that exceeds the renderer's input limit fails as a blank box, not as
   an error message.
   **Complete when:** the node count is counted, and either it is under the cap or a collapse
   rule is chosen and recorded.
5. **Comparison mode decided.** Off unless it was asked for and its preconditions hold.
   **Complete when:** comparison is off, or two envelopes are named with the same resolver and
   the same surface ids, and both base and head revisions are recorded.

## Procedure

1. **Validate the envelope before drawing a single node.** A renderer inherits every silence in
   its input and then makes it invisible. Check the validity conditions from the map's own
   contract: twelve surfaces present; one state and one break per node; a `note` on every
   `silent` node; confidence and evidence on every edge; every empty surface carrying either a
   negative with a fired control or a `not checked` confidence; `meta.notScanned` non-empty or
   explicitly empty. Where the envelope fails, **say so and render the failure** — an empty
   surface with no negatives is drawn as `not checked`, never as clean. Never invent a node,
   an edge or a state to make the picture connected.

2. **Take stock of the tools that are already here. Install nothing.** Tiering, and what each
   absence costs, is in [tool tiering](references/tool-tiering.md).

   - **Tier 1, use if present.** `dependency-cruiser` can emit a mermaid graph of the modules
     reachable from a change — roughly `depcruise --affected <base-revision> --output-type
     mermaid` — and `--highlight` takes a regular expression, which is how the **changed** set
     is separated from the merely **affected** set. `watskeburt` is the rename-aware
     changed-since-a-revision lister that can produce exactly that expression, and it is
     usable standalone when dependency-cruiser is not installed. Confirm flag spellings against
     the installed version's own `--help`; both tools are JavaScript and TypeScript only, so on
     any other language they contribute nothing and must not be presented as coverage.
   - **Graphviz `dot` is not assumed.** Do not emit a `.dot` file as the deliverable on the
     hope that something downstream renders it. If `dot` happens to be present and someone
     wants a raster, that is a bonus artefact, never the primary one.
   - **Tier 2 is the envelope alone**, and it is the normal case. The mermaid is built by hand
     from `nodes` and `edges`. Nothing about the contract below changes; what changes is that
     module-level edges the tools would have enumerated are absent, and the render's metadata
     line says so in the same words the map used: `not checked`.

3. **Emit the classic diagram first: mermaid `flowchart LR`.** Always `flowchart`, never
   `graph` — only `flowchart` permits edges to and from subgraphs, and this diagram needs them
   for deploy-ordering edges and for blindspots that attach to a whole surface. `LR` because
   surfaces are read as columns of consequence, left to right, and long labels stay legible.
   The full template, id scheme and legend are in
   [the mermaid contract](references/mermaid-contract.md).

   - **Fixed-order surface subgraphs with fixed ids, present even when empty.** The order is
     the map's order: `callers`, `data-contracts`, `jobs`, `ui`, `tests-and-guards`,
     `config-and-toolchains`, `deploy-ordering`, `docs-and-data-resident`,
     `external-consumers`, `second-order`, `reversibility`, `work-in-flight`. The subgraph id
     is the surface id with hyphens as underscores and an `s_` prefix, so two renders diff
     cleanly and a reader who has seen one of these diagrams can find a surface without
     reading the labels.
   - **An empty subgraph gets one node stating its coverage** — `checked · empty` or
     `not checked` — because an empty box with nothing in it is read as "nothing here", which
     is a claim the map may not have made.
   - **Plain `-->` edges.** The kind and the confidence go in the edge label
     (`-->|calls · measured|`). Dotted and thick arrow variants render inconsistently across
     mermaid versions and are the first thing lost to minification; a label survives.

4. **Style changed against affected, and let `unknown` look unknown.** One `classDef` per state
   plus one per break timing, applied from the envelope's own values — never re-derived at
   render time, because the deepest-touch-wins reconciliation already happened upstream and
   doing it twice invites two answers. `changed` reads as the strongest; `affected` as
   secondary; `unknown` as visibly unresolved rather than as absent. Break timing rides along:
   `silent` must be distinguishable at a glance from `compile`, since the whole reason the map
   exists is that those two cost different orders of magnitude.

5. **Put the blind spots on the diagram.** Every entry in `blindspots` becomes a node inside
   the subgraph of its `surface`, styled as its own class, labelled with what is unseen and
   carrying its `probe` — in the label if it is short, in the accompanying table if it is not.
   Plus one legend node stating what the styles mean. **Not a caption, not a footnote**: a
   caption is read as a disclaimer about the diagram, and a node is read as part of the map.
   A blindspot without a probe should not have left `blast-area`; if one arrives anyway, render
   it and say the probe is missing.

6. **Respect the node cap. Collapse, never truncate.** Large graphs hit renderer input limits
   and fail as a blank box rather than as an error, and tool-generated mermaid is often
   minified by default precisely to stay under those limits. Take **around 120 nodes** as the
   working ceiling for one diagram: that number is **reasoned, not measured** — it is being
   pinned by benchmark measurement, so measure it against your own renderer and adjust rather
   than trusting it. Over the cap, collapse **within a surface** into a count node
   (`+14 more callers · measured`) that keeps the confidence of what it stands for, or split
   into one diagram per surface with a fixed index. Never drop nodes silently, and never drop
   a blindspot to make room.

7. **Optionally emit the interactive file: one HTML file, one literal.** Only when the audience
   will open a browser and the map is big enough to explore. The rules are absolute and the
   full skeleton is in [the smart HTML contract](references/smart-html.md).

   - **One file. No build step. No external requests** — no CDN, no font fetch, no telemetry,
     no fetch of the envelope at runtime. It must render identically opened from a disk with
     the network off.
   - **The data arrives as a single generated literal**, `const BLAST = { meta, surfaces,
     nodes, edges, blindspots }` — the envelope, unedited, so the page and the map cannot
     disagree. Everything the page shows is derived from `BLAST` at load.
   - **`meta` pins provenance**: the tool and its version, the renderer version, `baseRevision`,
     `headRevision`, a fingerprint of the envelope, and `notScanned[]` shown in the interface
     rather than buried in the source.
   - **Affordances**: expand and collapse a surface, filter by state, break timing and
     confidence, and follow an edge to the evidence string that justifies it. Confidence is
     styled from the same five words. Blindspots are a first-class panel that cannot be
     filtered away.

8. **Comparison mode: only when asked, only when the preconditions hold, and the delta is a
   classification.** Default off. Preconditions: two envelopes of the same change shape, same
   `resolver`, same surface ids, both revisions recorded. The output is **not a second graph** —
   two graphs side by side are compared by eye and by eye is where differences hide. It is a
   per-surface classification: **added**, **removed**, **rewired** (same endpoints, different
   kind, confidence or evidence). Worked cases are in
   [comparison mode](references/comparison-mode.md). It earns its keep in two situations: a
   refactor whose claim is "no behaviour change", where **a non-empty delta is the finding**;
   and a removal or deprecation, where the question is precisely what stopped being reachable.

9. **Caption the render with what it is not.** Every artefact carries a metadata line or panel:
   base and head revision, dirty state, `resolver`, tools used with versions, the envelope
   fingerprint, `notScanned[]`, and whether collapsing happened and where. A diagram that
   travels without this is quoted a week later as though it were complete.

10. **Hand both artefacts back with where they render.** Mermaid goes wherever mermaid already
    renders, and the fenced block is the deliverable — not a screenshot of it. The HTML file is
    handed back by path with the statement that it needs no server. If comparison mode ran, the
    classification table travels with them, not instead of them.

11. **Document the run when the branch calls for it.** The convention is below, and it is
    identical in every skill of this family that supports it.

### The run record

**Documenting the run.** Write a full record when the invocation carries `--document` (or
an unmistakable phrase such as "document the run"), at `docs/visualise-blast-area/<UTC-date>-<slug>.md`
in the host repository — and always when the run is unattended, in which case it goes to the
harness scratch directory, never the repository, and its path is named in the final answer;
if you cannot confirm a human will see and answer a question in THIS run, treat it as
unattended. Attended with no token: stay silent, offering once only if the run ends with an
unresolved contradiction or an open blocking question. Five headings, in order: What was
searched / Who searched it / What each found / How it reconciled / What was decided and why,
closing with what this run could not see. No secret values, machine-absolute paths, child
transcripts or raw logs; no unmarked inference or unearned benefit claims; never edit an
earlier record, and never let writing one change the answer.

Records are written per [the run-record convention](references/documenting-the-run.md).

## Usage Examples

```text
Here is the blast map for the column drop. Draw it — mermaid, one diagram, all twelve surfaces
including the empty ones — and put the blind spots on the diagram itself rather than in a note
underneath. I am pasting this into a pull request comment.
```

```text
Render this map and make the changed set obvious against the merely affected set. I care most
about which of the affected things break silently, so make that visible at a glance rather than
something I have to read the labels for.
```

```text
This map has about three hundred nodes. Give me something I can actually explore — a single
HTML file I can open from disk with the network off, where I can filter to the silent breaks
and click an edge to see the evidence behind it.
```

```text
We refactored the ingest path and the claim is no behaviour change. Map it before and after and
compare them — but give me the delta as a list of what was added, removed and rewired per
surface, not two pictures to squint at.
```

```text
Draw this one and document the run (--document), because the diagram is going into the design
review and I want the provenance next to it: which tools were available, which surfaces were
never checked, and what the picture is not showing.
```

## Pitfalls

- **Blind spots rendered as a caption.** Underneath the picture they read as a disclaimer about
  the drawing. Inside it, as nodes, they read as part of the map — which is what they are.
- **Dropping empty subgraphs to tidy the layout.** Checked-and-empty is a finding and
  never-checked is a hole; deleting the box makes both look like the same nothing.
- **Colouring changed and affected the same.** The diagram then answers "what is involved",
  which nobody asked, instead of "what is about to happen and to whom".
- **Re-deriving node state at render time.** The most-severe-wins reconciliation happened
  upstream. Doing it again produces a second answer, and the two diagrams disagree.
- **Arrows without confidence.** An inferred edge and an enumerated one are the same
  arrowhead, and the reader has no way to tell. Put the confidence in the label.
- **Using `graph` instead of `flowchart`.** It looks equivalent until an edge has to touch a
  subgraph, and then it silently does not work.
- **Fancy arrow types carrying meaning.** Dotted and thick variants render inconsistently
  across versions and are the first casualty of minification. Meaning belongs in labels and in
  node styling.
- **Exceeding the node cap.** Past the renderer's input limit the output is a blank box, not an
  error — so a too-large diagram looks like a rendering bug rather than an oversized graph.
- **Truncating rather than collapsing.** A silently shortened diagram is a map with a lie in
  it. A count node that keeps its confidence is honest and takes one line.
- **Installing a tool to draw a picture.** The tools are used if present. Adding a dependency
  to the host repository to render a diagram is a side effect nobody asked for, and it changes
  a lockfile in a branch that was supposed to change nothing.
- **Presenting JavaScript-only tooling as full coverage.** In a polyglot repository the module
  graph those tools produce covers one language; the other languages are `not checked`, and the
  metadata line has to say it.
- **An HTML file that fetches anything.** One remote font or one CDN script and the artefact
  stops working on a plane, behind a proxy, or in two years. One file, no requests.
- **Editing the envelope on the way into the page.** The literal is the map. Reshape it and the
  picture and the decision surface quietly diverge.
- **Comparison mode as two graphs.** Side-by-side pictures are compared by eye, and by eye is
  where a rewired edge hides. The delta is a classification.
- **Turning comparison on by default.** It doubles the work, needs two valid envelopes, and
  answers a question that was not asked in most runs.
- **A diagram that travels without its metadata.** Weeks later it is quoted as complete, and
  the surfaces nobody checked have become surfaces somebody checked.

## Verification

- [ ] The envelope was validated before rendering, and any failure was rendered rather than
      smoothed over.
- [ ] The diagram is `flowchart LR` — not `graph` — and edges are plain `-->` with kind and
      confidence in the label.
- [ ] **All twelve surface subgraphs are present in the fixed order with their fixed ids,
      including the empty ones**, and each empty one states its coverage.
- [ ] Changed, affected and unknown are visually distinct, and `silent` breaks are
      distinguishable from `compile` breaks at a glance.
- [ ] Node states came from the envelope and were not re-derived; no node appears in two states.
- [ ] **Every blindspot appears as a node on the diagram**, in its own surface, with its probe —
      not as a caption, and none was dropped to save space.
- [ ] Every edge on the diagram carries its confidence from the five fixed words, and no
      percentage appears anywhere in the render.
- [ ] The node count was checked against the cap; where it was over, nodes were collapsed into
      labelled count nodes or split across indexed diagrams, and nothing was silently dropped.
- [ ] No tool was installed. Every optional tool is recorded present-with-version or absent,
      and each absence has its degradation stated in the render's metadata.
- [ ] Where module-graph tooling covered only part of a polyglot repository, the uncovered
      languages are reported as `not checked`.
- [ ] If the interactive file was produced: one file, no external requests, no build step, and
      it renders from disk with the network off.
- [ ] If the interactive file was produced: it carries exactly one generated
      `const BLAST = { meta, surfaces, nodes, edges, blindspots }` literal, unedited from the
      envelope, and `meta` pins tool and versions, base and head revisions, fingerprint and
      `notScanned[]`.
- [ ] Comparison mode is off unless it was asked for and its preconditions held; where it ran,
      the delta is a per-surface classification of added, removed and rewired — not a second
      graph.
- [ ] Every artefact carries its metadata: revisions, resolver, tools, fingerprint,
      `notScanned[]`, and whether collapsing happened.
- [ ] Nothing in the repository was changed, and nothing was committed except a run record that
      was explicitly asked for.
- [ ] Where a record was written, it exists at `docs/visualise-blast-area/<UTC-date>-<slug>.md`
      (or the harness scratch path for an unattended run, named in the final answer), under the
      five required headings.

## Deeper reading

**Prior art, honestly.** The nearest live tool in this space visualises **agent sessions**, not
codebases: a treemap of files touched during a run, with **no edges at all**, and a comparison
mode that diffs one session against another rather than one state of a repository against
another. It is real, actively maintained and good at its own job, and it is the wrong tool for
this one — a blast map is edges, and a treemap has none. Four of its conventions were adopted
anyway, because each solves a problem this skill also has:

- **Deepest-touch-wins**, one state per node, resolved once so a node never renders in two
  colours and never has to be reconciled by the reader.
- **A first-class "outcome unknown" slot.** Unresolved is a result and gets its own styling,
  rather than being folded into "unaffected" where it disappears.
- **An unverifiable criterion is a blind spot, not a failure.** It occupies space on the page
  with the probe that would settle it, instead of being dropped for being unprovable.
- **Findings and verdicts kept separate.** Individual observations are reported as they were
  found; the summary rolls up from them mechanically. A hand-written summary that does not
  follow from the findings is the failure mode this separation exists to prevent.

**The detail, one level down.**

- [Tool tiering](references/tool-tiering.md): what each optional tool contributes, the commands
  and flags, why nothing is installed, and what precisely degrades when each is absent.
- [The mermaid contract](references/mermaid-contract.md): the full `flowchart LR` template,
  fixed subgraph ids, classDef styling, edge labels, the legend, blindspot nodes, and the
  collapse rules for the node cap.
- [The smart HTML contract](references/smart-html.md): the single-file skeleton, the `BLAST`
  literal, the `meta` provenance fields, the affordances, and the prohibitions that keep the
  artefact working offline in two years.
- [Comparison mode](references/comparison-mode.md): the preconditions, the added / removed /
  rewired classification, worked deltas for a refactor and a removal, and why it is not a
  second graph.
- [A worked render](references/worked-render.md): one envelope taken end to end into a diagram,
  with the blindspot node, the empty-surface nodes and the metadata line in place.
- [The run-record convention](references/documenting-the-run.md): when a record is written,
  where it goes, its five headings, the prohibitions, and a worked record.
