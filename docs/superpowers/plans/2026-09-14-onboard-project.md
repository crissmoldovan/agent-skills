# onboard-project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a pack skill that picks a repository's skills from declared, testable evidence and wires them into every session through a generated rules file, with a silent session-start check that notices when the answer has changed.

**Architecture:** Pure evaluation first, then the shell around it. `fit.json` in every pack skill declares where that skill fits; a signal evaluator turns those declarations into evidence against one repository; a profile module reads and writes the two profile locations and renders the rules file; one CLI carries `plan`, `apply` and `check`; the check is also a `SessionStart` hook with its own installer, off until the user arms it. Nothing in the scripts installs a skill or touches the network — the skill runs the install commands the plan names, in order, and stops at the first failure.

**Tech Stack:** Node 22+, no dependencies (the pack's rule), `node --test`, the repository's existing `verify-skills` and catalogue tests.

**Spec:** `docs/superpowers/specs/2026-09-14-onboard-project-design.md`

## Global Constraints

- No runtime dependencies. Node's standard library only, ESM, Node 22+.
- No absolute machine paths, secrets, organisation names or private URLs in any committed file — `verify-skills` fails the build on the first two.
- A SKILL.md body is capped at 484 lines; `description` at 1024 characters and `compatibility` at 500.
- Every skill named in prose as a carried file (`scripts/x.mjs`, `references/y.md`) must exist in that skill's directory.
- The check hook prints **zero bytes** when it has nothing to say, never blocks, and fails open on any error.
- Tests never write the real `~/.claude/settings.json` or the real `~/.agents`: a temporary HOME and `--settings <path>` for every case that writes.
- A new skill is a **minor** release by this repository's rule.

## File structure

| File | Responsibility |
|---|---|
| `skills/onboard-project/SKILL.md` | The three entry points, what is written, and the consent rules |
| `skills/onboard-project/references/fit-signals.md` | The `fit.json` grammar, for authors of new skills |
| `skills/onboard-project/references/what-gets-written.md` | Every file the skill can write or arm, with its undo |
| `skills/onboard-project/scripts/fit.mjs` | Load `fit.json`; evaluate repo signals against a repository; evidence strings |
| `skills/onboard-project/scripts/history.mjs` | Bounded counts from this repository's own session history |
| `skills/onboard-project/scripts/profile.mjs` | Profile paths, read/write, fingerprint, rules-file rendering, installed-skill inventory |
| `skills/onboard-project/scripts/onboard.mjs` | The CLI: `plan`, `apply`, `check`; the change list |
| `skills/onboard-project/scripts/install-check-hook.mjs` | Writes/removes the `SessionStart` hook, recognised by command shape |
| `skills/<each>/references/fit.json` | One per pack skill: `signals`, `general` or `requestOnly` |
| `test/onboard-fit.test.mjs` | Every signal kind, both ways, against fixture repositories |
| `test/onboard-profile.test.mjs` | Profile round-trip, fingerprint, rules rendering, drift |
| `test/onboard-cli.test.mjs` | `plan`/`apply`/`check` end to end in temporary repositories with a temporary HOME |
| `test/onboard-check-hook.test.mjs` | Installer shape, `--remove`, silent-vs-one-line, `/bin/sh` and `dash` |
| `test/fixtures/onboard/*` | Repositories that do and do not carry each signal |

---

### Task 1: The signal evaluator

**Files:**
- Create: `skills/onboard-project/scripts/fit.mjs`
- Create: `test/onboard-fit.test.mjs`, `test/fixtures/onboard/`

**Interfaces:**
- Produces: `loadCatalogue(packRoot) -> Map<name, fit>`, `evaluateRepoSignals(fit, repoRoot) -> { matched: boolean, evidence: string[], trueSignals: string[] }`, `SIGNAL_KINDS`.

- [ ] **Step 1:** Write failing tests for `exists` (plain path and glob), `json`+`field` (dotted, missing field is false), `toml`/`yaml`+`field`, `grep` over a bounded glob, and `anyOf`/`allOf` combination — each asserted true against a fixture that has it and false against one that does not.
- [ ] **Step 2:** Run them; every case fails on a missing module.
- [ ] **Step 3:** Implement `fit.mjs`: a tiny glob matcher (`*`, `**`, no backtracking traps), shallow TOML and YAML field readers documented as shallow, `grep` bounded to a file count and a byte budget, and evidence strings that name the file and the reason (`package.json has a version`).
- [ ] **Step 4:** Run the tests; all pass.
- [ ] **Step 5:** Commit.

---

### Task 2: History counts

**Files:**
- Create: `skills/onboard-project/scripts/history.mjs`
- Modify: `test/onboard-fit.test.mjs`

**Interfaces:**
- Produces: `historyCounts(repoRoot, { home }) -> { known: boolean, agentDispatches, workflowLaunches, backgroundCommands, releaseCommands, writesOutsideRepo }`.

- [ ] **Step 1:** Write failing tests: a fabricated history directory under a temporary HOME yields the five counts; a repository with no history directory yields `known: false` and **no** count, so a history signal is *unknown* rather than false.
- [ ] **Step 2:** Run; fails.
- [ ] **Step 3:** Implement: encode the repository path the way Claude Code names its project directories, read `*.jsonl` line by line under a byte cap, count tool uses by name and by argument shape, and include sibling worktree directories.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit.

---

### Task 3: Profile, fingerprint and the rules file

**Files:**
- Create: `skills/onboard-project/scripts/profile.mjs`
- Create: `test/onboard-profile.test.mjs`

**Interfaces:**
- Produces: `profilePaths(repoRoot, { home })`, `readProfile`, `writeProfileAtomically`, `fingerprintOf(trueSignalsBySkill)`, `renderRules(profile)`, `installedSkills({ repoRoot, home })`, `rulesPath(repoRoot)`.

- [ ] **Step 1:** Failing tests: a profile round-trips; the fingerprint is stable under key order and changes when a signal appears or disappears; `renderRules` emits the generated-by header, one line per skill, strong matches first; `installedSkills` reads both lock files and both skill directories; writes are atomic (temporary file then rename).
- [ ] **Step 2:** Run; fails.
- [ ] **Step 3:** Implement. The fingerprint covers **repo** signals only, because the session-start check never reads history and must still be able to compare.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit.

---

### Task 4: The CLI — `plan`

**Files:**
- Create: `skills/onboard-project/scripts/onboard.mjs`
- Create: `test/onboard-cli.test.mjs`

**Interfaces:**
- Consumes: Tasks 1-3. Produces: `node onboard.mjs plan [--repo <path>] [--json]` printing the change list (`+` add, `=` present, `~` write, `!` arm, each with its undo) and, with `--json`, the machine-readable plan.

- [ ] **Step 1:** Failing tests: a fixture repository with a versioned manifest plans `+ release-notes` with its evidence; an already-installed skill plans `=`; the rules file and profile appear as `~` writes with undos; a hook line is marked "affects all projects"; a declined skill is not re-offered while its own fingerprint is unchanged; `--json` parses and carries the same rows.
- [ ] **Step 2:** Run; fails.
- [ ] **Step 3:** Implement `plan`: scan, match (strong, general, and weak entries only when the caller supplies them), render. Placement resolves from the user config's `commitOwners` against the repository's origin owner, and a non-git repository is local-only.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit.

---

### Task 5: The CLI — `apply`

**Files:**
- Modify: `skills/onboard-project/scripts/onboard.mjs`, `test/onboard-cli.test.mjs`

**Interfaces:**
- Produces: `node onboard.mjs apply [--repo <path>] [--yes]` — writes **files only** (profile, rules, and for local placement the `.git/info/exclude` entry), then prints the install and hook commands in order for the caller to run.

- [ ] **Step 1:** Failing tests: `apply` without `--yes` writes nothing and says so; with `--yes` it writes exactly the planned files and no others; re-running is idempotent; a failed write stops at the first failure and the report names what was and was not applied; the printed install commands match the plan's `+` rows in order.
- [ ] **Step 2:** Run; fails.
- [ ] **Step 3:** Implement, atomically, with the rules file's generated-by header.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit.

---

### Task 6: The check, and its hook

**Files:**
- Modify: `skills/onboard-project/scripts/onboard.mjs`
- Create: `skills/onboard-project/scripts/install-check-hook.mjs`, `test/onboard-check-hook.test.mjs`

**Interfaces:**
- Produces: `node onboard.mjs check [--hook]` — silent when profile, signals, required skills and rules all agree; one line otherwise; `--hook` wraps that line in the `SessionStart` `additionalContext` envelope. `install-check-hook.mjs [--settings <path>] [--remove]`.

- [ ] **Step 1:** Failing tests: check prints zero bytes when everything agrees; one line when a required skill is missing, when the fingerprint moved, or when the rules file drifted; it never reads history; it exits 0 and prints nothing on a corrupt profile, an unreadable rules file or a missing HOME; the installer writes `startup` and `resume` matchers, recognises its own hook by command shape after `describe` is stripped, is idempotent, and `--remove` leaves the file otherwise byte-identical; the hook runs correctly under `/bin/sh` **and** `dash`.
- [ ] **Step 2:** Run; fails.
- [ ] **Step 3:** Implement. Fail open everywhere: any throw becomes exit 0 with no output.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit.

---

### Task 7: `fit.json` for all 26 skills, and the verifier rule

**Files:**
- Create: `skills/<each>/references/fit.json`
- Modify: `scripts/verify-skills.mjs`, `test/verify-skills.test.mjs`

- [ ] **Step 1:** Failing test: `verify-skills` fails a skill directory with no `fit.json`, with an unparseable one, or with a `kind` outside the three.
- [ ] **Step 2:** Run; fails.
- [ ] **Step 3:** Add the rule to `verify-skills.mjs`; write all 26 `fit.json` files from the spec's table, each `useWhen` phrased as the routing line a reader will see.
- [ ] **Step 4:** `verify-skills` passes; a fixture test asserts each `signals` skill matches a repository that should have it and not one that should not.
- [ ] **Step 5:** Commit.

---

### Task 8: SKILL.md, references, catalogue registration and release

**Files:**
- Create: `skills/onboard-project/SKILL.md`, `references/fit-signals.md`, `references/what-gets-written.md`
- Modify: `README.md`, `CONTRIBUTING.md`, `docs/architecture.md`, `docs/composition.md`, `docs/releases.md`, `package.json`, `package-lock.json`, `test/catalog-content.test.mjs`, `test/workspace-governance-skill.test.mjs`

- [ ] **Step 1:** Write the skill: the three entry points, the consent rule (one yes, everything shown first), what it never touches (CLAUDE.md, AGENTS.md, generated context files), the non-duplication paragraph CONTRIBUTING requires, and the pitfalls the spec names.
- [ ] **Step 2:** Register: README row and use example, counts from twenty-six to twenty-seven in four files, the ownership paragraph and staged prose in `docs/releases.md`, version to 0.22.0, catalogue test updated.
- [ ] **Step 3:** `node scripts/verify-skills.mjs` and `node --test test/*.mjs` both green.
- [ ] **Step 4:** Commit, PR, merge, CHANGELOG entry, tag, release, read back.

---

## Self-review

- **Spec coverage:** §4.1 → Tasks 4-6, 8; §4.2 → Tasks 1, 7; §4.3 → Task 3; §4.3.1 → Tasks 3-4 (user config and the local profile location); §4.4 → Task 3; §4.5 → Task 6; §5.1 → Tasks 4-5; §5.2 → Task 4 (diff rows) and 5; §5.3 → Task 6; §5.4 → Task 4 (scope decision) and 5 (printed commands); §6 edge cases → Tasks 1 (monorepo globs), 2 (worktrees, absent history), 3 (atomic writes, drift), 4 (non-git); §7 → the test files in every task; §8 → Task 8.
- **Deviation from the spec, recorded deliberately:** the scripts do not run `npx skills add` themselves. `apply` writes files and prints the install and hook commands in order; the skill runs them and stops at the first failure. The spec's "apply in order: files, installs, hooks" is preserved, the network stays out of a script the session-start hook also loads, and every install remains visible to the user.
