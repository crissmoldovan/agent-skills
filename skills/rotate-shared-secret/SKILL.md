---
name: rotate-shared-secret
description: "Rotate a secret that services share without downtime: the receiver accepts the current key or a next key, with an empty value never matching; the next key is generated into a 0600 file and never printed; every sender moves to a secret store and is verified delivering; the old key is retired only after the receiver's handled requests in a fixed window match the senders' own delivery records exactly and a search finds no other caller; then the receiver is redeployed, the live domain is confirmed to serve the new build, and probes show the new key passing and a wrong key and no key refused. Symptoms: rotate the webhook secret, the shared key may have leaked, the key is a literal in a trigger or config file, change the token without breaking anything, who else calls with this key, retire the old secret. Placing a single credential is secure-credential-setup's; a change crossing code, schema and jobs is land-complex-change's."
license: MIT
compatibility: "A receiver you can redeploy and whose live domain can be traced to a deployment; senders that can read a secret store; request logs on the receiver and delivery records on each sender covering one window. A shell with openssl, shasum and curl. Output is the new key in place on every side, the old key refused, a reconciliation record and a probe record. No key value or hash appears in any output."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Write Edit Grep Glob Bash
---

# Rotate a shared secret

A shared secret is easy to change and hard to change safely. The receiver and every sender have to
agree at every moment, or deliveries fail. The new value has to travel to each of them without
passing through a terminal, a transcript or a log. And the old value can be retired only once
nothing is still using it — which nobody actually knows, because the list of senders is a memory,
not a measurement.

Each of those has a quiet way to go wrong. A receiver that accepts "the current key or the next key"
with the next key unset accepts an empty header too. A key generated with a trailing newline is
stored with it on one side and without it on the other. A production redeploy reports success while
the custom domain keeps serving the previous build, so the probes pass against the old key's code.
A code search finds two senders, and a third — a scheduled job configured in a dashboard years ago
— stops working the morning after.

This skill rotates with an overlap, so nothing fails while the senders move, and it retires the old
key on evidence: the receiver's handled requests matched one for one against the senders' own
delivery records, plus a search, with the limits of both stated.

### What this skill does not own

| The job | Whose it is | What this skill does with it |
|---|---|---|
| Placing one credential in a secret store without the value entering the transcript | `secure-credential-setup` | Follows its placement rule for every store the key enters. |
| Finding every reader of a key in the code | `investigate-codebase` | Asks it for the search, then adds the places code search cannot see. |
| What a change to the receiver would affect | `blast-area` | Consults it when the receiver's auth code is shared by other routes. |
| A change crossing code, schema and scheduled jobs | `land-complex-change` | Runs inside its budget when the rotation is part of a larger change. |
| Writing in a repository other than this one | `work-in-external-repo` | Hands over when a sender lives in another repository. |
| Telling the reader where the rotation stands | `report-progress` | Supplies the step, the window, the counts and the probe results. |

Install the companions with `npx skills add crissmoldovan/agent-skills`.

## When to Use

- A key shared between services you control — a webhook signing key, a service-to-service bearer
  key, an internal API key — has to change: a suspected leak, someone leaving, a scheduled
  rotation, or the key found somewhere it should not be.
- A key is held as a literal — in a configuration file, in a database trigger's definition, in a
  job's arguments — and has to move to a secret store. Moving it is a rotation: the old value has
  been readable wherever it sat.
- Nobody can say with evidence who else calls the receiver with the key.

Do not use it for a credential you hold against someone else's service, where you do not run the
receiver: rotate that in the provider's console and place it with `secure-credential-setup`. Do not
use it for asymmetric signing keys that carry a key id; those rotate by publishing the new public key
beside the old one, so the scheme already has the overlap this skill builds by hand. And where a
short outage is acceptable and the only sender deploys together with the receiver, a plain swap is
simpler — use this skill when it is not.

## Prerequisites

1. **The secret's map.** Every receiver, every known sender, and where each holds the key today:
   an environment variable, a secret store, a configuration file, a literal in a trigger or job
   definition, a CI secret, a third-party dashboard.
   **Complete when:** each holder is listed with its location, and the list says where it came
   from.
2. **A secret store every sender can read.** The receiver's platform secrets, a database's own
   secret store, a vault — one per side is fine.
   **Complete when:** each sender has a store it can read at run time, named.
