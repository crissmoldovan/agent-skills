---
name: layer-repository-docs
description: "Make a repository's documentation legible when an organisation has more repos than anyone can track: classify every document by kind, list the rot where one fact is stated twice and the two disagree, draft only the layers the tier needs from the repo's own source rather than its README, audit every replaced file for rules silently dropped, and put a newcomer through a clean clone before claiming any of it works. Symptoms: nobody can tell what this repo is for, write a manual for this repo, our READMEs all say something different, too many repos to keep track of, the docs disagree with the code, where is this rule supposed to live. It writes the documentation people read; it does not write the context files agents load — that is derive-codebase-context."
license: MIT
compatibility: "Any repository the agent can read, with git to record a baseline revision and read files at it rather than through a README. A second clean clone makes the newcomer test real; without one it degrades, and the skill says so. A forge CLI compares the README description line with the registered description; without one that check is reported as not run. Output is drafted files, a rot list, a loss audit and a verification report; nothing is committed."
metadata: "group=workflow; lifecycle=release; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Write Edit Grep Glob Bash
---

# Layer a repository's documentation

Documentation rarely fails by being absent. It fails by being present and wrong, which reads
exactly like being present and right. A repository with no README is a problem anybody can see
in a second. A repository whose README says the checks run on every push, while the workflow
file runs them on pull requests, on the default branch and on manual dispatch, hands every
newcomer a confident wrong answer, and it cost nothing to produce.

Multiply that across an estate. Once an organisation has more repositories than one person can
hold in their head, each one grows its own front door, its own session-continuation file, and
its own copy of the same standing rules written in different words. The copies drift, and a
rule that exists in four wordings is not a rule any more — it is four claims about a rule.

Documentation an agent drafts fails a third way, and it is the one to plan around: it is
fluent, it is plausible, and it invents. In the pilot this skill generalises, a first draft was
fact-checked claim by claim. Of 59 checkable claims, 26 were wrong or misleading. The structure
was sound; the detail was decoration. Every command, flag, path and citation had to be checked
against source, and a quarter of them moved.

Every number in this skill comes from that one run — one repository, one rewrite, one week.
Take the shapes as transferable and the proportions as not.

This skill is the shape the documentation takes, the order to build it in, and the four passes
that decide whether a draft is fit to hand over. The shape is the easy half.

## What makes a repository legible

Three things, and only the third is hard.

**Three layers, which are roles rather than required files.**

| Layer | Where it lives | The question it answers | Its reader |
|---|---|---|---|
| Quick start | `README.md`, at the root of every repository | What is this, is it for me, what is it not, and where do I go? | anyone arriving, with a minute |
| Manual | `docs/MANUAL.md`, or a root file named for what it is, once a repository outgrows its README | How do I get something done here, and what exactly is each command, credential and file? | people using or changing the repository |
| Handbook | one repository for the whole organisation; every other repository links to it and none copies it | How are repositories placed, named, documented and handed off, and how do people and agent sessions work in them? | anyone starting or maintaining a repository |

A repository nobody else runs or changes needs only the first. Do not scaffold a layer the
repository has no content for — Diátaxis, on its own four-way split: "It certainly does not
mean that you should create empty structures for tutorials/howto guides/reference/explanation
with nothing in them. Don't do that. It's horrible." The contents of each layer, and what is
banned from each, are in [layer contents](references/layer-contents.md).

**Other kinds of document beside the layers, because they age at different rates.** Records
(specs, decisions, research), runbooks, skills, working documents, agent files, sources and
generated files each have a home and an **edit rule** — how this kind of file is allowed to
change. A decision is superseded, never rewritten. A dated list is struck through and dated. A
generated file is never hand-edited at all. Mixing kinds in one file means the file has no edit
rule, and then nobody knows whether correcting it is a fix or a falsification. The kinds, their
homes and their edit rules are in [document kinds](references/document-kinds.md).

