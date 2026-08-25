# The twelve-surface checklist

Walk them in this order, every time, including the ones you expect to be empty. The order is
fixed for two reasons: two maps of the same repository become comparable, and an empty surface
stays visible as an empty surface rather than disappearing into the gap between two others.

Each surface below carries: **what to enumerate**, **how to enumerate it**, **the trap** it
exists to catch, and **its confidence ceiling** — the best value from the fixed vocabulary
(`enumerated`, `measured`, `sampled`, `inferred`, `not checked`) that this surface can honestly
reach with the tools you actually have.

---

## 1. Callers — `callers`

**Enumerate:** every call site of every changed definition, plus re-exports, barrel files,
wrappers and any place the symbol is passed as a value rather than called.

**How:** a language server or symbol index if one exists — ask it for references to the
**definition**, not for occurrences of the name. Without one: `git grep -n` on the name, then
open every hit and discard the ones that resolve elsewhere. Add the import-side search, because
a rename that leaves the import intact still breaks at the call.

**The trap:** a bare name. In a monorepo of roughly 2,500 TypeScript files, one measured pass
found 184 exported names defined in more than one file; the worst offenders were the framework's
own conventions — one handler name in 271 files, another in 209, a registry key in 143. A search
keyed on such a name returns the whole application, and a map built from it is noise with
citations.

**Ceiling:** `enumerated` with a compiler-resolved index; `measured` with grep plus opened hits;
never better than `measured` where the language permits dynamic access.

---

## 2. Data contracts and derivers — `data-contracts`

**Enumerate:** three buckets, and the third is the one that gets dropped.

- **Writers** — anything that produces the value: inserts, updates, event emitters, fixtures.
- **Readers** — anything that consumes it: queries, DTOs, deserialisers, exports, API responses.
- **Derivers** — anything that computes a *second* value from the first: aggregates, scores,
  cached rollups, denormalised copies, materialised views, report columns.

Include the schema objects themselves: constraints, indexes, defaults, triggers, generated
columns, and any view that selects the changed thing.

**How:** search the schema, then search **string literals** for the column or field name, in
every language in the repository — the query that will break is frequently assembled as text and
therefore invisible to every type system present. Then follow each writer one hop to find the
derivers.

**The trap:** the writer and the reader both stay correct while the transformation between them
quietly changes what the value means. In one measured case the defect lived exactly there, and
both ends passed review.

**The second trap — the discard by filename.** Every literal search on this surface returns hits
you will not keep, and how they are dropped decides whether the surface is measured or merely
plausible. **Classify a hit by the table its query text targets, read out of the query.** Not by
the file's name, not by the directory, not by the module's apparent domain: a report module can
hold a query against the ingest table, an "export" helper can select from three tables, and a
generic data-access file can name every table in the schema. Open the hit, find the `FROM` or
the builder call, and record the target.

An **exclusivity claim** — "only this service reads the column" — is a statement about the
discards, so it ships with them:

```text
discarded | path:line | query text as written | target it resolves to | why it is not this table
```

Worked failure: a string-literal `SELECT` against the changed table was discarded because it
lived in a module whose name belonged to another subject. Nothing about the query was read. The
map went out claiming a single reader, the drop was approved on that basis, and the second
reader failed at runtime — silently, because the query was assembled as text and no type system
ever saw it.

**Ceiling:** `enumerated` for constrained relationships the database itself knows (foreign keys,
view dependencies); `measured` for literal searches; `not checked` for any language you did not
search — say which.

---

## 3. Background jobs and their registries — `jobs`

**Enumerate:** tasks, queue consumers, cron entries, workers, schedulers — and, separately, the
**registry** each must appear in to run at all: a keys file, a manifest, a decorator scan, an
import side effect in an entrypoint.

**How:** read the registry, then open the file it cites, then check the runtime's own
registration path. A generated registry is evidence of what its generator saw at generation
time — it is not the runtime.

