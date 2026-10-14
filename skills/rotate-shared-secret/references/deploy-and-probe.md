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
- **A SQL statement containing the value** is saved in the client's history and can be saved in
  the database's statement log. Use a client that reads the value from a file into a variable, so
  that the statement names the variable and never contains the value (in `psql`,
  ``\set key `cat <file>` `` and then `:'key'`).

Where a store cannot take a value except as an argument, place it by hand through the store's own
interface, as `secure-credential-setup` describes, and record that it was done that way.

## The newline trap

`openssl rand -hex 32 > file` writes a trailing newline. One store keeps it and another trims it,
and the sender and the receiver now hold different keys. Every delivery fails, and both sides look
correctly configured. Generate without it — `openssl rand -hex 32 | tr -d '\n' > file` — and when two
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

## The probes

Use the harmless probe request from the prerequisites: one that authenticates and changes nothing.
Read the key from a header file so that it is not on the command line:

```bash
{ printf 'x-shared-key: '; cat "$SCRATCH/next.key"; echo; } > "$SCRATCH/probe.hdr"
curl -s -o /dev/null -w 'new key: %{http_code}\n'   -H @"$SCRATCH/probe.hdr"       -X POST "https://<receiver>/<probe-path>"
curl -s -o /dev/null -w 'wrong key: %{http_code}\n' -H 'x-shared-key: wrong'      -X POST "https://<receiver>/<probe-path>"
curl -s -o /dev/null -w 'no key: %{http_code}\n'                                  -X POST "https://<receiver>/<probe-path>"
```

Expected: the new key gets the probe's success code; the wrong key and no key get the receiver's
refusal code. If you still hold the old key, probe with it as well: after the promotion it must be
refused, and it is the most direct evidence that the retirement took. Record the status codes, not
the response bodies, which may echo request headers.

## Cleaning up

```bash
rm -f "$SCRATCH/next.key" "$SCRATCH/next.copy" "$SCRATCH/probe.hdr"
ls -A "$SCRATCH"
```

The listing must show none of them. Because no command ever carried the key as an argument, shell
history holds nothing to remove; if one did, the rotation is not finished until that history is
cleared and the key is rotated again. The record of the rotation holds dates, the window, the
counts, the search, the deployment ids and the probe codes — never the key and never its hash.
