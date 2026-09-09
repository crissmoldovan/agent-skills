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

## 2. The `runtime` anchor class has no producer

**§16's v1 set names it beside `environment`.**

`runtime` is in `ANCHOR_CLASSES` and nothing ever writes one. `environment`, its
sibling in that list, is captured by `observe --kind environment`. The distinction that
makes this a gap rather than a deferral: `visual` is *explicitly* schema-only in v1
("populated manually or by a human-authored entry"), and `runtime` carries no such
carve-out — it reads as something that should be captured.

Decide which it is, and either capture it or say in the spec that it is a schema.

## 3. §11's authoring floors are not wired

**§11.1–11.3.**

Authoring is self-triggered, with two floors that stop it being purely voluntary:

- **Floor 1 — compaction (§11.2).** The adapters record `compact` as an observation,
  but nothing prompts the agent to *author* at that moment. The observation is the
  evidence that context was about to be destroyed; the floor is the writing that
  should happen before it is.
- **Floor 2 — consequence, not judgement (§11.3).** A narrow set of
  consequence-bearing observations (config/flag/deploy mutations, permission grants)
  should also force an authoring prompt. Nothing reads observations for this.

§11.3's finding was that self-trigger alone captured roughly the complement of the set
that causes incidents — which is the whole reason the floors exist. Without them the
journal records what an agent felt like recording.

`SKILL.md` mentions compaction once. That is the extent of it.

## 4. Digest cadence — the open question with teeth

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
