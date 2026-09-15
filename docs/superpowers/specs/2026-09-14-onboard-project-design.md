# onboard-project — a project's skills, chosen from evidence and wired every session

- **Status:** design approved section by section; spec awaiting review
- **Date:** 2026-09-14
- **Repository:** crissmoldovan/agent-skills, branch `feat/onboard-project`
- **Builds on:** `update-agent-skills` (installs, session-start hook pattern), `derive-codebase-context`
  (agent context files), `report-progress` and `release-notes` (their gates are among the hooks it can arm)

## 1. The problem, as observed

- **Skills are chosen by description matching, and nothing more.** A skill loads only when its
  description happens to match the task, or when a person types `/skill-name`. There is no supported way
  to force-load a skill, and SKILL.md frontmatter has no field for one skill to require another.
- **A large install base drowns the right skill.** A real machine carried 201 installed skills. A skill a
  project depends on rarely surfaces on its own.
- **Enforcement without the skill is shallow.** The `report-progress` gate fired and was satisfied in real
  sessions, while the agents wrote the three headings from memory and never loaded the skill. One agent said
  so when asked. The parts that make the skill worth having — verified numbers kept apart from claimed ones,
  the user-facing consequence, corrections stated out loud — were never read.
- **Routing today is hand-written and rare.** Across 76 repositories on that machine, exactly one project
  CLAUDE.md carried a skill-routing section, and about ten had context files marked "generated, do not edit"
  that would overwrite anything inserted by hand.

## 2. Goals and non-goals

**Goals**

1. For any repository, recommend the skills it should use, each with the evidence that justified it.
2. Wire them so that every session in that repository sees them, without relying on description matching.
3. Notice, cheaply and quietly, when a required skill is missing or the repository gained something a skill
   fits.
4. Change nothing without one explicit yes, and make every change undoable.

**Non-goals**

- Force-loading skills. Claude Code does not support it; this steers through a file every session loads.
- Recommending skills that are not installed and not in this pack (no online discovery).
- Editing CLAUDE.md or AGENTS.md.
- Deciding model routing, lifecycle visibility or task planning; those stay with their own skills.

## 3. Decisions

| # | Decision | Reason |
|---|---|---|
| D1 | The project's skill list is committed in the repository | Teammates and other machines get the same setup |
| D2 | Routing is a generated `.claude/rules/skill-routing.md`, not a section in CLAUDE.md | Rules files load every session at CLAUDE.md priority; generated CLAUDE.md files would overwrite an inserted section |
| D3 | Onboarding shows every change and applies on one yes | Automation the user asked for, with explicit consent in the moment |
| D4 | Pack skills are recommended first, from declared fit; other installed skills second, from their descriptions, labelled weaker | Declared fit is testable; description matching is not |
| D5 | A quiet check at session start: silent unless something is missing or new | Context stays clean on normal sessions |
| D6 | One new pack skill with its own profile file, beside the Skills CLI's `skills-lock.json` | The lock file records what is installed and is rewritten by the CLI, so fields added to it can be dropped |
| D7 | Session history is read only by onboard and refresh, never at session start | History files can be tens of megabytes |
| D8 | Commit or keep local is asked once per repository and remembered; defaults come from a user config | Some repositories must not receive committed tooling files |
| D9 | Hooks that live in user settings (gates, the check hook) are flagged as affecting all projects | Onboarding one project must not silently change every session |

## 4. Components

### 4.1 `onboard-project` (new pack skill)

Three entry points, one skill:

- **onboard** — for a repository with no profile: scan, recommend, show the change list, apply on one yes.
- **refresh** — for a repository with a profile: scan again, show only differences, apply on one yes.
- **check** — the session-start check: reads, never writes, and speaks only when needed.

The skill body stays under the pack's body limit; the scanner, the change-list renderer and the check live
as scripts the skill carries.

### 4.2 `references/fit.json` in every pack skill

Where the skill fits, as evidence a script can evaluate. Three kinds:

- **repo** — files, folders, globs, package manifest fields, script names, CI configuration.
- **history** — counts from this repository's own Claude Code session history on this machine: agent
  dispatches, workflow launches, background commands, releases cut.
- **general** or **requestOnly** — `general` skills fit nearly any repository and form a small default set;
  `requestOnly` skills are invoked by explicit request and are never recommended by a scan.

```json
{
  "version": 1,
  "kind": "signals",
  "useWhen": "about to cut a release, bump a version, or write a CHANGELOG entry",
  "anyOf": [
    { "repo": { "json": "package.json", "field": "version" } },
    { "repo": { "toml": "Cargo.toml", "field": "package.version" } },
    { "repo": { "exists": ".changeset/" } },
    { "repo": { "exists": "CHANGELOG.md" } }
  ]
}
```

