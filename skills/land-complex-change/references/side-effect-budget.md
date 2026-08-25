# The side-effect budget

The budget is the artifact this skill exists to produce. It is written **before the first
edit**, it is derived from the blast map rather than from recollection, and it is the thing a
reviewer checks the diff against afterwards. Written after the work, it matches the diff
exactly, proves nothing, and reads exactly like diligence — which is why the ordering is not
a stylistic preference.

A budget answers one question that a plan does not: **what is this change not allowed to
touch?** The answer is "everything not listed", and that default is the whole mechanism.

## The artifact

```text
BUDGET  <change name>  base <sha>  band <light|normal|deep>  shape <feature|refactor|migration>
map: <blast map reference or "declared, no map — light band">

ALLOWED
  path or symbol                     operation   surface           note
  src/ingest/parse.ts                edit        callers           the signature change itself
  src/ingest/__tests__/parse.test.ts add         tests-and-guards  rung-1 guard for callers
  migrations/<version>_drop_status   add         data-contracts    file only — NOT applied

EXPECTED EFFECT
  surface            what changes there                              break time
  callers            three call sites take one fewer argument        compile
  data-contracts     the column stops being selected                 runtime
  jobs               nothing — the nightly job reads a view          none (searched, control fired)

OUT OF BOUNDS
  the four standing classes (below), plus:
  - the shared formatter config: touching it rewrites files this change never read
  - the deploy workflow: it is the gate this change is judged by

ON BREACH
  stop → re-enter the mapping skill with the new fact → extend | split | abandon
  never: absorb silently
```

Plain text is enough. What matters is that each row is checkable against the eventual diff by
someone who was not there.

## Deriving the touch-set from the map

The map is per **surface**; the budget is per **thing you will edit**. The conversion is
mechanical and has three rules:

1. **Every ALLOWED entry names a surface from the map.** An entry that cannot be attributed to
   a surface is either an unmapped surface — go back and map it — or work that belongs to a
   different change.
2. **Every affected surface appears under EXPECTED EFFECT, including the empty ones.** A
   surface the map searched and found clean carries `none`, plus the search and whether its
   control fired. An empty row and an absent row look identical to a reader six days later,
   and only one of them is evidence.
3. **A node the map marks `affected` but not `changed` does not become an ALLOWED entry by
   default.** Affected means something happens there; it does not mean you edit it. Promoting
   an affected node to an allowed edit is a decision, and it gets its own row and its reason.

## The awkward entries, declared on purpose

These are the ones that get left out and then dominate the diff:

- **Generated output** — build artifacts, type definitions, an atlas or registry that a script
  regenerates. Declare which generator you will run, and that its output is expected.
- **Lockfiles** — a dependency change is a change to the dependency graph and belongs in the
  map. An incidental lockfile churn from a different tool version is a side effect.
- **Formatter and linter sweeps** — a formatter run over files this change never read is a
  side effect with a tidy diff. Declare the scope, or exclude the tool from the run.
- **Import reordering and auto-fixes** — the editor's helpfulness is still your diff.
- **Snapshot updates** — updating a snapshot is asserting the new value is correct. If it is
  correct, that is a rung-1 gate observation and belongs on the ladder; if it is unexamined, it
  is a regression being written into the baseline.

## The four standing out-of-bounds classes

Outside every budget by default, regardless of what the map contains. Each is released only by
a consent that names the specific act, at the moment of the act — never by a general approval
given at the start of the run, which was granted before anyone knew what the act would be.

| Class | What it covers | Not covered (and therefore fine) |
|---|---|---|
| **Applying a migration** | executing the schema change against a live database; running a tool that applies pending files as a side effect | writing the migration file, reviewing it, dry-running it against a disposable local database |
| **Writing to production data** | inserts, updates, deletes, a "small" backfill, running a job whose effect is a write, a script pointed at production credentials | reads, a query plan, a count, the same write against a local fixture |
| **Deleting anything not restorable from history** | data, storage objects, branches, tags, secrets, and code whose only copy is the working tree | deleting committed code, which a revert restores |
| **Sending an outbound message to a person** | mail, chat, ticket comment, notification, a status change that pages someone | drafting the message and showing it |

Add the repository's own standing exclusions to the same list. Two recur everywhere:
**history rewriting** (force-push, rebase of a shared branch) and **editing the gates** — CI
configuration, the guard patterns, the allowlists. A change that alters the guard it is being
judged by has removed the only thing capable of contradicting it, and it is not made safe by
being correct.

## The breach procedure

A breach is not a mistake. It is the map being wrong, which is the normal condition of maps.
What makes it expensive is absorbing it.

**Stop at the discovery.** Not at the end of the current edit, not after "just finishing this
file". The reason is not tidiness: the discovery is evidence that the map's method missed
something, so every other surface the same method cleared is now suspect. Continuing to work
against a map you have just falsified is the actual risk.

**Re-enter the mapping skill with the new fact.** It re-runs its searching with the discovery
as an input — often the same class of thing exists in three more places, and finding two of
them by accident is worse than finding all four on purpose.

**Then take exactly one of three dispositions, in the open:**

| Disposition | When | What it costs |
|---|---|---|
| **Extend** | the discovery belongs to this change and does not alter its shape | re-declare the budget with the new rows, announce the extension and the re-scored band |
| **Split** | the discovery is real work with its own surfaces | land what is inside the original budget; carry the rest into a change with its own map |
| **Abandon** | the discovery invalidates the approach | say what was found — that finding is usually worth more than the change was |

The fourth option — absorb it, it is small and related and right there — is the one everyone
takes by default and the one the artifact exists to remove. It is how a two-file change becomes
an eight-file change, and how review stops being about correctness and becomes an argument
about scope.

## Verifying the budget after the fact

Two checks, both cheap:

- **Diff ⊆ ALLOWED.** List the paths the change touched and subtract the budget. A non-empty
  remainder is either an undeclared side effect or an extension that never got written down.
- **EXPECTED EFFECT ⊆ observed.** For each expected effect, name the gate observation that
  confirms it happened. An expected effect nobody observed is a prediction, not a result.
