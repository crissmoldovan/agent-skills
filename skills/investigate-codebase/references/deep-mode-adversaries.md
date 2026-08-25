# Deep mode: two adversaries

At the deep band, and only there, the draft answer is attacked by **two** children with
**asymmetric inputs** and **opposite defaults**. One asks whether the claims are true. The
other asks whether the claims are all of it. They are separate jobs and a single reviewer
collapses them into one — usually into the first, because refuting a written claim is easier
than noticing a surface nobody looked at.

Never run either on a light-band question. An adversarial round over a four-hit lookup costs
more than the answer and produces a confident dispute about nothing; escalation is scored as
a failure in the suite this family is measured against, not as diligence.

## The refuter

| | |
|---|---|
| **Input** | The claims and their citations. Nothing else — not the reasoning, not the children's summaries, not the question's framing. |
| **Default verdict** | `REFUTED`. The claim is wrong until an artifact shows otherwise. |
| **Concession rule** | It may concede **only by naming the artifact it opened** and what that artifact showed. "Seems right" is not a concession; it is the default, restated. |
| **Output** | Per claim: `refuted` with the counter-evidence, or `conceded` naming the artifact, or `unresolved (needs X)`. |

The withheld reasoning is the mechanism. A reviewer given the argument evaluates the
argument; a reviewer given only the conclusion and the citation has to go and look.

## The coverage auditor

| | |
|---|---|
| **Input** | The question, and the manifests — the file listing, the package list, the route or job registries, the deploy targets. **Not the answer.** |
| **Default verdict** | `INCOMPLETE`. |
| **Concession rule** | It may only conclude "covered" after failing to name an uncovered surface. To claim incompleteness it **must name a specific surface and one probe** that would settle it. |
| **Output** | Named uncovered surfaces, each with the one command or observation that would cover it. |

Withholding the answer is what makes it useful. An auditor that has read the answer audits
the answer's own frame, which is the frame that produced the gap.

## Adjudication

- **Two rounds maximum.** Round one runs both adversaries; round two runs only the ones with
  live objections.
- **Evidence only.** An objection is resolved by opening the artifact, not by re-arguing. If
  neither side has an artifact, the row is `unresolved (needs X)` and X is named.
- **A conceded claim is recorded `conceded`, not `validated`.** A refuter that ran out of
  objections has not verified anything; it has failed to refute. The distinction matters to
  whoever reopens the question, and it is the difference between "we checked" and "nobody
  found a problem in twenty minutes".
- Uncovered surfaces the auditor names are either covered in round two or written into *what
  this run could not see*. They do not evaporate because the round budget ended.

## This is not a code review

One line, because it gets confused constantly: **this gate has no pull request, no pushed
branch, and no completed implementation.** It attacks an answer, not a diff. The review loop
over a real PR belongs to `request-blocks-review` and `blocks`; running the adversaries
instead of that loop reviews a claim about code that nobody has written yet.

## Degradation

A harness that cannot withhold parent context from children cannot run this design: both
adversaries would see the reasoning, the answer, and each other, which removes the asymmetry
that makes their verdicts mean different things.

In that case run **one** reviewer, keep the `REFUTED`-by-default posture, and **say in the
answer and in the record that the two-verdict design degraded to a single reviewer** — so
the coverage question is visibly unasked rather than silently assumed. The one thing not to
do is run two children with identical inputs and present their agreement as adversarial
confirmation.

## Worked round

```text
draft claim: the generated registry is authoritative at runtime  [worker/boot.ts:22]

refuter        → REFUTED by default; opened worker/boot.ts:22, which imports
                 jobs.generated.ts directly → conceded, naming the artifact.
                 Recorded: conceded (not validated).
coverage       → INCOMPLETE: the deploy pipeline's own manifests were never read.
auditor          Probe: list the manifest files in the deploy configuration and grep
                 them for the registry filename.
round 2        → probe unavailable from this checkout → row stands as
                 "unresolved (needs a deploy-configuration read)", carried into
                 what this run could not see.
```
