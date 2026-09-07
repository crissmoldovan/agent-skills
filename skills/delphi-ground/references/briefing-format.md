# Briefing format

One markdown file. Two sections that must not be mixed, a list of what could not be
verified, and a coverage line.

## Shape

```markdown
# Verified context briefing — <artefact>

As of 2026-09-07. Ground your reasoning in this, not in an imagined environment.
If you need a fact that is not here, label your claim `constructed`.

## Environment facts

- The retry queue is in-process, bounded at 256 entries.   `src/queue.ts:14`
- Node 22 is the floor; CI pins it.                        `.github/workflows/ci.yml:31`
- Enforcement was enabled once and rolled back the same day, locking out every
  returning member.                                        `docs/incidents/2026-08-27.md`
- The pack ships to Claude Code, Codex and Cursor.         `README.md:41`

### Beliefs, attributed

- The maintainer believes the 256 bound is too low. Not measured.

### Could not verify

- Current production error rate — no log access from here.
- Whether the incident above has a linked ticket — tracker unreachable.

## Findings so far

WITHHELD from independent reviewers. Include only when the reader's independence
does not matter.

- The previous round concluded the bound should be dynamic.

---

Coverage: 14 facts, 14 with references. 3 claims dropped as unverifiable.
Briefing strength: adequate.
```

## The two-section split

**Environment facts** are shareable. They are about the world and do not encode anyone's
conclusion.

**Findings so far** are withheld whenever you intend to treat agreement among reviewers as
meaningful. Handing them the previous round's conclusion guarantees convergence on it,
and that convergence will look exactly like corroboration.

Include findings only when the reader is meant to build on prior work rather than
independently check it — a follow-up pass, a fix round, a summariser.

## Anchoring

Every retained fact carries something a reader could follow:

| Kind | Form |
| --- | --- |
| Code | `path:line` |
| Behaviour | The command, and its actual output |
| History | A commit, or a dated incident note |
| External | A URL, with the date it was read |
| Tracker | An issue or PR identifier |

**A fact without one is dropped, not softened.** The tempting middle path — keeping it in
hedged language — is what turns a briefing into fiction, because a hedged claim reads as
a weak fact rather than as a non-fact.

Where something matters and cannot be checked, it goes under **Could not verify**. That
section is not an apology; it shows the reviewer the shape of the hole, which is itself
information.

## Beliefs

Attribute them, always. "The team thinks X" is a legitimate entry. "X" is not, unless X
is checkable.

The distinction matters because reviewers will treat anything in the facts section as
ground truth, and an unattributed belief laundered into that section is indistinguishable
from a verified one.

## Strength

Computed from what bears on the question, not from raw count.

| Strength | Test |
| --- | --- |
| **Adequate** | A reviewer could be concretely, checkably wrong using this |
| **Thin** | Few anchored facts, or few that bear on the artefact. State the strength in every downstream prompt |
| **Insufficient** | Nothing checkable bears on the question. Refuse and stop |

Twenty facts about the build system do not ground a review of the retention policy.
Strength is about relevance and anchoring together.

## Staleness

Date every briefing. Reusing one is fine and often right; reusing one without checking
whether its facts still hold produces reviewers reasoning confidently about a system that
has moved.

A reused briefing gets its date checked, its anchors spot-checked, and its date updated —
or it gets rebuilt.

## What a briefing is not

- Not a summary of the artefact. The reviewer reads that themselves.
- Not a requirements list. It records what is true, not what is wanted.
- Not a case. If assembling it makes you want to argue a position, you have started
  writing findings.
