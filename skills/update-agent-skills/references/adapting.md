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
| `base.ref` | a tag (`vX.Y.Z` or `<skill>-vX.Y.Z`) or a full commit sha. A branch is refused, because it moves, and so is an abbreviated sha. A per-skill tag is compared with newer tags of its own and with the latest catalogue tag, because a catalogue release can change the skill without a per-skill tag beside it |
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
  file is reached at the same path it has in the adapter folder. Every link is checked, in fenced
  code too, so an example writes a path as code, such as `docs/intake.md`, not as a link.
- Fenced code in the overlay closes inside the addition or section it opens in, at a bare line of
  at least as many of its character, indented as far as the fence or up to three columns further;
  a fence may open on the line of its list marker. One left open would swallow every heading after
  it, and the checks they face, so it is refused. A line that opens another part of the overlay, a
  section or a `###` heading whose first word is an id, ends a fence open across it, and so does
  such a heading indented one to three spaces, which Markdown still reads as a heading: an example
  that shows one indents the fence and its lines four spaces.
- An addition's heading starts at the left margin, so an indented `###` heading whose first word
  is an id is refused outside fenced code too. A heading of any shape that opens with a hard line's
  id is refused anywhere but the addition to that hard line, fenced or not (check 5).

## Commands

```bash
# The first time, and when a pin moves to a ref that ships another composer: run the composer
# from a clone of the pack checked out at the pinned ref, a tag or a full commit sha.
git clone https://github.com/<owner>/<pack> <pack clone>
git -C <pack clone> fetch origin <ref>    # only for a commit that no branch or tag holds
git -C <pack clone> checkout --detach <ref>
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
  fetching. When the pinned ref ships another composer than the one running, it says so.
- `check` is offline: no git, no network. It exits 1 when any check below fails.
- `outdated` exits 2 when something needs a person: a newer tag that changes the skill, a moved or
  deleted tag, a vendored composer that is not the one the pinned ref ships, or a question it could
  not answer. A version orders tags of one kind only, so for a per-skill tag against a catalogue
  tag, or for a sha pin, a different tree is reported as differing, never as newer. It never says
  "current" when it could not tell. With `--verify` it exits 1 when a carried file is not the
  upstream bytes.

**Which composer is vendored.** The one that ran `compose --write`, byte for byte; check 7 then
holds every copy to it. `compose` reads the pack and never runs anything it fetched, the pinned
release's own composer included, so the composer does not move with a pin by itself: a pin moved
with the vendored composer keeps that composer until a person runs the new one. Bootstrapping from
a clone at the pinned ref is what makes the vendored composer the release's. When the two differ,
`compose` notes it and `outdated` flags it, and composing again with the composer from a clone at
the pinned ref replaces it.

Wire `check` into the project's tests, so that drift is a red test even without CI, and add one
line to the project's agent instructions: never edit `.claude/skills/<name>/`; edit the adapter
folder and compose. When branches that both changed an adapted skill merge, never merge the
generated folder by hand: merge `adapter.json` and the overlay, then compose.

## What the copy carries

`SKILL.md`, in this order:

1. the frontmatter: `name` and `description` from `adapter.json`; `license`, `allowed-tools` and
   `compatibility` from the skill, the tools widened only by `widenTools`; `metadata` a map of the
   source, entry, ref, commit and tree;
2. one generated line saying where to edit instead, and a short paragraph saying what the copy is
   and, when an addition opens with `replaces:`, that the addition wins over the step it names;
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
every relative link in it, fenced code included, is rewritten for that place, and it is still
carried at its own path. The skill's own `SKILL.md` is not carried, so a link to it from the entry
is refused, and so is a binding or an addition to an id that only `SKILL.md` declares. Another
carried file that links to the skill's `SKILL.md` is carried byte for byte, so its link resolves to
this copy's `SKILL.md`, which holds the entry's text; `compose` and `check` warn and name each such
link, because only an edit to the skill can change it.

Composing is concatenation at fixed points, never a model merging text, so the result can be
compared byte for byte: LF line endings, files in sorted order, no timestamps.

## The checks

`check` holds every adapted copy to these. `compose` refuses an input that would break 4, 5, 6 or 10,
or put a marker of check 2 into the overlay; the rest it writes true. A refusal or a failure is
printed with the number of its check. Two kinds carry a word instead: `[adapter]`, an adapter
folder that does not read as one (an unknown key, a missing overlay, a project file out of place
or colliding with a file of the skill, an overlay section the copy would drop, a fence in the
overlay that does not close inside its addition or section, an indented `###` heading whose first
word is an id), and `[pin]`, a pin
that cannot be taken (a branch, an abbreviated sha, a tag that now names another commit, a
recorded commit or tree the ref no longer gives, a skill or entry the ref does not have, or a
source that cannot be read).

