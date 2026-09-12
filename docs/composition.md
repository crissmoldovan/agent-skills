# Two-skill composition

The catalog ships twenty-three skills; this composition deliberately joins **exactly two skills**:

1. [`model-routing`](model-routing/index.md) reduces model-token and DRIVER-context cost by routing work to the least expensive configured model that can meet acceptance; profiles preserve its exact approved bindings.
2. [`agent-lifecycle`](lifecycle/index.md) makes the dispatched child observable and reconciles its lifecycle evidence.

There is no third composition skill. Keep model choice, child visibility, task planning, and host UI ownership distinct rather than introducing a coordinator skill that blurs those boundaries.

Two further skills are documented here because they meet that boundary from outside it, and neither joins the composition: `report-progress` reads the lifecycle evidence the composition produces, and `work-in-external-repo` settles which tree the composed work happens in before any of it starts.

## Ownership boundary

| Concern | `model-routing` | `agent-lifecycle` |
| --- | --- | --- |
| Exact driver and child-model choice | Owns | Does not choose models |
| Scoped routing profile | Owns | Reads it only as context |
| Delegation prompt and task ownership | Owns | Supplies observation requirements |
| Child identity, lineage, capabilities | Passes through | Owns |
| Events, heartbeats, snapshots, stale/lost | Does not infer | Owns |
| Todo rows, percentages, plan checkboxes | Auxiliary only | Never lifecycle authority |
| Hermes Desktop UI | Uses native host UI when available | Does not add Desktop core UI |

A final child result is outcome evidence, not a lifecycle event. A heartbeat is liveness evidence, not progress or success.

## Recommended load and dispatch order

1. Load `model-routing`; read the matching harness guide before configuring or dispatching.
2. Inspect live bindings and the active profile. If no active profile exists, ask the user for exact role identifiers; a harness default is not consent.
3. Load `agent-lifecycle` before launch when the host can expose delegated-child evidence.
4. Declare the child source, stable child ID, source epoch, lineage, and known/unknown capabilities.
5. Dispatch only after the user confirms the model profile and the host either has lifecycle evidence or clearly reports its visibility limits.
6. Keep task progress separate from lifecycle state. At phase boundaries, independently verify the resulting work.

Routing-only work that creates no observable child does not need lifecycle integration. Conversely, lifecycle integration does not authorize a model choice.

## Reporting on a composed run

`report-progress` is not a third composition skill. It joins nothing, dispatches nothing and holds no child bookkeeping of its own: it is downstream of the composition, and it reads what `agent-lifecycle` already owns. The reason the two are documented together is that the report has a section — **what is running** — whose only honest source is lifecycle evidence. Filling it from memory, from a dispatch that happened forty minutes ago, or from what a child "should" be doing by now produces the most convincing wrong answer in the report, because it arrives wearing a status block's formatting.

| Concern | `agent-lifecycle` | `report-progress` |
| --- | --- | --- |
| Child identity, lineage, literal state, freshness, terminal cause | Owns | Reads it; infers nothing |
| Whether any child evidence exists at all | Owns | Prints the exact no-evidence sentence in place of the section |
| The shape of what the user is told, and when a report is owed | Supplies observation requirements | Owns |
| Whether a number was verified here or claimed by someone else | Not its concern | Owns; labels both, never merges them |
| What happens next | Not its concern | Reports the next act; does not choose it |
| What a landed diff did | Not its concern | Hands the diff to `describe-changes` rather than paraphrasing it |

The lifecycle rule that a final child result is outcome evidence, not a lifecycle event, survives into the report unchanged: a child's "all tests pass" is evidence that the child said so. Re-run it at the boundary and report the command, or attribute it and mark it unverified. Both are honest; merging them into one sentence is not.

Where the host exposes no lifecycle evidence, the report does not degrade into an estimate. It prints, verbatim, the sentence `agent-lifecycle` specifies:

```text
Background work visibility unavailable; state unknown.
```

Task progress is not lifecycle status here either. A todo row or a percentage may appear in the report as task metadata, labelled as such; it never becomes a running row.

### The gate that reads this boundary

`report-progress` has an optional mechanical half: a Claude Code `Stop` hook in
[`adapters/claude-code/`](../adapters/claude-code/README.md), off until a user installs it by
hand. It inherits the boundary above rather than widening it. It reads no lifecycle evidence,
dispatches nothing, holds no child bookkeeping and joins no composition — it reads the turn's
final message and matches strings against it.

