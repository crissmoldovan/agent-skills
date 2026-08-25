# Onboarding runbook

The per-layer procedure in full. Read the skill body first: it carries the order,
the detection step, and the discipline. This carries the mechanics.

## Preconditions

- Git, and a Node 22+ runtime for the generators. The generators use builtins
  only, so there is nothing to install and nothing to keep up to date.
- A CI system that can run a command and fail the build on a non-zero exit.
- Write access to the repository's formatter configuration.

**Stack assumptions, and how to adapt.** Layers 1 and 3 are stack-agnostic: they
read the tree and write markdown. Layer 2 is the only one with an ecosystem
dependency, because it needs something that can resolve an import graph. The
measurements behind this procedure came from a TypeScript monorepo, so
dependency-cruiser is what the examples name. Substitute the equivalent for your
ecosystem and nothing else in the procedure changes:

| Ecosystem | Import-edge enforcement |
|---|---|
| JavaScript / TypeScript | dependency-cruiser, or an eslint import boundary plugin |
| Python | import-linter contracts |
| Go | the language's own package visibility, plus a depguard-style linter |
| Java / Kotlin | ArchUnit rules |
| Rust | crate boundaries, plus a workspace dependency lint |

What matters is not the tool. It is that a violated rule fails a build, and that
the rule was measured before it was written.

## Step 0: detection probes

Run these before writing anything. Adjust the paths to the repository's own
conventions; the point is the question each one answers, not the exact path.

```bash
# Which agent context files exist at all?
git ls-files | grep -Ei 'CLAUDE\.md|AGENTS\.md|GEMINI\.md|copilot-instructions|clinerules|windsurfrules|\.cursor/rules/'

# Are any of them generated? A generated file says so in its first lines.
git ls-files | grep -Ei 'CLAUDE\.md|AGENTS\.md' | xargs -I{} sh -c 'echo "== {}"; head -4 "{}"'

# Is there a generator, and does it have a --check mode?
git grep -lE 'generated.*do not edit|--check' -- '*.mjs' '*.js' '*.ts' | head

# Is there an import-boundary config, and does it carry this repo's own rules?
git ls-files | grep -Ei 'dependency-cruiser|importlinter|\.importlinter|archunit'

# Is there a committed atlas, and is it stamped?
git ls-files | grep -Ei 'atlas|agent-context' | head

# Will a format run rewrite the generated files?
cat .prettierignore 2>/dev/null || echo 'no formatter ignore file'
```

Report what you found, and which of the three branches you are taking, before
you edit a file. The three branches are in the skill body.

## Layer 1: one source for the agent context files

### 1. Measure the drift

Diff every context file against every other one and produce a list of rules that
exist in one place and not another. Do not resolve contradictions yourself: they
are decisions, and the list is what you take to whoever owns them.

This step is the reason the layer is worth doing. Generation without it copies
one file's mistakes into six harnesses at once.

### 2. Author the core

A directory of topic files, one topic per file, plus a manifest saying which
topics each harness output composes. Topics, not harnesses: a rule about
migrations belongs in the migrations topic whether or not Cursor reads it.

Keep harness-specific material in small per-harness files. If a harness needs a
tool syntax or a directory convention nobody else understands, that belongs to
the harness file, not to the core.

### 3. Write the generator

Builtins only. It reads the core plus the manifest and writes each output file
with a header of exactly this shape:

```text
<!-- Generated from docs/agent-context/. Do not edit.
     Regenerate: node tools/agent-context/generate.mjs -->
```

The header states three things: that it is generated, where the source is, and
the exact command. Somebody who edits the file by hand will read the header
before their change is reverted, and that is the only chance to teach them.

### 4. Add `--check`

`--check` regenerates into memory, compares to what is on disk, and exits
non-zero on any difference. It must **name the file that drifted** and print the
regenerate command. A check that says only "drift detected" costs the reader a
round trip.

### 5. Gate it, and ignore it in the formatter

