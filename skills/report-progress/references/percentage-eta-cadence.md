# A percentage, an ETA, and updates nobody has to ask for

A reader who is waiting on long work asks two questions the three sections do not answer on their
own: how far along is it, and when will it be finished, as a time they can plan around. Often
they ask a third thing too: to be told at a set interval without having to ask. This file is how
`report-progress` answers all three, in the optional **head line** its SKILL.md describes, and in
updates that arrive on a cadence.

The head line adds to the report and replaces nothing in it. The three sections (what is done,
what is running, what is next) are still owed, and outside a cadence, a report that nobody asked
for a percentage or an ETA carries none. This file names the skill's slots and hard lines by
their ids (B1, B2, B3, B5, B6, B7, H7 and H8); it declares none of its own, so a project adapts
all of this through the skill's `SKILL.md`.

## The head line

It sits directly under the report's first line, which still names the boundary, and above the
three sections. It is at most two lines: the percentage with its basis, then the ETA with its
basis.

```text
Progress NN%: D of N <unit> in <register>, counted HH:MM <zone> (done D · in flight F · to do T · blocked on a person B); ceiling without them CC%. Denominator N, unchanged since HH:MM (or: up from M at HH:MM, because <what found the new work>, which took the percentage from P% to NN%).
ETA, an estimate: A–B agent-hours for the whole goal; <the work the clock time covers>: about W wall-clock at the K agents running, done HH:MM–HH:MM <zone>, with its date when that is not today there, and the same range in each other reader's zone. Basis, in agent-minutes: F in flight at X–Y each, T to do at X–Y each, B blocked on a person at X–Y each once <what they wait on> arrives, R review rounds that find something at X–Y each, <what does not divide>. <Where the clock time leaves out work blocked on a person: the goal's own time is not measured until that person's answer has a time.> Not in it: <work outside the goal that a reader might count in it, if any>.
```

- **Keep the counts inside the percentage line.** A line that opens with "done", "in flight" or
  "next" reads as one of the three sections, to a reader skimming the report and to the optional
  gate, which matches section labels at the start of a line.
- **"In flight" here is the register's count of items started.** It is task metadata, and it
  never stands in for the running section. Those rows still come from lifecycle evidence alone
  (B7), with a literal state and a freshness each.

## The percentage, with its basis

- **Name the register you counted, and count it just before you write.** The register (B3) is
  the file or command that lists the work and each item's state. A percentage read from it ten
  minutes and two merges ago describes a moment that has passed.
- **One unit, and the rows add up.** Done, in flight, to do and blocked on a person sum to the
  denominator. A row in another unit cannot be added: one report put "2 workflows" in its
  in-flight row under a headline of "26 of 33 items", and nobody could make its rows come to 33.
- **Work blocked on a person counts in the denominator and never in the numerator.** Counting
  it as done flatters the number, and dropping it from the denominator hides it. State the
  ceiling the work can reach without that person, (N − B) / N, so the reader can see what only
  someone else can unlock.
- **When the denominator moves, say what moved it, and give both percentages.** "21, up from 18,
  because the review found three handlers with no tests; 72% before, 62% now." Without that
  line, work being found reads as a stall. When the basis itself changes (another unit, another
  register, or remaining fixes in place of items), give the old basis and the new one, and say
  that the two numbers do not compare. One report read "95% (31 of 33 items)"; after a context
  compaction the next read "about 60%", now counting remaining fixes, and nothing joined the two.
- **No register, no number.** With nothing that lists the work and each item's state (B3 unbound
  and no phase list), the line reads `Progress not measured: no register of the work` (H7). A
  percentage guessed from how the work feels is the invention the skill forbids.

## The ETA: agent-hours, then wall-clock, then a clock time

1. **Agent-hours.** The honest unit when work runs in parallel: the sum of what is left,
   itemised, so that the items add up to the headline.
