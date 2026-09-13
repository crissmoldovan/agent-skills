# release-notes-gate: should the matching layer be restructured?

- **Date:** 2026-09-13
- **Target:** `adapters/claude-code/release-notes-gate.sh`, shipped at v0.16.0 (`main` @ `e628379`).
- **Occasion:** branch `fix/gate-quoted-strings` @ `61b8677`, held twice by review, six items outstanding.
- **Question:** replace the four per-branch regexes with one shell tokenizer that marks
  command position, or keep patching?
- **Recommendation: PATCH — plus one structural guard that is not a tokenizer.**
- **Status:** recommendation only. No change to the gate is proposed here as applied; the
  work list below is unimplemented.

Every number in this note was measured on the machine that produced it, not estimated.
Where a measurement contradicted something I had already written down, the note says so.

## The premise, checked

The brief that prompted this says: *every defect this file has produced came from reading
shell text as CHARACTERS rather than as structure.* That is the argument for a tokenizer,
so it is the first thing worth checking rather than accepting.

It is true of most of them, and **false of two**:

| # | Defect | Character-vs-structure? | A tokenizer prevents it? |
|---|---|---|---|
| 1 | `changeset publish` unanchored — naming it denied | yes | **yes** (verified) |
| 2 | `foreign_repo_flag` ran `git config` in the hook's cwd | **no** — wrong directory | no |
| 3 | bump detector matched `^\+[[:space:]]*"version":` on diff TEXT | **no** — not shell text at all | no |
| 4 | a release verb below line 1 was never seen | yes | yes (weakly — see below) |
| 5 | a verb inside a quoted string denied after `;`/`\|`/`&`/`(` | yes | **yes** (verified) |
| 6a | `(gh\|glab) release create` still unanchored | yes | **yes** (structurally) |
| 6b | branch 2 matches, then `exit 0`s before the bump check | **no** — control flow | for this instance only |
| 6c | a byte offset applied as a character substring | yes (offset arithmetic substitutes for structure) | **yes** (structurally) |
| 6d | the new quote pass is O(n²) | **no** — implementation | **no** (measured — see below) |
| 6e | the tag extractor reads a version out of quoted prose | yes | **yes** (verified) |

**Six of ten.** That is well past the "two of six is not worth a rewrite" bar the brief sets,
and on this axis alone the tokenizer earns its hearing. Defects 1, 5, 6a and 6e are
*literally the same bug found four times*: a regex over raw text mistook argument text for
command structure. That is the structural signal.

Defect 4 is marked weak because a tokenizer does not *force* whole-input scanning; it merely
makes it natural. The prototype below still fails the line-continuation case unless the
existing normalisation pass is kept in front of it — which means a tokenizer does not
*replace* that layer, it sits on top of it. Two layers, not one.

## What the six outstanding items actually do

Reproduced against both the shipped gate and the fix branch, each with a control that
isolates the cause. Fixture: `@acme/app@9.9.9`, changelog mentioning only `1.0.0`.

| probe | expected | shipped | fix branch |
|---|---|---|---|
| prose naming a version: `echo "then run gh release create v9.9.9 to ship"` | allow | **deny** | **deny** |
| a staged, unnoted bump whose message says `gh release create` | deny | **allow** | **allow** |
| …the same commit without those words *(control)* | deny | deny | deny |
| `git tag v1.0.0 -m "supersedes the old git tag v9.9.9 line"` | allow | **deny** | **deny** |
| `git tag v9.9.9 -m "replaces git tag v1.0.0"` | deny | **allow** | **allow** |
| `gh release create v1.0.0 --notes "supersedes gh release create v9.9.9"` | allow | **deny** | **deny** |
| 40 multibyte chars, then a real publish, then a trailing `cd` — under `LC_ALL=C` | deny | **allow** | deny |
| …the same, under `LC_ALL=en_US.UTF-8` | deny | **allow** | **allow** |
| …the same shape in ASCII *(control)* | deny | **allow** | deny |

