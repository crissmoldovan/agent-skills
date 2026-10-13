# Learner and comparisons

How to settle who is learning (B1), and how to build the comparison that carries an idea across
from their field (H5). `SKILL.md` holds the rules; this file holds the method and worked examples.

## Settling who is learning

Most of B1 is already in what the learner has written. Read for:

- **Their field.** The examples they reach for, the job title they give, the words they use without
  explaining them (*handover*, *reconciliation*, *pick list*, *rehearsal*).
- **What they have seen of code.** *I've never touched it* and *I can read Python but not this* are
  different learners. A word they use correctly (*API*, *deploy*, *branch*) is a word you may use.
- **What they need to be able to do.** Talk to the developers, approve a change, run the admin
  screens, explain the system to their own team, debug a simple problem on their own. The goal
  decides how deep level 1 goes.

When that leaves the profile unclear, ask **one question** before the first answer, and make it
easy to answer in a line:

> Before I start: what do you do, and how much code have you seen — none, a little, or some but
> not this?

Then keep the profile for the rest of the run. Adjust it from what they show, in both directions:
when they use a term correctly, stop explaining it; when a word you assumed visibly lost them,
explain it now and avoid assuming the next one.

Never ask them to rate themselves on a scale, and never ask a second question before the first
answer. A learner who wanted a lesson and got a questionnaire leaves.

## Building a comparison

A comparison is a loan from what they already understand. It is worth making only when the
mechanism matches, because the learner will reason from it afterwards, and everything they infer
from a mismatched comparison is wrong.

1. **Name the job.** Not what the thing *is*, but what it *does*: holds orders until someone is
   free to take them; checks who is asking before letting them in; keeps a ready copy so the answer
   is quick.
2. **Find who or what does that job in their work.** The ticket rail, the ward's handover sheet,
   the warehouse's goods-in desk, the accountant's month-end close.
3. **Test the mechanism.** Ask of both sides: what goes in, what comes out, who decides, what
   happens when it fails, and what happens when two things arrive at once. Two or three matching
   answers make a comparison; one is a mood.
4. **Write where it stops.** The sentence that starts *Unlike …* or *Where it stops matching:*.
   It names the inference they would otherwise draw wrongly (*unlike the ticket rail, a failed job
   can be retried automatically, so nobody has to notice it fell off*).
5. **Keep one family across a course.** Once a server is *the pass* and a database is *the
   reservations book*, every later lesson reuses them. A course that compares the database to
   three different things leaves the learner with three wrong models of it.

When their field has no honest match for a concept, use everyday life — the post office, a library,
a cloakroom ticket — and say so: *nothing in a kitchen does quite this, so think of a cloakroom.*
A forced match from their own field is worse than a plain one from everyone's.

## Worked comparisons

Examples of the method, not answers to copy. Each matches on mechanism; the last column is the
sentence that keeps it honest.

| Concept | Kitchen | Hospital ward | Warehouse | Where it stops |
| --- | --- | --- | --- | --- |
| Server answering a request | The pass: an order goes in, a plate comes out | The pharmacy hatch: a prescription in, the drug out | The goods-out desk: a pick list in, a parcel out | A server answers thousands at once in under a second, and forgets each asker unless something reminds it |
| Database | The reservations book | The patient record | The stock system | Many people write at once without overwriting each other, and a question about any of it is answered in moments |
| Cache | Sauces made before service | The ward's stock cupboard, refilled from pharmacy | The fast-pick shelf by the packing bench | A stale copy looks exactly like a fresh one, so each cache needs a rule for when to throw it away |
| Queue and background job | The ticket rail: orders wait in turn | The list of tasks handed over at shift change | The pick queue on the scanners | A job that fails can be retried automatically, and nobody has to be watching for it to start |
| Logging in, and permissions | The staff door, then which stations you may work | The ID badge, then which drugs you may give | The site pass, then which zones you may enter | Proving who you are and what you may do are separate checks, and the second runs on every single request |
| Migration | Changing the menu card's layout, in numbered revisions | A change to the record's form, signed off and versioned | Re-labelling the racking, aisle by aisle, in order | Each one runs exactly once, in order, and is never edited after it has run |
| Deploy | Changing the menu at the start of service | A new protocol going live on the ward | A new picking route going live on a shift | A deploy can usually be rolled back in minutes, and on most platforms the old version keeps serving until the new one is ready |
| Branch and pull request | Trying a new dish as a special before it joins the menu | A draft protocol, reviewed before it is adopted | A trial layout in one aisle before the whole site | The draft and the live version exist side by side, and joining them shows every line that changed |
| Environment variable, secret | The safe combination, kept off the recipe card | The controlled-drugs key, signed out, never written on the chart | The alarm code, held by the manager | A secret in code is copied everywhere the code goes, so it is kept outside the code entirely |

## Register

Plain sentences, mostly short. The learner's spelling and language (B2). Bold a word where it is
explained, not elsewhere. No *simply*, *just* or *obviously*: each tells a learner who did not find
it simple that the fault is theirs.
