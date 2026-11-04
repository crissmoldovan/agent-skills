---
name: explore-prd
description: "Turn an existing PRD into reviewed experience prototypes and distinct visual directions, then an ordered shortlist with light/dark exploration before a selected restyle. Symptoms: explore this PRD, work through the use cases, prototype UI variations, shortlist these designs, compare light and dark. PRD authorship stays with its author; new-ux-discovery owns finding opportunities in an existing product."
license: MIT
compatibility: "An existing PRD or equivalent product brief, a writable prototype workspace, and sanctioned browser tools for rendered review. Uses an available art-direction skill when suitable; otherwise records explicit design research and rationale. Outputs local prototypes, static studies, decisions, and verification evidence; no deployment is implied."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Write Edit Grep Glob Bash Web Browser
---

# Explore a PRD through experience and visual direction

Make a product brief concrete enough for a person to judge: clarify what the experience
means, try realistic flows, compare art directions, narrow them, and explore both themes
before applying a chosen direction. Functional prototypes and static visual studies are
separate artifacts with different verification obligations.

### What this skill does not own

| The job | Whose it is | What this skill does with it |
| --- | --- | --- |
| Authoring the initial PRD | The PRD author and their requirements workflow | Accept a versioned handoff; return contradictions and proposed amendments. |
| Finding new UX opportunities in an existing product | `new-ux-discovery` | Use its findings as inputs when already available. |
| Establishing what source code supports | `investigate-codebase` | Use focused source evidence for capability questions. |
| Recording why a decision was made | `decision-journal` | Feed it explicit decisions and their evidence when needed. |
| Delivering a production change | `land-complex-change` | Hand over the selected direction and verified behavior contract. |

These boundaries do not require installing sibling skills to run this one.

## When to Use

- An existing PRD needs experience exploration, scenario walkthroughs or a clickable prototype.
- A functional concept needs several materially different visual directions before restyling.
- A review has reached refinement, shortlisting or light/dark comparison.

Do not use to invent an initial PRD, ship production infrastructure, or turn an isolated
bug fix into a discovery project. Enter at the phase the user requested; reuse existing
artifacts and decisions rather than restarting the whole sequence.

## Prerequisites

1. Read the PRD, discovery notes, relevant source/design-system files, repository guidance
   and current changes. Identify the exact writable scope and protect unrelated work and
   saved user data. **Complete when:** the input revision, working location, prior
   checkpoints and current authorization are known.
2. Establish the current phase and smallest useful review surface. If the user has already
   authorized the next work, proceed within that scope. Ask only for missing consequential
   information; unresolved production policy need not block a clearly labeled local study.
   **Complete when:** the next artifact and decision it will support are stated.

## Procedure

1. **Receive the PRD and expose its decision boundaries.** Record its revision, author or
   owner, audiences, goals, agreed behavior, open questions, deferred scope and claims
   needing verification. The author's process is an integration seam, not something to
   reconstruct from the finished document. Return proposed amendments separately; do not
   silently rewrite the source or promote draft recommendations to requirements.
   Use the [exploration record template](references/templates.md) only for records needed
   now. **Complete when:** another reader can distinguish requirements, proposals,
   prototype assumptions and unresolved choices.

2. **Walk through concrete use cases before adding features.** Clarify who initiates,
   who benefits, whose information is involved and what success looks like. Avoid locking
   an initiating persona when discovering their role is itself part of the experience.
   Use substantive, explicitly fictional content: a real-length procedure, varied people
   profiles, a decision with alternatives, or a source that conflicts with prior knowledge.
   Keep content comparable across later designs. Explore ordinary use, an empty/no-import
   path and a consequential exception where relevant. Discuss scenarios in manageable
   portions and record each actual user decision; approval of one behavior does not approve
   the entire example. Separate domain concepts such as organization, type, relationship,
   ownership and access before turning them into navigation or fields.
   **Complete when:** priority flows, semantic distinctions and open decisions are clear
   enough to prototype without inventing policy.