**The trap:** a job that stops registering does not fail. It stops existing. Nothing throws,
no test turns red, and the symptom is an absence of work that surfaces when someone asks why a
number stopped moving. Treat "still registered after the change" as a claim requiring evidence,
not as a default.

**Ceiling:** `enumerated` where the registry is the thing the runtime actually reads;
`measured` where you searched for registrations; `inferred` if you only read a doc.

---

## 4. UI — `ui`

**Enumerate:** screens, routes, components, and the empty, loading and error states that render
the changed value. Include admin surfaces, internal tools and anything rendered only for one
role — those are the ones nobody remembers.

**How:** search by field name and by prop name, then by the query or selector that fetches it.
Follow the component tree upward far enough to name the route.

**The trap:** the UI break is invisible until someone opens that route, and a missing value
frequently renders as blank rather than as an error. A blank field is a silent break wearing a
normal face.

**Ceiling:** `measured`; `sampled` when there are more routes than you opened — state n of N.

---

## 5. Tests and guards that would stop firing — `tests-and-guards`

**Enumerate:** two distinct sets.

- **Tests that would fail** — these are the friendly half. They are the change's alarm system.
- **Guards that would stop firing** — CI checks, lint rules, architecture-boundary configs,
  allowlists, denylists, assertion helpers, schema validators, security checks: anything whose
  behaviour is keyed on a pattern that mentions the thing you are changing.

**How:** grep the guard configurations for the old name. Then, for each guard you depend on,
**mutate something it should catch and confirm it fails.** A guard that has never been shown to
fail is a claim, not a control. In one measured repository, four separate guards were born
unarmed and passed every run while verifying nothing.

**The trap:** a guard whose pattern no longer matches anything does not fail. It passes, green,
indefinitely — and the protection it advertised is gone at exactly the moment it was needed.

**Ceiling:** `measured` for the pattern search; `enumerated` only for a guard you mutated and
watched fail.

---

## 6. Config, infra and every build toolchain — `config-and-toolchains`

**Enumerate:** environment variables, secrets *by name only*, deploy manifests, IaC, container
definitions, feature-flag defaults — and **every compiler, bundler, transpiler or transform
configured to process the changed file**: the typechecker, the test runner's transform, the
application build, the deploy bundler, any codegen step.

**How:** count the build manifests rather than assuming one. Then, for each toolchain, establish
what it does with the specific construct being changed — dynamic imports, path aliases, decorator
metadata, conditional exports and generated types are where they diverge.

**The trap:** one construct, three toolchains, three behaviours. In one measured monorepo, four
build pipelines processed overlapping file sets, and a module specifier that typechecked cleanly
and passed the whole test suite was unresolvable in exactly one of them. It was discovered after
deploy, because only that pipeline's bundler ever saw it.

**Ceiling:** `enumerated` for the toolchain list itself (the manifests are countable); `measured`
per toolchain only if you ran it.

---

## 7. Deploy ordering — `deploy-ordering`

**Enumerate:** the halves of the change that land separately, the required order, and what runs
in the window between them.

**How:** ask which half breaks the other when it runs alone. The full procedure, both directions
with their reasons, and the case where neither half can go first, are in `deploy-ordering.md`.

**The trap:** an ordering emitted by habit. Both directions are correct in the same repository
depending on which way the change runs, so an unconditional answer is wrong about half the time —
and an ordering without its reason cannot be checked by the person who has to execute it.

**Ceiling:** `measured` when you can name what runs in the window; `inferred` otherwise, and say
so.

---

## 8. Docs, prompts and data-resident references — `docs-and-data-resident`

**Enumerate:** prose in the repository that names the thing — and, separately, **rows in a
datastore that name it**: prompt templates, saved queries, report definitions, feature-flag
targeting rules, seeded configuration, workflow step definitions, tool allowlists.

**How:** grep for the docs. **Query** for the rows. If the store is not reachable from this run,
that fact goes on the map as a blindspot with the query that would settle it — not as an empty
cell.

