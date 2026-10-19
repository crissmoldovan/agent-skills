---
name: rotate-shared-secret
description: "Rotate a secret that services share without downtime: the receiver accepts the current key or a next key, with an empty value never matching; the next key is generated into a 0600 file and never printed; every sender moves to a secret store and is verified delivering; the old key is retired only after the receiver's handled requests in a fixed window match the senders' own delivery records exactly and a search finds no other caller; then the receiver is redeployed, the live domain is confirmed to serve the new build, and probes show the new key passing and the old key, a wrong key and no key refused. Symptoms: rotate the webhook secret, the shared key may have leaked, the key is a literal in a trigger or config file, change the token without breaking anything, who else calls with this key, retire the old secret. Placing a single credential is secure-credential-setup's; a change crossing code, schema and jobs is land-complex-change's."
license: MIT
compatibility: "A receiver you can redeploy and whose live domain can be traced to a deployment; senders that can read a secret store; request logs on the receiver and delivery records on each sender covering one window. A bash shell with openssl and curl. Output is the new key in place on every side, the old key refused, a reconciliation record and a probe record. No key value or hash appears in any output."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Write Edit Grep Glob Bash
---

# Rotate a shared secret

A shared secret is easy to change and hard to change safely. The receiver and every sender have to
agree at every moment, or deliveries fail. The new value has to travel to each of them without
passing through a terminal, a transcript or a log. And the old value can be retired only once
nothing is still using it — which nobody actually knows, because the list of senders is a memory,
not a measurement.

Each of those goes wrong quietly. With the next key unset, "the current key or the next key"
accepts an empty header too. A redeploy reports success while the domain serves the previous build.
A code search finds two senders, and a third, a job configured in a dashboard years ago, stops
working the morning after.

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

Not for a credential you hold against someone else's service: rotate that in the provider's
console and place it with `secure-credential-setup`. Not for asymmetric signing keys that carry a
key id: publishing the new public key beside the old one is already the overlap this skill builds by
hand. And where a short outage is acceptable and the only sender deploys with the receiver, a plain
swap is simpler.

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
   **Complete when:** it exists, is yours with mode 700, and `SCRATCH` names it in your shell.
7. **A request path that keeps no copy of a bearer key.** Any layer that records request headers —
   the sender's instrumentation, a proxy, WAF or CDN, an APM agent, an access log — keeps the key.
   **Complete when:** before the first probe, every layer on the path is shown not to record that
   header, or to redact it; if that cannot be shown, the rotation stops. A signing key never
   travels.

## Procedure

**The every-instance rule.** The receiver and each sender can run as several instances — replicas,
regions, a rollout part-way through — and evidence from one instance says nothing about the others.
So every claim below about what the receiver accepts, or what a sender sends, covers every instance,
on one of three kinds of evidence: each instance addressed and checked on its own; the platform's
own list of instances, each with its deployment or configuration version; or answers — probe
responses, delivery records — that identify the instance that gave them and, between them, name
every one. Short of that, a step that needs it waits, and a retirement already done is recorded as
**UNVERIFIED**.

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
   output of a cryptographic random source to a temporary file, with no trailing newline, check its
   exact length, and only then rename it into place: a generator that failed must leave no key file
   at all, never an empty one that a store would accept. Never echo it, open it in a viewer, pass
   it as a command-line argument, or hand it to a tool call as a parameter: each of those puts it in
   a terminal, a process list or a transcript. When two copies must be the same, compare them byte
   for byte with tracing off, printing only same, different or read error — never a hash.
   **Complete when:** the key file exists with mode 0600 and its exact expected length, and no output
   of any command so far contains the key, its hash or its length.

3. **Set it on the receiver as `NEXT`, redeploy, and confirm the live domain moved.** Feed the file
   to the platform's secret command on standard input. Redeploy, then read the deployment id the
   live domain serves and compare it with the one the redeploy produced; promote it if they differ
   ([deploy and probe](references/deploy-and-probe.md)). Probe with the next key. A sender moved
   while one backend still lacks `NEXT` fails on every request routed there, so no sender moves
   until the overlap holds on every receiver instance, by the every-instance rule.
   **Complete when:** the live domain serves the new deployment, and both the current key and the
   next key are accepted on every receiver instance, not only on the one that answered a probe.

