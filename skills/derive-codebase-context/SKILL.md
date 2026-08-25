---
name: derive-codebase-context
description: "Derive agent context, enforced boundaries, and an operational atlas from the repo itself. Use when agents keep losing the shape of a large codebase."
license: MIT
compatibility: "Any repository an agent works in. The generators need Node 22+ (builtins only) and git. Layer 2 assumes a JavaScript/TypeScript import graph through dependency-cruiser; other ecosystems need their own edge linter, and the rest of the procedure is unchanged. The measurements behind this came from a TypeScript monorepo of roughly 2,500 files. No database server, no daemon, and no network at any layer."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Write Edit Grep Glob Bash
---

# Derive codebase context

An agent working in a repository of a few thousand files cannot hold its shape.
The reflex is to build a code knowledge graph. The measurements say do something
cheaper and more durable: derive three artifacts from the tree itself, commit
them, and gate each one in CI so it cannot rot.

This skill is the order to build them in, how to tell whether a repository
already has them, and the one discipline that decides whether any of it works.

## What the evidence says

Read this before proposing a graph, because the graph is the thing people keep
proposing.

- **A tree-sitter code graph is not a win across the board.** Measured over 31
  repositories it gives roughly 10x fewer tokens and 2.1x fewer tool calls, at
  **83% answer quality against 92%** for an agent that simply reads files
  (arXiv 2603.27277). It wins on hub detection and caller ranking and loses
  elsewhere. So route *structural* questions to derived artifacts, and never
  take agents off grep.
- **Anthropic removed a local vector index from Claude Code** in favour of
  agentic search, over staleness, privacy and reliability. Anything built here
  must be **derived and regenerated**, never hand-maintained.
- **Name-keyed graphs collapse on real repositories.** In the codebase this came
  from, 184 exported names were defined in more than one file, and the worst
  offenders were its own conventions: `POST` 271 times, `GET` 209, `KEY` 143. A
  graph keyed on bare symbol names merges those into one node, and every
  blast-radius answer becomes "the whole app". Only compiler-resolved indexing
  survives that, and it is layer 4, which you defer.

## When to Use

- A repository is large enough that agents guess at its structure, and you are
  deciding what to build about it.
- Someone proposes a code knowledge graph, a vector index, or a semantic search
  layer over the codebase.
- The context files have multiplied: `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`,
  Copilot instructions, Cursor rules, `.clinerules`, Windsurf rules, all
  hand-maintained and no longer saying the same thing.
- Architecture rules live in prose that nothing enforces.
- A repository already has some of this and you need to know whether to finish
  it, upgrade it, or leave it alone.

Do not use it to answer a question about the code. That is what grep, the
language server, and reading files are for, and they are better at it. This
builds the artifacts; it does not replace how agents read.

## Required tooling

| Need | Tool | Where it runs | Notes |
|---|---|---|---|
| Context and atlas generation | Node 22+, builtins only | local and CI | No dependencies at all. |
| Boundary enforcement | `dependency-cruiser` ^18 | local and CI | One dev dependency at the root. |
| Boundary graph image | `graphviz` (`dot`) | local only | Optional. CI never needs it. |
| Symbol navigation (companion) | `uv` / `uvx` plus Serena | local only | Spawns a language server. Produces no committed artifact. |
| Symbol index (layer 4) | `scip-typescript` or your language's SCIP indexer | local, and CI only if you keep it | Emits a protobuf index. Gitignored, rebuilt on demand. |
| Index storage (layer 4) | SQLite or DuckDB **as a library** | local | An embedded file, not a server. |

**No database server at any layer.** No daemon, no container, no hosted index,
no network call. Everything travels through git because every artifact is a pure
function of the tree at HEAD, so a stale copy is fixed by regenerating it, not by
pulling. Do not register the repository with a hosted indexing service unless the
owner has decided the source may leave the machine.

## Step 0: find out what is already there

**Do this first, every time.** Blindly scaffolding over a working setup is the
failure this step exists to prevent, and a half-built setup is more common than
either extreme.

Probe for six signals:

| Signal | Look for | What it proves |
|---|---|---|
| Shared core | A directory holding the context source that several harness files are built from. | Layer 1 has a single source. |
| Generator | A script that writes those harness files, with a `--check` mode. | Layer 1 is derived, not hand-copied. |
| Gate | A CI step running that `--check`. | Layer 1 is enforced. |
| Boundary config | A dependency-cruiser config whose `forbidden` rules name *this* repository's architecture. | Layer 2 has started. |
| Atlas | A committed directory of generated registry markdown carrying a provenance line. | Layer 3 exists. |
| Formatter ignore | The generated paths listed in the formatter's ignore file. | Layers 1 and 3 survive a format run. |

