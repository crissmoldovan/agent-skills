---
name: blast-area
description: "Map what a set of changes would affect before making it: callers, data contracts, jobs, UI, tests, build toolchains, deploy ordering, and second-order readers — with searched negatives and a list of what the map cannot see. Use when you need to know what a change would break."
license: MIT
compatibility: "Any repository the agent can read, with git and a text search tool. A language server or compiler-resolved symbol index raises the map's precision and is used when present; without one, resolution is name-based and the map says so. Data-resident references need a queryable datastore — where there is none, the surface is reported unchecked rather than empty. Output is a written map plus a JSON envelope that renders directly as a diagram; nothing is changed and nothing is committed unless a run record is asked for."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Write Grep Glob Bash
---

# Map a change's blast area

"What will this break?" is usually answered with a list of files. A list of files is not a
decision. It says where to look, not what happens, not when, and not what the list left
out — and the changes that hurt are precisely the ones whose damage was never a file a
search would have returned. A column name inside a string literal. A job that stops
registering and simply never runs. A guard that starts passing because its pattern now
matches nothing. A prompt row in a table naming a tool that got renamed.

This skill produces a decision surface instead: eleven effect surfaces walked in a fixed
order; **when** each break would surface — compile time, runtime, or silently — stated per
item; a deploy ordering with the reason it is that way round; the searches that established
every empty cell; and a mandatory statement of what the map could not see, at a confidence
drawn from five fixed words.

It maps. It changes nothing, and it commits nothing unless a run record is asked for.

## What a map has to carry to be a decision

- **A break time on every item.** "Affected" is not actionable. A break that a typechecker
  catches costs minutes; the same break reached through a string literal costs an incident.
  In one measured case, dropping a column that only string-built queries selected passed
  every typecheck and every CI job and failed in production.
- **Negatives as findings, not as blank space.** An unchecked cell and a checked-and-empty
  cell look identical on a page. One of them is evidence. The other is the most dangerous
  element in the document.
- **One ordering, with its reason.** Schema-first and code-first are both correct, in the
  same repository, depending on which direction the change runs. Emitting one of them
  unconditionally is wrong about half the time.
- **A ceiling that is stated rather than implied.** Name-based resolution over a repository
  with duplicate exported names has a precision limit, and a map that does not name its own
  limit will be read as though it had none.
- **Confidence from a closed vocabulary.** `enumerated`, `measured`, `sampled`, `inferred`,
  `not checked`. Never a percentage: nobody computed it, and it survives into other people's
  decisions as though someone had.

Composition: **`investigate-codebase`** does the searching — complexity scoring, the
decomposition axes, the control rule on every negative, the contradiction table — and this
skill arranges what it returns by surface and adds the timing, the ordering and the
blindspots. **`visualise-blast-area`** consumes the output contract below and renders it.
**`land-complex-change`** turns the map into a touch-set budget and a regression gate per
affected surface. **`derive-codebase-context`** builds the durable index that raises this
map's ceiling. Install the companions with `npx skills add crissmoldovan/agent-skills`.

## When to Use

- A change is about to be made and someone needs to know what it would hit before it is made.
- A schema change is in flight — a drop, a rename, a type change — and the readers are not
  all in one language or one repository.
- A deletion looks safe. "Nothing calls this" is about to be load-bearing.
- Two candidate fixes need comparing by what each one disturbs rather than by which is nicer.
- A deploy has two halves and the order they land in matters.
- A change crosses a boundary — packages, toolchains, services, repositories — and no single
  compiler sees the whole path.
- A review asks "what else does this touch?" and the honest answer is currently a shrug.

Do not use it to answer one question about how the code works — that is `investigate-codebase`,
which this skill calls for its searching rather than duplicating. Do not use it to draw the
diagram: `visualise-blast-area` consumes this skill's output contract, and a map built to be
drawn rather than to be decided on will be shaped by what renders well. Do not use it to run a
report through to a fix — `resolve-problem-report` owns that pipeline and calls this skill once
per candidate. Do not use it to actually make the change inside a contained budget; that is
`land-complex-change`. Do not use it to describe a change that already landed — `describe-changes`
reads the diff and this skill reads a proposal. Do not use it as a code review over a pull
request: `request-blocks-review` and `blocks` own that loop, and they judge a diff that exists.

## Prerequisites

