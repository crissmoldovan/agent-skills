# Deploy and probe

How the key moves into each store without being seen, how to know the live domain is serving what
was deployed, how to probe it, and how to leave nothing behind.

## Moving the value: standard input or a file, never an argument

Every store the key enters gets it from the key file, on standard input or as a file the tool reads
itself:

```bash
<platform-cli> secrets set SHARED_KEY_NEXT < "$SCRATCH/next.key"
```

Three channels leak, and none of them announces it:

- **A command-line argument** is visible in the process list to other users of the machine, and is
  saved in shell history.
- **A tool-call parameter** — handing the value to an agent tool that runs a query or sets a
  setting — is saved in the session transcript.
- **The value sent through SQL** reaches whatever on that connection records statements or
  parameters, and the client's history keeps it too. That includes every way of sending it: typing
  it into the statement, string formatting, a template literal, client-side variables such as
  `psql`'s `:'name'`, and a bound parameter. A client-side variable is not a separate channel. The
  client expands it into the statement before sending it, so the server receives the literal value
  exactly as if it had been typed.

Where a store cannot take a value except as an argument, place it by hand through the store's own
interface, as `secure-credential-setup` describes, and record that it was done that way.

## When the store is inside a database

A database's own secret store is usually written with SQL, and SQL is where a value most easily
ends up in a log. A bound parameter keeps it out of the statement text but not out of every record:
the server's statement and parameter logging, an audit or plan-logging extension, a pooler or proxy
in between, a driver's debug log or an APM agent's query capture in the client. Each has its own
switch, or none, and showing that every one is off is rarely possible. So **the key does not go in
through SQL at all** — not in the statement text, not through a client-side variable, not as a
bound parameter.

It goes in through the store's own interface: a command-line tool or API that takes the value as
data, from standard input or a file, and builds no SQL from it on your side. Where the store has no
such interface, place it by hand through the store's console, as `secure-credential-setup`
describes, and record that it was done that way.

## The newline trap

`openssl rand -hex 32 > file` writes a trailing newline. One store keeps it and another trims it,
and the sender and the receiver now hold different keys. Every delivery fails, and both sides look
correctly configured. Generate without it, under `pipefail`, into a temporary file whose exact length
is checked before it is renamed into place — the example in the skill does this — and when two
copies must agree, compare them byte for byte with `cmp -s` inside the shell, tracing off, and
print only the verdict: same, different, or a read error that is never taken for either.

## Confirming that the live domain moved

A deploy that succeeded is not a live domain serving it. On some platforms a production redeploy
creates a new deployment while the custom domain stays on the previous one until it is promoted, and
the deploy command still reports success. Until the domain moves, the old code — and the old key —
are what callers reach.

After every redeploy:

1. Note the deployment id the redeploy produced.
2. Ask the platform which deployment the live domain's alias points to now.
3. If the two differ, promote the new deployment to the domain, and ask again.

A check that does not depend on the platform: have each build serve its own commit id on a harmless
path, and read it through the live domain.

```bash
curl -s "https://<receiver>/<version-path>"   # must print the commit that was just deployed
```

Probe only after the live domain is confirmed to be on the new deployment. A probe against the
previous build proves something about the previous build.

The same holds instance by instance. When `NEXT` is first set (step 3), every backend must accept
both keys before any sender moves, not only the backend that answered: a sender moved while one
backend still lacks `NEXT` fails on every request routed to it. When `CURRENT` is promoted (step
6), `NEXT` stays set until every backend logs the new key as `current`: a backend the promotion
missed still accepts it as `next`, but only while `NEXT` is there. The evidence is the same as for
the retirement below — each backend probed on its own, the platform's list of instances with each
one's version, or answers that identify the backend.

## The probes

Use the harmless probe request from the prerequisites: one that authenticates and changes nothing.

A bearer probe sends the key itself, in a header, through every layer a delivery passes: the
sender's instrumentation, a proxy, WAF or CDN, an APM agent, the receiver's access log. Any of them
that records request headers keeps the key before the receiver's slot-only log applies. So before
the first probe, each layer on the path is shown not to record that header, or to redact it. If
that cannot be shown, the rotation stops there. A signing key, which never travels, does not need
this.

