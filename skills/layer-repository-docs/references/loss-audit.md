# The loss audit

Every fact, rule and warning in a file you replace must have a new home or a stated reason for
being dropped.

This is the pass with the worst odds of being run, because everything it finds is *absent* from
the new draft, and absence does not read as an error. A rewritten file reads better than the one
it replaced — that is why it was rewritten — and the sentence that used to say "this is deferred,
and not to be chased" is simply not there any more. Nothing is misspelled. Nothing contradicts
anything. The rule is just gone, and the next session breaks it without ever having seen it.

Run it on every file the run replaces, before the drafts are handed over and while the old file
is still the version on the default branch.

## The method

1. **Fix the input before drafting.** The list of files being replaced is a prerequisite, not an
   afterthought. Assembled after the rewrite, it will quietly omit the file whose content you
   liked least.
2. **Read the old file at the baseline revision**, not from memory of having edited it, and not
   from the working tree where it may already be half-replaced.
3. **Split it into atomic facts and rules.** One claim, one instruction, one warning, one
   qualifier per row. "Never push, and never commit unless asked" is two rows, because a draft can
   easily keep one and lose the other. Splitting too finely costs a few minutes; splitting too
   coarsely is how a qualifier disappears inside a rule that was "kept".
4. **Give every row a verdict** from the five below, with the evidence for it.
5. **Report the weakened and lost rows individually**, to the person who owns the file. A total
   ("81 rows, 2 lost") hides exactly the rows the audit exists to surface.

## The five verdicts

| Verdict | What it means | What the row must carry |
|---|---|---|
| **kept** | Present in the new file, with the same force | The new file and section |
| **moved** | Present, in a different file | The new home, named |
| **dropped deliberately** | Deliberately not carried forward | The reason, in one sentence, and who it was shown to |
| **weakened** | Present, but narrower, softer, or missing a qualifier | Both wordings, side by side |
| **lost** | Not present anywhere, and not deliberate | The old wording, verbatim |

**`weakened` is the verdict people skip.** It is easier to mark a row `kept` because the topic
survived. The test is not whether the topic survived — it is whether the *same instruction* would
be followed by somebody reading only the new file.

## A worked pass

The pilot audited two replaced root files. They split into **81 facts and rules**: 36 kept, 22
moved, 9 dropped deliberately, 12 weakened, 2 lost outright.

The two lost rows were both procedural instructions to agent sessions — one telling a session to
prepare a change and hand back the command rather than run it, and one recording that a
particular past action had been a one-off authorisation rather than a standing permission. Both
were invisible in the new draft: nothing in it contradicted them, so no fact-check could have
found them.

The twelve weakenings cost more than the two losses. Four shapes recur:

- **A credentials rule narrowed.** The original applied to a broad class of action; the rewrite
  applied it to one action. Anybody reading only the rewrite would take the other actions as
  permitted.
- **A restriction on editing a class of records loosened without saying so.** The rewrite kept the
  topic and dropped the prohibition, which reads as permission.
- **A cross-repository convention tightened into a rule.** The rewrite stated as a requirement
  something that was a convention in one repository and does not exist in the other repository it
  governs. A weakening in one direction is a loss; a strengthening in the other is an invention,
  and the audit catches both because both are differences.
- **A standing qualifier dropped.** A class of gap was marked "deferred, later, and not to be
  chased". The rewrite kept the gap and dropped the qualifier, so an agent reading it does the
  helpful thing and chases the owner about something they had already decided to defer.

## What makes an audit worthless

- **Auditing the draft instead of the original.** Reading the new file and asking "is anything
  missing?" cannot work: you are asking the file to report its own omissions.
- **Doing it after the handover.** Once the replacement is merged, the audit's findings arrive as
  a second change against a file people have started trusting.
- **Counting instead of listing.** The number is not the product. The list of weakened and lost
  rows is the product.
- **Treating the drafting session's judgement as the reason.** "Dropped because it was
  out of date" is a claim that needs the same source check as anything else. If the reason is that
  a fact changed, cite the file that changed it.
- **Skipping files that were only "reorganised".** A file split into three is three replacements.
  Reorganisation is where qualifiers go missing, because each fragment looks complete.
