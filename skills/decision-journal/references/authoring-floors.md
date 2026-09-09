# Authoring floors: when the journal asks first

Everything else in this skill is voluntary. You notice a decision, and you write it —
[the main skill file](../SKILL.md)'s whole Procedure section is about getting better at
noticing. Spec §11.3's finding is the uncomfortable one: the set of things an agent
notices and writes down on its own is roughly *the complement* of the set that causes
incidents. Nobody decides to flip an enforcement flag. Nobody schedules a moment to
reflect on a secret rotation that went fine. The self-triggered loop (§11.1, unchanged
by any of this) is real and worth keeping, and it is also, by its own nature, silent on
exactly the calls that turn out to matter most.

Two floors sit beneath it — not a replacement, an addition. Both **prompt**: they ask a
question, in the agent's own voice, about something the observation plane already saw.
Neither writes an entry, and neither ever will; see "Floors prompt, never author" below.

## What each one fires on

| | Floor 2 — consequence (§11.3) | Floor 1 — compaction (§11.2) |
| --- | --- | --- |
| Fires on | `PostToolUse`, after a tool call returns | `PreCompact`, before the harness compacts context |
| Command | `agent-journal floor --kind consequence` | `agent-journal floor --kind compaction` |
| Asks | "Was that consequence-bearing? If so, write it down." | "Flush what's pending, and sweep for what you never checked." |
| Wire shape | `hookSpecificOutput.additionalContext` | top-level `reason` / `systemMessage`, **never** `hookSpecificOutput` |

