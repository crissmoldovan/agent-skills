---
name: describe-changes
description: "Document what a change actually did: analyse a commit, PR, or merge, classify it, and write short, medium, and detailed descriptions anchored to the diff."
license: MIT
compatibility: "Any version control history the agent can read — git locally, or a forge API. Diff access is required for the detailed register; without it the skill still produces the short and medium registers and says so rather than inventing detail. Output is markdown plus a JSON envelope, so it fits a changelog, a release note, a ledger row, or a ticket comment without change."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Grep Glob Bash
---

# Describe changes

Ask what a pull request did and you usually get its title back, reworded. The
title is the author's intent at the moment they opened it, which is frequently not
what the diff ended up doing. This skill produces a description that is checkable:
every claim in it points at a hunk.

It writes three registers of the same change — one line, one paragraph, one page —
so the consumer picks the length rather than truncating prose written for another
purpose. And it classifies, from a fixed set, so the descriptions sort.

It composes with two companions in the same pack: **`release-ledger`** orchestrates
a since-you-were-away ledger and consumes these descriptions as its entries, and
**`github-webhooks`** captures the merge events that feed it. Install either with
`npx skills add crissmoldovan/agent-skills`.

## When to Use

- A commit, pull request, merge, or release range needs a description for people
  who did not write it.
- A ledger, changelog, or release note needs a per-change entry with a
  classification.
- A ticket needs a resolution note that states what actually shipped.
- Someone asks "what changed between these two tags" and needs more than a
  commit list.

Do not use it to review a change — it describes what happened, it does not judge
whether it should have. Do not use it to write a commit message before the work
is done; it reads a completed diff. Do not use it as a summariser for a body of
text with no diff behind it; the entire value here is that claims are anchored,
and with nothing to anchor to you have a paraphrase.

## Prerequisites

1. **A named operation.** One commit, one pull request, one merge, or one range
   `A..B`. Ambiguity here produces a description of the wrong thing.
   **Complete when:** you can state the operation as an identifier a tool accepts.
2. **Read access to the diff.** `git show`, `git diff A..B`, or the forge's diff
   endpoint.
   **Complete when:** you have the diff, or have established that you cannot get
   it and will therefore write only the short and medium registers.
3. **The surrounding context, where it exists.** The pull request body, linked
   tickets or support requests, the reporter, the review outcome.
   **Complete when:** each of those is either in hand or recorded as absent.
   Absent is a normal answer.
4. **A decided output shape.** Single digest for the whole operation, or an
   itemized array plus a summary. Ask; do not choose silently.
   **Complete when:** the user has answered, or the caller passed the shape in.

## Procedure

1. **Gather the evidence, in this order.** Diff first — file list, then hunks,
   then the test changes. Then the pull request title and body. Then linked
   tickets and the reporter. Then the review and check outcomes. Reading the
   description before the diff anchors you to the author's framing, which is the
   thing you are here to check.
2. **Establish what the change is, mechanically.** Which files, how many lines,
   which subsystems, whether tests moved, whether a schema or an interface
   changed, whether anything was deleted. This paragraph of facts is the input to
   classification; do it before choosing a kind, not to justify one.
3. **Classify into exactly one kind** from `feature`, `bug_fix`, `improvement`,
   `security`, `ops`, `docs`, `breaking`. The rubric and its edge cases —
   a bug fix that adds a flag, a pure performance change, a revert, a dependency
   bump that fixes a vulnerability — are in
   [the classification guide](references/classification-guide.md). One kind. If
   two genuinely apply, that is a signal the operation should be itemized rather
   than digested.
4. **Write the three registers.**
   - **short** — one line, at most 140 characters, no markdown syntax beyond
     inline code, no trailing period needed. It answers "what changed" for
     someone scanning a list.
   - **medium** — one paragraph. What changed, who it affects, and what they will
     notice. No file paths, no function names; this register is for users.
   - **detail** — a full markdown page: what changed, why, and the specific
     evidence. File paths with line ranges, hunk citations, before/after
     fragments where a fragment is clearer than a sentence. This register is for
     someone who will open the code.
5. **Anchor every claim in the detail register.** A sentence that asserts
   behaviour must be followed by, or adjacent to, the reference that shows it. If
   you cannot point at the hunk, delete the sentence.
