# Layer contents

What belongs in each of the three layers, in the order it appears, and what is banned from each.
The bans matter more than the contents: a layer fails by absorbing the layer below it, and the
first symptom is always that somebody had to update two files for one change.

Every length threshold here is an opinion. Adopt it, change it, or drop it — but write down
which, because "60 lines at most" that nobody agreed to is a rule an agent will enforce against
a human who never heard of it.

## Quick start — the README, at the root of every repository

Answers four questions and routes: **what is this, who is it for, what is it not, where do I go.**

In this order:

1. **The repository's name as the heading.**
2. **A description line**, inside the first few lines, on a line of its own with a machine-findable
   marker such as an HTML comment. The text after the marker, trimmed, is one sentence, and the
   repository's registered description on the forge begins with exactly that text. The registered
   description may add one sentence of negative scope. If the two differ, tell the owner; changing
   the forge is theirs. This is the one sentence deliberately allowed to exist in two places
   ([one home per fact](one-home-per-fact.md)), because one of the copies is not in the repository.
3. **What it is for** — the problem and who has it, in two to four lines.
4. **Who it is for** — the audiences, in one or two lines.
5. **What it is not** — concrete limits, in one to three lines. This is the section that saves the
   most reader time and the one most often missing.
6. **Start here** — a table with one row per audience goal, each linking into the manual, and to
   the agent file if the repository has one. A repository with no manual uses a short **Use**
   section instead.
7. **Status** — each component as one lifecycle word, each linked to the document that holds its
   dates. A workable set: `specified` (written, not built) · `building` · `built` (exists, and is
   either not deployed or has nothing to deploy) · `live` (deployed and serving) · `paused` ·
   `retired`. One word, because a README is the worst place in the repository to keep a date.
8. **Owner** — who merges documentation changes here, and how to reach them, using only facts the
   repository already contains.

**Not in a README:** flags; environment variable names; counts or measured values; schemas, field
lists or vocabularies; deploy steps; history or dates; credentials; real personal addresses. At
most one code block, five lines or fewer, for the primary task.

**Length:** 60 lines (opinion), or the repository's own stricter cap if it has one.

The README is the layer that grows back. Every time somebody adds "just one command" to it, it
becomes a manual with no reference section, and then it is the file that goes stale fastest
because it is also the file the forge renders on the landing page.

## Manual — `docs/MANUAL.md`, or a root file named for what it is

Two parts, kept apart. The split is not decoration: a task and a reference entry age at
different rates and are read by people in different states of mind.

### Part A — Tasks: how do I get X done?

One section per goal, named the way the reader would say it, not the way the system is
organised.

- **Full form:** *When* to use it · *You need* · numbered steps · *It worked if* · *If it fails* ·
  *Why it works this way*, as a link to a record rather than an essay in place.
- **Short form:** one line and a link, where a skill or a runbook owns the steps. If the linked
  procedure is written for agent sessions, the line says so, so a person knows what they are
  opening before they start following it.
- The repository's **main task for people** is in full form, and readable without opening a spec
  or a skill. If the main task can only be followed by opening three other documents, the manual
  has not been written yet.

### Part B — Reference: what exactly is Y?

- **Prerequisites.**
- **Commands:** command · purpose · side effects · what it needs · where its flags are
  documented. A usable side-effect vocabulary: `none` · `writes files` · `reads the forge` ·
  `network` · `opens a port` · `runs a container`, each with an "only when …" where it is
  conditional. **No flags in this table** — the script's own usage header is their home, and a
  table of flags is the single most reliable way to publish a lie with a straight face.
- **Credentials:** the names the repository's own code reads, each with the source file that
  reads it. Deploy-time variable names are never listed here; link to the runbook.
- **Layout:** a link to the spec that owns it, or the listing itself if nothing owns it.
- **Vocabularies:** a link to the schema, or a listing that provably matches it.
- **Interfaces other systems read**, each with its version rule linked to that rule's home.
- **Docs map:** every document in the repository with its kind, audience and edit rule. It is the
  only complete list of documents, and the tier is stated in it.

**Not in a manual:** rationale essays (link to the records); status or history (link to the
working documents); deploy-time variable names, endpoints or domains (link to the runbook);
organisation-wide rules (link to the handbook); counts without a date and a home; credentials;
real personal data.

**Split it** into a manual directory with one file per area when it passes roughly 400 lines
(opinion), when two audiences share no tasks, or when a single task starts carrying a table of
flags or fields — that last one is the reliable signal, because it means reference content has
leaked into Part A.

## Handbook — one repository for the whole organisation

The single organisation-wide set of rules for how repositories are placed, named, documented and
handed off, and how people and agent sessions work in them. One repository holds it. Every other
repository **links** to it and none copies it.

**It would hold:** the documentation standard itself; cross-repository working rules; the
cross-repository reference convention; the rule that no credential goes into documentation; an
index of repositories built from each README's description line. Where a repository *belongs* —
placement, and the policy it inherits — is a separate question with its own owner; the handbook
records the convention only if the organisation keeps it there.

**It would not hold:** anything about one repository's product, data, commands or status, and no
tool procedure — link to the skill.

**Length:** 200 lines or fewer per page (opinion).

Three constraints that decide whether this layer works at all:

- **It does not exist until a repository is named for it.** Until then, nothing links to it and no
  file cites it as the source of a rule. A pointer to a handbook that has not been created is
  worse than no pointer: the reader concludes the rules exist and that the failure is theirs.
- **The name must not collide with something in the estate.** If any repository describes itself
  as "not a handbook", or ships a product manual it calls a handbook, write the organisation-wide
  layer's name in full every time so neither reading is possible.
- **A shared block of agent rules copied into every repository is a separate decision, and a
  costly one.** It needs a source, a settled wording, and an answer for repositories a client can
  see. Until all three exist, each repository's agent file holds only its own rules.

## A repository that is a deliverable rather than a system

A deck, a static site, a report handed to a client: quick start only, with a **Use** section if
anything has to be run. No manual, no records directory, no agent file. Its README's "what it is
not" section does most of the work, because the commonest failure for this kind of repository is
a reader assuming it is maintained.
