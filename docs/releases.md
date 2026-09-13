# Releases

## Published catalog

This public catalog ships `model-routing`, `agent-lifecycle`, `blocks`,
`request-blocks-review`, `secure-credential-setup`, `derive-codebase-context`,
`publish-agent-skill`, `update-agent-skills`, `release-ledger`, `github-webhooks`,
`describe-changes`, `release-notes`, `investigate-codebase`, `blast-area`,
`visualise-blast-area`, `decision-journal`, `delphi-ground`, `delphi-imagine`, `land-complex-change`,
`resolve-problem-report`, `new-ux-discovery`, `workspace-governance`, `report-progress`,
and `work-in-external-repo`, plus the canonical lifecycle runtime package under
`packages/agent-lifecycle`, the journal runtime package under `packages/agent-journal`,
and the separately installable workspace-governance CLI package under
`packages/workspace-governance`.

Routing and lifecycle compose as documented in [the composition guide](composition.md).
`blocks` is independent review tooling. `release-ledger`, `github-webhooks`,
`describe-changes`, and `release-notes` compose as release orchestration, capture,
entry authoring, and the note for one version, while each remains usable alone.
`release-notes` is the one that makes the semver call and places the note in every
destination the project records releases in; it carries an optional Claude Code
`PreToolUse` gate under `adapters/claude-code/` that refuses a release whose version
no release-note file mentions, and, like every hook in this pack, the user installs
it and nothing installs it for them. `investigate-codebase`, `blast-area`,
`visualise-blast-area`, `land-complex-change`, `resolve-problem-report`, and
`new-ux-discovery` compose the same way over evidence, change mapping and contained
delivery, each naming the sibling that owns the adjacent job and each usable alone.

`decision-journal` records why a decision was made, anchored to evidence a reader can
check, and stands alone. It carries its own CLI as `scripts/agent-journal.mjs`, bundled
from `packages/agent-journal` by `npm --prefix packages/agent-journal run bundle:skill`
and checked against that source by `npm run verify`; `scripts/install-cli.mjs` puts it
on PATH. `delphi-ground` builds a verified-facts briefing, and
`delphi-imagine` reviews an artefact against it from named perspectives.

`report-progress` and `work-in-external-repo` are workflow skills that sit beside the
delivery family rather than inside it. `report-progress` owns the shape of what the reader
is told during long work and reads `agent-lifecycle` for its "what is running" section;
`work-in-external-repo` owns the route to a target repository and the tree the work happens
in, and hands over to `land-complex-change` once that tree is right. Both are usable alone.

## Unreleased

Prose for the next catalogue release. Nothing below is published until the version is
bumped, the branch is merged, and a tag carries these notes.

**What.** `adapters/claude-code/release-notes-gate.sh` reads quoted text as data rather than
as shell structure, and works out the run directory from the `cd` that runs *before* the
release verb rather than from the last one on the line. Every detector over the normalised
command is anchored to a command position, every extractor reads the invocation that matched
rather than the whole line — one invocation and no more — the file measures offsets in one
unit, and the quoting pass costs what the pass it replaced cost.
`test/release-notes-gate.test.mjs` grows from 52 tests to 78.

**Why.** The known false refusal recorded in the 0.16.0 notes was the whole family, not one
case. `START`/`END` matched CHARACTERS, so any `;`, `|`, `&` or `(` in front of a release verb
put that verb at what the gate read as a command position — including when every one of those
characters sat inside a quoted string. `git commit -m "fixes the crash; npm publish now
works"`, `git commit -m "see README (npm publish)"` and `gh issue comment -b "workaround:
(pnpm publish)"` were all DENIED in `block` mode, as was any commit whose message ran to a
second line with a release verb on it. A commit message that mentions a publish step is
ordinary work, and a false denial is the one outcome this gate's header says it cannot afford.

The same character-reading produced two more defects in `run_dir_for`, both now closed:
`npm publish && cd <other-repo>` was judged against `<other-repo>` — a second false denial,
naming a repository with nothing to do with the release — and a `cd` written inside a commit
message hijacked the run directory, where an unresolvable one (`git commit -m "wip; cd
/nonexistent"`) switched the bump check off for that commit entirely.

Fixing the detectors did not fix the rest of the file, and six more defects were found
afterwards over four further rounds — four of them live in 0.16.0 as shipped. Five are the
same family; the last is not, and is listed here because it is a false denial of exactly the
kind this work exists to remove:

- *`gh|glab release create` was matched with no anchor at all*, while every other branch
  anchored — the same omission `changeset publish` shipped with, three rounds earlier. It
  refused prose (`echo "then run gh release create v9.9.9 to ship"`, a false denial in
  0.16.0 too) and, because that branch runs before the version-bump check and exits either
  way, it also **allowed an unnoted version bump** whenever the commit message happened to
  contain those four words. The byte-identical commit without them was correctly refused.
