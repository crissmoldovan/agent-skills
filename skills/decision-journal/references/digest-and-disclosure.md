# Digest and disclosure: rendering a journal for someone who cannot read all of it

A journal accumulates entries an agent wrote for itself, mid-session, with whatever
candour that required. Nothing in that origin makes every entry fit for a document a
team reviews or a customer sees. Disclosure is the control that lets the same journal
serve both audiences without either editing history or hiding that anything was
withheld.

## The three classes

```
private   →   team   →   published
```

Spec §13.3 orders them most closed to most open. Every entry carries exactly one.

| Class | Shows up in a digest rendered at `--level …` |
| --- | --- |
| `private` | Only `private`. Never `team`, never `published`. |
| `team` | `private` and `team`. Not `published`. |
| `published` | `private`, `team` and `published` — the version meant to leave the room. |

An entry's class is readable at a requested level when the class is **at least as
open** as the level: `readableAt(entry, level)` is `rank(entry.disclosure) >=
rank(level)`. So a `published` digest — the default — shows only `published` entries; a
`team` digest shows `team` and `published`; a `private` digest, meaningful only as an
internal, unredacted view, shows everything. More open classes are supersets of more
closed ones, never the reverse.

## Setting it

```bash
agent-journal record --workspace api --kind decision --id dg-bound \
  --question "how do we bound the retry queue?" --chosen "in-process ring buffer, 256 entries" \
  --disclosure published
```

`--disclosure` takes `record` and `invalidate`, nowhere else — it is a property of an
entry, not of a workspace or a query. An unrecognised value — `--disclosure public`, say
— is refused outright, exit 2, naming the three real classes in the error rather than
silently containing it to `private`; see the next section for why that refusal, not a
quiet downgrade, is the correct response here.

## The write default and the parse default disagree, on purpose

Omit `--disclosure` on a write this CLI performs and the entry lands as `team`. Read a
record — any record, including one this same CLI wrote — where the `disclosure` field
is absent or holds something unrecognised, and it parses as `private`.

Those look contradictory side by side, and the plan they came out of said so directly:
say this, because it *is* the subtlest asymmetry in the disclosure design, not an
inconsistency to quietly reconcile.

They are not the same decision. They answer two different questions:

- **Writing, with a caller present:** *what did this caller mean?* A caller who typed
  nothing meant the ordinary case, not silence — `team`, shareable inside the
  organisation but not shipped externally. Silently downgrading their unstated intent to
  `private` would be the same coercion this CLI already removed once from `--author`.
- **Parsing, with no caller to ask:** *what can this record be assumed to permit?* A
  line read from disk — possibly hand-edited, possibly from a version of this tool that
  never had the field, possibly corrupted — carries no author to consult. Here the two
  mistakes do not cost the same: treating an ambiguous record as more open than intended
  publishes something that should have stayed contained, and that is not a mistake a
  later correction undoes. Treating it as more closed than intended just means someone
  notices an omission and asks. `private` is the only default that fails toward the
  recoverable error.

The same instinct governs `Capabilities` elsewhere in this package — preserve `unknown`
rather than assume availability — and lands on the opposite literal here because the
harm runs the opposite direction: understating a capability costs nothing but useful
information; overstating disclosure costs the entry's own contents.

## Disclosure is containment, not curation

It is tempting to describe `private`/`team`/`published` as an editorial ladder — draft,
reviewed, publishable — the way a document workflow might. Resist that. Spec §6.4
rejects "curated in-repo" as a description of any part of this journal precisely because
it names no curator and no rule: nobody is elected to decide what counts as ready, and
nothing enforces that a `published` entry was ever reviewed by a person before a digest
picked it up.

Disclosure names **where an entry may be exposed**, never **whether it is any good**. A
`published` entry can rest on `model_knowledge` alone, contradict what a later entry
says, or belong to a decision that gets invalidated an hour later — the digest will
still show it to anyone entitled to see `published` material, flagged and ordered like
any other entry, because disclosure and quality are unrelated axes. Confusing them would
recreate exactly the unaccountable, undocumented gate the spec calls out by name.

## A private entry never reaches a digest — but invalidation is never gated

`renderDigest` computes outcomes over **every** event passed to it — `project(events)`
runs before the disclosure filter, not after — and only then filters which entries make
it into the printed list. The consequence: an entry's disclosure controls whether its
own text is shown, never whether the fact it recorded took effect.

Concretely, a `private` `invalidate` still suppresses its target for a `team` or
`published` reader. The retraction's reasoning stays hidden; the fact that the target is
now `invalidated` does not.

```bash
agent-journal record --workspace api --kind decision --id d-secret-source \
  --question "how do we route the queue's dead letters?" --chosen "a side table" \
  --disclosure published
agent-journal invalidate d-secret-source --workspace api \
  --reason "the vendor named in the postmortem cannot appear in a published digest" \
  --disclosure private
agent-journal digest --workspace api --level team
```