1. **A change set written as changes, not as an intention.** Every element names a thing —
   file, symbol, schema object, endpoint, config key — and an operation: add, rename, drop,
   retype, move, delete. "Refactor the ingest path" maps the wrong things.
   **Complete when:** every element has a thing and an operation, and each thing can be
   pointed at, at a revision.
2. **A base revision and its dirty state.** The map is drawn against a tree. If part of the
   change is already made, record head as well as base.
   **Complete when:** base sha, head sha where relevant, and dirty state are recorded.
3. **The repository's resolution capability declared.** A compiler-resolved symbol index, a
   language server, generated registries, or name-based search only — plus the duplicate
   exported-name count where you can measure it. This is the map's precision ceiling and it
   is written into the output, not assumed.
   **Complete when:** the best available resolver is named and the ceiling clause is drafted.
4. **The reach of your searches declared.** Which references live somewhere code search
   cannot go: rows in a datastore, a hosted flag service, an infrastructure repository you do
   not have, a vendor console.
   **Complete when:** each store is either queryable and queried, or named as out of reach.
5. **The consumers outside this checkout listed.** Other repositories, published packages,
   API clients, webhook subscribers, warehouse jobs, dashboards.
   **Complete when:** each is enumerated, or recorded as unknown with the probe that would
   settle it.

## Procedure

1. **Restate the brief as a change set — and refute the clause that is wrong.** A brief is a
   hypothesis, not a specification, and partial refutation is the expected outcome rather than
   an awkward one. Accept the premises that hold, reject the one that does not, and reject it
   **with a number**: not "this may not be accurate" but "two of these three hold; the third
   names 41 call sites and there are 3, all in one test file." In one measured case exactly
   that split — two premises true, one false — was the most valuable line in the map, because
   it changed which change got made. Refuse the whole brief only when nothing in it survives,
   and then say what does exist instead.

2. **Delegate the searching; do not improvise it.** `investigate-codebase` owns the complexity
   rubric, the decomposition axes, the child result contract and **the control rule** — a
   zero-hit search is admissible as "absent" only when a control fired. Brief by-symbol
   children with a **definition site, never a bare name**: in a monorepo of roughly 2,500
   TypeScript files, one measured pass found 184 exported names defined in more than one file,
   the worst being the framework's own conventions — one handler name in 271 files, another in
   209, a registry key in 143. Note also that a blast map's cost-of-being-wrong signal is 2
   whenever it authorises a migration, a deletion or a deploy, which forces at least the normal
   band before anything is spent.

3. **Walk all eleven surfaces, in the fixed order, including the ones you expect to be empty.**
   The order is fixed so that two maps of the same repository are comparable, and so that an
   empty surface is visibly empty rather than quietly missing. Full probes, worked examples and
   the trap each surface exists to catch are in
   [the eleven-surface checklist](references/surface-checklist.md).

   | # | Surface (id) | What to enumerate | Where the break usually surfaces |
   |---|---|---|---|
   | 1 | **Callers** (`callers`) | every call site of every changed definition, resolved at the **definition site** | compile time in a typed language; **runtime** through dynamic dispatch; **silent** when the call still typechecks with the argument gone |
   | 2 | **Data contracts and derivers** (`data-contracts`) | writers, readers, and **derivers** — anything computing a second value from the first; schemas, DTOs, serialisers, migrations | **runtime** for string-built queries; **silent** for a deriver that carries on against a default |
   | 3 | **Background jobs and their registries** (`jobs`) | tasks, queues, crons, workers — and the registry each must appear in to run at all | **runtime**, at boot or first dispatch; **silent** when registration is skipped and the job simply never runs |
   | 4 | **UI** (`ui`) | screens, components, routes, and the empty and error states that render the changed value | **runtime**, and only on the route that renders it; **silent** when the field renders blank |
   | 5 | **Tests and guards that would stop firing** (`tests-and-guards`) | the tests covering it, and the CI guards, lint rules, assertions and allowlists whose pattern mentions it | test failure at CI time; **silent** for a guard whose pattern now matches nothing — it passes |
   | 6 | **Config, infra and every build toolchain** (`config-and-toolchains`) | env vars, deploy manifests, IaC — and **each compiler, bundler or transform that processes the changed file** | **build time** under one toolchain and **runtime** under another: one construct, three toolchains, three behaviours |
   | 7 | **Deploy ordering** (`deploy-ordering`) | which half must land first, and what runs in the window between the halves | **runtime**, inside the window; **silent** when the window is short and the errors land in a log nobody reads |
   | 8 | **Docs, prompts and data-resident references** (`docs-and-data-resident`) | prose that names it — and **rows in a datastore that name it**: prompt templates, saved queries, feature flags, seeded config | **silent, always**. No code search sees a row |
   | 9 | **External consumers** (`external-consumers`) | other repositories, published packages, API clients, webhook subscribers, warehouse jobs | **runtime, in somebody else's system**, often days later |
   | 10 | **Second-order readers** (`second-order`) | whoever reads what the changed thing writes — then whoever reads that | **runtime or silent** — typically an aggregate that quietly changes value |
   | 11 | **Reversibility and the undo path** (`reversibility`) | what a revert restores, what it does not, and the data a rollback cannot bring back | not a break — the timing of the **recovery**; say whether undo is a revert, a compensating change, or nothing |

   Surface 8 needs a **query**, not a grep, and surface 6 needs the toolchains **counted**: in
   one measured monorepo, four separate build pipelines processed overlapping file sets, and a
   module specifier that typechecked and passed tests was unresolvable in exactly one of them —
   discovered after deploy, because only that pipeline's bundler ever saw the construct.