**The trap:** no code search will ever return a database row, and the break it causes is silent
by construction. A prompt row naming a renamed tool does not throw; the model simply does
something else, and the output stays plausible. This is the surface most often skipped and most
reliably expensive.

**Ceiling:** `measured` when you ran the query; `not checked` when you did not — never `absent`.

---

## 9. External consumers — `external-consumers`

**Enumerate:** other repositories, published packages and their dependants, API clients, webhook
subscribers, warehouse and analytics jobs, partner integrations, dashboards, saved exports.

**How:** diff the published interface, not the internal one. Check access logs where they exist —
production observation is the highest evidence class available here. Otherwise work from the
consumer list assembled in the prerequisites, and mark anything you could not confirm.

**The trap:** the break happens in somebody else's system, at their deploy cadence, and reaches
you as a support ticket days later with no obvious connection to your change.

**Ceiling:** `enumerated` only with a real consumer registry or complete access logs; otherwise
`sampled` or `inferred`, with the gap named.

---

## 10. Second-order readers — `second-order`

**Enumerate:** for every write the change touches, who reads that write — and then, one hop
further, who reads *their* output.

**How:** follow each writer one hop, then one more. Two hops is the working limit; past that,
record the frontier as a blindspot rather than pretending to a full closure.

**The trap:** the first-order map is complete and correct, and the damage lands two hops away in
an aggregate that keeps producing a number. Nothing throws. The number is just wrong, and it is
wrong in a report someone trusts.

**Ceiling:** `measured` for the hops you followed; always name the hop at which you stopped.

---

## 11. Reversibility and the undo path — `reversibility`

**Enumerate:** what a revert restores, what it does not, and the data a rollback cannot bring
back. Classify each element of the change set as:

- **revertible** — a commit revert restores the prior behaviour completely;
- **compensating** — undo requires a new forward change (a second migration, a backfill);
- **irreversible** — dropped data, sent messages, deleted rows, external side effects.

**How:** write the rollback steps *before* the change, at the same level of detail as the change
itself. If they cannot be written, that is the finding.

**The trap:** "we can always roll it back" as an unexamined premise. It is true of code and
frequently false of data, and the two halves of a change usually differ — which is also why this
surface constrains the deploy ordering rather than merely reporting on it.

**Ceiling:** `enumerated` — this one is a property of the change set you wrote down, so there is
no excuse for `inferred` here.

---

## 12. Work in flight — `work-in-flight`

**Enumerate:** every piece of unmerged or unapplied work that touches the same objects as this
change set — open branches, open pull requests, stacked or draft changes, and **migrations that
are written but not yet run**. The unit is the object, not the file: a branch renaming the same
symbol collides even where the two diffs share no line.

**How:** three commands and one query, all cheap.

```sh
git branch -a --sort=-committerdate --contains HEAD~0 | head          # what exists
git log --oneline HEAD..origin/<default> -- <paths>                   # landed ahead of you
git log --all --oneline -S"<symbol>" -- <paths>                       # who else touched it
```

Then the forge, for open pull requests naming the same symbol, path or table — a code search
scoped to open PRs where the host offers one, or a listing plus a diff scan where it does not.
And the migration directory: anything present in the tree and absent from the applied history is
in flight by definition, including a version number another open branch has already claimed.

**The trap:** a checkout is one state of the repository, and the map reads as though it were the
whole of it. Two changes that each pass every check alone meet in one tree later; the collision
is reported by this map as an absence, because nothing in the working tree ever mentioned it.
Version collisions are the sharpest case — two migrations stamped identically, the second
silently skipped as already applied — but a rename landing on a branch while you delete the same
symbol is the common one.

**Ceiling:** `enumerated` where the forge is queryable and the applied-migration history is
readable; `measured` where you searched branches locally; `not checked` where the forge was out
of reach — say which, on the page. A surface reported empty because nobody could reach the forge
is the failure this surface exists to prevent.
