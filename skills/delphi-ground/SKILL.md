---
name: delphi-ground
description: "Build a verified-facts briefing before asking anyone — human or agent — to reason about an artefact, and refuse to certify one when too little can be checked. Use when a review, a fan-out or a persona exercise would otherwise run on invention."
license: MIT
compatibility: "Any repository or environment the agent can read. Every fact needs a checkable reference — a path and line, a command and its output, a URL, a commit — so the briefing's strength tracks what the environment exposes: rich in an established codebase with history, thin on a greenfield proposal. Thin is a supported outcome and the skill says so rather than padding. No index, no daemon, no network beyond what a cited source needs. Output is a markdown briefing plus a coverage line; nothing is changed and nothing is committed."
metadata: "group=workflow; lifecycle=review; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Write Grep Glob Bash
---

# Ground a review in verified facts

Ask an agent to imagine how a design would be used and it will produce the median answer
about that job title: fluent, specific-sounding, and untethered. Ask twelve agents and
you get twelve variations of the same invention, which reads like corroboration and is
not.

The fix is not better prompting. It is giving them **facts somebody checked**, so their
reasoning has something to be wrong about.

This skill produces that briefing. It also does the harder thing: **it refuses to certify
one when too little can be verified**, because a disciplined-looking review built on an
empty briefing is worse than no review — it wears the costume of evidence.

## Quickstart

Point it at what the reviewers will reason about:

```text
Use delphi-ground on the payments migration spec. The reviewers are going to
critique it, and I want them arguing with reality rather than inventing a company.
```

You get back a briefing with every fact carrying a reference, split into two parts that
must not be mixed:

```markdown
## Environment facts          ← shareable with every reviewer
- The retry queue is in-process and bounded at 256   `src/queue.ts:14`
- Node 22 is the floor; CI pins it                   `.github/workflows/ci.yml:31`
- Two prior incidents involved the same code path    `docs/incidents/2026-06.md`

## Findings so far            ← WITHHELD from independent reviewers
- The last review concluded the bound is too low
```

And a coverage line that is the whole point:

```text
Coverage: 14 facts, 14 with references. 3 claims dropped as unverifiable.
Briefing strength: adequate.
```

If it comes back **thin**, that is a result, not a failure. It means a fan-out would
produce confident fiction, and you should read the artefact yourself instead.

## When to Use

- Before a review, a persona exercise, or any fan-out where several agents reason about
  the same artefact.
- Before asking an agent to evaluate something outside its context — a proposal, a
  design, an incident.
- When you want a second round of review that does not simply agree with the first.
- When someone hands you a set of confident findings and you want to know whether the
  inputs were real.

Do not use it to gather requirements — it records what is true, not what is wanted. Do
not use it to summarise an artefact; the briefing is context *around* the thing, not a
précis *of* it. And do not use it to make a weak case look strong: its main job is
telling you when the facts are not there.

## Prerequisites

1. **A named artefact.** One spec, one change, one proposal, one incident. "Our
   architecture" is not one.
   **Complete when:** you can name it as a path, a URL, or an identifier.
2. **Read access to whatever would make a claim checkable** — the repository, the
   history, the tracker, the logs.
   **Complete when:** you have it, or you have recorded which sources you cannot reach.
   Absent is a normal answer and changes the strength verdict, not the procedure.
3. **A decision about who reads it.** A briefing shared with independent reviewers must
   not contain prior findings. See step 4.
   **Complete when:** you know whether this briefing is going to one reader or several.

## Procedure

### 1. Collect candidate facts

Sweep the artefact and its surroundings for things that are *true*, not things that are
*relevant*. Relevance is the reviewer's job.

Prefer, in this order: incidents that actually happened, behaviour visible in code,
recorded decisions, and configuration. What people believe about the system goes in only
as a belief, attributed.

**Complete when:** you have more candidates than you expect to keep.

### 2. Anchor every one, and drop what you cannot

Each fact carries a reference a reader could follow: `path:line`, a command and its
output, a commit, a URL, a ticket.

**A fact you cannot anchor gets dropped, not softened.** "The service is probably
rate-limited" is not a weaker fact than a cited one — it is a different kind of thing,
and mixing them is how a briefing quietly becomes fiction. If it matters and you cannot
check it, list it under what could not be verified, where a reviewer can see the shape of
the hole.

