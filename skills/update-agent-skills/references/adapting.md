# Adapting a pack skill to one project

A project often needs a pack skill to carry what only it knows: who rules a decision, the zone
times are written in, where records go, which of its own skills does the job a sibling pack skill
does, and the steps and traps it has learned. Copying the skill and editing the copy is a fork: it
stops receiving fixes, and the two drift until nobody can say which rule is current.

The adapted copy is the alternative. It is **generated** from two inputs: the pack skill at a
pinned ref, and the project's overlay. It is committed, so every clone, worktree and branch that
carries it has it with no network. It is never edited by hand, the same discipline a project
already applies to any generated file a test byte-compares. The contract it follows — binding
slots, hard-line and step ids, and the merge rules — is the pack's `docs/project-adaptation.md`.
This page is how `scripts/adapt.mjs` carries it out.

Why one generated skill rather than the pack skill installed beside a thin project skill: nothing
in a skill's frontmatter makes one skill load another, so a second skill has to be found by its
description, and a harness with many skills installed drops descriptions first for the skills
invoked least. A personal copy of the generic skill can also take precedence over the project's.
One invocation of the adapted copy brings the whole procedure, the project's values and its
additions together.

## The files

```text
<project>/
  .claude/skill-adapters/
    .tool/adapt.mjs        the composer, vendored by compose --write
    <name>/
      adapter.json         written by a person
      overlay.md           written by a person
      references/
        project/           the project's own reference files, listed in projectFiles
  .claude/skills/<name>/   GENERATED: never edited by hand
    SKILL.md
    LICENSE
    adapted.lock.json
    (the skill's own references, scripts and assets, byte for byte)
```

`--adapters-dir` and `--skills-dir` move the two folders for a harness that reads skills from
somewhere else; pass the same values to every command, because the lock records them.

### `adapter.json`

```json
{
  "version": 1,
  "name": "triage-arrivals",
  "description": "Take in what reaches this repository. Use when a file, a mail or a message arrives for the team.",
  "base": {
    "source": "https://github.com/<owner>/<pack>",
    "skill": "<pack skill>",
    "entry": "SKILL.md",
    "ref": "v1.4.0",
    "commit": "<optional: the full commit the ref was reviewed at>",
    "tree": "<optional: the full tree of skills/<pack skill> at that commit>"
  },
  "widenTools": [],
  "overlay": "overlay.md",
  "projectFiles": [],
  "names": {}
}
```

| key | what it holds |
|---|---|
| `name`, `description` | the adapted copy's own name and trigger text. The name is never the pack skill's name, so neither copy hides the other |
| `base.source` | `https://github.com/<owner>/<repo>`, or a local path to a clone of the pack. Every other transport is refused |
| `base.skill` | the pack skill's folder name, `skills/<skill>` |
| `base.entry` | `SKILL.md`, or one reference file of the skill when that file holds the procedure the project needs |
| `base.ref` | a tag (`vX.Y.Z` or `<skill>-vX.Y.Z`) or a full commit sha. A branch is refused, because it moves, and so is an abbreviated sha |
| `base.commit`, `base.tree` | optional. When present, a ref that now resolves elsewhere is refused |
| `widenTools` | tools added to the skill's `allowed-tools`, each named here where review sees it |
| `overlay` | the overlay file, `overlay.md` unless named |
| `projectFiles` | the project's own files, each listed by its path inside the adapter folder, and each inside a `project` folder under `references`, `scripts` or `assets`, so they never collide with the skill's: `<adapter>/references/project/record-forms.md` is listed as the part after `<adapter>/`. A file in those folders that is not listed is refused rather than left out |
| `names` | rarely needed: a pack skill the carried text names in backticks that no slot covers, mapped to this project's skill. Its main use is a reference-file entry that sends the reader back to its own skill |

An unknown key is refused, because a misspelt one would otherwise be read as absent.

### `overlay.md`

```markdown
## Bindings

| id | value |
|---|---|
| B1 owner | Ada Example, the release manager. Only her own instruction is acted on. |
| B5 defects (skill) | `triage-a-defect`, this repository's own skill |

## Additions

### S3
An arrival larger than 100 MB is kept on the shared drive; the repository keeps its hash.

### H1
Not even an automatic reply: the mailbox's auto-responder stays off.

## Project traps

| trap | so |
|---|---|
| two packs unpacked into one folder overwrote each other | every pack gets its own folder |
```

