# The per-item file: contract, index and template

Optional. Carry these only when the brief alone would bury the evidence — see the
triggers in the skill. When you carry them, all of them follow this contract, and
the brief links each item to its file.

## The contract

One file per item, named `NN-kebab-title.md`, numbered in the order the brief uses.
Every file carries these headings, in this order, and nothing else:

| Line or heading, exactly as written | What goes in it |
|---|---|
| `# NN · [title]` | the item, as a reader would say it |
| `**Status:**` | one of: open · answer needed · fixed, verify · part fixed · changed, wrong direction |
| `**Owner:**` | the person who answers or acts, by name |
| `**Where:**` | the exact screen, file, endpoint or record |
| `## What was asked` | the original words, quoted, with who and when |
| `## What it looks like now` | the present state, measured — counts, quoted strings, a table if two things differ |
| `## What we found` | why it is like this; the cause, not the symptom |
| `## What needs to change, or be answered` | what to do, or the options if it is a decision |
| `## How to verify` | what a person checks to agree it is done, in steps they can follow |

The headings are the contract: the template below carries them verbatim, so a file
can be checked against this table line by line.

Two rules carry the weight:

- **Quote the request.** A paraphrase invites an argument about the paraphrase.
- **Measure "now".** If two environments differ, show both in one table; the
  difference is usually the finding.

## The index

Beside the files, one `README.md` or `TRACKER.md` with a row per item: number,
title, state, owner, link. It is the first thing a reader opens and the first thing
you update when an answer lands. Add a "where it stands" tally under the table —
how many fixed, open, waiting on a decision — so the state is legible without
counting rows.

## Template

```markdown
# 07 · [Item as a reader would say it]

**Status:** answer needed
**Owner:** [name] — [what they answer or do]
**Where:** [screen · file · record]

## What was asked

> **[Person], [date] [time]** ([where they were])
>
> "[their words, verbatim]"

## What it looks like now

[Measured. Counts, quoted strings. Where two environments differ:]

| | [Environment A] | [Environment B] |
|---|---|---|
| [the thing] | [value] | [value] |

## What we found

[The cause. Name the commit, the column, the function, the missing file — whatever
makes it true. Say what you could not check.]

## What needs to change, or be answered

[Either the change, or numbered options with the recommendation in bold, matching
the brief exactly. They must not drift apart.]

## How to verify

- [A step someone else can follow, with the number or string they should see.]
```

## Keeping the files and the brief in step

The brief's recommendation and the file's `## What needs to change, or be answered`
section are the same sentence.
When one moves, move the other in the same edit. A reader who finds them disagreeing
stops believing both.

When an answer arrives, update the file's **Status** and add the answer under
`## What needs to change, or be answered` with its date. The file becomes the record of what was
decided, which is what the next person reads.
