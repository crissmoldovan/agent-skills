---
name: release-ledger
description: "Onboard a since-you-have-been-gone release ledger into any product: capture merged work, analyse and categorise it, and show each user what changed since they last looked."
license: MIT
compatibility: "Any product with a version-controlled source of merged work, a durable store, a scheduler that can run once a day, and an authenticated user identity to hang a per-user watermark on. Automatic capture assumes a forge that emits webhooks; manual capture needs none. Analysis assumes a language model reachable from the job runner, and the digest assumes one chat or mail surface. No specific framework, database, or job runner is required."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Write Edit Grep Glob Bash
---

# Release ledger

A user who was away for two weeks comes back and cannot tell what shipped. The
changelog is written for the team, the commit log is unreadable, and the release
notes stopped in March. A release ledger fixes that one thing: it records every
merged change, describes it in plain language, and shows each user only what
landed since *they* last looked.

This skill is the onboarding procedure. It does not ship a library. Its output is
a written implementation map, in the host repository, saying where each part of
the system lands on the stack that is actually there.

Three skills divide the work: **`release-ledger`** orchestrates, **`github-webhooks`**
captures, **`describe-changes`** writes the entries. Install the companions from
the same pack with `npx skills add crissmoldovan/agent-skills`, and name them in
the implementation map rather than reimplementing what they cover.

## The system model

Six stages. Each is a boundary you can build and verify alone.

```text
  merge event ──► capture ──► queue row (raw payload, unanalysed)
                                  │
                        nightly   ▼
                       analysis ──► ledger entry {kind, title, short, medium, detail}
                                  │
                announcements ────┤
              (hand-written,      │
               scheduled,         ▼
               audience-targeted) ├──► per-user popup   (entries newer than the user's watermark)
                                  └──► daily digest     (entries since the previous digest)
```

1. **Capture** writes the raw merge payload and nothing else. It never calls a
   model, never blocks, and never drops a row because a later stage might not
   like it.
2. **The queue** is the unanalysed set. It exists so capture and analysis fail
   independently: a model outage costs a delayed entry, not a lost one.
3. **Nightly analysis** turns each queued payload into one ledger entry with a
   classification and three registers of description. This is where
   `describe-changes` is invoked.
4. **The popup** is per user. Each user carries a watermark — the timestamp they
   last acknowledged — and sees entries newer than it, capped at a window.
5. **The digest** is per channel. It posts entries created since the previous
   digest to one chat or mail surface, and records the send.
6. **Announcements** are hand-written entries that bypass capture and analysis.
   They carry a schedule and an audience, and render in the same surfaces.

Read [the system model reference](references/system-model.md) for the stage
contracts, the failure modes at each boundary, and the sequences in text form.

## When to Use

- A product has users who log in intermittently and no reliable way to tell them
  what changed while they were away.
- A team ships continuously and the release notes have fallen behind, or were
  never written for the people who use the product.
- Someone asks for "a what's-new popup" and you need the parts behind it named
  before anyone writes a migration.
- A ledger exists partially — capture but no analysis, entries but no per-user
  watermark — and you need to know which stage to finish next.

Do not use it to write a single set of release notes; that is `describe-changes`
on a release range, on its own. Do not use it to build a curated marketing
changelog — a ledger is derived from merged work, and a page nobody derives is a
CMS, not this. Do not use it to notify users of incidents or outages; those need
a status surface with different latency guarantees.

## Prerequisites

1. **A merged-work source you can name.** Either a forge that emits merge events,
   or a human process that will write entries by hand. Both are supported; a
   ledger with neither has no input.
   **Complete when:** you can state the source and, for automatic capture, point
   at the endpoint that will receive the events.
2. **A durable store with a unique constraint.** Capture must be able to insert
   the same event twice and keep one row — forges replay deliveries.
   **Complete when:** you have named the store and the natural key (repository
   plus change number is the usual one).
3. **A scheduler that can run a job once a day.** Cron, a hosted job runner, or a
   queue with delayed jobs. Analysis and digest are two separate schedules.
   **Complete when:** you have run a no-op job on that scheduler and seen it fire.
4. **An authenticated user identity.** The watermark hangs on it. Anonymous
   sessions can be given a ledger, but it degrades to "latest N entries" and you
   should say so out loud rather than pretend otherwise.
   **Complete when:** you can name the column the watermark row will key on.
5. **A decision on the analysis model.** Which model, reached how, and who pays.
   **Complete when:** the model is reachable from the job runner, not only from a
   developer machine, and a per-run cost estimate can be printed before the first
   batch.

## Procedure

1. **Investigate the host application against a bounded checklist.** Framework
   and version; datastore and migration idiom; job runner and how a schedule is
   declared; auth and the user table; the chat or mail surface and its posting
   helper; existing inbound webhook handling; how markdown is rendered in the UI;
   how roles or groups are represented. Work
   [the onboarding checklist](references/onboarding-checklist.md) and stop when
   its items are answered. Do not read the whole codebase.
2. **Write `docs/release-ledger/implementation.md` in the host repository.** One
   section per stage of the system model, each naming the concrete file, table,
   schedule, and helper that will carry it on *this* stack. Record what you could
   not determine as open questions with a named owner. This document is the
   deliverable of onboarding; everything after it is implementation against a map
   that already exists.
3. **Design the tables from the reference schema.** Queue, entries, dismissals,
   announcements, sends. Adapt names to the host's conventions and keep the
   invariants. [The data model reference](references/data-model.md) carries
   portable SQL and the reason each constraint is there.
