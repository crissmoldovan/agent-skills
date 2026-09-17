# The brief: template and worked example

One brief per person. Replace the bracketed parts; keep the order.

## Template

````markdown
# [N] decisions — [what this is about]

[One or two sentences: where the requests came from, what is already settled, and
that nothing else waits on this reader.]

**[X] are a yes/no** — if you agree with the recommendation, say yes and we build it.
**[Y] need you to choose or write something**, marked **WRITE / CHOOSE** below.

---

## The answer sheet — reply with just this

Copy these lines and answer in place. "Yes" means: do what we recommend.

```
D1  [the decision, in eight words] ................................. YES / NO
D2  [the decision] ................................................. YES / NO
    [the sub-question that comes with it] ......................... YES / NO
D3  [the decision] ........... OPTION A / OPTION B / OPTION C
D4  [the decision] ................................................. WRITE: ............
D5  [drafted wording, shown below] ................. APPROVED / EDIT: ............
```

---

## The detail

Each item: what it looks like today, the options, our recommendation in **bold**,
and [the per-item file / where the evidence sits].

### D1 · [title] — **YES/NO** *([item file numbers])*
[What a reader sees today, quoted and measured.]
[Whose request this answers, in their words.]
**We recommend:** [one sentence.]
[On silence: we do this / this one blocks.]

### D3 · [title] — **CHOOSE** *([item file numbers])*
[Current state.]
1. [Option, and its consequence]
2. **[Recommended option, and its consequence]**
3. [Option, and its consequence]

### D4 · [title] — **WRITE** *([item file numbers])*
[Current state, and exactly what is missing that only they hold.]
**Needed from you:** [the words, the number, or the name.]

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