4. **Move every sender to read the key from a secret store, then verify its delivery.** First, keep
   a private copy of the old key for step 8, before any sender drops it: a receiver store that
   cannot be read back leaves the senders' copies as the only readable ones, and this step removes
   them. Save it into a 0600 file from a copy that can still be read, never printed, in the store's
   raw form where it has one, under a `umask 077` set again, since a new shell has lost step 2's. A
   command that adds a newline or wraps the value in metadata writes a different key, and a probe
   with it is refused for the wrong reason. So prove the copy: while the old key is still `CURRENT`,
   before step 5's window opens, probe with it as step 8 will — the same header or signature
   scheme, over a fresh body — and see it accepted. Then, one sender at a time: put the next key into its store from the file,
   change the sender to read it from the store instead of wherever it held the old one, deploy, and
   watch a real delivery arrive and log the `next` slot at the receiver. That delivery shows one
   instance moved; a quiet instance still on the old value fails only once the old key is retired,
   so every instance of the sender is shown reading the store, by the every-instance rule. A key
   written as a literal in a definition — a trigger, a job, a configuration file — is readable by
   anyone who can read that definition, and changing it means redefining code; reading it from a
   store fixes both. Remove the literal and any fallback to it. While the sender is being changed
   anyway, have it send a unique delivery id on every request and record it, so that step 5 can
   match requests one to one. A store written with SQL takes the key through its own interface or
   by hand, never through SQL ([deploy and probe](references/deploy-and-probe.md)).
   **Complete when:** the old key is in a 0600 file that the receiver accepted before any sender
   dropped it, or the record says why no such copy could be had; every sender on the map has
   delivered at least one request that the receiver logged as matching `next`; every instance of
   every sender is shown reading the store, and no sender still holds the old value anywhere.

5. **Prove no other caller exists before retiring the old key.** Pick a fixed window that starts
   after the last sender moved and is longer than the slowest sender's cycle. Count the receiver's
   handled requests in the window and the senders' own delivery records for the same window. They
   must match exactly: the same count, and the same first and last second. Where the senders send a
   delivery id and the receiver logs it, match the ids one to one instead: that is proof, provided
   each id is counted — as many times on one side as on the other, normally once — so that a
   repeated request cannot hide behind its original, and every row is an id: a blank row or a
   placeholder such as `null` is no evidence. Without ids, the count and endpoints are aggregate
   evidence, not proof — a lost delivery and an unknown request in the middle of the window cancel
   exactly — and the record says so. If the receiver logs the slot, every request in the window
   must have matched `next`. Then search code and configuration for any other sender —
   repositories, CI, schedulers, database definitions, provider dashboards, runbooks with example
   requests. State what the evidence cannot see: the log retention, any paging the tools needed,
   and whether the logs identify the caller at all
   ([proving no other caller](references/proving-no-other-caller.md)).
   **Complete when:** the ids match one to one, or the counts and the first and last seconds match
   exactly and the record calls that aggregate evidence; the search terms and places are recorded
   with what they found; and the caveats are written beside the result.

6. **Promote `NEXT` to `CURRENT`, and remove `NEXT` only once the new `CURRENT` holds everywhere.**
   With the old key's copy kept from step 4, set `CURRENT` from the next key's file, on standard
   input, leaving `NEXT` in place, and redeploy as in step 7. An instance the change reached logs
   the new key as `current`; one it missed still accepts it as `next`, so no sender fails
   meanwhile. Delete `NEXT` only when every receiver instance logs the new key as `current`, by the
   every-instance rule.
   **Complete when:** every receiver instance matched the new key as `current` while `NEXT` was
   still set, `NEXT` was deleted after that, and the old key's copy from step 4 is still in its
   0600 file, or the record says why there is none.