Add the `--check` invocation to CI, and in the same commit add every generated
path to the formatter's ignore file. Not in a follow-up: a markdown formatter
that realigns tables will rewrite generated output the first time anybody runs
it, and the gate then fails for a reason that has nothing to do with the
content.

Mutation-test the gate before you believe it. See the gate hardening reference.

## Layer 2: architecture rules as enforced import edges

### 1. Take rules that already exist

Read the repository's own documentation and pull out the rules it already states
about what may import what. Every rule you enforce should be quotable back to a
sentence somebody wrote deliberately.

Rules invented inside a lint config are the ones that get switched off in the
first PR that trips them.

### 2. Measure with the enforcing tool

Before writing a rule, run the tool in reporting mode and count the current
violations. Not with grep. A pathspec is not an import graph, and the two
disagree in ways that are invisible until the rule ships. See the pitfalls in
the skill body for the exact case.

Record the number. It is the rule's baseline and it belongs in the rule's
comment.

### 3. Write the rule

- Count is zero: severity `error`. It cannot regress.
- Count is not zero: severity `warn`, with the count and the intended direction
  in the comment, and a plan to ratchet.

Never widen a rule to make a red build green. Either fix the violation or record
an explicit, reviewed exception with a written reason.

### 4. Mutation test it

Every rule, individually. This is where two of the rules in the original work
turned out to be verifying nothing. The procedure and the two configuration
traps behind those failures are in the gate hardening reference.

### 5. Run it in CI

Alongside the other checks, with the same exit-code contract.

Optionally add a graph render (`dot`) as a local-only command. It is useful in
review and CI must never depend on it.

## Layer 3: the generated operational atlas

### What to derive

The registries an agent would otherwise reconstruct by grep every session.
Typical candidates:

- Background jobs, their identifiers, and where each is registered. If the
  repository has a registry file, the atlas is the place the mismatch between
  the two becomes visible.
- Tool or plugin definitions and their executors.
- HTTP routes, their methods, and their handler files.
- Schema migrations and their applied-state convention.

The test for a good atlas page: an agent currently answers this question by
running three greps and getting it slightly wrong.

### How to derive it

Parse the tree. Never ask a model to summarise the codebase into the artifact:
the whole value is that it is exactly as true as the code, and a summary is not.

Every row carries the file path of the thing it describes. The atlas is an index
into the source, not a replacement for reading it.

### Provenance

Stamp each file with the generator, the commit the tree was at, and the
regenerate command. Then obey two rules that are less obvious than they look:

1. **Rewrite a file only when its derived facts change.** Otherwise every commit
   rewrites every atlas file and the diffs become noise.
2. **Compare bodies with the provenance line blanked** in `--check`. Otherwise
   the stamp itself is a difference and the check fails on every commit.

Do not build a scheme that compares a per-path commit SHA. It cannot work in CI.
The reason is in the gate hardening reference, and it is the kind of thing that
passes every local run.

## Layer 4: defer it

Do not start here, and do not let it block layers 1 to 3.

When the earlier layers have run long enough to show what is still missing, and
the missing thing is genuinely blast radius across duplicate exported names,
build it: a SCIP indexer for the language, loaded into an embedded SQLite or
DuckDB file, gitignored and rebuilt on demand. Budget a week.

A language server over MCP is the cheap partial substitute and can be added at
any point. It answers "where is this symbol defined and used" with no committed
artifact and nothing to keep in sync, which means nothing to keep honest.

## Stopping rules

Each layer is useful alone. Stop wherever it stops paying, and say so:

- If layer 1's drift list turns out to be empty, the repository does not have
  this problem. Generating anyway adds a build step and buys nothing.
- If layer 2's candidate rules all have non-zero violation counts nobody intends
  to fix, you are proposing policy, not enforcement. Take it back to the owner.
- If nobody can name a question layer 3 would answer, do not build an atlas of
  whatever is easiest to parse. An unread generated file is still a file that
  breaks a gate.