Two consequences follow for these two skills:

- **The no-evidence sentence is a shared constant.** The gate carries `agent-lifecycle`'s
  sentence byte-for-byte and treats it as satisfying the running requirement outright, because
  the skill puts it *in place of* the section rather than inside it. The gate does not import
  that string from anywhere; changing the sentence in `agent-lifecycle` changes what the gate
  accepts, so the copies have to move together.
- **Passing the gate is not lifecycle evidence.** It can see that a running row names a literal
  state and carries a freshness token. It cannot tell whether either was projected from a real
  child or written from memory, which is the question this table leaves with `agent-lifecycle`,
  and the gate's own reason string says as much to the model it blocks.

Its ceiling belongs here too, because it bounds what "enforcement" can mean: it acts at most
once per turn and then stands down — Claude Code ends a turn after 8 consecutive `Stop` blocks,
and that budget is shared with every other `Stop` hook on the machine — and its marker is keyed
by session, so a turn that dispatched a subagent and then died without a `Stop` leaves the
marker behind and the next turn in that session pays one block for a dispatch it did not make.

## Where `work-in-external-repo` sits

`work-in-external-repo` sits upstream of every other workflow skill, and only when the work belongs somewhere other than the current working directory. It owns exactly two things — which repository is meant, and which tree the work happens in — and it is finished the moment that tree exists at a fetched base. Work in the current repository never loads it; read-only inspection of another repository does not either, because nothing is written.

| Stage | Owner | Hand-off |
| --- | --- | --- |
| Which repository the change belongs in, and proving the checkout by its `origin` remote | `work-in-external-repo` | A confirmed path, or a clone at a destination the user approved |
| A current base ref, with ahead/behind stated | `work-in-external-repo` | A dedicated worktree cut from the fetched ref |
| The change itself, its touch-set budget and regression gates | `land-complex-change` | Commits in that worktree |
| What the landed diff did | `describe-changes` | Prose anchored to the diff |
| The review loop over the pull request | `request-blocks-review` | Repository, branch, head sha |
| Telling the user where any of it went | `report-progress` | The destination line: repository, branch, worktree path, commits |
| Two agents in one repository at once | `agent-lifecycle` | Child state, so the second tree is accounted for rather than assumed |

The two adjacent skills meet at that last hand-off. `work-in-external-repo` requires every result to name the repository, branch, worktree path and commits; `report-progress` is where that line is carried in an intermediate report rather than only at the end. A result that omits it reads as *this* repository to anyone looking at their own terminal, and nothing in the answer contradicts them.

## What ships now

The catalog ships both composition skills — `model-routing` and `agent-lifecycle` — and their documentation. The lifecycle contract includes a Hermes adapter foundation; it does **not** ship Hermes Desktop core integration, a task board, or arbitrary foreign-process adoption. Host-native rendering and status controls remain the host's responsibility. The shipped Hermes routing adapter is documented in [`skills/model-routing/references/harness-hermes.md`](../skills/model-routing/references/harness-hermes.md); its `hermes-routing` scripts are adapter tooling, not a Hermes profile primitive.

## Installing and packaging

Install both skills explicitly when you want this composition. The [`routed-delegation` bundle](../hermes-bundles/routed-delegation.yaml) is a load-time helper: it loads both skills but installs neither.

For public distribution, packing with `skills.sh pack` is optional. A successful pack does not itself publish the skills or make them discoverable in a public listing. Treat an unlisted package as an intentional distribution choice and provide an explicit repository/install path to users.

## When a dependency is missing

Do not silently substitute a third skill, a todo board, or an assumed model. Explain which of the two skills is unavailable and what degrades:

- **Missing `model-routing`:** do not delegate until the user has selected exact model identifiers through a supported host flow. You may perform non-delegated work.
- **Missing `agent-lifecycle`:** dispatch only if the user accepts degraded host-native visibility. State that lifecycle projection, reconciliation, stale/lost handling, and adapter evidence are unavailable. Where `report-progress` is in use, its running section becomes the exact no-evidence sentence above; it must not be filled with an estimate of what the children are doing.
- **Missing both:** do not claim routed or observable delegation. Offer installation instructions or proceed without delegation.

If the host exposes only todos, show them as task metadata—not as a child state. Label the display **“Task progress (not lifecycle status)”** and show `Lifecycle: unavailable` (or `unknown`) until lifecycle evidence exists.
