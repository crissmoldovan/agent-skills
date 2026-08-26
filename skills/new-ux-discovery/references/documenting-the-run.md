# The run record — `--document`

A run that reached a good answer and left nothing behind cannot be checked, reused, or
resumed. The next person — often the same person a week later — repeats the searches,
rediscovers the same dead ends, and has no way to tell which claims were measured and
which were guessed. A run record fixes exactly that: it says what was searched, who
searched it, what each found, how the disagreements were settled, and what was decided.

It is a byproduct, never the product. Writing one must not change the answer.

This file is the whole convention. It is carried, byte-identical, by every skill in this
family, and the copies are compared by hash in CI — so edit the convention once and copy
it, never edit a single skill's copy. Never link across skills to another copy: a local
link that escapes its skill directory fails the catalog verifier.

## When a record gets written

Three branches, keyed on **attendance**. Attendance is *declared* — conservatively — and
never probed. Do not ask the harness whether someone is watching; decide from what you
already know about how the run started.

| Branch | Condition | Where it goes | Form |
|---|---|---|---|
| Asked for | `--document`, `--document=<path>`, or an unambiguous phrase | host repository | full |
| Unattended | headless, cron, CI, or dispatched by a parent agent | harness scratch directory | full (light band: short) |
| Attended, no token | a human is in the loop and did not ask | nowhere | none, plus at most one offer |

1. **Asked for.** The invocation carries `--document` or `--document=<path>`, or an
   unambiguous natural phrase — "document the run", "write down how you got there".
   Write the **full** record at the host-repository path below. A vague "keep notes"
   is not this branch; treat it as attended and offer.

2. **Unattended.** The operative test is one sentence: *if you cannot confirm a human
   will see and answer a question in THIS run, treat it as unattended.* An unattended
   run **always** writes a record, because there is nobody to ask afterwards what it
   did — and it writes to the **harness scratch directory, never the host repository**.
   An unattended run does not make unsolicited repository writes; a cron job that leaves
   a file in someone's tree has changed their working state without being asked. Name the
   record's path in the final answer, or the record is unfindable and might as well not
   exist. Normal and deep bands write the full form; the light band writes the short form
   below.

3. **Attended, no token.** Silent by default. Make **one** offer, and only when the run
   ends with an unresolved contradiction or an open blocking question — the two states
   where the value of a written record exceeds the cost of the interruption. One offer,
   ever. A declined offer ends the matter for the run; do not re-offer with better
   framing.

## Where it goes

One literal convention:

```text
docs/<skill-name>/<UTC-date>-<slug>.md
```

- `<skill-name>` — the invoking skill's own name, so records from different skills do
  not interleave in one directory.
- `<UTC-date>` — `YYYY-MM-DD`, in UTC. Local dates put two records of the same run on
  different days when the machines sit in different zones.
- `<slug>` — a short kebab-case handle for the question or the change.

There is no probe cascade. The path is not negotiated with the repository's existing
documentation layout, because a convention that guesses produces a different answer on
every repo and nobody can predict where the file will land. Determinism wins.

- **Overridable only by `--document=<path>`.** No other input moves it.
- **Create the directory if absent.** A missing directory is not a reason to skip the
  record.
- **Never inside a skill directory.** Records are host artifacts; one written under a
  skill directory ships to everyone who installs the pack.
- **Never overwrite.** A re-run against an existing path **appends** a new section,
  headed with its UTC timestamp and round number. Earlier rounds stay exactly as written.
- **Assert its existence in the skill's Verification list**, with the path stated.

## What the record contains

A header block, then **five headings, in this order, with these names**:

```text
## What was searched
## Who searched it
## What each found
## How it reconciled
## What was decided and why
```

The names are literal and identical across every skill that carries this file. In a skill
whose work is mapping, rendering, or landing rather than searching, "searched" covers
whatever that skill probed — map queries, gate runs, seeded checks. Do not rename the
headings to fit the local vocabulary; the point of fixed names is that a reader who has
seen one record can read all of them.

### The header block

Above the first heading, pin what the record is about and what it was true of:

- Repository identity — remote or name, **never** a machine-absolute path.
- HEAD sha, and the **dirty state**: clean, or the count of modified files. A record
  taken against an uncommitted tree describes a state nobody else can reconstruct, and
  it has to say so.
- UTC timestamp.
- The invocation: skill, band, and the flags as they were given.
- The question, or the proposed change, in one sentence.

### What was searched

- Every query **verbatim**, with the tool that ran it and its result count. A query
  paraphrased into prose cannot be re-run.
