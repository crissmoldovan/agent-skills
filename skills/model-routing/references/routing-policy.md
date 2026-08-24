# Token-efficient, quality-preserving routing policy

## Objective

Complete the accepted work with the fewest model tokens and the least DRIVER-context growth that still satisfies the acceptance criteria. Profiles preserve approved exact bindings; they are a mechanism, not the goal.

A route is successful only when its output passes the required verification. Fewer tokens with lower acceptance quality is a failed optimization.

## Routing order

Use the lowest-cost route that can own the work completely:

1. **Deterministic local tool** — exact transformations, formatting, extraction, filtering, counting, validation, and builds that need no language-model judgment.
2. **SWEEPER** — bounded language work whose correct result is mechanically checkable and needs no judgment.
3. **BUILDER** — implementation, debugging, research, or review that needs bounded judgment and has objective acceptance criteria.
4. **DRIVER** — ambiguity, scope, trade-offs, architecture, safety decisions, conflict resolution, final synthesis, and acceptance.

Length alone never promotes a task to DRIVER. Apparent repetition never demotes an ambiguous task to SWEEPER.

## Delegation threshold

Do not delegate when dispatch, context packaging, and reconciliation cost more than doing the small task inline with deterministic tools. Prefer one coherent owner over a fan-out.

Decompose only when at least one is true:

- independent work can run concurrently with a meaningful wall-time benefit;
- moving implementation detail out of DRIVER context materially reduces context growth;
- a bounded specialist task can use a less expensive configured model without lowering the acceptance standard.

Parallel children require disjoint write ownership, non-overlapping questions, no unresolved decision dependency, and separate acceptance checks. Never ask several children the same broad question unless independent redundancy is itself the planned quality control.

## Minimum context package

Each child receives only:

```text
Goal: one outcome sentence
Role: BUILDER or SWEEPER
Ownership: exact paths, data partition, or question boundary
Inputs: source-of-truth paths/URLs and only necessary excerpts
Constraints: immutable decisions, safety limits, allowed tools
Acceptance: executable checks or exact predicates
Stop: ambiguity, missing input, ownership conflict, or exhausted budget
Return: status, artifacts/changed paths, verification, blocker/next decision
```

Reference source files and plans instead of pasting them. Do not forward the whole conversation, repository, logs, or prior transcripts. Reuse verified artifacts by path or stable source ID. Child results must be decision-ready and bounded; include full logs only when they are necessary failure evidence.

## Escalation and retry

Escalate on evidence, not on a task label:

- a SWEEPER encounters ambiguity or cannot verify the mechanical result;
- a BUILDER cannot meet an acceptance criterion with the assigned scope/model;
- verification fails because reasoning or quality is insufficient;
- findings conflict materially;
- the task needs an unassigned shared-file or product/safety decision.

Never blindly retry the same prompt. A transient execution failure permits one bounded retry. Otherwise change the tactic or escalate. Pass the next owner only the failure delta, relevant artifacts, attempted checks, and remaining acceptance criteria so discovery is not repeated.

## Verification economy

Use the cheapest decisive evidence first:

1. deterministic syntax/schema checks;
2. focused tests for the changed surface;
3. integration/full-suite checks at phase boundaries or when blast radius requires them;
4. DRIVER acceptance and synthesis.

A child completion message is evidence, not proof. The DRIVER independently verifies phase and final acceptance boundaries. Keep successful command output summarized; preserve the exact failure evidence needed to diagnose a failure.

## Quality and efficiency checks

A routed run is acceptable only when:

- every task has one accountable owner and an objective acceptance criterion;
- expensive DRIVER tokens are concentrated on judgment and synthesis;
- deterministic work did not consume model tokens unnecessarily;
- parallel prompts do not duplicate source context or work;
- low-cost attempts stop promptly at escalation triggers;
- accepted outputs have fresh verification evidence;
- selected, configured, dispatched, and observed model facts remain distinct.

Useful evaluation metrics are total model tokens per accepted outcome, duplicate-context ratio, dispatch-overhead ratio, acceptance yield, and independently verified acceptance rate. Token reduction must not reduce acceptance yield or verification coverage.