4. **Choose the capture mode, and offer the choice.** Automatic capture from a
   forge is the default; the `github-webhooks` skill covers endpoint setup,
   signature verification, and event routing for it — install it from the same
   pack with `npx skills add crissmoldovan/agent-skills` and follow it rather than
   hand-rolling a verifier. Manual-only is a first-class mode: announcements plus
   agent-written entries, no endpoint, no secret to rotate. Ask, and record the
   answer in the implementation map. The user configures the webhook itself later,
   from that document.
5. **Delegate entry authoring to `describe-changes`.** The analysis job owns
   batching, retry, cost control, and persistence. What an entry *says* — the
   classification and the three registers, anchored in the diff — belongs to
   `describe-changes`, and its output contract is what the entry columns should
   mirror. Do not invent a second description format.
6. **Build capture first and let it run before analysis exists.** A day of
   captured payloads is the test fixture for everything downstream, and it proves
   the queue survives replays before a model bill is attached to it.
7. **Add analysis, then the popup, then the digest, then announcements.** Each
   stage is useful on its own. Stop wherever it stops paying.
8. **State the limitations in the implementation map.** If capture stores only
   the event payload, entries cannot cite files the payload does not carry, and
   changes with no linked ticket will have no reporter. Write that down; do not
   let the popup render an empty "reported by" stub instead.

### Core invariants

- **The dismissal watermark is capped at a window** — thirty days is a sensible
  default. A user returning after a year gets the last thirty days, not four
  hundred entries.
- **Every text field is markdown**, in every stage. One renderer, one escaping
  story, no HTML passthrough.
- **Announcements are not analysed entries.** Separate table, separate authoring
  path, same rendering. A pinned announcement carries a start date, an optional
  end date, and an audience.
- **Digest sends are recorded and fail loud.** Every attempt writes a row with a
  status. A zero-entry day records `skipped` with a reason. A run that posted
  nothing and reports success is the bug this invariant exists to prevent.
- **Capture is idempotent on the natural key.** Insert, on conflict do nothing.

## Usage Examples

```text
Onboard a release ledger into this app. Run the stack investigation first and
show me the answers before you write anything, then produce
docs/release-ledger/implementation.md mapping every stage onto what is actually
here. Do not create tables yet.
```

```text
We already capture merged pull requests into a queue table but nothing reads it.
Add the nightly analysis stage only: batch the queue, classify and describe each
row with describe-changes, and write one ledger entry per change. Print a cost
estimate for the backlog before the first model call.
```

```text
Manual ledger, no webhook. Set up the entries, dismissals, and announcements
tables plus the per-user popup with a 30-day watermark cap, and give me an admin
form to write an announcement with a start date and an audience.
```

## Pitfalls

- **Capture placed inside an existing handler that returns early.** If merge
  events already flow into a handler that filters them — for tickets, for labels,
  for a naming convention — capture placed inside it inherits that filter and
  silently loses whatever the filter drops. Measure how many events the existing
  handler discards before deciding where to hook in. Capture belongs beside such
  a handler, not within it.
- **Analysing at capture time.** It couples a model call to a webhook response,
  which has a hard timeout, and makes every replayed delivery cost money. Capture
  writes a row; analysis runs later.
- **A watermark stored per device instead of per user.** Local storage looks
  simpler and gives the same user a fresh backlog in every browser. The watermark
  is server state.
- **Looping and awaiting over the queue.** One model call at a time turns a
  fifteen-minute batch into hours and gives no partial progress on failure.
  Batch, cap the batch size, and let each item fail on its own.
- **A digest that treats "nothing to send" as success.** Record it as skipped,
  with the reason, so an empty channel and a broken job look different in the
  send table.
- **Rendering markdown with raw HTML enabled.** Entry text derives from change
  titles and bodies that anyone with commit access can write. Render markdown,
  disable HTML passthrough, use an explicit component map.
- **Targeting announcements from the client.** If the browser asks for "all
  announcements" and filters by audience locally, the audience is advisory.
  Filter server-side and return only what the caller may see.
- **Backfilling without an estimate.** A month of merged work is a large model
  bill arriving as a surprise. Count the input first, print the estimate, cap the
  batch, and run it through the same path as the nightly job.

## Verification

- [ ] The stack investigation was completed against the checklist and its answers reported.
- [ ] `docs/release-ledger/implementation.md` exists in the host repository and names a concrete file, table, schedule, or helper for every stage.
- [ ] Capture mode was offered as a choice and the answer recorded.
- [ ] Capture is idempotent: the same event delivered twice produces one row, verified by replaying a delivery.
- [ ] Capture does not sit behind a filter that discards events the ledger needs.
- [ ] No model call happens on the capture path.
- [ ] Entry text follows the `describe-changes` output contract, not a second format.
- [ ] The watermark is server-side, per user, and capped at a window.
- [ ] Announcements are stored separately from analysed entries and carry schedule and audience.
- [ ] Audience filtering happens server-side.
- [ ] Every digest attempt writes a send row, and a zero-entry day is recorded as skipped with a reason.
- [ ] Markdown rendering has raw HTML disabled.
- [ ] Known limitations, including missing reporters, are written down rather than rendered as empty stubs.

## Deeper reading

- [System model](references/system-model.md): the six stages in depth, the
  contract at each boundary, sequences in text form, and what each stage may do
  when the next one is down.
- [Onboarding checklist](references/onboarding-checklist.md): the bounded stack
  investigation, one question per line, with what each answer decides.
- [Data model](references/data-model.md): portable reference schema for the
  queue, entries, dismissals, announcements, and sends, with the reason behind
  each constraint and the watermark query.