The `team`-level digest shows `d-secret-source` with `outcome: invalidated` — the
question is still there, the fact that it was retracted is still there — and nowhere in
that output does the withheld reason appear. Rendering it at `--level private` is the
only way to see the retraction record itself, title and reason included.

Get this backwards — filter by disclosure first, project second — and a private
retraction stops suppressing anything for a less-privileged reader: the invalidated
entry would read as live, which hides that anything happened at all. That is worse than
a retraction with a hidden reason, because a hidden reason at least announces itself as
hidden.

## Ordering: by consequence, not by time

A digest is not a timeline. Entries are sorted so the reader hits the things that most
change what they should do first:

1. `invalidated` outcome before anything else.
2. Among the rest, by `reversibility`: `one-way`, then `hard`, then `moderate`, then
   `trivial`, then entries with no `reversibility` at all.
3. Within a tie on the above, an entry with a `blastRadius` before one without.
4. Any remaining tie breaks on `id`, lexicographically.

That fourth rule exists so two renders of the same journal are byte-identical — a
committed digest that reordered itself on every regeneration would make review diffs
noise instead of signal.

`rejected[]` renders in full for every decision that has it; nothing is truncated or
summarised. An entry whose influences are **only** `model_knowledge` — not merely one
of several — gets a visible flag:

```
> **No source consulted** — this rested on `model_knowledge` alone.
```

A mixed entry, one `model_knowledge` influence alongside a real citation, does not carry
that flag: the signal is "nothing checkable was consulted," not "priors were involved at
all."

## Every digest carries a coverage statement

The tail of every rendered digest is the same coverage block `agent-journal coverage`
produces on its own, folded in rather than left for the reader to cross-reference
separately:

```
## Coverage

- sessions observed: 2
- sessions that recorded nothing: 0
- sessions with no events at all: not assessed
- refused writes (voids): 0
- sequence gaps: 0
- downgraded anchors: not assessed

`not assessed` is not `none` — it means nothing computed the figure.
```

`sessionsWithNoEvents` and `downgradedAnchors` are the two fields this package will only
ever compute when a caller supplies extra input the CLI's plain `digest` invocation does
not (a known-sessions list; a retention pass). Where that input was never supplied, the
field is `null`, and the digest renders `not assessed` — never `0`. A `0` there would
claim a real count of zero; `not assessed` says nobody looked, and a reader can tell the
difference without cross-referencing anything.

## `digest` refuses on a damaged journal; every other command warns and continues

`coverage`, `show` and `trace` all take the same stance toward a journal they could not
fully read: they render whatever they could parse, exit non-zero, and print a warning
that the result is a floor, not a total. `digest` does not. A damaged journal makes it
refuse outright — no partial output on stdout, and `--out` writes nothing to disk. Where
one unreadable path and no malformed lines makes `coverage` print its report with a
warning appended, the same damage makes `digest --out <path>` print nothing at all,
write nothing to `<path>`, and exit 1 with `refusing to render: <N> unreadable path(s),
<M> malformed line(s)` on stderr.

The other commands exist to be read interactively, by someone who will also see the
warning line next to the JSON. A digest is different in kind: it is the artifact that
gets committed, attached to a review, or handed to someone who was not in the room when
it was generated — and by the time they read it, the warning that would have explained
its gaps may not be attached to it at all. A digest that renders successfully with a
warning invites exactly that: a partial document with no visible sign, once separated
from its stderr, that it is partial. Refusing outright is the only version of this
command that cannot produce a silently-incomplete artifact.

## `--out` refuses to write inside any workspace's segment tree

Point `--out` at a path under `$AGENT_JOURNAL_ROOT/workspaces/<id>/segments/` — the tree
`agent-journal` itself writes entries into — and the command exits 2 before rendering
anything, naming that directory and explaining why: *a digest written there becomes
journal input on the next read*.

Every read of a workspace walks every `.jsonl` file under its `segments/` tree. A digest
written into that tree becomes journal input the next time anything reads the workspace
— parsed as an entry, or as a malformed line if its extension happens to match and its
content does not parse as one, either way corrupting the record it was rendered from.

This is not scoped to the workspace named by `--workspace`. `--out` may name a
*different* workspace's segment tree —
`agent-journal digest --workspace ws --out $AGENT_JOURNAL_ROOT/workspaces/other/segments/p.jsonl`
— and that sibling is refused too, even one that has never been written to before and
has no `segments/` directory on disk yet. Only a path outside every workspace's segment
tree is left alone; writing at `$AGENT_JOURNAL_ROOT/digest.md`, or elsewhere under a
workspace's own directory that is not its `segments/` tree, is odd but harmless and is
not refused.

The check resolves both the segment root and `--out` through the filesystem —
`realpath` on the parent chain, `lstat` on the final component — not string comparison,
so a relative path, a `..` traversal, or a symlink pointing back into the tree is caught
the same way a direct path would be. That includes a **dangling** symlink — one whose
target does not exist yet, the shape `ln -s $ROOT/workspaces/ws/segments/poison.jsonl
./out.md` produces. `realpath` alone cannot resolve a target that is not there yet, so
the check follows the link itself (`readlink`, resolved against the link's own
directory) rather than treating "the target doesn't exist" as "this whole path doesn't
exist, so it must be fine": both are refused identically, exit 2, before anything is
written.

