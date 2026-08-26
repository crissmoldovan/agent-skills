---
name: new-ux-discovery
description: "Discover UX improvements a codebase can already support — across UI, API, CLI, MCP and notifications — and gate every candidate through a not-already-implemented sweep and a no-confusion check before proposing it. Use when you want evidence-backed UX opportunities, riding a change or from pure analysis."
license: MIT
compatibility: "Any repository the agent can read, with git and a text search tool. Generated registries — a route index, a tool catalogue, a job list — are consumed where they exist and built by hand where they do not. Forge access to open branches and pull requests raises both gates sharply, and losing it is the degradation that costs the most. Checking who can read what needs a queryable datastore; without one, two signal classes lose their access half and say so. Output is a capped, ranked list with its sweep coverage attached; nothing is designed, nothing is built, and nothing is committed unless a run record is asked for."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Write Grep Glob Bash
---

# Discover UX a codebase can already support

Ask for UX improvements and you get a wish list: ideas that are plausible, unanchored,
and — often enough to be the default — already built. The expensive failures are not the
bad ideas. They are the good ones that duplicate something already shipped behind a
permission, or that add a second word for a thing the codebase already names, or that put
a link on the stale half of a fork nobody noticed had two halves.

This skill finds opportunities the way a search finds evidence. It enumerates the surfaces
first, sweeps nine signal classes that each have a recipe and a named false-positive check,
and then puts every survivor through two gates before it is allowed onto the page: **has
this already been implemented**, and **would proposing this create confusion**. Candidates
that fail are not deleted — they go into a DROPPED section with one reason line each,
because the reason is what stops the next agent proposing them again next month.

Two modes share one gate stack and one output contract, differing only in the seed set:
**pure analysis**, which sweeps the whole surface inventory, and **riding a change**, which
takes a blast map and asks what the change just made newly possible. Neither mode builds
anything. A discovery run that starts editing files has failed at its own job.

## What separates an opportunity from an idea

- **An anchor.** Every claim points at `path:line`, or at a verbatim query and its result
  count. A finding with no anchor is an opinion with a confident tone.
- **A gate record, not a gate claim.** "I checked whether this exists" is not a record. The
  record is the three names it was searched under, the count of surface classes swept, the
  whole-tree search, the work-in-flight search, and the access check — written down. An
  empty gate record disqualifies the candidate, however good the idea is.
- **A stated sweep coverage.** Which surface classes were enumerated and which were not.
  An unenumerated class is a hole in gate (a), and a report that hides it is claiming a
  completeness it did not buy.
- **A clean result is a valid result.** Zero survivors, with a sweep record showing what was
  checked, is a better deliverable than a padded list. The cap is a ceiling, never a quota.
- **Offered, never taken.** Nothing here gets implemented by the run that found it. An agent
  that has just found a good idea is exactly the agent that will implement it, which is why
  the prohibition is written into the output header rather than left to judgement.

Composition: **`investigate-codebase`** owns the searching — the control rule on every
negative, the contradiction table, the child briefs — and this skill calls it rather than
improvising searches. **`blast-area`** produces the map that seeds riding-a-change mode, and
this skill **consumes** it rather than redoing it. **`derive-codebase-context`** builds the
generated registries that make step 0 cheap; where they exist, read them instead of
re-deriving what a generator already emits. **`resolve-problem-report`** and
**`land-complex-change`** own building a chosen candidate. Install the companions with
`npx skills add crissmoldovan/agent-skills`.

## When to Use

- Someone wants to know what the product could do better that the code can already support.
- A change just landed or is about to, and the question is what it made newly possible,
  newly exposed, or newly wrong.
- A roadmap needs candidates anchored in the codebase rather than in a workshop.
- A surface feels incoherent — two ways to do one thing, a word that means two things — and
  the incoherence needs locating before it is designed around.
- Data is being collected and somebody suspects nobody can see it, or that a capability
  exists but nobody can reach it.
- A previous list of "improvements" turned out to be half-implemented already, and the next
  list needs to survive the check the last one skipped.

