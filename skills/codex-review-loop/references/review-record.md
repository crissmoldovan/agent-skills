# The review record

One record per round. It is what lets a reader who saw none of the rounds tell which findings were
real, what was done about each, how each fix was proven to matter, and what it changed.

## Where it goes

On the pull request, as a comment or a section of its description. That is the one place a record
can name every commit it refers to without moving the head under review.

A repository that keeps records as files commits each one **after** the fixes it describes, never
together with them. A file cannot name the commit that adds it: that sha does not exist until the
file is committed, and writing it in afterwards changes the file and so the sha. Committed after the
fixes, the record names them, and the next round reviews it along with them. The last round's
record still goes on the pull request: a record committed after the last review would itself be a
head nobody reviewed.

## Taking the final review

A reviewer's log is not its review. Before the final review it prints the work it did on the way:
drafts, commands it ran, files it read — including old review records or logs it found in the
repository, which it may quote at length. The review is its final message, and it has to be taken
from a boundary nothing in the log can fake.

**Where the reviewer writes its final message to a file, use that file.** The Codex CLI's exec form
does — `codex exec review --base origin/main -o <file>` writes the final message, and only that,
to the file, while the log goes to standard output as usual. Observed: on a scratch repository whose
change contained a line reading exactly `codex`, the log held that marker line and the `-o` file
held the review alone, finding included. Remove the file before the round starts, so a file from an
earlier round can never stand in for this one.

**Where the reviewer only prints a log, cutting by a marker is a fallback with a known flaw.** With
the Codex CLI's log, every message opens with a line reading `codex`, and the final block is
everything after the last such line:

```bash
awk '/^codex$/{buf=""} {buf=buf $0 "\n"} END{printf "%s", buf}' "$REVIEW_LOGS/round-3.log" > "$REVIEW_LOGS/round-3.final.txt"
grep -c '^codex$' "$REVIEW_LOGS/round-3.log"   # how many blocks there were; all but the last are discarded
```

The flaw: a line that equals the marker inside quoted output — a file the review shows, a command's
output — restarts the cut there. The findings before it vanish, and what is left still looks like a
review. So count the markers, compare the cut block with the log by eye, and treat any cut that
starts inside quoted text as a failed extraction. An extraction that takes the first block, or
everything, fails the other way: it presents earlier rounds' findings as this one's.

Keep raw logs outside the repository. A log committed in round 2 is a file the reviewer can read and
quote in round 3.

## A failed round is not a clean round

A round counts only when two things are true: the reviewer exited zero, and its final review is
non-empty. A reviewer that crashed, timed out, hit a rate limit or was logged out leaves no final
review, or an empty one — and nothing reads exactly like a review that found nothing. Test both
before reading a single finding:

```bash
# The same log directory as the main recipe: absolute, and outside the tree under review.
: "${REVIEW_LOGS:?set REVIEW_LOGS to an absolute directory outside the repository}"
case "$REVIEW_LOGS" in /*) ;; *) echo "REFUSE: REVIEW_LOGS must be an absolute path"; exit 1;; esac
final="$REVIEW_LOGS/round-3.final.txt"
rm -f "$final"
codex exec review --base origin/main -o "$final" > "$REVIEW_LOGS/round-3.log" 2>&1 &
wait $! || echo "ROUND FAILED: the reviewer exited non-zero"
grep -q '[^[:space:]]' "$final" 2>/dev/null || echo "ROUND FAILED: no final review was written"
```

The skill's `review_round` does all of this, refuses a log directory inside the tree under review,
and removes the final review of a round that failed, so no later step can read one.

A failed round is recorded as failed, with the reason, and run again as a new round. It never stops
the loop. A round number is never reused: the review step refuses one that has run before, so a final
review or dispositions left by an earlier run can never be read against a later head.

## Another reviewer

For another reviewer, find the equivalent: an option that writes its final message to a file, a
machine-readable output mode, or, last, the marker its final message carries. Check whichever it is
on a log you have read by eye before trusting it, and record in each round how the final review was
taken.

