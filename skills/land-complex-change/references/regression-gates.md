# The regression gate ladder

One gate per affected surface, and each gate **watched failing before the change and passing
after**. That is the whole discipline. Everything below is how to reach it on surfaces where
it is awkward, and what to write down when you cannot reach it at all.

The failure this prevents is not a broken guard. It is a guard that was never capable of
failing: green on the day it was written, green forever after, counted as coverage in every
subsequent conversation. In one measured repository four separate CI guards were added in that
state — one of them a regex that could never match, because the pattern used an escape the
matching engine does not support. Nothing detected them, because a guard that cannot fail
produces exactly the output everybody wants to see.

## The ladder

Per affected surface, take the highest rung you can actually reach, and record which rung it
was. The rung is part of the deliverable: rung 3 and rung 1 are both "guarded", and they are
not the same claim.

| Rung | Guard | Evidence that it is armed | Typical cost |
|---|---|---|---|
| 1 | an automated check that **fails before and passes after** | the failing output, quoted, from before the change | minutes |
| 2 | an automated check that cannot fail first — the work is purely additive | a recorded baseline **plus a mutation**: break the thing deliberately, watch the check fail, restore, watch it pass | a minute more |
| 3 | a written manual observation with an expected value | the procedure, plus the before-value recorded | minutes to hours |
| 4 | **none** | the surface recorded as unguarded, with what would guard it and what that costs | free, and the most useful row on the page |

### Rung 1 — fail first, for the right reason

Run the check before the change and read the failure. The trap is a failure that looks right
and is not: the file does not exist yet, the import is misspelled, the fixture is missing, the
test name has a typo so the runner selected nothing and reported success on zero tests. A run
that fails because the apparatus is broken proves the apparatus is broken. Read the message.

### Rung 2 — mutation, because additive work cannot fail first

Some correct work cannot make an existing check fail: adding a new column nothing reads yet,
adding a handler nothing calls yet, widening an accepted input. There is nothing to break, so
there is no failing state to observe. Substitute a **mutation**:

1. Deliberately break the thing the guard is supposed to protect — flip a boolean, delete a
   line, change the expected value.
2. Run the guard. Watch it fail. If it passes, the guard does not cover that thing, and you
   have just learned the surface is at rung 4, not rung 2.
3. Restore. Run again. Watch it pass.

Three commands. It converts "there is a test for this" from a claim into an observation.

### Rung 3 — a manual observation is a real guard if it is written

A written procedure with an expected value is checkable by someone else and repeatable next
week. "I clicked through it and it looked fine" is neither. Record the steps, the value you
observed before the change, and the value you expect after.

### Rung 4 — unguarded, and said out loud

A surface with no reachable guard is recorded as unguarded **in the deliverable**, not in a
thought and not in the run's scrollback. The row carries: the surface, why no guard exists,
what would guard it, and roughly what that would cost. This row is frequently the most
valuable output of the entire run, because it is the only artefact anyone produces that says
where the tests are not.

## Guard classes by surface

Mapping the map's surfaces onto the kinds of guard that fit them:

| Surface | Guards that reach it | Notes |
|---|---|---|
| Callers | typecheck, unit tests at the call sites | a typed language gives rung 1 almost free; a dynamic one usually does not |
| Data contracts and derivers | a test asserting the **derived** value, schema validation, a round-trip test | the deriver is the bucket that gets skipped, and the one where both ends stay correct |
| Background jobs and registries | a registration assertion — "this key appears in the registry" — plus one execution test | a job that stops registering fails silently and forever |
| UI | component or end-to-end test on the specific route, including the empty and error states | the empty state is where a removed field renders as nothing |
| Tests and guards | the mutation above, applied to the guard itself | this is the surface most likely to be quietly dead |
| Config, infra, toolchains | run **each** build pipeline that processes the file, not just the one in your terminal | one construct, several toolchains, several behaviours |
| Deploy ordering | a rehearsal against a disposable environment, or a written window analysis | rarely rung 1; usually rung 3, honestly labelled |
| Docs, prompts, data-resident references | a query against the datastore, asserting the count of rows naming the thing | no code search reaches these; the break is always silent |
| External consumers | a contract test, a recorded schema, or a notification with a date | often rung 4 — say so |
| Second-order readers | an assertion on the aggregate or the downstream value | the value changes quietly and nothing throws |
| Reversibility | a rehearsed revert on a disposable copy | proves the undo path exists rather than assuming it |

## How guards go quietly dead

Four mechanisms, all observed in real repositories, all producing green:

- **The pattern that matches nothing.** A grep-based guard whose regex is subtly invalid, or
  whose target was renamed. It now scans for something that does not exist and reports success.
- **The selector that selects nothing.** A test filter, tag, or path glob that no longer
  matches any file. The runner reports zero failures out of zero tests.
- **The assertion inside a swallowed path.** The code under test catches its own errors by
  design; the test asserts "it did not throw", which was never in doubt. Assert the inner call
  fired, not that the wrapper stayed quiet.
- **The check that never ran in this configuration.** The job is defined but skipped for this
  branch, this path filter, or this event type. Confirm it ran on the change, not that it
  exists in the file.

Each of these is caught by the same one-minute mutation. None of them is caught by reading the
guard's source and agreeing with it.

## Closing the ladder

After the change, run every gate again and record the result beside its fail-before evidence.
Three outcomes, and the third is the one that must not be rounded off:

- **Passed, having failed first** — the gate did its job.
- **Passed, mutation-armed** — rung 2, evidence recorded.
- **Unproven** — it passes now and it never failed first. Not a pass. Common cause: the guard
  does not actually cover the surface it was assigned to, which means the surface is at rung 4
  and the ladder has a hole where it claimed a rung.

Never edit a guard to make it pass. In a refactor that edit is the behaviour change announcing
itself; in a feature it is the gate being lowered to meet the work. If a guard's expectation is
genuinely wrong, that is its own change, with its own review, and the reason belongs in the
record rather than in the diff alone.