- *The tag and release-tag extractors read versions out of quoted prose.* A greedy,
  unanchored strip took the last version-looking token anywhere on the line: `git tag v1.4.0
  -m "supersedes the old git tag v9.9.9 line"` refused v9.9.9 — a version nobody is releasing
  and no note can ever satisfy — and `git tag v9.9.9 -m "replaces git tag v1.0.0"` read
  v1.0.0, found its note, and **cut an unnoted release**. Both are live in 0.16.0. The `-C`
  that decides which repository is judged was read the same way. An earlier revision of this
  note said that one was "bounded too"; it was bounded on the tag path only, and the commit
  path — the `-C` that picks whose index a version-bump commit is judged against — stayed a
  greedy whole-line read for one more round. It failed in all three directions, all live in
  0.16.0: `git -C <clean> commit -m "explain how git commit hooks work"` walked past the real
  `-C` and refused the commit against a bump staged in a repository the command never touches,
  while the byte-identical message without those two words was allowed; `git commit -m "see
  git -C <other> commit for how"` judged a clean checkout against `<other>`'s staged bump; and
  prose naming a `-C` that does not exist made the directory unresolvable, which exits the
  branch — so **a real unnoted bump walked through**. Both paths read their `-C` out of the
  invocation that matched now.
- *A byte offset was applied as a character substring.* The cut that stops the run-directory
  scan at the release verb took its offset from `grep -Eob` (bytes) and applied it with
  `${seg:0:$off}` (characters, under a multibyte `LC_CTYPE`), so past roughly 18 CJK
  characters, 12 emoji or 14 em dashes in front of the verb the fix above silently reverted —
  and reverted **only under a UTF-8 locale**, which is the locale most interactive shells
  run. The file now pins `LC_ALL=C`, so both are measured in bytes by construction.
- *The new quoting pass was quadratic, and the first repair did not finish the job.*
  Rebuilding the command one character at a time cost 1025ms on a 128KB command against 58ms
  for 0.16.0, on a hook that runs before **every** Bash tool call. Running over runs rather
  than characters fixed that for inert, metacharacter and many-line input — the three shapes
  the scaling test drove — and left the pass **still superlinear on the shape it exists for**:
  many short quoted spans cost 128KB 97ms, 256KB 256ms, 512KB 1398ms, four times the input for
  fourteen times the time, which at 512KB made `curl -d "{JSON}"` 5747ms against 204ms for
  0.16.0. Neither cause was in the algorithm. Writing each run with `print` under `ORS=""`
  instead of `printf`, and walking the record in fixed 4KB pieces with the parser's two
  carried states crossing the seams, give 128KB 60ms, 256KB 119ms, 512KB 231ms, 1MB 468ms — a
  doubling per doubling — with byte-identical output to the previous pass on all 5040 inputs of
  a fuzz corpus over the alphabet that can change parsing state, including inputs long enough
  to cross a piece boundary. What remains, stated rather than rounded away: a command with no
  release verb costs what it did in 0.16.0, and quote-dense commands stay roughly **twice** as
  dear (512KB 478ms against 255ms, end to end). That factor is what reading quoted text as data
  costs at all, and it does not go away.
- *A fragment could cover two invocations, so the FIRST one decided.* Each extractor cut its
  fragment as `grep -Eo "${START}${VERB}${END}[^;&|)]*"`, and `END` accepts a separator
  character — which it matches exactly when the verb abuts one, i.e. for an invocation with
  no arguments of its own. The trailing `[^;&|)]*` then began on the far side of that
  separator and ran on into the next invocation, `grep` consumed both as one match so
  `tail -1` had nothing left to choose between, and the `^`-anchored strip inside read the
  first. "The last invocation wins" — the rule every one of these branches claims — was
  broken by writing an argument-less invocation of the same verb in front of the real one,
  in all three branches that use that shape and in every direction:
  `gh release create;gh release create v9.9.9` read no version at all, so the branch exited
  and **an unnoted release was allowed** — a fail-open in the headline verb;
  `git commit;git -C <other> commit -m x` judged the session's index instead of `<other>`'s,
  the reverse order judged `<other>`'s instead of the session's, and an unresolvable `-C` in
  front **switched the bump check off** exactly as prose naming one used to; and
  `pnpm --filter <pkg> publish;pnpm publish` handed the member's package to the root's
  publish, found the member's note and **allowed the root's unnoted release** — that last one
  live in 0.16.0, where every other shape of it happens to come out right. All three now cut
  the command into invocations first and select among whole ones, which is the one thing a
  tokenizer would have given structurally, at four lines and no new dialect. The rule is
  asserted as a property over all four branches rather than as three cases, with the tag
  branch — immune because its verb pattern ends in ` +` — in the table as the control.
