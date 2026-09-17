# The brief: template and worked example

One brief per person or agent, whatever the asks are — questions, decisions,
clarifications, missing facts. Replace the bracketed parts; keep the order.

## Template

````markdown
# [N] things I need from you — [what this is about]

[One or two sentences: where the asks came from, what is already settled, and that
nothing else waits on this reader.]

**[X] are a yes/no** — if you agree with the recommendation, say yes and we build it.
**[Y] need you to choose, write, confirm a reading or explain something**, marked
**CHOOSE / WRITE / APPROVE OR EDIT / WHICH / EXPLAIN** below.

---

## The answer sheet — reply with just this

Copy these lines and answer in place. "Yes" means: do what we recommend.

```
Q1  [the ask, in eight words] ..................................... YES / NO
Q2  [the ask] ..................................................... YES / NO
    [the sub-question that comes with it] ......................... YES / NO
Q3  [the ask] ................. OPTION A / OPTION B / OPTION C
Q4  [the ask] ..................................................... WRITE: ............
Q5  [drafted wording, shown below] ................. APPROVED / EDIT: ............
Q6  we read [the thing] as [your reading] — correct? ... READING A / READING B
Q7  why is [the thing] done this way? ............................. WHY: ............
```

---

## The detail

Each item: what it looks like today, the options, our recommendation in **bold**,
and [the per-item file / where the evidence sits].

### Q1 · [title] — **YES/NO** *([item file numbers])*
[What a reader sees today, quoted and measured.]
[Whose request this answers, in their words.]
**We recommend:** [one sentence.]
[On silence: we do this / this one blocks.]

### Q3 · [title] — **CHOOSE** *([item file numbers])*
[Current state.]
1. [Option, and its consequence]
2. **[Recommended option, and its consequence]**
3. [Option, and its consequence]

### Q4 · [title] — **WRITE** *([item file numbers])*
[Current state, and exactly what is missing that only they hold.]
**Needed from you:** [the words, the number, or the name.]

### Q5 · [title] — **APPROVE OR EDIT** *([item file numbers])*
Today it reads: "[the current wording, quoted.]"
Proposed: "[your draft, in full — this is what they are approving.]"
[If it applies to more than one place, say how many and where.]

### Q6 · [title] — **WHICH** *([item file numbers])*
[The ambiguity, quoted: the phrase, field or figure that can be read two ways.]
1. **[Your reading, and what we would build on it]**
2. [The other reading, and what that would mean instead]
**We read it as 1.** Confirm, or point at the other.

### Q7 · [title] — **EXPLAIN** *([item file numbers])*
[What you found, measured, and the specific thing you cannot explain from it.]
**Needed from you:** one sentence — [the exact question.]

---

## Not for you, but worth raising

- **[Person]:** [the question, one sentence, and what it blocks.]
````

## Worked example

From a run where a client review left 38 notes on a live product. Five were fixed
before the brief, nine questions were answered from the data and withdrawn, and
sixteen decisions went to the person who owned the product's voice. Names, figures
and screens below are invented; the shape is what matters.

````markdown
# 16 decisions — [product] review

Two reviewers left 38 notes on production last week. Five are already fixed.
**Sixteen need your answer** — nothing else is waiting on you; the rest is either
being built or sits with the data team.

**Nine are a yes/no.** **Seven need you to choose or write something.**

## The answer sheet — reply with just this

```
D3  the reseller channel counts as ours, not a competitor ........... YES / NO  (or: competitor, labelled / toggle)
D5  order results by best rank, then score ......................... YES / NO  (or: score only)
D6  score bands: cut-offs ....... 70/55/35 / 75/55/35  and names .... WRITE: ............
D9  summary cards to keep visible by default ......... WRITE: ............
Q7  we read "active" as the active ingredient — correct? ... READING A / READING B
D16 ship the annotation fix ahead of the data refresh .............. YES / NO
```

## The detail

### D5 · Order of recommended items — **CHOOSE** *(07)*
They are alphabetical within each count today, so an item scoring 33.6 sits above
one scoring 64.2.
1. **Best rank first, then score**
2. Score alone
3. Number of new opportunities, then score
On silence: we build option 1.

### Q7 · "Active" in the card titles — **WHICH** *(26)*
A reviewer flagged the title "[care by concern and active]" as unclear.
1. **"Active" means the active ingredient — we would retitle to "…and active ingredient"**
2. "Active" means an active user segment — a different title entirely
**We read it as 1.** Confirm, or point at the other.

### D16 · Release — **YES/NO** *(02, 32)*
Production is held for a data refresh, so the two reviewers who asked for
box-level notes still cannot leave them. Two changes are ready and tested.
**We recommend:** ship those ahead of the data.
This one blocks: we will not push to production without a yes.

## Not for you, but worth raising

- **[Owner of the tracking feature]:** the page promised a first data sweep last
  Tuesday and nothing ran — there is no sweep job in the build at all. What do we
  tell the reviewers?
````

## Why the dot leaders

They are not decoration. A line with a visible right-hand slot gets answered in
place; a line without one gets answered in prose, or not at all.
