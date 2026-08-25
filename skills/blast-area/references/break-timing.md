# Break timing: compile, runtime, silent

An "affected files" list without **when** each break surfaces is not a decision surface. The
three classes below differ by roughly two orders of magnitude in cost, and the cheapest map in
the world is worthless if it groups them together.

| Class | What happens | Who finds it | Typical cost |
|---|---|---|---|
| `compile` | a typechecker, linter, build or codegen step rejects it | the build, before it ships | minutes |
| `runtime` | it ships and throws where the path executes | logs, error tracking, a user | hours, plus an incident |
| `silent` | it ships, executes, throws nothing, and is wrong — or stops happening at all | nobody, for a while | whatever was decided on the wrong number |

Every item on the map gets one of these, plus `none` for items that are affected but not broken
(a caller that keeps working because the change is additive still belongs on the map — it is what
makes the "affected" set trustworthy).

## Placing an item: four questions in order

1. **Does a tool that runs before deploy see this edge?** A typechecker only sees what the type
   system expresses. A string literal, a template, a JSON config, a database row and a generated
   file that is not regenerated in CI are all outside it. If nothing pre-deploy sees the edge, it
   is not `compile`, however obvious the breakage looks in the diff.
2. **Does the path execute, and does it throw when it does?** If the code runs and raises, it is
   `runtime`. Note *where* it executes: a route nobody visits, a nightly job, a retry branch, an
   error handler. Runtime breaks in rarely-executed paths behave like silent ones in practice —
   record the path, not just the class.
3. **Could it produce a wrong value, or stop producing one, without raising?** Then it is
   `silent`. Missing registration, a default that absorbs a null, a filter that now matches
   nothing, an aggregate over a column that changed meaning, a pattern-keyed guard that stops
   matching. Silence is the class this whole procedure exists to surface.
4. **Would a revert restore it?** This does not change the class; it goes to the reversibility
   surface. But a `silent` break that is also irreversible — data written wrong for a week — is
   the worst square on the board and deserves saying so explicitly.

## The cases that are always silent

- **A datastore row that names a symbol.** Prompt templates, saved queries, flag rules, workflow
  step definitions. Nothing in the build sees them; nothing throws when they go stale.
- **A registration that stops happening.** The job does not fail. It is not there.
- **A guard whose pattern no longer matches.** It passes. Green, forever, protecting nothing.
- **A deriver against a changed meaning.** Writer correct, reader correct, and the number in
  between now means something else.
- **An optional argument dropped from a call that still typechecks.** The call compiles and the
  behaviour changes.
- **A default that absorbs the difference.** `?? 0`, `COALESCE`, an empty-array fallback: the
  system keeps running on a value nobody chose.

## The case that looks like `compile` and is not

A string-built query naming a column that no longer exists. It typechecks, because no type system
was ever involved; it passes CI, because no test executed that path with a real database; and it
throws in production the first time the query runs. In one measured case, exactly this shape —
dropping a column whose only readers were string-built queries — cleared every pre-deploy gate
the repository had.

The general rule: **the type system's reach is the boundary of the `compile` class**, and that
boundary is narrower than it feels while reading typed code. Anything crossing a serialisation
boundary — SQL text, JSON config, environment variables, HTTP payloads, template strings,
reflection, a datastore — has left it.

## Toolchain-dependent placement

The same construct can be `compile` under one toolchain and `runtime` under another, which is why
surface 6 asks for the toolchains to be counted rather than assumed. A module specifier that the
typechecker resolves happily may be unresolvable to a bundler that must statically analyse it; a
decorator that one transform preserves and another erases changes class between the test run and
the deployed artifact. Where toolchains disagree, record the **worst** class of the ones that
process the file, and name the toolchain that produces it.

## Recording it

On the map, each node carries `break` as one of `compile | runtime | silent | none`, and each
`silent` item carries one extra clause: **what would be observed instead of an error** — a blank
field, a job that stops running, a count that drifts, a model that answers differently. That
clause is what makes a silent break checkable after the fact, and it is the difference between a
warning and a monitoring plan.
