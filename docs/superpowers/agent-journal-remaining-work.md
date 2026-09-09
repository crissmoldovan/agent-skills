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

**Digest cadence (§17.4)** — decided 2026-09-09: **per pull request**, rendered
locally and committed with the change. CI cannot render one — §6.2 keeps the journal
outside the repo, so a runner has nothing to render from and a workflow calling
`digest` would emit an empty document, which reads as "no decisions were made". CI
validates the committed digest's shape instead (`scripts/verify-digests.mjs`, in
`npm run verify`): not empty, not truncated, coverage block present and singular,
nothing appended by hand. **It cannot check freshness and does not claim to** — a
three-week-old digest passes. See `references/digest-and-disclosure.md`.

**Tombstones (§13.2) and entry TTL (§13.2, same paragraph)** — both shipped: the
`tombstone` event kind, `agent-journal tombstone <id> --reason …`, `tombstoned`
derived from the journal itself via `suppressedIds`, purge-on-compaction through
`compact --apply`, and an independent `--entry-ttl-days` alongside
`--observation-ttl-days`. See
[`skills/decision-journal/references/retention-and-deletion.md`](../../skills/decision-journal/references/retention-and-deletion.md)
for the mechanics — what a tombstone costs, why `compact` defaults to a dry run and
refuses on a damaged journal, and the pinning interaction between an entry's own TTL
and what it anchors.

**Authoring floors (§11.2–11.3)** — shipped, opt-in per workspace via
`AGENT_JOURNAL_FLOORS=1`: Floor 2 (consequence) on `PostToolUse`, Floor 1 (compaction)
on `PreCompact`. Both floors prompt, never author. See
[`skills/decision-journal/references/authoring-floors.md`](../../skills/decision-journal/references/authoring-floors.md)
for what each fires on, opting in and why it defaults off, and the classifier's named
blind spots (`permission` matches nothing on this harness today, "unfamiliar" means
absent from this journal rather than new to the world, and `MUTATION_PATTERNS` is a
table meant to be extended). The `runtime` anchor class was never actually missing a
producer — `record --anchor runtime:<id>` already worked, and an earlier revision of
this file said otherwise in error. What was missing was anything that helps an agent
*notice* a mutation happened so it thinks to cite one; that is Floor 2's job, closed as
a side effect of shipping it. Two structural limits found while verifying this end to
end are worth their own entries rather than a footnote here — see #2 and #3 below.

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

## 2. Floor 1 does not force a pre-compaction flush, despite what §11.2 says

**§11.2, and a limit of the hook surface rather than of this implementation.**

§11.2's own words: `PreCompact` "forces a flush **before** context is destroyed." The
shipped mechanism does not do that, and confirming so took a live check, not inference:
a follow-up prompt in the same session, after compaction, asked what special
instructions arrived around the compaction step and got the full flush/assumption-sweep
text back verbatim — with the agent's own unprompted commentary that it "reached me as
`local-command-stdout` *after* compaction had completed, carrying the caveat 'DO NOT
respond to these messages… unless the user explicitly asks'." As a prompt meant to
trigger action *before* the loss, it arrives too late to act on.

What it does achieve is real, and is not nothing: the flush/assumption-sweep
instruction is folded into the compaction/summarization request itself, so it survives
compaction and reminds the agent afterward to write those entries — with whatever
detail compaction already discarded. Both halves need saying together; see
[`skills/decision-journal/references/authoring-floors.md`](../../skills/decision-journal/references/authoring-floors.md)
for the reader-facing version, and `adapters/HOOK-OUTPUT-NOTES.md`'s 2026-09-09
addendum for the live verification this is drawn from.

**What would close it:** nothing available on this harness today. `PreCompact` rejects
`hookSpecificOutput` outright (the harness's own schema validation) — the only channel
that could plausibly deliver text before compaction completes rather than folded into
its own summary. Closing this needs either a harness capability that does not
currently exist, or accepting that §11.2's wording promises more agency in the moment
than the mechanism can provide and revising it to say what Floor 1 actually does.

## 3. Floor 2 cannot see a failed tool call

**§11.3, found running this task's own required end-to-end check, not a dedicated
probe.**

`PostToolUse` does not fire for a `Bash` call whose underlying command exits non-zero —
confirmed three separate ways, each isolated in its own session behind a debug wrapper
that logs every hook invocation verbatim: a missing binary (exit 127), a real program
erroring out on its own terms, and a bare `false`. In all three, exactly one hook fired
for the whole call (`PreToolUse`); no `PostToolUse` invocation appears anywhere in the
log. Contrast-confirmed against an identical setup with a succeeding command, which
fires both hooks every time.

A denied permission, a half-applied change, or a mutation attempt that failed —
expired auth, a typo'd flag, the tool not installed — is invisible to Floor 2
structurally, independent of anything `MUTATION_PATTERNS` gets right, and this is
arguably the more common real case for exactly the commands that table targets. It also
resolves an earlier open question: why `PostToolUseFailure` was never observed to fire
on this harness — `adapters/NOTES.md`'s own negative case was a permission *denial*, a
different mechanism (the harness refusing the call before it runs), not a call that ran
to completion and merely returned nonzero.

**What would close it:** a dedicated probe, isolated from everything else this task
needed to verify, bisecting whether this is `is_error`-state-driven (the harness
treating any nonzero Bash exit the way it treats a denied call), specific to Claude
Code 2.1.258, or something else — before anyone designs around it further. Full
verification, including the exact payloads and logs, is in
`adapters/HOOK-OUTPUT-NOTES.md`'s 2026-09-09 addendum.

## Deferred, already documented, not gaps

Named with reasons in `skills/decision-journal/references/decay.md` and `adapters.md`:
`url` and `ticket` rot (network egress, credentials), `premise[]` re-checks, `living`,
automated `visual` capture, the Cursor and Gemini adapters, the hosted sink, the MCP
wrapper, sync beyond tier 1, signed segments, transcript tier 4 and the backfill pass.

Also structural rather than deferred, recorded in `adapters/NOTES.md`: `heartbeat`
cannot be driven by any hook surface, `permission` and `tool_failure` have no confirmed
source, and a dropped hook leaves no trace because `sequenceGaps` cannot see one.

## Open questions still unanswered

§17's seven. Cadence (§17.4) is now decided — see "Closed since the last audit". The two that bite hardest of the rest:

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