Two ways to be fooled:

- **A file that feeds several harnesses is not generated.** Open it and look for
  a "generated, do not edit" header and a provenance stamp. No header means
  hand-maintained, however many harnesses read it.
- **A dependency-cruiser config carrying only the tool's own starter rules**
  (`no-circular`, `no-orphans`, `not-to-dev-dep`) encodes none of this
  repository's architecture. Layer 2 has not started.

Then branch:

- **Nothing found: onboard.** Build layers 1, 2, 3 in that order. Each is useful
  alone. Stop wherever it stops paying.
- **Some found: finish the layer that exists before adding the next one.** The
  usual half-state is a generator with no CI gate, which is the least useful
  shape there is: it drifts exactly as fast as hand-maintenance, and looks
  solved. Arm it first.
- **All found: verify and report. Change nothing.** Run each `--check` and the
  boundary check, report drift and its cause, and stop. Do not regenerate and
  commit unless the owner asks.

## Layer 1: one source for the agent context files

**The failure.** Every harness wants its own file, so the repository accumulates
`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md`,
`.cursor/rules/*`, `.clinerules`, `.windsurfrules`. Hand-maintained, they drift,
then contradict each other, and an agent obeys whichever one its harness happens
to load. Nobody can tell which rule is current.

1. **Measure the drift before writing anything.** List every context file, diff
   them, and write down which rules exist in one and not another. That list is
   the review artifact, and it is the only chance to settle contradictions with
   a human.
2. **Author a shared core**, split by topic so each harness file can compose a
   subset rather than take everything.
3. **Write the generator** with language builtins only. It reads the core and
   writes every harness file with a "generated, do not edit, regenerate with X"
   header.
4. **Add `--check`**: regenerate to memory, compare against what is on disk,
   exit non-zero on drift. Naming the file that drifted is the whole product of
   a failed run.
5. **Gate it in CI, and add the generated paths to the formatter's ignore file
   in the same commit.** See the pitfalls: a formatter will rewrite generated
   markdown and break the gate before you have finished building it.

## Layer 2: architectural rules as enforced import edges

**The failure.** The repository already writes rules in prose: this package may
not import that one, background jobs may not reach the web app, nothing calls
the provider SDK directly. Prose is followed until somebody is in a hurry.

1. **Take rules that are already written down.** Do not invent architecture
   policy inside a lint config. A rule nobody agreed to gets disabled.
2. **Measure the current violations with the tool that will enforce them**, not
   by hand. See the pitfalls: a hand count found 4 where the rule engine found
   6, and a rule that starts red gets switched off rather than fixed.
3. **Write each rule as a forbidden edge**, at error severity where the count is
   zero and warn where it is not, with the target count in the rule's own
   comment so the next person knows what it is ratcheting towards.
4. **Mutation test it.** Every rule. No exceptions. See the discipline below.
5. **Run it in CI** alongside the other checks.

Two traps that made real rules pass while checking nothing are in
[the gate hardening reference](references/gate-hardening.md). Read it before
writing a rule that mentions an npm package.

## Layer 3: the generated operational atlas

**The failure.** Agents re-derive the same cross-cutting registries by grep,
every session, and get them subtly wrong. Background jobs to their keys to where
they are registered. Plugin or MCP tools to their executors. HTTP routes to
methods to handlers. Whatever your repository has several dozen of and no list
of.

Derive them into committed markdown:

- **Parse the tree.** Never ask a model to summarise it. The value here is that
  the artifact is exactly as true as the code.
- **One row per real thing, carrying its file path**, so the agent can open the
  source instead of trusting the summary.
- **Stamp provenance**: which generator wrote it, the commit the tree was at, and
  the command to regenerate it.
- **Add `--check`**, as in layer 1.
- **Rewrite a file only when its derived facts change**, and compare bodies with
  the provenance line blanked. Otherwise every commit rewrites every atlas file
  and the diff becomes noise nobody reads.

The provenance scheme is where this goes wrong in CI specifically. Read the
[gate hardening reference](references/gate-hardening.md) before designing it.