Do not use it for greenfield design — there is no codebase to sweep, and the gates have
nothing to search. Do not use it for visual or aesthetic critique: nothing here judges
whether a screen looks good, and a finding of the form "this feels dated" has no anchor and
no gate record. Do not use it to design or evaluate an experiment; A/B strategy is a
different discipline with different evidence. Do not use it to prioritise someone else's
backlog — this skill discovers candidates from the code, it does not rank items somebody
else wrote. Do not use it to answer a question about how the code works; that is
`investigate-codebase`, which this skill calls. Do not use it to map what a change would
affect: that is `blast-area`, whose output this skill consumes as a seed set. Do not use it
to build the fix — `resolve-problem-report` owns the report-to-resolution pipeline and
`land-complex-change` owns landing the change inside a budget.

## Prerequisites

1. **A mode, chosen and stated.** Pure analysis sweeps the inventory; riding a change takes
   a blast map as its seed and asks the five newly-questions against it. The modes share the
   gates and the output contract, so this is a choice of seed set, not of rigour.
   **Complete when:** the mode is named in the output header, with its seed.
2. **The repository at a stated revision, with its dirty state.** Findings rot. A candidate
   that does not exist at this sha may exist at the next one, and half the false positives
   this skill catches live in work that is in flight rather than in the tree.
   **Complete when:** sha and dirty state are recorded in the header.
3. **Forge reach declared.** Whether open branches and open pull requests are searchable
   from here. This is not a nicety: in one measured sweep, both of the strongest naming
   collisions found were between two open pull requests and were invisible in the tree.
   **Complete when:** forge access is recorded as available, or its absence is recorded as a
   named confidence caveat.
4. **Datastore reach declared.** Whether the access rules — who may read which rows — can be
   queried. Two signal classes depend on it, and a missing store makes them half-answerable
   rather than unanswerable.
   **Complete when:** each store is queryable and queried, or named as out of reach.
5. **The personas named.** Who the surfaces serve: end user, operator, administrator,
   integrator, agent. Every finding names one. "Users" as a single undifferentiated noun is
   what hides the most common form of the first signal class — a reader whose access rule
   excludes the very persona the rows are about.
   **Complete when:** the persona list is written down, and each is one somebody could be.

## Procedure

1. **Step 0, mandatory: build the surface inventory before looking for anything.** Nine
   classes. A sweep that starts from an idea and searches for support for it finds support
   for it; a sweep that starts from the inventory finds what is there. Consume generated
   registries where they exist — a route index, a tool catalogue, a job list — and never
   re-derive by grep what a generator emits. **Record which classes were enumerated and
   which were not**, as "n of 9", with a skip reason per omission. An unenumerated class is
   a hole in gate (a) and the report says so on the page. Recipes per class are in
   [the surface inventory](references/surface-inventory.md).

   | # | Class (id) | Enumerate | The trap it exists to catch |
   |---|---|---|---|
   | 1 | **HTTP routes** (`http-routes`) | every endpoint and the methods it answers | a route that exists and returns nothing is not a surface |
   | 2 | **Pages and screens** (`screens`) | every screen **and what links to it** | linkage is the surface; a screen nothing links to is class-2 signal, not inventory |
   | 3 | **Tool registries** (`tool-registries`) | every registry, then every tool in each | **plural is load-bearing** — one measured monorepo has two, and the second one is where the false positives live |
   | 4 | **CLI entry points** (`cli`) | binaries, subcommands, and script targets a human is told to run | a script in the manifest nobody documents is reachable and undiscoverable |
   | 5 | **Background jobs** (`jobs`) | tasks, queues, crons — and the registry each must appear in to run | an unregistered job is not a surface; it is a silent nothing |
   | 6 | **Outbound notification channels** (`notifications-out`) | mail, chat, push, webhooks out — and what triggers each | a channel with no configured recipient delivers nowhere and reports success |
   | 7 | **Inbound webhooks** (`webhooks-in`) | every receiver, its verification, and what it does on receipt | a receiver that verifies and drops is a surface that returns nothing |
   | 8 | **Docs and help text** (`docs-and-help`) | in-product help, error copy, READMEs, command help | help text is a surface with a persona; stale help is a defect, not a typo |
   | 9 | **Data access rules** (`data-access-rules`) | who may read which rows, per persona — the rules, not the tables | existence is not reach; this class is what turns "missing" into "gated" |

   The rule that makes the inventory honest: **a surface that renders and returns nothing is
   not a surface.** Count what a persona can actually reach and see.