- *A version carrying any regex metacharacter but `.` was matched as a pattern.* The note
  lookup escaped `.` and stopped, so a package at the legal semver `1.0.0+build.7` was refused
  with "never mentions 1.0.0+build.7" while the changelog said exactly that — being accused of
  not having written the note you are looking at is the worst shape a false denial takes. Live
  in 0.16.0. The whole metacharacter set is escaped now.

**Impact.** **Additive, no migration**; nobody has to do anything. The gate ships off, the
installer is unchanged, and an armed install simply stops refusing work it should never have
refused. Four things are worth knowing:

- *What this gives up, on purpose:* a release that reaches the shell as a **string** is
  under-blocked, in four shapes — `sh -c "build; npm publish"` and its `bash -lc` / `ssh host`
  cousins; a command substitution inside double quotes, `echo "$(npm publish)"` and
  `OUT="$(npm publish --tag next)"`; backticks; and any command carrying an **unbalanced**
  quote, such as a heredoc body containing `it's`, which disarms every detector for the rest
  of that command. The middle two are the ones an earlier draft of these notes left unsaid,
  and they are the ones where bash genuinely runs the publish. All four join the list the
  adapter README publishes beside `sudo npm publish`, `time npm publish`,
  `NPM_CONFIG_TAG=next npm publish`, `git tag -f` and `gh release create --draft`. Measured
  against 0.16.0 almost all of that was already unblocked; the shape genuinely lost is
  `sh -c "build; npm publish --tag next"`, which 0.16.0 refused — for precisely the reading
  that refused the commit messages above, so the two could not be kept apart. The gate's own
  header decides which way that goes.
- *The heredoc trade now runs both ways.* A heredoc body line still reads as a command, so a
  body beginning with a release verb over-blocks; a body containing an ordinary apostrophe
  under-blocks the rest of the command. Which one a given heredoc gets depends on its
  punctuation. Both are now written down in the same paragraph, in the gate and in the
  adapter README, and neither is narrowed here.
- *One behaviour change beyond the bug fixes:* the `gh|glab release create` fragment is now
  cut at the next shell separator, where 0.16.0 deliberately read to end of line so a `--repo`
  hiding behind a quoted `--notes "a && b"` would not be lost. That reason is gone — the
  quoting pass blanks that `&&` before any of this runs — and reading a later command's
  `--repo` as this release's is the pairing bug the same branch already fixed once.
- *What it does not give up:* the cheap repair — blanking quoted spans before matching — would
  have passed every case above and lost the releases that are merely quoted. `npm "publish"`
  and `git tag "v1.4.0"` are gated, and `npm "publish"` is in fact newly gated, because
  quoting removes a character's power to act as structure without turning a command into a
  comment.

## Release checklist

1. Confirm every new or changed skill is under `skills/<name>/SKILL.md`.
2. Update the repository catalogue README with the exact frontmatter description,
   install coordinates, and update guidance.
3. Run `npm run verify` with Node.js 24 or newer.
4. Review all content against the [public-content policy](public-content-policy.md).
5. Merge through a reviewed pull request after CI succeeds.
6. Tag and publish human-readable GitHub Release notes explaining outcomes,
   compatibility/migration, who should update, and exact update action.
7. Read back main, release, installer discovery, and isolated installation before
   encouraging humans or agents to update.

## Versioning

The repository version records public catalog releases. Use semantic impact:
major for broken existing guidance/contracts, minor for new skills or substantive
new guidance, and patch for corrections within an already-correct contract.

## Changelog and update communication

GitHub Releases are the public changelog. A tag or generated diff is not release
notes. [`CHANGELOG.md`](../CHANGELOG.md) carries the same entry per version inside the
repository, so `git log` alone answers what shipped in which version; a Release body and
its changelog entry must agree. Notes must explain end-user behavior and exact update instructions.
Repository README and agent-facing update prompts must agree with the published
catalogue. Encouraging an update never authorizes mutation of a user's machine;
local synchronization remains an explicit target handled by `update-agent-skills`.

Release notes reach a reader only if they learn the release happened.
`update-agent-skills` carries a read-only freshness check that compares an
installed pack against the published tree and prints the stale skills, the latest
release, and the exact scoped command, plus an installer for an optional
`SessionStart` hook that runs it. The check never invokes the Skills CLI, whose
`check` is a mutating alias for `update`. Every verdict it has is printed as text
on stdout and delivered to the session on exit 0 — drift, and equally the
`unknown` it returns when it could not determine anything at all. An exit code
that means both "current" and "could not tell" can announce neither, and a check
whose healthy signal is silence must never let a failure render as silence. Its
notify mode reports and stops;
installing its auto mode is the user's standing consent to update that source at
that scope, and is withdrawn by removing the hook. Announcement remains
communication, and mutation remains something a user asks for. The update-check
design—asymmetric cache lifetimes, a fenced network call, and the split between
notifying and applying—is informed by garrytan/gstack's update-check design.

Future publication work is tracked in the [roadmap](roadmap.md); roadmap items
must not be described as shipped until implemented and verified.
