# A worked discovery — the candidate the gates inverted

One candidate, taken from raw signal to final disposition. Anonymised from a sweep run cold
against a large monorepo — roughly 2,500 TypeScript files and 592k lines — which produced four
orphan screens, one divergent duplicate fork, three tool slugs missing from the registry that
had been walked, and a vocabulary collision that existed only between two open pull requests.

This is the fork one, because it is the case that shows the gates doing the thing they are
actually for.

## The raw signal

Signal class 2, orphan surface. The route walk enumerated the screens and searched each path
literally, in both quote styles and as a template prefix.

```text
screen path:  /workspace/insights/summary
searches:     "…/insights/summary"          → 0
              '…/insights/summary'          → 0
              template prefix "…/insights/" → 4 hits, none resolving to /summary
              navigation definitions        → 0
              mail and chat templates       → 0
```

**Control, run before the zero was trusted:** the identical search shape against a screen known
to be linked from the primary navigation returned 3 hits. The apparatus works; the zero is
real. (Without this the finding would have been worthless — a walk that returns zero for
everything reads exactly like a repository full of orphans.)

Re-classification: not *mentioned-only* — the only appearances were the screen's own definition
and one snapshot test. Not *reachable-by-design* — nothing in the surrounding code marked it as
a deep-link or operator target.

**Candidate as first drafted:** *"The insights summary screen exists and nothing links to it.
Add it to the workspace navigation."*

That is the proposal that would have shipped without the gates. Hold on to it.

## Gate (a) — NOT-ALREADY-IMPLEMENTED

### Step 1 — three names

| Form | Name |
|---|---|
| user's words | "the summary view of workspace insights" |
| domain word | "insights summary" |
| identifier form | `InsightsSummary`, route segment `insights/summary` |

### Step 2 — sweep every step-0 class

**8 of 9.** The data-access-rules class was enumerated from code only; the store was not
queryable from this run, and that limitation is carried into the record rather than left out.

Screens: one hit, the orphan itself. Routes: one. Everything else: zero.

### Step 3 — search the whole tree by name

This is the cheap step, and this is where the run turned.

```text
git grep -rn "InsightsSummary" -- .   → 6 hits across 3 files
```

Two of those hits were in a **second screen**, at a near-identical path — one segment
different, under an administrative area — which imported the same component name from a
different module. That screen **was** linked: it appeared in an administrator navigation
definition, and the control-verified route walk had found it as *linked* earlier in the same
sweep without anyone connecting the two.

### Step 4 — work in flight

Two open branches and eleven open pull requests searched for all three names. Zero hits. No
in-flight work touched either screen.

### Step 5 — access

The linked sibling sits behind an administrator-only rule. The orphan sits behind nothing: any
authenticated persona who knew the URL could open it.

### Verdict

**EXISTS-BUT-GATED-OR-UNDISCOVERABLE.** A summary of workspace insights exists and is
reachable — by administrators. Not by the persona the original candidate was about.

At this point the candidate has already changed shape once: it is no longer "this does not
exist", it is "this exists and the end-user persona cannot reach it". Effort drops, and the
claim gets more specific.

## Gate (b) — NO-CONFUSION

### Q1 — is there already a second way to do this?

Yes: the administrator screen. Which makes this a class-3 question, so the recipe from
[the nine signal classes](signal-classes.md) applies — hash the pair.

```text
orphan  /workspace/insights/summary   sha256 6f2c…  last change: 4 months ago
sibling /admin/insights/summary       sha256 a417…  last change: 3 weeks ago
```

**Divergent.** A fork, not a copy. And then the check that this class exists to force — **the
linked one is not necessarily the newer one** — run in the direction that would have been
skipped by an assumption: the *sibling* is the newer half. It carries two filters and an export
control the orphan does not have; the orphan carries one panel the sibling dropped.

So the orphan is the **stale** half.

### Q2 — conflicting affordance?

Yes, latent: two screens with the same name, differing feature sets, one export control present
in only one of them. Anyone linked to both would get different answers depending on which they
opened.

### Q3 — naming collision?

The identifier is shared by both halves, deliberately. Near-neighbour search returned no third
use. No prior written resolution of the fork was located — searched, and recorded as not found
with a control that returned comparable decisions elsewhere.

### Disposition

**CONVERT** to a consolidation. Not "propose with a caveat".

## The inversion

The proposal that entered the gates was *"add a nav link"*. Executed, it would have taken the
**stale** half of a diverged fork and surfaced it to every user of the product — a screen four
months behind its sibling, missing an export control, carrying one panel that had been
deliberately removed. It would have looked like a small, obviously-correct improvement in
review, and it would have been shipped by someone with no reason to hash two files.

What the gates produced instead:

```text
signal_class:  duplicate
claim:         Two diverged copies of the workspace insights summary exist; the linked copy is
               administrator-only and the unlinked copy is four months stale. No end-user
               persona can reach a current summary, and any link added to the unlinked copy
               would surface the stale one.
evidence:      route walk → 0 links (control: linked screen → 3 hits);
               git grep -rn "InsightsSummary" -- . → 6 hits / 3 files;
               sha256 6f2c… vs a417…, divergent; last-change 4 months vs 3 weeks
surfaces:      screens, data-access-rules
persona:       end user (workspace member)
effort:        M
changes_scope: scope-change
price:         effort M; adds review surface across both screens and the admin access rule;
               runtime cost none
gate_a:        8 of 9 classes; whole-tree search found the admin-gated sibling;
               in-flight clean; verdict EXISTS-BUT-GATED-OR-UNDISCOVERABLE
gate_b:        Q1 fail → convert to consolidation; Q2 latent conflict; Q3 no third use,
               no prior resolution located
```

And in DROPPED, one line, because the original framing is worth recording as dead:

```text
- "Add the insights summary to the workspace navigation" — gate (b) Q1: the target is the
  stale half of a divergent fork (sha256 6f2c… vs a417…). Converted to a consolidation.
```

> The gates did not merely filter this candidate, they inverted it, and that is the normal
> case.

## What to take from it

- **Step 3 of gate (a) — the unscoped whole-tree search — is the cheapest step and it did the
  work.** The class sweep had already walked screens and found nothing; one unfiltered search
  on the identifier found the sibling in seconds.
- **The class-2 control is what made the finding admissible at all.** A zero from a broken walk
  is indistinguishable from a zero from a real orphan.
- **The hash comparison is not a formality.** Linkage was the intuitive proxy for currency, and
  it pointed the wrong way. Two commands settled it.
- **The most dangerous proposals are the small, obviously-correct ones.** Nobody reviews a nav
  link. That is precisely why it needed both gates.