Three things this table settles that were previously assertions:

1. **Two of the six are live in the SHIPPED gate**, not just on the fix branch. The
   unanchored `release create` denies ordinary prose today, and the greedy extractors
   mis-read a tag today.
2. **Two are fail-OPEN, not fail-closed.** `git tag v9.9.9 -m "replaces git tag v1.0.0"`
   cuts an unnoted release and is allowed, because the greedy extractor reads the *last*
   version on the line. The guard is not merely noisy here; it is absent.
3. **The locale claim is exact.** Fix (a) works under `LC_ALL=C` and silently reverts under
   `en_US.UTF-8` — the ASCII control denies under both, so the multibyte input is the cause
   and nothing else is. `grep -b` reports bytes; bash's `${x:0:n}` counts characters.

Note the second row against the third: the *only* difference is four words inside a commit
message. A commit that says what it is doing is denied a check that the identical silent
commit receives.

## Cost: measured, and it does not decide the question

Median wall time, `bash` spawn to exit, fixture repo, warm. `floor` is `#!/usr/bin/env bash
… exit 0` — the unavoidable spawn.

| case | floor | shipped | fix branch |
|---|---|---|---|
| no verb (`git status --short`) | 1.7ms | 20.6ms | 23.5ms |
| ordinary commit | 1.8ms | 44.0ms | 47.5ms |
| a real publish | 1.5ms | 29.0ms | 32.5ms |
| 128KB single line | 1.6ms | 60.1ms | **1028.0ms** |
| 2000 lines (~125KB) | 3.8ms | 66.5ms | **1367.7ms** |

The everyday cost is higher than the brief's "~18ms": **20.6ms with no verb at all, and
44ms for an ordinary commit**, on every Bash tool call. The dominant term is process spawns,
not string scanning — one `printf | grep -Eq` pair costs 3.0ms, six of them 8.9ms, one `jq`
4.9ms. That is the real budget conversation, and it is independent of this decision.

### The measurement that killed the tokenizer's best argument

I wrote a ~70-line POSIX-awk tokenizer and benchmarked it at **2.70ms on 128KB** — five
times cheaper than the O(n²) quote pass it would replace. That number was **wrong**. The awk
program had a syntax error on line 27; every run exited non-zero having done nothing, and the
harness timed awk *failing fast*.

Fixed so it actually runs, the same tokenizer costs **991ms on 128KB** — statistically
indistinguishable from the 978ms quote pass it was supposed to beat. Scaling, per doubling
from 8KB to 128KB:

| formulation | 8KB | 32KB | 128KB | growth per doubling |
|---|---|---|---|---|
| quote pass (fix branch) | 11.2ms | 79.2ms | 977.7ms | 2.30 → 3.69 (quadratic) |
| tokenizer, character loop | 12.3ms | 84.6ms | 991.0ms | 2.34 → 3.60 (quadratic) |
| tokenizer, **linear form** | 2.7ms | 3.8ms | **6.8ms** | 1.10 → 1.46 (linear) |

The quadratic term is `word = word c` — appending one character to a growing awk string. A
tokenizer written the obvious way has it too. The cure is one `gsub` to mark metacharacters
plus one `split`, so the loop appends whole runs and iterates once per metacharacter rather
than once per byte. **That cure belongs to either design.** Performance therefore does not
discriminate between restructure and patch; it only says *stop appending one byte at a time*.

Two lessons recorded rather than discovered: a benchmark that does not assert its subject
succeeded measures the failure path, and I published a number from it. And the brief's
warning — *a half-correct tokenizer that LOOKS principled is worse than honest regex* — has
a sharper form: a tokenizer that does not run at all can look like the best option in a table.

## What a tokenizer does not buy

The prototype, once working, was probed on 27 commands. It gets 15 of 16 specified cases
right (the miss is line continuation, which the existing normalisation pass already handles).
On the genuinely hard shell it behaves **identically to the gate we have**:

| shape | today | tokenizer |
|---|---|---|
| `echo "$(npm publish)"` — `$(…)` re-enters command context | missed | missed |
| ``echo `npm publish` `` | missed | missed |
| `sh -c "npm publish"` | missed | missed |
| `echo it's fine; npm publish` — unbalanced quote swallows the line | missed | missed |
| heredoc body beginning with a release verb | over-blocked | over-blocked |

So the tokenizer buys **no correctness on the hard cases at all**. Everything it fixes is on
the easy cases — and the patch fixes those too. Its real product is *prevention of
recurrence*, not correctness today.

## Can the patch route actually close all six?

Yes — measured, not assumed. Six targeted edits were applied to a scratch copy of the fix
branch (never to the repository):

- anchor the `release create` detector with `${START}…${END}`, and hand the anchored pattern
  to `run_dir_for`;
- bound the `release create` and `git tag` extractors to the invocation that matched, by
  `grep -Eo` + a `^`-anchored strip, instead of a greedy `.*`;
- make the offset truncation byte-correct;
- rewrite the quote pass in the linear form above.

Result: **0 wrong on all 8 outstanding probes, under both locales**, and the perf budget
restored — 128KB back from 1028ms to 71ms, 2000 lines from 1368ms to 100ms.

### The behaviour check, and the seventh defect it caught

The gate's 61 existing tests were run against the patched copy. Baseline in the same harness
is 59 pass / 2 fail (those 2 read `skills/` files absent from the scratch mirror). The
patched copy scored **58 / 3** — one new failure:

> `a project with no release-note file at all is allowed, silently`
> `+ 'head: illegal byte count -- 0'` `- ''`

The verdict was still correct; macOS `head -c 0` is an error, so the byte-correct truncation
leaked to stderr on every command whose verb sits at offset 0 — i.e. the commonest shape
there is. The test that caught it asserts *silence*, not the decision.

That is round seven, produced by a six-item patch that was individually well-specified. It is
the single best argument in this note for the restructure — and it was caught, in minutes, by
a test that already existed.

Two repairs were then tried, and **both** return the suite to the 59/2 baseline with all 8
probes still green:

- **A** — guard the zero case (`if [ "$off" = "0" ]; then seg=""; elif …`).
- **B** — delete the extra process entirely: `export LC_ALL=C` near the top, keep
  `${seg:0:$off}`. Every pattern in the file is ASCII, so pinning the locale makes `grep -b`
  and `${x:0:n}` agree by construction, costs nothing, and removes the class rather than the
  instance.

**B is the better repair** and is the one the work list uses.

## Recommendation: PATCH

The tokenizer clears the defect-prevention bar (6 of 10) and fails every other test:

- it does **not** improve any hard case — identical behaviour to today on all five;
- it does **not** fix the performance defect (measured: equally quadratic);
- it does **not** replace the normalisation layer it was supposed to subsume;
- it **is** a new place to be wrong, and mine was wrong on first write in a way a benchmark
  reported as a success;
- and it would touch all four branches at once, against a header whose one intolerable
  outcome is a false denial.

Against that, the patch route closes all six items, preserves every existing verdict
(59/2 = baseline), and restores the budget.

The one thing the tokenizer genuinely offers — *you cannot forget to anchor a branch* — is
worth having, because **that omission has now happened twice, three rounds apart**: defect 1
(`changeset publish`) and defect 6a (`gh|glab release create`) are the same mistake. But it
does not need a tokenizer. A twelve-line test buys it:

```
every `printf '%s' "$norm" | grep -Eq "<pattern>"` in the gate
must have <pattern> begin with ${START}
```

Run against the four variants, that rule flags **exactly** the real defect and nothing else:
`(gh|glab) +release +create` on the fix branch, the same unanchored literal on `main`, and
zero findings on either patched variant. It is also what `.blocks/review.md` asks of any new
pattern — *what turns red when the thing it describes changes?* — applied to the gate's own
source.

