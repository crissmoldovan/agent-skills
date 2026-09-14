# The newcomer test

Someone who has not seen the repository follows the README, then the manual, and performs the
repository's main task in a clean clone. Every place they get stuck is a defect in the
documentation.

This is the only pass that finds the defects caused by what the documentation **does not say**.
A fact-check compares each written sentence against source and passes every sentence that is
true; it has no way to notice the required field nobody wrote down. In the pilot, three other
passes ran over the same draft and none of the three blockers below was found by any of them.

## The three blockers it found

All three are shapes rather than one-off bugs, but they come from one run in one repository.
Treat them as examples of what this pass finds, not as a list to go looking for.

- **A documented step that failed validation.** The manual's procedure for adding a record omitted
  a field the validator required. Every sentence in the procedure was true. Following all of them
  produced an error.
- **A lookup that silently returned nothing.** An identifier was looked up as the reader had typed
  it, while the index was keyed in lower case. No error, no warning, an empty result — and a
  newcomer with no way to tell a missing record from a mis-keyed query.
- **A worked example whose own subject could not follow it.** The task named a person as its
  example, and that person lacked the access its first step required. The procedure was correct
  and unusable by the reader it addressed.

A fourth finding from the same run is the reason the test must be run the way the documentation
will actually be used: a command documented as showing the reader something produced output only
when attached to a terminal, so inside a session that was not one it succeeded and printed
nothing — and the check could be "passed" without ever having run. A person and an agent session
are different environments, and a command that works in only one of them is a documentation
defect in the other.

## The protocol

1. **Pick the newcomer's role, and write it down.** Not "a developer" — a specific standing: the
   contractor with read access and no membership, the teammate whose account is invited but not
   yet a member, the person who has the tool installed but has never authenticated. The role
   decides which steps are even available to them, and a role chosen after the run is a role
   chosen to match the result.
2. **Take a clean clone, and a newcomer who is not the author.** A fresh checkout at the baseline
   revision with the drafted files copied in, in a directory carrying none of the drafting
   session's context, none of its caches and none of its uncommitted files. The clone is
   disposable and its remote is removed before the newcomer starts — `git remote remove origin`,
   because a clone whose origin is somebody's working copy is one `git push` away from writing into
   it. The child is given the clone path and the task, and no write-capable tool the task does not
   need; where the harness cannot withhold them, that is a degradation the report states. The reader must be a
   person, or a child session given only that path and the task — never the session that wrote the
   files, which cannot un-know what it left out. Drafting in the same tree makes every step pass.
3. **Where the repository is documents rather than code, the task is still a task.** Find the home
   of a named fact and prepare the change to it, stopping before anything is pushed. "Read the
   documentation" is not a task, and a repository with no build to run still has a main thing
   people come to it to do.
4. **Read only what the documentation routes you to**, in the order it routes you. Do not open a
   spec because you know it explains the thing. Being unable to find something is the finding.
5. **Do only what is safe.** No commit, no push, no pull request, no write to any third-party
   system, no container, nothing that spends money or notifies a person. Where a step would do one
   of those, stop at the boundary and record that you stopped there — a step that could not be
   attempted is a result, not a pass.
6. **Record every stop.** What the documentation said, what happened, and what you would have
   needed to know. Include the small ones: the missing example, the unexplained abbreviation, the
   "ask the owner" that does not say who the owner is.
7. **Fix, then re-run from the same clean state.** A fix verified in the tree where it was written
   is not verified. Re-clone.

## What counts as a blocker

- The step produced an error.
- The step succeeded and produced nothing, and the documentation implied it would produce
  something.
- The documentation did not say where to go next, and more than one next step existed.
- The documentation named a person, an authority or a document that could not be reached.
- The environment differed from what the documentation assumed and it did not say which
  environment it assumed — engine versions, an interactive terminal, an authenticated tool.

Everything else is a defect of a smaller size, and still goes in the list.

## Degradations, and how to report them

The test is worth running degraded. It is not worth **claiming** undegraded.

| What is missing | What the test still catches | What it no longer catches | Say in the report |
|---|---|---|---|
| A second clone | Routing, gaps, missing examples | Anything depending on a cached or uncommitted file | "Run in the working tree, not a clean clone." |
| The newcomer's real permissions | Everything the reader can read | Whether the reader could have performed the step at all | "Permissions not reproduced; the access steps were read, not run." |
| Access to a third-party system | Every local step | The half of the task that leaves the machine | "Stopped at the boundary; the remaining N steps were not attempted." |
| A human newcomer | Most of it | Whatever a person would have found confusing but an agent would not | "Run by an agent session." |
| A reader who had not already read the source | Routing, gaps, missing examples | Anything the reader supplies from memory of the code rather than from the documentation | "Run by a session that had already read the source." |
| Anything drafted — an `audit` | Whether the documentation as it stands routes a reader to the answer | Any defect a draft would have introduced | "Run against the documentation as it stands; nothing was drafted." |

A planned test that returned no results is not a run. Report it as not run, never as passed: in
the pilot's first round, the test was planned, produced nothing, and the draft carried on as
though the repository had been walked through — which is precisely how a document comes to claim
a check nobody performed.
