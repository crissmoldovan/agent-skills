# Parity and controls

A study measures the difference between arms. That difference means something only if the control
arm is the system production actually runs, and only if the other things that differ between arms
— provider, layout, time, inputs — are held still or measured. This page covers both.

## Parity: the control is production's twin

Parity has two halves, and a study needs both. They differ in one way that decides when each runs:
request parity costs nothing, and output parity costs money.

| Half | Paid? | When | Committed |
|---|---|---|---|
| Request parity | no — built, never sent | inside the dry run | with the dry run, before any paid call |
| Output parity | yes | the first paid stage, before any arm is measured | its plan and cap before its first call; its result after |

**Request parity is offline, and part of the dry run.** Take a handful of real items production has
processed. Capture the request production sent for each — from production's own request log, or by
running production's request builder in a mode that builds and does not send. Build the control
arm's request for the same items, without sending it, and diff the two. Normalise only what does not reach the model, such as the key order inside
a JSON object. Never normalise array order: the order of messages, examples and tools is part of the
prompt.

The differences that turn up are rarely the interesting ones:

- a system prompt that production assembles from two sources and the harness from one;
- a tool or response-schema definition the harness left out or copied from an older version;
- a default parameter — temperature, a token limit, a response format — that production sets and
  the harness inherits from a library default;
- examples placed before the instructions in one and after them in the other;
- whitespace or a trailing newline that changes what a prompt cache matches;
- provider-routing preferences production sends and the harness does not.

**Output parity is paid, and a stage of its own.** It runs only after the dry run is committed, and
only under what the plan registered for it: the items, the pass rule — how close the control's
answers must come to production's — and a cap of its own inside the study's. Run the control alone
on items production processed under the same frozen prompt and model, and compare its answers with
what production stored. Larger disagreement than the pass rule allows means the harness is not
production yet, or the control run is faulty, and every arm compared against it would inherit the
fault: the study stops there, with an addendum. The noise floor measured later in the run says
whether the pass rule's tolerance was reasonable; if it was too loose, say so in an addendum.

A control that fails parity is not a slightly worse control. It is a different system, and the
study would be measuring the distance between two systems neither of which is the one being decided
about.

## Pinning the serving provider

Many models are served by several providers under one name, and a router may pick among them per
call. Providers can differ in quantisation, context limits, default parameters and tokenisation, so
the "same" model can answer differently depending on who served it. A router can also pick the
provider by the shape of the request — its length, its layout, whether it can use a cache — so a
change that only touched the layout can move an arm to a different provider without anyone
choosing to.

- Pin one provider per arm, in the request itself, and turn off fallbacks for the study. The pin is
  part of the request, so request parity checks it offline.
- Record, per call, the provider that actually served it, from the response's own metadata, from
  the first paid call — output parity's — onwards.
- After the run, check every call against its arm's pin. A pin that was not honoured is a finding,
  recorded in an addendum, and those calls are either rerun or reported separately.

## The noise floor

Run the baseline arm twice over the same items, interleaved with everything else. Many models are
not deterministic even at temperature zero, and providers change behaviour between hours. The
disagreement between the two baseline runs, per metric, is the noise floor.

A difference between arms smaller than the floor is reported as "within noise", not as a win or a
loss. A difference larger than the floor is not thereby significant — the interval rule in the plan
decides that — but a difference smaller than it is certainly not a finding.

## The layout-only control

A content change often changes the layout too: more messages, a different order, the variable part
of the prompt moved earlier, a prefix that no longer matches the cache. Layout and caching can move
quality, latency and cost on their own. When the arm under test changes layout or caching as well
as content, add an arm that carries the control's content in the candidate's layout:

```text
A  control content, control layout
L  control content, candidate layout      <- the layout-only control
B  candidate content, candidate layout

layout effect   = L - A
content effect  = B - L
```

Without L, a gain that came from the cache or the layout is reported as the content's.

## Interleaving

Run every arm on item 1, then every arm on item 2, rotating which arm goes first so that warm
caches and rate-limit back-off do not always favour the same one. Record a timestamp per call. If a
run is interrupted, resume it interleaved. Providers drift over hours and days, and arms run on
different days measure the days as much as the arms.

## Equal inputs

Every arm gets the same evidence for each item. Before measuring, count, per arm, how many items
had each input present. A mismatch — one arm missing a field for a fifth of the items because its
loader read a different column — is fixed before the run, or the affected items are excluded from
every arm so that the denominators still match. An arm that lacked an input lost those items for a
reason the study is not about.

## Sanity-check the control before trusting it

A control run fresh for the study can carry its own fault: a stale prompt file, a dropped field, a
parameter left at a default. Every other arm is measured against it, so a broken control makes each
of them look better than it is. Compare the fresh control run with production's stored outputs for
the same items before using it as the baseline, and record the comparison in the audit.