- **Bindings** bind slots the skill declares; a slot left out keeps its default. A `skill` slot's
  value opens with one skill's name in backticks; that is what the names map is built from.
- **Additions** are one `### <id>` heading per step or hard line. An addition whose first line is
  `replaces: S2. <why, and where the decision is recorded>` supersedes the step instead; it is
  refused on a hard line.
- **Project traps** come last, as written.
- Nothing else reaches the copy, so any other section, or text before the first one, is refused. A
  `#` title and HTML comments before the first section are allowed.
- Links in the overlay are written as they will be read from the generated `SKILL.md`: a project
  file is reached at the same path it has in the adapter folder.

## Commands

```bash
# The first time: run the composer from a clone of the pack checked out at the pinned ref.
node <pack clone>/skills/update-agent-skills/scripts/adapt.mjs compose --repo . --pack <pack clone>
node <pack clone>/skills/update-agent-skills/scripts/adapt.mjs compose --repo . --pack <pack clone> --write

# From then on, the vendored copy:
node .claude/skill-adapters/.tool/adapt.mjs compose --repo .            # prints the change
node .claude/skill-adapters/.tool/adapt.mjs compose --repo . --write    # writes it
node .claude/skill-adapters/.tool/adapt.mjs check --repo .              # offline
node .claude/skill-adapters/.tool/adapt.mjs outdated --repo .           # online, reads only
node .claude/skill-adapters/.tool/adapt.mjs outdated --repo . --verify  # and compares every carried file
```

- `compose` reads each pin, holds the overlay to what the skill declares, and prints the files it
  would add (`+`), change (`~`) or remove (`-`), what moved in the pin, and every addition to a hard
  line for review. It writes nothing without `--write`. With it, it writes the generated folder and
  vendors itself. `--adapter <name>` composes one; `--pack <dir>` reads a local clone instead of
  fetching.
- `check` is offline: no git, no network. It exits 1 when any check below fails.
- `outdated` exits 2 when something needs a person: a newer tag that changes the skill, a moved or
  deleted tag, or a question it could not answer. It never says "current" when it could not tell.

Wire `check` into the project's tests, so that drift is a red test even without CI, and add one
line to the project's agent instructions: never edit `.claude/skills/<name>/`; edit the adapter
folder and compose. When branches that both changed an adapted skill merge, never merge the
generated folder by hand: merge `adapter.json` and the overlay, then compose.

## What the copy carries

`SKILL.md`, in this order:

1. the frontmatter: `name` and `description` from `adapter.json`; `license`, `allowed-tools` and
   `compatibility` from the skill, the tools widened only by `widenTools`; `metadata` a map of the
   source, entry, ref, commit and tree;
2. one generated line saying where to edit instead, and a short paragraph saying what the copy is;
3. **Names in this copy**: where the text names a pack skill whose slot is bound to a project
   skill, the project skill to use instead;
4. **This repository's bindings**, the overlay's table as written;
5. the skill's text between `<!-- base:begin -->` and `<!-- base:end -->` markers, byte for byte;
6. **In this repository**: the additions under their ids, then the project traps.

Beside it: the skill's other files byte for byte at their own paths, so its links still resolve;
the project files; the pack's `LICENSE`, since the copy is a substantial portion of an MIT work;
and `adapted.lock.json`, which records the pin (source, ref, commit, tree), the sha256 of every file
of the skill and of the text between the markers, the sha256 of every adapter input and every
generated file, and the composer's version and sha256.

**A reference file as the entry.** Its text becomes the body of `SKILL.md` at the folder root, so
every relative link in it is rewritten for that place, and it is still carried at its own path. The
skill's own `SKILL.md` is not carried, so a link to it is refused, and so is a binding or an
addition to an id that only `SKILL.md` declares.

Composing is concatenation at fixed points, never a model merging text, so the result can be
compared byte for byte: LF line endings, files in sorted order, no timestamps.

## The checks

`check` holds every adapted copy to these; `compose` refuses an input that would break 3 to 6, 9 or 10.

