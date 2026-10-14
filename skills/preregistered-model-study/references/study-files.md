# Study files

What a study directory holds, what each file must say, and the order in which they are
committed. The names are suggestions; the contents and the order are not.

## Layout

```text
<study>/
  PLAN.md                 the question, arms, metrics, bars, sample size — first commit
  FREEZE.json             a hash for every input — committed before any paid call
  dryrun/<arm>.diff       each arm's request against production's — before any paid call
  addenda/<date>-<slug>.md   one per change after the first paid call
  code/                   harness, budget guard, judge runner, scorer
  data/raw/<arm>/         every response, stored as returned, with its cost per attempt
  data/judges/<judge>/    every judge verdict, stored as returned
  tables/                 every table in the report, as CSV
  reviews/round-<n>.md    one record per independent review round
  audit.md                the timeline, spend per stage, failures, corrections, commits
  methodology.md          how the study was run, in prose
  report.md               the verdict, written for the decision
  reproduce.sh            rebuilds every table offline
  MANIFEST.sha256         a checksum for every file reproduce.sh reads
```

Keep the study's code in its own directory and give its modules names no other study and no
standard library uses. Two studies that each carry a `score` module, both importable from the
repository root, will each run the other's on some machine.

## PLAN

```text
# PLAN — <study name>
Committed before any paid call. Changes after the first paid call go in addenda/.

Question:   Can <arm B> replace <arm A> on <task> without losing more than <X> on <metric>,
            and at what cost?
Decision:   <what changes if the answer is yes>, decided by <role>.

Arms:
  A (control)  <model> via <pinned provider>, prompt <file>, params <file>
  B            <model> via <pinned provider>, prompt <file>, params <file>
  A'           A run a second time, for the noise floor
  L            layout-only control: A's content in B's layout (only if layout or caching changes)

Items:      <n> items drawn by <rule> with seed <seed>, from <source>, frozen in FREEZE.json.
Why <n>:    the smallest difference worth detecting is <d> points; at <n> items the 95% interval
            on a difference near zero is about +/- <w> points.

Metrics (each with its predicate):
  M1 <name>: numerator <...>; denominator <...>; excluded <...> because <...>
  M2 invention: an answer given where the source cannot determine the field;
                denominator: items whose source leaves the field undeterminable

Bars:
  M1: point B-A >= -<x> points; interval: lower bound of 95% CI of B-A >= -<y>
  M2: point B-A <= <x> points;  interval: upper bound <= <y>
  A bar passes only when both its rules pass.

Judges:     J1 <vendor>, J2 <vendor>, J3 <vendor>; verdict = 2 of 3. J<k> shares a vendor with
            arm <arm>. Each judge is also reported alone.
Shortcut:   judge every item / judge only where arms differ (exactness test: <fixture>)
Budget:     study cap <amount>; balance floor <amount>; one paying process.
Stop rule:  stop and write an addendum if <condition>.
Not covered: <item types, providers, volumes this study will not speak to>
```

## FREEZE

One entry per input, hashed, with enough identity that a reader can find the same thing again.

```json
{
  "frozen_at_commit": "<sha of the commit that adds this file>",
  "items": { "file": "data/items.jsonl", "sha256": "<hash>", "rule": "<selection rule>", "seed": 0 },
  "prompts": [{ "arm": "A", "file": "prompts/a.txt", "sha256": "<hash>" }],
  "policies": [{ "file": "policies/<name>.md", "sha256": "<hash>" }],
  "judge_prompts": [{ "judge": "J1", "file": "judges/rubric.md", "sha256": "<hash>" }],
  "models": [{ "arm": "A", "model": "<model id>", "provider": "<pinned provider>" }],
  "code": [{ "file": "code/score.<ext>", "sha256": "<hash>" }],
  "metric_definitions_checked_against": ["<item id>", "<item id>", "<item id>"]
}
```

The last field is not decoration. It names the real items each metric definition was read
against before freezing, including the awkward ones — a field that does not apply, an empty
source, a source that contradicts itself.

## ADDENDUM

```text
# ADDENDUM <n> — <date> — <slug>
Applies from commit: <sha>   Governs calls: <batch or range>   Committed before them: yes

What changed:  <one paragraph>
Why:           <what was found, and how>
Effect:        <which numbers move, measured: before -> after, or "none, measured by <command>">
Alternatives:  <what else was considered>
```

A change found after its calls ran is recorded the same way, with "Committed before them: no" and
the calls it should have governed. That is a correction, and it is stated as one.

## reproduce.sh

It runs offline, with no key, from a clean checkout, and refuses to compute anything if an input
changed.

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# 1. Every input is what the manifest says it is. A changed or missing file stops the run here.
shasum -a 256 --check --quiet MANIFEST.sha256

# 2. Rebuild every table from committed data, offline. The loader opens only manifest-listed
#    paths, so a file the manifest forgot to list cannot be read silently.
<runtime> code/score.<ext> --offline --manifest MANIFEST.sha256 --in data --out tables.rebuilt

# 3. The rebuilt tables are byte-identical to the committed ones.
diff -r tables tables.rebuilt
rm -rf tables.rebuilt
echo "reproduced: every table matches"
```

The manifest check in step 1 catches a changed file. It cannot catch a file that was never listed,
and that is the gap that bites: a file read from another study, changed there, and never noticed
here. Close it in the loader: route every read through one function that refuses a path the
manifest does not list. A file the study consumes is then either listed or a loud failure.

## The report and the audit

The report is written for the decision: the verdict per bar, then quality, harm and cost per arm,
then each judge alone, the noise floor, every correction, and what the study does not cover. Every
arm appears in every chart, the control included.

The audit is written for the next person to doubt the result. It carries:

- a stage-by-stage timeline, with the commit each stage ran from;
- the spend per stage, from the guard's ledger, against the cap;
- every failure — a refused call, a malformed response, a timeout — and how it was scored;
- every correction, with the outputs before and after, and the addendum or review record that
  carries it;
- the checksums, and the one command that verifies them.

Record each stage as it happens. An audit reconstructed at the end from memory has the shape of an
audit and the reliability of a recollection.
