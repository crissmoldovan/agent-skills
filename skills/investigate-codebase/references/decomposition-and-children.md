# Decomposition axes and the child result contract

## Pick the axis on which children CAN disagree

A fan-out is only worth its overhead when the children could return different answers. Four
children pointed at the same files, given the same question, produce one reading billed four
times — and then agree with each other, which reads like corroboration and is not.

So choose the split by asking: *if these two children come back with different answers, what
would that difference tell me?* If the answer is "nothing, one of them read it wrong", the
axis is wrong.

| Axis | Split by | Use it when | The trap it avoids |
|---|---|---|---|
| **by-surface** | directory, package, deploy target, language | the question is "where does this happen" and the repo has real boundaries | one child skimming everything at equal shallowness |
| **by-symbol** | one **definition site** per child, never a bare name | the question is about a specific function, type, table, or route | name collisions merging unrelated code into one answer |
| **by-data-flow** | writers / readers / **derivers** | the question is about a value: who sets it, who consumes it, who computes something else from it | the derivation stage, which belongs to neither of the other two |
| **by-history** | commits, blame, reverts, the range where behaviour changed | the question is "when did this start" or "was this deliberate" | reading current code to answer a question about the past |
| **by-runtime-evidence** | logs, boot output, traces, schema dumps, live config | the question is "what actually happens", not "what does the code say" | a code reading passed off as an observation |

Two or three axes at once is normal at the deep band — by-surface for coverage plus
by-runtime-evidence for a check that no code reading can produce.

### by-symbol: always a definition site

A child briefed with a bare name searches for a string. In a monorepo of roughly 2,500
TypeScript files, one measured pass found **184 exported names defined in more than one
file**, and the worst offenders were the repo's own conventions — one HTTP handler name
appearing **271 times**, another 209, a registry key 143. Briefed with `POST`, a child
returns the whole application. Briefed with `path/to/module.ts:POST`, it returns the
callers of one thing.

So the brief names the file and the line, or resolves the name through a language server
first. If neither is possible, say the child is searching a name and downgrade every
finding built on it to `inferred`.

### by-data-flow: the third bucket is the one people forget

Writers and readers are the obvious two. The third — **derivers**, code that computes
something else from the value — is where questions go to die, because a deriver neither
sets the value nor reads it in the way a search for reads would find. In one measured case
the defect was in exactly that third stage: both the writer and the reader were correct,
and the value was transformed in between by code that a writers-and-readers split never
looked at.

Brief the derivers child explicitly: *find every place this value is used to compute
something that is then stored, cached, indexed, or sent.*

### by-runtime-evidence: forbid the code

The runtime child is only worth dispatching if it is **forbidden from reading source**. Its
whole value is that its evidence is a different class from everybody else's; a child that
quietly opens the file has produced a second code reading and a false independence signal.

State the prohibition in the brief, and state in the record what it was given instead —
boot output, a log query, a schema dump, a config listing.

## Read what the repo already derived, first

If the repository carries generated registries, an atlas, or a compiler-backed index — the
artifacts `derive-codebase-context` exists to build — read them and **open the file they
cite** before dispatching anything. That is one read against a fan-out. Two rules keep it
honest:

- A generated artifact is evidence of what the generator saw, not of what the runtime does.
  It sits at the "code reading" class, and it can be stale.
- Confirm by opening the cited file at the current revision. A registry entry pointing at a
  path that no longer exists is a finding, not a lookup failure.

## Brief the instance that was named

When the ask names an instance — this call site, this run id, this row, this file — the brief
carries **that** instance, and the child opens it before it looks at anything of the same
shape. A sibling instance answers a different question: the finding may be real, the evidence
may be sound, and it is still not about the line the asker pointed at. Generalise afterwards,
explicitly, and say which instance the finding came from.

Where the named instance cannot be found, that is the child's finding — `not_found` with its
control — not a licence to substitute the nearest thing with a similar name.

## The child brief

Give each child, and nothing else:

- **The question**, narrowed to its slice, in one sentence.
- **The instance it names**, verbatim, where the ask named one.
- **Its axis and its slice** — the paths, the definition site, the range, the artifact.
- **What is withheld and why.** The runtime child does not get source. The adversaries do
  not get each other's inputs. Withholding is the mechanism that makes agreement mean
  something; record it.
- **The result contract**, verbatim, below.
- **A stop condition** — hit budget, round, or "when you can name the control that fired".

Never paste the whole conversation, the parent's working notes, or another child's output.
Context packaging is `model-routing`'s subject; child visibility and lifecycle evidence are
`agent-lifecycle`'s. Neither is restated here.

## The result contract

