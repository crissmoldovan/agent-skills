# The nine signal classes

Each class is a recipe plus a **named false-positive check that runs before the finding is
written**. The order matters: a finding drafted first and checked second gets defended
rather than withdrawn, and the check stops being a check and becomes a formality.

Every recipe below is repo-agnostic. Substitute the repository's own conventions for the
search patterns; keep the control, the ordering and the check.

**Yield order**, for sequential sweeps when no subagents are available: **2, 5, 1**, then
3, 4, 7, 6, 8, 9. Classes 2 and 5 are cheap and productive; class 1 is the one users care
about most. Classes not reached are declared **unswept**, never implied as empty.

---

## 1. Collected-but-unsurfaced (`unsurfaced`)

**Recipe.** Take the persisted fields — columns, document keys, event properties. For each,
search for a reader on any enumerated surface: a select, a projection, a serialiser, an
export, a screen binding. Fields with no reader are candidates.

**The subtle form, which is the valuable one.** A reader exists, and its **access rule
excludes the persona the rows are about**. The data is collected from a person who cannot
see it; an operator can. This reads as "surfaced" to a code search and as "invisible" to the
persona, and only the class 9 inventory — the access rules — distinguishes them.

**False-positive check, run first:** does a reader exist that your search's shape cannot
see? Fields are read through `SELECT *`, through spread operators, through generic
serialisers that project whole rows, and through data-resident definitions — a saved query
or a report template stored as a row. Check for the wildcard read before claiming no reader.
Then check reach: for each reader found, which personas pass its access rule?

**Degradation.** Without a queryable store, the access half is unchecked. Say that; do not
report the code half as the whole answer.

---

## 2. Orphan surface / single entry point (`orphan`)

**Recipe.** For each screen or route in the inventory, search the whole tree for its path:

- as a literal in **both quote styles** the language allows;
- as a **template prefix** — the static head of an interpolated path, because a route built
  as a template literal never appears whole anywhere;
- in non-code surfaces: navigation definitions, mail and chat templates, documentation.

Then **re-classify** every zero into one of three, never leaving it as "orphan":

| Class | Meaning |
|---|---|
| **linked** | a real destination somewhere a persona can reach |
| **mentioned-only** | the path appears — in a test, a comment, a changelog — but nothing navigates to it |
| **reachable-by-design** | deliberately unlinked: a deep link sent by mail, an operator tool, a debug page |

**CONTROL, and it is mandatory:** before trusting any zero, **assert the route walk found a
plausible count.** Take a screen you know is linked and run the identical search; it must
return hits. A walk that returns zero for everything is a broken walk, and a broken walk
reads exactly like a repository full of orphans. In one measured sweep this control is what
separated four genuine orphans from a search that was silently matching nothing.

---

## 3. Duplicate surface (`duplicate`)

**Recipe.** Group by sibling basename and by near-identical path segments. For each group,
**hash the contents** of the members and compare.

- Identical hashes: a copy. Low-value unless one is dead.
- **Divergent hashes: a fork**, and this is the finding.

**False-positive check, run first — and it is the one that inverts proposals:** **the linked
one is not necessarily the newer one.** Do not infer recency from linkage. Compare last-change
dates from history, and compare the two contents for features present in one and absent in the
other. A fork whose orphan half is the newer, richer half is common enough that assuming the
opposite is how "add a nav link" ships the stale copy to everyone.

**Interaction with class 2.** A class-2 orphan whose sibling is a fork **converts** from
"surface it" to "consolidate it". This conversion happens at gate (b) Q1, and it is the
single most valuable interaction in this skill.

---

## 4. Competing vocabulary (`vocabulary`)

**Recipe.** For each domain concept, list the words the codebase uses for it: identifiers,
route segments, table and column names, user-facing copy, tool names, error strings. Two
words for one concept is the obvious form.

**Search INCLUDING open branches and pull requests.** This class hides in work in flight
more than in the tree: two people name the same new concept differently, in parallel, and
neither branch can see the other. In one measured sweep, the two strongest collisions found
were both between two open pull requests and were invisible in the checked-out tree.

**False-positive check, run first:** are the two words actually one concept, or two concepts
with overlapping copy? Compare **membership**: what set does each word denote? And note the
ranking that matters — **a shared word with different membership is worse than two disjoint
words.** Two words for one thing is friction. One word for two things is a wrong answer that
looks correct, in a surface, to someone who cannot tell.

