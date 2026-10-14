# The review record

One record per round, committed with that round's fixes. It is what lets a reader who saw none of
the rounds tell which findings were real, what was done about each, how each fix was proven to
matter, and what it changed.

## Extracting the final block

A reviewer's log is not its review. Before the final review it prints the work it did on the way:
drafts, commands it ran, files it read — including old review records or logs it found in the
repository, which it may quote at length. The review is the last block.

With the Codex CLI, every message in the log opens with a line reading `codex`, so the final block
is everything after the last such line:

```bash
awk '/^codex$/{buf=""} {buf=buf $0 "\n"} END{printf "%s", buf}' round-3.log > round-3.final.txt
grep -c '^codex$' round-3.log   # how many blocks there were; all but the last are discarded
```

For another reviewer, find the equivalent: the marker its final message carries, or a
machine-readable output mode if it has one. Check the extraction on a log you have read by eye
before trusting it, and record in each round how many blocks were discarded. An extraction that
takes the first block, or everything, will one day present earlier rounds' findings as this one's.

Keep raw logs outside the repository. A log committed in round 2 is a file the reviewer can read and
quote in round 3.

## Fields

```text
Review round <n> — PR <number> — head <sha> against <base>
Reviewer: <exact command>; last block only (<k> earlier blocks discarded)

[<severity>] <title, as the reviewer wrote it>
  verified:    yes — <file>:<line>; <the input that reproduces it>
               | no — <the evidence that refutes it>
  disposition: fixed in <sha> | fixed (cheap) in <sha> | deferred: <reason>, tracked in <where>
               | rejected: see verified | duplicate of round <m> [<severity>] <title>
  armed:       <the check> failed with the fix broken by <mutation>; passed after a restore
               from a byte copy, checked with <cmp | grep for identifier>
  effect:      <numbers that moved, from -> to, by <command>> | none — <command> output identical

Tests:       <command> at <sha> — <result>
Reproduce:   <command> at <sha> — <result>
Corrections: <anything an earlier record got wrong, stated here>
Next:        round <n+1> on <sha> | stop: only lowest-severity findings | split proposed: <link>
```

Every finding in the final block appears, including the ones that were rejected. A record that lists
only the findings acted on hides the reviewer's error rate, which is the number the next reader needs
in order to know how far to trust the reviewer.

## Dispositions

- **fixed** — verified, fixed, armed, effect measured.
- **fixed (cheap)** — a lowest-severity finding fixed because fixing it cost less than recording it.
  It still gets its effect line.
- **deferred** — verified and real, not fixed in this pull request. The reason is stated and the
  place it is tracked is named. Above the lowest severity, deferral needs the owner's agreement.
- **rejected** — the claim does not hold. The evidence is recorded: the line that shows it, and the
  input that behaves correctly. A rejection without evidence is a disagreement, not a disposition.
- **duplicate** — the same defect as an earlier finding, perhaps worded differently or graded
  differently. Name the earlier one and its state.

## Measuring an effect

"Effect" means what the fix changed outside the code: a published number, an output a user sees, a
row written to a store. Where the pull request publishes numbers, measure it.

1. Run the reproduce script, or the command that produces the published output, on the commit
   before the fix. Keep its outputs.
2. Run it on the commit with the fix.
3. Diff the two. Every changed number goes in the effect line, from what to what.

"None" is a result of that diff, not a judgement about the fix. Write it with the command that
produced the identical outputs. Where nothing is published, the effect is the behaviour that changed:
name the test that now passes and what it asserts.

A finding whose fix moves a published number is also a correction to what was published. Record it
where the published numbers live as well — in the study's addendum or the report's corrections —
and not only in the review record.
