# Architecture

## Purpose

`agent-skills` is a public, standards-first monorepo for portable agent skills. It separates catalog structure and validation from the skill content shipped by the public catalog.

## Discovery contract

The only supported discovery location is:

```text
skills/<name>/SKILL.md
```

`<name>` is the skill's stable identifier. Its `SKILL.md` frontmatter must declare the same `name`. The repository must not contain a root-level `SKILL.md`; that layout can make generic skill installers stop discovery early and ignore nested skills.

## Catalog boundary

The public product started with exactly two planned skills:

- `model-routing`: token-efficient, quality-preserving work routing with exact model bindings.
- `agent-lifecycle`: automatic delegated-work visibility.

No further skill belongs in the catalog without a deliberate product decision. The catalog
now ships twenty-nine skills, each admitted by such a decision and each recorded in the
repository README and in [releases](releases.md).

## Verification boundary

`scripts/verify-skills.mjs` is dependency-free and is run locally and in CI. It enforces discovery structure, minimal frontmatter, local-link containment, carried-file existence for every bare `references/`, `scripts/`, or `assets/` token, a 484-line cap on the `SKILL.md` body so detail lives in carried files, likely-secret detection, and local absolute-path detection. It intentionally does not claim to prove that content is safe; human review and the [public-content policy](public-content-policy.md) remain required.

## Adapters and hooks

`adapters/` is not part of the catalog. Nothing in it is discovered as a skill, nothing in it
is installed by `npx skills add`, and `scripts/verify-skills.mjs` does not look at it — it
validates `skills/` only. What lives there is harness-specific glue: code that runs outside
the conversation, in a hook the user wired into their own harness.

- `adapters/claude-code/journal-hook.{sh,mjs}` translates Claude Code's hook payloads into
  `agent-journal observe` calls, with two opt-in authoring floors that speak back into the
  session. Its tests live with the package it feeds
  (`packages/agent-journal/test/adapter-claude-code.test.ts`).
- `adapters/claude-code/report-progress-gate.mjs` is the mechanical half of the
  `report-progress` skill: a `Stop` hook that can hold a turn open when a report is owed and
  missing, plus the arming half the chosen coverage level reads — `PostToolUse` matcher
  `Agent` at coverage 1; `SubagentStart` at coverage 2, with `PostToolUse` matcher `Skill` only
  for a named skill list, while the harness's own register of background work is read out of
  the `Stop` payload itself. At both levels a `UserPromptSubmit` hook clears its record of a
  spent block when a turn starts, which is what holds it to one block per turn. At coverage 2 a
  `SessionStart` hook on matcher `resume` marks a session resumed in a fresh process, so its
  first `Stop` does not read the old process's tasks as gone. It is installed and removed by
  `install-report-progress-gate.mjs`, and covered by `test/report-progress-gate.test.mjs`.
- `adapters/claude-code/release-notes-gate.sh` is the mechanical half of the `release-notes`
  skill: a `PreToolUse` hook on `Bash` that refuses a publish, a forge release-create, a
  release-looking tag, or a version-bump commit when the version being released is not
  mentioned in any file that records releases, installed and removed by
  `install-release-notes-gate.mjs`. It is covered by `test/release-notes-gate.test.mjs`. It
  enforces presence only, and it allows every case it cannot resolve — including a project
  with no release-note file at all, where an armed gate correctly never fires.
