# The build contract

A spec that describes an approach is read as advice. A contract states requirements that can be
checked one at a time, by someone who was not in the investigation, against a diff they did not
write. That is the difference this artifact exists to make.

## The template

```text
BUILD CONTRACT  <report handle>  base <sha>  band <light|normal|deep>  candidate <chosen>

CLAIM       <the G0 claim, one sentence — what this build is supposed to make false>
EVIDENCE    <the G1 finding this rests on, at its class, with path:line at a sha>

R1  <one checkable requirement, in one sentence>
    FILES     <the paths this requirement owns — disjoint from every other requirement>
    PROVES    <the test that proves it: path + test name>
    MUTATION  <the edit to the implementation that must make that test fail>
    OUT       <what this requirement explicitly does not do>

R2  <…>

MUTATIONS   Every test named above is watched failing under its own mutation before the
            implementation lands. A test that has never been observed failing is a claim.
NOT IN SCOPE  <the candidates that lost, and what each would have fixed>
STANDING INSTRUCTION  Report brief errors instead of implementing them. If a requirement
            contradicts the code, another requirement, or itself, stop and return the
            contradiction with its evidence. Do not implement around it, and do not pick
            the reading that is easiest to build.
```

## Field semantics

- **CLAIM and EVIDENCE** travel with the contract so the builder can tell when a requirement has
  drifted from the report. A requirement that no longer serves the claim is a brief error, and
  the builder can only see that if the claim is in front of them.
- **R-lines are checkable sentences.** "Handle the empty case" is not one. "When the filter
  matches no rows, the endpoint returns an empty list and status 200, not 500" is.
- **FILES is ownership, not a guess.** It is what makes requirements independently revertible
  and what lets a reviewer attribute a defect to one requirement. It also feeds the landing
  skill's touch-set budget, which is derived from the blast map and this list together.
- **PROVES names one test.** If a requirement needs three assertions, that is one test with
  three assertions or three requirements — decide which, and write it down.
- **MUTATION is the edit that must break that test.** Not "change something"; the specific edit.
  See the forms below.
- **OUT is per requirement** and is different from NOT IN SCOPE, which is per contract. OUT stops
  a requirement from quietly growing; NOT IN SCOPE records the candidates that lost.

## Disjoint file sets

Two requirements owning the same file means: no independent revert, no attribution in review,
and a regression in one rolling back both. Three ways out, in preference order:

1. **Split the file's responsibilities** so each requirement owns a part — usually the right
   answer, and usually already wanted.
2. **Merge the requirements** into one, with one test and one mutation. Two requirements that
   cannot be separated in the code were one requirement.
3. **Declare and sequence.** Where the overlap is real and unavoidable — a registry file, a
   shared schema — say so explicitly: "R2 and R4 both touch the registry; R2 lands first, R4
   rebases on it." A declared overlap is fine. An undeclared one is discovered at revert time.

## Mutation forms, per requirement kind

The mutation is the cheapest evidence in the pipeline: about a minute, and it converts "there is
a test" into "there is a test that can fail". Pick the form that matches what the requirement
changes.

| Requirement kind | The mutation that must kill the test |
|---|---|
| new behaviour | delete the new branch, or return the pre-change value |
| bug fix | restore the defect: put back the off-by-one, the missing await, the wrong operand |
| validation or refusal | remove the check and pass the input that should be refused |
| data shape | rename or drop the field the requirement adds, and run the same test |
| a guard, lint rule or CI check | introduce the exact violation it is supposed to catch, in a scratch copy |
| removal or deprecation | re-introduce the removed path and assert the test notices |
| ordering or idempotency | run the steps in the wrong order, or run twice |
| performance | remove the optimisation and check the assertion's threshold actually trips |

Two measured reasons this line is not ceremony. In one repository four separate CI guards were
added that had never been capable of failing — each passed from the day it landed and each was
reported as coverage. In another, a swallow-by-design path made its own test decorative: the
test asserted that nothing threw, which the surrounding code guaranteed, so it proved the
function existed and nothing else. Both would have been caught by one deliberate break.

Watch the failure **for the right reason**, too: a test that fails because the file does not
exist yet, or because of a typo in the test name, has not been armed.

## The standing instruction

**Report brief errors instead of implementing them.** It sits in the contract because that is
the text the builder actually reads — a rule stated only in the conversation that produced the
contract does not travel with it.

What counts as a brief error:

- a requirement that contradicts the code as it stands (the function it names does not exist,
  the field it renames was already renamed);
- two requirements that cannot both hold;
- a requirement whose proving test cannot be written as stated;
- a requirement that no longer serves the CLAIM;
- a FILES list that does not contain the code the requirement is about.

What the builder returns instead of a diff: the requirement number, the contradiction, the
evidence for it, and — where there is one — the reading that would work. Not a best guess
implemented and flagged in the summary: by then the diff exists, review is anchored on it, and
the cheapest moment to fix the brief has gone.

## A worked contract

```text
BUILD CONTRACT  export-zero-rows  base 4f1c9ab  band deep    candidate C3 (scope the filter at
                                  the query, matching the precedent in the reporting module)

CLAIM       The export endpoint returns rows for one account and zero rows for another, for the
            same filter.
EVIDENCE    The filter is applied after the account scope is dropped by the shared query
            builder — services/reporting/query.ts:88, at 4f1c9ab. Measured: 6 of 9 reported
            counts reproduced; the 3 that diverged are all accounts created after the scope
            change.

R1  The query builder keeps the account scope when a filter is supplied.
    FILES     services/reporting/query.ts
    PROVES    test/reporting/query.test.ts :: "keeps account scope under a filter"
    MUTATION  drop the scope clause from the filtered branch; the test must fail
    OUT       does not change how the scope is chosen, only that it survives the filter

R2  The export endpoint returns an empty list and 200 when the scoped query matches nothing.
    FILES     services/export/handler.ts
    PROVES    test/export/handler.test.ts :: "empty result is 200 with an empty list"
    MUTATION  return 500 on the empty branch; the test must fail
    OUT       does not change the non-empty response shape

MUTATIONS   Both mutations run and both tests watched failing before implementation.
NOT IN SCOPE  C1 (patch the endpoint only) would fix the export and leave every other reader of
            the shared builder wrong. C2 (do nothing) rejected: 3 accounts affected today and
            the number grows with account creation.
STANDING INSTRUCTION  Report brief errors instead of implementing them. …
```