3. **Check technical claims at the boundary that matters.** For consequential claims,
   inspect current official documentation and the relevant source or installed version;
   record date, version/ref, evidence and method. Distinguish a documented primitive, a
   draft proposal, an implemented write path and runtime-tested behavior. Arbitrary JSON
   properties are not proof of typed validation; entity detection is not proof of reliable
   relationship discovery; a status event is not proof of delivery. Record verified
   support, application work, gaps and untested assumptions. Do not force a production
   architecture choice merely to continue a local UX study.
   **Complete when:** the capability ledger explains what the prototype may simulate and
   what still needs implementation or a real capability test.

4. **Build and review a reversible functional checkpoint.** Preserve the previous runnable
   version before substantial revisions: use a commit/worktree or a complete filesystem
   snapshot when there is no repository. Record how to run it and known verification
   limits. Implement the selected flows with meaningful content and explicit simulation
   labels. Do not imply live authentication, research, extraction or integration from an
   authored fixture. Preserve real inputs when entering/leaving a demo, editing answers,
   navigating Back or migrating stored state. Test the actual flow in the browser,
   including relevant error recovery, persistence, navigation and responsive layouts.
   Capture user corrections as behavior changes with evidence, not generic polish.
   **Complete when:** the reviewable checkpoint has a tested address, recorded observations
   and limitations; unverified late edits are named rather than declared green.

5. **Freeze behavior and make a bounded visual comparison.** Preserve the functional
   checkpoint and create static studies separately. Use `design-taste-frontend` when
   available and applicable, or another appropriate art-direction skill; without one,
   record subject research and explicit composition, typography and palette decisions.
   Follow the environment's sanctioned browser tools even if a design skill offers its
   own inspector. Keep the user's requested scope: agree or state a direction/screen
   budget and prioritize a complete first comparison. Include the landing page when the
   product has one, plus selected interior views that reveal transfer into daily work.
   Do not automatically multiply every direction into every screen or a working app.
   Give each direction a stable id, visible name, rationale, strength and trade-off.
   Distinguish concepts through composition, type, hierarchy and content treatment,
   rather than only recoloring the same layout. Publish complete HTML, CSS, fonts and
   images before exposing links. Inspect the styled gallery and each offered direction
   in the browser, then share the actual tested URL/port and a screenshot before asking
   for preferences. **Complete when:** the user can compare real rendered alternatives
   from one clear index and understand which companion views exist.

6. **Refine from feedback without losing the comparison.** Expand breadth when useful or
   requested, preserving prior source studies. Do not hold back the first comparison for
   unnecessary companions. Translate feedback into specific changes: brand message,
   wording, hierarchy, density or composition. Preserve what the user liked. A product's
   metaphor may guide occasional copy without taking over every label or illustration.
   Treat interior density separately from spacious landing composition; improve useful
   content per view without shrinking legibility or usable controls. Change both generator
   sources and generated studies where applicable. **Complete when:** revised artifacts
   reflect recorded feedback, the gallery remains complete, and the review request names
   the remaining decision rather than repeating empty status messages.

7. **Record and apply an ordered shortlist.** Save exactly the user's chosen stable ids,
   names and order in a machine-readable manifest and a short human record. A shortlist
   is not approval of a final direction. Update the active gallery to show ONLY those
   entries; preserve rejected studies outside the active comparison. Derive links and
   navigation from the same ordered manifest where practical. Regeneration must not
   resurrect excluded entries. If a label is ambiguous, resolve it from visible previews
   before choosing on the user's behalf. **Complete when:** the manifest, displayed
   names, count, order and active links agree in the rendered gallery.

