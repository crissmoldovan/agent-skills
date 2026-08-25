# Gate hardening

Everything in this procedure is worthless if the gates do not gate. In the work
this skill came from, **four separate guards were born unarmed**: they passed
every run while verifying nothing, and nothing about a green run distinguished
them from the guards that worked.

This is how to tell the difference, and the four mechanisms that produced them.

## The mutation test

For every gate, before you trust it, before you report it as done:

1. **Back the file up with `cp`.**

   ```bash
   cp path/to/file path/to/file.bak
   ```

   Not with git. `git checkout -- <file>` **silently does nothing for an
   untracked file**, so on a file you just created it neither restores nor
   errors. Run it after a mutation on new work and you have thrown away the fix
   and been told nothing.

2. **Introduce exactly the thing the gate forbids.** Not something adjacent. If
   the rule forbids an import of a package, add that import, in a file the rule's
   scope covers.

3. **Run the gate. Watch it fail.** Read the message. It must name the thing you
   introduced. A failure whose message names something else is a different gate
   firing, and yours is still unproven.

4. **Restore from the backup**, and delete the backup.

   ```bash
   cp path/to/file.bak path/to/file && rm path/to/file.bak
   ```

5. **Run it again. Watch it pass.** A gate that stays red after restore was
   measuring the wrong file, or the mutation was not fully reverted.

A guard you cannot make fail is checking something other than what you think.
Treat a new guard as broken until step 3 has happened.

## The four unarmed guards

### 1. The exclusion that deleted the edges the rule matched

A dependency-cruiser config carried `exclude: node_modules`. Two rules existed to
forbid direct imports of specific npm packages. But `exclude` removes those
modules from the graph **entirely**, so the edges the rules matched were not
absent from the code, they were absent from the graph. Both rules reported
success on every run while checking nothing.

Use `doNotFollow` for npm packages instead. It keeps the edge and stops the
traversal, which is the actual intent: you want to know that the import exists,
not what the package imports next.

### 2. The path prefix that is not guaranteed

The same two rules anchored their patterns on a leading `node_modules/`. The
resolver runs through a TypeScript configuration, and a package whose `exports`
map that configuration cannot follow arrives with `couldNotResolve: true` and its
`resolved` path set to the **bare specifier**. No `node_modules/` prefix ever
appears, so the pattern never matches.

Anchor npm patterns to accept both:

```text
(^|node_modules/)package-name
```

The general lesson is larger than one tool: a rule that matches on a resolved
path is making an assumption about resolution succeeding. Check what the tool
actually emits for the case you care about, on this repository, before writing
the pattern.

### 3. The branch that could not be reached

A generator tracked whether it was inside a block comment so it could skip
commented-out declarations. The condition that entered the tracking branch could
never be true given how the lines were split upstream. The guard existed, was
covered by a test, and was dead.

Reachability is exactly what a mutation test checks. Adding a commented-out
declaration to the input and watching the count not move is the two-minute
version of this discovery, and it happened only because somebody ran it.

### 4. The guard masked by a filter after it

An atlas generator decided a route's method twice: once where the guard checked
it, and again in a filter further down the pipeline. Anything the guard would
have rejected was removed by the later filter first, so the guard never fired on
real input.

When a guard sits in a pipeline, mutate the input and confirm the failure comes
from **your** guard, by its message. A pipeline that rejects bad input somewhere
is not the same as a guard that works.

## CI traps that make a green check meaningless

### Shallow clones

`actions/checkout` gives a depth-1 clone by default. Two consequences that both
pass locally and fail on every CI run:

- `git log -1 -- <path>` returns the tip commit for **every** path, because
  there is only one commit. Per-path provenance is uniform and meaningless.
- `git rev-parse --short` abbreviates to 7 characters rather than 8, because the
  abbreviation length scales with the object count.

So never build a provenance scheme that compares a per-path SHA. Stamp HEAD,
rewrite a file only when its derived facts change, and compare bodies with the
provenance line blanked.

If you genuinely need history in CI, ask for it (`fetch-depth: 0`) and say in the
workflow why, because it is a real cost on a large repository.

### Formatters

A markdown formatter that realigns tables will rewrite generated files, and the
generated-file gate then fails for a reason unrelated to its content. In the
original work this was already breaking the context check before the atlas
existed, because the repository had no formatter ignore file at all.

Add the ignore entry in the same commit as the generator, covering every
generated path.

### A new test directory that contributes zero tests

A test runner with a workspace or projects configuration only collects from the
directories that configuration names. A new test directory outside it contributes
zero tests, the suite stays green, and the summary count moves by nothing.

After adding tests in a new location, check that the reported test count went up
by the number you wrote.

### Stale dependencies

A declared, lockfile-present package that is not actually installed will fail a
large fraction of a suite for a reason that looks like a code defect. Install
before believing any suite result, especially after a big merge.

## Ratcheting

When a rule cannot start at zero:

- Write the current count into the rule's comment, with the date.
- Set severity to warn, not error, and say in the comment what turns it into an
  error.
- Never widen the rule to make a build green. Either fix the violation or record
  an explicit exception with a written reason that survives review.

A rule whose baseline drifts upward while nobody notices is a worse outcome than
no rule, because it is a rule everybody believes in.
