# Retention and deletion: tombstones, compaction, and what each does not do

The journal is a grow-only set. Nothing in it edits or removes anything in place —
that is what makes concurrent writers safe with no locking and no coordination
(spec §7.1). It is also the problem: in a grow-only set, erasure has no mechanism at
all. A leaked secret and a named person are, by default, exactly as permanent as
everything else, and a local delete only returns on the next union with a replica
that still has the bytes.

`tombstone` and `compact` are the two commands that exist to answer that problem
honestly — one records the decision that something must not exist, the other is the
one place in this package that actually destroys bytes. Read this before reaching for
either, and before assuming an anchor pointing at removed content still reads as
trustworthy.

## Tombstoning is not retraction

This is the distinction most likely to get blurred in practice, so state the rule
before anything else: **`invalidate` and `tombstone` answer two different questions,
and an entry can need either, both, or neither.**

- **Was the reasoning wrong?** → `invalidate`. The premise the entry rested on turned
  out to be false. The content stays on disk, fully readable — `show` still renders
  it, marked `outcome: invalidated, live: false` — and everything that declared a
  dependence on it is suppressed too, transitively. `invalidate` takes no position on
  whether the content itself is fit to exist; it says the conclusion was wrong.
- **Must the content not exist?** → `tombstone`. A credential got logged into a
  `rationale`. A `finding` named a real person. The reasoning could be entirely
  sound — the entry could even still be live — and the content still has to go. A
  tombstone takes no position on whether the reasoning was sound; it says the bytes
  themselves cannot stay.

Neither implies the other, and the CLI never reads one to decide the other. An entry
can be tombstoned without ever being invalidated: a decision was completely correct
and still leaked a colleague's name in its rationale, and deleting that says nothing
about whether the decision was right. An entry can be invalidated without being
tombstoned, and usually is: the reasoning was wrong, but nothing in it needs actual
erasure, and keeping the wrong reasoning on disk — visibly marked wrong — is the audit
trail `invalidate` exists to leave. Reach for `invalidate` when a later reader should
be able to see *what was believed and why it was wrong*. Reach for `tombstone` when no
reader should be able to see the content at all, regardless of whether it was right.

## Recording a tombstone

```bash
agent-journal tombstone <target-id> --reason <why> --workspace <id>
```

`--reason` is required, and a blank or whitespace-only value is refused exactly like
a missing one — exit 2, nothing written. This is deliberate, not a bureaucratic
formality: an unexplained tombstone is indistinguishable from a mistake. A reader six
months later, looking at a gap where an entry used to be, has no way to tell a
considered deletion from an accident unless the reason is right there.

```bash
agent-journal record --workspace retention-demo --kind finding --id f1 \
  --claim "leaked a live API key in its rationale"
agent-journal tombstone f1 --reason "leaked a live API key in its rationale" --workspace retention-demo
```

```
recorded f1
tombstoned f1
```

What this command does NOT do: **it purges nothing.** It appends one event — author
`human`, no session, the same shape `invalidate` uses for a retraction recorded out of
session — recording `target`, `reason`, and `purged: false`. The target's bytes stay
exactly where they were; `f1` is still fully readable at `agent-journal show
--workspace retention-demo --id f1`. Recording the decision and destroying the content
are two separate acts on purpose; `compact` is the only thing that can ever flip
`purged` to `true`, and only once it has actually removed the bytes.