7. **Redeploy, and verify that the live domain moved.** A production redeploy can leave a custom
   domain pointing at the previous build, and until it moves, the old key still works there. Read
   the deployment id behind the live domain, and promote the new deployment if they differ.
   **Complete when:** the live domain's deployment id is the new deployment's, read after the
   redeploy.

8. **Probe the live domain: the new key passes; the old key, a wrong key and no key are refused.**
   Send the harmless probe four times. How a key is presented depends on the receiver:
   - **A bearer key** travels in a header, read from a header file rather than written on the
     command line.
   - **A signing key never travels.** Sign a fresh probe body with each key file — the new key,
     the old key, a wrong key — reading the key inside the program, and send only the signature,
     in the receiver's own header and scheme. Fresh means a new timestamp and nonce every time: a
     receiver that refuses replays refuses a body it has seen whatever key signed it, and that
     refusal reads as a retirement that took. The fourth probe sends no signature. The
     `x-shared-key` header in the examples is for bearer keys only.

   The example's `probe` sends either kind, by `KIND`, and sends nothing when it cannot build the
   request. Define it again in a new shell, which also sets `umask 077` again.

   The old-key probe is not optional. A stale replica, a region or instance the redeploy has not
   reached, or a promotion that landed on part of the fleet still accepts the old key, and nothing
   else shows it. The probes cover every receiver instance, by the every-instance rule. Where
   replicas or regions can be addressed one by one, probe each of them. Where they sit behind a load
   balancer and cannot, a probe through the live domain reaches one backend and says nothing of the
   rest: the retirement stays **UNVERIFIED** unless every backend is covered, by the platform's list
   of instances or by answers that identify each backend. Where the old key cannot be probed safely
   at all — no copy of it was accepted before the promotion, or no probe is free of side effects —
   the retirement is **UNVERIFIED** too, with the reason. The record never says the old key is
   refused on less than that.
   **Complete when:** the record shows the new key accepted and the old key, the wrong key and the
   missing key refused, each with its status code, for every backend — each probed directly, or all
   covered by the every-instance rule's other evidence — or the retirement recorded as UNVERIFIED
   with the reason.

9. **Delete every local copy, and record what happened.** Remove the next, old and wrong key files,
   the probe's header and body files and any copy made for comparison, and confirm they are gone.
   Write the record: the dates, the window, the counts, the search, the deployment ids, the probes
   and the caveats. No key value and no hash.
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
# Tracing off; refuse unless SCRATCH is your own directory, mode 700 (unset, a path is /next.key).
# Then drop an earlier attempt's key, generate with no newline and check the length: a fresh key
# and status 0, or no key file and a failure. Later writes and deletes spell it ${SCRATCH:?}.
umask 077
set +x -o pipefail
if [ -z "$(find "${SCRATCH:?}" -maxdepth 0 -type d -user "$(id -u)" -perm 700 2>/dev/null)" ]; then
  echo "REFUSED: SCRATCH is not a private directory of yours (mode 700); nothing was touched"; false
elif rm -f "$SCRATCH/next.key" "$SCRATCH/next.key.tmp" \
  && openssl rand -hex 32 | tr -d '\n' > "$SCRATCH/next.key.tmp" \
  && [ "$(wc -c < "$SCRATCH/next.key.tmp" | tr -d ' ')" -eq 64 ] \
  && mv "$SCRATCH/next.key.tmp" "$SCRATCH/next.key"; then
  ls -l "$SCRATCH/next.key"
else
  rm -f "$SCRATCH/next.key.tmp"; echo "GENERATION FAILED: no key was written"; false
fi

# Compare two copies byte for byte: same, DIFFERENT or READ ERROR, never a hash or a key.
cmp -s "$SCRATCH/next.key" "$SCRATCH/next.copy"
case $? in 0) echo same ;; 1) echo DIFFERENT; false ;; *) echo "READ ERROR"; false ;; esac