**One home per fact, which is the rule the other two rest on.** Each fact is maintained in
exactly one file. Every other mention links to that file rather than restating it. A volatile
fact — a count, a status, a version, a measurement — repeated anywhere else carries its date
and names its home. Without this rule the layers will not stay apart: the README grows a
command table, the manual grows a rationale essay, and both restate the deploy variables the
runbook owns. With it, a contradiction stops being an argument and becomes a bug with a known
owner. The fact-to-home table, and the short list of things that may be repeated, are in
[one home per fact](references/one-home-per-fact.md).

The artefact that ties them together is the **docs map**: one table in the manual listing every
document in the repository with its kind, its audience and its edit rule. It is the only
complete list of documents, and it is where the repository's tier is stated.

### What this skill does not own

| The job | Whose it is | What this skill does with it |
|---|---|---|
| The context files agents load, and the CI gates that stop them rotting | `derive-codebase-context` | Records the agent file as a kind in the docs map with its edit rule; writes none of its content, builds no generated artefact and arms no gate. |
| Answering one question about the code with re-runnable evidence | `investigate-codebase` | Delegates the fact-check to it and cites path and line, rather than re-deriving an answer in prose. |
| The record of why a decision was made | `decision-journal` | Names the record as a kind and links it; writes no entry of its own. |
| What a change that already landed actually did | `describe-changes` | Names it as the home of that fact; paraphrases no diff. |
| The note for one version, and the semver call | `release-notes` | Makes neither. A version is a fact whose home is the pinning file or the note. |
| Getting a credential into a secret store | `secure-credential-setup` | Never requests, prints or places one. A credential found in prose is reported by file and line, with the value unread. |
| Where a repository belongs and which policy it inherits | `workspace-governance` | Reads no manifest and no catalog. The handbook layer is a document, not a placement decision. |
| Reaching a repository that is not the current tree | `work-in-external-repo` | Assumes the checkout is already the right one, and already proved. |
| The shape of status output while this runs | `report-progress` | Produces the drafts and the verification report; leaves the reporting shape to it. |
| Landing the drafts and getting them reviewed | `land-complex-change`, `request-blocks-review` | Hands the drafts over. Opens no pull request and runs no review loop. |

Install the companions with `npx skills add crissmoldovan/agent-skills`.

## When to Use

- A repository has no README, or one so long that nobody reads past the first screen.
- Somebody asks for "a manual", "a how-to file at the root", or a handbook covering repositories
  in general, and it is not yet clear which of those is one document and which is three.
- Two documents in the same repository state the same fact and disagree, and nobody can say
  which one is supposed to be right.
- An organisation has accumulated more repositories than one person can track, each with its
  own front door in its own shape.
- A repository has collected several session-continuation or handoff files at its root, and it
  is no longer obvious which one a new session should read.
- Documentation is about to be handed to a newcomer, a contractor or a client, and nobody has
  read it end to end since the code changed under it.

Do not use it to answer a question about the code: that is `investigate-codebase`, and it is
better at it. Do not use it to write the files an agent loads — those belong to
`derive-codebase-context`, and this skill only records that they exist and who may edit them.
And do not use it on a document nobody reads: a document with no reader, or with dead content,
is deleted rather than restructured, because version control keeps the history.

## Prerequisites

1. **A baseline revision, recorded before anything is read for content.** Resolve the default
   branch to a sha and write it into the draft. Every claim is checked against the files at that
   revision, read directly, not against the working tree and never against the README — which is
   one of the claims under test.
   **Complete when:** the sha is written down, and at least one file has been read at it.
2. **The repository's own sources located.** The manifest that names the runnable commands, every
   workflow file, the usage header of each script the documentation mentions, the schemas that
   define its vocabularies, and the source files that read credentials by name. These are the
   homes. The documentation is the set of claims about them.
   **Complete when:** each has a path, and each one that does not exist is written down as
   absent rather than quietly skipped.