## Layer 4: a compiler-accurate symbol index. Defer it.

This is the only thing that answers blast radius correctly in a repository with
duplicate exported names, and it is roughly a week of work. Run layers 1 to 3 for
a month first, because the cheap layers often remove the need.

When you do build it: a SCIP indexer for your language, loaded into an **embedded**
SQLite or DuckDB file. Gitignore the index. It is tens of megabytes of protobuf
that changes every commit, and committing it is putting `node_modules` in git.

A language server exposed over MCP (Serena, run through `uvx`) is a useful
companion at any point and is not a layer: it gives symbol-level navigation with
no committed artifact and nothing to keep in sync.

## The discipline: a gate you have not watched fail is not a gate

In the work this came from, **four separate guards were born unarmed**. They
passed every run while verifying nothing: two boundary rules whose configuration
had deleted the edges they matched, and two atlas guards that were structurally
unreachable. Nothing about a green run distinguishes a guard that passed from a
guard that checked nothing.

So for every gate, before you trust it:

1. **Back it up with `cp`.** Not with git. `git checkout -- <file>` silently does
   nothing for an untracked file, so it will not revert a mutation test on a
   file you just created, and you will lose the fix instead.
2. **Introduce exactly the thing the gate forbids.**
3. **Run the gate. Watch it fail**, and read the message. It must name the thing
   you introduced. A failure with a message that names something else is a
   different gate firing.
4. **Restore from the backup.**
5. **Run it again. Watch it pass.**

A guard you cannot make fail is checking something other than what you think it
is checking. Treat a new guard as broken until it has been watched to fail.

## Pitfalls

- **Measure with the tool that will enforce, not with a hand grep.** A pathspec
  like `dir/**/*.ts` does not match files sitting directly in `dir/`. The hand
  count said 4; the rule engine found 6. A baseline that is an undercount turns
  into a rule that starts red, and a rule that starts red gets disabled.
- **CI clones are shallow.** `actions/checkout` gives depth 1, so
  `git log -1 -- <path>` returns the tip commit for *every* path and
  `git rev-parse --short` abbreviates to 7 characters instead of 8. Any
  provenance scheme that compares a per-path SHA passes on a laptop and fails on
  every CI run.
- **Formatters rewrite generated files.** A markdown formatter realigning tables
  broke the generated-file gate before the atlas it was meant to protect even
  existed. The ignore entry belongs in the same commit as the generator.
- **A new test directory needs a workspace or project entry**, or its first test
  file contributes zero tests while the summary stays green.
- **Dependencies go stale after a big pull.** A declared, lockfile-present
  package that is not actually installed will fail most of a suite. Install
  before believing any suite result.

## Usage Examples

```text
Set up derived codebase context in this repo. Detect what already exists first
and tell me which of the three layers are present before you write anything.
```

```text
We have CLAUDE.md, AGENTS.md and Cursor rules that disagree. Do layer 1: show me
the drift between them as a diff first, then generate all three from one core
and gate it in CI.
```

```text
Turn the four architecture rules in our README into dependency-cruiser forbidden
edges. Measure the current violation count with the tool before writing each
rule, and mutation-test every one of them before you tell me it works.
```

## Verification

- [ ] Step 0 ran, and the branch taken (onboard, finish, verify-only) was stated.
- [ ] Nothing was scaffolded over an existing setup without being reported first.
- [ ] Every generated file carries a "do not edit" header and a regenerate command.
- [ ] Every generator has a `--check` mode that names the file that drifted.
- [ ] Every `--check` runs in CI.
- [ ] Generated paths are in the formatter's ignore file.
- [ ] Each boundary rule was measured with the enforcing tool before it was written.
- [ ] Every gate was watched to fail on a mutation and then to pass on restore.
- [ ] Mutation backups were `cp` copies, and the restore was verified.
- [ ] Provenance survives a depth-1 clone.
- [ ] No index, cache, or generated binary artifact was committed.
- [ ] Layer 4 was deferred, or the owner explicitly chose to pay for it.

## Deeper reading

- [Onboarding runbook](references/onboarding.md): the per-layer procedure in
  full, including generator design, `--check` semantics, provenance stamping,
  and how to adapt each layer to a non-JavaScript stack.
- [Gate hardening](references/gate-hardening.md): the mutation-test procedure,
  the four unarmed guards and the exact mechanism of each, and the CI traps that
  make a green check meaningless.
