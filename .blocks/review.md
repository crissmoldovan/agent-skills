# What to check when reviewing this repository

## Run the suite. The environment can.

`.blocks/post-clone.sh` has installed dependencies, so this works:

```
npm run verify
```

That is `npm test` (the `node --test` suites), then `verify-skills.mjs`, then the
agent-lifecycle package's own verify. It should finish green.

To run only the tests: `npm test`. To run one file:
`node --test test/blocks-review-corpus.test.mjs`.

**If post-clone reported a failure, say in your verdict that the tests were not
run and why.** A verdict that did not run them and does not mention it reads
exactly like one that did.

## Say what you dropped

Your platform drops inline comments below severity 7 before they reach the pull
request, and the summary then says "no new severity >=7 findings" whether you found
five sub-threshold things or none. From outside those two are identical: there is no
count, no list, no trace. Across four pull requests and roughly a dozen rounds on
these repositories, every finding we have ever received was a 7 or an 8 and not one
was below — which tells us either that nothing below exists, or that we have never
once been allowed to see it. We cannot tell which, and that is the problem.

**So put them in the summary comment instead.** The drop applies to inline comments;
prose in your summary is not filtered. One short line each: the severity you
assigned, the file, and what you saw. Do not open them as inline comments — those
will be discarded before anyone reads them.

If there genuinely were none, **say so explicitly** — "no sub-threshold
observations" — so that the absence is a statement you made rather than a silence we
have to interpret. An unfalsifiable all-clear is worth less than a small honest list.

This is not an invitation to pad the review. A sub-threshold observation is still
something you actually believe; if you would not have written it down at any
severity, it does not belong here either.

## What this repository is, and where it breaks

Most of it is executable logic rather than prose, and the failure mode that keeps
recurring is a **hand-maintained description of something that moved underneath
it**: a phrase list matching another system's wording, a check name standing in
for the commit it tested, a comment asserting an invariant nothing enforces.

`skills/blocks/scripts/blocks-review.mjs` is the cautionary example. It decided
whether a review had finished by matching two literal strings, was correct when
written, and silently stopped being correct when the bot rephrased its verdict —
costing a caller forty minutes of false pending and, on the next round, a clean
review reported as findings. `test/blocks-review-corpus.test.mjs` now holds 86
labelled comment bodies against it.

So when reviewing a change here, ask of any new pattern, list or phrase match:
**what turns red when the thing it describes changes?** If the answer is nothing,
that is worth raising even below the severity bar.

## Specific invariants

- `test/blocks-review-corpus.test.mjs` asserts two things exactly rather than as a
  floor: every observed comment body classifies correctly, and **nothing is ever
  wrongly reported `clean`**. A change that relaxes either is a finding, even if
  the overall score improves — a false `clean` is the only error that merges.
- `scripts/verify-skills.mjs` treats any `references/`, `scripts/` or `assets/`
  path named in a skill's prose as a promise that the skill carries that file, and
  caps `SKILL.md` bodies. Prose that names a file it does not ship fails the build.