3. **The owner named, and the route to them.** Who merges a documentation change here, and how a
   reader reaches them using only facts already in the repository.
   **Complete when:** a name and a route exist — or the run records the owner as unknown, and
   the drafts contain no instruction to "ask the owner", which is an instruction to nobody.
4. **The scope stated as files.** Which documents this run may replace, and which it must leave
   untouched. Research and evidence records are normally not edited at all.
   **Complete when:** the list of files to be replaced is fixed, because that list is the input
   to the loss audit and it cannot be assembled afterwards.
5. **A clean clone, or a stated substitute.** The newcomer test needs a checkout carrying none of
   this session's context and none of its uncommitted files.
   **Complete when:** a second clone exists — or the run records that the test ran degraded, and
   says exactly what was missing from it.
6. **The publication boundary.** Whether the repository is public, private, or visible to a
   client, and what that forbids: a public repository names no path in a private one; a
   client-visible repository carries no internal link, no internal status and no internal name
   beyond a role.
   **Complete when:** the visibility is written down together with what it rules out.

## Procedure

1. **Inventory what exists, and classify every document by kind.** List every tracked
   documentation file, including the ones at the root that nobody planned: session prompts,
   handover notes, conversation records. Give each one a kind, an audience and an edit rule. Then
   choose the tier — the amount of structure this repository has earned — with one line of
   reasons, and state it in the docs map. The tier ladder and its triggers are in
   [document kinds](references/document-kinds.md).
   **Complete when:** every tracked documentation file has a kind, an audience and an edit rule,
   and the tier is chosen and justified in one line.

2. **Find the rot, and give every finding a file, a line and a home.** Rot takes six shapes, and
   all six are found by reading source and comparing, not by reading documentation and agreeing:
   the same fact stated in two places where the two disagree; a count or a status that has gone
   stale; a command, flag or path that does not exist; a misstated trigger, such as a claim that
   the checks run on every push where the workflow says otherwise; a fact restated outside the
   document that owns it; and a credential written into prose. Report a credential by its file
   and its line **without reading, printing or copying the value**. Whether to change it is the
   owner's decision, and it is frequently another repository's work.
   The pass itself, and the six shapes with what each costs, are in
   [one home per fact](references/one-home-per-fact.md).
   **Complete when:** every finding names its file, its line, the source that contradicts it, and
   which file should be its home.

3. **Draft only what the tier needs, and draft it from source.** Write the README to the quick
   start contract, the manual to the tasks-and-reference split if its trigger has fired, and
   nothing else. Every command, flag, path, environment variable, count and citation in the draft
   comes from the file that owns it at the baseline revision. Where the repository's registered
   description and the README's description line differ, say so and leave the registered one
   alone; changing it is the owner's.
   What each layer contains, in order, and what is banned from it, are in
   [layer contents](references/layer-contents.md).
   **Complete when:** each drafted file exists in full, and every claim in it can be traced to a
   path at the baseline revision.

4. **Audit the replaced files for loss.** Split each file you are replacing into its individual
   facts and rules, and give every one of them a verdict: kept, moved with its new home, dropped
   deliberately with the reason, weakened, or lost. This is the pass that finds what no
   fact-check can, because everything it finds is *absent* from the new draft and absence does
   not read as an error. In the pilot, two replaced files split into 81 facts and rules: 36 kept,
   22 moved, 9 dropped deliberately, 12 weakened, 2 lost outright. The weakenings cost more than
   the losses — a credentials rule narrowed, a cross-repository convention tightened into a rule
   the other repository does not have, and a standing instruction that told agents a class of gap
   was deferred and **not to be chased** quietly dropped, which turns into an agent chasing the
   owner about it a week later. The method is in [the loss audit](references/loss-audit.md).
   **Complete when:** every fact and rule in every replaced file carries one of the five
   verdicts, and the weakened and lost rows are shown to the owner rather than buried in a total.