3. **A receiver you can redeploy and trace.** A deploy path, and a way to ask which deployment the
   live domain serves right now.
   **Complete when:** you have read the live domain's current deployment id once.
4. **Logs on both sides, with their limits known.** The receiver's handled-request log with
   timestamps, and each sender's own record of what it delivered. Their retention, any per-call
   entry cap in the tools that read them, and whether they identify the caller.
   **Complete when:** each log is named with its retention and its tooling limits.
5. **A harmless probe.** A request that authenticates and changes nothing, or changes something
   idempotent.
   **Complete when:** the probe request is written down and its expected success code known.
6. **A private scratch directory.** Outside any repository, created under `umask 077`.
   **Complete when:** the directory exists and only you can read it.

## Procedure

1. **Make the receiver accept the current key or a next key, and test it.** Two settings, `CURRENT`
   and `NEXT`. A request passes when its key equals `CURRENT`, or when `NEXT` is non-empty and its
   key equals `NEXT`. An empty value never matches anything: an unset `NEXT` must not let an empty
   or missing header through, and an unset `CURRENT` refuses everything. Compare in constant time,
   and log which slot matched — `current` or `next` — never the key. Test every case, arm the tests
   by breaking the empty-value rule, then deploy with `NEXT` unset
   ([the dual-key receiver](references/dual-key-receiver.md)).
   **Complete when:** the tests pass and were watched failing with the empty-value rule broken, and
   the live domain serves the build that contains them.

2. **Generate the next key into a 0600 file, and never print it.** `umask 077`, then write the
   output of a cryptographic random source straight to a file, with no trailing newline. Never echo
   it, open it in a viewer, pass it as a command-line argument, or hand it to a tool call as a
   parameter: each of those puts it in a terminal, a process list or a transcript. When two copies
   must be the same, compare their hashes inside the shell and print only "same" or "different".
   **Complete when:** the key file exists with mode 0600, and no output of any command so far
   contains the key or its hash.

3. **Set it on the receiver as `NEXT`, redeploy, and confirm the live domain moved.** Feed the file
   to the platform's secret command on standard input. Redeploy, then read the deployment id the
   live domain serves and compare it with the one the redeploy produced; promote it if they differ
   ([deploy and probe](references/deploy-and-probe.md)). Probe with the next key.
   **Complete when:** the live domain serves the new deployment, and both the current key and the
   next key are accepted there.

4. **Move every sender to read the key from a secret store, then verify its delivery.** One sender
   at a time: put the next key into its store from the file, change the sender to read it from the
   store instead of wherever it held the old one, deploy, and watch a real delivery arrive and log
   the `next` slot at the receiver. A key written as a literal in a definition — a trigger, a job, a
   configuration file — is readable by anyone who can read that definition, and changing it means
   redefining code; reading it from a store fixes both. Remove the literal and any fallback to it.
   While the sender is being changed anyway, have it send a unique delivery id on every request and
   record it, so that step 5 can match requests one to one.
   Where the store is written with SQL, the value travels as a bound parameter or through the
   store's own interface, never inside the statement text, and the server's statement and parameter
   logging are checked first ([deploy and probe](references/deploy-and-probe.md)).
   **Complete when:** every sender on the map has delivered at least one request that the receiver
   logged as matching `next`, and no sender still holds the old value anywhere.

5. **Prove no other caller exists before retiring the old key.** Pick a fixed window that starts
   after the last sender moved and is longer than the slowest sender's cycle. Count the receiver's
   handled requests in the window and the senders' own delivery records for the same window. They
   must match exactly: the same count, and the same first and last second. Where the senders send a
   delivery id and the receiver logs it, match the ids one to one instead: that is proof. Without
   ids, the count and endpoints are aggregate evidence, not proof — a lost delivery and an unknown
   request in the middle of the window cancel exactly — and the record says so. If the receiver
   logs the slot, every request in the window must have matched `next`. Then search code and
   configuration for any other sender — repositories, CI, schedulers, database definitions,
   provider dashboards, runbooks with example requests. State what the evidence cannot see: the log retention, any
   paging the tools needed, and whether the logs identify the caller at all
   ([proving no other caller](references/proving-no-other-caller.md)).
   **Complete when:** the ids match one to one, or the counts and the first and last seconds match
   exactly and the record calls that aggregate evidence; the search terms and places are recorded
   with what they found; and the caveats are written beside the result.

