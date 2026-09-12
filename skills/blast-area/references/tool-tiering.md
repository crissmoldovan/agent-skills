# Tool tiering

The rule first, because it is the one that gets broken: **use what is already installed; install
nothing.** Rendering a diagram is a read-only act. A skill that adds a dependency to the host
repository so it can draw a picture has changed a lockfile, a dependency tree and possibly a CI
cache, in a branch that was supposed to change nothing at all. If a tool is absent, the render
degrades and the degradation is stated on the artefact.

## Tier 1 — use if present

### dependency-cruiser

A module-graph tool for JavaScript and TypeScript trees. Two capabilities matter here.

- **A mermaid reporter.** It can emit its graph directly as mermaid, which means a
  module-level view of a change can be produced without hand-assembling nodes.
- **A change-aware mode.** It can restrict the graph to the modules reachable from what changed
  since a revision, which is the module-level half of an affected set:

  ```sh
  depcruise --affected <base-revision> --output-type mermaid src
  ```

- **A highlight expression.** `--highlight` takes a regular expression and marks the modules
  that match it. This is how **changed** is separated from **affected** in the same picture:
  highlight the changed files, and everything else in the graph is what they reach.

  ```sh
  depcruise --affected <base-revision> --highlight "<changed-files-regex>" --output-type mermaid src
  ```

Flag spellings and defaults move between major versions. Read the installed version's own
`--help` before running it, and record the version in the render's metadata — a diagram
produced by an unrecorded version of a tool cannot be reproduced.

### watskeburt

A standalone lister of what changed since a revision. Two properties earn it a place:

- **Rename-aware.** A renamed file is reported as a rename rather than as a delete plus an add,
  which stops a rename from arriving in the diagram as a removed node next to an unrelated new
  one.
- **It can emit a regular expression** over the changed set, which is exactly the shape
  `--highlight` wants. That is why the two tools are listed together; it is also useful alone,
  as the source of the changed-set truth when no module graph is available.

### A language server or a compiler-resolved symbol index

Not a diagram tool, but it is what makes the caller surface `enumerated` rather than `measured`.
If the repository carries one, the upstream map will already have used it and `meta.resolver`
will say so. The render's job is to carry that word through, not to re-resolve anything.

## Not assumed: Graphviz

`dot` is a fine renderer and it is **not** a safe assumption. It is a native binary, it is
frequently absent from CI images and developer machines alike, and a `.dot` file handed over as
the deliverable is a file most recipients cannot open.

So: never make `.dot` the primary artefact. If `dot` is present and someone wants a raster or a
vector for a slide, produce it as a **bonus** alongside the mermaid, and say which one is
canonical.

## Tier 2 — the envelope alone

This is the normal case, and it is a complete case. The mermaid is assembled by hand from the
envelope's `nodes` and `edges`; the contract does not change; the diagram is not worth less.

What changes is coverage, and it must be said out loud:

| Tool absent | What degrades | What the metadata line says |
|---|---|---|
| dependency-cruiser | Module-level import edges are not enumerated; only the edges the map itself recorded appear | `module graph: not checked` |
| watskeburt | The changed set comes from whatever the brief named, and renames may arrive as delete-plus-add | `changed set: as declared, renames unverified` |
| Language server / symbol index | Caller edges are name-based, at the map's stated precision ceiling | carry `meta.resolver` through verbatim |
| Graphviz `dot` | No raster or vector export; mermaid only | nothing — this was never promised |

## The polyglot trap

dependency-cruiser and watskeburt are JavaScript and TypeScript tools. In a repository that
also contains another language — a service in Go, jobs in Python, SQL that is executed as text —
the module graph they produce covers the part they can parse and says nothing about the rest.

Rendering that graph without qualification presents partial coverage as total coverage, which is
the exact failure the map's `not checked` vocabulary exists to prevent. The render must name the
languages the tooling did not see, in the metadata line, next to the tool that did not see them.