A bearer key is read from a header file, so that it is not on the command line. For a **signing
key**, nothing travels: the key never leaves its file. Each probe signs its body with the key file
inside a program, and only the signature is sent, in the receiver's own header and scheme.

Every probe gets a fresh body: a new timestamp and a new nonce, in the body or wherever the
receiver's scheme signs them. A receiver that refuses replays refuses a body it has already seen,
whatever key signed it. Never send the old key's probe after the promotion with the body that was
accepted before it: the receiver refuses it as a replay even while the old key is still valid, and
that refusal reads as a retirement that took. Each probe, the old key's after the promotion
included, gets its own timestamp and nonce. For the same reason a probe sends nothing when its key
file is missing, empty or not a regular file, or its body or signature failed: an empty signature,
a signature made with an empty key, or a header with no key in it is refused for the wrong reason
too. The body's nonce and timestamp are each checked before the body is written, so a clock that
failed sends nothing, never a body with no timestamp in it.

The skill's example defines `probe`, which does all of this for either kind of key, chosen by
`KIND` (`bearer` or `signing`, with no default). Define it again in every new shell: a new shell
has lost it, and with it the `umask 077` that creates each header file 0600. In order — the first
before any sender drops the old key (step 4), the rest after the promotion (step 8):

```bash
probe 'old key, before the senders move (must pass)' "$SCRATCH/old.key"
probe 'new key' "$SCRATCH/next.key"
probe 'old key' "$SCRATCH/old.key"
probe 'wrong key' "$SCRATCH/wrong.key"
probe 'no key' none
```

Expected: the new key gets the probe's success code; the old key, the wrong key and no key get the
receiver's refusal code. The old-key probe is the only direct evidence that the retirement took:
the settings can say the old key is gone while a stale replica, a region the redeploy has not
reached, or a promotion that landed on part of the fleet still accepts it. So it is mandatory
wherever it can be done safely. It uses the old key's private copy, saved and proven before any
sender dropped it; probe every replica or region that can be addressed on its own.

A refusal means something only if a probe built the same way — the same copy of the key, the same
header or signature scheme, over a fresh body — was accepted before. A secret command that adds a
newline or prints metadata around the value writes a different key into the copy; the signature
made from it, or the header built from it, is refused whether the old key was retired or not, and
the refusal reads as a retirement that took. So export the raw value where the store has a mode
for it, and prove the copy before any sender drops the old key (step 4): while the old key is still
`CURRENT` and before the reconciliation window opens, probe with it as you will afterwards — the
same header or signature scheme, over a fresh body — and see it accepted. Save it then, not at the promotion: a store that cannot be read back — many
platforms keep secrets write-only — leaves the senders' copies as the only readable ones, and
moving the senders removes them. Save it under a `umask 077` set in the same shell, since a new
shell has lost step 2's, and refuse an `old.key` that is a directory or a link: `mv` would put the
copy inside it, and the cleanup would leave it there. A copy that was not accepted then cannot show anything now.

Where the backends sit behind a load balancer and cannot be addressed one by one, a probe through
the live domain reaches whichever backend answered, and nothing more. One probe proves nothing about
the rest. The retirement is verified only by deployment evidence that every backend runs the new
configuration — the platform's own list of instances, each with its deployment or configuration
version — or by probes shown to have reached every backend, through answers that identify the
backend that gave them. Without either, it is **UNVERIFIED**.

When it cannot be done safely — no copy of the old key could be saved and accepted before the
senders dropped it, or there is no probe without side effects — the retirement is **UNVERIFIED**.
Record exactly that, with the reason. Never write "the old key is refused" on the strength of the
settings alone.

Record the status codes, not the response bodies, which may echo request headers.

## Cleaning up

```bash
rm -f "${SCRATCH:?}/next.key" "$SCRATCH/next.copy" "$SCRATCH/old.key" "$SCRATCH/wrong.key" "$SCRATCH/probe.hdr" "$SCRATCH/probe.json"
ls -A "$SCRATCH"
```

The listing must show none of them. Because no command ever carried the key as an argument, shell
history holds nothing to remove; if one did, the rotation is not finished until that history is
cleared and the key is rotated again. The record of the rotation holds dates, the window, the
counts, the search, the deployment ids and the probe codes — never the key and never its hash.
