# Fit signals

Every skill in this pack carries `references/fit.json`: where that skill fits, written so a script
can evaluate it against a repository. This file is the grammar, for anyone adding a skill or
sharpening one that is matching too often or not often enough.

A description is a guess a matcher might like. A fit is a claim about a repository that a fixture
can prove both ways — and `verify-skills` refuses a skill that does not carry one.

## The three kinds

```json
{ "version": 1, "kind": "signals", "useWhen": "...", "anyOf": [ ... ] }
```

| `kind` | What it means | Evaluated? |
|---|---|---|
| `signals` | Fits repositories that carry particular evidence | Yes, against the repository |
| `general` | Fits nearly any repository; forms a small default set | No — always offered |
| `requestOnly` | Invoked by name, never recommended by a scan | No — never offered |

`useWhen` is required for all three. It is the line the generated routing file will carry, so write
it as the **moment** a reader would recognise, not as a summary of the skill: *"about to cut a
release, bump a version, or write a CHANGELOG entry"*, not *"release management"*.

`signals` fits need `anyOf` (one signal is enough) or `allOf` (every signal must hold).

## Repository signals

Read from the repository's files. Cheap enough to run at session start, which is why the check
re-evaluates exactly these and nothing else.

| Signal | Shape | True when |
|---|---|---|
| exists | `{ "repo": { "exists": "CHANGELOG.md" } }` | A path matches. A named path is asked of the filesystem, so its case follows the volume's; a pattern with `*` or `?` is matched against the scan. A trailing `/` means a directory, with or without wildcards (`**/migrations/`); `*` stays inside one segment and `**` crosses them |
| missing | `{ "repo": { "missing": "README.md" } }` | An exact path is **not** there, asked of the filesystem. No globs: "nothing matched this pattern" is a much weaker claim than "this file is not here" |
| json | `{ "repo": { "json": "package.json", "field": "version" } }` | The file parses and the dotted field is present |
| toml | `{ "repo": { "toml": "Cargo.toml", "field": "package.version" } }` | A `[section]` header and a `key = value` under it. Shallow by design |
| yaml | `{ "repo": { "yaml": "pubspec.yaml", "field": "environment.sdk" } }` | Top-level and indented keys, two levels. Shallow by design |
| grep | `{ "repo": { "grep": "x-hub-signature", "globs": ["**/*.ts"] } }` | A JavaScript regular expression matches inside a file the globs select. The scan stops at the first match and names that file as the evidence |

The shallow readers are not an oversight. A fit signal asks whether a repository has a shape; a
signal that needs a real TOML or YAML parser is asking a question that belongs in the skill itself.

`grep` is bounded: a byte budget per file and in total, over the globs you name. A file too large
to read is skipped, and a grep that finds nothing but skipped one is unknown. Name them
narrowly — `**/*` across a large repository is slow and matches things you did not mean.

**A bound makes a signal unknown, never false.** The scan walks at most twenty thousand files and
twelve levels, skipping dependency trees and tool-owned build output. When a glob or a grep finds
nothing but the walk or the budget stopped before the end, the honest answer is "not in the part
that was read", and the signal reads as unknown — it neither matches nor rules the skill out, and it
does not move the evidence the session-start check compares.

## History signals

Read from this machine's own session history for this repository. They answer questions no file in
the tree can: is implementation delegated here, does work run in the background, are releases cut
from this directory.

```json
{ "history": { "count": "agentDispatches", "atLeast": 5 } }
```

| Count | Incremented by |
|---|---|
| `agentDispatches` | A subagent dispatched through the Agent tool (under either of its names) |
| `workflowLaunches` | A workflow started |
| `backgroundCommands` | A shell command started in the background |
| `releaseCommands` | A publish, a forge release-create, or an annotated version tag |
| `writesOutsideRepo` | A file-writing tool call whose path lies outside the repository root |

Two rules about history, and both matter:

- It is read by **onboard** and **refresh** only. The session-start check never touches it, because
  these transcripts run to tens of megabytes and a check that costs a second at every session start
  is a check somebody will remove.
- A history read that hit its byte budget is a lower bound: a count already past its threshold is
  true, and one short of it is unknown.
- An absent history is **unknown**, not zero. A machine that has never opened this repository has
  no evidence either way, and a skill must not be dropped for evidence that was never going to be
  there. In an `anyOf`, an unknown signal simply does not contribute; in an `allOf`, it prevents
  the match rather than falsifying it.

Because of the first rule, the profile's fingerprint is built from **repository signals only** —
the check has to be able to recompute it, and a fingerprint it cannot reproduce would report drift
at every session start.

## Writing a good fit

- **Match the moment, not the topic.** A signal that is true in every repository recommends the
  skill in every repository, which is the same as recommending nothing.
- **Prefer a manifest field to a grep.** It is faster, it is exact, and it does not fire on a
  comment.
- **Use `allOf` when one signal alone would be noise.** A changelog alone says little; a changelog
  *and* an authentication library together say something.
- **Test both ways.** The pack's own test asserts each shipped fit against a fixture repository
  that should match and one that should not. A fit with no negative case is a fit nobody has
  checked.
- **Keep `requestOnly` honest.** If a skill should only ever run because somebody asked for it by
  name — anything that installs, publishes or changes a user's own configuration — that is the
  kind it takes, whatever its signals would say.
