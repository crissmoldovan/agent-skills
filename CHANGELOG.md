# Changelog

Per-version record of what shipped. The public, reader-facing changelog is the
[GitHub Releases](https://github.com/crissmoldovan/agent-skills/releases) page, whose bodies
mirror these entries; `docs/releases.md` carries the release process and the staged prose for
the next version. Entries before v0.12.0 live only on the Releases page.

## 0.24.1

**What.** Three skills separate their worked specimens from their asks:
`handoff-prompt`, `report-progress` and `work-in-external-repo`. Each gains a
`## What it looks like` section holding the specimens, and `## Usage Examples` is left
holding only things a reader can use. In `work-in-external-repo` the end-to-end git
sequence also changes fence from `text` to `bash`, which is what it always was. No
guidance changed and no wording inside any example changed. The other twenty-six skills
are untouched.

**Why.** `## Usage Examples` answers one question: how to use the skill. These three had
been answering two under that heading, because each ends with worked specimens — a good
report and a bad one, a good handoff and the version that usually arrives, a command
sequence and the result it should produce. A specimen of output is not a way to use the
skill, and the heading did not distinguish them.

It showed up downstream. A consumer reading every `text` block under the heading as a
prompt published `handoff-prompt`'s deliberate anti-example — the one the skill annotates
"it cannot be sent at all" — as something to say to make the skill fire. A reader copying
it pasted the exact text the skill exists to prevent. The same consumer published
`work-in-external-repo`'s git sequence as a prompt, because a shell script fenced as
`text` is indistinguishable from prose meant for an agent. Both consumers were reading
the structure correctly; the structure was wrong.

**How it behaves.** `## Usage Examples` now holds prompts and, where there are any,
runnable commands: three asks in `handoff-prompt`, three in `report-progress`, and four
plus the shell sequence in `work-in-external-repo`. The specimens keep their own
subheadings verbatim under `## What it looks like`, which opens with one line saying what
they are. `agent-lifecycle` and `model-routing`, which deliberately give every ask its own
`###` subheading, are unchanged — that shape was never ambiguous.

`test/work-in-external-repo.test.mjs` now asserts the asks and the shell sequence
separately, and fails with "expected a runnable shell sequence, found 0" if the fence is
ever mislabelled `text` again.

**Who should update.** Anyone who parses `## Usage Examples` to extract prompts, and
anyone republishing the pack's examples: the section now yields prompts and commands, and
the specimens are somewhere they cannot be mistaken for either. No action for a reader or
an agent loading these skills — the guidance, the procedures and the verification
checklists are byte-identical.

## 0.24.0

**What.** One new skill, `handoff-prompt` (skill version 1.0.0): how to write work that is
going to another session, agent or person as one block they can copy without editing.
Nothing else in the pack changed: no gate, installer, adapter or other skill.

**Why.** Work moves between contexts constantly and it moves as prose written for whoever
was in the room. Two failures do most of the damage. The first is reference instead of
restatement — "apply the fix we discussed to that component" — where every noun resolves
only in a conversation the receiver cannot see. The second is the unpasteable deliverable,
where the handoff arrives interleaved with commentary to the sender, so there is no
contiguous region to select and the sender edits by hand; edits are where scope quietly
changes. The request that prompted it was narrower — *stop making me ask for a code block*
— but the block is the smallest part of the problem.

**How it behaves.** The block is the deliverable: everything the receiver needs is inside
one fence, everything the sender needs in order to decide whether to send it stays above.
Context is restated rather than referenced, each claim carries where it came from and each
judgement is labelled as one, scope comes with at least one non-goal, and machine-local
paths, session identifiers and anything secret are stripped, because a handoff is a paste
into a destination the sender does not control. The fence is chosen longer than the longest
backtick run inside it, which is the defect that silently truncates a handoff about code.
`references/handoff-contract.md` carries the block's anatomy, the fence rules in full, and
variants for a feature request, an agent brief and a session handover.

It sits beside two neighbours rather than inside them: `request-answers` is for a question
you need answered back, this is for work you are handing away; and `work-in-external-repo`
writes into another repository, where this only produces the ask.

## 0.23.0

**What.** One new skill, `request-answers` (skill version 1.0.0): how to ask when work
needs something only another person or agent can give. It drops every question that can be
answered from the system under discussion, then sends one brief whose answer sheet can be
replied to in a single block, at `brief`, `normal` or `deep` depth. Nothing else in the pack
changed: no gate, installer, adapter or other skill.

**Why.** The catalog had no skill for the ask itself. `decision-journal` records why a
decision was made, `report-progress` says where work stands, and `delphi-ground` builds the
facts before anyone reasons — but nothing covered the request that unblocks work, which is
where days are lost. On the run it was written from, twelve queued questions across four
owners became three once each was tested against the data, and the one blocked stakeholder
received sixteen decisions as a single answer sheet.

**How it behaves.** The iron rule is never to ask what you can answer yourself, and the
ledger records those self-answers with their evidence so the question is not re-asked.
Depth is chosen from what the recipient needs, and the answer sheet is answerable on its own
at every depth. An agent recipient gets the same sheet plus a one-line reply contract and is
asked to name the file or command behind its answer.

## 0.22.1

**What.** A patch to `onboard-project` (skill version 1.0.1) that fixes the thirteen distinct defects
an adversarial review of 0.22.0 confirmed — nineteen findings that each survived three independent
attempts at refutation, several describing the same defect, and one of them found independently by
running the scan on a real repository — plus three smaller gaps found while fixing them, and one
correction to the 0.21.1 notes. Nothing else in the pack changed: no gate, installer, adapter or
other skill.

**Why.** 0.22.0 shipped with its session-start check armed on at least one machine, and several of
these defects make that check say something untrue, or make the scan recommend a skill for a
reason that is not the case. In order of how much they mislead:

- **A named file could be reported missing while it sat in the repository.** `exists` and `missing`
  were answered from a case-sensitive list of paths gathered by a bounded walk. On a
  case-insensitive volume — macOS by default — a repository whose context file is `claude.md`
  got the evidence line "CLAUDE.md is not in this repository", and was recommended the skill whose
  whole job is a repository with no context file. A named path is now asked of the filesystem.
- **Anything a bounded scan did not reach read as absent.** Past twenty thousand files, below twelve
  levels, or beyond grep's budget, a signal that found nothing was reported false, printed as
  evidence and hashed into the fingerprint. A bound now makes a signal *unknown*: it neither matches
  nor rules a skill out, and never moves what the check compares. A history count read only in part
  is a lower bound in the same way.
- **The check reported "this repository's evidence has changed" when only the catalogue had.** The
  fingerprint covered every skill in the catalogue, so installing or updating any skill with a
  `fit.json` tripped it. The profile now records, per skill, the signals it was evaluated on and the
  ones that were true, and the check compares only signals both the profile and the installed fit
  define — so neither a new skill nor an edited signal is blamed on the repository.
- **One unrelated file could flip a grep signal.** Grep read the first 400 candidates in walk order;
  a match past that window was missed, so adding a file ahead of it moved the fingerprint. The scan
  now stops at the first match anywhere and names that file as the evidence, which is also more
  useful to read than a count that was never a count over the globs it named.
- **Refresh silently dropped listed skills.** The profile was rebuilt from the current scan alone,
  so a skill whose evidence had gone — or a weak one nobody re-passed — vanished from the profile and
  the routing file with no row and no word. A listed skill is now kept: a `-` row says its evidence
  is gone and how to remove it (`--drop`), a `?` row says its evidence cannot be read on this machine.
- **`land-complex-change` could never match on its migrations signal.** A directory pattern with a
  wildcard, `**/migrations/`, was compared as literal text. Directory patterns are globs now.
- **The routing file's order depended on the machine's locale** (`localeCompare`), so two machines
  rendered one profile two ways and each reported the other's committed file as drift. Code-point
  order.
- **Two repositories could share one local profile.** Claude Code's path encoding makes
  `work/foo-bar` and `work/foo/bar` one name. Local file names now carry a hash of the full path, a
  local profile records its repository, and one naming another — or naming none, as every 0.22.0
  local profile does — is never read.
- **In a git worktree, placement said "no origin remote"**, because the worktree's own gitdir holds
  no config. The shared config is read now, and the exclude line goes to the shared exclude file.
- **A failed `.git/info/exclude` write was silent** and apply exited 0; **a failed write was
  followed by the full install and hook list**, which an agent following printed instructions would
  have run; **the exclude write was not in the change list** the user says yes to; and **the check's
  one-time marker was read by `plan` as a recorded placement**. Each is fixed: a failure stops apply
  with a non-zero exit and prints no commands, the exclude line is a row with its undo, and the
  marker is never read as a profile.

The three smaller gaps: two promises the skill text made and the code did not keep are kept now — a routing file edited by
hand is shown as the lines that would change before it is rewritten, and "don't ask again" has a
command, `apply --decline <names>`. And the scan no longer takes evidence from tool-owned build
output — on the repository that surfaced the case bug, a grep evidence line had named a file under
`.trigger/tmp/build-…/`.

**Correction to 0.21.1.** Its notes said the report-progress refusal "opens by naming the skill". It
does not: the refusal opens with the gate's own line and what is missing, and names the skill
immediately after that, before the shape it describes. The behaviour was as shipped; the sentence
describing it was wrong, and has been corrected in the 0.21.1 entry and its release.

**Impact.** **Patch. No migration is required; one refresh is recommended.**

- **If you onboarded a repository with 0.22.0 and committed the profile**, run the skill's refresh
  once there. A 0.22.0 profile has no per-skill evidence, so until a refresh writes it the check
  makes no evidence comparison — it keeps checking installed skills and the routing file.
- **If you onboarded a repository with 0.22.0 and kept it local**, run the skill there again. A
  0.22.0 local profile is not read: its file name is the one that collided, and it records no
  repository, so nothing can say which repository wrote it. The check will suggest onboarding once.
  The old file, under `~/.agents/project-profiles/`, can be deleted.
- **The session-start hook needs no re-arming.** It runs the installed script by path, so updating
  the skill updates what runs.
- **What reads differently:** grep evidence names the first matching file rather than a count, and a
  grep that had to skip a file for its size reads as unknown when it finds nothing; the
  change list for a local placement in a git repository has a third `~` row for
  `.git/info/exclude`; refresh can show `-` and `?` rows; apply accepts `--drop` and `--decline`;
  a failed apply exits 1 and prints no install or hook command.
- **Blast radius:** anyone who installed `onboard-project` from 0.22.0, and anyone who armed its
  check. Everything else in the pack is byte-identical to 0.22.0.
- **Dependencies and distribution:** none added or changed. `latest` is correct for this version.
- **Tests:** 630 passing, 0 failing — 30 new or rewritten. All but two were written ahead of the fix
  they cover and seen failing first; the build-output skip and the `?` row were written after theirs.
  The patch was reviewed again before release, and that review's five findings are fixed here too.

## 0.22.0

**What.** One new skill, `onboard-project`, and one new rule behind it: every skill in the pack now
carries `references/fit.json`, and `verify-skills` refuses a skill without one. The skill decides
which skills a repository should use, from evidence in the repository and in how it is worked on,
and writes that decision into two places — `skills-profile.json` beside the Skills CLI's own lock
file, and a generated `.claude/rules/skill-routing.md`. It carries three entry points (`onboard`,
`refresh`, `check`), five scripts, two references, and a `SessionStart` hook with its own installer
that is **off until you arm it**. Minor, by this repository's rule that a new skill is a minor:
twenty-six skills become twenty-seven. Nothing else changed: no adapter, gate, installer or package
export was touched.

**Why.** A skill loads when its description happens to match the task, or when somebody types its
name. That is the whole mechanism — there is no supported way to force-load one, and no frontmatter
field that makes one skill require another. It works until the install base grows: on the machine
this was built for, **201 skills were installed**, and the one a project depends on surfaced by
luck.

Enforcement does not fix that, and the pack's own gate proves it. In real sessions the
`report-progress` gate fired, the turn came back carrying the three headings, and the skill was
never loaded — so everything it exists to carry was absent while the gate's string match passed.
(0.21.1 made that refusal name the skill; this is the other half of the same problem.)

So the fix is not a bigger gate. It is a file every session already reads: a rules file with no
`paths` frontmatter loads at the start of every session at the same priority as the project
CLAUDE.md. Two live headless runs against a real model settle that it works — one where the routing
line came back verbatim from a throwaway repository, one where the check's line arrived as
session-start context — and both are recorded in `adapters/HOOK-OUTPUT-NOTES.md`.

What makes the recommendation checkable is the declared fit. A `fit.json` states where a skill
belongs as **repository signals** (a path present or absent, a manifest field by dotted path, a
bounded grep) and **history signals** (agent dispatches, workflow launches, background commands,
release commands, writes outside the repository) — so each one can be tested both ways against a
fixture, which a description never can. Two rules hold history down: it is read by `onboard` and
`refresh` only, never at session start, because those transcripts run to tens of megabytes; and an
absent history is **unknown**, not zero, so a machine that has never opened a repository cannot
drop a skill for evidence that was never going to be there.

Consent is the shape of the whole thing. Every skill, file and hook is a row in one change list,
each carrying the evidence that justified it and the undo that takes it back. Nothing is written
before one explicit yes. The scripts install nothing at all — `apply` writes the files and prints
the install commands in order for you to run — which keeps the network out of a module the
session-start check also loads, and keeps every install where you can see it. A hook is always its
own row, always marked *affects all projects on this machine*, and never armed on a general yes
about setting a project up.

**Impact.** **Additive. No migration, and existing call sites are unchanged.**

- **Nothing already installed changes behaviour.** No adapter, hook, installer, package export or
  command was touched. An installed copy of the pack gains one skill directory, a `references/fit.json`
  in each of the others, and the catalogue text around them.
- **The new hook is off until you arm it,** and arming it is a command you run:
  `node <skill-folder>/scripts/install-check-hook.mjs`. It writes a `SessionStart` hook on the
  `startup` and `resume` matchers, prints **zero bytes** unless a listed skill is missing, the
  repository's evidence has moved or the routing file has drifted, never blocks, reads no session
  history, and fails open. `--remove` takes it back and leaves the rest of your settings file
  exactly as it found it.
- **For skill authors:** `verify-skills` now fails a skill with no `references/fit.json`, one that
  does not parse, one whose `kind` is outside `signals` / `general` / `requestOnly`, one with no
  `useWhen` line, or a `signals` fit with an empty or unreadable signal list. Anyone carrying a
  private skill in this layout adds one small file per skill;
  `skills/onboard-project/references/fit-signals.md` is the grammar.
- **Blast radius:** anyone updating the pack, plus anyone who then runs the skill in a repository.
  `npx skills update --global --yes` (or `--project`) brings it in; nothing is installed on your
  behalf.
- **Dependencies and distribution:** none added, none changed. `latest` is correct for this version.
- **Runtime behaviour:** unchanged everywhere until you run the skill. What it writes — a profile,
  a rules file, and for a repository kept local one line in `.git/info/exclude` — is listed with its
  undo in `skills/onboard-project/references/what-gets-written.md`.

The design and the implementation plan ship with it, under `docs/superpowers/`.

## 0.21.1

**What.** Two fixes in the `report-progress` Stop gate, both in `adapters/claude-code/report-progress-gate.mjs`.
The refusal it returns now names the skill to load before it describes the shape to write. And a
block that could not be shown is no longer left on record as spent: when the record of the block
lands but the marker beside it fails to write, the record is cleared again rather than kept.
No skill text, installer, hook command, settings shape or package export changed, and no hook
needs re-running.

**Why.** The refusal was teaching the wrong half. Measured in live sessions: the gate fired, the
turn came back carrying the three headings, and the `report-progress` skill was never loaded —
because skills load by description match, and a gate's refusal is not one. The shape passed the
string match while everything the skill exists for was absent: numbers the author checked kept
apart from numbers they were told, the user-facing consequence named, corrections said out loud.
The refusal now names the skill to load right after listing what is missing, and describes the
shape the same way as before, so an agent without
it installed still gets the shape from the message itself.

The second fix closes a silence. The gate's ceiling is two writes — a record of the spent block,
and the marker. They were evaluated in one condition, so a run where the record landed and the
marker did not returned without blocking and kept the record: for the rest of that turn the gate
believed it had already spoken, over a block nobody ever saw. It is the same silence the ceiling
exists to bound, arriving through the door marked "failed write". Reported by a review of
0.20.0 at severity 4; both halves now land or neither counts.

**Impact.** **Patch. No migration, no installer step, and no settings change.**

- **An installed gate picks both fixes up the moment the checkout updates** — an installed hook
  points at a checkout, and neither fix is behind a flag. Nothing about when the gate arms, what it
  checks, or what it writes to `settings.json` changed, so there is no re-install and no
  re-arming.
- **What you will notice:** the refusal message is one paragraph longer, and it starts by telling
  the model to load the skill.
- **Blast radius:** anyone running the report-progress gate in `block` or `observe` mode. In
  `observe` mode the refusal text is not printed at all, so only the record fix applies there.
- **Dependencies and distribution:** none added or changed. `latest` is correct for this version.
- **Runtime behaviour:** unchanged except in the failed-write path, where the gate now clears a
  record it previously kept. `test/report-progress-gate.test.mjs` grows from 119 to 121 tests,
  the two new ones covering exactly these paths.

## 0.21.0

**What.** One new skill, `isolated-change-validation`, and nothing else: no adapter, package,
export or flag changed, and the twenty-five skills already in the pack are byte-identical. It is
for work that must stay **outside** the repository until it is accepted — a change proven in a
sandbox, usually by a delegated agent, before anyone decides whether it may land. It owns the
physical lane and the evidence ladder over it: source identity frozen in a SHA-256 manifest before
the first edit, because in a copied lane with no git those hashes *are* the revision identity; two
path sets — allowed existing and allowed new — that acceptance matches exactly rather than as a
subset; one observed RED per behaviour, watched at the implementation file's hash rather than in
the builder's prose; the typecheck, build, focused, full and downstream gates run by the parent
itself; review on independent axes that fail closed on a source-hash mismatch; and a static scan
that is unfinished while any hit is unclassified. Two carried references hold the depth:
`references/evidence-contract.md` for the artifact shapes, and `references/handoff-bundle.md` for
the bundle an unattended run is transferred in. Minor, by this repository's rule that a new skill
is a minor: twenty-five skills become twenty-six.

**Why.** Two failures kept recurring in real isolated runs, and neither is visible in a diff.

The first is that **a builder's report is a claim**. "1042 passing" survives a run that was
stopped and restarted, an implementation written before its test, a file created outside the
budget, and a suite contaminated by a live-provider call that returned 401 — each still produces a
passing line, and nothing in the report distinguishes them. The ladder here exists so the parent
holds evidence for each claim it repeats: totals parsed from the runner's own machine-readable
output rather than quoted from a child, gates labelled with what they do **not** prove (direct
binaries against an attached dependency tree are source verification, not a clean install), and a
frozen-install record whose first half — argv, non-secret environment paths, empty-store and
empty-dependency-tree preconditions, input hashes — is written *before* the command runs, because
afterwards there is no way to tell a real clean install from a reused tree.

The second is that **a handoff document is not a handoff**. The next agent cannot re-run a
paragraph. What transfers is state: every lane preserved and labelled by acceptance state — the
accepted candidate, the work that runs but never earned a verdict, the dirty working checkout
whose uncommitted work has no reflog, the deltas made in other repositories, and the local
workflow changes that made the run work — plus the runnable artifacts, the evidence, the authority
boundaries, a manifest over all of it, and a verifier the next agent runs before trusting any of
it. A backup that preserves the good lane and silently drops the others reads as complete and is
not.

The skill also carries the package-manager lessons that cost the most time: a filtered
lockfile-only install is **not** importer isolation and can reconcile a workspace importer nobody
touched; a scratch `HOME` changes Corepack resolution and can make a lane you called offline reach
the network; and one pnpm version rejects `--state-dir`, which is why the installed CLI's own help
is read before options are added. Raw secret-scan hits are not findings: each is classified as a
credential-shaped fixture, a documentation example, or a real credential — the last of which stops
the run — and zero unclassified is a release condition, not a preference.

Above all it holds one boundary that a green run erodes: **technical acceptance in a sandbox
authorizes nothing.** Transfer into the repository, a commit or push, a publication, a visibility
change, signing, an account or billing change and a live-provider call are separate acts, each
needing its own authorization, and the verdict artifact keeps a field saying so.

**Impact.** **Additive. No migration, and existing call sites are unchanged.**

- **Nothing already installed changes behaviour.** No adapter, hook, installer, package export or
  command was touched. An installed copy of the pack gains one skill directory and the catalogue
  text around it.
- **The gates are unaffected.** The `report-progress` and `release-notes` hooks, their installers
  and their recognised command shapes are byte-identical to 0.20.0; there is no installer to re-run
  for this release.
- **Blast radius:** anyone updating the pack. `npx skills update --global --yes` (or `--project`)
  brings the new skill in; nothing is installed on your behalf.
- **Dependencies and distribution:** none added, none changed. `latest` is correct for this
  version.
- **Runtime behaviour:** unchanged everywhere. The new skill is instructions; it runs when an agent
  loads it and never on its own.
- The skill is loaded by description, like every other: it surfaces on *prove this in a sandbox*,
  *the agent says the tests pass*, *the scratch tree has no git*, *an overnight run someone else
  picks up*, and *keep the accepted candidate somewhere it cannot be lost*. For a change you are
  landing in the repository now, `land-complex-change` is still the skill; this one runs before it,
  in a tree that is not the repository.

Upstreamed from a local skill through issue #54, taking only the reusable workflow lessons: no
project paths, private evidence, machine details or organisation names, which a catalogue test now
asserts.

## 0.20.0

**If a gate installer stopped recognising your hooks, re-run it with no flag.** Claude Code drops the
`describe` key from every hook entry whenever it rewrites `settings.json`, and both gate installers
recognised their hooks by that key. They now recognise them by the command, which the harness keeps
byte for byte. Run either installer again from an up-to-date checkout of this repository, with no
flag, and it keeps your hooks, their mode and, for the report-progress gate, their coverage level:

```sh
node adapters/claude-code/install-report-progress-gate.mjs
node adapters/claude-code/install-release-notes-gate.mjs
```

Each prints `Kept mode block (already installed in this file)`, and the report-progress installer
also `Kept coverage 2 (already installed in this file)`. You no longer need `--adopt` for this, and no
longer need to name `--mode`: a re-run keeps the mode already installed, `off` included. Only `--mode`
and `--coverage` change them, and a new install with no `--mode` still gets `observe`.

**A plain re-run never takes a hook it cannot fully read.** A hook that runs the gate in a shape the
installer never writes, or one where it cannot tell whether the gate runs (a wrapper form it does not
recognise, the gate read on an interpreter's stdin, the gate path inside an option's value or passed
through an expansion it does not resolve), is named and refused, with or without the installer's own
`describe`: an install refuses and `--remove` exits 1. **`--adopt` takes over every other hook 0.19.0
would have taken**, apart from the hooks in the next two paragraphs, and prints which hooks it took,
by event and matcher:

```text
Took over 1 hook this installer could not fully read: Stop (matcher *).
```

The release-notes installer gains `--adopt`; 0.19.0's had none.

**Hooks judged to only mention the gate file, write to it, name a different file, or carry another
tool's `describe` are left alone, with any flag.** That covers `cat '<gate>'`, `wc -l < '<gate>'` and
`true # report-progress-gate.mjs`; `timeout 5 >'<gate>' node x`, which empties the gate;
`report-progress-gate.mjs.bak`, or the gate's name only as a directory; and a `describe` somebody
else wrote. 0.19.0 took the first three under its own `describe` or under `--adopt`. `--remove` names
each hook it leaves, with the reason, and never says no gate was installed while one of them names
the gate file. A hook holding an expansion the installer does not resolve, such as
`G='<gate>.bak'; node "${G%.bak}"`, is never given one of these reasons: it is unclear, so `--adopt`
can take it.

**Known limitation: the installer can read a hook that runs the gate as one that only mentions it.**
Those judgements come from reading the command's shell text, and the reader can misjudge complex,
hand-written shell. For such a hook `--remove` exits 0, says no hook in the file runs the gate as the
installer reads it, and lists the hook as `left alone: only mentions the gate file`. No flag,
`--adopt` included, takes it over, although the shell runs the gate. The families observed, with
`<gate>` standing for the gate's path:

- a here-document whose body runs the gate through `$(…)` or backticks (`cat <<EOF`, then
  `$(node '<gate>')`, then `EOF`);
- the output of a group or compound command piped into a shell or interpreter:
  `{ cat '<gate>'; } | bash`, `(cat '<gate>') | bash`, `if …; then cat '<gate>'; fi | bash`, or a loop;
- ANSI-C quoting, `$'…'`, hiding a later command;
- `$_` carrying a mentioned argument into the next command: `test -f '<gate>' && node "$_"`;
- arithmetic that bash evaluates inside `[[`;
- zsh process substitution: `cat '<gate>' > >(bash)`, `exec > >(bash)`;
- a launcher or a copy written to another file and run: `cp '<gate>' x && node x`, or through `tee`.

**If a hook wraps the gate in shell like this, remove it by hand; do not rely on `--remove`.** Where
0.19.0's `--adopt` removed such a hook by the gate file's name, this version leaves it. The list is kept
in [`adapters/claude-code/README.md`](adapters/claude-code/README.md#known-limits-of-the-reading).

**The report-progress gate blocks at most once per turn, at both coverage levels.** The gate now
records each block it spends, and the installer writes a `UserPromptSubmit` hook, which prints
nothing, that clears the record when the next turn starts. Arming again later in the same turn (another
`Agent` dispatch, a subagent starting, the background register changing) no longer buys a second
block; through 0.19.0 only the harness's `stop_hook_active` prevented one. A turn that event does not
fire for cannot block while an earlier turn's block is still on record. Turns started by a slash
command were not tested.

**Resuming a session no longer costs a false block** at coverage 2. The installer writes a
`SessionStart` hook on matcher `resume`, which prints nothing, and the resumed process's first `Stop`
no longer reads the old process's background tasks as gone. The 0.19.0 note offered no fix, because
every fix then available was a guess; `SessionStart` has since been observed reporting
`source: "resume"` for `--resume` and `--continue` before that first `Stop`
([`adapters/HOOK-OUTPUT-NOTES.md`](adapters/HOOK-OUTPUT-NOTES.md), fourth and fifth addenda of
2026-09-14). On `--fork-session`, a disappearance is still missed when all of the parent's tasks went
away in that same turn.

**The release-notes installer keeps block mode on a re-run.** Through 0.19.0 its `--mode` defaulted to
`observe` on every run. A re-run with no `--mode` now keeps the mode already installed and says so,
and a run that changes the mode says that too (`Set mode observe (was block)`).

**The new hooks reach an existing install only when you re-run the installer.** Updating the checkout
changes the gate file your hooks run, not the hooks. A gate installed by 0.19.0 or earlier has no
`UserPromptSubmit` or `SessionStart` hook, and its commands declare no turn hook, so the updated gate
decides exactly as 0.19.0 did until the installer is re-run: only the harness's `stop_hook_active`
stops a second block after a re-arm, and a resume at coverage 2 still costs one block.

**Other known limits of the reading.** None is one of the four reasons, and each is either what 0.19.0
did or taken only under `--adopt`:

- a gate whose name is not written out literally (a `[r]eport-progress-gate.mjs` glob, a path read
  from a file, a symlink under another name) is not read as naming it, so without the installer's own
  `describe` no flag takes such a hook and `--remove` does not name it;
- a group whose `hooks` is not an array is not read;
- control flow is read by structure: `false && node '<gate>'` reads as running the gate;
- a write through a program's argument (`sed -i`, `dd of=`, `curl -o`) is not a write target, so
  `--adopt` may take such a hook;
- under `--adopt`, a hook the installer did not write and cannot fully read is taken, and named on a
  line of its own;
- the certainty rule covers the whole command, so a plain mention beside an unrelated `${…}` is
  treated as unclear: `--adopt` takes it and `--remove` exits 1 over it;
- `printf -v` captures are handled only as unclear.

**Why.** The 0.19.0 note left three things open, and this version closes them. The release-notes
installer's `--remove` printed "No release-notes gate was installed … Nothing changed." and exited 0
with the hook still in place, and there was no `--adopt` to recover. Neither coverage level could
guarantee one block per turn. A resume at coverage 2 cost one block. Recognising a hook by its command
means reading shell text, and review kept finding hand-written command shapes the reader misjudges.
Those that would have taken a hook that does not run the gate were fixed as they were found, apart from
the ones listed above, because deleting a hook that is not the gate cannot be undone. This version ships
with the known shapes of the other kind named above rather than waiting for a reader that has none.

**Impact.** No flag or command was removed or renamed.

- *Scripts that call `--remove`:* its exit code follows the reading above. It exits 1 while a hook the
  installer reads as running the gate, or possibly running it, is left, and 0 over hooks it judges to
  only mention the gate file, write to it or name a different file. 0.19.0's release-notes installer
  exited 0 with its hook still in place.
- *Hooks that 0.19.0 took with no flag and this version takes only with `--adopt`:* a hook under the
  installer's own `describe` that it cannot fully read, or whose command never names the gate file.
- *Hooks that 0.19.0 took and this version never takes:* mentions, write targets and different files,
  and the misread shapes above.
- *The report-progress gate changed* (`report-progress-gate.mjs`), for the once-per-turn record and the
  resume note; under hooks written by 0.19.0 or earlier it decides as 0.19.0 did. The release-notes
  gate (`release-notes-gate.sh`) is unchanged.
- *Contributors:* three new test files hold the reader and both installers:
  `test/hook-ownership.test.mjs`, `test/hook-ownership-installers.test.mjs` and
  `test/hook-ownership-v0.19.0.test.mjs`. The last runs 0.19.0's installers, taken from git, beside
  this version's; a clone without that commit, such as a shallow CI checkout, checks this version
  against the table recorded from them in `test/fixtures/hook-ownership-v0.19.0.json` instead.
  `npm run verify` at the repository root still requires Node.js 24 or newer.
- *Distribution:* the gates and their installers ship with this repository, not with the installed
  skills, so `npx skills update --global --yes` updates `skills/report-progress/SKILL.md` and does not
  reach them. Update the checkout the hooks point at, then re-run the installers from it.

## 0.19.0

**If you installed the report-progress gate, read this first.** Its installer recognised its own
hooks by a `describe` key, and Claude Code removes that key from every hook entry whenever it writes
a settings file. Adding a plugin marketplace is enough to cause it, measured on Claude Code 2.1.181.
It does not depend on which version of this pack installed the gate: a real settings file written by
the 0.17.0 installer had lost `describe` on both gate hooks. Once that has happened, 0.18.0 and
earlier could neither remove the gate nor replace it. `--remove` printed "No report-progress gate was
installed … Nothing changed." and exited 0 while both hooks kept running, and re-running the
installer refused with "Remove it by hand first". From this version, add `--adopt`, run from an
up-to-date checkout of this repository:

```sh
# update in place, keeping the coverage level the hooks already run at
node adapters/claude-code/install-report-progress-gate.mjs --mode block --adopt

# or take the gate out
node adapters/claude-code/install-report-progress-gate.mjs --remove --adopt
```

Name the mode you run, because `--mode` still defaults to `observe` (a re-run that changes the mode
says so). `--adopt` takes only a hook that runs the gate and has no `describe` key at all, and names
each one it took; a hook whose `describe` something else wrote is never adopted. It is safe to pass
when nothing needs adopting: the run prints `Adopted none` and does what a plain run does. The next
time the harness writes the file, `describe` goes again, so expect to pass it on later updates too.
Without it, `--remove` now names every hook still running the gate and exits 1, and an install
refuses and names them.

**What.** The report-progress gate's installer gains two flags, and the hooks it writes now depend on
a coverage level.

- **`--coverage 1|2` chooses how wide the gate arms, and a bare re-run keeps the level already
  installed.** It prints `Kept coverage N (already installed in this file)`. Only `--coverage` changes
  the level, and then the output names the change, as in `Set coverage 2 (was 1)`. **A new install
  with no `--coverage` gets 1.** Until now the installer wrote coverage 2 on every run, so re-running
  the 0.17.0 or 0.18.0 installer to pick up a new version silently widened a coverage-1 gate.
- **The hooks follow the level.** Coverage 1 writes `Stop` and `PostToolUse` matcher `Agent`, which is
  v0.16.1's pair. Coverage 2 writes `Stop` and `SubagentStart`, plus `PostToolUse` matcher `Skill`
  only for a `--skills` list. `--skills` at coverage 1 is refused, because the gate at that level
  never reads a skill list. Coverage 1 written under the coverage-2 pair was measured writing no
  marker and never blocking, so keeping a level has to mean writing that level's hooks.
- **`--adopt`**, as above. With no `--coverage`, adopting keeps the level the adopted command runs at.
  A command whose level the installer cannot read, because it is set after `env`, `cd … &&` or
  `export`, or from an expansion, is refused until `--coverage` names the level, and so are hooks that
  run at different levels. A level it cannot read is never printed as kept.
- **A re-run that drops a `--skills` list it did not repeat says so**, as `Skill list not kept`, with
  the flag that keeps it. 0.18.0 removed the `Skill` hook without a word.
- **`--remove` exits 1 while any hook still runs the gate.** It also leaves the file untouched when it
  removed nothing (0.18.0 rewrote it), and no longer creates a settings file that did not exist
  (0.18.0 wrote `{}`).

**Why.** Updating was broken in two ways, both found on a live install. Re-running the installer, which
is the documented way to pick up a new version, changed what the gate enforced by writing coverage 2
over whatever was installed. And the installer's test of ownership did not survive the harness. The
probe recorded in [`adapters/HOOK-OUTPUT-NOTES.md`](adapters/HOOK-OUTPUT-NOTES.md) (third addendum of
2026-09-14) pointed `HOME` and the Claude Code config directory at a throwaway directory and added a
local marketplace at project and at user scope. Every hook entry came back as `type`, `command` and
`timeout` only, while an unknown top-level key survived. So a gate that no command in this pack could
update or remove was the common case, not a rare one.

The same work drove the gate in a real harness for the first time. **The deny path has now been
observed ending a real turn**, in headless sessions on Claude Code 2.1.181 recorded in that file: the
gate blocked once, the harness delivered its reason to the model, a second round ran, and the gate
stood down on the next `Stop`. A report with the three sections passed on the first `Stop` with
nothing on stdout. A change in the background register armed a turn, while a task that was merely
still running armed nothing on the turns after it.

**Corrections to what earlier releases said.** The 0.17.0 release note says "v0.16.1 was structurally
incapable of this" and "Coverage 1 does not have this shape", meaning a second block in one turn; it
is left as released, and both sentences are false. At coverage 1, an `Agent` dispatch in the round a
block bought rewrites the marker as unspent, just as a subagent starting does at coverage 2. Measured
against the gate directly with `stop_hook_active` absent, both levels blocked a second time. The
README, the adapter README, `skills/report-progress/SKILL.md`, and the installer's `--help` and output
now say so, and tests keep the false sentences out of all of them. The same pages promised that
updating "never changes what the gate enforces". That promise now covers the level, which is what an
update keeps; `--mode` and `--skills` are not carried over, and a re-run that changes either says so.

**Impact.** Additive: no flag or command was removed or renamed. One exit code changed, and it is
listed below.

- **The gate itself is unchanged.** `adapters/claude-code/report-progress-gate.mjs` is byte-identical
  to 0.18.0. An installed hook runs that file from its checkout, so updating the checkout changes
  nothing a running hook does. Only the installer and the documentation changed.
- *Who must act:* anyone updating or removing an installed gate whose hooks have lost `describe`, with
  the `--adopt` command above. Anyone else needs to do nothing, and a bare re-run keeps their level.
- *Scripts that call `--remove`:* it now exits 1 when a hook still runs the gate afterwards.
- *Still true, and named here rather than left to be found:*
  - **Neither level can guarantee one block per turn on its own.** The marker is the gate's only record
    of a block it spent, and anything that arms the gate again in the same turn rewrites it as unspent.
    At coverage 2 the background register can also re-arm the gate after standing down deleted the
    marker, with no memory of the block already spent. Live, only the harness's `stop_hook_active`
    prevented a second block: it was `true` on every in-turn `Stop` that followed a first block, nine
    of them across four sessions, and a second block was never reproduced. The gate's model-facing
    reason still says "It blocks once per turn and then stands down", which is untrue in that case; it
    is unchanged here because the gate is.
  - **Resuming a session that had background work costs one block at coverage 2, and no fix is
    offered, because every available fix is a guess.** The baseline is kept under the session id,
    which `--resume` keeps, while the harness's background list belongs to the CLI process, which a
    resume replaces. Measured, neither the `Stop` payload nor the hook's environment identifies that
    process. The hook's parent pid was the CLI where that was measured only because the shell
    exec'd the command, and a baseline scoped to it would suppress every real disappearance
    wherever that does not hold.
    `SessionStart` does report `source: "resume"`, on an event the gate does not wire.
  - **A block enforces an opportunity, not compliance.** It buys the model one more round and nothing
    else. Live, when the user's own prompt said to write no report, the model re-sent its one-line
    answer after the block and the turn ended. Where nothing contradicted the gate, the model wrote the
    report and it passed.
  - **The release-notes gate's installer has the same `describe` problem and no `--adopt`.** It is
    unchanged since 0.18.0. On a settings file the harness has rewritten, its `--remove` prints "No
    release-notes gate was installed … Nothing changed." and exits 0 with the hook still in place, and
    its install refuses. Until that is fixed, remove its `PreToolUse` hook by hand.
  - `--adopt` looks for the exact key `describe`. A hook that runs the gate and carries any other key
    instead, `description` for example, counts as having none, and `--adopt` takes it.
- *Contributors:* `test/report-progress-gate.test.mjs` grows from 79 tests to 102, including hook
  commands run through `/bin/sh` before the installer reads them. `npm run verify` at the repository
  root still requires Node.js 24 or newer.
- *Distribution:* the gate and its installer ship with this repository, not with the installed skill,
  so `npx skills update --global --yes` updates `skills/report-progress/SKILL.md` and does not reach
  them. Update the checkout the hooks point at, then run the installer from it.

## 0.18.0

**What.** The skill shipped in 0.17.0 as one seven-step procedure with no way in: a word after its
name — `check`, `need`, `update`, `ensure` — bound to nothing. It now has three entry points, and a
run announces the one it chose in a single line before it reads anything, rather than asking.
`audit` (also `check`, `need`, `review`, no word at all, or any word not listed) writes nothing in
the repository. `draft` (also `ensure`, `write`, `layer`) writes only the files it named first, plus
pointer-only edits and one-line status corrections where the drafts would otherwise contradict a
document they route readers to. `update` takes the diff from the previous baseline to `HEAD`, writes
overtaken passages, and keeps working documents in a separate patch under their own edit rules. Each
one's scope, permitted writes, steps and output are in the new `references/entry-points.md`, the
seventh carried reference.

All three end in one report contract — a verdict line with counts, the ranked findings, the owner's
decisions, then what was run against what was inferred — capped at about eighty lines, with longer
tables in linked files, everything inline where no file can be written, and every total counted from
rows that were saved. A total whose rows exist nowhere is a failed run rather than a short one.

Nine smaller changes come from the same evidence: the repository's standing directions are read
before the rot pass, so a subject its owner has closed is held back rather than raised again;
findings say whether the repository already tracks them; loss-audit rows are saved before any total
is quoted, and an `update` gets a sixth verdict, `corrected`; a documents-only repository gets a real
newcomer task; any edit made in the overreach pass sends the newcomer test back to a clean state; the
newcomer's clone has its remote removed by name; the description check is no longer trapped inside
the drafting step; and "the draft" is defined for a run that drafts nothing.

**Why.** Six sessions were given the skill and one message each — five a bare word, one a prose
request with no command word — in throwaway clones of four repositories, and a second session graded
every run against the repository's source. The method held: nothing was committed or pushed, nothing
leaked, and nearly every finding re-checked was true. The entry is what failed. Two runs given the
identical word produced reports that could not be compared. Reports reached 333 lines with no fixed
shape, and one never reached its owner at all while the run reported it delivered. An `update`
re-verified everything over a documentation-only diff. One run quoted loss-audit totals its own
working file contradicted. The prose run failed too, which is why the report contract matters as much
as the vocabulary.

The same scenarios re-run against this change, independently graded: announcements before the first
read in all three, reports of 76, 81 and 83 lines in the contract's order, writes inside each entry
point's boundary, and the `update` narrowed from a full re-verification to thirteen claims with the
newcomer test recorded as "not run: no task path changed". Two misses remain, both recorded publicly.

**What it does not change.** No frontmatter field was added: `argument-hint` and the other
argument-declaring fields are Claude Code's rather than the open Agent Skills specification's, whose
reference validator is documented as rejecting unknown fields — documented, not run here. `$ARGUMENTS`
is a body token rather than a field, and what an agent that does not substitute it would show a reader
is untested. The selection is prose, so a harness with no slash commands matches the same words in a
sentence. Nothing is removed: a plain-English request reaches the same procedure it did in 0.17.0.

**New public page.** [`docs/layer-repository-docs/evaluation.md`](docs/layer-repository-docs/evaluation.md)
records how the skill is exercised against real repositories, what the trial found, which checks run
on every change today against which are only planned, and what is still unmeasured — including that
the trial runs were not isolated, so their safety result is not attributable to the skill alone, and
that the no-word default has never been run.


**Entry points.** A request enters through one of three, and the run announces which in one line
before it reads anything, rather than asking: `audit` (also `check`, `need`, no word at all, or a
word it does not recognise) writes nothing in the repository; `draft` (also `ensure`) writes only
the files it named first; `update` takes the diff from the previous baseline to `HEAD`. Each states
its scope, what it may write, which of the seven steps it runs, and what it hands back, in
`references/entry-points.md`. All three end in one report contract — a verdict line, the ranked
findings, the owner's decisions, then what was run against what was inferred — capped at about
eighty lines, with longer tables in linked files, everything inline where no file can be written,
and a total whose rows exist nowhere counted as a failed run rather than a short one.

This is body text, and no frontmatter field was added. `argument-hint` and the other
argument-declaring fields are Claude Code's, not the open Agent Skills specification's, whose
reference validator is documented as rejecting unknown frontmatter fields — documented, not run
here. `$ARGUMENTS` is a body token rather than a field, and what an agent that does not substitute
it would show a reader is untested. Either way the portable form is the same, and a harness with no
slash commands matches the same words in a sentence.

**Why those three, and not a longer vocabulary.** Six sessions were given the skill — five a single bare
word, one a prose request with no command word at all — and a second session graded every run
against the repository's source. The method held:
nothing was committed or pushed, no credential value or address leaked, and nearly every finding
re-checked was true. What failed worst was the entry, and the prose run failed too, which is why
the report contract matters as much as the vocabulary. Every word bound to nothing, so each run cut the
procedure into its own subset; two runs given the identical word produced reports that could not be
compared; reports reached several hundred unranked lines; one never reached the owner while the run
reported it delivered; and one quoted loss-audit totals its own working file contradicted. The
entry points, the announcement and the report contract each name the failure they answer. The
protocol, the cases and what remains unmeasured are in
[the evaluation page](layer-repository-docs/evaluation.md).

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
