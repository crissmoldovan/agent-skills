# One home per fact

**The rule.** Each fact is maintained in exactly one file — its home. Every other mention links
to the home instead of restating it. A volatile fact — a count, a status, a version, a
measurement — that appears anywhere but its home carries its date and names its home.

This is the rule that makes the layers hold. Without it the README acquires a command table, the
manual acquires a rationale essay, the working list acquires deploy steps, and each of those
copies is correct on the day it is written. The layers are not a filing preference; they are the
shape that falls out of the rule once you apply it.

The measurable benefit is not tidiness. It is that a contradiction stops being an argument. When
two files disagree and one of them is the home, the other one is wrong, and fixing it takes a
minute. When neither is the home, fixing it takes a meeting.

## The fact-to-home table

| Fact | Its home |
|---|---|
| Flags and arguments | The script's own usage header |
| Deploy-time variable names, endpoints, domains, project identifiers, deploy step state | The runbook |
| Counts and measurements | The generated output, or the dated evidence record |
| Versions and pins | The pinning file, or the spec that defines the contract |
| Continuous-integration steps and triggers | The workflow file. The agent file maps its own checks to them rather than describing them |
| Layout | The spec that owns it; otherwise the manual's reference part |
| Rules | Organisation-wide: the handbook. Repository: the agent file for sessions, the manual for people. Domain: the spec |
| Step lists | The one task, runbook or skill that owns the operation |
| Dated status | The working list, or the runbook for anything deployed |
| Real personal addresses | Only the records that need them, never any other document |
| Credentials and passwords | Nowhere in documentation, at any tier, in any repository |

## What may be repeated without breaking the rule

Three things, and the list is deliberately this short:

- **The README's description sentence**, because its other copy is the repository's registered
  description on the forge, which is outside the repository entirely.
- **A script name with no flags**, because the name is stable and the flags are not.
- **A lifecycle word linked to the document that holds its dates** — `live`, `paused`, `retired`.
  One word carries almost no staleness; a date carries all of it.

Everything else is a link.

## The rot pass

The pass that finds violations. Run it against source, not against other documentation — the
whole point is that documentation is the claim under test.

For each kind of fact in the table above:

1. **Find the home and read it at the baseline revision.** The workflow file for the triggers.
   The manifest for the command names. The usage header for the flags. The source file that reads
   a credential by name.
2. **Search every documentation file for the same fact**, by value rather than by phrasing — grep
   for the command name, the variable name, the number.
3. **Compare, and record the disagreements** with file, line, the source that contradicts them,
   and which file should be the home.

Six shapes the findings take, with what each one costs:

- **The same fact in two places, disagreeing.** One document says a component is not deployed,
  another in the same repository says it is live. Whoever reads first is wrong, and there is no
  way to tell which one that was.
- **A count gone stale.** A test count that was right when it was typed and is now out by a factor
  of two. Nothing about the sentence signals its age.
- **A command, flag or path that does not exist.** Usually a plausible near-miss: the right verb
  with the wrong noun, or a flag that was renamed. This is the category an agent-written draft
  inflates the most.
- **A misstated trigger.** "The checks run on every push" where the workflow runs on pull
  requests, on the default branch and on manual dispatch. Costs a contributor a debugging session
  they should never have started.
- **A fact restated outside its home.** Deploy variable names in a working list, deploy state in
  two sections of the same file. Each copy is a future contradiction that has not happened yet.
- **A credential in prose.** Report the file and the line. **Do not read, print or copy the
  value.** Whether to change it is the owner's decision, and it is frequently another repository's
  work rather than this one's.

## Two traps in the pass itself

- **A stale fact and a wrong fact are different findings.** "17 tests" that is now 36 is stale;
  the fix is a date and a home, or the command that re-measures it. "runs on every push" was never
  true; the fix is a correction. Reporting them in one list makes the owner treat the corrections
  as maintenance.
- **A near-miss in the source is still a finding.** Where a source file's own comment disagrees
  with the code beside it — an option documented as choosing one of two things where the default
  list holds three — the documentation that copied the comment is not the only defect. Report
  both, and say which one is the home.