8. **Explore light and dark for every shortlisted direction.** Make both themes first-class
   review states, including available companion views. A missing interior remains an
   explicit coverage gap, not an implied delivered screen or automatic scope expansion.
   Use coherent semantic surface, text, border, accent, interaction and focus tokens for
   each palette; do not simply invert colors. Keep the concept recognizable and the
   content comparable. Provide an accessible theme switch on BOTH the gallery and each
   individual mockup. Add Previous/Next controls that follow the shortlist order and
   preserve the selected theme where practical; document endpoint behavior. Prefer an
   explicit theme choice across gallery/detail/navigation, with a system default only
   before a choice. Verify contrast and real rendered states using the
   [review checklist](references/review-checklist.md). **Complete when:** every selected
   direction's available views work in both themes, navigation stays within the shortlist,
   and observed results and remaining gaps are recorded.

9. **Hand over a selected direction before restyling.** Present the shortlist and theme
   evidence, retain unresolved product/capability decisions, and obtain an explicit final
   direction decision before changing the functional prototype's visual system. Reuse
   approval already given; a request to shortlist or theme alternatives alone is not that
   decision. After selection and within authorized scope, restyle from the checkpoint,
   preserving verified behavior and content meaning, then retest affected flows.
   **Complete when:** either the selected restyle is verified or the comparison is delivered
   awaiting the user's direction decision, with the next action clear. Production delivery
   remains a separate task.

## Usage Examples

```text
Use explore-prd with this PRD. Clarify the audiences and use cases, check engine
claims, and build a reversible local prototype with clearly fictional examples.
```

```text
Use explore-prd on the current prototype. Freeze its behavior and show several
distinct static art directions in a styled gallery before asking me to choose.
```

```text
Use explore-prd to keep only my shortlisted directions in this order. Explore
light and dark on the gallery and each mockup, with Previous and Next navigation.
```

## What it looks like

An exploration record names the input revision and current phase. It holds scenario
decisions and a capability ledger alongside a runnable checkpoint and its observed
verification. A separate gallery presents named static directions; its shortlist manifest
drives the selected order and both themes. The final handoff names a selected direction,
or clearly says selection is still pending.

Use the [templates](references/templates.md) to start only the records this phase needs.
The [process evidence](references/process-evidence.md) explains why these boundaries exist;
it is historical evidence, not a current product capability statement.

## Pitfalls

- A form beside an assistant avatar may still be a wizard; judge the actual requested
  interaction, including previous replies, edits and useful suggestions.
- Lorem ipsum hides whether a layout supports real knowledge. Fictional content should
  be realistic without inventing customers, endorsements, performance or commercial metrics.
- A successful form submission does not prove every authoritative backend write validates.
- A running server or an HTML file does not prove a styled page exists. Check assets and
  rendering before saying ready, opened, fixed or verified; do not blame refresh without evidence.
- A saved shortlist does not change the gallery. Verify the user-visible result as well.
- A screenshot proves appearance at a moment, not theme switching, navigation or persistence.
- Static product controls may be illustrative. Comparison controls, links and theme switches
  must work; label the distinction instead of building all alternatives into products.

## Verification

- [ ] Current phase, input revision, scope and prior decisions are recorded.
- [ ] Requirements, proposals, assumptions and deferred scope stay distinguishable.
- [ ] Consequential capability claims carry method/ref/date and explicit limits.
- [ ] Checkpoints and existing user data survive the authorized changes.
- [ ] Functional flows have appropriate browser evidence; simulation labels remain visible.
- [ ] The first comparison is complete, styled, bounded and reachable at the tested address.
- [ ] Stable direction names, meaningful differences and available view coverage are visible.
- [ ] Shortlist membership/order matches the gallery and survives regeneration.
- [ ] Both themes, contrast, switches and shortlist navigation have observed checks.
- [ ] Final direction approval precedes a functional restyle; pending work is named honestly.

## Deeper reading

- [Exploration record and shortlist templates](references/templates.md): reuse as needed.
- [Browser, gallery and theme review](references/review-checklist.md): run at review boundaries.
- [Historical process evidence and scenario cards](references/process-evidence.md): rationale
  and forward-testing cases for maintaining this skill.
- [Project fit declaration](references/fit.json): recommendation scope for onboard-project.