2. **Sweep the nine signal classes, each with its false-positive check run BEFORE the
   finding is written.** The check is not review; it is part of the recipe, and a finding
   written before its check is a finding that will be withdrawn. Full recipes, the exact
   searches, and the measured failure behind each check are in
   [the nine signal classes](references/signal-classes.md).

   | # | Signal (id) | Recipe, in one line | False-positive check, run first |
   |---|---|---|---|
   | 1 | **collected-but-unsurfaced** (`unsurfaced`) | persisted fields with no reader on any enumerated surface | the subtle form: a reader exists but its **access rule excludes the persona the rows are about** — check reach, not existence |
   | 2 | **orphan surface** (`orphan`) | for each screen or route, search for its path **in both quote styles and as a template prefix** | re-classify into linked / **mentioned-only** / reachable-by-design. CONTROL: assert the route walk returned a plausible count before trusting any zero |
   | 3 | **duplicate surface** (`duplicate`) | sibling basenames, then **content hashes** of the pair | divergent hashes mean forks — and **the linked one is not necessarily the newer one**. Converts class-2 findings into consolidations |
   | 4 | **competing vocabulary** (`vocabulary`) | one concept, two words — searched **including open branches and pull requests** | this class hides in work in flight; and **a shared word with different membership is worse than two disjoint words** |
   | 5 | **surface asymmetry** (`asymmetry`) | set difference **in both directions** between two registries or two surfaces | the item may exist in a registry you did not enumerate — **re-search the whole tree by name** before calling it missing |
   | 6 | **measured-but-unrouted** (`unrouted`) | values computed or scored, with no route to a decision point | the consumer may be **data-resident** — a saved query, a dashboard row — which no code search returns |
   | 7 | **silent failure** (`silent-failure`) | success-shaped non-events, write-then-act orderings, swallowed errors **on the asked-for path** | fail-soft makes its own tests decorative — a test asserting "did not throw" proves nothing; assert the inner call fired |
   | 8 | **cannot-describe-itself** (`cannot-describe-itself`) | identity, principal, capability list, refusal reason — each answerable in one call? | and the inverse: a **predictor using a rule the executor does not apply**, so the preview says yes and the run refuses |
   | 9 | **stale deferral markers** (`stale-deferral`) | three narrowing filters, never a raw marker grep | a raw grep for deferral markers returns four figures and is useless; the filters are reachability, the named blocker being gone, and age |

   The three narrowing filters for class 9, in order: the marker sits on a path reachable
   from an enumerated surface; the condition it defers on **has since become true** or the
   blocker it names no longer exists; and the line is older than a staleness threshold read
   from blame. The threshold is currently reasoned rather than measured and is awaiting
   benchmark calibration — state the value you used.

3. **Run gate (a), NOT-ALREADY-IMPLEMENTED, in five ordered steps, and record each one.**
   This is the gate that pays for itself. Steps are ordered by cost, and step 3 is the
   cheapest thing in this skill and the one that catches the most embarrassing failure.

   1. **Name it three ways** — the user's words, the domain word this codebase uses, and the
      identifier form (the symbol, the slug, the route segment). Most already-built things
      are missed because they were searched under one of the three.
   2. **Sweep every step-0 class** for it, and record **"n of m"**. Not "I looked" — the
      count, with the classes named.
   3. **Search the whole tree by name.** Unscoped, no path filter. This is the step that
      catches the second-registry false positive: the capability exists, registered
      somewhere the class sweep never enumerated.
   4. **Search work in flight** — open branches and open pull requests. The tree is not the
      product; it is the product minus everything currently being built.
   5. **Check access, not just existence.** A capability nobody can reach is not implemented
      from the persona's side, and this step is what turns a wrong drop into a real finding.

   Three verdicts, one per candidate:

   | Verdict | Disposition |
   |---|---|
   | **EXISTS-AND-REACHABLE** | drop, with its reason line in DROPPED |
   | **EXISTS-BUT-GATED-OR-UNDISCOVERABLE** | **re-file** as an access or discoverability opportunity — the claim changes and the effort usually drops a class |
   | **DOES-NOT-EXIST** | proceed to gate (b) |

   **An empty gate-(a) record disqualifies the candidate.** Not "flags", not "caveats" —
   disqualifies. A claim of having checked is not a record of a check.

