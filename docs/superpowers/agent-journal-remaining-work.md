# Agent Journal — what is not done

Audited 2026-09-09 against `specs/2026-09-07-agent-decision-journal-design.md`, by
reading the shipped code rather than the plans. Plans 1–5 are merged to `main`:
the envelope and validator, the file sink and CLI, entries and retraction, the
digest and disclosure classes, `trace`, the observation plane with two harness
adapters, and decay checks.

This file exists because a spec section that is *partly* implemented is the easiest
kind of gap to lose: the tests pass, the command runs, and nothing anywhere says the
other half was never built. Each item below names the section it comes from and what
would close it.

## Closed since the last audit

**Tombstones (§13.2) and entry TTL (§13.2, same paragraph)** — both shipped: the
`tombstone` event kind, `agent-journal tombstone <id> --reason …`, `tombstoned`
derived from the journal itself via `suppressedIds`, purge-on-compaction through
`compact --apply`, and an independent `--entry-ttl-days` alongside
`--observation-ttl-days`. See
[`skills/decision-journal/references/retention-and-deletion.md`](../../skills/decision-journal/references/retention-and-deletion.md)
for the mechanics — what a tombstone costs, why `compact` defaults to a dry run and
refuses on a damaged journal, and the pinning interaction between an entry's own TTL
and what it anchors.

## 1. A tombstone's `purged` flag can be permanently, wrongly `false`

**§13.2, and a consequence of the `compact` skip path rather than of the spec.**

If a target's segment is purged but the segment holding its *tombstone* is skipped
(a session was appending to it), the bytes are gone while the tombstone reads
`purged: false` — and no later run corrects it, because the target has left the
journal so nothing plans a purge for it. Verified by running: the flag persists
through repeated runs while the content is erased.

The error is in the safe direction and suppression is unaffected, so this is not
urgent. It is recorded because the obvious fix is wrong: a later run sees only that
the target is absent, and absent has two causes it cannot distinguish — purged here,
or never present on this replica. Flipping on absence alone would claim an erasure
that may never have happened.

Closing it properly needs a record of the purge itself — a receipt a later run could
read — which is a design question, not a patch. Documented as permanent in
`references/retention-and-deletion.md` in the meantime.

## 2. §11's authoring floors are not wired

**§11.1–11.3.** *(This entry absorbed the former "`runtime` anchor class has no
producer" item — see the correction at the end of this section.)*

Authoring is self-triggered, with two floors that stop it being purely voluntary:

- **Floor 1 — compaction (§11.2).** Force a flush before context is destroyed:
  pending entries, plus an assumption sweep — what was taken on trust, written as
  `assumption` entries with `checked: no`.
- **Floor 2 — consequence, not judgement (§11.3).** A narrow set of
  consequence-bearing observations — permission grants and denials, config/flag/
  env-var/deploy mutations, first use of an unfamiliar external API, a `constraint`
  matching the current subject — prompts an entry regardless of judgement.

§11.3's finding is the sharpest line in the spec: the set an agent self-triggers on is
roughly *the complement* of the set that causes incidents. Nobody decides to flip an
enforcement flag. Without the floors, the journal records what an agent felt like
recording.

**Both are now buildable, on evidence rather than documentation.**
`adapters/HOOK-OUTPUT-NOTES.md` (2026-09-09) converted the hook output channel from
the binary's own strings into observed behaviour:

- Floor 2 → `PostToolUse` with `hookSpecificOutput.additionalContext`. **Observed
  working**, delivered mid-turn immediately after the tool call.
- Floor 1 → `PreCompact` with top-level `reason`/`systemMessage`. **Observed
  working**, folded into the compaction summary and surviving it. `PreCompact`
  rejects `hookSpecificOutput` outright — the probe captured the harness's own
  schema error — so Floor 1 needs the generic-field path, not Floor 2's.

Decided 2026-09-09: build it, **opt-in per workspace**. Injecting text into a live
session is not something an installed adapter should start doing unannounced.

### Correction: `runtime` was never missing a producer

An earlier revision of this file listed the `runtime` anchor class as having no
producer. That was wrong, and checking took one command:
`record --anchor runtime:<observation-id>` already works, writes
`{"type":"runtime","ref":"…"}`, and correctly marks `capabilities.runtime: "known"`
while every other class stays `unknown`.

`runtime` is not like `visual` (a schema nothing can populate). It is like
`tool_use`: the hook produces the observation, and the anchor is the agent's claim
about which observation mattered. That division already holds. What is missing is
anything that helps an agent *notice* a config mutation happened so it thinks to cite
one — which is Floor 2. Building Floor 2 closes this as a side effect.

Rejected while deciding: letting the agent call `observe --kind runtime` itself. That
would put agent-asserted content into Plane A, whose whole purpose is to be *not*
agent-asserted — either lying about `provenance: "hook"` or needing a new provenance
to admit it was not one.

## 3. Digest cadence — the open question with teeth

**§17.4.**

No CI job anywhere produces a digest. The spec's own note is that an undecided cadence
means no digest reaches anyone, and §6.4 makes the committed digest the artefact a
reviewer actually reads. Everything upstream of it works; nothing runs it on a
schedule.

Deciding this is cheap (per PR, per release, or on demand) and wiring it is small.

## Deferred, already documented, not gaps

Named with reasons in `skills/decision-journal/references/decay.md` and `adapters.md`:
`url` and `ticket` rot (network egress, credentials), `premise[]` re-checks, `living`,
automated `visual` capture, the Cursor and Gemini adapters, the hosted sink, the MCP
wrapper, sync beyond tier 1, signed segments, transcript tier 4 and the backfill pass.

Also structural rather than deferred, recorded in `adapters/NOTES.md`: `heartbeat`
cannot be driven by any hook surface, `permission` and `tool_failure` have no confirmed
source, and a dropped hook leaves no trace because `sequenceGaps` cannot see one.

## Open questions still unanswered

§17's seven. Beyond cadence (above), the two that now bite hardest:

- **Retention windows (§17.2)** — still no numbers, on either axis. `compact
  --entry-ttl-days` and `--observation-ttl-days` both work now and are genuinely
  independent, but neither has a default; a caller must type both, every run, or
  nothing expires on that axis at all.
- **An axis above workspace (§17.6)** — an initiative spanning several repos has no
  home, and `context` is workspace-scoped.

## One thing that looks like a gap and is not

`redact.ts`'s `assigned-secret` and `flag-secret` patterns match by the NAME a value is
assigned to, and §12.1 says redaction must inspect values rather than key names. That
is not a conflict. §12.1's complaint is that name matching **alone** has no failure
state, so the fail-closed rule can never fire. The nine shape-based patterns plus a
real `RedactionVerdict` are the value-level scanning §12.1 demands; the name-anchored
patterns sit on top of it, catching secrets that have no shape to match
(`aws_secret_access_key=…`). Both halves are needed and both are present.
