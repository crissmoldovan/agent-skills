# Changelog

Per-version record of what shipped. The public, reader-facing changelog is the
[GitHub Releases](https://github.com/crissmoldovan/agent-skills/releases) page, whose bodies
mirror these entries; `docs/releases.md` carries the release process and the staged prose for
the next version. Entries before v0.12.0 live only on the Releases page.

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