---

## 5. Surface asymmetry (`asymmetry`)

**Recipe.** Take two registries, or two surfaces that ought to mirror each other — read tools
versus write tools, list endpoints versus detail endpoints, screens versus their exports —
and compute the **set difference in both directions**. Both directions: the missing member is
as often on the side you assumed was complete.

**The critical false positive, checked first:** **the item may exist in a registry you did not
enumerate.** Before writing "X has no Y", **re-search the whole tree by name**, unscoped. This
is the same step as gate (a) step 3, and it is cheap; run it here so the candidate does not
reach the gate already wrong. In one measured sweep, three slugs that looked unregistered were
absent only from the registry that had been walked.

---

## 6. Measured-but-unrouted (`unrouted`)

**Recipe.** Find values the system computes or scores for a decision — a score, a status, a
health signal, a cost total — and trace each to a decision point: a route, a screen, an alert,
a gate, a report. A value computed and stored with no route to anyone deciding anything is the
finding.

Distinguish from class 1: class 1 is data **collected** and never shown; class 6 is a
measurement **produced for a decision** that never reaches one.

**False-positive check, run first:** the consumer may be **data-resident** — a saved query, a
dashboard definition, an alert rule stored as a row rather than as code. No code search returns
those. Query the store, or record the class as half-checked.

---

## 7. Silent failure (`silent-failure`)

**Recipe.** Three shapes, searched deliberately:

- **Success-shaped non-events.** A send with no configured recipient; a batch with an empty
  input that logs "complete"; a sync whose zero-row result is indistinguishable from success.
- **Write-then-act orderings.** State committed before the action it describes is attempted,
  so a failure leaves a record claiming the action happened.
- **Swallowed errors on the asked-for path.** A catch that logs and continues is defensible on
  a background path and is a wrong answer on the path the user just asked for.

**False-positive check, run first:** is the swallow deliberate and correct here? Fail-soft is
a real design choice on a non-critical path. The finding is fail-soft **on the path the persona
is waiting on**, or fail-soft with no signal anywhere.

**The second-order finding, which travels with this class:** fail-soft makes its own tests
decorative. A test that asserts the function "did not throw" against a swallow-by-design path
passes whether or not the inner call ever fired. When you find one, say so: the test is not
covering what its name claims, and that is a separate finding with its own persona — the next
engineer.

---

## 8. Cannot-describe-itself (`cannot-describe-itself`)

**Recipe.** Four questions, each of which should be answerable **in one call** by any persona
using the surface:

1. **Identity** — what am I talking to, and at what version?
2. **Principal** — who am I authenticated as, and with what role?
3. **Capabilities** — what can I do here? Is there a list, and is it the list the runtime
   actually reads?
4. **Refusal reason** — when something is denied, does the surface say why, in terms the
   persona can act on?

Any of the four that takes more than one call, or is unanswerable, is a candidate.

**The inverse, which is the sharper finding:** a **predictor using a rule the executor does not
apply**. A preview, a dry run, a "can I do this" check that computes eligibility with one rule
while the executor applies another. The preview says yes and the run refuses — or worse, the
preview says no and the capability was available all along. Compare the two predicates
directly; do not compare their names.

**False-positive check, run first:** the answer may exist on a surface you did not enumerate —
a health endpoint, a CLI subcommand, a header. Re-search the whole tree by name before claiming
the system cannot describe itself.

---

## 9. Stale deferral markers (`stale-deferral`)

**Recipe.** Never a raw grep for deferral markers. A raw marker grep in a large repository
returns four figures, is unrankable, and is useless as a finding. Three narrowing filters, in
this order:

1. **Reachability** — the marker sits on a path reachable from an enumerated surface. A
   deferral inside a fixture, a build script or dead code is not a UX finding.
2. **The condition has expired** — the marker defers on something that has since happened, or
   names a blocker that no longer exists. This filter is the one that produces genuine
   findings: the deferral was correct when written and is now simply stale.
3. **Age** — the line is older than a staleness threshold read from blame. Recent markers are
   live work.

**False-positive check, run first:** read the surrounding code. A marker whose text is stale
while the code beneath it was rewritten is a comment defect, not a deferred capability.

**Thresholds.** The age threshold and the minimum reachability depth are currently **reasoned
rather than measured**, and are awaiting benchmark calibration. **State the values you used**
in the coverage record, so a later run can compare like with like.