The two use genuinely different delivery mechanisms, not by choice but because the
harness leaves no other option: `PreCompact` rejects `hookSpecificOutput` outright — the
harness's own schema validation fails it, captured directly as the literal error banner
in
[`adapters/HOOK-OUTPUT-NOTES.md`](https://github.com/crissmoldovan/agent-skills/blob/main/adapters/HOOK-OUTPUT-NOTES.md) —
so Floor 1 has to ride the generic top-level fields instead. That file, and
[`adapters/claude-code/README.md`](https://github.com/crissmoldovan/agent-skills/blob/main/adapters/claude-code/README.md)'s
"Authoring floors" section, are the primary record for the wire-level mechanics; this
page covers what a user of the skill needs to know, not the transport.

Only the Claude Code adapter has either floor wired. Codex's floors are deliberately
left unwired pending a real Codex install to build and verify against — the same
caution [references/adapters.md](adapters.md) already applies to Codex's mapping work
generally.

## Trying a floor directly, without a hook

`agent-journal floor` is a plain CLI command — you don't need a live Claude Code session
to see what it says, only a journal with something in it. Nothing has happened yet, so
there is nothing to say:

```bash
agent-journal floor --kind consequence --workspace floors-demo
```

Silent, exit 0. That silence is deliberate and is the common case — see "Why a false
positive is the worse defect" below. Now put something consequence-bearing in the
journal — a `wrangler secret put` is exactly the shape §11.3 names — the same way a
`PostToolUse` hook would, via `agent-journal observe`:

```bash
agent-journal observe --workspace floors-demo --kind tool_call --id obs-secret-put \
  --tool Bash --callId call-1 --input 'wrangler secret put API_KEY'
```

Ask again:

```bash
agent-journal floor --kind consequence --workspace floors-demo
```

```
Plane A saw something here that nobody necessarily decided on purpose. That does not mean it
needs an entry — most tool calls do not — but it's worth a moment's thought before moving on:

- mutation: wrangler secret put/delete/bulk changes a deployed Worker or Pages secret (observation obs-secret-put — cite it as `--anchor runtime:obs-secret-put`)

If this genuinely has a consequence, write down what happened, why, and what you assumed was
true when you did it. If on reflection it does not, that is a legitimate answer too — just
make sure it was a real judgement, not a pass.
```

It names the observation and hands you the exact anchor to cite — see "The `runtime`
anchor" below for why that citation is the point of the whole exercise:

```bash
agent-journal record --workspace floors-demo --kind decision --id d-secret-rotate \
  --question "should this secret actually be rotated here?" \
  --chosen "yes, it was an expired staging key" \
  --anchor runtime:obs-secret-put
```

And Floor 1, against the same workspace — it has something to say too, because *any*
unflushed activity is enough to trigger the flush half, regardless of whether it was
consequence-bearing:

```bash
agent-journal floor --kind compaction --workspace floors-demo
```

```
Context is about to be compacted. Whatever is not written down before that happens does not
survive it.

Flush: is there a decision, a finding, a blocker, or a piece of progress from this session
that you have not recorded yet? If so, write it now — in your own words, from what actually
happened, not a summary of this message.

Assumption sweep: separately from the above, what did you take on trust this session without
ever checking it — about idempotency, about ordering, about the environment? Name each one
you can think of and write it as an `assumption` entry with `checked: no`. This is not a
confession of a mistake; it is a record of what stayed unverified, for whoever reads this
journal next.
```

Both commands accept `--since <timestamp>` to narrow what counts as "since I last
checked" (Floor 2's adapter wiring uses this — see the README's "`--subject` and
`--since`" section for the exact heuristic and its own stated limits). Floor 2 also
takes `--subject <text>`, checked against every live `constraint`'s `scope` — the fourth
of §11.3's triggers, `constraint-match`.

## How to opt in — and why it defaults off

Neither floor speaks unless the workspace has explicitly turned them on:

```
AGENT_JOURNAL_FLOORS=1
```

set in the `PostToolUse` and `PreCompact` blocks' `command` strings in
`~/.claude/settings.json` (see the adapter README's "Installing it" and
"Configuration" sections for the exact fragment). Every other value — unset, blank,
`0`, `true`, anything else — leaves both floors completely inert, which is also the
state of every workspace that predates this feature.

**Why opt-in, not on by default:** a floor that starts talking into a session nobody
asked it to talk into is a floor that gets the whole adapter uninstalled within a day.
An uninstalled adapter records nothing at all — not just the consequence-bearing calls
this feature exists to catch, but every observation the plane was already producing.
That is a strictly worse outcome than the gap these floors close.

### Why a false positive is the worse defect

This is worth stating as its own rule, not folded into the paragraph above: **a floor
that fires on ordinary work is a worse defect than a floor that stays silent when it
should have spoken.** A false negative loses one entry that self-triggered authoring
might have caught anyway, or might not — the gap §11.1 already has. A false positive
costs the whole mechanism, for every future call, the moment someone decides the noise
isn't worth it and turns the adapter off. That asymmetry is why `MUTATION_PATTERNS`
below is deliberately conservative rather than broad, why both floor renderers return
`null` — never an empty string that still prints a blank prompt — the moment there is
nothing to say, and why opt-in exists at all instead of a default-on feature with an
escape hatch.

## Floors prompt, never author

Every renderer in `floors.ts` produces a question, never a filled-in entry and never a
`record` invocation with the fields already chosen. The file's own header comment states
the reason plainly: an influence is supposed to be *selected from what the tooling saw*
(§5.3), not handed to the agent pre-selected — a floor that hands over a draft skips
that selection step and manufactures exactly the perfunctory, unconsidered entry §11.3
warns a per-turn checkpoint would produce. If you ever see a floor's output contain a
complete sentence that reads like it belongs in `--rationale` or `--chosen`, that is a
bug in `floors.ts`, not a feature of it — file it as one.

## What the classifier cannot see

`consequencesIn` (`consequence.ts`) is a heuristic over what the observation plane
happened to capture, not a semantic understanding of what a tool call did. Three blind
spots are worth knowing before you rely on it, because each shapes what silence from a
floor actually means:

**`permission` matches nothing today, on this harness.** The rule itself is fully
implemented against a real observation kind (`permission`, with `tool` and `decision`
fields) — the code is correct, and the day an adapter starts emitting one it works with
no changes. But no adapter currently does: Claude Code's `PermissionRequest` hook was
attempted directly and never observed to fire, on this harness version, even during a
real permission denial (`adapters/NOTES.md`). So a permission grant or denial today
produces no observation at all, and Floor 2 has nothing to classify. Silence here is not
evidence the rule failed; it is evidence nothing fed it.

**"Unfamiliar" means *absent from this journal*, never "new to the world."**
`unfamiliar-api` tracks every host a `tool_call` has named so far in this workspace's own
history and flags the first appearance of each one. A host this project has called a
hundred times from a different workspace, or that every other engineer already knows
well, still reads as unfamiliar the first time *this* journal sees it. Read the detail
string literally — "first appearance of host X in this journal" — not as a claim about
the host's actual novelty.

**Mutation matching is a pattern table, and it is meant to be extended, not the matcher
around it.** `MUTATION_PATTERNS` in `consequence.ts` is a deliberately explicit list —
`wrangler secret put`, `gh secret set`, `aws secretsmanager …`, `terraform apply`, and
the rest — each naming a specific mutating subcommand, never a bare tool name, so a
read-only sibling (`… list`, `… get`, `… status`) is never caught by accident. When a new
CLI needs coverage, add a row there, following the same shape every existing row does;
the surrounding matcher (quote handling, comment stripping, preview-flag detection,
command splitting) already applies to whatever you add.

**One thing that matcher only sees for a shell tool.** Every guard above is written
against a command line, so classification runs only for `Bash` and its siblings. That
is not a limitation to work around — it is what stops a `Grep` for the literal text
`gh secret set`, or a `Write` whose content mentions a URL, from being read as a config
change. It was a real bug: before the gate existed, writing a README with links in it
prompted for a journal entry. A pattern you add here will never be tried against a
non-shell tool's payload, and should not be written as though it might.

Two things are deliberately **not** in the table, and adding them would trade a real
problem for a worse one: a bare `curl -X POST` against an arbitrary URL, and bare
`wrangler deploy` / `kubectl apply`. All three share the same defect — their read-only
preview form uses the identical verb, distinguishable from the real mutation only by a
flag (`--dry-run`, `-o yaml --dry-run=client`, or nothing at all for `curl`, since an
HTTP method flag alone says nothing about which URL is a feature-flags API and which
merely contains the word "flags" in its path). String matching alone cannot tell these
apart without either missing real mutations or firing on routine reads — exactly the
false-positive risk "Why a false positive is the worse defect" above says is not worth
taking. If your workflow needs one of these covered, it needs a rule with more context
than a command string carries, not a broader regex here.

## The three limits worth stating plainly

Each of these was found or decided while verifying this feature end to end, not
theorized in advance. None is a caveat to read past — each changes what you should
expect a floor to do for you.

### Floor 1 does not force a pre-compaction flush, despite what §11.2 says

§11.2's own words are that `PreCompact` "forces a flush **before** context is
destroyed." The mechanism does not do that, and the gap is structural, not a bug to
fix later. `PreCompact`'s text reaches the agent *after* compaction has already run —
confirmed live, not inferred: a follow-up prompt in the same session, asked what special
instructions arrived around the compaction step, got the full flush-and-sweep text back
verbatim, with the agent's own unprompted commentary that it "reached me as
`local-command-stdout` *after* compaction had completed, carrying the caveat 'DO NOT
respond to these messages… unless the user explicitly asks'" — the harness's own
caveat, not this project's. As a prompt meant to trigger action *before* the loss, it
arrives too late to act on.

What it *does* achieve is real, and worth having on its own terms: the flush and
assumption-sweep instruction is folded into the compaction/summarization request
itself, which means it becomes part of what *survives* compaction. The agent is
reminded, afterward, to go write those entries — with whatever detail compaction
already discarded. Say both halves together. "PreCompact fires, so nothing is lost" is
false; "PreCompact fires, so the reminder to flush is itself one of the things that
survives" is true, and is the actual value this floor provides. Treat this the way
`adapters/NOTES.md` treats `heartbeat`: a structural limit of the hook surface, stated
in its own right, not a defect in this implementation to route around.

### Floor 2 cannot see a failed tool call

`PostToolUse` does not fire for a `Bash` call whose underlying command exits non-zero —
confirmed three separate ways in isolated sessions, each behind a debug wrapper that
logs every hook invocation verbatim: a missing binary (`command not found`, exit 127), a
real program erroring out on its own terms, and a bare `false`. In all three, exactly
one hook fired for the whole call — `PreToolUse` — and no `PostToolUse` invocation
appears anywhere in the log, not merely one that produced empty output. Contrast-checked
against an identical setup with a succeeding command, which fires both hooks every time.

Practically: a denied permission, a half-applied change, or a mutating command that
errored partway through is invisible to Floor 2, structurally, regardless of how good
`MUTATION_PATTERNS` gets. This is arguably the more common real case for exactly the
commands that table targets — `wrangler secret put`, `gh secret set`, `aws
secretsmanager …` — all commands that fail constantly on an expired token or a
misremembered flag. It also resolves an earlier open question: why `PostToolUseFailure`
was never observed to fire on this harness — `adapters/NOTES.md`'s own negative case was
about a *permission denial*, a different mechanism (the harness refusing the call before
it runs), not a call that ran to completion and merely returned nonzero.

Not established here: whether this is `is_error`-state-driven — the harness treating any
nonzero Bash exit the same way it treats a denied call — specific to this harness
version, or something else entirely. A dedicated probe, isolated from everything else
this feature needed to verify, should settle that before anyone designs around it
further.

### The classifier is a heuristic with named blind spots

Covered in full above, under "What the classifier cannot see" — restated here only so
this list names all three real limits in one place: `permission` matches nothing in
practice today, "unfamiliar" means absent from this journal rather than new to the
world, and mutation matching is a pattern table with deliberately excluded classes
(`curl -X POST`, bare `wrangler deploy` / `kubectl apply`) that a reader should expect
to extend at `MUTATION_PATTERNS`, never at the matcher around it.

## The `runtime` anchor

[references/anchors.md](anchors.md) already defines `runtime`: it proves *a deployed
config or flag value*, and — like every anchor — never proves the value was reviewed,
only that it existed. `record --anchor runtime:<observation-id>` has always worked; an
earlier audit of this project briefly listed `runtime` as an anchor class with no
producer, which was wrong and got corrected on inspection — the CLI support was there
the whole time.

What was actually missing was narrower: nothing helped an agent *notice* that a
mutation had just happened, so nothing prompted it to think of citing a `runtime`
anchor in the first place. That is what Floor 2 is for. Every `mutation`-rule line a
Floor 2 prompt prints hands back exactly the anchor to use —
`` `--anchor runtime:<id>` `` — as shown in "Trying a floor directly" above. Building
Floor 2 closes the noticing gap as a side effect of closing the consequence gap; the
anchor mechanics needed nothing new.

## Further reading

- [references/adapters.md](adapters.md) — the observation plane both floors read from:
  what a hook captures automatically, what it can't, and how to verify one actually
  fired.
- `adapters/claude-code/README.md` and `adapters/HOOK-OUTPUT-NOTES.md`, in the
  repository (outside this skill's own installed files — see adapters.md's "Getting an
  adapter" section for why) — the primary record for the wire-level mechanics summarized
  above: exact payload shapes, the `--since` lookback heuristic, the 8,000-character
  truncation, and the JSON-safety guarantees.
