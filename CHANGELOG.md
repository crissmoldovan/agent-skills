# Changelog

Per-version record of what shipped. The public, reader-facing changelog is the
[GitHub Releases](https://github.com/crissmoldovan/agent-skills/releases) page, whose bodies
mirror these entries; `docs/releases.md` carries the release process and the staged prose for
the next version. Entries before v0.12.0 live only on the Releases page.

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
