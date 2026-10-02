# Versioning a product that has no API

The impact checklist in `release-notes` judges a library: an export removed, an argument made
required, a return shape changed. An app, a site, a dashboard, a report or a data feed has
readers rather than callers, and nothing in it is an export. Its number is still semver, and the
question is the same one in other words: **what does a reader rely on, and did it move?** This
file covers that judgement, the record it is made from, what to do with a tool that proposes the
level, and the numbers that are not an ordinary next release.

## The three levels, judged by what a reader relies on

What a reader relies on is what they see, use, quote or have built a habit around: a figure they
cite, a screen they go to, a file they download, a link they keep.

| level | means | for example |
|---|---|---|
| **patch** | a correction: nothing a reader relies on moves | a total that counted refunds twice now counts them once; an upload limit set below its documented size is raised to it; a link that never worked is taken out (see below) |
| **minor** | a new capability, with nothing removed or redefined | a new chart type; a table can now be exported; a saved filter |
| **major** | something a reader relied on is removed, reversed or redefined | a figure's definition changes (revenue is now net of returns); a screen is replaced by another; an item already delivered is taken back out |

A change no reader can reach (a refactor, a test, a build script, an internal document) moves
nothing a reader relies on, so it is at most a patch, and only if the project releases it at all.

**A removal is a patch only when the record says what was removed was false, broken or never
seen.** Taking something out reads as major, because someone may have relied on it. It is a patch
when the ledger entry (below) says, in its own words, that the thing was wrong, did not work, or
could never be reached, so that a reader and a judge can both see why. With no such words, it is a
major. An addition that only repairs a fault is a patch, not a minor: the capability was already
promised.

## Write the ledger first, as was and now

Before choosing a number, write one entry per change a reader can reach:

- **what** changed, named the way a reader would name it;
- **was**: what a reader had before;
- **now**: what they have after.

The number is read from these entries, not from commit subjects. Their words must be true first,
because the same words reach readers (a changelog, a what's-new panel, the note's Impact part) and
because a judge, if the project runs one, reads them. A change no reader could reach needs no
entry. One they could reach needs an entry even when it was never linked or never noticed, and the
entry says so: without those words, a removal reads as a major.

Where the ledger lives is the project's: a changelog source file, a table of changes the product
renders, a section of the release record. A project that keeps none writes it into the draft of
the note, and its was and now pairs become the Impact part.

## A bump judge is advice

Some projects run a tool that proposes the level: a script over commit messages, a phrase
classifier over the ledger, a conventional-commit analyser, a changeset bot, a model asked for an
opinion. `release-notes` takes it as the slot B4. Whatever it is, its verdict is a reading to
check, never a ruling.

1. Run it, and read the words it quotes for each change, not only the level it prints.
2. When it agrees with the impact analysis, it has added a check and nothing else.
3. When it disagrees, decide which of the two is wrong, and do exactly one of these:
   - **the number is wrong**: fix it everywhere it is stamped: the manifest, the release record,
     the note's heading, and any file named after the version;
   - **the judgement is wrong**: overrule it on the record, with a line in the release record or
     the note that says why the number is right, where review will see it.
4. Never reword the ledger to move the number (hard line H3). The ledger's words reach readers. A
   judge satisfied by changed words is now reading something untrue, and so is everyone after it.
   An entry that is untrue is another matter: correct it, even when the correction moves the
   number, and record what it said, what it says now and why, where review will see it. A
   correction makes the words true; a rewording only makes the judge agree.

A judge that warns and lets the release go on fits this. One that refuses by default turns advice
into a ruling nobody made, so make refusal something a person asks for. High confidence from a
judge that matches words is not proof: a phrase it has never seen falls through to its default,
which is often the least a change can be, or the most.

## When the person who rules the number departs from the analysis

A project may say who decides the version: a maintainer, a release manager, the person the release
is cut for. `release-notes` takes that person as the slot B5. When they name a number that departs
from what the impact analysis found, show them what it found, and the words a judge quoted if one
ran: a number named before the analysis existed may not survive reading it. If they keep their
number, that is their ruling, and it is the number stamped. The note still tells the truth,
because it records both readings (hard line H2):

- the level the impact analysis found, and the change it was found from;
- the number ruled, who ruled it, their words, and when;
- what the judge said, if one ran.

The Impact part then reads, for example: *"Released as a patch on the release manager's ruling.
The impact analysis reads it as a minor, because tables can now be exported."* A reader deciding
whether to adopt the version sees both. A mismatch shipped without these lines is the dishonest
note the skill warns about.

A ruling is that person's word, never the agent's own reading. Where the project binds nobody,
nobody rules: the impact analysis sets the number, and when it disagrees with the plan, the bump
changes or the release does.

## Pre-release numbers name the number they become

A pre-release such as `3.0.0-rc.1` sorts before `3.0.0` and names it. So:

- judge its level against the last full release, not against the previous pre-release;
- when a later pre-release on the same line brings a change of a higher level, the number before
  the suffix moves too: a breaking change after `2.4.0-rc.2` makes the next one `3.0.0-rc.1`, not
  `2.4.0-rc.3`;
- check that the project's version tools accept a suffix before stamping one, on this branch: one
  copy of a tool may accept a suffix that another copy refuses;
- when the project has not settled which line carries pre-release numbers, or who numbers it, ask
  before stamping a suffix.

## A renumbering restart is recorded once

A project that moves to semver from another scheme, or starts its numbering again, may release a
major lower than its last one. Record the restart once, in the release that makes it: the old
number, the new one, who ruled it and why. After that:

- the old numbers keep their place in the history, and are neither re-judged nor renamed;
- a judge treats a lower major as an error unless it finds that record;
- a judge's history starts at the restart, because numbers chosen under the old scheme are no
  evidence of what semver would have said.

## An in-sample back-test proves little

A judge can be back-tested: re-judge each past release and compare its verdict with the number
chosen by hand. Agreement there is weak evidence when the judge's rules were written from those
same releases, because it is reading its own answers back. Test it on what it has not seen:

- **leave one out**: for each release, switch off the rules that came from that release's own
  entries, and judge it again;
- **another source**: judge from commit subjects alone, without the ledger.

Report both results beside the in-sample one. One phrase-matching judge agreed with every
hand-chosen number in sample, and with three of seven when each release was left out in turn.
Re-run both after any change to the judge's rules. Where no other labelled history exists, say
so: a verdict on a new release is then a reading to check against the words it quoted, never a
ruling.
