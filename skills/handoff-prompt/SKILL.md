---
name: handoff-prompt
description: "Write work that is going to another session, agent or person as one self-contained block they can copy without editing: the receiver's missing context restated rather than referenced, every claim carrying where it came from, scope and non-goals stated, and the fence chosen so nested code cannot break it. Symptoms: write this as a prompt I can paste, draft a brief for another agent, file this as a feature request against another repo, hand this to the team that owns X, put it in a code block so I can copy it, I'll pass this over. Commentary to the sender stays outside the block and the block stays whole. It does not do the work it describes and it does not open the issue or the pull request — to write into another repository use work-in-external-repo, and when you need an answer back rather than to hand work away, use request-answers."
license: MIT
compatibility: "Any harness whose output the sender can select and copy — a terminal, a chat surface, an IDE panel. Needs read access to whatever the claims are drawn from, because a handoff that cites nothing is the failure mode this exists to prevent. Output is one fenced markdown block plus a short covering note, so it fits a paste into another session, an issue body, or an email without editing."
metadata: "group=workflow; lifecycle=handoff; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Grep Glob Bash
---

# Handoff prompt

Work moves between sessions constantly — to an agent in another repository, to a
colleague who owns the component, to tomorrow's context window — and it moves as
prose written for whoever was in the room. The receiver opens with none of it: no
transcript, no file open, no memory of which of four options was chosen. What
reads as a complete instruction to the sender reads as a riddle to them.

Two failures do most of the damage, and they look nothing alike.

The first is **reference instead of restatement**: "apply the fix we discussed to
that component". Every noun in it resolves only in a conversation the receiver
cannot see. They ask, or they guess; guessing is worse and more common.

The second is **the unpasteable deliverable**: the handoff arrives interleaved
with commentary to the sender — *here's what I'd send, though you may want to
soften the second paragraph* — so there is no contiguous region to select. The
sender edits by hand, and edits are where scope quietly changes.

This skill fixes the shape. **The block is the deliverable.** Everything the
receiver needs is inside one fence; everything the sender needs to decide whether
to send it stays outside.

## When to Use

- The sender says any of: *write this as a prompt*, *draft a brief for another
  agent*, *file this against repo X*, *hand this to the team that owns Y*, *put it
  in a code block*, *I'll pass this on*.
- Work is being delegated to a session that will not share this one's context — a
  subagent in another repository, a second window, a scheduled run.
- A finding here becomes a request there: a bug in a dependency, a component gap
  in a shared library, an infrastructure change another team owns.
- A session is ending with work unfinished and the next one starts cold.

Do not use it when the receiver is the person already reading: they have the
context, and a fenced block is then ceremony that hides the answer. Do not use it
to write a document that lives in a repository — that is a file with a path, not a
prompt to paste. And do not use it to perform the work it describes: it produces
the ask, not the change.

## Prerequisites

1. **The receiver, named.** A repository, a team, a session, a person. "Another
   agent" is not a receiver; the maintainer of `acme/design-system` is.
   **Complete when:** the handoff can say who it is for in its first line.
2. **What the receiver already knows.** Everything else must be restated. Assume
   no shared transcript, no open file, no memory of this session's decisions.
   **Complete when:** the shared baseline is written down, even as "assume they
   know only the public README".
3. **The evidence behind every claim.** A path and line, a command and its output,
   a version, a measurement. A claim you cannot source is a claim the receiver
   cannot check.
   **Complete when:** each intended claim has its source, or is marked as the
   sender's judgement rather than a fact.
4. **The decision already made, or explicitly open.** A handoff that is secretly
   asking the receiver to choose wastes a round trip.
   **Complete when:** every choice is either settled in the text or listed as a
   question for the receiver.

## Procedure

1. **Name the receiver and the ask in the first two lines of the block.** Not a
   preamble about where this came from. The receiver decides in five seconds
   whether this is theirs.
   **Complete when:** line one says who and what, and nothing above it is needed
   to understand line two.

2. **Restate the context; do not reference it.** Replace every "the fix we
   discussed", "that file", "as above" and "the issue you mentioned" with the
   thing itself. Pronouns whose antecedent is in this session are the specific
   defect to hunt.
   **Complete when:** no sentence in the block depends on anything outside the
   block, and no deictic ("this", "that", "the one") points out of it.

3. **Anchor each claim where it came from.** `path:line`, a command with its
   output, a version number, a date. Where the claim is a judgement, say so in the
   same sentence — the receiver is entitled to disagree with judgement and not
   with a measurement.
   **Complete when:** a reader who trusts nothing can re-derive every factual
   claim from what the block gives them.

4. **State the scope and the non-goals.** What you are asking for, and what you
   are explicitly not asking for. Non-goals prevent the two expensive failures:
   the receiver doing far more than wanted, and the receiver refusing because the
   ask looked unbounded.
   **Complete when:** the block contains at least one sentence beginning "not
   asking for" or its equivalent.

5. **Strip what does not travel.** Machine-local absolute paths, session ids,
   scratch directories, temporary branch names, ticket numbers from a tracker the
   receiver cannot open — and anything secret. A token, a key, an internal
   hostname or a customer name must never cross a handoff.
   **Complete when:** every path is repository-relative or explained, and a scan
   for credentials, absolute home paths and internal identifiers comes back empty.