`kind` is one of `signals`, `general`, `requestOnly`. A `repo` signal is one of `exists` (a path or glob),
`json` / `toml` / `yaml` with a `field` (a dotted key that must be present), or `grep` (a regular expression
over a bounded glob). A `history` signal is a named count with a minimum, e.g.
`{ "history": { "count": "agentDispatches", "atLeast": 5 } }`; the counts are `agentDispatches`,
`workflowLaunches`, `backgroundCommands`, `releaseCommands` (package publish, release create, version tag) and
`writesOutsideRepo` (file-writing tool calls whose path lies outside the repository root). `useWhen` is the one line written into the routing
file. `anyOf` / `allOf` combine signal objects. `verify-skills` rejects a pack skill without a valid
`fit.json`.

Initial fit, derived from each skill's own "When to Use":

| Skill | Kind | Signals |
|---|---|---|
| release-notes | signals | version field in a package or app manifest; `.changeset/`; a changelog file; releases in history |
| report-progress | signals | history: agent dispatches, workflow launches or background commands |
| agent-lifecycle | signals | repo: code that spawns or supervises child agents; history: heavy delegation |
| model-routing | signals | history: many agent dispatches or workflow launches |
| github-webhooks | signals | repo: webhook signature verification or a GitHub event handler |
| release-ledger | signals | repo: an app with authenticated users and a changelog or release process |
| derive-codebase-context | signals | repo: no CLAUDE.md, or several agent context files that disagree |
| layer-repository-docs | signals | repo: no README, or a README past a length threshold |
| land-complex-change | signals | repo: more than one surface present (schema/migrations, jobs, config beside code) |
| secure-credential-setup | signals | repo: an env example file, or config reading API keys from the environment |
| work-in-external-repo | signals | history: writes outside the repository's own path |
| investigate-codebase, blast-area, decision-journal | general | — |
| resolve-problem-report, describe-changes, delphi-ground, delphi-imagine, visualise-blast-area, new-ux-discovery | general | — |
| blocks, request-blocks-review, publish-agent-skill, update-agent-skills, workspace-governance | requestOnly | — |

The table is the starting point; each entry is finalised with fixture tests when its `fit.json` is written.

### 4.3 `skills-profile.json`

Committed at the repository root, beside `skills-lock.json`. For a repository kept local, the same content
lives under the user's agents directory, keyed by the repository path.

```json
{
  "version": 1,
  "generatedBy": "onboard-project 1.0.0",
  "scannedAt": "2026-09-14T23:50:00Z",
  "placement": "committed",
  "fingerprint": "sha256 of the sorted list of fit signals that evaluated true",
  "skills": {
    "release-notes": {
      "match": "strong",
      "evidence": ["package.json has a version"],
      "useWhen": "about to cut a release, bump a version, or write a CHANGELOG entry",
      "required": true,
      "scope": "project"
    }
  },
  "declined": {
    "github-webhooks": { "at": "2026-09-14", "fingerprint": "sha256 of that skill's true signals" }
  }
}
```

- `match` is `strong` (declared fit), `weak` (description) or `general`.
- `required` is proposed true for strong matches and false for weak ones; the check warns only for required
  skills that are not installed.
- `scope` records where the skill is installed: `project` or `global`.
- `declined` remembers a no. A declined skill is offered again only when its own signal fingerprint changes.
- Committed evidence holds counts and repository-relative paths only — no absolute paths, no file content,
  no history text.

### 4.3.1 User-level files

Everything that must not be committed lives under the user's agents directory, `~/.agents/`, beside the
Skills CLI's own global lock file:

- `~/.agents/onboard-project.json` — user config: `commitOwners`, the origin owners whose repositories take
  committed files. Any other owner pre-selects local placement.
- `~/.agents/project-profiles/<encoded-repo-path>.json` — the profile for a repository kept local, and for any
  repository where the user answered "don't suggest onboarding here" (`{ "onboarding": "declined" }`). The
  path is encoded the way Claude Code names project history: every character that is not a letter or a digit
  becomes `-`.

### 4.4 `.claude/rules/skill-routing.md`

Generated from the profile. A rules file without `paths` frontmatter loads at the start of every session with
the same priority as the project CLAUDE.md, which is what makes the skills visible without description
matching.

```markdown
<!-- Generated by onboard-project from skills-profile.json. Do not edit; change the profile and run refresh. -->
# Skill routing for this project

- about to cut a release, bump a version, or write a CHANGELOG entry → `release-notes`
- delegating to agents, or leaving work running across turns → `report-progress`
```