## Fields

```text
Review round <n> — PR <number> — head <sha> against <base>
Reviewer: <exact command>; final review from <the -o file | a marker cut: <k> markers, checked by eye>

[<severity>] <title, as the reviewer wrote it>
  verified:    yes — <file>:<line>; <the input that reproduces it>
               | no — <the evidence that refutes it>
  disposition: fixed in <sha> | fixed (cheap) in <sha> | deferred: <reason>, tracked in <where>
               | rejected: see verified | duplicate of round <m> [<severity>] <title>
  armed:       <the check> failed with the fix broken by <mutation>; passed after a restore
               from a byte copy, checked with <cmp | grep for identifier>
  effect:      <numbers that moved, from -> to, by <command>> | none — <command> output identical

Tests:       <command> at <sha of the last fix commit> — <result>
Reproduce:   <command> at <sha of the last fix commit> — <result>
Corrections: <anything an earlier record got wrong, stated here>
Next:        round <n+1> on the pushed head
             | stop, defer and merge <sha this round reviewed>
             | stop, fix and confirm: one confirmation round on the pushed head
             | split proposed: <link>
```

Every finding in the final block appears, including the ones that were rejected. A record that lists
only the findings acted on hides the reviewer's error rate, which is the number the next reader needs
in order to know how far to trust the reviewer.

## Dispositions

- **fixed** — verified, fixed, armed, effect measured.
- **fixed (cheap)** — a lowest-severity finding fixed because fixing it cost less than recording it.
  It still gets its effect line. In the round that stops the loop, a cheap fix makes a new head, and
  that head merges only after one confirmation round has reviewed it; findings that confirmation
  round reports at the lowest severity are deferred, not fixed.
- **deferred** — verified and real, not fixed in this pull request. The reason is stated and the
  place it is tracked is named. **Only a lowest-severity finding can be deferred.** A finding above
  it is fixed or rejected with evidence. An owner who disputes its grade re-scores it explicitly,
  with the reason in the record — and until it is fixed, or re-scored and graded no higher by a
  later round's final review, it blocks the stop rule and the merge.
- **rejected** — the claim does not hold. The evidence is recorded: the line that shows it, and the
  input that behaves correctly. A rejection without evidence is a disagreement, not a disposition.
- **duplicate** — the same defect as an earlier finding, perhaps worded differently or graded
  differently. Name the earlier one and its state.

## The dispositions file

The merge step does not take the record's word for it; it reads the dispositions of the round it
merges from a file beside that round's final review, `round-<n>.dispositions` in the log directory,
written after the findings were read and verified. One line per graded finding of the final review:
the finding's first line exactly as the reviewer wrote it, less a leading `- `, then ` => `, then
its disposition.

```text
[P3] Log line misspells an arm label — src/report.py:41-41 => deferred: cosmetic, tracked in #212
[P3] Retry delay is not jittered — src/fetch.py:88-90 => rejected: jitter is applied in the caller, src/client.py:17
```

A finding with no line blocks the merge; so does a line with any disposition but `deferred` or
`rejected`, because a finding fixed in the stop round makes a new head, which merges only after its
own confirmation round. Each line is checked whole: it starts with the finding, a deferral names
both its reason and `tracked in <where>`, and a rejection carries its evidence. A bare
`deferred: cosmetic` or an empty `rejected:` blocks the merge as a missing line does. The review
step refuses a round number that has run before and pins the round only once its review succeeded,
so neither dispositions nor a final review from an earlier run stand in for this one.

A final review that grades no finding at all is not clean on its face. A clean Codex review is
plain prose — its overall verdict, with no grade and no fixed wording (seen in a Codex session's own
record of a clean review) — and so is a reviewer's error message, or a half-written reply. Only the
person who read it can tell them apart, so the merge step refuses such a round as failed unless the
file says so in a line of its own, `clean: <the reviewer's verdict, quoted>`.

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