- `adapters/claude-code/hook-ownership.mjs` is how both gate installers recognise their own
  hooks: by the command, because Claude Code drops `describe` whenever it writes a settings file
  and keeps the command byte for byte. A command in an installer's exact shape — its own
  assignments, one interpreter word, the single-quoted gate, nothing after — is read by that
  interpreter alone. It is the installer's own when that interpreter is one the installer writes:
  for the report-progress gate, a single-quoted path whose name is a Node-compatible runtime
  (`node`, `nodejs` or `bun`, with an optional version and `.exe`) or the name of the binary
  running the installer; for the release-notes gate, the bare word `bash`. It runs the gate, and
  `--adopt` takes it, when that word is such a runtime, or for the release-notes gate a shell,
  written another way; it is nobody's when that word only prints, reads or deletes files (`cat`,
  `unlink`, `xxd`, `du`); and it is one the reader cannot fully read when that word is any other
  program. Where the harness has not dropped it, the installer's own `describe` makes any hook that
  runs the gate its own, as it did through 0.19.0. Any other hook that runs the gate is taken only
  under `--adopt`. It reads past the wrappers `timeout`, `nice`, `nohup`, `env`, `command`, `exec`,
  `caffeinate` and `sudo`, nested or not, each only in the forms its manual gives on both macOS and
  Linux (`WRAPPER_GRAMMARS`). A wrapper option or form outside that table makes a hook it cannot
  fully read, never guessed past; `time`, `stdbuf`, `ionice`, `chrt`, `taskset`, `xargs`, `watch` and
  `parallel` are not read as wrappers at all. A plain re-run never takes a hook it cannot fully
  read. `--adopt` takes every one over — whatever leads its command, wherever the gate path sits,
  option values included, and a hook under the installer's own `describe` whose command never names
  the gate file — unless it writes to the gate file, and the installer prints each hook it took that
  way, by event and matcher. No flag takes a hook for four reasons, which `neverTakenReason`
  returns and nothing else can, each applied as the reader judges the command: a mention (every place
  the reader finds the gate file named reaches only a program known not to run it — as its argument, on its stdin via a pipe, a here-string, a here-document or a
  `<` redirection, or in a shell comment — with nothing that program prints flowing on, and nowhere
  else in the command, so `wc -l < '<gate>'` and `cat <<< '<gate>'` are mentions while `node <<<
  '<gate>'` is not), a write target (a redirection writes to the gate file, inside `sh -c`, `eval`,
  a here-document or a substitution too), a different file (every path holding the gate file's name
  ends in another name: a lookalike, or the name only as a directory), and another tool's `describe`.
  A reason holds only when the command holds no expansion the reader does not resolve (the certainty
  rule, checked over the whole command): a parameter expansion with an operator (`${G%.bak}`), indirection,
  brace expansion or arithmetic, or a command substitution feeding an executing program, may turn a
  lookalike into the gate (`G=<gate>.bak; node "${G%.bak}"` runs it), so such a hook is left unclear,
  taken by `--adopt`, never a reason.
  Its known limits are listed in full in
  [the adapter README](../adapters/claude-code/README.md#known-limits-of-the-reading). The first is that
  the reader can misjudge complex, hand-written shell and read a hook that runs the gate as a mention:
  a here-document body that runs it through `$(…)` or backticks, a group or compound command's output
  piped into a shell or interpreter, `$'…'` quoting that hides a later command, `$_` carrying a
  mentioned argument on, arithmetic inside bash's `[[`, zsh process substitution, and a launcher or copy
  written to another file and run. `--remove` then leaves such a hook and exits 0, and no flag takes it,
  so it has to be removed by hand. The others: a gate name not written out literally is not read as
  naming it; a group whose `hooks` is not an array is not read; control flow is read by structure; a
  write through a program's argument is not a write target; under `--adopt` a hook the installer did
  not write and cannot fully read is taken, and named, as 0.19.0 took it; the certainty rule is
  command-wide, so a plain mention beside an unrelated expansion is unclear; and `printf -v` is handled
  only as unclear. `--remove` exits 1 while it leaves a hook it reads as running the gate, or possibly
  running it, and
  names every hook it leaves that names the gate file, with why. A re-run with no `--mode` keeps the
  mode already installed, as the report-progress installer keeps its level. It is covered by
  `test/hook-ownership.test.mjs`, `test/hook-ownership-installers.test.mjs` and
  `test/hook-ownership-v0.19.0.test.mjs`. That last test runs 0.19.0's installers beside this
  version's on identical settings files — release-notes hooks under events 0.19.0 never read among
  them — and holds every row to the release bar's four points in precedence order. A run with no
  flag never takes a hook the reader cannot fully read. Mentions, write targets, different files and
  another tool's `describe` are never taken, with any flag. Whatever else 0.19.0 took or removed,
  this version takes or removes with the same flags, or with `--adopt` added; 0.19.0's release-notes
  installer has no `--adopt`, so those rows are compared with its nearest equivalent run. Over those
  rows, `--remove` exits 1 while it leaves a hook that runs the gate, or may, and never says no gate
  was installed while a hook names the gate file. Whether a start hook runs the gate is established by firing it
  against a stand-in gate, not written by hand. The same test holds the four reasons closed: over every
  subject of that matrix, every form the branch's held reviews named and a generated set, a hook with
  the gate file's name in it is taken under `--adopt` or given one of the four reasons, never both, and
  every mention and different file is fired at a stand-in that records which file ran and at an armed
  copy of the real gate, and runs neither. That holds over those subjects only; it does not cover the
  misread forms in the known limits above, which do run the gate.
- `adapters/codex/` is built from Codex's published documentation and has never run against a
  real Codex session. It says so at the top of its own README and must keep saying so until
  someone captures a real payload.

The freshness `SessionStart` hook is the exception to the directory: it is carried inside
`skills/update-agent-skills/scripts/`, because an installed skill has to be able to offer it.

Three rules hold for anything here:

1. **Observed, not assumed.** Every claim about a payload shape, an event name or an output
   channel is anchored to a capture in [`adapters/NOTES.md`](../adapters/NOTES.md) or
   [`adapters/HOOK-OUTPUT-NOTES.md`](../adapters/HOOK-OUTPUT-NOTES.md). Those files outrank
   every README in the repository, including this one.
2. **An exit code is not a delivery channel.** The same number means different things on
   different events: a synchronous `SessionStart` hook that exits 2 discards the stdout an
   exit 0 would have delivered, and an asynchronous one delivers nothing on exit 0. A hook
   that has something to say prints the words.
3. **Off until a human arms it.** A hook that can end a turn, speak into a session or mutate
   an installation is installed by the user running its installer, never by a skill and never
   by an agent acting on a skill's instructions.

## Automation

GitHub Actions runs the same verifier using Node.js 24. A second job runs `agent-journal` on Node.js 22, because that is the floor its shipped CLI installs behind and the 24 job cannot see a 24-only API reaching those sources. Dependabot maintains GitHub Actions updates. CODEOWNERS routes changes in policy, automation, and skill content to maintainers.

## Future architecture

The planned bridge from the private skills control plane to this public
delivery repository is documented in the [roadmap](roadmap.md). The public
repository remains independently installable and contains no private team state.