# Step 4, before any sender drops the old key: a store that cannot be read back leaves the senders'
# copies as the only readable ones. A new shell has lost step 2's umask, so set it again. Save the
# old key raw, never printed: a new 0600 copy, or a failure that keeps any copy saved earlier.
umask 077
rm -f "${SCRATCH:?}/old.key.tmp"
if <platform-cli> secrets get SHARED_KEY > "${SCRATCH:?}/old.key.tmp" && [ -s "$SCRATCH/old.key.tmp" ] \
  && mv "${SCRATCH:?}/old.key.tmp" "$SCRATCH/old.key"; then
  ls -l "$SCRATCH/old.key"
else
  rm -f "${SCRATCH:?}/old.key.tmp"; echo "OLD KEY NOT SAVED: no new copy was written"; false
fi

# The probes: define them again in every new shell. KIND is bearer or signing, with no default. A
# bearer key travels in a header file; a signing key never travels, and only its signature is sent,
# in the receiver's own header and scheme. Every probe gets a fresh body, a new timestamp and nonce
# (adapt body to your receiver, keeping both wherever its scheme signs them), so a receiver that
# refuses replays refuses a key, never a repeat. A probe that cannot build its request sends nothing.
umask 077
printf '%064d' 0 > "${SCRATCH:?}/wrong.key"   # a wrong key of the right length
sign() { node -e 'const c=require("crypto"),f=require("fs");process.stdout.write(c.createHmac("sha256",f.readFileSync(process.argv[1])).update(f.readFileSync(process.argv[2])).digest("hex"))' "$1" "$2"; }
body() { local n; n=$(openssl rand -hex 16) && [ "${#n}" -eq 32 ] && printf '{"probe":true,"timestamp":%s,"nonce":"%s"}' "$(date +%s)" "$n" > "${SCRATCH:?}/probe.json"; }
probe() {  # probe <label> <key file, or none>
  rm -f "${SCRATCH:?}/probe.hdr" "$SCRATCH/probe.json"
  case "$KIND:$2" in
    bearer:none | signing:none) body && : > "${SCRATCH:?}/probe.hdr" ;;
    bearer:*) body && { printf 'x-shared-key: '; cat "$2" && echo; } > "${SCRATCH:?}/probe.hdr" ;;
    signing:*) body && { printf '<signature-header>: sha256='; sign "$2" "$SCRATCH/probe.json" && echo; } > "${SCRATCH:?}/probe.hdr" ;;
    *) false ;;
  esac || { echo "$1: NOTHING SENT: KIND is unset, or the body, the key or the signature failed"; return 1; }
  curl -s -o /dev/null -w "$1: %{http_code}\n" -H @"$SCRATCH/probe.hdr" --data-binary @"$SCRATCH/probe.json" "https://<receiver>/<probe-path>"
}

# Step 4, the old key still CURRENT and step 5's window not yet open: prove the copy. It must pass;
# refused, the copy is not the key, and step 8's old-key probe is UNVERIFIED.
probe 'old key, before the senders move (must pass)' "$SCRATCH/old.key"

# Step 8, the live domain on the promoted build: the new key passes; the old key, a wrong key and
# no key are refused.
probe 'new key' "$SCRATCH/next.key"
probe 'old key' "$SCRATCH/old.key"
probe 'wrong key' "$SCRATCH/wrong.key"
probe 'no key' none

# Remove every local copy, and check that none is left.
rm -f "${SCRATCH:?}/next.key" "$SCRATCH/next.copy" "$SCRATCH/old.key" "$SCRATCH/wrong.key" "$SCRATCH/probe.hdr" "$SCRATCH/probe.json"
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
  none unknown, none missing, none repeated

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
- **The key sent through SQL.** Statement text, a client-side variable such as `psql`'s `:'name'`,
  and a bound parameter each reach some log: the server's, an extension's, a proxy's, the
  client's. The key goes in through the store's own interface, or by hand.
- **A hash printed for comparison.** A hash is a stable fingerprint of the key in every place the
  output lands. Compare byte for byte inside the shell and print only the verdict.