6. **Choose a fence longer than anything inside it.** Handoffs about code contain
   code, and code contains fences. Three backticks inside a three-backtick block
   truncates the paste, usually silently and usually at the worst place. Count the
   longest run of backticks in the content and use at least one more, or use a
   tilde fence.
   **Complete when:** the block's fence is strictly longer than the longest
   backtick run inside it, and pasting the whole block into a markdown renderer
   shows one block rather than several.

7. **Put the covering note outside, above, and short.** The sender needs to know
   what they are about to send and what you assumed. That is two or three
   sentences before the fence — never after it, because anything after the fence
   is routinely pasted along with it.
   **Complete when:** nothing below the closing fence is needed by either the
   sender or the receiver.

8. **Run the Verification checklist over the block before handing it over.**
   **Complete when:** every box is ticked, or the block is edited until they are.

## Usage Examples

```text
Write this up as a prompt I can paste into a session working on <other-repo>.
Restate whatever they need — they have none of this context — and anchor each
claim to a path and line so they can check it rather than take my word.
```

```text
Draft the feature request against the shared UI library. Say plainly what we
need and what we are NOT asking them to do, because last time the scope grew.
One block, nothing after it.
```

```text
I'm handing this to tomorrow's session. Write the brief: what is done with its
evidence, what is running, what the next act is and what it waits on. Assume the
reader knows nothing about today.
```

## What it looks like

Specimens, not prompts. The asks are above; these are what the block should and should not look like.

### A handoff that works

````text
For: the session working on acme/design-system.

Ask: add an `inline` variant to `ToolCall` and `ToolGroup`.

Context you do not have: a console in another repository renders twenty tool
rows per transcript. It currently patches your published package to get this —
`patches/@acme__ui@0.10.0.patch`, 9 hunks across
`dist/elements/tool-call.{js,d.ts}` and `tool-group.{js,d.ts}` — so the change
already exists and is exercised by a real consumer.

The shape, as patched:

```ts
variant?: "default" | "inline";
```

Why it matters to you rather than to us: the patch must be re-applied on every
release, and a version bump silently drops the treatment.

Not asking for: the transcript assembly, or anything that knows what an agent
is. That stays in the consumer.
````

Note the four-backtick outer fence: the content contains a three-backtick `ts`
block, and a three-backtick outer fence would have ended the paste at `variant?`.

### The same handoff, as it usually arrives

```text
Can you ask them to add the inline variant we talked about? It's the thing the
patch does. Should be quick — though check with me first about whether the
compact mode stuff goes in the same request, I'm not sure.
```

Four defects in three sentences. "The inline variant we talked about" and "the
thing the patch does" resolve only here. There is no repository named, so the
receiver does not know it is theirs. "Should be quick" is an estimate of someone
else's work from someone who will not do it. And the last clause asks the sender
a question inside the text meant for the receiver, so it cannot be sent at all.

## Pitfalls

- **The unresolvable pronoun.** "That component", "the fix", "as discussed". It
  reads as complete to the sender because the antecedent is in their head. This is
  the single most common defect and the easiest to grep for.
- **Commentary inside the fence.** *You might want to reword this* addressed to the
  sender, sitting in the middle of text addressed to the receiver. It gets sent.
- **The truncating fence.** Three backticks around content containing three
  backticks. The paste ends early, the receiver acts on half a brief, and nobody
  notices until the work comes back wrong.
- **Machine-local paths.** A path rooted in someone's home directory tells the
  receiver nothing and makes the sender look careless. Repository-relative or
  nothing. (This pack's own catalogue validator refuses such a path in any skill
  file — including, on the first run, in this skill's illustration of the rule.)
- **Secrets crossing a boundary.** A handoff is a copy-paste into an unknown
  destination — another agent's context, an issue tracker, a chat. Treat it as
  publication.
- **Estimating the receiver's effort.** "Should be quick" is not yours to say, and
  it reliably annoys the person who has to do it.
- **Asking the sender a question inside the receiver's text.** If a choice is
  genuinely open, put it in the covering note above the fence, or list it inside as
  an explicit question *to the receiver*.
- **Conclusions without provenance.** "X is broken" invites disagreement with no
  way to resolve it. "X returns 500 at `src/api/x.ts:42` when `id` is absent — see
  the test at `test/x.test.ts:18`" does not.

## Verification

- [ ] The first two lines name the receiver and the ask.
- [ ] No sentence depends on anything outside the block; no pronoun points out of it.
- [ ] Every factual claim carries its source; every judgement is labelled as one.
- [ ] Scope and at least one non-goal are stated.
- [ ] No machine-local absolute paths, session ids, scratch directories, or secrets.
- [ ] The outer fence is strictly longer than the longest backtick run inside it.
- [ ] The covering note is above the fence and nothing below it is load-bearing.
- [ ] Pasting the block alone, with no surrounding text, is a complete instruction.

The handoff is finished when the sender could send it without reading it, and the
receiver could act on it without replying.

See [`references/handoff-contract.md`](references/handoff-contract.md) for the
block's anatomy, the fence rules in full, and variants for a feature request, an
agent brief and a session handover.