4. **Put a break time on every item.** Three values, and the third is the reason this skill
   exists: `compile` (a typechecker, linter, or build rejects it before it ships), `runtime` (it
   ships and throws where the path executes), `silent` (it ships, executes, throws nothing, and
   is wrong — or stops happening at all). An item with no break time is not finished. The
   taxonomy, its decision questions and the language-specific cases are in
   [break timing](references/break-timing.md).

5. **Write the negatives down as findings.** Every empty cell carries either the search that
   established it — verbatim query, tool, hit count, the control and whether the control
   fired — or the single word `inconclusive`. A search whose control never fired proves nothing
   about the codebase; the canonical failure is `git grep -E '\b…'`, which returns nothing and
   never could, because POSIX ERE has no `\b`. Read as absence, that is proof of a typo. In one
   measured case the load-bearing finding of an entire map was an absence: the consumer everyone
   assumed existed did not, and the map was only trustworthy because the search that established
   it was on the page next to a control that fired.

6. **Decide the deploy ordering, and say why it is that way round.** Derive it from one
   question — **which half breaks the other when it runs alone?**

   - **Schema-first** when the new code reads or writes something the schema does not have yet.
     The code half cannot run without it; the old code keeps working across an additive schema;
     the window is safe. Additive is the precondition, not a hope.
   - **Code-first** when applying the schema half would break readers that are live right now —
     a drop or a rename that current code still selects. Deploy the code that stops reading it,
     let the old instances drain, then contract. Schema-first here fails inside the window
     rather than at deploy time, which is why it reads as safe until it is not.
   - **Neither, when each half breaks the other.** That is not an ordering problem; it is a
     three-step one — expand, migrate, contract — or a flag, or a dual-write. Say which.

   State the direction, the reason, **and what runs in the window between the halves**: the
   in-flight requests, the workers mid-job, the cached clients. Worked orderings, the drain
   question and the expand-migrate-contract shape are in
   [deploy ordering](references/deploy-ordering.md).

7. **Assign confidence per surface and per edge, from five words.** `enumerated` — a complete
   list from a source that cannot omit a member: a compiler-resolved index, a registry the
   runtime itself reads, a foreign key. `measured` — a search or command that ran, with its
   count and a fired control; complete only over what it searched. `sampled` — n of N inspected,
   with both numbers. `inferred` — reasoned from convention or naming; nothing was opened.
   `not checked` — nobody looked, written down rather than left blank. Never a percentage, and
   never a sixth word.