| # | what it holds | what fails it |
|---|---|---|
| 1 | every generated file has the sha256 its lock records, and the folder holds nothing else | a hand edit, a file added or removed by hand |
| 2 | the text between the markers has the sha256 recorded at compose time | an edit to the skill's own text |
| 3 | composing again from the copy and the current adapter folder gives the same bytes | an overlay or `adapter.json` changed without composing; a pin moved in `adapter.json` but not composed |
| 4 | every id the overlay cites is declared by a carried file; each slot is bound once and to a value, a `skill` slot to a skill's name; each step or hard line is added to once, with text; every required slot is bound; a `skill` slot whose default this project also adapts is bound to the adapted copy, and to no other skill; `names` maps only a skill the carried text names and no slot covers, and the names map says one thing per skill | a typo in an id; an id a newer release renamed; a handoff that would reach the generic copy, or another skill than the adapted copy; two rows for one slot |
| 5 | no `replaces:` on a hard line, a reason on every `replaces:`, the id it names its own heading's, and no addition to a hard line, its heading included, or overlay line naming one, a heading included, written in the words of an exception (`unless`, `except`, `does not apply` …). Outside the addition to a hard line, no heading opens with its id, in any shape Markdown gives a heading: a `#` heading at any level, in a quote or a list item, an underlined line, a line that is only bold, or an HTML heading, indented up to three columns, fenced or not. A heading that names a hard line further in, or is indented four columns or more, is listed for review, and refused when it or the paragraph under it is written in the words of an exception | an overlay that relaxes a hard line, or puts text under a heading for one that no check reads as an addition to it. No script can tell stricter from looser in prose, so every addition to a hard line, and every heading that names one, is also listed for review |
| 6 | the adapted copy's name differs from the skill's | an adapter that takes its skill's name |
| 7 | the vendored composer is the one that composed each copy, and the one running the check | a composer upgraded without composing again. Whether it is the one the pinned ref ships is `outdated`'s to say, since that needs the pack |
| 8 | warning only: `SKILL.md` over 500 lines | a long trap table; move it into a project reference file |
| 9 | the frontmatter follows the skill, widened only by `widenTools`, with `metadata` a map | a hand edit to the frontmatter |
| 10 | every relative link in the generated folder resolves and stays inside the repository. A link inside fenced code is checked like any other, as the pack's verifier checks a skill's files: a link the check skipped would be checked by nothing, and no reading of fences by hand matches CommonMark. An example that shows a path writes it as code, such as `docs/guide.md`, not as a link | a link in the overlay or a project file to something that is not there, an example's included |

A generated folder whose adapter folder is gone fails as well.

Offline checks prove nobody changed the copy since it was composed; they cannot prove the copy
was ever the real upstream, because a person who edits a file and its hashes together leaves
nothing to disagree. `outdated --verify` fetches the pinned commit and compares every carried
file, and that is what proves it.

## Moving a pin

1. `outdated` prints, per adapted skill, either `v1.5.0 exists; skills/<skill> unchanged: moving the
   pin is a no-op`, or `changed (tree a -> b): read git diff v1.4.0 v1.5.0 -- skills/<skill>`. For a
   per-skill tag against a catalogue tag, or a sha pin, it says `differs`, never newer, and names
   the same diff; read it with the release notes before moving the pin.
2. Read that diff in the pack. A release note that names a renamed or removed id says what an
   overlay cites instead.
3. Change `base.ref` (and `base.commit` and `base.tree`, if recorded). `compose` refuses, and names
   the id, when the overlay cites one that is gone or a required slot the new release added.
4. `compose --write`, then review the generated diff: it is the upstream change and nothing else.
   If `compose` notes that the new ref ships another composer, compose again with the one from a
   clone of the pack at that ref, so the vendored composer moves with the pin.
5. Run `check` and whatever scenarios the project keeps for the skill, and commit it as one change.

`check-pack-freshness.mjs --repo <project>` lists the same pins against the latest release, beside
the global installs, as part of an inventory; a copy of another source is listed as not compared,
and the run exits 2 when a pin moved or differs. Neither it nor `skills update` ever moves one.

## Failure modes

| what goes wrong | what happens | what to do |
|---|---|---|
| someone edits the generated folder | `check` fails at 1, and for an edit to `SKILL.md` at 3 as well: at 2 too inside the base markers, and at 9 in the frontmatter; `compose` refuses to overwrite it | move the change into the overlay, then compose with `--discard-hand-edits` |
| a folder of the same name was written by hand | `compose` refuses: it has no lock | move its project text into the overlay, then `--discard-hand-edits` |
| a pinned tag is moved or deleted upstream | `outdated` raises an alarm; `compose` refuses the moved tag; the committed copy and the offline check are unaffected | read why; re-pin to a full sha or a new tag, or record the new commit in `base.commit` on purpose |
| a newer release renames an id the overlay cites | `compose` refuses and names it | fix the overlay in the same change as the pin |
| no network | only `compose` (without `--pack`) and `outdated` stop | nothing else needs it |
| a git setting (`url.<base>.insteadOf`) rewrites GitHub addresses to ssh | `compose` without `--pack` refuses the pin, and `outdated` reports unknown: the composer allows a remote over https only, and the message names the setting | run the command with that setting left out (for one in the global configuration, `GIT_CONFIG_GLOBAL` naming an empty file), or compose from a clone with `--pack` |
| the generic copy is picked instead of the adapted one | the session misses the project's values; an unbound slot falls back to its default, often "ask once" | give the adapted copy the project's own trigger phrases, and route the task to it by name in the project's agent instructions |
| two branches change one adapted skill | a conflict inside a generated folder | merge the adapter folder, then compose |
| a security fix reaches the pack | the project has it only when the pin moves | run `outdated` on a schedule the project keeps |
| a pin moved with the old composer | the copies are composed, vendored and checked by the old composer; nothing offline disagrees | `compose` notes it and `outdated` flags it; compose again with the composer from a clone at the pinned ref |

## What it does not do

It installs nothing globally and changes no agent settings. It never runs anything from a fetched
tree: it reads the pack with git plumbing only, never a checkout. It never asks a model to merge
text. It never writes outside the generated folder and its own vendored copy, and it writes
nothing at all without `--write`.