### Ordered work list

1. **`export LC_ALL=C`** immediately after `set -uo pipefail`, with the comment explaining
   that `grep -b` and `${x:0:n}` must be measured in the same unit. Closes 6c at the class
   level and adds no process. *Failing test first:* the UTF-8 probe above, asserted under
   `LC_ALL=en_US.UTF-8`, which is the locale most interactive shells actually run.
2. **Anchor the `release create` detector** — `"${START}${RELEASE_CREATE}${END}"` — and pass
   the anchored pattern to `run_dir_for`. Closes 6a, and 6b with it: an anchored branch 2 no
   longer claims a commit whose message merely names a release, so the bump check is reached.
3. **The anchoring test.** Parse the gate source, collect every `grep -Eq` whose input is
   `$norm`, assert each pattern starts with `${START}`. Must handle both `"…"` and `'…'`
   forms — the shipped defect is single-quoted and a double-quote-only matcher misses it.
   This is the item that makes round 8 unlikely; do not defer it.
4. **Bound the `git tag` extractor** to the invocation that matched: `grep -Eo
   "${START}${TAG_VERB}(-a +)?[^;&|)]*" | tail -1`, then strip with a `^`-anchored `sed`.
   Closes 6e's false denial *and* its fail-open. Two tests, one per direction — the fail-open
   is the one nobody would notice.
5. **Bound the `release create` extractor** the same way. Note this changes the documented
   "deliberately not truncated at the next separator" choice; after the quote pass a `&&`
   inside `--notes` is already blanked, so the reason for that choice is gone — but it is a
   behaviour change and needs its own test saying so.
6. **Rewrite the quote pass in linear form** (`gsub` to mark metacharacters, `split`, append
   whole runs). Closes 6d. Assert the *scaling*, not a wall-clock threshold: a fixed
   millisecond budget in a test is the "hand-maintained description of something that moved"
   failure `.blocks/review.md` names. Assert 128KB completes within a small multiple of 8KB.
7. **Record the under-blocks** already published in the adapter README, adding the four this
   note confirms are shared with the tokenizer: `$(…)` inside double quotes, backticks,
   `sh -c "…"`, and an unbalanced quote swallowing the rest of the line.

Items 1–3 are the ones that matter; 4–6 are mechanical once 3 exists.

## When to revisit

This recommendation is conditional, and here is the trip-wire. Restructure when **any** of:

- **a fifth branch is added.** Four branches each with their own extractor is near the limit
  where per-branch discipline still fits in one reader's head; the anchoring test scales, the
  extractor-pairing discipline does not.
- **the `sh -c "…"` or heredoc cases are ever promoted from under-block to must-fix.** Both
  need real command-context tracking. Regex cannot reach them, and a tokenizer is then the
  cheapest correct thing rather than an optional tidy-up.
- **a defect appears that the anchoring test could not have caught** and is still a
  command-position confusion. That would mean the cheap guard does not in fact cover the
  recurring class, and the evidence for the rewrite would be complete.

## What this note did not check

- **The gate was never run as a live `PreToolUse` hook here.** Every verdict above came from
  feeding the documented payload to the script on stdin, which is how the repository's own
  tests drive it. The decision channel remains DOCUMENTED, NOT OBSERVED, exactly as the file
  header says — nothing here upgrades that.
- **`observe` mode's stderr surfacing** is likewise unverified, and unchanged by any of this.
- The patched variants live only in a scratch directory. They are evidence that the work list
  is achievable, not a proposed diff; item ordering and the tests come first.
- The two mirror-harness failures (`skills/` files not copied) were confirmed to be artifacts
  by baselining the unpatched gate in the same mirror. They are not findings.
- Timings are from one machine (Apple silicon, `awk version 20200816`, no `gawk`/`mawk`
  present). The *ratios* should hold; the absolute milliseconds will not.