| # | what it holds | what fails it |
|---|---|---|
| 1 | every generated file has the sha256 its lock records, and the folder holds nothing else | a hand edit, a file added or removed by hand |
| 2 | the text between the markers has the sha256 recorded at compose time | an edit to the skill's own text |
| 3 | composing again from the copy and the current adapter folder gives the same bytes | an overlay or `adapter.json` changed without composing; a pin moved in `adapter.json` but not composed |
| 4 | every id the overlay cites is declared by a carried file; every required slot is bound; a `skill` slot whose default this project also adapts is bound to the adapter | a typo in an id; an id a newer release renamed; a handoff that would reach the generic copy |
| 5 | no `replaces:` on a hard line, a reason on every `replaces:`, and no addition to a hard line, or overlay line naming one, written in the words of an exception (`unless`, `except`, `does not apply` …) | an overlay that relaxes a hard line. No script can tell stricter from looser in prose, so every addition to a hard line is also listed for review |
| 6 | the adapted copy's name differs from the skill's | an adapter that takes its skill's name |
| 7 | the vendored composer is the one that composed each copy, and the one running the check | a composer upgraded without composing again |
| 8 | warning only: `SKILL.md` over 500 lines | a long trap table; move it into a project reference file |
| 9 | the frontmatter follows the skill, widened only by `widenTools`, with `metadata` a map | a hand edit to the frontmatter |
| 10 | every relative link in the generated folder resolves and stays inside the repository | a link in the overlay or a project file to something that is not there |

A generated folder whose adapter folder is gone fails as well.

Offline checks prove nobody changed the copy since it was composed; they cannot prove the copy
was ever the real upstream, because a person who edits a file and its hashes together leaves
nothing to disagree. `outdated --verify` fetches the pinned commit and compares every carried
file, and that is what proves it.

## Moving a pin

1. `outdated` prints, per adapted skill, either `v1.5.0 exists; skills/<skill> unchanged: moving the
   pin is a no-op`, or `changed (tree a -> b): read git diff v1.4.0 v1.5.0 -- skills/<skill>`.
2. Read that diff in the pack. A release note that names a renamed or removed id says what an
   overlay cites instead.
3. Change `base.ref` (and `base.commit` and `base.tree`, if recorded). `compose` refuses, and names
   the id, when the overlay cites one that is gone or a required slot the new release added.
4. `compose --write`, then review the generated diff: it is the upstream change and nothing else.
5. Run `check` and whatever scenarios the project keeps for the skill, and commit it as one change.

`check-pack-freshness.mjs --repo <project>` lists the same pins against the latest release, beside
the global installs, as part of an inventory. Neither it nor `skills update` ever moves one.

## Failure modes

| what goes wrong | what happens | what to do |
|---|---|---|
| someone edits the generated folder | `check` fails at 1 or 2; `compose` refuses to overwrite it | move the change into the overlay, then compose with `--discard-hand-edits` |
| a folder of the same name was written by hand | `compose` refuses: it has no lock | move its project text into the overlay, then `--discard-hand-edits` |
| a pinned tag is moved or deleted upstream | `outdated` raises an alarm; `compose` refuses the moved tag; the committed copy and the offline check are unaffected | read why; re-pin to a full sha or a new tag, or record the new commit in `base.commit` on purpose |
| a newer release renames an id the overlay cites | `compose` refuses and names it | fix the overlay in the same change as the pin |
| no network | only `compose` (without `--pack`) and `outdated` stop | nothing else needs it |
| the generic copy is picked instead of the adapted one | the session misses the project's values; an unbound slot falls back to its default, often "ask once" | give the adapted copy the project's own trigger phrases, and route the task to it by name in the project's agent instructions |
| two branches change one adapted skill | a conflict inside a generated folder | merge the adapter folder, then compose |
| a security fix reaches the pack | the project has it only when the pin moves | run `outdated` on a schedule the project keeps |

## What it does not do

It installs nothing globally and changes no agent settings. It never runs anything from a fetched
tree: it reads the pack with git plumbing only, never a checkout. It never asks a model to merge
text. It never writes outside the generated folder and its own vendored copy, and it writes
nothing at all without `--write`.