```json
{
  "question": "the slice this child was asked",
  "findings": [
    {
      "claim": "one checkable statement",
      "evidence": "path/to/file.ts:120-133",
      "basis": "measured | inferred",
      "confidence": "basis x coverage, in words"
    }
  ],
  "searched": [
    { "query": "git grep -n \"registerJob(\" -- src worker", "tool": "git grep", "hits": 41 }
  ],
  "not_found": [
    {
      "target": "a runtime read of the generated registry",
      "control": "git grep -n \"atlas\" -- worker",
      "control_fired": true,
      "reach": "direct references only"
    }
  ],
  "blockers": ["deploy manifests are not readable from this checkout"]
}
```

Field rules:

- **`claim`** is one statement that could be false. "Looked at the router" is not a claim.
- **`evidence`** is `path:line` or a named artifact plus the query that produced it. A claim
  with no evidence field does not go in `findings`; it goes in prose, marked `inferred`.
- **`basis`** is `measured` when something was run, counted, or read at a cited line, and
  `inferred` for everything else — including plausible reasoning from strong priors.
- **`confidence`** is basis × coverage, in words. Never a percentage.
- **`searched`** holds queries **verbatim** with their hit counts. A paraphrased query
  cannot be re-run, and re-running is the point.
- **`reach`** says what the negative covers: `direct references only` where a name search
  returned nothing and no edge was walked, or `walked: <the hop>` naming what was followed. A
  negative with no `reach` field cannot carry a claim about reachability, and the reconciler
  treats it as the narrower statement.
- **`blockers`** is where a child says what it could not do. An empty `blockers` on a child
  that hit a permission wall is the most expensive kind of silence.

## THE CONTROL RULE

> A zero-hit search is admissible as **absent** only when a control fired. Otherwise it is
> recorded **inconclusive**.

A **control** is a deliberately positive variant of the same search, run the same way, that
returns hits. It proves the search apparatus was working — right tool, right paths, right
pattern dialect, right file types. Without it, "no hits" means one of two very different
things and you cannot tell which: the thing is absent, or the search never worked.

Worked failures, each measured at least once:

- **The word-boundary escape.** `git grep -E '\bhandler\b'` returns nothing, and it never
  could: POSIX ERE has no `\b`. Read as proof of absence, it is proof of a typo. Control:
  the same command with the boundaries removed returns hits — so the pattern dialect, not
  the codebase, was the problem.
- **The pathspec that excluded the answer.** `-- src/` on a repo whose worker lives in
  `services/`. Control: search for something certainly present, with the same pathspec. If
  the control also returns nothing, the pathspec is the finding.
- **The untracked file type.** `git grep` searches tracked files. Generated output, vendored
  code, and anything in `.gitignore` are invisible to it. Control: `git ls-files -- '*.sql'
  | wc -l` before concluding that no SQL mentions the table.
- **Case and the compound identifier.** `job_name` does not match `jobName`. Control: search
  the case-insensitive variant, and if it fires, the original search proved nothing.

Record the control **and whether it fired**, in `not_found[]`, every time. This is the
single highest-value mechanical rule in this family, and it costs one extra command.

## THE TRANSITIVE-NEGATIVE RULE

> A zero-hit direct-reference search proves the **direct hop** and nothing beyond it. A claim
> about reachability or flow requires at least one hop through what the surface **does**
> reference; until that walk happens the negative is recorded as **"direct references only"**.

A fired control upgrades a negative from *inconclusive* to *absent*. It says nothing about the
**reach** of the question that negative is being used to answer, and that is the second half
people skip. "No file imports this module" and "this module cannot be reached" are different
statements, and the second is the one that authorises a deletion.

The hop is cheap. Take the surface the search covered and follow what it references outward
one level — barrel files and re-exports, registry tables keyed by string, dynamic or glob
imports, dependency-injection containers, generated entrypoints, configuration that names a
module as text. Any of those reaches a target it never spells, so a search for the target's
name over the importing file returns zero forever.

Worked failure: a run concluded "there is no import path to this module" from a single
direct-name search with a control that fired, and recorded it as absence. The loader reached
the module through an index file that re-exported a whole directory; nothing in the chain
spelled the module's name until the last hop. Both statements were true — the search was clean
and the module ran in production every night.

Write the negative at the reach it has:

```json
{ "target": "an import of modules/report", "control": "git grep -n \"modules/\" -- src",
  "control_fired": true, "reach": "direct references only",
  "hops_walked": ["src/index.ts re-exports ./modules/*"] }
```

## Fan-out width and independence

| Band | Children | Rounds |
|---|---|---|
| light | none — local tools, one pass | 1 |
| normal | 2–4 on disjoint axes, plus a reconciler | 2 |
| deep | normal, plus the refuter and the coverage auditor | 3 |

Record, per confirmed claim, **which children could see one another's output**. Two children
that read the same file and agree have produced one reading, counted twice; two children on
different evidence classes that agree have corroborated. Only the second is worth writing
down as corroboration, and the record has to say which one happened.