The suppression takes effect immediately, though, everywhere a tombstone is checked
for: `show` and `digest` stop rendering the target, and a `trace` lookup **by the
target's own id or subject** stops matching. A tombstoned id is invisible to every
read path in this package well before anything is physically deleted — `compact` only
catches up the disk to what every reader has already been shown. (Tracing by
something else that cites the target is a different question — see "An anchor citing
purged content" below, where the answer is more surprising than "gone".)

Tombstoning is append-only, same as `invalidate`: naming a target that matches
nothing yet known in this workspace is not an error, because the target may simply
live in a segment this replica has not synced. It still records, with a warning:

```bash
agent-journal tombstone ghost --reason "preemptive; the entry is coming from another replica" --workspace retention-demo
```

```
tombstoned ghost
```
```
WARNING: no entry with id ghost is present in this workspace
```

## What a tombstone costs

Say this plainly, because the design pays it knowingly rather than hiding it: writing
a tombstone **forfeits pure CRDT convergence.**

Suppression is derived by scanning the events a reader actually has — a tombstone
suppresses its target only where the tombstone event itself has been read. **A
replica that never sees the tombstone keeps the bytes.** A segment sitting unsynced on
a laptop, a digest already committed before the tombstone was written, a transcript
already forwarded, a backup taken the day before — none of those un-happen because an
event was appended after the fact. The tombstone travels through the same append-only,
eventually-converging channel as everything else in this journal, and until it
arrives everywhere the content already reached, the content is still there.

That is the honest price, and §13.2 argues — correctly — that it is worth paying: an
append-only store that has no way to erase a secret or a named person at all is not
defensible at a multi-year horizon. The alternative to accepting this gap is not a
cleaner design; it is pretending erasure is complete when it structurally cannot be.
Taking the cost now, with the limit stated, is cheaper than discovering it later by
someone finding the "deleted" secret in a stale replica.

## `compact`: the one command that deletes

```bash
agent-journal compact --workspace <id> [--entry-ttl-days <n>] [--observation-ttl-days <n>] [--apply]
```

Everything else in this package only ever appends or reads. `compact` is the sole
exception, and its defaults are built around that: **it is a dry run unless `--apply`
is given.**

```bash
agent-journal compact --workspace retention-demo
```

Without `--apply`, `compact` reads the journal, computes exactly what it would do,
and prints that as a report — `expired`, `tombstoned`, `pinned`, `downgraded`,
`unclassified`, `tombstonesMarkedPurged` — while changing not one byte on disk. Run it
again with `--apply` and the same purge actually happens.

The reason the default is a dry run, and not a confirmation prompt: `agent-journal`
has no session and no terminal to prompt in when it matters most. This is a command
meant to run from a hook or a CI job on a schedule, unattended, exactly where nothing
is present to answer a prompt. A destructive command whose default behaviour is
irreversible would either need a human standing by every time it runs, or it would
train whoever wires the automation to pass `--apply` by reflex — at which point the
default bought nothing. A dry-run default means the routine, unattended case is safe
by construction, and destruction is something a caller has to ask for by name, every
time.

`--apply` takes no value — it is the one bare boolean flag in this CLI (every other
flag treats a missing value as an error, never a default, for the same reason
`--workspace $WS` with an unset variable must not silently write to a workspace named
`true`). `--apply true` or `--apply=maybe` is refused outright rather than guessed at:

```
--apply takes no value; pass it as a bare flag
```

### It refuses outright on a damaged journal

Before computing anything, `compact` reads the whole journal and checks for
unreadable paths or malformed lines — the same damage `coverage`, `show` and `trace`
already detect. Where those three commands render what they could parse and warn that
the result is a floor, `compact` does neither. It refuses completely, exit 1, no
partial purge, not even under `--apply`:

```
refusing to compact: 1 unreadable path(s), 0 malformed line(s) -- compacting a
partial view could destroy content whose tombstone status was never seen
```

This is the most important guard in the command, and it exists for one reason: a
segment that failed to parse might be the one holding the tombstone that protects
something, or holding the content a tombstone elsewhere already names. Compacting on
an incomplete read cannot tell "this id is safe to purge" from "this id would not be
safe to purge if the segment that says so had loaded" — and unlike every other
command's floor-not-total warning, there is no way to walk a purge back once the bytes
are gone. Refusing outright is the only version of this command that cannot destroy
the wrong thing on a partial read.

### What gets purged, and what never does

A run purges exactly two sets: entries and observations that fell past their TTL
(`expired`), and ids named by a well-formed tombstone found in the journal
(`tombstoned`). The tombstone **events** themselves are never in either set — a
tombstone is the record that a deletion happened, not the deletion's own target, and
ageing it out would silently un-delete its target the next time a replica reads a
segment that no longer carries a live tombstone for it.

What happens to a tombstone event instead: `--apply` flips its `data.purged` field
from `false` to `true`, but only for a tombstone whose *target was actually removed
this run*. A tombstone naming a target that never existed on this replica — the
`ghost` example above — keeps `purged: false` forever, because nothing was ever there
to purge for it. Flipping every tombstone's flag unconditionally would claim a
destruction that never happened.

```bash
agent-journal compact --workspace retention-demo --apply
```

```json
{
  "apply": true,
  "entryTtlDays": null,
  "observationTtlDays": null,
  "expired": [],
  "tombstoned": ["f1"],
  "pinned": [],
  "downgraded": [],
  "unclassified": [],
  "tombstonesMarkedPurged": ["30164070-7cc6-4225-8995-95189689762b"]
}
```

(The dry run above prints the identical report — `apply: false` aside — because a dry
run computes the same plan; only `--apply` acts on it. `tombstonesMarkedPurged` names
the tombstone **event's own id**, generated by `tombstone`, not `f1` — a real run
prints whatever id that command reported when it wrote the event.)

## Why entries expire at all

Through the first five plans of this design, entries were kept forever and only
observations aged out. §13.2 names that plainly for what it was: *"'Kept
indefinitely' was a volume decision masquerading as a policy."* Entries are cheap in
bytes compared to observations, so "keep every entry" was easy to default to — but
cheap-to-store is not the same claim as should-be-permanent, and a journal that never
lets an entry go accumulates every stale assumption and every abandoned line of
reasoning right alongside what still matters, forever.

`compact` now takes an independent TTL for each axis:

```bash
agent-journal compact --workspace retention-demo --entry-ttl-days 180 --observation-ttl-days 30 --apply
```

The two windows are genuinely independent — entries commonly need to live far longer
than the tool calls that produced them, which is the whole reason `entryTtlMs` and
`observationTtlMs` are two separate options rather than one applied twice. **Omit
either flag and that axis never expires** — not "expire everything," the opposite. A
`compact --apply` run with no TTL flags at all purges only tombstoned content and
touches nothing for age, however old it is. The actual number of days on either axis
is still an open question this design has not settled (§17.2) — what shipped here is
the mechanism, symmetric on both axes, not a chosen default. A caller has to pick the
number and say so explicitly, every run.

## Pinning: an anchor can keep evidence past its own window — until the entry citing it expires too

§6.3's base rule: observations age out on the configured window. Its exception is not
optional — **an observation cited by a live entry's `--anchor` is pinned, and survives
its own TTL** for as long as that citation stands. Without this, "age out
observations, keep entries forever" quietly deleted the proof and kept the assertion:
every anchor became a citation to nothing, still rendering as if it were anchored.

```bash
agent-journal observe --workspace retention-demo --kind tool_call --id obs-migrate \
  --tool Bash --callId call-1
agent-journal record --workspace retention-demo --kind decision --id d-migrate \
  --question "how do we backfill the new column?" \
  --chosen "a one-off script run under a maintenance window" \
  --anchor tool_use:obs-migrate
agent-journal compact --workspace retention-demo --observation-ttl-days 0 --apply
```

```json
{ "expired": [], "pinned": ["obs-migrate"], "tombstoned": [], "downgraded": [] }
```

`--observation-ttl-days 0` is the shortest real window there is — everything already
on disk is, by definition, at least a few milliseconds older than "now", so a `0`
means every unpinned observation is due for expiry the instant this runs, no waiting
required. `obs-migrate` survives it anyway, because `d-migrate` is live (its own
`--entry-ttl-days` was omitted, so it never expires on its own) and cites it.

The second half of this rule is what entry TTL adds, and it is easy to miss: **an
entry that has itself expired stops pinning what it cited.** Only entries that survive
the entry-TTL pass — not invalidated, not tombstoned, not itself past its own
`entry-ttl-days` — contribute a pin. This was not in the original §6.3, written when
entries never expired; leaving it out once entries could expire would have made entry
retention nearly pointless. Observations outweigh entries by roughly 100× (§6.3's own
figure — a busy session is 500–2000 tool calls against 5–20 entries), so an expired
entry that still pinned its anchors forever would free about a hundredth of what
expiring it implies, and the very observations an old decision justified would outlive
every decision that justified them.

```bash
agent-journal compact --workspace retention-demo --entry-ttl-days 0 --observation-ttl-days 0 --apply
```

```json
{ "expired": ["obs-migrate", "d-migrate"], "pinned": [], "tombstoned": [], "downgraded": [] }
```

Give entries a same-instant window too, and `d-migrate` now falls outside its own
window on this run — it stops contributing a pin, and `obs-migrate`, no longer
protected by anything, is purged alongside it. In practice the two TTLs are set to
realistic, very different numbers (entries living far longer than the tool calls that
produced them); `0` here exists only to make the mechanism reproducible without
waiting for a real window to pass. Had some *other*, still-live entry also anchored
`obs-migrate`, that citation would have kept it pinned on its own, regardless of what
happened to `d-migrate`.

One ordering detail worth knowing: tombstone suppression is checked before the pin
check, for every kind of event, not only observations. A pinned-and-tombstoned
observation is still purged. Citing a leaked credential in an anchor is not a way to
make it permanent.

## An anchor citing purged content reads as `unknown`, never as intact

§6.3: where an anchor's referent is genuinely gone, the anchor is downgraded to
`unknown` in the §4.3 `known | unknown` vocabulary — an anchor that proves nothing is
never allowed to render as if it still proved something.

Concretely, in this package: `compact`'s own report is where that downgrade is made
visible. Its `downgraded` field lists the ids of entries — still live, still on
disk — whose anchors reference something *this run* is removing, whether that
referent was tombstoned or simply aged past its TTL. A tombstoned referent is the
reliable way to see it, because — as the pinning section above just established — a
*live* entry's own citation protects its target from ordinary TTL expiry; the only
way to remove something a live entry still cites is to name it directly:

```bash
agent-journal observe --workspace retention-demo --kind tool_call --id obs-vendor-call \
  --tool Bash --callId call-2
agent-journal record --workspace retention-demo --kind finding --id f-vendor-latency \
  --claim "the vendor call adds 40ms p50" \
  --anchor tool_use:obs-vendor-call
agent-journal tombstone obs-vendor-call --reason "the callId embeds an internal vendor account id" --workspace retention-demo
agent-journal compact --workspace retention-demo --apply
```

```json
{ "expired": [], "tombstoned": ["obs-vendor-call"], "downgraded": ["f-vendor-latency"] }
```

`compact` does not rewrite `f-vendor-latency`'s stored anchor — its `data.anchors`
still names `obs-vendor-call`, verbatim, and `f-vendor-latency` is still fully live.
The `downgraded` list is what tells a human reading the report which *still-live*
entries are now carrying a reference like that, so it does not have to be
rediscovered by noticing a dangling id by hand. Read a name in `downgraded` as *this
claim's evidence is gone*, never as *this claim is intact* — the entry itself is
unchanged and still renders with whatever confidence it originally stated, so nothing
about its own text signals the loss on its own.

What "the reference resolves to nothing" actually means is narrower than it sounds,
and worth being exact about, because the obvious guess is wrong:

```bash
agent-journal show --workspace retention-demo --id obs-vendor-call
```

```json
{ "entries": [], "liveConstraints": [], "unreadable": [], "malformed": [] }
```

That much matches the obvious guess — `obs-vendor-call` no longer exists as an event,
so asking for it *by its own id* finds nothing. But:

```bash
agent-journal trace obs-vendor-call --workspace retention-demo
```

```json
{ "matched": [{ "id": "f-vendor-latency", "via": "anchor" }], "chain": [ { "id": "f-vendor-latency", "via": null } ] }
```

`trace` still finds `f-vendor-latency` — via `anchor`, not via `id`. `trace` indexes
the *strings* entries wrote down, and `f-vendor-latency`'s anchor still literally
contains the text `obs-vendor-call`; nothing rewrote it, so the string is still there
to search for. This is arguably the more useful behaviour, not a bug: it is exactly
how a reader stumbles onto `downgraded`-style damage without already knowing to look
for it — search for the id you have, and the citing entry turns up on its own. Do not
read a `trace` hit as evidence the target survived; read `via: "anchor"` pointing at
an id `show --id` cannot find as the downgrade made visible a second way.

Two honest limits worth knowing before leaning on this field:

- It is computed fresh each run, from what *that* run purges. An id already purged in
  an earlier `compact --apply` is simply absent from the events this run reads — no
  different, from where retention sits, than an id in a segment nobody loaded. That
  case is deliberately not reported here a second time; re-validating every anchor in
  the journal against everything ever purged is `decay`'s whole-journal job, not a
  side effect of compaction.
- `agent-journal coverage` and `agent-journal digest`, run on their own, do not surface
  this. Their `downgradedAnchors` field reads `null` — not assessed — because neither
  command runs a retention pass; nothing today wires `compact`'s findings into them.
  The place this actually surfaces today is `compact`'s own report, dry run or
  applied.
