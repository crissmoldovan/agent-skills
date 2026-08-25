# The gate contracts

Six gates, six artifacts. A gate is not a checklist item and not a status; it is a thing that
exists on the page or does not. The discipline is one sentence: **a gate opens when its artifact
exists, never when the work feels finished.** Everything else in this file is the field list for
each artifact, the checks that open the gate, and what to hand back when a gate will not open.

The single most common way this pipeline fails is not a wrong answer. It is a gate that was
declared open because the next step was obvious.

## G0 — intake

**Artifact: the claim card.**

| Field | What it holds |
|---|---|
| `claim` | one sentence that could be false, with every noun resolved to something you can point at |
| `falsifier` | the observation that would prove the claim wrong, and whether it is reachable from here |
| `premises[]` | each cause, mechanism or attribution the report asserts — recorded **separately**, one per row, each with its own falsifier |
| `kind` | `bug` \| `feature` \| `question` — it decides what G1 has to produce |
| `reported` | the date, the reporter's role, and the surface they were on |
| `numbers[]` | every figure in the report, verbatim, with what the reporter says each one measured |
| `consequence` | what a wrong resolution would cause someone to do |

**Opens when:** the claim is falsifiable; the falsifier is checkable with the reach declared in
the prerequisites, or its unreachability is recorded; the asserted cause sits in `premises[]`
rather than inside `claim`; and `kind` is set.

**Restatement, worked.** "Exports are broken" → claim: *the export endpoint returns rows for one
account and zero rows for another, given the same filter*; falsifier: *a run of both returning
rows*; premise (theirs): *"because the filter was changed last week"*; kind: bug. The premise is
now a separate thing that can be refuted without refuting the report — which matters, because
the reporter is usually right about the symptom and guessing about the cause.

**What a blocked G0 hands back.** The report restated as far as it goes, plus the specific
ambiguity: which of two referents, or which observation would settle it. This is the cheapest
question in the pipeline and the one most worth asking.

## G1 — analyse

**Artifact: the finding at its class, plus the reproduction table.**

| Field | What it holds |
|---|---|
| `finding` | the cause (bug) or the implications (feature), one paragraph |
| `class` | the evidence class the claim requires, and the class actually achieved |
| `evidence[]` | `path:line` at a sha, a command with its output, or an observation with its source |
| `reproduction[]` | one row per reported number: reported, what it measured, measured here, delta, verdict |
| `premise_verdicts[]` | each intake premise: `confirmed` \| `refuted` \| `unresolved` \| `inconclusive`, with what refuted it |
| `dated[]` | every inherited claim with the sha it was checked at, and where it stopped holding |
| `not_searched[]` | what was out of reach, and the probe that would settle it |

**Opens when:** the finding is stated at the required class or the shortfall is named; every
number has a verdict; every load-bearing negative names a control that fired; every inherited
claim is dated.

**What a blocked G1 hands back.** The reproduction table as far as it got, plus the missing
reach stated as an access request — "this needs one query against the store that holds the
counts; here is the query". Half of the reports that stall here stall on a permission, not on a
difficulty.

## G2 — offer

**Artifact: the candidate table.** Fields per candidate, and the rules that decide which
candidates must be present, are in the candidate-offers reference. The gate itself:

**Opens when:** at least two candidates carry all five fields; the already-fixed and do-nothing
lines have each been evaluated and are either present or dismissed with a reason; each blast
area came from the mapping skill or names why it could not; and the chosen candidate is recorded
**with who chose it** — the reporter, the owner, or the agent under the light-band default.

**What a blocked G2 hands back.** The candidates that do exist, with the one field that could
not be filled and why. A candidate with no blast area is not a candidate; it is a suggestion.

## G3 — spec

**Artifact: the build contract.** Its template and field semantics are in the build-contract
reference.

**Opens when:** every requirement names files, a proving test and a mutation; file sets are
disjoint or the overlap is declared and sequenced; the losing candidates appear under NOT IN
SCOPE; the standing brief-error instruction is present in the text the builder receives.

**What a blocked G3 hands back.** The requirement that cannot be made provable, named. A
requirement no test can prove is either not a requirement or not understood yet, and both of
those are worth saying before a builder starts.

## G4 — implement

**Artifact: the landed change with its budget and gate ladder** — produced by the landing skill,
not here. This gate's job is to hand over the right context and to check what comes back.

**Opens when:** the budget and the ladder return with the diff; every affected surface has a
ladder row with its rung; every rung-1 guard has quoted fail-before evidence; every budget
breach is recorded with its disposition — extend, split or abandon.

**What a blocked G4 hands back.** The staged work, the budget as it stood, and the breach that
stopped it. A breach that invalidates the chosen candidate is not a G4 problem; it re-enters at
G2 with the new fact, because the comparison that chose the candidate was made on a map that has
just been shown to be wrong.

## G5 — verify and describe

**Artifact: the resolution note, plus one filed report per disagreement.**

| Field | What it holds |
|---|---|
| `per_requirement[]` | each R with the evidence that it holds, at its own class |
| `re_measured[]` | the G1 reproduction table, run again after the change |
| `filed[]` | every disagreement found during verification, with the handle it was filed under |
| `note` | the resolution note, from the description skill's registers |
| `residuals[]` | the map's silent items and the unguarded surfaces, each with the observation that would settle it |

**Opens when:** every requirement is verified at its own class; the reporter's numbers are
re-measured; each disagreement is filed rather than chased; and the note distinguishes what was
true in the report from what was not.

**What a blocked G5 hands back.** The change, landed, with the verification that could not be
completed stated as a residual and — where it matters — as its own filed report.

## Re-entry, and the direction it runs

Gates are ordered, but the pipeline is not one-way. Three re-entries are legitimate and each has
one destination:

| What happened | Re-enter at | Why not somewhere else |
|---|---|---|
| The budget was breached by a fact the map missed | **G2** | the candidate comparison used that map; it has to be redone before the build continues |
| Reproduction refuted the claim itself, not just a premise | **G0** | the report is about something else, and the claim card has to say what |
| Verification found a disagreement in a neighbouring value | **file a new report** | it is a different claim with a different falsifier; this one closes on its own contract |

The re-entry nobody should take is the fourth: continuing with a widened scope and mentioning it
in the note at the end.

## Degradations

Every companion can be missing. The gates still hold; each one says what it lost.

| Missing | Effect | What the artifact says |
|---|---|---|
| the investigation skill | G1 is run inline, without the fan-out and the child contract | "single-pass analysis; no independent corroboration" |
| the mapping skill | candidates carry a reasoned effect list instead of a map | "blast area reasoned, not enumerated — surfaces may be missing" |
| the landing skill | the build runs without a budget or a ladder | "no declared touch-set; regressions guarded by the existing suite only" |
| the description skill | the note is written here, from the diff | "note written inline; registers not separated" |
| the review skill | review is human-only | "no automated review pass; findings from one reader" |
| subagents | the bands become sequential passes | the wall-clock cost, stated |
| a queryable store | data-resident references cannot be checked | "unchecked, not empty" — never the second |