6. **Promote `NEXT` to `CURRENT`, and remove `NEXT`.** Set `CURRENT` from the same key file, on
   standard input, and delete `NEXT`. From this deploy on, the old key is refused.
   **Complete when:** the receiver's settings hold the new key as `CURRENT` and no `NEXT`.

7. **Redeploy, and verify that the live domain moved.** A production redeploy can leave a custom
   domain pointing at the previous build, and until it moves, the old key still works there. Read
   the deployment id behind the live domain, compare it with the new deployment, and promote if
   they differ.
   **Complete when:** the live domain's deployment id is the new deployment's, read after the
   redeploy.

8. **Probe the live domain: the new key passes, a wrong key and no key are refused.** Send the
   harmless probe three times, with the key read from a header file rather than written on the
   command line. Add the old key as a fourth probe if you still hold it.
   **Complete when:** the record shows the new key accepted and the wrong key and the missing key
   refused, each with its status code, against the live domain.

9. **Delete every local copy, and record what happened.** Remove the key file, the header file and
   any copy made for comparison, and confirm they are gone. Write the record: the dates, the
   window, the counts, the search, the deployment ids, the probes and the caveats. No key value and
   no hash.
   **Complete when:** no copy of the key exists outside the secret stores, and the record is
   written.

## Usage Examples

```text
Rotate the shared key between the scheduler and the web app without downtime. Make the app accept
the current key or a next one first, never print the new key, and before you retire the old one,
show me that every request the app handled in a fixed window matches a delivery the senders
recorded.
```

```text
The webhook key is written as a literal in a database trigger definition. Move it into the
database's secret store as part of a rotation, and tell me who else could be calling the endpoint
with the old key.
```

```text
You redeployed the receiver. Before you probe anything, show me that the live domain is serving the
new deployment and not the previous one.
```

```bash
# Generate the next key where only you can read it, with no trailing newline, printing nothing.
umask 077
openssl rand -hex 32 | tr -d '\n' > "$SCRATCH/next.key"
ls -l "$SCRATCH/next.key"

# Compare two copies without printing either one or its hash.
[ "$(shasum -a 256 < "$SCRATCH/next.key")" = "$(shasum -a 256 < "$SCRATCH/next.copy")" ] && echo same || echo DIFFERENT

# Probe the live domain with the new key, a wrong key and no key. The key travels in a header file.
{ printf 'x-shared-key: '; cat "$SCRATCH/next.key"; echo; } > "$SCRATCH/probe.hdr"
curl -s -o /dev/null -w 'new key: %{http_code}\n' -H @"$SCRATCH/probe.hdr" -X POST "https://<receiver>/<probe-path>"
curl -s -o /dev/null -w 'wrong key: %{http_code}\n' -H 'x-shared-key: wrong' -X POST "https://<receiver>/<probe-path>"
curl -s -o /dev/null -w 'no key: %{http_code}\n' -X POST "https://<receiver>/<probe-path>"

# Remove every local copy, and check that none is left.
rm -f "$SCRATCH/next.key" "$SCRATCH/next.copy" "$SCRATCH/probe.hdr"
ls -A "$SCRATCH"
```

## What it looks like

A specimen, not a prompt.

### The reconciliation that retires the old key

```text
Rotation of <secret name> — receiver <service>; senders <sender A>, <sender B>
Window: <date> 00:00:00 to 23:59:59 UTC; the last sender moved at <time> the day before

Receiver, authenticated requests handled:  <n>   first 00:00:07   last 23:59:41
  slot matched: next <n>, current 0
Sender A, delivery records:                <a>   first 00:00:07   last 23:59:41
Sender B, delivery records:                <b>   first 02:15:00   last 23:45:00
Senders together: <a> + <b> = <n> — an exact match, with the same first and last second
Delivery ids: <n> logged at the receiver, <n> recorded by the senders, matched one to one;
  none unknown, none missing

Search for other senders: "<header name>", "<setting name>", "<receiver path>" across the
  repositories, CI secrets, the scheduler, database function and trigger definitions, and the
  provider's webhook dashboard. Found: sender A and sender B, nothing else.
Caveats: receiver logs are kept for 7 days, so a caller rarer than weekly would not appear. The log
  command returns at most 1,000 entries per call; the count was paged. The logs carry no caller
  identity beyond the delivery id, so the match is by id and time, not by name.
Decision: retire the old key.
```