5. **Run the newcomer test in a clean clone.** Someone who has not seen this repository follows
   the README, then the manual, and performs the repository's main task — in a fresh checkout,
   doing only what is safe, stopping short of any write to a third-party system. **The newcomer is
   never the session that drafted the files.** Dispatch a child given only the clean clone's path
   and the task, carrying none of this run's context; where the harness cannot withhold that
   context, the report says the test was run by the drafting session and is degraded. A newcomer
   who already knows the answer passes every step. Everywhere they get stuck is a defect in the
   documentation, not in the newcomer. In the pilot this found three blockers that the other three
   passes over the same draft did not: a documented step that failed validation because it omitted
   a field the validator required and the manual never mentioned; a lookup that silently returned
   nothing, because the index keys were lowercased and the manual did not say so; and a task whose
   own worked example named a person who did not have the access the first step required. Among its
   other findings was a check command that printed nothing at all when run in a non-interactive
   session rather than a terminal. The protocol, and what makes a run worthless, are in
   [the newcomer test](references/newcomer-test.md).
   **Complete when:** the main task was attempted end to end, every place the newcomer stopped is
   recorded as a defect, and each defect that was fixed has been re-run from the same clean state.

6. **Check every claim against source, then check the draft for overreach.** Two separate passes,
   because they find different things. The first enumerates the checkable claims and gives each a
   verdict against a path at the baseline revision. The second reads the draft for what it
   *asserts about itself*: a proposal written as though already adopted, a pointer to an authority
   that does not exist yet, a freshness stamp claiming a review nobody performed, a conformance
   statement made while the repository fails items of its own checklist. Both are in
   [the claim check](references/claim-check.md).
   **Complete when:** every checkable claim has a verdict, and no sentence in the draft claims a
   status, an authority, a review or a conformance that does not exist.

7. **Report what was verified and what was not, and stop.** A draft that claims a test it did not
   run is worse than no draft, because it spends the reader's scepticism in the wrong place and
   they stop looking. Hand back the tier and its reasons, the inventory, the rot list, the loss
   audit, the newcomer test's blockers, each check with the result it actually produced, the
   decisions the owner must make, and everything that could not be verified marked as unknown.
   **Complete when:** the report distinguishes what was run from what was inferred, names every
   unknown, and nothing has been committed.

## Usage Examples

```text
This repo has grown three files at the root that all claim to explain it and none of them
agree. Classify every document by kind first and show me the rot list — file, line, and which
file should own each fact — before you draft a single replacement.
```

```text
We have far more repositories than anyone can keep track of and every README is a different
shape. Write the quick start and the manual for this one from the workflow files and the
scripts' usage headers, not from the README, and tell me which claims in the current README
turned out to be wrong.
```

```text
Before I merge your documentation rewrite: split every file you are replacing into its facts
and rules and give each a verdict, then run the newcomer test in a clean clone and tell me
every place a newcomer would get stuck. I want the weakened rules listed individually.
```

## Pitfalls

- **The plausible detail.** An agent drafting documentation fills gaps with what a repository
  like this one would have: a flag that sounds right, a path that follows the convention, a
  citation that matches the claim. It costs the reader the ability to trust anything in the
  document, because there is no visible difference between the invented sentences and the true
  ones. Check every command, flag, path and citation against the file that owns it.
- **A proposal written as though it were adopted.** A draft that says "must" and "never" about a
  standard nobody has agreed to reads, one week later, as a rule that somebody imposed without
  asking. State at the top who decides, that nothing is bound yet, and that "must" describes what
  the proposal would require if adopted.
- **Pointing readers at an authority that does not exist.** Sending anyone — and agent sessions
  especially — to a handbook that has not been created yet produces a confident dead end: the
  reader concludes the rules exist and that they simply cannot find them. Until the handbook
  exists in a named repository, nothing links to it and no file claims it as its source.