6. **Record relations, cited or omitted.** Ticket, request, reporter. A relation
   is included only when the evidence names it — a reference in the body, a
   linked issue, a trailer. Do not infer a reporter from an assignee, or a ticket
   from a branch name that resembles one, without saying that is what you did.
7. **Emit the agreed shape.** The JSON envelope in
   [the output contract](references/output-contract.md), single or array. Markdown
   lives inside the JSON string fields; the envelope itself is data.

### Honesty rules

These are not style preferences. Each one exists because the opposite behaviour
produces a description that reads well and is false.

- **Never claim a change does something the diff does not show.** "Improves
  performance" requires either a measurement in the change or a mechanical reason
  visible in the hunk. Otherwise write what the code now does and stop.
- **A revert says it is a revert**, names what it reverts, and does not describe
  the reverted change's benefits in the present tense.
- **A partial change is described as partial.** Scaffolding behind a disabled flag
  is not a shipped feature; say the flag is off.
- **Deletions are changes.** A removed endpoint, option, or column belongs in the
  description even when nothing was added.
- **Absent evidence is stated, not filled.** No reporter is `null`, not a guess
  and not an empty string that renders as a dangling label.
- **The title is evidence, not a conclusion.** When the diff contradicts it,
  describe the diff and note the discrepancy in the detail register.

## Usage Examples

```text
Describe this merge for a release ledger. Read the diff first, classify it from
the fixed kind set, and give me short, medium, and detailed registers with the
detail register citing file and line ranges. Return the single-digest JSON shape.
```

```text
Describe the range v2.3.0..v2.4.0. Ask me first whether I want one digest or an
itemized array — I think itemized, with a generic summary on top. Anything you
cannot anchor in a diff, leave out.
```

```text
This PR says it is a performance fix. Check that against the diff before you
classify it, and if the diff does not show a performance change, say so in the
detail register and classify what it actually is.
```

## Pitfalls

- **Describing the title.** The most common failure, and the hardest to see,
  because the output is fluent and plausible. Read the diff first, every time.
- **Merging two changes into one description.** A pull request that fixes a bug
  and refactors a module has two facts in it. One kind and one description will
  misrepresent one of them. Offer the itemized shape.
- **Detail that is a file list.** "Changed `router.ts`, `handler.ts`, and
  `types.ts`" is not detail; it is the diff's table of contents. Detail says what
  the change to each file does.
- **Line references that rot immediately.** Anchor to the *post-change* line
  numbers and pair them with the commit SHA, so the reference stays resolvable
  after the next merge.
- **A medium register full of identifiers.** It is the register users read.
  Function names there mean it was written for the wrong audience.
- **Claiming a security fix without evidence.** Only classify `security` when the
  change closes an actual exposure the diff shows, or an advisory names it.
  Calling routine hardening a security fix devalues the label the one time it
  matters.
- **Silent inference of relations.** A branch named `fix/1234` is not a citation.
  Either the evidence names the ticket or the relation is null.
- **Describing generated or vendored churn.** A lockfile update and a regenerated
  client are volume, not content. Say what the regeneration was for.
- **Losing the `breaking` signal in prose.** If callers must change, `breaking`
  is the kind and the first line of the detail register says what to change.

## Verification

- [ ] The diff was read before the pull request body or title.
- [ ] Exactly one kind was assigned, from the fixed set.
- [ ] The short register is at most 140 characters and readable on its own.
- [ ] The medium register names no file paths or function names.
- [ ] Every behavioural claim in the detail register has an adjacent reference.
- [ ] References carry a path, a post-change line range, and a commit SHA.
- [ ] Relations are cited or null; none were inferred without saying so.
- [ ] A revert, a partial change, or a disabled flag is described as such.
- [ ] The output shape matches what the user chose.
- [ ] The JSON envelope validates against the output contract.
- [ ] Nothing in the description asserts a benefit the diff does not demonstrate.

## Deeper reading

- [Output contract](references/output-contract.md): the JSON envelope, both
  shapes, field-by-field rules, and complete worked examples.
- [Classification guide](references/classification-guide.md): the seven kinds
  with their boundaries, a decision order that resolves overlaps, and the edge
  cases that get classified wrong most often.
