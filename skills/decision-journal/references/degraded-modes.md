# Degraded modes

The journal works in environments that cannot support all of it. What matters is that it
says which one it is in, rather than producing output that looks identical either way.

## What each environment actually gives you

| Environment | Filesystem | Hooks | MCP |
| --- | --- | --- | --- |
| Claude Code, Codex, Cursor, Gemini (local) | yes | yes | yes |
| Claude Code cloud / web | ephemeral | repo and org settings only | yes |
| Managed agents | persistent | no | yes |
| Cowork | **no** | no | yes |
| ChatGPT Work / agent mode | ephemeral terminal only | no | yes |

**The universal denominator is MCP — not the filesystem, and not hooks.** That is why
the write path is a sink interface rather than a file API: the CLI is one transport, not
the architecture.

## The ladder

Each rung records which one produced an event, so a reader can weigh it.

**1. Filesystem and CLI.** Full fidelity, offline, cheapest. Hooks capture actions
automatically; the agent records entries through the same validated path.

**2. Filesystem, no CLI.** Append JSONL directly. Entries are flagged unvalidated and a
later normalise pass repairs them. Schema conformance is on the honour system of the
entity being audited, which is exactly the weakness the CLI exists to remove — so treat
this as a bridge, not a destination.

**3. No filesystem.** An HTTP or MCP sink, same envelope. This is the only option in
Cowork and ChatGPT Work.

**4. Nothing at all.** The agent emits entries as marked structured blocks **into its own
transcript**, harvested later from anywhere with storage.

Rung 4 is worth taking seriously rather than treating as a joke. Every hosted product
retains conversation history, so the transcript *is* durable storage — it is simply not
*queryable* storage. Emitting in a machine-parseable form now means the reasoning can be
harvested into a real journal whenever that conversation is next touched from somewhere
with a filesystem.

The practical consequence: the skill degrades to "still records decisions" rather than
"does nothing", even in a bare chat with no tools.

## The honesty rule

Every rung below the first weakens what the record can claim, and the record must say so.

- On rung 2, entries are unvalidated. A later reader must be able to tell.
- On rung 3, the sink is remote. Whoever runs it can see the candid plane.
- On rung 4, **the agent authors both the actions and the reasoning**. The separation
  that makes the first rung trustworthy — evidence the agent does not write — does not
  exist. An entry from rung 4 is a claim, not a record, and should read as one.

## Without version control

Not a degraded mode so much as a different set of anchors. A design, ops or research
context has no commits and no diffs, and the journal still works — it proves *the agent
read X and then chose Y* rather than *the code changed this way*.

Two things follow:

- **Declare which anchor classes are available.** Preserve "unknown" rather than
  inferring optimistic defaults. A context that cannot produce a commit anchor must not
  render as though it checked and found none.
- **Renderers must degrade out loud.** A weaker claim presented in the same voice as a
  strong one is the failure this whole design exists to prevent.

## Without hooks

Where the harness exposes no hook system, nothing captures actions automatically, so
there is no evidence plane the agent did not author.

Record entries anyway — the reasoning is still worth keeping — but understand what
changed: anchoring now rests on the agent's own account of what it did. Prefer anchors
that are checkable after the fact regardless of who wrote them, such as a commit or a
file hash, over ones that are not, such as a tool call nobody else observed.

## Reading a journal that used several rungs

A long-lived workspace will contain entries from more than one. The coverage report is
where that becomes legible: it names sessions that recorded nothing, refused writes,
sequence gaps, and — importantly — returns `null` rather than an empty array for
anything it never assessed.

The distinction is not pedantry. `[]` means looked and found nothing. `null` means never
looked. Rendering the second as the first turns an unexamined gap into a clean bill of
health, which is the precise dishonesty the report exists to prevent.
