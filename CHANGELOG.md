# Changelog

Per-version record of what shipped. The public, reader-facing changelog is the
[GitHub Releases](https://github.com/crissmoldovan/agent-skills/releases) page, whose bodies
mirror these entries; `docs/releases.md` carries the release process and the staged prose for
the next version. Entries before v0.12.0 live only on the Releases page.

## 0.17.0

**What.** Two things: a twenty-fifth skill, `layer-repository-docs`, and a widened
`report-progress` gate. The gate armed on one signal — `PostToolUse` with `tool_name` `Agent` —
and now arms on **two families of work the user cannot see**. **Opaque delegation** (family A)
moves to `SubagentStart`, which fires for every subagent kind, foreground or backgrounded, and
optionally to a list of skill names the user names as external agents (`--skills codex`, exact
match on `tool_input.skill`, empty by default, and no hook is written at all when the list is
empty). **Work still in flight at a turn end** (family B) needs no new hook event: `Stop` already
carries `background_tasks[]`, the harness's own register of background shells, workflows and
backgrounded subagents, so the gate compares the ids running now against the ids running at the
session's previous `Stop` and arms on the **change** — something appeared, or something that was
running is no longer listed. A task that is merely still running arms nothing, so a dev server
left in the background does not make every turn owe a report. One check is added, on armed turns
only: a report may not say "Running: none", or claim there is no lifecycle evidence, while the
register in that same payload lists tasks as running. `test/report-progress-gate.test.mjs` grows
from 41 tests to 79. Minor, by this repository's rule that a new skill is a minor: twenty-four
skills become twenty-five.

**Why.** "Long-running tool" was asked for as a third family and is not one. A foreground call
that took six minutes is over by the time the turn ends and the user watched it happen — they were
blocked on it; a background task that has been running for six minutes is family B and always was.
That collapse is what removed the only part of this needing a wall clock the harness does not
have: no hook event carries a timestamp of any kind, so "long-running" is defined mechanically as
*still listed as running at a turn end*, and there is no threshold because there is nothing to
compare one against. The gate enforced a report for one kind of delegated work and was blind to
the rest — a workflow, a backgrounded subagent, a background shell left running when the user
stopped reading. The silence it was built to prevent was available through four doors and closed
on one.

`layer-repository-docs` makes a repository's documentation legible when an organisation has more
repositories than anyone can track: three layers as roles rather than required files — a quick
start in every repository, a manual once one outgrows its README, and a single organisation-wide
handbook every other repository links to and none copies — plus one home per fact and a tier
ladder, so a small repository is not made to grow structure it has not earned. It exists for the
two passes that decide whether a documentation rewrite is fit to hand over and that nothing else
catches: a **loss audit**, which splits every replaced file into atomic facts and rules and gives
each a verdict, because everything it finds is absent from the new draft and absence does not read
as an error; and a **newcomer test**, in which a reader carrying none of the drafting context
follows the documentation in a clean clone, because a fact-check passes every sentence that is
true and has no way to notice the required field nobody wrote down. Six carried references hold
the depth. It writes the documentation people read; the context files agents load remain
`derive-codebase-context`'s.

**Impact.** **Additive, and behaviour-compatible until you opt in.** No export, flag, command or
return shape was removed or renamed, and no runtime dependency was added.

- **If you already have this gate installed, your live hook starts executing the new file the
  moment this lands** — an installed hook points at a checkout, so updating the pack updates the
  code that runs, with no installer step in between. That is safe only because the new behaviour
  is behind a level the installer writes into the hook command,
  `AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2`. **Absent, `1`, or anything unrecognised is v0.16.1's
  behaviour exactly, register included** — at coverage 1 the register is not read at all, not for
  arming and not for the contradiction checks. So anyone running an installed copy gets the new
  code immediately and the old behaviour until they re-run the installer. The level exists because
  the two new hooks cannot appear in your settings without you running the installer, but the
  register half rides on the `Stop` hook that is already there: without it, updating the pack alone
  would have widened a gate you armed under different terms. An unrecognised value falls back to
  the narrower armed level rather than to `off`, so a typo can neither widen a gate that can end a
  turn nor silently disable one.
- *Who must do something:* **nobody, unless they want the wider coverage** — and anyone who does
  should **re-run the installer**, which is also the fix for a defect in `--remove`. `--remove` now
  scans every event key in your settings rather than the list this version happens to write:
  without that, the moment the installer stopped writing `PostToolUse`, an existing `PostToolUse`
  hook became unremovable and would have stayed behind arming a marker nothing reads. Re-installing
  replaces the v0.16.1 pair rather than orphaning half of it.
- *Known limitation of coverage 2 — it can spend more than one block on a turn.* Measured: the
  gate blocks on the first `Stop`, stands down on the second, and **standing down deletes the
  marker**, which is the only memory it has of the block it just spent; if the register changes
  again, a third `Stop` arms fresh and blocks again. v0.16.1 was structurally incapable of this,
  because only a tool event could arm and the marker was always there to be read. Live, this is
  caught by `stop_hook_active` — but this gate's stated stance is that `stop_hook_active` is the
  harness's backstop, not the gate's own memory, and the 8-block budget that ends a turn is
  **shared** with every other `Stop` hook on the machine, whose exhaustion is reported as a success
  with an empty answer. Coverage 1 does not have this shape.
- *New state on disk, and it accumulates.* Coverage 2 writes a second file per session,
  `<session>.register.json`, beside the marker in the temp directory — the baseline the next
  turn's edge is computed against, which has to survive the `Stop` that deletes the marker. It is
  removed only when a later `Stop` finds the register empty, so **a session that ends with a dev
  server still running leaves one behind** until the operating system sweeps its temp directory.
  These are small JSON files and nothing reads a stale one — anything older than six hours is
  treated as absent — but they are new state v0.16.1 never wrote.
- *What it still does not see, stated rather than left to be discovered:* a **foreground external
  agent** — a bare `codex exec` in a `Bash` call — unless you list the skill that runs it.
  **Automatic detection of external agents is not shipped, and was deferred by decision, not
  overlooked**; the reasoning is recorded in the design note. That path carries no distinguishing
  tool name (`tool_name` is `Bash`; the only signal is `tool_input.command`, which is text), and
  **this gate does no command-text matching anywhere** — not for `codex`, not for any binary, not
  behind a flag. The sibling release gate's eight defects over five rounds were four repeats of one
  bug, a regex reading argument text as command structure, found twice more after two structural
  guards were written to stop it; and there a false positive merely denied a command, where here it
  would demand a progress report because a commit message mentioned codex. Backgrounding such a
  call makes it a register entry with its own id, exactly tracked, with no guessing. Also unseen:
  the individual children of a workflow, background work that starts and finishes inside one turn,
  and how long anything has been running.
- *Two decisions worth recording, because both are non-obvious.* **A workflow of twelve agents
  owes one row, not twelve** — the bar is one row per unit the harness itself registers, because
  twelve is not a number this gate can see and twelve rows carrying states nobody observed would be
  invention wearing a status block, produced by the gate meant to prevent it. And **`SubagentStop`
  is deliberately not wired**: internal compaction summarisation is itself a subagent dispatch,
  seen as a `SubagentStop` with `agent_type: ""` and no matching `SubagentStart`, so arming on it
  would demand a progress report on the turn after every `/compact`. `PostToolUse` matcher
  `Workflow` is not wired either — it fires at `duration_ms` 3–5, the launch rather than the work,
  while the dispatching turn's `Stop` fires with the workflow still running, so the register
  answers the workflow case and the gate never reads that event at all.
- *A disappearance is not a completion.* There is no terminal status on `background_tasks[]` to
  read — a finished entry is removed rather than re-labelled — so the gate concludes that a report
  is owed and never what happened. Terminal states belong to `agent-lifecycle`.
- *Still off until armed, and still zero bytes on a passing turn.* The gate exits without reading
  its input unless `AGENT_SKILLS_PROGRESS_GATE` is `block` or `observe`, no skill and no agent may
  install it on a user's behalf, and a turn that delegated nothing and changed nothing ends exactly
  as it would with the hook absent. Its stand-down notes go to stderr, which the harness does not
  deliver to the model at exit 0.
- *Blast radius of the new skill:* additive. `layer-repository-docs` adds a catalogue row and a use
  example, and moves the pack count from twenty-four to twenty-five in the README, CONTRIBUTING and
  the architecture and composition guides. No existing skill's frontmatter `description` changed,
  so nothing an agent selects on moved.
- *Contributors:* `npm run verify` at the repository root still requires Node.js 24 or newer. Three
  regressions against v0.16.1 were found by measuring the widened gate and fixed before this
  shipped, each mutation-checked by reverting it alone and confirming a red test: both contradiction
  checks refused **honest** reports, because the patterns were scanned over the whole running block,
  so "state running, last observed just now — none of the tests failed", "Failures: none so far",
  "(queue empty)" and a report quoting the no-evidence sentence while explaining it all read as
  denials — a denial now requires the section to carry **no row**; a stale marker cost the gate the
  memory of a block it had just spent, because the spent-block record inherited the stale marker's
  own `armedAt` and read back as stale, leaving `stop_hook_active` as the only brake; and one
  malformed hook group made `--remove` skip an entire event key, so a live `Stop` hook survived
  `--remove` while the run printed "Removed 1", and the same skip hid a foreign gate hook from the
  scan that exists to stop two gates sharing one 8-block budget. Tolerance is now per group: an
  unreadable group is stepped over and put back untouched.
- *Distribution:* the Skills CLI resolves this repository's default branch, so the update reaches
  users through `npx skills update --global --yes` with no dist-tag to manage.

## 0.16.1

**What.** `adapters/claude-code/release-notes-gate.sh` — the optional Claude Code `PreToolUse`
hook that shipped with `release-notes` in 0.16.0 — now reads quoted text as **data** rather
than as shell structure, and reads the invocation that is actually being run rather than the
whole command line. Every detector over the normalised command is anchored to a command
position, every extractor reads the invocation that matched, the file measures offsets in one
unit (`LC_ALL=C`, so bytes), and the quoting pass is linear in the size of the command.
`test/release-notes-gate.test.mjs` grows from 52 tests to 79. No skill changed, nothing was
added or removed from the catalogue, and no export, flag, command or return shape moved:
twenty-four skills stay twenty-four, which is why this is a patch.

**Why.** The known false refusal recorded in the 0.16.0 notes was a whole family, not one
case. `START`/`END` matched **characters**, so any `;`, `|`, `&` or `(` in front of a release
verb put that verb at what the gate read as a command position — including when every one of
those characters sat inside a quoted string. Eight defects were found over five rounds. All
eight are live in 0.16.0 as shipped; each was measured against that build and against this one
with the same fixtures, and each is named here by the command that exhibits it.

*False refusals, now removed.* A false denial is the one outcome this gate's own header says
it cannot afford, because it is the one that teaches people to route around the guard.

- `git commit -m "fixes the crash; npm publish now works"` — a `;` inside a commit message.
- `gh issue comment -b "workaround: (pnpm publish)"` — a `(` inside a quoted argument.
- `git commit -m "line one` / `npm publish later"` — a release verb starting the second line
  of a message.
- `echo "then run gh release create v9.9.9 to ship"` — prose naming a release command. The
  `gh|glab release create` branch was matched with **no anchor at all**, the same omission
  `changeset publish` shipped with three rounds earlier.
- `git tag v1.0.0 -m "supersedes the old git tag v9.9.9 line"` — refused v9.9.9, a version
  nobody is releasing and no note can ever satisfy.
- `npm publish && cd <other-repo>` — judged against the repository the command leaves for
  *afterwards*, naming a project with nothing to do with the release.
- `git -C <clean> commit -m "explain how git commit hooks work"` — the `-C` that decides whose
  index is read was taken from the message, so an unrelated commit was refused for a bump
  staged in a repository the command never touches. The byte-identical message without those
  two words was allowed.
- `npm publish` in a package at the legal semver `1.0.0+build.7`, whose changelog said exactly
  that — the `+` was read as a regex quantifier and the refusal claimed the file "never
  mentions 1.0.0+build.7". Being accused of not having written the note you are looking at is
  the worst shape a false denial takes.

*Releases that went through unchecked, now refused.* These are the quieter half — nobody
reports a guard that fails to fire.

- `git tag v9.9.9 -m "replaces git tag v1.0.0"` read v1.0.0, found its note, and cut an
  unnoted release.
- `git commit -m "see git -C /nonexistent commit"` made the directory unresolvable, which
  exits the branch — so a sentence switched the version-bump check off and a real unnoted
  bump walked through.
- `pnpm --filter @acme/a publish;pnpm publish` handed the member's package to the root's
  publish, found the member's note, and allowed the root's unnoted release; so did
  `npm publish;pnpm --filter @acme/a build` and `npm publish;npm --prefix packages/a run
  build`, where a bare publish took a later build step's package selector.
- `npm "publish"` is newly gated. Quoting removes a character's power to act as structure; it
  does not turn a command into a comment.

**Impact.** **Additive, no migration**, and nobody has to do anything. The gate still ships
**off**, the installer is unchanged, and an armed install simply stops refusing work it should
never have refused. Six things are worth knowing before you rely on it.

- *Landing this does not update an installed copy.* Nothing here reaches a machine on its own.
  Re-run the installer from a checkout of this repository: `node
  adapters/claude-code/install-release-notes-gate.mjs --mode observe` to watch it,
  `--mode block` to arm it, `--remove` to take it out. If you wired this gate into your Claude
  Code settings **by hand** before 0.16.0, delete that entry yourself first — the installer
  refuses to overwrite a hook wearing its name that it did not write, and exits 1 rather than
  clobbering your version. And if you repoint an existing hand-wired entry at the repository
  copy, carry the `AGENT_SKILLS_RELEASE_NOTES_GATE=block|observe` assignment with it: without
  it the hook is **silently inert**, armed-looking and doing nothing.
- *What is given up, on purpose, and by how much.* A release that reaches the shell as a
  **string** is under-blocked in four shapes: handed to another shell (`sh -c "build; npm
  publish"`, `bash -lc`, `ssh host`); a command substitution inside double quotes
  (`echo "$(npm publish)"`, `OUT="$(npm publish --tag next)"`); backticks; and any command
  carrying an **unbalanced** quote, such as a heredoc body containing `it's`, which disarms
  every detector for the rest of that command. An earlier draft of these notes said almost all
  of that was already unblocked in 0.16.0 and only `sh -c "build; npm publish --tag next"` was
  newly lost. **That was wrong, and the measurement is the correction.** Genuinely unblocked
  already: backticks, and the `sh -c` forms carrying no separator inside the string. Newly
  unblocked: that `sh -c` form *and the whole command-substitution row* — `echo "$(npm
  publish)"`, `OUT="$(npm publish --tag next)"`, `printf "%s" "$(git tag v1.4.0)"`,
  `echo "$(gh release create v1.4.0)"` — *and the whole unbalanced-quote row*, `echo it's
  fine; npm publish` and `echo don't; git tag v1.4.0`. Every one of those is the same reading
  that refused the commit messages above, so they cannot be separated; the header decides
  which way it goes.
- *One shape is blocked less than 0.16.0 blocked it, and it is not a false-denial fix.* A
  compound command is judged on its **last** gated invocation. When that last invocation is
  `gh|glab release create` with **no arguments**, it names no version, so the branch reads
  nothing and allows: `gh release create v9.9.9 && gh release create` was refused by 0.16.0
  and is allowed here, in all eight separator forms. 0.16.0 refused it by scavenging the
  version out of the *earlier* invocation — the same greedy read that produced the eight
  defects above, so it could not be kept for this shape and dropped for those. `git tag`,
  `npm|pnpm|yarn publish` and `git commit` are unaffected, each naming what it acts on without
  an argument. Unchanged from 0.16.0 and stated so it is not mistaken for new: a command that
  performs **two** real releases is checked for one (`gh release create v9.9.9 && gh release
  create v1.3.0` allows on both builds), and `git tag ` written with a trailing space allows on
  both. All of it is pinned by a property test rather than left to be rediscovered.
- *It costs more than 0.16.0 on large quoted input.* This hook runs before **every** Bash tool
  call. The quoting pass is linear in the size of the command — it was quadratic when first
  written, and superlinear after the first repair — but linear is a shape, not a price.
  Median of five, end to end, the two builds interleaved on one machine (macOS 14.5 arm64,
  one-true-awk 20200816, bash 3.2), at a 512KB command: no quotes at all 265ms against 189ms
  (1.3x), many short quoted spans 425ms against 235ms (1.8x), a `psql -c "INSERT …"` body
  404ms against 217ms (1.9x), a `curl -d '{JSON}'` body 755ms against 204ms (3.7x), and the
  same body with its inner quotes backslash-escaped 927ms against 210ms (4.4x). The driver is
  how many `'`, `"` and `\` marks a command carries, not its byte count, so the dearest shapes
  are the ones the pass exists for. An ordinary commit message measured 44ms against 30ms.
  Past roughly 1.25MB of quote-dense input this awk falls off a cliff — 1.25MB 1063ms, 1.5MB
  2724ms, where 0.16.0 stays linear at 703ms — which arrives with this work rather than being
  inherited. A 1.5MB Bash command is not a shape this hook meets, so it is recorded rather
  than chased. Measure it on the machine it runs on rather than trusting these numbers.
- *The heredoc trade runs both ways*, and both halves are now written in the same paragraph in
  the gate and in the adapter README. A heredoc body line still reads as a command, so a body
  beginning with a release verb **over**-blocks; a body carrying an ordinary apostrophe
  **under**-blocks the rest of the command. Which one a given heredoc gets depends on its
  punctuation. Neither is narrowed here.
- *Two smaller behaviour changes.* The `gh|glab release create` fragment is now cut at the next
  shell separator, where 0.16.0 deliberately read to end of line so a `--repo` hiding behind a
  quoted `--notes "a && b"` would not be lost — that reason is gone, because the quoting pass
  blanks that `&&` before any of this runs. And `gh release create --draft v1.4.0` is
  unblocked while `gh release create v1.4.0 --draft` is gated, on both builds; the adapter
  README used to name that less precisely than it behaves.

## 0.16.0

**What.** A twenty-fourth skill, `release-notes`, and the mechanical half that keeps it from
being only instructions. `skills/release-notes/SKILL.md` writes the note for one version — what
shipped, why it shipped, and an impact analysis a reader can act on — makes the semver call, and
places the note in every destination the project records releases in.
`adapters/claude-code/release-notes-gate.sh` is an optional Claude Code `PreToolUse` hook on
`Bash` that refuses a release whose version no release-note file mentions, across four shapes:
`npm|pnpm|yarn publish` and `changeset publish`, `gh|glab release create <tag>`, a release-looking
`git tag`, and a `git commit` that stages a `package.json` version bump.
`adapters/claude-code/install-release-notes-gate.mjs` installs and removes it, and
`test/release-notes-gate.test.mjs` drives the real script with real hook payloads in 52 tests.
`release-ledger` and `describe-changes` each change one sentence. Minor, by this repository's
rule that a new skill is a minor: twenty-three skills become twenty-four.

**Why.** Two skills already in this pack named `release-notes` in their own text as the owner of
the job neither of them does — `release-ledger` ("it does not write the notes for one version —
that is release-notes") and `describe-changes` ("it does not cut a release … for that use
release-notes"). Both described it as *a skill outside this pack, installed alongside it*, which
was true and is no longer worth being true: it lived in one directory on one machine and was in
no git repository at all. Those two sentences now point inside the pack, which is the only reason
this is a catalogue change rather than a file move.

The gate exists because the skill is instructions, and instructions are skippable in exactly the
moment this one matters: the note is the last thing between here and `publish`, and nobody is
reading. It carries a scar. `git -C <dir> tag v1.2.3` contains no `git tag` substring, so the
detector missed it entirely and every tag cut against another checkout went completely ungated —
which is how a version once got tagged with no note at all.

**Impact.** **Additive, no migration.** No export, flag, command or return shape changed, no
runtime dependency was added, and nothing was renamed or removed. Existing installs keep working
unchanged whether or not anyone touches the gate.

- *Who must do something:* **nobody, unless they want the gate.** This release does **not** run
  the installer, and nothing in the skill may run it on a user's behalf. It ships off. A user who
  wants it runs, from a checkout of this repository, `node
  adapters/claude-code/install-release-notes-gate.mjs --mode observe` to watch it for a day,
  `--mode block` to arm it, and `--remove` to take it back out.
- *Off until armed:* the hook reads `AGENT_SKILLS_RELEASE_NOTES_GATE`, which takes `observe` or
  `block`. **Unset means off**, and unset is what a fresh checkout has. This is the pack's rule for
  any hook that can end a turn: it ships off and a user arms it.
- *If you already hand-wired this gate into your Claude Code settings, delete that entry by hand
  first.* The installer refuses to overwrite a hook wearing its name that it did not write, and
  exits 1 rather than clobbering your version.
- *And if you repoint an existing hand-wired entry at the repository copy, carry the env
  assignment with it* — without it the hook is silently inert, armed-looking and doing nothing.
  The installer writes the assignment into the command itself for exactly this reason: a desktop
  launch inherits no shell profile, so an exported variable from a terminal never reaches it.
- *Start in `observe`:* the deny path is verified against the hook schema and against fixtures,
  but it has **not** been observed ending a real turn in a live harness. `observe` writes what it
  would have refused to stderr and stops nothing, which is the honest way to find out what it
  would do to your own release commands before it can do it.
- *What it can and cannot check:* it checks that the version string is **present** in a file whose
  job is recording releases — `CHANGELOG.md` and its usual spellings, `docs/releases.md`, files
  under `docs/releases/`, a pending `.changeset/` entry. It cannot check whether what is written
  there says why the release happened or what it breaks, so a heading with a git-message body
  passes the gate and fails the skill. **It is a floor; the skill's contract is the grade.**
- *It is fail-open by design,* and shapes it does not recognise proceed: `sudo npm publish`, `time
  npm publish`, a leading env assignment such as `NPM_CONFIG_TAG=next npm publish`, `git tag -f`,
  and `gh release create --draft` all pass an armed gate today. A project with no release-note file
  at all is allowed silently, so **an armed gate that never fires is the expected outcome there**
  rather than proof the installation worked.
- *One known false refusal:* a release verb inside a quoted string is read as a command when a
  `;`, `|`, `&` or `(` precedes it, so `git commit -m "fixes the crash; npm publish now works"` is
  refused in `block` mode. Masking quoted regions is a redesign of the matching substrate and is
  deliberately not in this release. It is the strongest reason to live in `observe` first.
- *Blast radius:* the two sentences in `release-ledger` and `describe-changes` that pointed
  outside the pack, and nothing else. Twenty-one other skills are untouched, and neither of those
  two changed its frontmatter `description`, so nothing an agent selects on moved.
- *Contributors:* `npm run verify` at the repository root still requires Node.js 24 or newer. Five
  defects in the gate were found and fixed before this shipped — a changeset publish behind a
  runner prefix going ungated, `gh release create --repo owner/name` resolved against the wrong
  repository, a version bump invisible in a one-line `package.json`, a build step's `--filter`
  read as the publish's package, and a trailing `;` printed in a refusal message — each with a
  test that reddens when only that fix is reverted. A sixth, in the test harness rather than the
  gate, was found while cutting this release: the unarmed-gate case raced its own stdin write and
  reddened roughly one full-suite run in six, because an unarmed gate exits without draining
  stdin and the resulting EPIPE had no handler. The gate was correct every time it fired.
- *Distribution:* the Skills CLI resolves this repository's default branch, so the update reaches
  users through `npx skills update --global --yes` with no dist-tag to manage.

## 0.15.0

**What.** The `decision-journal` CLI installs on Node.js 22. `MIN_NODE_MAJOR` in
`skills/decision-journal/scripts/install-cli.mjs` drops from 24 to 22, the esbuild target of the
bundle it installs moves from `node24` to `node22` to match, `packages/agent-journal`'s
`engines.node` becomes `>=22.7.0`, and the skill's `compatibility` line now reads Node.js 22+. A
second CI job runs the package and the committed bundle on Node 22. No skill was added, removed or
renamed; the catalogue still ships twenty-three.

**Why.** Below 24 the installer wrote no command and exited 1. On a machine whose `node` is v22.x
the `agent-journal` CLI was therefore absent from PATH entirely, and the authoring-floor hook that
calls it could not be armed at all — while that same Node ran every subcommand of the bundle
without complaint. The skill was refusing to install itself on a runtime it works on.

The 24 was inherited, not measured. It had been copied from `packages/agent-journal`'s `engines`,
which answers a different question: `engines` is a floor on *developing the TypeScript sources*,
which `npm test` runs under `--experimental-strip-types`, while `MIN_NODE_MAJOR` is a floor on
*running the built JavaScript*, which never meets the type stripper. Nothing had ever run the built
program below 24, so there was no evidence behind the number that excluded those users.

There is now. The bundle was rebuilt at esbuild target `node22` and came out **byte-identical** to
the `node24` build — the target had never been emitting anything 22 could not parse. Runtime
dependencies are `{}`, so no transitive engine claim sits underneath it. And v22.0.0, v22.7.0,
v22.14.0, v22.18.0, v22.22.1 and v22.22.3 each drove the shipped bundle through `record`,
`observe`, `show`, `coverage`, `claims`, `digest`, `trace`, `decay`, `floor`, `invalidate`,
`tombstone` and `compact`, with redaction holding and exit statuses matching Node 24.

Three floors in this repository are deliberately different, and each now says which question it
answers rather than being kept numerically in step:

| Floor | Value | Question |
| --- | --- | --- |
| `MIN_NODE_MAJOR` (installer) | 22 | Can a user *run* the shipped bundle? |
| `packages/agent-journal` `engines` | `>=22.7.0` | Can a contributor *develop* the TypeScript sources? |
| Repository root `engines` | `>=24` | Can `npm run verify` run here? |

The package floor is stricter than the installer's on purpose: v22.6.0's type stripper mangles a
`readonly #field` declaration into a SyntaxError before a single test executes, and no user of the
bundle can reach that path. The repository root stays `>=24` because root `verify` genuinely fails
on 22 — `workspace-governance` has a process-group test that does not pass there.

**Impact.** **Additive, no migration.** No export, flag, command or return shape changed, and no
runtime dependency was added.

- *Who must do something:* **anyone whose `node` is v22.x and who was turned away when they tried to
  install the `decision-journal` CLI.** Re-run `node skills/decision-journal/scripts/install-cli.mjs`
  (or the installed skill's copy) and it will now write the `agent-journal` wrapper and put it on
  PATH. There was nothing to migrate, because the previous attempt installed nothing.
- *Runtime behavior:* unchanged on Node 24. The emitted bundle is byte-identical to the one 0.14.0
  shipped, so an existing install that already works keeps behaving exactly as it did.
- *Blast radius:* limited to the `decision-journal` CLI installer and `agent-journal`'s development
  floor. Twenty-two other skills are untouched. The skill's frontmatter `description` did not
  change, so nothing an agent selects on moved.
- *Contributors:* unaffected either way. `npm run verify` at the repository root still requires
  Node.js 24 or newer, as `CONTRIBUTING.md` and the release checklist state.
- *Distribution:* the Skills CLI resolves this repository's default branch, so the update reaches
  users through `npx skills update --global --yes` with no dist-tag to manage.
- *CI:* a new `journal-node-floor` job runs on Node 22 and does two things the Node-24 `verify` job
  cannot see — it runs `agent-journal`'s own verify against the **sources**, catching a 24-only API
  a contributor might reach for, and it drives the **committed bundle** through record, observe,
  show, digest and coverage, which is what a user actually runs. That second gap is how this floor
  came to be 24 unmeasured in the first place.

## 0.14.0

**What.** Fourteen skill descriptions rewritten to name the situation an agent finds itself in
rather than the capability it provides; three broken hand-offs between skills corrected; and
`workspace-governance` now declares the platforms its read-only surface actually runs on.

**Why.** A skill is chosen by an agent reading a list of one-line descriptions — the body is only
read *after* selection, so the description is the entire selection surface. The investment in this
pack was inverted: every skill carries an excellent, situation-shaped `## When to Use` list in its
body, in the words a user would actually type ("Someone asks for a what's-new popup", "A deletion
looks safe — 'nothing calls this' is about to be load-bearing"), while the description stated a
capability in house vocabulary nobody would search for. Twelve of twenty-three had a "Use when…"
clause; those were the ones that got selected.

The hand-offs mattered for a different reason: `release-ledger` pointed single release notes at
`describe-changes`, which covers one CHANGE and carries no release machinery at all — no semver
decision, no dist-tag, no forge Release. That one wrong sentence made three distinct skills look
like duplicates of each other.

`workspace-governance` declared `platforms: [linux]` and called macOS "expected but untested",
while its whole read-only surface — validate, catalog, explain, workflow, discover, report, plan,
audit, verify-plan — runs correctly on darwin, and the package's own 79 tests pass there. It was a
skill excluding itself from a machine it works on. The corrected text distinguishes the two real
Linux gates rather than flipping the flag: `manifest-init-plan` and `manifest-init-trial-plan`
require Linux x86_64, `mutation-status` requires Linux on any architecture, and no procedure step
in the skill reaches any of them.

**Impact.** Additive, no migration. Same twenty-three skills; nothing renamed, removed or merged.
An update changes what an agent sees when choosing, and makes `workspace-governance` selectable on
macOS. Existing installs keep working unchanged.

## 0.13.1

**What.** Every runnable script in the pack ran nothing and exited 0 when it was reached through a
symlink. Seven sites; four now share one `isEntrypoint` helper per shippable unit.

**Why.** The Skills CLI installs this pack by symlink — `~/.claude/skills/<name>` points into
`~/.agents/skills/` — and every script gated `main()` on
`pathToFileURL(process.argv[1]).href === import.meta.url`. Through a symlink those differ:
`process.argv[1]` keeps the path as typed, `import.meta.url` is the file Node resolved it to. So the
guard was false, `main()` never ran, and the process exited **0 with no output**. A user who followed
the documented install command had no hook installed and no way to tell.

That is the failure class v0.13.0 closed in the freshness checker — *"where silence is the healthy
signal, a failure that renders as silence reads as health"* — left standing in the script that
installs it. Two sites were worse than the installer: `check-pack-freshness.mjs` is the file the
`SessionStart` hook runs, and this pack defines its silence as "your pack is current", so a checker
that never ran reported every pack as fresh forever; and `verify-effective-uid.mjs` is the
privilege-boundary verifier behind `npm run verify:governance`, which used a form that also breaks for
any path containing a space.

Resolving only `process.argv[1]` would have been half a fix: under `--preserve-symlinks-main` the
situation inverts, and `fs.realpathSync` returns a mis-cased path as typed, so on macOS
`~/.claude/Skills/...` would still have no-opped. Both sides are resolved, with
`fs.realpathSync.native`.

**Impact.** Additive fix, no interface change, no migration. **Anyone who ran an install command
through a `~/.claude/skills/...` path has no hook installed** and must re-run it; confirm with
`grep -c check-pack-freshness ~/.claude/settings.json`, because the exit code was 0 throughout and
proves nothing. A new `test/entrypoint-guard.test.mjs` invokes through a real symlink and carries a
pack-wide sweep so the per-unit copies cannot drift.

## 0.13.0

**What.** Two hooks that run outside the conversation. A new, user-installable Claude Code
`Stop` gate for `report-progress` (`adapters/claude-code/report-progress-gate.mjs`, with
`install-report-progress-gate.mjs` beside it) that holds a turn open for one more round when
that turn dispatched a subagent and the final message carries no progress report. And a
delivery fix in the freshness check `update-agent-skills` carries: a new `--hook` flag that
emits a `SessionStart` `hookSpecificOutput.additionalContext` envelope, `notify` turned
synchronous, and every verdict — drift and `unknown` alike — written to stdout. No skill was
added, removed or renamed; the catalogue still ships twenty-three.

**Why.** A skill is instructions, and instructions get skipped in silence on exactly the turns
where that costs most: the user has stopped reading, children are still running, and the whole
final message is "the subagent came back with done." `skills/report-progress` already fixes the
shape of the report; nothing made producing one anything other than optional. The gate is the
half that is not instructions — string matching in a hook, with no model in the enforcement
path, so there is nothing there to talk round.

The freshness fix exists because a notifier that could not determine an answer was reporting
silence, and silence is its healthy signal. An unreadable lockfile, an unreachable source or a
crash inside the checker wrote a line to stderr and exited 0, while the `SessionStart` hook
acted only on exit 2 — so a failed check produced exactly what a current pack produces:
nothing. The skill's own text names that failure ("where silence is the healthy signal, a
failure that renders as silence reads as health") and shipped it inside the implementation of
the sentence naming it. Delivery no longer rides on the exit code, because the exit code cannot
carry it: on this harness a synchronous `SessionStart` hook that exits 2 discards the stdout
exit 0 would have delivered, and an asynchronous one delivers nothing on exit 0 — which is the
code an undetermined check returns. Neither shape could announce "I could not tell". The
channels were probed on the installed binary before anything was built on them, and the runs
are recorded in `adapters/HOOK-OUTPUT-NOTES.md`.

**Impact.** **Additive.** **No migration**, and nothing changes for a user who installs neither
hook. No skill's name or frontmatter `description` changed, no export or return shape changed,
and no runtime package was touched. Two `SKILL.md` bodies gained text: `report-progress`
describes the gate and names it in its `compatibility` line, and `update-agent-skills`
documents the new delivery and the caveat that a tree hash is different, never newer.

- *Blast radius:* the gate is off until a human runs its installer and gone when they run it
  with `--remove`. It lives in this repository rather than inside the skill — `npx skills add`
  copies `skills/report-progress/SKILL.md` and nothing else — so installing the pack does not
  install it and cannot.
- *Runtime behavior:* one thing does change without being asked for. A `SessionStart` freshness
  hook installed before this release keeps the command string it was written with, so it keeps
  reporting drift but still cannot carry an `unknown` verdict; re-running
  `install-freshness-hook.mjs` rewrites the entry and is the whole migration. Freshly installed
  `notify` hooks are now synchronous: the session waits for the check, roughly ten seconds cold
  (two requests fenced at five seconds each) and a process spawn when cached. That cost buys a
  report that arrives.
- *What the gate cannot do, stated because over-trusting it is the risk:* it checks the SHAPE
  of a report and never whether anything in it is true — it cannot tell whether `npm test` was
  run, whether `child-7f2` exists, or whether "40s ago" was observed. It acts at most once per
  turn and then stands down, because Claude Code ends a turn after 8 consecutive `Stop` blocks
  and that budget is shared with every other `Stop` hook on the machine. Its marker is keyed by
  session, so a turn that dispatched a subagent and then died without a `Stop` leaves it behind
  and the next turn in that session pays one block for a dispatch it did not make.
- *Dependencies:* none added. `engines.node` remains `>=24`, required to run this repository's
  verification rather than to use the skills.
- *Downstream surfacing:* `README.md` gains an "Optional hooks (adapters)" section,
  `docs/architecture.md` an "Adapters and hooks" boundary, `docs/composition.md` the note that
  the gate carries `agent-lifecycle`'s no-evidence sentence as a shared constant, and
  `CONTRIBUTING.md` the rules for changing anything under `adapters/`. `docs/releases.md`
  carries the reader-facing prose for the tag.

## 0.12.0

**What.** Six new skills, taking the catalogue from seventeen to twenty-three:
`report-progress`, `work-in-external-repo`, `workspace-governance`, `decision-journal`,
`delphi-ground` and `delphi-imagine`; plus two new packages, `agent-journal` and
`workspace-governance`. Also a test-only fix that makes `npm run verify` pass on macOS.

**Why.** Four of these six have been on `main` since before v0.10.0 with no release announcing
them — v0.11.0 was bumped but never tagged, so `workspace-governance`, `decision-journal`,
`delphi-ground` and `delphi-imagine` were installable but unannounced. This release closes that
gap and adds two more.

The two new ones come from an observed failure each. `report-progress` exists because long
agent work fails its reader in one of two ways — silence, or fluent narration that relays a
child agent's "all tests pass" as though the reporter had watched it run — and neither is
visible to the person reading it. `work-in-external-repo` exists because every failure mode of
working in another repository is quiet: a checkout hundreds of commits behind its origin looks
normal from the inside, and two agents sharing one worktree can silently revert each other.

The macOS fix matters for this document's own process. `docs/releases.md` step 3 asks for
`npm run verify` on Node 24+, and thirty-one of seventy-two `workspace-governance` tests had
been failing on every macOS machine since that package landed. CI runs Linux, where `/var` is a
real directory rather than a symlink to `/private/var`, so nothing could see it.

**Impact.** **Additive.** No existing skill's name, description, guidance or contract changed;
no export, flag or return shape changed. **No migration** — existing installs keep working and
existing call sites are unchanged.

- *Blast radius:* anyone who installed from this pack before v0.10.0 gains six skills on their
  next update. Nobody loses one. No skill was removed or renamed, so no local copy becomes a
  removal candidate.
- *Runtime behavior:* unchanged for consumers. The macOS fix touches only `test/` and
  `scripts/verify-package.mjs`; no file under any `src/` changed, and on Linux the fix is the
  identity function (`realpath` of a path with no symlink ancestors returns that same path).
  Contributors on macOS go from a `verify` that cannot pass to one that does.
- *Distribution:* the Skills CLI resolves this repository's default branch, so an update reaches
  users through `npx skills update --global --yes` with no dist-tag to manage. `--agent '*'`
  covers only the agents the installed CLI supports; native plugin, manual-upload and remote
  planes are independent targets with their own freshness.
- *Dependencies:* none added. `engines.node` remains `>=24` — required to run this repository's
  verification, not to use the skills.
- *Downstream surfacing:* `README.md`, `docs/architecture.md` and `docs/composition.md` all
  state the catalogue size and were updated to twenty-three in the same change; a test asserts
  the count so the claim cannot drift.