The decision rests on a match a reader can redo, not on a belief about who the senders are, and
the record says what the match cannot rule out.

## Pitfalls

- **An empty next key that matches an empty header.** With `NEXT` unset, "the key equals `NEXT`"
  is true for a request with no key at all. Every dual-key check needs the non-empty guard, and a
  test that fails without it.
- **The key printed "just to check".** Terminal scrollback, shell history, a transcript and a log
  aggregator each keep their own copy, and none of them is a secret store.
- **The key as an argument.** A command-line argument is visible in the process list and saved in
  shell history. A tool-call parameter is saved in the transcript. Values travel on standard input
  or in files.
- **The key inside a SQL statement.** A client-side variable — `psql`'s `:'name'`, string formatting,
  a template literal — is expanded into the statement before it is sent, so the server receives
  and can log the literal value. Send it as a bound parameter, and check first whether the server
  logs parameters too.
- **A hash printed for comparison.** A hash is a stable fingerprint of the key in every place the
  output lands. Compare inside the shell and print only the verdict.
- **A trailing newline on one side.** A key file written with a newline, fed to one store that
  keeps it and another that trims it, gives the sender and the receiver different keys. Every
  delivery fails, and both sides look correctly configured.
- **A redeploy that did not move the domain.** The deploy succeeds, the probes pass, and they pass
  against the previous build, which still accepts the old key. Read the deployment behind the live
  domain every time.
- **Retiring on a code search alone.** Senders live in schedulers, dashboards, database definitions
  and scripts on someone's machine. A search finds what was written down in the places searched.
- **Equal counts, different requests.** A lost delivery and an unknown caller in the middle of the
  window cancel out in a count, and the first and last seconds do not move. A per-request id matched
  one to one tells them apart. Without one, the match is aggregate evidence, and the record says
  so. The `current` slot catches any caller still on the old key either way.
- **A window shorter than the slowest sender.** A weekly job is invisible in a daily window.
- **Counting one page.** A log tool that returns a capped number of entries per call returns exactly
  the cap when there are more. A count equal to the cap is a reason to page, not a result.
- **A fallback to the old literal.** A sender that reads "the store, or else the old value" still
  holds the old value, and recovers to it when the store read fails.
- **`NEXT` left set after the promotion.** Two keys are then accepted indefinitely, and the second
  one is the key that was meant to be retired.

## Verification

- [ ] Every receiver and known sender is listed with where it held the key.
- [ ] The receiver accepts `CURRENT` or a non-empty `NEXT`; an empty value never matches; the
      comparison is constant-time; the slot is logged and the key is not.
- [ ] The receiver's tests cover current, next, wrong, missing and empty keys, and were watched
      failing with the empty-value rule broken.
- [ ] The next key was generated into a 0600 file, with no trailing newline, and no output
      contained the key or its hash.
- [ ] Every value reached every store on standard input or from a file, never as an argument, a
      tool parameter or part of a SQL statement's text; where SQL was the way in, the value was a
      bound parameter and the server's parameter logging was read first.
- [ ] After each redeploy, the live domain's deployment id was read and matched the new deployment.
- [ ] Every sender reads the key from a secret store, with no literal and no fallback left, and
      each delivered a request the receiver logged as matching `next`.
- [ ] The reconciliation window started after the last sender moved and was longer than the slowest
      sender's cycle.
- [ ] Receiver requests and sender delivery records matched exactly: one to one by delivery id,
      or else in count and in first and last second, recorded as aggregate evidence — with paging
      where the tools capped entries.
- [ ] The search for other senders is recorded with its terms, its places and its result.
- [ ] Log retention and the lack of caller identity, where it applies, are stated as caveats.
- [ ] `NEXT` was promoted to `CURRENT` and then removed.
- [ ] Against the live domain, the new key was accepted, and a wrong key and no key were refused.
- [ ] Every local copy of the key was deleted, and the record holds no key value and no hash.

## Deeper reading

- [The dual-key receiver](references/dual-key-receiver.md): the comparison, the empty-value rule,
  slot logging, the test cases and how to arm them.
- [Proving no other caller](references/proving-no-other-caller.md): the window, the exact match,
  where else senders hide, and what log tooling limits do to the evidence.
- [Deploy and probe](references/deploy-and-probe.md): moving values on standard input, the newline
  trap, confirming the live domain moved, the three probes, and cleaning up.