- **Instructions for agent sessions mixed with instructions for people.** They are different
  rules with different reasons, and a file that addresses both contradicts itself the first time
  they diverge: "never enter a credential" is absolute for a session and wrong for the person who
  has to enter it. Keep the agent rules in the agent file and say, in the manual, when a linked
  procedure is written for a session so a person knows what they are opening.
- **A freshness stamp nobody earned.** "Last reviewed" is worth less than nothing unless
  something defines who counts as a reviewer and how they would know the list of paths is
  complete. An unearned stamp converts an unread document into an apparently checked one. Leave
  it out, or make it name the revision whose sources someone actually re-read.
- **A count in prose.** A test count, a repository count, a number of orgs: true on the day it is
  typed and quietly false afterwards. In the pilot, a documented test count had roughly doubled by
  the next time anyone measured, and nothing in the sentence signalled its age. Either give the
  count a date and name its home, or give the reader the command that re-measures it, or leave it
  out.
- **The empty structure.** Creating the manual, the runbook and the records directory for a
  repository that has one command and one reader produces scaffolding that is immediately stale
  and that nobody will ever fill. Let the tier decide, and let a document appear when its trigger
  fires.
- **Copying the organisation's rules into the repository instead of linking them.** A copied rule
  is a fork. It is exactly how the same standing instruction ends up in four repositories in four
  wordings, which is the failure the handbook layer exists to end. One home, everywhere else a
  link.
- **The check that would fail the repository's own recent work.** Before proposing any automated
  documentation check, run it against the last several merged pull requests. Two checks proposed
  in the pilot would each have blocked ordinary, correct changes. Start every check as a warning.

## Verification

- [ ] The baseline revision is recorded, and every claim was checked against files at it.
- [ ] Every tracked documentation file appears in the docs map with a kind, an audience and an
      edit rule, and the tier is stated with its reasons.
- [ ] Each rot finding names a file, a line, the source that contradicts it, and its proper home.
- [ ] No credential value was read, printed or copied; any credential found is reported by file
      and line only.
- [ ] Every fact and rule in every replaced file has one of the five loss-audit verdicts, and the
      weakened and lost rows are listed individually.
- [ ] The newcomer test ran in a clean clone, or the report says it was degraded and how.
- [ ] Every blocker the newcomer hit is recorded, and every fix was re-run from a clean state.
- [ ] Every checkable claim in the draft has a verdict against a path at the baseline revision.
- [ ] No drafted file claims a status, an authority, a review or a conformance that does not
      exist, and nothing links to a document that has not been created.
- [ ] No count, deploy-time variable name, endpoint or real personal address appears outside its
      home without a date and a link; examples use patterns and `example.com` addresses.
- [ ] Each proposed check was run against recent merged pull requests before being proposed as a
      failure.
- [ ] The report separates what was run from what was inferred, and nothing was committed.

The work is finished when a reader can tell, for every sentence in the draft, which file it came
from — and when everything the drafting could not verify is written down as unverified rather
than left to look like the rest.

## Deeper reading

- [Layer contents](references/layer-contents.md): what belongs in the quick start, the manual and
  the handbook, in order; what is banned from each; and the length thresholds, marked as opinion.
- [Document kinds](references/document-kinds.md): every kind beside the three layers with its
  home and edit rule, the edit-rule vocabulary, the tier ladder and the trigger that creates each
  document.
- [One home per fact](references/one-home-per-fact.md): the fact-to-home table, the short list of
  things that may be repeated, and how to run the pass that finds violations.
- [The loss audit](references/loss-audit.md): how to split a replaced file into facts and rules,
  the five verdicts, and what a weakened rule costs.
- [The newcomer test](references/newcomer-test.md): the protocol, what the newcomer is allowed to
  do, what counts as a blocker, and the shapes of defect only this pass finds.
- [The claim check](references/claim-check.md): enumerating checkable claims, the five verdicts a
  claim can take, and the overreach review that reads the draft for what it asserts about itself.
