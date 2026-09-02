---
name: request-blocks-review
description: "Run Blocks review/fix/re-review until a GitHub PR is clean."
license: MIT
compatibility: "GitHub pull requests with the Blocks integration; requires the public blocks skill, authenticated gh, repository access, and a host capable of a visible bounded wait."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Grep Glob Bash
---

# Request Blocks review

Use this as the final code-review gate after implementation and local verification
are complete on a GitHub pull request. It owns the review policy and loop; the
public `blocks` skill owns Blocks communication, workspace/session resolution,
status classification, and visible waiting primitives.

## When to Use

- Work on a GitHub PR is finished and verified, and it needs Blocks review.
- “Request Blocks review,” “run Blocks review,” “fix the Blocks findings,” or
  “re-review until green.”
- A Blocks review landed and its findings need triage and another review cycle.

Do not start during exploratory work, before a PR exists, or while implementation
and known local failures remain unfinished.

## Prerequisites

1. Load the public `blocks` skill. If unavailable, show and request approval for:

   ```bash
   npx skills add crissmoldovan/agent-skills --skill blocks
   ```

   Never install it silently.
2. Confirm the branch is pushed, the PR is open, implementation is complete, and
   relevant local and CI checks are green.
3. Resolve Blocks workspace context through `blocks` only if REST interaction is
   needed. GitHub review status remains GitHub-authoritative.

## Procedure

1. **Resolve the PR.** Use the named PR or current branch PR. Do not create or
   merge a PR implicitly.
2. **Capture a full baseline.** Record the head SHA, request timestamp, and stable
   IDs for top-level comments, reviews, and paginated inline comments.
3. **Request review once.** Post `@blocks please review`; record its URL.
4. **Await visibly through `blocks`.** Keep a tracked operation active and surface
   waiting progress. Reactions/help/queued/courtesy messages are nonterminal.
5. **Collect every finding.** Read top-level summaries, formal reviews, and all
   paginated inline comments. Preserve explicit severity; otherwise classify:
   security/data loss/broken contract = blocker; correctness/crash = high;
   refactor/quality = medium; style = low.
6. **Apply policy.** Fix blocker/high findings. Ask before medium/low judgment
   calls. For intentional disagreements, reply with rationale rather than changing
   correct code.
7. **Verify and push.** Run focused and repository-required checks, then push the
   accepted fixes to the PR branch.
8. **Re-baseline and request re-review.** A review of an older head never accepts
   the current head.
9. **Repeat until green.** Continue review → findings → fixes → verification →
   re-review until Blocks reports the current head clean and CI remains green.

Acceptance is not the word "clean". It is a clean verdict **for the head you are
about to merge**, with CI green **on that same commit** — `blocks` reports this and
names its reason when it refuses. Check the sha, never the check name: a green check
can belong to the previous head when the new run has not registered yet, and a
verdict for a superseded commit reads exactly like one for this commit.

Stop only for a clean current-head review, explicit user cancellation, closed PR,
or non-convergence that must be escalated to the user. Never merge implicitly.

## Usage Examples

```text
Implementation is finished and tests are green. Request Blocks review for this
branch's PR, await visibly, fix blocker/high findings, ask me about judgment
calls, and repeat until Blocks reports the current head clean. Do not merge.
```

```text
Resume the Blocks review loop on PR 42. Compare against the latest request
baseline, include all inline findings, and do not accept a review of an older
head.
```

## Verification

- [ ] `blocks` was loaded as the interaction/status/wait authority.
- [ ] Implementation was complete and local/CI checks were green before review.
- [ ] Baseline includes head SHA and stable IDs from all three GitHub surfaces.
- [ ] Wait remained visible and bounded.
- [ ] Every accepted finding was fixed and freshly verified.
- [ ] Re-review targeted the new head after each fix cycle.
- [ ] The final Blocks verdict is clean for the current head and CI is green.
- [ ] No implicit merge occurred.