**Complete when:** every retained fact has a reference, and the dropped ones are counted.

### 3. Split environment facts from findings

Two sections, and the split is load-bearing:

- **Environment facts** — what is true about the world. Shareable with everyone.
- **Findings so far** — what previous rounds concluded. **Withheld** from anyone whose
  independence you intend to rely on.

This is not tidiness. Hand a reviewer the previous round's conclusion and they will
converge on it, and you will read that convergence as corroboration. It is the single
easiest way to manufacture false agreement, and it is easy to do by accident while trying
to be transparent about what is already known.

**Complete when:** a reader of the shareable half cannot infer what the last round
decided.

### 4. Date it and name what you could not reach

A briefing is true as of a moment. Stamp it, and list the sources you could not consult —
a tracker without access, a log already rotated, a person unavailable.

**Complete when:** a reader six months later can tell whether it has expired, and can see
what was never checked rather than assuming it was checked and clean.

### 5. Rate the strength, and be willing to refuse

Count what you have and say plainly what it supports:

| Strength | Means | Do this |
| --- | --- | --- |
| **Adequate** | Enough anchored facts that a reviewer can be concretely wrong | Proceed |
| **Thin** | Few facts, or few that bear on the artefact | Proceed only with the strength stated in every downstream prompt |
| **Insufficient** | Nothing checkable bears on the question | **Refuse.** Say so and stop |

The refusal is the skill's most valuable output and the one you will be most tempted to
skip. A greenfield proposal with no incident history and no code has nothing to brief
from — and a fan-out over it produces disciplined-looking output at full cost, where the
discipline is the harm, because unlabelled invention gets discounted and formatted
invention does not.

**Complete when:** the strength is stated, and if insufficient, nothing downstream runs.

## Verification

- **Every retained fact has a reference someone else could follow.** Spot-check three at
  random; if one does not resolve, the briefing is not ready.
- **The shareable half leaks no conclusions.** Read it as though you were the reviewer:
  can you tell what the last round decided?
- **The dropped facts are counted, not silently discarded.** A briefing that mentions no
  gaps has either had an unusually good day or has not looked.
- **The strength verdict matches the count.** Fourteen anchored facts is not "thin"; two
  is not "adequate".
- **It is dated.**

## Usage Examples

**Before a multi-reviewer fan-out:**

```text
Use delphi-ground on docs/specs/retention.md before I fan out reviewers. They must
argue with this system, not a hypothetical one. Withhold anything the last review
concluded — I want independent reads, not agreement.
```

**Checking whether someone else's findings rested on anything:**

```text
Use delphi-ground on the same artefact these findings came from, then tell me which
of them cite something checkable and which are assertions.
```

**Expecting a refusal, and wanting it:**

```text
Use delphi-ground on this greenfield proposal. If there is nothing verifiable to
brief from, say so and stop — I would rather read it myself than fund a fan-out
that invents a company.
```

## Pitfalls

- **Padding a thin briefing.** The temptation is to add plausible context so the
  downstream run has something to work with. That converts an honest "insufficient" into
  a confident fabrication with your name on it.
- **Sharing findings for transparency.** It feels open. It manufactures the agreement you
  will then cite as evidence.
- **Anchoring to the artefact under review.** A spec citing itself is not a fact about
  the world; it is the claim you asked reviewers to evaluate.
- **Treating an old briefing as current.** Facts expire. A reused briefing produces
  reviewers reasoning confidently about a system that has moved.
- **Letting beliefs in unattributed.** "The team thinks the bound is too low" is fine,
  attributed. Stated flatly it becomes a fact nobody checked.
- **Rating strength by fact count alone.** Twenty facts about the build system do not
  ground a review of the retention policy. Strength is about what bears on the question.

## Deeper reading

- [references/briefing-format.md](references/briefing-format.md) — the exact shape,
  the two-section split, and how strength is computed.
- [references/why-briefings-fail.md](references/why-briefings-fail.md) — the evidence
  behind the withholding rule, including a measured case where a shared briefing
  produced convergence that read as independent corroboration and was not.