4. **Run gate (b), NO-CONFUSION, as three searched questions.** Searched, not considered:
   each answer carries the query that produced it. Dispositions and the worked searches are
   in [the two gates](references/gates.md).

   - **Q1 — is there already a second way to do this?** If yes, the proposal is **converted
     into a consolidation** and is never presented as new. Adding a third way to do a thing
     that already has two is the failure this question exists to prevent.
   - **Q2 — would this create a conflicting affordance?** Two controls whose effects
     overlap, disagree, or shadow each other; a new default that contradicts an existing
     one.
   - **Q3 — does the name collide?** Including **near-neighbours** — singular/plural, a
     prefix of an existing term, the same word in another subsystem — and including open
     branches. A failure here means **drop, or re-scope while stating what was re-scoped**.
     A collision that is kept and noted in a caveat is a failed proposal, not a caveated one.

   **Special rule for a shared word:** when two subsystems already use one word for two
   things, name **both** subsystems in the finding, and **locate the prior written
   resolution before proposing anything**. Somebody has usually already decided this, and
   re-deciding it silently is how a repository ends up with three answers.

   Every candidate that fails either gate goes into the **DROPPED** section with one reason
   line. That section is the most reusable part of the report.

5. **Expect the gates to invert a candidate, not merely filter it.** In one measured sweep,
   an orphan screen — no link anywhere in the tree — looked like a clean "add it to the
   navigation". Gate (a) step 3, the whole-tree search by name, found a sibling screen at a
   near-identical path that *was* linked, behind an administrator-only rule. Gate (b) Q1
   then compared content hashes: the two had diverged, and the orphan was the **stale** half
   of the fork. The proposal that would have shipped was "add a nav link", and it would have
   surfaced the stale fork to every user of the product. What shipped instead was a
   consolidation: reconcile the fork, keep one, and decide the access rule deliberately.

   > The gates did not merely filter this candidate, they inverted it, and that is the
   > normal case.

   The full run, with its searches and its hash comparison, is in
   [a worked discovery](references/worked-discovery.md).

6. **Riding a change: seed from the blast map and ask five questions per affected surface.**
   The input is `blast-area`'s envelope — surfaces, nodes, edges, blindspots. For each
   affected surface ask: what is **newly possible** that was not before; what is **newly
   exposed** to a persona who could not see it; what is **newly asymmetric** against its
   sibling surface; what is **newly wrong** — copy, help text, an error message, a reason
   code that has stopped being true; and what is **newly orphaned or duplicated** by the
   change. Then price the scope, mechanically — the questions and the pricing worked through
   are in [riding a change](references/riding-a-change.md).

   **INSIDE-SCOPE** means all five of: only files the change already touches; no new
   surface; no new user-visible name; no migration; and no new spend path. Anything else is
   a **SCOPE-CHANGE** and carries a **three-part price** — effort class (S/M/L), the review
   surface it adds, and the runtime cost if it is spend-bearing — **or it is not offered at
   all**. There is no unpriced middle.

   State this sentence verbatim in the output header of a riding-a-change run:

   ```text
   Scope proposals in this report are offered, never taken: nothing here has been
   implemented, and the run that produced it will not implement it.
   ```

7. **Apply the reason-code vocabulary rule to any "make this absence explain itself"
   proposal.** This shape recurs across at least three of the signal classes and is the most
   frequently botched fix: the proposal is to have the system say *why* nothing happened,
   and the implementation invents a fresh vocabulary next to the one already there. Four
   requirements, all four or the proposal is not gated:

   - **Cite an existing precedent enum and extend it.** Never introduce a second vocabulary
     for the same kind of absence.
   - **State the not-attempted vs ran-no-result distinction.** "We never ran it" and "we ran
     it and found nothing" are different facts, and a code that conflates them is worse than
     no code, because it is confidently wrong.
   - **Supply negative controls known in advance** — cases whose expected code you can state
     before running, so a vocabulary that is silently never emitted is detectable.
   - **Check the code NAME is true under the predicate that actually produces it.** A code
     called `no-match` emitted by a branch that also fires on a timeout is a lie shipped in a
     surface. A reason code is a UX surface and can be wrong exactly the way a screen can.

