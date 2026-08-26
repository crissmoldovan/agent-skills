# The two gates

Every candidate passes gate (a) — **not already implemented** — and then gate (b) — **no
confusion** — before it is allowed onto the page. The gates are cheap relative to what they
prevent: proposing something that already ships, or shipping a second word for a thing the
product already names.

A gate is a **record**, never a claim. The verdict without the record is worth nothing,
because nobody downstream can tell a real check from a confident sentence.

---

## Gate (a) — NOT-ALREADY-IMPLEMENTED

Five steps, in this order, each recorded.

### Step 1 — name it three ways

- **The user's words**: how the person asking would say it.
- **The domain word**: what this codebase calls the concept, taken from the vocabulary you
  built for signal class 4.
- **The identifier form**: the symbol, slug, route segment, or table column it would be.

Most already-built capabilities are missed because the search used exactly one of the three.
Record all three names; they are the input to steps 2 to 4.

### Step 2 — sweep every step-0 class, and record "n of m"

Search each of the nine surface classes for all three names. Record the count as **"n of 9"**,
naming the classes not swept and why. A candidate whose gate record says "7 of 9" is still
admissible; a candidate whose record says nothing is not.

### Step 3 — search the whole tree by name

Unscoped. No path filter, no directory restriction, all three names.

This is **the cheapest step in the gate and the one that catches the most embarrassing false
positive**: the capability exists, registered in a second registry that the class sweep never
enumerated, or living in a package nobody thought to include. Run it even when steps 1 and 2
came back clean — especially then.

### Step 4 — search work in flight

Open branches and open pull requests. The checked-out tree is the product minus everything
currently being built, and "not implemented" is a claim about the product.

Without forge access this step cannot run, and its absence is the most damaging degradation
in this skill. Record a **named confidence caveat** on the gate record itself, not in a
methods note: *"work in flight was not searched; this verdict covers the tree at <sha> only."*

### Step 5 — check access, not just existence

For anything found in steps 2 to 4: **can the persona in question reach it?** Walk the access
rules from class 9 of the inventory. A capability behind an administrator-only rule is not
implemented from the end user's side, and skipping this step converts a real finding into a
wrong drop.

### The three verdicts

| Verdict | What it means | Disposition |
|---|---|---|
| **EXISTS-AND-REACHABLE** | it is built and the persona can get to it | **drop**, with one reason line in DROPPED |
| **EXISTS-BUT-GATED-OR-UNDISCOVERABLE** | built, but behind an access rule or with no path to it | **re-file**: the claim becomes an access or discoverability gap, the evidence becomes the rule or the missing link, and the effort class usually drops |
| **DOES-NOT-EXIST** | none of the five steps found it | proceed to gate (b) |

The middle verdict is the one that earns the gate its cost. It is neither a drop nor the
original proposal; it is a different, usually much cheaper finding, and it is invisible to any
process that only asks "does this exist".

### The disqualification rule

**An empty gate-(a) record disqualifies the candidate.** Not a caveat, not a lower rank —
the candidate does not appear in the ranked rows. "I checked" is not a record. The record is:

```text
gate_a:
  names:        "export the audit trail" | "activity log" | "auditEvents"
  classes_swept: 8 of 9 — data-access-rules not enumerated (store not reachable)
  whole_tree:   git grep -n "auditEvents" -- .          → 6 hits, all in one package
  in_flight:    2 open branches searched, 0 hits; 11 open pull requests searched, 0 hits
  access:       reader exists at <path:line>; its rule admits operator only
  verdict:      EXISTS-BUT-GATED-OR-UNDISCOVERABLE
```

---

## Gate (b) — NO-CONFUSION

Three questions. **Searched, not considered** — every answer carries the query that produced
it.

### Q1 — is there already a second way to do this?

Search for the capability's effect, not its name: what else changes the same state, produces
the same artifact, answers the same need?

**Failure disposition: CONVERT to a consolidation.** The proposal is re-written as "these two
paths do the same thing; here is what reconciling them costs", and it is **never presented as
new**. Adding a third way to do something that already has two is the exact failure this
question exists to prevent, and the proposal that reaches this state is usually a good idea —
which is why it needs a rule rather than judgement.

This is also where a class-2 orphan meets a class-3 fork and the whole proposal inverts. See
[a worked discovery](worked-discovery.md).

### Q2 — would this create a conflicting affordance?

Two controls whose effects overlap or disagree; a new default that contradicts an existing
one; an action available in two places that behaves differently in each. Search the
surrounding surface, not just the identifier.

**Failure disposition:** re-scope so the affordances compose, and say what was re-scoped — or
drop.

### Q3 — does the name collide?

Search for the proposed name and its **near-neighbours**: singular and plural, a prefix or
suffix of an existing term, the same word already used in another subsystem, the same word in
user-facing copy for a different thing. **Include open branches** — this is where the two
strongest collisions in one measured sweep were found, both between two open pull requests.

**Failure disposition: DROP, or re-scope while stating what was re-scoped.** A collision that
is kept and noted in a caveat is **a failed proposal, not a caveated one**. The caveat does not
travel: it is dropped by the first person who summarises the report, and the collision ships.

### The shared-word rule

When two subsystems already use one word for two things:

1. **Name both subsystems** in the finding. A finding that names one is a finding that will be
   fixed in one and re-broken in the other.
2. **Locate the prior written resolution before proposing anything** — a design note, a review
   comment, a decision record, a migration comment. Somebody has usually already decided this
   once, and re-deciding it silently is how a repository ends up with three answers instead of
   two.
3. If no prior resolution exists, say that explicitly. "No prior resolution found; control:
   <query> returns hits for comparable decisions" is a finding in its own right.

### The DROPPED section

Every candidate that fails either gate goes into **DROPPED**, with **one reason line each**:

```text
DROPPED
- Bulk re-run from the list screen — gate (a): EXISTS-AND-REACHABLE, the row menu already
  does this (whole-tree search on the handler name, 3 hits, one is the menu item).
- "Collections" for grouped exports — gate (b) Q3: collides with the existing collections
  concept in the ingest subsystem; different membership. Prior resolution not located.
```

One line, the gate, the verdict, the evidence. That section is why the next agent does not
re-propose these next month, and it is the part of the report most often cut for length. Cut a
ranked row before cutting a dropped reason.
