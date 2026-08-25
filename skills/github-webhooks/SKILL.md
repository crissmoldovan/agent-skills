---
name: github-webhooks
description: "Adopt and manage GitHub webhook handling in an app: endpoint setup, signature verification, event routing, and a working reference for every event type you route."
license: MIT
compatibility: "Any server that can expose one publicly reachable HTTPS route and read a raw request body. Verification needs an HMAC-SHA256 primitive and a constant-time comparison, both of which every mainstream runtime has in its standard library. Repository, organization, and GitHub App webhooks are all covered; App webhooks differ only in where the hook is configured and in the extra installation fields on the payload. Local delivery testing assumes the GitHub CLI."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Write Edit Grep Glob Bash
---

# GitHub webhooks

A webhook endpoint is three things that get confused with each other: a verifier,
a router, and a set of handlers. Most broken integrations are broken because those
three were written as one function — the verifier trusts a parsed body, the router
is an `if` chain nobody can enumerate, and a handler's slow work happens inside the
ten seconds GitHub allows before it calls the delivery failed.

This skill separates them, and carries a reference for what each event type
actually contains so a handler is written against real fields rather than
remembered ones.

It composes with two companions in the same pack: **`release-ledger`** orchestrates
a since-you-were-away ledger and consumes captured merge events, and
**`describe-changes`** turns one of those changes into prose. Install either with
`npx skills add crissmoldovan/agent-skills`.

## When to Use

- An application needs to react to activity on a GitHub repository or
  organization, and no endpoint exists yet.
- An endpoint exists and you are adding an event type, or auditing whether its
  verification is real.
- Deliveries are arriving and being lost, timing out, or processed twice.
- You need to know which event carries a field before designing a feature around
  it — that is what the event reference is for.

Do not use it for outbound calls to the GitHub API; that is the REST or GraphQL
API and needs a credential this endpoint deliberately does not hold. Do not use it
for GitHub Actions workflow triggers — `on: pull_request` in a workflow file is a
different mechanism with a different payload shape and no endpoint of yours.
Do not use it to poll: if you find yourself scheduling a fetch of recent merges,
you are building a poller, and a poller has different idempotency and rate-limit
concerns than anything here.

## Prerequisites

1. **A publicly reachable HTTPS URL** that GitHub can POST to, or a tunnel to a
   local port for development.
   **Complete when:** an unauthenticated POST from outside your network reaches
   your handler.
2. **A shared verification value, stored as a secret.** Generate a long random
   value; place it with your platform's secret mechanism, never in the repository.
   **Complete when:** the running process reads it from the environment and the
   value has never appeared in a file, a log line, or a chat message.
3. **Access to the raw request body.** HMAC is computed over the exact bytes
   GitHub sent. A framework that hands you a parsed object has already destroyed
   the thing you need to verify.
   **Complete when:** you can log the byte length of the body and it matches the
   `Content-Length` header.
4. **Somewhere to put work that is not the request.** A queue, a job runner, or at
   minimum a durable table the response does not wait on.
   **Complete when:** you can enqueue and return in the same request, and see the
   work complete afterwards.
5. **Admin rights on the repository, organization, or App** whose settings hold
   the hook.
   **Complete when:** you can open the webhook settings page and see the Recent
   Deliveries tab.

## Procedure

1. **Audit what already exists.** Search for a route matching `webhook`, `hooks`,
   or `github` and read it end to end before adding anything. Answer four
   questions: does it verify, does it verify against the raw body, which events
   does it already subscribe to, and does it filter events before doing work? The
   fourth matters most when you are adding a consumer: a handler that returns
   early for events it does not care about will discard yours too if you nest
   inside it.
2. **Design the event map before writing code.** A table of event, actions you
   care about, the predicate that selects them, and the handler. Keep it in the
   repository — it is the document that answers "why are we subscribed to that?"
   in a year. [The event reference](references/event-types.md) is the raw material;
   [the payload cookbook](references/payload-cookbook.md) has the predicates for
   the common cases already written.
3. **Implement the endpoint in four layers, in this order.**
   - Read the raw body as bytes.
   - Verify `X-Hub-Signature-256` with HMAC-SHA256 and a constant-time compare.
     Reject with 401 on mismatch, and reject when the header is absent — an
     endpoint that skips verification when the header is missing is unverified.
   - Route on `X-GitHub-Event` and, where the event has one, `payload.action`.
   - Hand off to a handler that enqueues and returns. Respond 2xx within a
     second or two; GitHub's delivery timeout is ten seconds and a timed-out
     delivery is retried, which is how one merge becomes three ledger rows.
4. **Handle the `ping` event explicitly.** GitHub sends it when the hook is
   created. Returning 200 with no special case is fine, but returning 400 for an
   unknown event means the hook shows a red delivery from the moment it exists.
5. **Register the hook.** Create it against the repository or organization, select
   only the events in the map, set the content type to `application/json`, and set
   the verification value. Selecting "send me everything" is how an endpoint ends
   up receiving thousands of deliveries it discards.
6. **Verify with a real delivery.** Cause the event, then open Recent Deliveries
   and read the request and response. A 200 you produced by hand-posting a
   fixture proves your parser works and proves nothing about the hook.
