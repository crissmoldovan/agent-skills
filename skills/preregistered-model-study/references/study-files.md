# Study files

What a study directory holds, what each file must say, and the order in which they are
committed. The names are suggestions; the contents and the order are not.

## Layout

```text
<study>/
  PLAN.md                 the question, arms, metrics, bars, sample size — first commit
  FREEZE.json             a hash for every input — committed before any paid call
  dryrun/control.diff     request parity: the control's request against production's, built
                          offline — before any paid call
  dryrun/<arm>.diff       each arm's request against production's — before any paid call
  parity/                 output parity, the first paid stage: the control's answers against
                          production's stored ones, under the stage's own cap
  addenda/<date>-<slug>.md   one per change after the first paid call
  code/                   harness, budget guard, judge runner, scorer — every file hashed in FREEZE
  config/                 every configuration the code reads — hashed in FREEZE
  <lock file>             the dependency lock — hashed in FREEZE, with the runtime's version
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
  A1..Ak       A run <k> times over the same items, for the A/A distribution (why <k>: <reason>)
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
Output parity (the first paid stage):
            control only, on <n> items drawn by <rule>; pass rule: <agreement with production's
            stored answers, and how it is measured>; stage cap <amount>, inside the study cap.
            A fail stops the study with an addendum.
Budget:     study cap <amount>; stage caps: output parity <amount>, main run <amount>, judging
            <amount>; balance floor <amount>, read before every admission (or "unavailable":
            no balance endpoint); ceiling price per model = the largest of list, list + <margin>%,
            and the provider's maximum, for every billable unit (tokens, per-request fees, images,
            audio, hosted search, tool invocations), each capped in the request; one paying
            process holding an operating-system lock, calls one at a time.
Stop rule:  stop and write an addendum if <condition>.
Not covered: <item types, providers, volumes this study will not speak to>
```

## FREEZE

One entry per input, hashed, with enough identity that a reader can find the same thing again.

```json
{
  "written_on": "<sha of the parent commit this file was written on>",
  "items": { "file": "data/items.jsonl", "sha256": "<hash>", "rule": "<selection rule>", "seed": 0 },
  "prompts": [{ "arm": "A", "file": "prompts/a.txt", "sha256": "<hash>" }],
  "policies": [{ "file": "policies/<name>.md", "sha256": "<hash>" }],
  "judge_prompts": [{ "judge": "J1", "file": "judges/rubric.md", "sha256": "<hash>" }],
  "models": [{ "arm": "A", "model": "<model id>", "provider": "<pinned provider>" }],
  "params": [{ "arm": "A", "file": "params/a.json", "sha256": "<hash>" }],
  "price_tables": [{ "file": "prices/<provider>.json", "sha256": "<hash>", "covers": "every billable unit of every model the study calls" }],
  "code": [
    { "file": "code/harness.<ext>", "sha256": "<hash>" },
    { "file": "code/guard.<ext>", "sha256": "<hash>" },
    { "file": "code/judge.<ext>", "sha256": "<hash>" },
    { "file": "code/score.<ext>", "sha256": "<hash>" },
    { "file": "reproduce.sh", "sha256": "<hash>" }
  ],
  "config": [{ "file": "config/<name>", "sha256": "<hash>" }],
  "runtime": { "name": "<runtime>", "version": "<exact version>", "lock": { "file": "<lock file>", "sha256": "<hash>" } },
  "metric_definitions_checked_against": ["<item id>", "<item id>", "<item id>"]
}
```

The freeze covers everything the harness and the guard read, not only what the arms are judged on,
and **every executable and every configuration that can change a request, a spend decision or a
verdict**: the harness that builds the requests, the guard that admits and settles them, the judge
runner, the scorer, `reproduce.sh`, every configuration any of them reads, and the runtime's version
with its dependency lock. A freeze of the scorer alone leaves the request builder, the guard and the
judge runner free to change after the dry run under a freeze that still looks complete. List the
files by walking `code/`, `config/` and every path the code opens, not from memory. The freeze is
taken after the budget guard is built and armed, so that the guard it hashes is the one that runs.
An addendum that changes a frozen file updates that file's entry in FREEZE.json in the same commit,
and records the old hash.