- The surface each query covers, and the surfaces deliberately left out.
- Artifacts *read* as well as searched — generated registries, manifests, migrations,
  dashboards, logs. Reading a registry that already answers the question is a finding,
  not a shortcut worth hiding.
- Which round each query belongs to, when there was more than one.

### Who searched it

- One line per child: **role, tier band, decomposition axis, the input it was given, and
  what was withheld from it.** Roles and tiers, never model names — routing identifiers
  belong to `model-routing`, and a record naming a model is stale the day it changes.
- **Independence.** State which children could see one another's output. Agreement
  between two children that read the same artifact is one reading, counted twice.
- When there were no children — no subagents available, or a light band — say so, and
  say the passes ran sequentially instead. A record that silently omits this reads as
  if a fan-out happened.

### What each found

- **Claims**, each with its evidence as `path:line`, its `basis` — `measured` or
  `inferred` — and its confidence expressed as basis × coverage. Never a percentage;
  a number nobody computed is a decoration.
- **`not_found[]`, each with its control and whether the control fired.** A zero-hit
  search is admissible as "absent" **only** with a fired control — a deliberately
  positive variant of the same query, run the same way, that returns hits. Without one,
  record `inconclusive`, not `absent`. This is not pedantry: in one measured case a
  `git grep -E '\b…'` returned nothing and was read as proof of absence, when ERE simply
  ignores `\b` and the search had never matched anything at all.
- **Discarded candidates** — everything looked at and rejected, with the reason for the
  rejection and the artifact that produced it. This is the bullet most often skipped and
  the one that earns the most: in the suite this family is scored against, four of the
  eight scoring keys award credit for a recorded discard, and none award anything for a
  candidate dropped in silence. A discard is what stops the next reader spending an hour
  on a path already walked.
- **Blockers** — anything a child could not do, with the reason.

### How it reconciled

- **The contradiction table**, with these columns, in this order:

  ```text
  claim | source A | source B | evidence A | evidence B | what each evidence CAN prove | verdict | residual
  ```

  Verdicts come from a closed set: `confirmed`, `refuted`, `unresolved (needs X)`,
  `inconclusive`. "What each evidence CAN prove" is the column that does the work — a
  document proves intent, a log proves behaviour, and a table that skips this column
  settles disputes by tone.
- **The evidence class used to break each tie**, and the note that class breaks ties
  while *reach* decides admissibility: an observation of production outranks a local
  measurement, which outranks code reading, which outranks docs, comments, and titles,
  which outrank recollection — but only over the surface the evidence actually touches.
- **Which candidate hits were re-read** rather than taken from a child's summary. Summaries
  launder substring false positives into confirmed claims; the reconciler opens the file.
- **Rounds that changed no verdict.** That is the stop rule firing, and it belongs in the
  record as the reason the run ended.

### What was decided and why

- **The decision**, one sentence, and what it authorises — including "authorises nothing
  destructive" when that is the truth.
- **Adversarial concessions**, quoted, each naming the artifact that produced it. A
  conceded claim is recorded *conceded*, not *validated*; the difference matters to whoever
  re-opens this.
- **Marked assumptions.** Every claim depending on an unanswered question is marked
  assumption-dependent, with the question, the default taken, and the direction the answer
  would move the conclusion.
- **Open questions**, with the blocking one labelled as blocking.
- **The evidence index**: every load-bearing citation as `path:line`, the sha it was read
  at, and the result counts of the queries behind it. This is what makes the record
  re-checkable a month later against a moved tree.
- **A closing paragraph titled "what this run could not see"** — surfaces not covered,
  tools unavailable, questions only a production observation could settle. It closes the
  record; there is no sixth heading. It is a boundary, not a hedge — and the paragraph a
  reader deciding how far to trust the rest will go looking for.

## The short form

Unattended runs at the light band write four parts and stop:

1. Header block and invocation.
2. The complexity assessment — each signal's score, the observable that scored it, and
   the resulting band.
3. The decision, with its marked assumptions.
4. What this run could not see.

No contradiction table and no evidence index: a light-band run that produced either was
mis-banded, and the fix is the band, not the record.

## Prohibitions

- **No secret values.** Variable and file names only. Records get committed, and a record
  is read by people who were not in the room.
- **No machine-absolute paths.** Repository-relative only. An absolute path under a home
  directory leaks a username and stops resolving on any other machine.
- **No chain-of-thought, child transcripts, or raw logs.** The record carries claims,
  evidence, verdicts and decisions. A transcript is volume, and it re-presents reasoning
  as if it were a finding.
- **Minimal personal-data fragments.** Names, addresses, ticket text, customer strings —
  only where the finding genuinely cannot be stated without them, and preferably as a role.
