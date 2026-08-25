# A worked investigation, end to end

One normal-band run in an anonymised monorepo, from the ask to the delivered answer. It is
short on purpose: the shape is the lesson, not the length. The record this run would write
is in the run-record convention's own worked example.

## The ask

> "The job registry page is the source of truth for job names, right? I want to delete the
> generated file — nothing reads it."

Two things are asserted, and both are checkable. That is a contradiction risk of 2 before a
single search runs, and "delete" makes cost-of-being-wrong a 2.

## 1. Score, then announce

| Signal | Observable | Score |
|---|---|---|
| scope | `git grep -n "registerJob(" -- src worker \| wc -l` → 41 hits in 18 files | 2 |
| contradiction risk | the ask asserts authority *and* absence; both decide the answer | 2 |
| size + toolchains | 14 packages, 2 build systems | 1 |
| ambiguity | "the registry" resolves to two artifacts | 1 |
| cost of being wrong | authorises a deletion | 2 |

Total 8 → deep. (It would have reached normal on the cost override alone.) Size is 1 under the
cap for a question that names its artifacts; scored 2 on the repository instead, the total is 9
and the band is the same — the band here is carried by contradiction and cost, not by size.

```text
investigate-codebase · deep band — scope 2 (41 hits/18 files), contradiction 2 (authority and
absence both asserted), size 1 (14 packages, 2 toolchains), ambiguity 1 ("the registry" → 2
artifacts), cost-of-being-wrong 2 (authorises a deletion) = 8 → 4 children + reconciler,
adversarial pair, 3 rounds max
```

Printed before anything was dispatched. Nothing waited on it.

## 2. One blocking question, batched

"The registry" is two artifacts, and the two readings imply different work — so it survives
both tests and is asked. The deletion authorisation is the second must-ask, folded into the
same message.

```text
BLOCKING — "the registry" is either the generated page or jobs.generated.ts. Which do you
           mean to delete? I will not act on the deletion either way; this run produces the
           evidence for it.
Also (defaults in brackets): count test fixtures as registrations? [no]
```

## 3. Decompose where children can disagree

- **A — by-surface** over `src/`: who calls `registerJob(`.
- **B — by-runtime-evidence**, forbidden from reading source: what the boot output names.
- **C — by-data-flow, derivers**: what computes something *from* job names — cache keys,
  metrics labels, deploy manifests.
- **D — by-history**: when the generated file appeared, and what it replaced.

A and B can disagree, and their disagreement is the answer. C exists because writers and
readers would both have missed a derivation.

## 4. What came back

- **A**: `worker/boot.ts:22` imports `jobs.generated.ts` — measured.
- **B**: boot output names 41 jobs; the page lists 46 — measured, and from a class no code
  reading could produce.
- **C**: one metrics label is computed from the generated file's export — measured. This is
  the finding a writers-and-readers split loses.
- **D**: the generated file replaced a hand-maintained list eleven months ago — measured.
- **`not_found`**: no runtime read of the *page*. Control: `git grep -n "atlas" -- worker`
  → 3 hits, so the pattern and pathspec both work in that tree. **Control fired**, so
  "absent" is admissible.
- **Discarded**: `tools/sync-jobs.ts` — writes the page, never read at runtime; rejected
  after opening it, not after reading its name. Five of A's 41 hits are test fixtures.

## 5. Reconcile

The reconciler re-read all 41 cited hits rather than trusting A's count — which is where the
five fixtures surfaced.

| claim | source A | source B | evidence A | evidence B | what each evidence CAN prove | verdict | residual |
|---|---|---|---|---|---|---|---|
| the page is authoritative | the page's header | boot output | a doc asserting intent | 41 booted vs 46 listed | doc proves intent; output proves behaviour | refuted | the 5 extra rows are unexplained |
| nothing reads the generated file | the ask | children A and C | recollection | an import at `boot.ts:22` and a metrics derivation | recollection proves belief; the import proves a read | refuted | — |

Independence: A and C are both code readings and were not counted as corroboration of each
other; B is a different class, and its agreement with A is what carries the first row.

## 6. Adversaries (deep band)

- **Refuter**, given claims and citations only: opened `worker/boot.ts:22` and **conceded**,
  naming the artifact. Recorded *conceded*, not validated.
- **Coverage auditor**, given the question and the manifests but not the answer: `INCOMPLETE`
  — the deploy configuration was never read. Probe named. Not available from this checkout,
  so the row is carried into what this run could not see rather than closed.

## 7. Stop

Conditions 1, 2 and 4 hold; round 2 changed no verdict (condition 3). Stop at round 2 of a
3-round budget, with the auditor's uncovered surface stated.

## 8. The answer

> **Both premises are false, and the deletion is unsafe as scoped.** The generated file is
> read at runtime (`worker/boot.ts:22`) and a metrics label is derived from it; the page is
> the one that has drifted, by five entries. Deleting the generated file breaks boot.
>
> Confidence: measured at four cited sites, corroborated across two evidence classes (code
> reading and boot output). Coverage: `src/`, `worker/`, and boot output searched; the page's
> runtime absence is admissible — the control fired. The deploy configuration was not read
> and is not readable from this checkout.
>
> Open (non-blocking): what produced the five extra page rows.
>
> What this run could not see: the deploy configuration's own manifests, any environment
> whose entrypoint differs from local, and registration that happens per request rather than
> at boot.

Note what the answer does **not** do: it does not delete anything, and it does not say
"safe to delete once you check the deploy config". It states what was measured, and leaves
the irreversible act to a consented step.