8. **Assemble the output contract.** One envelope, which `visualise-blast-area` consumes
   directly. Eleven surfaces in the fixed order with their fixed ids, **present even when
   empty**; one state per node; **every edge carrying its confidence and its evidence**.

   ```json
   {
     "meta": { "baseRevision": "sha", "headRevision": "sha or null", "dirty": false,
               "resolver": "language-server | index | registries | name-based",
               "toolsUsed": ["git grep", "…"], "notScanned": ["…"] },
     "surfaces": [{ "id": "callers", "label": "Callers", "confidence": "measured",
                    "searched": [{ "query": "verbatim", "tool": "git grep", "hits": 41 }],
                    "negatives": [{ "target": "…", "query": "verbatim", "control": "…",
                                    "control_fired": true, "verdict": "absent | inconclusive" }] }],
     "nodes": [{ "id": "n1", "label": "…", "path": "path:line", "surface": "callers",
                 "state": "changed | affected | unknown", "break": "compile | runtime | silent | none",
                 "note": "…" }],
     "edges": [{ "from": "n1", "to": "n2", "kind": "calls | reads | writes | derives | registers | renders | deploys-before",
                 "confidence": "enumerated | measured | sampled | inferred | not checked",
                 "evidence": "path:line @ sha, or the query that found it" }],
     "blindspots": [{ "id": "b1", "label": "…", "surface": "docs-and-data-resident",
                      "reason": "…", "probe": "what would settle it" }]
   }
   ```

   An edge without evidence is a guess with an arrowhead on it, and it renders identically to a
   measured one. Field-by-field semantics, the node-state rules and a full worked envelope are in
   [the output contract](references/output-contract.md).

9. **Write "What this map cannot see". It is not optional.** Four named limits, each answered
   rather than gestured at:

   - **Dynamic dispatch** — which registries were found, by what mechanism, and the statement
     that anything dispatched through a string built at runtime is outside the map.
   - **Data-resident references** — whether the datastore was queried, which store, and if it
     was not reachable, that it was not, on the page.
   - **Resolution basis** — compiler-resolved or name-based, and where name-based, **the
     collision count**: how many exported names in this repository are defined in more than one
     file. If you cannot measure it, say the resolution is name-based and the collision count is
     unknown.
   - **Runtime-only edges** — reflection, dependency injection, generated code, webhooks, cron,
     anything that exists only in a running process.

   Then the **precision-ceiling clause**, stated plainly: without a compiler-resolved symbol
   index, name-based resolution is this map's ceiling. `derive-codebase-context` makes the
   argument in full — a symbol index is the only thing that answers blast radius correctly in a
   repository with duplicate exported names, and it costs roughly a week, which is why the cheap
   layers come first and layer 4 is deferred deliberately. A map produced under a deferred
   layer 4 reports at that ceiling and says so; it does not quietly promise the precision of an
   index it does not have.

10. **Hand the map on, whole.** `visualise-blast-area` renders the envelope, blindspots included
    as visible nodes. `land-complex-change` converts the surfaces into a touch-set budget and one
    regression gate per affected surface. `resolve-problem-report` compares candidates by their
    maps. Hand over the envelope and the coverage together — a consumer given only the nodes will
    treat the blank cells as checked.

11. **Document the run when the branch calls for it.** The convention is below, and it is
    identical in every skill of this family that supports it.

### The run record