8. **Rank, cap at ten, and attach the coverage.** The rank key is strict and applied in
   order — later keys break ties in earlier ones, never override them:

   ```text
   1. evidence strength    measured with a fired control > measured > sampled > inferred
   2. affected population   a number where one is obtainable; "unknown" sorts last
   3. harm shape            silent wrong answer > silent nothing > friction > cosmetic
   4. effort                ascending — S, then M, then L
   5. scope                 inside-scope before scope-change
   ```

   Three sections, always all three, defined in [the output contract](references/output-contract.md):
   the **ranked rows** (at most ten), **DROPPED** (one reason line each), and **NOT SWEPT**
   (which surface and signal classes were not covered, and why). Per-row required fields:

   ```json
   {
     "signal_class": "orphan",
     "claim": "the gap, stated as what is missing or wrong — never the fix",
     "evidence": "path:line, or the verbatim query with its tool and hit count",
     "surfaces": ["screens", "http-routes"],
     "persona": "the role affected, from the named list",
     "effort": "S | M | L",
     "changes_scope": "inside-scope | scope-change",
     "price": { "effort_class": "M", "review_surface": "…", "runtime_cost": "… | none" },
     "gate_a": { "names": ["…", "…", "…"], "classes_swept": "7 of 9",
                 "whole_tree": "verbatim query → hits", "in_flight": "…",
                 "access": "…", "verdict": "DOES-NOT-EXIST" },
     "gate_b": { "q1": "…", "q2": "…", "q3": "…",
                 "disposition": "propose | convert | re-scope | drop" }
   }
   ```

   **Enforced exclusions.** No redesign essays — the claim is the gap, and the fix belongs to
   whoever builds it. No unanchored findings. No aesthetic critique. And no "add a link to
   this" when the target has a duplicate, which is the exact failure step 5 describes.
   **A clean result is a valid result:** zero rows plus a full sweep record is a complete,
   deliverable answer, and padding to the cap is the failure the cap was meant to prevent.

9. **Degrade explicitly, and say which rung you are on.** Every rung below changes the
   answer's reach and belongs in the output, not in a footnote.

   | Missing | What happens |
   |---|---|
   | **Subagents** | sweep sequentially **in yield order** — classes 2, 5, 1 first — and declare the rest **unswept** rather than rushing them |
   | **Model choice** | the cap drops from ten rows to **five**; depth is what the band was buying |
   | **Datastore** | classes 1 and 6 lose their access-rule half; report that half unchecked, never empty |
   | **Git or forge access** | the **most damaging** degradation — both of the strongest collisions in one measured sweep were between two open pull requests. A named confidence caveat is required on every gate-(a) and gate-(b) record |
   | **Generated registries** | build the minimum inventory by hand, recommend `derive-codebase-context` as a follow-up, and **never block on it** |

10. **Hand the report on, unbuilt.** A chosen candidate goes to `resolve-problem-report` to
    be dug into and specced, or straight to `land-complex-change` when it is already well
    enough understood to budget. Hand over the rows **with** the DROPPED and NOT-SWEPT
    sections: a consumer given only the ranked rows will read the absences as checked.

11. **Document the run when the branch calls for it.** The convention is below, identical in
    every skill of this family that supports it; what a discovery run puts under those
    headings is the **sweep ledger** described next.

### The sweep ledger

Under the five fixed headings, a `new-ux-discovery` record carries these required bullets:

- **What was searched** — the surface inventory as enumerated, **with a skip reason per
  omitted class**; then the per-signal-class commands verbatim with their raw counts,
  **including the classes that yielded nothing**. A zero-yield class that is missing from the
  ledger reads as a class that was never run.
- **Who searched it** — one line per child: role, tier band, the class or surface it was
  given, and what was withheld. Sequential passes are recorded as sequential.
- **What each found** — the raw hits per class, and the **control assertions**: for class 2,
  that the route walk returned a plausible count; for every zero, the positive variant that
  fired.