- **No unmarked inference.** Every claim carries its basis. Inference written flat, in the
  same voice as measurement, is the failure this whole family exists to prevent.
- **No unearned benefit claims.** "Faster", "safer", "fixes it" require something that
  measured it. Otherwise state what the code does and stop.
- **Never edit an earlier record.** Append a new dated round section. Records are a
  history; a rewritten one is a claim about the past with no evidence behind it.
- **`--document` must not change the answer.** If knowing a record is coming changes what
  gets searched, what gets conceded, or how confident the conclusion sounds, the record has
  become the product. Decide first, write second.

## A worked example

A normal-band investigation in a large monorepo, anonymised. Short deliberately — the
shape matters more than the length.

```markdown
# Which registry is authoritative for job names?

- repo: `acme/platform` @ `3f9c1ab` — clean
- run: investigate-codebase, normal band (scope 2, contradiction 2, size 1, ambiguity 0,
  cost-of-being-wrong 1 = 6), 2026-08-26T09:14Z
- question: two registries list job names; which one does the runtime read?

## What was searched
- `git grep -n "registerJob(" -- src worker` → 41 hits (round 1)
- `git grep -nE "jobs\.(json|ts)" -- .` → 6 hits (round 1)
- read: the generated job registry page, and `worker/boot.ts`
- not searched: the deploy pipeline's own manifests — not readable from this checkout

## Who searched it
- child A — searcher, mid tier, by-surface (`src/`), given the question only
- child B — searcher, mid tier, by-runtime-evidence, forbidden from reading source,
  given boot output only
- reconciler — mid tier, re-read every cited hit; A and B could not see each other

## What each found
- A: `worker/boot.ts:22` imports `jobs.generated.ts` — basis measured
- B: boot output names 41 jobs, against the 46 listed in the generated page — basis measured
- not_found: no runtime read of the generated page. Control: `git grep -n "atlas" -- worker`
  → 3 hits, so the pattern matches in that path and the absence is real. Control fired.
- discarded: `tools/sync-jobs.ts` — writes the page, never read at runtime; rejected
  after reading it, not after reading its name
- discarded: 5 of the 41 `registerJob(` hits are test fixtures, not registrations

## How it reconciled
| claim | source A | source B | evidence A | evidence B | what each evidence CAN prove | verdict | residual |
|---|---|---|---|---|---|---|---|
| the generated page is authoritative | its own header | boot output | a doc asserting intent | 41 booted vs 46 listed | doc proves intent; output proves behaviour | refuted | the 5 extra rows are unexplained |

Runtime observation outranks the doc's own claim. The reconciler re-read all 41
`registerJob(` sites rather than trusting a counted summary; that is where the 5 fixtures
surfaced.

## What was decided and why
- Decision: `jobs.generated.ts` is authoritative at runtime; the generated page has drifted
  by five entries. Authorises nothing destructive.
- Concession: the refuter conceded after reading `worker/boot.ts:22` — recorded conceded,
  not independently validated.
- Assumption (marked): the deployed image boots the same entrypoint as local. Unanswered;
  default taken is yes. If false, the drift count is wrong in an unknown direction.
- Open question (non-blocking): what produced the five extra rows?
- Evidence index: `worker/boot.ts:22` @ `3f9c1ab`; `jobs.generated.ts` @ `3f9c1ab`;
  `git grep -n "registerJob(" -- src worker` → 41.

What this run could not see: the deploy pipeline manifests, any environment whose
entrypoint differs from local, and job registration that happens per-request rather than
at boot.
```

## In-body core (copy verbatim)

Every skill that supports `--document` embeds the block below in its own body, so the
convention survives a reader who never opens this file. Copy it verbatim; the only
permitted edit is substituting the skill's own name for `<skill-name>`.

```markdown
**Documenting the run.** Write a full record when the invocation carries `--document` (or
an unmistakable phrase such as "document the run"), at `docs/<skill-name>/<UTC-date>-<slug>.md`
in the host repository — and always when the run is unattended, in which case it goes to the
harness scratch directory, never the repository, and its path is named in the final answer;
if you cannot confirm a human will see and answer a question in THIS run, treat it as
unattended. Attended with no token: stay silent, offering once only if the run ends with an
unresolved contradiction or an open blocking question. Five headings, in order: What was
searched / Who searched it / What each found / How it reconciled / What was decided and why,
closing with what this run could not see. No secret values, machine-absolute paths, child
transcripts or raw logs; no unmarked inference or unearned benefit claims; never edit an
earlier record, and never let writing one change the answer.
```

Follow it, in the same section, with this sentence exactly:

```markdown
Records are written per [the run-record convention](references/documenting-the-run.md).
```
