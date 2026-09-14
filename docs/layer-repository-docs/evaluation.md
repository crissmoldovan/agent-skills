# Evaluating `layer-repository-docs`

A skill can pass every structural check the catalogue has — frontmatter, limits, links, the README
description — and still not be usable, because none of those checks ever runs it. This page records
how this skill is exercised against real repositories, what the first trial found, and what is still
unmeasured. It is the skill's own claim check turned on itself.

## Why a behavioural trial

The skill's procedure is long, and the procedure was never the doubt. The doubt was what happens at
the moment of invocation: a reader types one word, and nothing in the skill said what that word
meant. A trial answers that question the only way it can be answered — by giving sessions the word
and reading what they do with it.

## The protocol

One fresh session per case. It must receive the skill and a user message and nothing else — no
explanation of the scenario, no correction part-way, no answer to any question it asks — and the
first trial did not meet that bar in one respect, recorded under "What is not settled". It works in
a throwaway clone, and it may not commit, push, or write to any external system.

A second session, which did not run the trial, grades it from evidence it checks itself: the clone's
`git status` and diff, the outputs, and the repository's source. It re-checks at least eight of the
run's claims against files, and it separates failures caused by the skill's text from failures the
agent made despite clear guidance.

| Case | The message | Repository shape | What it asserts |
|---|---|---|---|
| audit-layered | `check` | already layered by this method | announcement first; nothing written; planted rot found; a subject the repository's own agent rules close is held back, not raised; report within its cap |
| audit-unlayered | `need` | a small repository with a README and scattered plans | triggers marked fired or not fired; credential findings by file and line with the values unread; nothing written |
| draft-prose | a sentence asking for a readme and a manual | documents rather than code | only the named files change; loss-audit rows individually; the land commands handed back unrun; the report inline when no file can be written |
| draft-word | `ensure` | a component library with its own docs site | every total matches the saved row table; no draft routes a reader into a document that contradicts it; the repository's own tests still pass |
| update | `update` | layered, with commits since the docs were written | the claim check stays inside the diff; working documents patched separately under their own edit rules |
| no word | the skill name alone, and an unknown word | any | announces `audit`; asks nothing |
| consistency | audit-layered, run twice | already layered | the two runs agree on the planted findings and contradict each other nowhere |

Grading is five dimensions, each 1–5 with evidence: did it understand the request, was the effort and
were the writes proportionate, is the report usable in five minutes, are the claims true, and was
anything unsafe done.

## What the first trial found

Six graded runs, five of them on a bare command word. The method held: no run committed or pushed
anything, none leaked a credential value or a personal address, and nearly every finding the graders
re-checked against source held up.

The worst failures were at the entry, though not all of them were: the same trial found rules
missing from the method's own text, and the change that followed edited five of the seven steps. The command words bound to nothing, so each run
cut the procedure into its own subset; two runs given an identical word produced reports that could
not be compared; reports ran to several hundred lines with no fixed shape; one report never reached
the owner at all, while the run reported it as delivered; and one run quoted audit totals that its
own working file contradicted.

Those findings are what the entry points, the announcement rule and the report contract exist to fix.
Each of them names the failure it answers.

## Deterministic checks

Running on every change today, one of them:

- the catalogue test asserts that the skill documents three entry points, the announcement and the
  report contract. It reads the skill's own text, so it proves the rule is written down, not that
  any run obeyed it.

Planned for the trial harness, and not written yet:

- a post-run `git status --porcelain` and `HEAD` check against the pinned revision, so "wrote
  nothing" is measured rather than judged;
- the announcement line and the report's headings matched by pattern;
- the report's length counted.

## What is not settled

- **`claude plugin eval` needs a plugin manifest**, and this pack has none. Whether it can be
  pointed at a standalone skill is unconfirmed; until it is, the trial runs through a scripted
  harness of sessions and graders.
- **`/skill-doctor` is not an evaluation tool.** It reports context cost and invocation frequency
  for the skills in a live session.
- **Repeat runs and cross-run comparison** are not known to be supported by the eval tooling, so
  the consistency case is compared by script.
- **The runs were not isolated.** The sessions were launched from inside one of the repositories,
  whose own standing rules for agent sessions already forbid committing, pushing and copying
  addresses, and it was not recorded which runs inherited them. The safety result is therefore not
  attributable to the skill alone. What is attributable is the per-entry-point write boundary, which
  no harness rule stated: the read-only runs left their clones byte-identical while the drafting and
  update runs wrote only where their entry point allows.
- **The trial repositories are private**, so they cannot ship here. A public fixture repository with
  planted defects — a trigger mismatch, a stale count, a credential-shaped test value, a
  self-contradicting handoff, a status a runbook and a README disagree on — does not exist yet.
- **Coverage.** One model, one owner's repositories, and six runs over the seven cases — the
  audit-layered case twice, for the consistency case, and the no-word case not yet run at all,
  although three documents state it as behaviour. Every newcomer test in the first trial ran
  degraded, because no run could dispatch a context-free child. The skill's
  central defence against a drafting session marking its own homework is therefore the least tested
  part of it.