7. **Write the event map into the host repository's docs** with the endpoint URL
   path, the events subscribed, and how to rotate the verification value.

### Managing evolution

- **Adding an event** is three steps in one change: extend the map, add the
  handler, then update the hook's subscription list. Doing the third first means
  live deliveries hitting a router that does not know them.
- **Idempotency comes from a natural key, not from the delivery id.** GitHub's
  `X-GitHub-Delivery` is unique per *attempt group* and a manual redelivery
  reuses it — but a second, genuinely separate delivery of the same underlying
  fact (a `synchronize` after a `synchronize`) has a new one. Deduplicate on what
  the fact is: repository plus pull request number, or the head SHA plus check
  name. Keep the delivery id in the log line, not in the unique constraint.
- **Replay is the debugging tool.** Recent Deliveries has a Redeliver button, and
  the API exposes the same thing, so a fixed handler can be tested against the
  exact bytes that broke it.
- **Local development uses forwarding, not a fixture.** `gh webhook forward`
  (from the `cli/gh-webhook` extension) relays live deliveries to a local port
  with real signatures, which exercises the verifier that a saved JSON file never
  will.

## Usage Examples

```text
Set up GitHub webhook handling in this app. Audit anything that exists first,
then implement the endpoint: raw body, HMAC-SHA256 verification with a
constant-time compare, routing on the event header plus action, and a handler
that enqueues. Only subscribe to pull_request and push for now.
```

```text
We already receive pull_request events but the handler returns early unless the
title matches our ticket convention. I need every merged PR. Show me how many
deliveries that filter discards, then add a second consumer beside it rather
than inside it.
```

```text
Add check_run to our event map. Route only completed check runs whose conclusion
is failure or timed_out, on the default branch, and tell me which payload fields
the predicate reads.
```

## Pitfalls

- **Verifying a re-serialized body.** `JSON.stringify(await req.json())` is not the
  bytes GitHub signed. Key order, whitespace, and unicode escaping all differ, and
  the signature will never match — or worse, will match in development and fail
  in production behind a proxy that reformats.
- **Comparing signatures with `===`.** Use a constant-time comparison. Compare
  fixed-length buffers, and check the length before comparing, because most
  constant-time helpers throw on a length mismatch rather than returning false.
- **Trusting `X-Hub-Signature`.** The unsuffixed header is the legacy SHA-1
  signature. Verify the `-256` one; accepting either lets a caller choose the
  weaker algorithm.
- **Doing the work inline.** Anything that calls a model, another API, or a slow
  query belongs behind a queue. A ten-second timeout means a slow handler turns
  into retries, and retries turn into duplicates.
- **Returning a non-2xx for events you do not handle.** GitHub retries failures.
  An unrouted event should return 200 and be counted, not rejected.
- **Assuming every event has an `action`.** `push`, `status`, `create`, `delete`,
  `fork`, `gollum`, and `public` have none. A router that reads `payload.action`
  unconditionally routes them all to the same undefined branch.
- **Assuming a merge.** `pull_request` with `action: "closed"` fires for closed
  and for merged. `payload.pull_request.merged` is the field that distinguishes
  them, and it is a boolean on the pull request, not on the event.
- **Assuming the push commit list is complete.** Large pushes truncate the
  `commits` array; the payload is a notification, not an archive. Read the range
  with the API if you need every commit.
- **A payload that is a delete.** `push` with `after` equal to all zeros is a
  branch deletion arriving as a push. Handlers that diff `before..after` produce
  nonsense on it.
- **Subscribing to everything "to be safe".** Every unwanted event is delivery
  volume, log noise, and a payload you did not review for the data it carries.
- **Placing the endpoint behind the app's authentication.** It has no session and
  no bearer token; its authentication *is* the signature. Exempt the route
  deliberately and narrowly, and make sure the exemption does not extend to the
  routes you add next.

## Verification

- [ ] The endpoint reads the raw request body and verifies HMAC-SHA256 over those exact bytes.
- [ ] Comparison is constant-time, and a missing signature header is rejected rather than skipped.
- [ ] A deliberately corrupted signature was sent and produced 401.
- [ ] The router handles events without an `action` field.
- [ ] `ping` returns 200.
- [ ] Unrouted events return 200 and are counted.
- [ ] Handlers enqueue; nothing slow runs inside the request.
- [ ] Median response time to GitHub is well under the ten-second delivery timeout.
- [ ] Deduplication uses a natural key, and a redelivery was replayed to prove it.
- [ ] The hook subscribes only to the events in the map.
- [ ] A real delivery was inspected in Recent Deliveries, request and response.
- [ ] The verification value lives in a secret store and appears in no file, log, or message.
- [ ] The event map is documented in the host repository, with the rotation procedure.

## Deeper reading

- [Event types](references/event-types.md): every event this skill routes, its
  actions, the payload fields that carry the meaning, and one line on when you
  would subscribe to it.
- [Payload cookbook](references/payload-cookbook.md): worked predicates —
  merged-PR-to-default-branch, tag push, check regression, review approval,
  successful deployment — each written as a condition plus the exact fields it
  reads.