2. **Wall-clock.** Agent-hours divided by the number of agents actually running now, not the
   number that could run. That number is the count of rows in the running section, which come
   from lifecycle evidence (B7). With no evidence there is no such count: divide by the agents
   dispatched and say so ("at the 2 agents dispatched, not observed running"), or give
   agent-hours alone. When the evidence shows no agent running, between waves of work or with all
   that is left waiting on a person, there is nothing to divide by: give agent-hours alone, and
   say that the wall-clock and the clock time are not measured, and why (H7). Work that has to go
   one step after another, such as a review, a fix and a re-review of one change, does not divide.
3. **A clock time, in each reader's zone (B2).** The only one of the three a reader can act on.
   Give it as a range, start to end.

Then:

- **It is an estimate, and it says so (H8).** Label it, and give its basis: the items, the time
  each was costed at, and the number of agents. Rule 5 of the skill forbids predicting a pending
  result, and an unlabelled ETA is one: a forecast written in the grammar of an observation.
  "Done 16:00–16:35 UTC" with no label is that forecast. "ETA, an estimate: … Basis: …" is a
  forecast presented as one.
- **The headline covers all the work up to the goal.** One report headlined "3–6 agent-hours"
  and said a few lines further down that three more passes were "another 4–8 agent-hours on
  top". The reader planned around the headline. Every item's known effort goes into the
  agent-hours, work that waits on a person included: when its answer comes is unknown, but what
  the work costs once it does is known. Only the clock time, and the wall-clock it is counted
  from, may leave out work that waits on a person, because that work cannot start before the
  answer. A clock time that leaves a part out says what it covers, and never reads as the goal's:
  the goal's own time is not measured (H7) until that person's timing is known, and the ETA says
  so. "Not in it" is for work outside the goal, never for a part of it.
- **Assume a review finds something.** Cost a fix round for each review still to come. An
  estimate that treats every review as coming back clean grows each time one does not.

## The clock, printed and never typed

Every clock time in the head line and the next section is pasted from what a command printed,
the zone label included. A label typed from memory is wrong for half of every year in a zone
that keeps summer time, and a template that spells one out goes wrong on the day the clocks
change. One such template had the wrong offset from the day it was written.

```bash
date -u '+%H:%M %Z'                             # now, in UTC
TZ="$READER_ZONE" date '+%H:%M %Z (UTC%z)'      # now, in a reader's zone (B2)
date -u -v+95M '+%a %d %b %H:%M %Z'             # 95 minutes from now: BSD and macOS date
date -u -d '+95 minutes' '+%a %d %b %H:%M %Z'   # 95 minutes from now: GNU date
# the same time ahead, in a reader's zone (B2): BSD and macOS date, then GNU date
TZ="$READER_ZONE" date -v+95M '+%a %d %b %H:%M %Z (UTC%z)'
TZ="$READER_ZONE" date -d '+95 minutes' '+%a %d %b %H:%M %Z (UTC%z)'
```

`READER_ZONE` is the IANA name of a zone bound as B2. Run one command for each end of the range
and each zone, and paste what they print. With B2 unbound, every time is in UTC. A time ahead is
printed with its date: keep the date wherever it is not today's in that zone, because a range
that runs past midnight, or a reader whose zone is already on the next day, reads as today
without it.

## A figure that was not measured

A figure that could not be measured this time is `null` in any record the run keeps, with the
reason it was skipped, and "not measured" in the report, with that reason (H7). Zero is a
measurement. Written for a figure nobody took, it reads as a result: "0 failing" from a suite
that never ran tells the reader the opposite of the truth.

## Updates that come without being asked

When a cadence runs (B1), such as every 20 minutes until a goal is met, set by the reader or bound
by the project, each tick is a point at which a report is owed. If the reader has to ask "eta?", the update was already late.

