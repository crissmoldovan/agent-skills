# Describe changes — classification guide

Seven kinds, one per change. The set is deliberately small: a taxonomy people can
hold in their heads gets applied consistently, and a consistent wrong-ish label
sorts better than an inconsistent precise one.

## The seven

| Kind | The change… | Test |
|---|---|---|
| `feature` | adds a capability that did not exist | Can a user now do something they could not before? |
| `bug_fix` | makes existing behaviour match its intent | Was the previous behaviour wrong, not merely worse? |
| `improvement` | makes existing, correct behaviour better | Speed, ergonomics, clarity, reliability, with no new capability. |
| `security` | closes an exposure | Does the diff or an advisory name an exploitable condition? |
| `ops` | changes how the system runs, not what it does | Build, deploy, config, monitoring, dependencies, infrastructure. |
| `docs` | changes documentation only | Would the compiled or deployed behaviour be byte-identical? |
| `breaking` | requires callers or users to change | Does something that worked before now fail without action? |

## Decision order

Overlaps are common. Resolve them by taking the first kind that applies, in this
order:

1. **`breaking`** — it wins over everything. A breaking change is a breaking
   change whether it arrived as a feature, a fix, or a cleanup, because the
   reader needs the warning more than the category.
2. **`security`** — it wins over `bug_fix`, because a reader deciding whether to
   upgrade urgently is asking a different question.
3. **`bug_fix`** — wrong behaviour becoming right.
4. **`feature`** — new capability.
5. **`improvement`** — better, same capability.
6. **`ops`** — the system runs differently, users notice nothing.
7. **`docs`** — nothing else changed.

Two of these deserve stating plainly:

- **`breaking` first** means a removed API endpoint is `breaking`, not `ops`,
  even though the diff is deletion.
- **`docs` last** means a change that touches documentation *and* code is never
  `docs`. Only a documentation-only change is.

## Edge cases

### A bug fix that adds a flag

The fix is correct but risky, so it ships behind a flag that defaults off.

- **Flag defaults off:** classify `improvement`, and the description says the fix
  exists and is not yet active. It is not a `bug_fix` for users, because for
  users nothing changed.
- **Flag defaults on:** `bug_fix`. The flag is an escape hatch, not the change.
- **Either way**, the detail register names the flag and its default. A reader who
  cannot tell whether the fix is on has learned nothing.

### A pure performance change

`improvement`, unless behaviour changed.

- With a measurement in the change — a benchmark, a recorded before and after —
  the description may state the gain, and cites it.
- Without a measurement, describe the mechanism the diff shows ("results are now
  cached for the duration of a request") and do not attach a number. An invented
  percentage is the single most common false claim in generated release notes.
- If the optimisation changed a result, an ordering, or a rounding, it is a
  `breaking` change wearing a performance costume. Check for that specifically.

### A revert

Classified by **what the revert does now**, not by what was reverted.

- Reverting a broken change restores correct behaviour: `bug_fix`.
- Reverting a feature removes a capability users had: `breaking` if it was
  released, `improvement` if it never reached them.
- The title says "Revert", names the original, and the detail register states
  whether the underlying problem is still open. It usually is.

### A dependency bump

- Routine version bump: `ops`.
- Bump that resolves a named advisory: `security`, and cite the advisory
  identifier.
- Bump that forces callers to change: `breaking`.
- A lockfile-only change with no version movement: `ops`, and the description says
  it is a lockfile refresh rather than implying an upgrade.

### A refactor

`improvement` when it changes nothing observable, and the medium register should
be honest that users will notice nothing. A refactor that fixes a bug on the way
is `bug_fix`; a refactor that changes a public signature is `breaking`.

Resist the temptation to describe a refactor as a feature because the diff is
large. Size is not significance.

### A new configuration option

- Option is optional and defaults to the previous behaviour: `feature`.
- Option is required and has no default: `breaking`.
- Option only affects deployment, not product behaviour: `ops`.

### A migration or schema change

Classify by effect, not by file type.

- Adds a nullable column nothing reads yet: `ops`.
- Backs a user-visible capability in the same change: `feature`.
- Drops or renames something callers use: `breaking`.
- Backfills or corrects wrong stored data: `bug_fix`.

### Test-only changes

`ops`. They change how the system is verified, not what it does. A change that
adds tests *and* the fix they cover is a `bug_fix` — the tests are evidence, not
the change.

### Generated or vendored churn

Classify by the reason for regenerating. A regenerated API client because the API
gained an endpoint is `feature` or `ops` depending on whether anything calls the
new endpoint yet. Never classify by the size of the generated diff.

## When two kinds genuinely apply

That is a signal about shape, not about classification. A pull request that fixes
a bug *and* adds an unrelated capability should be described as two items in the
itemized shape, each with its own kind. Forcing it into one digest means one of
the two facts is lost, and it will be the one the reader needed.

If the itemized shape is not available to you, choose by the decision order and
state the second fact explicitly in the detail register. Do not let it disappear.

## What none of the kinds mean

- **`improvement` is not a bin for "unclear".** If the kind is unclear, the change
  is not yet understood; read more of the diff.
- **`ops` is not "backend".** A backend change users can observe is a `feature`,
  `bug_fix`, or `improvement`.
- **`security` is not "hardening".** Adding a header, tightening a validator, or
  rotating a value on schedule is `improvement` or `ops` unless it closes an
  exposure that existed. Reserve the label so it retains its urgency.