- **How it reconciled** — the re-classifications (mentioned-only versus linked,
  fork-versus-duplicate), and the contradiction table where two classes disagreed about the
  same artefact.
- **What was decided and why** — **every per-candidate gate record verbatim, including the
  dropped ones.** This is the most valuable section in the file: the dropped records are why
  the next agent does not re-propose them. Then the ranked output, and the closing paragraph
  of what was not swept.

### The run record

**Documenting the run.** Write a full record when the invocation carries `--document` (or
an unmistakable phrase such as "document the run"), at `docs/new-ux-discovery/<UTC-date>-<slug>.md`
in the host repository — and always when the run is unattended, in which case it goes to the
harness scratch directory, never the repository, and its path is named in the final answer;
if you cannot confirm a human will see and answer a question in THIS run, treat it as
unattended. Attended with no token: stay silent, offering once only if the run ends with an
unresolved contradiction or an open blocking question. Five headings, in order: What was
searched / Who searched it / What each found / How it reconciled / What was decided and why,
closing with what this run could not see. No secret values, machine-absolute paths, child
transcripts or raw logs; no unmarked inference or unearned benefit claims; never edit an
earlier record, and never let writing one change the answer.

Records are written per [the run-record convention](references/documenting-the-run.md).

## Usage Examples

```text
Sweep this repository for UX improvements it could already support. Enumerate the surfaces
first and tell me how many classes you actually got through — and for every candidate, show
me the not-already-implemented check before you show me the idea.
```

```text
We just merged the change that splits enrichment into two stages. Ride that change: for each
surface it touched, what is newly possible, newly exposed, or newly wrong now? Price anything
outside the files that change already touched, and do not build any of it.
```

```text
I suspect we collect a lot of data nobody can see. Find the fields we persist that no screen,
route or export reads — and check whether the reader exists but excludes the very people the
rows are about, because that is the case I keep missing.
```

```text
Before I write up these three ideas: put each through the gates. Search the whole tree by
name, search the open pull requests too, and tell me plainly if one of them is already
shipped behind an admin permission.
```

```text
Run a discovery sweep and document the run (--document) so the dropped candidates are written
down with their reasons. Last time we re-proposed the same two things a month apart because
nobody recorded why they were dropped.
```

## Pitfalls

- **Searching for support for an idea instead of sweeping the inventory.** A sweep seeded by
  a hypothesis returns the hypothesis. Step 0 exists to make the seed the codebase.
- **One tool registry.** Plural is load-bearing. The capability you are about to propose is
  registered in the second registry, and gate (a) step 3 is the only thing that finds it.
- **"I checked that it doesn't exist."** That sentence is not a record and does not satisfy
  gate (a). Three names, n-of-m classes, the whole-tree query, work in flight, access.
- **A zero-hit search read as absence.** The route walk that returns nothing may have been
  broken. Assert a plausible count first; a control that fires proves the apparatus worked.
- **Assuming the linked copy is the current one.** Divergent hashes mean a fork, and forks do
  not label their halves. The orphan is the newer one often enough to matter.
- **Proposing "add a link" to a surface with a duplicate.** That is the one enforced
  exclusion with a shipping consequence: the link surfaces the stale half to everybody.
- **Searching only the tree.** Half the naming collisions live in open pull requests. Without
  forge access this skill is on its worst rung and has to say so.
- **Treating a shared word as a smaller problem than two words.** One word with two
  memberships is the harder failure; disjoint vocabularies at least sort.
- **A second reason-code vocabulary.** Extend the enum that exists. And check the code's name
  is true under the branch that emits it — a code that fires on a timeout and says "no match"
  is a wrong answer with a confident label.
- **Conflating not-attempted with ran-and-found-nothing.** Two different facts, one code, and
  everyone downstream now believes something false.
- **Padding to the cap.** Ten is a ceiling, never a quota. A one-row report with a full sweep
  record beats a ten-row report with four unanchored fillers.
- **Presenting the fix as the claim.** "Add a filter to the export screen" is a design
  decision taken before the gap was agreed. The claim is the gap.
- **Taking a scope proposal instead of offering it.** The run that finds a good idea is the
  run most likely to implement it, and implementing it silently converts a discovery report
  into an unreviewed change.