## `--out` refuses at `--level private`

Spec §13.3, verbatim: *"private never leaves the local journal — not to sync, not to a
hosted sink, not to a digest."* Printing a private-level digest to stdout is reading the
local journal; writing it to a file is leaving it. So `--level private` combined with
`--out` is refused outright, exit 2, before anything is read or rendered:

```
$ agent-journal digest --workspace api --level private --out ./digest.md
--out is refused with --level private; private entries are not written to a file
(spec 13.3) — omit --out and read the digest from stdout for local inspection
```

Drop `--out` and the same `--level private` render still works — stdout is local
inspection, not leaving the journal, and stays available:

```bash
agent-journal digest --workspace api --level private
```

## A digest is a rendered artifact, never the source of truth

The journal's segment files are the record. A digest is a projection of them at one
disclosure level, at one moment — literally stamped `As of <timestamp>` on its first
line. Treat a stale digest as evidence of anything beyond what the journal looked like
when it was rendered, and you have reintroduced the exact problem coverage exists to
name: an artifact that looks authoritative and is quietly out of date.

## Tracing from a symptom: `trace <key> --workspace <id>`

Spec §10.2 is explicit that support and debugging questions do not start with an entry
id — they start with a ticket number, a file that misbehaves, a flag someone flipped, or
a decision id someone already has in hand. `trace` indexes all four the same way:

| Source | Example |
| --- | --- |
| `id` | the entry's own id |
| `subject` | `--subject src/queue.ts` on the entry that recorded it |
| anchor ref | `--anchor runtime:flags/retry-backpressure=on` |
| influence ref | `--influence url:supporting:JIRA-4821` |

```bash
agent-journal record --workspace api --kind decision --id d-queue \
  --subject "src/queue.ts" \
  --question "how do we bound the retry queue?" --chosen "in-process ring buffer, 256 entries" \
  --disclosure published
agent-journal record --workspace api --kind finding --id f-ticket \
  --claim "the bound matches the SLA in the ticket" \
  --influence url:supporting:JIRA-4821 --disclosure published
agent-journal record --workspace api --kind decision --id d-flag \
  --question "should retry backpressure ship dark?" --chosen "yes, behind a flag" \
  --anchor "runtime:flags/retry-backpressure=on" --disclosure published
agent-journal record --workspace api --kind finding --id f-depends \
  --claim "the 256 bound is never reached" \
  --influence journal:decisive:d-queue --disclosure published
```

```bash
agent-journal trace src/queue.ts --workspace api
agent-journal trace JIRA-4821 --workspace api
agent-journal trace flags/retry-backpressure=on --workspace api
```

Each reports one match: `d-queue` via `subject`, `f-ticket` via `influence`, `d-flag` via
`anchor`. Every match carries `via`, naming which of the four sources produced it, in
precedence order `id` > `subject` > `anchor` > `influence` when more than one would
apply to the same entry — an entry whose id happens to equal the key is what was asked
for; that it might also cite the key elsewhere is secondary and never shown instead.
`agent-journal trace d-queue --workspace api` shows this with two entries at once: it
reports `d-queue` itself via `id`, and, separately, `f-depends` via `influence` — the
same key, matched for two different reasons, each labelled with the reason it matched.

### Lookup is exact, never a substring

```bash
agent-journal trace queue --workspace api
```

This reports no match — exit 0, an empty `matched` array, and
`no entry is indexed under "queue" in this workspace` on stderr — even though the
workspace above has an entry whose `subject` is `src/queue.ts`. Keys are trimmed and
lower-cased, but never partially matched — a fuzzy index would hand back candidates a
reader then has to rule out one by one, which is the adjudication this lookup exists to
avoid. Ask for the exact string that appears in the subject, the anchor, the influence,
or the id.

### The walk goes backwards, and does not stop at an invalidated entry

Past the initial match, `trace` follows three edge types backwards — `journal`-typed
`influences`, `supersedes`, and `invalidates` — building a chain that says, for every
step past the first, which edge led there:

```bash
agent-journal invalidate d-queue --workspace api \
  --reason "the SLA changed; the bound is no longer sufficient"
agent-journal trace f-depends --workspace api
```

```json
{
  "matched": [{ "id": "f-depends", "via": "id" }],
  "chain": [
    { "id": "f-depends", "via": null },
    { "id": "d-queue", "via": "influences" }
  ]
}
```

`d-queue` is now `invalidated`, and the walk reaches it anyway. That is deliberate, not
an oversight the disclosure work should have closed off: "why is this like this" very
often ends at a decision that turned out to be wrong, and hiding invalidated entries
from the walk would make the one traversal built for root-causing unable to reach root
causes. `trace` answers a different question than `show`'s `live` flag — reachable,
not currently in force — and conflating the two would break the tool support questions
are supposed to use.
