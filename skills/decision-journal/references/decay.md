# Decay: checking a journal against the world it described

An entry does not stay true because it was true once. The file it cites gets deleted.
The ticket it cites gets closed. The interpreter it ran under is not the one on `PATH`
today. `decay` is the command that asks, of everything already in the journal, *does
the world still look like this said it did* — and reports what it finds without acting
on any of it.

[references/anchors.md](anchors.md) introduces the distinction between **rot** (did a
source move or die) and **premise** (was the reasoning ever sound) in brief. This
document is the full reference: every status `decay` can report, exactly what it does
and does not look at, and the two limits worth knowing before you trust its output.

## Running it

```bash
agent-journal decay --workspace <id> [--repo <path>]
```

`--repo` is the only thing beyond `--workspace`, and it is optional — see "The
`codebase` ref convention" below for what omitting it means. Like every other command
here, an unrecognised flag is refused rather than silently ignored.

`decay` exits 0 whenever the journal itself could read cleanly, **regardless of what
the findings say** — a report full of `failing` entries exits the same as a report
full of `passing` ones. That is not an oversight; see "Nothing is auto-resolved" below.
Exit 1 means the journal was damaged (unreadable segments, malformed lines), the same
floor-not-total warning `coverage`, `show` and `trace` already give — and is unrelated
to any individual finding's status.

## Five statuses, and what each one commits to

| Status | Says | Never means |
| --- | --- | --- |
| `passing` | Checked. The source still holds. | — |
| `failing` | Checked. The source no longer holds, or the citation was broken to begin with. | "It probably still holds" |
| `drifted` | Checked. It differs — but the difference is a question for a human, not a verdict. | "It is wrong" |
| `not-checkable` | Nothing could ever check this, or the tools to check it were not supplied for this run. | "It is fine" |
| `not-implemented` | A checker could exist for this. This release does not ship one. | "It is fine", or "it can never be checked" |

The two that get confused are `not-checkable` and `passing`. They must never collapse
into each other — a `person` influence that comes back anything other than
`not-checkable` is a bug, because nothing in this tool can re-interview a person. Read
`not-checkable` as *silence*, not as *clean*.

The other confusable pair is `drifted` and `failing`, and the difference is deliberate
rather than cosmetic — see "Environment drift" below for why it exists as a fifth
status instead of folding into `failing`.

## What decay actually looks at

Two things, and only two:

- Every live entry's `influences` — the nine types in
  [references/anchors.md](anchors.md#anchors-versus-influences): `journal`,
  `tool_result`, `codebase`, `url`, `ticket`, `document`, `person`, `model_knowledge`,
  `conversation`.
- `environment`-class anchors specifically.

**Every other anchor class is not decay-checked in this release.** `commit`, `file`,
`visual`, `runtime`, `tool_use`, `message`, `url` and `external` anchors produce no
finding at all — not `not-checkable`, not anything. Citing one is still valuable (it is
what [references/anchors.md](anchors.md) is about), but `decay` has nothing to say
about it. Do not read a clean decay report as "every anchor on this entry was
verified"; read it as "every influence, and any `environment` anchor, was verified."

### What `journal` and `tool_result` each verify

Both resolve their `ref` inside this journal, and both check the **kind** of what they
find, because a citation that points the wrong way is a defect in the entry rather
than decay in a source:

- **`journal`** — the ref must name an *entry*, and that entry must still be live. It
  reports `failing` if the entry is absent, superseded, invalidated, a `void`, or an
  observation (cite an observation as `tool_result` instead).
- **`tool_result`** — the ref must name an *observation*, and this is a **presence
  check only**. It confirms the observation is still in the journal. It does **not**
  confirm that what the tool reported then is still true now. A `tool_result` reading
  `passing` means "that row is still there", never "that command would still print
  this". Nothing in this release re-runs anything.

Citing a `void` fails on both. A `void` is the journal's own record that a write was
*refused* — reading it as a surviving source would say "your evidence still holds"
about a row whose entire content is that nothing was written.

An entry that was itself directly superseded or invalidated is skipped — its own
sources stopped mattering the moment it stopped counting. An entry that merely *cites*
a casualty through a `journal` influence is not skipped: that citation is exactly what
reports `failing`, which is how a reader learns the entry's reasoning now rests on
something withdrawn.

## The `codebase` ref convention, and its honest limit

A `codebase` influence's ref is either a bare path or `path:symbolName`:

```bash
agent-journal record --workspace decay-demo --kind decision --id d-decay-check \
  --question "how does decay check a codebase influence?" \
  --chosen "existence, plus a text-contains scan for a named symbol" \
  --influence codebase:decisive:packages/agent-journal/src/decay.ts \
  --influence codebase:supporting:packages/agent-journal/src/decay.ts:computeDecay
```

`packages/agent-journal/src/decay.ts` alone checks that the file exists.
`packages/agent-journal/src/decay.ts:computeDecay` additionally requires the text
`computeDecay` to appear somewhere in that file.

**That second check is a grep, not a parse.** It catches a deleted file. It catches a
renamed or removed symbol — `computeDecay` gone from the text reports `failing`. It
does **not** catch a symbol that kept its name and changed what it does. If
`computeDecay`'s signature or behaviour changed while the identifier stayed exactly as
it is, this check has no way to know, and the finding would still read `passing`. A
`passing` `codebase` finding means *the name is still there*, never *the code still
means what the entry said it meant*. Overclaiming here — parsing every language a
journal might cite, understanding renames, tracking behaviour — is not a thing this
release attempts, and the reference says so rather than implying otherwise.

`--repo` is what makes any of this checkable at all, and it defaults to nothing:

```bash
agent-journal decay --workspace decay-demo
```

```json
{
  "findings": [
    { "entryId": "d-decay-check", "type": "codebase",
      "ref": "packages/agent-journal/src/decay.ts",
      "status": "not-checkable", "detail": "no codebase index was provided for this run" },
    { "entryId": "d-decay-check", "type": "codebase",
      "ref": "packages/agent-journal/src/decay.ts:computeDecay",
      "status": "not-checkable", "detail": "no codebase index was provided for this run" }
  ],
  "checked": 0, "notCheckable": 2, "notImplemented": 0, "drifted": 0
}
```

That is deliberate, not a missing default. Silently scanning whatever directory the
caller happens to be standing in is a surprise; `not-checkable` is the honest status
for "nobody told this run where to look." Point it at a checkout and the same refs
resolve — run from the root of this repository, `--repo .` names it:

```bash
agent-journal decay --workspace decay-demo --repo .
```

```json
{
  "findings": [
    { "entryId": "d-decay-check", "type": "codebase",
      "ref": "packages/agent-journal/src/decay.ts",
      "status": "passing", "detail": "\"packages/agent-journal/src/decay.ts\" is present in the codebase" },
    { "entryId": "d-decay-check", "type": "codebase",
      "ref": "packages/agent-journal/src/decay.ts:computeDecay",
      "status": "passing", "detail": "\"packages/agent-journal/src/decay.ts:computeDecay\" is present in the codebase" }
  ],
  "checked": 2, "notCheckable": 0, "notImplemented": 0, "drifted": 0
}
```

`--repo` is not remembered between runs — omit it on the next invocation and these two
findings go back to `not-checkable`, not to whatever they were last time. A ref that
resolves outside `--repo` (by `..`, a symlink, or an absolute path pointing elsewhere)
is refused the same way: omitted from what gets checked, reported `not-checkable`
rather than guessed at either direction.

## Environment drift: why this check exists at all

This is not a feature that happened to get added. It is the reason the plan exists.

The design's canonical failure looks like this: a session runs against the wrong
interpreter on `PATH`. Tests fail for environmental reasons. An agent investigates them
as a genuine regression and writes an entry that is *perfectly* formed — real anchors,
a real failing suite, an honest note that nothing was consulted beyond the failure
itself, high stated confidence. Every anchoring rule this skill teaches is satisfied.
The conclusion is worthless. Anchoring proves a decision happened; it says nothing
about whether the premise it rested on was true, and a well-anchored entry built on a
false premise is more dangerous than an unanchored one, because it reads as verified.

An `environment` anchor is what makes that premise checkable after the fact. Capture
one, and a decision can point at the toolchain it actually ran under:

```bash
agent-journal observe --workspace decay-demo --kind environment --id obs-node-pin \
  --interpreter /opt/build/bin/node --version v18.20.4
```

```
observed obs-node-pin
```

`observe` takes `--id` the same way `record` does — passed here so this example needs
no id copied out of the previous command's output. Omit it in practice and `observe`
generates one, printed the same way.

```bash
agent-journal record --workspace decay-demo --kind decision --id d-node-pin \
  --question "which interpreter must the suite run under?" \
  --chosen "the version pinned in package.json engines" \
  --anchor environment:obs-node-pin
```

`decay` compares that observation's `interpreter` and `version` against the machine
`decay` itself is running on right now:

```bash
agent-journal decay --workspace decay-demo
```

```json
{ "entryId": "d-node-pin", "type": "environment",
  "ref": "obs-node-pin",
  "status": "drifted",
  "detail": "environment drifted: recorded /opt/build/bin/node@v18.20.4, now /[REDACTED]/.local/share/node/bin/node@v26.7.0" }
```

(The live interpreter path is redacted before it ever reaches stdout — the same
machine-identifying-path rule spec §4.3 requires for a *stored* environment
observation applies here to a freshly captured one, since this is the one place a raw
`process.execPath` could otherwise leak straight into a report.)

**This is `drifted`, deliberately never `failing`.** A moved *source* is broken — a
deleted file, a closed ticket, a superseded entry. A moved *environment* may simply be
a different machine: a laptop instead of CI, a container instead of bare metal, a
newer patch release nobody needs to worry about. Collapsing the two would train people
to ignore the flag exactly the way §10.1 already warns against for a `living` source
flagged on every save — except here what would get trained away is the one check this
whole plan was built to have. `drifted` is surfaced for a human to judge, never
auto-invalidated: it says *the ground under this entry has moved, go look*, not *this
entry is wrong*.

A structurally broken anchor — no observation matching the ref, because it was never
recorded or was mistyped — is `failing`, not `drifted`. That is a dead citation, the
same class of problem a broken `journal` or `tool_result` reference is, and belongs
with those, not with a legitimate machine difference.

**The comparison is narrower than the whole `Environment` shape.** Only `interpreter`
and `version` are compared. `platform`, `packageManager` and `flags` can all differ
between the recorded observation and the machine running `decay` without ever
producing a `drifted` finding — those fields are captured and stored, but this check
does not read them. A `container` field or a CI-runner label changing is invisible to
this specific check.

## Nothing is auto-resolved

A `failing` finding does not invalidate the entry that cited the broken source. A
`drifted` finding does not mark anything wrong. Spec §10.1, verbatim: *a decision does
not become wrong because a source moved.* `decay` reports; a human, or
[`agent-journal invalidate`](../SKILL.md#5-retract-what-turns-out-to-be-wrong), acts.

One report shows the whole shape at once — a broken citation, a deferred type on every
row, a genuine drift, and two passing codebase refs, side by side, one exit code:

```bash
agent-journal record --workspace decay-demo --kind finding --id f-cites-ghost \
  --claim "the interpreter pin still matches production" \
  --influence journal:decisive:d-does-not-exist
agent-journal decay --workspace decay-demo --repo .
```

```json
{
  "findings": [
    { "entryId": "d-decay-check", "type": "codebase", "status": "passing", "...": "…" },
    { "entryId": "d-decay-check", "type": "codebase", "status": "passing", "...": "…" },
    { "entryId": "d-node-pin", "type": "environment", "status": "drifted", "...": "…" },
    { "entryId": "f-cites-ghost", "type": "journal", "ref": "d-does-not-exist",
      "status": "failing", "detail": "cited entry \"d-does-not-exist\" is not present in this journal" }
  ],
  "checked": 3, "notCheckable": 0, "notImplemented": 0, "drifted": 1
}
```

Exit code `0`. Nothing here blocked the write above it, and nothing here will block
the next one — `decay` is a report to read, not a gate.

(`record` gives one warning earlier and independently of `decay`: citing a `journal`
influence or a retraction edge whose id is not yet in the workspace prints
`WARNING: no entry with id … is present in this workspace` to stderr at write time,
exit 0. It is not refused, because across replicas the target can legitimately arrive
later. `decay`, run afterward, is what catches the same break once enough time has
passed that "not yet synced" is no longer the likely explanation.)

## Deferred, and why — not a property of the source

`checked` (`passing` + `failing`) plus `notCheckable` plus `notImplemented` plus
`drifted` account for every finding; each finding lands in exactly one of the four
counters, never zero and never two:

```bash
agent-journal record --workspace decay-demo --kind decision --id d-deferred-sources \
  --question "which sources back this decision?" \
  --chosen "a mix, and the record says which kind each one is" \
  --influence url:supporting:https://example.com/bench \
  --influence ticket:supporting:JIRA-1102 \
  --influence document:supporting:design-doc-v3 \
  --influence person:considered:reviewer \
  --influence model_knowledge:decisive \
  --influence conversation:considered:standup-2026-09-01
agent-journal decay --workspace decay-demo
```

| Influence type | Status | Why |
| --- | --- | --- |
| `url` | `not-implemented` | Checking it means fetching it — network egress this release does not perform. |
| `ticket` | `not-implemented` | Checking it means calling a tracker's API — a credential this release does not hold. |
| `document` | `not-implemented` | There is no ref convention yet for what a "document" points at or how to resolve it. |
| `person` | `not-checkable` | Nothing can re-interview a person. This is permanent, not a future release. |
| `model_knowledge` | `not-checkable` | There is nothing to point at — that is the claim it makes. Permanent. |

### `premise[]` is deferred too

§10.1 conditions the premise re-check on a `finding` declaring `premise[]` **and** an
environment anchor. Only the environment half ships. A `finding` whose premises are now
plainly false, but whose interpreter has not moved, reports clean — because nothing
reads `premise[]` at all.

This is named here rather than left silent for the same reason `visual` and `living`
are: a gap a reader can see is a gap they can work around. Re-checking a premise means
re-running the reasoning that produced it, and this release does not attempt that.
Environment drift is the one premise check that can be made deterministic, which is why
it is the one that shipped.
| `conversation` | `not-checkable` | This journal does not keep transcripts to re-check against. Permanent. |

The line that matters: `url`, `ticket` and `document` are **`not-implemented`** — a
property of *this release*, and a future one could add a checker for any of them.
`person`, `model_knowledge` and `conversation` are **`not-checkable`** — a property of
*the source itself*, and no future checker changes that. Confusing "we haven't built
it yet" with "it cannot be built" understates the first and overstates the second.

Two more things named in the spec are deferred for reasons worth stating rather than
leaving as a silent gap:

- **`visual` anchors are not decay-checked at all**, for the same reason listed under
  "What decay actually looks at" above — nothing in this release even attempts it —
  and separately, nothing in this release *writes* one either. §10.1 describes
  comparing a design file's version id at decision-relevant granularity; no adapter or
  command here produces that observation yet, so there is nothing to compare even in
  principle.
- **`living` does not exist as a flag in this release.** Spec §10.1 describes marking a
  source `living` to exempt it from content-hash rot — a design file changes on every
  save, and flagging that daily trains people to ignore rot flags entirely. But no
  content-hash rot check ships here at all; `codebase`'s check is existence and a text
  scan, never a hash. A `living` flag would have nothing to suppress. Adding one now
  would be a flag whose only stored effect is to be stored — worse than not having it,
  because it would look like it did something.