One line per listed skill, strong matches first. Evidence stays in the profile to keep the loaded text short.

### 4.5 The session-start check hook

- Runs `check` on `SessionStart` for new processes (`startup` and `resume`).
- Installed by its own installer in the pack's existing pattern, and **off until the user arms it**. It has one
  mode — it never blocks, so there is no `observe` / `block` choice — and arming it means the installer writes
  the hook with its assignment in the command. The installer recognises its own hooks by command shape and
  supports `--remove`.
- Output travels as `additionalContext`: zero bytes when there is nothing to say, one line when there is.
- Fails open: any error, timeout or unreadable file produces no output.

## 5. Flows

### 5.1 Onboard

1. **Placement.** Ask once whether this repository gets committed files or keeps them local. Pre-select from
   the user config's list of owners whose repositories take committed files; any other origin owner
   pre-selects local. Remember the answer in the profile.
2. **Scan.** Evaluate every pack skill's `fit.json` against the repository files, and history signals
   against this repository's session history (including its worktrees' histories).
3. **Match.** Strong matches from `fit.json`; the general set; then weak matches, where the agent reads the
   descriptions of other installed skills against what the scan found and labels each "suggested from
   description, not checked". Nothing without evidence is recommended.
4. **Change list.** One list, every line with its undo:
   - `+` a skill to add, its match and evidence, and what installing it takes;
   - `=` a skill already installed, which is only listed;
   - `~` files to write (`skills-profile.json`, `.claude/rules/skill-routing.md`, and for a local placement the
     `.git/info/exclude` entry);
   - `!` a hook to arm, marked **affects all projects**.
5. **Apply on one yes,** in order: files, then installs, then hooks. Stop at the first failure and report
   exactly what was applied and what was not.
6. **On no,** write nothing. Record declined skills only if the user says not to ask again.

### 5.2 Refresh

Same scan. The change list shows only differences: new matches, skills whose evidence disappeared (offered for
removal, never removed silently), required skills not installed, and a rules file that no longer matches its
profile (hand edit or formatter) with a diff.

### 5.3 Check

1. Find the profile (repository root, then the local location). If none and this is a git repository with
   code, say one line suggesting onboarding — once per repository, until the user answers.
2. Re-evaluate **repo** signals only, within a bounded file set (the union of globs the pack's `fit.json`
   files name). Compare with the stored fingerprint.
3. Check that required skills are installed (project and global Skills CLI lock files, and skill
   directories).
4. Regenerate the rules file in memory and compare with the one on disk.
5. Say nothing if all agree. Otherwise one line naming what changed and suggesting refresh.

### 5.4 Install scope

- Already installed at any scope: list it, install nothing.
- Missing, committed placement: install at project scope, so `skills-lock.json` carries it. The installed skill
  folders follow the repository's existing convention: if the Skills CLI's project skill directories are
  ignored, they stay ignored and `skills-lock.json` restores them; otherwise the change list names the folders
  as files that will appear in the next commit.
- Missing, local placement: install globally.

## 6. Edge cases

| Case | Behaviour |
|---|---|
| Monorepo | One profile at the root; repo signals evaluated across every workspace package, found from `package.json` `workspaces`, `pnpm-workspace.yaml`, or a Cargo `[workspace]` |
| Worktrees | The committed profile arrives through git; history signals include each worktree's history |
| Not a git repository | Local placement only; never writes committed files |
| Rules file edited by hand or reflowed by a formatter | Check reports drift; refresh shows the diff; never overwritten silently |
| Listed skill with no known source | "listed, not installed, source unknown" |
| History absent on another machine | History signals are **unknown**, not false; no skill is dropped for lack of history |
| Two sessions refreshing together | Atomic writes (temporary file, then rename) |
| Context files generated elsewhere | Untouched; the rules file is separate from them |

## 7. Testing

- `verify-skills` enforces a valid `fit.json` in every pack skill.
- Each fit signal is tested both ways against fixture repositories.
- Onboard and refresh apply and undo against temporary repositories with a temporary HOME; the real user
  settings file is never written.
- The check prints zero bytes when silent and exactly one line otherwise, stays within a time budget, and is
  fired through `/bin/sh` **and** `dash`, since hook commands meet `dash` on Linux.
- One live headless session in a throwaway project proves the rules file loads and the check line reaches the
  model, using the method recorded in `adapters/HOOK-OUTPUT-NOTES.md`.

## 8. Release

A minor pack release: the new skill, `fit.json` in every pack skill, the check-hook installer, README and
catalogue entries, and release notes that tell users the hook is off until they arm it.
