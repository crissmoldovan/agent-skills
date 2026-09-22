# The handoff contract

The anatomy of the block, the fence rules in full, and three variants. The skill
body carries the procedure; this carries the detail that would otherwise sit in
an always-loaded instruction file.

## Anatomy

A handoff block has five parts, in this order. Only the first two are mandatory.

| Part | Content | Why it is where it is |
| --- | --- | --- |
| **Address** | Who this is for, in one line | The receiver decides in seconds whether it is theirs; a preamble spends that time |
| **Ask** | What is wanted, in one sentence | Everything after it is support; a reader who stops here still knows what to do |
| **Context they lack** | The facts restated, each anchored | The receiver's session is empty. Assume nothing carried |
| **Scope and non-goals** | What is and is not being asked | Prevents both over-delivery and refusal-for-vagueness |
| **Open questions** | Choices genuinely left to the receiver | Only if real. An empty section invites invention |

Anything that does not serve the receiver belongs above the fence, in the
covering note to the sender.

## Fence rules

A handoff about code contains code. Code contains fences. Get this wrong and the
paste truncates silently.

1. **Count the longest run of backticks anywhere in the content**, including
   inside prose and inline spans.
2. **Use at least one more.** Content with a three-backtick block needs a
   four-backtick fence; content with a four-backtick block needs five.
3. **Or use tildes.** `~~~~` never collides with backticks and is legal markdown.
   Prefer it when the content's fencing is unpredictable.
4. **Give the outer fence a language hint of `text`**, not the language of the
   content. The block is a prompt, not a program; `text` stops a renderer from
   syntax-colouring prose.
5. **Never nest a fence of equal length.** Renderers differ on which one closes,
   and the sender will not notice until the receiver acts on half a brief.

A one-line check before sending: paste the whole block into a markdown preview.
One block means the fence held. Two or more means it did not.

## Variant: a feature request against another repository

Add, after the ask:

- **Where the need came from** — the consumer, and what it currently does instead
  (a patch, a fork, a workaround) with a path.
- **The shape, if you have written it already.** A patch that exists is the most
  persuasive form of a request: the change, written, and exercised.
- **The cost of not doing it**, to *them* where possible — maintenance they will
  carry, consumers who will diverge — rather than to you.
- **What stays yours.** The line between the library's concern and the consumer's
  is the thing most likely to be argued about; draw it first.

Do not include: a deadline, an effort estimate, or a priority. None is the
requester's to set, and each reliably costs goodwill.

## Variant: a brief for an agent in another session

Add:

- **The repository and branch**, by remote and name, not by local path.
- **Where to start** — the entry point or the first file to read.
- **The definition of done**, as a check that can be run.
- **What not to touch**, especially anything the current session is mid-way
  through.

Agents comply with instructions more literally than people. An ambiguity a
colleague would resolve sensibly is an ambiguity an agent will resolve
surprisingly, so spend words on the boundaries rather than the goal.

## Variant: a handover to the next session

Add:

- **What is done, with evidence** — commands run and their results, not "the tests
  pass".
- **What is running**, with its state as last observed.
- **The next act**, and what it waits on.
- **What was tried and abandoned**, so the next session does not re-run it.

This overlaps `report-progress`, which owns the shape of a progress report. Use
that skill for the content of the three sections and this one for making the
result pasteable.

## Redaction

A handoff is a paste into a destination you do not control: another agent's
context, an issue tracker, a chat, an email. Treat it as publication.

Remove before sending: credentials of any kind, internal hostnames, customer or
client names, absolute paths under a home directory, session and run identifiers
from this harness, and ticket references the receiver cannot open. Replace a
removed fact with what the receiver actually needs — `<the deploy host>` rather
than the hostname, `a customer on the enterprise plan` rather than the name.

If a claim cannot survive redaction, it cannot go in the handoff. Say instead
what the receiver should ask for, and from whom.
