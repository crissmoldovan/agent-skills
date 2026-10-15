# Judging and metrics

Where the truth is not in a lookup table, a panel of model judges produces the key the arms are
scored against. This page covers how that panel is built so that it can see the failure that
matters most, how its results are reported, and how the numbers built on it are stated.

## The panel

- **Three judges from three vendors.** An item's verdict is the 2-of-3 majority; on a graded scale,
  the median. One vendor's blind spots are not another's, and a single judge's taste is not a key.
- **On the study's one account.** Every judge is called through the same research account as the
  arms, and so through the guard: a judge on its own vendor key spends outside the balance the guard
  reads. Data a judge may not receive is not in the study.
- **One frozen rubric**, the same for every judge, hashed in the freeze.
- **Blind to the arm.** Answers are labelled neutrally and, where a judge sees more than one, shown
  in an order shuffled per item, so that position and labels cannot lean on the verdict.
- **Own-vendor overlap named in the plan.** Where a judge shares a vendor with an arm, the plan says
  so, and the per-judge report below shows whether it favoured its own.

## Provenance: why a judge misses invention

The failure that matters most is invention: an answer given where the evidence cannot determine
it. A judge catches it only if it can tell what the evidence actually says from what a model added.

In many pipelines the evidence shown to a model is itself partly model-made — a summary an earlier
step wrote, attributes an earlier step guessed. Give the judge that same evidence, untagged, and an
answer built on a guessed field looks supported: the field is right there. The judge marks the
invention correct, and does it fluently. A judge given the same untagged evidence as the model
cannot detect invented evidence. That is not a weakness of a particular judge; the information it
would need is not on the page.

Two changes put it on the page:

- **Tag every field with where it came from.** The source, or written by a model, or guessed by a
  model.
- **Add a source-only reading.** Separately, the judge sees only the source and answers one question
  per field: can this be determined from the source alone, and if so, what is it?

```text
EVIDENCE — every line says where it came from
[source]          title: <...>
[source]          description: <...>
[model-written]   summary: <...>        written by an earlier pipeline step
[model-guessed]   <field>: <...>        inferred; the source does not state it

ANSWER UNDER REVIEW
<field>: <value>

SOURCE-ONLY READING
Using only the [source] lines: can <field> be determined?  yes / no / partly
If yes, what is it?
```

An answer counts as an invention when it gives a value and the source-only reading says the field
cannot be determined. The verdict on the tagged evidence then says whether the value was at least
consistent with what a model had written, which is a different and lesser question.

## Reporting each judge alone

Report the majority, and beside it every judge's own result on every bar. Then ask, for each bar:
would the verdict change if any one judge were removed? A verdict that flips without one judge
rests on that judge, and the report says so. Add the pairwise agreement between judges, and, for a
judge that shares a vendor with an arm, its verdicts on that arm against its verdicts on the others.

## Keying only where the arms differ

Judging every answer of every arm is the expensive part. Where two arms give the same answer to an
item, they get the same verdict, so the item cannot contribute to the difference between them.
Judging only the items where the arms' answers differ therefore gives the **difference** between
arms exactly — and gives no absolute rate at all. Report it that way: a difference, with absolute
rates marked not measured, unless the agreeing items are judged too.

The shortcut is exact only under conditions that are easy to break:

- "the same answer" must mean equal under the scorer's own comparison, field by field where the
  scorer scores fields;
- a verdict must depend only on the item and the answer — not on the arm's label, on the position
  of the answer, or on other answers shown in the same judge prompt (a pairwise judge breaks this);
- with more than two arms, an item is judged when any arm differs from any other.

Before relying on it, test it on a fixture. Use a deterministic stand-in judge — a function of the
item and the answer — so that the test checks the shortcut's own logic and not the judges' noise.
Score the fixture with every answer judged, then with the shortcut, and require every difference
between arms to be identical. Then break the shortcut — key on the arm label, or compare answers
before normalising them — and watch the test fail.

## Metrics

### Invention is a bar

Invention gets its own bar in the plan, with its own predicate: the items whose source leaves the
field undeterminable. Folded into accuracy it disappears, because a confident invention and an
honest error weigh the same there. Read the definition against real items before freezing it. A
"no" on a field that does not apply to the item — this tool is not waterproof, this document has no
signature — is an answer about applicability, not an invented value, and a definition that cannot
tell the two apart can flip a verdict.

An arm that abstains more often will look worse on coverage and better on invention. Report both,
side by side, so that neither number is read alone.

### Denominators match across arms

Every arm is scored on the same items. A timeout, a refusal or a malformed response is a failure in
the arm that produced it, scored as one. It is never an exclusion from that arm alone, which would
quietly remove an arm's hardest items from its own denominator. Where an item has to go — its
source vanished, its ground truth is disputed — it leaves every arm, and the report counts it.

### Every percentage carries its predicate

The same answers give very different rates over "all items", "items with an answer" and "items
whose source determines the answer". Write the predicate and the count beside every percentage:

```text
4.1% invention — of items whose source leaves the field undeterminable (n = 612, both arms)
```

A percentage without its predicate cannot be compared with anything, including the same study's
other percentages.

### Passing the bar is not being better

A non-inferiority bar answers one question: is the candidate safe to switch to? It does not say
which arm is better. Report, for every arm:

| | Bars | Quality (observed) | Harm | Cost per item | Cost at expected volume |
|---|---|---|---|---|---|
| A (control) | — | <with predicate> | <invention, consequential errors> | <amount> | <amount> |
| B | pass / fail per bar | <with predicate> | <...> | <amount> | <amount> |

Then write the recommendation in the terms of the question it answers: "B is safe to switch to
under the registered bars" and "B is the better arm on observed quality and harm" are different
claims, and only the evidence for each one supports it.
