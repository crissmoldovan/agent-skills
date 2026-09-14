# The claim check

Two passes over the draft, run separately because they find different things. The first asks
whether each sentence is true. The second asks what the document is asserting about **itself** —
its status, its authority, and the reviews it implies were performed.

Both are needed. In the pilot the fact-check pass reported a draft as factually sound while that
same draft called the repository "piloted" and "checked" when nothing had landed, sent agent
sessions to an authority that did not exist, and declared conformance to a checklist the
repository was failing. Every individual fact in it was true.

## Pass one: every claim against source

**The measured reason to run it.** A first draft was enumerated claim by claim: **59 checkable
claims, of which 27 were correct, 6 wrong, 20 misleading, 3 at risk of going stale and 3
unverifiable.** Twenty-six of fifty-nine wrong or misleading, in a document whose structure was
sound. The errors were not careless; they were plausible. That is the failure mode of
documentation drafted by a model, and the only defence is enumeration.

**What counts as a checkable claim.** Any sentence naming a command, a flag, a path, a file, an
environment variable, a count, a version, a trigger, a behaviour, or an external citation. Do not
enumerate the prose that says what the repository is for — that is a judgement, and it belongs to
the owner.

**How to run it.**

1. Number every checkable claim in the draft. The number is the unit of work; a claim that is not
   numbered is a claim that will not be checked.
2. For each, name the file that is its home and read it **at the baseline revision**. Not the
   working tree, not another document, and never the README.
3. Record a verdict and the path that produced it.

**The five verdicts:**

| Verdict | Meaning |
|---|---|
| **correct** | The source says this |
| **wrong** | The source contradicts it |
| **misleading** | Literally true and read the wrong way — the largest category, and the one most easily argued away |
| **at risk of going stale** | True now, with nothing to keep it true: a count, a total, a status with no date |
| **unverifiable** | No source in reach. Says so in the draft, or comes out of it |

**Misleading is where the work is.** Twenty of the pilot's twenty-six problems were in this
category. Three recurring shapes:

- **True of the happy path only.** A branch documented as behaving one way, where the code exits
  earlier under conditions the reader will actually hit.
- **True but read as a guarantee.** A command described by what it does, which the reader takes as
  a promise it does nothing else.
- **True of one of the things named.** A statement covering two of the three things it appears to
  cover, where the third is the one the reader has.

Also check the citations. An external quotation is a claim like any other: open it, and quote it
exactly or not at all.

## Pass two: what the draft asserts about itself

Read the draft for status, authority and self-report. Five findings to look for, each of which
was real:

- **A proposal written as though adopted.** "Must" and "never", about a standard nobody has
  agreed to. One week later it reads as a rule somebody imposed without asking. State at the top
  who decides, that nothing is bound, and that "must" describes what the proposal *would* require
  if adopted.
- **A pointer to an authority that does not exist.** Sending readers, and agent sessions
  especially, to an organisation-wide handbook "for all rules" when no repository holds one. The
  reader concludes the rules exist and that finding them is their problem. Until it exists in a
  named repository, nothing links to it and no rules block claims it as its source.
- **A freshness stamp claiming a review nobody performed.** "Last reviewed" is worth less than
  nothing unless something defines who counts as a reviewer and how anyone would know the list of
  paths it covers is complete. It converts an unread document into an apparently checked one.
  Leave it out, or make it name the revision whose sources a person actually re-read.
- **A conformance claim made while failing the checklist.** A document that declares it meets the
  standard it introduces, while several items are unmet. State the unmet items in a table with
  where each one is, and say what the repository would be if it conformed.
- **A request overridden rather than put back to the requester.** The owner asked for a file in a
  particular place; the draft decided otherwise and did not say so. Where a draft departs from
  what was asked, it is a decision for the owner, with options and a recommendation — not a fait
  accompli discovered on review.

Two more that belong in this pass because nothing else catches them:

- **Proportion.** A draft that runs to several hundred lines to describe a standard for keeping
  documents short has refuted itself. Check the draft against its own thresholds.
- **A claim about another repository stated as fact.** Anything the run discovered elsewhere —
  especially a security finding — is reported with what was actually read, when, and by what
  means, and is that repository's work rather than this one's.

## Finishing honestly

Whatever the final edits are, they are the ones nobody re-checked. Say so. A draft that names the
one part of itself that had no independent pass is more trustworthy than one that reports a clean
run, because the reader knows where to look.

Report, at the end of the run:

- Each pass, what it covered, and the counts it produced.
- What was checked by running a command and what was checked by reading.
- Everything that could not be verified, marked unknown.
- Anything fixed after the last pass, marked as unchecked by that pass.

A draft that claims a test it did not run is worse than no draft: it spends the reader's
scepticism in the wrong place, and they stop looking.