- **Dropping candidates quietly.** A drop with no reason line is work that will be redone.

## Verification

- [ ] The mode is stated with its seed set, and the revision and dirty state are in the header.
- [ ] Step 0 ran first, and the output records the surface inventory as **"n of 9"** with a
      skip reason for every class not enumerated.
- [ ] Generated registries were consumed where they exist rather than re-derived by search.
- [ ] Every one of the nine signal classes appears in the coverage record, **including those
      that yielded nothing**.
- [ ] Each finding's false-positive check was run **before** the finding was written, and the
      check is recorded with it.
- [ ] Class 2's control assertion — that the route walk returned a plausible count — fired
      and is recorded.
- [ ] Every candidate carries a **gate (a) record** with all five steps: three names, the
      n-of-m class sweep, the whole-tree query, the work-in-flight search, and the access
      check. No candidate with an empty record appears in the ranked rows.
- [ ] Every gate-(a) verdict is one of EXISTS-AND-REACHABLE, EXISTS-BUT-GATED-OR-
      UNDISCOVERABLE, or DOES-NOT-EXIST, and a gated verdict was **re-filed** rather than
      dropped.
- [ ] Every surviving candidate carries a **gate (b) record** answering Q1, Q2 and Q3, each
      with the query that answered it.
- [ ] Any Q1 failure was **converted to a consolidation**, not presented as new; any Q3
      failure was dropped or re-scoped **with the re-scope stated**. No collision is carried
      in a caveat.
- [ ] A shared word names **both** subsystems, and the prior written resolution was located
      before anything was proposed.
- [ ] The **DROPPED** section exists with one reason line per dropped candidate, and the
      **NOT SWEPT** section names the classes not covered.
- [ ] The ranked list is capped at ten (five where model choice was unavailable) and sorted by
      the strict key in order.
- [ ] Every row carries all required fields, and every claim states the **gap** rather than a
      fix, anchored to `path:line` or a verbatim query and count.
- [ ] Riding-a-change runs price every SCOPE-CHANGE with all three parts, and the
      offered-never-taken sentence appears **verbatim** in the output header.
- [ ] Any "make this absence explain itself" proposal cites an existing enum, distinguishes
      not-attempted from ran-no-result, names its negative controls, and checks the code name
      against its predicate.
- [ ] The degradation rung is named in the output where any capability was missing, and the
      forge-access caveat is on every gate record when the forge was unreachable.
- [ ] Nothing was designed, nothing was built, no file in the repository was changed, and
      nothing was committed except a run record that was explicitly asked for.
- [ ] Where a record was written, it exists at `docs/new-ux-discovery/<UTC-date>-<slug>.md`
      (or the harness scratch path for an unattended run, named in the final answer), under
      the five required headings, carrying the sweep ledger's required bullets.

## Deeper reading

- [The surface inventory](references/surface-inventory.md): all nine classes with their
  enumeration recipes, what counts as reachable, the registries-are-plural rule, and how to
  build the inventory by hand when nothing generates it.
- [The nine signal classes](references/signal-classes.md): each class with its full recipe,
  its named false-positive check, the measured failure the check exists to prevent, and the
  yield order to sweep them in when the passes are sequential.
- [The two gates](references/gates.md): gate (a)'s five steps with worked searches and the
  three verdicts, gate (b)'s three questions with their dispositions, the shared-word rule,
  and what a complete gate record looks like written out.
- [Riding a change](references/riding-a-change.md): the five newly-questions applied per
  surface, the mechanical inside-scope test, the three-part price, and why scope proposals
  are offered and never taken.
- [The output contract](references/output-contract.md): the three sections, the rank key
  applied to a worked tie, every row field defined, the enforced exclusions, and what a clean
  result looks like on the page.
- [Reason codes as a UX surface](references/reason-codes.md): the precedent-enum rule, the
  not-attempted distinction, negative controls known in advance, and the name-versus-predicate
  check with its failure modes.
- [A worked discovery](references/worked-discovery.md): one candidate taken from orphan screen
  to consolidation, with the searches, the hash comparison, and the inverted proposal.
- [The run-record convention](references/documenting-the-run.md): when a record is written,
  where it goes, its five headings, the prohibitions, and a worked record.