- **A trailing newline on one side.** A key file written with a newline, fed to one store that
  keeps it and another that trims it, gives the sender and the receiver different keys. Every
  delivery fails, and both sides look correctly configured. The same newline on the exported old
  key makes the old-key probe fail for the wrong reason, which reads as a retirement that took.
- **A key file written in a new shell.** `umask 077` lasts as long as the shell that set it, and a
  redirect into an existing file keeps that file's mode. A step run days later in a new terminal
  writes the old key's copy and the header files 0644. Every block that writes a key sets the
  umask itself and starts from no file.
- **The old key's last readable copy removed.** With a store that cannot be read back, the
  senders' copies are the only readable ones, and moving the senders removes them. Save and prove
  the old key before the first sender moves, or the old-key probe has nothing to send.
- **A signed probe sent twice.** A receiver that refuses replays refuses a body it has seen,
  whatever key signed it. Every signed probe gets a new timestamp and nonce.
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
- **One instance standing for all.** A probe one backend answered, a delivery one replica sent:
  each shows that instance only. Senders moved while one receiver backend lacks `NEXT` fail there; a
  quiet sender replica on the old literal fails after the retirement; a replica the redeploy missed
  still accepts the old key, and only the old-key probe shows it — without that, UNVERIFIED.
- **`NEXT` removed too early, or never.** Removed before every instance has the new `CURRENT`, it
  takes the overlap from the instances the promotion missed, and moved senders fail there. Left
  set after the promotion, it keeps two keys accepted indefinitely.

## Verification

- [ ] Every receiver and known sender is listed with where it held the key.
- [ ] The receiver accepts `CURRENT` or a non-empty `NEXT`; an empty value never matches; the
      comparison is constant-time; the slot is logged and the key is not.
- [ ] The receiver's tests cover current, next, wrong, missing and empty keys, and were watched
      failing with the empty-value rule broken.
- [ ] For a bearer key, every layer on the request path was shown, before the first probe, not to
      record its header.
- [ ] The next key was generated into a 0600 file in a private `SCRATCH`, with no trailing newline,
      and no output contained the key or its hash; every file holding a key was created 0600, under
      a `umask 077` set in the same shell.
- [ ] Every value reached every store on standard input or from a file, through the store's own
      interface or by hand: never as an argument, a tool parameter or through SQL.
- [ ] After each redeploy, the live domain's deployment id was read and matched the new deployment.
- [ ] Before any sender moved, every receiver instance accepted both the current and the next key.
- [ ] Every sender reads the key from a secret store, with no literal and no fallback left; each
      delivered a request the receiver logged as matching `next`, and every instance of each was
      shown reading the store.
- [ ] The reconciliation window started after the last sender moved and was longer than the slowest
      sender's cycle.
- [ ] Receiver requests and sender delivery records matched exactly: one to one by delivery id,
      each id as many times on each side, or else in count and in first and last second, recorded
      as aggregate evidence — with paging where the tools capped entries.
- [ ] The search for other senders is recorded with its terms, its places and its result.
- [ ] Log retention and the lack of caller identity, where it applies, are stated as caveats.
- [ ] The old key's copy was saved and accepted before any sender dropped the old key; every
      receiver instance matched the new key as `current` while `NEXT` was still set, and only then
      was `NEXT` removed.
- [ ] For every backend — each probed directly, or all covered by deployment evidence or by probes
      shown to reach each one — the new key was accepted, and the old key, a wrong key and no key
      were refused; a signing key was probed by signature and never sent, each probe with a fresh
      body; otherwise the retirement is recorded as UNVERIFIED, with the reason.
- [ ] Every local copy of the key was deleted, and the record holds no key value and no hash.

## Deeper reading

- [The dual-key receiver](references/dual-key-receiver.md): the comparison, the empty-value rule,
  slot logging, the test cases and how to arm them.
- [Proving no other caller](references/proving-no-other-caller.md): the window, the exact match,
  where else senders hide, and what log tooling limits do to the evidence.
- [Deploy and probe](references/deploy-and-probe.md): moving values, never through SQL; the newline
  trap; confirming the live domain moved; the probes and what they need; cleaning up.
