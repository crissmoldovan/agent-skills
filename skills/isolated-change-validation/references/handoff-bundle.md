# The handoff bundle

A handoff document is not a handoff. The next agent — or you, a week later, after the scratch
directory is gone — cannot re-run a paragraph. What transfers is **state**: the lanes, the
artifacts, the evidence, the boundaries, a manifest over all of it, and a verifier that proves
the bundle is intact before anyone trusts a word of it.

This is the shape that survived a real unattended run. Use it whenever an isolated run ends
without landing, which is most of them.

## Every lane is separate, and labelled by its acceptance state

The single most common failure is a backup that preserves the good lane and silently drops the
others. Three months later the accepted candidate is there and the half-finished work that
explains it is not.

| Lane | What it holds | Why it must stay separate |
|---|---|---|
| Accepted candidate | The bytes a verdict was issued over | The only lane a later run may build on without re-validating |
| Working, not accepted | Work that runs but never earned a verdict | It looks identical to the accepted lane from the outside, and is not |
| Dirty working checkout | Uncommitted work in the real repository | It has no reflog. Losing it is unrecoverable, and it usually overlaps the candidate |
| External-repository deltas | Changes made in other repositories | They are invisible to this repository's history entirely |
| Local workflow changes | Skills, scripts and tooling improved during the run | The lesson that made the run work leaves with the machine otherwise |

Each lane keeps its own status capture and its own patch — for a git checkout, the status output
and a binary patch of the working tree; for a copied lane, the file inventory and the manifest.
Label each one with its acceptance state in the bundle's own README, not in a commit message.

## What the bundle contains

```text
README.md                  what this is, and the one command that verifies it
PICKUP_PROMPT.md           the exact prompt the next agent starts from
MANIFEST.sha256            every file in the bundle, hashed
verify-bundle.(py|mjs)     the verifier: manifest, required files, lane counts, forbidden state
docs/HANDOFF.md            orientation: mission, constraints, what works, what failed, what is next
docs/DECISIONS.md          decisions taken, with the evidence each rests on
snapshots/<lane>/          one directory per lane above
evidence/<stage>/          the verdict artifacts, gate records and scan classifications
artifacts/                 runnable output — a built application, a package tarball — each hashed
```

Two rules about what must **not** be in it: no copied dependency trees or build caches (they are
large, they are derivable, and they make the manifest meaningless), and nothing a secret scan has
not classified. Run the scan over the bundle, not over the product lane, before it is pushed
anywhere.

## The verifier

The bundle carries a script that checks it. It is deliberately cheap — no installs, no provider
calls — because its job is to answer one question before any real work starts: *is this bundle
what it says it is?*

It checks:

- every file in `MANIFEST.sha256` exists and hashes to the recorded value;
- the required files are present (the prompt, the orientation document, each lane, the final
  verdict artifact for each stage);
- the lane inventories match their recorded file counts;
- the final source pins in the verdict artifact match the accepted lane's current bytes;
- forbidden state is absent — no dependency trees, no caches, no unclassified scan hits.

A bundle whose verifier fails is not a starting point. Repair it, or record which check fails and
why, in the README, before anyone builds on it.

## The authority boundaries travel with it

The next agent inherits the work and none of the permissions. Write the boundaries into the
bundle explicitly: which acts the previous run was authorized to perform, which it performed,
and which are still gated. Landing, pushing, publishing, visibility changes, signing, another
authenticated provider run, an account or credit purchase, remote-host changes, and any
provisioning or spend each get a line. Credentials are never requested in the handoff and never
stored in it — the bundle names the variable, and the person supplies the value.

## The pickup prompt

One file, written for an agent that has no memory of the run: the bundle's location, the commit
or revision to read it at, the verifier to run first, the lane to build on, the boundaries above,
and the single next task. A pickup prompt that says "continue the work" hands over nothing; one
that names the lane, the verifier and the next gate hands over everything.

Keep it honest about what is unfinished. A bundle that reads as complete, and is not, costs the
next agent the time it takes to discover that — which is exactly the time the bundle existed to
save.
