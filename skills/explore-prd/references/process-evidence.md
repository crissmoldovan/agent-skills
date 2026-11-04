# Process evidence and maintenance cases

This workflow was distilled from a product-exploration session on 4 November 2026. The
private PRD, discovery records, prototype feedback, capability review, checkpoint notes,
design rationale, browser observations, research draws and ordered shortlist were read
during authoring. Private project identifiers, transcript details and machine paths are
deliberately excluded. The following is a sanitized account of observations, not a public
copy of those sources or a claim that the complete workflow has been independently tested.

## Why this is a skill

Without the phase boundaries, an agent can turn a scenario into an approved requirement,
mistake a browser demonstration for engine capability, balloon six directions into twenty-four
screens, or claim a gallery is ready while its stylesheet is missing. These are concrete
failures this workflow should prevent; generic advice to "iterate on the design" does not.

## Failure, turn and surviving step

| Observed failure or correction | What changed | Reusable instruction |
| --- | --- | --- |
| Example scenarios risked fixing personas and product policy prematurely | Specific decisions, proposals and deferrals were recorded separately | Explore use cases without adopting every detail of a fictional example. |
| Structured forms could imply that the proposed engine already enforced domain schemas | Official documentation and the actual entity-write path were inspected | Keep UX simulations separate from verified primitives and remaining application work. |
| A people hierarchy obscured collaborators and client contacts | Directory became primary; reporting stayed secondary | Revisit domain meaning when the user corrects the experience, not only its appearance. |
| An avatar beside forms did not satisfy conversational onboarding | Visible assistant/user turns, suggestions and editing were introduced | Verify the actual interaction the user asked for. |
| The first visual set multiplied direction count by companion count | Later expansion prioritized complete landing studies | Budget screens as well as directions; deliver a useful first comparison promptly. |
| Readiness was claimed before the styled comparison existed; a stylesheet was missing | Assets were completed and actual browser rendering and a screenshot were checked | Check the exact address and served assets before saying ready. |
| Broad "still working" messages added no evidence | Useful reports named concrete findings, rendered checks and remaining work | Communicate changes in understanding or state. |
| A recorded shortlist did not initially remove other gallery entries | The rendered gallery was filtered to the exact selection and order | Shortlisting has both a decision artifact and a user-visible result. |
| Light/dark became an explicit request after shortlisting | Both themes, switches on index/detail and ordered Previous/Next were specified | Treat theme exploration as a phase before final restyling. |

At the evidence cutoff, light/dark work was in progress. No completed theme/contrast/navigation
verification or final direction approval is claimed here. The skill's review contract captures
what should be checked, not an assertion that this session already passed it.

## Capability example: storage flexibility versus schema enforcement

The session's review of the public MemPalace engine found that accepting entity type strings and
JSON properties did not establish per-type required-field validation in the inspected write path.
This was a dated documentation/static-source finding at development ref
`2da78c883a61a2fa689103c65a1fa9cab18d4dc3`, not a deployed-version or runtime integration audit.
The public evidence locations recorded by that review were the
[graph write implementation](https://github.com/MemPalace/mempalace/blob/2da78c883a61a2fa689103c65a1fa9cab18d4dc3/mempalace/knowledge_graph.py)
and the [adapter interface](https://github.com/MemPalace/mempalace/blob/2da78c883a61a2fa689103c65a1fa9cab18d4dc3/mempalace/sources/base.py).
Adapter metadata declarations and authoritative domain-entity validation were different concerns.

The transferable lesson is to inspect the actual boundary and record the method. Recheck the
chosen engine/version for a new project; this historical finding is not a universal engine rule.

## What was local, not universal

The session used a particular brand metaphor, six initial directions, twelve later additions,
seven shortlisted names, specific scripts, localhost ports, filesystem snapshots and a requested
designer model. Those are not defaults for another project. Reuse the method: purposeful variation,
screen budgets, reversible checkpoints, stable names, explicit decisions and rendered evidence.
PRD authorship belongs to the upstream author; this skill starts at the handoff seam.

## Forward-testing scenario cards

These are maintenance exercises, not reports of executed independent evaluations. Run them with
the skill in an isolated workspace when changing its behavior. Judge artifacts and actions rather
than whether the agent repeats a preferred sentence. Do not connect real services or change a
user's actual browser data for an exercise.

1. **Capability ambiguity.** Supply a brief claiming typed schemas and source code that accepts
   arbitrary properties. Ask for a local concept. Inspect whether the agent records the gap,
   labels form validation as a demonstration and can continue without claiming backend support.
2. **Bounded first comparison.** Supply a frozen prototype and ask for several static directions.
   Inspect whether the agent preserves it, states a screen budget, uses comparable content and
   shares a complete styled gallery before soliciting preferences. Introduce a missing CSS asset:
   readiness should remain pending until the actual rendered result is fixed and checked.
3. **Shortlist and theme navigation.** Supply three directions, then select the third and first in
   that order. Ask for both themes. Inspect whether only those two appear, names/order survive
   regeneration, index/detail switches work and Previous/Next follows the selection in both themes.
   The excluded study should remain recoverable outside the active gallery.
4. **Approval and data preservation.** Supply a saved local company and ask to explore fictional
   content, then shortlist designs. Inspect whether the company can be restored and the working
   prototype stays frozen. Shortlisting must not trigger restyling without a final selection.

Keep actual evaluation results with their artifact revision, commands/browser evidence, outcome
and limitations. Do not label a walkthrough of these cards as an independent agent run.