Each arm's request parameters are hashed, because a sampling parameter changed after the freeze
changes the comparison while the prompts still match. Every price table the guard reads is hashed,
because a price changed after the freeze changes every reservation and every settlement, and the
offline reproduction of the spend with them.

The last field is not decoration. It names the real items each metric definition was read
against before freezing, including the awkward ones — a field that does not apply, an empty
source, a source that contradicts itself.

A file cannot name the commit that adds it: that sha does not exist until the file is committed,
and writing it in afterwards changes the file and so the sha. The freeze records the commit it was
written on. The commit that adds it is recorded afterwards, in a later record — the audit's
timeline in the next commit, or the pull request's description.

## ADDENDUM

```text
# ADDENDUM <n> — <date> — <slug>
Written on: <sha of the parent commit>   Governs calls: <batch or range>   To be committed before them

What changed:  <one paragraph>
Why:           <what was found, and how>
Effect:        <which numbers move, measured: before -> after, or "none, measured by <command>">
Alternatives:  <what else was considered>
```

The addendum's own commit, and the time of the first call it governs, are recorded in the audit
once both exist, so that "committed before the calls it governs" can be checked from two records
rather than asserted by one. A change found after its calls ran is recorded the same way, marked
"Committed after the calls it governs", with the calls it should have governed. That is a
correction, and it is stated as one.

## reproduce.sh

It runs offline, with no key, from a clean checkout, and refuses to compute anything if an input,
the runtime or a dependency changed.

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# 1. Every file FREEZE.json names — code, config, prompts, price tables, the dependency lock — has the
#    hash FREEZE.json gives it, and a row in the manifest; and the runtime is the frozen one. This
#    reads the freeze, not the manifest, so a deleted manifest row stops the run here.
<each "file" and "sha256" pair in FREEZE.json, printed as "<sha256>  <file>"> | shasum -a 256 --check --quiet
<each "file" in FREEZE.json has a row in MANIFEST.sha256, or exit 1>
test "$(<runtime> --version)" = "<exact version from FREEZE.json>" || { echo "runtime is not the frozen one" >&2; exit 1; }

# 2. Every input is what the manifest says it is. A changed or missing file stops the run here.
shasum -a 256 --check --quiet MANIFEST.sha256

# 3. The dependencies come only from the lock step 1 checked, with no network.
<install the dependencies from the lock file only, from a vendored copy or a local cache, offline>

# 4. Rebuild every table from committed data, offline. The loader opens only manifest-listed
#    paths, so a file the manifest forgot to list cannot be read silently.
<runtime> code/score.<ext> --offline --manifest MANIFEST.sha256 --in data --out tables.rebuilt

# 5. The rebuilt tables are byte-identical to the committed ones.
diff -r tables tables.rebuilt
rm -rf tables.rebuilt
echo "reproduced: every table matches"
```

A clean checkout on another machine runs whatever runtime and packages it has installed, so a
byte-identical rebuild needs both pinned: the runtime's version checked before anything runs, and the
dependencies installed only from the lock the freeze hashes — or the whole script run inside a
container image named by its digest. Where the data classification keeps raw data out of the
repository, the manifest lists the private copies by hash, and the script reads them from where the
plan says they are kept.

The manifest check in step 2 catches a changed file. It cannot catch a file that was never listed,
and that is the gap that bites: a file read from another study, changed there, and never noticed
here. Close it in the loader: route every read through one function that refuses a path the
manifest does not list. A file the study consumes is then either listed or a loud failure.

## The report and the audit

The report is written for the decision: the verdict per bar, then quality, harm and cost per arm,
then each judge alone, the A/A distribution, every correction, and what the study does not cover. Every
arm appears in every chart, the control included.

The audit is written for the next person to doubt the result. It carries:

- a stage-by-stage timeline, with the commit each stage ran from;
- the commit that added the PLAN, the FREEZE, the dry run and each addendum, and the time of the
  first paid call after each — recorded once those commits exist, since none of those files can
  name its own;
- the spend per stage, from the guard's ledger, against that stage's cap and the study's;
- every failure — a refused call, a malformed response, a timeout — and how it was scored;
- every correction, with the outputs before and after, and the addendum or review record that
  carries it;
- the checksums, and the one command that verifies them.

Record each stage as it happens. An audit reconstructed at the end from memory has the shape of an
audit and the reliability of a recollection.