- **Tick strictly inside the harness's cap (B5).** A background command, a watcher or a timer
  usually has a limit on how long it may run. A tick timed to land exactly on that limit races
  the kill and is usually lost: two 15-minute ticks under a 30-minute cap deliver the first and
  drop the second. In one long run, 11 of 12 such armings delivered one tick each, and updates
  promised every 15 minutes came 30 to 44 minutes apart. Leave a margin of some seconds below
  the cap for the last tick, and test the timing at a small scale before trusting it. In that
  harness, two 10-second ticks under a 20-second cap delivered one, and two 9-second ticks
  delivered both. When the interval is as long as the cap or longer, no tick strictly inside the
  cap can reach it: chain wake-ups, each armed for the time left until the update or strictly
  inside the cap, whichever is shorter. A wake-up before the update is due re-arms the next one
  and writes nothing; the one that reaches the update's time writes it. For hourly updates under
  a 30-minute cap: wake-ups of 29 minutes, at 29 and 58 minutes past, write nothing; the third,
  armed for the 2 minutes left, writes the update on the hour. 30-minute updates under the same
  cap take a wake-up of 29 minutes, which writes nothing, and one for the 1 minute left, which
  writes the update.
- **Re-arm before you write.** When the tick's stream ends or expires, arm the next one before
  anything else, including the update it prompted. An expiry noticed in the middle of a long
  turn and left for later is how the ticks stop without anyone noticing. In the same run, after
  the ticks had stopped unnoticed, the reader asked for status 34 times, against 7 while they
  ran.
- **Write the standing order down where a compaction cannot take it (B6).** For example "updates
  every 20 minutes, armed, until the release is out", in the file the work is tracked in. An
  order that lives only in the conversation is lost when the context is compacted.
- **Give the next update's time in the next section.** Put it beside the next acts, not on a
  closing line of its own. A line that opens "Next update" reads as the next section, and a
  report whose only "next" is the time of the next update has not said what happens next.
- **The last update says the updates stop.** "Final update: the release is out; no more
  scheduled updates." If the goal changes instead, say whether the updates continue.

## A status question during a fan-out

Some harnesses relay a message the user sends while a fan-out of agents is running into every
running agent, as the user's own words. A "status?" sent then becomes each agent's newest
instruction: one such question stood down every agent of a fifteen-agent run. Two habits follow.
Send the updates on time, so nobody has to ask. And do not launch a fan-out from a turn that a
status question began, because that question then becomes the request every agent in it works
to.

## A report with a head line, on a cadence

```text
Scheduled update, 14:15 UTC (every 20 minutes until the migration is merged).
Progress 62%: 13 of 21 handlers in TRACKER.md, counted 14:14 UTC (done 13 · in flight 2 · to do 4 · blocked on a person 2); ceiling without that person 90%. Denominator 21, up from 18 at 13:40 UTC because the review found three handlers with no tests, which took the percentage from 72% to 62%.
ETA, an estimate: 4–5 agent-hours for the whole migration; the 19 handlers not blocked on a person: about 1h45m–2h20m wall-clock at the 2 agents running, done 16:00–16:35 UTC. Basis, in agent-minutes: 2 in flight at 15–20 each, 4 to do at 30–40 each, 2 blocked on a person at 30 each once their owner's answer arrives, 1 review round that finds something at 30–40, which does not divide. The whole migration's time is not measured until the time of that answer is known. Not in it: the deploy after the merge, which this goal does not include.

Done — verified here: 13 handlers marked done in TRACKER.md; `npm test` run in this checkout at 4e5f6a7, 640 passing, 0 failing.
Done — claimed, not verified: none this update.
Running: 2 children. child-3a1, state running, activity "porting the orders handler", last observed 30s ago; child-8c4, state running, activity "porting the refunds handler", last observed 50s ago (lifecycle projection).
Next: the review round over all 15 ported handlers, once child-3a1 and child-8c4 reach a terminal state; the 2 blocked handlers once their owner answers which error codes they keep. Next update 14:35 UTC.
Consequence: callers of the 13 ported handlers now get the new error format; the other 8 still return the old one.
```

The last update of the series ends its next section with "Final update: the migration is merged;
no more scheduled updates."
