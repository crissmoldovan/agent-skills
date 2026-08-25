# Reason codes are a UX surface

A recurring proposal shape, across at least three signal classes — collected-but-unsurfaced,
silent failure, and cannot-describe-itself — is *"make this absence explain itself"*. The
system did nothing, or refused, or returned empty, and the proposal is to have it say why.

It is a good proposal. It is also **the most frequently botched fix in this whole skill**, and
it fails in the same four ways every time. A reason code is a UX surface: it is a short string
a persona reads and acts on, and it can be wrong exactly the way a screen can be wrong —
except that nothing renders it visibly enough for anyone to notice.

Four requirements. All four, or the proposal is not gated and does not ship as a row.

## 1. Cite an existing precedent enum and extend it

Before proposing a vocabulary, **find the one that already exists**. Search for the shapes:
a status enum, a skip-reason column, an error-code union, a set of string literals compared in
a switch. Nearly every codebase past a certain age already has one for the same *kind* of
absence.

Cite it by `path:line` in the finding, and propose an **extension** to it: the new members, and
what predicate produces each.

**Never introduce a second vocabulary for the same kind of absence.** Two vocabularies for one
absence is signal class 4 — competing vocabulary — created deliberately by the person who came
to fix a UX problem. Downstream, every consumer now has to know both, and the two drift because
nothing forces them together.

If no precedent exists, say so with the control: *"no precedent enum found; control: <query>
returns hits for comparable enums elsewhere in the tree, so the search shape works."* An absent
precedent is a finding, not a licence to invent quietly.

## 2. State the not-attempted vs ran-no-result distinction

Two facts that a single code will conflate, and they are not close:

- **Not attempted** — the work never ran. A precondition failed, a gate refused, a queue never
  dispatched, the input was empty.
- **Ran, no result** — the work ran to completion and found nothing.

A vocabulary that merges them produces confident wrongness. The persona reads "no results" and
concludes the answer is no, when the truth is that nobody asked the question. In one measured
case this exact conflation kept an absence unexplained for weeks, because every consumer of the
code treated it as "checked and empty".

The proposal states which existing members are which, and whether the extension needs one
member or two.

## 3. Supply negative controls known in advance

For each proposed code, name a case whose expected code **you can state before running it**.
Write the expectation down first, then check.

This is what makes a silent vocabulary detectable. A code that is defined, wired, documented,
and **never actually emitted** looks identical from the outside to one that is working
perfectly — nothing errors, the enum is complete, the tests pass. The advance-declared negative
control is the only thing that catches it, and it must be declared in advance or it becomes a
post-hoc rationalisation of whatever came out.

Include at least one control per member, and one for the merged case in requirement 2: an input
you know was never attempted, and an input you know ran and found nothing.

## 4. Check the code NAME is true under the predicate that produces it

Read the branch that emits each code, and ask whether the code's name is a true statement about
every path that reaches it.

The canonical failure: a code called `no-match` emitted by a branch that also fires on a
timeout, on a malformed input, and on a downstream refusal. The name is a lie in three of the
four cases, and the persona acts on the lie because the name is the only thing they see.

Two questions per code:

- **Is the name true on every path into the branch?** If not, either narrow the branch or
  rename the code — and prefer narrowing, because a code named around its implementation
  ("handler-returned-null") is a leak, not a fix.
- **Is the name true only under an assumption?** Then the assumption belongs in the finding,
  marked, with the direction the answer would move things if it turned out false.

## What the finding looks like

```text
claim:     A refused enrichment returns an empty result with no code; the persona cannot
           distinguish "not eligible" from "ran and found nothing".
evidence:  <path:line> — the empty return; <path:line> — the eligibility branch above it
precedent: existing skip-reason enum at <path:line>, 6 members, extended not replaced
distinction: needs two members — not-attempted (eligibility failed) and ran-no-result
controls:  an ineligible input, expected `not-eligible`; an eligible input with no matches,
           expected `no-matches`; declared before running
name check: `no-matches` is true only on the post-fetch branch; the timeout path must not
           reach it — narrow the branch rather than widening the name
```

Anything short of that is a proposal to add a string, and a string that gets added without
these four is a new surface that is confidently wrong to a persona who has no way to check it.
