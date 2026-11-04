# Exploration records

These are optional output shapes, not files to create for every run. Extend an existing
record rather than copying the whole discussion. Keep private evidence in its original
authorized location; a public handoff should contain only safe abstractions.

## PRD integration seam

| Field | Record |
| --- | --- |
| Input | PRD title, revision/ref, date and owner if known |
| Authoring seam | What arrived from the author; questions or proposed amendments to return |
| Current phase | Scenario discovery / functional prototype / visual comparison / shortlist / themes / selected restyle |
| Authorized scope | Writable artifacts, retained checkpoints and next deliverable |
| Audience and outcome | Initiator, beneficiary, other participants; useful outcome |
| Agreed | Decisions with user evidence |
| Proposed | Recommendations awaiting a decision |
| Prototype assumptions | Choices made solely to make a local study inspectable |
| Open or deferred | Consequential unknowns; whether each blocks this phase and why |

Do not invent how the PRD was authored. An input can be useful while some decisions stay open.

## Scenario card

- **Question:** the product distinction this walkthrough should clarify.
- **Actor/context:** role, business situation and relationships; all example details fictional.
- **Starting state:** what is known, missing, disputed or already saved.
- **Walkthrough:** trigger → actions → review/correction → outcome → later retrieval or use.
- **Exception:** one realistic conflict, incomplete input or recovery path.
- **Decision:** confirmed / rejected / proposed / deferred, with the user's actual response.
- **Prototype implication:** behavior to demonstrate, assumptions and exclusions.

Example: a revised fictional brief requests a later date than an existing agreement. Accepting
its contact contribution should not silently approve its requested date. This tests semantics,
independent review and evidence display without dictating a universal knowledge-product schema.

## Capability ledger

| Claim | Evidence / ref / checked date | Method | Finding | Prototype treatment / work remaining |
| --- | --- | --- | --- | --- |
| Custom record fields are validated | Exact write function or official contract | Static source / docs / runtime | Verified support / missing / unverified | Simulated form rule; authoritative write validation still needed |

Keep version and deployed-version uncertainty visible. Link to the smallest useful source;
distinguish public docs, development code, an open proposal and an actual integration test.

## Checkpoint record

- Identity: commit/ref or snapshot manifest; save before/after revision.
- Includes: complete runnable files/assets, relevant notes and run command.
- Address: exact tested URL/port, checked at a recorded time; distinguish prototype/gallery.
- Browser state: isolated review origin/profile when needed; how real user data is preserved.
- Verified: actual scenarios, viewports, errors recovered and screenshot locations.
- Pending/limits: late changes not retested, simulations and known defects.

## Direction record

| Stable id / name | Idea and subject connection | Composition / type / palette | Available views | Strength / trade-off | Research evidence |
| --- | --- | --- | --- | --- | --- |
| edited-notebook / Edited notebook | Maintained knowledge as an edited publication | Editorial mosaic, serif reading, quiet UI | Landing + directory | Rich context / less immediate scanning | Draw/ref or research rationale |

The example is fictional. Reuse content across directions. Record the direction/screen budget
before expanding; six directions with four views each means twenty-four screens, not six.

## Ordered shortlist manifest

Use the project's own format if one exists. A minimal example, with fictional direction names:

```json
{
  "revision": 1,
  "decision": "shortlisted; final direction pending",
  "directions": [
    {
      "id": "edited-notebook",
      "name": "Edited notebook",
      "reviewPath": "edited-notebook.html",
      "views": ["landing", "directory"]
    },
    {
      "id": "quiet-instrument",
      "name": "Quiet instrument",
      "reviewPath": "quiet-instrument.html",
      "views": ["landing"]
    }
  ]
}
```

Array order is review order; ids remain stable if display names change. Generate the active gallery
and Previous/Next from this order where practical. Preserve full source studies elsewhere. On a
shortlist change, update count, links, navigation, theme coverage and the human decision record.
Theme may use one tokenized page or paired variants; the reviewPath opens a view with its own switch.
Do not infer an unlisted interior screen from a direction's presence in the shortlist.

## Iteration/change log

| Date / revision | Feedback or finding | Decision status | Artifact / generator changed | Check run and result | Next decision |
| --- | --- | --- | --- | --- | --- |
| Review 1 | Interior content too spread out | Authorized refinement | Interior spacing only | Desktop/mobile reading and controls inspected | Compare refined set |

Record substantive changes, not every command. A failed or pending check remains visible until
a later observation resolves it. Keep product decisions distinct from cosmetic preferences.

## Selected-direction handoff

- Selected stable id/name, approval evidence and preferred theme behavior.
- Frozen functional checkpoint to restyle; approved behavior and content distinctions to retain.
- Brand/copy decisions, density guidance and applicable design tokens/assets.
- Required companion views and unresolved coverage gaps.
- Capability findings and remaining production work.
- Browser evidence, limitations and authorized next action.

If no direction is approved, deliver the comparison and name selection as pending.
