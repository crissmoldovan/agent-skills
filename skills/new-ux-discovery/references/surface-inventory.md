# The surface inventory — step 0

A discovery sweep that begins with an idea finds evidence for that idea. A sweep that begins
with the inventory finds what is there. That is the whole reason step 0 is mandatory and
comes before any signal class is run.

The inventory answers one question per class: **what can a persona actually reach, and see
something?** A route that exists and returns nothing is not a surface. A screen that renders
an empty state is. A job that is never registered is not a surface — it is a silent nothing,
and it belongs to signal class 7, not to this list.

## The rule about generators

Where the repository already generates a registry — a route index, a tool catalogue, a job
list, an API schema — **read it, and do not re-derive it by search.** A generator that runs
in CI has already resolved what a grep can only approximate, and re-deriving it produces a
second answer that will disagree with the first for reasons nobody will chase. Record which
generated artifact you read and at which revision.

Where none exists, build the minimum inventory by hand from the recipes below, note that the
inventory is hand-built, and recommend `derive-codebase-context` as a follow-up. **Never
block on the absence of a generator.** A hand-built inventory with a stated coverage is a
working step 0; a refusal to start is not.

## Recording coverage

The output records the inventory as **"n of 9"**, with a **skip reason per omitted class**.
This is not bookkeeping. Gate (a) step 2 sweeps "every step-0 class", so a class that was
never enumerated is a hole in every gate record in the report, and the report has to say so
where a reader will see it rather than in a methods note at the end.

## The nine classes

### 1. HTTP routes (`http-routes`)

Enumerate every endpoint and the methods it answers. Read the generated route index if there
is one; otherwise walk the routing convention — file-system routing, a router table, or
decorator/annotation registration — and count.

Reachability test: does it return a body, a redirect, or a meaningful status to some persona?
An endpoint that answers only to an internal caller is a surface for the *integrator*
persona, not for the end user, and it gets recorded as such.

### 2. Pages and screens (`screens`)

Enumerate every screen **and what links to it**. Linkage is the surface, not the file. Build
two columns: the screen's path, and every place that path appears as a destination —
navigation definitions, in-page links, redirects, buttons that push a route, deep links in
mail or chat templates.

This class is where the inventory and signal class 2 meet. Do not classify orphans here;
just record the linkage column honestly, including "no linkage found", and let class 2 run
its own control before anything is called an orphan.

### 3. Tool registries (`tool-registries`)

**Plural is load-bearing.** Enumerate every registry first, then every tool inside each. A
repository that exposes capabilities to agents frequently has more than one — one measured
monorepo has two, registered by different mechanisms, and the second is where most of this
skill's false positives live: the capability "does not exist" in the registry you walked and
exists in the one you did not.

Find registries by their registration call, not by their file name. Then, for each registry,
record: what registers into it, what reads it at runtime, and whether the two lists agree.
A disagreement between them is a signal class 5 finding waiting to happen.

### 4. CLI entry points (`cli`)

Enumerate declared binaries, subcommands, and the script targets a human is actually told to
run — the ones in the package manifest, the ones in the contributing guide, the ones in the
CI configuration. A script that exists in the manifest and appears in no documentation is
reachable and undiscoverable, which is a real finding with a real persona.

### 5. Background jobs (`jobs`)

Enumerate tasks, queues, crons and workers — **and the registry each must appear in to run at
all.** Two lists: defined, and registered. The difference between them is the finding.

An unregistered job produces the most expensive kind of nothing: no error, no output, no
alert, and a downstream surface that quietly shows stale data forever.

### 6. Outbound notification channels (`notifications-out`)

Enumerate mail, chat, push, and outbound webhooks — with, for each, **what triggers it** and
**who is configured to receive it**. A channel wired to an unset recipient is the canonical
success-shaped non-event: the send call returns, the log line says "sent", and nothing was
delivered. Record the recipient configuration as part of the inventory so class 7 has
something to check against.

### 7. Inbound webhooks (`webhooks-in`)

Enumerate every receiver, its verification step, and **what it does on receipt**. A receiver
that verifies a signature and then drops the payload is a surface that returns nothing; a
receiver with no verification is a different kind of finding and not this skill's, but it
should be handed on rather than swallowed.

### 8. Docs and help text (`docs-and-help`)

Enumerate in-product help, error copy, command help output, and the READMEs a persona is
pointed at. Help text is a surface with a persona attached, and stale help is a defect rather
than a typo: it makes a confident, wrong claim to the person least able to check it.

Where a change has just landed, this is the class that goes stale first and is checked last.

### 9. Data access rules (`data-access-rules`)

Enumerate **the rules, not the tables**: who may read which rows, per persona. Row-level
policies, permission checks in the reading path, role grants, tenant scoping, feature gates
on a route.

This is the class that turns "missing" into "gated", and it is the reason gate (a) has a
fifth step. Existence is not reach. A capability that exists and is unreachable by the
persona who needs it is a finding — a different, usually cheaper one than building it.

Where the store cannot be queried from this run, record the class as **enumerated from code
only**, and carry that limit into signal classes 1 and 6, which each lose their access half
without it.

## What the inventory is not

- It is not a file census. Two hundred component files can be four screens.
- It is not a list of things that could be surfaces. Only what a persona can reach today.
- It is not a place to record findings. The inventory is the denominator; the signal classes
  produce the numerator, and mixing them makes the coverage number meaningless.