**Documenting the run.** Write a full record when the invocation carries `--document` (or
an unmistakable phrase such as "document the run"), at `docs/blast-area/<UTC-date>-<slug>.md`
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
I want to drop the status column from the jobs table. Map what that would hit before I write
the migration — and tell me for each thing whether it breaks at compile time, at runtime, or
not at all until someone notices the number is wrong. Include the deploy ordering and say why
it is that way round.
```

```text
We are renaming this exported helper across the monorepo. Walk all eleven surfaces, including
the ones you think are empty — and for every empty one, show me the search and the control
that proves the search was working. I have been burned by a clean grep before.
```

```text
Before I delete this endpoint: who outside this repository calls it? If you cannot see them
from here, say so on the map rather than leaving that surface blank, and tell me what would
settle it.
```

```text
Two candidate fixes, same bug. Map each one and compare them by what they disturb and by what
each one cannot undo — I care more about reversibility than about elegance here.
```

```text
Map this change set and document the run (--document) so I can hand the evidence to review
with the pull request. I especially want the "what this map cannot see" section; last time
the surprise was a prompt row in the database that no code search would ever have found.
```

## Pitfalls

- **A file list handed over as a blast map.** Files say where to look. A decision needs what
  happens, when it surfaces, and what the list left out.
- **The blank cell that was never searched.** It renders exactly like a searched-and-empty one,
  and the reader cannot tell them apart. This is the failure that makes maps dangerous rather
  than merely incomplete.
- **A zero-hit search read as absence.** One extra command prevents it. A control that fires
  proves the apparatus worked; without it, the finding is about your regex.
- **Grepping for data-resident references.** Prompt rows, saved queries and flag definitions
  live in a datastore. No code search will ever return them, and the break they cause is silent
  — the system keeps running and does something else.
- **Counting one compiler.** The file is processed by every toolchain configured to process it,
  and they disagree. A construct that typechecks, passes tests, and is unresolvable in the
  deploy bundle is found after deploy or not at all.
- **Emitting one deploy ordering by habit.** Schema-first and code-first are each correct in
  one direction and destructive in the other. The ordering without its reason cannot be checked
  by the person who has to run it.
- **Forgetting the derivers.** Writers and readers are the obvious two buckets. The third —
  anything computing a second value from the first — is where the value silently changes while
  both ends stay correct.
- **Guards assumed to still fire.** A guard whose pattern no longer matches anything does not
  fail. It passes, in green, forever.
- **A bare symbol name in a child brief.** The common names in a real repository are the
  framework's own conventions, and a name-keyed search returns the whole application.
- **Confidence as a percentage.** Nobody computed it. It travels into other people's decisions
  looking like a measurement.
- **Accepting the whole brief, or rejecting it.** Both are cheaper than the correct answer,
  which is usually: these premises hold, this one does not, here is the number.
- **Skipping "what this map cannot see" because the map looks complete.** A map that looks
  complete is exactly when the section is load-bearing.
- **Shaping the map for the diagram.** Decide first, render second. `visualise-blast-area`
  consumes the envelope; it does not get a vote in what goes into it.

## Verification

- [ ] The brief was restated as a change set, with a thing and an operation per element.
- [ ] Any premise that did not hold was rejected explicitly, with a number, and the surviving
      premises were carried forward rather than the whole brief refused.
- [ ] The searching was delegated to `investigate-codebase`, and every by-symbol child was
      briefed with a definition site rather than a bare name.
- [ ] **All eleven surfaces appear in the output in the fixed order, including empty ones.**
- [ ] Every item carries a break time: `compile`, `runtime`, or `silent`.
- [ ] Surface 8 states whether the datastore was queried, and names it — or records that no
      store was reachable.
- [ ] Surface 6 names every build toolchain that processes the changed files, counted rather
      than assumed.
- [ ] Every empty cell carries its verbatim query, the control, whether the control fired, and
      a verdict of `absent` or `inconclusive`.
- [ ] Deploy ordering is stated **with its reason and its direction**, plus what runs in the
      window between the halves — or is recorded as expand-migrate-contract when neither half
      can go first.
- [ ] Every surface and every edge carries a confidence from the closed vocabulary:
      `enumerated`, `measured`, `sampled`, `inferred`, `not checked`. No percentage appears.
- [ ] **Every edge carries both a confidence and its evidence.**
- [ ] The output envelope validates: `meta`, `surfaces`, `nodes`, `edges`, `blindspots`, with
      one state per node and fixed surface ids.
- [ ] **"What this map cannot see" is present**, and answers all four named limits: dynamic
      dispatch and the registries found; data-resident references and whether the store was
      queried; resolution basis with the collision count or its absence; runtime-only edges.
- [ ] The precision-ceiling clause is stated where no compiler-resolved index exists.
- [ ] Nothing in the repository was changed, and nothing was committed except a run record that
      was explicitly asked for.
- [ ] Where a record was written, it exists at `docs/blast-area/<UTC-date>-<slug>.md` (or the
      harness scratch path for an unattended run, named in the final answer), under the five
      required headings.

## Deeper reading

- [The eleven-surface checklist](references/surface-checklist.md): every surface with what to
  enumerate, the probe that enumerates it, the trap it exists to catch, and its default
  confidence ceiling.
- [Break timing](references/break-timing.md): the compile / runtime / silent taxonomy, the
  decision questions that place an item, the language and toolchain cases, and why the silent
  class is the one worth the walk.
- [Deploy ordering](references/deploy-ordering.md): both directions with their reasons, the
  window and the drain question, expand-migrate-contract, and the orderings that are not
  orderings.
- [The output contract](references/output-contract.md): the envelope field by field, node
  states, edge kinds, the confidence vocabulary applied, and a full worked example ready for
  `visualise-blast-area`.
- [A worked blast map](references/worked-blast-map.md): one column drop mapped end to end,
  including the refuted premise, the searched negative that decided it, and the blindspot that
  survived.
- [The run-record convention](references/documenting-the-run.md): when a record is written,
  where it goes, its five headings, the prohibitions, and a worked record.
