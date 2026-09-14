# Entry points

Three, and they share one procedure. They differ in what they may touch, which steps they run, and
what comes back. The word that selects one arrives however the harness delivers it: as the word after
the skill name, as an `ARGUMENTS:` line appended to these instructions, or as the request's own
phrasing. No entry point is a flag, and none of this is frontmatter: a skill is portable only through
the text of SKILL.md.

## Choosing one, without asking

| The request | Entry point |
|---|---|
| `check`, `need`, `audit`, `review`; "is the documentation still true", "what does this repo need" | `audit` |
| `draft`, `ensure`, `write`, `layer`; "give it a readme and a how-to-use file", "make it follow the standard" | `draft` |
| `update`, `refresh`; "the code moved under the docs", "bring the docs up to date" | `update` |
| No word at all, or a word not listed here | `audit`, and the announcement says the word was not recognised |
| A **listed** drafting word, on a repository whose layers do not exist yet | `draft`, with the files it will create named before drafting |

A request that names no file to produce and asks for no change is an `audit`. Guessing toward
read-only costs the reader one word; guessing the other way costs them a diff they did not ask for.

Never stop to ask which entry point to run. State the one chosen, and let the reader redirect.

## `audit` — read-only

**Scope.** Every tracked documentation file at the baseline revision. Research and evidence records
are read for contradictions but never listed as rot to fix.

**May write.** Nothing inside the repository — no draft, no correction, not the baseline line. The
newcomer may edit a disposable clone, which is reverted and whose remote is made inert first.
Anything the run saves — the claim list, the credential scan — lives outside the working tree, at a
path the report names.

**Runs.**

1. Prerequisites 1, 2, 3, 5 and 6. Prerequisite 4 is not applicable: nothing is replaced, so there
   is no scope list and no loss audit. Prerequisite 5 still applies — the newcomer test runs here
   too, against the documentation as it stands.
2. Step 1 in full, including the docs map checked against the list of tracked files, and whether a
   tier line exists at all.
3. The description check — the registered description against the README's description line — which
   in a drafting run sits inside step 3.
4. Step 2, after reading the repository's standing instructions for agent sessions.
5. Step 6, pass one over the documentation as it stands, pass two over every layer file.
6. The newcomer test on the main task only, labelled degraded whenever the session that runs it has
   already read the source.
7. Named as not applicable, never silently skipped: step 3 beyond the description check and the
   trigger plan; step 4, since nothing is replaced; and step 5's fix-and-re-run loop, since nothing
   was fixed. **Step 7 always runs.**

**Where the layers do not exist yet,** step 3 runs as a plan and not a draft: each trigger quoted,
marked fired or not fired, with the file it would create and what would go in it.

**Hands back.** The report contract, plus two saved files it links: the numbered claim list with a
verdict each, and the credential scan, every finding by file and line with the value unread. Both
are offered rather than pasted, and every count in the report is taken from those rows.

## `draft <files>` — writes the layers

**Scope.** The files named in the request. Where none are named, the layers whose triggers have
fired, listed and announced before any drafting starts.

**May write.**

- Those files, uncommitted.
- Pointer-only edits in files that link to content that moved.
- The baseline line under the docs map — `sources re-read at <sha>` — which is the line a later
  `update` looks for.
- A one-line status correction in a document the new layers route readers to, where leaving it would
  make the drafts contradict it. Anything larger there is reported as a blocker the drafts introduce,
  not quietly fixed.
- Nothing else. Records, research and other repositories are not touched.

**Runs.** All seven steps, with four emphases. Only the last is drafting's own; the procedure
states the other three for every entry point.

- The loss audit is saved as a row table before any total is quoted, and every total is counted from
  it.
- In a repository that is documents only, the newcomer's task is to find the home of a named fact and
  prepare the change, stopping before anything is pushed.
- Any edit made in step 6 sends the newcomer test back to a clean state and it runs again.
- The repository's own test suite runs with the drafts in place, because a test that reads the
  documentation as data fails on a rewrite that is otherwise correct.

**Hands back.** The report contract, every weakened and lost row individually, and the commands that
would land the change — branch, add, commit, open a pull request — written out and not run.

## `update` — the delta since the docs were written

**Scope.** The range from the previous baseline to `HEAD`, and the files that changed in it. The
previous baseline is the revision recorded under the docs map as the one whose sources were last
re-read. Where no such line exists, use the last commit that touched the docs map **before `HEAD`**,
or the commit that created it, and say that is what was used: the docs map's own most recent commit
is usually the documentation change itself, which would give an empty range and a run that reports
nothing moved.

**May write.**

- Passages of the README and the manual that the diff has overtaken.
- Working documents whose own edit rule allows it — struck through and dated, never rewritten — as a
  separate patch, kept apart from the layer files.
- The baseline line itself, which is the one freshness stamp this skill permits, because it names a
  revision somebody actually re-read.
- Never a record, a research file, an agent file, or anything in another repository.

**Runs.**

- Step 1 only where files were added or removed.
- Step 2 over the changed files, plus every claim whose cited source moved in the range.
- Step 4 over the edited passages, with the sixth verdict, `corrected`, for a passage the update
  brings back into line.
- Step 5 only where a command, a path or a step of a task changed. Otherwise the report records
  "not run: no task path changed", which is a result and not a gap.
- Step 3 over the overtaken passages only, drafted from source like anything else this skill writes.
- Step 6 over the edited passages only.
- Step 7 always.

**Hands back.** A delta report: the range, what moved, the patches, what is stale that this entry
point may not touch and whose it is, the owner's decisions, and the unknowns.

## The announcement

One line, before the first read, on every entry point:

```text
layer-repository-docs · audit — read-only, baseline <baseline-sha>; writes nothing in the repository; report only
```

It carries the entry point, the baseline, what may be written, and what comes back. Reading git
metadata — the clone, `rev-parse`, the log — comes first, because the line carries the baseline;
reading a file for its content comes after. An `update` announces its range rather than one sha. A run that
changes entry point — an audit the reader turns into a draft — announces again rather than drifting
into writing.
