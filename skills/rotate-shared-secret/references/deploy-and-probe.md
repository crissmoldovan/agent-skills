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
- **The value inside SQL text** is sent to the server as part of the statement, where the
  statement log can keep it, and the client's history keeps it too. That includes every way of
  building the text on the client: typing the value, string formatting, a template literal, and
  client-side variables such as `psql`'s `:'name'`. A client-side variable is not a separate
  channel. The client expands it into the statement before sending it, so the server receives the
  literal value exactly as if it had been typed.

Where a store cannot take a value except as an argument, place it by hand through the store's own
interface, as `secure-credential-setup` describes, and record that it was done that way.

## When the store is inside a database

A database's own secret store is usually written with SQL, which is where the value most easily
ends up in a log. In order of preference:

1. **The store's own interface, reading from standard input or a file.** A command-line tool or API
   that takes the value as data and builds no SQL from it on your side.
2. **A parameterised call, with the value as a bound parameter.** The statement text holds only a
   placeholder; the client library sends the value separately, as data, through the protocol's
   parameter channel. The program reads the value from the key file itself, so it never appears on
   a command line either:

   ```js
   // The statement text holds only $1 and $2; the value travels as a bound parameter.
   const value = readFileSync(process.env.KEY_FILE, 'utf8');
   await client.query('select <store>.set_secret($1, $2)', ['shared_key', value]);
   ```

3. **Check, and switch off, what the server logs before you send it.** A bound parameter keeps the
   value out of the statement text, but not necessarily out of the log. Some servers log parameter
   values alongside a statement they log, and again when the statement fails. PostgreSQL, for one,
   has three switches that matter: statement logging (`log_statement`,
   `log_min_duration_statement`); `log_parameter_max_length`, which writes bound parameters beside
   every logged statement and by default writes them in full; and
   `log_parameter_max_length_on_error`, which writes them when the statement fails. Before placing
   the value, in the session that will send it, read all of them, switch them off where you are
   allowed to, and read them again:

   ```sql
   SET log_statement = 'none';
   SET log_min_duration_statement = -1;
   SET log_parameter_max_length = 0;
   SET log_parameter_max_length_on_error = 0;
   SHOW log_statement; SHOW log_min_duration_statement;
   SHOW log_parameter_max_length; SHOW log_parameter_max_length_on_error;
   ```

   Changing them may need elevated rights. If any of them cannot be switched off for that session,
   do not send the value this way: use the store's own interface, or place it by hand.

   These are the server's own switches, and the server is not the only recorder. Anything else on
   that connection that writes down bound parameters keeps the value just as well — for example an
   audit or plan-logging extension on the server, a pooler or proxy in between, or a driver's debug
   log or an APM agent's query capture in the client — and each has its own switch, or none. So the
   rule is not "these settings are off". It is: **send the value over SQL only when you can show
   that nothing on that connection records bound parameters.** Where you cannot show it — a layer
   you cannot inspect, a setting you cannot read or change — use the store's own interface, or
   place it by hand. Record what you read before and after, layer by layer.

Never interpolate the value into the statement and rely on the log being off: the log is one
reader, and the client's history, a proxy and a slow-query report are others.

## The newline trap

`openssl rand -hex 32 > file` writes a trailing newline. One store keeps it and another trims it,
and the sender and the receiver now hold different keys. Every delivery fails, and both sides look
correctly configured. Generate without it, under `pipefail`, into a temporary file whose exact length
is checked before it is renamed into place — the example in the skill does this — and when two
copies must agree, compare their hashes inside the shell and print only the verdict.

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
backend still lacks `NEXT` fails on every request routed to it. The evidence is the same as for the
retirement below — each backend probed on its own, the platform's list of instances with each
one's version, or answers that identify the backend.

## The probes

Use the harmless probe request from the prerequisites: one that authenticates and changes nothing.
Read the key from a header file so that it is not on the command line:

```bash
{ printf 'x-shared-key: '; cat "$SCRATCH/next.key"; echo; } > "$SCRATCH/probe.hdr"
{ printf 'x-shared-key: '; cat "$SCRATCH/old.key"; echo; } > "$SCRATCH/old.hdr"
curl -s -o /dev/null -w 'new key: %{http_code}\n'   -H @"$SCRATCH/probe.hdr"       -X POST "https://<receiver>/<probe-path>"
curl -s -o /dev/null -w 'old key: %{http_code}\n'   -H @"$SCRATCH/old.hdr"         -X POST "https://<receiver>/<probe-path>"
curl -s -o /dev/null -w 'wrong key: %{http_code}\n' -H 'x-shared-key: wrong'      -X POST "https://<receiver>/<probe-path>"
curl -s -o /dev/null -w 'no key: %{http_code}\n'                                  -X POST "https://<receiver>/<probe-path>"
```

For a **signing key**, nothing above travels: the key never leaves its file. Sign the fixed probe
body with each key file inside a program, and send only the signature, in the receiver's own header
and scheme — many also sign a timestamp, which the probe must include the same way:

```bash
sign() { node -e 'const c=require("crypto"),f=require("fs");process.stdout.write(c.createHmac("sha256",f.readFileSync(process.argv[1])).update(f.readFileSync(process.argv[2])).digest("hex"))' "$1" "$2"; }
{ printf '<signature-header>: sha256='; sign "$SCRATCH/next.key" "$SCRATCH/probe.json"; echo; } > "$SCRATCH/sig-new.hdr"
curl -s -o /dev/null -w 'signed, new key: %{http_code}\n' -H @"$SCRATCH/sig-new.hdr" --data-binary @"$SCRATCH/probe.json" "https://<receiver>/<probe-path>"
```

Do the same with the old key and a wrong key, and send the body once with no signature.

Expected: the new key gets the probe's success code; the old key, the wrong key and no key get the
receiver's refusal code. The old-key probe is the only direct evidence that the retirement took:
the settings can say the old key is gone while a stale replica, a region the redeploy has not
reached, or a promotion that landed on part of the fleet still accepts it. So it is mandatory
wherever it can be done safely. Keep the old key's private copy from before the promotion for it,
and probe every replica or region that can be addressed on its own.

A refusal means something only if the same probe was accepted before. A secret command that adds a
newline or prints metadata around the value writes a different key into the copy; the signature
made from it, or the header built from it, is refused whether the old key was retired or not, and
the refusal reads as a retirement that took. So export the raw value where the store has a mode
for it, and prove the copy before the promotion: with the reconciliation window closed and the old
key still `CURRENT`, probe with it exactly as you will afterwards, and see it accepted. A copy that
was not accepted then cannot show anything now.

Where the backends sit behind a load balancer and cannot be addressed one by one, a probe through
the live domain reaches whichever backend answered, and nothing more. One probe proves nothing about
the rest. The retirement is verified only by deployment evidence that every backend runs the new
configuration — the platform's own list of instances, each with its deployment or configuration
version — or by probes shown to have reached every backend, through answers that identify the
backend that gave them. Without either, it is **UNVERIFIED**.

When it cannot be done safely — no copy of the old key could be read from its store and accepted
before the promotion, or there is no probe without side effects — the retirement is **UNVERIFIED**.
Record exactly that, with the reason. Never write "the old key is refused" on the strength of the
settings alone.

Record the status codes, not the response bodies, which may echo request headers.

## Cleaning up

```bash
rm -f "$SCRATCH/next.key" "$SCRATCH/next.copy" "$SCRATCH/old.key" "$SCRATCH/probe.hdr" "$SCRATCH/old.hdr" "$SCRATCH/sig-new.hdr" "$SCRATCH/sig-old.hdr"
ls -A "$SCRATCH"
```

The listing must show none of them. Because no command ever carried the key as an argument, shell
history holds nothing to remove; if one did, the rotation is not finished until that history is
cleared and the key is rotated again. The record of the rotation holds dates, the window, the
counts, the search, the deployment ids and the probe codes — never the key and never its hash.
